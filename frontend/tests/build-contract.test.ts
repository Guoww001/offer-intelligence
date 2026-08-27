import { describe, expect, it } from "vitest";

import { createModernAppApi, getLegacySnapshot } from "../src/legacy/bridge";
import type { LegacyBootstrapData, ModernPageFactory } from "../src/legacy/contracts";

function bootstrapData(): LegacyBootstrapData {
  return {
    chatbotData: { offers: [{ merchantId: "merchant-1" }] },
    sheetReportData: { sheets: [] },
    productKeywords: { merchants: [] },
    language: "zh",
    llmEnabled: true,
    agentEnabled: false
  };
}

describe("Legacy Bridge 构建契约", () => {
  it("接收旧入口的结构化启动数据，但不提前注册业务页面", () => {
    const modernApp = createModernAppApi();

    modernApp.bootstrap(bootstrapData());

    expect(getLegacySnapshot().value.language).toBe("zh");
    expect(getLegacySnapshot().value.agentEnabled).toBe(false);
    expect(modernApp.hasPage("offer-list-tracker")).toBe(false);
  });

  it("未注册页面应返回 false，让旧页面继续渲染", () => {
    const modernApp = createModernAppApi();
    const root = document.createElement("section");

    expect(modernApp.mountPage("offer-list-tracker", root)).toBe(false);
    expect(root.childElementCount).toBe(0);
  });

  it("语言切换只更新桥接状态，不直接操作旧 DOM", () => {
    const modernApp = createModernAppApi();
    modernApp.bootstrap(bootstrapData());

    modernApp.setLanguage("en");

    expect(getLegacySnapshot().value.language).toBe("en");
  });

  it("拒绝来自旧 JavaScript 入口的无效启动数据", () => {
    const modernApp = createModernAppApi();
    const invalidData = {
      ...bootstrapData(),
      language: "fr"
    } as unknown as LegacyBootstrapData;

    expect(() => modernApp.bootstrap(invalidData)).toThrow("language");
  });

  it("保存浅冻结副本，避免调用方改写桥接顶层状态", () => {
    const modernApp = createModernAppApi();
    const data = bootstrapData();

    modernApp.bootstrap(data);

    expect(Object.isFrozen(getLegacySnapshot().value)).toBe(true);
    expect(getLegacySnapshot().value).not.toBe(data);
  });

  it("注册页面后支持挂载、重复挂载先卸载旧实例并安全卸载当前实例", () => {
    const calls: string[] = [];
    const factory: ModernPageFactory = () => ({
      unmount: () => calls.push("unmount")
    });
    const modernApp = createModernAppApi({ "offer-list-tracker": factory });
    const root = document.createElement("section");

    expect(modernApp.hasPage("offer-list-tracker")).toBe(true);
    expect(modernApp.mountPage("offer-list-tracker", root)).toBe(true);
    expect(modernApp.mountPage("offer-list-tracker", root)).toBe(true);
    expect(calls).toEqual(["unmount"]);
    modernApp.unmountPage("offer-list-tracker");
    expect(calls).toEqual(["unmount", "unmount"]);
    modernApp.unmountPage("offer-list-tracker");
    expect(calls).toEqual(["unmount", "unmount"]);
  });
});
