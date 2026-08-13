import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");

// ── Task 1: 菜单第 9 项 + 命令前缀注册 ──
assertMatch(html, /data-chat-intent="publisherprofile"/, "提问类型菜单应包含 publisherprofile 选项");
assertMatch(html, /data-chat-intent="publisher"[\s\S]{0,600}data-chat-intent="publisherprofile"/, "publisherprofile 选项应位于 publisher 之后");
assertMatch(html, /data-chat-intent="publisherprofile"[\s\S]{0,200}>Publisher Profile</, "publisherprofile 选项显示应为 Publisher Profile");
assertMatch(app, /\{ key: "publisherprofile", intent: "publisherprofile" \}/, "CHAT_INTENT_OPTIONS 应注册 publisherprofile 意图");
assertMatch(app, /categorytier\|merchant\|category\|tier\|trend\|payment\|asin\|publisherprofile\|publisher/, "命令解析应支持 publisherprofile 前缀（且在 publisher 之前）");
assertMatch(app, /"chat\.intent\.publisherProfile": "媒体画像"/, "中文 i18n 应提供 publisherprofile 菜单文案");
assertMatch(app, /"chat\.intent\.publisherProfileHint": "媒体画像查询"/, "中文 i18n 应提供 publisherprofile 提示文案");

console.log("PASS: chatbot publisher profile contract tests (Task 1 static)");
