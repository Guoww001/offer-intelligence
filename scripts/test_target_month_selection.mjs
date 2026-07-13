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

runScript("protected_data/chatbot_data.js", sandbox);
runScript("protected_data/product_keywords.js", sandbox);
runScript("protected_data/sheet_report_data.js", sandbox);
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
assertTruthy(hooks.ensureReportingMonthRecord, "future reporting month hook should be exposed");
assertTruthy(hooks.targetDbStatusMonthKey, "database month selection hook should be exposed");

const records = hooks.targetRecords();
const months = Array.from(new Set(records.map((row) => row.Month).filter(Boolean)));
assertTruthy(months.includes("July 2026"), "July target template should remain available");
assertEqual(hooks.targetMonthHasMetrics("July 2026"), false, "July target template should be recognized as metric-empty");
assertEqual(hooks.preferredTargetMonth(records), "June 2026", "target matrix should default to the latest month with real summary metrics");

hooks.setTargetFilters({ month: "July 2026", tier: "all" });
const julyRows = hooks.targetMonthlyTrendRows(records);
assertEqual(julyRows.length, 3, "monthly trend should retain historical context through a manually selected July month");
assertEqual(julyRows[julyRows.length - 1].label, "July 2026", "monthly trend should end at the selected July month");
assertEqual(julyRows[julyRows.length - 1].selected, true, "monthly trend should highlight the selected July month");
assertEqual(julyRows[julyRows.length - 1].value, 0, "July template month should render as zero-valued monthly trend data");

const augustRecords = hooks.ensureReportingMonthRecord(records, "2026-08");
const augustRecord = augustRecords.find((row) => row.__monthKey === "2026-08");
assertTruthy(augustRecord, "the active calendar month should be available without a static sheet row");
assertEqual(augustRecord.Month, "August 2026", "future reporting month should use the visible month label");
assertEqual(augustRecord.__databaseOnly, true, "auto-created reporting months should be marked as database-only");
hooks.setTargetFilters({ month: "August 2026", tier: "all" });
assertEqual(hooks.targetDbStatusMonthKey(), "2026-08", "selecting August should request the August database window");
const augustRows = hooks.targetMonthlyTrendRows(augustRecords);
assertEqual(augustRows[augustRows.length - 1].label, "August 2026", "monthly trend should end at the auto-created August month");
