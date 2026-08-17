# Agent Question Logging and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将独立 Agent 页面接入现有 Chatbot 用户提问日志和回答反馈能力，记录每次 Agent 提问的提交与最终状态，并让成功的 Agent 回答支持现有反馈弹窗、原因选择、幂等和导出流程。

**Architecture:** 复用现有 `/api/chat/stream?operation=questions` 和 `/api/chat/stream?operation=feedback` 接口、`cnpscy_oi_chatbot_question_logs` 与 `cnpscy_oi_chatbot_answer_feedback` 表，以及 Chatbot 已有的前端日志/反馈 helper。Agent 使用 `mode=agent` 与 `report`、`chat` 区分，后端仅扩展 mode 白名单；现有数据库字段为 `VARCHAR(16)`，无需迁移。

**Tech Stack:** Vanilla JavaScript (`public/app.js`), Python HTTP/domain modules, Node.js static-contract tests, Python unit/HTTP tests, Markdown architecture documentation.

## Global Constraints

- 所有新增用户可见文案、测试说明和文档说明使用简体中文；代码标识符沿用现有英文命名。
- 不创建新的日志或反馈 API，不重复实现反馈弹窗、原因枚举、导出和幂等逻辑。
- 保留当前工作区已有的 Agent 上下文、历史回滚、中止按钮及其他未相关改动。
- Agent 成功回答才展示反馈入口；中止、失败或异常只完成提问日志为 `failed`，不创建可反馈回答。
- 不提交、不推送、不修改与本功能无关的脏文件。

---

## Task 1: Extend the logging domain to accept Agent mode

**Files:**
- Modify: `chatbot_question_logs.py`
- Modify: `chatbot_answer_feedback.py`
- Test: `scripts/test_chatbot_question_logs.py`
- Test: `scripts/test_chatbot_answer_feedback.py`

- [x] 在两个领域模块的现有 mode 校验测试中先增加 `agent` 合法断言，并运行对应 Python 测试确认 RED。
- [x] 将两个 `_clean_mode()` 的合法值从 `report/chat` 扩展为 `report/chat/agent`，同步更新校验错误文本；保留大小写归一化和其他校验行为。
- [x] 重新运行两个领域测试，确认 Agent mode 可创建提问日志、可创建反馈，并且现有非法 mode 仍被拒绝。
- [x] 确认 DDL 与导出字段无需结构迁移：`mode VARCHAR(16)` 已能容纳 `agent`；如代码或测试中的值说明仍只写 `report/chat`，同步补齐。

## Task 2: Log Agent question lifecycle

**Files:**
- Modify: `public/app.js`
- Test: `scripts/test_agent_question_logging.mjs`

- [x] 先新增一个聚焦 Agent handler 的静态契约测试，断言 `handleAgentPageSubmit()` 创建 `agent` mode 日志、生成 event id，并在成功、失败、中止路径调用完成接口；运行测试确认 RED。
- [x] 在 `handleAgentPageSubmit()` 启动 Agent 请求前，根据当前 prompt、语言和意图调用现有 `beginQuestionLog(prompt, "agent", language, intent, eventId)`。
- [x] 为 direct content、完整 Agent response、fallback 成功三条成功路径调用 `completeQuestionLog(..., "success", intent)`。
- [x] 为用户中止、Agent 返回失败、fallback 失败和异常路径调用 `completeQuestionLog(..., "failed", intent)`，确保 finally 不会重复完成同一条记录。
- [x] 保持 Agent 当前历史提交/回滚和 AbortController 行为不变；日志接口失败只能被现有 helper 吸收，不能阻断 Agent 回答。

## Task 3: Attach feedback to successful Agent answers

**Files:**
- Modify: `public/app.js`
- Modify: `scripts/test_chatbot_answer_feedback_frontend.mjs`

- [x] 先扩展前端反馈契约测试，断言 Agent handler 复用 `attachAnswerFeedbackButton()`、传入 `mode: "agent"`，并运行测试确认 RED。
- [x] 对 direct content 返回的消息元素绑定反馈按钮，回答快照使用 direct content。
- [x] 对完整 Agent streaming/synthesis 返回的 status bar 绑定反馈按钮，回答快照读取最终 status bar 内容。
- [x] 对 fallback streaming 返回的 status bar 绑定反馈按钮，确保反馈上下文携带同一个 `questionEventId` 和成功完成 promise。
- [x] 保持已有全局反馈弹窗、reasonCode、reasonDetail、重复提交处理和 `/api/chat/stream?operation=feedback` payload 不变；中止/失败回答不显示按钮。

## Task 4: Document the shared Agent logging contract

**Files:**
- Modify: `docs/chatbot-feature-report.md`

- [x] 更新提问日志和反馈说明，将合法 mode 写为 `report`、`chat`、`agent`。
- [x] 说明独立 Agent 页面由 `handleAgentPageSubmit()` 复用同一套提问日志生命周期和反馈提交流程，导出结果通过 mode 区分来源。
- [x] 明确数据库 schema 无需新增表或迁移，Agent 只是现有 `VARCHAR(16)` mode 的新增业务值。

## Task 5: Verify the complete change

**Files:**
- Test: `scripts/test_agent_question_logging.mjs`
- Test: `scripts/test_chatbot_question_logs.py`
- Test: `scripts/test_chatbot_answer_feedback.py`
- Test: `scripts/test_chatbot_question_log_http.py`
- Test: `scripts/test_chatbot_answer_feedback_http.py`
- Test: `scripts/test_chatbot_question_logging.mjs`
- Test: `scripts/test_chatbot_answer_feedback_frontend.mjs`

- [x] 运行 Agent 日志/反馈新增测试及现有 Chatbot 日志、反馈领域和 HTTP 测试。
- [x] 运行现有 Agent 行为测试、Chatbot 关键回归测试、`node --check public/app.js` 和相关 Python 编译检查；Agent 行为测试最终通过 `OK 24 scenarios`，Chatbot 关键回归、语法和编译均通过。
- [x] 运行 `git diff --check`，审查本次相关文件 diff 与计划文件；记录测试通过、跳过或环境限制，不进行 commit/push。
