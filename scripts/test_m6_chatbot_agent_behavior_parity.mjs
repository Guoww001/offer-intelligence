import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const appSource = read("public", "app.js");
const entrySource = read("frontend", "src", "entry.ts");
const contractsSource = read("frontend", "src", "legacy", "contracts.ts");
const bridgeSource = read("frontend", "src", "legacy", "bridge.ts");
const chatbotPageSource = read("frontend", "src", "features", "chatbot", "ChatbotPage.vue");
const chatbotSessionSource = read("frontend", "src", "features", "chatbot", "chatbotSession.ts");
const deepWindowSource = read("frontend", "src", "features", "chatbot", "DeepWindow.vue");
const deepWindowStoreSource = read("frontend", "src", "features", "chatbot", "deepWindowStore.ts");
const chatSource = read("frontend", "src", "features", "chatbot", "ChatbotChatView.vue");
const agentPageSource = read("frontend", "src", "features", "agent", "AgentPage.vue");
const agentSessionSource = read("frontend", "src", "features", "agent", "agentSession.ts");
const agentHostSource = read("frontend", "src", "features", "agent", "CopilotKitAgentHost.vue");
const agentViewStateSource = read("frontend", "src", "features", "agent", "agentViewState.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/function\s+modernChatbotAgentParityEnabled\s*\(/.test(appSource), "Chatbot/Agent 必须保留显式回退闸门");
const parityGate = appSource.match(/function\s+modernChatbotAgentParityEnabled\s*\(\)\s*\{([\s\S]*?)\n  \}/);
assert(parityGate, "Chatbot/Agent Modern-first 闸门实现缺失");
assert(
  parityGate[1].includes("__OI_MODERN_CHATBOT_AGENT_PARITY__ !== false")
    && !parityGate[1].includes("modernChatbotAgentBridgeAvailable()"),
  "Chatbot/Agent 必须默认使用 Modern，且仅用显式 false 回退 Legacy"
);
assert(/isDashboard\s*&&\s*modernChatbotAgentParityEnabled\s*\(\)/.test(appSource), "Dashboard 必须通过 Modern-first 闸门挂载");
assert(/function\s+modernAgentRuntimeEnabled\s*\(/.test(appSource), "生产 Agent 必须保留独立 CopilotKit Runtime 闸门");
assert(/config\.enabled\s*===\s*true/.test(appSource) && /config\.authority\s*===\s*"python-registry"/.test(appSource), "生产 Agent 只允许 Python registry 权威的 Runtime");
assert(/isAgent\s*&&\s*modernAgentParityEnabled\(\)/.test(appSource), "Agent 必须通过 Modern-first 闸门挂载");

assert(/createChatbotSession/.test(entrySource) && /createAgentSession/.test(entrySource), "Modern factory 必须创建独立 Chatbot/Agent session");
assert(!/OI_LEGACY_BRIDGE\?\.(?:chatSession|deepWindows|agentSession|runChat|runAgent)/.test(entrySource), "Modern 正常链路不得消费 Legacy session 或 runner");
assert(/toolExecutor/.test(agentHostSource) && /executeTool:\s*executeFrontendTool/.test(agentSessionSource), "CopilotKit 工具必须使用独立 Agent executor");
assert(!/OI_LEGACY_BRIDGE/.test(agentHostSource), "CopilotKit Agent Host 不得读取 Legacy bridge");
assert(/saveAgentViewSnapshot/.test(agentPageSource) && /const snapshots = new Map/.test(agentViewStateSource), "CopilotKit 页面切换必须保留进程内状态");

assert(/downloadOverview/.test(chatbotSessionSource + chatbotPageSource) && /downloadChatbotReport/.test(entrySource), "Modern 报告必须保留独立 XLSX 下载入口");
assert(/data-deep-window-action="export"/.test(deepWindowSource) && /onExport/.test(deepWindowStoreSource), "Deep Window 必须通过独立 store 保留导出入口");
assert(/starterCards|starter-prompt/.test(chatbotSessionSource + chatSource + chatbotPageSource), "Chat Mode 必须保留报告上下文 starter question 卡片");
assert(/openDeepWindow|open-chat-deep/.test(chatbotSessionSource + chatSource + chatbotPageSource), "Chat Mode 必须保留 Open as View 到 Deep Window 的入口");
assert(/operation=feedback/.test(chatbotSessionSource + agentSessionSource), "Chatbot/Agent 反馈必须由独立 session 调用受控 API");
assert(/downloadLogs/.test(chatbotSessionSource + agentSessionSource + chatbotPageSource + agentPageSource), "Chatbot/Agent 必须保留问题与反馈日志下载入口");
assert(/toggleHelp/.test(chatbotSessionSource + chatbotPageSource) && /toggleGuide/.test(chatbotSessionSource + chatbotPageSource), "Chatbot 必须保留帮助与用户指南入口");
assert(/onTimeline/.test(agentPageSource + agentSessionSource), "Agent 必须通过 timeline callback 更新可见步骤");
assert(/memoryText/.test(agentSessionSource), "Agent Runtime 必须继续携带结构化 Memory 上下文");
assert(/trend-interact|setTrendColumns/.test(deepWindowSource + deepWindowStoreSource), "Deep Window 趋势图控件必须由独立 store 保留交互");
assert(/renderMarkdownToHtml/.test(agentPageSource), "Agent 回答必须复用受控 Markdown renderer");

assert(/runChatAgent\(/.test(appSource) && /streamAssistantReply\(/.test(appSource), "整页 Legacy fallback 的核心执行链不能在回滚窗口内删除");
assert(/paymentAnswer\(/.test(appSource) && /analysisAnswer\(/.test(appSource), "Legacy payment/analysis 回退路由必须保留");
assert(/LegacyChatSessionBridge/.test(contractsSource) && /LegacyAgentSessionBridge/.test(contractsSource), "必须保留 Legacy 回退 contract");
assert(/createLegacyChatSessionBridge/.test(bridgeSource) && /createLegacyAgentSessionBridge/.test(bridgeSource), "必须保留可测试的 Legacy 回退适配器");
assert(/agentSession:\s*legacyAgentSession/.test(appSource), "Legacy bridge 必须继续提供整页 Agent 回退 session");
assert(/Modern Chatbot unavailable; continuing with the legacy chatbot\./.test(appSource), "Chatbot factory 挂载失败时必须保留整页 Legacy fallback");
assert(/Modern Agent unavailable; continuing with the legacy Agent page\./.test(appSource), "Agent factory 挂载失败时必须保留整页 Legacy fallback");
assert(/dashboard:\s*chatbotFactory/.test(entrySource) && /agent:\s*agentFactory/.test(entrySource), "Modern Chatbot/Agent factory 必须保持注册");

console.log("PASS: Chatbot and Agent use independent Modern runtimes with explicit Legacy fallback");
