import { describe, expect, it } from "vitest";

import {
  buildRevenueFlowLayout,
  buildRevenueFlowModel,
  normalizeRevenueFlowPayload,
  revenueFlowCatalogOptions,
  revenueFlowFlowDetail,
  revenueFlowFlowHitTest,
  revenueFlowHoverState,
  toggleRevenueFlowNode,
  type RevenueFlowPayload
} from "./revenueFlowModel";

const payload: RevenueFlowPayload = {
  ok: true,
  merchants: [
    { merchantId: "101", merchantName: "Alpha" },
    { merchantId: "202", merchantName: "Beta" }
  ],
  dateRange: {
    startDate: "2026-07-01",
    endDate: "2026-07-31"
  },
  sankey: {
    available: true,
    nodes: [
      { id: "brand:101", type: "brand", label: "Alpha", merchantId: "101", value: 155 },
      { id: "brand:202", type: "brand", label: "Beta", merchantId: "202", value: 60 },
      { id: "product:101:ASIN-A", type: "product", label: "Alpha Widget", productKey: "ASIN-A", merchantId: "101", value: 140 },
      { id: "product:101:ASIN-B", type: "product", label: "Alpha Cable", productKey: "ASIN-B", merchantId: "101", value: 15 },
      { id: "product:202:ASIN-A", type: "product", label: "Beta Widget", productKey: "ASIN-A", merchantId: "202", value: 60 },
      { id: "media:7", type: "media", label: "Media Seven", userId: "7", value: 160 },
      { id: "media:8", type: "media", label: "Media Eight", userId: "8", value: 55 },
      { id: "product:101:ZERO", type: "product", label: "Zero", merchantId: "101", value: 0 },
      { id: "media:negative", type: "media", label: "Negative", value: -2 }
    ],
    links: [
      { source: "brand:101", target: "product:101:ASIN-A", value: 140 },
      { source: "brand:101", target: "product:101:ASIN-B", value: 15 },
      { source: "brand:202", target: "product:202:ASIN-A", value: 60 },
      { source: "product:101:ASIN-A", target: "media:7", value: 100 },
      { source: "product:101:ASIN-A", target: "media:8", value: 40 },
      { source: "product:101:ASIN-B", target: "media:8", value: 15 },
      { source: "product:202:ASIN-A", target: "media:7", value: 60 },
      { source: "brand:101", target: "media:7", value: 999 },
      { source: "product:101:ZERO", target: "media:7", value: 0 }
    ],
    summary: {
      totalRevenue: 215,
      brandCount: 2,
      productCount: 3,
      mediaCount: 2,
      linkCount: 7
    }
  }
};

describe("revenueFlowModel", () => {
  it("归一化可用 payload，并保留品牌和日期范围", () => {
    const normalized = normalizeRevenueFlowPayload(payload, {
      startDate: "2026-01-01",
      endDate: "2026-01-02"
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.dateRange.startDate).toBe("2026-07-01");
    expect(normalized?.dateRange.endDate).toBe("2026-07-31");
    expect(normalized?.merchants).toEqual(payload.merchants);
    expect(normalized?.sankey.available).toBe(true);
    expect(normalizeRevenueFlowPayload({ ok: false }, undefined)).toBeNull();
    expect(normalizeRevenueFlowPayload({
      ok: true,
      dateRange: payload.dateRange,
      sankey: { available: false, reason: "missing-product-field" }
    })?.sankey.available).toBe(false);
  });

  it("只保留正值且合法的 brand-product-media 图", () => {
    const model = buildRevenueFlowModel(payload);

    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.brandCount).toBe(2);
    expect(model.productCount).toBe(3);
    expect(model.mediaCount).toBe(2);
    expect(model.links).toHaveLength(7);
    expect(model.totalRevenue).toBe(215);
    expect(model.nodeById["product:101:ASIN-A"]?.merchantId).toBe("101");
    expect(model.nodeById["product:202:ASIN-A"]?.merchantId).toBe("202");
    expect(model.links.every((link) => link.value > 0)).toBe(true);
    expect(model.links.every((link) =>
      model.nodeById[link.source]?.type !== model.nodeById[link.target]?.type
    )).toBe(true);
  });

  it("生成三列 Sankey 布局和可绘制的流带边界", () => {
    const model = buildRevenueFlowModel(payload);
    expect(model).not.toBeNull();
    if (!model) return;

    const layout = buildRevenueFlowLayout(model, 920);

    expect(layout.surfaceWidth).toBeGreaterThanOrEqual(1160);
    expect(new Set(layout.nodes.map((node) => node.type))).toEqual(new Set(["brand", "product", "media"]));
    expect(layout.links).toHaveLength(model.links.length);
    expect(layout.nodes.every((node) => node.width > 0 && node.height >= 14)).toBe(true);
    expect(layout.links.every((link) =>
      link.sourceBottom > link.sourceTop
      && link.targetBottom > link.targetTop
      && link.value > 0
    )).toBe(true);

    const targetLink = layout.links.find((link) => link.index === 3);
    expect(targetLink).toBeDefined();
    if (!targetLink) return;
    const hit = revenueFlowFlowHitTest(
      layout,
      (targetLink.source.x + targetLink.source.width + targetLink.target.x) / 2,
      (targetLink.sourceTop + targetLink.targetTop + targetLink.sourceBottom + targetLink.targetBottom) / 4,
      new Set([targetLink.index])
    );
    expect(hit?.index).toBe(targetLink.index);
  });

  it("只为产品和媒体节点建立同一收入流路径的 hover 关系", () => {
    const model = buildRevenueFlowModel(payload);
    expect(model).not.toBeNull();
    if (!model) return;

    const hover = revenueFlowHoverState(model, "product:101:ASIN-A");
    expect(hover.relatedNodeIds).toContain("brand:101");
    expect(hover.relatedNodeIds).toContain("media:7");
    expect(hover.relatedNodeIds).toContain("media:8");
    expect(hover.relatedNodeIds).not.toContain("brand:202");
    expect(toggleRevenueFlowNode(model, "", "brand:101")).toBe("");
    expect(toggleRevenueFlowNode(model, "", "product:101:ASIN-A")).toBe("product:101:ASIN-A");
    expect(toggleRevenueFlowNode(model, "product:101:ASIN-A", "product:101:ASIN-A")).toBe("");
  });

  it("输出 flow 详情并按媒体目录去重排序", () => {
    const model = buildRevenueFlowModel(payload);
    expect(model).not.toBeNull();
    if (!model) return;

    const detail = revenueFlowFlowDetail(model, model.links[3]);
    expect(detail).not.toBeNull();
    expect(detail?.sourceLabel).toBe("Alpha Widget");
    expect(detail?.targetLabel).toBe("Media Seven");
    expect(detail?.value).toBe(100);
    expect(revenueFlowCatalogOptions({
      merchantNameMap: { "101": "Alpha", "202": "Beta" },
      publishers: [
        { merchantIds: [101, 101] },
        { merchantIds: [101, 202] }
      ]
    })).toEqual([
      { merchantId: "101", name: "Alpha", count: 2 },
      { merchantId: "202", name: "Beta", count: 1 }
    ]);
  });
});
