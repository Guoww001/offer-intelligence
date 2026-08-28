import { createApp, h } from "vue";

import "./shared/styles/modern-root.css";
import "./features/offer-tracker/offerTracker.css";
import "./features/payments/payments.css";
import "./features/publishers/publishers.css";
import "./features/brand-media/brandMedia.css";
import "./features/revenue-flow/revenueFlow.css";

import { createModernAppApi, getLegacySnapshot } from "./legacy/bridge";
import type {
  LegacyBootstrapData,
  ModernPageController,
  ModernPageFactory
} from "./legacy/contracts";
import type {
  OfferRecord,
  OfferTrackerDateRange,
  OfferTrackerExportPayload
} from "./shared/contracts/offer";
import type { PaymentExportPayload, PaymentLivePayload } from "./shared/contracts/payment";
import type { PublisherExportPayload } from "./features/publishers/publisherModel";
import { apiRequest } from "./shared/api/client";
import { createI18nStore } from "./shared/i18n";
import OfferTrackerPage from "./features/offer-tracker/OfferTrackerPage.vue";
import PaymentsPage from "./features/payments/PaymentsPage.vue";
import PublishersPage from "./features/publishers/PublishersPage.vue";
import BrandMediaPage from "./features/brand-media/BrandMediaPage.vue";
import type { BrandMediaTrendRequest } from "./features/brand-media/useBrandMedia";
import RevenueFlowPage from "./features/revenue-flow/RevenueFlowPage.vue";
import type { RevenueFlowCatalogOption } from "./features/revenue-flow/revenueFlowModel";
import type { RevenueFlowTrendRequest } from "./features/revenue-flow/useRevenueFlow";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

interface OfferTrackerOffersPayload {
  readonly offers?: unknown;
}

interface PaymentsApiPayload {
  readonly records?: unknown;
  readonly checkedAt?: unknown;
}

function chatbotRecord(data: LegacyBootstrapData): Record<string, unknown> {
  return isRecord(data.chatbotData) ? data.chatbotData : {};
}

function offerRecords(data: LegacyBootstrapData): readonly OfferRecord[] {
  const rows = chatbotRecord(data).offers;
  return Array.isArray(rows)
    ? rows.filter((row): row is OfferRecord => isRecord(row))
    : [];
}

function paymentRecords(data: LegacyBootstrapData): readonly Record<string, unknown>[] {
  const rows = chatbotRecord(data).paymentRecords;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
}

function sheetRows(data: LegacyBootstrapData): readonly Record<string, unknown>[] {
  const sheetReport = isRecord(data.sheetReportData) ? data.sheetReportData : {};
  const sheets = sheetReport.sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets.flatMap((sheet) => {
    if (!isRecord(sheet) || !Array.isArray(sheet.rows)) return [];
    return sheet.rows.filter((row): row is Record<string, unknown> => isRecord(row));
  });
}

function defaultDateRange(data: LegacyBootstrapData): OfferTrackerDateRange {
  const chatbotData = chatbotRecord(data);
  const startDate = stringValue(chatbotData.startDate);
  const endDate = stringValue(chatbotData.endDate);
  if (startDate && endDate) return { startDate, endDate };
  return { startDate: "1970-01-01", endDate: "1970-01-01" };
}

async function loadOfferTrackerRange(range: OfferTrackerDateRange): Promise<readonly OfferRecord[]> {
  const query = new URLSearchParams({
    start_date: range.startDate,
    end_date: range.endDate
  });
  const payload = await apiRequest<OfferTrackerOffersPayload>(
    `/api/ui/db/offers?${query.toString()}`
  );
  if (!isRecord(payload) || !Array.isArray(payload.offers)) {
    throw new Error("Offer Tracker API 响应缺少 offers");
  }
  return payload.offers.filter((row): row is OfferRecord => isRecord(row));
}

function downloadOfferTracker(payload: OfferTrackerExportPayload): boolean {
  const bridge = window.OI_LEGACY_BRIDGE;
  if (!bridge) return false;
  return bridge.download("offer-tracker", payload);
}

async function loadPayments(): Promise<PaymentLivePayload> {
  const payload = await apiRequest<PaymentsApiPayload>("/api/levanta/payments");
  if (!isRecord(payload) || !Array.isArray(payload.records)) {
    throw new Error("Payments API 响应缺少 records");
  }
  const checkedAt = stringValue(payload.checkedAt).slice(0, 10);
  return {
    records: payload.records,
    ...(checkedAt ? { checkedAt } : {})
  };
}

async function loadPublishers(): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/publishers");
}

async function loadPublisherPortfolio(userId: string, startDate: string, endDate: string): Promise<unknown> {
  const query = new URLSearchParams({ userId });
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);
  return apiRequest<unknown>(`/api/ui/db/publishers?${query.toString()}`);
}

async function loadBrandMediaCatalog(): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/publishers");
}

async function loadBrandMediaTrend(request: BrandMediaTrendRequest): Promise<unknown> {
  const query = new URLSearchParams({
    merchantId: request.merchantId,
    startDate: request.startDate,
    endDate: request.endDate
  });
  return apiRequest<unknown>(`/api/ui/db/brand-media-trend?${query.toString()}`, {
    signal: request.signal
  });
}

async function loadRevenueFlowCatalog(): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/publishers");
}

async function loadRevenueFlowTrend(request: RevenueFlowTrendRequest): Promise<unknown> {
  const query = new URLSearchParams({
    merchantIds: request.merchantIds.join(","),
    startDate: request.startDate,
    endDate: request.endDate
  });
  return apiRequest<unknown>("/api/ui/db/brand-media-sankey?" + query.toString(), {
    signal: request.signal,
    timeoutMs: 30_000
  });
}

function revenueFlowInitialState(element: HTMLElement): {
  readonly merchants: readonly RevenueFlowCatalogOption[];
  readonly startDate: string;
  readonly endDate: string;
} {
  let merchants: RevenueFlowCatalogOption[] = [];
  try {
    const parsed = JSON.parse(element.dataset.initialMerchants || "[]") as unknown;
    if (Array.isArray(parsed)) {
      merchants = parsed.filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
          merchantId: stringValue(item.merchantId || item.id),
          name: stringValue(item.name || item.merchantName || item.merchantId || item.id),
          count: Number.isFinite(Number(item.count)) ? Math.max(0, Number(item.count)) : 0
        }))
        .filter((item) => item.merchantId)
        .slice(0, 12);
    }
  } catch {
    merchants = [];
  }
  return {
    merchants,
    startDate: stringValue(element.dataset.initialStartDate),
    endDate: stringValue(element.dataset.initialEndDate)
  };
}

function downloadPayments(payload: PaymentExportPayload): boolean {
  const bridge = window.OI_LEGACY_BRIDGE;
  if (!bridge) return false;
  return bridge.download("payments", payload);
}

function downloadPublishers(payload: PublisherExportPayload): boolean {
  const bridge = window.OI_LEGACY_BRIDGE;
  if (!bridge) return false;
  return bridge.download("publishers", payload);
}

const offerTrackerFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getLegacySnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const offers = offerRecords(snapshot);
  const range = defaultDateRange(snapshot);
  const app = createApp({
    name: "ModernOfferTrackerMount",
    setup() {
      return () => h(OfferTrackerPage, {
        offers,
        language: i18n.language.value,
        defaultDateRange: range,
        loadRange: loadOfferTrackerRange,
        download: downloadOfferTracker
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const paymentsFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getLegacySnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernPaymentsMount",
    setup() {
      return () => h(PaymentsPage, {
        records: paymentRecords(snapshot),
        offers: offerRecords(snapshot),
        sheetRows: sheetRows(snapshot),
        language: i18n.language.value,
        loadLive: loadPayments,
        download: downloadPayments
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const publishersFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getLegacySnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernPublishersMount",
    setup() {
      return () => h(PublishersPage, {
        language: i18n.language.value,
        loadData: loadPublishers,
        loadPortfolio: loadPublisherPortfolio,
        download: downloadPublishers
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const brandMediaFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getLegacySnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernBrandMediaMount",
    setup() {
      return () => h(BrandMediaPage, {
        language: i18n.language.value,
        loadCatalog: loadBrandMediaCatalog,
        loadTrend: loadBrandMediaTrend
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const revenueFlowFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getLegacySnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const initialState = revenueFlowInitialState(element);
  const app = createApp({
    name: "ModernRevenueFlowMount",
    setup() {
      return () => h(RevenueFlowPage, {
        language: i18n.language.value,
        initialMerchants: initialState.merchants,
        initialStartDate: initialState.startDate,
        initialEndDate: initialState.endDate,
        loadCatalog: loadRevenueFlowCatalog,
        loadTrend: loadRevenueFlowTrend
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

window.OI_MODERN_APP = createModernAppApi({
  "offer-list-tracker": offerTrackerFactory,
  payments: paymentsFactory,
  publishers: publishersFactory,
  "brand-media": brandMediaFactory,
  "revenue-flow": revenueFlowFactory
});
