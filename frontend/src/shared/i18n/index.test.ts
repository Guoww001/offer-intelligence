import { computed, nextTick } from "vue";
import { describe, expect, it } from "vitest";

import {
  createI18nStore,
  normalizeLanguage,
  translateMessage
} from "./index";

describe("shared i18n", () => {
  it("默认使用中文，并在切换后更新响应式文案", async () => {
    const store = createI18nStore();
    const exportLabel = computed(() => store.t("offerTracker.exportCurrent"));

    expect(store.language.value).toBe("zh");
    expect(exportLabel.value).toBe("导出当前筛选");

    store.setLanguage("en");
    await nextTick();

    expect(store.language.value).toBe("en");
    expect(exportLabel.value).toBe("Export current results");
  });

  it("替换消息占位符，并为未知 key 使用 fallback", () => {
    expect(translateMessage("zh", "offerTracker.selectedCount", "备用 {count} 条", { count: 3 }))
      .toBe("已选择 3 个");
    expect(translateMessage("en", "missing.message", "Fallback {name}", { name: "value" }))
      .toBe("Fallback value");
  });

  it("只接受受控语言值，其他输入回退中文", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("zh")).toBe("zh");
    expect(normalizeLanguage("fr")).toBe("zh");
    expect(normalizeLanguage(null)).toBe("zh");
  });
});
