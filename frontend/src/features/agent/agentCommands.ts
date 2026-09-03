import type { UiLanguage } from "../../shared/i18n";

export interface AgentCommand {
  key: string; zh: string; en: string; zhHint: string; enHint: string;
  route?: "publisher" | "publisherprofile";
  template: (value: string, language: UiLanguage) => string;
}
const query = (zh: string, en: string) => (value: string, language: UiLanguage) => `${language === "zh" ? zh : en} ${value}`;
export const AGENT_COMMANDS: readonly AgentCommand[] = [
  { key: "merchant", zh: "商户分析", en: "Merchant", zhHint: "商户名或 ID，例如 Tapo", enHint: "Merchant name or ID, e.g. Tapo", template: query("分析商户", "Analyze merchant") },
  { key: "publisher", zh: "媒体记录", en: "Publisher", zhHint: "媒体名、ID 或筛选条件", enHint: "Publisher name, ID, or filters", route: "publisher", template: (v) => `publisher: ${v}` },
  { key: "publisherprofile", zh: "媒体画像", en: "Publisher profile", zhHint: "媒体名或 ID，可补充站点", enHint: "Publisher name or ID, optional market", route: "publisherprofile", template: (v) => `publisherprofile: ${v}` },
  { key: "trend", zh: "月度趋势", en: "Monthly trend", zhHint: "对象、月份和指标，例如 Tapo 最近 6 个月收入", enHint: "Target, months, metric, e.g. Tapo 6 months revenue", template: query("查看月度趋势", "Show monthly trends for") },
  { key: "tier", zh: "Tier 概览", en: "Tier overview", zhHint: "Tier 1–4，例如 Tier 2", enHint: "Tier 1–4, e.g. Tier 2", template: query("分析分层", "Analyze tier") },
  { key: "merchants", zh: "Tier 商户列表", en: "Tier merchants", zhHint: "Tier、条数或分页，例如 Tier 2 前 50 个", enHint: "Tier and limit, e.g. first 50 in Tier 2", template: query("列出商户及核心指标", "List merchants and key metrics for") },
  { key: "category", zh: "品类分析", en: "Category", zhHint: "品类名称，例如 Electronics", enHint: "Category name, e.g. Electronics", template: query("分析品类", "Analyze category") },
  { key: "compare", zh: "商户对比", en: "Compare merchants", zhHint: "两个或多个商户，例如 Tapo 和 Kasa", enHint: "Two or more merchants, e.g. Tapo and Kasa", template: query("比较商户", "Compare merchants") },
  { key: "comparecategories", zh: "品类对比", en: "Compare categories", zhHint: "两个或多个品类", enHint: "Two or more categories", template: query("比较品类", "Compare categories") },
  { key: "payment", zh: "付款状态", en: "Payments", zhHint: "商户、月份或付款状态", enHint: "Merchant, month, or payment status", template: query("查询付款状态", "Check payment status for") },
  { key: "unpaid", zh: "未付款记录", en: "Unpaid records", zhHint: "商户或月份，例如 Tapo", enHint: "Merchant or month, e.g. Tapo", template: query("查询未支付记录", "Show unpaid records for") },
  { key: "revenue", zh: "收入趋势", en: "Revenue trend", zhHint: "商户、品类或 Tier 与月份", enHint: "Merchant, category, or tier and months", template: query("查看收入月度趋势", "Show monthly revenue trends for") },
  { key: "epc", zh: "EPC 趋势", en: "EPC trend", zhHint: "商户、品类或 Tier 与月份", enHint: "Merchant, category, or tier and months", template: query("查看 EPC 月度趋势", "Show monthly EPC trends for") },
  { key: "orders", zh: "订单趋势", en: "Order trend", zhHint: "商户、品类或 Tier 与月份", enHint: "Merchant, category, or tier and months", template: query("查看订单月度趋势", "Show monthly order trends for") }
];

export function parseAgentCommand(input: string) {
  const match = input.match(/^\s*\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = AGENT_COMMANDS.find((item) => item.key === match[1]?.toLowerCase());
  return command ? { command, value: (match[2] || "").trim() } : null;
}
