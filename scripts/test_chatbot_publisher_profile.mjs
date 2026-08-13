import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");

// ── Task 1: 菜单第 9 项 + 命令前缀注册 ──
assertMatch(html, /data-chat-intent="publisherprofile"/, "提问类型菜单应包含 publisherprofile 选项");
assertMatch(html, /data-chat-intent="publisher"[\s\S]{0,600}data-chat-intent="publisherprofile"/, "publisherprofile 选项应位于 publisher 之后");
assertMatch(html, /data-chat-intent="publisherprofile"[\s\S]{0,200}>Publisher Profile</, "publisherprofile 选项显示应为 Publisher Profile");
assertMatch(app, /\{ key: "publisherprofile", intent: "publisherprofile" \}/, "CHAT_INTENT_OPTIONS 应注册 publisherprofile 意图");
assertMatch(app, /categorytier\|merchant\|category\|tier\|trend\|payment\|asin\|publisherprofile\|publisher/, "命令解析应支持 publisherprofile 前缀（且在 publisher 之前）");
assertMatch(app, /"chat\.intent\.publisherProfile": "媒体画像"/, "中文 i18n 应提供 publisherprofile 菜单文案");
assertMatch(app, /"chat\.intent\.publisherProfileHint": "媒体画像查询"/, "中文 i18n 应提供 publisherprofile 提示文案");

// ── Task 2: 意图检测（vm 沙箱） ──
import vm from "node:vm";

const storageValues = new Map();
const requests = [];
const publishersCache = JSON.parse(fs.readFileSync("protected_data/db_publishers_cache.json", "utf8"));
const fetchImpl = async (url) => {
  requests.push(String(url));
  if (String(url).indexOf("/api/ui/db/publishers?userId=") !== -1) {
    return { ok: true, async json() { return { ok: true, merchants: [] }; } };
  }
  return { ok: true, async json() { return publishersCache; } };
};
const elementStub = {
  addEventListener() {}, appendChild() {}, insertBefore() {}, remove() {}, click() {}, focus() {},
  replaceChildren() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, style: {}, querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, removeAttribute() {}, closest() { return null; }, reset() {},
  getAttribute() { return null; }, innerHTML: "", textContent: "", outerHTML: "", isConnected: true
};
const sandbox = {
  console: { ...console, warn() {} }, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  Uint8Array, TextDecoder, TextEncoder, clearInterval, setInterval, clearTimeout, setTimeout,
  fetch: fetchImpl,
  localStorage: {
    getItem(key) { return storageValues.get(key) || null; },
    setItem(key, value) { storageValues.set(key, value); },
    removeItem(key) { storageValues.delete(key); }
  },
  document: {
    body: { ...elementStub },
    getElementById() { return { ...elementStub }; },
    querySelectorAll() { return []; },
    querySelector() { return { ...elementStub }; },
    createElement() { return { ...elementStub }; },
    addEventListener() {}
  },
  window: {
    __OFFER_INTELLIGENCE_TEST__: true,
    crypto: { randomUUID() { return "00000000-0000-4000-8000-000000000000"; } }
  }
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
const offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: offersCache.summary || {}, offers: offersCache.offers || [],
  paymentRecords: offersCache.paymentRecords || [], sources: { mode: "db", month: offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: offersCache.sheets || [], tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
sandbox.window.PRODUCT_KEYWORDS = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
vm.runInNewContext(fs.readFileSync("public/chatbot_i18n.js", "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync("public/tier2_recommendation_rules.js", "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync("public/app.js", "utf8"), sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
if (!hooks) throw new Error("应暴露测试 hooks");

// ── Task 2: 意图检测 ──
// 测试 ID 用真实缓存中存在的 1022（4 位）与 26（2 位短 ID，覆盖短 ID 解析）
assertMatch(String(hooks.hasPublisherProfileIntent("publisherprofile: 1022")), /^true$/, "publisherprofile 前缀应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("媒体画像 1022")), /^true$/, "中文媒体画像表述应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("publisher: amazon.de Amazon")), /^false$/, "publisher 前缀不应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("分析媒体 shokz 的表现")), /^false$/, "分析语句不应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("Shokz 的销售如何")), /^false$/, "普通商户查询不应误判为画像意图");
if (hooks.detectQueryIntent("publisherprofile: 1022") !== "publisherprofile") throw new Error("detectQueryIntent 应返回 publisherprofile");
if (hooks.detectQueryIntent("publisher: 1022") !== "publisher") throw new Error("publisher 前缀仍应路由到 publisher 意图");
if (hooks.parseChatIntentPrefix("publisherprofile: 1022")?.intent !== "publisherprofile") throw new Error("parseChatIntentPrefix 应解析 publisherprofile");
if (hooks.parseChatIntentPrefix("publisher: 1022")?.intent !== "publisher") throw new Error("parseChatIntentPrefix 不应破坏 publisher");

// ── Task 3: 媒体匹配解析 ──
const pubData = publishersCache;
const q1 = hooks.parsePublisherProfileQuery("publisherprofile: 1022", pubData);
if (q1.mode !== "id" || !q1.publisher) throw new Error("ID 查询应精确匹配媒体");
if (String(q1.publisher.userId) !== "1022") throw new Error("ID 匹配的媒体不正确");
const q1b = hooks.parsePublisherProfileQuery("publisherprofile: 26", pubData);
if (q1b.mode !== "id" || String(q1b.publisher.userId) !== "26") throw new Error("短 ID（2 位）也应精确匹配");
const q2 = hooks.parsePublisherProfileQuery("publisherprofile: 1022 amazon.de", pubData);
if (q2.market !== "amazon.de") throw new Error("应解析出站点 amazon.de");
const q3 = hooks.parsePublisherProfileQuery("publisherprofile: 不存在的媒体xyz", pubData);
if (q3.mode !== "none") throw new Error("无匹配应返回 mode=none");
if (!q3.queryText.includes("不存在的媒体xyz")) throw new Error("应回显查询词");
const q4 = hooks.parsePublisherProfileQuery("publisherprofile:", pubData);
if (q4.mode !== "empty") throw new Error("空查询应返回 mode=empty");
const someName = pubData.publishers[0].userName;
const q5 = hooks.parsePublisherProfileQuery("publisherprofile: " + someName, pubData);
if (q5.mode !== "id" && q5.mode !== "name") throw new Error("名称查询应返回 id 或 name 模式");
if (!q5.publisher && !(q5.candidates || []).length) throw new Error("名称匹配应有结果");
// 名称多匹配 → 候选模式（构造 3 个共享前缀的媒体）
const multiData = { publishers: pubData.publishers.slice(0, 3).map(function (p, i) {
  return { ...p, userId: 1000 + i, userName: "TestMedia 媒体" + (i + 1), total: { ...(p.total || {}), sales: 1000 - i * 100 } };
}), merchantNameMap: pubData.merchantNameMap, networks: pubData.networks };
const q6 = hooks.parsePublisherProfileQuery("publisherprofile: TestMedia", multiData);
if (q6.mode !== "name") throw new Error("名称多匹配应返回 mode=name");
if (q6.publisher !== null) throw new Error("多匹配时 publisher 应为 null");
if (q6.candidates.length !== 3) throw new Error("多匹配应返回全部 3 个候选");
if (q6.candidates[0].userName !== "TestMedia 媒体1") throw new Error("候选应按销售额降序（媒体1 销售额最高）");

console.log("PASS: chatbot publisher profile contract tests (Task 1 static)");
