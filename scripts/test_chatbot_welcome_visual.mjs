import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const css = fs.readFileSync("public/styles.css", "utf8").replace(/\r\n/g, "\n");

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
assert(
  css.includes(".welcome-float.onboarding-tour-active"),
  "onboarding should keep the assistant panel in a persistent highlight state"
);
assert(
  css.includes("z-index: 50001"),
  "onboarding assistant panel should stay above the tour mask"
);
assert(
  css.includes("outline: 2px solid rgba(150, 178, 255, 0.82)"),
  "onboarding assistant panel should have a persistent highlight outline"
);
assert(
  css.includes(".welcome-float.onboarding-tour-active .welcome-float-dot") &&
    css.includes("outline: 2px solid rgba(255, 157, 92, 0.9)"),
  "onboarding assistant icon should use an orange highlight outline"
);
assert(
  css.includes(".onboarding-highlight") &&
    css.includes("border: 1.5px solid rgba(255, 157, 92, 0.85)"),
  "onboarding target highlight should use the orange assistant accent"
);
assert(
  css.includes("background: rgba(6, 8, 15, 0.48);"),
  "onboarding mask should only dim the background with a lighter overlay"
);
assert(
  css.includes(".onboarding-mask-piece") &&
    css.includes("-webkit-backdrop-filter: none;") &&
    css.includes("backdrop-filter: none;") &&
    !css.includes("-webkit-backdrop-filter: blur(3px) saturate(1.2);") &&
    !css.includes("backdrop-filter: blur(3px) saturate(1.2);"),
  "onboarding mask should not blur the background"
);
assert(
  css.includes(".dash-tour-btn.onboarding-tour-btn-attention"),
  "onboarding entry button should have a dedicated attention state"
);
assert(
  css.includes("animation: onboardingTourButtonAttention 2s cubic-bezier(0.22, 1, 0.36, 1) both"),
  "onboarding entry attention animation should last 2 seconds"
);
assert(
  css.includes("@keyframes onboardingTourButtonAttention") &&
    css.includes("rgba(255, 157, 92"),
  "onboarding entry attention animation should use the orange assistant accent"
);
assert(
  css.includes("@keyframes onboardingTourButtonHalo") &&
    css.includes("opacity: 1;") &&
    css.includes("transform: scale(1.04);"),
  "onboarding entry should use an opacity and transform halo pulse"
);
assert(
  css.includes("@media (prefers-reduced-motion: reduce)") &&
    css.includes("onboarding-tour-btn-attention"),
  "onboarding entry should remain visibly highlighted when motion is reduced"
);
assert(
  css.includes(".welcome-float.onboarding-tour-drag-enabled .welcome-head") &&
    css.includes("cursor: grab") &&
    css.includes("cursor: grabbing"),
  "tour drag mode should expose a grab cursor on the assistant panel header"
);
assert(
  css.includes(".chat-reminder-kicker") &&
    css.includes(".chat-reminder-title") &&
    css.includes(".chat-reminder-body") &&
    css.includes(".chat-reminder-reminder"),
  "Chat Mode reminder should use the same layered card typography as Report Mode"
);
assert(
  css.includes("rgba(155, 123, 255") &&
    css.includes("#9b7bff") &&
    css.includes("#7c5cff"),
  "Chat Mode reminder should use the existing purple theme"
);
assert(
  css.includes(".welcome-float.mode-chat .welcome-panel") &&
    css.includes("--welcome-shell-top: #2f265b") &&
    css.includes(".welcome-float.mode-chat .welcome-float-dot"),
  "Chat Mode should switch the assistant panel and icon to a purple shell"
);
assert(
  css.includes("linear-gradient(135deg, #b59cff 0%, #8066ff 100%)") &&
    css.includes("--welcome-dot-glow: rgba(155, 123, 255, 0.38)"),
  "Chat Mode assistant icon should use purple fill and glow"
);
assert(
  css.includes(".welcome-float.mode-chat .welcome-panel.welcome-emphasis") &&
    css.includes(".welcome-float.mode-chat .welcome-avatar"),
  "Chat Mode emphasis state should keep inner assistant accents purple"
);
assert(
  css.includes(".welcome-col {") && css.includes("cursor: pointer;"),
  "Report and Chat regions should expose a clickable affordance"
);

console.log("PASS: Chatbot 使用助手面板视觉样式检查通过");
