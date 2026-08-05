import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {}, insertBefore() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {}, removeAttribute() {}, style: {}
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

const cases = [
  "根据记忆栏的报告，给我分析建议",              // chat-1（原）
  "总结记忆栏的数据，提出下个月的运营重点",        // chat-3（原）
  "总结记忆栏的数据，规划下个月的运营方向",        // chat-3（首选替代）
  "总结记忆栏的数据，分析下个月的运营方向",        // chat-3（候选 1：分析）
  "总结记忆栏的数据，规划下个月的运营方向分析",    // chat-3（候选 2）
  "总结记忆栏的数据，分析下个月的运营重点",        // chat-3（候选 3：分析+重点 → 预期 recommendation）
  "对比记忆栏里的两个商户，谁更值得重点投入",      // chat-2（对照）
  "Summarize the data in memory and plan next month's direction", // en 候选
  "Summarize the data in memory and analyze next month's direction", // en 候选 2
  "Summarize the data in memory and give next month's priorities"   // en 候选 3（priorities）
];

for (const text of cases) {
  let result;
  try {
    result = hooks.detectQueryIntent(text);
  } catch (err) {
    result = `CRASH: ${err.constructor.name}: ${err.message}`;
  }
  let category = "n/a";
  try { category = JSON.stringify(hooks.categoryForPrompt(text)); } catch (err) { category = `CRASH: ${err.constructor.name}`; }
  console.log(JSON.stringify({ text, intent: result, category }));
}
