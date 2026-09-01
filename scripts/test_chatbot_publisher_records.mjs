import fs from "node:fs";
import vm from "node:vm";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");

// ── Task 1：菜单第 8 项与命令前缀 ──
assertMatch(html, /data-chat-intent="publisher"/, "提问类型菜单应包含 publisher 选项");
assertMatch(html, /data-chat-intent="asin"[\s\S]{0,600}data-chat-intent="publisher"/, "publisher 选项应位于 asin 之后");
assertMatch(html, /data-chat-intent="publisher"[\s\S]{0,300}>Publisher</, "publisher 选项显示应首字母大写");
assertMatch(app, /\{ key: "publisher", intent: "publisher" \}/, "CHAT_INTENT_OPTIONS 应注册 publisher 意图");
assertMatch(app, /categorytier\|category\\s\*&\\s\*tier\|品类\\s\*\[\+＋\]\\s\*tier\|merchant\|category\|tier\|trend\|payment\|asin\|publisher/, "命令解析应支持 publisher 前缀");
assertMatch(app, /"chat\.intent\.publisher": "媒体"/, "中文 i18n 应提供 publisher 菜单文案");

// ── Task 2-4：意图、解析、渲染与回答入口 ──
assertMatch(app, /function hasPublisherIntent\s*\(/, "应提供 publisher 意图检测");
assertMatch(app, /function parsePublisherFilters\s*\(/, "应提供 publisher 筛选解析器");
assertMatch(app, /function renderPublisherRecordsHtml\s*\(/, "应提供 publisher records 渲染函数");
assertMatch(app, /function publisherRecordsAnswer\s*\(/, "应提供 publisher records 回答函数");
assertMatch(app, /intent === "publisher"/, "answerPrompt 应路由 publisher 意图");

// ── Task 5：说明书类型数（publisherprofile 加入后为 9 种）──
assertMatch(app, /### 9 种提问类型/, "中文说明书应列出全部 9 种提问类型");
assertMatch(app, /### The 9 Question Types/, "英文说明书应列出全部 9 种提问类型");
assertMatch(app, /\| Publisher（媒体） \| publisher: \|/, "中文说明书应提供 Publisher 行");
assertMatch(app, /\| Publisher \| publisher: \|/, "英文说明书应提供 Publisher 行");
assertMatch(app, /publisher: amazon\.de Amazon 张三/, "说明书应提供 Publisher 示例");
assertMatch(app, /### 6\. 媒体记录查询/, "中文说明书应提供媒体记录查询小节");
assertMatch(app, /### 1\.6 Publisher Records/, "英文说明书应提供 Publisher Records 小节");

// ── Task 6：缓存版本 ──
assertMatch(html, /styles\.css\?v=20260901-m4-shell/, "样式应使用当前缓存版本");
assertMatch(html, /auth\.js\?v=20260901-m4-shell/, "认证脚本应使用当前缓存版本");
assertMatch(auth, /APP_SCRIPT\s*=\s*"\.\/app\.js\?v=20260901-m4-shell"/, "app.js 缓存版本应与 auth.js 一致");

const storageValues = new Map();
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
  fetch: async () => ({ ok: true, async json() { return { ok: true }; } }),
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
vm.runInNewContext(app, sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
if (!hooks) throw new Error("应暴露 publisher records 测试 hooks");

assertEqual(hooks.hasPublisherIntent("列一下媒体"), true, "列一下媒体应触发 publisher 意图");
assertEqual(hooks.hasPublisherIntent("amazon.de 市场的媒体"), true, "带站点的媒体查询应触发 publisher 意图");
assertEqual(hooks.hasPublisherIntent("销售最高的 5 个媒体"), true, "带排序的媒体查询应触发 publisher 意图");
assertEqual(hooks.hasPublisherIntent("publisher: amazon.de Amazon"), true, "publisher 前缀应触发 publisher 意图");
assertEqual(hooks.hasPublisherIntent("分析媒体 shokz 的表现"), false, "分析媒体表现应让位给 analysis 意图");
assertEqual(hooks.hasPublisherIntent("Shokz 的销售如何"), false, "普通商户查询不应误判为 publisher");
assertEqual(hooks.detectQueryIntent("列一下媒体"), "publisher", "detectQueryIntent 应返回 publisher");

const pubData = JSON.parse(fs.readFileSync("protected_data/db_publishers_cache.json", "utf8"));
const f1 = hooks.parsePublisherFilters("列一下 amazon.de 市场、Amazon 联盟、经理张三的媒体", pubData);
assertEqual(f1.market, "amazon.de", "应解析出 amazon.de 站点");
assertEqual(String(f1.network).toLowerCase(), "amazon", "应解析出 Amazon 联盟的真实缓存值");
if (!Array.isArray(f1.merchantIds)) throw new Error("merchantIds 应为数组");
assertEqual(f1.manager, "张三", "应解析出经理名称");
assertEqual(f1.limit, 50, "默认限额应为 50");
assertEqual(f1.sortKey, "clicks", "默认排序应为 clicks");

const f2 = hooks.parsePublisherFilters("销售最高的 5 个媒体", pubData);
assertEqual(f2.market, null, "销售排序不应误识别为西班牙站");
assertEqual(f2.sortKey, "sales", "应解析出按销售排序");
assertEqual(f2.limit, 5, "应解析出限额 5");

const f3 = hooks.parsePublisherFilters("和 shokz 合作的媒体", pubData);
if (!f3.merchantIds.length) throw new Error("应按商家名称匹配出 merchantIds");
const f4 = hooks.parsePublisherFilters("商家 362135 的媒体", pubData);
if (!f4.merchantIds.includes(362135)) throw new Error("应按商家 ID 匹配出 362135");
const f5 = hooks.parsePublisherFilters("按佣金排序的媒体", pubData);
assertEqual(f5.sortKey, "allCommission", "应解析出按佣金排序");
const f6 = hooks.parsePublisherFilters("德国站的媒体", pubData);
assertEqual(f6.market, "amazon.de", "德国站应映射到 amazon.de");
const knownManager = (pubData.publishers || []).find((p) => p.adminName && p.adminName !== "Unknown")?.adminName;
if (knownManager) {
  const fm = hooks.parsePublisherFilters(`经理 ${knownManager} 的媒体`, pubData);
  assertEqual(fm.manager, knownManager, "应匹配真实经理名称");
}

const zhHtml = hooks.renderPublisherRecordsHtml("列一下媒体", pubData, "zh");
if (!zhHtml.includes("媒体业绩记录")) throw new Error("中文标题应显示媒体业绩记录");
if (!zhHtml.includes("媒体 ID") || !zhHtml.includes("毛利")) throw new Error("中文表格应含 12 列（含毛利）");
if (!zhHtml.includes('class="total-row"')) throw new Error("表格应含合计行");
if (!zhHtml.includes("共 ")) throw new Error("应显示总数");
if (zhHtml.includes("rank")) throw new Error("不应包含 rank 列");
const marketHtml = hooks.renderPublisherRecordsHtml("amazon.de 市场的媒体", pubData, "zh");
if (!marketHtml.includes("站点 amazon.de")) throw new Error("应回显站点筛选条件");
const enHtml = hooks.renderPublisherRecordsHtml("list publishers", pubData, "en");
if (!enHtml.includes("Publisher Records")) throw new Error("英文标题应显示 Publisher Records");
if (!enHtml.includes("Publisher ID") || !enHtml.includes("Gross Profit")) throw new Error("英文表格应含 12 列");
const noMatchHtml = hooks.renderPublisherRecordsHtml("经理不存在的经理甲 的媒体", pubData, "zh");
if (!noMatchHtml.includes("未找到匹配的媒体")) throw new Error("无匹配时应显示未找到提示");
const noMerchantMatchHtml = hooks.renderPublisherRecordsHtml("商家不存在的商家 的媒体", pubData, "zh");
if (!noMerchantMatchHtml.includes("未找到匹配的媒体")) throw new Error("不存在的商家应显示未找到提示");
const emptyHtml = hooks.renderPublisherRecordsHtml("列一下媒体", { publishers: [] }, "zh");
if (!emptyHtml.includes("未找到匹配的媒体")) throw new Error("空数据应显示未找到提示");
const sortedHtml = hooks.renderPublisherRecordsHtml("销售最高的 3 个媒体", pubData, "zh");
const salesRows = sortedHtml.match(/<td class="num">\$[\d,.]*<\/td>/g) || [];
if (salesRows.length < 3) throw new Error("按销售排序后应输出限额 3 行");

console.log("PASS: chatbot publisher records contract tests");
