import { describe, expect, it } from "vitest";

import { createReportDataProvider } from "../chatbot/report/reportDataProvider";
import { createAgentPublisherBridge, runAgentPublisher } from "./agentPublisher";

const signal = new AbortController().signal;

describe("runAgentPublisher", () => {
  it("把媒体记录命令交给现有 Report renderer", async () => {
    const provider = createReportDataProvider({
      offers: [],
      publishers: { publishers: [{ userId: "p-1", userName: "Media One", merchantIds: ["101"], total: { clicks: 10, orders: 1, sales: 20, affCommission: 2 } }] }
    });
    const result = await runAgentPublisher({ kind: "publisher", query: "Media One", language: "en", signal }, {
      offers: [], paymentRecords: [], productKeywords: {}, provider
    });
    expect(result.source).toBe("cache");
    expect(result.text).toContain("Found 1 results.");
    expect(result.report.blocks.some((block) => block.id === "publisher-records")).toBe(true);
  });

  it("保留媒体画像命令并加载画像报告", async () => {
    const provider = createReportDataProvider({
      offers: [],
      publishers: { publishers: [{ userId: "p-1", userName: "Media One", merchantIds: ["101"], total: { clicks: 10, orders: 1, sales: 20, affCommission: 2 } }] },
      loadPublisherPortfolio: async () => ({ merchants: [{ merchantId: "101", merchantName: "Merchant One", category: "Home", total: { sales: 20, clicks: 10, orders: 1 } }] })
    });
    const result = await runAgentPublisher({ kind: "publisherprofile", query: "Media One", language: "en", signal }, {
      offers: [], paymentRecords: [], productKeywords: {}, provider
    });
    expect(result.text).toContain("Found 1 results.");
    expect(result.report.blocks.some((block) => block.id === "publisher-profile-summary")).toBe(true);
  });

  it("每次调用媒体桥接时都读取最新依赖", async () => {
    let calls = 0;
    const dependencies = {
      offers: [],
      paymentRecords: [],
      productKeywords: {},
      provider: createReportDataProvider({ offers: [], publishers: { publishers: [] } })
    };
    const bridge = createAgentPublisherBridge(() => {
      calls += 1;
      return dependencies;
    });
    await bridge({ kind: "publisher", query: "p-1", language: "zh", signal });
    await bridge({ kind: "publisherprofile", query: "p-1", language: "zh", signal });
    expect(calls).toBe(2);
  });
});
