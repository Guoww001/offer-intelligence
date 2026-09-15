import type { ReportDataProvider, ReportRow, ReportSource } from "./reportContracts";

type RawRecord = Readonly<Record<string, unknown>>;

export interface ReportDataProviderOptions {
  readonly offers: readonly ReportRow[];
  readonly paymentRecords?: readonly ReportRow[];
  readonly keywords?: unknown;
  readonly publishers?: unknown;
  readonly source?: ReportSource["kind"];
  readonly asOf?: string | null;
  readonly preferRemote?: boolean;
  readonly loadOffers?: (signal: AbortSignal) => Promise<unknown>;
  readonly loadKeywords?: (signal: AbortSignal) => Promise<unknown>;
  readonly loadMerchant?: (merchantId: string, months: number, signal: AbortSignal) => Promise<unknown>;
  readonly loadAsin?: (asins: readonly string[], months: number, signal: AbortSignal) => Promise<unknown>;
  readonly loadSearch?: (query: string, signal: AbortSignal) => Promise<unknown>;
  readonly loadPublishers?: (signal: AbortSignal) => Promise<unknown>;
  readonly loadPublisherPortfolio?: (userId: string, startDate: string | null, endDate: string | null, signal: AbortSignal) => Promise<unknown>;
}

export interface ReportProviderSnapshot {
  readonly source: ReportSource["kind"];
  readonly asOf: string | null;
  readonly offersLoadedFrom: ReportSource["kind"];
  readonly detailLoadedFrom: ReportSource["kind"];
  readonly publishersLoadedFrom: ReportSource["kind"];
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsFrom(value: unknown, keys: readonly string[] = ["rows", "offers", "records", "items", "merchants", "results"]): readonly ReportRow[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (value.ok === false) return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [];
}

function hasPayloadData(value: unknown, keys: readonly string[]): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!isRecord(value) || value.ok === false) return false;
  if (keys.some((key) => Array.isArray(value[key]) && value[key].length > 0)) return true;
  return Object.keys(value).some((key) => !["ok", "summary", "checkedAt", "generatedAt", "source", ...keys].includes(key));
}

function cloneRows(rows: readonly ReportRow[]): readonly ReportRow[] {
  return rows.map((row) => ({ ...row }));
}

function abortError(): DOMException {
  return new DOMException("Report request aborted", "AbortError");
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

/**
 * 会话级数据提供器：先复用 bootstrap/cache，只有本地数据不足或报告类型需要时才调用现有 API。
 * 每个请求共享同一 Promise，避免同一轮查询重复打接口；调用方取消只结束自己的等待，不取消其他窗口的共享请求。
 */
export function createReportDataProvider(options: ReportDataProviderOptions): ReportDataProvider & {
  readonly snapshot: () => ReportProviderSnapshot;
} {
  let offerSource: ReportSource["kind"] = options.offers.length ? (options.source || "cache") : "unavailable";
  let detailSource: ReportSource["kind"] = "unavailable";
  let paymentRows: readonly ReportRow[] = cloneRows(options.paymentRecords || []);
  let publisherSource: ReportSource["kind"] = hasPayloadData(options.publishers, ["publishers", "rows", "items"]) ? (options.source || "cache") : "unavailable";
  const preferRemote = options.preferRemote ?? Boolean(options.loadOffers);
  let offersPromise: Promise<readonly ReportRow[]> | null = null;
  let keywordsPromise: Promise<unknown> | null = null;
  let publishersPromise: Promise<unknown> | null = null;
  const merchantPromises = new Map<string, Promise<unknown>>();
  const asinPromises = new Map<string, Promise<unknown>>();
  const searchPromises = new Map<string, Promise<unknown>>();
  const portfolioPromises = new Map<string, Promise<unknown>>();

  async function offers(signal: AbortSignal): Promise<readonly ReportRow[]> {
    if (!preferRemote && options.offers.length) return cloneRows(options.offers);
    if (!options.loadOffers) return cloneRows(options.offers);
    if (!offersPromise) {
      const sharedController = new AbortController();
      offersPromise = options.loadOffers(sharedController.signal).then((payload) => {
        if (isRecord(payload) && Array.isArray(payload.paymentRecords)) paymentRows = payload.paymentRecords.filter(isRecord);
        const rows = cloneRows(rowsFrom(payload, ["offers", "rows", "records", "items"]));
        if (rows.length) {
          offerSource = "db";
          return rows;
        }
        offerSource = options.offers.length ? (options.source || "cache") : "unavailable";
        return cloneRows(options.offers);
      }).catch((error) => {
        offersPromise = null;
        offerSource = options.offers.length ? (options.source || "cache") : "unavailable";
        return cloneRows(options.offers);
      });
    }
    return awaitWithSignal(offersPromise, signal);
  }

  async function paymentRecords(signal: AbortSignal): Promise<readonly ReportRow[]> {
    if (paymentRows.length) return cloneRows(paymentRows);
    await offers(signal);
    return cloneRows(paymentRows);
  }

  async function keywords(signal: AbortSignal): Promise<unknown> {
    if (hasPayloadData(options.keywords, ["merchants", "rows", "keywords", "items"])) return options.keywords;
    if (!options.loadKeywords) return {};
    if (!keywordsPromise) {
      const sharedController = new AbortController();
      keywordsPromise = options.loadKeywords(sharedController.signal).catch((error) => {
        keywordsPromise = null;
        throw error;
      });
    }
    return awaitWithSignal(keywordsPromise, signal);
  }

  async function merchant(merchantId: string, months: number, signal: AbortSignal): Promise<unknown> {
    const key = `${merchantId}::${months}`;
    if (options.loadMerchant) {
      if (!merchantPromises.has(key)) {
        const sharedController = new AbortController();
        merchantPromises.set(key, options.loadMerchant(merchantId, months, sharedController.signal)
          .then((payload) => {
            if (hasPayloadData(payload, ["rows", "offers", "merchant", "products", "monthlyAmazonMetrics", "monthlyAggregateMetrics"])) detailSource = "db";
            return payload;
          })
          .catch((error) => {
            merchantPromises.delete(key);
            throw error;
          }));
      }
      return awaitWithSignal(merchantPromises.get(key)!, signal);
    }
    const rows = await offers(signal);
    return { rows: rows.filter((row) => String(row.merchantId ?? row.merchant_id ?? row.id ?? "") === merchantId) };
  }

  async function asin(asins: readonly string[], months: number, signal: AbortSignal): Promise<unknown> {
    const normalized = Array.from(new Set(asins.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))).sort();
    const key = `${normalized.join(",")}::${months}`;
    if (options.loadAsin) {
      if (!asinPromises.has(key)) {
        const sharedController = new AbortController();
        asinPromises.set(key, options.loadAsin(normalized, months, sharedController.signal)
          .then((payload) => {
            if (hasPayloadData(payload, ["rows", "asins"])) detailSource = "db";
            return payload;
          })
          .catch((error) => {
            asinPromises.delete(key);
            throw error;
          }));
      }
      return awaitWithSignal(asinPromises.get(key)!, signal);
    }
    return { rows: [] };
  }

  async function search(query: string, signal: AbortSignal): Promise<unknown> {
    const key = query.trim().toLowerCase();
    if (options.loadSearch) {
      if (!searchPromises.has(key)) {
        searchPromises.set(key, options.loadSearch(query, new AbortController().signal).catch((error) => {
          searchPromises.delete(key);
          throw error;
        }));
      }
      return awaitWithSignal(searchPromises.get(key)!, signal);
    }
    const rows = await offers(signal);
    return { rows: rows.filter((row) => JSON.stringify(row).toLowerCase().includes(key)) };
  }

  async function publishers(signal: AbortSignal): Promise<unknown> {
    if (hasPayloadData(options.publishers, ["publishers", "rows", "items"])) return options.publishers;
    if (!options.loadPublishers) return { publishers: [] };
    if (!publishersPromise) {
      const sharedController = new AbortController();
      publishersPromise = options.loadPublishers(sharedController.signal).then((payload) => {
        publisherSource = hasPayloadData(payload, ["publishers", "rows", "items"]) ? "db" : "unavailable";
        return payload;
      }).catch((error) => {
        publishersPromise = null;
        publisherSource = hasPayloadData(options.publishers, ["publishers", "rows", "items"])
          ? (options.source || "cache")
          : "unavailable";
        return options.publishers || { publishers: [] };
      });
    }
    return awaitWithSignal(publishersPromise, signal);
  }

  async function publisherPortfolio(userId: string, startDate: string | null, endDate: string | null, signal: AbortSignal): Promise<unknown> {
    const key = `${userId}::${startDate || ""}::${endDate || ""}`;
    if (!options.loadPublisherPortfolio) return { merchants: [] };
    if (!portfolioPromises.has(key)) {
      portfolioPromises.set(key, options.loadPublisherPortfolio(userId, startDate, endDate, new AbortController().signal).catch((error) => {
        portfolioPromises.delete(key);
        throw error;
      }));
    }
    return awaitWithSignal(portfolioPromises.get(key)!, signal);
  }

  return {
    offers,
    paymentRecords,
    keywords,
    merchant,
    asin,
    search,
    publishers,
    publisherPortfolio,
    snapshot: () => ({
      source: offerSource === "db" || publisherSource === "db" || detailSource === "db"
        ? "db"
        : offerSource !== "unavailable"
          ? offerSource
          : publisherSource !== "unavailable"
            ? publisherSource
            : detailSource,
      asOf: options.asOf || null,
      offersLoadedFrom: offerSource,
      detailLoadedFrom: detailSource,
      publishersLoadedFrom: publisherSource
    })
  };
}

export function reportRowsFromPayload(value: unknown): readonly ReportRow[] {
  return rowsFrom(value);
}
