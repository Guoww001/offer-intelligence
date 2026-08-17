# Chat Mode Agent Merchant Monthly Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Report Mode 商户概览使用的真实月度商户数据接入 Chat Mode Agent 的 `merchant_analysis` 工具。

**Architecture:** 复用现有的 `fetchMerchantMonthlyRows()`、`fetchMerchantMetrics()` 和 `mergeMonthIntoOffer()`，不新增数据库接口，也不改变 Report Mode 的月份选择器。Agent 工具在返回当前商户分析摘要时附加最近 12 个月的结构化明细；数据库不可用时保留当前汇总结果，并返回空月度数组和明确的数据来源状态。

**Tech Stack:** Vanilla JavaScript SPA、`/api/ui/db/merchant`、Node VM tests、Markdown documentation。

## Global Constraints

- 保持 `merchant_analysis` 现有的当前汇总、百分位、比较、强弱项、Peer 和付款风险字段不变。
- 月度数据必须复用 Report Mode 的 `/api/ui/db/merchant?merchantId=...&months=12&minimal=1` 数据口径。
- 月度数据不可用时不得生成伪造月度值；Agent 仍需返回当前商户分析结果。
- 本次只迁移数据层，不新增 Chat Mode 月份选择器或其他 UI。
- 不提交、推送或创建 Pull Request；保留工作区中已有的用户改动和缓存改动。

---

### Task 1: Add a failing Agent monthly-data contract test

**Files:**
- Modify: `scripts/test_chat_agent.mjs` near the existing `merchant_analysis` tests

**Interfaces:**
- Consumes: `window.OFFER_INTELLIGENCE_TEST_HOOKS.agentExecuteTool()` and the existing mock `fetch` recorder.
- Produces: A failing contract proving `merchant_analysis` returns `latestMonth`, `monthly`, and `monthlyDataSource` from the Report Mode monthly payload.

- [ ] **Step 1: Write the failing test**

Add a test that supplies two descending monthly rows through `/api/ui/db/merchant`, calls `agentExecuteTool("merchant_analysis", { merchant: firstOffer })`, and asserts:

```js
assertEqual(result.data.latestMonth, "2026-08", "merchant analysis should expose latest month");
assertEqual(result.data.monthlyDataSource, "db", "monthly data should identify the DB source");
assertEqual(result.data.monthly.length, 2, "merchant analysis should carry monthly rows");
assertEqual(result.data.monthly[0].revenue, 1400, "latest monthly revenue should be preserved");
assertEqual(result.data.monthly[0].epcAll, 2, "monthly all EPC should use payout/clicks");
assertEqual(result.data.monthly[0].epcAff, 1, "monthly affiliate EPC should use affiliatePayout/clicks");
assertEqual(result.data.monthly[1].month, "2026-07", "monthly order should match the DB response order");
assertTruthy(fetchCalls.some((call) => call.url.includes("/api/ui/db/merchant") && call.url.includes("months=12") && call.url.includes("minimal=1")), "merchant analysis should request the Report Mode monthly endpoint");
```

Use rows with `revenue`, `orders`, `clicks`, `payout`, `affiliatePayout`, `aov`, `conversionRate`, `dpv`, and `atc`; reset the Agent trend cache before the call so the test does not reuse another test's payload.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test_chat_agent.mjs`

Expected: FAIL at the new assertion because the existing compact `merchant_analysis` result has no `monthly` field.

---

### Task 2: Attach Report Mode monthly data to `merchant_analysis`

**Files:**
- Modify: `public/app.js:12831-12930,13080-13095,13289-13305`
- Test: `scripts/test_chat_agent.mjs`

**Interfaces:**
- Consumes: `fetchMerchantMonthlyRows(offer)` returning the latest-first `monthlyAmazonMetrics` rows, and `mergeMonthIntoOffer(offer, row)` for the same derived metric mapping used by Report Mode.
- Produces: `compactAgentToolResult("merchant_analysis", summary, language, { offer, monthlyRows })` with `latestMonth`, `monthly`, `monthlyDataAvailable`, `monthlyDataSource`, and `monthlyNote`.

- [ ] **Step 1: Add the bounded Agent monthly fetch helper**

Near the Agent constants, use the existing Report Mode fetcher without changing its 12-month behavior:

```js
async function fetchMerchantMonthlyRowsForAgent(offer) {
  return timeoutPromise(fetchMerchantMonthlyRows(offer), 8000, null);
}
```

The timeout prevents an unavailable DB from blocking the Agent indefinitely; it must not alter the existing Report Mode fetch timeout.

- [ ] **Step 2: Add the compact monthly serializer**

Inside the Agent result block, map each row with `mergeMonthIntoOffer()` and return these final fields:

```js
function compactMerchantMonthlyRows(offer, monthlyRows) {
  if (!offer || !Array.isArray(monthlyRows)) return [];
  return monthlyRows.slice(0, 12).map(function (row) {
    var active = mergeMonthIntoOffer(offer, row);
    return {
      month: row.month || "",
      revenue: agentRoundNumber(active.salesAmount),
      aov: agentRoundNumber(active.aov),
      epcAll: agentRoundNumber(offerAllEpc(active)),
      epcAff: agentRoundNumber(offerAffEpc(active)),
      conversionRate: agentRoundNumber(active.conversionRate),
      payout: agentRoundNumber(offerAllCommission(active)),
      affiliatePayout: agentRoundNumber(offerAffCommission(active)),
      orders: agentRoundNumber(active.orders),
      clicks: agentRoundNumber(active.clicks),
      dpv: agentRoundNumber(active.dpv),
      atc: agentRoundNumber(active.atc)
    };
  });
}
```

Keep empty rows empty. Do not call `generateTrendFromOfferSummary()` here because this contract is for real monthly merchant data, not estimated trend data.

- [ ] **Step 3: Extend the compact merchant result without removing existing fields**

In the `merchant_analysis` branch of `compactAgentToolResult()`, read `opts.offer` and `opts.monthlyRows`, then append:

```js
var monthly = compactMerchantMonthlyRows(opts && opts.offer, opts && opts.monthlyRows);
out.latestMonth = monthly.length ? monthly[0].month : null;
out.monthly = monthly;
out.monthlyDataAvailable = monthly.length > 0;
out.monthlyDataSource = monthly.length ? "db" : "unavailable";
out.monthlyNote = language === "en"
  ? "monthly contains the latest real DB rows, newest first; an empty array means monthly data was unavailable."
  : "monthly 为数据库返回的真实月度数据，按最新月份在前排列；空数组表示月度数据暂不可用。";
```

If the compact result exceeds `AGENT_MAX_RESULT_CHARS`, trim only the monthly array after the existing peer/global-comparison fallback and keep `latestMonth` and the source status accurate. The first implementation should retain all 12 rows whenever the compact result fits within the existing limit.

- [ ] **Step 4: Fetch the monthly rows in `agentExecuteTool()`**

Change only the `merchant_analysis` branch to await the bounded fetch and pass the result into the compact function:

```js
var monthlyRows = await fetchMerchantMonthlyRowsForAgent(strictOffer);
return {
  ok: true,
  data: compactAgentToolResult("merchant_analysis", summary, state.language || "zh", {
    offer: strictOffer,
    monthlyRows: monthlyRows || []
  })
};
```

Update the tool description to state that the result includes the latest 12 real monthly rows when DB data is available.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `node scripts/test_chat_agent.mjs`

Expected: `OK 17 scenarios` or the updated scenario count after the new contract test.

---

### Task 3: Cover unavailable monthly data and update the data contract documentation

**Files:**
- Modify: `scripts/test_chat_agent.mjs`
- Modify: `docs/chat-mode-analysis-types.md`
- Modify: `docs/chatbot-feature-report.md`
- Modify: `public/app.js` Chat Mode help text in the Chinese and English Agent capability sections

**Interfaces:**
- Consumes: The `monthlyDataSource` contract from Task 2.
- Produces: Explicit documentation that current merchant metrics and real monthly rows have different sources and that missing DB monthly data does not invalidate the current analysis.

- [ ] **Step 1: Add the unavailable-data regression test**

Mock `/api/ui/db/merchant` with `{ ok: true, monthlyAmazonMetrics: [] }`, call `merchant_analysis`, and assert `result.ok === true`, `result.data.monthly` is empty, `monthlyDataAvailable === false`, and `monthlyDataSource === "unavailable"`.

- [ ] **Step 2: Update the Chinese and English capability documentation**

State that `merchant_analysis` returns the current cached analysis plus up to 12 real DB monthly rows when available; `monthly=[]` means only the current cached analysis is available. Clarify that the separate `trend` tool remains responsible for trend deltas and trend-specific metric selection.

- [ ] **Step 3: Run the focused tests**

Run: `node scripts/test_chat_agent.mjs`

Expected: all Agent scenarios pass, including the unavailable-monthly-data case.

---

### Task 4: Full verification and worktree boundary check

**Files:**
- No additional files

- [ ] **Step 1: Run syntax and Agent regression checks**

Run:

```text
node --check public/app.js
node scripts/test_chat_agent.mjs
python scripts/test_agent_http.py
python scripts/test_llm_agent.py
python scripts/test_agent_config.py
python scripts/test_vercel_chat_routes.py
python -m py_compile chat_agent_http.py llm_provider.py api/chat/actions.py api/chat/stream.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_report_mode_guide.mjs
```

- [ ] **Step 2: Verify diff quality and scope**

Run: `git diff --check` and `git status --short --branch`.

Confirm that the protected cache modification and the previously existing Agent/Phase 2 changes remain untouched except for the intended files, and do not commit or push.
