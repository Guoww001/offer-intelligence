# Chatbot 流程引导（Flow Onboarding）设计

日期：2026-08-05
状态：设计已获用户确认（方案 A 状态感知引导 + 方案 B 一键加入对话）；本文档待用户审阅

## 1. 背景与目标

当前 chatbot 已有三层引导（欢迎屏卡片 `chatbot_welcome.js`、首次 7 步新手引导 `onboarding_tour.js`、Help 说明书），但新用户仍然容易在核心流程上困惑：

1. Report Mode 提问后不知道下一步该做什么；
2. 不知道「最小化 → 切 Chat Mode → 拖入记忆栏」这套隐藏交互，导致 Chat Mode 没有数据上下文；
3. 欢迎屏偏概念地图，示例点击后没有持续引导。

目标：让新用户无脑走通主路径 **「Report 提问 → 一键加入对话 → Chat 对话」**，并把每一步的下一步动作在关键时刻就地提示出来。

## 2. 需求确认（用户已选择）

1. **优先级**：先解决 B 流程困惑；A（不会提问的话术示例）与 C（运营分析思路）留到后续迭代；
2. **方案**：方案 A（状态感知引导）+ 方案 B（一键加入对话）结合；
3. **范围**：推荐、对比、分析、关键词四项能力本期不动；现有最小化 + 拖拽保留为高级路径；
4. **主路径**：Report Mode 提问 → 报告浮窗点「加入对话」→ 自动切到 Chat Mode → 直接对话；
5. **高级路径**：报告浮窗点「─」最小化 → 切 Chat Mode → 拖药丸到记忆栏（保留现状，不再作为新手教学主路径）。

## 3. 现状（已核实）

### 3.1 相关文件与挂点

- `public/chatbot_welcome.js`：常驻欢迎屏（`.welcome-panel` 挂 `.main-grid.dashboard-page` 左列顶部），`window.CHATBOT_WELCOME` API：`maybeRender` / `notify` / `dismiss` / `isRendered`；事件：`chat-sent` / `mode-switched` / `report-ready` / `memory-added`。
- `public/onboarding_tour.js`：7 步全屏引导（`intro → report-ask → deep-window → minimize-window → switch-chat → drag-memory → chat-ask`），`window.ONBOARDING_TOUR`，首次自动弹出，localStorage `oi_onboarding_done` 标记；事件：`sent` / `minimized` / `switched` / `memory-added`。
- `public/app.js`：
  - `_deepPanelTemplate()`（约 9554 行）：Deep Window 头部动作区现有 stop / export / minimize / close；
  - `_bindPanelEvents()`（约 9622 行）：绑定各头部按钮事件；
  - `_minimizeDeepPanel()` / `_expandDeepPanel()`：动画后 `_settleMin` / `_settleExp` 设置 `panel.minimized` 与 `.minimized` 类；
  - `_renderPanelReport()` 尾部（约 10069 行）：`notify("report-ready", { panelEl })`；
  - `_addMemoryFromPanel()`（约 10543 行）：push 记忆、`_renderMemoryBar()`、notify tour / welcome；
  - 模式切换（约 19804 行）：`els.modeFastBtn` / `els.modeDeepBtn` 点击处理，设置 `state.deepMode`、class、placeholder、`_syncChatLogVisibility()`、`_renderMemoryBar()`、notify welcome；
  - 聊天提交（约 19782 行）：`notify("chat-sent")` → `applyPrompt(prompt)`。
- `scripts/test_chatbot_welcome.mjs`（234 行）、`scripts/test_onboarding_tour.mjs`（378 行）：已有 vm sandbox 测试；CI（`.github/workflows/ci.yml`）已运行这两个测试。

### 3.2 现有流程缺口

- 报告完成后只提示「最小化 → 拖入记忆栏」，没有一键路径；
- 欢迎屏流程横条仍是「提问 → 最小化拖入 → 对话」三步，与用户实际认知有落差；
- Chat Mode 空记忆时只有常驻提醒卡片，没有可执行的动作（回到 Report 生成报告）；
- Tour 教的是最小化 + 拖拽，操作链过长，新用户容易在中途放弃。

## 4. 核心交互（方案 B）：报告面板新增「加入对话」按钮

### 4.1 按钮与可见性

- 在 `_deepPanelTemplate()` 头部动作区、Export 按钮之后新增按钮：
  - class：`deep-window-chat-add`；
  - 文案（中/英）：`加入对话` / `Add to chat`（走 `t()` 键，如 `deep.chatAdd`）；
  - 初始 `hidden`。
- 可见性规则：
  - 报告生成中（`panel.state === "loading"`）隐藏；
  - 报告完成（`_renderPanelReport` 与 `_showQuickResultInDeepPanel` 完成路径）移除 `hidden`；
  - 报告失败（`_showPanelError`）隐藏。

### 4.2 点击行为（`_addToChat(panel)`，app.js 新增）

1. 守卫：`panel.state === "loading"` 直接返回；`panel._addedToMemory` 为真直接返回（防重复）；
2. 调用 `_addMemoryFromPanel(panel)`（复用现有记忆提取与渲染）；
3. 置 `panel._addedToMemory = true`，按钮文案改为 `已加入`（`deep.chatAdded`）并 `disabled`；
4. 调用新抽出的 `_switchToChatMode()`（见 4.3）自动切到 Chat Mode；
5. 在 `#chatLogChat` 顶部（提醒卡片之后）注入一条引导消息：`报告「{title}」已加入对话，试试问：`，附 2 个示例 chips（文案直接复用 `WELCOME_EXAMPLES.chat` 前两条：`根据记忆栏的报告，给我分析建议` 与 `总结记忆栏的数据，分析下个月的运营方向`，en 版对应英文文案；点击填充输入框 + 发送按钮脉冲，复用欢迎屏 chips 的填充逻辑风格）；
6. notify：`window.ONBOARDING_TOUR?.notify("chat-add")`、`window.CHATBOT_WELCOME?.notify("chat-add", { hasMemory: true, title })`。

### 4.3 模式切换公共函数（app.js 重构）

抽两个公共函数，现有 `modeFastBtn` / `modeDeepBtn` 点击处理器改为调用它们，避免逻辑复制、便于测试：

```js
function _switchToChatMode()  // state.deepMode=false + class + placeholder + 日志可见性 + 记忆栏 + notify welcome
function _switchToReportMode() // 对称逻辑
```

### 4.4 深窗提示条文案更新

`welcome-panel-tip` 文案由「点 ─ 最小化，拖入记忆栏后可在 Chat Mode 深度分析」改为：

- zh：`点「加入对话」一键带进对话；或点 ─ 最小化后拖入记忆栏（高级用法）`；
- en：`Click “Add to chat” to start instantly, or click – to minimize and drag it into the memory bar (advanced)`。

## 5. 状态感知引导（方案 A）

### 5.1 流程状态机（chatbot_welcome.js 新增）

状态由四个布尔量推导：`hasReport`（至少一个已完成报告）、`hasPill`（至少一个最小化药丸）、`hasMemory`（记忆栏有数据）、`isChat`（当前 Chat Mode）：

| 状态 | 条件 | 含义 |
|---|---|---|
| `noReport` | 无已完成报告 | 第一步：去 Report 提问 |
| `reportReady` | 有报告、无记忆 | 第二步：点「加入对话」（或高级路径） |
| `memoryReady` | 有记忆、非 Chat Mode | 已加入，切到 Chat 即可对话 |
| `chatActive` | 有记忆、Chat Mode | 完成，可直接提问 |

导出纯函数 `flowStage({ hasReport, hasPill, hasMemory, isChat })`，供测试直接断言。

### 5.2 欢迎屏进度条

欢迎卡片头部下方新增 3 步进度条（`.welcome-progress`）：

1. ① 在 Report 提问（`noReport` 时高亮）
2. ② 点「加入对话」（`reportReady` 时高亮）
3. ③ 在 Chat 对话（`memoryReady` / `chatActive` 时高亮）

已完成步骤打勾；`chatActive` 时整条进度条显示完成态。高级路径（最小化 + 拖拽）以一行小字附在进度条下，不占主路径视觉。

### 5.3 就地提示（关键时刻）

- **报告完成**：深窗顶部提示条（4.4）引导点「加入对话」，按钮加 `.welcome-pulse` 呼吸高亮（复用现有 CSS）；
- **用户走了高级路径**（`notify("panel-minimized")`）：提示条切换为「切到 Chat Mode，把药丸拖到记忆栏」；`memory-ready` 后消失；
- **Chat Mode 空记忆**：现有 `.chat-reminder` 卡片增强——文案不变，新增「去生成报告」按钮（`.chat-reminder-action`），点击后 dispatch `CustomEvent("chatbot-go-report")`，app.js 监听后调 `_switchToReportMode()` 并填入动态商户示例（与欢迎屏 `merchantForExample` 同逻辑）；**不拦截自由提问**；
- **记忆就绪**：进度条完成态，提示条消失；
- **手动输入**：维持零打扰（现有 `shouldClearTipOnInput` 规则不变）。

### 5.4 事件契约（新增/复用）

| 事件 | 发出方 | 消费方 | 作用 |
|---|---|---|---|
| `report-ready` | app.js `_renderPanelReport`（现有） | welcome | 设置 `hasReport`，显示深窗提示 |
| `panel-minimized` | app.js `_settleMin`（新增） | welcome | 设置 `hasPill`，切换高级路径提示 |
| `panel-expanded` | app.js `_settleExp`（新增） | welcome | 清 `hasPill`（最后一个药丸展开时重算） |
| `memory-added` | app.js `_addMemoryFromPanel`（现有） | welcome / tour | 设置 `hasMemory` |
| `mode-switched` | app.js 模式切换（现有） | welcome | 设置 `isChat`，同步提醒卡片 |
| `chat-add` | app.js `_addToChat`（新增） | welcome / tour | 立即更新进度 + tour 自动推进 |
| `chat-sent` | app.js 提交（现有） | welcome | 清提示条 |

## 6. 首次引导 Tour 更新（onboarding_tour.js）

### 6.1 步骤精简为 5 步

| # | id | target | autoNext | 说明 |
|---|---|---|---|---|
| 1 | `intro` | `#chatModeToggle` | 无 | 布局介绍（文案同步主路径） |
| 2 | `report-ask` | `#chatInput` | `sent` | 填 `Shokz`，高光转移到发送按钮 |
| 3 | `deep-window` | 最后一个 `.deep-window:not(.generating)` | 无 | 等待报告完成 |
| 4 | `add-to-chat` | 最后一个面板的 `.deep-window-chat-add` | `chat-add` | 点「加入对话」，自动推进 |
| 5 | `chat-ask` | `#chatInput` | `sent`（final） | 填 `根据刚才的报告，给我分析建议`（en 版 `autoFillEn`），发送即完成 |

### 6.2 调整点

- 移除 `minimize-window` / `switch-chat` / `drag-memory` 三步；`requireMinimized`、`focusOn`、`dropzoneTip`、`popover: "bottom-center"` 等旧机制随步骤删除；
- `intro` 与 `chat-ask` 文案补充一行高级路径说明（最小化后拖入记忆栏），不进入操作；
- `startTour()` 的 `_ensureReportMode()` 保留（重播时若在 Chat Mode 先切回 Report）；
- 模块级事件委托增加 `.deep-window-chat-add` 点击 → `notify("chat-add")`（与 app.js notify 双保险，任一到达即可推进）。

## 7. 语言（i18n）

- `WELCOME_COPY` 新增键（zh/en 一一对应）：进度条三步标题、`addToChat` 按钮文案、`chatAdded` 已加入、深窗提示新文案、提醒卡片按钮「去生成报告」、Chat 引导消息标题；
- `TOUR_COPY` 同步：`intro` / `addToChat` 步骤标题正文、`addToChatNextHint`、`chat-ask` 补充高级路径说明、`stepCounter` 总数变化；
- 所有新文案遵守现有键集一致性测试（zh/en keys 完全相等）。

## 8. 边界与错误处理

- loading / error 报告不显示「加入对话」；
- 同一报告重复点击：`panel._addedToMemory` 防重复，按钮置为「已加入」disabled；
- 面板关闭（`_hideDeepPanel`）不影响已加入的记忆；进度按「是否有已完成报告 / 是否有记忆」计算，不绑定单个面板生命周期；
- 多次最小化/展开：`hasPill` 按“是否存在 minimized 面板”实时重算；
- 自动切 Chat Mode 失败（按钮/元素缺失）：仍完成记忆加入，welcome 提示条兜底引导手动切换；
- `_switchToChatMode()` 幂等：已在 Chat Mode 时重复调用不产生副作用；
- 语言切换：进度条、提示、按钮文案全部随 `<html lang>` 重渲染（现有 lang observer 机制）；
- 无 LLM 环境：按钮流程照常可用（Chat 走规则回答）；
- 已标记 `oi_onboarding_done` 的用户不自动重播 tour；欢迎屏常驻显示新流程，可随时点 🎓 重播；
- 测试模式：`__OFFER_INTELLIGENCE_TEST__` 下不自动弹、不渲染（现有约定）。

## 9. 测试与验证

### 9.1 自动化测试

`scripts/test_chatbot_welcome.mjs` 追加：
1. `flowStage` 纯函数全状态断言（8 种布尔组合）；
2. 进度条渲染（3 步、完成态）；
3. 新文案键 zh/en 一致；
4. `notify("panel-minimized")` / `notify("panel-expanded")` / `notify("chat-add")` 的状态更新；
5. 提醒卡片「去生成报告」按钮存在性（渲染 smoke 扩展）。

`scripts/test_onboarding_tour.mjs` 修改：
1. 步骤数 7 → 5，id 顺序 `intro|report-ask|deep-window|add-to-chat|chat-ask`；
2. `add-to-chat` 步：`autoNext: "chat-add"`、target 为函数（最后一个面板的加入按钮）、`autoFill` 无；
3. 删除旧步骤相关断言（minimize / switch / drag / dropzoneTip / requireMinimized）；
4. autoNext 步骤数为 3（sent / chat-add / sent）；
5. `autoFillEn` 断言移到新 `chat-ask` 步。

CI（`.github/workflows/ci.yml`）追加：
```bash
node --check public/chatbot_welcome.js
node --check public/onboarding_tour.js
```

### 9.2 手动验证清单

本地 `python server.py` 后：
1. 主路径：Report 提问 → 报告完成出现「加入对话」→ 点击 → 自动切 Chat + 引导消息 + 进度条完成 → 点示例提问；
2. 高级路径：最小化 → 切 Chat → 拖入记忆栏 → 进度条完成；
3. 空记忆 Chat：提醒卡片有「去生成报告」按钮，点击切回 Report 并填入示例；
4. 重复点击「加入对话」→ 按钮变已加入且禁用；
5. 中英切换后所有新文案同步；
6. 首次进入 tour 为 5 步，重播正常；
7. 完成验证后关闭本地服务器（AGENTS.md 要求）。

## 10. 涉及文件

| 文件 | 改动 |
|---|---|
| `public/app.js` | 深窗按钮模板与绑定、`_addToChat`、`_switchToChatMode` / `_switchToReportMode` 抽取、`_settleMin` / `_settleExp` 通知、提醒卡片事件监听、新 i18n 键 |
| `public/chatbot_welcome.js` | 状态机、进度条、新提示、提醒卡片按钮、新文案 |
| `public/onboarding_tour.js` | 步骤精简为 5 步、`chat-add` 事件、文案 |
| `public/styles.css` | `.welcome-progress`、`.deep-window-chat-add`、`.chat-reminder-action`、已加入态样式 |
| `scripts/test_chatbot_welcome.mjs` | 追加状态机与事件用例 |
| `scripts/test_onboarding_tour.mjs` | 步骤结构/事件断言更新 |
| `.github/workflows/ci.yml` | 追加两个 `node --check` |
| `docs/chatbot-feature-report.md` | 引导章节同步主路径描述 |
| `CLAUDE.md` | 新增函数行号索引（`_addToChat`、`_switchToChatMode`、`_switchToReportMode`） |

## 11. 非目标（YAGNI）

- 不做 A（能力话术地图扩展）与 C（业务场景化思路引导）——后续迭代；
- 不动推荐 / 对比 / 分析 / 关键词能力本身；
- 不拦截 Chat Mode 自由提问（即使空记忆，只提示不阻断）；
- 不删除最小化 + 拖拽高级路径；
- 不改 Help 说明书主体（仅如需与主路径一致时微调文案）；
- 不做引导进度中途保存/恢复。
