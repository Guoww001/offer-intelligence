var fs = require("fs");
var c = fs.readFileSync("public/app.js", "utf-8");

// 1. Add reportMemory to state
c = c.replace(
  "deepHistory: []",
  "deepHistory: [],\n    reportMemory: []"
);
console.log("1. Added reportMemory to state");

// 2. Add chatMemoryBar/chatMemoryChips to els
c = c.replace(
  "modeDeepBtn: null",
  "modeDeepBtn: null,\n    chatMemoryBar: null,\n    chatMemoryChips: null"
);
console.log("2. Added chatMemory refs to els");

// 3. Add i18n strings
c = c.replace(
  '"deep.placeholder": "View analysis results in Deep Window…"',
  '"deep.placeholder": "View analysis results in Deep Window…",\n      "memory.hint": "将面板拖入此处作为上下文",\n      "memory.hint.en": "Drop panel here to use as context"'
);
console.log("3. Added i18n strings");

// 4. Insert memory functions before _NUMERIC_COL_PATTERNS
var numPatterns = c.indexOf("var _NUMERIC_COL_PATTERNS = [");
if (numPatterns < 0) throw new Error("_NUMERIC_COL_PATTERNS not found");

var memoryFunctions = `

  // ═════════════════════════════════
  // 报告记忆系统 — 面板拖入对话作为上下文
  // ═════════════════════════════════
  function _extractPanelMemory(panel) {
    var title = panel.title || panel.prompt || "Untitled";
    var sectionsEl = panel.sectionsEl;
    var textContent = "";
    var htmlContent = "";
    if (sectionsEl) {
      textContent = sectionsEl.textContent.replace(/\\s+/g, " ").trim();
      htmlContent = sectionsEl.innerHTML;
    }
    return {
      id: "mem-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      title: title,
      textContent: textContent.slice(0, 2000),
      html: htmlContent,
      timestamp: Date.now(),
      panelId: panel.id
    };
  }

  function _addMemoryFromPanel(panel) {
    var memory = _extractPanelMemory(panel);
    state.reportMemory.push(memory);
    _renderMemoryBar();
  }

  function _removeReportMemory(id) {
    state.reportMemory = state.reportMemory.filter(function (m) { return m.id !== id; });
    _renderMemoryBar();
  }

  function _renderMemoryBar() {
    var bar = els.chatMemoryBar;
    var chips = els.chatMemoryChips;
    if (!bar || !chips) return;

    if (!state.deepMode && state.reportMemory.length > 0) {
      bar.classList.remove("hidden");
      chips.innerHTML = state.reportMemory.map(function (m) {
        return '<div class="chat-memory-chip" title="' + escapeHtml(m.textContent.slice(0, 100)) + '">' +
          '<span class="chat-memory-chip-label">' + escapeHtml(m.title) + '</span>' +
          '<button class="chat-memory-chip-remove" data-memory-id="' + m.id + '" type="button">✕</button>' +
          '</div>';
      }).join("");
      chips.querySelectorAll(".chat-memory-chip-remove").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          _removeReportMemory(btn.dataset.memoryId);
        });
      });
      _updateMemoryContext();
    } else {
      bar.classList.add("hidden");
      chips.innerHTML = "";
    }
  }

  function _updateMemoryContext() {
    if (state.reportMemory.length > 0) {
      state.reportMemoryContext = state.reportMemory.map(function (m) {
        return "[上下文: " + m.title + "] " + m.textContent.slice(0, 500);
      }).join("\\n---\\n");
    } else {
      state.reportMemoryContext = null;
    }
  }
`;

c = c.slice(0, numPatterns) + memoryFunctions + "\n" + c.slice(numPatterns);
console.log("4. Added memory functions");

// 5. Now replace applyPrompt
var fnStart = c.indexOf("async function applyPrompt(prompt) {");
if (fnStart < 0) throw new Error("applyPrompt not found");

// Find the end of the function by counting braces
var depth = 0;
var fnEnd = -1;
for (var i = fnStart; i < c.length; i++) {
  if (c[i] === "{") depth++;
  if (c[i] === "}") {
    depth--;
    if (depth === 0) {
      fnEnd = i + 1;
      break;
    }
  }
}
if (fnEnd < 0) throw new Error("Could not find end of applyPrompt");

var beforeFn = c.slice(0, fnStart);
var afterFn = c.slice(fnEnd);

var newApply =
`async function applyPrompt(prompt) {
    const language = responseLanguageFor(prompt);
    var panel = null;
    var isDeep = state.deepMode;

    addMessage("user", escapeHtml(prompt));

    // ════════════════════════════════════════
    // Chat Mode (fast): 流式 LLM 回答
    // ════════════════════════════════════════
    if (!isDeep) {
      const loadingText = language === "zh" ? "正在思考…" : "Thinking…";
      var loadingMsg = document.createElement("div");
      loadingMsg.className = "message assistant loading-indicator";
      loadingMsg.textContent = loadingText;
      els.chatLog.appendChild(loadingMsg);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;

      // 构建记忆上下文
      var memoryText = null;
      if (state.reportMemory.length > 0) {
        memoryText = state.reportMemory.map(function (m) {
          return "[上下文: " + m.title + "] " + m.textContent.slice(0, 500);
        }).join("\\n---\\n");
      }

      try {
        var responseStream = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt,
            memory: memoryText,
            language: language
          })
        });

        loadingMsg.remove();

        if (!responseStream.ok) {
          addMessage("assistant", language === "zh" ? "请求失败，请稍后重试。" : "Request failed, please retry.");
          return;
        }

        // 创建 assistant 消息容器
        var msgEl = document.createElement("div");
        msgEl.className = "message assistant";
        els.chatLog.appendChild(msgEl);
        els.chatLog.scrollTop = els.chatLog.scrollHeight;

        // 实时状态栏：计时 + Token 计数
        var statusBar = document.createElement("div");
        statusBar.className = "chat-stream-status";
        msgEl.appendChild(statusBar);

        var tokenCount = 0;
        var streamStartTime = Date.now();
        var timerTick = setInterval(function () {
          var e = ((Date.now() - streamStartTime) / 1000).toFixed(1);
          statusBar.textContent = language === "zh"
            ? "⏱ " + e + "秒 · ⊞ " + tokenCount + " tokens"
            : "⏱ " + e + "s · ⊞ " + tokenCount + " tokens";
        }, 100);

        // 流式读取 SSE 响应
        var reader = responseStream.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";
        var doneReading = false;

        while (!doneReading) {
          var readResult = await reader.read();
          if (readResult.done) break;

          buffer += decoder.decode(readResult.value, { stream: true });
          var lines = buffer.split("\\n");
          buffer = lines.pop() || "";

          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            if (line.startsWith("data: ")) {
              var payload = line.slice(6).trim();
              if (payload === "[DONE]") {
                doneReading = true;
                break;
              }
              try {
                var parsed = JSON.parse(payload);
                if (parsed.token) {
                  msgEl.textContent += parsed.token;
                  tokenCount++;
                  els.chatLog.scrollTop = els.chatLog.scrollHeight;
                }
              } catch (e) { /* skip malformed SSE lines */ }
            }
          }
        }

        // 流式结束，停止计时器，显示最终状态
        clearInterval(timerTick);
        var finalElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
        statusBar.textContent = language === "zh"
          ? "⏱ " + finalElapsed + "秒 · ⊞ " + tokenCount + " tokens"
          : "⏱ " + finalElapsed + "s · ⊞ " + tokenCount + " tokens";
        els.chatLog.scrollTop = els.chatLog.scrollHeight;
      } catch (error) {
        loadingMsg.remove();
        console.error("[chat-stream] fetch error:", error);
        addMessage("assistant",
          (language === "zh" ? "网络错误，请稍后重试。" : "Network error, please retry.")
          + " (" + escapeHtml(error.message || "") + ")"
        );
      }
      return;
    }

    // ════════════════════════════════════════
    // Deep Mode (Report Mode): 面板 + 分类 + 现有回答管道
    // ════════════════════════════════════════
    panel = _createDeepPanel(prompt);
    _showPanelSkeleton(panel, false);
    await new Promise(function (r) { setTimeout(r, 50); });

    if (state.llmEnabled !== false && !canSkipLLMClassify(prompt)) {
      const loadingText = language === "zh" ? "正在理解你的问题…" : "Understanding your question…";
      var loadingMsg2 = document.createElement("div");
      loadingMsg2.className = "message assistant loading-indicator";
      loadingMsg2.textContent = loadingText;
      els.chatLog.appendChild(loadingMsg2);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
      const result = await classifyWithLLM(prompt, collectCategories());
      loadingMsg2.remove();
      state.llmClassifyResult = result;
    } else {
      state.llmClassifyResult = null;
      if (state.llmEnabled !== false) {
        console.log("[LLM] skipped — regex classification is sufficient for: " + prompt.slice(0, 60));
      }
    }
    state.reportMemoryContext = null;

    const dbMerchantOffer = dbMerchantOfferForPrompt(prompt);
    try {
      var html = answerPrompt(prompt);

      if (panel) {
        _showQuickResultInDeepPanel(panel, html, prompt);
        addMessage("assistant", _deepQuickSummaryHtml(panel, prompt, html));
      } else {
        addMessage("assistant", html);
      }
    } catch (error) {
      console.error("[analysis] answerPrompt error:", error);
      var errMsg = (language === "zh"
        ? "抱歉，分析过程出错。请稍后重试。"
        : "Sorry, an error occurred. Please try again.") + " (" + escapeHtml(error.message || "unknown") + ")";
      if (panel) {
        _showPanelError(panel, errMsg);
      } else {
        addMessage("assistant", errMsg);
      }
    }
    if (dbMerchantOffer) loadDbMerchantInsight(dbMerchantOffer);
    else loadDbSearchInsight(prompt);
  }
`;

c = beforeFn + newApply + afterFn;
console.log("5. Replaced applyPrompt");

// 6. Update drag system
// 6a. _initPanelDrag - add originalLeft/originalTop
c = c.replace(
  "panelLeft: rect.left, panelTop: rect.top,",
  "panelLeft: rect.left, panelTop: rect.top,\n            originalLeft: rect.left, originalTop: rect.top,"
);
console.log("6a. Updated _initPanelDrag");

// 6b. _onPanelDragMove - add chat log collision
c = c.replace(
  'panel.el.style.top = newTop + "px";\n\n    // Check for chat mode intent',
  'panel.el.style.top = newTop + "px";\n\n    // 检测面板是否拖到对话区域上方\n    if (els.chatLog) {\n      var chatRect = els.chatLog.getBoundingClientRect();\n      var isOver = e.clientX >= chatRect.left && e.clientX <= chatRect.right &&\n                   e.clientY >= chatRect.top && e.clientY <= chatRect.bottom;\n      if (isOver && !panel._dropZoneActive) {\n        panel._dropZoneActive = true;\n        panel._overChatTarget = true;\n        els.chatLog.classList.add("drop-highlight");\n      } else if (!isOver && panel._dropZoneActive) {\n        panel._dropZoneActive = false;\n        panel._overChatTarget = false;\n        els.chatLog.classList.remove("drop-highlight");\n      }\n    }\n\n    // Check for chat mode intent'
);
console.log("6b. Updated _onPanelDragMove");

// 6c. _onPanelDragEnd - reset position and add memory when over chat
c = c.replace(
  'var wasMinClick = panel.minimized && !panel.dragState.moved;\n      // 拖放到聊天区域 → 加入记忆\n      if (panel.dragState.moved && panel._overChatTarget) {\n        _addMemoryFromPanel(panel);\n        var origLeft = panel.dragState.originalLeft;\n        var origTop = panel.dragState.originalTop;\n        panel.el.style.left = origLeft + "px";\n        panel.el.style.top = origTop + "px";\n      }\n      panel.dragState = null;\n      panel.el.classList.remove("dragging");\n      panel._overChatTarget = false;\n      panel._dropZoneActive = false;\n      if (els.chatLog) els.chatLog.classList.remove("drop-highlight");',
  'var wasMinClick = panel.minimized && !panel.dragState.moved;\n      // 拖放到聊天区域 → 加入记忆\n      if (panel.dragState.moved && panel._overChatTarget) {\n        _addMemoryFromPanel(panel);\n        var origLeft = panel.dragState.originalLeft;\n        var origTop = panel.dragState.originalTop;\n        panel.el.style.left = origLeft + "px";\n        panel.el.style.top = origTop + "px";\n      }\n      panel.dragState = null;\n      panel.el.classList.remove("dragging");\n      panel._overChatTarget = false;\n      panel._dropZoneActive = false;\n      if (els.chatLog) els.chatLog.classList.remove("drop-highlight");'
);
console.log("6c. Updated _onPanelDragEnd");

// 7. Update init() - add DOM references and _renderMemoryBar()
c = c.replace(
  'els.modeDeepBtn = document.getElementById("modeDeepBtn");',
  'els.modeDeepBtn = document.getElementById("modeDeepBtn");\n    els.chatMemoryBar = document.getElementById("chatMemoryBar");\n    els.chatMemoryChips = document.getElementById("chatMemoryChips");\n    _renderMemoryBar();'
);
console.log("7. Updated init() DOM refs");

// 8. Update mode switch handlers - add _renderMemoryBar to deep mode button
c = c.replace(
  'els.modeDeepBtn?.addEventListener("click", () => {\n      state.deepMode = true;\n      els.modeDeepBtn.classList.add("active");\n      els.modeFastBtn.classList.remove("active");\n      els.chatInput.placeholder = t("deep.placeholder", "View analysis results in Deep Window…");',
  'els.modeDeepBtn?.addEventListener("click", () => {\n      state.deepMode = true;\n      els.modeDeepBtn.classList.add("active");\n      els.modeFastBtn.classList.remove("active");\n      els.chatInput.placeholder = t("deep.placeholder", "View analysis results in Deep Window…");\n      _renderMemoryBar();'
);
console.log("8. Updated mode switch handlers");

// 9. Add _renderMemoryBar to FAB handler
c = c.replace(
  'state.deepMode = true;\n        els.modeDeepBtn?.classList.add("active");\n        els.modeFastBtn?.classList.remove("active");\n        _renderMemoryBar();\n        els.chatInput.placeholder = t("deep.placeholder", "View analysis results in Deep Window…");',
  'state.deepMode = true;\n        els.modeDeepBtn?.classList.add("active");\n        els.modeFastBtn?.classList.remove("active");\n        _renderMemoryBar();\n        els.chatInput.placeholder = t("deep.placeholder", "View analysis results in Deep Window…");'
);
console.log("9. FAB handler already has _renderMemoryBar");

fs.writeFileSync("public/app.js", c);
console.log("\nALL CHANGES APPLIED");
