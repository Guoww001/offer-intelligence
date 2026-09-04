import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const contracts = read("frontend/src/legacy/contracts.ts");
const stage = process.env.CHATBOT_PARITY_STAGE || "bridge";

assert.match(contracts, /LegacyChatAnswerMessage/);
assert.match(contracts, /feedbackForAnswer/);
assert.match(contracts, /LegacyDeepWindowSkeletonStep/);

if (stage === "full") {
  const page = read("frontend/src/features/chatbot/ChatbotPage.vue");
  const chat = read("frontend/src/features/chatbot/ChatbotChatView.vue");
  const report = read("frontend/src/features/chatbot/ChatbotReportView.vue");
  const deep = read("frontend/src/features/chatbot/DeepWindow.vue");
  const answerActions = read("frontend/src/features/chatbot/ChatAnswerActions.vue");
  const utility = read("frontend/src/features/chatbot/ChatbotUtilityPanels.vue");
  const onboarding = read("frontend/src/features/chatbot/ChatbotOnboarding.vue");
  const onboardingTour = read("public/onboarding_tour.js");
  const styles = read("frontend/src/features/chatbot/chatbot.css");
  const legacyRuntime = read("public/app.js");
  assert.match(page, /ChatbotUtilityPanels/);
  assert.match(page, /ChatbotOnboarding/);
  assert.match(page, /class="chatbot-modern-page"/);
  assert.match(answerActions, /data-chat-answer-id/);
  assert.match(answerActions, /data-chatbot-action="open-chat-deep"/);
  assert.match(chat, /class="chat-log/);
  assert.match(chat, /class="chat-input/);
  assert.doesNotMatch(chat, /data-chatbot-action="open-chat-deep"/);
  assert.match(chat, /class="chatbot-chat-send"/);
  assert.match(report, /class="chatbot-report-send"/);
  assert.match(deep, /class="deep-window"/);
  assert.match(deep, /deep-window-skeleton/);
  assert.match(deep, /deep-window-feedback/);
  assert.match(utility, /data-chatbot-action="help"/);
  assert.match(utility, /data-chatbot-action="clear"/);
  assert.match(onboarding, /data-chatbot-action="onboarding"/);
  assert.match(onboardingTour, /chatbotModernRoot/);
  assert.match(onboardingTour, /data-chatbot-report-form/);
  assert.match(onboardingTour, /data-deep-window-action="add-memory"/);
  assert.match(styles, /\.chatbot-modern-page/);
  assert.match(styles, /\.chatbot-command-menu/);
  assert.match(styles, /\.chatbot-utility-panels\s*\{[\s\S]*margin-left:\s*auto/);
  assert.match(styles, /\.chatbot-chat-panel \.chat-memory-bar\s*\{[\s\S]*flex-direction:\s*row/);
  assert.match(styles, /\.chatbot-chat-log \.message\.user \.chat-stream-text\s*\{[\s\S]*color:\s*#fff\s*!important/);
  assert.match(styles, /\.chatbot-chat-send\s*\{[\s\S]*background:\s*linear-gradient/);
  assert.match(styles, /\.chatbot-chat-send:hover:not\(:disabled\)/);
  assert.match(styles, /\.chatbot-report-send[\s\S]*color:\s*#fff\s*!important/);
  assert.match(styles, /\.chatbot-report-send:hover:not\(:disabled\)/);
  assert.match(styles, /\.answer-feedback-dialog/);
  // The current M6 baseline is Modern-first; the same predicate must still
  // expose an explicit false escape hatch for a Legacy rollback.
  assert.match(legacyRuntime, /window\.__OI_MODERN_CHATBOT_AGENT_PARITY__ !== false/);
}

console.log(stage === "full" ? "Chatbot visual contract: PASS" : "Chatbot Legacy-first parity gap gate: PASS");
