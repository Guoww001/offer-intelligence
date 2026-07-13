# Modular Intent Skills Spec

## 背景

当前 `llm_classify.py` 的 `_build_system_prompt()` 将所有 intent 定义、参数 schema、消歧规则、业务规则、few-shot examples 硬编码在一个 120+ 行的 Python 字符串中。每当需要新增一个 intent 或能力时，必须修改这个巨型字符串，风险在于：

- **单点膨胀**——所有 intent 的定义、参数、规则、示例挤在一个 prompt 里，修改任何一处都可能意外影响其他 intent 的分类质量
- **无隔离测试**——无法单独验证「新增 payment 的 overdue 参数提取」而不影响其他 intent
- **prompt 长度持续增长**——每个新 intent 都增加 prompt tokens，但实际上大多数查询只匹配 1-2 个 intent
- **参数定义重复**——`_EXPECTED_PARAM_KEYS`、`_VALID_METRIC_FIELDS`、`_VALID_TIERS` 等验证常量与 prompt 中的参数描述需要手动保持同步
- **前端 fallback 关键词分散**——`app.js:detectQueryIntent()` 和 `chatbot_i18n.js:detectIntent()` 各有一套关键词，与 Python prompt 中的描述构成第三套

## 目标

将单一 monolithic system prompt 重构为可扩展的 Skill 注册表架构，核心目标：

1. **隔离性**——每个 intent（及其参数提取）作为独立 Skill 模块，修改一个不影响其他
2. **可扩展**——新增 intent 只需：创建 Skill 类/模块 → 注册到 registry → 前端 fallback 可选添加关键词。不修改 orchestrator 代码
3. **单一真相源**——参数 schema、验证规则、prompt 描述从同一份定义派生，消除手动同步
4. **按需组装**——orchestrator 根据请求上下文决定发送哪些 skill 的 prompt 片段给 LLM
5. **analysis 作为一等 Skill**——`_build_analysis_system_prompt()` 同样纳入 skill 体系，共享 provider/调用基础设施

## 功能需求

- **F1: Skill 基类/协议定义**——定义一个 Skill 的抽象协议（Python base class），每个 Skill 模块自描述：intent 名称、intent 描述（中英文关键词）、参数 schema（字段名、类型、约束）、消歧规则、few-shot examples（至少 2-3 个）、前端 fallback 关键词（可选）

- **F2: Skill Registry 注册中心**——一个 Registry 容器，Skill 模块在 import 时自动注册。Orchestrator 通过 Registry 获取已注册的 skills。支持按 intent 名查找单个 skill，支持遍历所有 registered skills。新增 skill 只需创建文件 + import，不需修改 registry/orchestrator 代码

- **F3: Prompt 组装器（Orchestrator）**——将 `_build_system_prompt()` 拆分为固定前缀（角色定义、输出格式指令）、按 Skill 拼接的 intent 定义段（遍历 Registry 中所有 skill）、固定后缀（全局规则 + 已知品类列表 + few-shot examples）。Orchestrator 负责组装，不硬编码任何单个 intent 的信息

- **F4: 参数验证从 Schema 自动派生**——当前 `_parse_response()` 中的参数验证逻辑改为从各 Skill 的参数 schema 自动生成。每个 Skill 的参数 schema 即为其验证规则的单一真相源。`_parse_response()` 根据 intent 查找对应 Skill，用其 schema 验证参数

- **F5: Analysis Skill 纳入统一体系**——`_build_analysis_system_prompt()` 和 `generate_analysis_text()` 重构为同体系的 Analysis Skill——共享 provider 切换、超时、错误处理等基础设施。analysis 不作为 intent 之一（它是独立 LLM 调用），但共享 Skill 的 provider/配置抽象

- **F6: 向后兼容**——`POST /api/chat/classify` 输入输出格式不变；`POST /api/chat/analyze` 输入输出格式不变；`classify_intent()` 函数签名保持兼容；前端 `classifyWithLLM()` 调用方式不变；`VALID_INTENTS` 集合从 Registry 自动派生

- **F7: Provider 抽象保持**——现有的 DeepSeek / Claude 双 provider 切换逻辑保留，Skill 体系不绑定特定 LLM provider

## 非功能需求

- **N1: 可测试性**——每个 Skill 应可独立进行单元测试。可以单独验证某个 Skill 的 prompt 片段生成、参数验证逻辑，而不需要启动整个 LLM 调用链

- **N2: 延迟不变**——重构不增加 prompt 长度（或减少）。分类调用仍为单次 LLM 请求，P95 延迟 ≤ 3 秒

- **N3: 可观测性**——服务端日志保持现有格式（`[llm_classify] → calling ...` / `[llm_classify] ← intent=...`）。新增 skill 注册日志（开发模式）

- **N4: 向后兼容**——现有测试 `test_chatbot_intent_flow.mjs`、`test_zh_chatbot.mjs`、`test_auth_helpers.py` 全部通过。CI 检查通过

- **N5: 代码规范**——新代码遵循现有项目模式：Python 共享模块放根目录，Vercel handler 放 `api/chat/` 下。不引入新的第三方依赖

## 不做的事

- 不改为多阶段 LLM 调用（仍为单次分类调用）
- 不改变前端回答生成逻辑（`answerPrompt()` 及下游）
- 不改变 HTTP API contract
- 不改变 JS 端正则 fallback 机制本身（仅可选地提供关键词对齐能力）
- 不做 Skill 的热加载或动态配置——Skill 在代码中定义，部署时生效
- 不做多轮对话记忆

## 验收标准

- **AC1**: Skill 基类可被继承，新 Skill 实现所有必需方法后可正常注册和被调用（对应 F1）
- **AC2**: 新增一个 Skill 模块文件并 import 后，Registry 自动包含该 skill，`classify_intent()` 的 prompt 中自动包含其 intent 定义（对应 F2）
- **AC3**: 生成的 system prompt 在结构上由固定前缀 + 遍历 Skills 的动态段 + 固定后缀组成，不硬编码任何单个 intent 的描述（对应 F3）
- **AC4**: 修改某个 Skill 的参数 schema 后，LLM 返回的该参数自动按新 schema 验证（添加新字段、收紧约束均生效），无需手动同步 `_parse_response()`（对应 F4）
- **AC5**: Analysis 文本生成使用与 intent 分类相同的 provider 切换逻辑和错误处理，不重复实现（对应 F5）
- **AC6**: 现有测试全量通过。`POST /api/chat/classify` 和 `POST /api/chat/analyze` 的行为与重构前一致（对应 F6）
- **AC7**: 分别设置 `OI_LLM_PROVIDER=deepseek` 和 `OI_LLM_PROVIDER=claude` 后，分类和 analysis 均正确使用对应 provider（对应 F7）
- **AC8**: 至少有一个 Skill 具有独立的单元测试，验证其 prompt 片段和参数验证（对应 N1）
