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
      introTitle: "👋 先打开 Chatbot 使用助手",
      introBody: "先点击助手图标，打开 Chatbot 使用助手面板。面板会全程展示这次引导的三步状态；打开后我们先认识整体布局：聊天区顶部可切换 Report Mode（提问获取数据报告）与 Chat Mode（带着数据对话），输入商户名 / Merchant ID / ASIN 或品类即可查询；报告以浮窗展示，点击「加入对话」即可把报告带进 Chat Mode。下面我们实际操作一遍。",
      step1Title: "第 1 步：在 Report Mode 提问",
      step1Body: "在输入框输入商户名 / Merchant ID / ASIN 或品类，就能获取后台数据分析报告。填好后点击右侧「发送」按钮发起查询。试试看：",
      step2Title: "第 2 步：等待分析报告",
      step2Body: "报告在浮窗中打开。生成完成后，浮窗头部会出现「加入对话」按钮。",
      step2MoveTitle: "第 2 步：先移开助手面板",
      step2MoveBody: "为避免 Chatbot 使用助手挡住 Deep Window，请按住面板顶部的头像或标题区域，把面板拖到不遮挡聊天区的位置。拖动时橙色高光会跟随面板；移开后会继续等待报告。",
      step2MoveHint: "请拖动助手面板，移开 Deep Window 区域",
      step3Title: "第 3 步：点「加入对话」",
      step3Body: "点击浮窗头部的「加入对话」按钮，报告会自动加入记忆栏并切换到 Chat Mode。",
      step4Title: "第 4 步：与 Chat Mode 对话",
      step4Body: "记忆栏里已经有刚才的报告了，现在可以自由提问。填好后点击「发送」按钮。试试：\n（高级用法：也可以点「─」最小化浮窗，再拖入记忆栏。）",
      completeTitle: "🎉 完成！",
      completeBody: "你已经掌握了核心用法：Report 提问 → 点「加入对话」→ Chat 对话。随时点击 Help 可重播本引导。",
      fillExample: "帮我填入示例",
      prev: "上一步",
      next: "下一步",
      skip: "跳过",
      finish: "完成 🎉",
      stepCounter: "第 {n} 步 / 共 {total} 步",
      waitReport: "等待报告生成…",
      // autoNext 步骤主按钮（置灰不可点）的动作提示——防止新用户误点「跳过」
      introNextHint: "点击助手图标打开使用助手",
      step1NextHint: "点击「发送」按钮继续",
      step3NextHint: "点击「加入对话」按钮继续",
      step3MinimizeBody: "先将 Deep Window 最小化，避免挡住记忆栏。点击窗口顶部的「─」按钮。",
      step3MinimizeHint: "请先最小化 Deep Window",
      step3MemoryBody: "记忆栏已经显示刚加入的记忆卡片。看清这个效果后，点击「下一步」进入 Chat Mode。",
      step4NextHint: "点击「发送」按钮完成"
    },
    en: {
      introTitle: "👋 Open the Chatbot Assistant",
      introBody: "First click the assistant icon to open the Chatbot Assistant panel. It will stay visible throughout this guide so you can see the three-step status change. Here's the layout: the top of the chat area toggles between Report Mode (ask for data reports) and Chat Mode (chat with context); type a merchant name / ID / ASIN or category to query. Reports open in a floating window — click “Add to chat” to bring the report into Chat Mode. Let's walk through it.",
      step1Title: "Step 1: Ask in Report Mode",
      step1Body: "Type a merchant name / ID / ASIN or category to get a data analysis report. Click the Send button on the right to submit. Try it:",
      step2Title: "Step 2: Wait for the report",
      step2Body: "Reports open in a floating window. Once ready, an “Add to chat” button appears in the header.",
      step2MoveTitle: "Step 2: Move the assistant panel first",
      step2MoveBody: "To keep the Chatbot Assistant from covering the Deep Window, hold the avatar or title area at the top of the panel and drag it somewhere clear of the chat area. The orange highlight follows while you drag; once moved, the guide will keep waiting for the report.",
      step2MoveHint: "Drag the assistant panel away from the Deep Window",
      step3Title: "Step 3: Click Add to chat",
      step3Body: "Click “Add to chat” in the window header — the report is added to memory and you're switched to Chat Mode automatically.",
      step4Title: "Step 4: Chat with context",
      step4Body: "The report is now in your memory bar. Ask freely. Click Send to submit. Try:\n(Advanced: you can also click “–” to minimize the window, then drag it into the memory bar.)",
      completeTitle: "🎉 Done!",
      completeBody: "You've learned the core flow: ask in Report Mode → click Add to chat → chat in Chat Mode. Click Help anytime to replay this guide.",
      fillExample: "Fill example for me",
      prev: "Back",
      next: "Next",
      skip: "Skip",
      finish: "Finish 🎉",
      stepCounter: "Step {n} of {total}",
      waitReport: "Waiting for the report…",
      // autoNext 步骤主按钮（置灰不可点）的动作提示——防止新用户误点「Skip」
      introNextHint: "Click the assistant icon to open the guide",
      step1NextHint: "Click Send to continue",
      step3NextHint: "Click “Add to chat” to continue",
      step3MinimizeBody: "First minimize the Deep Window so it does not cover the memory bar. Click the “─” button in the window header.",
      step3MinimizeHint: "Minimize the Deep Window first",
      step3MemoryBody: "The memory bar now shows the report memory card. After seeing it, click Next to continue to Chat Mode.",
      step4NextHint: "Click Send to finish"
    }
  };

  // ── 步骤数据（纯数据；target 可为选择器字符串、返回选择器的函数或返回元素的函数）──
  // 主路径 5 步：布局介绍 → Report 提问 → 等待报告 → 点「加入对话」→ Chat 提问。
  // 最小化 + 拖入记忆栏保留为高级用法（见第 4 步正文说明），不再进入主引导流程。
  var TOUR_STEPS = [
    {
      id: "intro",
      target: ".welcome-float-dot",
      copyKey: "intro",
      mask: "block",
      autoNext: "assistant-opened"
    },
    {
      id: "report-ask",
      target: ["#chatbotModernRoot [data-chatbot-report-input]", "#chatInput"],
      copyKey: "step1",
      mask: "block",
      autoFill: "Shokz",
      // 用户点击「帮我填入示例」后，高光从输入框转移到发送按钮，引导点击发送
      autoFillFocus: ['#chatbotModernRoot [data-chatbot-report-form] button[type="submit"]', '#chatForm button[type="submit"]'],
      // 点击发送（chatForm submit）后自动进入下一步
      autoNext: "sent"
    },
    {
      id: "deep-window",
      target: function () {
        // 等待报告完成（generating 移除）后的浮窗——生成期间最小化按钮被 CSS 隐藏，
        // 且 _minimizeDeepPanel 拒绝 loading 态，必须等报告就绪才能进入下一步。
        // 注意：重播/二次使用时旧面板仍在页面上，必须返回"最后一个"（最新创建）的
        // 已完成面板——否则高光会落在被置顶新面板盖住的旧面板上，用户看不到高光。
        try {
          var list = document.querySelectorAll(".deep-window:not(.generating)");
          return (list && list.length) ? list[list.length - 1] : null;
        } catch (e) { return null; }
      },
      copyKey: "step2",
      mask: "block",
      appear: true
    },
    {
      id: "add-to-chat",
      target: function () {
        // 取最后一个（最新创建）面板的「加入对话」按钮：重播/二次使用时旧面板仍在页面，
        // 必须指向最新面板的按钮——旧面板的按钮可能已「已加入」禁用，高光不可见
        try {
          var list = document.querySelectorAll(".deep-window");
          if (!list || !list.length) return null;
          var last = list[list.length - 1];
          return last.querySelector ? firstTarget([".deep-window-chat-add", '[data-deep-window-action="add-memory"]'], last) : null;
        } catch (e) { return null; }
      },
      copyKey: "step3",
      mask: "block",
      // 点击「加入对话」后先转移高光到最小化按钮，最小化完成后再展示记忆栏
      focusOn: "chat-add",
      autoNextFocus: ".deep-window-minimize",
      nextPhaseOn: "panel-minimized"
    },
    {
      id: "chat-ask",
      target: ["#chatbotModernRoot [data-chatbot-input]", "#chatInput"],
      copyKey: "step4",
      mask: "block",
      autoFill: "根据刚才的报告，给我分析建议",
      // 英文模式下填入英文示例（autoFillEn）
      autoFillEn: "Based on the report, give me some analysis suggestions",
      // 填示例后高光转移到发送按钮，点击发送后自动结束引导
      autoFillFocus: ['#chatbotModernRoot [data-chatbot-composer] button[type="submit"]', '#chatForm button[type="submit"]'],
      autoNext: "sent",
      final: true
    }
  ];

  // ── 状态 ──
  var _active = false;
  var _stepIndex = -1;
  var _tourPhase = null; // add-to-chat: await-add → await-minimize → memory-revealed
  var _maskEls = [];
  var _highlightEl = null;
  var _popoverEl = null;
  var _resizeObserver = null;
  var _targetEl = null;
  var _locateTimer = null;
  var _autoStartTimer = null;
  var _bodyKeyOverride = null;
  var _titleKeyOverride = null;
  var _focusSelector = null; // 步骤内高光转移（如填入示例后指向发送按钮）
  var _autoNextTimer = null; // 自动推进延迟（展示最小化效果后再前进）
  var _focusTimer = null;    // 高光转移补定位轮询（等最小化动画完成后指向药丸框）
  var _memoryRevealTimer = null;
  var _replayButtonPulseTimer = null;
  var REPLAY_BUTTON_PULSE_MS = 2000;

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
  function firstTarget(selectors, root) {
    var list = Array.isArray(selectors) ? selectors : [selectors];
    var scope = root && root.querySelector ? root : document;
    for (var i = 0; i < list.length; i++) {
      var selector = list[i];
      if (typeof selector !== "string" || !selector.trim()) continue;
      try {
        var target = scope.querySelector(selector);
        if (target) return target;
      } catch (e) {}
    }
    return null;
  }
  function resolveTarget(step) {
    var selector = _focusSelector || (typeof step.target === "function" ? step.target() : step.target);
    // 动态 target 函数可返回元素本身（如"最后一个已完成面板"），直接使用
    if (selector && typeof selector === "object" && selector.nodeType === 1) return selector;
    return firstTarget(selector);
  }
  function isFinalStep(index) { return !!TOUR_STEPS[index] && !!TOUR_STEPS[index].final; }
  // requireMinimized 守卫（第 4 步）：最后一个（最新创建）面板必须已最小化才能推进。
  // 用户点击药丸框可重新展开面板（失去 minimized 类）——此时不允许「下一步」
  function minimizeGatePassed() {
    try {
      var list = document.querySelectorAll(".deep-window");
      if (!list || !list.length) return false;
      var last = list[list.length - 1];
      return !!(last.classList && last.classList.contains("minimized"));
    } catch (e) { return false; }
  }
  // 填入示例按语言切换：英文模式优先 autoFillEn（如最后一步的英文提问示例）
  function autoFillFor(step) {
    if (step.autoFillEn && currentLanguage() === "en") return step.autoFillEn;
    return step.autoFill;
  }
  function isAutoNextStep(index, eventName) {
    var step = TOUR_STEPS[index];
    return !!step && !!step.autoNext && step.autoNext === eventName;
  }
  function currentStepIndex() { return _stepIndex; }
  function stepCount() { return TOUR_STEPS.length; }
  function isActive() { return _active; }
  function phase() { return _tourPhase; }
  function canAdvance() {
    return _stepIndex !== 3 || _tourPhase === "memory-revealed";
  }
  function _syncStepPhase(step) {
    if (step && step.id === "deep-window") {
      if (_tourPhase !== "await-report") _tourPhase = "move-assistant";
    } else if (step && step.id === "add-to-chat") {
      if (_tourPhase !== "await-add" && _tourPhase !== "await-minimize" && _tourPhase !== "memory-revealed") {
        _tourPhase = "await-add";
      }
    } else {
      _tourPhase = null;
    }
  }

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
        var input = firstTarget(["#chatbotModernRoot [data-chatbot-report-input]", "#chatbotModernRoot [data-chatbot-input]", "#chatInput"]);
        if (input) {
          input.value = autoFillFor(TOUR_STEPS[_stepIndex]);
          try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
          input.focus();
        }
        // 步骤配置了 autoFillFocus → 高光转移到该元素（如发送按钮），引导用户发送。
        // 不能立即转移：高光一旦跳走，输入框落入遮罩虚化区（blur+半透明），用户
        // 看不清刚填入的示例内容。先让高光在输入框停留约 1.6s 展示示例，再自动
        // 滑到发送按钮。复用 _focusTimer——advance/goBack/stopTour 均会清理它：
        // 期间用户提前点发送推进步骤时，本定时器自然失效，不会误打高光。
        var focusSel = TOUR_STEPS[_stepIndex].autoFillFocus;
        if (focusSel) {
          if (_focusTimer) { clearTimeout(_focusTimer); _focusTimer = null; }
          _focusTimer = setTimeout(function () {
            _focusTimer = null;
            if (!_active) return;
            _focusSelector = focusSel;
            _retarget();
          }, 1600);
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
    var isChatMode = false;
    try {
      isChatMode = !!(el && el.closest && el.closest(".welcome-float.mode-chat"));
    } catch (e) {}
    _highlightEl.classList.toggle("onboarding-highlight-chat", isChatMode);
    _highlightEl.style.display = "block";
    _highlightEl.style.left = (rect.left - 6) + "px";
    _highlightEl.style.top = (rect.top - 6) + "px";
    _highlightEl.style.width = (rect.width + 12) + "px";
    _highlightEl.style.height = (rect.height + 12) + "px";
  }

  function _positionPopover(el, follow) {
    var step = TOUR_STEPS[_stepIndex];
    // 固定视口底部中央（第 5 步）：投放区在聊天区顶部，默认气泡位置会盖住它。
    // follow=true 表示步骤内高光重定位（如拖入记忆栏后）——气泡改为跟随新目标
    // 定位（记忆栏在视口底部，默认逻辑会把它放到记忆栏上方），避免盖住高亮目标
    if (step && step.popover === "bottom-center" && !follow) {
      _popoverEl.style.left = Math.max(12, (window.innerWidth - 360) / 2) + "px";
      _popoverEl.style.top = Math.max(12, window.innerHeight - 240) + "px";
      return;
    }
    var rect = el.getBoundingClientRect();
    var pw = 360;
    var left = Math.min(Math.max(12, rect.left + rect.width / 2 - pw / 2), window.innerWidth - pw - 12);
    // 按气泡真实高度定位（内容先于定位渲染，offsetHeight 准确）：优先放目标下方，
    // 放不下再放上方——硬编码 220px 估算在气泡实际更高时会压住高光目标
    var popH = 0;
    try { popH = _popoverEl.offsetHeight || 0; } catch (e) {}
    if (popH < 60) popH = 240; // 兜底：测量不可用（如测试环境）时沿用估算
    var gap = 16;
    var below = rect.bottom + gap;
    var above = rect.top - gap - popH;
    var top;
    if (below + popH <= window.innerHeight - 12) {
      top = below;                 // 下方放得下
    } else if (above >= 12) {
      top = above;                 // 下方放不下，上方放得下
    } else {
      top = Math.max(12, above);   // 上下都放不下（超高气泡/短视口）：贴顶兜底，尽量少挡
    }
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

  // 重渲染气泡内容（按钮状态）并同步重定位——classObserver 在面板获得/失去
  // minimized 类时调用：第 4 步「下一步」随最小化状态实时启用/禁用，
  // 按钮文案变化可能引起气泡高度变化，需按新高度重新摆放（不压住高光目标）
  function _refreshActionButtons() {
    var step = TOUR_STEPS[_stepIndex];
    if (!step || !_active) return;
    _renderPopoverContent(step, copy(currentLanguage()));
    if (_targetEl) _positionPopover(_targetEl);
  }

  // 步骤内高光转移：按 _focusSelector 重新解析目标并重绘遮罩/高亮/气泡。
  function _retarget() { _retargetTo(null); }
  function _retargetTo(el) {
    var step = TOUR_STEPS[_stepIndex];
    if (!step || !_active) return;
    if (!el) {
      try {
        if (_focusSelector === ".deep-window-minimize") {
          var panels = document.querySelectorAll(".deep-window");
          var lastPanel = panels && panels.length ? panels[panels.length - 1] : null;
          el = lastPanel && lastPanel.querySelector ? firstTarget(_focusSelector, lastPanel) : null;
        } else {
          el = firstTarget(_focusSelector);
        }
      } catch (e) {}
    }
    if (!el) return;
    _targetEl = el;
    _positionMask(step, el);
    _positionHighlight(el);
    _positionPopover(el, true);
    if (_resizeObserver) {
      try { _resizeObserver.disconnect(); } catch (e) {}
      try { _resizeObserver.observe(el); } catch (e) {}
    }
  }

  function _queueRetarget() {
    _retarget();
    var retryCount = 0;
    (function retryFocus() {
      if (!_active) return;
      if (retryCount++ >= 4) return;
      _retarget();
      _focusTimer = setTimeout(retryFocus, 120);
    })();
  }

  function _revealMemoryPhase() {
    if (!_active || _stepIndex !== 3 || _tourPhase !== "await-minimize") return;
    _tourPhase = "memory-revealed";
    _focusSelector = ["#chatbotModernRoot [data-chatbot-memory-bar]", "#chatMemoryBar"];
    _bodyKeyOverride = "step3MemoryBody";
    var bar = null;
    var chip = null;
    try {
      bar = firstTarget(["#chatbotModernRoot [data-chatbot-memory-bar]", "#chatMemoryBar"]);
      if (bar && bar.classList) bar.classList.add("onboarding-memory-reveal");
      if (bar && bar.querySelector) {
        chip = bar.querySelector(".chat-memory-chip:last-child, [data-chatbot-memory-item]:last-child");
        if (chip && chip.classList) chip.classList.add("onboarding-memory-chip-reveal");
      }
    } catch (e) {}
    if (_memoryRevealTimer) { clearTimeout(_memoryRevealTimer); _memoryRevealTimer = null; }
    if (bar || chip) {
      _memoryRevealTimer = setTimeout(function () {
        _memoryRevealTimer = null;
        try {
          if (bar && bar.classList) bar.classList.remove("onboarding-memory-reveal");
          if (chip && chip.classList) chip.classList.remove("onboarding-memory-chip-reveal");
        } catch (e) {}
      }, 1800);
    }
    _queueRetarget();
    _refreshActionButtons();
  }

  function _renderPopoverContent(step, c) {
    var bodyKey = step.copyKey + "Body";
    if (_bodyKeyOverride) bodyKey = _bodyKeyOverride;
    var html = "";
    var titleKey = _titleKeyOverride || (step.copyKey + "Title");
    html += '<div class="onboarding-popover-title">' + c[titleKey] + '</div>';
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
    // add-to-chat 第三步的内部阶段：加入对话后必须先完成最小化，再开放 Next。
    if (step.id === "deep-window" && _tourPhase === "move-assistant") {
      html += '<button class="onboarding-btn onboarding-btn-primary onboarding-btn-hint" type="button" disabled>' +
        c.step2MoveHint + '</button>';
    // add-to-chat 第三步的内部阶段：加入对话后必须先完成最小化，再开放 Next。
    } else if (step.id === "add-to-chat" && _tourPhase !== "memory-revealed") {
      var phaseHint = _tourPhase === "await-minimize" ? c.step3MinimizeHint : c.step3NextHint;
      html += '<button class="onboarding-btn onboarding-btn-primary onboarding-btn-hint" type="button" disabled>' +
        phaseHint + '</button>';
    // autoNext 步骤无主按钮（点击目标即自动推进或结束）：主按钮位置渲染置灰的
    // 动作提示（如「点击「发送」按钮继续」），既引导操作又防新用户误点「跳过」
    } else if (step.autoNext) {
      var hintKey = step.copyKey + "NextHint";
      if (c[hintKey]) {
        html += '<button class="onboarding-btn onboarding-btn-primary onboarding-btn-hint" type="button" disabled>' +
          c[hintKey] + '</button>';
      }
    } else if (step.requireMinimized && !minimizeGatePassed()) {
      // 第 4 步未最小化：禁用「下一步」（用户点击药丸展开面板后不能继续），
      // 主按钮位置渲染置灰提示；面板获得 minimized 类后由 classObserver 刷新恢复
      html += '<button class="onboarding-btn onboarding-btn-primary onboarding-btn-hint" type="button" disabled>' +
        c.minimizeRequired + '</button>';
    } else {
      html += '<button class="onboarding-btn onboarding-btn-primary" data-tour-action="' +
        (step.final ? "finish" : "next") + '" type="button">' + (step.final ? c.finish : c.next) + '</button>';
    }
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
    var titleKey = _titleKeyOverride || (step.copyKey + "Title");
    html += '<div class="onboarding-popover-title">' + c[titleKey] + '</div>';
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
    // 清残留 probe 链：语言切换等触发重渲染时，旧链超时后可能误 advance 踢走当前步骤
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    var step = TOUR_STEPS[_stepIndex];
    if (!step) { stopTour(); return; }
    var c = copy(currentLanguage());
    _syncStepPhase(step);
    _bodyKeyOverride = null;
    _titleKeyOverride = null;
    if (step.id === "deep-window" && _tourPhase === "move-assistant") {
      _focusSelector = ".welcome-float";
      _bodyKeyOverride = "step2MoveBody";
      _titleKeyOverride = "step2MoveTitle";
      _setChatbotTourDragEnabled(true);
    } else if (step.id === "deep-window") {
      _setChatbotTourDragEnabled(false);
    }
    if (step.id === "add-to-chat") {
      if (_tourPhase === "await-minimize") _bodyKeyOverride = "step3MinimizeBody";
      if (_tourPhase === "memory-revealed") _bodyKeyOverride = "step3MemoryBody";
    }
    _renderWaiting(step, c); // 先渲染等待态（目标未出现时给出反馈），命中后由 done 回调覆盖
    _locateTarget(step, function (el) {
      if (!_active) return;
      _targetEl = el;
      _positionMask(step, el);
      _positionHighlight(el);
      // 先渲染气泡内容再定位——_positionPopover 按真实高度（offsetHeight）摆放，
      // 若先定位后渲染，测到的是旧内容的高度，气泡会压住高光目标
      _renderPopoverContent(step, c);
      _positionPopover(el);
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
    var cur = TOUR_STEPS[_stepIndex];
    if (_stepIndex === 2 && _tourPhase !== "await-report") return;
    if (_stepIndex === 3 && _tourPhase !== "memory-revealed") return;
    // requireMinimized 守卫（第 4 步）：面板未最小化（如用户点击药丸重新展开）时禁止推进——
    // 与渲染守卫双保险，后续步骤（第 5/6 步）依赖 `.deep-window.minimized` 目标
    if (cur && cur.requireMinimized && !minimizeGatePassed()) return;
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    if (_autoNextTimer) { clearTimeout(_autoNextTimer); _autoNextTimer = null; }
    if (_focusTimer) { clearTimeout(_focusTimer); _focusTimer = null; }
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
    if (_autoNextTimer) { clearTimeout(_autoNextTimer); _autoNextTimer = null; }
    if (_focusTimer) { clearTimeout(_focusTimer); _focusTimer = null; }
    _focusSelector = null;
    if (_stepIndex > 0) {
      _stepIndex--;
      _renderStep();
    }
  }
  function notify(eventName) {
    if (!_active) return;
    var step = TOUR_STEPS[_stepIndex];
    if (!step) return;
    if (_stepIndex === 2 && (_tourPhase === "move-assistant" || _tourPhase === "await-report")) {
      if (eventName === "assistant-panel-drag") {
        if (_targetEl) _reposition();
        return;
      }
      if (eventName === "assistant-panel-drag-end" && _tourPhase === "move-assistant") {
        _tourPhase = "await-report";
        _focusSelector = null;
        _bodyKeyOverride = null;
        _titleKeyOverride = null;
        _setChatbotTourDragEnabled(false);
        _renderStep();
        return;
      }
    }
    if (_stepIndex === 3 && eventName === "chat-add") {
      if (_tourPhase !== "await-add") return;
      _tourPhase = "await-minimize";
      _focusSelector = step.autoNextFocus;
      _bodyKeyOverride = "step3MinimizeBody";
      _queueRetarget();
      _refreshActionButtons();
      return;
    }
    if (_stepIndex === 3 && eventName === step.nextPhaseOn) {
      _revealMemoryPhase();
      return;
    }
    var isAutoNext = isAutoNextStep(_stepIndex, eventName);
    var isFocusEvent = step.focusOn === eventName;
    if (!isAutoNext && !isFocusEvent) return;
    // focusOn + autoNextFocus：事件触发后高光转移到指定目标展示效果，不自动推进。
    // 目标就绪后一次重定位即可，补几次短延时定位兜底（布局微调）
    if (isFocusEvent && step.autoNextFocus) {
      _focusSelector = step.autoNextFocus;
      _retarget();
      var retryCount = 0;
      (function retryFocus() {
        if (!_active) return;
        if (retryCount++ >= 4) return;
        _retarget();
        _focusTimer = setTimeout(retryFocus, 120);
      })();
    }
    if (step.autoNextDelay) {
      var idx = _stepIndex;
      _autoNextTimer = setTimeout(function () {
        _autoNextTimer = null;
        if (_active && _stepIndex === idx) advance();
      }, step.autoNextDelay);
      return;
    }
    if (isAutoNext) advance();
  }

  function _clearTimers() {
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    if (_autoNextTimer) { clearTimeout(_autoNextTimer); _autoNextTimer = null; }
    if (_focusTimer) { clearTimeout(_focusTimer); _focusTimer = null; }
    if (_memoryRevealTimer) { clearTimeout(_memoryRevealTimer); _memoryRevealTimer = null; }
    if (_autoStartTimer) { clearTimeout(_autoStartTimer); _autoStartTimer = null; }
  }

  function stopTour() {
    var wasActive = _active;
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
    _tourPhase = null;
    _bodyKeyOverride = null;
    _titleKeyOverride = null;
    _focusSelector = null;
    _setChatbotTourDragEnabled(false);
    if (wasActive) _setChatbotTourState(false);
  }
  function finishTour() { stopTour(); markCompleted(); }
  function skipTour() { markCompleted(); stopTour(); }

  // 重播时若当前处于 Chat Mode，先自动切回 Report Mode——引导从「整体布局介绍」
  // 开始，核心流程（第 2~3 步 Report Mode 提问、生成报告）都建立在 Report Mode 上。
  // 直接点击 [data-mode="deep"] 走 app.js 官方切换路径（state.deepMode / 聊天区/记忆栏
  // 同步更新），比手动改状态安全。首次自动弹出时默认就是 Report Mode，判断不命中、无动作。
  function _ensureReportMode() {
    try {
      var chatBtn = firstTarget(['#chatbotModernRoot [data-chatbot-mode-button="chat"]', '[data-mode="fast"]']);
      var chatActive = chatBtn && chatBtn.classList && chatBtn.classList.contains("active");
      if (chatBtn && typeof chatBtn.getAttribute === "function" && chatBtn.getAttribute("aria-selected") === "true") chatActive = true;
      if (!chatActive) return;
      var reportBtn = firstTarget(['#chatbotModernRoot [data-chatbot-mode-button="report"]', '[data-mode="deep"]']);
      if (reportBtn && reportBtn.click) reportBtn.click();
    } catch (e) {}
  }

  function _setChatbotTourState(active) {
    try {
      var assistant = window.CHATBOT_WELCOME;
      if (!assistant) return;
      if (active && assistant.prepareForTour) assistant.prepareForTour();
      if (!active && assistant.endTour) assistant.endTour();
    } catch (e) {}
  }

  function _setChatbotTourDragEnabled(enabled) {
    try {
      var assistant = window.CHATBOT_WELCOME;
      if (assistant && assistant.setTourDragEnabled) assistant.setTourDragEnabled(!!enabled);
    } catch (e) {}
  }

  function startTour() {
    if (_active) return;
    _ensureReportMode();
    _setChatbotTourState(true);
    _active = true;
    _stepIndex = 0;
    _ensureDom();
    _renderStep();
  }

  // 首次进入自动弹（app.js init() 尾部调用）；完成/跳过过则不再弹
  function maybeAutoStart() {
    if (TEST_MODE) return;
    pulseReplayButton();
    if (_active) return;
    if (!shouldShowTour()) return;
    _clearTimers();
    _autoStartTimer = setTimeout(function () {
      if (!_active && shouldShowTour()) startTour();
    }, 800);
  }

  // 仪表盘数据加载完成后提醒用户顶部的「新手引导」入口；动画只播放一次，
  // 计时结束移除 class，避免持续打扰已经熟悉页面的用户。
  function pulseReplayButton() {
    var btn = null;
    try { btn = document.getElementById("reportHelpTourBtn"); } catch (e) {}
    if (!btn || !btn.classList) return false;
    if (_replayButtonPulseTimer) {
      clearTimeout(_replayButtonPulseTimer);
      _replayButtonPulseTimer = null;
    }
    btn.classList.remove("onboarding-tour-btn-attention");
    // 允许重复触发时重新建立 CSS animation 的起点；页面首次打开时也保持确定性。
    void btn.offsetWidth;
    btn.classList.add("onboarding-tour-btn-attention");
    _replayButtonPulseTimer = setTimeout(function () {
      _replayButtonPulseTimer = null;
      try { btn.classList.remove("onboarding-tour-btn-attention"); } catch (e) {}
    }, REPLAY_BUTTON_PULSE_MS);
    return true;
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

  // ── 自动推进事件监听（模块级注册一次）──────────────────────────
  // 发送：chatForm submit（含点击发送按钮与回车）→ "sent"
  // 加入对话：浮窗头部「加入对话」按钮点击 → "chat-add"
  // notify() 内部校验 isAutoNextStep，非当前自动步骤的事件一律忽略
  try {
    document.addEventListener("submit", function (e) {
      if (!e.target) return;
      if (e.target.id === "chatForm" || (e.target.matches && e.target.matches("#chatbotModernRoot [data-chatbot-report-form], #chatbotModernRoot [data-chatbot-composer]"))) notify("sent");
    });
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".welcome-float-dot")) {
        notify("assistant-opened");
        return;
      }
      if (e.target && e.target.closest && e.target.closest('.deep-window-chat-add, [data-deep-window-action="add-memory"]')) notify("chat-add");
    });
  } catch (e) {}

  // ── 语言跟随：页面切换语言（app.js applyStaticLanguage 更新 <html lang>）时 ──
  // 同步重渲染引导气泡（标题/正文/按钮/步骤条全部跟随页面中英文模式）
  try {
    new MutationObserver(function () {
      if (_active) _renderStep();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  } catch (e) {}

  // ── autoNextFocus 兜底 + requireMinimized 守卫刷新：浮窗元素 class 属性变化的瞬间
  // （最小化动画 settle 获得 minimized 类 / 用户点击药丸重新展开失去类）——① 获得类时
  // 立即重定位高光到药丸框（类名观察比 150ms 轮询精确）；② 第 4 步「下一步」按钮随
  // 状态实时启用/禁用（失去类时也必须刷新，否则按钮保持可点但 advance 守卫拦截，体验不一致）
  try {
    new MutationObserver(function (muts) {
      if (!_active) return;
      var step = TOUR_STEPS[_stepIndex];
      if (!step) return;
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.matches && t.matches(".welcome-float") && _targetEl && t.contains && t.contains(_targetEl)) {
          _positionHighlight(_targetEl);
          continue;
        }
        if (!t || !t.matches || !t.matches(".deep-window")) continue;
        var panels = document.querySelectorAll(".deep-window");
        var latestPanel = panels && panels.length ? panels[panels.length - 1] : null;
        if (t !== latestPanel) continue;
        if (_stepIndex === 3 && _tourPhase === "await-minimize" &&
            t.classList && t.classList.contains("minimized")) {
          _revealMemoryPhase();
          return;
        }
        if (step.requireMinimized) _refreshActionButtons();
        if (_focusSelector && t.classList && t.classList.contains("minimized")) _retarget();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  } catch (e) {}

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
      phase: phase,
      canAdvance: canAdvance,
      stepCount: stepCount,
      autoFillFor: autoFillFor,
      minimizeGatePassed: minimizeGatePassed,
      highlightPosition: function () {
        return _highlightEl && _highlightEl.style ? {
          left: _highlightEl.style.left,
          top: _highlightEl.style.top,
          width: _highlightEl.style.width,
          height: _highlightEl.style.height
        } : null;
      },
      pulseReplayButton: pulseReplayButton,
      replayButtonPulseDuration: function () { return REPLAY_BUTTON_PULSE_MS; },
      refreshActions: _refreshActionButtons,
      renderStep: _renderStep,
      popoverHtml: function () { return _popoverEl ? _popoverEl.innerHTML : ""; }
    }
  };
})();
