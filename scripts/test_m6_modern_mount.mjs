import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n?/g, "\n");
const html = read("public/index.html");
const entry = read("frontend/src/entry.ts");
const app = read("public/app.js");
const styles = read("public/styles.css");

assert.match(html, /id="chatbotModernRoot"/, "index.html 必须提供 Chatbot modern root");
assert.match(html, /id="agentModernRoot"/, "index.html 必须提供 Agent modern root");
assert.match(entry, /ChatbotPage/, "entry.ts 必须导入 ChatbotPage");
assert.match(entry, /AgentPage/, "entry.ts 必须导入 AgentPage");
assert.match(entry, /(?:["']dashboard["']|dashboard)\s*:/, "entry.ts 必须注册 dashboard factory");
assert.match(entry, /(?:["']agent["']|agent)\s*:/, "entry.ts 必须注册 agent factory");

for (const page of ["dashboard", "agent"]) {
  assert.match(app, new RegExp(`hasPage\\("${page}"\\)`), `${page} 必须检查 modern factory`);
  assert.match(app, new RegExp(`mountPage\\("${page}"`), `${page} 必须优先挂载 modern page`);
  assert.match(app, new RegExp(`unmountPage\\("${page}"\\)`), `${page} 必须清理 modern page`);
}

assert.match(styles, /#dashboardAgentPage\.is-modern\s*>\s*:not\(#agentModernRoot\)/, "Agent modern mount 必须隐藏 legacy 内容");
assert.match(styles, /\.main-grid\.dashboard-page\.is-modern\s*>\s*:not\(#chatbotModernRoot\)/, "Chatbot modern mount 必须隐藏 legacy 内容");
assert.match(styles, /\.topbar\.dashboard-page\.is-modern\s*>\s*div:first-child/, "Chatbot modern mount 必须收敛 legacy 顶部标题");
assert.match(app, /Modern Chatbot unavailable; continuing with the legacy chatbot\./, "Chatbot modern mount 必须保留 legacy 回退");
assert.match(app, /Modern Agent unavailable; continuing with the legacy Agent page\./, "Agent modern mount 必须保留 legacy 回退");

console.log("M6 modern mount contract: PASS");
