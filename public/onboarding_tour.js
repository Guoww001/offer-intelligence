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
      introTitle: "👋 欢迎使用 YeahPromos 助手",
      introBody: "先认识整体布局：聊天区顶部可切换 Report Mode（提问获取数据报告）与 Chat Mode（带着数据对话），输入商户名 / Merchant ID / ASIN 或品类即可查询；报告以浮窗展示，可最小化并拖入记忆栏作为对话上下文。下面我们实际操作一遍。",
      step1Title: "第 1 步：在 Report Mode 提问",
      step1Body: "在输入框输入商户名 / Merchant ID / ASIN 或品类，就能获取后台数据分析报告。填好后点击右侧「发送」按钮发起查询。试试看：",
      step2Title: "第 2 步：等待分析报告",
      step2Body: "报告在浮窗中打开。浮窗可以随意拖动，也能最小化，还支持一键导出 Excel。",
      step3Title: "第 3 步：点击最小化",
      step3Body: "点击浮窗头部的「─」按钮，把浮窗最小化成一个药丸小框——只有最小化后的浮窗才能拖入记忆栏。",
      step4Title: "第 4 步：切换到 Chat Mode",
      step4Body: "点击上方「Chat Mode」按钮，聊天区上方会出现记忆栏——这是把数据带进对话的入口。",
      step5Title: "第 5 步：拖入记忆栏",
      step5Body: "按住药丸框头部不放，把它拖到聊天区上方的「将面板拖入此处作为上下文」区域后松开，报告就会成为聊天上下文。",
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
      waitReport: "等待报告生成…",
      // autoNext 步骤主按钮（置灰不可点）的动作提示——防止新用户误点「跳过」
      step1NextHint: "点击「发送」按钮继续",
      step4NextHint: "点击「Chat Mode」按钮继续",
      step5NextHint: "把药丸框拖入记忆栏后继续",
      step6NextHint: "点击「发送」按钮完成",
      // 第 4 步：未最小化时「下一步」禁用的提示（用户点击药丸展开后不能继续）
      minimizeRequired: "请先点击「─」最小化浮窗",
      // 第 5 步投放区上方独立浮动提示条
      dropzoneTip: "拖到这里 👇"
    },
    en: {
      introTitle: "👋 Welcome to the YeahPromos Assistant",
      introBody: "Here's the layout: the top of the chat area toggles between Report Mode (ask for data reports) and Chat Mode (chat with context); type a merchant name / ID / ASIN or category to query. Reports open in a floating window that you can minimize and drag into the memory bar as chat context. Let's walk through it.",
      step1Title: "Step 1: Ask in Report Mode",
      step1Body: "Type a merchant name / ID / ASIN or category to get a data analysis report. Click the Send button on the right to submit. Try it:",
      step2Title: "Step 2: Wait for the report",
      step2Body: "Reports open in a floating window you can drag around, minimize, or export to Excel.",
      step3Title: "Step 3: Minimize the window",
      step3Body: "Click the “–” button in the window header to shrink it into a pill — only minimized panels can be dragged into the memory bar.",
      step4Title: "Step 4: Switch to Chat Mode",
      step4Body: "Click the Chat Mode button above; a memory bar appears above the chat area — the way to bring data into the conversation.",
      step5Title: "Step 5: Drag into the memory bar",
      step5Body: "Press and hold the pill header, drag it to the “drag the panel here as context” area above the chat, then release — the report becomes chat context.",
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
      waitReport: "Waiting for the report…",
      // autoNext 步骤主按钮（置灰不可点）的动作提示——防止新用户误点「Skip」
      step1NextHint: "Click Send to continue",
      step4NextHint: "Click Chat Mode to continue",
      step5NextHint: "Drag the pill into the memory bar to continue",
      step6NextHint: "Click Send to finish",
      // Step 4: Next disabled until the panel is minimized (user may re-expand the pill)
      minimizeRequired: "Minimize the panel first (click the “–” button)",
      // Step 5 dropzone floating tip above the drop area
      dropzoneTip: "Drag it here 👇"
    }
  };

  // ── 步骤数据（纯数据；target 可为选择器字符串、返回选择器的函数或返回元素的函数）──
  var TOUR_STEPS = [
    {
      id: "intro",
      // 第 1 步：整体布局 + chatbot 应用场景介绍（高亮模式切换入口）
      target: "#chatModeToggle",
      copyKey: "intro",
      mask: "block"
    },
    {
      id: "report-ask",
      target: "#chatInput",
      copyKey: "step1",
      mask: "block",
      autoFill: "Shokz",
      // 用户点击「帮我填入示例」后，高光从输入框转移到发送按钮，引导点击发送
      autoFillFocus: '#chatForm button[type="submit"]',
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
      id: "minimize-window",
      target: function () {
        // 取最后一个（最新创建）面板的最小化按钮：重播/二次使用时旧面板仍在页面，
        // querySelector 匹配第一个会命中旧面板的按钮——若旧面板已是最小化 pill，
        // 其最小化按钮被 CSS 隐藏（rect 为 0），高光将不可见
        try {
          var list = document.querySelectorAll(".deep-window");
          if (!list || !list.length) return null;
          var last = list[list.length - 1];
          var btn = last.querySelector ? last.querySelector(".deep-window-minimize") : null;
          return btn || null;
        } catch (e) { return null; }
      },
      copyKey: "step3",
      mask: "block",
      // 点击最小化按钮后：高光从动画开始高频跟随并停在药丸框展示最小化效果。
      // 不自动推进——用户看效果后手动点「下一步」进入下一步
      focusOn: "minimized",
      autoNextFocus: ".deep-window.minimized",
      // 必须最小化后才能「下一步」：用户可能点击药丸框重新展开面板（失去 minimized 类），
      // 此时推进到后续步骤会找不到 `.deep-window.minimized` 目标而引导错乱——因此
      // 未最小化时「下一步」禁用（渲染守卫 + advance 守卫），面板获得/失去 minimized 类
      // 时由 classObserver 实时刷新按钮状态
      requireMinimized: true
    },
    {
      id: "switch-chat",
      target: '[data-mode="fast"]',
      copyKey: "step4",
      mask: "block",
      // 点击 Chat Mode 按钮后自动进入下一步
      autoNext: "switched"
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
      // 拖入记忆栏后：高光转移到上下文区域（记忆栏）展示效果——新芯片已渲染进记忆栏，
      // 与第 4 步最小化一样不自动推进，用户看效果后手动点「下一步」
      focusOn: "memory-added",
      autoNextFocus: "#chatMemoryBar",
      // 气泡固定视口底部中央：投放区在聊天区顶部，默认气泡位置（目标上方/下方）会盖住它
      popover: "bottom-center"
    },
    {
      id: "chat-ask",
      target: "#chatInput",
      copyKey: "step6",
      mask: "block",
      autoFill: "根据刚才的报告，给我分析建议",
      // 英文模式下填入英文示例（autoFillEn）
      autoFillEn: "Based on the report, give me some analysis suggestions",
      // 填示例后高光转移到发送按钮，点击发送后自动结束引导
      autoFillFocus: '#chatForm button[type="submit"]',
      autoNext: "sent",
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
  var _autoNextTimer = null; // 自动推进延迟（展示最小化效果后再前进）
  var _focusTimer = null;    // 高光转移补定位轮询（等最小化动画完成后指向药丸框）
  var _dropzoneTip = null;   // 第 5 步投放区上方独立浮动提示条（防被气泡遮挡）
  var _pendingPillEl = null; // 用户点击最小化的面板元素（药丸高光直接指向它，避免误查其他面板）

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
    // 动态 target 函数可返回元素本身（如"最后一个已完成面板"），直接使用
    if (selector && typeof selector === "object" && selector.nodeType === 1) return selector;
    try { return document.querySelector(selector); } catch (e) { return null; }
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
          input.value = autoFillFor(TOUR_STEPS[_stepIndex]);
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

  // 拖拽提示：第 5 步给记忆栏投放区加脉冲动画类（styles.css .onboarding-dropzone-hint），
  // 另加独立浮动提示条固定在投放区上方——气泡在视口底部中央，提示条贴近投放区不被遮挡
  function _addDropzoneHint() {
    try {
      var dz = document.getElementById("chatMemoryDropzone");
      if (dz) dz.classList.add("onboarding-dropzone-hint");
    } catch (e) {}
    if (!_dropzoneTip) {
      var tip = document.createElement("div");
      tip.className = "onboarding-dropzone-tip";
      document.body.appendChild(tip);
      _dropzoneTip = tip;
    }
    _positionDropzoneTip();
  }
  function _positionDropzoneTip() {
    if (!_dropzoneTip) return;
    try { _dropzoneTip.textContent = copy(currentLanguage()).dropzoneTip; } catch (e) {}
    var dz = null;
    try { dz = document.getElementById("chatMemoryDropzone"); } catch (e) {}
    if (dz) {
      var r = dz.getBoundingClientRect();
      _dropzoneTip.style.left = Math.round(r.left + r.width / 2) + "px";
      _dropzoneTip.style.top = Math.round(r.top - 46) + "px";
    } else {
      _dropzoneTip.style.left = "50%";
      _dropzoneTip.style.top = "150px";
    }
    _dropzoneTip.style.transform = "translateX(-50%)";
  }
  // 仅重渲染气泡内容（按钮状态），不重新定位——classObserver 在面板获得/失去
  // minimized 类时调用：第 4 步「下一步」随最小化状态实时启用/禁用
  function _refreshActionButtons() {
    var step = TOUR_STEPS[_stepIndex];
    if (!step || !_active) return;
    _renderPopoverContent(step, copy(currentLanguage()));
  }

  function _removeDropzoneHint() {
    try {
      var dz = document.getElementById("chatMemoryDropzone");
      if (dz) dz.classList.remove("onboarding-dropzone-hint");
    } catch (e) {}
    if (_dropzoneTip) {
      try { if (_dropzoneTip.parentNode) _dropzoneTip.parentNode.removeChild(_dropzoneTip); } catch (e) {}
      _dropzoneTip = null;
    }
  }

  // 步骤内高光转移：按 _focusSelector 重新解析目标并重绘遮罩/高亮/气泡。
  // 也可显式传入目标元素（如药丸高光直接指向用户点击最小化的那个面板，位置必然正确）
  function _retarget() { _retargetTo(null); }
  function _retargetToPill() {
    var el = _pendingPillEl;
    if (el && el.classList && el.classList.contains("minimized")) _retargetTo(el);
  }
  function _retargetTo(el) {
    var step = TOUR_STEPS[_stepIndex];
    if (!step || !_active) return;
    if (!el) {
      try { el = document.querySelector(_focusSelector); } catch (e) {}
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
    // autoNext 步骤无主按钮（点击目标即自动推进或结束）：主按钮位置渲染置灰的
    // 动作提示（如「点击「发送」按钮继续」），既引导操作又防新用户误点「跳过」
    if (step.autoNext) {
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
    // 清残留 probe 链：语言切换等触发重渲染时，旧链超时后可能误 advance 踢走当前步骤
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    var step = TOUR_STEPS[_stepIndex];
    if (!step) { stopTour(); return; }
    var c = copy(currentLanguage());
    _bodyKeyOverride = null;
    if (step.id === "drag-memory") {
      var bar = null;
      try { bar = document.getElementById("chatMemoryBar"); } catch (e) {}
      if (!bar || bar.classList.contains("hidden")) {
        _bodyKeyOverride = "step5NeedSwitchBody";
      } else {
        _addDropzoneHint();
      }
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
    var cur = TOUR_STEPS[_stepIndex];
    // requireMinimized 守卫（第 4 步）：面板未最小化（如用户点击药丸重新展开）时禁止推进——
    // 与渲染守卫双保险，后续步骤（第 5/6 步）依赖 `.deep-window.minimized` 目标
    if (cur && cur.requireMinimized && !minimizeGatePassed()) return;
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    if (_autoNextTimer) { clearTimeout(_autoNextTimer); _autoNextTimer = null; }
    if (_focusTimer) { clearTimeout(_focusTimer); _focusTimer = null; }
    _focusSelector = null;
    _pendingPillEl = null;
    _removeDropzoneHint();
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
    _pendingPillEl = null;
    _removeDropzoneHint();
    if (_stepIndex > 0) {
      _stepIndex--;
      _renderStep();
    }
  }
  function notify(eventName) {
    if (!_active) return;
    var step = TOUR_STEPS[_stepIndex];
    if (!step) return;
    var isAutoNext = isAutoNextStep(_stepIndex, eventName);
    var isFocusEvent = step.focusOn === eventName;
    if (!isAutoNext && !isFocusEvent) return;
    // focusOn + autoNextFocus：事件触发后高光转移到指定目标展示效果，不自动推进。
    // 两种转移方式，按事件来源区分：
    // ① 最小化（第 4 步，_pendingPillEl 已记录）：最小化动画期间 transform 移动不触发
    //    ResizeObserver，且 pill 需 250ms~800ms 才 settle（加 minimized 类）——因此从
    //    点击瞬间起每 80ms 高频跟随重定位：动画中高光圈贴着 pill 飞行（位置永不丢失），
    //    动画结束 rect 收敛到最终位置后再跟若干次确保稳定，然后停止。定位直接使用
    //    _pendingPillEl（用户点击最小化的那个面板）——比全局 querySelector 精确。
    // ② 拖入记忆栏（第 6 步，无 _pendingPillEl）：_addMemoryFromPanel 已同步渲染新芯片，
    //    目标就绪，一次重定位即可，补几次短延时定位兜底（芯片/布局微调）
    if (isFocusEvent && step.autoNextFocus) {
      _focusSelector = step.autoNextFocus;
      if (_pendingPillEl) {
        _retargetToPill();
        var followCount = 0;
        var totalFollow = 0;
        (function followPill() {
          if (!_active) return;
          if (totalFollow++ >= 40) return; // 3.2s 兜底，防无限循环
          var el = _pendingPillEl;
          if (el) {
            _retargetTo(el);
            if (el.classList && el.classList.contains("minimized") && followCount++ >= 10) return;
          }
          _focusTimer = setTimeout(followPill, 80);
        })();
      } else {
        _retarget();
        var retryCount = 0;
        (function retryFocus() {
          if (!_active) return;
          if (retryCount++ >= 4) return;
          _retarget();
          _focusTimer = setTimeout(retryFocus, 120);
        })();
      }
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
    if (_autoStartTimer) { clearTimeout(_autoStartTimer); _autoStartTimer = null; }
    _pendingPillEl = null;
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
    _removeDropzoneHint();
  }
  function finishTour() { stopTour(); markCompleted(); }
  function skipTour() { markCompleted(); stopTour(); }

  // 重播时若当前处于 Chat Mode，先自动切回 Report Mode——引导从「整体布局介绍」
  // 开始，核心流程（第 2~3 步 Report Mode 提问、生成报告）都建立在 Report Mode 上。
  // 直接点击 [data-mode="deep"] 走 app.js 官方切换路径（state.deepMode / 聊天区/记忆栏
  // 同步更新），比手动改状态安全。首次自动弹出时默认就是 Report Mode，判断不命中、无动作。
  function _ensureReportMode() {
    try {
      var fastBtn = document.querySelector('[data-mode="fast"]');
      if (!fastBtn || !fastBtn.classList || !fastBtn.classList.contains("active")) return;
      var deepBtn = document.querySelector('[data-mode="deep"]');
      if (deepBtn && deepBtn.click) deepBtn.click();
    } catch (e) {}
  }

  function startTour() {
    if (_active) return;
    _ensureReportMode();
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

  // ── 自动推进事件监听（模块级注册一次）──────────────────────────
  // 发送：chatForm submit（含点击发送按钮与回车）→ "sent"
  // 最小化：浮窗头部「─」按钮点击 → "minimized"
  // 切模式：Chat Mode 按钮点击 → "switched"
  // notify() 内部校验 isAutoNextStep，非当前自动步骤的事件一律忽略
  try {
    document.addEventListener("submit", function (e) {
      if (e.target && e.target.id === "chatForm") notify("sent");
    });
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".deep-window-minimize")) {
        // 记录被点击最小化的面板元素——药丸高光直接指向它，避免误定位到其他面板
        var panelEl = null;
        try { panelEl = e.target.closest(".deep-window"); } catch (err) {}
        if (panelEl) _pendingPillEl = panelEl;
        notify("minimized");
      }
      if (e.target && e.target.closest && e.target.closest('[data-mode="fast"]')) notify("switched");
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
        if (!t || !t.matches || !t.matches(".deep-window")) continue;
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
      stepCount: stepCount,
      autoFillFor: autoFillFor,
      minimizeGatePassed: minimizeGatePassed,
      refreshActions: _refreshActionButtons,
      renderStep: _renderStep,
      popoverHtml: function () { return _popoverEl ? _popoverEl.innerHTML : ""; },
      dropzoneTipActive: function () { return !!_dropzoneTip; }
    }
  };
})();
