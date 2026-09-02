import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const entrySource = fs.readFileSync(path.join(root, "frontend", "src", "entry.ts"), "utf8");
const contractsSource = fs.readFileSync(path.join(root, "frontend", "src", "legacy", "contracts.ts"), "utf8");
const bridgeSource = fs.readFileSync(path.join(root, "frontend", "src", "legacy", "bridge.ts"), "utf8");
const chatbotPageSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "chatbot", "ChatbotPage.vue"), "utf8");
const deepWindowSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "chatbot", "DeepWindow.vue"), "utf8");
const chatSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "chatbot", "ChatbotChatView.vue"), "utf8");
const agentPageSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "agent", "AgentPage.vue"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /function\s+modernChatbotAgentParityEnabled\s*\(/.test(appSource),
  "Chatbot/Agent Modern-first 必须有显式 behavior parity 闸门"
);
const parityGate = appSource.match(/function\s+modernChatbotAgentParityEnabled\s*\(\)\s*\{([\s\S]*?)\n  \}/);
assert(parityGate, "Chatbot/Agent Modern-first 闸门实现缺失");
assert(
  parityGate[1].includes("modernChatbotAgentBridgeAvailable()")
    && parityGate[1].includes("__OI_MODERN_CHATBOT_AGENT_PARITY__ !== false")
    && !parityGate[1].includes("__OI_MODERN_CHATBOT_AGENT_PARITY__ === true"),
  "M6 放行后必须默认启用 Modern，并保留显式 false 回滚开关"
);
assert(
  /isDashboard\s*&&\s*modernChatbotAgentParityEnabled\s*\(\)/.test(appSource),
  "Dashboard 未通过 parity 闸门时必须继续使用 Legacy 页面"
);
assert(
  /isAgent\s*&&\s*modernChatbotAgentParityEnabled\s*\(\)/.test(appSource),
  "Agent 未通过 parity 闸门时必须继续使用 Legacy 页面"
);
assert(
  /runChatAgent\(/.test(appSource) && /streamAssistantReply\(/.test(appSource),
  "Legacy Chatbot/Agent 核心执行链不能被迁移切片删除"
);
assert(/paymentAnswer\(/.test(appSource) && /analysisAnswer\(/.test(appSource), "Legacy payment/analysis 路由必须保留");
assert(/loadLiveChatbotData\(\)/.test(appSource), "Modern Report 必须经过 Legacy live chatbot data 刷新边界");
assert(/LegacyChatSessionBridge/.test(contractsSource) && /LegacyAgentSessionBridge/.test(contractsSource), "必须存在受控 Chat/Agent session contract");
assert(/createLegacyChatSessionBridge/.test(bridgeSource) && /createLegacyAgentSessionBridge/.test(bridgeSource), "必须存在可测试的 session bridge 适配器");
assert(/chatSession/.test(entrySource) && /agentSession/.test(entrySource), "Modern factory 必须消费共享 Legacy session");
assert(/applyPrompt\(/.test(appSource) && /chatSession/.test(appSource), "Report/Chat submit 必须回到 Legacy applyPrompt 路由");
assert(/data-deep-window-action=\"export\"/.test(deepWindowSource) || /deepWindow.*export/.test(appSource), "Deep Window 必须保留导出入口");
assert(/memory-recommendation|prepareChatMemoryRecommendation/.test(chatSource + appSource), "Chat Mode 必须保留 Memory recommendation");
assert(/recommendationHtml/.test(contractsSource + chatbotPageSource + appSource), "Chat Mode 必须把 Memory recommendation 结果传给 Modern 视图");
assert(/feedback/.test(contractsSource + chatSource + agentPageSource) && /operation=feedback/.test(appSource), "Chatbot/Agent 反馈必须继续走受控 Legacy feedback bridge");
assert(/downloadLogs/.test(contractsSource + chatbotPageSource + agentPageSource), "Chatbot/Agent 必须保留问题与反馈日志下载入口");
assert(/toggleHelp/.test(contractsSource + chatbotPageSource) && /toggleGuide/.test(contractsSource + chatbotPageSource), "Chatbot 必须保留帮助与用户指南入口");
assert(/starterCards|starter-prompt/.test(contractsSource + chatSource + chatbotPageSource), "Chat Mode 必须保留记忆报告 starter question 卡片");
assert(/openDeepWindow|open-chat-deep/.test(contractsSource + chatSource + chatbotPageSource + appSource), "Chat Mode 必须保留 Open as View 到 Deep Window 的入口");
assert(/onTimeline/.test(agentPageSource + appSource) && !/steps:\s*modernAgentTimeline\(host\)/.test(appSource), "Agent 必须通过受控 timeline callback，而不是隐藏 DOM 反解析");
assert(/memory:\s*String\(request\.memoryText\s*\|\|\s*\"\"\)/.test(appSource), "Agent fallback 必须继续携带结构化 Memory 上下文");
assert(/onBeforeUnmount/.test(agentPageSource) && /props\.session/.test(agentPageSource), "Agent 页面切换必须保留 session");
assert(/agentSession:\s*legacyAgentSession/.test(appSource), "Legacy bridge 必须提供 Agent session");
assert(
  /dashboard:\s*chatbotFactory/.test(entrySource) && /agent:\s*agentFactory/.test(entrySource),
  "Modern Chatbot/Agent factory 必须保留为后续 parity 验证入口"
);

assert(/function\s+modernChatbotAgentBridgeAvailable\s*\(/.test(appSource)
  && /modernChatbotAgentBridgeAvailable\(\)/.test(appSource),
  "Chatbot/Agent bridge 缺失时必须继续使用 Legacy 页面");
assert(/typeof chat\.addMemory\s*===\s*"function"/.test(appSource)
  && /typeof chat\.downloadLogs\s*===\s*"function"/.test(appSource)
  && /typeof agent\.downloadLogs\s*===\s*"function"/.test(appSource),
  "Modern-first 闸门必须确认记忆、日志和 Agent 辅助能力可用");
assert(/trend-interact|setTrendColumns/.test(deepWindowSource + contractsSource + bridgeSource + appSource), "Deep Window 趋势图控件必须通过受控 bridge 保留交互");
assert(/renderMarkdownToHtml/.test(agentPageSource), "Agent 回答必须复用受控 Markdown renderer");

assert(/downloadRecommendation/.test(contractsSource + chatbotPageSource + appSource), "Report/Deep Window 下载必须继续调用 Legacy recommendation export");

console.log("PASS: Chatbot/Agent behavior parity gate enables Modern-first with Legacy fallback");
