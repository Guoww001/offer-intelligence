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
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
  }
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

// 用例 1：真实商户映射（Shokz 362653）
const shokz = (_offersCache.offers || []).find((o) => String(o.merchantId) === "362653");
assertTruthy(shokz, "Shokz 362653 offer should exist in cache");
assertEqual(hooks.offerAllCommission(shokz), 26, "Shokz All Commission should use payout");
assertEqual(hooks.offerAffCommission(shokz), 19.5, "Shokz Aff Commission should use affCommission");

// 用例 2：EPC 计算
const epcFixture = { payout: 100, affCommission: 80, clicks: 200 };
assertEqual(hooks.offerAllEpc(epcFixture), 0.5, "All EPC = payout / clicks");
assertEqual(hooks.offerAffEpc(epcFixture), 0.4, "Aff EPC = affCommission / clicks");

// 用例 3：缺失 / 零点击
assertEqual(hooks.offerAllEpc({ clicks: 0 }), null, "zero clicks should make All EPC null");
assertEqual(hooks.offerAffEpc({ clicks: 0 }), null, "zero clicks should make Aff EPC null");
assertEqual(hooks.offerAllCommission({}), null, "missing payout should make All Commission null");
assertEqual(hooks.offerAffCommission({}), null, "missing affCommission should make Aff Commission null");

// 用例 4a：格式化函数对 null 的行为
assertEqual(hooks.money(null), "not available in current data", "money(null) should show not available");
assertEqual(hooks.shortEpc(null), "-", "shortEpc(null) should show dash");

// 用例 7：i18n 键
assertEqual(hooks.labelText("All Commission"), "总佣金", "zh label All Commission should translate");
assertEqual(hooks.labelText("Aff Commission"), "联盟佣金", "zh label Aff Commission should translate");
assertEqual(hooks.labelText("EPC(All)"), "EPC(All)", "zh label EPC(All) should stay EPC(All)");
assertEqual(hooks.labelText("EPC(Aff)"), "EPC(Aff)", "zh label EPC(Aff) should stay EPC(Aff)");

console.log("PASS: commission All/Aff helpers, formatting, i18n");
