(function () {
  // ── Chatbot 欢迎屏（Welcome Guide）────────────────────────────
  // 独立卡片：能力地图 + 流程示意 + 示例问题。挂在 dashboard 主网格左列顶部
  // （.main-grid.dashboard-page 第 1 行第 1 列），始终完整展开、不折叠、不受对话影响。
  // 双栏工作台布局（左「① 先获取数据」/ 右「③ 再深度分析」），示例点击即填 + 提示条贯穿
  // 「获取→分析」流程。零依赖，挂 window.CHATBOT_WELCOME。与 app.js 的交互点：
  //   1. init 尾部: window.CHATBOT_WELCOME.maybeRender("report", { offers })
  //   2. chatForm submit: window.CHATBOT_WELCOME.notify("chat-sent", { mode })   → 按模式推进流程并清提示条（不折叠）
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
      helloTitle: "我是你的Chatbot使用助手",
      flow1Title: "Report 提问",
      flow1Sub: "获取数据",
      flow2Title: "面板最小化",
      flow2Sub: "拖入记忆栏",
      flow3Title: "Chat 对话",
      flow3Sub: "深度分析",
      colLeftTitle: "先获取数据",
      colLeftTag: "REPORT",
      colRightTitle: "再深度分析",
      colRightTag: "CHAT",
      colRightNote: "必须先拖入记忆栏，Chat 才有数据可答",
      tipReport: "发送后，报告生成时可点“加入对话”按钮，放入记忆栏——Chat 分析必须先有记忆栏数据",
      chatHelloTitle: "记忆栏已就绪，开始分析吧",
      chatHelloBody: "先拖入 1 份报告，再点下面的示例，我会基于它给出建议",
      chatEmptyMemory: "请先拖入报告到记忆栏",
      panelTip: "点「加入对话」一键带进对话；或点 ─ 最小化后拖入记忆栏（高级用法）",
      progressStep1: "在 Report 提问",
      progressStep2: "点「加入对话」",
      progressStep3: "在 Chat 对话",
      completionPrompt: "三步操作都完成了吗？",
      completionConfirm: "已完成，重新开始",
      completionLater: "还没完成",
      progressAdvanced: "高级用法：最小化后拖入记忆栏",
      minimizedTip: "已最小化：切到 Chat Mode，把药丸拖到记忆栏",
      goReport: "去生成报告",
      chatReminderKicker: "Chat Mode",
      chatReminderTitle: "把报告放进记忆栏，再开始对话",
      chatReminderBody: "Chat Mode 可以根据记忆内容做解释、归纳、横向比较和行动建议",
      chatReminderReminder: "还没有报告？先去 Report Mode 生成一份",
      newBadge: "新手引导",
      collapse: "收起",
      showGuide: "查看使用引导",
      close: "关闭",
      memoryHint: "将面板拖入此处作为上下文"
    },
    en: {
      helloTitle: "I'm your Chatbot usage assistant",
      flow1Title: "Ask in Report Mode",
      flow1Sub: "Get data",
      flow2Title: "Minimize the panel",
      flow2Sub: "Drag into memory",
      flow3Title: "Chat in Chat Mode",
      flow3Sub: "Deep analysis",
      colLeftTitle: "Fetch data first",
      colLeftTag: "REPORT",
      colRightTitle: "Then analyze deeply",
      colRightTag: "CHAT",
      colRightNote: "Drag reports into memory first — Chat only answers with data in memory",
      tipReport: "After sending, click the “Add to chat” button once the report is ready — it drops into the memory bar, which Chat analysis needs first",
      chatHelloTitle: "Memory ready — start analyzing",
      chatHelloBody: "Drag in a report first, then pick an example — I'll analyze based on it",
      chatEmptyMemory: "Drag a report into the memory bar first",
      panelTip: "Click “Add to chat” to start instantly, or click – to minimize and drag into the memory bar (advanced)",
      progressStep1: "Ask in Report Mode",
      progressStep2: "Click Add to chat",
      progressStep3: "Chat in Chat Mode",
      completionPrompt: "Have you completed all three steps?",
      completionConfirm: "Yes, start over",
      completionLater: "Not yet",
      progressAdvanced: "Advanced: minimize, then drag into the memory bar",
      minimizedTip: "Minimized: switch to Chat Mode and drag the pill into the memory bar",
      goReport: "Go generate a report",
      chatReminderKicker: "Chat Mode",
      chatReminderTitle: "Bring a report into memory, then start the conversation",
      chatReminderBody: "Chat Mode can explain, summarize, compare side by side, and suggest actions based on memory content.",
      chatReminderReminder: "No report yet? Generate one in Report Mode first",
      newBadge: "First time?",
      collapse: "Collapse",
      showGuide: "Show guide",
      close: "Close",
      memoryHint: "Drag the panel here as context"
    }
  };

  // ── 示例数据（纯数据；dynamic 字段渲染时替换占位符）──
  // Report Mode 只做数据获取 + 趋势分析：直接输入实体名即可（商户名/品类名/Tier），
  // 趋势分析直接写"实体名 + 趋势分析"。示例即字面输入，不套"查一下…这个月表现"等修饰。
  var WELCOME_EXAMPLES = {
    report: [
      { text: "{merchant}", textEn: "{merchant}", dynamic: "merchant" },
      { text: "Beauty 品类", textEn: "Beauty category" },
      { text: "Tier 2", textEn: "Tier 2" },
      { text: "{merchant}趋势分析", textEn: "{merchant} trend analysis", dynamic: "merchant" }
    ],
    chat: [
      { text: "给我分析建议", textEn: "Give me analysis suggestions" },
      { text: "对比两个商户，谁更值得重点投入", textEn: "Compare the two merchants — who deserves more investment" },
      { text: "总结数据，分析下个月的运营方向", textEn: "Summarize the data and plan next month's direction" },
      { text: "用表格展示指标数据", textEn: "Show the metrics in a table" }
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

  // ── 持久化与用户状态（新老用户判定 / 气泡收起）──
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function tourDone() { return !!storageGet("oi_onboarding_done"); }
  function collapsedPersisted() { return storageGet("oi_welcome_collapsed") === "1"; }
  function defaultCollapsed() { return collapsedPersisted() || tourDone(); }

  // ── 流程状态机：主路径 3 步（① Report 提问 → ② 加入对话 → ③ Chat 对话）──
  function flowStage(state) {
    state = state || {};
    var hasReport = !!state.hasReport;
    var hasAddedToChat = !!state.hasAddedToChat;
    var hasChatSent = !!state.hasChatSent;
    if (hasReport && hasAddedToChat && hasChatSent) return "chatActive";
    if (hasReport && hasAddedToChat) return "memoryReady";
    if (hasReport) return "reportReady";
    return "noReport";
  }
  function _flowState() {
    return {
      hasReport: _hasReport,
      hasPill: _hasPill,
      hasMemory: _hasMemory,
      hasAddedToChat: _hasAddedToChat,
      hasChatSent: _hasChatSent,
      completionPromptDismissed: _completionPromptDismissed,
      isChat: _mode === "chat"
    };
  }
  function _anyMinimizedPanel() {
    try { return document.querySelectorAll(".deep-window.minimized").length > 0; } catch (e) { return false; }
  }
  function _refreshProgress() {
    try {
      var container = containerFor(_mode);
      if (!container) return;
      var panel = container.querySelector(".welcome-panel");
      var box = panel && panel.querySelector(".welcome-progress");
      if (box) box.outerHTML = progressHtml(_flowState());
    } catch (e) {}
  }
  function progressHtml(state) {
    var stage = flowStage(state);
    var steps = [
      { key: "progressStep1", state: "active" },
      { key: "progressStep2", state: "" },
      { key: "progressStep3", state: "" }
    ];
    if (stage === "reportReady") { steps[0].state = "done"; steps[1].state = "active"; }
    else if (stage === "memoryReady") { steps[0].state = "done"; steps[1].state = "done"; steps[2].state = "active"; }
    else if (stage === "chatActive") { steps[0].state = "done"; steps[1].state = "done"; steps[2].state = "done"; }
    var completionHtml = stage === "chatActive" && !state.completionPromptDismissed
      ? '<div class="welcome-progress-confirmation">' +
        '<span class="welcome-progress-confirmation-text">' + escapeHtml(currentCopy("completionPrompt")) + '</span>' +
        '<div class="welcome-progress-confirmation-actions">' +
        '<button type="button" class="welcome-progress-confirm-yes" data-flow-action="confirm">' + escapeHtml(currentCopy("completionConfirm")) + '</button>' +
        '<button type="button" class="welcome-progress-confirm-later" data-flow-action="later">' + escapeHtml(currentCopy("completionLater")) + '</button>' +
        '</div></div>'
      : "";
    return '<div class="welcome-progress" data-stage="' + escapeHtml(stage) + '">' +
      steps.map(function (s, i) {
        var cls = "welcome-progress-step" + (s.state ? " " + s.state : "");
        var icon = s.state === "done" ? "✓" : String(i + 1);
        return '<div class="' + cls + '"><span class="welcome-progress-num">' + escapeHtml(icon) + '</span>' +
          '<span class="welcome-progress-label">' + escapeHtml(currentCopy(s.key)) + '</span></div>';
      }).join("") + completionHtml + '</div>';
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
  // 悬浮气泡：挂在 dashboard 主网格（.main-grid.dashboard-page）内。
  // 主网格 = 整个 dashboard 页，气泡可拖到页面任意位置（不再受 #chatPanel 的
  // overflow:hidden 裁剪），随页面切换一起隐藏；右下角即聊天面板右下角（chatPanel
  // 占右列整行），默认位置不变。grid 为 position:relative（见 styles.css）。
  function containerFor() {
    try {
      var grid = document.querySelector(".main-grid.dashboard-page");
      if (grid) return grid;
    } catch (e) {}
    try { return document.getElementById("chatPanel"); } catch (e) { return null; }
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
  var _hasReport = false;      // 是否已在 Report Mode 点击发送（主路径 ① 完成标记）
  var _hasAddedToChat = false; // 是否点击过「加入对话」（主路径 ② 完成标记）
  var _hasChatSent = false;    // 是否在 Chat Mode 发送过消息（主路径 ③ 完成标记）
  var _completionPromptDismissed = false; // 是否暂时关闭了三步完成确认
  var _hasPill = false;        // 是否已有最小化药丸（高级路径标记）
  var _panelTipShown = false;
  var _langObserver = null;
  var _collapsed = defaultCollapsed();
  var _tourHidden = false;
  var _wrapEl = null;
  var _panelEl = null;
  var _dotEl = null;
  var _bodyObserver = null;
  var _drag = null;              // 圆钮拖拽会话 {startX, startY, origLeft, origTop, wrapW/H, contW/H, moved, pointerId}
  var _suppressDotClick = false; // 拖拽结束后抑制随后的 click（避免误触发展开）
  var _tourDragEnabled = false;  // 新手引导仅在第二步临时开放面板拖拽

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
  // 渲染时替换动态占位符（chip 的 data-text 存最终文本）。
  // 示例文案跟随页面语言：en 模式优先 textEn（点击示例填入输入框的也是对应语言文本）
  function resolveExampleText(ex, merchant) {
    var text = currentLanguage() === "en" && ex.textEn ? ex.textEn : ex.text;
    if (ex.dynamic === "merchant") {
      text = text.replace("{merchant}", merchant || FALLBACK_MERCHANT);
    }
    return text;
  }
  function exampleMerchant(offers) {
    return merchantForExample(offers) || FALLBACK_MERCHANT;
  }

  // ── 欢迎屏渲染 ──
  function chipsHtml(examples, kind, merchant) {
    return '<div class="welcome-chips">' + examples.map(function (ex) {
      var text = resolveExampleText(ex, merchant);
      return '<button type="button" class="welcome-chip" data-kind="' + kind + '" data-text="' +
        escapeHtml(text) + '">' + escapeHtml(text) + '</button>';
    }).join("") + '</div>';
  }
  function headHtml(emphasis) {
    var badge = emphasis
      ? '<span class="welcome-new-badge">' + escapeHtml(currentCopy("newBadge")) + '</span>'
      : "";
    return '<div class="welcome-head"><div class="welcome-avatar">🤖</div>' +
      '<div class="welcome-head-main">' +
      '<div class="welcome-hello">' + escapeHtml(currentCopy("helloTitle")) + badge + '</div>' +
      '</div>' +
      '<button type="button" class="welcome-collapse-btn" aria-label="' + escapeHtml(currentCopy("collapse")) + '" title="' + escapeHtml(currentCopy("collapse")) + '">✕</button>' +
      '</div>';
  }
  function colHtml(kind, examples, merchant, extra) {
    var isRight = kind === "chat";
    var titleKey = isRight ? "colRightTitle" : "colLeftTitle";
    var tagKey = isRight ? "colRightTag" : "colLeftTag";
    // 栏标识类（report/chat）+ 布局类（right）：CSS 用 .welcome-float.mode-* 选择器
    // 对当前模式对应栏做焦点强调（见 styles.css 模式焦点栏一节）
    var html = '<div class="welcome-col' + (isRight ? " right chat" : " report") + '">' +
      '<div class="welcome-col-title"><span>' + escapeHtml(currentCopy(titleKey)) + '</span>' +
      '<span class="welcome-col-tag' + (isRight ? " alt" : "") + '">' + escapeHtml(currentCopy(tagKey)) + '</span></div>' +
      chipsHtml(examples, kind, merchant);
    if (isRight && currentCopy("colRightNote")) {
      html += '<div class="welcome-note">' + escapeHtml(currentCopy("colRightNote")) + '</div>';
    }
    return html + "</div>";
  }
  // 渲染完整双栏工作台（悬浮气泡）。挂载为 #chatPanel 内部右下角绝对定位层，
  // 新用户默认展开 + 强调态；老用户/已收起默认折叠为圆钮；Tour 激活时保持可见并高光。
  function _renderPanel(mode, opts) {
    opts = opts || {};
    var container = containerFor(mode);
    if (!container) return false;
    if (opts.offers) _offers = opts.offers;
    var merchant = exampleMerchant(opts.offers || _offers);
    var emphasis = !tourDone() && !_collapsed;
    var panelHtml = headHtml(emphasis) + progressHtml(_flowState()) +
      '<div class="welcome-cols">' + colHtml("report", WELCOME_EXAMPLES.report, merchant) +
      colHtml("chat", WELCOME_EXAMPLES.chat, merchant) +
      "</div>";
    _clearWelcome(container);
    var wrap = makeEl("welcome-float", "");
    if (_collapsed) wrap.classList.add("collapsed");
    if (_tourHidden) wrap.classList.add("onboarding-tour-active");
    if (_tourDragEnabled) wrap.classList.add("onboarding-tour-drag-enabled");
    // 语言 class：驱动 CSS 宽度自适应（英文文案长，面板加宽，见 styles.css .welcome-lang-en）
    wrap.classList.add(currentLanguage() === "en" ? "welcome-lang-en" : "welcome-lang-zh");
    _applyModeClass(wrap, mode);
    var panel = makeEl("welcome-panel", panelHtml);
    if (emphasis) panel.classList.add("welcome-emphasis");
    var dot = makeEl("welcome-float-dot", "🤖");
    dot.setAttribute("aria-label", currentCopy("showGuide"));
    dot.setAttribute("aria-expanded", String(!_collapsed));
    wrap.appendChild(panel);
    wrap.appendChild(dot);
    _wrapEl = wrap;
    _panelEl = panel;
    _dotEl = dot;
    container.appendChild(wrap);
    _applyDotPos(wrap);
    _mode = mode;
    if (opts.hasMemory !== undefined) _hasMemory = !!opts.hasMemory;
    _bindPanel(panel);
    _bindPanelDrag(panel);
    _bindBubbleControls(panel, dot);
    _bindLangObserver();
    _bindTourObserver();
    _applyTourHidden();
    return true;
  }
  // 模式感知焦点栏：wrap 上的 mode-report / mode-chat 类驱动 CSS 强调
  // （Report Mode → 左栏「① 先获取数据」点亮；Chat Mode → 右栏「③ 再深度分析」点亮，
  //   对侧栏退暗）。渲染时按传入模式设置，mode-switched 通知时切换。
  function _applyModeClass(wrap, mode) {
    if (!wrap || !wrap.classList) return;
    wrap.classList.toggle("mode-report", mode !== "chat");
    wrap.classList.toggle("mode-chat", mode === "chat");
  }
  function _clearWelcome(container) {
    if (!container) return;
    var els = container.querySelectorAll(".welcome-float");
    for (var i = 0; i < els.length; i++) els[i].parentNode.removeChild(els[i]);
    _wrapEl = null;
    _panelEl = null;
    _dotEl = null;
  }
  // 收起/展开：persist=true 写入 oi_welcome_collapsed（手动收起/自动收起），
  // persist=false 只改当前会话（手动展开不覆盖持久化，刷新仍按默认规则）。
  function setCollapsed(collapsed, persist) {
    _collapsed = !!collapsed;
    if (_wrapEl) _wrapEl.classList.toggle("collapsed", _collapsed);
    if (_dotEl) _dotEl.setAttribute("aria-expanded", String(!_collapsed));
    if (_panelEl) _panelEl.classList.toggle("welcome-emphasis", !tourDone() && !_collapsed);
    if (persist) {
      if (_collapsed) storageSet("oi_welcome_collapsed", "1");
      else storageRemove("oi_welcome_collapsed");
    }
  }
  function _bindBubbleControls(panel, dot) {
    try {
      if (panel) {
        var closeBtn = panel.querySelector(".welcome-collapse-btn");
        if (closeBtn) closeBtn.addEventListener("click", function () { setCollapsed(true, true); });
      }
    } catch (e) {}
    try {
      if (dot) {
        dot.addEventListener("click", function () {
          if (_suppressDotClick) { _suppressDotClick = false; return; }
          setCollapsed(false, false);
        });
        _bindDotDrag(dot);
      }
    } catch (e) {}
  }
  // ── 气泡组自由拖拽：pointer 事件 + capture，拖动整个气泡组（wrap）。
  //    两种拖拽入口共用一套状态机（_drag.byDot 区分 clamp 基准）：
  //      byDot=true  收起态圆钮 —— 按圆钮自身位置 clamp（圆钮可自由拖到面板任意位置），
  //                   未移动视为点击展开；
  //      byDot=false 展开态面板头部手柄 —— 按 wrap 自身尺寸 clamp（面板必须完整留在容器内），
  //                   未移动视为普通点击（无副作用）。
  //    位置共用持久化键 oi_welcome_dot_pos：展开拖走后收起，圆钮出现在面板新位置。──
  var DOT_DRAG_THRESHOLD = 4; // px：累计位移超过阈值视为拖拽（不触发展开），否则视为点击展开
  function clampDotPos(left, top, contW, contH, dotW, dotH) {
    return {
      left: Math.min(Math.max(Math.round(left), 0), Math.max(0, contW - dotW)),
      top: Math.min(Math.max(Math.round(top), 0), Math.max(0, contH - dotH))
    };
  }
  function _dotPosPersisted() {
    try {
      var raw = storageGet("oi_welcome_dot_pos");
      if (!raw) return null;
      var pos = JSON.parse(raw);
      if (typeof pos.left !== "number" || typeof pos.top !== "number") return null;
      return pos;
    } catch (e) { return null; }
  }
  // 内联 left/top 定位时，必须同时把 right/bottom 置为 auto，
  // 否则样式表默认 right:14px / bottom:115px 恢复，top+bottom（或 left+right）同时生效会把
  // absolute 元素拉伸成不可控尺寸。
  function _pinPosition(wrap) {
    wrap.style.right = "auto";
    wrap.style.bottom = "auto";
  }
  function _applyDotPos(wrap) {
    try {
      var pos = _dotPosPersisted();
      if (pos && wrap) {
        wrap.style.left = pos.left + "px";
        wrap.style.top = pos.top + "px";
        _pinPosition(wrap);
      }
    } catch (e) {}
  }
  function _startDrag(e, byDot) {
    var wrap = _wrapEl, dot = _dotEl;
    if (!wrap || (_tourHidden && !_tourDragEnabled)) { _drag = null; return; }
    if (byDot && !_collapsed) { _drag = null; return; }  // 圆钮只在收起态可拖
    if (!byDot && _collapsed) { _drag = null; return; }  // 面板只在展开态可拖
    var container = containerFor();
    if (!container) return;
    try {
      var wrapRect = wrap.getBoundingClientRect();
      var contRect = container.getBoundingClientRect();
      var drag = {
        startX: e.clientX, startY: e.clientY,
        origLeft: wrapRect.left - contRect.left,
        origTop: wrapRect.top - contRect.top,
        contW: contRect.width, contH: contRect.height,
        byDot: byDot,
        moved: false, pointerId: e.pointerId || 0
      };
      if (byDot && dot) {
        var dotRect = dot.getBoundingClientRect();
        drag.dotOffLeft = dotRect.left - wrapRect.left;
        drag.dotOffTop = dotRect.top - wrapRect.top;
        drag.dotW = dotRect.width; drag.dotH = dotRect.height;
      } else {
        drag.wrapW = wrapRect.width; drag.wrapH = wrapRect.height;
      }
      _drag = drag;
      // capture 必须设在 pointerdown 实际触发的元素上（圆钮 / 面板头部手柄）：
      // capture 会把后续 move/up 全部路由到该元素，而 move/up 监听器也绑在它上面；
      // 若设在 wrap 上，事件被劫持到 wrap，head/dot 上的监听器收不到，拖拽会卡死。
      var captureEl = byDot ? dot : (e.currentTarget || wrap);
      if (captureEl && captureEl.setPointerCapture) {
        try { captureEl.setPointerCapture(_drag.pointerId); } catch (err) {}
      }
      if (wrap.classList) wrap.classList.add("dragging");
    } catch (err) { _drag = null; }
  }
  function _dotPointerDown(e) { _startDrag(e, true); }
  function _panelPointerDown(e) {
    // 头部手柄：排除 ✕ 收起按钮按下（按钮仍是点击语义）
    try {
      if (e.target && e.target.closest && e.target.closest(".welcome-collapse-btn")) { _drag = null; return; }
    } catch (err) {}
    _startDrag(e, false);
  }
  function _notifyTour(eventName) {
    try {
      if (window.ONBOARDING_TOUR && window.ONBOARDING_TOUR.notify) {
        window.ONBOARDING_TOUR.notify(eventName);
      }
    } catch (e) {}
  }
  function _dotPointerMove(e) {
    if (!_drag) return;
    var dx = e.clientX - _drag.startX;
    var dy = e.clientY - _drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > DOT_DRAG_THRESHOLD) _drag.moved = true;
    if (!_drag.moved || !_wrapEl) return;
    if (_drag.byDot) {
      // 按圆钮自身位置 clamp（圆钮可自由拖到面板任意位置），wrap 跟随其内部偏移
      var dotLeft = _drag.origLeft + _drag.dotOffLeft + dx;
      var dotTop = _drag.origTop + _drag.dotOffTop + dy;
      var pos = clampDotPos(dotLeft, dotTop, _drag.contW, _drag.contH, _drag.dotW, _drag.dotH);
      _wrapEl.style.left = (pos.left - _drag.dotOffLeft) + "px";
      _wrapEl.style.top = (pos.top - _drag.dotOffTop) + "px";
    } else {
      // 按 wrap 自身尺寸 clamp：展开面板必须完整留在容器内
      var p = clampDotPos(_drag.origLeft + dx, _drag.origTop + dy, _drag.contW, _drag.contH, _drag.wrapW, _drag.wrapH);
      _wrapEl.style.left = p.left + "px";
      _wrapEl.style.top = p.top + "px";
    }
    _pinPosition(_wrapEl);
    if (_tourDragEnabled) _notifyTour("assistant-panel-drag");
  }
  // 圆钮拖到边缘后展开时，把 wrap 拉回面板内，保证展开面板完整可见（不持久化）。
  // 必须在展开后调用：用展开后的真实高度计算边界。
  // 底部保留 115px 避让（与 CSS .welcome-float bottom:115px 一致）：不遮 mode 切换区
  // （38px）+ 输入框（65px）+ 间距。
  var WELCOME_BOTTOM_GUARD = 115;
  function _ensureWrapInside() {
    if (!_wrapEl) return;
    var container = containerFor();
    if (!container) return;
    try {
      var wr = _wrapEl.getBoundingClientRect();
      var cr = container.getBoundingClientRect();
      var left = Math.min(Math.max(wr.left - cr.left, 0), Math.max(0, cr.width - wr.width));
      var maxTop = Math.max(0, cr.height - wr.height - WELCOME_BOTTOM_GUARD);
      var top = Math.min(Math.max(wr.top - cr.top, 0), maxTop);
      _wrapEl.style.left = left + "px";
      _wrapEl.style.top = top + "px";
      _pinPosition(_wrapEl);
    } catch (e) {}
  }
  function _dotPointerUp() {
    if (!_drag) return;
    var moved = _drag.moved;
    var byDot = _drag.byDot;
    if (!moved) {
      if (byDot) {
        setCollapsed(false, false); // 圆钮未移动 → 视为点击展开
        _ensureWrapInside();        // 展开后拉回面板内（用展开后高度）
      }
      // 面板头部未移动 → 普通点击，无副作用
    } else {
      // 圆钮拖拽后的 click 不再触发展开；面板拖拽的 click 派发到头部（非圆钮），无需抑制
      if (byDot) _suppressDotClick = true;
      if (_wrapEl) {
        try {
          storageSet("oi_welcome_dot_pos", JSON.stringify({
            left: parseFloat(_wrapEl.style.left || "") || 0,
            top: parseFloat(_wrapEl.style.top || "") || 0
          }));
        } catch (err) {}
      }
    }
    if (moved && _tourDragEnabled) _notifyTour("assistant-panel-drag-end");
    var captureEl = byDot ? _dotEl : _wrapEl;
    if (captureEl && captureEl.releasePointerCapture) {
      try { captureEl.releasePointerCapture(_drag.pointerId || 0); } catch (err) {}
    }
    if (_wrapEl && _wrapEl.classList) _wrapEl.classList.remove("dragging");
    _drag = null;
  }
  function _bindDotDrag(dot) {
    try {
      dot.addEventListener("pointerdown", _dotPointerDown);
      dot.addEventListener("pointermove", _dotPointerMove);
      dot.addEventListener("pointerup", function (e) {
        if (_drag) _drag.pointerId = e.pointerId || _drag.pointerId;
        _dotPointerUp();
      });
    } catch (e) {}
  }
  // 展开态：面板头部（头像/标题区）作为拖拽手柄，拖动整个气泡组。
  // 监听器绑在每次新建的 panel 头部上，panel 重建时随之销毁。
  function _bindPanelDrag(panel) {
    try {
      var head = panel.querySelector(".welcome-head");
      if (!head || !head.addEventListener) return;
      head.addEventListener("pointerdown", _panelPointerDown);
      head.addEventListener("pointermove", _dotPointerMove);
      head.addEventListener("pointerup", function (e) {
        if (_drag) _drag.pointerId = e.pointerId || _drag.pointerId;
        _dotPointerUp();
      });
    } catch (e) {}
  }
  function _tourElementsPresent() {
    try {
      return document.querySelectorAll(".onboarding-mask-piece, .onboarding-popover").length > 0;
    } catch (e) { return false; }
  }
  function _applyTourHidden() {
    _tourHidden = _tourElementsPresent();
    if (!_tourHidden) _tourDragEnabled = false;
    if (_wrapEl) {
      _wrapEl.classList.remove("tour-hidden");
      _wrapEl.classList.toggle("onboarding-tour-active", _tourHidden);
      _wrapEl.classList.toggle("onboarding-tour-drag-enabled", _tourDragEnabled);
    }
  }
  function prepareForTour() {
    _tourHidden = true;
    _tourDragEnabled = false;
    setCollapsed(true, false);
    if (_wrapEl) {
      _wrapEl.classList.remove("tour-hidden");
      _wrapEl.classList.add("onboarding-tour-active");
      _wrapEl.classList.remove("onboarding-tour-drag-enabled");
    }
  }
  function setTourDragEnabled(enabled) {
    _tourDragEnabled = !!enabled && _tourHidden;
    if (_wrapEl) _wrapEl.classList.toggle("onboarding-tour-drag-enabled", _tourDragEnabled);
  }
  function endTour() {
    _tourHidden = false;
    _tourDragEnabled = false;
    if (_wrapEl) {
      _wrapEl.classList.remove("tour-hidden");
      _wrapEl.classList.remove("onboarding-tour-active");
      _wrapEl.classList.remove("onboarding-tour-drag-enabled");
    }
  }
  function _bindTourObserver() {
    if (_bodyObserver) return;
    try {
      _bodyObserver = new MutationObserver(function () { _applyTourHidden(); });
      _bodyObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  // 点击监听绑定在每次新建的 panel 上：panel 被 dismiss 移除时监听器随之销毁，
  // 避免常驻容器（#chatLog/#chatLogChat）上反复绑定累积监听器。
  function _bindPanel(panel) {
    try {
      panel.addEventListener("click", function (e) {
        var t = e.target;
        var flowAction = t && t.closest && t.closest("[data-flow-action]");
        if (flowAction) {
          var action = flowAction.getAttribute("data-flow-action");
          if (action === "confirm") _resetCompletedFlow();
          if (action === "later") _dismissCompletionPrompt();
          return;
        }
        if (t && t.closest && t.closest(".welcome-chip")) {
          var chip = t.closest(".welcome-chip");
          var kind = chip.getAttribute("data-kind") || "report";
          _requestMode(kind === "chat" ? "chat" : "report");
          _handleChipClick(kind, chip.getAttribute("data-text") || "");
          return;
        }
        var col = t && t.closest && t.closest(".welcome-col");
        if (col) {
          _requestMode(col.classList && col.classList.contains("chat") ? "chat" : "report");
        }
      });
    } catch (err) {}
  }
  function _requestMode(mode) {
    if (mode !== "report" && mode !== "chat") return;
    try {
      document.dispatchEvent(new CustomEvent("chatbot-mode-requested", {
        detail: { mode: mode }
      }));
    } catch (e) {}
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
  // 常驻 sticky 卡片（.chat-reminder），用与 Report Mode 相同的层级说明 Chat 的使用方式。
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
        '<div class="chat-reminder-mark" aria-hidden="true">◈</div>' +
        '<div class="chat-reminder-content">' +
        '<span class="chat-reminder-kicker">' + escapeHtml(currentCopy("chatReminderKicker")) + '</span>' +
        '<h3 class="chat-reminder-title" id="chatModeReminderTitle">' + escapeHtml(currentCopy("chatReminderTitle")) + '</h3>' +
        '<p class="chat-reminder-body">' + escapeHtml(currentCopy("chatReminderBody")) + '</p>' +
        '<p class="chat-reminder-reminder"><span aria-hidden="true">→</span>' +
        '<strong>' + escapeHtml(currentCopy("chatReminderReminder")) + '</strong>' +
        '<button type="button" class="chat-reminder-action">' + escapeHtml(currentCopy("goReport")) + '</button></p>' +
        '</div>');
      card.setAttribute("role", "note");
      card.setAttribute("aria-labelledby", "chatModeReminderTitle");
      var actionBtn = card.querySelector(".chat-reminder-action");
      if (actionBtn) actionBtn.addEventListener("click", _goReportFromReminder);
      if (log.insertBefore) log.insertBefore(card, log.firstChild || null);
    } catch (e) {}
  }
  function _goReportFromReminder() {
    try { document.dispatchEvent(new CustomEvent("chatbot-go-report")); } catch (e) {}
    _fillFirstReportExample();
  }
  function _fillFirstReportExample() {
    var ex = WELCOME_EXAMPLES.report[0];
    if (!ex) return;
    fillInput(resolveExampleText(ex, exampleMerchant(_offers)));
  }
  function fillInput(text) {
    var input = null;
    try { input = document.getElementById("chatInput"); } catch (e) {}
    if (!input) return false;
    input.value = text;
    _lastFillValue = text;
    _tipFromExample = true;
    _pulseSend(true);
    return true;
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
  function _resetCompletedFlow() {
    if (flowStage(_flowState()) !== "chatActive") return;
    _hasReport = false;
    _hasAddedToChat = false;
    _hasChatSent = false;
    _completionPromptDismissed = false;
    _refreshProgress();
    _clearTipbar();
    _pulseSend(false);
  }
  function _dismissCompletionPrompt() {
    if (flowStage(_flowState()) !== "chatActive") return;
    _completionPromptDismissed = true;
    _refreshProgress();
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
      if (payload.mode === "report") _hasReport = true;
      if (payload.mode === "chat") _hasChatSent = true;
      _refreshProgress();
      // 气泡：发送消息只清提示条/脉冲——收起/展开完全由用户手动（✕ / 圆钮）决定
      _clearTipbar();
      _tipFromExample = false;
      _pulseSend(false);
      return;
    }
    if (eventName === "flow-complete-confirmed") {
      _resetCompletedFlow();
      return;
    }
    if (eventName === "report-ready") {
      // 报告已真正生成：作为 Report 提问事件缺少 mode 时的兜底，推进核心三步的第一步。
      _hasReport = true;
      _refreshProgress();
      if (_panelTipShown || !payload.panelEl) return;
      _panelTipShown = true;
      _insertPanelTip(payload.panelEl);
      return;
    }
    if (eventName === "panel-minimized") {
      _hasPill = true;
      _showTipbar("minimizedTip");
      return;
    }
    if (eventName === "panel-expanded") {
      _hasPill = _anyMinimizedPanel();
      if (!_hasPill) _clearTipbar();
      return;
    }
    if (eventName === "chat-add") {
      _hasAddedToChat = true;
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      _refreshProgress();
      _clearTipbar();
      _pulseSend(false);
      return;
    }
    if (eventName === "mode-switched") {
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      var mode = payload.mode === "chat" ? "chat" : "report";
      _mode = mode;
      _applyModeClass(_wrapEl, mode); // 焦点栏随模式切换
      _refreshProgress();
      // Chat Mode → 聊天区顶部渲染提醒卡片；Report Mode → 移除
      _syncChatReminder(mode);
      return;
    }
    if (eventName === "memory-added") {
      _hasMemory = true;
      _refreshProgress();
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
    fillInput: fillInput,
    prepareForTour: prepareForTour,
    endTour: endTour,
    setTourDragEnabled: setTourDragEnabled,
    _test: {
      examples: WELCOME_EXAMPLES,
      copy: WELCOME_COPY,
      currentLanguage: currentLanguage,
      merchantForExample: merchantForExample,
      shouldRenderFor: shouldRenderFor,
      containerFor: containerFor,
      defaultCollapsed: defaultCollapsed,
      tourDone: tourDone,
      isCollapsed: function () { return _collapsed; },
      tourHidden: function () { return _tourHidden; },
      prepareForTour: prepareForTour,
      endTour: endTour,
      setTourDragEnabled: setTourDragEnabled,
      setCollapsed: setCollapsed,
      resetCollapsed: function () { _collapsed = defaultCollapsed(); },
      refreshTourHidden: _applyTourHidden,
      wrapElement: function () { return _wrapEl; },
      panelElement: function () { return _panelEl; },
      clampDotPos: clampDotPos,
      dotPosPersisted: _dotPosPersisted,
      dotPointerDown: _dotPointerDown,
      dotPointerMove: _dotPointerMove,
      dotPointerUp: _dotPointerUp,
      panelPointerDown: _panelPointerDown,
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
      requestMode: _requestMode,
      modeClass: function () { // 当前 wrap 的模式焦点类（供测试断言）
        return _wrapEl ? (_wrapEl.classList.contains("mode-chat") ? "chat" : "report") : null;
      },
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
      resetCompletedFlow: _resetCompletedFlow,
      dismissCompletionPrompt: _dismissCompletionPrompt,
      flowState: function () {
        return {
          hasReport: _hasReport,
          hasPill: _hasPill,
          hasMemory: _hasMemory,
          hasAddedToChat: _hasAddedToChat,
          hasChatSent: _hasChatSent,
          completionPromptDismissed: _completionPromptDismissed,
          isChat: _mode === "chat"
        };
      },
      progressHtml: progressHtml,
      chatReminderHtml: function () {
        var log = _chatLogChatElement();
        if (!log || !log.querySelector) return "";
        var card = log.querySelector(".chat-reminder");
        return card && card.innerHTML ? card.innerHTML : "";
      },
      triggerGoReport: _goReportFromReminder
    }
  };
})();
