# 对话 Agent 用户体验修复计划

> 状态：已按本方案实施本地修复，自动化与本地备用链浏览器验收结果见第 9 节。原生 Node 环境浏览器验收和线上部署验收仍待完成。

**目标：** 让 Agent 能接着已有结果工作，清楚说明查询是否完成，并让用户先读到结论、再按需查看证据。

**架构：** 在当前 Vue Agent 与 modern session / CopilotKit 两条执行路径上增加共享的会话内结果复用能力，沿用 Python 的工具绑定和综合入口。将结果是否可回答、恢复动作、展示格式分别建模；保留真实数据口径和现有调用限制。

**技术栈：** Vue 3、TypeScript、Python、现有 AG-UI / CopilotKit、Vitest 与 Python 契约测试。

## 1. 范围与约束

- 本次文档基于 2026-10-14 线上八轮体验；本地代码检查基线为 `main` 的 `e9bff71`。线上实际部署提交和浏览器加载的构建版本尚未核实。
- 完整文件路径相对 `D:/Code/offer-intelligence-main`。后文无目录的前端文件名指 `frontend/src/features/agent/` 下对应文件，`results/` 指该目录下的结果组件；共享契约使用 `frontend/src/shared/contracts/agentResult.ts`。不恢复 `public/app.js` 或旧运行时。
- 保留最多两轮规划、最多六次工具调用、每批四次工具调用；保留现有规划总时限与输出额度配置。
- 结果复用限于当前会话内存，不将原始工具载荷、完整提问、回答或执行凭据加入持久化 Agent Memory。
- 新对话、登出清除复用数据；请求开始和普通失败不能提前清空仍可查看的上一轮结果。
- 零值与缺失值分开；CVR 使用订单/点击，联盟 EPC 使用联盟佣金/点击；多商户比较使用共同完整月份。
- 用户明确要求更新、改变数据范围或引用未覆盖指标时不静默复用；用户明确不要重查时，也不静默发起数据查询。
- 不增加模型供应商、依赖、数据库表或通用缓存平台。
- 本地实施、Git 发布和部署分别记录状态；下列实施复选框表示代码及相应回归通过，不能代表已上线。浏览器证据按实际执行入口单列。

## 2. 体验证据与验收目标

| 编号 | 线上观察 | 用户影响 | 修复目标 |
| --- | --- | --- | --- |
| UX-01 | 三家查询完成后，要求整理成一张表，又追加三张趋势图，结果索引从三条增加为六条。 | 简单追问也重复等待、重复浏览。 | 对象、期间和指标未变时复用原结果，只增加本次要求的表格或结论。 |
| UX-02 | 三家的工具已完成，在综合阶段停止后，要求继续使用已有结果，得到无可验证来源提示；原图表在下一次提交后消失。 | 用户看到的数据不能继续使用，停止造成工作丢失。 | 停止结束当前运行但保留已完成结果；提供继续整理入口。 |
| UX-03 | 上述继续操作没有回答问题，页面仍显示查询完成，执行摘要打勾。 | 用户不能判断是否需要恢复或重试。 | 无可回答结果与有效回答明确区分，状态、时间线和日志保持一致。 |
| UX-04 | 不存在的商户被提示为月度数据不足。 | 用户被引导修改时间，而实际可能是名称未匹配。 | 未匹配对象、数据期间不足、服务不可用分别说明并提供对应操作。 |
| UX-05 | 三家分析正文约 1,885 字、高约 1,268 像素；会话区域高约 583 像素。回答和图表追加后自动滚到末尾。 | 用户需要回滚寻找新回答结论。 | 默认结论、对比表、最多三条发现；结束时定位结论而非最后一张图。 |
| UX-06 | 单商户回答先强调包含未结束月份的 4239.60% 增长，再提醒不能据此判断趋势。 | 数字吸引注意，但结论口径互相牵制。 | 完整月份用于趋势判断，未结束月份独立展示；覆盖月份数与完整月份数分开。 |
| UX-07 | CVR 有时显示为小数，有时显示百分比；金额出现三位小数；排序卡同时出现 EPC 降序和未按表现排序。 | 数字需要人工换算，筛选口径难确认。 | 数字格式统一，排序说明只反映实际应用条件。 |
| UX-08 | 恢复上下文为 Shokz，商户示例预填 Tapo；上下文出现 conversionRate 等字段名，推广上传区域常驻输入区。 | 对象不明确、信息噪声较多。 | 上下文使用业务名称；示例和输入区优先服务当前查询。 |

已验证可保留的行为：真实查询可完成；完整月份追问正确选取八月、九月；跨商户回答说明共同期间；筛选零匹配时没有擅自放宽条件；停止及时生效，停止当时已有图表仍可见。

本次仅体验桌面端，不将这些结论扩展为移动端或输入法组合态的验收结果。

## 3. 代码定位与证据边界

| 位置 | 当前代码事实 | 方案影响 |
| --- | --- | --- |
| `frontend/src/features/agent/agentSession.ts` | `allExecutions` 在单次 submit 内；下一次 submit 重置 resultViews；`commitStopped()` 不将本轮加入成功历史。 | 增加独立于成功历史的会话内结果集，不通过把停止轮写入成功历史来实现复用。 |
| `frontend/src/features/agent/CopilotKitAgentHost.vue` | `beginRun()` 每次创建本轮结果数组；综合失败仅有 ASIN 专用保留逻辑，其余调用 fallbackRun。 | 两条执行路径共享结果集；综合失败不能因此重启整轮查询。 |
| `frontend/src/features/agent/AgentPage.vue` | `scrollLatest()` 滚到 scrollHeight；正文、图表、状态改变都会触发跟随。 | 区分运行中跟随、结束后结论定位、用户主动查看历史。 |
| `frontend/src/features/agent/agentKeywordSearch.ts` | 排序实际优先使用 metricSort，但说明文案仍按 mode 选择，search 模式会写未按表现排序。 | 用实际排序和符合数量生成单一说明，不重新实现排序算法。 |
| `frontend/src/features/agent/agentModel.ts` | `agentMemoryDisplayText()` 直接拼接 query.metrics；日期只选取 startMonth 或 endMonth。 | 保持记忆中的规范字段，展示时映射业务标签并显示完整范围。 |
| `agent_contract.py` | planProof 绑定原问题、原 agentRunId、调用参数和有效期；综合验证按当前问题校验。 | 不能直接将旧 proof 与新问题组合提交；需要明确的复用契约。 |
| `agent_trend_comparison.py` | 已区分 availablePeriodMetrics、commonCompleteMetrics、commonCompleteTrends。 | 沿用现有共同期间计算，不另造平均比率或重新让模型计算汇总。 |

**需要先确认的部分：** 当前本地 `commitPlanningFailure()` 已返回 error，并记录 failed；`toolFailureMessage()` 也已区分 merchant 与 months。线上仍观察到状态和原因不准确，不能直接断言这些保护没有实现。实施前先核对部署版本、实际执行入口以及安全的错误码/阶段信息，判断是旧构建、分支遗漏还是错误在中间层被改写。

## 4. 任务一：会话内结果复用与停止后继续（P1）

**涉及文件：**

- 新增 `frontend/src/features/agent/agentResultReuse.ts`、`agentResultReuse.test.ts`。
- 修改 `frontend/src/features/agent/agentSession.ts`、`CopilotKitAgentHost.vue`、`CopilotKitAgentRuntime.vue`、`AgentPage.vue`、`frontend/src/entry.ts`。
- 修改 `agent_contract.py`、`agent_agui.py`、`server.py`、`api/chat/stream.py`，沿用既有综合入口并覆盖本地和 Vercel 两种入口。
- 回归 `agentQuestionLogging.test.ts`、`CopilotKitAgentRuntime.test.ts`、`scripts/test_agent_synthesis_contract.py`；新增 `scripts/test_agent_result_reuse.py`。

**接口和数据生命周期：**

```ts
export interface AgentReusableResultSet {
  readonly sourceQuestion: string;
  readonly sourceQuestionEventId: string;
  readonly agentRunId: string;
  readonly planProofs: readonly string[];
  readonly toolResults: readonly AgentToolExecutionResponse["toolResult"][];
  readonly resultViews: readonly AgentResultView[];
  readonly stopped: boolean;
}

export interface AgentResultReuseStore {
  get(): AgentReusableResultSet | null;
  retain(result: AgentReusableResultSet): void;
  clear(): void;
}
```

上述类型计划放在 `agentResultReuse.ts`，导入既有工具投影和视图类型。每个 Agent 会话创建一个 store，native 与 fallback 共用；最多保留最近一个包含已完成调用的结果集，沿用六次调用和现有结果大小限制。

- 只保留成功完成且具有原调用绑定的工具结果；失败调用不能覆盖成功数据。停止或综合失败时保留已有成功部分并标为部分完成。
- 同一结果集的数据截至时间保持原值；重新整理不伪装成重新查库。
- 改格式、解释、同范围对比以及停止后继续，可以引用该结果集。新的实体、未覆盖期间、未提供指标或明确更新数据，需要重新查询或让用户选择范围。
- 用户明确不要重查且现有结果不足时，说明哪些部分可回答、哪些部分不可回答，不创建重复趋势图，也不把这一轮包装为成功的完整分析。
- 新对话与登出清除 store；刷新页面后按现有行为重新查询，不把执行凭据持久化。

**服务端复用契约：**

既有综合请求增加可选 `reuse`，仅接受 `originalQuestion`、`sourceQuestionEventId` 和受控的对象/月份/指标范围。`agentRunId`、planProofs、toolResults 仍来自原执行；`question` 与 trace 则属于当前追问。

验证顺序必须为：认证 → 当前问题/复用字段和字节上限校验 → 按原问题及原执行校验 proof → 按原参数校验工具结果绑定 → 检查所选范围有结果支持 → 构建当前追问的综合消息。沿用既有证明有效期，过期或篡改返回受控错误。有效期不足时可继续阅读已显示结果，但不能绕过服务端校验发起模型综合。

复用流程不请求新的数据工具；当前追问仍登记新的问题事件，反馈关联当前追问，原结果来源在会话内保留原事件引用。Trace 使用现有综合阶段、最终状态和零次新工具调用的摘要字段，不新增存储字段，不写入问题、结果或 proof。

**实施步骤与回归断言：**

- [x] 先写失败回归：三家完成后整理成表，月度数据请求数不增加；三个源图表不重复；表格保留共同完整期间。
- [x] 先写失败回归：三家工具完成后停止，再继续整理，仍能回答；成功工具未完成时不能伪造完整结果。
- [x] 先写失败回归：新对话、登出、范围超出、proof 过期/篡改、错误参数绑定均不能跨范围复用。
- [x] 实现 store 和两条路径的接入，再实现原绑定校验下的复用综合；不能仅用字符串出现“继续”就放行。
- [x] 验证每次用户提交仅登记一次；内部恢复不增加事件，用户主动再次提交产生新事件。

## 5. 任务二：失败状态、原因和恢复动作（P1）

**涉及文件：** `AgentPage.vue`、`agentSession.ts`、`CopilotKitAgentHost.vue`、`CopilotKitAgentRuntime.vue`、`AgentTimeline.vue`、`agentActivity.ts`；对应页面、Runtime、可靠性、日志、时间线测试。

**先做版本和入口核对：** 对照线上实际加载构建与本地保护逻辑，仅查看版本、受控错误码、resolution.field、阶段与最终状态；不导出 Cookie、执行凭据或完整网络载荷。若只是旧部署或旧页面会话，先按当前构建重新复验，避免重复修改已正确的代码。

统一最终状态规则：

| 情况 | 运行状态与页面表达 | 可提供的操作 |
| --- | --- | --- |
| 已完成有依据的回答 | done / 已完成 | 整理为表格、解释、更新数据 |
| 合法筛选得到零匹配 | done / 无符合条件结果 | 显示原条件；用户点击后才能调整 |
| 商户未匹配或对象歧义 | error / 未找到或需要选择商户 | 编辑名称；展示现有解析器给出的候选 |
| 对象已识别，但月份不足 | error / 该期间资料不足 | 查看已有月份、修改范围 |
| 规划失败或服务不可用 | error / 查询未完成 | 保留问题，重试；不能显示成功勾号 |
| 部分工具成功、其余失败 | 保留 partial 标志，明确部分完成 | 查看已完成结果，重试缺失部分 |
| 用户主动停止 | stopped / 已停止 | 查看已查结果，继续整理，重新编辑 |

`status=done` 不能仅由“返回了非空提示文本”决定。native、fallback、页面、Trace 和提问日志消费同一运行结论。停止时将仍在 running 的时间线节点收敛为 stopped，保留已完成节点。

**实施步骤与回归断言：**

- [x] 模拟无工具数据计划、无数据提示文本、native RUN_ERROR，断言页面 error、日志 failed、成功历史不追加。
- [x] 分别构造 `resolution.field=merchant` 与 `months`，断言提示不混用；歧义候选只能来自现有解析结果。
- [x] 构造合法零匹配，断言保留 Tier、CVR 门槛、排序条件且不自动放宽。
- [x] 保留上一轮结果的恢复动作；重试行为经过用户操作，继续整理只访问任务一中的结果集。
- [x] 复验反馈与原失败事件的关联，避免恢复按钮引入重复提问日志。

## 6. 任务三：结论优先、展示去重与滚动（P1）

**涉及文件：** `AgentPage.vue`、`agentWorkspace.css`、`results/AgentTrendResult.vue`、`frontend/src/shared/contracts/agentResult.ts`、`chat_agent_http.py`；回归 `AgentPage.test.ts`、`results/AgentTrendResult.test.ts`、`results/AgentPresentation.test.ts`。

默认布局：一句结论 → 必要的对比表 → 最多三条发现 → 可展开的详细分析与图表。用户明确要求详细分析时展开完整解释。多商户同时比较多个指标时，首选并列表格；原月度趋势图保留为证据入口。

- 视图去重按原结果集/调用标识完成，不通过标题相同就删除不同来源或不同时期的结果。
- 纯表格追问只追加所需表格和来源引用，不复制原三张图；右侧索引区分本次展示与引用来源。
- 流式回答期间只在用户原本跟随最新时跟随；用户主动向上阅读或查看月度明细时不得抢滚动。
- 运行结束后定位当前 assistant 回答开头，结论可见；不以 scrollHeight 作为回答完成后的默认落点。
- 展开详情、切换图表指标、打开明细时保持当前阅读位置。
- 压缩多余段落间距，保留列表、表格和正常段落结构，不通过裁断原始回答隐藏结论。

**实施步骤与回归断言：**

- [x] 三家首次回答的默认结构包含结论、对比表、最多三条发现，完整证据可展开。
- [x] 表格追问后源图表仍为三个，本次新增表格可以直接找到。
- [x] 完成时滚动目标为当前回答锚点；用户主动上滚后，token 或图表更新不再强制滚动。
- [x] 指标切换与明细展开后，阅读位置不跳到会话末尾；折叠按钮可用键盘操作并声明 aria-expanded。

## 7. 任务四：数字格式与完整月份口径（P1/P2）

**涉及文件：** 新增 `frontend/src/features/agent/agentMetricFormatting.ts` 及对应测试；修改 `agentSession.ts`、`agentResultPresentation.ts`、结果组件、`chat_agent_http.py`、`agent_trend_comparison.py` 与必要的 registry 结果投影。

统一显示接口：

```ts
export function formatAgentMetric(
  key: string,
  value: number | null | undefined,
  language: UiLanguage
): string;
```

`UiLanguage` 来自既有 i18n。金额两位小数、点击/订单为整数、EPC 三位小数、CVR 两位百分数；显示层不改变计算精度。CVR 规范输入为小数比例，`0.072` 显示 `7.20%`；变化百分数与比例分别处理，不能依赖数值是否小于 1 猜单位。

缺失显示未提供，真实零保留；分母为零时比率不可计算。没有来源币种时不凭空添加货币符号。综合消息可携带由规范数值生成的展示字符串，正文、表格、fallback 使用同一格式；不以事后文本替换把回答中所有小数都改成百分数。

时间口径沿用现有共同月份计算：

- 分别展示数据覆盖月份数与完整月份数。按此次数据，Shokz 覆盖 12 个月，其中 11 个完整月；其余商户同样说明不足。
- 未结束月份用于说明截至当前的表现，不能作为默认完整期间首末增长结论。
- 三家比较仍使用共同完整期间 2026-06 至 2026-09；保留每家实际覆盖期间汇总，不混用两种累计。
- 当前月、完整月判断使用明确的业务时区和数据截至时间；无法确定完整性时不将其肯定标为完整。
- 普通展示用北京时间与可读日期，来源详情可展开查看原始时间。

**实施步骤与回归断言：**

- [x] 覆盖 CVR 小数比例、超过 100% 的变化率、金额三位源精度、真实零、NULL 和零分母。
- [x] 固定时钟为 2026-10-14，默认完整月分析排除十月；显式查询十月则展示截至值并标注未结束。
- [x] 单商户与多商户在相同月份、相同指标上格式一致；单商户不得再以包含未结束月份的巨大增长率开头后又否定该口径。
- [x] 综合、表格和 fallback 都能正确显示，缺失值不因为格式化变成零。

## 8. 任务五：筛选说明、上下文和输入区（P2）

**涉及文件：** `agentKeywordSearch.ts`、`agentModel.ts`、`AgentPage.vue`、`AgentAttachment.vue`、`agentWorkspace.css`，及对应关键词、记忆、页面和附件测试。

- 排序说明优先使用实际 metricSort；search 模式设置了 EPC 排序时，不再同时写未按表现排序。
- 零匹配显示无符合条件结果，原条件保持可见；提供查看原匹配范围、调整门槛的入口，调整需要用户确认动作。
- 上下文保留规范字段，但显示商户、完整月份范围、收入/订单/转化率/联盟 EPC 等业务标签；不将原始指标键当作查询对象。
- 单一明确商户上下文可用于预填商户示例；多个候选时先选择，没有上下文时提供可编辑示例。示例继续保持预填后由用户发送的交互。
- 推广上传默认收起为附件入口；用户选择推广查询或添加文件后展开。保留现有文件限制、解析和推送日期确认。
- 普通指标查询只优先显示本次所问指标，其余指标放在更多指标中；不删除既有可用指标。

**实施步骤与回归断言：**

- [x] search + EPC 降序与 recommendation + 显式排序都只有一套正确说明；零匹配不放宽条件。
- [x] 上下文从规范 metric key 得到中文标签；开始/结束月份均显示；多个对象不能被静默替换为一个。
- [x] 示例预填保持当前对象或明确示例对象，不自动发送；用户已有草稿时不会被上下文刷新覆盖。
- [x] 收起附件入口后仍能选择文件、识别拖入文件并完成原有推广确认流程。

## 9. 实施顺序与检查点

1. 先核对线上版本与实际执行路径，重现状态和原因问题；记录与本地保护逻辑的差异。
2. 实现任务一的结果集、原绑定校验和双路径接入，验证停止后继续及表格追问。
3. 完成任务二的状态与恢复动作，确认没有破坏日志去重、反馈或停止。
4. 完成任务三的答案结构、去重与滚动，再处理任务四、五的展示规范。
5. 本地测试通过后进行真实 Provider 与 BrowserAct 验收；部署后再对线上两条执行路径验收。

每个任务先写能复现该行为的失败回归，确认失败原因后实现，再运行相关测试。不能仅改提示词就认定结果复用、失败状态或滚动问题已经修复。纯样式、文案调整使用必要的现有验证，不增加与实现完全镜像的测试。

## 10. 自动化与浏览器验收

### 自动化入口

```powershell
python scripts/test_agent_result_reuse.py
python scripts/test_agent_synthesis_contract.py
python scripts/test_agent_agui.py
python scripts/test_agent_planning_truncation.py
python scripts/test_agent_trend_comparison.py
python scripts/test_agent_trace.py
python scripts/test_chatbot_question_log_http.py
python scripts/test_chatbot_answer_feedback_http.py
npm --prefix frontend run test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm run test:copilotkit
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m7_modern_entry.mjs
```

`test_agent_result_reuse.py` 已新增并验证 HTTP 双入口的原绑定复用、范围拒绝、比率汇总与投影约束。具体命令输出状态见第 9 节。

### 浏览器验收矩阵

| 场景 | 操作 | 通过标准 |
| --- | --- | --- |
| 单商户 | 查询 Shokz 最近十二个月收入、订单、点击、CVR、EPC | 数据正确；CVR 百分比；完整月与未结束月分别说明；默认结论简洁。 |
| 完整月追问 | 只比较最近两个完整月份 | 固定十月日期时选择八月、九月，不误用九月、十月。 |
| 三家分析 | 查询 Shokz、Roborock、Beatbot Amazon 并比较趋势 | 覆盖与共同完整期间明确，汇总不混用；结论直接可见。 |
| 纯表格追问 | 同范围只整理为一张对比表 | 无新数据查询、无重复趋势图；当前追问有独立正确日志。 |
| 停止后继续 | 工具完成、综合时停止，再基于已有结果继续 | 保留源图表；无需重查即可继续；未完成部分明确标注。 |
| 范围变化 | 将已有结果改为未覆盖商户或月份 | 不伪装复用成功；用户可选择新查询；明确不要重查时只回答覆盖部分。 |
| 对象不存在 | 使用不存在的商户名 | 说明名称未匹配；不能错误归因于月份不足；无成功分析勾号。 |
| 零匹配筛选 | Tier 1、vacuum cleaner、CVR 至少 5%、EPC 降序 | 条件未放宽；零匹配说明准确；不存在排序文案冲突。 |
| 服务失败/超时 | 使用受控测试响应触发 | error/failed 一致；不是用户停止；反馈仍关联当前问题。 |
| 阅读与输入 | 阅读历史时更新结果、展开明细、切换指标、输入草稿 | 不抢滚动、不抹掉草稿；结论可定位，附件入口仍可使用。 |
| 清理与隔离 | 新对话、登出、刷新 | 不能跨对话或跨账号复用旧凭据；不将原始结果加入持久化记忆。 |

普通 modern session 与可用的 native CopilotKit 路径分别验收，不能用 fallback 通过代替 native 通过。真实回答允许措辞变化，但数据、期间、状态和请求次数必须符合断言。浏览器请求数只用于核对数据查询，内部 Node/Python transport 往返不算额外的商户查询。

### 交付与收尾

- [x] 相关回归、完整前端测试、类型检查和构建通过。
- [x] 本地真实查询通过，并记录使用的是 native 还是 fallback。
- [ ] 部署后重复线上验收矩阵，确认加载构建与本次代码一致。
- [x] 关闭本次启动的测试浏览器和本地服务器，并核对监听端口。
- [x] 文档记录实际完成、待验收、PR 与部署状态；Git 发布仅在用户授权后执行。

## 9. 实施与验收记录（2026-10-14）

### 本地代码状态

- 修复分支：`codex/agent-ux-remediation-1014`；基线仍为 `e9bff7126f852951799dcd1cad230bb4d8d93804`。
- 本次交付包含 Agent 修复、回归测试及本方案，保护数据缓存不纳入改动。用户已授权创建到上游 `main` 的 PR，发布使用独立修复分支；未合并或部署。
- 线上公开脚本包含上一轮规划截断及无工具保护，不能将本次问题全部归因于旧部署；实际线上提交身份仍未核实。

### 实际实现

| 任务 | 实现位置与结果 |
| --- | --- |
| 结果复用 | `agentResultReuse.ts` 在会话内保留最近一组成功结果，最多六个调用，沿用十分钟证明窗口；`agentSession.ts` 与 `CopilotKitAgentHost.vue` 共享这组结果。原生规划状态经 `STATE_SNAPSHOT` 或工具上下文保留，工具成功后逐个登记，停止不丢失已取得数据；原轮次只取得部分工具时，继续结果及 Trace 保留 `partial`。 |
| 绑定与范围 | `agent_contract.py` 增加可选 `reuse`。证明仍按原问题、原执行及原参数验证，当前问题和 Trace 使用当前追问；仅投影已有对象、月份与指标。连续月份范围包含中间月份。只选 CVR/EPC 时先按原分子分母计算所选期间，再裁剪输出；主动缩小对象不会误报执行不完整。 |
| 停止与失败 | 来源视图独立保留；恢复综合失败或越界拒绝也不清除它们。新对话、刷新和登出清理临时结果；dispose/abort 后迟到工具不能回写缓存。无数据和综合失败不会凭非空提示标记成功；已规划后的原生传输中断不再启动第二条规划链。 |
| 名称解析 | Agent 不沿用全文搜索的内部短词命中。实际不存在名称曾误匹配短名 `YZ`，现已拦截，同时保留精确名称、编号和正常名称前缀匹配。 |
| 阅读展示 | 当前问题决定简洁、仅表格或详细模式。默认保留结论、必要表格和最多三条发现；其余原文进入可键盘操作的“查看完整分析”，没有截断或改写回答、历史、反馈。流式输出不反复折叠；来源图表默认收起。同源结果去重，完成时定位结论，展开与切换指标不追尾；程序化定位不会自动收起输入区。 |
| 格式与口径 | `agentMetricFormatting.ts` 统一金额两位、整数计数、EPC 三位、CVR 两位百分比；缺失不变零，源指标保留完整精度。`agent_trend_comparison.py` 为单商户和多商户生成完整月份摘要与显示值，并按每个指标独立生成最高/最低事实，保留并列与缺失。 |
| 筛选与输入 | 排序文案使用实际 `metricSort`，零匹配保留条件；调整入口只预填。上下文显示业务标签与完整月份范围，示例沿用单一商户且保留草稿。推广附件默认简化，选择、拖放和确认流程由组件回归验证。 |

### 本地 BrowserAct 证据

使用 `http://127.0.0.1:8765/` 与配置浏览器的独立测试会话。仅本地设置 `OI_AUTH_ENABLED=0`，并关闭 `OI_CHATBOT_QUESTION_LOGGING`、`OI_AGENT_TRACE_ENABLED`；没有提交反馈或实际上传文件，没有污染线上提问与 Trace 记录。

Python 本地服务器没有 `/api/copilotkit/info` 的 Node 入口，返回 404。本次真实浏览器数据与模型查询通过备用 modern session；原生组件、AG-UI、Node 合同有自动化覆盖，不能把这些或备用链成功称为 native 浏览器验收。

| 场景 | 实际观察 |
| --- | --- |
| 单 Shokz | 一次规划、一次商户数据读取、一次综合；完整月份与未结束的十月分别说明，金额/CVR/EPC 格式正确，趋势默认收起。 |
| 三家趋势 | 三个商户数据读取，覆盖与共同完整期间明确；完整比较使用六月至九月，十月排除。 |
| 表格追问 | 三家已完成后追加一次复用综合，规划与商户数据读取均不增加，源趋势仍为三张；最新仅表格回答为一张表加期间说明。 |
| 停止后继续 | 在真实工具完成后受控暂停综合，点击停止，运行节点归零、源趋势三张保留、继续按钮可用；继续只增加一次复用综合，无额外规划或数据读取。 |
| 排名一致性 | 初测模型曾把 EPC 的最低排名套到 CVR。加入按指标独立的排名事实后，复验正确区分 Roborock 的 CVR 最低与 Shokz 的 EPC 最低。数值事实确定生成，模型措辞仍由 Provider 生成，尚无通用回答硬校验器。 |
| 不存在商户 | 最新复验返回名称未匹配、状态 error；一次规划，零商户数据读取、零综合，不再误报月度数据不足。 |
| 零匹配 | Tier 1、vacuum cleaner、CVR 至少 5%、EPC 降序没有被放宽；卡片不再出现相反排序文案。点击调整入口仅预填，未增加请求。 |
| 刷新隔离 | 刷新后无旧结果；明确“不要重新查询”的继续请求返回可复用结果不可用，零规划、零数据读取、零综合。 |
| 阅读与输入 | 完成时回答开头位于视口内，输入区保持展开；Markdown 容器使用 normal 空白规则，用户提问与代码块保持各自规则。草稿、结束后展开与滚动还由页面回归验证。 |

最终收尾时，真实商户月度请求遇到十秒超时；该外部状态不代表没有历史数据。已补充回归并保留 `tool_timeout`，不可再误报月份不足。最新静态折叠使用明确的受控展示样例验证：直接显示实质结论、期间、一张表和三条发现，另一张表、代码及链接保留在关闭的详情中；鼠标展开后位置稳定。

原生 Node 环境浏览器、部署后全矩阵、真实附件上传和数据库日志落库仍未在本轮执行。日志关联和反馈语义已由受控 HTTP/组件回归验证；初次真实查询、表格复用、停止继续与最新受控展示证据分别记录，不将受控样例视为真实经营数据验收。

### 自动化与交付状态

- 最终前端全量：122 个文件、793 项测试通过；新增的停止部分标记、超时原因、正文折叠边界另经相关 105 项回归通过。
- `npm --prefix frontend run typecheck`、两套前端构建和 `git diff --check` 通过。
- Python：复用 12 项、趋势与排名 17 项、综合 8 项、AG-UI 16 项、规划截断 9 项、Trace 5 项，以及提问/反馈 HTTP 合同脚本通过。
- Node CopilotKit 6 项、M6/M7、迁移清单、构建合同、页面切换、现代挂载、Shell 合同与 `public/auth.js` 语法检查通过。
- `test_payment_placeholders.py` 因本地不存在 `output/payment_records.json` 跳过集成检查，没有生成付款数据以绕过此限制。
- 最后一次前端源码编译后，静态回答折叠由 BrowserAct 受控展示验证；原生 Node 真实浏览器与部署验证仍保持待验收。
- 已关闭本次 BrowserAct 会话 `oi-ux-fix-1014` 和本地服务器（PID `27420`）；复核 `8765` 端口无监听。本地服务器自动刷新的缓存已恢复，`protected_data/` 无改动；本次临时截图已删除。
