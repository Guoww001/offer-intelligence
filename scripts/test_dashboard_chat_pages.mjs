import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

assert(html.includes('id="dashboardSubnav"'), "Dashboard must expose a child navigation");
assert(html.includes('id="chatbotNav"'), "Chatbot child navigation is missing");
assert(html.includes('id="agentNav"'), "Agent child navigation is missing");
assert(html.includes('id="dashboardAgentPage"'), "Agent page shell is missing");
assert(html.includes('id="agentChatForm"'), "Agent page form is missing");
assert(app.includes('switchPage("agent")'), "Agent navigation must route to the Agent page");
assert(app.includes('state.page === "agent"'), "Agent page state must be handled");
assert(app.includes("agentPage: {"), "Agent page needs isolated state");
assert(app.includes("handleAgentPageSubmit"), "Agent page submit handler is missing");
assert(styles.includes(".dashboard-agent-page"), "Agent page styles are missing");
assert(html.includes('class="agent-page-title-row"'), "Agent page title row is missing");
assert(html.includes('data-agent-surface="workspace"'), "Agent workspace marker is missing");
assert(styles.includes(".dashboard-agent-page .message.user .chat-stream-text"), "Agent user message contrast styles are missing");
assert(styles.includes(".dashboard-agent-page .chat-stream-text table"), "Agent response table styles are missing");
assert(styles.includes('html[lang="zh-Hans"] body.dashboard-mode .dashboard-agent-page .message.user::before'), "Agent Chinese message labels are missing");
assert(html.includes('class="agent-chat-context"'), "Agent chat context bar is missing");
assert(html.includes('class="agent-input-meta"'), "Agent input meta row is missing");
assert(html.includes('class="agent-send-icon"'), "Agent send icon is missing");
assert(html.includes('class="agent-example-prompt"'), "Agent example prompt card is missing");
assert(html.includes("Tapo，ID398679，epc和conversion帮我查询下"), "Agent example prompt copy is missing");
assert(styles.includes(".dashboard-agent-page .agent-chat-context"), "Agent context bar styles are missing");
assert(styles.includes(".dashboard-agent-page .agent-input-meta"), "Agent input meta styles are missing");
assert(styles.includes(".dashboard-agent-page .agent-send-icon"), "Agent send icon styles are missing");
assert(styles.includes(".dashboard-agent-page .agent-example-prompt"), "Agent example prompt styles are missing");
assert(app.includes("agent-chat-log-has-messages"), "Agent conversation state class is missing");
assert(app.includes("data-agent-example-prompt-key"), "Agent example prompt click target is missing");
assert(app.includes("agentChatInput.value = prompt"), "Agent example prompt should populate the composer");
assert(styles.includes(".agent-chat-log.agent-chat-log-has-messages .agent-page-welcome"), "Agent welcome state hide styles are missing");
assert(styles.includes(".agent-page-chat-panel .message.assistant"), "Agent assistant surface override is missing");
assert(styles.includes(".agent-page-chat-panel {\n    height: clamp(520px, calc(100dvh - 260px), 680px);"), "Agent mobile chat panel height constraint is missing");
assert(styles.includes("@media (prefers-reduced-motion: reduce)"), "Reduced-motion coverage is missing");

console.log("PASS: Dashboard Chatbot/Agent page contract");
