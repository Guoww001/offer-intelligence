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

  // ── 公共 API 骨架（后续任务填充实现）──
  function maybeRender(mode, opts) {
    if (TEST_MODE) return false;
    return false;
  }
  function notify(eventName, payload) {}
  function dismiss(mode) {}
  function isRendered(mode) { return false; }

  window.CHATBOT_WELCOME = {
    maybeRender: maybeRender,
    notify: notify,
    dismiss: dismiss,
    isRendered: isRendered,
    _test: {
      examples: WELCOME_EXAMPLES,
      copy: WELCOME_COPY,
      currentLanguage: currentLanguage,
      merchantForExample: merchantForExample
    }
  };
})();
