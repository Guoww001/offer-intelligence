# Modular Intent Skills Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `skills/__init__.py` | import 所有 skill 模块，触发自动注册 |
| 新建 | `skills/base.py` | `IntentSkill` 基类、`ParamDef`、`ExamplePair`、`SkillRegistry` |
| 新建 | `skills/asin.py` | ASIN intent skill |
| 新建 | `skills/merchant.py` | Merchant intent skill |
| 新建 | `skills/payment.py` | Payment intent skill |
| 新建 | `skills/recommendation.py` | Recommendation intent skill |
| 新建 | `skills/tier.py` | Tier intent skill |
| 新建 | `skills/category.py` | Category intent skill |
| 新建 | `skills/analysis_text.py` | Analysis 文本生成 skill |
| 重构 | `llm_classify.py` | Orchestrator + provider 抽象 + 公共入口 |
| 微调 | `server.py` | 顶部 `import skills` |
| 新建 | `tests/test_skills.py` | Skill 单元测试（prompt 片段 + 参数验证） |

## T1: 创建 Skill 基础设施

**文件：** `skills/base.py`
**依赖：** 无
**步骤：**
1. 定义 `ParamDef` 数据类：`type`、`required`、`enum`、`nested_schema`、`description` 字段
2. 定义 `ExamplePair` 数据类：`query`、`output` 字段
3. 定义 `IntentSkill` 抽象基类（ABC）：`intent` 属性、`prompt_intent_section()`、`prompt_params_section()`、`param_schema()`、`examples()`、`fallback_keywords()` 抽象方法
4. 定义 `AnalysisSkill` 类（非抽象，但可被子类化）：`build_system_prompt(language)`、`generate(summary, language, timeout)` 方法
5. 定义 `SkillRegistry` 类：`register()`、`get()`、`list_all()`、`list_intents()`、`register_analysis()`、`get_analysis()`
6. 创建模块级 `registry = SkillRegistry()` 单例

**验证：** `python -c "from skills.base import IntentSkill, ParamDef, ExamplePair, SkillRegistry, AnalysisSkill, registry; print('base OK')"` 无报错

## T2: ASIN Skill

**文件：** `skills/asin.py`
**依赖：** T1
**步骤：**
1. 定义 `AsinSkill(IntentSkill)`，`intent = "asin"`
2. 实现 `prompt_intent_section()`：返回 ASIN 意图描述（"query contains a 10-character ASIN starting with B"）
3. 实现 `prompt_params_section()`：返回 asin 参数描述
4. 实现 `param_schema()`：`{"asin": ParamDef(type="str", description="...")}`
5. 实现 `examples()`：返回 `[ExamplePair(query="B0D2HKCMBP", output={"intent":"asin","params":{"asin":"B0D2HKCMBP"}})]`
6. 创建 `asin_skill = AsinSkill()` 模块实例

**验证：** `python -c "from skills.asin import asin_skill; print(asin_skill.intent, list(asin_skill.param_schema().keys()))"` 无报错

## T3: Merchant Skill

**文件：** `skills/merchant.py`
**依赖：** T1
**步骤：**
1. 定义 `MerchantSkill(IntentSkill)`，`intent = "merchant"`
2. 从当前 `_build_system_prompt()` 提取 merchant intent 描述（line 46-47）和参数描述（line 67-68）
3. 实现 `param_schema()`：`merchantName` (str)、`merchantId` (str)
4. 实现 `examples()`：默认 fallback（"hello" → merchant with empty params）
5. 实现 `fallback_keywords()`：返回 merchant 相关中英文关键词

**验证：** `python -c "from skills.merchant import merchant_skill; print(merchant_skill.intent, list(merchant_skill.param_schema().keys()))"` 无报错

## T4: Payment Skill

**文件：** `skills/payment.py`
**依赖：** T1
**步骤：**
1. 定义 `PaymentSkill(IntentSkill)`，`intent = "payment"`
2. 从当前 prompt line 48-49 提取 intent 描述（含中文关键词：付款、未付款、逾期、佣金、结算等）
3. 实现 `prompt_params_section()`：month、paymentStatus、paymentCycleFilter、merchantName
4. 实现 `param_schema()`：`month` (str)、`paymentStatus` (str, enum=["unpaid","paid","pending","partial","overdue"])、`paymentCycleFilter` (object)、`merchantName` (str)
5. 实现 `examples()`：至少 "Shokz payment status" → payment
6. 实现 `fallback_keywords()`：付款、未付款、已付款、逾期、佣金等中文关键词

**验证：** `python -c "from skills.payment import payment_skill; print(payment_skill.intent, list(payment_skill.param_schema().keys()))"` 无报错

## T5: Recommendation Skill

**文件：** `skills/recommendation.py`
**依赖：** T1
**步骤：**
1. 定义 `RecommendationSkill(IntentSkill)`，`intent = "recommendation"`
2. 从当前 prompt line 50-51、line 103-105 提取 intent 描述（含中文关键词：推荐、排行、最好等）
3. 实现 `prompt_params_section()`：category、tier、includeTier4、includeBlack、count、metricFilters、metricSort、keywordSearch、tierOfferPlan——从当前 prompt line 69-93 提取
4. 实现 `param_schema()`：4 个简单参数 + 3 个复合参数（metricFilters 为 array[object] with field/enum constraint、metricSort 为 object、tierOfferPlan 为 array[object]）
5. 实现 `examples()`：至少 3 个（"top 5 electronics with aov above 100"、"tier1 推荐6个"、"Tier 2 推荐10个"、"Tier 1 前5个 aov最高的"）
6. 实现 `fallback_keywords()`：推荐、排行、最好、最佳、优先、选品、主推

**验证：** `python -c "from skills.recommendation import recommendation_skill; print(recommendation_skill.intent, list(recommendation_skill.param_schema().keys()))"` 无报错

## T6: Tier Skill

**文件：** `skills/tier.py`
**依赖：** T1
**步骤：**
1. 定义 `TierSkill(IntentSkill)`，`intent = "tier"`
2. 从当前 prompt line 52-53 提取 intent 描述（含中文：第一层/级、Tier 1、黑名单）
3. 实现 `param_schema()`：`tier` (str, enum=["Tier 1","Tier 2","Tier 3","Tier 4","BLACK TIER"])
4. 实现 `examples()`：至少 1 个
5. 实现 `fallback_keywords()`：Tier 相关中英文

**验证：** `python -c "from skills.tier import tier_skill; print(tier_skill.intent, list(tier_skill.param_schema().keys()))"` 无报错

## T7: Category Skill

**文件：** `skills/category.py`
**依赖：** T1
**步骤：**
1. 定义 `CategorySkill(IntentSkill)`，`intent = "category"`
2. 从当前 prompt line 54-55 提取 intent 描述（含中文：美妆、电子、宠物）
3. 实现 `param_schema()`：`category` (str)
4. 实现 `examples()`：至少 1 个
5. 实现 `fallback_keywords()`：品类相关中英文

**验证：** `python -c "from skills.category import category_skill; print(category_skill.intent, list(category_skill.param_schema().keys()))"` 无报错

## T8: 创建 Analysis 文本生成 Skill

**文件：** `skills/analysis_text.py`
**依赖：** T1
**步骤：**
1. 定义 `AnalysisTextSkill(AnalysisSkill)`
2. 实现 `build_system_prompt(language)`：从当前 `_build_analysis_system_prompt()` 迁移，保持相同的 prompt 文本（角色定义、4 步分析结构、语言指令）
3. 实现 `generate(summary, language, timeout)`：调用 `llm_classify._call_llm()` 完成 LLM 调用，`max_tokens=600`，`temperature=0.3`
4. 创建 `analysis_text_skill = AnalysisTextSkill()` 模块实例

**验证：** `python -c "from skills.analysis_text import analysis_text_skill; print('analysis OK', type(analysis_text_skill).__name__)"` 无报错

## T9: 创建 skills 包入口

**文件：** `skills/__init__.py`
**依赖：** T2-T8
**步骤：**
1. import 所有 skill 模块实例（`from skills.asin import asin_skill` 等）
2. import `registry` from `skills.base`
3. 调用 `registry.register()` 注册所有 6 个 IntentSkill（asin、merchant、payment、recommendation、tier、category）
4. 注意：analysis intent skill（如果需要 `analysis` 作为 intent 参与分类）也应在此注册
5. 调用 `registry.register_analysis()` 注册 AnalysisSkill
6. 对外暴露 `registry`、所有 skill 实例

**验证：** `python -c "import skills; print('intents:', skills.registry.list_intents()); print('analysis:', skills.registry.get_analysis())"` 输出 6-7 个 intent 和 analysis skill 实例

## T10: 重构 llm_classify.py

**文件：** `llm_classify.py`
**依赖：** T9
**步骤：**
1. 顶部新增 `from skills import registry`
2. 删除 `VALID_INTENTS` 硬编码，改为 `VALID_INTENTS = frozenset(registry.list_intents())`
3. 重写 `_build_system_prompt(categories)`：
   - 固定前缀部分——角色 + "Output ONLY the JSON object, nothing else"
   - "Intent labels" 段——遍历 `registry.list_all()`，拼接每个 skill 的 `prompt_intent_section()`
   - "Available param fields" 段——遍历每个 skill，拼接 `prompt_params_section()`
   - "Important rules" 段——保留跨 intent 的消歧规则（merchant+category → merchant、metric filter → recommendation、analysis vs recommendation 区分等）
   - "Known product categories"——`categories` 参数拼接（不变）
   - "Example outputs" 段——遍历所有 skills，收集各 skill 的 `examples()`，统一格式化
4. 重写 `_parse_response(text)`：
   - 解析 intent 后，通过 `registry.get(intent)` 获取对应 skill
   - 用 `skill.param_schema()` 中的 `ParamDef` 驱动参数验证：
     - `ParamDef.type == "str"` → 字符串清洗
     - `ParamDef.type == "int"` → 数值截断
     - `ParamDef.type == "bool"` → 布尔转换
     - `ParamDef.enum` → 枚举值约束检查
     - `ParamDef.type == "object"` with `nested_schema` → 嵌套对象验证
     - `ParamDef.type == "array"` with `nested_schema` → 数组遍历验证
5. 删除硬编码常量：`_EXPECTED_PARAM_KEYS`、`_VALID_METRIC_FIELDS`、`_VALID_TIERS`、`_VALID_ANALYSIS_TYPES`
6. 重写 `generate_analysis_text()`：委托给 `registry.get_analysis().generate(summary, language, timeout)`
7. 保留不变：`_provider()`、`_model_name()`、`_api_key()`、`_classify_deepseek()`、`_classify_claude()`、`_call_llm()`、`_default_timeout()`、`classify_intent()` 函数签名

**验证：** `python -c "from llm_classify import classify_intent, _build_system_prompt; prompt = _build_system_prompt(['electronics','beauty']); print('prompt len:', len(prompt))"` 无报错，prompt 长度合理

## T11: 更新 server.py 确保 Skill 注册

**文件：** `server.py`
**依赖：** T10
**步骤：**
1. 在 `from llm_classify import classify_intent, generate_analysis_text` 之前添加 `import skills  # noqa: F401 — trigger skill registration`
2. `api/chat/classify.py` 和 `api/chat/analyze.py` 不需要修改——它们从 `llm_classify` import，而 `llm_classify` 内部 import skills

**验证：** `python -c "import skills; from llm_classify import classify_intent, generate_analysis_text; print('server imports OK')"` 无报错

## T12: 编写 Skill 单元测试

**文件：** `tests/test_skills.py`
**依赖：** T10
**步骤：**
1. 导入 `skills` 包和 `registry`
2. 测试 `test_registry_all_intents_present`：验证 `registry.list_intents()` 包含所有预期 intent
3. 测试 `test_each_skill_has_prompt_section`：遍历每个 skill，验证 `prompt_intent_section()` 返回非空字符串
4. 测试 `test_each_skill_has_param_schema`：遍历每个 skill，验证 `param_schema()` 返回 dict
5. 测试 `test_each_skill_has_examples`：遍历每个 skill，验证 `examples()` 返回非空列表
6. 测试 `test_analysis_skill_registered`：验证 `registry.get_analysis()` 非 None
7. 测试 `test_build_system_prompt_contains_all_intents`：调用 `_build_system_prompt([...])`，验证生成的 prompt 包含所有 intent 名称
8. 测试 `test_parse_response_valid_json`：用合法 JSON 测试 `_parse_response()` 返回正确结果
9. 测试 `test_parse_response_invalid_json`：用非法 JSON/Gibberish 测试 `_parse_response()` 返回 None

**验证：** `python tests/test_skills.py` 所有断言通过

## T13: 运行现有测试确保向后兼容

**依赖：** T11, T12
**步骤：**
1. 编译检查：`python -m py_compile` 检查所有新建和修改的 Python 文件
2. 前端检查：`node --check public/app.js public/chatbot_i18n.js`
3. Auth 测试：`python scripts/test_auth_helpers.py`
4. Intent flow 测试：`node scripts/test_chatbot_intent_flow.mjs`
5. 中文 chatbot 测试：`node scripts/test_zh_chatbot.mjs`
6. 若 CI 配置了其他检查，同步运行

**验证：** 所有现有测试通过，无 regression

## 执行顺序

```
T1 (base.py)
 │
 ├── T2 (asin) ───┐
 ├── T3 (merchant)┤
 ├── T4 (payment) │
 ├── T5 (recommendation) ├─ 可并行
 ├── T6 (tier)    │
 ├── T7 (category)┘
 │
 ├── T8 (analysis_text)
 │
 └── T9 (__init__.py) ← 依赖 T2-T8
        │
        ▼
      T10 (refactor llm_classify.py)
        │
        ▼
      T11 (server.py import)
        │
        ▼
      T12 (unit tests)
        │
        ▼
      T13 (existing tests)
```
