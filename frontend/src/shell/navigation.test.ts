import { describe, expect, it } from "vitest";

import { MODERN_PAGE_NAMES } from "../legacy/contracts";
import {
  GOOGLE_ADS_NAVIGATION_ITEM,
  NAVIGATION_GROUPS,
  navigationGroupForPage,
  navigationItemForPage,
  pageLabel,
  pageTitle
} from "./navigation";

describe("共享 Shell 导航模型", () => {
  it("为每个页面提供唯一导航项，并保持 Tier 为单一入口", () => {
    const items = [
      ...NAVIGATION_GROUPS.flatMap((group) => group.items),
      GOOGLE_ADS_NAVIGATION_ITEM
    ];
    const pages = items.map((item) => item.page);

    expect(new Set(pages).size).toBe(pages.length);
    expect(new Set(pages)).toEqual(new Set(MODERN_PAGE_NAMES));
    expect(NAVIGATION_GROUPS.find((group) => group.key === "merchants")?.items
      .filter((item) => item.page === "tier")).toHaveLength(1);
  });

  it("沿用 legacy 的分组归属和当前页面标签", () => {
    expect(navigationGroupForPage("agent")).toBe("workspace");
    expect(navigationGroupForPage("dashboard")).toBe("workspace");
    expect(navigationGroupForPage("sheets")).toBe("merchants");
    expect(navigationGroupForPage("tier")).toBe("merchants");
    expect(navigationGroupForPage("brand-media")).toBe("media");
    expect(navigationGroupForPage("google-ads")).toBe("google-ads");
    expect(navigationGroupForPage("category")).toBe("products");
    expect(navigationItemForPage("tier")?.label.zh).toBe("Tier");
    expect(pageLabel("monthly-new-merchants", "zh")).toBe("上新商家");
  });

  it("生成稳定的中英文页面标题", () => {
    expect(pageTitle("agent", "zh")).toBe("Agent · YeahPromos");
    expect(pageTitle("payments", "en")).toBe("Payments · YeahPromos");
    expect(pageTitle("category", "zh")).toBe("分类 · YeahPromos");
  });
});
