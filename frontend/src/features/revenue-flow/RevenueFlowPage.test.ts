import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import RevenueFlowPage from "./RevenueFlowPage.vue";
import { buildRevenueFlowLayout, buildRevenueFlowModel } from "./revenueFlowModel";

const catalog = {
  merchantNameMap: { "101": "Alpha", "202": "Beta" },
  publishers: [{ merchantIds: [101] }, { merchantIds: [202] }]
};

const trendPayload = {
  ok: true,
  merchants: [
    { merchantId: "101", merchantName: "Alpha" },
    { merchantId: "202", merchantName: "Beta" }
  ],
  dateRange: { startDate: "2026-08-01", endDate: "2026-08-27" },
  sankey: {
    available: true,
    nodes: [
      { id: "brand:101", type: "brand", label: "Alpha", merchantId: "101", value: 10 },
      { id: "product:101:A", type: "product", label: "Alpha A", productKey: "A", merchantId: "101", value: 10 },
      { id: "media:7", type: "media", label: "Media Seven", userId: "7", value: 10 }
    ],
    links: [
      { source: "brand:101", target: "product:101:A", value: 10 },
      { source: "product:101:A", target: "media:7", value: 10 }
    ],
    summary: { totalRevenue: 10 }
  }
};

describe("RevenueFlowPage", () => {
  it("渲染旧页面语义结构、五个 KPI 和 Canvas，并支持展开与卸载清理", async () => {
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "zh",
        catalogData: catalog,
        today: () => new Date("2026-08-28T12:00:00"),
        loadTrend: async () => trendPayload
      }
    });

    expect(wrapper.find('[data-page="revenue-flow"]').exists()).toBe(true);
    expect(wrapper.find("h1").exists()).toBe(true);
    expect(wrapper.find('[role="combobox"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="revenue-flow-kpi"]')).toHaveLength(5);

    await wrapper.find('[role="combobox"]').trigger("click");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    await wrapper.find('[role="option"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".revenue-flow-selected-brand")).toHaveLength(1);
    expect(wrapper.find("canvas").exists()).toBe(true);

    const expandButton = wrapper.find('[data-testid="revenue-flow-expand"]');
    await expandButton.trigger("click");
    expect(expandButton.attributes("aria-expanded")).toBe("true");
    expect(document.body.classList.contains("revenue-flow-chart-expanded")).toBe(true);

    wrapper.unmount();
    expect(document.body.classList.contains("revenue-flow-chart-expanded")).toBe(false);
  });

  it("保留品牌最多 12 个的选择边界", async () => {
    const merchants = Array.from({ length: 13 }, (_, index) => ({
      merchantId: String(index + 1),
      name: "Brand " + String(index + 1),
      count: 1
    }));
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "en",
        catalogData: {
          merchants: merchants.map((merchant) => ({
            merchantId: merchant.merchantId,
            merchantName: merchant.name,
            count: merchant.count
          }))
        },
        loadTrend: async () => trendPayload
      }
    });

    await wrapper.find('[role="combobox"]').trigger("click");
    for (const option of wrapper.findAll('[role="option"]')) {
      await option.trigger("click");
    }
    expect(wrapper.findAll(".revenue-flow-selected-brand")).toHaveLength(12);
    expect(wrapper.text()).toContain("12");
    wrapper.unmount();
  });

  it("使用 legacy Sankey 的节点颜色、标签和值展示", async () => {
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "zh",
        catalogData: catalog,
        today: () => new Date("2026-08-28T12:00:00"),
        loadTrend: async () => trendPayload
      }
    });

    await wrapper.find('[role="combobox"]').trigger("click");
    await wrapper.find('[role="option"]').trigger("click");
    await flushPromises();

    const nodes = wrapper.findAll(".revenue-flow-sankey-node");
    expect(nodes).toHaveLength(3);
    const brand = nodes.find((node) => node.classes().includes("is-brand"));
    const product = nodes.find((node) => node.classes().includes("is-product"));
    const media = nodes.find((node) => node.classes().includes("is-media"));
    const nodeLayer = wrapper.find(".brand-media-sankey-node-layer");
    expect(nodeLayer.attributes("style")).toContain("width:");
    expect(nodeLayer.attributes("style")).toContain("height:");
    expect(brand?.classes()).toContain("brand-media-sankey-node-brand");
    expect(brand?.find(".brand-media-sankey-node-bar").exists()).toBe(true);
    expect(brand?.find(".brand-media-sankey-node-label").text()).toBe("Alpha");
    expect(brand?.find(".brand-media-sankey-node-value").text()).toBe("$10");
    expect(product?.find(".brand-media-sankey-node-label").text()).toBe("A");
    expect(media?.find(".brand-media-sankey-node-label").text()).toBe("Media Seven");
    expect(brand?.attributes("style")).toContain("--brand-media-node-color: #17233d");
    expect(product?.attributes("style")).toContain("--brand-media-node-color: #246bfe");
    expect(media?.attributes("style")).toContain("--brand-media-node-color: hsl(138 72% 48%)");
    expect(wrapper.find(".revenue-flow-sankey-toolbar .brand-media-sankey-canvas-pan").exists()).toBe(true);
    expect(wrapper.find('[data-testid="revenue-flow-expand"] svg').exists()).toBe(true);

    wrapper.unmount();
  });

  it("点击商品节点后还原 legacy 锁定聚焦视觉状态", async () => {
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "zh",
        initialMerchants: [{ merchantId: "101", name: "Alpha", count: 1 }],
        initialStartDate: "2026-08-01",
        initialEndDate: "2026-08-27",
        today: () => new Date("2026-08-28T12:00:00"),
        loadTrend: async () => trendPayload
      }
    });

    await flushPromises();
    await flushPromises();

    const productNode = wrapper.find(".revenue-flow-sankey-node.is-product");
    await productNode.find(".brand-media-sankey-node-bar").trigger("click");
    await productNode.trigger("mouseleave");
    await flushPromises();

    const chart = wrapper.find(".revenue-flow-sankey-chart-wrap");
    expect(chart.classes()).toContain("brand-media-sankey-chart-has-focus");
    expect(chart.classes()).toContain("brand-media-sankey-chart-has-lock");
    expect(productNode.classes()).toContain("is-focused");
    expect(productNode.classes()).toContain("is-selection-anchor");
    expect(productNode.find("button").attributes("aria-pressed")).toBe("true");

    wrapper.unmount();
  });

  it("锁定单品后可在关联 flow 上显示详情", async () => {
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "en",
        initialMerchants: [{ merchantId: "101", name: "Alpha", count: 1 }],
        initialStartDate: "2026-08-01",
        initialEndDate: "2026-08-27",
        loadTrend: async () => trendPayload
      }
    });

    await flushPromises();
    await flushPromises();

    const product = wrapper.find(".revenue-flow-sankey-node.is-product button");
    await product.trigger("click");
    const viewport = wrapper.find(".revenue-flow-sankey-viewport");
    const model = buildRevenueFlowModel(trendPayload);
    expect(model).not.toBeNull();
    const layout = buildRevenueFlowLayout(model!, 1160);
    const link = layout.links.find((item) => item.source.column === "product");
    expect(link).toBeDefined();

    Object.defineProperty(viewport.element, "scrollLeft", { configurable: true, value: 0, writable: true });
    Object.defineProperty(viewport.element, "scrollTop", { configurable: true, value: 0, writable: true });
    Object.defineProperty(viewport.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1160, height: 600, right: 1160, bottom: 600 })
    });
    await viewport.trigger("pointermove", {
      clientX: link!.target.x - 1,
      clientY: (link!.targetTop + link!.targetBottom) / 2,
      pointerId: 1
    });

    expect(wrapper.find(".revenue-flow-sankey-flow-tooltip").exists()).toBe(true);
    expect(wrapper.text()).toContain("Flow details");
    wrapper.unmount();
  });

  it("品牌搜索无匹配项时显示专用提示", async () => {
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "en",
        catalogData: catalog,
        loadTrend: async () => trendPayload
      }
    });

    const input = wrapper.find('[role="combobox"]');
    await input.setValue("missing-brand");
    await input.trigger("focus");
    expect(wrapper.text()).toContain("No matching brand");
    wrapper.unmount();
  });
});
