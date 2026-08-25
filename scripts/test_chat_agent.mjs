import fs from "node:fs";
import vm from "node:vm";
import { TextDecoder } from "node:util";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack, needle, label) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new Error(`${label}: expected to include ${JSON.stringify(needle)}, got ${JSON.stringify(haystack).slice(0, 300)}`);
  }
}

function createTestElement() {
  return {
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); },
    insertBefore(child) { this.children.unshift(child); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    setAttribute(name, value) {
      this.attributes = this.attributes || {};
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes ? this.attributes[name] : undefined;
    },
    removeAttribute(name) {
      if (this.attributes) delete this.attributes[name];
    },
    style: {},
    remove() { this.removed = true; },
    textContent: "",
    innerHTML: "",
    open: false
  };
}

const elementStub = createTestElement();

let mockFetchImpl = null;
let fetchCalls = [];
let intervalDelays = [];

const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  TextDecoder, AbortSignal, setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return createTestElement(); }
  },
  fetch: async function (url, init) {
    fetchCalls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (!mockFetchImpl) throw new Error("no mockFetchImpl for " + url);
    return mockFetchImpl(String(url), fetchCalls[fetchCalls.length - 1]);
  },
  setInterval(_callback, delay) { intervalDelays.push(delay); return intervalDelays.length; },
  clearInterval() {}
};
sandbox.window.document = sandbox.document;

const _offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: _offersCache.summary || {},
  offers: _offersCache.offers || [],
  paymentRecords: _offersCache.paymentRecords || [],
  sources: { mode: "db", month: _offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: _offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
const _kwCache = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
sandbox.window.PRODUCT_KEYWORDS = _kwCache;
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");
assertTruthy(hooks.agentExecuteTool, "agentExecuteTool hook missing");
assertTruthy(hooks.runChatAgent, "runChatAgent hook missing");
assertTruthy(hooks.createAgentExecutionTimeline, "createAgentExecutionTimeline hook missing");

const firstOffer = hooks.firstOfferName();
assertTruthy(firstOffer, "fixture offers must not be empty");
const merchantTargets = Array.from(new Map(
  sandbox.window.CHATBOT_DATA.offers
    .filter((offer) => offer && offer.merchantId)
    .map((offer) => [String(offer.merchantId), offer])
)).slice(0, 7).map(([merchantId, offer]) =>
  merchantId + " " + (offer.brand || offer.merchantName || merchantId)
);
assertTruthy(merchantTargets.length >= 7, "fixture offers must contain seven unique merchants");

function sseResponse(bodyText) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(bodyText);
  return {
    ok: true,
    status: 200,
    body: {
      getReader: function () {
        let done = false;
        return {
          read: async function () {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: bytes };
          }
        };
      }
    }
  };
}

const chatLogStub = { nodes: [], appendChild(node) { this.nodes.push(node); }, scrollTop: 0, scrollHeight: 0 };

// ── Execution timeline contract ──
{
  const timelineLog = { nodes: [], appendChild(node) { this.nodes.push(node); }, scrollTop: 0, scrollHeight: 0 };
  const timerCountBeforeTimeline = intervalDelays.length;
  const timeline = hooks.createAgentExecutionTimeline(timelineLog, "zh");
  assertTruthy(timeline && timeline.root, "timeline should create a root details element");
  assertEqual(intervalDelays[timerCountBeforeTimeline], 100, "timeline elapsed time should refresh every 0.1 seconds");
  assertEqual(timeline.root.open, true, "timeline should stay open while running");
  const step = timeline.addStep({ status: "running", label: "规划查询", detail: "识别月份范围" });
  assertEqual(timeline.root.getAttribute("aria-live"), "polite", "running timeline should announce progress updates");
  assertEqual(step.getAttribute("aria-current"), "step", "running step should be exposed as the current step");
  assertIncludes(step._meta.textContent, "已用时", "running step should show live elapsed time instead of a static status");
  timeline.updateStep(step, { status: "done", label: "规划查询", detail: "最近 12 个月", elapsedMs: 1200 });
  assertIncludes(step.className, "agent-run-step-done", "completed step should expose done state");
  timeline.finish("done", 2400);
  assertEqual(timeline.root.open, false, "completed timeline should collapse");

  const stoppedStep = timeline.addStep({ status: "running", label: "数据查询", detail: "正在读取月度数据" });
  timeline.finish("stopped", 3100);
  assertEqual(stoppedStep.getAttribute("data-status"), "stopped", "stopped timeline should close active step");
}

// ── Agent stop state ──
{
  const controller = new AbortController();
  controller.abort();
  const stopped = await hooks.runChatAgent("停止测试", {
    language: "zh",
    chatLogEl: chatLogStub,
    memoryText: "",
    history: [],
    viewContext: null,
    executionTimeline: true,
    signal: controller.signal
  });
  assertEqual(stopped.handled, true, "aborted Agent run should be handled");
  assertEqual(stopped.stopped, true, "aborted Agent run should report stopped");
}

// ── Agent conceptual follow-up should answer directly without planning tools ──
{
  assertEqual(hooks.agentShouldBypassPlanning("你是按什么指标推荐的"), true,
    "methodology follow-up should be classified as direct answer");
  assertEqual(hooks.agentShouldBypassPlanning("为什么推荐 Tier 2"), true,
    "methodology follow-up may mention a Tier without requesting new data");
  assertEqual(hooks.agentShouldBypassPlanning("请推荐10个 Tier 2 商户并列出 EPC"), false,
    "a concrete Tier merchant request must keep the planning path");
  fetchCalls = [];
  chatLogStub.nodes = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      throw new Error("conceptual follow-up must not call the planning endpoint");
    }
    return sseResponse('data: {"token":"推荐依据包括 EPC、佣金率和转化率"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("你是按什么指标推荐的", {
    language: "zh",
    chatLogEl: chatLogStub,
    memoryText: "",
    history: [{ role: "assistant", content: "刚才已经给出了一组推荐商户" }],
    viewContext: null,
    executionTimeline: true
  });
  assertEqual(outcome.handled, true, "conceptual follow-up should be handled directly");
  assertEqual(outcome.ok, true, "conceptual follow-up direct stream should succeed");
  assertEqual(fetchCalls.some((call) => call.url.indexOf("/api/chat/agent") === 0), false,
    "conceptual follow-up must not call the Agent planning endpoint");
  assertTruthy(fetchCalls.some((call) => call.url.indexOf("/api/chat/stream") === 0),
    "conceptual follow-up should use the normal streaming answer endpoint");
  assertIncludes(outcome.fullResponse, "EPC", "conceptual follow-up should preserve the direct answer");
  const directTimeline = chatLogStub.nodes.find((node) => String(node.className || "").indexOf("agent-run-timeline") !== -1);
  assertTruthy(directTimeline, "conceptual follow-up should still expose a direct-answer timeline");
  assertIncludes(directTimeline.className, "agent-run-timeline-done", "direct-answer timeline should complete without planning");
}

// ── Test 0b: 具体数据问题没有可验证来源时不得采用规划模型直答 ──
{
  const prompt = "Shokz（商户 ID 123）当前 EPC 是多少？";
  assertEqual(hooks.agentPromptRequiresVerifiableData(prompt), true,
    "concrete EPC lookup should require a verifiable data source");
  assertEqual(hooks.agentPromptRequiresVerifiableData("什么是 EPC？"), false,
    "metric definition should remain a methodology question");
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: "模型猜测 EPC 为 9.99", toolCalls: [], finishReason: "stop" };
      } };
    }
    throw new Error("missing-data guard must not fall back to the normal stream");
  };
  const outcome = await hooks.runChatAgent(prompt, {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "missing-data guard should handle the request");
  assertEqual(outcome.ok, true, "missing-data guard should return a safe answer");
  assertEqual(outcome.dataUnavailable, true, "missing-data guard should mark data as unavailable");
  assertIncludes(outcome.directContent, "可验证", "safe answer should explain the missing verifiable source");
  assertEqual(fetchCalls.length, 1, "missing-data guard should only need the planning response");
}

// ── Test 0c: 已有数据上下文或用户提供数值时允许继续回答 ──
{
  const prompt = "Shokz 当前 EPC 是多少？";
  const planContent = "根据已加载的报告上下文，Shokz 的 EPC 为 1.23。";
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: planContent, toolCalls: [], finishReason: "stop" };
      } };
    }
    throw new Error("existing data context should not call the normal stream");
  };
  const contextualOutcome = await hooks.runChatAgent(prompt, {
    language: "zh", chatLogEl: chatLogStub,
    memoryText: "报告快照：Shokz EPC 为 1.23，数据月份为 2026-08。",
    history: [], viewContext: null
  });
  assertEqual(contextualOutcome.directContent, planContent,
    "structured data context should allow the planner content");
  assertEqual(contextualOutcome.dataUnavailable || false, false,
    "structured data context should not be marked unavailable");

  assertEqual(hooks.agentPromptRequiresVerifiableData("EPC 1.23 是否值得继续？"), true,
    "metric interpretation should still be recognized as a data question");
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: "EPC 1.23 可以作为当前输入值进行解释。", toolCalls: [], finishReason: "stop" };
      } };
    }
    throw new Error("user-provided metric should not call the normal stream");
  };
  const userDataOutcome = await hooks.runChatAgent("EPC 1.23 是否值得继续？", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertIncludes(userDataOutcome.directContent, "1.23", "user-provided metric should remain answerable");
  assertEqual(userDataOutcome.dataUnavailable || false, false,
    "user-provided metric should not be marked unavailable");
}

// ── Test 0d: 具体数据问题规划失败时也不得回退为无来源直答 ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) throw new Error("planner unavailable");
    throw new Error("planner failure must not fall back to the normal stream");
  };
  const outcome = await hooks.runChatAgent("Shokz 当前 EPC 是多少？", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "planner failure should still be safely handled for data questions");
  assertEqual(outcome.dataUnavailable, true, "planner failure should mark data as unavailable");
  assertIncludes(outcome.directContent, "重试", "planner failure should ask the user to retry or provide data");
  assertEqual(fetchCalls.length, 1, "planner failure should not call the normal stream");
}

// ── Test 1: merchant_analysis 工具直接执行 ──
{
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  const result = await hooks.agentExecuteTool("merchant_analysis", { merchant: firstOffer });
  assertTruthy(result.ok, "merchant_analysis should succeed for firstOffer");
  assertTruthy(result.data.ranks, "compact result should keep ranks");
  assertTruthy(result.data.headline, "compact result should carry headline");
  assertIncludes(result.data.note, "EPC", "note should carry metric definitions");
  const missing = await hooks.agentExecuteTool("merchant_analysis", { merchant: "__agent_test_missing_merchant__" });
  assertEqual(missing.ok, false, "unknown merchant should fail cleanly");
  hooks.resetAgentTrendCache();
}

// ── Test 1b: ID + 商户名时优先使用商户 ID ──
{
  const targetOffer = sandbox.window.CHATBOT_DATA.offers.find((offer) => String(offer.merchantId) === "362342");
  assertTruthy(targetOffer, "ID-priority fixture should contain merchant 362342");
  const targetName = targetOffer.brand || targetOffer.merchantName;
  const combined = await hooks.agentExecuteTool("merchant_analysis", { merchant: `362342 ${targetName}` });
  assertTruthy(combined.ok, "ID + merchant name should resolve by ID");
  assertEqual(combined.data.merchant, targetName, "ID + merchant name should return the ID-matched merchant");

  const conflictingName = await hooks.agentExecuteTool("merchant_analysis", { merchant: `362342 __agent_test_other_name__` });
  assertTruthy(conflictingName.ok, "ID should take priority over a conflicting merchant name");
  assertEqual(conflictingName.data.merchant, targetName, "ID-priority lookup should ignore the conflicting name");
}

// ── Test 2: 规划 → 执行 → 综合全链路 ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: firstOffer } }] };
      } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: {"token":"OK"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("Shokz 在同品类的表现", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should handle the prompt");
  assertEqual(outcome.ok, true, "agent run should succeed");
  assertEqual(outcome.fullResponse, "OK", "synthesis tokens should accumulate");
  assertEqual(fetchCalls.length, 3, "expect one plan call, one monthly data call, and one synthesis call");
  assertIncludes(JSON.stringify(fetchCalls[2].body), "merchant_analysis", "synthesis body should carry tool result");
}

// ── Test 2a: 超过 4 个工具调用应拆批执行而不是静默截断 ──
{
  hooks.resetAgentTrendCache();
  fetchCalls = [];
  const sixCalls = Array.from({ length: 6 }, (_, index) => ({
    id: `merchant-${index + 1}`,
    name: "merchant_analysis",
    arguments: { merchant: merchantTargets[index] }
  }));
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls", toolCalls: sixCalls };
      } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: {"token":"六个查询完成"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("分别查询六个商户的表现", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.ok, true, "six planned tool calls should succeed");
  assertEqual(
    fetchCalls.filter((call) => call.url.indexOf("/api/ui/db/merchant") === 0).length,
    6,
    "six planned tool calls should all execute in 4+2 batches"
  );
  const synthesisBody = JSON.stringify(fetchCalls[fetchCalls.length - 1].body);
  assertEqual((synthesisBody.match(/merchant_analysis/g) || []).length >= 6, true,
    "synthesis body should include all six tool results");
}

// ── Test 2b: 超过总预算时必须明确报告未执行目标 ──
{
  hooks.resetAgentTrendCache();
  fetchCalls = [];
  const sevenCalls = Array.from({ length: 7 }, (_, index) => ({
    id: `merchant-budget-${index + 1}`,
    name: "merchant_analysis",
    arguments: { merchant: merchantTargets[index] }
  }));
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls", toolCalls: sevenCalls };
      } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: {"token":"预算测试完成"}\n\ndata: [DONE]\n\n');
  };
  const partialOutcome = await hooks.runChatAgent("分别查询七个商户的表现", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(partialOutcome.ok, true, "partial tool run should still synthesize an answer");
  assertEqual(partialOutcome.partial, true, "seventh tool call should mark the outcome partial");
  assertEqual(partialOutcome.executedToolCalls, 6, "tool budget should execute six calls");
  assertEqual(partialOutcome.omittedTargets.length, 1, "one target should be explicitly omitted");
  assertEqual(
    fetchCalls.filter((call) => call.url.indexOf("/api/ui/db/merchant") === 0).length,
    6,
    "tool execution should stop at the explicit total budget"
  );
  assertIncludes(partialOutcome.fullResponse, "未执行", "partial answer should disclose omitted target");
}

// ── Test 2c: 多商户字段查询不能误用 merchant_comparison ──
{
  hooks.resetAgentTrendCache();
  fetchCalls = [];
  const merchants = [
    "362342 Nulastin",
    "385281 Anua",
    "362805 TP-Link | Tapo",
    "363006 FlavCity"
  ];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return {
          ok: true,
          content: null,
          finishReason: "tool_calls",
          toolCalls: [{ id: "comparison", name: "merchant_comparison", arguments: { merchants } }]
        };
      } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: {"token":"逐个商户查询完成"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent(
    "For merchant IDs 362342 Nulastin, 385281 Anua, 362805 TP-Link | Tapo, and 363006 FlavCity, return clicks, orders, sales/revenue, affiliate commission, EPC affiliate, AOV, CVR, and payment cycle.",
    { language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null }
  );
  assertEqual(outcome.ok, true, "multi-merchant field lookup should succeed");
  assertEqual(
    fetchCalls.filter((call) => call.url.indexOf("/api/ui/db/merchant") === 0).length,
    4,
    "multi-merchant field lookup should fetch monthly data for each merchant"
  );
  const synthesisBody = JSON.stringify(fetchCalls[fetchCalls.length - 1].body);
  assertEqual(synthesisBody.includes('"tool":"merchant_comparison"'), false,
    "field lookup synthesis should not receive a merchant comparison result");
  assertEqual((synthesisBody.match(/merchant_analysis/g) || []).length >= 4, true,
    "field lookup synthesis should receive one merchant analysis per merchant");
}

// ── Test 2d: 明确要求比较时仍保留 merchant_comparison ──
{
  const comparisonCalls = hooks.normalizeAgentToolCalls([
    { id: "comparison", name: "merchant_comparison", arguments: { merchants: ["Shokz", "Anua"] } }
  ], "Compare Shokz and Anua and tell me which performs better.");
  assertEqual(comparisonCalls.length, 1, "explicit comparison should remain one comparison call");
  assertEqual(comparisonCalls[0].name, "merchant_comparison", "explicit comparison should use comparison tool");

  const trendCalls = hooks.normalizeAgentToolCalls([
    { id: "merchant", name: "merchant_analysis", arguments: { merchant: "Shokz" } }
  ], "查看 Shokz 最近 12 个月的收入趋势");
  assertEqual(trendCalls.length, 1, "explicit trend should remain one trend call");
  assertEqual(trendCalls[0].name, "trend", "explicit trend should use the trend tool");
  assertEqual(trendCalls[0].arguments.target, "Shokz", "trend fallback should preserve the merchant target");
}

// ── Test 3: 工具失败 → 补充规划 → 直接内容 ──
{
  fetchCalls = [];
  let planCount = 0;
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      planCount++;
      if (planCount === 1) {
        return { ok: true, json: async function () {
          return { ok: true, content: null, finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: "__agent_test_missing_merchant__" } }] };
        } };
      }
      return { ok: true, json: async function () {
        return { ok: true, content: "未找到该商户", toolCalls: [], finishReason: "stop" };
      } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("分析一个不存在的商户", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should handle failed-tool case");
  assertEqual(outcome.directContent, "未找到该商户", "second plan round content should surface");
  assertEqual(planCount, 2, "expect a corrective second planning round");
}

// ── Test 4: 规划失败 → handled:false（调用方回退单发） ──
{
  fetchCalls = [];
  mockFetchImpl = function () {
    throw new Error("network down");
  };
  const outcome = await hooks.runChatAgent("你好", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, false, "plan failure must fall back to caller");
  assertTruthy(outcome.error, "fallback outcome should carry an error");
}

// ── Test 5: 综合流返回错误 → 保留工具数据并生成确定性 fallback ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: firstOffer } }] };
      } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: {"error":"boom"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("Shokz 在同品类的表现", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should handle synthesis errors with tool data");
  assertEqual(outcome.ok, true, "synthesis error should yield deterministic fallback");
  assertIncludes(outcome.fullResponse, firstOffer, "fallback should carry the tool result headline");
}

// ── Test 6: 简称/子串解析（数据名可带后缀，如 "Shokz Official"） ──
{
  const merchantOffers = sandbox.window.CHATBOT_DATA.offers.filter((offer) => offer && (offer.brand || offer.merchantName));
  let substringOffer = null;
  let query = "";
  for (const offer of merchantOffers) {
    const fullName = String(offer.brand || offer.merchantName || "").trim();
    if (fullName.length <= 6) continue;
    const prefix = fullName.slice(0, 5).toLowerCase();
    const matches = merchantOffers.filter((candidate) => {
      const candidateName = String(candidate.brand || candidate.merchantName || "").toLowerCase();
      return candidateName.indexOf(prefix) !== -1;
    });
    if (matches.length === 1) {
      substringOffer = offer;
      query = fullName.slice(0, 5);
      break;
    }
  }
  assertTruthy(substringOffer && query, "fixture must contain a uniquely resolvable merchant substring");
  const result = await hooks.agentExecuteTool("merchant_analysis", { merchant: query });
  assertTruthy(result.ok, "substring-of-brand query should resolve via containment: " + query);
  assertIncludes(result.data.headline.toLowerCase(), query.toLowerCase(), "headline should belong to the matched offer");
  const garbage = await hooks.agentExecuteTool("merchant_analysis", { merchant: "__agent_test_missing_merchant__" });
  assertEqual(garbage.ok, false, "garbage must still reject");
  assertEqual(garbage.resolution && garbage.resolution.status, "not_found",
    "unknown merchant should expose a not_found resolution");
}

// ── Test 6b: 商户歧义必须失败关闭，并由所有商户路径统一处理 ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  const ambiguousMerchant = await hooks.agentExecuteTool("merchant_analysis", { merchant: "US" });
  assertEqual(ambiguousMerchant.ok, false, "ambiguous merchant must not select the first substring match");
  assertEqual(ambiguousMerchant.resolution && ambiguousMerchant.resolution.status, "ambiguous",
    "ambiguous merchant should expose its status");
  assertTruthy(ambiguousMerchant.resolution.candidates.length > 1,
    "ambiguous resolution should include multiple candidates");
  assertTruthy(ambiguousMerchant.resolution.candidates[0].name,
    "ambiguous candidates should include merchant names");
  assertTruthy(Object.prototype.hasOwnProperty.call(ambiguousMerchant.resolution.candidates[0], "tier"),
    "ambiguous candidates should include tier fields");
  assertTruthy(Object.prototype.hasOwnProperty.call(ambiguousMerchant.resolution.candidates[0], "category"),
    "ambiguous candidates should include category fields");
  assertIncludes(ambiguousMerchant.error, ambiguousMerchant.resolution.candidates[0].merchantId,
    "ambiguous error should include the first candidate ID");
  assertIncludes(ambiguousMerchant.error, ambiguousMerchant.resolution.candidates[1].merchantId,
    "ambiguous error should include the second candidate ID");

  const ambiguousComparison = await hooks.agentExecuteTool("merchant_comparison", {
    merchants: ["US", hooks.firstOfferName()]
  });
  assertEqual(ambiguousComparison.ok, false, "comparison must reject an ambiguous merchant");
  assertEqual(ambiguousComparison.resolution && ambiguousComparison.resolution.merchants[0].status, "ambiguous",
    "comparison should use the shared merchant resolver");

  const ambiguousTrend = await hooks.agentExecuteTool("trend", {
    entityType: "merchant", target: "US", months: 2
  });
  assertEqual(ambiguousTrend.ok, false, "merchant trend must reject an ambiguous merchant");
  assertEqual(ambiguousTrend.resolution && ambiguousTrend.resolution.status, "ambiguous",
    "trend should use the shared merchant resolver");

  const ambiguousPayment = await hooks.agentExecuteTool("payment_status", { merchant: "US" });
  assertEqual(ambiguousPayment.ok, false, "payment lookup must reject an ambiguous merchant");
  assertEqual(ambiguousPayment.resolution && ambiguousPayment.resolution.status, "ambiguous",
    "payment should use the shared merchant resolver");
}

// ── Test 7: merchant_comparison（2 个真实商户 + notFound 上报） ──
{
  const firstOfferRecord = sandbox.window.CHATBOT_DATA.offers[0];
  const nameA = String(firstOfferRecord.merchantId) + " " + (firstOfferRecord.brand || firstOfferRecord.merchantName);
  const secondOffer = sandbox.window.CHATBOT_DATA.offers[1] || null;
  const nameB = secondOffer
    ? String(secondOffer.merchantId) + " " + (secondOffer.brand || secondOffer.merchantName)
    : nameA;
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
  assertTruthy(Array.isArray(result.data.merchants), "tier analysis should carry merchant rows");
  assertTruthy(result.data.merchants.length > 0, "tier analysis should return at least one merchant row");
  assertEqual(result.data.merchantList.total, result.data.merchantCount, "merchant list total should match tier count");
  assertEqual(result.data.merchantList.offset, 0, "default tier merchant page should start at zero");
  assertEqual(result.data.merchantList.limit, 100, "default tier merchant page should use the bounded page size");
  assertEqual(result.data.merchantList.returned, result.data.merchants.length, "merchant page metadata should match rows");
  assertEqual(result.data.merchantList.hasMore, result.data.merchantCount > result.data.merchantList.returned, "merchant page should expose whether more rows exist");
  const firstPage = await hooks.agentExecuteTool("tier_analysis", { tier: anyTier, limit: 2, offset: 0 });
  const secondPage = await hooks.agentExecuteTool("tier_analysis", { tier: anyTier, limit: 2, offset: 2 });
  assertTruthy(firstPage.ok && secondPage.ok, "tier merchant pages should succeed");
  assertTruthy(firstPage.data.merchants.length <= 2, "first tier merchant page should respect limit");
  assertTruthy(secondPage.data.merchants.length <= 2, "second tier merchant page should respect limit");
  assertEqual(secondPage.data.merchantList.offset, 2, "second tier merchant page should report offset");
  const bad = await hooks.agentExecuteTool("tier_analysis", { tier: "__agent_test_no_tier__" });
  assertEqual(bad.ok, false, "unknown tier should fail cleanly");
}

// ── Test 8b: Tier 商家列表必须穿过工具到综合请求 ──
{
  const anyTier = sandbox.window.CHATBOT_DATA.offers[0].tier || "Tier 1";
  const expectedPage = await hooks.agentExecuteTool("tier_analysis", { tier: anyTier, limit: 2 });
  const representativeMerchant = expectedPage.data.merchants[0].merchant;
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return {
          ok: true,
          content: null,
          finishReason: "tool_calls",
          toolCalls: [{ id: "tier-list", name: "tier_analysis", arguments: { tier: anyTier, limit: 2 } }]
        };
      } };
    }
    return sseResponse('data: {"token":"已列出商家"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("请列出这个 Tier 的商家", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "tier list Agent run should be handled");
  assertEqual(outcome.ok, true, "tier list Agent run should succeed");
  assertIncludes(JSON.stringify(fetchCalls[1].body), "merchantList", "synthesis body should carry Tier page metadata");
  assertIncludes(JSON.stringify(fetchCalls[1].body), "merchants", "synthesis body should carry Tier merchant rows");
  assertIncludes(JSON.stringify(fetchCalls[1].body), representativeMerchant, "synthesis body should carry a representative merchant");
  assertIncludes(outcome.fullResponse, representativeMerchant, "final Tier answer should keep a representative merchant visible");
}

// ── Test 8c: 综合模型漏展示 Tier 行时，前端补出确定性明细 ──
{
  const anyTier = sandbox.window.CHATBOT_DATA.offers[0].tier || "Tier 1";
  const page = await hooks.agentExecuteTool("tier_analysis", { tier: anyTier, limit: 2 });
  const firstMerchant = page.data.merchants[0].merchant;
  const secondMerchant = page.data.merchants[1] && page.data.merchants[1].merchant;
  const response = hooks.ensureAgentTierMerchantDataVisible(
    "根据聚合结果无法直接推荐具体商户。",
    [{ name: "tier_analysis", result: page }],
    "zh",
    "请推荐2个 Tier 商户"
  );
  assertIncludes(response, firstMerchant, "Tier visibility guard should append the first merchant");
  if (secondMerchant) assertIncludes(response, secondMerchant, "Tier visibility guard should append the requested page");
  assertIncludes(response, "Tier 商户明细", "Tier visibility guard should label the deterministic table");
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

  const pending = await hooks.agentExecuteTool("payment_status", { status: "未到期" });
  assertTruthy(pending.ok, "Chinese pending filter should succeed");
  assertEqual(pending.data.filter.status, "pending",
    "未到期 must normalize to pending instead of overdue");

  const invalidStatus = await hooks.agentExecuteTool("payment_status", { status: "settled" });
  assertEqual(invalidStatus.ok, false, "unknown payment status must not return all rows");
  assertEqual(invalidStatus.resolution && invalidStatus.resolution.status, "invalid_filter",
    "unknown status should be invalid_filter");
  assertEqual(invalidStatus.resolution && invalidStatus.resolution.field, "status",
    "invalid status should identify its field");

  const invalidMonth = await hooks.agentExecuteTool("payment_status", { month: "13月" });
  assertEqual(invalidMonth.ok, false, "unknown payment month must not be ignored");
  assertEqual(invalidMonth.resolution && invalidMonth.resolution.status, "invalid_filter",
    "unknown month should be invalid_filter");

  const invalidTier = await hooks.agentExecuteTool("payment_status", { tier: "Tier 9" });
  assertEqual(invalidTier.ok, false, "unknown payment tier must not return an empty success");
  assertEqual(invalidTier.resolution && invalidTier.resolution.status, "invalid_filter",
    "unknown tier should be invalid_filter");
}

// ── Test 10b: 未写年份的付款月份默认当前年，明确年份必须保留 ──
{
  const currentYearPayment = await hooks.agentExecuteTool(
    "payment_status",
    { status: "unpaid", month: "2025-06" },
    { prompt: "6月份未付款的商户" }
  );
  assertTruthy(currentYearPayment.ok, "current-year payment lookup should succeed");
  assertEqual(currentYearPayment.data.filter.month, "2026-06",
    "a month without an explicit year should be normalized to the current year");
  assertTruthy(currentYearPayment.data.rows.some((row) => row.month === "2026-06"),
    "current-year payment lookup should return current-year rows");

  const decemberPayment = await hooks.agentExecuteTool(
    "payment_status",
    { month: "12月" },
    { prompt: "12月份付款记录" }
  );
  assertTruthy(decemberPayment.ok, "numeric December payment lookup should succeed");
  assertEqual(decemberPayment.data.filter.month, "2026-12",
    "numeric December must not be misread as February");

  const explicitYearPayment = await hooks.agentExecuteTool(
    "payment_status",
    { status: "unpaid", month: "2025-06" },
    { prompt: "2025年6月份未付款的商户" }
  );
  assertTruthy(explicitYearPayment.ok, "explicit-year payment lookup should succeed");
  assertEqual(explicitYearPayment.data.filter.month, "2025-06",
    "an explicitly requested historical year must be preserved");
}

// ── Test 10c: 付款规划传错年份时，执行结果按用户原话纠正 ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return {
          ok: true,
          content: null,
          finishReason: "tool_calls",
          toolCalls: [{ id: "payment-june", name: "payment_status", arguments: { status: "unpaid", month: "2025-06" } }]
        };
      } };
    }
    return sseResponse('data: {"token":"根据工具返回结果，2025年6月没有未付款的商户"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("6月份未付款的商户", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.ok, true, "payment month correction should keep the Agent run successful");
  const synthesisBody = JSON.stringify(fetchCalls[fetchCalls.length - 1].body);
  assertIncludes(synthesisBody, "2026-06",
    "synthesis should receive the current-year payment filter");
  assertIncludes(outcome.fullResponse, "2026-06",
    "final payment answer should correct a stale historical year");
}

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
  hooks.resetAgentTrendCache();
  const result = await hooks.agentExecuteTool("trend", { entityType: "merchant", target: name, months: 2 });
  assertTruthy(result.ok, "merchant trend should succeed with mocked DB data");
  assertTruthy(result.data.months && result.data.months.length >= 2, "trend should carry monthly rows");
  assertEqual(result.data.estimated, false, "real monthly data is not estimated");
  assertTruthy(result.data.summary && result.data.summary.revenue, "trend summary should carry revenue delta");
  assertEqual(result.data.entityType, "merchant", "entityType should be merchant");
}

// ── Test 11b: 趋势非法月份和指标必须失败关闭 ──
{
  const name = hooks.firstOfferName();
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  const invalidMonths = await hooks.agentExecuteTool("trend", {
    entityType: "merchant", target: name, months: 1
  });
  assertEqual(invalidMonths.ok, false, "trend months below two must not default to twelve");
  assertEqual(invalidMonths.resolution && invalidMonths.resolution.status, "invalid_filter",
    "invalid trend months should be invalid_filter");
  assertEqual(invalidMonths.resolution && invalidMonths.resolution.field, "months",
    "invalid trend months should identify its field");

  const invalidMetric = await hooks.agentExecuteTool("trend", {
    entityType: "merchant", target: name, months: 2, metric: "madeUpMetric"
  });
  assertEqual(invalidMetric.ok, false, "unknown trend metric must not display all metrics");
  assertEqual(invalidMetric.resolution && invalidMetric.resolution.status, "invalid_filter",
    "invalid trend metric should be invalid_filter");
  assertEqual(invalidMetric.resolution && invalidMetric.resolution.field, "metric",
    "invalid trend metric should identify its field");
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
  hooks.resetAgentTrendCache();
  const result = await hooks.agentExecuteTool("trend", { entityType: "merchant", target: name, months: 2 });
  assertTruthy(result.ok, "merchant trend should degrade to estimate when DB returns null");
  assertEqual(result.data.estimated, true, "fallback must be flagged estimated");
  assertTruthy(result.data.months && result.data.months.length >= 2, "estimated trend should still carry months");
}

// ── Test 12b: Agent 趋势结果应渲染为可切换指标的 SVG 折线图 ──
{
  const trendData = {
    tool: "trend",
    entityType: "merchant",
    target: "Shokz",
    estimated: true,
    metric: null,
    metrics: ["revenue", "orders"],
    months: [
      { month: "2026-04", revenue: 1000, orders: 50 },
      { month: "2026-05", revenue: 1200, orders: 60 }
    ],
    summary: {
      revenue: { first: 1000, last: 1200, abs: 200, pct: 20, dir: "up" }
    }
  };
  const chartHtml = hooks.renderAgentTrendChartHtml(trendData, "zh");
  assertIncludes(chartHtml, "agent-trend-card", "trend result should render an Agent chart card");
  assertIncludes(chartHtml, "<svg", "trend result should render an SVG line chart");
  assertIncludes(chartHtml, 'data-agent-trend-metric="revenue"', "trend chart should expose a revenue metric switch");
  assertIncludes(chartHtml, 'data-agent-trend-metric="orders"', "trend chart should expose an orders metric switch");
  assertIncludes(chartHtml, "估算趋势", "estimated trend should show an estimate notice");
  assertEqual(hooks.renderAgentTrendChartHtml({ months: [] }, "zh"), "", "trend chart should stay hidden without monthly rows");

  const content = { children: [], appendChild(node) { this.children.push(node); } };
  const reply = { msgEl: { querySelector(selector) { return selector === ".chat-stream-text" ? content : null; } } };
  hooks.appendAgentTrendCharts(reply, [{ name: "trend", result: { ok: true, data: trendData } }], "zh");
  assertEqual(content.children.length, 1, "successful Agent trend should append one chart visual");
  assertIncludes(content.children[0].className, "agent-trend-visuals", "trend visual should use the Agent chart wrapper");
  assertIncludes(content.children[0].innerHTML, "agent-trend-card", "trend visual wrapper should contain the chart card");
}

// ── Test 13: 三商户对比必须保留参考商户到每个同行的差异 ──
{
  const names = Array.from(new Set(sandbox.window.CHATBOT_DATA.offers.slice(0, 5)
    .map((o) => String(o.merchantId) + " " + (o.brand || o.merchantName))
    .filter(Boolean)));
  assertTruthy(names.length >= 3, "fixture must contain three merchants");
  const result = await hooks.agentExecuteTool("merchant_comparison", { merchants: names.slice(0, 3) });
  assertTruthy(result.ok, "three-merchant comparison should succeed");
  assertTruthy(Array.isArray(result.data.pairwiseDeltas), "comparison should expose pairwise deltas");
  assertEqual(result.data.pairwiseDeltas.length, 2, "three merchants should produce two peer delta rows");
}

// ── Test 14: 只有一个品类匹配时不能伪装成品类对比 ──
{
  const cat = sandbox.window.CHATBOT_DATA.offers[0].mainCategory
    || sandbox.window.CHATBOT_DATA.offers[0].category;
  const result = await hooks.agentExecuteTool("category_comparison", {
    categories: [cat, "__agent_test_missing_category__"]
  });
  assertEqual(result.ok, false, "partial category comparison should fail cleanly");
}

// ── Test 15: 综合失败时必须保留已成功执行的工具数据 ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: firstOffer } }] };
      } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
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

// ── Test 16: payment_status 的 merchant 过滤必须约束所有返回行 ──
{
  const payment = (sandbox.window.CHATBOT_DATA.paymentRecords || []).find((r) => r.merchantName);
  if (payment) {
    const paymentMerchantQuery = payment.merchantId
      ? String(payment.merchantId) + " " + payment.merchantName
      : payment.merchantName;
    const result = await hooks.agentExecuteTool("payment_status", { merchant: paymentMerchantQuery });
    assertTruthy(result.ok, "merchant payment filter should succeed");
    assertTruthy(result.data.rows.every((r) => r.merchant === payment.merchantName),
      "merchant payment filter should constrain rows");
  } else {
    console.warn("WARN Test 16 skipped: fixture has no named payment record");
  }
}

// ── Test 17: merchant_analysis 必须复用 Report Mode 的真实月度数据 ──
{
  const offer = sandbox.window.CHATBOT_DATA.offers[0];
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return {
        ok: true,
        json: async function () {
          return {
            ok: true,
            merchantId: offer.merchantId,
            monthlyAmazonMetrics: [
              { month: "2026-08", revenue: 1400, orders: 28, clicks: 140, payout: 280, affiliatePayout: 140, aov: 50, conversionRate: 0.2, dpv: 70, atc: 14 },
              { month: "2026-07", revenue: 1000, orders: 20, clicks: 100, payout: 200, affiliatePayout: 100, aov: 50, conversionRate: 0.2, dpv: 50, atc: 10 }
            ]
          };
        }
      };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  hooks.resetAgentTrendCache();
  const result = await hooks.agentExecuteTool("merchant_analysis", { merchant: firstOffer });
  assertTruthy(result.ok, "merchant_analysis should still succeed with monthly data");
  assertEqual(result.data.latestMonth, "2026-08", "merchant analysis should expose latest month");
  assertEqual(result.data.monthlyDataSource, "db", "monthly data should identify the DB source");
  assertTruthy(Array.isArray(result.data.monthly), "merchant analysis should carry monthly rows");
  assertEqual(result.data.monthly.length, 2, "merchant analysis should carry all mocked monthly rows");
  assertEqual(result.data.monthly[0].revenue, 1400, "latest monthly revenue should be preserved");
  assertEqual(result.data.monthly[0].epcAll, 2, "monthly all EPC should use payout/clicks");
  assertEqual(result.data.monthly[0].epcAff, 1, "monthly affiliate EPC should use affiliatePayout/clicks");
  assertEqual(result.data.monthly[1].month, "2026-07", "monthly order should match the DB response order");
  assertTruthy(fetchCalls.some((call) => call.url.includes("/api/ui/db/merchant") && call.url.includes("months=12") && call.url.includes("minimal=1")), "merchant analysis should request the Report Mode monthly endpoint");
}

// ── Test 18: 月度数据不可用时仍返回当前商户分析 ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return { ok: true, json: async function () { return { ok: true, monthlyAmazonMetrics: [] }; } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  hooks.resetAgentTrendCache();
  const result = await hooks.agentExecuteTool("merchant_analysis", { merchant: firstOffer });
  assertTruthy(result.ok, "merchant analysis should not fail when monthly data is unavailable");
  assertTruthy(Array.isArray(result.data.monthly), "unavailable monthly data should be represented as an empty array");
  assertEqual(result.data.monthly.length, 0, "unavailable monthly data should not be fabricated");
  assertEqual(result.data.monthlyDataAvailable, false, "unavailable monthly data should be marked unavailable");
  assertEqual(result.data.monthlyDataSource, "unavailable", "unavailable monthly data should identify its source state");
}

// ── Test 20: 规划与综合使用不同的上下文 ──
{
  const longAnswer = "历史回答内容 ".repeat(1800);
  const history = [
    { role: "user", content: "之前的问题" },
    { role: "assistant", content: longAnswer }
  ];
  const planning = hooks.buildAgentPlanningMessages("", history, "当前问题");
  const synthesis = hooks.buildAgentSynthesisMessages("", history, "当前问题", [], "zh");
  const fallbackHistory = hooks.agentFallbackHistory(history);
  assertTruthy(planning.some((message) => message.role === "assistant"), "planning context should preserve recent role messages");
  assertEqual(synthesis.some((message) => message.role === "assistant"), false, "synthesis context should not resend raw assistant history");
  assertIncludes(JSON.stringify(synthesis), "对话背景", "synthesis context should use a compact conversation background");
  assertEqual(JSON.stringify(synthesis).includes(longAnswer), false, "synthesis context must not contain the full historical answer");
  assertEqual(JSON.stringify(fallbackHistory).includes(longAnswer), false, "fallback context must not contain the full historical answer");
}

// ── Test 21: 工具结果传给模型前只保留白名单字段 ──
{
  const noisyData = {
    tool: "merchant_analysis",
    merchant: "Shokz",
    headline: "Shokz（Electronics · Tier 1）",
    metrics: { revenue: 123 },
    note: "最终口径",
    rawPayload: "不应传给模型的完整原始 JSON"
  };
  const projected = hooks.agentToolPromptData("merchant_analysis", noisyData);
  assertEqual(projected.rawPayload, undefined, "tool prompt data must drop unknown raw fields");
  assertEqual(projected.merchant, "Shokz", "tool prompt data should keep the merchant identity");
  assertTruthy(projected.metrics, "tool prompt data should keep required metrics");
  const synthesis = hooks.buildAgentSynthesisMessages("", [], "当前问题", [
    { name: "merchant_analysis", result: { ok: true, data: noisyData } }
  ], "zh");
  assertIncludes(JSON.stringify(synthesis), "revenue", "synthesis should carry selected tool metrics");
  assertEqual(JSON.stringify(synthesis).includes("rawPayload"), false, "synthesis must not carry the raw tool JSON");
}

// ── Test 22: 失败/中止不提交本轮用户消息，成功才提交成对历史 ──
{
  const previous = [{ role: "assistant", content: "上一轮回答" }];
  const failed = hooks.agentHistoryAfterOutcome(previous, "失败的问题", { handled: false, error: "network down" });
  const stopped = hooks.agentHistoryAfterOutcome(previous, "中止的问题", { handled: true, stopped: true });
  assertEqual(JSON.stringify(failed), JSON.stringify(previous), "failed turn must roll back formal history");
  assertEqual(JSON.stringify(stopped), JSON.stringify(previous), "stopped turn must roll back formal history");
  const success = hooks.agentHistoryAfterOutcome(previous, "成功的问题", { handled: true, ok: true, fullResponse: "成功回答" });
  assertEqual(success.length, 3, "successful turn should commit user and assistant as a pair");
  assertEqual(success[1].role, "user", "successful history should commit the user message first");
  assertEqual(success[2].role, "assistant", "successful history should commit the assistant message second");
}

// ── Test 23: 综合模型只回答最新月时，Agent 仍必须返回完整月度序列 ──
{
  const offer = sandbox.window.CHATBOT_DATA.offers[0];
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return {
          ok: true,
          content: null,
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: firstOffer } }]
        };
      } };
    }
    if (url.indexOf("/api/ui/db/merchant") === 0) {
      return {
        ok: true,
        json: async function () {
          return {
            ok: true,
            merchantId: offer.merchantId,
            monthlyAmazonMetrics: [
              { month: "2026-08", revenue: 1400, orders: 28, clicks: 140, payout: 280, affiliatePayout: 140, aov: 50, conversionRate: 0.2, dpv: 70, atc: 14 },
              { month: "2026-07", revenue: 1000, orders: 20, clicks: 100, payout: 200, affiliatePayout: 100, aov: 50, conversionRate: 0.2, dpv: 50, atc: 10 }
            ]
          };
        }
      };
    }
    return sseResponse('data: {"token":"只展示 2026-08"}\n\ndata: [DONE]\n\n');
  };
  hooks.resetAgentTrendCache();
  chatLogStub.nodes = [];
  const outcome = await hooks.runChatAgent("请分析商户并展示多个月份数据", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null,
    executionTimeline: true
  });
  assertEqual(outcome.handled, true, "agent should handle a successful synthesis");
  assertIncludes(outcome.fullResponse, "2026-07", "agent response should preserve older monthly rows");
  assertIncludes(outcome.fullResponse, "1,000", "agent response should preserve older monthly metrics");
  const timelineRoot = chatLogStub.nodes.find((node) => String(node.className || "").indexOf("agent-run-timeline") !== -1);
  assertTruthy(timelineRoot, "successful Agent run should render an execution timeline");
  assertEqual(timelineRoot.open, false, "successful Agent timeline should collapse after completion");
}

console.log("OK 32 scenarios");
