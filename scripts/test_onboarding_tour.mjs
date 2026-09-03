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
function assertNotEqual(actual, expected, label) {
  if (actual === expected) throw new Error(`${label}: expected ${JSON.stringify(actual)} to differ from ${JSON.stringify(expected)}`);
}
function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
}

const elementStub = {
  nodeType: 1,
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, appendChild() {}, querySelectorAll() { return []; },
  querySelector() { return null; }, setAttribute() {}, removeAttribute() {},
  style: {}, getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};
// 已完成面板（含「加入对话」按钮）——第 3 步 add-to-chat 目标解析与推进序列命中用
const addToChatBtnStub = { ...elementStub };
const addToChatPanelStub = { ...elementStub, querySelector() { return addToChatBtnStub; } };
const minimizeBtnStub = { ...elementStub };
let assistantPanelRect = { left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 };
const assistantPanelStub = {
  ...elementStub,
  getBoundingClientRect() { return { ...assistantPanelRect }; }
};
// Chat Mode 切换按钮 stub（用例 15 重播切回 Report Mode 用）
const fastBtnStub = { ...elementStub };

// 可控查询：selectorMap 供 querySelector，queryAllMap 供 querySelectorAll，
// byIdMap 供 getElementById（动态 target 测试用）
const selectorMap = {
  "#chatInput": elementStub,
  ".deep-window": elementStub,
  '[data-mode="fast"]': elementStub,
  "#chatMemoryBar": elementStub,
  ".deep-window-minimize": minimizeBtnStub,
  "#chatModeToggle": elementStub,
  ".welcome-float-dot": elementStub,
  ".welcome-float": assistantPanelStub
};
const replayButtonClasses = new Set();
const replayButtonStub = {
  ...elementStub,
  classList: {
    add(name) { replayButtonClasses.add(name); },
    remove(name) { replayButtonClasses.delete(name); },
    contains(name) { return replayButtonClasses.has(name); }
  }
};
const queryAllMap = {};
const byIdMap = {};
const mutationObservers = [];
class TestMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.target = null;
    mutationObservers.push(this);
  }
  observe(target) { this.target = target; }
  disconnect() {}
}
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true, innerWidth: 1920, innerHeight: 1080 },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) {
      if (id === "reportHelpTourBtn") return replayButtonStub;
      return byIdMap[id] || null;
    },
    querySelector(sel) { return selectorMap[sel] || null; },
    querySelectorAll(sel) { return queryAllMap[sel] || []; },
    createElement() { return { ...elementStub, innerHTML: "" }; },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete",
    addEventListener() {}, removeEventListener() {}
  },
  ResizeObserver: class { observe() {} disconnect() {} },
  MutationObserver: TestMutationObserver
};
sandbox.window.document = sandbox.document;
let assistantPrepareCalls = 0;
let assistantEndCalls = 0;
const assistantDragEnabledCalls = [];
sandbox.window.CHATBOT_WELCOME = {
  prepareForTour() { assistantPrepareCalls++; },
  endTour() { assistantEndCalls++; },
  setTourDragEnabled(enabled) { assistantDragEnabledCalls.push(!!enabled); }
};

function emitBodyClassMutation(target) {
  for (const observer of mutationObservers) {
    if (observer.target === sandbox.document.body) observer.callback([{ target }]);
  }
}

runScript("public/onboarding_tour.js", sandbox);
const tour = sandbox.window.ONBOARDING_TOUR;
assertTruthy(tour, "onboarding_tour should expose window.ONBOARDING_TOUR");
const t = tour._test;

// ── 用例 1：步骤结构完整性（5 步主路径）──
assertEqual(t.stepCount(), 5, "should have exactly 5 steps");
const ids = t.steps.map((s) => s.id);
assertEqual(new Set(ids).size, ids.length, "step ids must be unique");
assertEqual(ids.join("|"), "intro|report-ask|deep-window|add-to-chat|chat-ask", "step ids order");
for (const s of t.steps) {
  assertTruthy(s.target, `step ${s.id} target must be a selector or function`);
  assertTruthy(s.copyKey, `step ${s.id} copyKey must be set`);
  assertEqual(["block", "pass"].includes(s.mask), true, `step ${s.id} mask must be block|pass`);
}
assertEqual(t.steps[0].id, "intro", "step0 should be the layout intro");
assertEqual(t.steps[0].target, ".welcome-float-dot", "intro should first highlight the assistant icon");
assertEqual(t.steps[0].autoNext, "assistant-opened", "opening the assistant panel should advance intro");
assertEqual(t.steps[1].target[0], "#chatbotModernRoot [data-chatbot-report-input]", "report-ask should prefer the Modern input");
assertEqual(t.steps[1].autoFillFocus[1], '#chatForm button[type="submit"]', "report-ask should keep the Legacy send fallback after autofill");
assertEqual(t.steps[1].autoNext, "sent", "report-ask should autoNext on sent");
assertEqual(t.steps[2].id, "deep-window", "step2 should wait for report");
assertEqual(typeof t.steps[2].target, "function", "deep-window target should be a dynamic function");
assertEqual(t.steps[3].id, "add-to-chat", "step3 should be add-to-chat");
assertEqual(t.steps[3].autoNext, undefined, "add-to-chat should wait for the guided memory reveal");
assertEqual(t.steps[3].focusOn, "chat-add", "add-to-chat should react to chat-add as a focus transition");
assertEqual(t.steps[3].autoNextFocus, ".deep-window-minimize", "chat-add should focus the minimize button");
assertEqual(t.steps[3].nextPhaseOn, "panel-minimized", "add-to-chat should reveal memory after minimization");
assertEqual(typeof t.steps[3].target, "function", "add-to-chat target should be a dynamic function");
assertEqual(t.steps[4].id, "chat-ask", "step4 should be chat-ask");
assertEqual(t.steps[4].target[0], "#chatbotModernRoot [data-chatbot-input]", "chat-ask should prefer the Modern input");
assertEqual(t.steps[4].autoFillFocus[1], '#chatForm button[type="submit"]', "chat-ask should keep the Legacy send fallback after autofill");
assertEqual(t.steps[4].autoNext, "sent", "chat-ask should autoNext on sent");
assertEqual(t.steps[4].final, true, "chat-ask should be final");
assertEqual(t.steps.filter((s) => s.autoNext).length, 3, "3 steps should have autoNext (assistant-opened/sent/sent)");
assertEqual(t.steps.filter((s) => s.final).length, 1, "only chat-ask should be final");
assertEqual(t.steps[3].autoFill, undefined, "add-to-chat should not have autoFill");
assertTruthy(t.copy.zh.step3MinimizeBody, "zh should explain minimizing the Deep Window");
assertTruthy(t.copy.en.step3MinimizeBody, "en should explain minimizing the Deep Window");
assertTruthy(t.copy.zh.step3MemoryBody, "zh should explain the memory card");
assertTruthy(t.copy.en.step3MemoryBody, "en should explain the memory card");
assertTruthy(t.copy.zh.step2MoveBody, "zh should explain moving the assistant panel");
assertTruthy(t.copy.en.step2MoveBody, "en should explain moving the assistant panel");
assertTruthy(t.copy.zh.step2MoveHint, "zh should prompt moving the assistant panel");
assertTruthy(t.copy.en.step2MoveHint, "en should prompt moving the assistant panel");

// ── 用例 2：i18n 键集一致 ──
const zhKeys = Object.keys(t.copy.zh).sort();
const enKeys = Object.keys(t.copy.en).sort();
assertEqual(zhKeys.join("|"), enKeys.join("|"), "zh/en copy keys must match exactly");
for (const s of t.steps) {
  assertTruthy(t.copy.zh[s.copyKey + "Title"] !== undefined, `zh missing ${s.copyKey}Title`);
  assertTruthy(t.copy.zh[s.copyKey + "Body"] !== undefined, `zh missing ${s.copyKey}Body`);
  assertTruthy(t.copy.en[s.copyKey + "Title"] !== undefined, `en missing ${s.copyKey}Title`);
  assertTruthy(t.copy.en[s.copyKey + "Body"] !== undefined, `en missing ${s.copyKey}Body`);
}
assertTruthy(t.copy.zh.step3NextHint, "zh missing step3NextHint");
assertTruthy(t.copy.en.step3NextHint, "en missing step3NextHint");
assertTruthy(t.copy.zh.step4NextHint, "zh missing step4NextHint");
assertTruthy(t.copy.en.step4NextHint, "en missing step4NextHint");
assertTruthy(t.copy.zh.introNextHint, "zh missing introNextHint");
assertTruthy(t.copy.en.introNextHint, "en missing introNextHint");
assertEqual(t.currentLanguage(), "zh", "documentElement lang zh-Hans should resolve to zh");
assertEqual(t.replayButtonPulseDuration(), 2000, "replay button attention pulse should last 2 seconds");

// ── 用例 3：完成状态（localStorage 可注入）──
const memStorage = {
  setItem(k, v) { this[k] = v; },
  removeItem(k) { delete this[k]; },
  getItem(k) { return this[k] || null; }
};
assertEqual(tour.shouldShowTour({ getItem: () => null }), true, "no marker should show tour");
assertEqual(tour.shouldShowTour({ getItem: () => "1" }), false, "done marker should hide tour");
tour.markCompleted(memStorage);
assertEqual(memStorage["oi_onboarding_done"], "1", "markCompleted should write oi_onboarding_done");
assertEqual(tour.shouldShowTour({ getItem: (k) => memStorage[k] || null }), false, "after markCompleted shouldShowTour false");
tour.resetCompleted(memStorage);
assertEqual(memStorage["oi_onboarding_done"], undefined, "resetCompleted should remove marker");

// ── 用例 4：引导启动先准备助手面板，点击助手图标后进入 Report 步骤 ──
const prepareCallsBeforeStart = assistantPrepareCalls;
const endCallsBeforeStart = assistantEndCalls;
tour.startTour();
assertEqual(assistantPrepareCalls, prepareCallsBeforeStart + 1, "startTour should prepare the assistant panel");
assertEqual(t.currentStepIndex(), 0, "assistant opening step should start at index 0");
tour.notify("assistant-opened");
assertEqual(t.currentStepIndex(), 1, "assistant-opened should advance to Report step");
tour.stopTour();
assertEqual(assistantEndCalls, endCallsBeforeStart + 1, "stopTour should release the assistant panel tour state");

// ── 用例 4b：第二步先引导移开助手面板，高光随拖拽位置更新，完成后才能继续 ──
tour.startTour();
tour.advance(); // Report 问题
tour.notify("sent"); // 进入等待报告/移开面板阶段
assertEqual(t.currentStepIndex(), 2, "Report send should enter the Deep Window step");
assertEqual(t.phase(), "move-assistant", "Deep Window step should first guide moving the assistant panel");
assertEqual(assistantDragEnabledCalls.at(-1), true, "Deep Window step should enable assistant panel dragging");
const highlightBeforeDrag = t.highlightPosition();
assistantPanelRect = { left: 420, top: 180, right: 620, bottom: 380, width: 200, height: 200 };
tour.notify("assistant-panel-drag");
const highlightAfterDrag = t.highlightPosition();
assertNotEqual(highlightAfterDrag.left, highlightBeforeDrag.left, "highlight should follow assistant panel while dragging");
assertNotEqual(highlightAfterDrag.top, highlightBeforeDrag.top, "highlight top should follow assistant panel while dragging");
tour.advance();
assertEqual(t.currentStepIndex(), 2, "Deep Window step should not advance before panel is moved");
tour.notify("assistant-panel-drag-end");
assertEqual(t.phase(), "await-report", "panel move should switch Deep Window step to report waiting");
assertEqual(assistantDragEnabledCalls.at(-1), false, "assistant panel dragging should disable after the move");
tour.advance();
assertEqual(t.currentStepIndex(), 3, "Deep Window step should advance after panel move is complete");
tour.stopTour();

// ── 用例 4：推进 / 回退 / 边界 ──
queryAllMap[".deep-window"] = [addToChatPanelStub]; // 第 3 步 add-to-chat 目标命中（推进序列经过）
tour.startTour();
assertEqual(tour.isActive(), true, "startTour should activate");
assertEqual(t.currentStepIndex(), 0, "startTour should begin at step 0");
tour.goBack();
assertEqual(t.currentStepIndex(), 0, "goBack at first step should stay");
tour.advance();
assertEqual(t.currentStepIndex(), 1, "advance should move to step 1");
tour.advance();
tour.notify("assistant-panel-drag-end");
tour.advance();
assertEqual(t.currentStepIndex(), 3, "advance x3 should stop at guided add-to-chat");
tour.notify("chat-add");
tour.notify("panel-minimized");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "Next after memory reveal should reach chat-ask");
tour.goBack();
assertEqual(t.currentStepIndex(), 3, "goBack should return to add-to-chat");
assertEqual(t.phase(), "await-add", "going back should reset add-to-chat phase");
tour.notify("chat-add");
tour.notify("panel-minimized");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "advance should return to chat-ask");
assertEqual(t.isFinalStep(4), true, "index 4 should be final");
assertEqual(t.isFinalStep(3), false, "index 3 should not be final");
tour.stopTour(); // 用例 6 以 startTour() 独立开始，需先结束本用例的 tour
delete queryAllMap[".deep-window"];

// ── 用例 5：autoNext 判定 ──
assertEqual(t.isAutoNextStep(0, "sent"), false, "intro should not autoNext on sent");
assertEqual(t.isAutoNextStep(1, "sent"), true, "report-ask should autoNext on sent");
assertEqual(t.isAutoNextStep(1, "other"), false, "report-ask should not autoNext on other events");
assertEqual(t.isAutoNextStep(3, "chat-add"), false, "add-to-chat should not autoNext on chat-add");
assertEqual(t.isAutoNextStep(3, "memory-added"), false, "add-to-chat should not autoNext on memory-added");
assertEqual(t.isAutoNextStep(4, "sent"), true, "chat-ask should autoNext on sent");

// ── 用例 6：notify 推进 + 完成 ──
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2 -> deep-window
tour.notify("assistant-panel-drag-end");
tour.advance(); // 3 -> add-to-chat
assertEqual(t.currentStepIndex(), 3, "advance should reach add-to-chat");
tour.notify("chat-add");
assertEqual(t.currentStepIndex(), 3, "notify chat-add should keep the guided step active");
assertEqual(t.phase(), "await-minimize", "notify chat-add should enter await-minimize");
tour.notify("panel-minimized");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "Next after panel-minimized should enter chat-ask");
tour.notify("sent");
assertEqual(tour.isActive(), false, "notify sent on final step should finish tour");
assertEqual(tour.shouldShowTour({ getItem: () => "1" }), false, "finished tour should stay hidden");

// ── 用例 7：skip ──
tour.startTour();
tour.skipTour();
assertEqual(tour.isActive(), false, "skipTour should deactivate");

// ── 用例 8：测试模式不自动弹 ──
tour.maybeAutoStart();
assertEqual(tour.isActive(), false, "maybeAutoStart should no-op in test mode");

// ── 用例 9：目标动态解析 ──
// 9a：deep-window 步等报告完成——无面板 → null 继续轮询；
//     有面板 → 取最后一个（最新创建）的已完成面板（旧面板仍在页面的重播场景）
assertEqual(t.resolveTarget(t.steps[2]), null, "no finished deep-window → keep polling");
const oldPanelStub = { ...elementStub, nodeType: 1 };
const newPanelStub = { ...elementStub, nodeType: 1, querySelector() { return null; } };
queryAllMap[".deep-window:not(.generating)"] = [oldPanelStub, newPanelStub];
assertEqual(t.resolveTarget(t.steps[2]), newPanelStub, "should pick the LAST finished deep-window (newest panel)");
assertEqual(t.resolveTarget(t.steps[2]) !== oldPanelStub, true, "must not highlight an old panel behind the new one");

// 9b：add-to-chat 步取最后一个面板的「加入对话」按钮（重播场景同样取最新面板）
queryAllMap[".deep-window"] = [addToChatPanelStub];
assertEqual(t.resolveTarget(t.steps[3]), addToChatBtnStub, "add-to-chat should target the LAST panel's chat-add button");
delete queryAllMap[".deep-window"];
delete queryAllMap[".deep-window:not(.generating)"];

// ── 用例 10：自动推进事件 ──
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2
tour.notify("assistant-panel-drag-end");
tour.advance(); // 3
assertEqual(t.currentStepIndex(), 3, "advance should reach add-to-chat");
tour.notify("chat-add");
assertEqual(t.currentStepIndex(), 3, "chat-add should not reach chat-ask directly");
tour.notify("panel-minimized");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "manual Next should reach chat-ask");
tour.notify("sent");
assertEqual(tour.isActive(), false, "final sent should finish tour");

// ── 用例 11：语言跟随——页面切换语言后重渲染气泡使用新语言 ──
// currentLanguage 优先 localStorage（sandbox 恒返回 null）→ 兜底 documentElement.lang
tour.startTour();
assertMatch(t.popoverHtml(), /第 1 步/, "popover should render zh copy initially");
assertMatch(t.popoverHtml(), /先认识整体布局/, "intro step should show layout copy in zh");
sandbox.document.documentElement.lang = "en";
t.renderStep(); // 引擎在 MutationObserver 回调中调用同一函数
assertMatch(t.popoverHtml(), /Step 1 of 5/, "popover should re-render with en copy after lang change");
assertMatch(t.popoverHtml(), /Here's the layout/, "intro step should show layout copy in en");
sandbox.document.documentElement.lang = "zh-Hans";
t.renderStep();
assertMatch(t.popoverHtml(), /第 1 步/, "popover should re-render back to zh copy");
tour.stopTour();

// ── 用例 12：autoNext 步骤渲染置灰动作提示按钮（防误点跳过）──
queryAllMap[".deep-window:not(.generating)"] = [{ ...elementStub, nodeType: 1 }];
tour.startTour();
tour.advance(); // 1
tour.advance(); // 2
assertEqual(t.currentStepIndex(), 2, "advance should reach deep-window");
assertMatch(t.popoverHtml(), /移开助手面板/, "deep-window should first explain moving the assistant panel");
assertEqual(t.popoverHtml().indexOf('data-tour-action="next"'), -1, "panel move phase should not render Next");
tour.notify("assistant-panel-drag-end");
assertMatch(t.popoverHtml(), /data-tour-action="next"/, "deep-window should render Next after the panel is moved");
queryAllMap[".deep-window"] = [{ ...elementStub, querySelector() { return { ...elementStub }; } }];
tour.advance(); // 3 -> add-to-chat（target 函数依赖 queryAllMap[.deep-window]，推进前必须先建映射）
assertMatch(t.popoverHtml(), /onboarding-btn-hint/, "add-to-chat should render disabled hint");
assertMatch(t.popoverHtml(), /点击「加入对话」按钮继续/, "hint should show zh action hint");
assertMatch(t.popoverHtml(), /disabled/, "hint should be disabled");
assertEqual(t.popoverHtml().indexOf('data-tour-action="next"'), -1, "await-add phase should not render Next");
tour.notify("chat-add");
assertMatch(t.popoverHtml(), /最小化/, "await-minimize phase should explain minimizing the window");
assertEqual(t.popoverHtml().indexOf('data-tour-action="next"'), -1, "await-minimize phase should not render Next");
tour.notify("panel-minimized");
assertMatch(t.popoverHtml(), /记忆卡片/, "memory-revealed phase should explain the memory card");
assertMatch(t.popoverHtml(), /data-tour-action="next"/, "memory-revealed phase should render Next");
tour.stopTour();
delete queryAllMap[".deep-window"];
delete queryAllMap[".deep-window:not(.generating)"];

// ── 用例 14：填入示例按语言切换（英文版最后一步填入英文示例）──
assertEqual(t.steps[4].autoFillEn, "Based on the report, give me some analysis suggestions", "chat-ask should define autoFillEn");
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2
tour.notify("assistant-panel-drag-end");
tour.advance(); // 3
tour.advance(); // blocked at add-to-chat until the guided phases complete
tour.notify("chat-add");
tour.notify("panel-minimized");
tour.advance(); // 4
assertEqual(t.currentStepIndex(), 4, "advance should reach final chat-ask");
assertEqual(t.autoFillFor(t.steps[4]), "根据刚才的报告，给我分析建议", "zh mode should fill zh example");
sandbox.document.documentElement.lang = "en";
assertEqual(t.autoFillFor(t.steps[4]), "Based on the report, give me some analysis suggestions", "en mode should fill en example");
sandbox.document.documentElement.lang = "zh-Hans";
tour.stopTour();

// ── 用例 15：重播时若当前处于 Chat Mode，startTour 自动切回 Report Mode ──
let deepClicked = 0;
const fastActiveStub = { ...elementStub, classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } } };
const deepBtnStub = { ...elementStub, click() { deepClicked++; } };
selectorMap['[data-mode="fast"]'] = fastActiveStub; // Chat Mode：fast 按钮 active
selectorMap['[data-mode="deep"]'] = deepBtnStub;
tour.startTour();
assertEqual(deepClicked, 1, "startTour in Chat Mode should auto-click the Report Mode (deep) button");
tour.stopTour();
selectorMap['[data-mode="fast"]'] = fastBtnStub;     // Report Mode：fast 无 active
deepClicked = 0;
tour.startTour();
assertEqual(deepClicked, 0, "startTour in Report Mode should not click the deep button");
tour.stopTour();
delete selectorMap['[data-mode="deep"]'];

// ── 用例 16：旧面板最小化不能提前揭示最新报告的记忆栏 ──
function observerPanel(isMinimized) {
  return {
    ...addToChatPanelStub,
    matches(sel) { return sel === ".deep-window"; },
    classList: {
      add() {}, remove() {}, toggle() {},
      contains(name) { return name === "minimized" && isMinimized(); }
    },
    querySelector(sel) {
      if (sel === ".deep-window-chat-add") return addToChatBtnStub;
      if (sel === ".deep-window-minimize") return minimizeBtnStub;
      return null;
    }
  };
}
let oldPanelMinimized = false;
let latestPanelMinimized = false;
const observerOldPanel = observerPanel(() => oldPanelMinimized);
const observerLatestPanel = observerPanel(() => latestPanelMinimized);
queryAllMap[".deep-window"] = [observerOldPanel, observerLatestPanel];
tour.startTour();
tour.advance();
tour.notify("sent");
tour.notify("assistant-panel-drag-end");
tour.advance();
assertEqual(t.currentStepIndex(), 3, "observer test should start on add-to-chat");
tour.notify("chat-add");
oldPanelMinimized = true;
emitBodyClassMutation(observerOldPanel);
assertEqual(t.phase(), "await-minimize", "old panel minimize must not reveal memory");
latestPanelMinimized = true;
emitBodyClassMutation(observerLatestPanel);
assertEqual(t.phase(), "memory-revealed", "latest panel minimize should reveal memory");
tour.stopTour();
delete queryAllMap[".deep-window"];

// ── 用例 17：页面就绪时新手引导按钮进入明显提示态，并在 2 秒后恢复 ──
t.pulseReplayButton();
assertEqual(replayButtonClasses.has("onboarding-tour-btn-attention"), true, "pulse should add attention class");
await new Promise((resolve) => setTimeout(resolve, 2050));
assertEqual(replayButtonClasses.has("onboarding-tour-btn-attention"), false, "pulse should remove attention class after 2 seconds");

console.log("PASS: onboarding tour logic");
