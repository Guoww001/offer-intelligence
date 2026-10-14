import type { UiLanguage } from "../../shared/i18n";

export function formatAgentMetric(key: string, value: number | null | undefined, language: UiLanguage): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return language === "zh" ? "未提供" : "Not provided";
  const ratio = ["conversionRate", "cvr"].includes(key);
  const percent = ratio || /(?:changePercent|growthPercent|changePct)$/i.test(key);
  const digits = key === "epc" ? 3 : /^(orders|clicks|dpv|atc|recordCount|merchantCount|count)$/.test(key) ? 0 : 2;
  const formatted = (ratio ? value * 100 : value).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${formatted}${percent ? "%" : ""}`;
}
