import fs from "node:fs";
import vm from "node:vm";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

assertMatch(app, /function createChatQuestionEventId\s*\(/, "应生成稳定提问 UUID");
assertMatch(app, /eventId:\s*questionEventId/, "创建提问日志应提交浏览器 UUID");
assertMatch(app, /function attachAnswerFeedbackButton\s*\(/, "应能附加不满意按钮");
assertMatch(app, /context\.language === "zh" \? "👎踩" : "👎Dislike"/, "中英文反馈按钮应显示为对应的👎短标签");
assertMatch(app, /function sendAnswerFeedback\s*\(/, "应有反馈提交函数");
assertMatch(app, /operation=feedback/, "反馈应复用 stream 端点");
assertMatch(app, /fullResponse/, "Chat 反馈应保留原始 Markdown 回答");
assertMatch(app, /panel\.contentEl\?\.(?:innerText|textContent)/, "Report 反馈应读取当前面板文本");
if (/\/api\/chat\/feedback/.test(app)) throw new Error("不得新增独立反馈端点");

assertMatch(html, /id="answerFeedbackDialog"/, "应提供反馈对话框");
assertMatch(html, /name="answerFeedbackReason"[^>]+value="inaccurate"/, "应提供回答不准确原因");
assertMatch(html, /name="answerFeedbackReason"[^>]+value="not_answered"/, "应提供没有回答问题原因");
assertMatch(html, /name="answerFeedbackReason"[^>]+value="incomplete_data"/, "应提供数据不完整原因");
assertMatch(html, /name="answerFeedbackReason"[^>]+value="unclear"/, "应提供难以理解原因");
assertMatch(html, /name="answerFeedbackReason"[^>]+value="other"/, "应提供其他原因");
assertMatch(html, /chat-log-group-title[^>]*>\s*提问记录/, "日志菜单应包含提问记录分组");
assertMatch(html, /chat-log-group-title[^>]*>\s*不满意反馈/, "日志菜单应包含反馈分组");
assertMatch(html, /data-chat-log-kind="feedback"[^>]+data-chat-log-format="csv"/, "反馈分组应提供 CSV");
assertMatch(html, /data-chat-log-kind="feedback"[^>]+data-chat-log-format="jsonl"/, "反馈分组应提供 JSONL");
assertMatch(app, /operation=\$\{safeKind\}/, "日志导出应按分组选择 operation");
assertMatch(app, /What went wrong\?/, "反馈对话框应提供英文标题");
assertMatch(app, /The answer is inaccurate/, "反馈原因应提供英文文案");
assertMatch(app, /context\.answerSnapshot/, "点击反馈时应冻结回答快照");
assertMatch(app, /const submission = activeAnswerFeedback/, "异步提交应捕获局部反馈上下文");
assertMatch(app, /activeAnswerFeedback === submission/, "异步响应不得关闭或覆盖另一反馈面板");
assertMatch(app, /function ensureQuestionLogSuccess\s*\(/, "反馈重试应能幂等恢复提问日志");
assertMatch(app, /feedback_already_exists/, "已存在反馈的 409 应转为已反馈状态");
assertMatch(app, /function trapAnswerFeedbackFocus\s*\(/, "模态反馈框应约束 Tab 焦点");
assertMatch(app, /e\.key === "Tab"[\s\S]+trapAnswerFeedbackFocus\(e\)/, "键盘 Tab 应留在反馈框内");
assertMatch(app, /els\.answerFeedbackDialog\s*=\s*document\.getElementById\("answerFeedbackDialog"\)/, "初始化时应重新解析动态反馈节点");
assertMatch(app, /event\.target\.closest\("\.answer-feedback-button\[data-answer-feedback-context\]"\)/, "反馈按钮应使用可承受节点替换的事件委托");
assertMatch(styles, /\.answer-feedback-button\s*\{/, "应提供低调反馈按钮样式");
assertMatch(styles, /\.answer-feedback-button:focus-visible/, "反馈按钮应有键盘焦点样式");
assertMatch(styles, /\.answer-feedback-dialog\s*\{/, "应提供反馈对话框布局");
assertMatch(styles, /data-dash-theme="light"[\s\S]+\.answer-feedback-card/, "反馈对话框应支持浅色主题");
assertMatch(html, /class="answer-feedback-mood"[^>]*>😡<\/span>/, "反馈面板应显示愤怒表情");
assertMatch(styles, /\.answer-feedback-mood\s*\{/, "愤怒表情应有专属样式");
assertMatch(html, /styles\.css\?v=20260807-publisher1/, "反馈样式应提升缓存版本");
assertMatch(html, /auth\.js\?v=20260807-publisher2/, "反馈脚本应提升缓存版本");

const storageValues = new Map();
const requests = [];
let fetchImpl = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) });
  return { ok: true, async json() { return { ok: true }; } };
};
const elementStub = {
  addEventListener() {}, appendChild() {}, insertBefore() {}, remove() {}, click() {}, focus() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, style: {}, querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, removeAttribute() {}, closest() { return null; }, reset() {}
};
let uuidIndex = 0;
const uuids = [
  "f319e5c4-7a7e-4a93-8e77-7da8db4aecb2",
  "6d20e540-f7e0-49dd-b9d1-161f327c2e71",
  "63b496be-1aa8-4ec0-bcc3-28a823aff76d",
];
const sandbox = {
  console: { ...console, warn() {} }, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  Uint8Array, TextDecoder, TextEncoder, clearInterval, setInterval, clearTimeout, setTimeout,
  fetch(...args) { return fetchImpl(...args); },
  localStorage: {
    getItem(key) { return storageValues.get(key) || null; },
    setItem(key, value) { storageValues.set(key, value); },
    removeItem(key) { storageValues.delete(key); }
  },
  document: {
    body: { ...elementStub },
    getElementById() { return { ...elementStub }; }, querySelectorAll() { return []; },
    querySelector() { return { ...elementStub }; }, createElement() { return { ...elementStub }; },
    addEventListener() {}
  },
  window: {
    __OFFER_INTELLIGENCE_TEST__: true,
    crypto: { randomUUID() { return uuids[uuidIndex++] || uuids.at(-1); } }
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
if (!hooks) throw new Error("应暴露反馈测试 hooks");
const eventId = hooks.createChatQuestionEventId();
if (!/^[0-9a-f-]{36}$/.test(eventId)) throw new Error("提问事件 ID 应为 UUID");

requests.length = 0;
await hooks.beginQuestionLog("测试问题", "chat", "zh", "unknown", eventId);
if (requests[0].body.eventId !== eventId) throw new Error("提问日志应使用预生成 UUID");

requests.length = 0;
const context = {
  questionPromise: Promise.resolve({ recordId: eventId }),
  feedbackEventId: "63b496be-1aa8-4ec0-bcc3-28a823aff76d",
  mode: "chat",
  prompt: "测试问题",
  language: "zh",
  getAnswer() { return "原始 **Markdown** 回答"; }
};
await hooks.sendAnswerFeedback(context, "inaccurate", "数字不正确");
const feedbackRequest = requests[0];
if (!feedbackRequest.url.includes("operation=feedback")) throw new Error("反馈应提交到现有 stream 路由");
if (feedbackRequest.body.questionEventId !== eventId) throw new Error("反馈应关联提问 UUID");
if (feedbackRequest.body.answer !== "原始 **Markdown** 回答") throw new Error("应提交回答快照");
if (feedbackRequest.body.reasonCode !== "inaccurate") throw new Error("应提交标准原因代码");

console.log("PASS: chatbot answer feedback frontend contract tests");
