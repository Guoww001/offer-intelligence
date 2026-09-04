import fs from "node:fs";
import assert from "node:assert/strict";

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
const indexHtml = read("public/index.html");
const auth = read("public/auth.js");
const entry = read("frontend/src/entry.ts");
const shell = read("frontend/src/shell/shell.css");
const appApi = read("frontend/src/legacy/bridge.ts");
const trend = read("frontend/src/features/agent/results/AgentTrendResult.vue");
const authCss = read("public/auth.css");

assert.match(indexHtml, /id="modernAppRoot"/, "M7 modern 应用必须拥有独立根节点");
assert.match(indexHtml, /id="modernAppError"/, "M7 必须提供可见的 modern 启动错误态");
assert.match(indexHtml, /auth\.css\?v=20260904-m7-entry/, "modern index 必须只加载认证关键样式");
assert.doesNotMatch(indexHtml, /styles\.css\?v=20260901-m4-shell/, "modern index 不得预加载整份 legacy CSS");
assert.doesNotMatch(indexHtml, /(?:chatbot_i18n|onboarding_tour|chatbot_welcome|tier2_recommendation_rules|agent_memory_state)\.js/, "modern index 不得预加载 legacy 辅助脚本");
assert.match(auth, /async function loadLegacyRollbackApp\(\)/, "legacy 只能通过显式回滚加载");
assert.match(auth, /LEGACY_STYLE_SHEET\s*=\s*"\.\/styles\.css\?v=20260901-m4-shell"/, "legacy CSS 必须由回滚加载器拥有");
assert.match(auth, /LEGACY_COMPAT_SCRIPTS/, "legacy 辅助脚本必须由回滚加载器拥有");
assert.match(auth, /for \(const script of LEGACY_COMPAT_SCRIPTS\)/, "legacy 辅助脚本必须按顺序加载");
assert.match(auth, /function clearModernSessionState\(\)/, "退出登录必须清理 modern 会话状态");
assert.match(auth, /oi_agent_memory_v1/, "退出登录必须清理 Agent 结构化记忆");
assert.match(auth, /new URLSearchParams\(window\.location\.search\).*legacy.*1/s, "回滚入口必须由 URL 明确启用");
assert.match(auth, /mountApplication\(modernAppRoot, "agent"\)/, "认证成功后必须挂载完整 modern 应用");
assert.match(auth, /showModernError\(error\)/, "modern 启动失败必须显示错误态");
assert.doesNotMatch(auth, /catch \(error\) \{[\s\S]{0,180}continuing with the legacy dashboard/i, "modern 失败不得静默切回旧应用");
assert.match(entry, /window\.OI_MODERN_APP\?\.setPage\(page\)/, "modern Shell 导航必须回到 modern app API");
assert.doesNotMatch(entry, /downloadOfferTracker[\s\S]{0,180}OI_LEGACY_BRIDGE/, "Offer Tracker 导出不得依赖 legacy bridge");
assert.match(appApi, /mountApplication\(element, initialPage = "agent"\)/, "modern app API 必须支持 standalone mount");
assert.match(appApi, /data-modern-workspace/, "standalone mount 必须创建独立 workspace");
assert.doesNotMatch(trend, /OI_LEGACY_BRIDGE/, "Agent 趋势图必须由 Vue 本地渲染");
assert.match(trend, /<svg[^>]+class="agent-trend-chart"/, "Agent 趋势结果必须渲染可访问 SVG");
assert.match(shell, /\.modern-application\s*\{/, "modern Shell 必须拥有独立布局 CSS");
assert.match(shell, /body\.modern-only #appShell > :not\(#modernAppRoot\)/, "modern-only 模式必须隐藏旧 DOM 壳");
assert.match(shell, /prefers-reduced-motion/, "modern Shell 必须保留 reduced-motion 保护");
assert.match(authCss, /\.auth-shell\s*\{/, "认证关键样式必须独立存在");

console.log("M7 modern entry isolation contract: PASS");
