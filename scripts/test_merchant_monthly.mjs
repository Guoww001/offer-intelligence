import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}
function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
}
function assertNotEqual(actual, expected, label) {
  if (actual === expected) throw new Error(`${label}: expected ${JSON.stringify(actual)} to differ from ${JSON.stringify(expected)}`);
}
function assertNotMatch(actual, pattern, label) {
  if (pattern.test(actual)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to NOT match ${pattern}`);
}

const elementStub = {
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
  dataset: {}, appendChild() {}, querySelectorAll() { return []; },
  querySelector() { return null; }, setAttribute() {}, removeAttribute() {}, style: {}
};
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

const _offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: _offersCache.summary || {},
  offers: _offersCache.offers || [],
  paymentRecords: _offersCache.paymentRecords || [],
  sources: { mode: "db", month: _offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: _offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
const _kwCache = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
sandbox.window.PRODUCT_KEYWORDS = _kwCache;
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");
assertTruthy(hooks.mergeMonthIntoOffer && hooks.formatMonthLabel && hooks.merchantMonthPickerHtml &&
  hooks.selectedMonthRow && hooks.monthlyMetricRows && hooks.offerByMerchantId && hooks.fetchMerchantMonthlyRows,
  "monthly helpers should be exposed in hooks");

// ── 用例 1：月份行→offer 映射 ──
const base = { merchantId: "362653", brand: "Shokz", tier: "Tier 1", network: "Awin",
  category: "Audio", commissionRate: 0.2, paymentStatus: "Paid", linkStatus: "ok" };
const aug = { month: "2026-08", orders: 120, revenue: 9600, payout: 1440, affiliatePayout: 960,
  clicks: 2400, dpv: 2600, atc: 400, aov: 80, conversionRate: 0.05 };
const merged = hooks.mergeMonthIntoOffer(base, aug);
assertEqual(merged.salesAmount, 9600, "merged salesAmount should come from row.revenue");
assertEqual(merged.payout, 1440, "merged payout should come from row.payout");
assertEqual(merged.affCommission, 960, "merged affCommission should come from row.affiliatePayout");
assertEqual(merged.orders, 120, "merged orders should come from row.orders");
assertEqual(merged.clicks, 2400, "merged clicks should come from row.clicks");
assertEqual(merged.dpv, 2600, "merged dpv should come from row.dpv");
assertEqual(merged.atc, 400, "merged atc should come from row.atc");
assertEqual(merged.aov, 80, "merged aov should come from row.aov");
assertEqual(merged.conversionRate, 0.05, "merged conversionRate should come from row.conversionRate");
assertEqual(merged.tier, "Tier 1", "offer-level tier should be preserved");
assertEqual(merged.network, "Awin", "offer-level network should be preserved");
assertEqual(merged.category, "Audio", "offer-level category should be preserved");
assertEqual(merged.brand, "Shokz", "offer-level brand should be preserved");
assertNotEqual(merged, base, "mergeMonthIntoOffer should return a shallow copy, not mutate the input");

// ── 用例 2：EPC 公式复用（映射后 offerAllEpc/offerAffEpc 直接成立）──
assertEqual(hooks.offerAllEpc(merged), 1440 / 2400, "All EPC should be payout/clicks on merged offer");
assertEqual(hooks.offerAffEpc(merged), 960 / 2400, "Aff EPC should be affiliatePayout/clicks on merged offer");
assertEqual(hooks.offerAllCommission(merged), 1440, "All Commission should be payout on merged offer");
assertEqual(hooks.offerAffCommission(merged), 960, "Aff Commission should be affCommission on merged offer");

// ── 用例 3：月份格式化 ──
assertEqual(hooks.formatMonthLabel("2026-08", "zh"), "2026年8月", "zh month label format");
assertEqual(hooks.formatMonthLabel("2026-08", "en"), "Aug 2026", "en month label format");
assertEqual(hooks.formatMonthLabel("2026-12", "en"), "Dec 2026", "en December format");
assertEqual(hooks.formatMonthLabel("2026-01", "zh"), "2026年1月", "zh January format");

// ── 用例 4：下拉 HTML ──
const rows4 = [
  { month: "2026-08", revenue: 9600, payout: 1440, affiliatePayout: 960, clicks: 2400, aov: 80, orders: 120, conversionRate: 0.05 },
  { month: "2026-07", revenue: 8000, payout: 1200, affiliatePayout: 800, clicks: 2000, aov: 80, orders: 100, conversionRate: 0.05 },
  { month: "2026-06", revenue: 7200, payout: 1080, affiliatePayout: 720, clicks: 1800, aov: 80, orders: 90, conversionRate: 0.05 }
];
const pickerZh = hooks.merchantMonthPickerHtml(base, rows4, "2026-07", "context", "zh");
assertMatch(pickerZh, /merchant-month-picker/, "picker should have merchant-month-picker class");
assertMatch(pickerZh, /data-merchant-id="362653"/, "picker should carry data-merchant-id");
assertMatch(pickerZh, /data-card="context"/, "picker should carry data-card=context");
assertMatch(pickerZh, /2026年8月/, "picker zh should list 2026年8月");
assertMatch(pickerZh, /2026年7月/, "picker zh should list 2026年7月");
assertMatch(pickerZh, /<option value="2026-07" selected>/, "selected month option should be marked selected");
assertEqual((pickerZh.match(/<option/g) || []).length, 3, "picker should have 3 month options");
const pickerOverview = hooks.merchantMonthPickerHtml(base, rows4, null, "overview", "en");
assertMatch(pickerOverview, /data-card="overview"/, "picker overview should carry data-card=overview");
assertMatch(pickerOverview, /Aug 2026/, "en picker should show Aug 2026");
assertMatch(pickerOverview, /<option value="2026-08" selected>/, "default selected should be latest month");

// ── 用例 5：selectedMonthRow ──
assertEqual(hooks.selectedMonthRow(rows4, "2026-06").month, "2026-06", "selectedMonthRow should pick requested month");
assertEqual(hooks.selectedMonthRow(rows4, "2026-07").month, "2026-07", "selectedMonthRow should pick requested month");
assertEqual(hooks.selectedMonthRow(rows4, null).month, "2026-08", "selectedMonthRow default should be latest month");
assertEqual(hooks.selectedMonthRow([], "2026-08"), null, "empty rows should return null");
assertEqual(hooks.selectedMonthRow(null, "2026-08"), null, "null rows should return null");

// ── 用例 6：月度指标行 ──
const metricRows = hooks.monthlyMetricRows(merged, "zh");
const metricByLabel = Object.fromEntries(metricRows);
assertEqual(metricByLabel["EPC(All)"], hooks.epc(1440 / 2400), "metric rows EPC(All) should use epc format");
assertEqual(metricByLabel["EPC(Aff)"], hooks.epc(960 / 2400), "metric rows EPC(Aff) should use epc format");
assertEqual(metricByLabel["CVR"], hooks.pct(0.05), "metric rows CVR should use pct format");
assertEqual(metricByLabel["Revenue"], hooks.money(9600), "metric rows Revenue should use money format");
assertEqual(metricByLabel["All Commission"], hooks.money(1440), "metric rows All Commission should use money format");
assertEqual(metricByLabel["Aff Commission"], hooks.money(960), "metric rows Aff Commission should use money format");
assertEqual(metricByLabel["Orders"], hooks.countValue(120), "metric rows Orders should use countValue format");
assertEqual(metricByLabel["Clicks"], hooks.countValue(2400), "metric rows Clicks should use countValue format");

// ── 用例 7：offerByMerchantId ──
const shokz = (_offersCache.offers || []).find((o) => String(o.merchantId) === "362653");
assertTruthy(shokz, "Shokz 362653 offer should exist in cache");
assertEqual(hooks.offerByMerchantId("362653").merchantId, "362653", "offerByMerchantId should find by id");
assertEqual(hooks.offerByMerchantId("999999"), null, "offerByMerchantId should return null for unknown id");

// ── 用例 8：统计卡片（有月度数据 → 下拉 + 所选月虚拟 offer）──
const statsWithRows = hooks.renderMerchantStats(shokz, rows4);
assertMatch(statsWithRows, /merchant-month-picker/, "stats card should render month picker with rows");
assertMatch(statsWithRows, /data-card="context"/, "stats card picker should be context scope");
assertMatch(statsWithRows, /2026年8月/, "stats card picker should show zh month labels");
assertMatch(statsWithRows, /总佣金/, "stats card should keep All Commission zh label");
assertMatch(statsWithRows, /\$9,600/, "stats card Revenue made should reflect merged revenue 9600 (money format $9,600)");
assertMatch(statsWithRows, /\$0\.600/, "stats card EPC(All) should be payout/clicks of latest month");
// 指定所选月（7 月）
const statsJul = hooks.renderMerchantStats(shokz, rows4, "2026-07");
assertMatch(statsJul, /<option value="2026-07" selected>/, "stats card selected month should follow selectedMonth arg");
assertMatch(statsJul, /\$8,000/, "stats card Revenue made should reflect July revenue");

// ── 用例 9：统计卡片（无月度数据 → 降级，无下拉）──
const statsNoRows = hooks.renderMerchantStats(shokz, null);
assertNotMatch(statsNoRows, /merchant-month-picker/, "no monthly rows should not render picker");
assertMatch(statsNoRows, /总佣金/, "degraded stats card should keep All Commission zh label");

console.log("PASS: merchant monthly pure helpers");
