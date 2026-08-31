import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy, got ${JSON.stringify(value)}`);
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {},
  removeAttribute() {},
  style: {}
};

const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  RegExp,
  Array,
  Object,
  Set,
  Map,
  JSON,
  URLSearchParams,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

// 从 db_offers_cache.json / db_keywords_cache.json 加载数据（替代旧的静态 JS 文件）
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
assertTruthy(hooks.targetRecords, "targetRecords hook should be exposed");
assertTruthy(hooks.preferredTargetMonth, "preferredTargetMonth hook should be exposed");
assertTruthy(hooks.targetMonthlyTrendRows, "targetMonthlyTrendRows hook should be exposed");
assertTruthy(hooks.setTargetFilters, "setTargetFilters hook should be exposed");
assertTruthy(hooks.currentReportingMonthKey, "current reporting month hook should be exposed");
assertTruthy(hooks.reportOverviewMonthKeys, "report overview month option hook should be exposed");
assertTruthy(hooks.ensureReportingMonthRecord, "future reporting month hook should be exposed");
assertTruthy(hooks.targetDbStatusMonthKey, "database month selection hook should be exposed");

const records = hooks.targetRecords();
const months = Array.from(new Set(records.map((row) => row.Month).filter(Boolean)));
assertTruthy(months.includes("May 2026"), "May database reporting month should be selectable");
assertTruthy(months.includes("June 2026"), "June database reporting month should be selectable");
assertTruthy(months.includes("July 2026"), "July target template should remain available");
const referenceMonthKey = hooks.currentReportingMonthKey();
const recentMonthKeys = [-2, -1, 0].map((offset) => {
  const [year, month] = referenceMonthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
});
const overviewMonthKeys = hooks.reportOverviewMonthKeys();
for (const monthKey of ["2026-05", "2026-06", ...recentMonthKeys]) {
  assertTruthy(overviewMonthKeys.includes(monthKey), `report overview should expose ${monthKey}`);
}
const expectedPreferredMonth = months
  .slice()
  .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())
  .filter((month) => hooks.targetMonthHasMetrics(month))
  .at(-1);
assertTruthy(expectedPreferredMonth, "at least one report month should contain real summary metrics");
assertEqual(hooks.preferredTargetMonth(records), expectedPreferredMonth, "target matrix should default to the latest month with real summary metrics");

hooks.setTargetFilters({ month: "July 2026", tier: "all" });
const julyRows = hooks.targetMonthlyTrendRows(records);
assertEqual(julyRows.length, 3, "monthly trend should retain historical context through a manually selected July month");
assertEqual(julyRows[julyRows.length - 1].label, "July 2026", "monthly trend should end at the selected July month");
assertEqual(julyRows[julyRows.length - 1].selected, true, "monthly trend should highlight the selected July month");
assertTruthy(Number.isFinite(julyRows[julyRows.length - 1].value), "July monthly trend should render a numeric value");

const futureMonthKey = "2099-01";
const futureRecords = hooks.ensureReportingMonthRecord(records, futureMonthKey);
const futureRecord = futureRecords.find((row) => row.__monthKey === futureMonthKey);
assertTruthy(futureRecord, "a future reporting month should be available without a static sheet row");
assertEqual(futureRecord.Month, "January 2099", "future reporting month should use the visible month label");
assertEqual(futureRecord.__databaseOnly, true, "auto-created reporting months should be marked as database-only");
hooks.setTargetFilters({ month: "January 2099", tier: "all" });
assertEqual(hooks.targetDbStatusMonthKey(), futureMonthKey, "selecting a future month should request the matching database window");
const futureRows = hooks.targetMonthlyTrendRows(futureRecords);
assertEqual(futureRows[futureRows.length - 1].label, "January 2099", "monthly trend should end at the auto-created future month");
