import fs from "node:fs";
import vm from "node:vm";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

assertMatch(app, /function getChatQuestionSessionId\s*\(/, "应创建匿名会话 ID");
assertMatch(app, /function beginQuestionLog\s*\(/, "应异步创建提问日志");
assertMatch(app, /function completeQuestionLog\s*\(/, "应异步完成提问日志");
assertMatch(app, /mode:\s*isDeep\s*\?\s*["']report["']\s*:\s*["']chat["']/, "应区分 Report 和 Chat 模式");
assertMatch(app, /completeQuestionLog\([^;]+["']success["']/, "成功回答应更新日志状态");
assertMatch(app, /completeQuestionLog\([^;]+["']failed["']/, "失败回答应更新日志状态");
assertMatch(app, /chatbotI18n\.detectIntent/, "应记录本地识别的意图");
assertMatch(app, /\/api\/chat\/stream\?operation=questions/, "前端应复用现有聊天端点");
if (/\/api\/chat\/questions/.test(app)) throw new Error("不得新增独立提问日志端点");
assertMatch(app, /sessionId:\s*getChatQuestionSessionId\(\)/, "创建和完成日志时应携带匿名会话 ID");

assertMatch(html, /id="chatLogsButton"/, "聊天页应提供低调的日志按钮");
assertMatch(html, /data-chat-log-format="csv"/, "日志菜单应提供 CSV");
assertMatch(html, /data-chat-log-format="jsonl"/, "日志菜单应提供 JSONL");
assertMatch(html, /id="chatLogsButton"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/, "日志按钮应包含菜单可访问属性");
assertMatch(html, /id="chatLogsMenu"[^>]+role="menu"/, "日志菜单应使用 menu 语义");
assertMatch(app, /event\.target\.closest\("\.chat-logs-control"\)/, "点击菜单外部应关闭菜单");
assertMatch(app, /e\.key === "Escape"[\s\S]+setChatLogsMenuOpen\(false\)/, "Escape 应关闭日志菜单");
assertMatch(styles, /\.mode-btn\.mode-logs:focus-visible/, "日志按钮应有键盘焦点样式");
assertMatch(styles, /not\(\[data-dash-theme="light"\]\)[\s\S]+\.chat-logs-menu/, "日志菜单应支持深色主题");

const storageValues = new Map();
let storageThrows = false;
let fetchImpl = async () => ({ ok: true, async json() { return { ok: true, recordId: "6d20e540-f7e0-49dd-b9d1-161f327c2e71" }; } });
const elementStub = {
  addEventListener() {}, appendChild() {}, insertBefore() {}, remove() {}, click() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, style: {}, querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, removeAttribute() {}, closest() { return null; }
};
const sandbox = {
  console: { ...console, warn() {} }, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  Uint8Array, TextDecoder, clearInterval, setInterval, clearTimeout, setTimeout,
  fetch(...args) { return fetchImpl(...args); },
  localStorage: {
    getItem(key) { if (storageThrows) throw new Error("storage disabled"); return storageValues.get(key) || null; },
    setItem(key, value) { if (storageThrows) throw new Error("storage disabled"); storageValues.set(key, value); },
    removeItem(key) { storageValues.delete(key); }
  },
  document: {
    body: { ...elementStub },
    getElementById() { return elementStub; }, querySelectorAll() { return []; },
    querySelector() { return elementStub; }, createElement() { return { ...elementStub }; },
    addEventListener() {}
  },
  window: {
    __OFFER_INTELLIGENCE_TEST__: true,
    crypto: { randomUUID() { return "f319e5c4-7a7e-4a93-8e77-7da8db4aecb2"; } }
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
if (!hooks) throw new Error("应暴露提问日志测试 hooks");
const firstSession = hooks.getChatQuestionSessionId();
const secondSession = hooks.getChatQuestionSessionId();
if (firstSession !== secondSession) throw new Error("同一页面应复用匿名会话 ID");
hooks.resetChatQuestionSessionForTest();
if (hooks.getChatQuestionSessionId() !== firstSession) throw new Error("应从 localStorage 恢复匿名会话 ID");
storageThrows = true;
hooks.resetChatQuestionSessionForTest();
const fallbackSession = hooks.getChatQuestionSessionId();
if (hooks.getChatQuestionSessionId() !== fallbackSession) throw new Error("localStorage 异常时页面内会话仍应稳定");
storageThrows = false;

const requests = [];
fetchImpl = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) });
  return { ok: true, async json() { return { ok: true, recordId: "6d20e540-f7e0-49dd-b9d1-161f327c2e71" }; } };
};
const started = hooks.beginQuestionLog("测试问题", "report", "zh", "merchant");
await hooks.completeQuestionLog(started, "success", "merchant");
if (requests[0].body.action !== "create" || requests[0].body.mode !== "report") throw new Error("create payload 应保留模式快照");
if (requests[1].body.action !== "complete" || requests[1].body.recordId !== "6d20e540-f7e0-49dd-b9d1-161f327c2e71") throw new Error("complete 应更新同一记录");
if (requests[0].body.sessionId !== requests[1].body.sessionId) throw new Error("创建与完成应使用同一匿名会话");

fetchImpl = async () => { throw new Error("logging unavailable"); };
const failedStart = await hooks.beginQuestionLog("仍应继续", "chat", "zh", "unknown");
if (failedStart !== null) throw new Error("日志网络异常应被吸收");
await hooks.completeQuestionLog(Promise.reject(new Error("create failed")), "failed", "unknown");

console.log("PASS: chatbot question logging frontend contract tests");
