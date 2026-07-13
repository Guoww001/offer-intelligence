# Modular Intent Skills Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [ ] **Skill 基类可被继承**（AC1）——验证：`python -c "from skills.base import IntentSkill; class Test(IntentSkill): pass; print('subclass OK')"` 无报错
- [ ] **所有 Skill 文件可导入**（AC2）——验证：`python -c "import skills; print(skills.registry.list_intents())"` 输出 6+ 个 intent
- [ ] **Analysis Skill 已注册**（F5）——验证：`python -c "import skills; assert skills.registry.get_analysis() is not None; print('analysis registered')"` 无报错
- [ ] **System prompt 由遍历 Skills 动态组装**（AC3）——验证：检查 `_build_system_prompt()` 源码，不存在硬编码的单个 intent 描述字符串
- [ ] **参数验证由 Schema 驱动**（AC4）——验证：修改某个 Skill 的 `param_schema()` 中某字段的 `enum` 值后，`_parse_response()` 对该字段的验证同步生效，无需手动修改 `_parse_response()` 中的常量
- [ ] **VALID_INTENTS 从 Registry 自动派生**（F4）——验证：检查 `llm_classify.py` 源码，`VALID_INTENTS` 由 `registry.list_intents()` 生成

## 集成
- [ ] **`llm_classify.py` imports `skills`**——验证：import 链路 `llm_classify → skills → skills/*` 正常工作
- [ ] **`server.py` imports `skills`**——验证：`python -c "import skills; from llm_classify import classify_intent, generate_analysis_text"` 通过
- [ ] **`api/chat/classify.py` 不修改**（F6）——验证：对比重构前后该文件的 diff，无变更
- [ ] **`api/chat/analyze.py` 不修改**（F6）——验证：对比重构前后该文件的 diff，无变更
- [ ] **Analysis 委托给 AnalysisSkill**（F5）——验证：`generate_analysis_text()` 内部调用 `registry.get_analysis().generate()`

## 编译与测试
- [ ] **所有 Python 文件无语法错误**——验证：`python -m py_compile skills/base.py skills/asin.py skills/merchant.py skills/payment.py skills/recommendation.py skills/tier.py skills/category.py skills/analysis_text.py skills/__init__.py llm_classify.py api/chat/classify.py api/chat/analyze.py server.py` 全部通过
- [ ] **前端 JS 无语法错误**——验证：`node --check public/app.js` 和 `node --check public/chatbot_i18n.js` 通过
- [ ] **现有 Python 测试通过**——验证：`python scripts/test_auth_helpers.py` 通过
- [ ] **现有 Node 测试通过**——验证：`node scripts/test_chatbot_intent_flow.mjs` 和 `node scripts/test_zh_chatbot.mjs` 通过
- [ ] **Skill 单元测试通过**（AC8）——验证：`python tests/test_skills.py` 所有断言通过

## 端到端场景
- [ ] **场景 1: 正常意图分类**——验证：本地启动 `python server.py`，用 curl 发 `POST /api/chat/classify {"prompt":"推荐5个美妆offer","categories":["Beauty"]}` → 返回 `{"intent":"recommendation","params":{"category":"Beauty","count":5}}`（需 LLM API key）
- [ ] **场景 2: Analysis 文本生成**——验证：本地启动 `python server.py`，用 curl 发 `POST /api/chat/analyze {"summary":{...},"language":"zh"}` → 返回 `{"ok":true,"text":"..."}`（需 LLM API key）
- [ ] **场景 3: LLM 不可用时 fallback**——验证：`OI_LLM_ENABLED=0` 时 chatbot 通过正则 fallback 正常工作，发送 "Tier2推荐" 正确路由到 recommendation 回答
- [ ] **场景 4: Provider 切换**——验证：设置 `OI_LLM_PROVIDER=deepseek` 后调用 DeepSeek；设置 `OI_LLM_PROVIDER=claude` 后调用 Claude
- [ ] **场景 5: 新增 Skill 验证**——验证：创建最小测试 Skill 文件并 import，其 intent 自动出现在 `registry.list_intents()` 和生成的 system prompt 中
