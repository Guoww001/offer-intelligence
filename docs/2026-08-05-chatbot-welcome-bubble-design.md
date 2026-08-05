# Chatbot 欢迎引导气泡（Welcome Guide Bubble）设计

日期：2026-08-05
状态：设计已获用户确认并已实现（2026-08-05）；验证见实施计划

## 1. 背景与目标

当前欢迎指南面板（`chatbot_welcome.js` 渲染的 `.welcome-panel`）固定挂在 dashboard 主网格左列顶部，视觉基调与下方洞察面板几乎相同（同为 Ethereal Glass 玻璃拟态、正文 10–13px），用户很难注意到它；同时它对所有用户任何时候都常驻完整展开，既不够显眼，又对老用户形成持续干扰。

目标：让**未完成引导的新用户**一打开页面就能注意到欢迎引导并理解「Report 提问 → 加入对话 → Chat 对话」主流程；**已完成引导的老用户**默认收起为小圆钮，不占聊天区空间，随时可展开回看。

## 2. 需求确认（用户已选择）

1. **方案**：方案 C —— 把欢迎内容从左侧网格卡片改为**聊天面板内部右下角的悬浮气泡**；
2. **新老用户**：首次使用（`oi_onboarding_done` 未设置）默认展开 + 强调态；老用户（已设置）默认收起为小圆钮；
3. **持久化**：手动收起/展开写入 `localStorage.oi_welcome_collapsed`，刷新保持；
4. **范围**：欢迎内容、流程进度状态机、示例 chips、深浅双主题全部保留；5 步 Tour、Help 说明书、支付/目标等页面不动。

## 3. 现状（已核实）

- `public/chatbot_welcome.js`（IIFE，`window.CHATBOT_WELCOME`）：
  - `containerFor()` 返回 `.main-grid.dashboard-page`；
  - `maybeRender()` 在容器无 `.welcome-panel` 时渲染完整卡片到主网格第 1 行第 1 列（`insertBefore(panel, container.firstChild)`）；
  - `notify()` 处理 `chat-sent` / `report-ready` / `panel-minimized` / `panel-expanded` / `chat-add` / `mode-switched` / `memory-added`，维护流程状态机 `noReport → reportReady → memoryReady → chatActive`；
  - 语言跟随：MutationObserver 观察 `<html lang>`，切语言时重渲染；
  - `dismiss()` 存在但 app.js 从未调用（卡片常驻）。
- `public/onboarding_tour.js`：5 步全屏 Tour，`window.ONBOARDING_TOUR.isActive()` 可判断运行中；localStorage `oi_onboarding_done` 标记完成/跳过。
- `public/styles.css`：
  - `.chat-panel`（约 1515 行）`position: relative; display: grid; grid-template-rows: 1fr auto; overflow: hidden`；
  - `.chat-input`（约 2034 行）高约 65px（44px input + 8px/12px padding + 边框）；
  - `.welcome-*` 全套样式（约 13962 行起），含 `body.dashboard-mode[data-dash-theme="light"]` 浅色覆盖。
- `public/index.html`：dashboard 主网格 `<section class="main-grid dashboard-page">` 内含 `.insight-panel` 与 `.chat-panel`（`#chatPanel`），无欢迎卡片静态节点（由 JS 渲染）。
- `scripts/test_chatbot_welcome.mjs`：vm sandbox 测试，容器 stub 目前模拟 `.main-grid.dashboard-page`。

## 4. 设计

### 4.1 位置与形态

- 欢迎卡片不再挂载到主网格，改为**聊天面板 `#chatPanel` 内的绝对定位悬浮层**（`.chat-panel` 本身 `position: relative`，可作包含块）：
  - 展开态：`position: absolute; right: 14px; bottom: 76px`（避开底部输入框，输入框约 65px 高 + 12px 间距），宽度约 340–360px，最大高度不超过聊天区可视高度（`max-height: calc(100% - 90px)`，内容溢出滚动）；
  - 收起态：同一位置的小圆钮（约 44px，🤖 图标 + 轻微呼吸光晕），点击展开。
- 因为气泡挂在 `.chat-panel` 内部，切到支付/目标等页面时随聊天面板一起隐藏，不会漂浮到其他页面。
- 与 5 步 Tour 不冲突：Tour 激活时隐藏气泡（Tour 浮层本身已承担首屏引导），Tour 结束/跳过后按新老用户规则恢复。实现采用 MutationObserver 监听 `document.body` 中 `.onboarding-mask-piece` / `.onboarding-popover` 的插入/移除来切换隐藏态（不动 onboarding_tour.js，也无需轮询）。

### 4.2 新老用户规则与持久化

- 判定：`localStorage.oi_onboarding_done` 未设置 → 新用户；已设置 → 老用户。
- 新用户：默认展开 + 强调态；老用户：默认收起为小圆钮。
- 持久化键：`localStorage.oi_welcome_collapsed = "1"`（收起）/ 删除（展开）。
- 初始默认态优先级：`oi_welcome_collapsed` 有值 > `oi_onboarding_done` 有值 > 新用户展开。
- 即：老用户即使没有收起记录也默认收起；新用户手动收起后即使 Tour 未完成也保持收起（不再反复打扰）。
- `localStorage` 不可用（隐私模式/禁用）时按新用户展开处理，收起操作仅本次会话生效。

### 4.3 强调态视觉与动效

仅新用户展开态启用：
- 右上角「新手引导」徽标（中/英跟随 `WELCOME_COPY`，如 `新手引导` / `First time?`）；
- 标题字号从 13px 提升到 16px，描述 11px → 12px，权重加重；
- 渐变描边 + 外发光：冰蓝 → 紫（与现有 `#6ea8ff` / `#9b7bff` 同系），卡片背景比普通玻璃卡更亮一档；
- 入场 3–5 秒呼吸光晕（`welcome-bubble-attention` keyframes，只动画 box-shadow/transform）；`prefers-reduced-motion` 下仅保留静态强调，不播放动画。

### 4.4 交互与自动收起时机

- 展开态卡片头部保留「收起」按钮（✕/`收起`，可键盘聚焦，`aria-expanded="false"`）；收起态圆钮 `aria-expanded="true"`。
- **收起/展开完全由用户点击决定**（✕ 收起 / 圆钮展开），流程事件不自动收起：`notify("chat-sent")`（发出提问）与 `notify("chat-add")`（一键加入对话）只清提示条、推进进度状态机，不改变面板展开态（2026-08-05 修订，用户要求）；
- 示例 chips 点击填充输入框、发送按钮脉冲、提示条、进度状态机、`memory-added` 等现有逻辑不变；
- 手动点开圆钮后不自动持久化展开态（刷新仍按默认规则），避免误操作覆盖新用户判定。

### 4.5 布局调整

- 从 `.main-grid.dashboard-page` 移除 `.welcome-panel` 的 grid 占位规则；
- `.insight-panel` 改为跨满左列两行（`grid-row: 1 / -1`），页面不再出现“卡片 + 面板”上下堆叠的空档；
- 主网格 `grid-template-rows` 简化为 `minmax(0, 1fr)`（如保留双行模板，insight 跨满即可，实现时二选一）；
- 窄屏（≤1120px）单列复位规则中，删除 welcome 卡片相关文档流规则（气泡始终绝对定位在聊天面板内，不占文档流）。

### 4.6 主题与可访问性

- 深浅双主题：现有 `body.dashboard-mode[data-dash-theme="light"] .welcome-*` 覆盖保留，新增气泡容器/圆钮的浅色覆盖（白底玻璃 + 冰蓝描边，与现有词汇一致）；
- 焦点可见：展开卡片「收起」按钮与收起态圆钮都有可见 focus ring；
- 语义：气泡为可展开区域，圆钮带 `aria-label`（`查看使用引导` / `Show guide`）与 `aria-expanded`；
- 动效尊重 `prefers-reduced-motion`。

## 5. 文件影响

| 文件 | 改动 |
|------|------|
| `public/chatbot_welcome.js` | `containerFor()` 改为 `#chatPanel`；新增 `.welcome-float` 包裹结构（展开卡片 + 收起圆钮）；新老用户判定与持久化；Tour 激活时隐藏；`chat-sent`/`chat-add` 自动收起；新增 `_test` 导出 |
| `public/styles.css` | 新增气泡容器/圆钮/强调态样式与浅色覆盖；移除欢迎卡片 grid 占位；insight-panel 跨满左列 |
| `scripts/test_chatbot_welcome.mjs` | 容器 stub 改为 `#chatPanel`；新增新老用户默认态、收起/展开持久化、Tour 激活隐藏、chat-sent 自动收起用例 |
| `public/index.html` | 无需改动（chatbot_welcome.js 已引入）；如引入版本号惯例，更新 `chatbot_welcome.js?v=` 参数 |
| `public/app.js` | 无需改动（`maybeRender` / `notify` 调用点全部保留） |

## 6. 测试

- `node --check public/chatbot_welcome.js`；
- `node scripts/test_chatbot_welcome.mjs`（更新 + 新增用例全部 PASS）；
- 回归：`node scripts/test_onboarding_tour.mjs`、`node scripts/test_zh_chatbot.mjs`、`node scripts/test_chatbot_intent_flow.mjs`；
- CI 涉及的 `node --check` 其他前端文件不受影响（app.js 零改动）。

## 7. 验证方式

1. 清空 `oi_onboarding_done` 与 `oi_welcome_collapsed` → 打开 dashboard：气泡展开、强调态出现、3–5 秒呼吸后安静；
2. 点击示例 → 发送提问 → 气泡自动收起为圆钮，刷新后保持收起；
3. 设置 `oi_onboarding_done=1` → 刷新：默认收起为圆钮，点开可看完整引导；
4. 重播 Tour（🎓 按钮）→ 气泡隐藏，Tour 结束 → 气泡按规则恢复；
5. 深浅主题切换 → 气泡/圆钮颜色正确；窄屏窗口 → 不遮挡输入框；
6. 支付页/目标页 → 气泡不出现。

## 8. 范围外（不做）

- 不重写欢迎内容文案与流程状态机；
- 不改 5 步 Tour 步骤与 Help 说明书；
- 不改动聊天提交、报告生成、记忆栏等业务逻辑；
- 不做“聚光灯遮罩式”的额外引导层。
