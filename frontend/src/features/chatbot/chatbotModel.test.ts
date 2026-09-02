import { describe, expect, it } from "vitest";

import {
  canonicalChatbotTier,
  compactChatbotResult,
  detectChatbotIntent,
  normalizeChatbotText,
  resolveChatbotCategory,
  resolveChatbotMerchant,
  searchChatbotOffers
} from "./chatbotModel";

const offers = [
  {
    merchantId: "398679",
    merchantName: "Tapo",
    brand: "Tapo",
    tier: "Tier 1",
    category: "Electronics",
    topAsins: ["B0TAPO1234"],
    productNameKeywords: ["security camera", "smart home"]
  },
  {
    merchantId: "398680",
    merchantName: "Tapo Home",
    brand: "Tapo Home",
    tier: "Tier 2",
    category: "Home",
    topAsins: ["B0HOME1234"],
    productNameKeywords: ["smart home"]
  },
  {
    merchantId: "398681",
    merchantName: "Blocked Audio",
    brand: "Blocked Audio",
    tier: "BLACK TIER",
    category: "Electronics",
    topAsins: ["B0BLACK1234"],
    productNameKeywords: ["headphones"]
  }
] as const;

describe("chatbotModel", () => {
  it("normalizes text and canonicalizes all supported tier labels", () => {
    expect(normalizeChatbotText(" Beauty & Personal Care ")).toBe("beauty and personal care");
    expect(canonicalChatbotTier("tier 2")).toBe("Tier 2");
    expect(canonicalChatbotTier("black")).toBe("BLACK TIER");
  });

  it("detects the documented report intents in Chinese and English", () => {
    expect(detectChatbotIntent("请查询商户 398679 的 EPC")).toBe("merchant");
    expect(detectChatbotIntent("show the payment status for Tapo")).toBe("payment");
    expect(detectChatbotIntent("推荐 Tier 1 的 beauty offers")).toBe("recommendation");
    expect(detectChatbotIntent("分析 Tapo 最近 6 个月趋势")).toBe("analysis");
  });

  it("resolves a category from known categories without inventing a value", () => {
    const categories = ["Electronics", "Beauty & Personal Care", "Home"];
    expect(resolveChatbotCategory("beauty products", categories)).toBe("Beauty & Personal Care");
    expect(resolveChatbotCategory("未收录的品类", categories)).toBeNull();
  });

  it("prefers an exact merchant ID and exposes ambiguity instead of guessing", () => {
    expect(resolveChatbotMerchant("Tapo ID398679", offers)).toMatchObject({
      status: "resolved",
      matches: [{ offer: offers[0], matchType: "merchant" }]
    });

    const ambiguous = resolveChatbotMerchant("Tapo", [
      offers[0],
      { ...offers[0], merchantId: "398682", merchantName: "Tapo", brand: "Tapo" }
    ]);
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.matches).toHaveLength(2);
  });

  it("searches ASIN and product keywords while applying safe tier defaults", () => {
    expect(searchChatbotOffers(offers, "headphones").map((match) => match.offer.merchantId)).toEqual([]);
    expect(searchChatbotOffers(offers, "headphones", { includeBlack: true })
      .map((match) => match.offer.merchantId)).toEqual(["398681"]);
    expect(searchChatbotOffers(offers, "B0TAPO1234", { tier: "Tier 1" })
      .map((match) => match.offer.merchantId)).toEqual(["398679"]);
    expect(searchChatbotOffers(offers, "smart home", { tier: "Tier 1" })
      .map((match) => match.offer.merchantId)).toEqual(["398679"]);
  });

  it("keeps safe result rows while dropping prompt, answer and internal fields", () => {
    expect(compactChatbotResult({
      prompt: "private question",
      answer: "provider answer",
      rows: [{ merchantId: "398679", revenue: 120, privateNote: "secret" }],
      stack: "internal stack"
    })).toEqual({
      rows: [{ merchantId: "398679", revenue: 120 }]
    });
  });
});
