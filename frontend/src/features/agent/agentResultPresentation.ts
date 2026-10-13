import type { UiLanguage } from "../../shared/i18n";

const tools: Record<string, [string, string]> = {
  merchant_analysis: ["商户分析", "Merchant analysis"], category_analysis: ["品类分析", "Category analysis"],
  merchant_comparison: ["商户对比", "Merchant comparison"], tier_analysis: ["Tier 概览", "Tier overview"],
  category_comparison: ["品类对比", "Category comparison"], payment_status: ["付款状态", "Payment status"],
  trend: ["月度趋势", "Monthly trend"], asin_analysis: ["ASIN 查询", "ASIN lookup"],
  keyword_search: ["关键词商户", "Keyword merchants"], promotion_analysis: ["推广分析", "Promotion analysis"]
};
const states: Record<string, [string, string]> = {
  running: ["查询中", "Running"], done: ["已完成", "Completed"], partial: ["部分完成", "Partial"], error: ["查询未完成", "Incomplete"]
};
const metrics: Record<string, [string, string]> = {
  revenue: ["收入", "Revenue"], salesAmount: ["销售额", "Revenue"], orders: ["订单", "Orders"], clicks: ["点击", "Clicks"],
  epc: ["联盟 EPC", "Affiliate EPC"], aov: ["客单价", "AOV"], conversionRate: ["转化率", "CVR"],
  commission: ["联盟佣金", "Affiliate commission"], affCommission: ["联盟佣金", "Affiliate commission"],
  affiliatePayout: ["联盟佣金", "Affiliate commission"], payout: ["总佣金", "Total commission"],
  dpv: ["详情页浏览", "Detail views"], atc: ["加购", "Add to cart"], directSales: ["直接销售额", "Direct sales"], haloSales: ["关联销售额", "Halo sales"],
  recordCount: ["记录数", "Records"], merchantCount: ["商户数", "Merchants"], totalExpected: ["预期总额", "Expected amount"], totalRemaining: ["剩余总额", "Remaining amount"],
  unpaid: ["未付款", "Unpaid"], pending: ["待处理", "Pending"], paid: ["已付款", "Paid"], overdue: ["逾期", "Overdue"]
};
const select = (value: [string, string] | undefined, language: UiLanguage, fallback: string) => value?.[language === "zh" ? 0 : 1] || fallback;
export const agentToolLabel = (key: string, language: UiLanguage) => select(tools[key], language, language === "zh" ? "数据查询" : "Data lookup");
export const agentStatusLabel = (key: string, language: UiLanguage) => select(states[key], language, language === "zh" ? "查询中" : "Running");
export const agentMetricLabel = (key: string, language: UiLanguage) => select(metrics[key], language, key);
