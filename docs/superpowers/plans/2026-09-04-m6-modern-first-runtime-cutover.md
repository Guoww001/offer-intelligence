# M6 Chatbot/Agent Modern-first Runtime 切换记录

## 目标

- 梳理 Modern Chatbot/Agent 对 Legacy bridge 的实际依赖。
- 用独立 Vue session 接管 Chatbot Report/Chat、Deep Window 和 Agent Runtime。
- 页面默认挂载 Modern；保留显式整页 Legacy 回退，不删除旧实现。

## 切换前依赖

| 功能 | 切换前路径 | 问题 |
| --- | --- | --- |
| 页面放行 | `modernChatbotAgentParityEnabled()` 检查完整 `OI_LEGACY_BRIDGE` | 即使 Vue 已存在，也必须先启动 Legacy session 才能进入 Modern |
| Chatbot 会话 | `entry.ts → OI_LEGACY_BRIDGE.chatSession/runChat` | Report、Chat、历史记录和状态均由 Legacy 执行 |
| Deep Window | `entry.ts → OI_LEGACY_BRIDGE.deepWindows` | 窗口生命周期和加入对话依赖 Legacy 全局状态 |
| Agent 会话 | `entry.ts → OI_LEGACY_BRIDGE.agentSession/runAgent` | Modern Agent 只是 Legacy Agent 的展示层 |
| CopilotKit 工具 | `CopilotKitAgentHost.vue → OI_LEGACY_BRIDGE.executeAgentTool` | Python Runtime 的前端工具仍回调 Legacy 实现 |
| 导航恢复 | Vue page 卸载后读取 Legacy session | Modern 自身不能独立恢复 Chatbot/Agent 状态 |

## 切换后边界

- `entry.ts` 创建并复用入口级 `createChatbotSession()` 与 `createAgentSession()`；页面卸载只销毁 Vue mount，不销毁 session。
- Chatbot 的历史、模式、Memory、反馈/日志、SSE 停止与报告状态由 `chatbotSession.ts` 管理。
- Deep Window 的打开、激活、最小化、固定、移动、复制、遮罩、取消、导出和加入对话由 `deepWindowStore.ts` 管理。
- CopilotKit 的 7 个前端工具通过 `toolExecutor` 注入 `agentSession.ts`，不读取 `window.OI_LEGACY_BRIDGE`。
- CopilotKit 页面使用进程内快照恢复导航前的消息、时间线和结果视图；提问、答案和工具结果不写入持久化存储。
- Chatbot 报告和 Deep Window 通过 shared XLSX 生成器导出，不再把下载动作转发给 Legacy session。
- `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ !== false` 时默认挂载 Modern；显式设为 `false` 时整页回退 Legacy。

## 仍保留的 Legacy 边界

这些边界用于回滚，不属于 Modern Chatbot/Agent 的正常运行链路：

1. `public/app.js` 仍负责 SPA 导航和 Modern factory 挂载失败后的整页 Legacy fallback。
2. `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = false` 仍可在现场把 Chatbot 与 Agent 切回旧页面。
3. Modern 启动数据暂时通过 `getLegacySnapshot()` 读取统一 bootstrap 快照；运行中的会话、Deep Window 和 Agent 工具不再回调 Legacy bridge。
4. Legacy Chatbot/Agent 的渲染器、事件和 bridge 实现继续保留，删除工作必须进入单独的 M7 清理任务。

## TDD 与验收边界

- RED：新增契约先命中入口仍使用 Legacy session/runner、默认 Legacy gate、CopilotKit bridge 工具、Deep Window 缺少完整视图状态和 Agent 导航状态丢失。
- GREEN：独立 session/store/tool executor、Modern-first gate、进程内状态恢复和独立 XLSX 下载实现后，目标组件与静态契约通过。
- 浏览器登录、真实数据、SSE 网络、视觉和完整交互由用户最终验收；自动化结果不替代浏览器结论。
