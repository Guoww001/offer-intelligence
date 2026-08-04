(function () {
  // ── Chatbot 新手引导（Onboarding Tour）────────────────────────────
  // 独立引导引擎：全屏遮罩（四块矩形围出目标开窗）+ 高亮圈 + 步骤气泡。
  // 零依赖，挂 window.ONBOARDING_TOUR。与 app.js 的交互点：
  //   1. app.js init() 尾部: window.ONBOARDING_TOUR.maybeAutoStart()
  //   2. app.js _addMemoryFromPanel() 尾部: window.ONBOARDING_TOUR.notify("memory-added")
  // 样式类 .onboarding-*（见 styles.css），z-index: 遮罩 50000 / 高亮 50001 / 气泡 50002，
  // 高于 Deep Window 浮窗（_deepMaxZIndex 从 1000 递增）。

  var DONE_KEY = "oi_onboarding_done";
  var TEST_MODE = !!(window.__OFFER_INTELLIGENCE_TEST__);

  // ── 双语文案（键集 zh/en 必须一一对应）──
  var TOUR_COPY = {
    zh: {
      welcomeTitle: "👋 欢迎使用 YeahPromos 助手",
      step1Title: "第 1 步：在 Report Mode 提问",
      step1Body: "在输入框输入商户名 / Merchant ID / ASIN 或品类，就能获取后台数据分析报告。填好后点击右侧「发送」按钮发起查询。试试看：",
      step2Title: "第 2 步：等待分析报告",
      step2Body: "报告在浮窗中打开。浮窗可以随意拖动，也能最小化，还支持一键导出 Excel。",
      step3Title: "第 3 步：点击最小化",
      step3Body: "点击浮窗头部的「─」按钮，把浮窗最小化成一个药丸小框——只有最小化后的浮窗才能拖入记忆栏。",
      step4Title: "第 4 步：切换到 Chat Mode",
      step4Body: "点击上方「Chat Mode」按钮，聊天区上方会出现记忆栏——这是把数据带进对话的入口。",
      step5Title: "第 5 步：拖入记忆栏",
      step5Body: "把最小化后的药丸框拖入记忆栏（上下文区域），报告就会成为聊天上下文。",
      step5NeedSwitchBody: "记忆栏只在 Chat Mode 显示，请先点击上方「Chat Mode」按钮切换。",
      step6Title: "第 6 步：与 Chat Mode 对话",
      step6Body: "记忆栏里已经有刚才的报告了，现在可以自由提问。填好后点击「发送」按钮。试试：",
      completeTitle: "🎉 完成！",
      completeBody: "你已经掌握了核心用法：Report Mode 获取数据 → 拖入记忆栏 → Chat Mode 对话。随时点击 Help 可重播本引导。",
      fillExample: "帮我填入示例",
      prev: "上一步",
      next: "下一步",
      skip: "跳过",
      finish: "完成 🎉",
      stepCounter: "第 {n} 步 / 共 {total} 步",
      waitReport: "等待报告生成…"
    },
    en: {
      welcomeTitle: "👋 Welcome to the YeahPromos Assistant",
      step1Title: "Step 1: Ask in Report Mode",
      step1Body: "Type a merchant name / ID / ASIN or category to get a data analysis report. Click the Send button on the right to submit. Try it:",
      step2Title: "Step 2: Wait for the report",
      step2Body: "Reports open in a floating window you can drag around, minimize, or export to Excel.",
      step3Title: "Step 3: Minimize the window",
      step3Body: "Click the “–” button in the window header to shrink it into a pill — only minimized panels can be dragged into the memory bar.",
      step4Title: "Step 4: Switch to Chat Mode",
      step4Body: "Click the Chat Mode button above; a memory bar appears above the chat area — the way to bring data into the conversation.",
      step5Title: "Step 5: Drag into the memory bar",
      step5Body: "Drag the minimized pill into the memory bar (the context area) — the report becomes chat context.",
      step5NeedSwitchBody: "The memory bar only shows in Chat Mode — click the Chat Mode button above first.",
      step6Title: "Step 6: Chat with context",
      step6Body: "The report is now in your memory bar. Ask freely. Click Send to submit. Try:",
      completeTitle: "🎉 Done!",
      completeBody: "You've learned the core flow: get data in Report Mode → drag into memory → chat in Chat Mode. Click Help anytime to replay this guide.",
      fillExample: "Fill example for me",
      prev: "Back",
      next: "Next",
      skip: "Skip",
      finish: "Finish 🎉",
      stepCounter: "Step {n} of {total}",
      waitReport: "Waiting for the report…"
    }
  };

  // ── 步骤数据（纯数据；target 可为选择器字符串或返回选择器的函数）──
  var TOUR_STEPS = [
    {
      id: "report-ask",
      target: "#chatInput",
      copyKey: "step1",
      mask: "block",
      autoFill: "Shokz",
      // 用户点击「帮我填入示例」后，高光从输入框转移到发送按钮，引导点击发送
      autoFillFocus: '#chatForm button[type="submit"]'
    },
    {
      id: "deep-window",
      target: function () {
        // 等待报告完成（generating 移除）后的浮窗——生成期间最小化按钮被 CSS 隐藏，
        // 且 _minimizeDeepPanel 拒绝 loading 态，必须等报告就绪才能进入下一步
        try { return document.querySelector(".deep-window:not(.generating)") ? ".deep-window:not(.generating)" : null; } catch (e) { return null; }
      },
      copyKey: "step2",
      mask: "block",
      appear: true
    },
    {
      id: "minimize-window",
      target: ".deep-window .deep-window-minimize",
      copyKey: "step3",
      mask: "block"
    },
    {
      id: "switch-chat",
      target: '[data-mode="fast"]',
      copyKey: "step4",
      mask: "block"
    },
    {
      id: "drag-memory",
      target: function () {
        var bar = null;
        try { bar = document.getElementById("chatMemoryBar"); } catch (e) {}
        // 记忆栏可见 → 高亮最小化后的药丸框，引导拖入上下文区域；否则回退切换按钮
        if (bar && !bar.classList.contains("hidden")) return ".deep-window.minimized";
        return '[data-mode="fast"]';
      },
      copyKey: "step5",
      mask: "pass",
      autoNext: "memory-added"
    },
    {
      id: "chat-ask",
      target: "#chatInput",
      copyKey: "step6",
      mask: "block",
      autoFill: "根据刚才的报告，给我分析建议",
      final: true
    }
  ];

  // ── 状态 ──
  var _active = false;
  var _stepIndex = -1;
  var _maskEls = [];
  var _highlightEl = null;
  var _popoverEl = null;
  var _resizeObserver = null;
  var _targetEl = null;
  var _locateTimer = null;
  var _autoStartTimer = null;
  var _bodyKeyOverride = null;
  var _focusSelector = null; // 步骤内高光转移（如填入示例后指向发送按钮）

  // ── 语言 ──
  function currentLanguage() {
    var stored = null;
    try { stored = localStorage.getItem("offerLanguage"); } catch (e) {}
    if (stored === "zh" || stored === "en") return stored;
    return (document.documentElement.lang || "en").indexOf("zh") === 0 ? "zh" : "en";
  }

  function copy(lang) { return TOUR_COPY[lang === "zh" ? "zh" : "en"]; }

  // ── 完成状态（storage 可注入以便测试）──
  function storageOf(storage) { return storage || (function () { try { return localStorage; } catch (e) { return null; } })(); }
  function shouldShowTour(storage) {
    var s = storageOf(storage);
    if (!s) return true;
    try { return !s.getItem(DONE_KEY); } catch (e) { return true; }
  }
  function markCompleted(storage) {
    var s = storageOf(storage);
    if (!s) return;
    try { s.setItem(DONE_KEY, "1"); } catch (e) {}
  }
  function resetCompleted(storage) {
    var s = storageOf(storage);
    if (!s) return;
    try { s.removeItem(DONE_KEY); } catch (e) {}
  }

  // ── 纯逻辑（可测试）──
  function resolveTarget(step) {
    var selector = _focusSelector || (typeof step.target === "function" ? step.target() : step.target);
    try { return document.querySelector(selector); } catch (e) { return null; }
  }
  function isFinalStep(index) { return !!TOUR_STEPS[index] && !!TOUR_STEPS[index].final; }
  function isAutoNextStep(index, eventName) {
    var step = TOUR_STEPS[index];
    return !!step && !!step.autoNext && step.autoNext === eventName;
  }
  function currentStepIndex() { return _stepIndex; }
  function stepCount() { return TOUR_STEPS.length; }
  function isActive() { return _active; }

  // ── DOM 层 ──
  function _ensureDom() {
    if (_maskEls.length) return;
    for (var i = 0; i < 4; i++) {
      var m = document.createElement("div");
      m.className = "onboarding-mask-piece";
      _maskEls.push(m);
      document.body.appendChild(m);
    }
    _highlightEl = document.createElement("div");
    _highlightEl.className = "onboarding-highlight";
    document.body.appendChild(_highlightEl);
    _popoverEl = document.createElement("div");
    _popoverEl.className = "onboarding-popover";
    document.body.appendChild(_popoverEl);
    _popoverEl.addEventListener("click", function (e) {
      var actionBtn = e.target.closest("[data-tour-action]");
      if (actionBtn) {
        var action = actionBtn.getAttribute("data-tour-action");
        if (action === "next") advance();
        else if (action === "prev") goBack();
        else if (action === "skip") skipTour();
        else if (action === "finish") finishTour();
        return;
      }
      var fillBtn = e.target.closest(".onboarding-fill-btn");
      if (fillBtn && TOUR_STEPS[_stepIndex] && TOUR_STEPS[_stepIndex].autoFill) {
        var input = document.querySelector("#chatInput");
        if (input) {
          input.value = TOUR_STEPS[_stepIndex].autoFill;
          input.focus();
        }
        // 步骤配置了 autoFillFocus → 高光转移到该元素（如发送按钮），引导用户发送
        var focusSel = TOUR_STEPS[_stepIndex].autoFillFocus;
        if (focusSel) {
          _focusSelector = focusSel;
          _retarget();
        }
      }
    });
    _resizeObserver = new ResizeObserver(function () {
      if (_active && _targetEl) _reposition();
    });
  }

  function _positionMask(step, el) {
    var rect = el.getBoundingClientRect();
    if (step.mask === "pass") {
      for (var i = 0; i < 4; i++) _maskEls[i].style.display = "none";
      return;
    }
    var pad = 14;
    var left = Math.max(0, rect.left - pad);
    var top = Math.max(0, rect.top - pad);
    var right = Math.min(window.innerWidth, rect.right + pad);
    var bottom = Math.min(window.innerHeight, rect.bottom + pad);
    var pos = [
      { l: 0, t: 0, w: window.innerWidth, h: top },
      { l: 0, t: bottom, w: window.innerWidth, h: window.innerHeight - bottom },
      { l: 0, t: top, w: left, h: bottom - top },
      { l: right, t: top, w: window.innerWidth - right, h: bottom - top }
    ];
    for (var i = 0; i < 4; i++) {
      var p = pos[i];
      var m = _maskEls[i];
      m.style.display = p.w > 0 && p.h > 0 ? "block" : "none";
      m.style.left = p.l + "px";
      m.style.top = p.t + "px";
      m.style.width = p.w + "px";
      m.style.height = p.h + "px";
    }
  }

  function _positionHighlight(el) {
    var rect = el.getBoundingClientRect();
    _highlightEl.style.display = "block";
    _highlightEl.style.left = (rect.left - 6) + "px";
    _highlightEl.style.top = (rect.top - 6) + "px";
    _highlightEl.style.width = (rect.width + 12) + "px";
    _highlightEl.style.height = (rect.height + 12) + "px";
  }

  function _positionPopover(el) {
    var rect = el.getBoundingClientRect();
    var pw = 360;
    var left = Math.min(Math.max(12, rect.left + rect.width / 2 - pw / 2), window.innerWidth - pw - 12);
    var below = rect.bottom + 16;
    var above = Math.max(12, rect.top - 16 - 220);
    var top = below <= window.innerHeight - 240 ? below : above;
    _popoverEl.style.left = left + "px";
    _popoverEl.style.top = top + "px";
  }

  function _reposition() {
    if (!_targetEl) return;
    var step = TOUR_STEPS[_stepIndex];
    if (!step) return;
    _positionMask(step, _targetEl);
    _positionHighlight(_targetEl);
    _positionPopover(_targetEl);
  }

  // 步骤内高光转移：按 _focusSelector 重新解析目标并重绘遮罩/高亮/气泡
  function _retarget() {
    var step = TOUR_STEPS[_stepIndex];
    if (!step || !_active) return;
    var el = null;
    try { el = document.querySelector(_focusSelector); } catch (e) {}
    if (!el) return;
    _targetEl = el;
    _positionMask(step, el);
    _positionHighlight(el);
    _positionPopover(el);
    if (_resizeObserver) {
      try { _resizeObserver.disconnect(); } catch (e) {}
      try { _resizeObserver.observe(el); } catch (e) {}
    }
  }

  function _renderPopoverContent(step, c) {
    var bodyKey = step.copyKey + "Body";
    if (_bodyKeyOverride) bodyKey = _bodyKeyOverride;
    var html = "";
    html += '<div class="onboarding-popover-title">' + c[step.copyKey + "Title"] + '</div>';
    html += '<div class="onboarding-popover-body">' + c[bodyKey] + '</div>';
    if (step.autoFill) {
      html += '<button class="onboarding-fill-btn" type="button">' + c.fillExample + '</button>';
    }
    html += '<div class="onboarding-step-counter">' +
      c.stepCounter.replace("{n}", String(_stepIndex + 1)).replace("{total}", String(TOUR_STEPS.length)) +
      '</div>';
    html += '<div class="onboarding-popover-actions">';
    if (_stepIndex > 0) {
      html += '<button class="onboarding-btn" data-tour-action="prev" type="button">' + c.prev + '</button>';
    }
    html += '<button class="onboarding-btn onboarding-btn-skip" data-tour-action="skip" type="button">' + c.skip + '</button>';
    html += '<button class="onboarding-btn onboarding-btn-primary" data-tour-action="' +
      (step.final ? "finish" : "next") + '" type="button">' + (step.final ? c.finish : c.next) + '</button>';
    html += '</div>';
    _popoverEl.innerHTML = html;
  }

  // 等待态渲染：目标元素尚未出现（如第 2 步轮询 .deep-window 期间）时，
  // 四块遮罩铺满全屏防误触、隐藏高亮圈、气泡居中显示"等待报告生成"文案，
  // 避免旧步骤 UI 残留造成"卡住"的观感。probe 命中后 _renderStep 的
  // done 回调会用真实定位（_positionMask/_positionHighlight/_positionPopover/
  // _renderPopoverContent）覆盖本等待态。
  function _renderWaiting(step, c) {
    for (var i = 0; i < _maskEls.length; i++) {
      var m = _maskEls[i];
      m.style.left = "0px";
      m.style.top = "0px";
      m.style.width = window.innerWidth + "px";
      m.style.height = window.innerHeight + "px";
      m.style.display = "block";
    }
    _highlightEl.style.display = "none";
    _popoverEl.style.left = Math.max(12, (window.innerWidth - 360) / 2) + "px";
    _popoverEl.style.top = Math.round(window.innerHeight * 0.35) + "px";
    var html = "";
    html += '<div class="onboarding-popover-title">' + c[step.copyKey + "Title"] + '</div>';
    html += '<div class="onboarding-popover-body">' + c.waitReport + '</div>';
    html += '<div class="onboarding-step-counter">' +
      c.stepCounter.replace("{n}", String(_stepIndex + 1)).replace("{total}", String(TOUR_STEPS.length)) +
      '</div>';
    html += '<div class="onboarding-popover-actions">';
    html += '<button class="onboarding-btn onboarding-btn-skip" data-tour-action="skip" type="button">' + c.skip + '</button>';
    html += '</div>';
    _popoverEl.innerHTML = html;
  }

  function _renderStep() {
    var step = TOUR_STEPS[_stepIndex];
    if (!step) { stopTour(); return; }
    var c = copy(currentLanguage());
    _bodyKeyOverride = null;
    if (step.id === "drag-memory") {
      var bar = null;
      try { bar = document.getElementById("chatMemoryBar"); } catch (e) {}
      if (!bar || bar.classList.contains("hidden")) _bodyKeyOverride = "step5NeedSwitchBody";
    }
    _renderWaiting(step, c); // 先渲染等待态（目标未出现时给出反馈），命中后由 done 回调覆盖
    _locateTarget(step, function (el) {
      if (!_active) return;
      _targetEl = el;
      _positionMask(step, el);
      _positionHighlight(el);
      _positionPopover(el);
      _renderPopoverContent(step, c);
      if (_resizeObserver) {
        try { _resizeObserver.disconnect(); } catch (e) {}
        try { _resizeObserver.observe(el); } catch (e) {}
      }
    });
  }

  // 目标定位：元素不存在时轮询（appear 步骤最长 15s，其余 3s），仍失败则跳过该步
  function _locateTarget(step, done) {
    var maxTries = step.appear ? 50 : 10;
    var tries = 0;
    var interval = 300;
    function probe() {
      var el = resolveTarget(step);
      if (el) { done(el); return; }
      tries++;
      if (tries >= maxTries) { advance(); return; } // 找不到 → 跳过
      _locateTimer = setTimeout(probe, interval);
    }
    probe();
  }

  // ── 公开推进 API ──
  // 推进/回退前必须先清 _locateTimer，使旧 probe 轮询链失效：
  // 否则旧链耗尽后回调会用捕获的旧 step 重绘 UI（闪回），或调 advance() 踢走当前步骤。
  function advance() {
    if (!_active) return;
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    _focusSelector = null;
    var step = TOUR_STEPS[_stepIndex];
    if (!step) return;
    if (step.final) { finishTour(); return; }
    if (_stepIndex < TOUR_STEPS.length - 1) {
      _stepIndex++;
      _renderStep();
    }
  }
  function goBack() {
    if (!_active) return;
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    _focusSelector = null;
    if (_stepIndex > 0) {
      _stepIndex--;
      _renderStep();
    }
  }
  function notify(eventName) {
    if (!_active) return;
    if (isAutoNextStep(_stepIndex, eventName)) advance();
  }

  function _clearTimers() {
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    if (_autoStartTimer) { clearTimeout(_autoStartTimer); _autoStartTimer = null; }
  }

  function stopTour() {
    _active = false;
    _clearTimers();
    if (_resizeObserver) { try { _resizeObserver.disconnect(); } catch (e) {} _resizeObserver = null; }
    for (var i = 0; i < _maskEls.length; i++) {
      var m = _maskEls[i];
      if (m.parentNode) m.parentNode.removeChild(m);
    }
    _maskEls = [];
    if (_highlightEl && _highlightEl.parentNode) _highlightEl.parentNode.removeChild(_highlightEl);
    _highlightEl = null;
    if (_popoverEl && _popoverEl.parentNode) _popoverEl.parentNode.removeChild(_popoverEl);
    _popoverEl = null;
    _targetEl = null;
    _stepIndex = -1;
    _bodyKeyOverride = null;
    _focusSelector = null;
  }
  function finishTour() { stopTour(); markCompleted(); }
  function skipTour() { markCompleted(); stopTour(); }

  function startTour() {
    if (_active) return;
    _active = true;
    _stepIndex = 0;
    _ensureDom();
    _renderStep();
  }

  // 首次进入自动弹（app.js init() 尾部调用）；完成/跳过过则不再弹
  function maybeAutoStart() {
    if (TEST_MODE) return;
    if (_active) return;
    if (!shouldShowTour()) return;
    _clearTimers();
    _autoStartTimer = setTimeout(function () {
      if (!_active && shouldShowTour()) startTour();
    }, 800);
  }

  // 重播入口（Help 面板工具栏「🎓 新手引导」按钮）
  function bindReplayButton() {
    if (TEST_MODE) return;
    var btn = document.getElementById("reportHelpTourBtn");
    if (btn) btn.addEventListener("click", startTour);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindReplayButton);
  } else {
    bindReplayButton();
  }

  window.ONBOARDING_TOUR = {
    startTour: startTour,
    stopTour: stopTour,
    skipTour: skipTour,
    finishTour: finishTour,
    advance: advance,
    goBack: goBack,
    notify: notify,
    maybeAutoStart: maybeAutoStart,
    shouldShowTour: shouldShowTour,
    markCompleted: markCompleted,
    resetCompleted: resetCompleted,
    isActive: isActive,
    _test: {
      steps: TOUR_STEPS,
      copy: TOUR_COPY,
      currentLanguage: currentLanguage,
      resolveTarget: resolveTarget,
      isFinalStep: isFinalStep,
      isAutoNextStep: isAutoNextStep,
      currentStepIndex: currentStepIndex,
      stepCount: stepCount
    }
  };
})();
