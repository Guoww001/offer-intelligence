import { readonly, shallowRef } from "vue";

import type { LegacyBootstrapData, ModernAppApi, ModernPageName, UiLanguage } from "./contracts";

const EMPTY_BOOTSTRAP_DATA: LegacyBootstrapData = Object.freeze({
  chatbotData: {},
  sheetReportData: {},
  productKeywords: {},
  language: "zh",
  llmEnabled: false,
  agentEnabled: false
});

const legacySnapshot = shallowRef<LegacyBootstrapData>(EMPTY_BOOTSTRAP_DATA);
const readonlyLegacySnapshot = readonly(legacySnapshot);

export function getLegacySnapshot() {
  return readonlyLegacySnapshot;
}

function assertLanguage(language: unknown): asserts language is UiLanguage {
  if (language !== "zh" && language !== "en") {
    throw new TypeError("Legacy bootstrap language 必须是 zh 或 en");
  }
}

function assertLegacyBootstrapData(data: LegacyBootstrapData): void {
  if (typeof data !== "object" || data === null) {
    throw new TypeError("Legacy bootstrap data 必须是对象");
  }
  for (const key of ["chatbotData", "sheetReportData", "productKeywords"] as const) {
    if (!(key in data)) {
      throw new TypeError(`Legacy bootstrap 缺少 ${key}`);
    }
  }
  assertLanguage(data.language);
  if (typeof data.llmEnabled !== "boolean" || typeof data.agentEnabled !== "boolean") {
    throw new TypeError("Legacy bootstrap 功能开关必须是布尔值");
  }
}

export function createModernAppApi(): ModernAppApi {
  return {
    bootstrap(data) {
      assertLegacyBootstrapData(data);
      legacySnapshot.value = Object.freeze({ ...data });
    },

    mountPage(_page, _element) {
      // M1 只建立双运行时边界；未注册页面由 legacy app.js 继续渲染。
      return false;
    },

    unmountPage(_page) {
      // M1 尚无现代页面实例需要卸载。
    },

    setLanguage(language: UiLanguage) {
      assertLanguage(language);
      legacySnapshot.value = Object.freeze({
        ...legacySnapshot.value,
        language
      });
    },

    hasPage(_page: ModernPageName) {
      return false;
    }
  };
}
