import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const styles = fs.readFileSync("public/styles.css", "utf8");

assertMatch(
  styles,
  /\.mode-btn\.mode-help\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*opacity:\s*0\.62;/,
  "使用说明应保持低调显示"
);
assertMatch(
  styles,
  /\.mode-btn\.mode-user-guide\s*\{[^}]*border-color:\s*rgba\(118,\s*94,\s*170,\s*0\.26\);[^}]*background:\s*rgba\(118,\s*94,\s*170,\s*0\.08\);[^}]*opacity:\s*1;/,
  "使用流程应有轻微突出效果"
);
assertMatch(
  styles,
  /\.mode-btn\.mode-user-guide:hover,\s*\.mode-btn\.mode-user-guide:focus-visible,\s*\.mode-btn\.mode-user-guide\.active\s*\{[^}]*background:\s*rgba\(118,\s*94,\s*170,\s*0\.16\);/,
  "使用流程悬停或打开时应进一步突出"
);
assertMatch(
  styles,
  /body\.dashboard-mode:not\(\[data-dash-theme="light"\]\) :is\(\.insight-panel, \.chat-panel\) \.mode-btn\.mode-help:hover,\s*body\.dashboard-mode:not\(\[data-dash-theme="light"\]\) :is\(\.insight-panel, \.chat-panel\) \.mode-btn\.mode-help:focus-visible,\s*body\.dashboard-mode:not\(\[data-dash-theme="light"\]\) :is\(\.insight-panel, \.chat-panel\) \.mode-btn\.mode-help\.active\s*\{[^}]*background:\s*rgba\(184,\s*194,\s*207,\s*0\.08\);/,
  "深色主题下使用说明也应保持低调"
);

console.log("PASS: chatbot button hierarchy contract tests");
