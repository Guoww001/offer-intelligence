// 品类趋势 Deep View 回归测试：全量聚合（不截断 Top 25）、品类下拉模式、
// Tier 1-3 口径、无品类名路由、下拉切换竞态守卫、品类缓存。
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
  if (!pattern.test(String(actual))) throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
}
function assertNotEqual(actual, expected, label) {
  if (actual === expected) throw new Error(`${label}: expected ${JSON.stringify(actual)} to differ from ${JSON.stringify(expected)}`);
}
function assertNotMatch(actual, pattern, label) {
  if (pattern.test(String(actual))) throw new Error(`${label}: expected ${JSON.stringify(actual)} to NOT match ${pattern}`);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const elementStub = {
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
  dataset: {}, appendChild() {}, querySelectorAll() { return []; },
  querySelector() { return null; }, setAttribute() {}, removeAttribute() {}, style: {}, innerHTML: ""
};

// ── mock fetch：商户月度端点按 merchantId 返回可预测数据；LLM 分析端点返回固定文本 ──
let merchantFetchCalls = 0;      // 商户月度端点调用计数（缓存命中验证）
const slowMerchantIds = new Set(); // 竞态测试：这些商户的响应延迟 150ms
async function mockFetch(url, opts) {
  const u = String(url);
  if (u.includes("/api/chat/analyze")) {
    return { ok: true, json: async () => ({ ok: true, text: "趋势分析文本" }) };
  }
  if (u.includes("merchantId=")) {
    merchantFetchCalls++;
    const id = parseInt((u.match(/merchantId=([^&]+)/) || [])[1] || "0", 10);
    const delay = slowMerchantIds.has(id) ? 150 : 0;
    if (delay) await sleep(delay);
    const base = Number.isFinite(id) ? id : 0;
    return { ok: true, json: async () => ({ ok: true, monthlyAmazonMetrics: [
      { month: "2026-07", revenue: base, orders: 2, clicks: 40, payout: base * 0.15, affiliatePayout: base * 0.1 },
      { month: "2026-08", revenue: base + 10, orders: 3, clicks: 50, payout: (base + 10) * 0.15, affiliatePayout: (base + 10) * 0.1 }
    ] }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}

const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  fetch: mockFetch, AbortSignal, setTimeout, clearTimeout,
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
["isTier4OrBlack", "offersInCategory", "categoryListForTrend", "fetchAggregatedMonthlyMetrics",
 "fetchCategoryTrendMetrics", "trendAnalysisTitle", "renderTrendContext", "renderCategoryTrend",
 "switchTrendCategory", "buildTrendContext", "computeTrend", "trendContextData", "activeTrendCategory"]
  .forEach((k) => assertTruthy(hooks[k], `${k} should be exposed in hooks`));

// ── 用例 1：Tier 过滤口径 ──
assertEqual(hooks.isTier4OrBlack("Tier 4"), true, "Tier 4 → true");
assertEqual(hooks.isTier4OrBlack("black tier"), true, "black tier → true");
assertEqual(hooks.isTier4OrBlack("BLACK TIER"), true, "BLACK TIER → true");
assertEqual(hooks.isTier4OrBlack("Tier 3"), false, "Tier 3 → false");
assertEqual(hooks.isTier4OrBlack(undefined), false, "undefined → false");

// Electronics 品类：默认含 Tier 4/BLACK；excludeTier4Black 后无 Tier 4/BLACK 商户
const elecAll = hooks.offersInCategory("Electronics");
const elecT123 = hooks.offersInCategory("Electronics", { excludeTier4Black: true });
assertTruthy(elecAll.length > elecT123.length, "excluding Tier 4/BLACK should shrink the category set");
assertEqual(elecT123.every((o) => !hooks.isTier4OrBlack(o.tier)), true, "excluded set should contain no Tier 4/BLACK");
assertEqual(hooks.offersInCategory("Electronics").length, hooks.offersInCategory("Electronics", {}).length,
  "empty opts should behave like default (no filter)");

// ── 用例 2：品类下拉列表（Tier 1-3、revenue 降序）──
const catList = hooks.categoryListForTrend();
assertTruthy(catList.length >= 2, "should have at least 2 categories for trend dropdown");
for (let i = 1; i < catList.length; i++) {
  if (catList[i].revenue > catList[i - 1].revenue) {
    throw new Error(`categoryList should be revenue-desc: ${catList[i].name} > ${catList[i - 1].name}`);
  }
}
// 列表项与 offersInCategory 口径一致（每个列表品类都能命中 Tier1-3 商户）
const listHit = hooks.offersInCategory(catList[0].name, { excludeTier4Black: true });
assertTruthy(listHit.length > 0, `list category ${catList[0].name} should hit offers`);

// ── 用例 3：无品类名趋势路由 ──
assertEqual(hooks.detectTrendEntityType(null, "品类趋势"), "category", "裸「品类趋势」→ category");
assertEqual(hooks.detectTrendEntityType(null, "category trend analysis"), "category", "category trend analysis → category");
assertEqual(hooks.detectTrendEntityType(null, "Shokz revenue trend"), "merchant", "无品类词 → merchant");
assertEqual(hooks.detectTrendEntityType("Beauty", "Beauty category trend"), "category", "带品类名仍走 category");
assertEqual(hooks.trendAnalysisTitle("category", null, true), "品类趋势", "zh 标题");
assertEqual(hooks.trendAnalysisTitle("category", null, false), "Category Trend", "en 标题");

// ── 用例 4：全量聚合不截断 Top 25 ──
const offers30 = [];
for (let i = 0; i < 30; i++) {
  offers30.push({ merchantId: String(2000 + i), brand: "M" + i, tier: "Tier 1",
    mainCategory: "TrendTest", salesAmount: 1000 + i });
}
const agg30 = await hooks.fetchAggregatedMonthlyMetrics(offers30, 12);
assertTruthy(agg30 && agg30.length >= 2, "aggregated monthly rows should exist");
const augRow = agg30.find((r) => r.month === "2026-08");
assertTruthy(augRow, "2026-08 row should exist");
// Σ(2000..2029) + 10*30 —— 若仍截断 Top 25，2025-2029 的贡献缺失
const expectRev = 30 * (2000 + 2029) / 2 + 300;
assertEqual(augRow.revenue, expectRev, "all 30 merchants should contribute (no Top-25 truncation)");

// ── 用例 5：品类聚合缓存（二次调用不触发商户请求）──
const topCat = catList[0].name;
merchantFetchCalls = 0;
const first = await hooks.fetchCategoryTrendMetrics(topCat, 12);
const firstCalls = merchantFetchCalls;
assertTruthy(first && first.length >= 2, "first category fetch should return metrics");
const second = await hooks.fetchCategoryTrendMetrics(topCat, 12);
assertEqual(merchantFetchCalls, firstCalls, "cached category fetch should not hit merchant API again");
assertEqual(JSON.stringify(second), JSON.stringify(first), "cached result should be identical");

// ── 用例 6：buildTrendContext 透传品类下拉状态 ──
const ctx = hooks.buildTrendContext({ target: "X", categoryTrend: true, categoryList: catList, activeCategory: topCat });
assertEqual(ctx.categoryTrend, true, "context should carry categoryTrend");
assertEqual(ctx.activeCategory, topCat, "context should carry activeCategory");
assertEqual(ctx.categoryList, catList, "context should carry categoryList");

// ── 用例 7：renderTrendContext 品类下拉 + loading 态 ──
hooks.setLanguage("zh");
const renderSummary = { target: topCat, categoryTrend: true, categoryList: catList,
  activeCategory: topCat, months: [{ month: "2026-08", revenue: 1 }], summary: {} };
const pickerHtml = hooks.renderTrendContext(renderSummary);
assertMatch(pickerHtml, /data-trend-category-select/, "trend context should render category dropdown");
// option 值经 escapeHtml 转义（& → &amp;），断言按转义后文本匹配
const escTopCat = topCat.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
assertMatch(pickerHtml, new RegExp('value="' + escTopCat + '" selected'), "active category should be selected");
assertNotMatch(pickerHtml, /trend-loading/, "normal render should not contain loading state");
const loadingHtml = hooks.renderTrendContext({ target: topCat, loading: true, categoryTrend: true, categoryList: catList, activeCategory: topCat });
assertMatch(loadingHtml, /trend-loading/, "loading render should show loading state");
assertMatch(loadingHtml, /data-trend-category-select/, "loading render should keep dropdown");
const plainHtml = hooks.renderTrendContext({ target: "M1", months: [{ month: "2026-08", revenue: 1 }], summary: {} });
assertNotMatch(plainHtml, /data-trend-category-select/, "non-category trend should not render dropdown");

// ── 用例 8：renderCategoryTrend 初始品类（裸输入 → 列表第一项）──
const containerA = { innerHTML: "" };
const sA = await hooks.renderCategoryTrend(containerA, null, true, "zh", 3, 12, 0);
assertTruthy(sA, "bare category trend should produce a summary");
assertEqual(sA.categoryTrend, true, "summary should be marked categoryTrend");
assertEqual(sA.activeCategory, catList[0].name, "bare input should default to first (top-revenue) category");
assertMatch(containerA.innerHTML, /趋势数据已加载/, "answer area should show loaded info");
const cA = hooks.trendContextData();
assertEqual(cA.categoryTrend, true, "context panel should be categoryTrend mode");
assertEqual(cA.activeCategory, catList[0].name, "context panel should show first category");

// 带品类名 → 初始选中该品类
const containerB = { innerHTML: "" };
const sB = await hooks.renderCategoryTrend(containerB, catList[1].name, false, "en", 3, 12, 0);
assertTruthy(sB, "named category trend should produce a summary");
assertEqual(sB.activeCategory, catList[1].name, "named category should be selected");

// 品类不在 Tier1-3 → 警告 + 回退列表第一项
const containerC = { innerHTML: "" };
const sC = await hooks.renderCategoryTrend(containerC, "不存在品类XYZ", true, "zh", 3, 12, 0);
assertTruthy(sC, "mismatch category should still produce a summary (fallback)");
assertEqual(sC.activeCategory, catList[0].name, "mismatch should fall back to first category");
assertMatch(containerC.innerHTML, /已切换为/, "mismatch should warn user about fallback");

// ── 用例 9：下拉切换竞态守卫（慢品类过期结果不覆盖新品类）──
// 用 db cache 真实商户构建慢/快品类延迟表
const cat0Offers = hooks.offersInCategory(catList[0].name, { excludeTier4Black: true });
const cat1Offers = hooks.offersInCategory(catList[1].name, { excludeTier4Black: true });
assertTruthy(cat0Offers.length > 0 && cat1Offers.length > 0, "both categories should have offers");
cat0Offers.forEach((o) => slowMerchantIds.add(Number(o.merchantId)));
// 预热品类 1（避免其缓存行为影响请求计数）
await hooks.fetchCategoryTrendMetrics(catList[1].name, 12);

// 先切慢品类（不 await，挂起）→ 立即切快品类 → 慢品类结果返回后应被丢弃
const p0 = hooks.switchTrendCategory(catList[0].name); // 慢（150ms 延迟）
const s1 = await hooks.switchTrendCategory(catList[1].name); // 快
assertTruthy(s1, "fast switch should complete");
assertEqual(s1.activeCategory, catList[1].name, "fast switch summary should be the new category");
await sleep(300); // 等慢品类请求完成返回
const finalCtx = hooks.trendContextData();
assertEqual(finalCtx.target, catList[1].name, "stale slow result should be dropped (race guard)");
assertEqual(hooks.activeTrendCategory(), catList[1].name, "active category should stay on fast switch");

// ── 用例 10：DB 不可用 → 估算趋势仍带品类下拉标记 ──
const estCat = catList[Math.min(2, catList.length - 1)].name;
sandbox.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) }); // 商户请求全部失败
const containerD = { innerHTML: "" };
const sD = await hooks.renderCategoryTrend(containerD, estCat, true, "zh", 3, 5, 0);
assertTruthy(sD, "estimated trend should still produce a summary");
assertEqual(sD.estimated, true, "summary should be marked estimated");
assertEqual(sD.categoryTrend, true, "estimated summary should keep categoryTrend marker");
assertEqual(sD.activeCategory, estCat, "estimated summary should keep active category");

console.log("test_category_trend.mjs: all assertions passed");
