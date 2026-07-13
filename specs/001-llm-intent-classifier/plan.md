# LLM 意图分类 Plan

## 架构概览

新增一个共享模块 `llm_classify.py`（与 `auth.py`、`offer_db.py` 同级），封装 Anthropic API 调用逻辑。本地和 Vercel 两条路径共用此模块：

```
Browser (app.js)
  │  POST /api/chat/classify  { prompt, categories }
  ▼
┌─ server.py ─────────────────────────────────────┐
│  do_POST → llm_classify.classify_intent()         │
│              │                                     │
│              ▼                                     │
│        Anthropic API (Claude Haiku)               │
│              │                                     │
│              ▼                                     │
│        返回 intent label 或 null                   │
└──────────────────────────────────────────────────┘

Vercel 路径:
  api/chat/classify.py → llm_classify.classify_intent()
                          → Anthropic API
```

**数据流**：

1. 用户在聊天框输入查询 → `applyPrompt(prompt)` 被调用
2. `applyPrompt` 显示加载消息（"正在理解你的问题…"）
3. 前端调用 `POST /api/chat/classify`，发送 `{ prompt, categories }`
4. 服务端调用 Claude Haiku，返回意图标签或 null
5. 前端收到结果：
   - 有效意图 → 存入缓存，继续 `answerPrompt()` 使用该意图
   - null/超时/错误 → 走现有 `detectQueryIntent()` 正则逻辑
6. `answerPrompt()` 照常生成 HTML 回答

**组件划分**：

| 组件 | 文件 | 职责 |
|------|------|------|
| LLM 分类模块 | `llm_classify.py`（新建） | 封装 Anthropic SDK 调用、prompt 构建、响应解析 |
| Vercel handler | `api/chat/classify.py`（新建） | Vercel 入口，验证 session，调 classify_intent |
| 服务端路由 | `server.py`（修改） | 添加 `POST /api/chat/classify` 本地路由 |
| Session 响应 | `auth.py`（修改） | 在 `/api/auth/session` 中返回 `llmEnabled` |
| 前端意图识别 | `public/app.js`（修改） | LLM 优先调用、缓存、加载状态、fallback |
| 依赖声明 | `requirements.txt`（修改） | 添加 `anthropic` |

## 核心数据结构

### `llm_classify.py` — 函数签名

```python
def classify_intent(prompt: str, categories: list[str], timeout: float = 5.0) -> str | None:
    """调用 Claude Haiku 对用户查询做意图分类。

    Args:
        prompt: 用户输入的原始查询文本
        categories: 当前系统中所有已知品类名称列表（用于 category 意图判断）
        timeout: API 调用超时秒数，默认 5 秒

    Returns:
        意图标签字符串 ("asin" | "merchant" | "payment" | "recommendation" | "tier" | "category")
        或 None（LLM 无法判断或调用失败）
    """
```

### `llm_classify.py` — 内部函数

```python
def _build_system_prompt(categories: list[str]) -> str:
    """构建 system prompt，包含意图定义和可用品类列表。"""

def _parse_response(text: str) -> str | None:
    """从 LLM 响应文本中提取意图标签。只接受 6 个已知标签，其余返回 None。"""
```

### HTTP API — `POST /api/chat/classify`

**Request** (JSON body, max 2KB):
```json
{
  "prompt": "推荐5个美妆offer",
  "categories": ["Beauty & Personal Care", "Electronics", "Home & Kitchen", "..."]
}
```

**Response** (200 OK):
```json
{ "intent": "recommendation" }
```

**Response** (LLM 无法判断):
```json
{ "intent": null }
```

**Response** (401 Unauthorized):
```json
{ "ok": false, "authenticated": false, "error": "Login is required." }
```

**Response** (400 Bad Request):
```json
{ "ok": false, "error": "prompt is required" }
```

### 前端 — 缓存结构

```javascript
// session 级别缓存，key 为 trim 后的用户输入
const llmIntentCache = new Map();  // Map<string, string | null>
```

### 前端 — `classifyWithLLM()` 函数签名

```javascript
async function classifyWithLLM(prompt, categories) {
  // 1. 检查 llmIntentCache
  // 2. 如果 miss，POST /api/chat/classify
  // 3. 超时 5 秒用 AbortController
  // 4. 成功 → 写入缓存，返回 intent
  // 5. 失败 → console 记录原因，返回 null
}
```

### `auth.py` — Session 响应扩展

```python
# handle_auth_session() 响应中新增字段：
{
  "ok": True,
  "authenticated": True,
  "user": { ... },
  "llmEnabled": True   # 由 OI_LLM_ENABLED 环境变量控制
}
```

## 模块设计

### 模块 A: `llm_classify.py`（新建）

**职责**：封装 Anthropic API 调用，对外暴露单一函数 `classify_intent()`

**对外接口**：`classify_intent(prompt, categories, timeout=5.0) -> str | None`

**依赖**：`anthropic` Python SDK（`requirements.txt` 新增），环境变量 `ANTHROPIC_API_KEY`

**内部设计**：

- `_build_system_prompt(categories)` — 构建 system prompt，定义 6 种意图及其判别规则，附带当前品类名称列表
- `_parse_response(text)` — 清理 LLM 返回文本（trim、lowercase），验证是否为合法意图标签，不在白名单内返回 None
- 合法标签白名单：`{"asin", "merchant", "payment", "recommendation", "tier", "category"}`
- API 调用使用 `anthropic.Anthropic().messages.create()`，指定 `model="claude-haiku-3-5-latest"`, `max_tokens=16`, `temperature=0`
- 捕获 `anthropic.APIError` 及其子类，统一返回 None 并打印警告到 stderr

### 模块 B: `api/chat/classify.py`（新建）

**职责**：Vercel serverless handler，处理 `POST /api/chat/classify`

**对外接口**：`class handler(BaseHTTPRequestHandler)` — `do_OPTIONS` + `do_POST`

**依赖**：`auth.py`（`require_auth`, `send_json`）, `llm_classify.py`（`classify_intent`）

**内部设计**：
- `do_OPTIONS` — 返回 204 + CORS headers
- `do_POST` — 流程：require_auth → 读取 JSON body → 校验 → classify_intent → send_json

### 模块 C: `server.py`（修改）

**职责**：本地开发服务器路由

**修改点**：
- 顶部 import 新增 `from llm_classify import classify_intent`
- `do_POST()` 方法中新增 `/api/chat/classify` 路由
- 新增 `handle_llm_classify()` 方法

### 模块 D: `auth.py`（修改）

**职责**：session 响应中添加 `llmEnabled` 字段

**修改点**：
- `handle_auth_session()` 200 响应 body 增加 `llmEnabled` 字段
- `OI_LLM_ENABLED` 环境变量控制（0/false/no/off → false）

### 模块 E: `public/app.js`（修改）

**职责**：前端 LLM 优先调用、缓存、加载状态

**修改点**：

1. 新增 `classifyWithLLM()` 函数
2. 修改 `applyPrompt()` — 异步调 LLM，显示加载消息，结果存入 `state.llmIntent`
3. 修改 `detectQueryIntent()` — 优先使用 `state.llmIntent`
4. 新增 `collectCategories()` 辅助函数 — 从 offers 提取唯一品类名
5. 加载消息 i18n

## 模块交互

### 正常流程（LLM 成功分类）

```
用户输入 "推荐5个美妆offer"
  │
  ▼
app.js: applyPrompt(prompt)
  ├── 显示加载消息 "正在理解你的问题…"
  ├── await classifyWithLLM(prompt, categories)
  │     ├── 检查 llmIntentCache → miss
  │     ├── fetch POST /api/chat/classify
  │     │     │
  │     │     ▼
  │     │   server.py: handle_llm_classify()
  │     │     ├── require_auth() ✓
  │     │     ├── 读取 body, 校验参数
  │     │     └── llm_classify.classify_intent(prompt, [...])
  │     │           ├── _build_system_prompt([...])
  │     │           ├── anthropic.messages.create(...)
  │     │           │     → "recommendation"
  │     │           └── _parse_response("recommendation") → "recommendation"
  │     │
  │     ├── 返回 { intent: "recommendation" }
  │     └── llmIntentCache.set("推荐5个美妆offer", "recommendation")
  │
  ├── state.llmIntent = "recommendation"
  ├── 移除加载消息
  └── answerPrompt(prompt)
        └── detectQueryIntent() → "recommendation"（来自 state.llmIntent）
              └── 走 recommendation 分支
```

### Fallback 流程（LLM 超时 / 失败）

```
classifyWithLLM() 返回 null
  → state.llmIntent = null
  → detectQueryIntent() 跳过 LLM 路径
  → 走现有正则逻辑
```

### 缓存命中流程

```
classifyWithLLM() → llmIntentCache.get() 命中 → 立即返回（无网络请求）
```

## 文件组织

```
project/
├── llm_classify.py          ← 新建  共享模块：classify_intent(), prompt 构建, 响应解析
├── requirements.txt         ← 修改  添加 anthropic
├── auth.py                  ← 修改  handle_auth_session() 返回 llmEnabled
├── server.py                ← 修改  do_POST 新增 /api/chat/classify 路由
├── api/
│   └── chat/
│       └── classify.py      ← 新建  Vercel handler，调 llm_classify.classify_intent()
├── public/
│   ├── app.js               ← 修改  classifyWithLLM(), detectQueryIntent(), applyPrompt()
│   └── chatbot_i18n.js      ← 可能修改  understanding 文案 i18n
├── specs/
│   └── 001-llm-intent-classifier/
│       ├── spec.md           ← ✓
│       ├── plan.md           ← (当前)
│       ├── task.md
│       └── checklist.md
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| LLM SDK | `anthropic` Python SDK | 内置重试、错误分类、类型提示。与 Levanta API 不同（无官方 SDK） |
| 模型 | `claude-haiku-3-5-latest` | 延迟低（~0.5-1s）、成本极低、中英双语能力足够做分类 |
| temperature | `0` | 意图分类是确定性任务，不需要创造性 |
| 共享模块位置 | 根目录 `llm_classify.py` | 与 `auth.py`、`offer_db.py` 同级，符合项目现有 pattern |
| LLM 调用时机 | `applyPrompt()` 中异步调用 | `detectQueryIntent()` 是同步函数，改为 async 会波及大量调用方。在 applyPrompt 中 async 调用，结果通过 state 传递 |
| 加载消息实现 | `addMessage("assistant", "...")` 临时消息 | 复用现有消息渲染机制，不引入新 UI 组件 |
| 缓存位置 | 浏览器内存 `Map` | session 级别，刷新后清空。`localStorage` 需要额外过期管理 |
| 品类列表获取 | 每次从 `window.CHATBOT_DATA.offers` 动态提取 | 数据已在浏览器内存中，O(n) 提取耗时 < 10ms |
| 超时实现 | 前端 `AbortSignal.timeout(5000)` + SDK `timeout=5.0` | 双重保障，标准 Web API |
| `llmEnabled` 传递 | `/api/auth/session` 响应字段 | 复用现有 session check 流程，无需新增请求 |
| Vercel handler 模式 | POST handler | prompt 和 categories 可能较长，不适合 URL query string |
