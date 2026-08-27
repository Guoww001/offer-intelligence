import { createApp, h, ref } from "vue";

import "./shared/styles/modern-root.css";
import "./features/offer-tracker/offerTracker.css";

import { createModernAppApi, getLegacySnapshot } from "./legacy/bridge";
import type {
  LegacyBootstrapData,
  ModernPageController,
  ModernPageFactory
} from "./legacy/contracts";
import type {
  OfferRecord,
  OfferTrackerDateRange,
  OfferTrackerExportPayload
} from "./shared/contracts/offer";
import OfferTrackerPage from "./features/offer-tracker/OfferTrackerPage.vue";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function chatbotRecord(data: LegacyBootstrapData): Record<string, unknown> {
  return isRecord(data.chatbotData) ? data.chatbotData : {};
}

function offerRecords(data: LegacyBootstrapData): readonly OfferRecord[] {
  const rows = chatbotRecord(data).offers;
  return Array.isArray(rows)
    ? rows.filter((row): row is OfferRecord => isRecord(row))
    : [];
}

function defaultDateRange(data: LegacyBootstrapData): OfferTrackerDateRange {
  const chatbotData = chatbotRecord(data);
  const startDate = stringValue(chatbotData.startDate);
  const endDate = stringValue(chatbotData.endDate);
  if (startDate && endDate) return { startDate, endDate };
  return { startDate: "1970-01-01", endDate: "1970-01-01" };
}

async function loadOfferTrackerRange(range: OfferTrackerDateRange): Promise<readonly OfferRecord[]> {
  const query = new URLSearchParams({
    start_date: range.startDate,
    end_date: range.endDate
  });
  const response = await fetch(`/api/ui/db/offers?${query.toString()}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Offer Tracker API 请求失败: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.offers)) {
    throw new Error("Offer Tracker API 响应缺少 offers");
  }
  return payload.offers.filter((row): row is OfferRecord => isRecord(row));
}

function downloadOfferTracker(payload: OfferTrackerExportPayload): boolean {
  const bridge = window.OI_LEGACY_BRIDGE;
  if (!bridge) return false;
  return bridge.download("offer-tracker", payload);
}

const offerTrackerFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getLegacySnapshot().value;
  const language = ref(snapshot.language);
  const offers = offerRecords(snapshot);
  const range = defaultDateRange(snapshot);
  const app = createApp({
    name: "ModernOfferTrackerMount",
    setup() {
      return () => h(OfferTrackerPage, {
        offers,
        language: language.value,
        defaultDateRange: range,
        loadRange: loadOfferTrackerRange,
        download: downloadOfferTracker
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      language.value = nextLanguage;
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

window.OI_MODERN_APP = createModernAppApi({ "offer-list-tracker": offerTrackerFactory });
