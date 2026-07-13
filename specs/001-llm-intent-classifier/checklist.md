# LLM 意图分类 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [ ] **llm_classify.py 可导入** — 验证：`python -c "from llm_classify import classify_intent; print('OK')"` 无报错
- [ ] **api/chat/classify.py 编译通过** — 验证：`python -m py_compile api/chat/classify.py` 无错误
- [ ] **server.py 编译通过** — 验证：`python -m py_compile server.py` 无错误
- [ ] **app.js 语法检查通过** — 验证：`node --check public/app.js` 无错误
- [ ] **anthropic 依赖可安装** — 验证：`pip install -r requirements.txt` 成功

## 功能验证（对应 AC1）
- [ ] **中文推荐查询 → intent "recommendation"** — 验证：`curl -X POST .../api/chat/classify -d '{"prompt":"推荐5个美妆offer","categories":["Beauty","Electronics"]}'` → `{"intent":"recommendation"}`
- [ ] **英文 merchant 查询 → intent "merchant"** — 验证：prompt=`"Shokz Electronics offers"` → `{"intent":"merchant"}`
- [ ] **中文支付查询 → intent "payment"** — 验证：prompt=`"四月未付款有哪些"` → `{"intent":"payment"}`
- [ ] **ASIN 查询 → intent "asin"** — 验证：prompt=`"B0D2HKCMBP"` → `{"intent":"asin"}`
- [ ] **Tier 查询 → intent "tier"** — 验证：prompt=`"Tier 2 里面表现好的"` → `{"intent":"tier"}`
- [ ] **品类查询 → intent "category"** — 验证：prompt=`"pet supplies"`，categories 包含 `"Pet Supplies"` → `{"intent":"category"}`

## Fallback 验证（对应 AC2）
- [ ] **无 API key 时返回 null** — 验证：不设 `ANTHROPIC_API_KEY`，调 `/api/chat/classify` → `{"intent":null}`
- [ ] **`OI_LLM_ENABLED=0` 时前端不调 LLM** — 验证：浏览器 console 无 LLM 相关网络请求
- [ ] **LLM 失败时正则路径正常** — 验证：断网/错误 API key 时，输入 `"四月未付款有哪些"`，chatbot 仍正常返回支付回答

## 加载状态验证（对应 AC3）
- [ ] **LLM 调用期间显示加载消息** — 验证：LLM 调用期间聊天区出现「正在理解你的问题…」/「Understanding your question…」
- [ ] **正则路径不显示加载消息** — 验证：`OI_LLM_ENABLED=0` 时，直接出现回答，无加载消息

## 缓存验证（对应 AC4）
- [ ] **相同查询不重复调 LLM** — 验证：两次相同输入，Network 面板只看到 1 次 `/api/chat/classify` 请求
- [ ] **刷新页面后缓存清空** — 验证：刷新后相同输入，再次看到网络请求

## 开关验证（对应 AC5）
- [ ] **Session 响应包含 llmEnabled** — 验证：`curl /api/auth/session` → 响应包含 `"llmEnabled": true`
- [ ] **`OI_LLM_ENABLED=0` 时 llmEnabled 为 false** — 验证：session 响应包含 `"llmEnabled": false`

## 回归测试（对应 AC6）
- [ ] **JS 语法检查全部通过** — 验证：`node --check public/auth.js public/app.js public/chatbot_i18n.js public/tier2_recommendation_rules.js`
- [ ] **Python 编译检查全部通过** — 验证：`python -m py_compile auth.py server.py llm_classify.py api/chat/classify.py`
- [ ] **chatbot 意图流测试通过** — 验证：`node scripts/test_chatbot_intent_flow.mjs`
- [ ] **中文 chatbot 测试通过** — 验证：`node scripts/test_zh_chatbot.mjs`
- [ ] **auth helpers 测试通过** — 验证：`python scripts/test_auth_helpers.py`

## 端到端场景
- [ ] **场景 1：正常 LLM 分类** — 输入 `"推荐 5 个美妆 offer"` → 加载消息 → 美妆品类推荐列表 → 第二次相同输入不调 LLM
- [ ] **场景 2：LLM 不可用时降级** — 无 `ANTHROPIC_API_KEY` → 输入 `"四月未付款有哪些"` → 正则识别 → 正常支付回答
- [ ] **场景 3：未登录拒绝** — 清除 cookie → `POST /api/chat/classify` → 401 → 走正则
