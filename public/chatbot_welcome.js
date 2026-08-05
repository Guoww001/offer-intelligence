(function () {
  // ── Chatbot 欢迎屏（Welcome Guide）────────────────────────────
  // 独立卡片：能力地图 + 流程示意 + 示例问题。挂在 dashboard 主网格左列顶部
  // （.main-grid.dashboard-page 第 1 行第 1 列），始终完整展开、不折叠、不受对话影响。
  // 双栏工作台布局（左「① 先获取数据」/ 右「③ 再深度分析」），示例点击即填 + 提示条贯穿
  // 「获取→分析」流程。零依赖，挂 window.CHATBOT_WELCOME。与 app.js 的交互点：
  //   1. init 尾部: window.CHATBOT_WELCOME.maybeRender("report", { offers })
  //   2. chatForm submit: window.CHATBOT_WELCOME.notify("chat-sent")   → 清提示条（不折叠）
  //   3. 模式切换: window.CHATBOT_WELCOME.notify("mode-switched", { mode, hasMemory }) → 同步记忆状态
  //      + Chat Mode 时在聊天区顶部渲染常驻提醒卡片（.chat-reminder），Report Mode 移除
  //   4. _renderPanelReport 尾部: window.CHATBOT_WELCOME.notify("report-ready", { panelEl })
  //   5. _addMemoryFromPanel 尾部: window.CHATBOT_WELCOME.notify("memory-added", { hasMemory: true })
  // 样式类 .welcome-*（见 styles.css）。

  var TEST_MODE = !!(window.__OFFER_INTELLIGENCE_TEST__);
  var FALLBACK_MERCHANT = "Shokz";

  // ── 双语文案（键集 zh/en 必须一一对应）──
  var WELCOME_COPY = {
    zh: {
      helloTitle: "我是你的运营分析助手",
      helloBody: "查商户、看风险、找机会、出建议 —— 先从左边获取数据，再拖入记忆栏到右边深度分析",
      flow1Title: "Report 提问",
      flow1Sub: "获取数据",
      flow2Title: "面板最小化",
      flow2Sub: "拖入记忆栏",
      flow3Title: "Chat 对话",
      flow3Sub: "深度分析",
      colLeftTitle: "① 先获取数据",
      colLeftTag: "REPORT",
      colRightTitle: "③ 再深度分析",
      colRightTag: "CHAT",
      colRightNote: "必须先拖入记忆栏，Chat 才有数据可答",
      tipReport: "发送后，报告生成时可点 ─ 最小化，拖入记忆栏——Chat 分析必须先有记忆栏数据",
      chatHelloTitle: "记忆栏已就绪，开始分析吧",
      chatHelloBody: "先拖入 1 份报告，再点下面的示例，我会基于它给出建议",
      chatEmptyMemory: "请先拖入报告到记忆栏",
      panelTip: "点「加入对话」一键带进对话；或点 ─ 最小化后拖入记忆栏（高级用法）",
      progressStep1: "① 在 Report 提问",
      progressStep2: "② 点「加入对话」",
      progressStep3: "③ 在 Chat 对话",
      progressAdvanced: "高级用法：最小化后拖入记忆栏",
      minimizedTip: "已最小化：切到 Chat Mode，把药丸拖到记忆栏",
      goReport: "去生成报告",
      chatReminder: "先将数据注入记忆栏，Chat才有数据可答",
      close: "关闭",
      memoryHint: "将面板拖入此处作为上下文"
    },
    en: {
      helloTitle: "I'm your operations analysis assistant",
      helloBody: "Check merchants, spot risks, find opportunities, get advice — fetch data on the left first, then drag it into memory for deep analysis on the right",
      flow1Title: "Ask in Report Mode",
      flow1Sub: "Get data",
      flow2Title: "Minimize the panel",
      flow2Sub: "Drag into memory",
      flow3Title: "Chat in Chat Mode",
      flow3Sub: "Deep analysis",
      colLeftTitle: "① Fetch data first",
      colLeftTag: "REPORT",
      colRightTitle: "③ Then analyze deeply",
      colRightTag: "CHAT",
      colRightNote: "Drag reports into memory first — Chat only answers with data in memory",
      tipReport: "After sending, click – to minimize, then drag into the memory bar — Chat analysis needs that data first",
      chatHelloTitle: "Memory ready — start analyzing",
      chatHelloBody: "Drag in a report first, then pick an example — I'll analyze based on it",
      chatEmptyMemory: "Drag a report into the memory bar first",
      panelTip: "Click “Add to chat” to start instantly, or click – to minimize and drag into the memory bar (advanced)",
      progressStep1: "① Ask in Report Mode",
      progressStep2: "② Click Add to chat",
      progressStep3: "③ Chat in Chat Mode",
      progressAdvanced: "Advanced: minimize, then drag into the memory bar",
      minimizedTip: "Minimized: switch to Chat Mode and drag the pill into the memory bar",
      goReport: "Go generate a report",
      chatReminder: "Drag reports into memory first — Chat only answers with data in memory",
      close: "Close",
      memoryHint: "Drag the panel here as context"
    }
  };

  // ── 示例数据（纯数据；dynamic 字段渲染时替换占位符）──
  // Report Mode 只做数据获取 + 趋势分析：直接输入实体名即可（商户名/品类名/Tier），
  // 趋势分析直接写"实体名 + 趋势分析"。示例即字面输入，不套"查一下…这个月表现"等修饰。
  var WELCOME_EXAMPLES = {
    report: [
      { text: "{merchant}", dynamic: "merchant" },
      { text: "Beauty 品类" },
      { text: "Tier 2" },
      { text: "{merchant}趋势分析", dynamic: "merchant" }
    ],
    chat: [
      { text: "根据记忆栏的报告，给我分析建议" },
      { text: "对比记忆栏里的两个商户，谁更值得重点投入" },
      { text: "总结记忆栏的数据，分析下个月的运营方向" }
    ]
  };

  // ── 语言 ──
  function currentLanguage() {
    try {
      var stored = localStorage.getItem("offerLanguage");
      if (stored === "zh" || stored === "en") return stored;
    } catch (e) {}
    try {
      return /^zh/i.test(document.documentElement.lang) ? "zh" : "en";
    } catch (e) {}
    return "zh";
  }
  function currentCopy(key) {
    var lang = currentLanguage();
    return (WELCOME_COPY[lang] && WELCOME_COPY[lang][key]) || WELCOME_COPY.zh[key] || key;
  }

  // ── 流程状态机：主路径 3 步（① Report 提问 → ② 加入对话 → ③ Chat 对话）──
  function flowStage(state) {
    state = state || {};
    var hasReport = !!state.hasReport;
    var hasMemory = !!state.hasMemory;
    var isChat = !!state.isChat;
    if (hasMemory && isChat) return "chatActive";
    if (hasMemory) return "memoryReady";
    if (hasReport) return "reportReady";
    return "noReport";
  }

  // ── 动态商户名：取 commission 最高的商户 ──
  function merchantForExample(offers) {
    if (!Array.isArray(offers) || !offers.length) return null;
    var ranked = offers.slice().sort(function (a, b) {
      return (Number(b.commission) || 0) - (Number(a.commission) || 0);
    });
    for (var i = 0; i < ranked.length; i++) {
      // 命中已知关键词的商户：点击示例会走 keyword 搜索而非 merchant 分析，跳过
      if (ranked[i] && ranked[i].knownKeyword === true) continue;
      var name = ranked[i] && (ranked[i].merchantName || ranked[i].merchant);
      if (name) {
        var clean = String(name).trim();
        if (clean) return clean;
      }
    }
    return null;
  }

  // ── 渲染判定与示例交互决策（纯函数）──
  // 独立卡片：挂在 dashboard 主网格（.main-grid.dashboard-page）左列顶部，
  // 作为 grid 第 1 行第 1 列子项，与聊天区（#chatLog/#chatLogChat）完全解耦。
  function containerFor() {
    return document.querySelector(".main-grid.dashboard-page");
  }
  function shouldRenderFor(mode) {
    var container = containerFor(mode);
    if (!container) return false;
    if (container.querySelector(".welcome-panel")) return false;
    return true;
  }
  // kind: "report" | "chat"（示例所属分区）
  // 决策层键 = WELCOME_COPY 文案键（单一事实源，避免渲染字面键名）
  function tipStateFor(kind, hasMemory) {
    if (kind === "report") return "tipReport";
    if (!hasMemory) return "chatEmptyMemory";
    return null;
  }
  function fillAllowedFor(kind, hasMemory) {
    if (kind === "report") return true;
    return !!hasMemory;
  }
  function shouldClearTipOnInput(currentValue, lastFillValue) {
    return currentValue !== lastFillValue;
  }

  // ── 状态 ──
  var _mode = null;            // "report" | "chat" | null（最近一次通知的模式，供语言重渲染）
  var _offers = null;          // 最近一次渲染的 offers（供语言切换重渲染）
  var _tipShown = false;
  var _tipFromExample = false;
  var _lastFillValue = "";
  var _hasMemory = false;
  var _hasReport = false;      // 是否已有生成完成的报告（主路径 ① 完成标记）
  var _hasPill = false;        // 是否已有最小化药丸（高级路径标记）
  var _panelTipShown = false;
  var _langObserver = null;

  // ── DOM 工具 ──
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function makeEl(className, html) {
    var el = document.createElement("div");
    el.className = className;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }
  // 渲染时替换动态占位符（chip 的 data-text 存最终文本）
  function resolveExampleText(ex, merchant) {
    var text = ex.text;
    if (ex.dynamic === "merchant") {
      text = text.replace("{merchant}", merchant || FALLBACK_MERCHANT);
    }
    return text;
  }
  function exampleMerchant(offers) {
    return merchantForExample(offers) || FALLBACK_MERCHANT;
  }

  // ── 欢迎屏渲染 ──
  function flowHtml() {
    var keys = [["flow1Title", "flow1Sub"], ["flow2Title", "flow2Sub"], ["flow3Title", "flow3Sub"]];
    var nums = ["①", "②", "③"];
    return '<div class="welcome-flow">' + keys.map(function (pair, i) {
      return '<div class="welcome-flow-step"><span class="welcome-flow-num">' +
        escapeHtml(nums[i]) + '</span><span class="welcome-flow-txt">' +
        escapeHtml(currentCopy(pair[0])) + '<br>' + escapeHtml(currentCopy(pair[1])) + '</span></div>';
    }).join('<span class="welcome-flow-arrow">→</span>') + '</div>';
  }
  function chipsHtml(examples, kind, merchant) {
    return '<div class="welcome-chips">' + examples.map(function (ex) {
      var text = resolveExampleText(ex, merchant);
      return '<button type="button" class="welcome-chip" data-kind="' + kind + '" data-text="' +
        escapeHtml(text) + '">' + escapeHtml(text) + '</button>';
    }).join("") + '</div>';
  }
  function headHtml() {
    return '<div class="welcome-head"><div class="welcome-avatar">🤖</div><div>' +
      '<div class="welcome-hello">' + escapeHtml(currentCopy("helloTitle")) + '</div>' +
      '<div class="welcome-desc">' + escapeHtml(currentCopy("helloBody")) + '</div></div></div>';
  }
  function colHtml(kind, examples, merchant, extra) {
    var isRight = kind === "chat";
    var titleKey = isRight ? "colRightTitle" : "colLeftTitle";
    var tagKey = isRight ? "colRightTag" : "colLeftTag";
    var html = '<div class="welcome-col' + (isRight ? " right" : "") + '">' +
      '<div class="welcome-col-title"><span>' + escapeHtml(currentCopy(titleKey)) + '</span>' +
      '<span class="welcome-col-tag' + (isRight ? " alt" : "") + '">' + escapeHtml(currentCopy(tagKey)) + '</span></div>' +
      chipsHtml(examples, kind, merchant);
    if (isRight && currentCopy("colRightNote")) {
      html += '<div class="welcome-note">' + escapeHtml(currentCopy("colRightNote")) + '</div>';
    }
    return html + "</div>";
  }
  // 渲染完整双栏工作台（常驻独立卡片）。挂载为 dashboard 主网格左列第一个 grid 子项，
  // 始终完整展开、不折叠；与聊天区内容解耦，对话不顶掉、不改变它。
  function _renderPanel(mode, opts) {
    opts = opts || {};
    var container = containerFor(mode);
    if (!container) return false;
    if (opts.offers) _offers = opts.offers;
    var merchant = exampleMerchant(opts.offers || _offers);
    var html = '<div class="welcome-panel">' + headHtml() + flowHtml() +
      '<div class="welcome-cols">' + colHtml("report", WELCOME_EXAMPLES.report, merchant) +
      colHtml("chat", WELCOME_EXAMPLES.chat, merchant) +
      "</div></div>";
    _clearWelcome(container);
    var panel = makeEl("welcome-panel", html);
    container.insertBefore(panel, container.firstChild);
    _mode = mode;
    if (opts.hasMemory !== undefined) _hasMemory = !!opts.hasMemory;
    _bindPanel(panel);
    _bindLangObserver();
    return true;
  }
  function _clearWelcome(container) {
    if (!container) return;
    var els = container.querySelectorAll(".welcome-panel");
    for (var i = 0; i < els.length; i++) els[i].parentNode.removeChild(els[i]);
  }
  // 点击监听绑定在每次新建的 panel 上：panel 被 dismiss 移除时监听器随之销毁，
  // 避免常驻容器（#chatLog/#chatLogChat）上反复绑定累积监听器。
  function _bindPanel(panel) {
    try {
      panel.addEventListener("click", function (e) {
        var t = e.target;
        if (t && t.closest && t.closest(".welcome-chip")) {
          var chip = t.closest(".welcome-chip");
          var kind = chip.getAttribute("data-kind") || "report";
          _handleChipClick(kind, chip.getAttribute("data-text") || "");
        }
      });
    } catch (err) {}
  }
  function _handleChipClick(kind, text) {
    if (!fillAllowedFor(kind, _hasMemory)) {
      _showTipbar("chatEmptyMemory");
      // 拦截提示条同样标记为"示例触发"：用户一输入即 ≠ 旧填充值，随手动输入消失
      _tipFromExample = true;
      return;
    }
    var input = document.getElementById("chatInput");
    if (!input) return;
    input.value = text;
    _lastFillValue = text;
    _tipFromExample = true;
    var tipKey = tipStateFor(kind, _hasMemory);
    if (tipKey) _showTipbar(tipKey);
    _pulseSend(true);
  }
  function _pulseSend(on) {
    try {
      var form = document.getElementById("chatForm");
      var btn = form && form.querySelector('button[type="submit"]');
      if (btn) btn.classList.toggle("welcome-pulse", !!on);
    } catch (e) {}
  }
  function _showTipbar(key) {
    try {
      _clearTipbar();
      var form = document.getElementById("chatForm");
      if (!form || !form.parentNode) return;
      var tip = makeEl("welcome-tipbar",
        '<span>📌 ' + escapeHtml(currentCopy(key)) + '</span>' +
        '<button type="button" class="welcome-tip-close" aria-label="' + escapeHtml(currentCopy("close")) + '">✕</button>');
      form.parentNode.insertBefore(tip, form);
      _tipShown = true;
      _wireTipClose(tip);
    } catch (e) {}
  }
  function _wireTipClose(tip) {
    try {
      tip.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".welcome-tip-close")) {
          _clearTipbar();
        }
      });
    } catch (e) {}
  }
  function _clearTipbar() {
    try {
      var tips = document.querySelectorAll(".welcome-tipbar");
      for (var i = 0; i < tips.length; i++) tips[i].parentNode.removeChild(tips[i]);
    } catch (e) {}
    _tipShown = false;
  }
  // ── Chat Mode 聊天区顶部提醒卡片 ──────────────────────
  // 常驻 sticky 卡片（.chat-reminder），提示「先将数据注入记忆栏，Chat 才有数据可答」。
  // 渲染进 #chatLogChat 顶部；Chat Mode（mode === "chat"）显示，Report Mode 移除。
  // 与欢迎屏独立卡片解耦——它挂在聊天区内部，作为该模式下的使用方式提示。
  function _chatLogChatElement() {
    try { return document.getElementById("chatLogChat"); } catch (e) { return null; }
  }
  function _renderChatReminder(force) {
    try {
      var log = _chatLogChatElement();
      if (!log) return;
      if (force) _removeChatReminder();
      if (log.querySelector && log.querySelector(".chat-reminder")) return;
      var card = makeEl("chat-reminder",
        '<span class="chat-reminder-icon">📌</span>' +
        '<span class="chat-reminder-text">' + escapeHtml(currentCopy("chatReminder")) + '</span>');
      if (log.insertBefore) log.insertBefore(card, log.firstChild || null);
    } catch (e) {}
  }
  function _removeChatReminder() {
    try {
      var log = _chatLogChatElement();
      if (!log || !log.querySelectorAll) return;
      var els = log.querySelectorAll(".chat-reminder");
      for (var i = 0; i < els.length; i++) {
        if (els[i].parentNode) els[i].parentNode.removeChild(els[i]);
      }
    } catch (e) {}
  }
  function _syncChatReminder(mode, force) {
    if (mode === "chat") _renderChatReminder(!!force);
    else _removeChatReminder();
  }
  function _insertPanelTip(panelEl) {
    try {
      var tip = makeEl("welcome-panel-tip",
        '<span>' + escapeHtml(currentCopy("panelTip")) + '</span>' +
        '<button type="button" class="welcome-panel-tip-close" aria-label="' + escapeHtml(currentCopy("close")) + '">✕</button>');
      tip.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".welcome-panel-tip-close")) {
          try { tip.parentNode.removeChild(tip); } catch (err) {}
        }
      });
      var head = panelEl.querySelector && panelEl.querySelector(".deep-window-head");
      if (head && head.parentNode) head.parentNode.insertBefore(tip, head.nextSibling);
      else if (panelEl.appendChild) panelEl.appendChild(tip);
    } catch (e) {}
  }
  function _bindLangObserver() {
    if (_langObserver) return;
    try {
      _langObserver = new MutationObserver(function () {
        var mode = _mode;
        if (isRendered(mode)) {
          _clearTipbar();
          _renderPanel(mode, { offers: _offers, hasMemory: _hasMemory });
          _syncChatReminder(mode, true); // 语言切换：强制刷新提醒卡片文案
        }
      });
      _langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    } catch (e) {}
  }

  // ── 公共 API ──
  // 常驻独立卡片：dashboard 主网格没有 welcome 内容时渲染（首次打开）；已有内容则保持当前态。
  function maybeRender(mode, opts) {
    if (TEST_MODE) return shouldRenderFor(mode);
    if (!shouldRenderFor(mode)) return false;
    return _renderPanel(mode, opts || {});
  }
  function dismiss(mode) {
    try {
      var container = containerFor(mode);
      if (!container) return;
      _clearWelcome(container);
    } catch (e) {}
    _clearTipbar();
    _tipFromExample = false;
    if (_mode === mode) _mode = null;
    _pulseSend(false);
  }
  function isRendered(mode) {
    var container = containerFor(mode);
    if (!container) return false;
    try { return !!container.querySelector(".welcome-panel"); } catch (e) { return false; }
  }
  function notify(eventName, payload) {
    payload = payload || {};
    if (eventName === "chat-sent") {
      // 面板常驻完整展开：发送消息只清提示条/脉冲，不折叠、不删除
      _clearTipbar();
      _tipFromExample = false;
      _pulseSend(false);
      return;
    }
    if (eventName === "mode-switched") {
      // 面板常驻：模式切换只同步记忆栏状态，不重渲染、不切换欢迎屏
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      var mode = payload.mode === "chat" ? "chat" : "report";
      _mode = mode;
      // Chat Mode → 聊天区顶部渲染提醒卡片；Report Mode → 移除
      _syncChatReminder(mode);
      return;
    }
    if (eventName === "report-ready") {
      if (_panelTipShown || !payload.panelEl) return;
      _panelTipShown = true;
      _insertPanelTip(payload.panelEl);
      return;
    }
    if (eventName === "memory-added") {
      _hasMemory = true;
      return;
    }
  }

  // ── 手动输入零打扰：用户改动输入框文本（≠ 示例填充值）→ 清 tipbar ──
  try {
    document.addEventListener("input", function (e) {
      if (!_tipFromExample) return;
      if (e.target && e.target.id === "chatInput" &&
          shouldClearTipOnInput(e.target.value, _lastFillValue)) {
        _clearTipbar();
        _tipFromExample = false;
        _pulseSend(false);
      }
    });
  } catch (e) {}

  window.CHATBOT_WELCOME = {
    maybeRender: maybeRender,
    notify: notify,
    dismiss: dismiss,
    isRendered: isRendered,
    _test: {
      examples: WELCOME_EXAMPLES,
      copy: WELCOME_COPY,
      currentLanguage: currentLanguage,
      merchantForExample: merchantForExample,
      shouldRenderFor: shouldRenderFor,
      containerFor: containerFor,
      tipStateFor: tipStateFor,
      fillAllowedFor: fillAllowedFor,
      shouldClearTipOnInput: shouldClearTipOnInput,
      renderSmoke: function () {
        _renderPanel("report", { offers: [], hasMemory: false });
        _renderPanel("chat", { offers: [{ merchantName: "Shokz", commission: 1 }], hasMemory: false });
      },
      renderPanel: function (mode, opts) { return _renderPanel(mode, opts || {}); },
      tipActive: function () { return _tipShown; },
      showTipbar: function (key) { _showTipbar(key); },
      clearTipbar: function () { _clearTipbar(); },
      lastMode: function () { return _mode; },
      panelTipActive: function () { return !_panelTipShown; },
      hasMemory: function () { return _hasMemory; },
      tipFromExampleActive: function () { return _tipFromExample; },
      handleChipClick: function (kind, text) { _handleChipClick(kind, text); },
      resolveExampleText: resolveExampleText,
      chatReminderActive: function () {
        var log = _chatLogChatElement();
        if (!log || !log.querySelector) return false;
        return !!log.querySelector(".chat-reminder");
      },
      renderChatReminder: function (force) { _renderChatReminder(!!force); },
      removeChatReminder: function () { _removeChatReminder(); },
      flowStage: flowStage,
      flowState: function () {
        return { hasReport: _hasReport, hasPill: _hasPill, hasMemory: _hasMemory, isChat: _mode === "chat" };
      }
    }
  };
})();
