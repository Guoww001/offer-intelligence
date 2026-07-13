# Chatbot 数据分析 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `llm_classify.py` | 新增 analysis 意图 + analysisType/analysisTarget 参数 + generate_analysis_text() |
| 新建 | `api/chat/analyze.py` | Vercel serverless handler for `/api/chat/analyze` |
| 修改 | `server.py` | 新增本地 `/api/chat/analyze` 路由 |
| 修改 | `public/app.js` | 新增分析引擎（计算+渲染+路由）约 400-500 行 |

## T1: llm_classify.py — 扩展 VALID_INTENTS 和参数校验

**文件：** `llm_classify.py`
**依赖：** 无

**步骤：**
1. 在 `VALID_INTENTS`（第 9 行）中添加 `"analysis"`
2. 在 `_EXPECTED_PARAM_KEYS`（第 127-143 行）末尾添加 `"analysisType"`、`"analysisTarget"`
3. 在 `_VALID_TIERS`（第 150 行）下方新增 `_VALID_ANALYSIS_TYPES = frozenset({"merchant", "category", "tier"})`
4. 在 `_parse_response()` 末尾（第 242 行 `elif` 链之后）新增 `analysisType` 和 `analysisTarget` 的解析逻辑：
   - `analysisType`：校验值在 `_VALID_ANALYSIS_TYPES` 中
   - `analysisTarget`：trim 后作为字符串

**验证：** `python -c "from llm_classify import classify_intent; print('import ok')"` 无报错

## T2: llm_classify.py — 更新 system prompt

**文件：** `llm_classify.py`
**依赖：** T1

**步骤：**
1. 在 `_build_system_prompt()` 的 Intent labels 部分，新增 `analysis` 意图描述：
   ```
   - analysis: The query asks to analyze, evaluate, diagnose, or assess the performance of a merchant,
     category, or tier. In Chinese this includes 分析、评估、诊断、怎么样、表现、趋势、健康度、状态.
   ```
2. 在 Available param fields 部分，新增 `analysisType` 和 `analysisTarget` 的描述
3. 在 Important rules 部分，新增分析意图的路由规则
4. 在 Example outputs 部分，新增 2-3 条 analysis 示例（中英文各一条）

**验证：** `python -c "from llm_classify import classify_intent; print('prompt ready')"` 无报错

## T3: llm_classify.py — 新增 generate_analysis_text()

**文件：** `llm_classify.py`
**依赖：** T1, T2

**步骤：**
1. 新增 `_build_analysis_system_prompt(language: str) -> str`——构建分析系统提示词，要求 LLM：
   - 角色：Amazon 联盟营销数据分析师
   - 基于提供的统计摘要生成简洁的分析叙述
   - 包含：整体评价、亮点、问题、可行建议
   - 语言根据参数切换（zh/en）
   - 控制长度在 200-400 字
2. 新增 `generate_analysis_text(summary: dict, language: str = "en", timeout: float | None = None) -> str | None`：
   - 调用 `_provider()` 和 `_api_key()` 获取配置
   - 用 `json.dumps(summary)` 作为 user message
   - 超时默认 15 秒
   - 复用现有 `_classify_deepseek()` / `_classify_claude()` 调用模式
   - 返回 LLM 文本或 None（失败时）

**验证：** `python -c "from llm_classify import generate_analysis_text; print('function exists')"` 无报错

## T4: 新建 api/chat/analyze.py

**文件：** `api/chat/analyze.py`（新建）
**依赖：** T3

**步骤：**
1. 创建文件，导入 `BaseHTTPRequestHandler`
2. 从 `auth` 导入 `_read_json_body`、`require_auth`、`send_json`
3. 从 `llm_classify` 导入 `generate_analysis_text`
4. 实现 `class handler(BaseHTTPRequestHandler)`：
   - `do_OPTIONS`：返回 204
   - `do_POST`：
     - `require_auth(self)` 检查
     - 校验 Content-Length ≤ 8192（8KB）
     - 解析 JSON body
     - 校验 `summary` 字段存在且为 dict
     - 提取 `language` 字段（默认 "en"）
     - 调用 `generate_analysis_text(summary, language)`
     - 成功返回 `{"ok": true, "text": "..."}`
     - 失败返回 `{"ok": false, "error": "..."}`

**验证：** `python -m py_compile api/chat/analyze.py` 无报错

## T5: server.py — 新增本地路由

**文件：** `server.py`
**依赖：** T4

**步骤：**
1. 找到现有 `/api/chat/classify` 路由注册位置（约第 837 行 `handle_llm_classify` 附近）
2. 在该路由下方新增 `/api/chat/analyze` 的条件分支，调用 `self.handle_llm_analyze()`
3. 新增 `handle_llm_analyze()` 方法，逻辑与 `api/chat/analyze.py` 的 handler 一致
4. 若未导入 `generate_analysis_text`，在文件顶部 import 中添加

**验证：** `python -m py_compile server.py` 无报错

## T6: app.js — 新增分析工具函数

**文件：** `public/app.js`
**依赖：** 无（前端独立）

**步骤：**
1. 在 `collectCategories()` 函数之后（约第 3053 行之后），新增以下工具函数：
   - `percentileRank(value, values)`——返回 0-100 的百分位
   - `segmentedStats(offers, field)`——按 field 值排序，分成 head(前20%)、mid(中60%)、tail(后20%)
   - `metricLabel(field)`——返回指标的中英文显示名
   - `deltaText(selfVal, otherVal, language)`——返回如 "+30.6%" 或 "-12.3%" 的格式化文本

**验证：** 在浏览器 console 手动调用 `percentileRank(50, [10,20,30,40,50,60,70,80,90,100])` 返回约 45

## T7: app.js — 新增 analyzeMerchant()

**文件：** `public/app.js`
**依赖：** T6

**步骤：**
1. 新增 `analyzeMerchant(name)` 函数：
   - 从 `offers` 中按名称/ID 查找目标商户
   - 提取核心指标 → 计算在品类内和 Tier 内的百分位
   - 计算 vsCategory/vsTier/vsGlobal 对比
   - 识别 strengths（百分位 > 70）和 weaknesses（百分位 < 30）
   - 获取支付风险信息
   - 找 3 个同品类+同 Tier 的同行作为 peers
   - 返回 AnalysisResult 对象
   - 找不到商户返回 null

**验证：** 在浏览器 console 调用 `analyzeMerchant("Shokz")`（或数据中存在的商户名），检查返回对象结构是否完整

## T8: app.js — 新增 analyzeCategory() 和 analyzeTier()

**文件：** `public/app.js`
**依赖：** T6, T7

**步骤：**
1. 新增 `analyzeCategory(name)`：
   - 过滤 `offers` 中 `mainCategory === name` 的商户
   - 计算聚合统计（count, totalRevenue, avgEpc, avgCvr, avgOrders, avgCommissionRate）
   - 计算 vsGlobal 对比
   - 按 key metric 排名取 top 5 和 bottom 3
   - 返回 AnalysisResult 对象
   - 品类不存在返回 null
2. 新增 `analyzeTier(name)`：
   - 过滤 `offers` 中 `tier === name` 的商户
   - 计算聚合统计
   - 对其他每个 Tier 计算对比
   - 用 `segmentedStats()` 计算三段分化
   - 识别异常值
   - 返回 AnalysisResult 对象
   - Tier 不存在返回 null

**验证：** 在浏览器 console 分别调用 `analyzeCategory("Electronics")` 和 `analyzeTier("Tier 2")`，检查返回对象结构和数据合理性

## T9: app.js — 新增 renderAnalysisTable()

**文件：** `public/app.js`
**依赖：** T7, T8

**步骤：**
1. 新增 `renderAnalysisTable(summary)`——根据 `summary.type` 分发到三个渲染子函数：
   - `renderMerchantAnalysisTable(s)`：核心指标表 + 横向对比表 + 强弱项标签 + 同行对比表
   - `renderCategoryAnalysisTable(s)`：聚合统计表 + vsGlobal 对比 + Top/Bottom 排名表
   - `renderTierAnalysisTable(s)`：聚合统计表 + 跨 Tier 对比表 + 三段分化表 + 异常值列表
2. 复用现有表格 HTML 生成模式（`resultTable` 或 `fieldRows` 风格）
3. 表格采用与现有推荐表格一致的 class 样式

**验证：** 用模拟 summary 对象调用 `renderAnalysisTable()`，检查返回的 HTML 字符串结构

## T10: app.js — 新增 LLM 调用和降级函数

**文件：** `public/app.js`
**依赖：** T5（API 端点就绪）

**步骤：**
1. 新增 `fetchAnalysisText(summary, language)`——`POST /api/chat/analyze`，timeout 15s，返回 text 或 null
2. 新增 `renderAnalysisNarrative(containerEl, text)`——在容器中追加文字段落的 DOM 元素
3. 新增 `fallbackAnalysisText(summary, language)`——基于数据特征的模板判断：
   - 商户：百分位 > 70 → 亮点；< 30 → 关注点
   - 品类：高于/低于全站均值的文字描述
   - Tier：与相邻 Tier 的差距描述
   - 生成为 HTML 段落文本

**验证：** 用模拟的 summary 对象调用 `fallbackAnalysisText()`，检查是否返回非空 HTML 字符串

## T11: app.js — 新增 analysisAnswer() 和路由分支

**文件：** `public/app.js`
**依赖：** T7, T8, T9, T10

**步骤：**
1. 新增 `analysisAnswer(prompt, params)` 函数：
   - 从 params 中取 `analysisType` 和 `analysisTarget`
   - 如果 `analysisType` 未指定，尝试从 prompt 中推断
   - 根据 type 调用对应的 analyze 函数
   - 如果分析对象不存在，返回友好的"未找到"消息
   - 调用 `renderAnalysisTable(summary)` 渲染表格
   - 异步调用 `fetchAnalysisText(summary, language)`，成功则追加文字，失败则追加降级文字
   - 设置 context
   - 返回表格 HTML（LLM 文字通过异步追加到消息 DOM）

**验证：** 完整流程——在聊天中发送"分析 Shokz"，检查是否渲染表格

## T12: app.js — answerPrompt() 和 detectQueryIntent() 修改

**文件：** `public/app.js`
**依赖：** T11

**步骤：**
1. 在 `detectQueryIntent()` 的正则 fallback 部分（约第 3108 行 recommendation 检测之后），新增 analysis 关键词检测：
   ```
   if (/分析|评估|诊断|怎么样|表现如何|趋势|健康度/.test(userMessage)) return "analysis";
   ```
2. 在 `answerPrompt()` 中（第 4619 行 keyword search 判断之前），新增 analysis 路由分支：
   ```
   if (intent === "analysis") {
     return analysisAnswer(prompt, p);
   }
   ```

**验证：** `node --check public/app.js` 无语法错误

## T13: 回归验证

**依赖：** T12

**步骤：**
1. 运行 `node --check public/app.js`
2. 运行 `node --check public/auth.js`
3. 运行 `node --check public/chatbot_i18n.js`
4. 运行 `python -m py_compile llm_classify.py api/chat/analyze.py api/chat/classify.py server.py`
5. 运行 `node scripts/test_chatbot_intent_flow.mjs`
6. 运行 `node scripts/test_zh_chatbot.mjs`

**验证：** 全部通过，无回归错误

## 执行顺序

```
T1 → T2 → T3 → T4 → T5
                    ↓
T6 → T7 → T8 → T9 → T10 → T11 → T12
                                    ↓
                                  T13
```

T1-T5 和后端相关，T6-T12 是前端。前端工具函数（T6）是后续所有前端任务的基础。
