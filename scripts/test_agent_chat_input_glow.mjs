import assert from "node:assert/strict";
import fs from "node:fs";

const stylesheet = fs.readFileSync("public/styles.css", "utf8");
const focusVisibleRule = stylesheet.match(
  /body\.dashboard-mode \.dashboard-agent-page \.agent-page-input input:focus-visible\s*\{([^}]*)\}/s
);

assert.ok(focusVisibleRule, "Agent 输入框应有独立的键盘焦点样式规则");
assert.match(focusVisibleRule[1], /outline\s*:\s*none\s*!important\s*;/, "Agent 输入框不应显示高亮外轮廓");
assert.match(focusVisibleRule[1], /box-shadow\s*:\s*none\s*!important\s*;/, "Agent 输入框不应显示焦点光晕");

const lightThemeFocusRule = stylesheet.match(
  /body\.dashboard-mode\[data-dash-theme="light"\] \.dashboard-agent-page \.agent-page-input input:focus-visible\s*\{([^}]*)\}/s
);

assert.ok(lightThemeFocusRule, "浅色主题应有 Agent 输入框焦点覆盖规则");
assert.match(lightThemeFocusRule[1], /outline\s*:\s*none\s*!important\s*;/, "浅色主题下 Agent 输入框不应显示高亮外轮廓");
assert.match(lightThemeFocusRule[1], /box-shadow\s*:\s*none\s*!important\s*;/, "浅色主题下 Agent 输入框不应显示焦点光晕");

console.log("Agent 聊天框高亮光效回归测试通过");
