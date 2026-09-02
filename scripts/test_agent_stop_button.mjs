import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8").replace(/\r\n?/g, "\n");
const css = fs.readFileSync("public/styles.css", "utf8").replace(/\r\n?/g, "\n");

assert.match(
  html,
  /<button id="agentChatSubmit" type="submit" aria-label="Send">/,
  "Agent 聊天提交按钮应有稳定的 DOM id"
);
assert.match(
  app,
  /agentChatSubmit:\s*document\.getElementById\("agentChatSubmit"\)/,
  "Agent 提交按钮应被加入元素索引"
);

const handlerMatch = app.match(
  /async function handleAgentPageSubmit\(event\) \{([\s\S]*?)\n  \}\n\n  async function applyPrompt/
);
assert.ok(handlerMatch, "应能定位 Agent 提交处理函数");
assert.match(
  handlerMatch[1],
  /if \(state\.agentPage\.submitting\) \{\s*stopAgentPageConversation\(\);\s*return;/,
  "生成中再次点击提交按钮应触发中止"
);
assert.match(handlerMatch[1], /setAgentPageSubmitButtonState\(true\)/, "开始生成时应切换为中止按钮");
assert.match(handlerMatch[1], /setAgentPageSubmitButtonState\(false\)/, "生成结束后应恢复发送按钮");

const stopStyleMatch = css.match(
  /body\.dashboard-mode \.dashboard-agent-page \.agent-page-input > button\.is-stopping \{([\s\S]*?)\n\}/
);
assert.ok(stopStyleMatch, "中止按钮应有独立的视觉状态");
assert.match(
  stopStyleMatch[1],
  /background:[\s\S]*?var\(--agent-primary-deep\)[\s\S]*?var\(--agent-user-end\)/,
  "中止按钮应沿用原发送按钮的蓝色"
);
assert.doesNotMatch(stopStyleMatch[1], /#b42318|#7f1d1d/, "中止按钮不应改成红色");

console.log("Agent 发送按钮中止状态回归测试通过");
