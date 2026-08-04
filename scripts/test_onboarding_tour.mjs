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

const elementStub = {
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, appendChild() {}, querySelectorAll() { return []; },
  querySelector() { return null; }, setAttribute() {}, removeAttribute() {},
  style: {}, getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};

// 可控查询：selectorMap 供 querySelector，byIdMap 供 getElementById（动态 target 测试用）
const selectorMap = {
  "#chatInput": elementStub,
  ".deep-window": elementStub,
  '[data-mode="fast"]': elementStub,
  "#chatMemoryBar": elementStub
};
const byIdMap = {};
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true, innerWidth: 1920, innerHeight: 1080 },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector(sel) { return selectorMap[sel] || null; },
    querySelectorAll() { return []; },
    createElement() { return { ...elementStub, innerHTML: "" }; },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete",
    addEventListener() {}, removeEventListener() {}
  },
  ResizeObserver: class { observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

runScript("public/onboarding_tour.js", sandbox);
const tour = sandbox.window.ONBOARDING_TOUR;
assertTruthy(tour, "onboarding_tour should expose window.ONBOARDING_TOUR");
const t = tour._test;

// ── 用例 1：步骤结构完整性 ──
assertEqual(t.stepCount(), 6, "should have exactly 6 steps");
const ids = t.steps.map((s) => s.id);
assertEqual(new Set(ids).size, ids.length, "step ids must be unique");
assertEqual(ids.join("|"), "report-ask|deep-window|minimize-window|switch-chat|drag-memory|chat-ask", "step ids order");
for (const s of t.steps) {
  assertTruthy(s.target, `step ${s.id} target must be a selector or function`);
  assertTruthy(s.copyKey, `step ${s.id} copyKey must be set`);
  assertEqual(["block", "pass"].includes(s.mask), true, `step ${s.id} mask must be block|pass`);
}
assertEqual(t.steps[0].autoFillFocus, '#chatForm button[type="submit"]', "step1 should focus send button after autofill");
assertEqual(t.steps[0].autoNext, "sent", "step1 should autoNext on sent");
assertEqual(t.steps[2].autoNext, "minimized", "step3 should autoNext on minimized");
assertEqual(typeof t.steps[1].target, "function", "deep-window target should be a dynamic function (wait for report done)");
assertEqual(t.steps[4].autoNext, "memory-added", "drag-memory step should autoNext on memory-added");
assertEqual(t.steps.filter((s) => s.autoNext).length, 3, "3 steps should have autoNext (sent/minimized/memory-added)");
assertEqual(t.steps[5].final, true, "chat-ask step should be final");
assertEqual(t.steps.filter((s) => s.final).length, 1, "only chat-ask should be final");
assertEqual(typeof t.steps[4].target, "function", "drag-memory target should be a dynamic function");
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
assertEqual(t.currentStepIndex(), 3, "advance x3 should reach switch-chat");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "advance should reach drag-memory");
tour.goBack();
assertEqual(t.currentStepIndex(), 3, "goBack should return to switch-chat");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "advance should return to drag-memory");
assertEqual(t.isFinalStep(5), true, "index 5 should be final");
assertEqual(t.isFinalStep(4), false, "index 4 should not be final");

// ── 用例 5：autoNext 判定 ──
assertEqual(t.isAutoNextStep(0, "sent"), true, "step 0 should autoNext on sent");
assertEqual(t.isAutoNextStep(0, "other"), false, "step 0 should not autoNext on other events");
assertEqual(t.isAutoNextStep(2, "minimized"), true, "step 2 should autoNext on minimized");
assertEqual(t.isAutoNextStep(4, "memory-added"), true, "step 4 should autoNext on memory-added");
assertEqual(t.isAutoNextStep(4, "other"), false, "step 4 should not autoNext on other events");

// ── 用例 6：notify 推进 + 完成 ──
tour.notify("memory-added");
assertEqual(t.currentStepIndex(), 5, "notify memory-added should advance to final step");
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
// 9a：deep-window 步等报告完成——生成中（选择器未命中）→ null 继续轮询；完成后命中
assertEqual(t.resolveTarget(t.steps[1]), null, "no finished deep-window → keep polling");
const finishedWinStub = { ...elementStub };
selectorMap[".deep-window:not(.generating)"] = finishedWinStub;
assertEqual(t.resolveTarget(t.steps[1]), finishedWinStub, "finished deep-window → resolved");

// 9b：drag-memory 步（记忆栏不可用回退切换按钮 / 可用指向药丸框）
const fastBtnStub = { ...elementStub };
const memoryBarStub = { ...elementStub };
const hiddenMemoryBarStub = { ...elementStub, classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } } };
const pillStub = { ...elementStub };
selectorMap['[data-mode="fast"]'] = fastBtnStub;
selectorMap['#chatMemoryBar'] = memoryBarStub;
selectorMap['.deep-window.minimized'] = pillStub;
byIdMap["chatMemoryBar"] = null;                 // 记忆栏不存在 → 回退切换按钮
assertEqual(t.resolveTarget(t.steps[4]), fastBtnStub, "no memory bar → fall back to fast-mode button");
byIdMap["chatMemoryBar"] = hiddenMemoryBarStub;  // 记忆栏 hidden → 回退切换按钮
assertEqual(t.resolveTarget(t.steps[4]), fastBtnStub, "hidden memory bar → fall back to fast-mode button");
byIdMap["chatMemoryBar"] = memoryBarStub;        // 记忆栏可见 → 指向最小化药丸框
assertEqual(t.resolveTarget(t.steps[4]), pillStub, "visible memory bar → point at minimized pill");
delete byIdMap["chatMemoryBar"];

// ── 用例 10：自动推进事件（点发送 → sent；点最小化 → minimized）──
tour.startTour();
assertEqual(t.currentStepIndex(), 0, "startTour should begin at step 0");
tour.notify("sent");
assertEqual(t.currentStepIndex(), 1, "notify sent should auto-advance from step 0");
tour.advance();
assertEqual(t.currentStepIndex(), 2, "manual advance should reach minimize step");
tour.notify("minimized");
assertEqual(t.currentStepIndex(), 3, "notify minimized should auto-advance from step 2");
tour.notify("minimized");
assertEqual(t.currentStepIndex(), 3, "stale minimized notify should not re-advance");
tour.stopTour();

console.log("PASS: onboarding tour logic");
