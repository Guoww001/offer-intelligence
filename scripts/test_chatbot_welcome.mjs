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
  setAttribute() {}, removeAttribute() {}, style: {}, innerHTML: "", value: "",
  getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};
const byIdMap = {};
let langObserverCallback = null;

// 可控制欢迎屏卡片存在性的 dashboard 主网格 stub（welcome 独立卡片挂在这）
function makeMainGrid() {
  let hasWelcome = false;
  const mainGrid = {
    ...elementStub,
    querySelector(sel) { return sel === ".welcome-panel" ? (hasWelcome ? { className: "welcome-panel" } : null) : null; },
    querySelectorAll(sel) {
      return sel === ".welcome-panel" ? (hasWelcome ? [{ className: "welcome-panel", parentNode: mainGrid }] : []) : [];
    },
    insertBefore() { hasWelcome = true; return null; },
    removeChild() { hasWelcome = false; return null; },
    _welcomePresent() { return hasWelcome; }
  };
  return mainGrid;
}
const mainGrid = makeMainGrid();

// 可控制 Chat Mode 提醒卡片存在性的 #chatLogChat stub
function makeChatLogChat() {
  let hasReminder = false;
  const log = {
    ...elementStub,
    firstChild: null,
    querySelector(sel) { return sel === ".chat-reminder" ? (hasReminder ? { className: "chat-reminder" } : null) : null; },
    querySelectorAll(sel) {
      return sel === ".chat-reminder" ? (hasReminder ? [{ className: "chat-reminder", parentNode: log }] : []) : [];
    },
    insertBefore() { hasReminder = true; return null; },
    removeChild() { hasReminder = false; return null; },
    _reminderPresent() { return hasReminder; }
  };
  return log;
}
const chatLogChat = makeChatLogChat();
byIdMap["chatLogChat"] = chatLogChat;

const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector(sel) { return sel === ".main-grid.dashboard-page" ? mainGrid : null; },
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

// ── 用例 2：文案键集 zh/en 一致（无折叠条键）──
const zhKeys = Object.keys(t.copy.zh).sort();
const enKeys = Object.keys(t.copy.en).sort();
assertEqual(enKeys.join("|"), zhKeys.join("|"), "zh/en copy keys must match exactly");
assertEqual(zhKeys.includes("barTitle"), false, "bar keys removed (no collapsed bar)");
assertEqual(zhKeys.includes("collapse"), false, "collapse key removed (always fully expanded)");

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

// ── 用例 5：渲染判定（独立卡片挂 dashboard 主网格，与聊天区完全解耦）──
assertEqual(t.shouldRenderFor("report"), true, "empty main grid -> should render");
assertEqual(t.shouldRenderFor("chat"), true, "mode is ignored — same persistent card");
// 已有欢迎屏内容 → 保持当前态，不重复渲染
t.renderPanel("report", { offers: [], hasMemory: false });
assertEqual(t.shouldRenderFor("report"), false, "welcome already rendered -> no re-render");
assertTruthy(welcome.isRendered("report"), "panel should be present after render");

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

// ── 用例 11：notify("mode-switched") 只同步状态，不重渲染、不切换欢迎屏 ──
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.lastMode(), "chat", "mode-switched chat should record mode");
assertTruthy(welcome.isRendered("chat"), "persistent card stays rendered across mode switch (no re-render swap)");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should record mode");
assertTruthy(welcome.isRendered("report"), "card still present after switching back");

// ── 用例 12：notify("chat-sent") 常驻——发送消息只清提示条，面板保持完整展开 ──
t.showTipbar("tipReport");
assertEqual(t.tipActive(), true, "tip shown before send");
welcome.notify("chat-sent");
assertEqual(t.tipActive(), false, "chat-sent should clear tipbar");
assertTruthy(welcome.isRendered("report"), "chat-sent must NOT remove the panel (always fully expanded)");

// ── 用例 13：语言切换重渲染保持当前态 ──
assertTruthy(langObserverCallback, "lang observer should have registered during render smoke");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should set mode before lang observer fires");
langObserverCallback();
assertEqual(t.lastMode(), "report", "lang observer should re-render the persistent card, keeping _mode");
assertTruthy(welcome.isRendered("report"), "card remains after language re-render");

// ── 用例 14：拦截路径提示条也随手动输入消失（M2 修复）──
t.handleChipClick("chat", "根据记忆栏的报告，给我分析建议"); // 无记忆 → 拦截
assertEqual(t.tipActive(), true, "blocked chat example should show empty-memory tipbar");
assertEqual(t.tipFromExampleActive(), true, "blocked chat example should set tipFromExample so typing clears the tipbar");

// ── 用例 15：点击监听绑定在每次新建的 panel 上，不累积在主网格容器 ──
let containerListenerCalls = 0;
mainGrid.addEventListener = () => { containerListenerCalls++; };
t.renderSmoke();
t.renderSmoke();
assertEqual(containerListenerCalls, 0, "click listeners must bind to per-render welcome-panel, not the main-grid container");

// ── 用例 16：Chat Mode 聊天区顶部提醒卡片（常驻 sticky，提示先注入记忆栏）──
assertEqual(t.chatReminderActive(), false, "no reminder before entering Chat Mode");
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.chatReminderActive(), true, "Chat Mode should render the reminder card");
assertEqual(chatLogChat._reminderPresent(), true, "reminder card should live inside #chatLogChat");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.chatReminderActive(), false, "Report Mode should remove the reminder card");
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.chatReminderActive(), true, "re-entering Chat Mode should re-render the reminder card");
// 语言切换（lang observer）在 Chat Mode 下强制刷新文案，卡片保持存在
langObserverCallback();
assertEqual(t.chatReminderActive(), true, "lang switch keeps the reminder card in Chat Mode");

// ── 用例 17：流程状态机 flowStage（8 种布尔组合）──
assertEqual(t.flowStage({ hasReport: false, hasMemory: false, isChat: false }), "noReport", "all false -> noReport");
assertEqual(t.flowStage({ hasReport: true, hasMemory: false, isChat: false }), "reportReady", "report only -> reportReady");
assertEqual(t.flowStage({ hasReport: false, hasMemory: true, isChat: false }), "memoryReady", "memory only -> memoryReady");
assertEqual(t.flowStage({ hasReport: true, hasMemory: true, isChat: false }), "memoryReady", "report+memory -> memoryReady");
assertEqual(t.flowStage({ hasReport: false, hasMemory: false, isChat: true }), "noReport", "chat only -> noReport");
assertEqual(t.flowStage({ hasReport: true, hasMemory: false, isChat: true }), "reportReady", "chat+report -> reportReady");
assertEqual(t.flowStage({ hasReport: false, hasMemory: true, isChat: true }), "chatActive", "chat+memory -> chatActive");
assertEqual(t.flowStage({ hasReport: true, hasMemory: true, isChat: true }), "chatActive", "all true -> chatActive");
assertEqual(t.flowStage({ hasReport: true, hasPill: true, hasMemory: false, isChat: false }), "reportReady", "hasPill alone does not change stage");

// ── 用例 18：新增文案键存在（zh/en 键集一致性由用例 2 兜底）──
for (const key of ["progressStep1", "progressStep2", "progressStep3", "progressAdvanced", "minimizedTip", "goReport"]) {
  assertTruthy(t.copy.zh[key], `zh missing ${key}`);
  assertTruthy(t.copy.en[key], `en missing ${key}`);
}

console.log("PASS: welcome logic");
