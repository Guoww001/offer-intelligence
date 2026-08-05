import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const welcome = fs.readFileSync("public/chatbot_welcome.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assert(welcome.includes("function _requestMode(mode)"), "welcome panel should expose a mode request helper");
assert(welcome.includes('new CustomEvent("chatbot-mode-requested"'), "welcome panel should dispatch mode requests");
assert(welcome.includes('_requestMode(kind === "chat" ? "chat" : "report")'), "chip clicks should request their section mode");
assert(welcome.includes('t.closest(".welcome-col")'), "welcome panel should handle clicks on the whole mode section");
assert(app.includes('document.addEventListener("chatbot-mode-requested"'), "app should listen for welcome panel mode requests");
assert(app.includes('if (mode === "chat") _switchToChatMode();'), "Chat request should enter Chat Mode");
assert(app.includes('if (mode === "report") _switchToReportMode();'), "Report request should enter Report Mode");

console.log("PASS: Chatbot 助手面板模式跳转检查通过");
