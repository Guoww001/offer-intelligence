# Modular Intent Skills Plan

## 架构概览

将 `llm_classify.py` 的 monolithic prompt 拆分为三层：

```
┌─ skills/ 包 ─────────────────────────────────────┐
│  base.py        IntentSkill 基类 + SkillRegistry  │
│  asin.py        ASIN Intent Skill                 │
│  merchant.py    Merchant Intent Skill             │
│  payment.py     Payment Intent Skill              │
│  recommendation.py  Recommendation Intent Skill   │
│  tier.py        Tier Intent Skill                 │
│  category.py    Category Intent Skill             │
│  analysis_text.py  Analysis 文本生成 Skill         │
│  __init__.py    import 所有 skill → 自动注册       │
└──────────────────────────────────────────────────┘
         │ 注册到 SkillRegistry
         ▼
┌─ llm_classify.py（重构）──────────────────────────┐
│  _build_system_prompt()  遍历 Registry 组装 prompt │
│  _parse_response()       用 Skill schema 验证参数  │
│  classify_intent()       orchestrator 入口         │
│  generate_analysis_text()  委托给 AnalysisSkill    │
│  _call_llm()             provider 抽象（保留）      │
│  _provider() / _api_key()  配置（保留）            │
└──────────────────────────────────────────────────┘
         │ HTTP
         ▼
┌─ api/chat/classify.py ── 不变 ───────────────────┐
┌─ api/chat/analyze.py  ── 不变 ───────────────────┐
┌─ server.py             ── 新增 import skills/ ───┘
```

**数据流（与重构前一致）**：`applyPrompt()` → `POST /api/chat/classify` → `classify_intent()` → LLM → `_parse_response()` → 返回 `{intent, params}`

## 核心数据结构

### `IntentSkill`（抽象基类）

```python
class IntentSkill:
    """一个意图分类 Skill 的自描述定义。"""

    intent: str                          # "payment", "recommendation", ...

    def prompt_intent_section(self) -> str:
        """返回此 intent 在 system prompt 中的 intent 定义段（含描述、关键词、消歧规则）。"""

    def prompt_params_section(self) -> str:
        """返回此 intent 的参数 schema 描述段。"""

    def param_schema(self) -> dict[str, ParamDef]:
        """返回参数名 → ParamDef 的映射，驱动验证逻辑。"""

    def examples(self) -> list[ExamplePair]:
        """返回 few-shot examples（input → output JSON）。"""

    def fallback_keywords(self) -> dict[str, list[str]]:
        """返回供前端 fallback 使用的关键词（可选）。"""
```

### `ParamDef`（参数定义）

```python
@dataclass
class ParamDef:
    type: str              # "str" | "int" | "bool" | "object" | "array"
    required: bool = False
    enum: list[str] | None = None     # 允许的枚举值
    nested_schema: dict | None = None  # array[object] 的内层字段定义
    description: str = ""  # 用于 prompt 中描述此参数
```

### `ExamplePair`

```python
@dataclass
class ExamplePair:
    query: str     # 用户输入
    output: dict   # 期望的 {"intent": "...", "params": {...}}
```

### `SkillRegistry`（单例）

```python
class SkillRegistry:
    _intent_skills: dict[str, IntentSkill]   # intent → skill
    _analysis_skill: AnalysisSkill | None

    def register(self, skill: IntentSkill) -> None
    def get(self, intent: str) -> IntentSkill | None
    def list_all(self) -> list[IntentSkill]
    def list_intents(self) -> list[str]        # 自动派生 VALID_INTENTS
    def register_analysis(self, skill: AnalysisSkill) -> None
    def get_analysis(self) -> AnalysisSkill | None
```

### `AnalysisSkill`（独立于 IntentSkill）

```python
class AnalysisSkill:
    """Analysis 文本生成 Skill——不是 intent，是独立的 LLM 调用。"""

    def build_system_prompt(self, language: str) -> str
    def generate(self, summary: dict, language: str, timeout: float) -> str | None
    # 内部使用共享的 _call_llm() provider 抽象
```

## 模块设计

### 模块 A: `skills/base.py`（新建）

**职责：** 定义 `IntentSkill` 抽象基类、`ParamDef` 数据类、`ExamplePair` 数据类、`SkillRegistry` 单例。

**对外接口：**
- `IntentSkill` — 所有 intent skill 的基类
- `ParamDef(type, required, enum, nested_schema, description)` — 参数定义
- `ExamplePair(query, output)` — few-shot 示例
- `SkillRegistry()` — 全局单例，`register()` / `get()` / `list_all()` / `list_intents()`
- `registry` — 模块级全局实例

**依赖：** 无第三方依赖。仅使用 `dataclasses`、`abc` 标准库。

### 模块 B: `skills/asin.py`、`merchant.py`、`payment.py`、`recommendation.py`、`tier.py`、`category.py`（新建，6 个文件）

**职责：** 每个文件定义一个 `IntentSkill` 子类，覆盖基类的所有抽象方法。从当前 `_build_system_prompt()` 和 `_parse_response()` 中提取对应 intent 的逻辑。

**对外接口：** 每个文件暴露一个模块级实例（如 `asin_skill = AsinSkill()`），`skills/__init__.py` import 时自动注册到 Registry。

**依赖：** `skills/base.py`

### 模块 C: `skills/analysis_text.py`（新建）

**职责：** 定义 `AnalysisSkill` 类，封装 analysis 文本生成的 system prompt 构建和 LLM 调用。使用共享的 `_call_llm()` 基础设施。

**对外接口：** `analysis_skill = AnalysisSkill()` 模块级实例

**依赖：** 共享 provider 配置（从 `llm_classify` 导入 `_call_llm`、`_provider`、`_api_key`）

### 模块 D: `skills/__init__.py`（新建）

**职责：** import 所有 skill 模块，触发自动注册。对外暴露 `registry` 和所有 skill 实例。

### 模块 E: `llm_classify.py`（重构）

**职责：** Orchestrator + Provider 抽象 + 公共入口。

**保留不变：**
- `_provider()` / `_model_name()` / `_api_key()` / `DEFAULT_PROVIDER`
- `_classify_deepseek()` / `_classify_claude()`
- `_call_llm()` — 保留为内部函数供 `AnalysisSkill` 通过 import 调用
- `_default_timeout()`
- `classify_intent()` — 签名兼容
- `generate_analysis_text()` — 签名兼容，内部委托给 `AnalysisSkill`

**重构变更：**
- `_build_system_prompt()` — 改为遍历 `registry.list_all()` 组装
- `_parse_response()` — 根据 intent 查找 skill，用 `skill.param_schema()` 验证
- `VALID_INTENTS` — 删除硬编码，改为 `registry.list_intents()` 动态派生
- `_EXPECTED_PARAM_KEYS` / `_VALID_METRIC_FIELDS` / `_VALID_TIERS` / `_VALID_ANALYSIS_TYPES` — 删除，验证逻辑从 schema 派生

### 模块 F: `api/chat/classify.py` + `api/chat/analyze.py` + `server.py`（微小修改）

**变更：** 仅确保 import 路径正确（`server.py` 顶部 `import skills` 确保 skill 注册触发）。

## 文件组织

```
project/
├── skills/
│   ├── __init__.py           ← 新建  import 所有 skill 触发注册
│   ├── base.py               ← 新建  IntentSkill, ParamDef, ExamplePair, SkillRegistry
│   ├── asin.py               ← 新建  ASIN intent skill
│   ├── merchant.py           ← 新建  Merchant intent skill
│   ├── payment.py            ← 新建  Payment intent skill
│   ├── recommendation.py     ← 新建  Recommendation intent skill
│   ├── tier.py               ← 新建  Tier intent skill
│   ├── category.py           ← 新建  Category intent skill
│   └── analysis_text.py      ← 新建  Analysis 文本生成 skill
├── llm_classify.py           ← 重构  orchestrator + provider + 公共入口
├── api/chat/
│   ├── classify.py           ← 不变（或微调 import）
│   └── analyze.py            ← 不变（或微调 import）
├── server.py                 ← 微调  顶部 `import skills`
├── scripts/
│   └── test_chatbot_intent_flow.mjs  ← 不变
├── tests/
│   └── test_skills.py        ← 新建  skill 单元测试
└── specs/
    └── 003-modular-intent-skills/
        ├── spec.md            ← ✓
        └── plan.md            ← (当前)
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Skill 定义方式 | Python 类（`IntentSkill` 抽象基类） | 类型安全，IDE 支持好，符合项目现有 Python 代码风格。JSON/YAML 配置增加解析层且无类型检查 |
| 注册机制 | import 时自动注册（模块级实例） | 零配置，新增 skill 只需创建文件 + 在 `__init__.py` 加一行 import。无需显式注册表 |
| Registry 位置 | `skills/base.py` 模块级单例 | 全局唯一访问点，`llm_classify.py` 和 tests 都可以 import |
| 参数验证方式 | Schema 驱动——`ParamDef` 列表驱动 `_parse_response()` 中的类型检查 | 单一真相源，修改 skill 的 param_schema 自动更新验证 |
| Analysis 定位 | 独立 `AnalysisSkill` 类，与 `IntentSkill` 平级但不参与 intent 分类 | Analysis 是独立 LLM 调用（不同 temperature、不同 prompt 结构），但共享 provider 抽象 |
| Provider 抽象 | 保留在 `llm_classify.py`，`_call_llm()` 改为可被 AnalysisSkill 调用的公共函数 | 不引入新的 provider 层，保持现有的 DeepSeek/Claude 互斥逻辑 |
| 向后兼容 | `classify_intent()` 和 `generate_analysis_text()` 签名和行为不变 | API contract 不变，前端零改动 |
| Skill 文件粒度 | 每个 intent 一个文件 | 隔离性最大化，方便独立测试和 review |
