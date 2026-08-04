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

// ── 用例 5：渲染判定 ──
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; } };
byIdMap["chatLogChat"] = { ...elementStub, querySelector() { return null; } };
assertEqual(t.shouldRenderFor("report"), true, "empty chatLog -> should render");
assertEqual(t.shouldRenderFor("chat"), true, "empty chatLogChat -> should render");
assertEqual(t.shouldRenderFor("bogus"), false, "unknown mode -> never render");
byIdMap["chatLog"] = null;
assertEqual(t.shouldRenderFor("report"), false, "missing chatLog -> no render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return { className: "welcome-panel" }; } };
assertEqual(t.shouldRenderFor("report"), false, "welcome already rendered -> no re-render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return { className: "message" }; } };
assertEqual(t.shouldRenderFor("report"), false, "chat log has messages -> no render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; } };

// ── 用例 6：示例交互决策 ──
assertEqual(t.tipStateFor("report", false), "report-tip", "report example always shows report tip");
assertEqual(t.tipStateFor("chat", false), "empty-memory", "chat example without memory -> empty-memory tip");
assertEqual(t.tipStateFor("chat", true), null, "chat example with memory -> no tip");
assertEqual(t.fillAllowedFor("report", false), true, "report example always fills");
assertEqual(t.fillAllowedFor("chat", false), false, "chat example without memory -> blocked");
assertEqual(t.fillAllowedFor("chat", true), true, "chat example with memory -> fills");

// ── 用例 7：手动输入清除提示 ──
assertEqual(t.shouldClearTipOnInput("abc", "abc"), false, "unchanged value -> keep tip");
assertEqual(t.shouldClearTipOnInput("abcX", "abc"), true, "user edited value -> clear tip");
assertEqual(t.shouldClearTipOnInput("", "abc"), true, "cleared value -> clear tip");

// ── 用例 8：渲染 smoke（stub DOM 下不抛异常）──
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; }, addEventListener() {} };
byIdMap["chatLogChat"] = { ...elementStub, querySelector() { return null; }, addEventListener() {} };
byIdMap["chatInput"] = elementStub;
byIdMap["chatForm"] = { ...elementStub, parentNode: { insertBefore() {} } };
t.renderSmoke();
assertEqual(t.tipActive(), false, "no tip after plain render");
t.showTipbar("report-tip");
assertEqual(t.tipActive(), true, "showTipbar should set tip state");
t.clearTipbar();
assertEqual(t.tipActive(), false, "clearTipbar should clear tip state");

// ── 用例 9：notify("report-ready") 一次性 ──
assertEqual(t.panelTipActive(), true, "panel tip should be available initially");
welcome.notify("report-ready", { panelEl: elementStub });
assertEqual(t.panelTipActive(), false, "panel tip should be consumed after first report");
welcome.notify("report-ready", { panelEl: elementStub });
assertEqual(t.panelTipActive(), false, "panel tip must NOT re-appear on second report");

// ── 用例 10：notify("memory-added") ──
assertEqual(t.hasMemory(), false, "hasMemory starts false");
welcome.notify("memory-added", { hasMemory: true });
assertEqual(t.hasMemory(), true, "memory-added should set hasMemory true");

// ── 用例 11：notify("mode-switched") 驱动渲染 ──
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.lastMode(), "chat", "mode-switched chat should render chat welcome");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should render report welcome");

// ── 用例 12：notify("chat-sent") 清理 ──
t.showTipbar("report-tip");
assertEqual(t.tipActive(), true, "tip shown before send");
welcome.notify("chat-sent");
assertEqual(t.tipActive(), false, "chat-sent should clear tipbar");
