import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes('class="agent-page-welcome-logo"'), "Static Agent welcome logo is missing");
assert(html.includes('aria-label="Yeah"'), "Static Agent welcome logo label is missing");
assert(html.includes('>Yeah</span>'), "Static Agent welcome logo text is missing");
assert(!html.includes('class="agent-page-welcome-mark"'), "Static Agent welcome star icon should be removed");
assert(html.includes("What would you like to query?"), "Static Agent welcome title copy is outdated");
assert(app.includes("agent-page-welcome-logo"), "Dynamic Agent welcome logo is missing");
assert(app.includes('aria-label="Yeah"'), "Dynamic Agent welcome logo label is missing");
assert(app.includes(">Yeah</span>"), "Dynamic Agent welcome logo text is missing");
assert(!app.includes("agent-page-welcome-mark"), "Dynamic Agent welcome star icon should be removed");
assert(app.includes('"agent.welcome.title": "你想查询什么？"'), "Chinese Agent welcome title copy is outdated");
assert(app.includes('t("agent.welcome.title", "What would you like to query?")'), "Dynamic Agent welcome title fallback is outdated");
assert(styles.includes(".agent-page-welcome-logo"), "Agent welcome logo styles are missing");
assert(!styles.includes("agent-page-welcome-mark::after"), "Agent welcome star-dot pseudo element should be removed");

const logoStyleStart = styles.lastIndexOf("body.dashboard-mode .dashboard-agent-page .agent-page-welcome-logo {");
const logoStyleEnd = styles.indexOf("}", logoStyleStart);
const logoStyle = styles.slice(logoStyleStart, logoStyleEnd);
assert(/border:\s*0\s*;/.test(logoStyle), "Yeah Logo should not have a border frame");
assert(/border-radius:\s*0\s*;/.test(logoStyle), "Yeah Logo should not have rounded corners");
assert(/background:\s*transparent\s*;/.test(logoStyle), "Yeah Logo should not have a background tile");
assert(/box-shadow:\s*none\s*;/.test(logoStyle), "Yeah Logo should not have a container shadow");
assert(/color:\s*var\(--agent-primary\)\s*;/.test(logoStyle), "Yeah Logo should use the Agent blue");
assert(/font-size:\s*clamp\(30px,\s*3\.6vw,\s*42px\)\s*;/.test(logoStyle), "Yeah Logo should be larger than the welcome heading");
assert(/letter-spacing:\s*0\.12em\s*;/.test(logoStyle), "Yeah Logo letter spacing should be more generous");
assert(/margin-bottom:\s*12px\s*;/.test(logoStyle), "Yeah Logo should have breathing room below it");

const promptStyleStart = styles.lastIndexOf("body.dashboard-mode .dashboard-agent-page .agent-example-prompt {");
const promptStyleEnd = styles.indexOf("}", promptStyleStart);
const promptStyle = styles.slice(promptStyleStart, promptStyleEnd);
assert(/margin:\s*36px auto 0\s*;/.test(promptStyle), "Example prompt card should sit lower in the welcome flow");

const emptyChatStyleStart = styles.lastIndexOf("body.dashboard-mode .dashboard-agent-page .agent-chat-log:not(.agent-chat-log-has-messages) {");
const emptyChatStyleEnd = styles.indexOf("}", emptyChatStyleStart);
const emptyChatStyle = styles.slice(emptyChatStyleStart, emptyChatStyleEnd);
assert(emptyChatStyleStart !== -1, "Empty Agent chat layout rule is missing");
assert(/padding-top:\s*clamp\(24px,\s*5vh,\s*52px\)\s*;/.test(emptyChatStyle), "Empty Agent chat should have balanced top breathing room");
assert(/padding-bottom:\s*clamp\(24px,\s*5vh,\s*52px\)\s*;/.test(emptyChatStyle), "Empty Agent chat should have balanced bottom breathing room");

assert(styles.includes("min-height: clamp(300px, 46vh, 420px);"), "Welcome content should occupy a balanced vertical zone");

console.log("PASS: Agent welcome uses the Yeah logo");
