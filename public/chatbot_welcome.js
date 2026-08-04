(function () {
  // ── Chatbot 欢迎屏（Welcome Guide）────────────────────────────
  // 空聊天区的能力地图 + 流程示意 + 示例问题：双栏工作台布局（左「① 先获取数据」/
  // 右「③ 再深度分析」），示例点击即填 + 提示条贯穿「获取→分析」流程。
  // 零依赖，挂 window.CHATBOT_WELCOME。与 app.js 的交互点：
  //   1. init 尾部: window.CHATBOT_WELCOME.maybeRender("report", { offers })
  //   2. chatForm submit: window.CHATBOT_WELCOME.notify("chat-sent")
  //   3. 模式切换: window.CHATBOT_WELCOME.notify("mode-switched", { mode, hasMemory })
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
      colRightNote: "需先拖入记忆栏",
      tipReport: "发送后，报告生成时可点 ─ 最小化，拖入记忆栏继续深度分析",
      chatHelloTitle: "记忆栏已就绪，开始分析吧",
      chatHelloBody: "先拖入 1 份报告，再点下面的示例，我会基于它给出建议",
      chatEmptyMemory: "请先拖入报告到记忆栏",
      panelTip: "点 ─ 最小化，拖入记忆栏后可在 Chat Mode 深度分析",
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
      colRightNote: "Drag reports into memory first",
      tipReport: "After sending, click – to minimize the panel and drag it into the memory bar for deep analysis",
      chatHelloTitle: "Memory ready — start analyzing",
      chatHelloBody: "Drag in a report first, then pick an example — I'll analyze based on it",
      chatEmptyMemory: "Drag a report into the memory bar first",
      panelTip: "Click – to minimize, then drag into memory for Chat Mode analysis",
      close: "Close",
      memoryHint: "Drag the panel here as context"
    }
  };

  // ── 示例数据（纯数据；dynamic 字段渲染时替换占位符）──
  var WELCOME_EXAMPLES = {
    report: [
      { text: "查一下 {merchant} 这个月表现", dynamic: "merchant" },
      { text: "这个月有哪些商户逾期？" },
      { text: "Tier 2表现" },
      { text: "品类趋势" }
    ],
    chat: [
      { text: "根据记忆栏的报告，给我分析建议" },
      { text: "对比记忆栏里的两个商户，谁更值得重点投入" },
      { text: "总结记忆栏的数据，提出下个月的运营重点" }
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

  // ── 动态商户名：取 commission 最高的商户 ──
  function merchantForExample(offers) {
    if (!Array.isArray(offers) || !offers.length) return null;
    var ranked = offers.slice().sort(function (a, b) {
      return (Number(b.commission) || 0) - (Number(a.commission) || 0);
    });
    for (var i = 0; i < ranked.length; i++) {
      var name = ranked[i] && (ranked[i].merchantName || ranked[i].merchant);
      if (name) {
        var clean = String(name).trim();
        if (clean) return clean;
      }
    }
    return null;
  }

  // ── 渲染判定与示例交互决策（纯函数）──
  function containerFor(mode) {
    if (mode === "chat") return document.getElementById("chatLogChat");
    if (mode === "report") return document.getElementById("chatLog");
    return null;
  }
  function shouldRenderFor(mode) {
    var container = containerFor(mode);
    if (!container) return false;
    if (container.querySelector(".welcome-panel")) return false;
    if (container.querySelector(".message")) return false;
    return true;
  }
  // kind: "report" | "chat"（示例所属分区）
  function tipStateFor(kind, hasMemory) {
    if (kind === "report") return "report-tip";
    if (!hasMemory) return "empty-memory";
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
  var _mode = null;            // "report" | "chat" | null
  var _tipShown = false;
  var _tipFromExample = false;
  var _lastFillValue = "";
  var _hasMemory = false;
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
  function _render(mode, opts) {
    opts = opts || {};
    var container = containerFor(mode);
    if (!container) return;
    var merchant = exampleMerchant(opts.offers);
    var html;
    if (mode === "chat") {
      html = '<div class="welcome-panel">' + headHtml() +
        flowHtml().replace('class="welcome-flow"', 'class="welcome-flow progress"') +
        colHtml("chat", WELCOME_EXAMPLES.chat, merchant) + "</div>";
    } else {
      html = '<div class="welcome-panel">' + headHtml() + flowHtml() +
        '<div class="welcome-cols">' + colHtml("report", WELCOME_EXAMPLES.report, merchant) +
        '<div class="welcome-cols-arrow">➜</div>' + colHtml("chat", WELCOME_EXAMPLES.chat, merchant) +
        "</div></div>";
    }
    var panel = makeEl("welcome-panel", html);
    container.appendChild(panel);
    _mode = mode;
    _hasMemory = !!opts.hasMemory;
    _bindContainer(container);
    _bindLangObserver();
  }
  function _bindContainer(container) {
    try {
      container.addEventListener("click", function (e) {
        var chip = e.target && e.target.closest && e.target.closest(".welcome-chip");
        if (!chip) return;
        var kind = chip.getAttribute("data-kind") || "report";
        _handleChipClick(kind, chip.getAttribute("data-text") || "");
      });
    } catch (err) {}
  }
  function _handleChipClick(kind, text) {
    if (!fillAllowedFor(kind, _hasMemory)) {
      _showTipbar("empty-memory");
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
        if (isRendered(_mode)) {
          _clearTipbar();
          dismiss(_mode);
          maybeRender(_mode, { hasMemory: _hasMemory });
        }
      });
      _langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    } catch (e) {}
  }

  // ── 公共 API ──
  function maybeRender(mode, opts) {
    if (TEST_MODE) return shouldRenderFor(mode);
    if (!shouldRenderFor(mode)) return false;
    _render(mode, opts || {});
    return true;
  }
  function dismiss(mode) {
    try {
      var container = containerFor(mode);
      if (!container) return;
      var panels = container.querySelectorAll(".welcome-panel");
      for (var i = 0; i < panels.length; i++) panels[i].parentNode.removeChild(panels[i]);
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
  function notify(eventName, payload) {} // Task 4 实现

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
        _render("report", { offers: [], hasMemory: false });
        _render("chat", { offers: [{ merchantName: "Shokz", commission: 1 }], hasMemory: false });
      },
      tipActive: function () { return _tipShown; },
      showTipbar: function (key) { _showTipbar(key); },
      clearTipbar: function () { _clearTipbar(); },
      lastMode: function () { return _mode; },
      resolveExampleText: resolveExampleText
    }
  };
})();
