import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes('class="agent-page-welcome-logo"'), "Static Agent welcome logo is missing");
assert(html.includes('aria-label="YeahPromos"'), "Static Agent welcome logo label is missing");
assert(html.includes('class="agent-page-welcome-logo-wordmark"'), "Static Agent welcome wordmark is missing");
assert(html.includes('class="agent-page-welcome-logo-base">YEAH</span>'), "Static Agent welcome logo base text is missing");
assert(html.includes('class="agent-page-welcome-logo-accent">P</span>'), "Static Agent welcome logo accent is missing");
assert(html.includes('class="agent-page-welcome-logo-tail">ROMOS</span>'), "Static Agent welcome logo tail text is missing");
assert(!html.includes('class="agent-page-welcome-mark"'), "Static Agent welcome star icon should be removed");
assert(html.includes("What would you like to query?"), "Static Agent welcome title copy is outdated");
assert(app.includes("agent-page-welcome-logo"), "Dynamic Agent welcome logo is missing");
assert(app.includes('aria-label="YeahPromos"'), "Dynamic Agent welcome logo label is missing");
assert(app.includes('agent-page-welcome-logo-wordmark'), "Dynamic Agent welcome wordmark is missing");
assert(app.includes('agent-page-welcome-logo-base">YEAH</span>'), "Dynamic Agent welcome logo base text is missing");
assert(app.includes('agent-page-welcome-logo-accent">P</span>'), "Dynamic Agent welcome logo accent is missing");
assert(app.includes('agent-page-welcome-logo-tail">ROMOS</span>'), "Dynamic Agent welcome logo tail text is missing");
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
assert(/color:\s*var\(--agent-ink\)\s*;/.test(logoStyle), "YeahPromos Logo should use the Agent ink color");
assert(/font-size:\s*clamp\(24px,\s*2\.7vw,\s*30px\)\s*;/.test(logoStyle), "YeahPromos Logo should keep a compact wordmark scale");
assert(/margin-bottom:\s*12px\s*;/.test(logoStyle), "Yeah Logo should have breathing room below it");

const wordmarkStyleStart = styles.lastIndexOf("body.dashboard-mode .dashboard-agent-page .agent-page-welcome-logo-wordmark {");
const wordmarkStyleEnd = styles.indexOf("}", wordmarkStyleStart);
const wordmarkStyle = styles.slice(wordmarkStyleStart, wordmarkStyleEnd);
assert(wordmarkStyleStart !== -1, "YeahPromos wordmark styles are missing");
assert(/font-family:\s*Arial,\s*Helvetica,\s*sans-serif\s*;/.test(wordmarkStyle), "YeahPromos Logo should use a neutral wordmark font");
assert(/letter-spacing:\s*-0\.065em\s*;/.test(wordmarkStyle), "YeahPromos Logo should keep the wordmark compact");
assert(styles.includes(".dashboard-agent-page .agent-page-welcome-logo-accent"), "YeahPromos red accent style is missing");
assert(styles.includes(".dashboard-agent-page .agent-page-welcome-logo-tail"), "YeahPromos tail style is missing");

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

console.log("PASS: Agent welcome uses the YeahPromos wordmark");
