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

// 可控查询：selectorMap 供 querySelector，queryAllMap 供 querySelectorAll，
// byIdMap 供 getElementById（动态 target 测试用）
const selectorMap = {
  "#chatInput": elementStub,
  ".deep-window": elementStub,
  '[data-mode="fast"]': elementStub,
  "#chatMemoryBar": elementStub,
  "#chatModeToggle": elementStub
};
const queryAllMap = {};
const byIdMap = {};
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true, innerWidth: 1920, innerHeight: 1080 },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector(sel) { return selectorMap[sel] || null; },
    querySelectorAll(sel) { return queryAllMap[sel] || []; },
    createElement() { return { ...elementStub, innerHTML: "" }; },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete",
    addEventListener() {}, removeEventListener() {}
  },
  ResizeObserver: class { observe() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

runScript("public/onboarding_tour.js", sandbox);
const tour = sandbox.window.ONBOARDING_TOUR;
assertTruthy(tour, "onboarding_tour should expose window.ONBOARDING_TOUR");
const t = tour._test;

// ── 用例 1：步骤结构完整性 ──
assertEqual(t.stepCount(), 7, "should have exactly 7 steps");
const ids = t.steps.map((s) => s.id);
assertEqual(new Set(ids).size, ids.length, "step ids must be unique");
assertEqual(ids.join("|"), "intro|report-ask|deep-window|minimize-window|switch-chat|drag-memory|chat-ask", "step ids order");
for (const s of t.steps) {
  assertTruthy(s.target, `step ${s.id} target must be a selector or function`);
  assertTruthy(s.copyKey, `step ${s.id} copyKey must be set`);
  assertEqual(["block", "pass"].includes(s.mask), true, `step ${s.id} mask must be block|pass`);
}
assertEqual(t.steps[0].id, "intro", "step0 should be the layout intro");
assertEqual(t.steps[0].autoNext, undefined, "intro step should have no autoNext (manual next)");
assertEqual(t.steps[1].autoFillFocus, '#chatForm button[type="submit"]', "report-ask should focus send button after autofill");
assertEqual(t.steps[1].autoNext, "sent", "report-ask should autoNext on sent");
// Step3（最小化）：不自动推进（手动「下一步」），点击最小化仅触发高光转移展示药丸效果
assertEqual(t.steps[3].autoNext, undefined, "minimize step should NOT autoNext (manual next)");
assertEqual(t.steps[3].focusOn, "minimized", "minimize step should focus pill on minimized event");
assertEqual(t.steps[3].autoNextFocus, ".deep-window.minimized", "minimize step should focus pill after minimize");
assertEqual(t.steps[4].autoNext, "switched", "switch-chat should autoNext on switched");
assertEqual(t.steps[6].autoFillFocus, '#chatForm button[type="submit"]', "chat-ask should focus send button after autofill");
assertEqual(t.steps[6].autoNext, "sent", "chat-ask should autoNext on sent (auto-finish)");
assertEqual(typeof t.steps[2].target, "function", "deep-window target should be a dynamic function (wait for report done)");
assertEqual(t.steps[5].autoNext, "memory-added", "drag-memory step should autoNext on memory-added");
assertEqual(t.steps.filter((s) => s.autoNext).length, 4, "4 steps should have autoNext (sent/switched/memory-added/sent)");
assertEqual(t.steps[6].final, true, "chat-ask step should be final");
assertEqual(t.steps.filter((s) => s.final).length, 1, "only chat-ask should be final");
assertEqual(typeof t.steps[5].target, "function", "drag-memory target should be a dynamic function");
assertEqual(typeof t.steps[3].target, "function", "minimize step target should be a dynamic function (last panel's minimize button)");
assertEqual(typeof t.resolveTarget(t.steps[0]), "object", "resolveTarget should resolve selector strings via document.querySelector");

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
assertTruthy(t.copy.zh.step5NeedSwitchBody, "zh missing step5NeedSwitchBody");
assertTruthy(t.copy.en.step5NeedSwitchBody, "en missing step5NeedSwitchBody");
assertEqual(t.currentLanguage(), "zh", "documentElement lang zh-Hans should resolve to zh");

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

// ── 用例 4：推进 / 回退 / 边界 ──
tour.startTour();
assertEqual(tour.isActive(), true, "startTour should activate");
assertEqual(t.currentStepIndex(), 0, "startTour should begin at step 0");
tour.goBack();
assertEqual(t.currentStepIndex(), 0, "goBack at first step should stay");
tour.advance();
assertEqual(t.currentStepIndex(), 1, "advance should move to step 1");
tour.advance();
tour.advance();
tour.advance();
assertEqual(t.currentStepIndex(), 4, "advance x4 should reach switch-chat");
tour.advance();
assertEqual(t.currentStepIndex(), 5, "advance should reach drag-memory");
tour.goBack();
assertEqual(t.currentStepIndex(), 4, "goBack should return to switch-chat");
tour.advance();
assertEqual(t.currentStepIndex(), 5, "advance should return to drag-memory");
assertEqual(t.isFinalStep(6), true, "index 6 should be final");
assertEqual(t.isFinalStep(5), false, "index 5 should not be final");

// ── 用例 5：autoNext 判定 ──
assertEqual(t.isAutoNextStep(0, "sent"), false, "intro step should not autoNext on sent");
assertEqual(t.isAutoNextStep(1, "sent"), true, "report-ask should autoNext on sent");
assertEqual(t.isAutoNextStep(1, "other"), false, "report-ask should not autoNext on other events");
assertEqual(t.isAutoNextStep(3, "minimized"), false, "minimize step should NOT autoNext (manual next)");
assertEqual(t.isAutoNextStep(4, "switched"), true, "switch-chat should autoNext on switched");
assertEqual(t.isAutoNextStep(5, "memory-added"), true, "drag-memory should autoNext on memory-added");
assertEqual(t.isAutoNextStep(5, "other"), false, "drag-memory should not autoNext on other events");
assertEqual(t.isAutoNextStep(6, "sent"), true, "chat-ask should autoNext on sent");

// ── 用例 6：notify 推进 + 完成 ──
tour.notify("memory-added");
assertEqual(t.currentStepIndex(), 6, "notify memory-added should advance to final step");
tour.advance();
assertEqual(tour.isActive(), false, "advance on final step should finish tour");
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

// 9c：minimize 步取最后一个面板的最小化按钮（旧面板已最小化时按钮隐藏不可高光）
const oldMinBtnStub = { ...elementStub };
const newMinBtnStub = { ...elementStub };
const oldMinPanelStub = { ...elementStub, querySelector() { return oldMinBtnStub; } };
const newMinPanelStub = { ...elementStub, querySelector() { return newMinBtnStub; } };
queryAllMap[".deep-window"] = [oldMinPanelStub, newMinPanelStub];
assertEqual(t.resolveTarget(t.steps[3]), newMinBtnStub, "minimize step should target the LAST panel's minimize button");
delete queryAllMap[".deep-window"];
delete queryAllMap[".deep-window:not(.generating)"];

// 9b：drag-memory 步（记忆栏不可用回退切换按钮 / 可用指向药丸框）
const fastBtnStub = { ...elementStub };
const memoryBarStub = { ...elementStub };
const hiddenMemoryBarStub = { ...elementStub, classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } } };
const pillStub = { ...elementStub };
selectorMap['[data-mode="fast"]'] = fastBtnStub;
selectorMap['#chatMemoryBar'] = memoryBarStub;
selectorMap['.deep-window.minimized'] = pillStub;
byIdMap["chatMemoryBar"] = null;                 // 记忆栏不存在 → 回退切换按钮
assertEqual(t.resolveTarget(t.steps[5]), fastBtnStub, "no memory bar → fall back to fast-mode button");
byIdMap["chatMemoryBar"] = hiddenMemoryBarStub;  // 记忆栏 hidden → 回退切换按钮
assertEqual(t.resolveTarget(t.steps[5]), fastBtnStub, "hidden memory bar → fall back to fast-mode button");
byIdMap["chatMemoryBar"] = memoryBarStub;        // 记忆栏可见 → 指向最小化药丸框
assertEqual(t.resolveTarget(t.steps[5]), pillStub, "visible memory bar → point at minimized pill");
delete byIdMap["chatMemoryBar"];

// ── 用例 10：自动推进事件 ──
tour.startTour();
assertEqual(t.currentStepIndex(), 0, "startTour should begin at step 0");
// 10a：点发送（sent）→ 立即推进（intro 步无 autoNext，先手动到 report-ask）
tour.notify("sent");
assertEqual(t.currentStepIndex(), 0, "intro step should not auto-advance on sent");
tour.advance();
assertEqual(t.currentStepIndex(), 1, "manual advance should reach report-ask");
tour.notify("sent");
assertEqual(t.currentStepIndex(), 2, "notify sent should auto-advance from report-ask");
tour.advance();
assertEqual(t.currentStepIndex(), 3, "manual advance should reach minimize step");
// 10b：点最小化（minimized）→ 仅高光转移到药丸框展示效果，不自动推进（手动「下一步」）
tour.notify("minimized");
assertEqual(t.currentStepIndex(), 3, "minimized should NOT auto-advance (manual next)");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "manual advance should reach switch-chat");
tour.stopTour();
assertEqual(tour.isActive(), false, "stopTour should clean up follow timer");
// 10c：切 Chat Mode（switched）→ 立即推进
tour.startTour();
tour.advance(); // 1
tour.advance(); // 2
tour.advance(); // 3
tour.advance(); // 4
assertEqual(t.currentStepIndex(), 4, "advance should reach switch-chat");
tour.notify("switched");
assertEqual(t.currentStepIndex(), 5, "notify switched should auto-advance from switch-chat");
tour.stopTour();
// 10d：最后一步点发送（sent）→ 自动结束引导
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2
tour.advance(); // 3
tour.advance(); // 4
tour.advance(); // 5
tour.advance(); // 6
assertEqual(t.currentStepIndex(), 6, "advance should reach final chat-ask");
tour.notify("sent");
assertEqual(tour.isActive(), false, "notify sent on final step should finish tour");

// ── 用例 11：语言跟随——页面切换语言后重渲染气泡使用新语言 ──
// currentLanguage 优先 localStorage（sandbox 恒返回 null）→ 兜底 documentElement.lang
tour.startTour();
assertMatch(t.popoverHtml(), /第 1 步/, "popover should render zh copy initially");
assertMatch(t.popoverHtml(), /先认识整体布局/, "intro step should show layout copy in zh");
sandbox.document.documentElement.lang = "en";
t.renderStep(); // 引擎在 MutationObserver 回调中调用同一函数
assertMatch(t.popoverHtml(), /Step 1 of 7/, "popover should re-render with en copy after lang change");
assertMatch(t.popoverHtml(), /Here's the layout/, "intro step should show layout copy in en");
sandbox.document.documentElement.lang = "zh-Hans";
t.renderStep();
assertMatch(t.popoverHtml(), /第 1 步/, "popover should re-render back to zh copy");
tour.stopTour();

// ── 用例 12：autoNext 步骤渲染置灰动作提示按钮（防误点跳过）──
queryAllMap[".deep-window:not(.generating)"] = [newPanelStub]; // deep-window 步立即命中（渲染完整气泡）
tour.startTour();
// intro（无 autoNext）→ 保留「下一步」，无 hint
assertMatch(t.popoverHtml(), /data-tour-action="next"/, "intro step should render Next button");
assertEqual(t.popoverHtml().indexOf("onboarding-btn-hint"), -1, "intro step should not render hint button");
tour.advance(); // → report-ask（autoNext sent）
assertMatch(t.popoverHtml(), /onboarding-btn-hint/, "autoNext step should render disabled hint button");
assertMatch(t.popoverHtml(), /点击「发送」按钮继续/, "hint button should show zh action hint");
assertMatch(t.popoverHtml(), /disabled/, "hint button should be disabled");
assertEqual(t.popoverHtml().indexOf('data-tour-action="next"'), -1, "autoNext step should not render Next button");
tour.advance(); // → deep-window（无 autoNext，保留「下一步」）
assertEqual(t.popoverHtml().indexOf("onboarding-btn-hint"), -1, "non-autoNext step should not render hint button");
assertMatch(t.popoverHtml(), /data-tour-action="next"/, "non-autoNext step should render Next button");
assertEqual(t.popoverHtml().indexOf('data-tour-action="finish"'), -1, "deep-window should not render finish");
tour.stopTour();

// ── 用例 13：第 5 步——气泡固定视口底部中央 + 投放区独立浮动提示条 ──
assertEqual(t.steps[5].popover, "bottom-center", "drag-memory step should pin popover to bottom-center");
assertTruthy(t.copy.zh.dropzoneTip, "zh missing dropzoneTip");
assertTruthy(t.copy.en.dropzoneTip, "en missing dropzoneTip");
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2
tour.advance(); // 3
tour.advance(); // 4
byIdMap["chatMemoryBar"] = memoryBarStub;            // 记忆栏可见
byIdMap["chatMemoryDropzone"] = { ...elementStub, getBoundingClientRect() { return { left: 400, top: 300, width: 600, height: 60, right: 1000, bottom: 360 }; } };
tour.advance(); // 5 → drag-memory 渲染：应创建投放区提示条
assertTruthy(t.dropzoneTipActive(), "step6 should create dropzone tip element");
assertMatch(t.popoverHtml(), /第 6 步/, "step6 popover should render");
assertMatch(t.popoverHtml(), /把药丸框拖入记忆栏后继续/, "step6 should render disabled hint button");
tour.stopTour();
assertEqual(t.dropzoneTipActive(), false, "stopTour should remove dropzone tip");
delete byIdMap["chatMemoryBar"];
delete byIdMap["chatMemoryDropzone"];

// ── 用例 14：填入示例按语言切换（英文版最后一步填入英文示例）──
assertEqual(t.steps[6].autoFillEn, "Based on the report, give me some analysis suggestions", "chat-ask should define autoFillEn");
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2
tour.advance(); // 3
tour.advance(); // 4
tour.advance(); // 5
tour.advance(); // 6
assertEqual(t.currentStepIndex(), 6, "advance should reach final chat-ask");
assertEqual(t.autoFillFor(t.steps[6]), "根据刚才的报告，给我分析建议", "zh mode should fill zh example");
sandbox.document.documentElement.lang = "en";
assertEqual(t.autoFillFor(t.steps[6]), "Based on the report, give me some analysis suggestions", "en mode should fill en example");
sandbox.document.documentElement.lang = "zh-Hans";
tour.stopTour();

console.log("PASS: onboarding tour logic");
