# Agent 日志问题修复计划

> 执行方式：按已确认根因补失败回归，再实施修复；独立模块并行处理，查询入口统一集成。

**目标：** 修复中文品类查询、品类月度数据、商户名单与同名选择、明确月份和环比输出，并补齐原生链 Trace。

**架构：** 前端负责实体解析和结果展示，数据库月度聚合放在共享 Python 模块，经已有 DB 函数路由提供；不逐商户发起数百次请求。趋势参数扩展起止月份，原始指标和派生指标分开计算；按月明细在证明校验后直接生成事实表，普通分析保留模型综合。

## 全局约束

- 仅修改本次问题相关代码；不提交、推送、创建 PR、合并或部署。
- 所有新增说明、注释和测试名称使用中文；不写入真实问题、回答、凭据或完整工具载荷。
- 真实缺失不补零，零基期不生成百分比，跨缺月不计算环比；未结束月份明确标注。
- 中文名称映射回真实品类，不创造数据库分类；同名商户要求编号，不能任意选第一条。
- 新接口复用会话权限和已有 Vercel DB 入口；查询参数校验、SQL 参数化，保持只读。
- 原生 Trace 异步且失败不影响回答，不重复登记提问；保留原 questionEventId。
- 本地测试与线上验收分别记录；完成后关闭本次服务器和浏览器。

## 任务一：数据库品类月度查询与趋势参数

文件：`agent_category_monthly.py`、`agent_tool_registry.py`、`server.py`、`api/db/index.py`、`vercel.json`、相关 Python 回归。

- [x] 增加失败回归：真实品类筛选、成员去重、按月汇总、加权 CVR、官方点击保留、NULL/零、历史月份及非法区间。
- [x] 提供 `category_monthly_payload(query)`，返回 `ok/checkedAt/categories/merchantCount/monthly`；每月包含 `month/revenue/orders/clicks/affiliatePayout/payout`，缺失字段保持空。
- [x] 接口 `/api/ui/db/category-monthly` 复用 dashboard 会话权限；`category` 支持重复参数构成品类并集，`startMonth/endMonth` 为 YYYY-MM，最多连续 24 月。
- [x] 从数据库真实品类及商户映射解析成员，使用批量月度查询，避免逐商户接口调用和重复累加。
- [x] `trend` 参数增加成对的 `startMonth/endMonth`，校验格式、顺序及 24 月上限；旧 `months` 调用兼容。
- [x] 明确品类月度及指定年月规划规则，综合使用已计算环比而非临时推算。

任务一记录（2026-10-26，本地）：

- 新增 `scripts/test_agent_category_monthly.py`：初次运行 8 条预期失败（缺少批量模块、合同拒绝区间）；新增规划规则、比例覆盖和未分类回退回归先失败再修复；最终 15 条通过，包括 872 个合成成员仍只执行 1 次成员查询和 3 次批量指标查询（另有固定次数列发现）。
- 品类主分类采用 `sheetCategory → mainCategory → Uncategorized`，其中 `Uncategorized` 占位视为缺失，回退真实主分类，与本次前端解析保持一致；相似名称不做包含匹配。重复品类取并集，成员按编号去重；先合并每商户每月来源，再累加群体指标。CVR/EPC/AOV 等比例要求所有参与商户月的分子分母齐备，再使用总量比值；任一输入缺失则对应比例为空，防止不同覆盖集合拼出错误比率。
- 明确区间的 `/api/ui/db/merchant` 复用相同查询路径，旧商户请求不变；两类接口均额外返回独立 `previousMonth` 作为环比基期，`monthly` 只含请求月份，对外区间仍不超过 24 月。
- 通过：`python -X utf8 scripts/test_agent_category_monthly.py`（15）、`scripts/test_agent_tool_registry.py`（15）、`scripts/test_agent_http.py`（11）、`scripts/test_agent_planning_contract.py`（3）、`scripts/test_agent_synthesis_contract.py`（8）、`scripts/test_merchant_monthly_metrics.py`（5）、`scripts/test_agent_result_reuse.py`（12）、`scripts/test_vercel_db_wsgi.py`、`scripts/test_vercel_function_budget.py`（7/12），以上后续命令同样使用 `python -X utf8`。
- 额外旧回归 `python -X utf8 -m unittest discover -s scripts -p test_db_monthly_trend.py` 为 4 通过、1 错误：Tier Summary 旧夹具未替代 `merchant_registry.report_snapshot`，占位 `object` 无 `cursor`；该测试及 `offer_db.py` 无本次修改，未扩大范围修复。
- 本项证据为合成数据、合同和两套路由调用回归；未运行真实数据库或 Provider 验收，未启动本地服务，未提交、推送或部署。

## 任务二：中文品类与月度计算纯函数

文件：新增 `frontend/src/features/agent/agentCategoryModel.ts`、`agentMonthlyMetrics.ts` 及对应测试。

- [x] 增加失败回归：家居、家具、厨具、家装与英文名称；多个品类去重，避免组合分类的包含匹配扩大范围。
- [x] `resolveAgentCategories(input, offers): string[]` 只返回真实数据中的主分类；中文字段只用于对应主类的翻译，重复译名通过受控别名消歧；家具不由子类扩大为整个家居主类，不改变全站分类分组。
- [x] `deriveAgentMonthlyMetrics(rows)` 接收月份及 metrics 对象，保留源字段，追加 `revenueMoM/clicksMoM/ordersDelta`；百分比使用小数比例，首月、跨缺月、缺失和零基期均返回 null。
- [x] 月份解析与区间选择使用纯函数；按当前问题和明确历史上下文承接指标及时间，不承接用户已明确更换的实体。

## 任务三：原生链 Trace

文件：`CopilotKitAgentRuntime.vue`、新增原生 Trace 辅助模块及测试，必要的组件回归。

- [x] 增加失败回归：原生成功、规划失败、工具失败、停止、写入失败、直接备用执行不重复写入。
- [x] 原生运行在已有 questionEventId 下记录 start、阶段摘要及 complete，状态、耗时、执行与失败计数准确。
- [x] 写入不阻塞、不抛回用户流程，不含问题、回答、参数、结果或堆栈；缺少用量保持未知。

## 任务四：查询和展示集成

文件：`agentSession.ts`、`agentResult.ts`、`AgentTrendResult.vue`、相关组件及 session 回归。

- [x] 在纯函数与接口确定后先补集成失败回归。
- [x] 品类工具接入中文解析；同名提示显示商户名称、编号及 Tier；Top 商户投影为实际可见名单。
- [x] 品类趋势调用一次批量接口，不使用无月份快照冒充月度历史；多个品类按并集汇总。
- [x] 商户趋势明确区间时读取足够历史并裁剪区间，所选区间保留前一月作为环比基准，但不在表格增加未请求月份。
- [x] 月度表稳定提供月份、GMV、GMV 环比、点击、点击环比、订单、订单新增、转化率；允许缺失显示未提供。
- [x] 派生指标纳入前后端结果白名单，停止/继续、证明绑定、复用范围及费用预算保持兼容。

## 验证与交付

- [x] 相关 Python、前端 session/组件回归通过；全量前端测试、类型检查、两套构建及现有契约检查通过。
- [x] 使用 10 月 26 日对应输入做受控复现，记录真实 Provider/数据库与固定样例各自证据。
- [x] 更新 Chatbot 档案与本计划的完成记录，说明未执行的验收项。
- [x] 核对工作区差异，保护缓存不纳入修复，关闭本次测试服务。

## 最终实施与验收记录（2026-10-27）

### 实现与边界

- 分支 `codex/agent-log-remediation-1026`，实施基线 `56a2d64`；用户已授权通过此分支创建目标为上游 `main` 的 PR，提交范围为本次修复、回归及文档，不包含保护缓存；未合并或部署。
- 中文元数据只有在与实际主分类对应时才参与映射；重复译名按受控别名消歧，未知组合拒绝部分成功。家具仅匹配对应真实主分类，不因为某个家具子类而扩大到整个家居类。
- 品类 Top 商户投影为可见名称、编号、所属品类及指标；同名候选包含名称、编号和 Tier，保留用户选择，不任取一条。
- 品类批量查询及明确区间商户查询均返回独立前月基期；先合并商户月来源、再汇总群体，不重复累计。月份不足和指标缺失分别处理；全空月份不算实际覆盖，未结束月份单独说明。
- `deriveAgentMonthlyMetrics` 保留首月真实基期，派生值在结构化结果、复用和展示合同中统一；缺月不跨越、零基期不生成百分比。已计算的空派生值可以复用，未计算字段不能假装覆盖。
- 实际页面发现模型可能重算缺失转化率、丢掉首月已有环比或沿用旧品类。新增 `agent_monthly_answer.py`，本地 SSE、Vercel SSE 与 AG-UI 均在规划证明及结果结构校验之后直接生成这类月度事实表，普通解释仍走原综合；当前明确的品类并集在签名前规范，品类比较保持独立目标。表格不推断缺失站点或币种。
- Trace 同时修复备用链缺失 `action`、start 不接受 `status=running` 两处协议问题，并补齐原生异步记录；不落原问题、回答、完整参数或结果，未知用量保持 NULL，写入失败不影响回答。已规划后的回退只整理已有结果，不重启第二条查询链。

### 自动化证据

- 初始六项集成回归全部失败，随后逐项修复；后续针对品类范围、明确月份、派生图表、原生回退和月度事实输出补充了先失败后通过的回归。
- 最终前端：`npm --prefix frontend run test -- --run`，126 个文件、857 项测试通过；`typecheck` 和两套生产构建通过。
- Python：品类及区间查询 15 项、月度事实表及签名前范围 5 项、复用 15 项、期间比较 19 项、registry 15 项、规划合同 3 项、综合合同 8 项、AG-UI 16 项、Trace 5 项、Trace HTTP 3 项，以及 HTTP、原签名合同、规划截断、商户月度来源、提问与反馈 HTTP 回归通过。
- CopilotKit Node runtime 6 项、WSGI 路由、Vercel 函数预算（7/12）、前端迁移/构建/Shell/M6/M7、`public/auth.js` 语法及 `git diff --check` 通过。新增后端回归已接入 CI。
- 旧 `test_db_monthly_trend.py` 的既有 Tier Summary 夹具错误仍按任务一记录保留，没有把它记为通过。

### 真实数据与 BrowserAct

- 直接只读数据库和本地 HTTP 均验证了品类 7—9 月批量查询、商户明确区间查询以及独立 6 月基期；没有使用逐商户数百次接口调用。
- 本地启动时现有商户档案快照刷新阻塞，页面验收进程改为仅从已有真实 Offer/关键词快照启动；月度接口仍读取真实数据库，规划使用真实 Provider。此设置仅限本次验收进程，未修改生产启动逻辑或快照文件。
- BrowserAct 验证 Furniture & Home 仅显示真实对应分类及 5 家商户名称、编号，不再混入整个 Home & Kitchen；SIHOO 明确显示三个候选的不同编号和 Tier。
- 最终页面验证家居、厨具、家装只汇总 Home & Kitchen、Kitchen & Dining、Tools & Home Improvement 三个分类；7—9 月八列表格与直接生成的回答一致，7 月环比使用已有 6 月基期，覆盖不齐的转化率显示未提供，没有被模型重算。
- 页面实际走 Python 本地服务器的现代备用链；原生 Node 浏览器及线上部署验收尚未执行。原生组件、Trace 合同与 AG-UI 有自动化覆盖，不将其表述为原生浏览器通过；没有提交真实附件或反馈。
- 本地关闭提问日志及 Trace 数据库写入；未将验收问题登记到业务日志。已关闭 BrowserAct 会话 `oi-agent-fix-1027` 和最终服务器 PID `28728`，复核 8765 无监听；`protected_data/` 无修改，测试临时文件已清理。
