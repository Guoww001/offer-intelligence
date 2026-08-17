# Chat Mode Agent Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Chat Mode Agent 从 2 个工具扩展到 5 个：`merchant_comparison`、`tier_analysis`、`category_comparison`、`payment_status`、`trend`，使 Agent 能主动取数回答多商户对比、Tier 分析、品类对比、付款查询与月度趋势问题。

**Architecture:** 沿用 Phase 1 的前端循环 + 后端 LLM function calling。全部新工具仍是现有 Report Mode 分析函数的一层薄包装（`analyzeMerchantComparison` / `analyzeTier` / `analyzeMultiCategory` / 支付查询 / `computeTrend`+DB 月度取数），通过 `agentExecuteTool` 注册、`compactAgentToolResult` 压缩。本阶段唯一协议改动：`agentExecuteTool` 改为 async（`trend` 需要 DB 取数），`runChatAgent` 与测试同步改为 `await`。

**Tech Stack:** Vanilla JS（`public/app.js` IIFE）、Node VM 沙箱测试（`scripts/test_chat_agent.mjs`，沿用 Phase 1 范式）。

**设计依据:** `docs/superpowers/specs/2026-08-14-chat-mode-agent-design.md` §9 Phase 2；工具口径来自 `docs/chat-mode-analysis-types.md`（多商户对比 §4、单 Tier §7、多品类 §6、付款 §12.2、趋势 §9）。用户已确认工具范围（5 个，排除多 Tier 对比）。

## Global Constraints

- Phase 1 的既有行为不变：`merchant_analysis`/`category_analysis` 的 schema、严格解析（精确+包含，无 fuzzy）、压缩、测试场景 1-6 全部保持。
- 工具参数契约：比较类工具拒绝 <2 个实体；`trend` 的 `months` 限制 2-24；付款行压缩 ≤30 条。
- 新工具的结果压缩同样遵循「白名单 + 数值规整 + 口径说明 + 勿重算」原则；单工具结果序列化 ≤6000 字符。
- 无新 npm/pip 依赖；不改 `server.py`/`api/chat/*`/`llm_provider.py`（本阶段纯前端 + 测试）。
- `public/app.js` 是 ~25.7k 行 IIFE：**永远不要整文件读取**，只按锚点文本插入/替换。
- **不做任何 git 提交/分支/暂存操作**（用户明确禁止）；改动仅留工作区。提交步骤一律跳过。
- 测试输出保持干净；`scripts/test_chat_agent.mjs` 的既有场景 1-6 的断言不得破坏（如场景 1/6 直接调用 `hooks.agentExecuteTool`，改为 `await` 后语义不变）。
- 每次验证命令在仓库根目录运行。

---

### Task 1: 平台改造（async 工具 + 严格解析助手 + 标签映射）+ 4 个同步工具

**Files:**
- Modify: `public/app.js`（agent 工具块内：新增 `agentResolveMerchantStrict`、`AGENT_TOOL_KIND_LABELS`/`agentToolKindLabel`；`agentExecuteTool` 改 async；新增 4 个工具分支与定义；`compactAgentToolResult` 增 4 类压缩与口径常量；`runChatAgent` 的标签行与执行行改用助手/await）
- Modify: `scripts/test_chat_agent.mjs`（既有场景 1/6 改 `await`；新增场景 7-10）

**Interfaces:**
- Consumes: `analyzeMerchantComparison`(5765)、`analyzeTier`(6034)、`analyzeMultiCategory`(6111)、`canonicalTierName`(1967)、`getPaymentRecords`(≈3900)、`updatePaymentSummary`(3943)、`isPaymentOverdue`(3934)、`monthNameFromText`(3435)、`paymentDueDate`、`agentRoundNumber`、`agentRoundMetrics`、`normalizedOfferName`(5556)、`offers`
- Produces:
  - `agentResolveMerchantStrict(name) -> offer|null`（精确相等或子串包含；无 fuzzy）
  - `agentToolKindLabel(name) -> string`（步骤卡片中文标签）
  - `async agentExecuteTool(name, args) -> Promise<{ok:true,data}|{ok:false,error}>`
  - `compactAgentToolResult(toolName, summary, language, opts?)` 支持 4 个新类型（opts 供 trend 使用，Task 2 消费）

- [ ] **Step 1: 追加失败测试（场景 7-10 + await 化）**

把 `scripts/test_chat_agent.mjs` 中两处直接调用 `hooks.agentExecuteTool(...)` 改为 `await hooks.agentExecuteTool(...)`（Test 1 的 `const result = hooks.agentExecuteTool("merchant_analysis", {...})` 与 Test 6 的两处调用）。然后在 `console.log("OK 6 scenarios")` 前插入：

```js
// ── Test 7: merchant_comparison（2 个真实商户 + notFound 上报） ──
{
  const nameA = hooks.firstOfferName();
  const secondOffer = sandbox.window.CHATBOT_DATA.offers[1] || null;
  const nameB = secondOffer ? (secondOffer.brand || secondOffer.merchantName) : nameA;
  const result = await hooks.agentExecuteTool("merchant_comparison", { merchants: [nameA, nameB] });
  assertTruthy(result.ok, "comparison of two real offers should succeed");
  assertTruthy(result.data.entities && result.data.entities.length >= 2, "comparison should carry entities");
  assertTruthy(result.data.headline, "comparison should carry headline");
  assertIncludes(result.data.note, "delta", "comparison note should explain deltas");
  const missing = await hooks.agentExecuteTool("merchant_comparison", { merchants: ["__agent_test_missing_a__", "__agent_test_missing_b__"] });
  assertEqual(missing.ok, false, "all-missing comparison should fail");
}

// ── Test 8: tier_analysis（取一个真实 Tier） ──
{
  const anyTier = sandbox.window.CHATBOT_DATA.offers[0].tier || "Tier 1";
  const result = await hooks.agentExecuteTool("tier_analysis", { tier: anyTier });
  assertTruthy(result.ok, "tier_analysis should succeed for " + anyTier);
  assertTruthy(result.data.aggregates && typeof result.data.merchantCount === "number", "tier analysis should carry aggregates");
  assertTruthy(result.data.headline, "tier analysis should carry headline");
  const bad = await hooks.agentExecuteTool("tier_analysis", { tier: "__agent_test_no_tier__" });
  assertEqual(bad.ok, false, "unknown tier should fail cleanly");
}

// ── Test 9: category_comparison（2 个真实品类） ──
{
  const catA = sandbox.window.CHATBOT_DATA.offers[0].mainCategory || sandbox.window.CHATBOT_DATA.offers[0].category || "Electronics";
  let catB = null;
  for (const o of sandbox.window.CHATBOT_DATA.offers) {
    const c = o.mainCategory || o.category;
    if (c && c !== catA) { catB = c; break; }
  }
  if (catB) {
    const result = await hooks.agentExecuteTool("category_comparison", { categories: [catA, catB] });
    assertTruthy(result.ok, "category comparison should succeed");
    assertTruthy(result.data.entities && result.data.entities.length >= 2, "category comparison should carry entities");
  } else {
    console.warn("WARN Test 9 skipped: fixture lacks a second category");
  }
  const bad = await hooks.agentExecuteTool("category_comparison", { categories: ["__agent_test_missing_cat__"] });
  assertEqual(bad.ok, false, "single/unknown category comparison should fail");
}

// ── Test 10: payment_status（真实付款记录汇总 + 状态过滤） ──
{
  const result = await hooks.agentExecuteTool("payment_status", {});
  assertTruthy(result.ok, "payment_status should succeed without filters");
  assertTruthy(result.data.summary && typeof result.data.summary.recordCount === "number", "payment summary should carry counts");
  assertTruthy(Array.isArray(result.data.rows), "payment rows should be an array");
  const overdue = await hooks.agentExecuteTool("payment_status", { status: "overdue" });
  assertTruthy(overdue.ok, "overdue filter should succeed");
  assertTruthy(overdue.data.rows.every(function (r) { return r.status !== "Paid"; }), "overdue rows must not be Paid");
}

console.log("OK 10 scenarios");
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/test_chat_agent.mjs`
Expected: FAIL（`agentResolveMerchantStrict`/`agentToolKindLabel` 未定义或新工具返回"未知工具"）；Test 7 报 `result.ok` 为 false 或函数未定义。

- [ ] **Step 3: 平台改造**

在 `agentExecuteTool` 函数（`public/app.js` 约 12904）**之前**插入：

```js
  // 商户严格解析：精确相等（品牌/商户名/商户ID）→ 子串包含；不启用 fuzzy 层。
  function agentResolveMerchantStrict(name) {
    if (!name) return null;
    var raw = String(name).trim();
    var lower = raw.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
    if (!lower) return null;
    var exact = offers.filter(function (o) {
      return normalizedOfferName(o, "brand") === lower ||
        normalizedOfferName(o, "merchantName") === lower ||
        String(o.merchantId || "").trim() === raw;
    })[0];
    if (exact) return exact;
    return offers.filter(function (o) {
      return normalizedOfferName(o, "brand").indexOf(lower) !== -1 ||
        normalizedOfferName(o, "merchantName").indexOf(lower) !== -1;
    })[0] || null;
  }

  var AGENT_TOOL_KIND_LABELS = {
    merchant_analysis: "商户", merchant_comparison: "商户对比",
    tier_analysis: "Tier", category_analysis: "品类",
    category_comparison: "品类对比", payment_status: "付款", trend: "趋势"
  };
  function agentToolKindLabel(name) {
    return AGENT_TOOL_KIND_LABELS[name] || "分析";
  }
```

在 `agentStepCopy` 定义附近（口径常量区）追加：

```js
  var AGENT_COMPARISON_NOTE_ZH = "对比为目标商户指标直接并列；deltas 以第一个商户为基准的差异（abs 与 pct）。无百分位、无样本门槛（与单商户分析口径不同）。数值为最终结果，直接引用，勿重算。";
  var AGENT_COMPARISON_NOTE_EN = "Comparison lists target merchants' metrics side by side; deltas are differences vs the first merchant (abs and pct). No percentiles, no sample gates (unlike single-merchant analysis). Values are final; quote, do not recompute.";
  var AGENT_TIER_NOTE_ZH = "Head=佣金前20%、Tail=后20%（商户过少时保证各至少1个）；vsOtherTiers 为各指标相对其他层级均值的差异；异常商户是诊断提示，非升降级决策规则。数值为最终结果，直接引用。";
  var AGENT_TIER_NOTE_EN = "Head=top 20% by commission, Tail=bottom 20% (each kept to at least 1 merchant when few); vsOtherTiers = metric deltas vs other tier averages; outlier merchants are diagnostic hints, not tier-move rules. Values are final; quote them.";
  var AGENT_CATEGORY_COMPARISON_NOTE_ZH = "平均值为商户级算术平均，非加权混合；支持可选 Tier 过滤；无百分位。数值为最终结果，直接引用。";
  var AGENT_CATEGORY_COMPARISON_NOTE_EN = "Averages are merchant-level arithmetic means, not weighted aggregates; optional tier filter; no percentiles. Values are final; quote them.";
  var AGENT_PAYMENT_NOTE_ZH = "状态：Paid/Pending/Unpaid/Partial；逾期=应付日已过且未付清（派生状态）；金额为原始货币。数值为最终结果，直接引用。";
  var AGENT_PAYMENT_NOTE_EN = "Statuses: Paid/Pending/Unpaid/Partial; overdue is derived (due date passed and not fully paid). Amounts in original currency. Values are final; quote them.";
```

把 `agentExecuteTool` 签名改为 `async function agentExecuteTool(name, args)`；`merchant_analysis` 分支的严格预检替换为对 `agentResolveMerchantStrict` 的调用（保持错误文案不变）：

```js
    if (name === "merchant_analysis") {
      var merchant = typeof args.merchant === "string" ? args.merchant.trim().slice(0, 80) : "";
      if (!merchant) return { ok: false, error: "merchant 参数缺失" };
      var strictOffer = agentResolveMerchantStrict(merchant);
      if (!strictOffer) return { ok: false, error: "未找到商户 '" + merchant + "'" };
      var summary = analyzeMerchant(merchant);
      if (!summary) return { ok: false, error: "未找到商户 '" + merchant + "'" };
      return { ok: true, data: compactAgentToolResult("merchant_analysis", summary, state.language || "zh") };
    }
```

在 `agentExecuteTool` 的 `category_analysis` 分支之后、`return { ok: false, error: "未知工具 ..." }` 之前插入 4 个分支：

```js
    if (name === "merchant_comparison") {
      var mList = Array.isArray(args.merchants)
        ? args.merchants.filter(function (x) { return typeof x === "string" && x.trim(); }).slice(0, 5)
        : [];
      if (mList.length < 2) return { ok: false, error: "merchants 至少需要 2 个商户" };
      var resolved = [];
      var notFound = [];
      mList.forEach(function (m) {
        var o = agentResolveMerchantStrict(m);
        if (o) resolved.push(o.brand || o.merchantName || m); else notFound.push(m);
      });
      if (resolved.length < 2) return { ok: false, error: "未找到足够的商户做对比：" + notFound.join("、") };
      var cmpSummary = analyzeMerchantComparison(resolved);
      if (!cmpSummary) return { ok: false, error: "无法生成商户对比结果" };
      return { ok: true, data: compactAgentToolResult("merchant_comparison", cmpSummary, state.language || "zh") };
    }
    if (name === "tier_analysis") {
      var tierRaw = typeof args.tier === "string" ? args.tier.trim() : "";
      var canonTier = canonicalTierName(tierRaw) || tierRaw;
      if (!canonTier) return { ok: false, error: "tier 参数缺失" };
      var tierSummary = analyzeTier(canonTier);
      if (!tierSummary) return { ok: false, error: "未找到层级 '" + canonTier + "'" };
      return { ok: true, data: compactAgentToolResult("tier_analysis", tierSummary, state.language || "zh") };
    }
    if (name === "category_comparison") {
      var cList = Array.isArray(args.categories)
        ? args.categories.filter(function (x) { return typeof x === "string" && x.trim(); }).slice(0, 4)
        : [];
      if (cList.length < 2) return { ok: false, error: "categories 至少需要 2 个品类" };
      var tierF = (typeof args.tier === "string" && args.tier.trim()) ? (canonicalTierName(args.tier) || args.tier.trim()) : null;
      var multiCat = analyzeMultiCategory(cList, tierF);
      if (!multiCat) return { ok: false, error: "未找到足够的品类数据做对比" };
      return { ok: true, data: compactAgentToolResult("category_comparison", multiCat, state.language || "zh") };
    }
    if (name === "payment_status") {
      var p = args || {};
      var statusArg = typeof p.status === "string" ? p.status.trim() : "";
      var monthArg = typeof p.month === "string" ? p.month.trim() : "";
      var tierArg = typeof p.tier === "string" ? p.tier.trim() : "";
      var payRows = getPaymentRecords();
      if (statusArg) {
        var stLower = statusArg.toLowerCase();
        var zhStatus = /逾期|到期/.test(statusArg) ? "overdue"
          : (/未付|没付|未支付/.test(statusArg) ? "unpaid"
          : (/待处理|未到期|等待/.test(statusArg) ? "pending"
          : (/已付|已支付/.test(statusArg) ? "paid"
          : (/部分/.test(statusArg) ? "partial" : ""))));
        var stFinal = zhStatus || stLower;
        if (stFinal === "overdue") payRows = payRows.filter(isPaymentOverdue);
        else if (["paid", "pending", "unpaid", "partial"].indexOf(stFinal) !== -1) {
          payRows = payRows.filter(function (r) { return String(r.paymentStatus || "").toLowerCase() === stFinal; });
        }
      }
      if (monthArg) {
        if (/^\d{4}-\d{2}$/.test(monthArg)) {
          payRows = payRows.filter(function (r) { return r.reportMonthKey === monthArg; });
        } else {
          var monthName = monthNameFromText(monthArg);
          if (monthName) payRows = payRows.filter(function (r) { return r.reportMonth === monthName; });
        }
      }
      if (tierArg) {
        var payTier = canonicalTierName(tierArg) || tierArg;
        payRows = payRows.filter(function (r) { return r.tier === payTier; });
      }
      payRows = payRows.slice(0, 60);
      var paySummary = updatePaymentSummary(payRows);
      var compactPay = {
        tool: "payment_status",
        filter: { status: statusArg || null, month: monthArg || null, tier: tierArg || null },
        summary: {
          recordCount: paySummary.recordCount, merchantCount: paySummary.merchantCount,
          unpaid: paySummary.unpaidMerchantCount, pending: paySummary.pendingMerchantCount,
          paid: paySummary.paidMerchantCount, overdue: paySummary.overdueMerchantCount,
          totalExpected: agentRoundNumber(paySummary.totalExpectedPayment),
          totalRemaining: agentRoundNumber(paySummary.totalRemainingAmount)
        },
        rows: payRows.slice(0, 30).map(function (r) {
          return {
            merchant: r.merchantName, tier: r.tier, month: r.reportMonthKey || r.reportMonth,
            status: r.paymentStatus, cycle: r.paymentCycle,
            expected: agentRoundNumber(r.expectedPaymentAmount), remaining: agentRoundNumber(r.remainingAmount),
            due: r.paymentAvailabilityDate || r.expectedPaymentDate || ""
          };
        })
      };
      compactPay.headline = "付款记录 " + compactPay.summary.recordCount + " 条 / " + compactPay.summary.merchantCount
        + " 商户（未付 " + compactPay.summary.unpaid + " · 逾期 " + compactPay.summary.overdue + "）";
      compactPay.note = state.language === "en" ? AGENT_PAYMENT_NOTE_EN : AGENT_PAYMENT_NOTE_ZH;
      return { ok: true, data: compactPay };
    }
```

`agentToolDefinitions()` 数组末尾（`category_analysis` 定义之后、`];` 之前）追加 4 条：

```js
      {
        name: "merchant_comparison",
        description: "对比 2-5 个商户的核心指标（EPC/AOV/CVR/Orders/Clicks/佣金/佣金率/Sales），返回各商户指标并列、相对第一个商户的差异(deltas)与付款风险。参数 merchants 为品牌名或商户ID数组。",
        parameters: {
          type: "object",
          properties: { merchants: { type: "array", items: { type: "string" }, description: "商户名数组，至少 2 个" } },
          required: ["merchants"]
        }
      },
      {
        name: "tier_analysis",
        description: "获取单个 Tier 的汇总：商户数、总量、平均 EPC/AOV/CVR/佣金率、与其他 Tier 的指标对比、Head/Mid/Tail 分段、异常商户（EPC>3x 或 CVR>2x 同级均值）。参数 tier 如 Tier 1/Tier 2/Tier 3/Tier 4/BLACK TIER。",
        parameters: {
          type: "object",
          properties: { tier: { type: "string", description: "层级名，如 Tier 2" } },
          required: ["tier"]
        }
      },
      {
        name: "category_comparison",
        description: "对比 2-4 个品类的汇总：商户数、总Revenue/Commission/Clicks/Orders、平均 EPC/AOV/CVR/佣金率、各品类 Top5 商户。可选按 Tier 过滤。参数 categories 为品类名数组。",
        parameters: {
          type: "object",
          properties: {
            categories: { type: "array", items: { type: "string" }, description: "品类名数组，至少 2 个" },
            tier: { type: "string", description: "可选：只比较该 Tier，如 Tier 2" }
          },
          required: ["categories"]
        }
      },
      {
        name: "payment_status",
        description: "查询付款记录：可按状态（paid/pending/unpaid/overdue/partial 或中文 已付款/待处理/未付款/逾期/部分付款）、月份（YYYY-MM，如 2025-04）、Tier、商户过滤。返回汇总计数与记录列表。",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", description: "可选：paid/pending/unpaid/overdue/partial" },
            month: { type: "string", description: "可选：YYYY-MM，如 2025-04" },
            tier: { type: "string", description: "可选：Tier 名" },
            merchant: { type: "string", description: "可选：商户名（预留，当前按无此过滤处理）" }
          }
        }
      },
```

`compactAgentToolResult` 的 `if (toolName === "category_analysis") {...}` 分支之后、`return summary;` 之前追加 4 类压缩：

```js
    if (toolName === "merchant_comparison") {
      var outC = {
        tool: "merchant_comparison",
        entities: (summary.entities || []).map(function (e) {
          return {
            name: e.name, tier: e.tier, category: e.category,
            paymentRisk: e.paymentRisk || null,
            metrics: agentRoundMetrics(e.metrics || {})
          };
        }),
        notFound: summary.notFound || null,
        deltas: {}
      };
      Object.keys(summary.deltas || {}).forEach(function (f) {
        var d = summary.deltas[f];
        outC.deltas[f] = { abs: agentRoundNumber(d.abs), pct: d.pct === null ? null : Math.round(d.pct), better: d.better };
      });
      outC.headline = outC.entities.map(function (e) { return e.name; }).join(" vs ");
      outC.note = state.language === "en" ? AGENT_COMPARISON_NOTE_EN : AGENT_COMPARISON_NOTE_ZH;
      if (JSON.stringify(outC).length > AGENT_MAX_RESULT_CHARS) {
        outC.deltas = null;
      }
      return outC;
    }
    if (toolName === "tier_analysis") {
      var outT = {
        tool: "tier_analysis",
        tier: summary.target && summary.target.name,
        merchantCount: (summary.target && summary.target.merchantCount) || 0,
        aggregates: agentRoundMetrics(summary.aggregates || {}),
        vsOtherTiers: {},
        segments: summary.segments || null,
        outliers: (summary.outliers || []).slice(0, 5)
      };
      Object.keys(summary.vsOtherTiers || {}).forEach(function (t) {
        outT.vsOtherTiers[t] = {};
        Object.keys(summary.vsOtherTiers[t] || {}).forEach(function (f) {
          var row = summary.vsOtherTiers[t][f];
          outT.vsOtherTiers[t][f] = { self: agentRoundNumber(row.self), other: agentRoundNumber(row.other), delta: row.delta === null ? null : Math.round(row.delta) };
        });
      });
      outT.headline = outT.tier + "（" + outT.merchantCount + " 个商户）";
      outT.note = state.language === "en" ? AGENT_TIER_NOTE_EN : AGENT_TIER_NOTE_ZH;
      return outT;
    }
    if (toolName === "category_comparison") {
      var outCC = {
        tool: "category_comparison",
        tierFilter: (summary.target && summary.target.tierFilter) || null,
        entities: (summary.entities || []).map(function (e) {
          return {
            name: e.name, merchantCount: e.merchantCount,
            totals: agentRoundMetrics(e.totals || {}), averages: agentRoundMetrics(e.averages || {}),
            topBrands: (e.topBrands || []).slice(0, 3)
          };
        })
      };
      outCC.headline = outCC.entities.map(function (e) { return e.name; }).join(" vs ") + "（品类对比）";
      outCC.note = state.language === "en" ? AGENT_CATEGORY_COMPARISON_NOTE_EN : AGENT_CATEGORY_COMPARISON_NOTE_ZH;
      return outCC;
    }
```

`runChatAgent` 中两处改动：
1. 步骤卡片标签行（现为 `var kind = call.name === "category_analysis" ? "品类" : "商户";`）改为 `var kind = agentToolKindLabel(call.name);`
2. 工具执行行（现为 `var result = agentExecuteTool(call.name, call.arguments || {});`）改为 `var result = await agentExecuteTool(call.name, call.arguments || {});`

- [ ] **Step 4: 运行确认通过**

Run: `node scripts/test_chat_agent.mjs`
Expected: `OK 10 scenarios`

- [ ] **Step 5: 回归**

Run: `node --check public/app.js && node scripts/test_chatbot_intent_flow.mjs && node scripts/test_zh_chatbot.mjs`
Expected: 全部通过

- [ ] **Step 6: Commit（跳过——本会话禁止 git 操作）**

---

### Task 2: `trend` 异步工具（商户/品类/Tier 三条取数路径 + 估算降级）

**Files:**
- Modify: `public/app.js`（`agentExecuteTool` 的 trend 分支 + `agentRunTrendTool` + trend 压缩与口径常量 + `agentToolDefinitions` 追加 trend）
- Modify: `scripts/test_chat_agent.mjs`（新增场景 11-12）

**Interfaces:**
- Consumes: `findLiveOffer`(5615)、`fetchMerchantMetrics`(6524)、`fetchCategoryTrendMetrics`(7020)、`fetchAggregatedMonthlyMetrics`(6956)、`timeoutPromise`(6946)、`estimateAggregatedTrend`(7058)、`generateTrendFromOfferSummary`(5907)、`computeTrend`(5822)、`detectTrendEntityType`(6587)、`offersInCategory`/`offersInTier`、`isTier4OrBlack`(5638)
- Produces: `agentRunTrendTool(args) -> Promise<{ok,data}|{ok,false,error}>`；`compactAgentToolResult("trend", summary, language, {target, entityType, estimated, metric})` 输出 `{tool, entityType, target, estimated, metric, metrics, months, summary, headline, note}`

- [ ] **Step 1: 追加失败测试（场景 11-12）**

在 `scripts/test_chat_agent.mjs` 的 `console.log("OK 10 scenarios")` 前插入：

```js
// ── Test 11: trend 商户路径（mock DB 月度数据） ──
{
  const name = hooks.firstOfferName();
  const offer = sandbox.window.CHATBOT_DATA.offers[0];
  const mockMonthly = [
    { month: "2026-04", revenue: 1000, orders: 50, clicks: 500, payout: 100, affiliatePayout: 100 },
    { month: "2026-05", revenue: 1200, orders: 60, clicks: 600, payout: 120, affiliatePayout: 120 }
  ];
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () { return { ok: true, content: null, finishReason: "tool_calls", toolCalls: [] }; } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, merchantId: offer.merchantId, monthlyAmazonMetrics: mockMonthly }; } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  const result = await hooks.agentExecuteTool("trend", { entityType: "merchant", target: name, months: 2 });
  assertTruthy(result.ok, "merchant trend should succeed with mocked DB data");
  assertTruthy(result.data.months && result.data.months.length >= 2, "trend should carry monthly rows");
  assertEqual(result.data.estimated, false, "real monthly data is not estimated");
  assertTruthy(result.data.summary && result.data.summary.revenue, "trend summary should carry revenue delta");
  assertEqual(result.data.entityType, "merchant", "entityType should be merchant");
}

// ── Test 12: trend 商户估算降级（DB 返回 null） ──
{
  const name = hooks.firstOfferName();
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: null }; } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  const result = await hooks.agentExecuteTool("trend", { entityType: "merchant", target: name, months: 2 });
  assertTruthy(result.ok, "merchant trend should degrade to estimate when DB returns null");
  assertEqual(result.data.estimated, true, "fallback must be flagged estimated");
  assertTruthy(result.data.months && result.data.months.length >= 2, "estimated trend should still carry months");
}

console.log("OK 12 scenarios");
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/test_chat_agent.mjs`
Expected: FAIL（`agentRunTrendTool` 未定义 / trend 返回"未知工具"）

- [ ] **Step 3: 实现**

口径常量（追加到 Task 1 的常量区）：

```js
  var AGENT_TREND_NOTE_ZH = "需要至少 2 个月数据；estimated=true 表示基于当前汇总的估算（非真实月度），只能作方向参考。品类趋势排除 Tier 4/BLACK TIER。趋势口径：EPC=affiliatePayout/clicks，AOV=revenue/orders。数值为最终结果，直接引用。";
  var AGENT_TREND_NOTE_EN = "Requires at least 2 months; estimated=true means derived from current totals (not real monthly data), directional only. Category trends exclude Tier 4/BLACK TIER. Trend metrics: EPC=affiliatePayout/clicks, AOV=revenue/orders. Values are final; quote them.";
```

`agentExecuteTool` 的 `payment_status` 分支之后、未知工具兜底之前插入：

```js
    if (name === "trend") {
      return agentRunTrendTool(args || {});
    }
```

`agentExecuteTool` 之后追加 `agentRunTrendTool`：

```js
  async function agentRunTrendTool(args) {
    var target = typeof args.target === "string" ? args.target.trim().slice(0, 80) : "";
    var monthsArg = typeof args.months === "number" ? args.months
      : (typeof args.months === "string" ? parseInt(args.months, 10) : 0);
    var metric = typeof args.metric === "string" ? args.metric.trim().toLowerCase() : "";
    var entityType = typeof args.entityType === "string" ? args.entityType.trim().toLowerCase() : "";
    if (!target) return { ok: false, error: "target 参数缺失（商户名/品类名/Tier 名）" };
    if (monthsArg && (monthsArg < 2 || monthsArg > 24)) monthsArg = 0;
    var requested = monthsArg > 0 ? monthsArg : 12;
    var language = state.language || "zh";

    function estimatedResult(summary, entity, label) {
      return {
        ok: true,
        data: compactAgentToolResult("trend", summary, language, {
          target: label, entityType: entity, estimated: true, metric: metric
        })
      };
    }

    var entity = entityType || detectTrendEntityType(target);
    var monthlyMetrics = null;
    var label = target;

    if (entity === "merchant") {
      var offer = findLiveOffer(target);
      if (!offer) return { ok: false, error: "未找到商户 '" + target + "' 的数据" };
      label = offer.brand || offer.merchantName || target;
      var payload = await fetchMerchantMetrics(offer.merchantId, requested);
      monthlyMetrics = payload && Array.isArray(payload.monthlyAmazonMetrics) ? payload.monthlyAmazonMetrics : null;
      if (!monthlyMetrics || monthlyMetrics.length < 2) {
        var basic = generateTrendFromOfferSummary(offer, requested);
        if (basic) return estimatedResult(basic, "merchant", label);
        return { ok: false, error: "商户 '" + label + "' 的月度数据不足（需要至少 2 个月）" };
      }
    } else if (entity === "category") {
      var catMetrics = await fetchCategoryTrendMetrics(target, requested);
      if (catMetrics && catMetrics.length >= 2) {
        monthlyMetrics = catMetrics;
      } else {
        var est = estimateAggregatedTrend(offersInCategory(target, { excludeTier4Black: true }), requested);
        if (est) return estimatedResult(est, "category", target);
        return { ok: false, error: "品类 '" + target + "' 的趋势数据不足（需要至少 2 个月）" };
      }
    } else if (entity === "tier") {
      var tierOffers = offersInTier(target);
      if (!tierOffers || !tierOffers.length) return { ok: false, error: "未找到层级 '" + target + "' 的数据" };
      label = target;
      monthlyMetrics = await timeoutPromise(fetchAggregatedMonthlyMetrics(tierOffers, requested), 8000, null);
      if (!monthlyMetrics || monthlyMetrics.length < 2) {
        var tEst = estimateAggregatedTrend(tierOffers, requested);
        if (tEst) return estimatedResult(tEst, "tier", target);
        return { ok: false, error: "层级 '" + target + "' 的趋势数据不足（需要至少 2 个月）" };
      }
    } else {
      return { ok: false, error: "无法识别目标类型：" + (entityType || "未知") };
    }

    var summary = computeTrend(monthlyMetrics, metric);
    if (!summary) return { ok: false, error: "无法计算趋势（需要至少 2 个月的月度数据）" };
    summary.target = label;
    return { ok: true, data: compactAgentToolResult("trend", summary, language, {
      target: label, entityType: entity, estimated: false, metric: metric
    }) };
  }
```

`compactAgentToolResult` 签名改为 `function compactAgentToolResult(toolName, summary, language, opts)`，并在 `category_comparison` 压缩之后、`return summary;` 之前插入：

```js
    if (toolName === "trend") {
      var o = opts || {};
      var outTr = {
        tool: "trend",
        entityType: o.entityType || summary.entityType || "merchant",
        target: o.target || summary.target || "unknown",
        estimated: !!o.estimated || !!summary.estimated,
        metric: o.metric || null,
        metrics: summary.metrics || [],
        months: (summary.months || []).map(function (m) {
          var row = { month: m.month };
          (summary.metrics || []).forEach(function (k) { row[k] = agentRoundNumber(m[k]); });
          return row;
        }),
        summary: {}
      };
      Object.keys(summary.summary || {}).forEach(function (k) {
        var s = summary.summary[k];
        outTr.summary[k] = {
          first: agentRoundNumber(s.first), last: agentRoundNumber(s.last),
          abs: agentRoundNumber(s.abs), pct: s.pct === null ? null : Math.round(s.pct), dir: s.dir
        };
      });
      outTr.headline = outTr.target + " 趋势" + (outTr.metric ? " · " + outTr.metric : "")
        + (outTr.estimated ? " · 估算" : "");
      outTr.note = language === "en" ? AGENT_TREND_NOTE_EN : AGENT_TREND_NOTE_ZH;
      return outTr;
    }
```

`agentToolDefinitions()` 末尾追加：

```js
      {
        name: "trend",
        description: "获取商户/品类/Tier 的月度趋势（Revenue/Orders/Clicks/EPC/AOV/Payout 等），返回逐月数值与首末月变化。参数 entityType 为 merchant/category/tier（可省略，自动识别）；target 为目标名；months 为月数（2-24，默认 12）；metric 可选（如 revenue）。DB 无月度数据时返回估算趋势（estimated=true）。",
        parameters: {
          type: "object",
          properties: {
            entityType: { type: "string", description: "可选：merchant/category/tier" },
            target: { type: "string", description: "商户名/品类名/Tier 名，如 Shokz / Electronics / Tier 2" },
            months: { type: "number", description: "可选：月数 2-24，默认 12" },
            metric: { type: "string", description: "可选：指标名，如 revenue/orders/epc/aov/clicks" }
          },
          required: ["target"]
        }
      },
```

- [ ] **Step 4: 运行确认通过**

Run: `node scripts/test_chat_agent.mjs`
Expected: `OK 12 scenarios`

- [ ] **Step 5: 回归**

Run: `node --check public/app.js && node scripts/test_chatbot_intent_flow.mjs && node scripts/test_zh_chatbot.mjs`
Expected: 全部通过

- [ ] **Step 6: Commit（跳过——本会话禁止 git 操作）**

---

### Task 3: 全量验证 + 文档 + 收尾

**Files:**
- Modify: `docs/chatbot-feature-report.md`（Phase 2 备注行）
- Run: 全量验证命令

- [ ] **Step 1: 文档备注**

`docs/chatbot-feature-report.md` 的 Phase 1 Agent 备注块之后追加一行：

```markdown
> Phase 2（2026-08-14）：Agent 工具扩展至 5 个 —— `merchant_comparison`/`tier_analysis`/`category_comparison`/`payment_status`/`trend`（多 Tier 对比未纳入）。
```

- [ ] **Step 2: 全量验证**

Run（仓库根目录）：

```bash
node --check public/app.js
python scripts/test_llm_agent.py
python scripts/test_agent_http.py
python scripts/test_agent_config.py
python scripts/test_vercel_chat_routes.py
python scripts/test_llm_stream_timeout.py
node scripts/test_chat_agent.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_intent_flow.mjs
```

Expected: 全部通过；`test_chat_agent.mjs` 输出 `OK 12 scenarios`。

- [ ] **Step 3: 手动冒烟（可选）**

`python server.py` 后浏览器输入「Tier 2 整体表现如何」「哪些商户逾期未付款」「Shokz 近三个月趋势」「Shokz 和 Soundcore 谁更好」验证。完成后必须关闭服务器（前台 `Ctrl+C`，或 `netstat -ano | grep 8765 | grep LISTEN` + `taskkill //F //PID <PID>`）。

- [ ] **Step 4: Commit（跳过——本会话禁止 git 操作）**

---

## 自审记录

**Spec 覆盖**：设计文档 §9 Phase 2 的工具清单（排除用户未选的多 Tier 对比）→ Task 1/2；口径全部来自 `chat-mode-analysis-types.md`（§4 多商户、§6 多品类、§7 Tier、§9 趋势、§12.2 付款）并写入工具描述与压缩口径块。既有 Phase 1 契约（严格解析、压缩原则、循环上限、降级链）不变。

**占位符扫描**：无 TBD/TODO；所有代码块完整；锚点均为唯一锚文本（函数名/现有代码行）。

**类型一致性**：`agentExecuteTool` 改 async 后，Task 1 Step 3 的 `runChatAgent` await 修改与 Task 2 的 trend 分支返回 Promise 一致；`compactAgentToolResult` 第 4 参 `opts` 只在 trend 分支消费，其他分支忽略；`agentResolveMerchantStrict` 返回 offer|null 与 merchant_analysis/comparison 消费一致；`agentToolKindLabel` 覆盖全部 7 个工具名。

**已知风险（留给任务审查）**：
- `segments` 结构透传（`segmentedStats` 返回值未在本计划中逐字段压缩，交给 LLM 时保持原结构）。
- Test 9 的品类 B 依赖 fixture 数据包含 ≥2 个品类；缺失时 WARN 跳过（已处理）。
- `payment_status` 的 `merchant` 参数为预留（当前忽略），描述中已注明。
