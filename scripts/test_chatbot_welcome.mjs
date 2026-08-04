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

const elementStub = {
  nodeType: 1,
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, appendChild() {}, removeChild() {}, insertBefore() {},
  querySelectorAll() { return []; }, querySelector() { return null; },
  setAttribute() {}, removeAttribute() {}, style: {}, innerHTML: "",
  getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};
const byIdMap = {};
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector(sel) { return null; },
    querySelectorAll(sel) { return []; },
    createElement() { return { ...elementStub }; },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete",
    addEventListener() {}, removeEventListener() {}
  },
  MutationObserver: class { observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

runScript("public/chatbot_welcome.js", sandbox);
const welcome = sandbox.window.CHATBOT_WELCOME;
assertTruthy(welcome, "chatbot_welcome should expose window.CHATBOT_WELCOME");
const t = welcome._test;

// ── 用例 1：示例数据结构 ──
assertEqual(t.examples.report.length, 4, "report examples should be 4");
assertEqual(t.examples.chat.length, 3, "chat examples should be 3");
assertEqual(t.examples.report[0].text, "查一下 {merchant} 这个月表现", "first report example should be the dynamic merchant query");
assertEqual(t.examples.report[0].dynamic, "merchant", "first report example should be dynamic");
assertEqual(t.examples.report[1].text, "这个月有哪些商户逾期？", "overdue example should use single status");
for (const ex of [...t.examples.report, ...t.examples.chat]) {
  assertTruthy(ex.text, "example text must be non-empty");
}
assertEqual(t.examples.chat[0].text, "根据记忆栏的报告，给我分析建议", "first chat example should reference memory bar");
assertEqual(t.examples.chat[0].dynamic, undefined, "chat examples must NOT be dynamic");

// ── 用例 2：文案键集 zh/en 一致 ──
const zhKeys = Object.keys(t.copy.zh).sort();
const enKeys = Object.keys(t.copy.en).sort();
assertEqual(enKeys.join("|"), zhKeys.join("|"), "zh/en copy keys must match exactly");

// ── 用例 3：动态商户名 ──
assertEqual(t.merchantForExample(null), null, "no offers -> null");
assertEqual(t.merchantForExample([]), null, "empty offers -> null");
assertEqual(
  t.merchantForExample([
    { merchantName: "Low", commission: 1 },
    { merchantName: "TopBrand", commission: 99 },
    { merchantName: "Mid", commission: 50 }
  ]),
  "TopBrand",
  "should pick the highest-commission merchant"
);
assertEqual(
  t.merchantForExample([{ commission: 5 }, { merchantName: "OnlyName" }]),
  "OnlyName",
  "should fall back to any merchant with a name"
);

// ── 用例 4：语言读取 ──
assertEqual(t.currentLanguage(), "zh", "html lang zh-Hans -> zh");
