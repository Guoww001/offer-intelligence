import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

const reportLogStart = html.indexOf('<div class="chat-log" id="chatLog">');
const chatLogStart = html.indexOf('<div class="chat-log hidden" id="chatLogChat">');
const guideStart = html.indexOf('class="report-mode-guide"');

assert(reportLogStart >= 0, "Report Mode 聊天区不存在");
assert(chatLogStart > reportLogStart, "Chat Mode 聊天区结构异常");
assert(
  guideStart > reportLogStart && guideStart < chatLogStart,
  "说明卡片必须位于 Report Mode 聊天区顶部，并且不应放入 Chat Mode 聊天区"
);

for (const key of [
  "report.modeGuideKicker",
  "report.modeGuideTitle",
  "report.modeGuideBody",
  "report.modeGuideReminder"
]) {
  assert(html.includes(`data-i18n="${key}"`), `缺少说明卡片文案标记：${key}`);
  assert(app.includes(`"${key}"`), `缺少中文翻译：${key}`);
}

assert(
  app.includes("具体要求请转至聊天模式"),
  "说明卡片必须提醒用户将具体要求转至聊天模式"
);
assert(styles.includes(".report-mode-guide"), "缺少说明卡片基础样式");
assert(
  styles.includes("body.dashboard-mode[data-dash-theme=\"light\"] .report-mode-guide"),
  "缺少说明卡片浅色主题样式"
);
assert(
  styles.includes("body.dashboard-mode:not([data-dash-theme=\"light\"]) .report-mode-guide"),
  "缺少说明卡片深色主题样式"
);
assert(
  app.includes('if (chatLog) chatLog.classList.toggle("hidden", isChat);'),
  "Report Mode 聊天区缺少模式切换隐藏逻辑"
);

console.log("PASS: Report Mode 说明卡片检查通过");
