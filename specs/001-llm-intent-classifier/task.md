# LLM 意图分类 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `llm_classify.py` | 共享模块：`classify_intent()`, system prompt 构建, 响应解析 |
| 新建 | `api/chat/classify.py` | Vercel handler: `POST /api/chat/classify` |
| 修改 | `requirements.txt` | 添加 `anthropic` SDK 依赖 |
| 修改 | `auth.py` | `handle_auth_session()` 返回 `llmEnabled` |
| 修改 | `server.py` | `do_POST` 新增路由, `handle_llm_classify()` 方法 |
| 修改 | `public/app.js` | `classifyWithLLM()`, 修改 `applyPrompt()` 和 `detectQueryIntent()` |

---

## T1: 创建 `llm_classify.py` 共享模块

**文件：** `llm_classify.py`（新建）
**依赖：** T2（`requirements.txt` 需要先添加 `anthropic`）

**步骤：**
1. 创建文件，添加 `from __future__ import annotations`
2. 定义常量：`VALID_INTENTS = {"asin", "merchant", "payment", "recommendation", "tier", "category"}`
3. 定义常量：`MODEL = "claude-haiku-3-5-latest"`
4. 实现 `_build_system_prompt(categories: list[str]) -> str`：
   - 定义 6 种意图的判别规则（参考现有正则逻辑的中英文覆盖范围）
   - 嵌入品类列表（用逗号分隔）
   - 要求 LLM 只输出意图标签单词，不要额外解释
5. 实现 `_parse_response(text: str) -> str | None`：
   - strip + lowercase 文本
   - 如果在 `VALID_INTENTS` 中 → 返回
   - 否则返回 `None`
6. 实现 `classify_intent(prompt: str, categories: list[str], timeout: float = 5.0) -> str | None`：
   - 检查 `ANTHROPIC_API_KEY` 环境变量，未配置时直接返回 `None`
   - 创建 `anthropic.Anthropic()` 客户端
   - 调用 `client.messages.create(model=MODEL, max_tokens=16, temperature=0, timeout=timeout, system=_build_system_prompt(categories), messages=[{"role": "user", "content": prompt}])`
   - 提取响应文本，调用 `_parse_response`
   - 捕获 `anthropic.APIError` 及其子类，打印警告到 `sys.stderr`，返回 `None`

**验证：** `python -c "from llm_classify import classify_intent, _build_system_prompt, _parse_response; print('import OK')"` 无报错

---

## T2: 添加 `anthropic` 依赖

**文件：** `requirements.txt`（修改）
**依赖：** 无

**步骤：**
1. 在文件末尾新增一行 `anthropic>=0.39.0`
2. 保持现有 `PyMySQL==1.1.1` 不变

**验证：** `pip install -r requirements.txt` 成功安装

---

## T3: 创建 `api/chat/classify.py` Vercel handler

**文件：** `api/chat/classify.py`（新建）
**依赖：** T1, T2

**步骤：**
1. 创建文件，导入 `BaseHTTPRequestHandler`
2. 导入 `from auth import require_auth, send_json, _read_json_body`
3. 导入 `from llm_classify import classify_intent`
4. 定义 `class handler(BaseHTTPRequestHandler)`：
   - `do_OPTIONS(self)` — 调用 `send_json(self, 204, {})`
   - `do_POST(self)`：
     1. `require_auth(self)` 失败则 return
     2. 检查 `Content-Length`，为 0 或 > 2048 则返回 400
     3. 调用 `_read_json_body(self)` 读取 JSON body
     4. 提取 `prompt`（必填，非空字符串）和 `categories`（选填，默认空列表）
     5. `prompt` 缺失返回 400 `{"ok": False, "error": "prompt is required"}`
     6. 调用 `result = classify_intent(prompt, categories)`
     7. `send_json(self, 200, {"intent": result})`

**验证：** `python -m py_compile api/chat/classify.py` 无语法错误

---

## T4: 修改 `auth.py` 添加 `llmEnabled`

**文件：** `auth.py`（修改）
**依赖：** 无

**步骤：**
1. 在文件顶部附近（如 `auth_enabled()` 函数之后）新增辅助函数：
   ```python
   def _llm_enabled() -> bool:
       value = os.environ.get("OI_LLM_ENABLED", "1").strip().lower()
       return value not in {"0", "false", "no", "off"}
   ```
2. 在 `handle_auth_session()` 中，auth disabled 分支的 200 响应 JSON 中添加 `"llmEnabled": _llm_enabled()`
3. 在 `handle_auth_session()` 中，正常 session 有效的 200 响应 JSON 中添加 `"llmEnabled": _llm_enabled()`

**验证：** `python scripts/test_auth_helpers.py` 全部通过

---

## T5: 修改 `server.py` 添加本地路由

**文件：** `server.py`（修改）
**依赖：** T1, T4

**步骤：**
1. 顶部 import 增加：从 `auth` 导入列表中追加 `_read_json_body`
2. 顶部 import 增加：`from llm_classify import classify_intent`（新增一行）
3. 在 `do_POST()` 方法中，`/api/tier_moves` 分支之后、`self.send_error(404)` 之前，增加 `/api/chat/classify` 路由分支
4. 新增 `handle_llm_classify()` 方法：
   - 检查 Content-Length ≤ 2048，否则返回 400
   - 读取并解析 JSON body
   - 校验 `prompt` 必填
   - 校验 `categories` 为 list 类型
   - 调用 `classify_intent(prompt, categories)`
   - 返回 `{"intent": result}`

**验证：** `python -m py_compile server.py` 无语法错误

---

## T6: 修改 `public/app.js` 前端集成

**文件：** `public/app.js`（修改）
**依赖：** T5

**步骤：**
1. 在 `const state = { ... }` 对象中新增字段：`llmIntent: null`
2. 在 `state` 对象附近新增 `const llmIntentCache = new Map();`
3. 新增 `collectCategories()` 函数（放在 `detectQueryIntent` 上方）：
   - 从 `offers` 数组遍历，提取唯一 `mainCategory` / `category` 值
   - 排除 `"Uncategorized"`，排序返回
4. 新增 `classifyWithLLM(prompt, categories)` 异步函数：
   - 检查缓存命中 → 直接返回
   - 检查 `state.llmEnabled === false` → 返回 null
   - `fetch POST /api/chat/classify`，`AbortSignal.timeout(5000)`
   - 成功 → 缓存并返回 `data.intent`
   - 失败 → `console.warn("[LLM] fallback to regex: " + reason)`，返回 null
5. 修改 `applyPrompt(prompt)` 为 `async function`：
   - LLM enabled 时：显示加载消息 → `await classifyWithLLM` → `state.llmIntent = intent` → 移除加载消息
   - LLM disabled 时：`state.llmIntent = null`
   - 然后照常执行 `addMessage("user", ...)` + `addMessage("assistant", answerPrompt(prompt))`
6. 修改 `detectQueryIntent(userMessage)` 函数：
   - 函数开头增加：如果 `state.llmIntent` 不为 null，返回它并清空
   - 后续正则逻辑不变
7. 在初始化流程中（session 数据加载后），将 `llmEnabled` 写入 `state.llmEnabled`

**验证：** `node --check public/app.js` 无语法错误

---

## T7: 运行全部测试

**文件：** 不涉及文件修改
**依赖：** T1-T6

**步骤：**
1. `node --check public/auth.js`
2. `node --check public/app.js`
3. `node --check public/chatbot_i18n.js`
4. `node --check public/tier2_recommendation_rules.js`
5. `python -m py_compile auth.py server.py llm_classify.py api/chat/classify.py`
6. `python scripts/test_auth_helpers.py`
7. `node scripts/test_chatbot_intent_flow.mjs`
8. `node scripts/test_zh_chatbot.mjs`

**验证：** 所有测试通过，无报错

---

## 执行顺序

```
T2 (requirements.txt) ──┐
                        ├── T1 (llm_classify.py) ── T3 (api/chat/classify.py)
                        │                              │
T4 (auth.py) ───────────┘                              │
                                                       │
                                            T5 (server.py)
                                                       │
                                            T6 (app.js)
                                                       │
                                            T7 (全部测试)
```
