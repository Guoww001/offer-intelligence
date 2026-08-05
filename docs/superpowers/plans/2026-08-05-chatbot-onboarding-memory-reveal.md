# Chatbot Onboarding Memory Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Keep the onboarding tour on the Add to chat step until the user minimizes Deep Window and sees the newly added memory card, then let Next enter Chat Mode guidance.

**Architecture:** Extend the existing `public/onboarding_tour.js` tour engine with a small internal phase for the existing `add-to-chat` step. The current business flow remains unchanged; tour events only retarget the highlight and update the popover. A scoped CSS class provides a one-shot pulse for the newest memory chip after the Deep Window receives `minimized`.

**Tech Stack:** Vanilla JavaScript IIFE, DOM `MutationObserver`, existing vm-based Node test harness, scoped CSS animations.

## Global Constraints

- Do not change the existing Add to chat business behavior, memory data shape, or Chat Mode injection.
- Keep the formal tour step count and IDs unchanged: `intro|report-ask|deep-window|add-to-chat|chat-ask`.
- Chinese and English copy keys must remain one-to-one.
- Respect the existing dirty changes in `public/index.html` and `public/styles.css`; only add narrowly scoped onboarding styles.
- Do not create a Git commit without explicit user authorization.

### Task 1: Add the failing onboarding phase tests

**Files:**
- Modify: `scripts/test_onboarding_tour.mjs`
- Reference: `public/onboarding_tour.js`

**Interfaces:**
- Consumes: `window.ONBOARDING_TOUR._test` helpers and the existing `querySelector`/`querySelectorAll` stubs.
- Produces: regression assertions for `chat-add` phase transitions and manual advancement.

- [ ] **Step 1: Replace the old auto-next assertions with the desired behavior assertions**

Add assertions next to the existing step-structure tests:

```js
assertEqual(t.steps[3].autoNext, undefined, "add-to-chat should wait for the guided memory reveal");
assertEqual(t.steps[3].focusOn, "chat-add", "add-to-chat should react to chat-add as a focus transition");
assertEqual(t.steps[3].autoNextFocus, ".deep-window-minimize", "chat-add should focus the minimize button");
assertEqual(t.steps[3].nextPhaseOn, "panel-minimized", "add-to-chat should reveal memory after minimization");
assertTruthy(t.copy.zh.step3MinimizeBody, "zh should explain minimizing the Deep Window");
assertTruthy(t.copy.en.step3MinimizeBody, "en should explain minimizing the Deep Window");
assertTruthy(t.copy.zh.step3MemoryBody, "zh should explain the memory card");
assertTruthy(t.copy.en.step3MemoryBody, "en should explain the memory card");
```

Update the auto-next count to two (`report-ask` and final `chat-ask`) and assert that `isAutoNextStep(3, "chat-add")` is false.

- [ ] **Step 2: Add a failing phase-transition test**

Append a test block before the final console output:

```js
queryAllMap[".deep-window"] = [
  { ...addToChatPanelStub, querySelector(sel) {
    if (sel === ".deep-window-chat-add") return addToChatBtnStub;
    if (sel === ".deep-window-minimize") return minimizeBtnStub;
    return null;
  } }
];
tour.startTour();
tour.advance();
tour.notify("sent");
tour.advance();
tour.advance();
assertEqual(t.currentStepIndex(), 3, "phase test should start on add-to-chat");
tour.notify("chat-add");
assertEqual(t.currentStepIndex(), 3, "chat-add must not advance to step 4");
assertEqual(t.phase(), "await-minimize", "chat-add should enter await-minimize phase");
assertMatch(t.popoverHtml(), /最小化|Minimize/, "popover should explain minimizing the window");
assertEqual(t.canAdvance(), false, "Next must stay unavailable before minimization");
tour.notify("panel-minimized");
assertEqual(t.phase(), "memory-revealed", "panel-minimized should reveal memory state");
assertEqual(t.canAdvance(), true, "Next should become available after memory reveal");
assertMatch(t.popoverHtml(), /下一步|Next/, "popover should offer Next after memory reveal");
tour.advance();
assertEqual(t.currentStepIndex(), 4, "manual Next should enter the chat step");
tour.stopTour();
delete queryAllMap[".deep-window"];
```

Define `minimizeBtnStub` near the existing panel stubs with `classList.contains()` returning `false`.

- [ ] **Step 3: Run the focused test and verify the expected failure**

Run: `node scripts/test_onboarding_tour.mjs`

Expected: FAIL because the current add-to-chat step still has `autoNext: "chat-add"` and the tour does not expose a phase or `panel-minimized` transition.

### Task 2: Implement the guided phase transitions

**Files:**
- Modify: `public/onboarding_tour.js:25-150, 180-220, 300-540, 635-670`

**Interfaces:**
- Consumes: existing `notify(eventName)`, `_renderStep()`, `_renderPopoverContent()`, class observer, and `deep-window` DOM.
- Produces: `_tourPhase`, `phase()`, `canAdvance()`, and a third-step flow that waits for minimization before allowing `advance()`.

- [ ] **Step 1: Add bilingual phase copy and phase metadata**

Add these matching keys to `TOUR_COPY.zh` and `TOUR_COPY.en`:

```js
step3MinimizeBody: "先将 Deep Window 最小化，避免挡住记忆栏。点击窗口顶部的「─」按钮。",
step3MemoryBody: "记忆栏已经显示刚加入的记忆卡片。看清这个效果后，点击「下一步」进入 Chat Mode。",
step3MemoryNext: "下一步"
```

Use equivalent English text: `First minimize the Deep Window so it does not cover the memory bar. Click the “─” button in the window header.` and `The memory bar now shows the report memory card. After seeing it, click Next to continue to Chat Mode.`

Change the add-to-chat step to remove `autoNext: "chat-add"` and add:

```js
focusOn: "chat-add",
autoNextFocus: ".deep-window-minimize",
nextPhaseOn: "panel-minimized"
```

- [ ] **Step 2: Track and reset the internal phase**

Add `_tourPhase = "await-add"` beside `_stepIndex`. Reset it to `await-add` whenever the current step becomes `add-to-chat`, and clear it in `stopTour()`, `advance()`, and `goBack()` when leaving that step. Expose read-only test helpers:

```js
phase: function () { return _tourPhase; },
canAdvance: function () {
  return _stepIndex !== 3 || _tourPhase === "memory-revealed";
}
```

- [ ] **Step 3: Make `chat-add` retarget the minimize button without advancing**

In `notify(eventName)`, handle the current step’s `focusOn` event before generic auto-next handling:

```js
if (_stepIndex === 3 && eventName === "chat-add") {
  if (_tourPhase !== "await-add") return;
  _tourPhase = "await-minimize";
  _focusSelector = ".deep-window-minimize";
  _bodyKeyOverride = "step3MinimizeBody";
  _retarget();
  _refreshActionButtons();
  return;
}
```

This makes duplicate `chat-add` notifications idempotent and keeps the formal step index unchanged.

- [ ] **Step 4: Advance only after `minimized` is observed and highlight memory**

In the existing body class `MutationObserver`, after confirming the mutation target is the current `.deep-window`, detect the add-to-chat phase:

```js
if (_stepIndex === 3 && _tourPhase === "await-minimize" && t.classList.contains("minimized")) {
  _tourPhase = "memory-revealed";
  _focusSelector = "#chatMemoryBar";
  _bodyKeyOverride = "step3MemoryBody";
  var bar = document.querySelector("#chatMemoryBar");
  if (bar) {
    bar.classList.add("onboarding-memory-reveal");
    var chip = bar.querySelector(".chat-memory-chip:last-child");
    if (chip) chip.classList.add("onboarding-memory-chip-reveal");
    setTimeout(function () {
      if (bar) bar.classList.remove("onboarding-memory-reveal");
      if (chip) chip.classList.remove("onboarding-memory-chip-reveal");
    }, 1800);
  }
  _retarget();
  _refreshActionButtons();
  return;
}
```

Use the existing short retry positioning mechanism if Chat Mode layout has not finished mounting the memory bar yet.

- [ ] **Step 5: Guard manual advance and render the correct action button**

At the start of `advance()`, return when `_stepIndex === 3 && _tourPhase !== "memory-revealed"`. In `_renderPopoverContent`, render a disabled hint during `await-add`/`await-minimize`; render the normal Next button only during `memory-revealed`. Keep the existing final-step behavior unchanged.

- [ ] **Step 6: Run the focused test and verify it passes**

Run: `node scripts/test_onboarding_tour.mjs`

Expected: PASS, including the new phase assertions and all existing onboarding cases.

### Task 3: Add the memory-bar reveal styling

**Files:**
- Modify: `public/styles.css` near the existing `.onboarding-*` rules around line 13870

**Interfaces:**
- Consumes: `onboarding-memory-reveal` and `onboarding-memory-chip-reveal` classes from `onboarding_tour.js`.
- Produces: a scoped one-shot visual cue without changing the baseline memory bar appearance.

- [ ] **Step 1: Add scoped keyframes and reduced-motion fallback**

Add CSS adjacent to the onboarding styles:

```css
.onboarding-memory-reveal {
  animation: onboarding-memory-bar-pulse 1.8s ease-out;
}
.onboarding-memory-chip-reveal {
  animation: onboarding-memory-chip-in 0.75s cubic-bezier(.22, 1, .36, 1);
}
@keyframes onboarding-memory-bar-pulse {
  0%, 100% { box-shadow: inherit; }
  35% { box-shadow: 0 0 0 4px rgba(110, 168, 255, .28), 0 0 24px rgba(110, 168, 255, .32); }
}
@keyframes onboarding-memory-chip-in {
  0% { transform: translateY(6px) scale(.94); opacity: .35; }
  65% { transform: translateY(-2px) scale(1.04); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .onboarding-memory-reveal,
  .onboarding-memory-chip-reveal { animation: none; outline: 2px solid rgba(110, 168, 255, .65); }
}
```

- [ ] **Step 2: Run syntax and onboarding checks**

Run: `node --check public/onboarding_tour.js` and `node scripts/test_onboarding_tour.mjs`

Expected: both commands exit 0; onboarding test prints `PASS: onboarding tour logic`.

### Task 4: Run the project regression checks

**Files:**
- Test only: `public/onboarding_tour.js`, `public/styles.css`, `scripts/test_onboarding_tour.mjs`

- [ ] **Step 1: Run the relevant JavaScript checks**

Run:

```bash
node --check public/onboarding_tour.js
node scripts/test_onboarding_tour.mjs
node --check public/app.js
```

Expected: all commands exit 0.

- [ ] **Step 2: Inspect the final diff and preserve unrelated worktree changes**

Run: `git diff -- public/onboarding_tour.js public/styles.css scripts/test_onboarding_tour.mjs docs/superpowers/specs/2026-08-05-chatbot-onboarding-memory-reveal-design.md docs/superpowers/plans/2026-08-05-chatbot-onboarding-memory-reveal.md`

Expected: only the guided onboarding implementation, its tests/styles, and the two planning documents are shown; existing cache/index changes remain untouched.

- [ ] **Step 3: Report verification evidence without committing**

Report the exact commands and exit results. Do not create a commit or start a local server unless explicitly requested.
