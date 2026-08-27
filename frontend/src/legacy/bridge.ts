import { readonly, shallowRef } from "vue";

import type {
  LegacyBootstrapData,
  ModernAppApi,
  ModernPageController,
  ModernPageFactory,
  ModernPageName,
  UiLanguage
} from "./contracts";

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

export function createModernAppApi(
  definitions: Partial<Record<ModernPageName, ModernPageFactory>> = {}
): ModernAppApi {
  let activePage: { name: ModernPageName; controller: ModernPageController } | null = null;

  function unmountActivePage(): void {
    if (!activePage) return;
    const current = activePage;
    activePage = null;
    current.controller.unmount();
  }

  return {
    bootstrap(data) {
      assertLegacyBootstrapData(data);
      legacySnapshot.value = Object.freeze({ ...data });
    },

    mountPage(page, element) {
      const factory = definitions[page];
      if (!factory) return false;
      unmountActivePage();
      const controller = factory(element);
      activePage = { name: page, controller };
      return true;
    },

    unmountPage(page) {
      if (!activePage || activePage.name !== page) return;
      unmountActivePage();
    },

    setLanguage(language: UiLanguage) {
      assertLanguage(language);
      legacySnapshot.value = Object.freeze({
        ...legacySnapshot.value,
        language
      });
      activePage?.controller.setLanguage?.(language);
    },

    hasPage(page: ModernPageName) {
      return Boolean(definitions[page]);
    }
  };
}
