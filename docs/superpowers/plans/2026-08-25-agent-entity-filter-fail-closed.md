# Agent 实体与过滤条件失败关闭实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 统一 Chat Agent 商户解析和过滤条件校验，避免歧义实体被猜选、非法过滤被忽略或查询范围被意外扩大。

**架构：** 在 `public/app.js` 的 Agent 工具边界增加结构化解析结果：商户解析按 ID、精确名称、唯一子串依次处理，多候选返回 `ambiguous`，无候选返回 `not_found`。付款和趋势工具在执行前将状态、月份、Tier、月份数量和指标归一化；非法值统一返回 `invalid_filter`，不进入数据查询。

**技术栈：** Vanilla JavaScript、Node.js Agent 回归脚本、现有 `CHATBOT_DATA` fixture、Markdown 文档。

## 全局约束

- 保持商户 ID 优先规则：输入同时包含 ID 和名称时只按 ID 解析。
- 保留唯一子串匹配能力，只有唯一命中时才允许继续查询。
- 歧义、未找到和非法过滤必须返回可供 Agent 综合使用的结构化状态和中文错误说明。
- 商户分析、商户对比、趋势商户路径和付款商户过滤必须复用同一套商户解析逻辑。
- 不扩大本次范围到数据库查询、Report Mode 原有页面筛选器或不相关 UI 重构。
- 所有新增回归测试先建立 RED，再实现 GREEN；不提交或推送，除非用户另行授权。

---

### 任务 1：补充失败关闭回归测试

**文件：**

- 修改：`scripts/test_chat_agent.mjs`，在现有商户、付款和趋势工具测试附近增加 3.4 场景。
- 参考：`public/app.js:13914`、`public/app.js:14062`、`public/app.js:14205`。

**接口：**

- 消费：现有 `hooks.agentExecuteTool(name, args, context)`。
- 预期失败结果：`{ ok: false, error: string, resolution?: { status: string, ... } }`。

- [x] **步骤 1：写出歧义商户测试**

```js
const ambiguousMerchant = await hooks.agentExecuteTool("merchant_analysis", { merchant: "US" });
assertEqual(ambiguousMerchant.ok, false, "ambiguous merchant must not select the first substring match");
assertEqual(ambiguousMerchant.resolution.status, "ambiguous", "ambiguous merchant should expose its status");
assertIncludes(ambiguousMerchant.error, ambiguousMerchant.resolution.candidates[0].merchantId,
  "ambiguous error should include the first candidate ID");
assertIncludes(ambiguousMerchant.error, ambiguousMerchant.resolution.candidates[1].merchantId,
  "ambiguous error should include the second candidate ID");
```

- [x] **步骤 2：写出跨工具统一解析测试**

```js
const ambiguousComparison = await hooks.agentExecuteTool("merchant_comparison", {
  merchants: ["US", hooks.firstOfferName()]
});
assertEqual(ambiguousComparison.ok, false, "comparison must reject an ambiguous merchant");
assertEqual(ambiguousComparison.resolution.merchants[0].status, "ambiguous", "comparison should use the shared merchant resolver");

const ambiguousTrend = await hooks.agentExecuteTool("trend", {
  entityType: "merchant", target: "US", months: 2
});
assertEqual(ambiguousTrend.ok, false, "merchant trend must reject an ambiguous merchant");
assertEqual(ambiguousTrend.resolution.status, "ambiguous", "trend should use the shared merchant resolver");

const ambiguousPayment = await hooks.agentExecuteTool("payment_status", { merchant: "US" });
assertEqual(ambiguousPayment.ok, false, "payment lookup must reject an ambiguous merchant");
assertEqual(ambiguousPayment.resolution.status, "ambiguous", "payment should use the shared merchant resolver");
```

- [x] **步骤 3：写出非法过滤测试**

```js
const invalidStatus = await hooks.agentExecuteTool("payment_status", { status: "settled" });
assertEqual(invalidStatus.ok, false, "unknown payment status must not return all rows");
assertEqual(invalidStatus.resolution.status, "invalid_filter", "unknown status should be invalid_filter");

const invalidMonth = await hooks.agentExecuteTool("payment_status", { month: "13月" });
assertEqual(invalidMonth.ok, false, "unknown payment month must not be ignored");
assertEqual(invalidMonth.resolution.status, "invalid_filter", "unknown month should be invalid_filter");

const invalidTrend = await hooks.agentExecuteTool("trend", {
  entityType: "merchant", target: hooks.firstOfferName(), months: 1, metric: "madeUpMetric"
});
assertEqual(invalidTrend.ok, false, "invalid trend filters must not fall back to defaults");
assertEqual(invalidTrend.resolution.status, "invalid_filter", "invalid trend filter should be invalid_filter");
```

- [x] **步骤 4：运行测试确认 RED**

运行：`node scripts/test_chat_agent.mjs`

预期：失败，原因是当前歧义商户会返回第一个子串命中，未知付款状态会继续执行，趋势非法参数会被默认化。

### 任务 2：实现统一实体解析和过滤失败关闭

**文件：**

- 修改：`public/app.js:13913-14370`，Agent 解析、付款工具和趋势工具。
- 测试：`scripts/test_chat_agent.mjs`。

**接口：**

- 产生：`agentResolveMerchant(name)` 返回 `resolved`、`ambiguous` 或 `not_found`。
- 产生：`agentInvalidFilterResolution(field, value, allowed)` 返回 `invalid_filter`。
- 保留：`agentResolveMerchantStrict(name)` 作为兼容包装，仅对 `resolved` 返回 offer，其余返回 `null`。

- [x] **步骤 1：实现结构化商户解析**

```js
function agentResolveMerchant(name) {
  var input = String(name || "").trim().slice(0, 80);
  if (!input) return { status: "not_found", input: input, candidates: [] };

  var idMatch = input.match(/\b\d{5,8}(?:\.0)?\b/);
  var candidates;
  if (idMatch) {
    var merchantId = idMatch[0].replace(/\.0$/, "");
    candidates = offers.filter(function (offer) {
      return String(offer.merchantId || "").trim() === merchantId;
    });
  } else {
    var lower = input.toLowerCase().replace(/\s+/g, " ").trim();
    candidates = offers.filter(function (offer) {
      return normalizedOfferName(offer, "brand") === lower
        || normalizedOfferName(offer, "merchantName") === lower;
    });
    if (!candidates.length) {
      candidates = offers.filter(function (offer) {
        return normalizedOfferName(offer, "brand").indexOf(lower) !== -1
          || normalizedOfferName(offer, "merchantName").indexOf(lower) !== -1;
      });
    }
  }

  var status = candidates.length === 1 ? "resolved" : candidates.length ? "ambiguous" : "not_found";
  return { status: status, input: input, offer: status === "resolved" ? candidates[0] : null,
    candidates: candidates.slice(0, 5).map(agentMerchantCandidate) };
}
```

- [x] **步骤 2：接入四条商户路径**

`merchant_analysis`、`merchant_comparison`、商户 `trend` 和 `payment_status.merchant` 在解析结果不是 `resolved` 时立即返回 `ok:false`，并将候选 ID、名称、Tier 和品类写入错误说明与 `resolution` 字段。

- [x] **步骤 3：实现付款过滤校验**

只接受 `paid`、`pending`、`unpaid`、`overdue`、`partial` 及现有中文别名；月份必须是有效 `YYYY-MM` 或能从用户原话解析出的 1–12 月；Tier 必须能归一化为现有五个 Tier。任何其他值返回 `invalid_filter`，不得保留全量 `payRows`。

- [x] **步骤 4：实现趋势过滤校验**

月份数量显式传入时必须是 2–24 的整数；指标显式传入时必须属于 `TREND_METRIC_DEFS`；非法值返回 `invalid_filter`，不得静默改成 12 个月或展示全部指标。

- [x] **步骤 5：运行定向测试确认 GREEN**

运行：`node scripts/test_chat_agent.mjs`

预期：新增失败关闭场景和既有 Agent 场景全部通过。

### 任务 3：同步文档

**文件：**

- 修改：`docs/chat-agent-optimization-roadmap.md:97-118`。
- 修改：`docs/chatbot-feature-report.md` 的 Agent 工具流程说明。
- 修改：本计划文件，将完成步骤标记为 `[x]`。

- [x] **步骤 1：标记路线图 3.4 已完成**

记录统一解析的状态契约、ID 优先、唯一子串匹配、歧义候选和非法过滤拒绝行为，并将实现成本从待实施更新为已完成。

- [x] **步骤 2：同步功能报告**

说明 Agent 工具遇到 `ambiguous`、`not_found` 和 `invalid_filter` 时不会执行扩大范围的查询，并列出商户分析、趋势、对比和付款查询共享解析器。

### 任务 4：完整验证

- [x] **步骤 1：运行 JavaScript 和 Agent 回归**

运行：`node --check public/app.js`、`node scripts/test_chat_agent.mjs`、`node scripts/test_chatbot_intent_flow.mjs`、`node scripts/test_zh_chatbot.mjs`。

- [x] **步骤 2：运行后端契约和编译检查**

运行：`python scripts/test_chat_stream_agent_config.py`、`python scripts/test_agent_http.py`、`python -m py_compile auth.py server.py chat_agent_http.py api/chat/stream.py`。

- [x] **步骤 3：检查差异和服务器状态**

运行：`git diff --check`，确认 `8765` 没有遗留本地服务器；本任务不执行提交或推送。
