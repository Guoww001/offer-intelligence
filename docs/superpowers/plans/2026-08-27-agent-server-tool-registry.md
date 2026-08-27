# Agent 服务端工具注册表与结构化协议实现方案

> **给执行代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本方案。每一步使用复选框跟踪。

**目标：** 将 Agent 的工具定义、参数校验、综合请求组装和运行绑定从浏览器端迁移到服务端，使客户端不能再自定义工具描述、Schema 或整段 LLM `messages`，同时保持本地服务与 Vercel 函数的行为一致。

**架构：** 新增两个无数据库依赖的共享 Python 模块：`agent_tool_registry.py` 只负责七个只读工具的规范定义和结果字段白名单，`agent_contract.py` 负责版本化请求校验、计划证明签发/验证以及服务端消息组装。`chat_agent_http.py`、`server.py` 和 `api/chat/stream.py` 只调用共享模块；`public/app.js` 只发送问题、语言、启用工具集合以及结构化工具结果。普通 Chat Mode 的 `prompt/history` 请求保持原有路径，不能再通过 `messages` 旁路进入 Agent 综合流程。

**技术栈：** Python 标准库（`json`、`hashlib`、`hmac`、`secrets`、`time`）、现有 `chat_agent_http.py`、`server.py`、`api/chat/stream.py`、`llm_provider.py`、原生 JavaScript、现有 Python/Node 测试脚本；不新增运行时依赖、不新增数据库表。

## 全局约束

- 本方案只实现 `docs/chat-agent-optimization-roadmap.md` 的 4.2；不改 4.3 的超时/重试架构，不重做 4.5 的记忆模型，不新增 Agent Trace 表或 DB migration。
- 服务端规范工具固定为七个：`merchant_analysis`、`category_analysis`、`merchant_comparison`、`tier_analysis`、`category_comparison`、`payment_status`、`trend`。
- `AGENT_MAX_REQUEST_BYTES` 继续为 `64 * 1024`，`AGENT_SYNTHESIS_MAX_REQUEST_BYTES` 继续为 `128 * 1024`，`AGENT_SYNTHESIS_MAX_TOKENS` 继续为 `4096`；更细的字段限制必须小于这些总请求上限。
- Agent 规划和综合协议版本固定为 `v2`，注册表版本固定为 `agent-tools-v1`。版本不匹配时返回固定错误码，不自动降级到旧的任意 `messages`/客户端工具定义协议。
- 初次规划请求只允许提交 `question`、`language`、`enabledTools` 和受控的 Trace 元数据；重规划若保留现有两轮行为，只能增加服务端定义的 `retry` 控制块，不能增加自由文本消息或工具结果。
- 综合请求只允许提交 `question`、`language`、`context`、`toolResults`、服务端签发的计划证明和受控 Trace 元数据；客户端提交的 `messages`、`system`、工具描述、工具 Schema、原始异常文本一律拒绝。
- `context` 只能包含 `memory` 和 `history`；`history` 的角色只能是 `user` 或 `assistant`，不能出现客户端 `system` 消息。服务端把它标记为不可信用户上下文后再组装 LLM 消息。
- 计划证明使用现有服务端 `OI_SESSION_SECRET` 的独立 HMAC purpose，签名有效期为 600 秒；不使用客户端可见密钥，不向客户端返回密钥，不落库。
- HMAC 证明可以防止跨运行重放、调用 ID/工具名/参数替换和注册表版本错配，但不能证明浏览器返回的数据值真实。七个工具仍由浏览器执行这一事实必须在文档和测试中明确；结果真实性需要未来的服务端工具执行方案。
- 工具结果只能包含注册表列出的顶层字段、受控 `source` 元数据和受控错误对象；不得将 prompt、完整工具 JSON、完整答案、异常堆栈写入 Trace 或新增日志。
- `server.py` 本地路由和 Vercel 的 `api/chat/actions.py`/`api/chat/stream.py` 必须复用相同共享校验函数；不得在两个入口各自复制一套 Schema。
- 修改前后都要保留工作区已有的 `protected_data/db_offers_cache.json`、`docs/agent-structured-conversation-memory.md` 和 `docs/superpowers/plans/2026-08-25-agent-trace-metrics.md` 变更，不把它们混入本方案实现。
- 所有用户可见文档、注释和测试说明使用简体中文；代码标识符、协议字段、错误码和命令保持英文原样。
- 实现阶段若需要启动页面验证，使用 `browser-act`，不使用 Playwright；任务完成后按 `AGENTS.md` 关闭 `8765` 端口上的本地服务器。

## 协议基线

### 规划请求

初次规划请求的 JSON 固定为：

```json
{
  "contractVersion": "v2",
  "question": "Shokz 当前 EPC 和转化率是多少？",
  "language": "zh",
  "enabledTools": [
    "merchant_analysis",
    "category_analysis",
    "merchant_comparison",
    "tier_analysis",
    "category_comparison",
    "payment_status",
    "trend"
  ],
  "trace": {
    "runId": "trace-run-id",
    "questionEventId": "question-event-id",
    "tracePhase": "planning"
  }
}
```

`trace` 只用于已有 Trace 关联，不参与工具权限判断。服务端从 `enabledTools` 与注册表求交集并生成实际 LLM tools；客户端不能改变描述和 Schema。

重规划时允许增加以下受控字段，以保留现有最多两轮规划能力：

```json
{
  "retry": {
    "agentRunId": "server-issued-agent-run-id",
    "previousPlanProof": "signed-proof",
    "failedCalls": [
      {"callId": "r1c1", "errorCode": "invalid_filter"}
    ]
  }
}
```

`failedCalls[].errorCode` 只能来自固定集合 `tool_error`、`tool_timeout`、`invalid_arguments`、`invalid_filter`、`not_found`、`stopped_by_user`；服务端只根据这些代码生成固定重试提示，不把浏览器的 `error` 文本传给 LLM。

规划成功响应固定包含：

```json
{
  "ok": true,
  "contractVersion": "v2",
  "registryVersion": "agent-tools-v1",
  "agentRunId": "server-issued-agent-run-id",
  "content": null,
  "toolCalls": [
    {
      "id": "r1c1",
      "name": "merchant_analysis",
      "arguments": {"merchant": "Shokz"}
    }
  ],
  "planProof": "base64url-payload.base64url-signature",
  "finishReason": "tool_calls",
  "telemetry": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "usageAvailable": false,
    "inputTokens": null,
    "outputTokens": null,
    "totalTokens": null,
    "inputBytes": 512,
    "errorCode": null
  }
}
```

无工具的直接回答仍返回 `content` 和 `finishReason: "stop"`，但不返回 `planProof`。LLM 返回的工具调用必须先经过注册表名称、参数类型、字段白名单和范围校验，校验失败时返回 `ok: false`、固定 `errorCode` 和不回显输入值的 `field`。

### 综合请求

Agent 综合请求固定为：

```json
{
  "contractVersion": "v2",
  "agentRunId": "server-issued-agent-run-id",
  "planProofs": ["signed-proof"],
  "question": "Shokz 当前 EPC 和转化率是多少？",
  "language": "zh",
  "context": {
    "memory": "用户此前关注 EPC 和转化率。",
    "history": [
      {"role": "user", "content": "先看 Shokz"},
      {"role": "assistant", "content": "我会查询 Shokz 的数据。"}
    ]
  },
  "toolResults": [
    {
      "callId": "r1c1",
      "toolName": "merchant_analysis",
      "arguments": {"merchant": "Shokz"},
      "result": {
        "ok": true,
        "data": {
          "merchant": "Shokz",
          "metrics": {"epc": 1.23, "conversionRate": 0.08},
          "headline": "Shokz 查询完成"
        },
        "source": {
          "dataSource": "database",
          "dataAsOf": "2026-08-27T08:00:00Z",
          "estimated": false
        }
      }
    }
  ],
  "trace": {
    "runId": "trace-run-id",
    "questionEventId": "question-event-id",
    "tracePhase": "synthesis"
  }
}
```

服务端必须验证：`agentRunId`、`question` 哈希、注册表版本、计划证明有效期、每个 `callId`/`toolName`/`arguments` 哈希、结果数量上限和结果字段白名单。通过后由服务端生成唯一的 provider message list；`llm_provider.stream_chat(messages=server_messages)` 只能接收该列表。

### 错误协议

对外只使用以下固定错误码：

| HTTP 状态 | `errorCode` | 用途 |
| --- | --- | --- |
| 400 | `agent_contract_version_required` | 缺少或不支持 `contractVersion` |
| 400 | `invalid_agent_contract` | JSON 类型、必填字段或字段长度错误 |
| 400 | `unsupported_tool` | 工具不在服务端注册表或未启用 |
| 400 | `invalid_arguments` | 工具参数字段、类型、枚举或范围错误 |
| 400 | `invalid_tool_result` | 结果字段、结果来源或结果大小错误 |
| 409 | `run_binding_failed` | 计划证明、运行 ID、调用 ID、参数哈希或过期时间不匹配 |
| 413 | `agent_payload_too_large` | 请求或单项结果超出限制 |
| 200 | `agent_planning_unavailable` | 规划 Provider 不可用，沿用当前 JSON 业务失败语义 |
| 503 | `agent_signing_unavailable` | 服务端没有可用的 `OI_SESSION_SECRET` |
| 503 | `agent_synthesis_unavailable` | Provider 不可用；不回显 Provider 异常文本 |

错误响应只返回 `ok: false`、`errorCode`、必要的 `field` 和固定 `allowed` 值；不返回原始 prompt、完整 payload、客户端错误文本或异常堆栈。

## 文件边界

### 新增文件

- `agent_tool_registry.py`：七个工具的唯一规范来源、参数 Schema、结果字段白名单、字段限制和纯函数校验。
- `agent_contract.py`：`v2` 请求校验、HMAC 计划证明、规划/综合 provider message 组装以及公开错误映射。
- `scripts/test_agent_tool_registry.py`：注册表和工具参数/结果校验的纯单元测试。
- `scripts/test_agent_contract.py`：协议、计划证明、上下文裁剪和综合消息组装测试。
- `scripts/test_agent_synthesis_contract.py`：本地与 Vercel 综合入口的结构化协议边界测试。

### 修改文件

- `chat_agent_http.py`：移除客户端 `messages`、`tools` 作为规划输入；改为服务端注册表和 `v2` 计划证明。
- `server.py`：本地 `/api/chat/stream` 对 Agent 综合请求调用共享结构化校验；普通 `prompt/history` 继续可用。
- `api/chat/stream.py`：Vercel 综合入口与本地入口共用相同结构化校验和消息组装。
- `public/app.js`：停止发送客户端工具描述和整段综合 `messages`；发送 `v2` 规划/综合请求，并把工具调用参数与结果按白名单投影。
- `scripts/test_agent_http.py`：将既有规划测试迁移到 `v2`，增加客户端工具 Schema/旧 `messages` 拒绝断言。
- `scripts/test_chat_agent.mjs`：增加前端请求体和计划证明绑定回归断言，更新现有 Agent fixture。
- `scripts/test_chat_stream_agent_config.py`：确认本地/Vercel 都经过结构化校验后才调用综合流。
- `scripts/test_llm_agent.py`：增加 provider 只接收服务端组装消息的回归测试，保留低层 provider 适配器测试。
- `docs/chatbot-feature-report.md`：补充 4.2 协议、注册表和真实性边界。
- `docs/chat-agent-optimization-roadmap.md`：在 4.2 中记录实现状态、协议版本和未覆盖的服务端工具执行阶段。
- `.github/workflows/ci.yml`：加入新增 Python 测试脚本，并保持既有 Node/Python 检查。

`llm_provider.py` 不承担客户端输入校验，原则上不改 provider 调用行为；只在必要时更新 `stream_chat` 的 docstring，明确 `messages` 是服务端内部已组装消息。真正的安全边界在 `agent_contract.py` 和两个 HTTP 入口。

---

### 任务 1：建立服务端工具注册表

**文件：**

- 新增：`agent_tool_registry.py`
- 新增：`scripts/test_agent_tool_registry.py`
- 参考：`chat_agent_http.py:16-23`、`public/app.js:13532-13540`、`public/app.js:15110-15200`

**接口：**

```python
AGENT_CONTRACT_VERSION = "v2"
AGENT_TOOL_REGISTRY_VERSION = "agent-tools-v1"
AGENT_TOOL_NAMES = (
    "merchant_analysis",
    "category_analysis",
    "merchant_comparison",
    "tier_analysis",
    "category_comparison",
    "payment_status",
    "trend",
)

def get_agent_tool_definitions(language: str, enabled_tools: object) -> list[dict]:
    pass


def validate_enabled_tools(value: object) -> tuple[list[str] | None, dict | None]:
    pass


def validate_tool_arguments(tool_name: str, arguments: object) -> tuple[dict | None, dict | None]:
    pass


def validate_tool_result(tool_name: str, result: object) -> tuple[dict | None, dict | None]:
    pass
```

`get_agent_tool_definitions` 必须返回深拷贝，调用方修改返回值不能污染注册表。注册表内部使用不可变常量，七个工具的描述和 Schema 只在此文件维护。

所有协议校验函数的错误返回值都必须包含内部使用的整数 `status` 和公开的 `errorCode`；`public_agent_error_payload` 在发送前删除 `status`、异常对象和内部字段，只保留错误协议允许的公开键。

七个工具的 canonical description 语义固定为：`merchant_analysis` 查询单个商户的核心指标、分位、品类/Tier/全站对比、同行、付款风险和月度数据；`category_analysis` 查询品类汇总、Tier 分布、全站对比和 Top 商户；`merchant_comparison` 只处理用户明确提出的 2–5 个商户比较；`tier_analysis` 查询单个 Tier 汇总和分页商户列表；`category_comparison` 比较 2–4 个品类并支持可选 Tier；`payment_status` 按状态、月份、Tier 或商户查询付款记录；`trend` 查询商户、品类或 Tier 的月度趋势。每个工具在注册表中同时保存 `description_zh` 和 `description_en`，`get_agent_tool_definitions(language, enabled_tools)` 只输出对应语言的 `description`。

参数 Schema 固定为：

| 工具 | 必填字段 | 允许字段和限制 |
| --- | --- | --- |
| `merchant_analysis` | `merchant` | 字符串，去除首尾空白后长度 1–80 |
| `category_analysis` | `category` | 字符串，去除首尾空白后长度 1–120 |
| `merchant_comparison` | `merchants` | 字符串数组，数量 2–5，每项长度 1–80 |
| `tier_analysis` | `tier` | `tier` 为五个 Tier 枚举之一；`limit` 为整数 1–100；`offset` 为整数 0–10000；只允许这三个字段 |
| `category_comparison` | `categories` | 字符串数组，数量 2–4，每项长度 1–120；`tier` 为可选 Tier 枚举 |
| `payment_status` | 至少一个过滤字段 | `status` 为 `paid/pending/unpaid/overdue/partial`；`month` 匹配 `^20\\d{2}-(0[1-9]|1[0-2])$`；`tier` 为 Tier 枚举；`merchant` 为字符串 1–80 |
| `trend` | `target` | `entityType` 为 `merchant/category/tier`；`target` 长度 1–80；`months` 为整数 2–24，默认 12；`metric` 只能使用当前 `TREND_METRIC_DEFS` 的键 |

结果顶层字段白名单沿用前端当前 `AGENT_TOOL_PROMPT_FIELDS`，但由服务端维护：

```python
AGENT_RESULT_FIELDS = {
    "merchant_analysis": ("merchant", "tier", "category", "metrics", "ranks", "comparisons", "strengths", "weaknesses", "paymentRisk", "peers", "latestMonth", "monthly", "monthlyDataAvailable", "monthlyDataSource", "monthlyNote", "headline", "note"),
    "category_analysis": ("category", "merchantCount", "tierDistribution", "aggregates", "vsGlobal", "topMerchants", "headline", "note"),
    "merchant_comparison": ("entities", "notFound", "deltas", "pairwiseDeltas", "headline", "note"),
    "tier_analysis": ("tier", "merchantCount", "aggregates", "vsOtherTiers", "segments", "outliers", "merchantList", "merchants", "headline", "note"),
    "category_comparison": ("tierFilter", "entities", "headline", "note"),
    "payment_status": ("filter", "summary", "rows", "headline", "note"),
    "trend": ("entityType", "target", "estimated", "metric", "metrics", "months", "summary", "headline", "note"),
}
```

结果校验还必须执行：普通结果最大 6,000 UTF-8 字节，`tier_analysis` 最大 18,000 字节，单项字符串最大 1,000 字符，数组最大 100 项，嵌套深度最大 4，数值必须为有限 JSON number，拒绝 `__proto__`、`constructor`、`prototype` 键；外层 `source` 只允许 `dataSource`、`dataAsOf`、`estimated`。

结果外层只允许 `ok`、`data`、`source`、`errorCode`、`resolution`；成功结果要求 `ok=true`、`data` 为对应工具的 `AGENT_RESULT_FIELDS` 投影，失败结果要求 `ok=false` 且 `errorCode` 属于受控错误集合。`resolution` 只允许 `status`、`field`、`allowed`、`candidates`、`value`，不接受自由文本 `error`。

- [ ] **步骤 1：先写失败测试。** 在 `scripts/test_agent_tool_registry.py` 中覆盖以下具体断言：七个名称完全相等；未知启用工具返回 `unsupported_tool`；每个工具拒绝未知参数字段；`merchant_comparison` 拒绝 1 项；`tier_analysis.limit=101` 被拒绝；`payment_status` 的非法月份被拒绝；`trend.months=1` 被拒绝；结果中的 `rawPrompt` 和额外顶层字段被拒绝；返回的定义深拷贝可修改且不影响第二次读取。

```python
from agent_tool_registry import (
    AGENT_TOOL_NAMES,
    get_agent_tool_definitions,
    validate_enabled_tools,
    validate_tool_arguments,
    validate_tool_result,
)


def test_registry_has_exactly_seven_tools():
    assert AGENT_TOOL_NAMES == (
        "merchant_analysis", "category_analysis", "merchant_comparison",
        "tier_analysis", "category_comparison", "payment_status", "trend",
    )


def test_client_cannot_add_tool_or_mutate_registry():
    names, error = validate_enabled_tools(["merchant_analysis", "delete_data"])
    assert names is None and error["errorCode"] == "unsupported_tool"
    first = get_agent_tool_definitions("zh", ["merchant_analysis"])
    first[0]["parameters"]["properties"]["merchant"]["type"] = "array"
    second = get_agent_tool_definitions("zh", ["merchant_analysis"])
    assert second[0]["parameters"]["properties"]["merchant"]["type"] == "string"


def test_tool_arguments_are_closed_and_bounded():
    valid, error = validate_tool_arguments("merchant_comparison", {"merchants": ["A", "B"]})
    assert error is None and valid["merchants"] == ["A", "B"]
    invalid, error = validate_tool_arguments("merchant_comparison", {"merchants": ["A"]})
    assert invalid is None and error["errorCode"] == "invalid_arguments"
    invalid, error = validate_tool_arguments("tier_analysis", {"tier": "Tier 2", "limit": 101})
    assert invalid is None and error["errorCode"] == "invalid_arguments"


def test_result_fields_are_allowlisted():
    result, error = validate_tool_result(
        "merchant_analysis",
        {"ok": True, "data": {"merchant": "A", "headline": "done", "rawPrompt": "secret"}},
    )
    assert result is None and error["errorCode"] == "invalid_tool_result"
```

- [ ] **步骤 2：运行失败测试，确认缺少模块或校验未实现。**

运行：`python scripts/test_agent_tool_registry.py`

预期：FAIL，至少出现 `ModuleNotFoundError` 或断言失败；此时不修改生产入口。

- [ ] **步骤 3：实现最小注册表和纯函数校验。** 在 `agent_tool_registry.py` 中添加闭合的七工具定义、参数校验、递归 JSON 安全限制和结果投影。所有错误统一返回形如 `{"errorCode": "invalid_arguments", "field": "limit"}` 的字典，不包含收到的原始值。

```python
def validate_tool_arguments(tool_name: str, arguments: object) -> tuple[dict | None, dict | None]:
    spec = _SPECS.get(tool_name)
    if spec is None:
        return None, {"errorCode": "unsupported_tool", "field": "toolName"}
    if not isinstance(arguments, dict):
        return None, {"errorCode": "invalid_arguments", "field": "arguments"}
    allowed = set(spec["argument_fields"])
    if any(key not in allowed for key in arguments):
        return None, {"errorCode": "invalid_arguments", "field": "arguments"}
    cleaned = _validate_spec_arguments(spec, arguments)
    return (cleaned, None) if cleaned is not None else (None, {"errorCode": "invalid_arguments", "field": "arguments"})
```

- [ ] **步骤 4：运行注册表测试，确认全部通过。**

运行：`python scripts/test_agent_tool_registry.py`

预期：输出每个测试的 `PASS`，最后输出 `OK`，且没有数据库连接或网络调用。

- [ ] **步骤 5：检查工作区边界。**

运行：`git diff --check`，再运行 `git status --short`；确认只新增注册表及其测试，没有触碰已有缓存和历史方案文件。未经用户再次授权，不提交 Git commit。

---

### 任务 2：建立版本化 Agent 协议和计划证明

**文件：**

- 新增：`agent_contract.py`
- 新增：`scripts/test_agent_contract.py`
- 依赖：`agent_tool_registry.py`

**接口：**

```python
def validate_planning_request(body: object) -> tuple[dict | None, dict | None]:
    pass


def build_planning_messages(request: dict, retry: dict | None = None) -> list[dict]:
    pass


def normalize_planning_tool_calls(tool_calls: object, question: str, round_number: int) -> list[dict]:
    pass


def normalize_planning_result(result: dict, request: dict, agent_run_id: str, round_number: int) -> tuple[dict | None, dict | None]:
    pass


def issue_plan_proof(agent_run_id: str, question: str, calls: list[dict], expires_at: int) -> str:
    pass


def verify_plan_proof(token: str, agent_run_id: str, question: str, now: int | None = None) -> dict | None:
    pass


def validate_synthesis_request(body: object) -> tuple[dict | None, dict | None]:
    pass


def validate_bound_tool_results(request: dict) -> tuple[list[dict] | None, dict | None]:
    pass


def build_synthesis_messages(request: dict, validated_results: list[dict]) -> list[dict]:
    pass


def public_agent_error_payload(error: dict) -> dict:
    pass
```

计划证明的签名输入必须是规范化 JSON：

```python
{
    "version": "agent-tools-v1",
    "agentRunId": "run-20260827-a1",
    "questionHash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "round": 1,
    "expiresAt": 1780000000,
    "calls": [
        {"id": "r1c1", "name": "merchant_analysis", "argumentsHash": "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}
    ]
}
```

使用 `hmac.compare_digest` 验证签名；密钥读取 `OI_SESSION_SECRET`，缺失时返回 `agent_signing_unavailable`，不能使用空密钥、客户端传入密钥或固定测试密钥。证明负载只放调用元数据，不放 prompt、结果值或答案。

综合上下文限制固定为：`memory` 最多 8,000 字符；`history` 最多 4 条；每条 `content` 最多 1,200 字符；`toolResults` 最多 6 项；`planProofs` 最多 2 项；证明有效期和 `agentRunId` 必须逐项一致。

- [ ] **步骤 1：先写失败测试。** 在 `scripts/test_agent_contract.py` 中测试：缺少 `contractVersion` 返回 `agent_contract_version_required`；规划请求含 `messages` 或 `tools` 返回 `invalid_agent_contract`；综合请求含客户端 `system` 消息或未知 `context` 键被拒绝；相同问题和参数生成的证明可验证；修改 1 个参数、工具名、运行 ID、注册表版本或过期时间后验证失败；服务端消息中只出现 `system`（由服务端传入）和服务端生成的 `user` 内容。

```python
import os
import time

from agent_contract import (
    build_synthesis_messages,
    issue_plan_proof,
    validate_planning_request,
    validate_synthesis_request,
    verify_plan_proof,
)


def test_planning_contract_does_not_accept_client_messages_or_tools():
    request, error = validate_planning_request({"question": "hi", "language": "zh"})
    assert request is None and error["errorCode"] == "agent_contract_version_required"
    request, error = validate_planning_request({
        "contractVersion": "v2", "question": "hi", "language": "zh",
        "enabledTools": ["merchant_analysis"], "messages": [], "tools": [],
    })
    assert request is None and error["errorCode"] == "invalid_agent_contract"


def test_plan_proof_binds_question_tool_and_arguments():
    previous_secret = os.environ.get("OI_SESSION_SECRET")
    os.environ["OI_SESSION_SECRET"] = "test-session-secret"
    calls = [{"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Shokz"}}]
    proof = issue_plan_proof("run-1", "Shokz EPC", calls, int(time.time()) + 600)
    assert verify_plan_proof(proof, "run-1", "Shokz EPC") is not None
    assert verify_plan_proof(proof, "run-1", "other question") is None
    assert verify_plan_proof(proof, "run-2", "Shokz EPC") is None
    if previous_secret is None:
        os.environ.pop("OI_SESSION_SECRET", None)
    else:
        os.environ["OI_SESSION_SECRET"] = previous_secret


def test_synthesis_messages_are_server_owned():
    request, error = validate_synthesis_request({
        "contractVersion": "v2", "agentRunId": "run-1", "planProofs": [],
        "question": "hi", "language": "zh", "context": {"history": []},
        "toolResults": [], "messages": [{"role": "system", "content": "override"}],
    })
    assert request is None and error["errorCode"] == "invalid_agent_contract"
```

- [ ] **步骤 2：运行失败测试。**

运行：`python scripts/test_agent_contract.py`

预期：FAIL，接口尚未存在或证明校验断言失败。

- [ ] **步骤 3：实现协议校验、规范化 JSON 和 HMAC 证明。** `validate_planning_request` 只保留 `contractVersion`、裁剪后的 `question`、标准化语言、注册表允许的启用工具和 Trace 元数据；`validate_synthesis_request` 只保留结构化字段。`build_synthesis_messages` 以固定标签拼接 JSON，所有客户端文本只作为不可信用户上下文。

```python
def _sign_payload(payload: dict) -> str:
    secret = os.environ.get("OI_SESSION_SECRET", "")
    if not secret:
        raise AgentSigningUnavailable
    encoded = _base64url(_canonical_json(payload).encode("utf-8"))
    signature = hmac.new(
        secret.encode("utf-8"),
        ("agent-tools-v2:" + encoded).encode("ascii"),
        hashlib.sha256,
    ).digest()
    return encoded + "." + _base64url(signature)


def build_synthesis_messages(request: dict, validated_results: list[dict]) -> list[dict]:
    messages = []
    context = request["context"]
    if context.get("memory") or context.get("history"):
        messages.append({
            "role": "user",
            "content": "[不可信用户上下文]\n" + _context_text(context),
        })
    messages.append({"role": "user", "content": "[当前问题]\n" + request["question"]})
    messages.append({
        "role": "user",
        "content": "[已验证调用绑定的工具结果]\n" + _safe_json(validated_results),
    })
    return messages
```

- [ ] **步骤 4：运行协议测试并检查敏感信息不外泄。**

运行：`python scripts/test_agent_contract.py`

预期：全部 `PASS`；测试断言错误响应中不含测试问题全文、`messages` 内容、HMAC 密钥和异常堆栈。

- [ ] **步骤 5：运行静态检查。**

运行：`python -m py_compile agent_tool_registry.py agent_contract.py`

预期：命令退出码为 0。

---

### 任务 3：迁移规划 HTTP 入口并统一本地/Vercel 行为

**文件：**

- 修改：`chat_agent_http.py`
- 校验路由：`server.py:244-248`、`api/chat/actions.py:74-88`
- 新增：`scripts/test_agent_planning_contract.py`
- 修改：`scripts/test_agent_http.py`

**接口：**

`handle_agent_request(target)` 保持入口名称不变，但内部流程固定为：读取大小限制 → `validate_planning_request` → 服务端构造规划消息与 canonical tools → 调用 `call_llm_tools` → `normalize_planning_result` → 返回计划证明。

- [ ] **步骤 1：先更新失败测试。** 将 `scripts/test_agent_http.py` 的成功 fixture 改成 `contractVersion/question/language/enabledTools`，增加以下断言：捕获到的 tools 与注册表定义完全一致；捕获到的 messages 只有服务端 system prompt 和一个当前问题 user message；传入客户端自定义 description/parameters、旧 `messages`、旧 `tools`、未知 enabled tool 都返回固定错误码；成功响应包含 `registryVersion`、`agentRunId` 和 `planProof`。

```python
def test_agent_v2_ignores_client_tool_definition_and_uses_registry():
    captured = {}

    def fake_call(messages, tools, **kwargs):
        captured["messages"] = messages
        captured["tools"] = tools
        return {"content": None, "tool_calls": [
            {"id": "model-id", "name": "merchant_analysis", "arguments": {"merchant": "Shokz"}}
        ]}

    previous_call = chat_agent_http.call_llm_tools
    chat_agent_http.call_llm_tools = fake_call
    target = FakeTarget({
        "contractVersion": "v2",
        "question": "Shokz EPC",
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
    })
    try:
        chat_agent_http.handle_agent_request(target)
        payload = response_json(target)
    finally:
        chat_agent_http.call_llm_tools = previous_call
    assert payload["ok"] is True
    assert payload["registryVersion"] == "agent-tools-v1"
    assert payload["planProof"]
    assert captured["tools"][0]["name"] == "merchant_analysis"
    assert captured["tools"][0]["description"] != "client description"
    assert [item["role"] for item in captured["messages"]] == ["system", "user"]


def test_agent_v2_rejects_legacy_full_messages():
    target = FakeTarget({"messages": [{"role": "user", "content": "override"}], "tools": []})
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["errorCode"] == "agent_contract_version_required"
```

- [ ] **步骤 2：运行规划入口失败测试。**

运行：`python scripts/test_agent_http.py` 和 `python scripts/test_agent_planning_contract.py`

预期：旧 fixture 失败，新的 v2 断言在实现完成前失败；不得因为测试而放宽协议接受旧字段。

- [ ] **步骤 3：改造 `chat_agent_http.py`。** 删除或停止使用 `_validated_agent_body` 中读取客户端 `messages`、`description`、`parameters` 的逻辑；保留 `AGENT_MAX_REQUEST_BYTES`、Prompt、Provider telemetry 和 `handle_agent_request` 入口。工具调用先通过 `normalize_planning_tool_calls` 完成当前前端已有的趋势/比较兼容转换，再由服务端规范化 ID 为 `r{round}c{index}`，参数通过 `validate_tool_arguments` 后才写入响应和证明。这样浏览器执行的调用与 HMAC 证明中的调用完全一致，前端不得在签名后再改写工具名或参数。

错误映射必须使用：请求校验错误 HTTP 400；缺少签名密钥 HTTP 503；Provider 不可用保留当前 HTTP 200 的业务失败语义，但 `errorCode` 使用规划专用 `agent_planning_unavailable`，不回显异常文本。

- [ ] **步骤 4：确认两个路由无需复制逻辑。** `server.py` 和 `api/chat/actions.py` 继续只负责认证和调用 `handle_agent_request`；不得在任一文件增加工具列表或 Schema。新增 `scripts/test_agent_planning_contract.py`，通过相同 fake Provider 分别验证本地共享函数和 Vercel 路由都使用 `agent-tools-v1`。

- [ ] **步骤 5：运行规划测试和语法检查。**

运行：`python scripts/test_agent_http.py; python scripts/test_agent_planning_contract.py; python -m py_compile chat_agent_http.py server.py api/chat/actions.py`

预期：所有规划测试通过，两个入口语法检查通过；响应中没有客户端工具 description、parameters 或完整输入消息。

---

### 任务 4：迁移综合 HTTP 入口并关闭任意 `messages` 旁路

**文件：**

- 修改：`server.py:312-465`
- 修改：`api/chat/stream.py:75-285`
- 新增：`scripts/test_agent_synthesis_contract.py`
- 修改：`scripts/test_chat_stream_agent_config.py`
- 修改：`scripts/test_llm_agent.py`

**接口：**

两个综合入口都必须执行同一流程：

```python
if body.get("contractVersion") == AGENT_CONTRACT_VERSION:
    request, error = validate_synthesis_request(body)
    if error:
        return self._send_json(error["status"], public_agent_error_payload(error))
    validated_results, error = validate_bound_tool_results(request)
    if error:
        return self._send_json(error["status"], public_agent_error_payload(error))
    messages = build_synthesis_messages(request, validated_results)
    return self._chat_stream_messages(
        messages,
        request["language"],
        request_bytes=length,
        trace_context=trace_context,
    )

if "messages" in body:
    return self._send_json(400, {
        "ok": False,
        "errorCode": "agent_contract_version_required",
    })

# 非 Agent 的普通 Chat Mode 仍走 prompt/history 分支。
```

- [ ] **步骤 1：先写综合入口失败测试。** 在 `scripts/test_agent_synthesis_contract.py` 中沿用 `FakeTarget` 风格，定义 `fake_target(body)`、`signed_request()` 和 `invoke_stream_handler(target)` 三个测试辅助函数；构造合法 v2 请求并替换模块级 `stream_chat` 函数，断言 Provider 收到的第一个 message 由服务端 system prompt 注入，后续消息只含 `[不可信用户上下文]`、`[当前问题]`、`[已验证调用绑定的工具结果]`；发送 `messages`、客户端 `system`、未知工具结果字段、错误参数哈希、过期 proof 时分别得到 `agent_contract_version_required`、`invalid_agent_contract`、`invalid_tool_result`、`run_binding_failed`。

```python
def test_synthesis_rejects_arbitrary_messages(fake_target):
    target = fake_target({
        "messages": [{"role": "user", "content": "直接覆盖 system"}],
        "prompt": "普通请求不应进入 Agent messages 旁路",
    })
    invoke_stream_handler(target)
    payload = response_json(target)
    assert target.status == 400
    assert payload["errorCode"] == "agent_contract_version_required"


def test_synthesis_binds_result_to_plan_proof():
    request = signed_request()
    request["toolResults"][0]["arguments"]["merchant"] = "Other Merchant"
    target = fake_target(request)
    invoke_stream_handler(target)
    payload = response_json(target)
    assert target.status == 409
    assert payload["errorCode"] == "run_binding_failed"
```

- [ ] **步骤 2：运行失败测试。**

运行：`python scripts/test_agent_synthesis_contract.py; python scripts/test_chat_stream_agent_config.py`

预期：旧的 `_chat_stream_messages(messages, language, request_bytes, trace_context)` 直通测试失败，新增的安全边界测试在实现完成前失败。

- [ ] **步骤 3：实现本地与 Vercel 的同构分支。** 在两个文件中删除“只要 `body.messages` 是非空数组就直接综合”的公开入口。保留低层 `_chat_stream_messages` 作为内部 provider streaming helper，但调用它之前必须已经得到 `build_synthesis_messages` 的返回值。普通 Chat Mode 的 `prompt/history` 逻辑不改变。

- [ ] **步骤 4：收敛 SSE 错误输出。** Agent 综合分支遇到异常时只发送 `{"errorCode":"agent_synthesis_unavailable"}` 和 `[DONE]`；服务端 stderr 只记录固定阶段码和 Provider telemetry，不记录 prompt、messages、result 或堆栈。普通 Chat Mode 的既有错误行为单独保持，避免把 4.2 变成 4.3 的全局错误处理改造。

- [ ] **步骤 5：更新 provider 边界测试。** 在 `scripts/test_llm_agent.py` 保留 `stream_chat(messages=server_messages)` 的适配器测试，并新增断言：HTTP handler 传入的 `messages` 等于 `agent_contract.build_synthesis_messages` 返回值；测试中的任意客户端 `messages` 不会被传给 provider。`llm_provider.py` 只更新 docstring，说明 `messages` 是服务端内部参数。

- [ ] **步骤 6：运行综合测试。**

运行：`python scripts/test_agent_synthesis_contract.py; python scripts/test_chat_stream_agent_config.py; python scripts/test_llm_agent.py; python -m py_compile server.py api/chat/stream.py llm_provider.py`

预期：本地和 Vercel 入口的边界测试全部通过；普通 `prompt/history` 测试仍通过；Agent 请求不存在任意 `messages` 直通路径。

---

### 任务 5：迁移前端 Agent 请求和结果投影

**文件：**

- 修改：`public/app.js:14052-14120`、`public/app.js:15110-15200`、`public/app.js:15818-16240`
- 修改：`scripts/test_chat_agent.mjs`
- 参考：`public/app.js:13532-13540` 的 `AGENT_TOOL_PROMPT_FIELDS`

**接口：**

新增前端内部函数：

```javascript
function agentEnabledToolNames() {
  return [
    "merchant_analysis",
    "category_analysis",
    "merchant_comparison",
    "tier_analysis",
    "category_comparison",
    "payment_status",
    "trend"
  ];
}

function buildAgentPlanningRequest(prompt, language, traceContext, retry) {
  return {
    contractVersion: "v2",
    question: agentClipText(prompt, AGENT_PROMPT_CHARS),
    language: language === "en" ? "en" : "zh",
    enabledTools: agentEnabledToolNames(),
    trace: traceContext ? {
      runId: traceContext.runId,
      questionEventId: traceContext.questionEventId,
      tracePhase: "planning"
    } : undefined,
    retry: retry || undefined
  };
}

function buildAgentSynthesisRequest(prompt, language, memoryText, history, toolResults, run, traceContext) {
  return {
    contractVersion: "v2",
    agentRunId: String(run.agentRunId || ""),
    planProofs: Array.isArray(run.planProofs) ? run.planProofs.slice(0, 2) : [],
    question: agentClipText(prompt, AGENT_PROMPT_CHARS),
    language: language === "en" ? "en" : "zh",
    context: {
      memory: agentClipText(memoryText, AGENT_SYNTHESIS_MEMORY_CHARS),
      history: agentRecentHistory(history, AGENT_SYNTHESIS_HISTORY_LIMIT, AGENT_SYNTHESIS_MESSAGE_CHARS)
    },
    toolResults: (toolResults || []).map(projectAgentToolResultForServer),
    trace: traceContext ? {
      runId: traceContext.runId,
      questionEventId: traceContext.questionEventId,
      tracePhase: "synthesis"
    } : undefined
  };
}

function projectAgentToolResultForServer(item) {
  var result = item && item.result && typeof item.result === "object" ? item.result : {};
  var trace = agentTraceDataMeta(result);
  var projected = {
    callId: String(item && item.id || ""),
    toolName: String(item && item.name || ""),
    arguments: item && item.arguments && typeof item.arguments === "object" ? item.arguments : {},
    result: {
      ok: result.ok === true,
      data: result.ok === true ? agentToolPromptData(String(item && item.name || ""), result.data) : {},
      source: {
        dataSource: trace.dataSource || "unknown",
        dataAsOf: trace.dataAsOf || null,
        estimated: trace.estimated === true
      }
    }
  };
  if (!projected.result.ok) projected.result.errorCode = String(result.errorCode || "tool_error");
  return projected;
}
```

- [ ] **步骤 1：先添加 Node 失败测试。** 在 `scripts/test_chat_agent.mjs` 的 fetch fixture 中记录 `/api/chat/agent` 与 `/api/chat/stream` 的 body，断言：规划 body 没有 `messages`、`tools`、`description`、`parameters`；综合 body 没有 `messages`，包含 `contractVersion`、`question`、`context`、`toolResults`、`agentRunId`、`planProofs`；每个 result 包含 `callId`、`toolName`、`arguments`，但不包含原始 `error`、完整未投影数据或 `trace` 之外的未知字段。

```javascript
assert(!Object.prototype.hasOwnProperty.call(planBody, "messages"));
assert(!Object.prototype.hasOwnProperty.call(planBody, "tools"));
assert(planBody.contractVersion === "v2");
assert(Array.isArray(planBody.enabledTools));
assert(synthesisBody.contractVersion === "v2");
assert(!Object.prototype.hasOwnProperty.call(synthesisBody, "messages"));
assert(synthesisBody.toolResults[0].callId === "c1");
assert(synthesisBody.toolResults[0].toolName === "merchant_analysis");
assert(!Object.prototype.hasOwnProperty.call(synthesisBody.toolResults[0].result, "error"));
```

- [ ] **步骤 2：运行 Node 失败测试。**

运行：`node scripts/test_chat_agent.mjs`

预期：新增请求体断言失败；现有 Agent 工具结果和 UI 行为测试继续提供基线信息。

- [ ] **步骤 3：移除客户端工具定义传输。** 删除 `agentToolDefinitions()` 中用于向服务端发送 description/parameters 的职责，使用 `agentEnabledToolNames()` 只传七个名称。可以保留 UI 内部标签映射，但不能再把任何客户端描述或 Schema 放入 HTTP body。

- [ ] **步骤 4：改造规划调用。** `runChatAgent` 初次调用 `/api/chat/agent` 时使用 `buildAgentPlanningRequest`；保存服务端返回的 `agentRunId` 和 `planProof`，并把每轮 proof 追加到 `planProofs`。重规划只发送受控 `retry` 的调用 ID 和固定错误码，不再向 `messages` 数组追加工具结果文本。原有 `normalizeAgentToolCalls` 中会改变工具名或参数的业务兼容转换迁移到 `agent_contract.py`，由服务端在签发 `planProof` 前完成；前端只执行服务端返回的已绑定调用，不能在签名后改写调用。

- [ ] **步骤 5：改造工具结果投影。** `executeAgentToolBatch` 返回值增加 `arguments: call.arguments`，综合前用 `projectAgentToolResultForServer` 生成：

```javascript
{
  callId: String(item.id),
  toolName: String(item.name),
  arguments: item.arguments || {},
  result: {
    ok: item.result.ok === true,
    data: agentToolPromptData(item.name, item.result.data),
    source: {
      dataSource: agentTraceDataMeta(item.result).dataSource || "unknown",
      dataAsOf: agentTraceDataMeta(item.result).dataAsOf || null,
      estimated: agentTraceDataMeta(item.result).estimated === true
    }
  }
}
```

失败结果只保留 `ok: false`、`errorCode` 和受控 `resolution` 字段；不得把 `result.error` 传入综合请求。`buildAgentSynthesisRequest` 将当前 memory/history 按服务端限制裁剪，并把 Trace 元数据放在独立 `trace` 字段。

- [ ] **步骤 6：改造综合调用。** 用结构化 request 替换：

```javascript
var synthesisRequest = buildAgentSynthesisRequest(
    prompt,
    language,
    memoryText,
    history,
    toolResults,
    { agentRunId: agentRunId, planProofs: planProofs },
    traceContext
  );
var reply = await streamAssistantReply(synthesisRequest, {
  chatLogEl: chatLogEl,
  language: language,
  viewContext: opts.viewContext || null,
  onError: opts.onError || null,
  signal: signal,
  traceContext: traceContext,
  tracePhase: "synthesis"
});
```

`streamAssistantReply` 仍负责 SSE 渲染、usage 和中止；不再为 Agent 综合构造或发送完整 `messages`。普通 Chat Mode 调用点继续使用 `prompt/history`。

- [ ] **步骤 7：运行前端回归测试和语法检查。**

运行：`node --check public/app.js; node scripts/test_chat_agent.mjs; node scripts/test_agent_trace.mjs`

预期：Agent 的工具执行、失败 fallback、月度数据展示、Trace 关联和中止行为通过；请求体断言确认客户端没有发送工具 Schema 或任意 messages。

---

### 任务 6：补齐 Trace、文档和 CI 边界

**文件：**

- 修改：`docs/chatbot-feature-report.md`
- 修改：`docs/chat-agent-optimization-roadmap.md` 的 4.2
- 修改：`.github/workflows/ci.yml`
- 参考且保持不变：`agent_trace_http.py`、`scripts/test_agent_trace.py`、`scripts/test_agent_trace_http.py`、`docs/agent-structured-conversation-memory.md`

- [ ] **步骤 1：先写文档验收断言。** 用 `rg` 检查文档必须包含 `v2`、`agent-tools-v1`、七个工具名、`OI_SESSION_SECRET`、600 秒、`messages` 拒绝规则和“浏览器结果值不具备服务端真实性证明”的边界说明；不得把 `prompt`、完整工具结果或答案列为 Trace 持久化字段。

运行：

```powershell
rg -n "v2|agent-tools-v1|OI_SESSION_SECRET|600|messages|merchant_analysis|category_analysis|merchant_comparison|tier_analysis|category_comparison|payment_status|trend" docs/chatbot-feature-report.md docs/chat-agent-optimization-roadmap.md
```

预期：两个文档都能找到协议说明，4.2 的状态描述与实际代码一致。

- [ ] **步骤 2：更新 chatbot 架构文档。** 在 Agent 请求流中明确：浏览器 → `v2` 规划请求 → 服务端 canonical tools → 浏览器执行 → `v2` 结构化综合请求 → 服务端校验/组装 → Provider；列出规划和综合 JSON 的允许顶层字段、错误码、证明 TTL 和字段大小限制。

- [ ] **步骤 3：更新路线图 4.2。** 将“建议”改为实际实现状态时，单独列出已完成的服务端注册表、参数/结果白名单、计划证明、本地/Vercel 共用校验和前端请求迁移；同时注明结果值真实性仍依赖未来服务端执行工具，避免将 HMAC 绑定误写成数据来源签名。

- [ ] **步骤 4：把测试加入 CI。** 在 `.github/workflows/ci.yml` 中加入以下命令，并保持顺序与本地验证一致：

```yaml
- run: python scripts/test_agent_tool_registry.py
- run: python scripts/test_agent_contract.py
- run: python scripts/test_agent_planning_contract.py
- run: python scripts/test_agent_synthesis_contract.py
- run: python scripts/test_agent_http.py
- run: python scripts/test_chat_stream_agent_config.py
- run: python scripts/test_llm_agent.py
- run: node scripts/test_chat_agent.mjs
- run: node scripts/test_agent_trace.mjs
```

- [ ] **步骤 5：运行 Trace 回归测试。**

运行：`python scripts/test_agent_trace.py; python scripts/test_agent_trace_http.py`

预期：Trace 的 `runId`、`questionEventId`、planning/tool/synthesis 阶段状态和 usage 事件仍通过；测试确认新协议不会把 `question`、`messages`、工具参数、工具结果、答案正文或异常堆栈写入 Trace。

---

### 任务 7：执行全量验证和 browser-act 运行验证

**文件：**

- 只读检查：`git diff --check`、`git diff --stat`、`git status --short`
- 运行入口：`server.py`
- 浏览器验证：使用 `browser-act` skill，不使用 Playwright

- [ ] **步骤 1：运行与 CI 一致的本地静态/单元检查。**

运行：

```powershell
node --check public/auth.js
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
python scripts/test_auth_helpers.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_category_drilldown.mjs
node scripts/test_tier_visual_status.mjs
node scripts/test_zh_chatbot.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py server.py offer_db.py levanta_payments.py chat_agent_http.py agent_tool_registry.py agent_contract.py api/auth/index.py api/chat/actions.py api/chat/stream.py api/db/index.py api/levanta/payments.py api/tier_moves.py scripts/validate_db_migration.py
python scripts/test_agent_tool_registry.py
python scripts/test_agent_contract.py
python scripts/test_agent_planning_contract.py
python scripts/test_agent_synthesis_contract.py
python scripts/test_agent_http.py
python scripts/test_chat_stream_agent_config.py
python scripts/test_llm_agent.py
node scripts/test_chat_agent.mjs
node scripts/test_agent_trace.mjs
```

预期：所有命令退出码为 0；任何失败先回到对应任务的 RED/GREEN 测试定位，不跳过 Agent 协议测试。

- [ ] **步骤 2：启动本地服务并用 browser-act 验证真实请求。** 使用 `python server.py` 启动后，通过 `browser-act` 打开 `http://127.0.0.1:8765/`，完成现有登录流程，在 Agent 页面发送一个具体商户问题和一个普通问候问题。检查 Network/XHR 或 browser-act 捕获的请求：

  - `/api/chat/agent` 只含 `contractVersion/question/language/enabledTools/trace`，不含 `messages/tools`。
  - `/api/chat/stream` 的 Agent 综合请求只含 `question/context/toolResults/agentRunId/planProofs`，不含 `messages`。
  - 普通 Chat Mode 仍能使用 `prompt/history`。
  - Agent 页面仍显示 planning、tool、synthesis 三阶段，并能在 Provider usage 不可用时保持 `usageAvailable=false`。

- [ ] **步骤 3：验证拒绝路径。** 在浏览器开发者工具或受控测试请求中发送旧 `messages`、未知 `enabledTools` 和篡改后的 `toolResults.arguments`，确认服务端分别返回 `agent_contract_version_required`、`unsupported_tool`、`run_binding_failed`；不验证真实数据值签名，不把该边界误报为已完成。

- [ ] **步骤 4：关闭本地服务器。** 任务完成后用以下 PowerShell 只定位并终止当前监听 8765 的本地进程，再确认端口已释放；不要根据旧 PID 终止其他进程：

```powershell
$agentPortListeners = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($agentPortListeners) {
  $agentPortListeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id ([int]$_) -Force
  }
}
Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
```

预期：最后一条命令无输出，不留下后台 `server.py`。

- [ ] **步骤 5：完成最终差异审计。**

运行：`git diff --check; git diff --stat; git status --short`

最终差异只能包含本方案列出的 Agent 代码、测试、CI 和文档；已有缓存、4.5 文档和 Agent Trace 计划文件必须保持原状。只有在用户明确授权后，才进行 commit、push 或 PR。

## 完成判定

4.2 只有同时满足以下条件才算完成：

1. 服务端注册表是七个工具定义的唯一来源，客户端只能提交启用名称集合。
2. `/api/chat/agent` 不接受客户端 `messages`、工具 description 或 parameters，并能返回服务端签发的计划证明。
3. Agent 综合请求只能使用 `question + context + toolResults + planProofs`，本地与 Vercel 都在 provider 调用前完成相同校验。
4. 工具结果拥有调用 ID、工具名、参数哈希绑定和受控来源字段；旧请求、未知字段、越界数据和篡改请求都有固定错误码。
5. 普通 Chat Mode、Agent UI、Trace usage、工具失败 fallback 和现有全量测试不回归。
6. 文档准确说明 HMAC 只绑定运行和调用元数据，尚未对浏览器产生的结果值提供事实真实性签名。
7. browser-act 真实页面验证完成，且本地 `8765` 服务已关闭。
