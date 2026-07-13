# Chatbot 数据分析 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [x] **后端 T1-T3 完成**——验证：`python -c "from llm_classify import classify_intent, generate_analysis_text; print('ok')"` 无报错
- [x] **API 端点可用**——验证：`python -m py_compile api/chat/analyze.py` 通过
- [x] **本地路由可用**——验证：`python -m py_compile server.py` 通过
- [x] **前端新增函数存在**——验证：9 个关键函数全部声明：`analyzeMerchant`、`analyzeCategory`、`analyzeTier`、`renderAnalysisTable`、`analysisAnswer`、`percentileRank`、`segmentedStats`、`fetchAnalysisText`、`fallbackAnalysisText`
- [x] **路由分支已接入**——验证：`node --check public/app.js` 无语法错误

## 功能验收（对应 spec AC1-AC8）
- [ ] **AC1: LLM 正确分类分析意图**——验证：`llm_classify.classify_intent("分析 Shokz", ["Electronics"])` 返回 `{"intent": "analysis", "params": {"analysisType": "merchant", "analysisTarget": "Shokz"}}`
- [ ] **AC1: 品类分析分类**——验证：`classify_intent("美妆品类趋势如何", ["Beauty"])` 返回 `{"intent": "analysis", "params": {"analysisType": "category", "analysisTarget": "Beauty"}}`
- [ ] **AC1: Tier 分析分类**——验证：`classify_intent("Tier 2 整体表现", [])` 返回 `{"intent": "analysis", "params": {"analysisType": "tier", "analysisTarget": "Tier 2"}}`
- [ ] **AC2: 自然语言隐式触发**——验证：`classify_intent("Shokz 最近怎么样", [])` 返回 `{"intent": "analysis", ...}`（不包含"分析"二字仍能识别）
- [ ] **AC3: 商户分析完整性**——验证：在聊天中输入"分析 Shokz"，回答包含：(a) 核心指标表含百分位，(b) 与同品类/Tier 对比数据，(c) 强弱项标识，(d) 分析文字或降级文字
- [ ] **AC4: 品类分析完整性**——验证：在聊天中输入"分析 Electronics"，回答包含：(a) 品类统计（商户数/收入/EPC/CVR），(b) 品类内 Top/Bottom 排名，(c) 与全站均值对比
- [ ] **AC5: Tier 分析完整性**——验证：在聊天中输入"分析 Tier 2"，回答包含：(a) 聚合统计，(b) 与其他 Tier 对比，(c) 三段分化数据
- [ ] **AC6: LLM 生成分析文字**——验证：API key 配置正确时，分析回答中包含 LLM 生成的自然语言叙述和建议（非模板文字）
- [ ] **AC7: 混合呈现布局**——验证：分析回答中统计表格在 LLM 文字之前渲染，表格始终可见
- [ ] **AC8: LLM 降级**——验证：临时清空 `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` 后发送分析请求，分析表格正常显示，文字部分降级为模板生成的结论

## 回归验证
- [x] **现有意图不受影响**——验证：`node scripts/test_chatbot_intent_flow.mjs` 全部通过
- [x] **中文意图不受影响**——验证：`node scripts/test_zh_chatbot.mjs` 全部通过
- [x] **所有 JS 语法检查**——验证：`node --check public/app.js`、`node --check public/auth.js`、`node --check public/chatbot_i18n.js` 均通过
- [x] **所有 Python 编译检查**——验证：`python -m py_compile llm_classify.py api/chat/analyze.py api/chat/classify.py server.py` 均通过

## 端到端场景
- [ ] **场景 1: 显式触发商户分析**——用户输入"分析 Shokz" → chatbot 显示加载提示 → LLM 返回 analysis 意图 → 即时渲染商户分析表格 → 异步加载 LLM 分析文字（或降级文字）→ 完整分析回答可见
- [ ] **场景 2: 隐式触发品类分析**——用户输入"美妆最近表现怎么样" → LLM 识别为 analysis/category/Beauty → 即时渲染品类分析表格 → 追加分析文字
- [ ] **场景 3: LLM 不可用时降级**——LLM API 超时或报错 → 用户输入"分析 Tier 2" → 表格正常显示（即时）→ 降级文字出现（模板生成，如"Tier 2 平均 EPC 2.10，高于 Tier 3 40%"）
- [ ] **场景 4: 分析对象不存在**——用户输入"分析 NotExistBrand" → chatbot 返回友好的"未找到该商户/品类/Tier"消息，不崩溃
