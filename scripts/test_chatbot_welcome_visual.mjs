import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const css = fs.readFileSync("public/styles.css", "utf8");

assert(css.includes("--welcome-shell-top"), "welcome panel should define an independent shell palette");
assert(css.includes("#3b2a25"), "dark welcome panel should use a warm espresso shell color");
assert(css.includes("welcomePanelGlowWarm"), "welcome panel should use a warm glow animation");
assert(
  css.includes('body.dashboard-mode[data-dash-theme="light"] .welcome-panel'),
  "light theme should explicitly override the welcome panel shell"
);
assert(css.includes("#fff8f1"), "light welcome panel should use a warm paper shell color");
assert(
  css.includes('body.dashboard-mode[data-dash-theme="light"] .welcome-panel::after {\n  background: linear-gradient(135deg, var(--welcome-shell-line-strong)'),
  "light theme should use a warm panel highlight instead of the blue theme line"
);
assert(
  css.includes('body.dashboard-mode[data-dash-theme="light"] .welcome-panel {\n    animation: welcomeCardIn 0.6s cubic-bezier(0.32, 0.72, 0, 1) both,\n      welcomePanelGlowWarm'),
  "light theme should use the warm panel glow animation"
);

console.log("PASS: Chatbot 使用助手面板视觉样式检查通过");
