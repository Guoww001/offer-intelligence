# LLM 意图分类 Spec

## 背景

当前 chatbot 的意图识别完全基于正则表达式和关键词匹配（`detectQueryIntent` 函数，`app.js:3010`）。这套规则系统存在以下局限：

- 正则规则需要人工维护，覆盖边界情况成本高（如中英文混合、口语化表达、拼写变体）
- 关键词匹配依赖硬编码的别名表（如 `CATEGORY_ALIASES_ZH`），新品类需要手动添加映射
- 歧义消解能力弱——当一句话同时匹配多种意图时，只能按硬编码的优先级硬选
- 无法理解上下文语义（如「还有吗？」、「这个怎么样？」等追问）

## 目标

引入 Claude Haiku 作为意图分类引擎，在不改变回答生成逻辑的前提下，提高意图识别的准确度和覆盖范围：

- 用 LLM 理解用户查询的自然语言语义，替代部分正则规则的脆弱匹配
- 保持现有正则系统作为 fallback，确保 LLM 不可用时 chatbot 仍然可用
- 支持中英双语查询的意图识别

## 功能需求

- **F1**: LLM 意图分类 API——新增 `POST /api/chat/classify`，输入用户查询文本和品类列表，返回意图分类结果。使用 Claude Haiku，通过 Anthropic API SDK 调用，API key 通过 `ANTHROPIC_API_KEY` 环境变量配置
  - 输入：`{ prompt: string, categories: string[] }`
  - 输出：`{ intent: "asin" | "merchant" | "payment" | "recommendation" | "tier" | "category" | null }`
  - `null` 表示 LLM 无法判断，调用方应 fallback 到正则

- **F2**: 客户端 LLM 优先调用——修改 `detectQueryIntent()` 函数，在现有正则逻辑之前增加 LLM 调用。LLM 返回有效意图时直接使用；返回 `null` 或失败时走现有正则。参数提取仍由现有正则函数完成，不受 LLM 影响

- **F3**: 异步加载体验——LLM 调用期间显示「正在理解你的问题…」（中文）或「Understanding your question…」（英文）的临时消息。LLM 返回后替换为正常回答。正则路径（不调 LLM）时不显示加载状态

- **F4**: 客户端缓存——以用户输入（trim 后）为 key，session 级别缓存 LLM 返回的意图结果。页面刷新后清空。缓存命中时不发起网络请求

- **F5**: 超时与容错——LLM 请求超时时间 5 秒，超时自动 fallback 到正则。API 错误（4xx/5xx）、网络错误同样 fallback。fallback 对用户透明，在浏览器 console 记录原因方便调试

- **F6**: 功能开关——`OI_LLM_ENABLED=0` 时前端直接使用现有正则逻辑。默认启用。开关由 `/api/auth/session` 响应中的 `llmEnabled` 字段传递给前端

## 非功能需求

- **N1**: 延迟——LLM 意图分类的 P95 延迟（含网络往返）应 ≤ 3 秒，超时上限 5 秒

- **N2**: 可靠性——LLM 分类服务的可用性不影响 chatbot 核心功能，任何 LLM 故障都应透明降级到正则。正则路径的响应速度不受 LLM 集成影响

- **N3**: 安全性——`ANTHROPIC_API_KEY` 仅存储在服务端环境变量，不出现在前端代码、日志或 API 响应中。`/api/chat/classify` 端点需要 session 认证。请求体大小限制 ≤ 2KB

- **N4**: 成本控制——使用 Claude Haiku，客户端缓存减少重复调用，prompt 中仅发送用户查询文本和品类名称列表（不发送完整 offer 数据）

- **N5**: 可观测性——服务端记录 LLM 调用的基本指标（请求次数、成功/失败率、平均延迟），失败时记录原因

- **N6**: 兼容性——遵循项目 dual runtime 架构（`server.py` 本地路由 + `api/` 目录下 Vercel serverless handler）。接受使用 `anthropic` Python SDK。前端改动兼容现有浏览器支持范围

## 不做的事

- 不改变回答生成逻辑——`answerPrompt()` 及其下游函数保持不变
- 不改变参数提取——品类名、Tier 名、推荐数量、metric filter、支付周期等仍由现有正则/关键词函数完成
- 不引入流式输出——LLM 只返回意图标签，不需要 streaming
- 不存储用户查询历史——不做对话历史持久化，不做审计日志
- 不改变 chatbot UI 布局——只增加加载状态提示
- 不做多轮对话记忆——LLM 每次分类独立进行，现有 `contextFollowup` 逻辑保持在正则路径中

## 验收标准

- **AC1**: LLM 正确分类中英文意图（对应 F1）——中英文典型查询均返回正确意图标签
- **AC2**: 正则 fallback 正常工作（对应 F2, F5）——LLM 不可用/超时/报错时走正则，回答与改动前一致
- **AC3**: 加载状态展示（对应 F3）——LLM 调用期间显示双语临时消息，完成后替换为正常回答
- **AC4**: 缓存命中（对应 F4）——相同输入不重复调 LLM，刷新页面后缓存清空
- **AC5**: 功能开关生效（对应 F6）——`OI_LLM_ENABLED=0` 时前端不调 LLM，全部走正则
- **AC6**: 现有测试全量通过（对应 F2）——`test_chatbot_intent_flow.mjs` 和 `test_zh_chatbot.mjs` 全部通过，CI 检查通过
- **AC7**: 端点认证与输入校验（对应 F1, N3）——未登录返回 401，登录后正常返回 200，超 2KB 返回 400
