# Chat Mode Agent Tier Merchant List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Chat Mode Agent 的 `tier_analysis` 在保留 Tier 概览的同时，复用 Report Mode 的 Tier 行排序并返回可分页的商家列表。

**Architecture:** Report Mode 的 Tier 查询以 `offers` 中的完整 Tier 行作为数据源，按 `compareRecommendationOffers()` 排序；Agent 继续使用 `analyzeTier()` 生成概览，再把同一批排序后的行压缩为 `merchants` 页面，并返回总数、offset、limit、hasMore 元数据。默认返回前 100 行，用户可通过后续问题触发 offset/limit 分页，避免 Tier 4 的 5800 行直接进入模型上下文。

**Tech Stack:** Vanilla JavaScript SPA, existing Agent tool loop, Markdown/SSE synthesis, Node regression scripts.

## Global Constraints

- 保持 Agent 只读，不新增写入操作或后端数据接口。
- 保持 Report Mode 的 Tier 概览与排序行为不变。
- 商户列表必须来自当前 `offers` 数据，并与 Report Mode 的 Tier 查询排序口径一致。
- Agent 结果必须明确区分总商户数与本次返回页数，不得把截断列表表述成完整列表。
- 所有用户可见中文文案和代码注释使用简体中文，并同步维护英文文案。
- 不提交、不推送，保留工作区中的其他用户改动。

---

### Task 1: 固定 Tier 商家列表工具契约

**Files:**
- Modify: `scripts/test_chat_agent.mjs:299-307`
- Modify: `public/app.js:13336-13365,13465-13482,13676-13686`

**Interfaces:**
- `agentExecuteTool("tier_analysis", { tier, limit?, offset? })` returns `data.merchantCount`, `data.merchantList`, and `data.merchants`.
- `data.merchantList` is `{ total, offset, limit, returned, hasMore }`.
- Each `data.merchants` row contains `merchant`, `merchantId`, `tier`, `category`, `epcAll`, `epcAff`, `aov`, `conversionRate`, `orders`, `revenue`, `commission`, and `affiliateCommission`.

- [x] **Step 1: Add the failing assertions**

Extend the existing real-Tier test with:

```javascript
assertTruthy(Array.isArray(result.data.merchants), "tier analysis should carry merchant rows");
assertTruthy(result.data.merchants.length > 0, "tier analysis should return at least one merchant row");
assertEqual(result.data.merchantList.total, result.data.merchantCount, "merchant list total should match tier count");
assertEqual(result.data.merchantList.offset, 0, "default tier merchant page should start at zero");
assertEqual(result.data.merchantList.returned, result.data.merchants.length, "merchant page metadata should match rows");
```

Also add a page-size/offset check using `limit: 2` and `offset: 2`, asserting both pages return at most two rows and the second page reports the requested offset.

- [x] **Step 2: Run the focused test and verify the contract fails**

Run:

```powershell
node scripts/test_chat_agent.mjs
```

Expected: FAIL in the Tier test because the current compact result has no `merchants` or `merchantList` fields.

- [x] **Step 3: Add the shared compact Tier row mapper**

Add a helper next to `compactAgentToolResult()`:

```javascript
function compactAgentTierMerchantRows(rows) {
  return (rows || []).map(function (offer) {
    return {
      merchant: offer.brand || offer.merchantName || "Unknown",
      merchantId: offer.merchantId || "",
      tier: offer.tier || "Unknown",
      category: displayCategory(offer),
      epcAll: agentRoundNumber(offerAllEpc(offer)),
      epcAff: agentRoundNumber(offerAffEpc(offer)),
      aov: agentRoundNumber(offer.aov),
      conversionRate: agentRoundNumber(offer.conversionRate),
      orders: agentRoundNumber(offer.orders),
      revenue: agentRoundNumber(offer.salesAmount),
      commission: agentRoundNumber(offerAllCommission(offer)),
      affiliateCommission: agentRoundNumber(offerAffCommission(offer))
    };
  });
}
```

- [x] **Step 4: Implement sorted, bounded Tier pages**

In `agentExecuteTool()`'s `tier_analysis` branch, resolve the complete Tier rows, sort them with the same comparator as the Report Mode `tiers.length` path, normalize `limit` to `1..100` with default `100`, normalize `offset` to a non-negative integer, and pass the selected page into `compactAgentToolResult()` through `opts`:

```javascript
var tierRows = offersInTier(canonTier).slice().sort(function (a, b) {
  return compareRecommendationOffers(a, b, { includeTier4: true, includeBlack: true });
});
var total = tierRows.length;
var limit = Math.min(100, Math.max(1, Number(args.limit) || 100));
var offset = Math.min(total, Math.max(0, Number(args.offset) || 0));
var pageRows = tierRows.slice(offset, offset + limit);
return {
  ok: true,
  data: compactAgentToolResult("tier_analysis", tierSummary, state.language || "zh", {
    tierRows: pageRows,
    merchantList: { total: total, offset: offset, limit: limit, returned: pageRows.length, hasMore: offset + pageRows.length < total }
  })
};
```

The Tier compactor must add `merchants` and `merchantList` while retaining all existing overview fields. It must never claim `hasMore: false` when rows remain.

- [x] **Step 5: Extend the Tier tool schema and synthesis instructions**

Document optional `limit` and `offset` in `agentToolDefinitions()` so the planner can request the next page. Update Chinese and English synthesis prompts to say that `merchants` is the Report Mode ordering, `merchantList.hasMore` means more rows exist, and a truncated page must not be described as the complete Tier list. Update the Tier timeline scope to show the returned page and total count after the tool finishes.

- [x] **Step 6: Run the focused test and verify the contract passes**

Run:

```powershell
node scripts/test_chat_agent.mjs
```

Expected: all Agent scenarios pass, including full Tier 1/2 page behavior and offset pagination.

---

### Task 2: Verify the Agent synthesis and existing Report Mode boundaries

**Files:**
- Test: `scripts/test_chat_agent.mjs`
- Test: `scripts/test_dashboard_chat_pages.mjs`
- Test: `scripts/test_agent_execution_timeline.mjs`

**Interfaces:**
- Agent synthesis receives the compact Tier page and metadata through the existing `/api/chat/stream` message list.
- Report Mode continues to render its existing Deep Window/download snapshot path unchanged.

- [x] **Step 1: Add a synthesis fixture assertion for Tier rows**

Mock a `tier_analysis` tool call and a synthesis response, then assert the synthesis request body contains `"merchants"`, `"merchantList"`, and a representative merchant name. This proves the list crosses the tool-to-model boundary rather than only appearing in the browser-side result object.

- [x] **Step 2: Run all relevant checks**

Run:

```powershell
node scripts/test_chat_agent.mjs
node scripts/test_agent_execution_timeline.mjs
node scripts/test_dashboard_chat_pages.mjs
node --check public/app.js
git diff --check -- public/app.js scripts/test_chat_agent.mjs docs/chat-mode-analysis-types.md docs/chatbot-feature-report.md
```

Expected: all commands exit with code 0, the Agent timeline still collapses on success, and the existing Dashboard Chatbot/Agent page contract remains green.

- [x] **Step 3: Synchronize the two chatbot reference documents**

Update the Agent tool table and limitations in `docs/chat-mode-analysis-types.md` and `docs/chatbot-feature-report.md` to state that `tier_analysis` returns a bounded, paginated merchant list with total count, while Report Mode remains the complete Deep Window/Excel path.

- [x] **Step 4: Inspect final diff and leave local services stopped**

Run `git status --short` and verify only the intended Tier contract, tests, and documentation additions are attributable to this task. Do not commit or push. If a local server was started for runtime verification, stop it and confirm port 8765 is not listening.
