# Chatbot Welcome Progress Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Chatbot 使用助手面板的三步进度只在对应真实用户操作发生后完成。

**Architecture:** 保留现有 `CHATBOT_WELCOME.notify()` 事件机制，在欢迎助手内部增加“已点击加入对话”和“已完成 Chat 提问”的独立状态；`app.js` 的统一发送入口向事件携带当前模式，从而区分 Report Mode 发送和 Chat Mode 发送。报告生成完成、模式切换、拖入记忆栏不再单独推进错误的步骤。

**Tech Stack:** Vanilla JavaScript、Node.js ESM 定向测试、现有 `vm` 测试沙箱。

## Global Constraints

- 所有说明、测试描述和代码注释使用简体中文；代码标识符保持现有英文命名风格。
- 不改变聊天请求、报告生成和记忆栏数据流，只调整欢迎助手进度状态的来源事件。
- 不提交 Git commit；保留工作区内用户已有修改。
- 不启动本地服务器；使用定向 Node 测试和语法检查验证。

---

### Task 1: 锁定三步操作事件语义

**Files:**
- Modify: `scripts/test_chatbot_welcome.mjs`

**Interfaces:**
- `flowStage(state)` 使用 `hasReport`、`hasAddedToChat`、`hasChatSent` 判断进度。
- `notify("chat-sent", { mode: "report" | "chat" })` 只完成对应模式的发送步骤。

- [ ] **Step 1: 写入失败断言**

在现有 flowStage 测试中补充：仅有记忆不应完成第 2 步；`hasAddedToChat` 才进入 `memoryReady`；`hasChatSent` 才进入 `chatActive`。在 notify 测试中补充带 `mode` 的 Report/Chat 发送事件断言。

- [ ] **Step 2: 运行测试确认按预期失败**

运行：

```bash
node scripts/test_chatbot_welcome.mjs
```

预期：新增的 `hasAddedToChat` / `hasChatSent` 断言失败，证明当前实现仍把 `hasMemory` 或模式切换当作步骤完成。

---

### Task 2: 更新欢迎助手状态机

**Files:**
- Modify: `public/chatbot_welcome.js:132-180, 230-240, 760-810, 880-890`

**Interfaces:**
- 新增内部状态 `_hasAddedToChat` 和 `_hasChatSent`。
- `_flowState()`、测试导出 `flowState()` 返回上述状态。
- `notify("chat-sent", payload)` 根据 `payload.mode` 更新 Report 或 Chat 完成态。

- [ ] **Step 1: 实现最小状态变更**

将进度判断改为：

```js
if (state.hasChatSent) return "chatActive";
if (state.hasAddedToChat) return "memoryReady";
if (state.hasReport) return "reportReady";
return "noReport";
```

`notify("chat-sent", { mode: "report" })` 设置 `_hasReport`，`notify("chat-sent", { mode: "chat" })` 设置 `_hasChatSent`；`notify("chat-add")` 设置 `_hasAddedToChat`。`report-ready`、`memory-added` 和 `mode-switched` 只同步既有辅助状态，不推进三步主流程。

- [ ] **Step 2: 运行欢迎助手测试确认通过**

运行：

```bash
node scripts/test_chatbot_welcome.mjs
```

预期：输出 `Chatbot welcome tests passed.`。

---

### Task 3: 让发送入口传递当前模式

**Files:**
- Modify: `public/app.js:19940-19948`

**Interfaces:**
- `chatForm` submit 继续调用 `CHATBOT_WELCOME.notify("chat-sent")`，但增加 `{ mode: state.deepMode ? "report" : "chat" }` payload。

- [ ] **Step 1: 修改发送事件 payload**

将统一发送入口改为：

```js
if (window.CHATBOT_WELCOME) {
  window.CHATBOT_WELCOME.notify("chat-sent", {
    mode: state.deepMode ? "report" : "chat"
  });
}
```

保留空输入拦截、清空输入框和 `applyPrompt(prompt)` 的原有顺序。

- [ ] **Step 2: 运行语法和回归检查**

运行：

```bash
node --check public/app.js
node --check public/chatbot_welcome.js
node scripts/test_chatbot_welcome.mjs
node scripts/test_onboarding_tour.mjs
git diff --check
```

预期：所有命令成功退出；既有新手引导测试不受事件 payload 变化影响。

---

### Task 4: 最终检查

**Files:**
- Review: `public/chatbot_welcome.js`, `public/app.js`, `scripts/test_chatbot_welcome.mjs`

- [ ] **Step 1: 检查行为覆盖**

确认以下路径分别只推进对应步骤：Report Mode 发送 → 第 1 步；点击“加入对话” → 第 2 步；Chat Mode 发送 → 第 3 步。

- [ ] **Step 2: 检查工作区状态**

运行 `git status --short`，确认不修改、不删除用户已有的缓存、页面或其他无关文件。
