import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const markdown = fs.readFileSync("public/chatbot-user-guide.md", "utf8");
const englishMarkdown = fs.readFileSync("public/chatbot-user-guide-en.md", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

for (let step = 1; step <= 5; step += 1) {
  const number = String(step).padStart(2, "0");
  assertMatch(markdown, new RegExp(`^## 第 ${step} 步：`, "m"), `Markdown 应包含第 ${step} 步`);
  assertMatch(markdown, new RegExp(`\\./user-guide-images/step-${number}\\.png`), `第 ${step} 步应包含示例图`);
  assertMatch(englishMarkdown, new RegExp(`^## Step ${step}:`, "m"), `English Markdown should include step ${step}`);
  assertMatch(englishMarkdown, new RegExp(`\\./user-guide-images/step-${number}\\.png`), `English step ${step} should include the example image`);
  if (!fs.existsSync(`public/user-guide-images/step-${number}.png`)) {
    throw new Error(`第 ${step} 步示例图文件不存在`);
  }
}

for (const keyword of ["Report Mode", "Deep Window", "加入对话", "记忆栏", "Chat Mode", "发送"]) {
  assertMatch(markdown, new RegExp(keyword), `使用流程应包含关键步骤：${keyword}`);
}

assertMatch(html, /id="userFlowGuideBtn"/, "Chatbot 页面应提供使用流程入口");
assertMatch(html, /id="userFlowGuidePanel"/, "Chatbot 页面应提供使用流程面板");
assertMatch(html, /id="userFlowGuideContent"/, "使用流程面板应提供 Markdown 容器");
assertMatch(app, /function toggleUserFlowGuide\s*\(/, "应提供使用流程开关函数");
assertMatch(app, /fetch\(guideUrl,/, "应从 Markdown 文件实时读取使用流程");
assertMatch(app, /markdownToHtml\(markdown\)/, "应使用现有 Markdown 渲染器");
assertMatch(app, /cache:\s*"no-store"/, "使用流程读取应避免缓存旧内容");
assertMatch(app, /function openUserFlowImage\s*\(/, "应提供示例图放大函数");
assertMatch(app, /function closeUserFlowImage\s*\(/, "应提供示例图关闭函数");
assertMatch(app, /userFlowGuideContent\?\.addEventListener\("click"/, "应支持点击示例图放大");
assertMatch(app, /userFlowImageLightbox\?\.addEventListener\("click"/, "应支持点击遮罩关闭示例图");
assertMatch(app, /event\.key === "Escape"[\s\S]+closeUserFlowImage\(\)/, "应支持按 Escape 关闭示例图");
assertMatch(html, /id="userFlowImageLightbox"/, "页面应提供示例图放大层");
assertMatch(html, /id="userFlowImageLightboxImage"/, "放大层应提供图片容器");
assertMatch(html, /id="userFlowImageLightboxClose"/, "放大层应提供关闭按钮");
assertMatch(styles, /\.user-flow-guide-panel\s*\{/, "应提供使用流程面板样式");
assertMatch(styles, /\.user-flow-guide-content\s+img/, "示例图应有专属样式");
assertMatch(styles, /\.user-flow-image-lightbox\s*\{/, "应提供示例图放大层样式");
assertMatch(styles, /cursor:\s*zoom-in/, "示例图应显示可放大光标");
assertMatch(styles, /@media[\s\S]+\.user-flow-guide-panel/, "使用流程面板应适配窄屏");
assertMatch(html, /data-i18n="report\.userFlowGuideTitle"/, "使用流程标题应支持语言切换");
assertMatch(app, /function userFlowGuideUrl\s*\(/, "应根据当前语言选择使用流程文件");
assertMatch(app, /var USER_FLOW_GUIDE_URL_EN = "\.\/chatbot-user-guide-en\.md";/, "应支持读取英文使用流程");

console.log("PASS: chatbot user guide contract tests");
