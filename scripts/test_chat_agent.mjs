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

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {}, insertBefore() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {}, removeAttribute() {},
  style: {},
  remove() {}
};

let mockFetchImpl = null;
let fetchCalls = [];

const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  TextDecoder,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  },
  fetch: async function (url, init) {
    fetchCalls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (!mockFetchImpl) throw new Error("no mockFetchImpl for " + url);
    return mockFetchImpl(String(url), fetchCalls[fetchCalls.length - 1]);
  },
  setInterval() { return 1; },
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

const firstOffer = hooks.firstOfferName();
assertTruthy(firstOffer, "fixture offers must not be empty");

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

const chatLogStub = { appendChild() {}, scrollTop: 0, scrollHeight: 0 };

// ── Test 1: merchant_analysis 工具直接执行 ──
{
  const result = hooks.agentExecuteTool("merchant_analysis", { merchant: firstOffer });
  assertTruthy(result.ok, "merchant_analysis should succeed for firstOffer");
  assertTruthy(result.data.ranks, "compact result should keep ranks");
  assertTruthy(result.data.headline, "compact result should carry headline");
  assertIncludes(result.data.note, "EPC", "note should carry metric definitions");
  const missing = hooks.agentExecuteTool("merchant_analysis", { merchant: "__agent_test_missing_merchant__" });
  assertEqual(missing.ok, false, "unknown merchant should fail cleanly");
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
    return sseResponse('data: {"token":"OK"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("Shokz 在同品类的表现", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should handle the prompt");
  assertEqual(outcome.ok, true, "agent run should succeed");
  assertEqual(outcome.fullResponse, "OK", "synthesis tokens should accumulate");
  assertEqual(fetchCalls.length, 2, "expect one plan call and one synthesis call");
  assertIncludes(JSON.stringify(fetchCalls[1].body), "merchant_analysis", "synthesis body should carry tool result");
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

// ── Test 5: 综合流返回错误 → handled:true, ok:false（调用方走单发 fallback） ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: firstOffer } }] };
      } };
    }
    return sseResponse('data: {"error":"boom"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("Shokz 在同品类的表现", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should mark the turn handled even when synthesis errors");
  assertEqual(outcome.ok, false, "synthesis error must yield ok:false");
  assertTruthy(outcome.error, "error outcome should carry the error");
}

// ── Test 6: 简称/子串解析（数据名可带后缀，如 "Shokz Official"） ──
{
  const fullName = hooks.firstOfferName();
  const query = fullName.length > 6 ? fullName.slice(0, 5) : fullName;
  const result = hooks.agentExecuteTool("merchant_analysis", { merchant: query });
  assertTruthy(result.ok, "substring-of-brand query should resolve via containment: " + query);
  assertIncludes(result.data.headline.toLowerCase(), query.toLowerCase(), "headline should belong to the matched offer");
  const garbage = hooks.agentExecuteTool("merchant_analysis", { merchant: "__agent_test_missing_merchant__" });
  assertEqual(garbage.ok, false, "garbage must still reject");
}

console.log("OK 6 scenarios");
