import { describe, expect, it } from "vitest";

import {
  buildChatbotReport,
  summarizeChatbotOffers,
  type ChatbotReportData
} from "./chatbotReportModel";

const data: ChatbotReportData = {
  offers: [
    {
      merchantId: "398679",
      merchantName: "Tapo",
      brand: "Tapo",
      tier: "Tier 1",
      category: "Electronics",
      topAsins: ["B0TEST123"],
      clicks: 100,
      orders: 12,
      salesAmount: 1200,
      affCommission: 120
    },
    {
      merchantId: "398680",
      merchantName: "Home Lamp",
      brand: "Home Lamp",
      tier: "Tier 2",
      category: "Home",
      clicks: 50,
      orders: 5,
      salesAmount: 500,
      affCommission: 50
    },
    {
      merchantId: "398681",
      merchantName: "Black Audio",
      brand: "Black Audio",
      tier: "BLACK TIER",
      category: "Electronics",
      clicks: 20,
      orders: 1,
      salesAmount: 100,
      affCommission: 10
    }
  ]
};

describe("chatbotReportModel", () => {
  it("summarizes numeric offer metrics without mutating source rows", () => {
    expect(summarizeChatbotOffers(data.offers)).toEqual({
      offerCount: 3,
      clicks: 170,
      orders: 18,
      revenue: 1800,
      commission: 180,
      conversionRate: 18 / 170
    });
  });

  it("builds a resolved merchant report with an ID-first result", () => {
    const result = buildChatbotReport("Tapo ID398679", data, "zh");

    expect(result).toMatchObject({
      intent: "merchant",
      status: "resolved",
      rows: [data.offers[0]],
      summary: {
        offerCount: 1,
        clicks: 100,
        orders: 12,
        revenue: 1200,
        commission: 120
      }
    });
    expect(result.message).toContain("Tapo");
  });

  it("builds category and tier reports from known cached data", () => {
    const category = buildChatbotReport("Electronics", data, "en");
    expect(category.intent).toBe("category");
    expect(category.rows.map((row) => row.merchantId)).toEqual(["398679"]);

    const tier = buildChatbotReport("Tier 1", data, "en");
    expect(tier.intent).toBe("tier");
    expect(tier.rows.map((row) => row.merchantId)).toEqual(["398679"]);
  });

  it("returns an explicit no-data result instead of inventing a row", () => {
    const result = buildChatbotReport("Unknown merchant", data, "en");

    expect(result.status).toBe("not_found");
    expect(result.rows).toEqual([]);
    expect(result.summary.offerCount).toBe(0);
    expect(result.message).toContain("No matching");
  });

  it("resolves ASIN searches from the cached offer rows", () => {
    const result = buildChatbotReport("ASIN B0TEST123", data, "en");

    expect(result.intent).toBe("asin");
    expect(result.status).toBe("resolved");
    expect(result.rows.map((row) => row.merchantId)).toEqual(["398679"]);
  });

  it("marks live analysis and payment questions as deferred instead of fabricating metrics", () => {
    const result = buildChatbotReport("show payment status", data, "en");

    expect(result.status).toBe("deferred");
    expect(result.rows).toEqual([]);
    expect(result.message).toContain("Chat Mode");
  });
});
