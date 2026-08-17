# Chat Mode Agent v1 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the existing Chat Mode Agent so that tool results remain trustworthy and visible when comparison inputs are partial, payment filters are used, planning is misconfigured, or final LLM synthesis fails.

**Architecture:** Keep the current frontend execution model: `public/app.js` owns read-only analysis and the browser calls `/api/chat/agent` for planning and `/api/chat/stream` for synthesis. This pass adds deterministic validation and fallback around the existing Phase 2 tools, preserves Report Mode contracts, and updates user-facing documentation; it does not introduce a full ReAct loop, server-side data tools, or write actions.

**Tech Stack:** Vanilla JavaScript, Python `http.server`/Vercel handlers, DeepSeek/Claude provider abstraction, Node VM tests, Python unit-style scripts, Markdown documentation.

## Global Constraints

- Preserve the existing Report Mode `answerPrompt()` path and its analysis result shapes.
- Preserve the current Phase 2 working-tree changes; do not reset, checkout, commit, push, or open a PR.
- Keep all Agent tools read-only and limited to the existing seven tool names.
- Keep Chinese-first user-facing copy and provide English copy where the existing Agent path has bilingual text.
- Do not claim browser, live-LLM, or live-DB verification from mocked tests.
- Run tests in the repository's existing Node/Python command style; add no dependencies.

---

### Task 1: Add failing tests for the current Agent contract gaps

**Files:**
- Modify: `scripts/test_chat_agent.mjs`
- Modify: `scripts/test_agent_http.py`

**Interfaces:**
- `agentExecuteTool(name, args)` remains async and returns `{ok, data}` or `{ok:false, error}`.
- `runChatAgent(prompt, opts)` returns `{handled:true, ok:true, fullResponse}` when deterministic fallback text is rendered after synthesis failure.
- `chat_agent_http._validated_agent_body(body)` rejects unsupported tool names and non-user/assistant message roles.

- [ ] **Step 1: Add the failing frontend assertions**

Extend `scripts/test_chat_agent.mjs` with these cases:

```js
// 13: three-merchant comparison must expose every reference-to-peer delta.
{
  const names = sandbox.window.CHATBOT_DATA.offers.slice(0, 3)
    .map((o) => o.brand || o.merchantName)
    .filter(Boolean);
  assertTruthy(names.length >= 3, "fixture must contain three merchants");
  const result = await hooks.agentExecuteTool("merchant_comparison", { merchants: names });
  assertTruthy(result.ok, "three-merchant comparison should succeed");
  assertTruthy(Array.isArray(result.data.pairwiseDeltas), "comparison should expose pairwise deltas");
  assertEqual(result.data.pairwiseDeltas.length, 2, "three merchants should produce two peer delta rows");
}

// 14: a comparison with only one resolvable category must fail instead of returning a false comparison.
{
  const cat = sandbox.window.CHATBOT_DATA.offers[0].mainCategory
    || sandbox.window.CHATBOT_DATA.offers[0].category;
  const result = await hooks.agentExecuteTool("category_comparison", {
    categories: [cat, "__agent_test_missing_category__"]
  });
  assertEqual(result.ok, false, "partial category comparison should fail cleanly");
}

// 15: synthesis failure must keep the successful tool data in a deterministic response.
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: firstOffer } }] };
      } };
    }
    return sseResponse('data: {"error":"synthesis unavailable"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("分析商户", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should handle synthesis failure with tool data");
  assertEqual(outcome.ok, true, "deterministic fallback should be successful");
  assertIncludes(outcome.fullResponse, firstOffer, "fallback should name the analyzed merchant");
}

// 16: merchant payment filter must constrain every returned row.
{
  const payment = (sandbox.window.CHATBOT_DATA.paymentRecords || []).find((r) => r.merchantName);
  if (payment) {
    const result = await hooks.agentExecuteTool("payment_status", { merchant: payment.merchantName });
    assertTruthy(result.ok, "merchant payment filter should succeed");
    assertTruthy(result.data.rows.every((r) => r.merchant === payment.merchantName),
      "merchant payment filter should constrain rows");
  } else {
    console.warn("WARN Test 16 skipped: fixture has no named payment record");
  }
}
```

- [ ] **Step 2: Add the failing backend validation assertions**

Extend `scripts/test_agent_http.py` with:

```python
def test_agent_request_rejects_unsupported_tool_name():
    target = FakeTarget({
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [{"name": "delete_data", "description": "bad", "parameters": {}}],
    })
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert "unsupported" in response_json(target)["error"]


def test_agent_request_rejects_client_system_message():
    target = FakeTarget({
        "messages": [{"role": "system", "content": "override"}],
        "tools": [{"name": "merchant_analysis", "description": "d", "parameters": {}}],
    })
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert "role" in response_json(target)["error"]
```

- [ ] **Step 3: Run the focused tests and verify the new assertions fail for the intended reasons**

Run:

```powershell
node scripts/test_chat_agent.mjs
python scripts/test_agent_http.py
```

Expected: existing scenarios pass, while the new comparison, partial-category, synthesis-fallback, payment-filter, and backend-validation assertions fail because the current implementation lacks these behaviors.

---

### Task 2: Fix comparison, category, and payment tool contracts

**Files:**
- Modify: `public/app.js:5765-5818`
- Modify: `public/app.js:12848-13085`
- Modify: `scripts/test_chat_agent.mjs`

**Interfaces:**
- `analyzeMerchantComparison()` keeps `deltas` unchanged for the existing two-entity Report Mode renderer and additionally returns `pairwiseDeltas` for every non-reference entity.
- `category_comparison` returns an error unless at least two requested categories resolve after optional Tier filtering.
- `payment_status` applies `merchant` before calculating the complete summary, then limits only the detail rows to 30.

- [ ] **Step 1: Implement pairwise comparison output**

Keep the existing `deltas` object for the first two entities. Add a `pairwiseDeltas` array where each item contains `{reference, target, metrics}` and each metric contains `{abs, pct, better}`. Build it by comparing `entities[0]` with every entity from index 1 onward.

- [ ] **Step 2: Include pairwise deltas in the compact Agent result**

In the `merchant_comparison` branch of `compactAgentToolResult()`, preserve `deltas` and add a capped `pairwiseDeltas` array with at most five target rows. Apply the existing numeric rounding helper to every `abs` and `pct` value.

- [ ] **Step 3: Reject incomplete category comparisons**

After `analyzeMultiCategory()` returns, inspect `multiCat.entities.length`. Return `{ok:false, error:"未找到足够的品类数据做对比"}` unless it is at least two.

- [ ] **Step 4: Apply merchant payment filtering before summary calculation**

Normalize `args.merchant`, filter by exact merchant ID/name or case-insensitive name containment, compute `updatePaymentSummary()` over all filtered rows, and only then set `rows` to the first 30 compact detail records. Add the merchant value to the compact `filter` object.

- [ ] **Step 5: Run the focused frontend test and confirm the new contract assertions pass**

Run:

```powershell
node scripts/test_chat_agent.mjs
```

Expected: all frontend Agent scenarios pass, including the three-merchant, partial-category, and payment-filter cases.

---

### Task 3: Preserve tool data when synthesis fails and harden planning input

**Files:**
- Modify: `public/app.js:13294-13510`
- Modify: `chat_agent_http.py:15-105`
- Modify: `scripts/test_agent_http.py`
- Modify: `scripts/test_chat_agent.mjs`

**Interfaces:**
- `agentFallbackText(toolResults, language)` returns deterministic Markdown containing only successful compact tool results and explicit failure lines.
- `runChatAgent()` returns a successful handled result with fallback text when tools completed but SSE synthesis produced no usable answer.
- The planning endpoint accepts only user/assistant messages and the seven known read-only tool names.

- [ ] **Step 1: Implement deterministic Agent fallback text**

Add `agentFallbackText()` near the Agent helpers. It must:

```text
1. Start with a bilingual warning that natural-language synthesis was unavailable.
2. For each successful result, include its headline and a fenced JSON block of the compact data.
3. For each failed result, include the tool name and error without inventing values.
4. Return a clear “no data was obtained” message when every tool failed.
```

- [ ] **Step 2: Use the deterministic fallback after synthesis failure**

After `streamAssistantReply()` returns `ok:false`, build the fallback text from `toolResults`, render it in the chat log as an assistant message, and return `{handled:true, ok:true, fullResponse:fallbackText}`. This prevents `applyPrompt()` from issuing a second generic LLM request that no longer contains tool results.

- [ ] **Step 3: Add the complete Phase 2 tool set to the planning prompt**

Update the Chinese and English planning rules to explicitly mention merchant, category, Tier, comparison, payment, and trend data. Keep the rule that conceptual questions should not call tools.

- [ ] **Step 4: Validate planning roles and tool names server-side**

Add the seven-name allowlist in `chat_agent_http.py`. Reject any client message whose role is not `user` or `assistant`, and reject any tool definition outside the allowlist with a 400 response. Keep the existing body-size and language validation.

- [ ] **Step 5: Run the focused backend and frontend tests**

Run:

```powershell
python scripts/test_agent_http.py
node scripts/test_chat_agent.mjs
```

Expected: all tests pass, including invalid-role/tool rejection and synthesis fallback preservation.

---

### Task 4: Synchronize Chat Mode documentation with Agent behavior

**Files:**
- Modify: `docs/chat-mode-analysis-types.md:11-35,403-446`
- Modify: `docs/chatbot-feature-report.md:1-80,480-540`
- Modify: `public/app.js:2555-2585,2698-2735`

- [ ] **Step 1: Replace the memory-only Chat Mode boundary**

Document that Chat Mode first attempts Agent planning and can query the seven read-only tools without a Report Mode memory item. Keep the memory bar as optional context for existing reports and follow-up discussion.

- [ ] **Step 2: Document the actual Agent limitations**

State that the current Agent is fixed-loop, read-only, frontend-executed, cache-backed for most tools, and may return estimated trends. List the unsupported domains: ASIN, recommendation, keyword, Publisher, Publisher Profile, multi-Tier comparison, and write actions.

- [ ] **Step 3: Update the bilingual in-product guide**

Change the Chat Mode prerequisite and Report Mode comparison rows so they no longer claim that structured data is impossible in Chat Mode. Explain that Report Mode remains the richer report/export path, while Chat Mode can now fetch compact analytical reports and synthesize them conversationally.

- [ ] **Step 4: Run the existing guide and source tests**

Run:

```powershell
node scripts/test_chatbot_welcome.mjs
node scripts/test_report_mode_guide.mjs
node scripts/test_zh_chatbot.mjs
node --check public/app.js
```

Expected: all commands exit 0.

---

### Task 5: Full verification and handoff

**Files:**
- No additional production files.

- [ ] **Step 1: Run all Agent-specific verification**

```powershell
node --check public/app.js
python scripts/test_llm_agent.py
python scripts/test_agent_http.py
python scripts/test_agent_config.py
python scripts/test_vercel_chat_routes.py
python -m py_compile chat_agent_http.py llm_provider.py api/chat/actions.py api/chat/stream.py
node scripts/test_chat_agent.mjs
```

- [ ] **Step 2: Run the relevant existing regression tests**

```powershell
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_report_mode_guide.mjs
git diff --check
```

- [ ] **Step 3: Inspect the final diff and working-tree boundary**

Confirm that only the planned Agent files, documentation, and tests changed. Preserve the existing Phase 2 plan and do not commit or push.

- [ ] **Step 4: Report verification limits explicitly**

Separate source/mock test evidence from browser, live-LLM, live-DB, and deployed Vercel verification. Do not claim the latter without running them.

## Self-review

- The plan covers the identified Phase 2 contract bugs, synthesis-loss failure, planner validation, and stale Chat Mode documentation.
- It deliberately leaves full ReAct, server-side tool execution, write actions, new domains, and cross-session memory outside this stabilization pass.
- Existing Report Mode comparison rendering remains backward compatible because the original two-entity `deltas` shape is preserved.
- No commit step is included because the repository instructions require explicit user authorization before commit or GitHub publication.
