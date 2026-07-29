/**
 * Apply ALL Chat Mode changes to a FRESH git checkout of app.js.
 * Run: git checkout -- public/app.js && node scripts/fix_chat_mode.js
 */
const fs = require("fs");
let c = fs.readFileSync("public/app.js", "utf-8");

// ── 1. els ──
c = c.replace(
  "chatLog: document.getElementById(\"chatLog\"),",
  "chatLog: document.getElementById(\"chatLog\"),\n    chatLogChat: document.getElementById(\"chatLogChat\"),"
);
console.log("1. chatLogChat in els");

// ── 2. state ──
c = c.replace(
  "reportMemory: []",
  "reportMemory: [],\n    chatHistory: []"
);
console.log("2. chatHistory in state");

// ── 3. init() DOM refs + _syncChatLogVisibility call ──
c = c.replace(
  "els.modeDeepBtn = els.chatModeToggle?.querySelector('[data-mode=\"deep\"]');",
  "els.modeDeepBtn = els.chatModeToggle?.querySelector('[data-mode=\"deep\"]');\n\n    els.chatMemoryBar = document.getElementById(\"chatMemoryBar\");\n    els.chatMemoryChips = document.getElementById(\"chatMemoryChips\");\n    _syncChatLogVisibility();"
);
console.log("3. init DOM refs");

// ── 4. _syncChatLogVisibility before _NUMERIC_COL_PATTERNS ──
c = c.replace(
  "var _NUMERIC_COL_PATTERNS = [",
  "function _syncChatLogVisibility() {\n    var chatLog = els.chatLog;\n    var chatLogChat = els.chatLogChat;\n    var isChat = !state.deepMode;\n    if (chatLog) chatLog.classList.toggle(\"hidden\", isChat);\n    if (chatLogChat) chatLogChat.classList.toggle(\"hidden\", !isChat);\n  }\n\n  " +
  "function _renderMemoryBar() {\n" +
  "    var bar = els.chatMemoryBar;\n" +
  "    var chips = els.chatMemoryChips;\n" +
  "    if (!bar || !chips) return;\n" +
  "    if (!state.deepMode) {\n" +
  "      bar.classList.remove(\"hidden\");\n" +
  "      chips.innerHTML = state.reportMemory.length > 0\n" +
  '        ? state.reportMemory.map(function (m) {\n' +
  "            return '<div class=\"chat-memory-chip\" title=\"' + escapeHtml(m.textContent.slice(0, 100)) + '\">' +\n" +
  "              '<span class=\"chat-memory-chip-label\">' + escapeHtml(m.title) + '</span>' +\n" +
  '              \'<button class="chat-memory-chip-remove" data-memory-id="\' + m.id + \'" type="button">✕</button>\' +\n' +
  "              '</div>';\n" +
  "          }).join(\"\")\n" +
  '        : "";\n' +
  '      chips.querySelectorAll(".chat-memory-chip-remove").forEach(function (btn) {\n' +
  "        btn.addEventListener(\"click\", function (e) {\n" +
  "          e.stopPropagation();\n" +
  "          _removeReportMemory(btn.dataset.memoryId);\n" +
  "        });\n" +
  "      });\n" +
  "      _updateMemoryContext();\n" +
  "    } else {\n" +
  '      bar.classList.add("hidden");\n' +
  '      chips.innerHTML = "";\n' +
  "    }\n" +
  "  }\n\n" +
  "var _NUMERIC_COL_PATTERNS = ["
);
console.log("4. _syncChatLogVisibility + _renderMemoryBar");

// ── 5. Mode switch handlers ──
c = c.replace(
  "els.modeFastBtn?.addEventListener(\"click\", () => {\n      state.deepMode = false;\n      els.modeFastBtn.classList.add(\"active\");\n      els.modeDeepBtn.classList.remove(\"active\");\n      els.chatInput.placeholder = t(\"chat.placeholder\", \"Ask about EPC, tiers, AOV, conversion, unpaid offers...\");\n    });\n\n    els.modeDeepBtn?.addEventListener(\"click\", () => {\n      state.deepMode = true;\n      els.modeDeepBtn.classList.add(\"active\");\n      els.modeFastBtn.classList.remove(\"active\");\n      els.chatInput.placeholder = t(\"deep.placeholder\", \"View analysis results in Deep Window…\");\n    });",
  "els.modeFastBtn?.addEventListener(\"click\", () => {\n      state.deepMode = false;\n      els.modeFastBtn.classList.add(\"active\");\n      els.modeDeepBtn.classList.remove(\"active\");\n      els.chatInput.placeholder = t(\"chat.placeholder\", \"Ask about EPC, tiers, AOV, conversion, unpaid offers...\");\n      _syncChatLogVisibility();\n      _renderMemoryBar();\n    });\n\n    els.modeDeepBtn?.addEventListener(\"click\", () => {\n      state.deepMode = true;\n      els.modeDeepBtn.classList.add(\"active\");\n      els.modeFastBtn.classList.remove(\"active\");\n      els.chatInput.placeholder = t(\"deep.placeholder\", \"View analysis results in Deep Window…\");\n      _syncChatLogVisibility();\n      _renderMemoryBar();\n    });"
);
console.log("5. Mode switch handlers");

// ── 6. FAB handler ──
c = c.replace(
  "els.chatInput.placeholder = t(\"deep.placeholder\", \"View analysis results in Deep Window…\");\n      }\n      els.chatInput?.focus();",
  "els.chatInput.placeholder = t(\"deep.placeholder\", \"View analysis results in Deep Window…\");\n        _syncChatLogVisibility();\n        _renderMemoryBar();\n      }\n      els.chatInput?.focus();"
);
console.log("6. FAB handler");

// ── 7. Drag target → memory bar ──
c = c.replace(
  "// Check for chat mode intent\n    if (els.chatLog) {\n      var chatRect = els.chatLog.getBoundingClientRect();",
  "// Check for chat mode intent\n    if (els.chatMemoryBar) {\n      var chatRect = els.chatMemoryBar.getBoundingClientRect();"
);
c = c.replace(
  "panel._overChatTarget = true;\n        els.chatLog.classList.add(\"drop-highlight\");\n      } else if (!isOver && panel._dropZoneActive) {\n        panel._dropZoneActive = false;\n        panel._overChatTarget = false;\n        els.chatLog.classList.remove(\"drop-highlight\");\n      }",
  "panel._overChatTarget = true;\n        els.chatMemoryBar.classList.add(\"drop-highlight\");\n      } else if (!isOver && panel._dropZoneActive) {\n        panel._dropZoneActive = false;\n        panel._overChatTarget = false;\n        els.chatMemoryBar.classList.remove(\"drop-highlight\");\n      }"
);
c = c.replace(
  "if (els.chatLog) els.chatLog.classList.remove(\"drop-highlight\");",
  "if (els.chatMemoryBar) els.chatMemoryBar.classList.remove(\"drop-highlight\");"
);
console.log("7. Drag target");

// ── 8. Replace applyPrompt entirely ──
var fnMatch = c.match(/async function applyPrompt\(prompt\) \{[\s\S]*?\n  \}/);
if (!fnMatch) throw new Error("Cannot find applyPrompt");

var newApply =
`async function applyPrompt(prompt) {
    const language = responseLanguageFor(prompt);
    var panel = null;
    var isDeep = state.deepMode;

    // ════════════════════════════════════════
    // Chat Mode: 流式 LLM 回答（独立聊天区）
    // ════════════════════════════════════════
    if (!isDeep) {
      var _chatLog = els.chatLogChat || els.chatLog;

      // 保存用户消息
      state.chatHistory.push({ role: "user", content: prompt });
      var _userMsg = document.createElement("div");
      _userMsg.className = "message user";
      _userMsg.textContent = prompt;
      _chatLog.appendChild(_userMsg);
      _chatLog.scrollTop = _chatLog.scrollHeight;

      const loadingText = language === "zh" ? "正在思考…" : "Thinking…";
      var loadingMsg = document.createElement("div");
      loadingMsg.className = "message assistant loading-indicator";
      loadingMsg.textContent = loadingText;
      _chatLog.appendChild(loadingMsg);
      _chatLog.scrollTop = _chatLog.scrollHeight;

      // 记忆上下文
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
            language: language,
            history: state.chatHistory.slice(0, -1)
          })
        });
        loadingMsg.remove();

        if (!responseStream.ok) {
          var _failMsg = document.createElement("div");
          _failMsg.className = "message assistant";
          _failMsg.textContent = language === "zh" ? "请求失败，请稍后重试。" : "Request failed, please retry.";
          _chatLog.appendChild(_failMsg);
          _chatLog.scrollTop = _chatLog.scrollHeight;
          return;
        }

        var msgEl = document.createElement("div");
        msgEl.className = "message assistant";
        var msgContent = document.createElement("div");
        msgContent.className = "chat-stream-text";
        msgEl.appendChild(msgContent);
        var statusBar = document.createElement("div");
        statusBar.className = "chat-stream-status";
        msgEl.appendChild(statusBar);
        _chatLog.appendChild(msgEl);
        _chatLog.scrollTop = _chatLog.scrollHeight;

        var tokenCount = 0;
        var fullResponse = "";
        var streamStartTime = Date.now();

        var thinkingZh = ["思考中", "分析中", "处理中", "生成中", "整合中"];
        var thinkingEn = ["thinking", "analyzing", "processing", "generating", "compiling"];
        var thinkIdx = 0;
        var thinkTicks = 0;
        var timerTick = setInterval(function () {
          var e = ((Date.now() - streamStartTime) / 1000).toFixed(1);
          thinkTicks++;
          if (thinkTicks % 30 === 0) {
            thinkIdx = (thinkIdx + 1) % (language === "zh" ? thinkingZh.length : thinkingEn.length);
          }
          var word = language === "zh" ? thinkingZh[thinkIdx] : thinkingEn[thinkIdx];
          var timeUnit = language === "zh" ? "秒" : "s";
          statusBar.textContent = "\\u23f1 " + e + timeUnit + " \\u00b7 " + word + "…";
        }, 100);

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
              if (payload === "[DONE]") { doneReading = true; break; }
              try {
                var parsed = JSON.parse(payload);
                if (parsed.token) {
                  msgContent.textContent += parsed.token;
                  fullResponse += parsed.token;
                  tokenCount++;
                  _chatLog.scrollTop = _chatLog.scrollHeight;
                }
              } catch (e) { /* skip malformed SSE */ }
            }
          }
        }

        state.chatHistory.push({ role: "assistant", content: fullResponse });
        clearInterval(timerTick);
        var finalElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
        statusBar.textContent = language === "zh"
          ? "\\u23f1 " + finalElapsed + "秒 \\u00b7 \\u229e " + tokenCount + " tokens"
          : "\\u23f1 " + finalElapsed + "s \\u00b7 \\u229e " + tokenCount + " tokens";
        _chatLog.scrollTop = _chatLog.scrollHeight;
      } catch (error) {
        loadingMsg.remove();
        console.error("[chat-stream] fetch error:", error);
        var _errMsg = document.createElement("div");
        _errMsg.className = "message assistant";
        _errMsg.textContent = (language === "zh" ? "网络错误，请稍后重试。" : "Network error, please retry.")
          + " (" + (error.message || "") + ")";
        _chatLog.appendChild(_errMsg);
        _chatLog.scrollTop = _chatLog.scrollHeight;
      }
      return;
    }

    // ════════════════════════════════════════
    // Report Mode (Deep): 面板 + 现有分析管道
    // ════════════════════════════════════════

    // 用户消息用原有 addMessage（Report Mode 聊天区）
    addMessage("user", escapeHtml(prompt));

    if (isDeep) {
      panel = _createDeepPanel(prompt);
      _showPanelSkeleton(panel, false);
      await new Promise(function (r) { setTimeout(r, 50); });
    }

    if (state.llmEnabled !== false && !canSkipLLMClassify(prompt)) {
      const loadingText = language === "zh" ? "正在理解你的问题…" : "Understanding your question…";
      const loadingMsg = document.createElement("div");
      loadingMsg.className = "message assistant loading-indicator";
      loadingMsg.textContent = loadingText;
      els.chatLog.appendChild(loadingMsg);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
      const result = await classifyWithLLM(prompt, collectCategories());
      loadingMsg.remove();
      state.llmClassifyResult = result;
    } else {
      state.llmClassifyResult = null;
    }
    state.reportMemoryContext = null;

    const dbMerchantOffer = dbMerchantOfferForPrompt(prompt);
    try {
      var html = answerPrompt(prompt);
      if (isDeep && panel) {
        _showQuickResultInDeepPanel(panel, html, prompt);
        addMessage("assistant", _deepQuickSummaryHtml(panel, prompt));
      } else {
        addMessage("assistant", html);
      }
    } catch (error) {
      console.error("[analysis] answerPrompt error:", error);
      var errMsg = (language === "zh"
        ? "抱歉，分析过程出错。请稍后重试。"
        : "Sorry, an error occurred. Please try again.") + " (" + escapeHtml(error.message || "unknown") + ")";
      if (isDeep && panel) {
        _showPanelError(panel, errMsg);
      } else {
        addMessage("assistant", errMsg);
      }
    }
    if (dbMerchantOffer) loadDbMerchantInsight(dbMerchantOffer);
    else loadDbSearchInsight(prompt);
  }`;

c = c.replace(fnMatch[0], newApply);
console.log("8. Replaced applyPrompt");

// ── Final verification: only flag joins with literal newlines INSIDE quotes
var invalidJoins = c.match(/\)\.join\("[\s\S]*?\n[\s\S]*?"\);/g);
if (invalidJoins) {
  // Filter out those where the newline is AFTER the closing quote
  var realProblems = invalidJoins.filter(function(j) {
    var q1 = j.indexOf('"');
    var q2 = j.indexOf('"', q1 + 1);
    var inner = j.slice(q1 + 1, q2);
    return inner.indexOf('\n') >= 0;
  });
  if (realProblems.length > 0) {
    console.error("ERROR: " + realProblems.length + " corrupted join() remain!");
    realProblems.forEach(function(j) { console.error("  " + JSON.stringify(j.slice(0,60))); });
    process.exit(1);
  }
}

fs.writeFileSync("public/app.js", c);
console.log("\nALL DONE");
