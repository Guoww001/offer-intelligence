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
    readyState: "complete"
  },
  ResizeObserver: class { observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

runScript("public/onboarding_tour.js", sandbox);
const tour = sandbox.window.ONBOARDING_TOUR;
assertTruthy(tour, "onboarding_tour should expose window.ONBOARDING_TOUR");
const t = tour._test;

// ── 用例 1：步骤结构完整性 ──
assertEqual(t.stepCount(), 5, "should have exactly 5 steps");
const ids = t.steps.map((s) => s.id);
assertEqual(new Set(ids).size, ids.length, "step ids must be unique");
assertEqual(ids.join("|"), "report-ask|deep-window|switch-chat|drag-memory|chat-ask", "step ids order");
for (const s of t.steps) {
  assertTruthy(s.target, `step ${s.id} target must be a selector or function`);
  assertTruthy(s.copyKey, `step ${s.id} copyKey must be set`);
  assertEqual(["block", "pass"].includes(s.mask), true, `step ${s.id} mask must be block|pass`);
}
assertEqual(t.steps[3].autoNext, "memory-added", "drag-memory step should autoNext on memory-added");
assertEqual(t.steps.filter((s) => s.autoNext).length, 1, "only drag-memory should have autoNext");
assertEqual(t.steps[4].final, true, "chat-ask step should be final");
assertEqual(t.steps.filter((s) => s.final).length, 1, "only chat-ask should be final");
assertEqual(typeof t.steps[3].target, "function", "drag-memory target should be a dynamic function");
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
assertTruthy(t.copy.zh.step4NeedSwitchBody, "zh missing step4NeedSwitchBody");
assertTruthy(t.copy.en.step4NeedSwitchBody, "en missing step4NeedSwitchBody");
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
assertEqual(t.currentStepIndex(), 3, "advance x3 should reach drag-memory");
tour.goBack();
assertEqual(t.currentStepIndex(), 2, "goBack should return to step 2");
tour.advance();
assertEqual(t.currentStepIndex(), 3, "advance should return to drag-memory");
assertEqual(t.isFinalStep(4), true, "index 4 should be final");
assertEqual(t.isFinalStep(3), false, "index 3 should not be final");

// ── 用例 5：autoNext 判定 ──
assertEqual(t.isAutoNextStep(3, "memory-added"), true, "step 3 should autoNext on memory-added");
assertEqual(t.isAutoNextStep(3, "other"), false, "step 3 should not autoNext on other events");
assertEqual(t.isAutoNextStep(0, "memory-added"), false, "step 0 should not autoNext");

// ── 用例 6：notify 推进 + 完成 ──
tour.notify("memory-added");
assertEqual(t.currentStepIndex(), 4, "notify memory-added should advance to final step");
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

// ── 用例 9：目标动态解析（drag-memory 记忆栏缺失时指向切换按钮）──
byIdMap["chatMemoryBar"] = null;                             // 记忆栏不存在 → 回退到切换按钮
assertTruthy(t.resolveTarget(t.steps[3]), "dynamic target should fall back to fast-mode button");
byIdMap["chatMemoryBar"] = elementStub;                      // 记忆栏存在（contains=false = 未隐藏）→ 指向记忆栏
assertEqual(t.resolveTarget(t.steps[3]) !== null, true, "dynamic target should point at memory bar when visible");
delete byIdMap["chatMemoryBar"];

console.log("PASS: onboarding tour logic");
