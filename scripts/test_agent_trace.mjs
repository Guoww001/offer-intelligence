import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

function assertNotMatch(text, pattern, label) {
  if (pattern.test(text)) throw new Error(`${label}: 不应匹配 ${pattern}`);
}

const app = fs.readFileSync("public/app.js", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");
const agentHandlerStart = app.indexOf("async function handleAgentPageSubmit");
const applyPromptStart = app.indexOf("async function applyPrompt");
const runAgentStart = app.indexOf("async function runChatAgent");
const streamStart = app.indexOf("async function streamAssistantReply");
const streamEnd = app.indexOf("\n  function attachChatViewButton", streamStart);
const applyPromptEnd = app.indexOf("\n  function renderMetrics", applyPromptStart);
if (agentHandlerStart < 0 || applyPromptStart < 0 || applyPromptEnd < 0 || runAgentStart < 0 || streamStart < 0 || streamEnd < 0) {
  throw new Error("无法定位 Agent 生命周期函数");
}

const handler = app.slice(agentHandlerStart, applyPromptStart);
const applyPrompt = app.slice(applyPromptStart, applyPromptEnd);
const runAgent = app.slice(runAgentStart, app.indexOf("\n  function agentPageWelcomeHtml", runAgentStart));
const stream = app.slice(streamStart, streamEnd);

for (const name of [
  "createAgentTraceContext",
  "startAgentTrace",
  "appendAgentTraceSteps",
  "completeAgentTrace",
  "normalizeAgentTraceError",
  "agentTraceDataMeta",
  "agentTraceArgumentSignature",
]) {
  assertMatch(app, new RegExp(`function ${name}\\s*\\(`), `缺少 ${name}`);
}

assertMatch(handler, /var\s+questionEventId\s*=\s*createChatQuestionEventId\(\)/, "Agent 页面应生成 questionEventId");
assertMatch(handler, /createAgentTraceContext\(questionEventId,\s*language\)/, "Agent 页面应复用同一 Trace context");
assertMatch(handler, /traceContext\s*:\s*traceContext/, "Agent 页面应把 Trace context 传给 runChatAgent");
assertMatch(applyPrompt, /var\s+questionEventId\s*=\s*createChatQuestionEventId\(\)/, "Chat/Report 应生成 questionEventId");
assertMatch(applyPrompt, /createAgentTraceContext\(questionEventId,\s*language\)/, "Chat/Report Agent 应复用同一 Trace context");

assertMatch(runAgent, /phase\s*:\s*["']planning["']/, "Trace 应记录 planning 阶段");
assertMatch(runAgent, /phase\s*:\s*["']tool["']/, "Trace 应记录 tool 阶段");
assertMatch(runAgent, /phase\s*:\s*["']synthesis["']/, "Trace 应记录 synthesis 阶段");
assertMatch(runAgent, /appendAgentTraceSteps\(/, "Agent 应异步追加 Trace steps");
assertMatch(runAgent, /completeAgentTrace\(/, "Agent 应完成 Trace run");
assertMatch(runAgent, /stopped_by_user/, "用户中止应映射为 stopped_by_user");
assertMatch(runAgent, /llm_timeout/, "Provider timeout 应映射为 llm_timeout");
assertMatch(runAgent, /tool_error/, "工具失败应映射为 tool_error");
assertMatch(runAgent, /synthesis_unavailable/, "综合失败应映射为 synthesis_unavailable");
assertMatch(runAgent, /dataSource/, "工具 Trace 应包含 dataSource");
assertMatch(runAgent, /dataAsOf/, "工具 Trace 应包含 dataAsOf");
assertMatch(runAgent, /estimated/, "工具 Trace 应包含 estimated");
assertMatch(app, /traceDataAsOf\s*=\s*catMetrics\s*&&\s*catMetrics\.checkedAt/, "品类数据库趋势应传递 checkedAt");
assertMatch(app, /traceDataAsOf\s*=\s*monthlyMetrics\s*&&\s*monthlyMetrics\.checkedAt/, "聚合数据库趋势应传递 checkedAt");
const directBypassStart = runAgent.indexOf("if (agentShouldBypassPlanning(prompt))");
const directBypassEnd = runAgent.indexOf("\n    var planningRetry", directBypassStart);
if (directBypassStart < 0 || directBypassEnd < 0) throw new Error("无法定位直接回答路径");
assertMatch(
  runAgent.slice(directBypassStart, directBypassEnd),
  /finishTrace\(\s*["']success["']/,
  "直接回答成功后必须完成 Trace run"
);

const traceClientStart = app.indexOf("function createAgentTraceContext");
const traceClientEnd = app.indexOf("\n  async function ensureQuestionLogSuccess", traceClientStart);
const traceClient = app.slice(traceClientStart, traceClientEnd);
assertNotMatch(traceClient, /prompt\s*:/, "Trace payload 不得写入 prompt");
assertNotMatch(traceClient, /messages\s*:/, "Trace payload 不得写入 messages");
assertNotMatch(traceClient, /arguments\s*:/, "Trace payload 不得写入工具 arguments");
assertNotMatch(traceClient, /toolResult\s*:/, "Trace payload 不得写入工具结果正文");
assertNotMatch(traceClient, /response\s*:/, "Trace payload 不得写入回答正文");
assertMatch(traceClient, /console\.warn/, "Trace 网络失败应只警告并吞掉");
assertMatch(traceClient, /completionPromise|completePromise/, "Trace 完成应幂等");
assertMatch(traceClient, /normalizeAgentTraceError\(step\.errorCode\)/, "Trace errorCode 应归一化到后端白名单");

assertMatch(stream, /parsed\.type\s*===\s*["']usage["']|parsed\.type\s*==\s*["']usage["']/, "SSE 应解析 usage 事件");
assertMatch(stream, /response chunks|响应片段数/, "无 usage 时应显示响应片段数");
assertNotMatch(stream, /tokenCount\s*\+\s*["'][^"']*tokens/, "不得把片段数显示为 tokens");
assertMatch(stream, /outputTokens/, "usage 可用时应保留真实 outputTokens");

assertMatch(auth, /sources:\s*\{[^}]*checkedAt:\s*offersResp\.checkedAt/s, "auth 应传递 offers checkedAt");

console.log("PASS: Agent Trace frontend contract tests");
