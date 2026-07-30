# Chat → Deep View 按钮 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat Mode 每条流式回复底部增加一个「转为 View」按钮，点击后创建深层面板浮窗展示同一内容

**Architecture:** 在 `applyPrompt()` 的 Chat Mode 流式完成分支中追加按钮。按钮点击后调用已有的 `_createDeepPanel()` + `_showQuickResultInDeepPanel()` 将已渲染的 HTML 注入面板。面板生命周期（创建/隐藏/恢复）由按钮管理。

**Tech Stack:** Vanilla JS (app.js) + CSS (styles.css)，无后端变更

## Global Constraints

- 不要摘要卡片样式，只要按钮
- 按钮点击后不添加 `_deepQuickSummaryHtml` 摘要卡片
- 面板被隐藏后，再次点击按钮恢复面板，不重新生成内容
- 遵循现有代码风格：函数声明式、`var`、`els.` 引用 DOM

---

### Task 1: CSS 按钮样式

**Files:**
- Modify: `public/styles.css`（末尾追加）

**Interfaces:**
- Produces: `.chat-to-deep-btn` 样式类

- [ ] **Step 1: 在 styles.css 末尾追加按钮样式**

```css
/* ── Chat → Deep View 按钮 ── */
.chat-to-deep-btn {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 14px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--accent, #4a90d9);
  background: transparent;
  border: 1px solid var(--border-color, rgba(0,0,0,0.15));
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  user-select: none;
}
.chat-to-deep-btn:hover {
  background: var(--accent-bg, rgba(74,144,217,0.08));
  border-color: var(--accent, #4a90d9);
}
.chat-to-deep-btn:active {
  background: var(--accent-bg, rgba(74,144,217,0.15));
}
```

- [ ] **Step 2: 提交**

```bash
git add public/styles.css
git commit -m "style(chat): add .chat-to-deep-btn button styles"
```

---

### Task 2: 按钮追加 + 事件处理

**Files:**
- Modify: `public/app.js`（`applyPrompt()` 函数中 Chat Mode 分支末尾，~line 9320）

**Interfaces:**
- Consumes: `_createDeepPanel(prompt)` — 返回 panel 对象
- Consumes: `_showQuickResultInDeepPanel(panel, html, prompt)` — 注入内容
- Consumes: `_deepPanels` — 全局面板数组
- Consumes: `_hideDeepPanel(id)` — 隐藏面板
- Consumes: `_showDeepPanel(id)` — 恢复隐藏的面板
- Consumes: `_bringPanelToFront(panel)` — 置前

- [ ] **Step 1: 在流式渲染完成后追加按钮**

在 `applyPrompt()` 的 Chat Mode 分支中，在 `statusBar.textContent = ...` 设置完成之后（~line 9324）、`_chatLog.scrollTop = _chatLog.scrollHeight`（~line 9325）之前，或者在其后追加按钮创建逻辑：

```js
        // ── 追加「转为 View」按钮 ──
        if (fullResponse && fullResponse.trim()) {
          var viewBtn = document.createElement("button");
          viewBtn.className = "chat-to-deep-btn";
          viewBtn.textContent = language === "zh" ? "转为 View" : "Open as View";
          viewBtn._chatPrompt = prompt;
          viewBtn._fullResponse = fullResponse;
          viewBtn.addEventListener("click", function (e) {
            var btn = e.currentTarget;
            var _prompt = btn._chatPrompt || "";
            var _html = btn._fullResponse ? markdownToHtml(btn._fullResponse) : "";
            if (!_html) return;
            // 查找是否已有与此按钮关联的面板
            var existing = _deepPanels.find(function (p) { return p._viewBtn === btn; });
            if (existing && existing._hidden) {
              _showDeepPanel(existing.id);
            } else if (existing) {
              _bringPanelToFront(existing);
            } else {
              var p = _createDeepPanel(_prompt);
              p._viewBtn = btn;
              _showQuickResultInDeepPanel(p, _html, _prompt);
            }
          });
          msgEl.appendChild(viewBtn);
        }
```

**插入位置：** 在 `statusBar.textContent = ...` 设置之后，`_chatLog.scrollTop = _chatLog.scrollHeight;`（~line 9325）之前。

```js
        // 原代码:
        var finalElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
        statusBar.textContent = language === "zh"
          ? "⏱ " + finalElapsed + "秒 · ⊞ " + tokenCount + " tokens"
          : "⏱ " + finalElapsed + "s · ⊞ " + tokenCount + " tokens";
        _chatLog.scrollTop = _chatLog.scrollHeight;

        // 修改为: 在原代码后追加按钮
        var finalElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
        statusBar.textContent = language === "zh"
          ? "⏱ " + finalElapsed + "秒 · ⊞ " + tokenCount + " tokens"
          : "⏱ " + finalElapsed + "s · ⊞ " + tokenCount + " tokens";
        // ── 追加「转为 View」按钮 ──
        if (fullResponse && fullResponse.trim()) {
          var viewBtn = document.createElement("button");
          viewBtn.className = "chat-to-deep-btn";
          viewBtn.textContent = language === "zh" ? "转为 View" : "Open as View";
          viewBtn._chatPrompt = prompt;
          viewBtn._fullResponse = fullResponse;
          viewBtn.addEventListener("click", function (e) {
            var btn = e.currentTarget;
            var _prompt = btn._chatPrompt || "";
            var _html = btn._fullResponse ? markdownToHtml(btn._fullResponse) : "";
            if (!_html) return;
            var existing = _deepPanels.find(function (p) { return p._viewBtn === btn; });
            if (existing && existing._hidden) {
              _showDeepPanel(existing.id);
            } else if (existing) {
              _bringPanelToFront(existing);
            } else {
              var p = _createDeepPanel(_prompt);
              p._viewBtn = btn;
              _showQuickResultInDeepPanel(p, _html, _prompt);
            }
          });
          msgEl.appendChild(viewBtn);
        }
        _chatLog.scrollTop = _chatLog.scrollHeight;
```

- [ ] **Step 2: 验证语法正确**

```bash
node --check public/app.js
```

Expected: 无错误输出（exit code 0）

- [ ] **Step 3: 提交**

```bash
git add public/app.js
git commit -m "feat(chat): add 'Open as View' button to each chat response"
```

---

### Task 3: 冒烟测试

**说明：** 手动启动本地服务器，验证端到端功能

- [ ] **Step 1: 启动服务器**

```bash
python server.py
```

- [ ] **Step 2: 打开浏览器访问 http://127.0.0.1:8765/**

确认 Chat Mode 加载正常。

- [ ] **Step 3: 发送一条 Chat Mode 消息**

如 "有哪些offer"，等待流式回复完成。

- [ ] **Step 4: 验证按钮**

确认回复底部出现「转为 View」按钮。

- [ ] **Step 5: 点击按钮**

确认浮窗面板弹出，内容与聊天回复一致（含表格/列表等格式）。

- [ ] **Step 6: 关闭面板（点击 X）**

确认面板消失。再次点击同一消息的「转为 View」按钮，确认面板恢复显示（不重新生成）。

- [ ] **Step 7: 最小化测试**

面板打开时点击最小化按钮（─），确认面板缩小为药丸。点击药丸恢复。

- [ ] **Step 8: 发送另一条消息**

确认新消息也有按钮，且独立运作。

- [ ] **Step 9: 关闭服务器**

```bash
netstat -ano | grep ':8765'  # 找到 PID
taskkill //F //PID <PID>
```

- [ ] **Step 10: 提交最终状态**

```bash
git add -A
git commit -m "test: verify chat-to-deep-view button works"
```
