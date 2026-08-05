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

const elementStub = {
  nodeType: 1,
  addEventListener() {}, dataset: {},
  appendChild() {}, removeChild() {}, insertBefore() {},
  querySelectorAll() { return []; }, querySelector() { return null; },
  setAttribute() {}, removeAttribute() {}, style: {}, innerHTML: "", value: "",
  getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};

// 可写 localStorage stub
const store = {};
const localStorageStub = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
  setItem(key, value) { store[key] = String(value); },
  removeItem(key) { delete store[key]; }
};

// 真实 classList stub（className 同步维护，供 collapsed/tour-hidden 断言）
function makeElement(className) {
  const el = { ...elementStub, className: className || "", children: [], parentNode: null };
  const set = new Set();
  el.classList = {
    add(cls) { set.add(cls); el.className = [...set].join(" "); },
    remove(cls) { set.delete(cls); el.className = [...set].join(" "); },
    toggle(cls, force) {
      const on = force === undefined ? !set.has(cls) : !!force;
      if (on) set.add(cls); else set.delete(cls);
      el.className = [...set].join(" ");
      return on;
    },
    contains(cls) { return set.has(cls); }
  };
  return el;
}

// dashboard 主网格 stub（欢迎气泡挂载点：containerFor 查询 .main-grid.dashboard-page）
function makeGrid() {
  let wrapper = null;
  const panelProbe = makeElement("welcome-panel");
  const grid = {
    ...elementStub,
    querySelector(sel) {
      if (sel === ".welcome-float") return wrapper;
      if (sel === ".welcome-panel") return wrapper ? panelProbe : null;
      if (sel === ".welcome-float-dot") return wrapper ? makeElement("welcome-float-dot") : null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === ".welcome-float") return wrapper ? [wrapper] : [];
      if (sel === ".welcome-panel") return wrapper ? [panelProbe] : [];
      return [];
    },
    appendChild(child) { wrapper = child; child.parentNode = grid; return null; },
    insertBefore(child) { wrapper = child; child.parentNode = grid; return null; },
    removeChild(child) { if (child === wrapper) wrapper = null; return null; },
    // 拖拽 clamp 用：主网格 = 整个 dashboard 页（1200×800），供页面任意位置拖拽测试
    getBoundingClientRect() { return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }; },
    _welcomePresent() { return !!wrapper; }
  };
  return grid;
}
const grid = makeGrid();
// #chatPanel fallback stub（containerFor 兜底路径，正常测试不触发）
const chatPanel = {
  ...elementStub,
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
};
const byIdMap = { chatPanel };

// 可控制 Chat Mode 提醒卡片存在性的 #chatLogChat stub
function makeChatLogChat() {
  let hasReminder = false;
  let reminderCard = null;
  const log = {
    ...elementStub,
    firstChild: null,
    querySelector(sel) { return sel === ".chat-reminder" ? (reminderCard || null) : null; },
    querySelectorAll(sel) {
      return sel === ".chat-reminder" ? (reminderCard ? [reminderCard] : []) : [];
    },
    insertBefore(card) { card.parentNode = log; reminderCard = card; hasReminder = true; return null; },
    removeChild(child) { if (child === reminderCard) { reminderCard = null; hasReminder = false; } return null; },
    _reminderPresent() { return hasReminder; }
  };
  return log;
}
const chatLogChat = makeChatLogChat();
byIdMap["chatLogChat"] = chatLogChat;

let tourMaskEls = [];
let observerCallbacks = [];

const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: localStorageStub,
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector(sel) { return sel === ".main-grid.dashboard-page" ? grid : null; },
    querySelectorAll(sel) {
      if (sel === ".onboarding-mask-piece, .onboarding-popover") return tourMaskEls;
      return [];
    },
    createElement() { return makeElement(""); },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete",
    addEventListener() {}, removeEventListener() {}
  },
  MutationObserver: class { constructor(cb) { observerCallbacks.push(cb); } observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

// 流程引导测试：.deep-window.minimized 查询映射 + 事件派发记录 + CustomEvent
let minimizedPanels = [];
let dispatchedEvents = [];
const documentWithFlow = {
  ...sandbox.document,
  querySelectorAll(sel) {
    if (sel === ".deep-window.minimized") return minimizedPanels;
    if (sel === ".onboarding-mask-piece, .onboarding-popover") return tourMaskEls;
    return [];
  },
  dispatchEvent(evt) { dispatchedEvents.push(evt && evt.type); return true; }
};
sandbox.document = documentWithFlow;
sandbox.window.document = documentWithFlow;
sandbox.CustomEvent = class { constructor(type) { this.type = type; } };

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

// ── 用例 2：文案键集 zh/en 一致（新增气泡键）──
const zhKeys = Object.keys(t.copy.zh).sort();
const enKeys = Object.keys(t.copy.en).sort();
assertEqual(enKeys.join("|"), zhKeys.join("|"), "zh/en copy keys must match exactly");
assertEqual(zhKeys.includes("barTitle"), false, "bar keys removed (no collapsed bar)");
assertEqual(zhKeys.includes("collapse"), true, "collapse key added for bubble collapse button");
assertEqual(zhKeys.includes("newBadge"), true, "newBadge key added for new-user emphasis");
assertEqual(zhKeys.includes("showGuide"), true, "showGuide key added for collapsed dot label");

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

// ── 用例 5：渲染判定（气泡挂 #chatPanel）──
assertEqual(t.shouldRenderFor("report"), true, "empty chat panel -> should render");
assertEqual(t.shouldRenderFor("chat"), true, "mode is ignored — same persistent bubble");
t.renderPanel("report", { offers: [], hasMemory: false });
assertEqual(t.shouldRenderFor("report"), false, "bubble already rendered -> no re-render");
assertTruthy(welcome.isRendered("report"), "bubble should be present after render");

// ── 用例 6：示例交互决策 ──
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

// ── 用例 11：notify("mode-switched") 只同步状态，不重渲染、不切换气泡 ──
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.lastMode(), "chat", "mode-switched chat should record mode");
assertTruthy(welcome.isRendered("chat"), "bubble stays rendered across mode switch (no re-render swap)");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should record mode");
assertTruthy(welcome.isRendered("report"), "bubble still present after switching back");

// ── 用例 12：notify("chat-sent") 首次发送自动收起 ──
t.showTipbar("tipReport");
assertEqual(t.tipActive(), true, "tip shown before send");
welcome.notify("chat-sent");
assertEqual(t.tipActive(), false, "chat-sent should clear tipbar");
assertTruthy(welcome.isRendered("report"), "chat-sent keeps the bubble mounted");
assertTruthy(t.isCollapsed(), "first chat-sent auto-collapses the bubble");
const wrapAfterSend = grid.querySelector(".welcome-float");
assertTruthy(wrapAfterSend && wrapAfterSend.classList.contains("collapsed"), "wrapper should carry collapsed class");
assertEqual(store["oi_welcome_collapsed"], "1", "first chat-sent persists collapse");

// ── 用例 13：语言切换重渲染保持当前态 ──
function fireLangObserver() { if (observerCallbacks[0]) observerCallbacks[0](); }
assertTruthy(observerCallbacks.length >= 1, "lang observer should have registered during render");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should set mode before lang observer fires");
fireLangObserver();
assertEqual(t.lastMode(), "report", "lang observer should re-render the bubble, keeping _mode");
assertTruthy(welcome.isRendered("report"), "bubble remains after language re-render");

// ── 用例 14：拦截路径提示条也随手动输入消失（M2 修复）──
t.handleChipClick("chat", "根据记忆栏的报告，给我分析建议"); // 无记忆 → 拦截
assertEqual(t.tipActive(), true, "blocked chat example should show empty-memory tipbar");
assertEqual(t.tipFromExampleActive(), true, "blocked chat example should set tipFromExample so typing clears the tipbar");

// ── 用例 15：点击监听绑定在每次新建的 panel 上，不累积在挂载容器（主网格）──
let containerListenerCalls = 0;
grid.addEventListener = () => { containerListenerCalls++; };
t.renderSmoke();
t.renderSmoke();
assertEqual(containerListenerCalls, 0, "click listeners must bind to per-render elements, not the chat panel container");

// ── 用例 16：Chat Mode 聊天区顶部提醒卡片（常驻 sticky，提示先注入记忆栏）──
assertEqual(t.chatReminderActive(), false, "no reminder before entering Chat Mode");
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.chatReminderActive(), true, "Chat Mode should render the reminder card");
assertEqual(chatLogChat._reminderPresent(), true, "reminder card should live inside #chatLogChat");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.chatReminderActive(), false, "Report Mode should remove the reminder card");
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.chatReminderActive(), true, "re-entering Chat Mode should re-render the reminder card");
fireLangObserver();
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
for (const key of ["progressStep1", "progressStep2", "progressStep3", "progressAdvanced", "minimizedTip", "goReport", "newBadge", "collapse", "showGuide"]) {
  assertTruthy(t.copy.zh[key], `zh missing ${key}`);
  assertTruthy(t.copy.en[key], `en missing ${key}`);
}

// ── 用例 19：进度条渲染（progressHtml 纯函数）──
assertMatch(t.progressHtml({ hasReport: false, hasMemory: false, isChat: false }), /data-stage="noReport"/, "noReport progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: false, isChat: false }), /data-stage="reportReady"/, "reportReady progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: true, isChat: false }), /data-stage="memoryReady"/, "memoryReady progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: true, isChat: true }), /data-stage="chatActive"/, "chatActive progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: true, isChat: true }), /welcome-progress-step done/, "chatActive renders done steps");

// ── 用例 20：notify 状态事件 ──
welcome.notify("panel-minimized", {});
assertEqual(t.flowState().hasPill, true, "panel-minimized sets hasPill");
minimizedPanels = [];
welcome.notify("panel-expanded", {});
assertEqual(t.flowState().hasPill, false, "panel-expanded recomputes hasPill false when no minimized panels");
minimizedPanels = [{ className: "deep-window minimized" }];
welcome.notify("panel-expanded", {});
assertEqual(t.flowState().hasPill, true, "panel-expanded recomputes hasPill true when a minimized panel exists");
minimizedPanels = [];

// ── 用例 21：notify("chat-add") ──
welcome.notify("chat-add", { hasMemory: true });
assertEqual(t.flowState().hasReport, true, "chat-add sets hasReport");
assertEqual(t.flowState().hasMemory, true, "chat-add sets hasMemory");

// ── 用例 22：提醒卡片包含「去生成报告」按钮，点击 dispatch chatbot-go-report 并填入示例 ──
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertMatch(t.chatReminderHtml(), /chat-reminder-action/, "reminder card should include go-report action");
byIdMap["chatInput"] = { ...elementStub, value: "" };
dispatchedEvents = [];
t.triggerGoReport();
assertEqual(dispatchedEvents.includes("chatbot-go-report"), true, "goReport should dispatch chatbot-go-report");
assertEqual(byIdMap["chatInput"].value, "Shokz", "goReport should fill the first report example (fallback Shokz)");

// ── 用例 23：fillInput 公共 API ──
assertEqual(welcome.fillInput("Tier 2"), true, "fillInput should return true when input exists");
assertEqual(byIdMap["chatInput"].value, "Tier 2", "fillInput should set input value");

// ── 用例 24：示例提问跟随中英文模式（textEn 字段 + resolveExampleText 按语言选择）──
for (const ex of [...t.examples.report, ...t.examples.chat]) {
  assertTruthy(ex.textEn, `example missing textEn: ${ex.text}`);
}
// zh 模式：返回原中文示例
assertEqual(t.resolveExampleText(t.examples.report[1], null), "Beauty 品类", "zh mode keeps zh example text");
// en 模式：返回英文示例
sandbox.document.documentElement.lang = "en";
assertEqual(t.resolveExampleText(t.examples.report[1], null), "Beauty category", "en mode should use textEn");
assertEqual(t.resolveExampleText(t.examples.chat[0], null), "Analyze the reports in memory and give me suggestions", "en chat example should use textEn");
assertEqual(t.resolveExampleText(t.examples.report[0], "Shokz"), "Shokz", "en dynamic merchant example still substitutes merchant");
sandbox.document.documentElement.lang = "zh-Hans";
assertEqual(t.resolveExampleText(t.examples.report[0], "Shokz"), "Shokz", "zh dynamic merchant example substitutes merchant");

// ── 用例 25：新老用户默认收起判定（纯函数）──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
assertEqual(t.defaultCollapsed(), false, "fresh user -> expanded by default");
store["oi_onboarding_done"] = "1";
assertEqual(t.defaultCollapsed(), true, "onboarding done -> collapsed by default");
delete store["oi_onboarding_done"];
assertEqual(t.defaultCollapsed(), false, "fresh user again -> expanded");
store["oi_welcome_collapsed"] = "1";
assertEqual(t.defaultCollapsed(), true, "explicit collapse wins even when onboarding not done");
store["oi_onboarding_done"] = "1";
assertEqual(t.defaultCollapsed(), true, "both markers -> collapsed");

// ── 用例 26：渲染默认态（新用户展开 + 强调 / 老用户收起）──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
let wrap = grid.querySelector(".welcome-float");
assertTruthy(wrap, "bubble wrapper should render");
assertEqual(wrap.classList.contains("collapsed"), false, "new user renders expanded");
assertMatch(t.panelElement().className, /welcome-emphasis/, "new user panel carries emphasis class");

store["oi_onboarding_done"] = "1";
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
wrap = grid.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("collapsed"), true, "returning user renders collapsed");
assertEqual(t.panelElement().className.includes("welcome-emphasis"), false, "returning user panel has no emphasis");

// ── 用例 27：收起/展开 + 持久化 ──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
t.setCollapsed(true, true);
wrap = grid.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("collapsed"), true, "setCollapsed(true) collapses wrapper");
assertEqual(store["oi_welcome_collapsed"], "1", "collapse with persist writes storage");
t.setCollapsed(false, false);
wrap = grid.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("collapsed"), false, "setCollapsed(false) expands wrapper");
assertEqual(store["oi_welcome_collapsed"], "1", "manual expand does NOT clear persisted collapse");
assertMatch(t.panelElement().className, /welcome-emphasis/, "re-expanded fresh-user panel gets emphasis back");

// ── 用例 28：chat-sent 自动收起只发生一次 ──
t.resetAutoCollapse();
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
welcome.notify("chat-sent");
assertTruthy(t.isCollapsed(), "first chat-sent collapses");
t.setCollapsed(false, false);
welcome.notify("chat-sent");
assertEqual(t.isCollapsed(), false, "second chat-sent does NOT re-collapse (first send only)");

// ── 用例 29：chat-add 自动收起只发生一次 ──
t.resetAutoCollapse();
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
welcome.notify("chat-add", { hasMemory: true });
assertTruthy(t.isCollapsed(), "first chat-add collapses");
t.setCollapsed(false, false);
welcome.notify("chat-add", { hasMemory: true });
assertEqual(t.isCollapsed(), false, "second chat-add does NOT re-collapse");

// ── 用例 30：Tour 激活时隐藏气泡 ──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
assertEqual(t.tourHidden(), false, "tour not active initially");
tourMaskEls = [{ className: "onboarding-mask-piece" }];
t.refreshTourHidden();
assertEqual(t.tourHidden(), true, "tour active -> hidden state true");
wrap = grid.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("tour-hidden"), true, "wrapper carries tour-hidden class");
tourMaskEls = [];
t.refreshTourHidden();
assertEqual(t.tourHidden(), false, "tour ended -> hidden state false");
assertEqual(wrap.classList.contains("tour-hidden"), false, "wrapper removes tour-hidden class");

// ── 用例 31：三步进度垂直渲染（去掉 → 箭头，每步文案完整可见）──
const progNoReport = t.progressHtml({ hasReport: false, hasMemory: false, isChat: false });
assertEqual(progNoReport.includes("welcome-progress-arrow"), false, "vertical progress removes arrow separators");
assertEqual(progNoReport.includes("① 在 Report 提问"), true, "step 1 label fully present (no ellipsis truncation)");
assertEqual(progNoReport.includes("② 点「加入对话」"), true, "step 2 label fully present");
assertEqual(progNoReport.includes("③ 在 Chat 对话"), true, "step 3 label fully present");
assertEqual(t.progressHtml({ hasReport: true, hasMemory: true, isChat: true }).includes("✓"), true, "chatActive renders done checkmarks");

// ── 用例 32：拖拽位置 clamp 纯函数 ──
assertEqual(JSON.stringify(t.clampDotPos(10, 10, 800, 600, 350, 300)), JSON.stringify({ left: 10, top: 10 }), "in-bounds position unchanged");
assertEqual(JSON.stringify(t.clampDotPos(-50, 20, 800, 600, 350, 300)), JSON.stringify({ left: 0, top: 20 }), "negative left clamps to 0");
assertEqual(JSON.stringify(t.clampDotPos(900, 700, 800, 600, 350, 300)), JSON.stringify({ left: 450, top: 300 }), "overflow clamps inside container");
assertEqual(JSON.stringify(t.clampDotPos(40.6, 10.4, 800, 600, 350, 300)), JSON.stringify({ left: 41, top: 10 }), "position rounds to integer px");

// ── 用例 33：渲染应用持久化位置（oi_welcome_dot_pos）──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
delete store["oi_welcome_dot_pos"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
wrap = grid.querySelector(".welcome-float");
assertEqual(wrap.style.left, undefined, "no persisted position -> no inline left");
assertEqual(wrap.style.top, undefined, "no persisted position -> no inline top");
store["oi_welcome_dot_pos"] = JSON.stringify({ left: 40, top: 30 });
t.renderPanel("report", { offers: [], hasMemory: false });
wrap = grid.querySelector(".welcome-float");
assertEqual(wrap.style.left, "40px", "persisted left applied on re-render");
assertEqual(wrap.style.top, "30px", "persisted top applied on re-render");

// ── 用例 34：圆钮拖拽（移动 → 不展开 + 持久化；未移动 → 展开）──
t.setCollapsed(true, true); // 收起为圆钮
t.dotPointerDown({ clientX: 100, clientY: 50, pointerId: 1 });
t.dotPointerMove({ clientX: 140, clientY: 60, pointerId: 1 }); // 位移 44px > 4px 阈值
t.dotPointerUp();
assertEqual(t.isCollapsed(), true, "drag beyond threshold does NOT expand");
const dragPos = JSON.parse(store["oi_welcome_dot_pos"]);
assertEqual(dragPos.left, 40, "dragged position persisted left (0 + 40, clamped)");
assertEqual(dragPos.top, 10, "dragged position persisted top (0 + 10)");
t.dotPointerDown({ clientX: 100, clientY: 50, pointerId: 2 });
t.dotPointerUp();
assertEqual(t.isCollapsed(), false, "pointer down+up without move expands the dot");

// ── 用例 35：helloBody 无用文案已移除 ──
assertEqual("helloBody" in t.copy.zh, false, "zh helloBody removed");
assertEqual("helloBody" in t.copy.en, false, "en helloBody removed");
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
delete store["oi_welcome_dot_pos"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
assertEqual(t.panelElement().innerHTML.includes("welcome-desc"), false, "panel no longer renders welcome-desc");
assertEqual(t.panelElement().innerHTML.includes("查商户"), false, "panel no longer renders useless hello body copy");

console.log("PASS: welcome logic");
