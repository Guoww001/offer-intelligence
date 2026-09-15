import { describe, expect, it, vi } from "vitest";

import { emptyMetrics, type PerformanceReport } from "../offer-performance/performanceModel";
import { parseAgentAttachment, type AgentPromotionAttachment } from "./agentAttachment";
import { executePromotionTool, type PromotionToolArguments } from "./agentPromotionTool";

const attachment: AgentPromotionAttachment = {
  manifest: {
    attachmentId: "attachment-a",
    fileName: "campaign.csv",
    merchantCount: 2,
    merchants: [
      { merchantId: "101", merchantName: "First merchant" },
      { merchantId: "102", merchantName: "Second merchant" },
    ],
    window: {
      launchDate: "2026-09-07",
      startDate: "2026-09-07",
      endDate: "2026-09-13",
      beforeStart: "2026-08-31",
      beforeEnd: "2026-09-06",
      days: 7,
    },
  },
  offers: [
    { merchantId: "101", merchantName: "First merchant", category: "Home", asins: ["B012345678"] },
    { merchantId: "102", merchantName: "Second merchant", category: "Home", asins: [] },
  ],
  diagnostics: { totalRows: 2, invalidIdRows: 0, duplicateRows: 0, missingNameRows: 0, sheetsWithMerchantHeader: 1 },
};

function report(): PerformanceReport {
  return {
    ok: true,
    availableThrough: "2026-09-20",
    generatedAt: "2026-09-21T00:00:00Z",
    clickSource: "cnpscy_amazon_click",
    dateRange: {
      startDate: "2026-09-07",
      endDate: "2026-09-13",
      beforeStart: "2026-08-31",
      beforeEnd: "2026-09-06",
      days: 7,
    },
    supported: { revenue: true, clicks: true, dpv: true, atc: true, orders: true, commission: true },
    merchants: [
      {
        merchantId: "101",
        before: { ...emptyMetrics(), revenue: 100, orders: 1 },
        after: { ...emptyMetrics(), revenue: 150, orders: 2 },
        daily: [],
        monthly: [],
      },
      {
        merchantId: "102",
        before: { ...emptyMetrics(), revenue: 50, orders: 1 },
        after: { ...emptyMetrics(), revenue: 40, orders: 1 },
        daily: [],
        monthly: [],
      },
    ],
    media: [
      {
        merchantId: "101", publisherId: "p1", publisherName: "Publisher One",
        before: { ...emptyMetrics(), revenue: 30 }, after: { ...emptyMetrics(), revenue: 70 },
        linkType: "product", asin: "B012345678", purchasedAsin: "B098765432",
      },
      {
        merchantId: "102", publisherId: "p1", publisherName: "Publisher One",
        before: { ...emptyMetrics(), revenue: 20 }, after: { ...emptyMetrics(), revenue: 10 },
        linkType: "storefront", asin: "", purchasedAsin: "B098765432",
      },
    ],
    links: [],
  };
}

const args = (view: PromotionToolArguments["view"]): PromotionToolArguments => ({
  attachmentId: "attachment-a",
  view,
  merchantIds: ["101", "102"],
  window: attachment.manifest.window,
  metric: "revenue",
  sortBy: "after",
  direction: "desc",
  offset: 0,
  limit: 25,
});

describe("promotion_analysis frontend tool", () => {
  it("accepts observation after launch and sends the launch-anchored comparison to reports", async () => {
    const window = { ...attachment.manifest.window!, startDate: "2026-09-10", endDate: "2026-09-16" };
    const later = { ...attachment, manifest: { ...attachment.manifest, window } };
    const loader = vi.fn(async (_request: unknown) => ({ ...report(), dateRange: window }));
    const result = await executePromotionTool(later, { ...args("merchants"), window }, loader, new AbortController().signal, "zh");
    expect(result.result.ok).toBe(true);
    expect(loader.mock.calls[0]?.[0]).toMatchObject({ launchDate: "2026-09-07", startDate: "2026-09-10", beforeStart: "2026-08-31", beforeEnd: "2026-09-06" });
    for (const invalid of [{ ...window, beforeEnd: "2026-09-09" }, { ...window, startDate: "2026-09-06", endDate: "2026-09-12" }]) {
      const rejected = await executePromotionTool({ ...later, manifest: { ...later.manifest, window: invalid } }, { ...args("merchants"), window: invalid }, loader, new AbortController().signal, "zh");
      expect(rejected.result.errorCode).toBe("invalid_arguments");
    }
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("aggregates merchant totals before applying ranking and preserves null semantics", async () => {
    const loadReport = async () => report();
    const result = await executePromotionTool(attachment, args("merchants"), loadReport, new AbortController().signal, "zh");
    const data = result.result.data as Record<string, unknown>;
    const aggregates = data.aggregates as Record<string, unknown>;
    const rows = data.rows as Array<Record<string, unknown>>;

    expect(aggregates).toMatchObject({ before: 150, after: 190, delta: 40 });
    expect(aggregates.change).toBeCloseTo(40 / 150);
    expect(rows[0]).toMatchObject({ merchantId: "101", after: 150, delta: 50 });
    expect(rows[1]).toMatchObject({ merchantId: "102", after: 40, delta: -10 });
    expect(result.result.source).toMatchObject({ dataSource: "database", estimated: false });
  });

  it("deduplicates a publisher across merchants and keeps file facts local", async () => {
    const calls: string[] = [];
    const loadReport = async (request: { action?: "relations" }) => {
      calls.push(request.action || "summary");
      return report();
    };
    const publisherResult = await executePromotionTool(attachment, args("publishers"), loadReport, new AbortController().signal, "zh");
    const publisherData = publisherResult.result.data as Record<string, unknown>;
    expect(publisherData.rows).toMatchObject([{ publisherId: "p1", before: 50, after: 80 }]);
    expect(calls).toEqual(["relations"]);

    const fileResult = await executePromotionTool(attachment, args("file"), loadReport, new AbortController().signal, "zh");
    expect(fileResult.result.source.dataSource).toBe("unknown");
    expect((fileResult.result.data as Record<string, unknown>).evidenceOrigin).toBe("file");
    expect(calls).toEqual(["relations"]);
  });

  it("ranks merchants by distinct active media count", async () => {
    const base = report();
    const loadReport = async (request: { action?: "relations" }) => {
      expect(request.action).toBe("relations");
      return {
        ...base,
        media: [
          ...(base.media || []),
          {
            merchantId: "101", publisherId: "p2", publisherName: "Publisher Two",
            before: { ...emptyMetrics(), revenue: 0 }, after: { ...emptyMetrics(), revenue: 4 },
            linkType: "asin" as const, asin: "B012345678", purchasedAsin: "",
          },
          {
            merchantId: "101", publisherId: "p3", publisherName: "Inactive Publisher",
            before: { ...emptyMetrics(), revenue: 0 }, after: { ...emptyMetrics(), revenue: 0 },
            linkType: "product" as const, asin: "B012345678", purchasedAsin: "",
          },
          {
            merchantId: "101", publisherId: "0", publisherName: "Unknown Publisher",
            before: { ...emptyMetrics(), revenue: 2 }, after: { ...emptyMetrics(), revenue: 2 },
            linkType: "storefront" as const, asin: "", purchasedAsin: "",
          },
        ],
      };
    };
    const result = await executePromotionTool(attachment, args("merchant_media"), loadReport, new AbortController().signal, "zh");
    const data = result.result.data as Record<string, unknown>;
    expect(data.rows).toEqual([
      expect.objectContaining({ merchantId: "101", mediaCount: 2 }),
      expect.objectContaining({ merchantId: "102", mediaCount: 1 }),
    ]);
    expect(result.resultView?.columns).toEqual(["商家", "媒体数量"]);
  });

  it("keeps a missing target ASIN separate from a purchased ASIN", async () => {
    const loadReport = async () => ({
      ...report(),
      links: [{
        merchantId: "101",
        publisherId: "p1",
        publisherName: "Publisher One",
        before: { ...emptyMetrics(), revenue: 0 },
        after: { ...emptyMetrics(), revenue: 12 },
        linkType: "storefront" as const,
        asin: "",
        purchasedAsin: "B0H2JJBFYX",
      }],
    });
    const result = await executePromotionTool(attachment, args("links"), loadReport, new AbortController().signal, "zh");
    const rows = (result.result.data as Record<string, unknown>).rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ targetAsin: null, purchasedAsin: "B0H2JJBFYX" });
  });

  it("rejects a stale attachment scope before querying the database", async () => {
    const loadReport = async () => report();
    const stale = { ...args("merchants"), attachmentId: "attachment-old" };
    const result = await executePromotionTool(attachment, stale, loadReport, new AbortController().signal, "zh");
    expect(result.result).toMatchObject({ ok: false, errorCode: "invalid_arguments" });
  });

  it("does not infer a target ASIN from a purchased ASIN", () => {
    const parsed = parseAgentAttachment([[["Merchant ID", "Merchant Name"], ["101", "First"]]], "list.csv");
    expect(parsed.offers[0]?.asins).toEqual([]);
  });

  it("bounds the file view and keeps the next page available", async () => {
    const offers = Array.from({ length: 30 }, (_, index) => ({
      merchantId: String(101 + index),
      merchantName: `Merchant ${index + 1}`,
      category: "Home",
      asins: Array.from({ length: 50 }, (_, asinIndex) => `B${String(index * 50 + asinIndex).padStart(9, "0")}`),
    }));
    const pagedAttachment: AgentPromotionAttachment = {
      manifest: {
        ...attachment.manifest,
        merchantCount: offers.length,
        merchants: offers.map(({ merchantId, merchantName }) => ({ merchantId, merchantName })),
      },
      offers,
      diagnostics: attachment.diagnostics,
    };
    const result = await executePromotionTool(
      pagedAttachment,
      { ...args("file"), merchantIds: offers.map((offer) => offer.merchantId), limit: 25 },
      async () => { throw new Error("file view must not query the database"); },
      new AbortController().signal,
      "zh",
    );
    const data = result.result.data as Record<string, unknown>;
    expect(data).toMatchObject({ totalRows: 30, hasMore: true, offset: 0, limit: 25 });
    expect(Number(data.returned)).toBeLessThan(25);
    expect(Number(data.nextOffset)).toBe(Number(data.returned));
    expect(new TextEncoder().encode(JSON.stringify(data)).byteLength).toBeLessThanOrEqual(16_000);
  });
});
