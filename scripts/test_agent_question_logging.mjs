import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const app = fs.readFileSync("public/app.js", "utf8");
const handlerStart = app.indexOf("async function handleAgentPageSubmit");
const handlerEnd = app.indexOf("async function applyPrompt", handlerStart);
if (handlerStart < 0 || handlerEnd < 0) throw new Error("应能定位 Agent 提交处理函数");
const handler = app.slice(handlerStart, handlerEnd);

assertMatch(handler, /var\s+questionLogIntent\s*=\s*detectQuestionLogIntent\(prompt\)/, "Agent 应检测提问意图");
assertMatch(handler, /var\s+questionEventId\s*=\s*createChatQuestionEventId\(\)/, "Agent 应生成提问事件 ID");
assertMatch(handler, /beginQuestionLog\(prompt,\s*["']agent["']/, "Agent 提问应写入 agent 模式日志");
assertMatch(handler, /completeAgentQuestionLog\(["']success["']\)/, "Agent 成功回答应完成提问日志");
assertMatch(handler, /completeAgentQuestionLog\(["']failed["']\)/, "Agent 失败或中止应完成失败日志");
assertMatch(handler, /attachAnswerFeedbackButton\s*\(/, "Agent 成功回答应绑定反馈入口");
if (/\/api\/chat\/(?:questions|feedback)/.test(handler)) {
  throw new Error("Agent 不应新增独立日志或反馈端点");
}

console.log("PASS: agent question logging frontend contract tests");
