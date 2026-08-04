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
let langObserverCallback = null;
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
  MutationObserver: class { constructor(cb) { langObserverCallback = cb; } observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

runScript("public/chatbot_welcome.js", sandbox);
const welcome = sandbox.window.CHATBOT_WELCOME;
assertTruthy(welcome, "chatbot_welcome should expose window.CHATBOT_WELCOME");
const t = welcome._test;

// ── 用例 1：示例数据结构（Report Mode 直接输入：商户名/品类名/Tier + 趋势分析）──
assertEqual(t.examples.report.length, 4, "report examples should be 4");
assertEqual(t.examples.chat.length, 3, "chat examples should be 3");
assertEqual(t.examples.report[0].text, "{merchant}", "first report example should be direct merchant name input");
assertEqual(t.examples.report[0].dynamic, "merchant", "first report example should be dynamic");
assertEqual(t.examples.report[1].text, "Beauty 品类", "second report example should be direct category input");
assertEqual(t.examples.report[2].text, "Tier 2", "third report example should be direct tier input");
assertEqual(t.examples.report[3].text, "{merchant}趋势分析", "fourth report example should be direct trend analysis");
assertEqual(t.examples.report[3].dynamic, "merchant", "trend example should use the dynamic merchant");
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
// knownKeyword 商户点击示例会走 keyword 搜索而非 merchant 分析，示例商户应跳过它们
assertEqual(
  t.merchantForExample([
    { merchantName: "TopBrand", commission: 99, knownKeyword: true },
    { merchantName: "OnlyName", commission: 50 }
  ]),
  "OnlyName",
  "should skip known-keyword merchants and pick the top non-keyword merchant"
);
assertEqual(
  t.merchantForExample([
    { merchantName: "TopBrand", commission: 99, knownKeyword: true },
    { merchantName: "OnlyName", commission: 50, knownKeyword: true }
  ]),
  null,
  "all known-keyword merchants -> null (welcome falls back to fixed Shokz example)"
);

// ── 用例 4：语言读取 ──
assertEqual(t.currentLanguage(), "zh", "html lang zh-Hans -> zh");

// ── 用例 5：渲染判定（常驻：只检查 welcome 内容是否已存在，不再受聊天区消息影响）──
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; } };
byIdMap["chatLogChat"] = { ...elementStub, querySelector() { return null; } };
assertEqual(t.shouldRenderFor("report"), true, "empty chatLog -> should render");
assertEqual(t.shouldRenderFor("chat"), true, "empty chatLogChat -> should render");
assertEqual(t.shouldRenderFor("bogus"), false, "unknown mode -> never render");
byIdMap["chatLog"] = null;
assertEqual(t.shouldRenderFor("report"), false, "missing chatLog -> no render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return { className: "welcome-panel" }; } };
assertEqual(t.shouldRenderFor("report"), false, "welcome already rendered -> no re-render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return { className: "welcome-bar" }; } };
assertEqual(t.shouldRenderFor("report"), false, "welcome already collapsed to bar -> no re-render");
// 常驻语义：聊天区已有消息但无 welcome 内容 → 仍渲染（对话不顶掉指南）
byIdMap["chatLog"] = {
  ...elementStub,
  querySelector(sel) { return sel.indexOf("welcome") !== -1 ? null : { className: "message" }; }
};
assertEqual(t.shouldRenderFor("report"), true, "chat log has messages but no welcome -> still render (persistent)");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; } };

// ── 用例 6：示例交互决策 ──
// 决策层键 = WELCOME_COPY 文案键（单一事实源；C1 修复：不得返回字面键名）
assertEqual(t.tipStateFor("report", false), "tipReport", "report example always shows report tip");
assertEqual(t.tipStateFor("chat", false), "chatEmptyMemory", "chat example without memory -> empty-memory tip");
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
t.showTipbar("tipReport");
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

// ── 用例 12：notify("chat-sent") 折叠为紧凑条（常驻，不删除面板）──
t.showTipbar("tipReport");
assertEqual(t.tipActive(), true, "tip shown before send");
// 先渲染展开面板，再发消息 → 折叠而非删除
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} };
byIdMap["chatLogChat"] = { ...elementStub, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} };
t.renderPanel("report", { offers: [], hasMemory: false });
assertEqual(t.collapsed(), false, "panel rendered expanded by default");
welcome.notify("chat-sent");
assertEqual(t.tipActive(), false, "chat-sent should clear tipbar");
assertEqual(t.collapsed(), true, "chat-sent should collapse to a persistent bar, NOT delete the panel");

// ── 用例 12b：折叠条可点击重新展开（常驻双态）──
assertEqual(t.renderBar("report"), true, "renderBar returns true");
assertEqual(t.collapsed(), true, "renderBar sets collapsed state");
assertEqual(t.renderPanel("report", { offers: [], hasMemory: false }), true, "re-expand renders panel again");
assertEqual(t.collapsed(), false, "re-expand clears collapsed state");
assertEqual(t.renderBar("chat"), true, "chat mode can also collapse to a bar");
assertEqual(t.collapsed(), true, "chat bar is collapsed");

// ── 用例 13：Chat 欢迎屏流程条 ✓ 标记（I2 修复）──
let flowStepAdds = [];
const mkFlowStep = () => ({
  ...elementStub,
  classList: { add(cls) { flowStepAdds.push(cls); }, remove() {}, toggle() {}, contains() { return false; } }
});
const flowSteps = [mkFlowStep(), mkFlowStep(), mkFlowStep()];
byIdMap["chatLogChat"] = {
  ...elementStub,
  querySelectorAll(sel) { return sel === ".welcome-flow.progress .welcome-flow-step" ? flowSteps : []; },
  querySelector() { return null; }
};
// 渲染预标记：hasMemory ⇒ 前两步 done（语义：记忆栏有数据 ⇒ ① 提问 ② 拖入记忆栏 都已完成）
t.markFlowStepsDone(byIdMap["chatLogChat"], 2);
assertEqual(flowStepAdds.filter((c) => c === "done").length, 2, "hasMemory render should pre-mark first two flow steps done");
// 事件路径：memory-added 补同样语义（前两步）
flowStepAdds = [];
t.markMemoryStepDone();
assertEqual(flowStepAdds.filter((c) => c === "done").length, 2, "memory-added should mark first two flow steps done");

// ── 用例 14：语言切换重渲染保持当前态（缓存 mode + 折叠态）──
assertTruthy(langObserverCallback, "lang observer should have registered during render smoke");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return { className: "welcome-panel" }; }, querySelectorAll() { return []; } };
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should set mode before lang observer fires");
langObserverCallback();
// 常驻改造：observer 不再 dismiss（置 _mode=null），而是按缓存的 mode + 折叠态重渲染，_mode 保持
assertEqual(t.lastMode(), "report", "lang observer should re-render current mode, keeping _mode (not null)");

// ── 用例 15：拦截路径提示条也随手动输入消失（M2 修复）──
byIdMap["chatInput"] = elementStub;
byIdMap["chatForm"] = { ...elementStub, parentNode: { insertBefore() {} } };
t.handleChipClick("chat", "根据记忆栏的报告，给我分析建议"); // 无记忆 → 拦截
assertEqual(t.tipActive(), true, "blocked chat example should show empty-memory tipbar");
assertEqual(t.tipFromExampleActive(), true, "blocked chat example should set tipFromExample so typing clears the tipbar");

// ── 用例 16：点击监听绑定在 panel 上，不累积在常驻容器（I1 修复）──
let containerListenerCalls = 0;
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() { containerListenerCalls++; } };
byIdMap["chatLogChat"] = { ...elementStub, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() { containerListenerCalls++; } };
t.renderSmoke();
t.renderSmoke();
assertEqual(containerListenerCalls, 0, "click listeners must bind to per-render welcome-panel, not the persistent container");
