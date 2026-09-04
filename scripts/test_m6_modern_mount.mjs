import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n?/g, "\n");
const html = read("public/index.html");
const entry = read("frontend/src/entry.ts");
const agentHost = read("frontend/src/features/agent/CopilotKitAgentHost.vue");
const app = read("public/app.js");
const styles = read("public/styles.css");
const chatbotStyles = read("frontend/src/features/chatbot/chatbot.css");

assert.match(html, /id="chatbotModernRoot"/, "index.html 必须提供 Chatbot modern root");
assert.match(html, /id="agentModernRoot"/, "index.html 必须提供 Agent modern root");
assert.match(entry, /ChatbotPage/, "entry.ts 必须导入 ChatbotPage");
assert.match(entry, /AgentPage/, "entry.ts 必须导入 AgentPage");
assert.match(entry, /createChatbotSession/, "entry.ts 必须创建独立 Chatbot session");
assert.match(entry, /createAgentSession/, "entry.ts 必须创建独立 Agent session");
assert.doesNotMatch(entry, /OI_LEGACY_BRIDGE\?\.(?:chatSession|deepWindows|agentSession|runChat|runAgent)/, "Modern Chatbot/Agent 正常链路不得读取 Legacy session 或 runner");
assert.doesNotMatch(agentHost, /OI_LEGACY_BRIDGE/, "CopilotKit 前端工具不得通过 Legacy bridge 执行");
assert.match(agentHost, /toolExecutor/, "CopilotKit 前端工具必须注入独立工具执行器");
assert.match(entry, /(?:["']dashboard["']|dashboard)\s*:/, "entry.ts 必须注册 dashboard factory");
assert.match(entry, /(?:["']agent["']|agent)\s*:/, "entry.ts 必须注册 agent factory");

for (const page of ["dashboard", "agent"]) {
  assert.match(app, new RegExp(`hasPage\\("${page}"\\)`), `${page} 必须检查 modern factory`);
  assert.match(app, new RegExp(`mountPage\\("${page}"`), `${page} 必须优先挂载 modern page`);
  assert.match(app, new RegExp(`unmountPage\\("${page}"\\)`), `${page} 必须清理 modern page`);
}

assert.match(styles, /#dashboardAgentPage\.is-modern\s*>\s*:not\(#agentModernRoot\)/, "Agent modern mount 必须隐藏 legacy 内容");
assert.match(styles, /\.main-grid\.dashboard-page\.is-modern\s*>\s*:not\(#chatbotModernRoot\)/, "Chatbot modern mount 必须隐藏 legacy 内容");
assert(
  !/\.topbar\.dashboard-page\.is-modern\s*>\s*div:first-child/.test(styles),
  "Modern 对照不得隐藏 Legacy 顶部标题"
);
assert.match(
  chatbotStyles,
  /grid-template-columns:\s*minmax\(380px,\s*1\.04fr\)\s*minmax\(0,\s*0\.96fr\)/,
  "Modern Chatbot 必须复用 Legacy Dashboard 的双栏比例"
);
assert.match(
  styles,
  /\.main-grid\.dashboard-page\.is-modern\s*>\s*#chatbotModernRoot\s*\{[\s\S]*?min-height:\s*clamp\(620px,\s*calc\(100vh\s*-\s*150px\),\s*820px\)/,
  "Modern Chatbot 根节点必须继承 Legacy Dashboard 的视口高度"
);
assert.match(
  styles,
  /body\.dashboard-agent-mode\s+\.workspace\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/,
  "Agent 页面工作区必须保留桌面端垂直滚动"
);
assert.match(chatbotStyles, /@media\s*\(max-width:\s*1120px\)/, "Modern Chatbot 必须复用 Legacy Dashboard 的单栏断点");
assert(
  !/\.chatbot-(?:report|chat)-layout\s*>\s*\.insight-panel\s*\{[^}]*display:\s*none/s.test(chatbotStyles),
  "Modern Chatbot 窄屏不得隐藏 Legacy 洞察面板"
);
assert.match(
  chatbotStyles,
  /body\.dashboard-mode[^{]*\.chatbot-report-log\s+\.message\.assistant/,
  "Modern Report 气泡必须补齐无 Legacy ID 的深色主题样式"
);
assert.match(
  chatbotStyles,
  /body\.dashboard-mode\[data-dash-theme="light"\][^{]*\.chatbot-chat-log\s+\.message\.assistant/,
  "Modern Chat 气泡必须补齐无 Legacy ID 的浅色主题样式"
);
assert.match(app, /Modern Chatbot unavailable; continuing with the legacy chatbot\./, "Chatbot modern mount 必须保留 legacy 回退");
assert.match(app, /Modern Agent unavailable; continuing with the legacy Agent page\./, "Agent modern mount 必须保留 legacy 回退");

console.log("M6 modern mount contract: PASS");
