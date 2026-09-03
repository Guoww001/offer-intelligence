import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const pages = [
  {
    key: "brand-media",
    root: "brandMediaModernRoot",
    legacy: "renderBrandMediaPage()",
    factory: '"brand-media": brandMediaFactory',
    blockStart: "if (isBrandMedia) {",
    blockEnd: "if (isRevenueFlow) {",
    boundary: "#brandMediaPage.is-modern > :not(#brandMediaModernRoot)",
    hiddenRoot: ".brand-media-page:not(.is-modern) > #brandMediaModernRoot",
    visibleRoot: ".brand-media-page.is-modern > #brandMediaModernRoot"
  },
  {
    key: "revenue-flow",
    root: "revenueFlowModernRoot",
    legacy: "renderRevenueFlowPage()",
    factory: '"revenue-flow": revenueFlowFactory',
    blockStart: "if (isRevenueFlow) {",
    blockEnd: "if (isGoogleAds) {",
    boundary: ".revenue-flow-page.is-modern > :not(#revenueFlowModernRoot)",
    hiddenRoot: ".revenue-flow-page:not(.is-modern) > #revenueFlowModernRoot",
    visibleRoot: ".revenue-flow-page.is-modern > #revenueFlowModernRoot"
  },
  {
    key: "google-ads",
    root: "googleAdsModernRoot",
    legacy: "renderGoogleAdsPage()",
    factory: '"google-ads": googleAdsFactory',
    blockStart: "if (isGoogleAds) {",
    blockEnd: "if (isSheets) {",
    boundary: ".google-ads-page.is-modern > :not(#googleAdsModernRoot)",
    hiddenRoot: ".google-ads-page:not(.is-modern) > #googleAdsModernRoot",
    visibleRoot: ".google-ads-page.is-modern > #googleAdsModernRoot"
  },
  {
    key: "sheets",
    root: "sheetModernRoot",
    legacy: "renderSheetPage()",
    factory: "sheets: targetsFactory",
    blockStart: "if (isSheets) {",
    blockEnd: "if (isCategory) {",
    boundary: ".sheet-page.is-modern > :not(#sheetModernRoot)",
    hiddenRoot: ".sheet-page:not(.is-modern) > #sheetModernRoot",
    visibleRoot: ".sheet-page.is-modern > #sheetModernRoot"
  },
  {
    key: "category",
    root: "categoryModernRoot",
    legacy: "ensureDashboardCategoryReportData()",
    factory: "category: categoryReportFactory",
    blockStart: "if (isCategory) {",
    blockEnd: "if (isTier) {",
    boundary: ".category-page.is-modern > :not(#categoryModernRoot)",
    hiddenRoot: ".category-page:not(.is-modern) > #categoryModernRoot",
    visibleRoot: ".category-page.is-modern > #categoryModernRoot"
  },
  {
    key: "tier",
    root: "tierModernRoot",
    legacy: "renderTierPage(state.selectedTierPage)",
    factory: "tier: tierFactory",
    blockStart: "if (isTier) {",
    blockEnd: "if (isMonthlyNewMerchants) {",
    boundary: ".tier-page.is-modern > :not(#tierModernRoot)",
    hiddenRoot: ".tier-page:not(.is-modern) > #tierModernRoot",
    visibleRoot: ".tier-page.is-modern > #tierModernRoot"
  },
  {
    key: "offer-list-tracker",
    root: "offerListTrackerModernRoot",
    legacy: "renderOfferListTrackerPage()",
    factory: '"offer-list-tracker": offerTrackerFactory',
    blockStart: "if (isOfferListTracker) {",
    blockEnd: "    updateMobileCurrentPage();\n    closeMobileNavigation(true);\n  }",
    boundary: ".offer-tracker-page.is-modern > :not(#offerListTrackerModernRoot)",
    hiddenRoot: ".offer-tracker-page:not(.is-modern) > #offerListTrackerModernRoot",
    visibleRoot: ".offer-tracker-page.is-modern > #offerListTrackerModernRoot"
  }
];

const inventorySource = read("docs/frontend-migration-inventory.md");
const inventoryMatch = inventorySource.match(
  /<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/
);
assert(inventoryMatch, "迁移清单缺少受控 JSON 区块");
const inventory = JSON.parse(inventoryMatch[1]);
const pagesByKey = new Map(inventory.pages.map((page) => [page.pageKey, page]));

const indexHtml = read("public/index.html");
const entry = read("frontend/src/entry.ts");
const app = read("public/app.js").replace(/\r\n/g, "\n");
const styles = read("public/styles.css");
const switchPageStart = app.indexOf("function switchPage(page)");
const switchPageEnd = app.indexOf("function init()", switchPageStart);
assert(switchPageStart >= 0 && switchPageEnd > switchPageStart, "无法定位 switchPage() 页面入口");
const switchPageSource = app.slice(switchPageStart, switchPageEnd);

for (const page of pages) {
  const inventoryPage = pagesByKey.get(page.key);
  assert(inventoryPage?.status === "modern", `${page.key} 尚未进入 modern 状态`);
  assert(inventoryPage?.roots?.includes(`#${page.root}`), `${page.key} 清单未记录 modern root`);
  assert(indexHtml.includes(`id="${page.root}"`), `${page.key} 缺少 modern root`);
  assert(entry.includes(page.factory), `${page.key} 未注册 modern factory`);
  assert(switchPageSource.includes(`unmountPage("${page.key}")`), `${page.key} 离开页面时必须卸载 modern 页面`);

  const blockStart = switchPageSource.indexOf(page.blockStart);
  const blockEnd = switchPageSource.indexOf(page.blockEnd, blockStart);
  assert(blockStart >= 0 && blockEnd > blockStart, `${page.key} 缺少可定位的 switchPage() 页面分支`);
  const block = switchPageSource.slice(blockStart, blockEnd);
  const mountIndex = block.indexOf(`mountPage("${page.key}"`);
  const fallbackIndex = block.indexOf(page.legacy);
  assert(mountIndex >= 0, `${page.key} 未尝试挂载 modern 页面`);
  assert(fallbackIndex > mountIndex, `${page.key} legacy fallback 必须位于 modern mount 之后`);
  assert(block.includes("modernMounted"), `${page.key} 缺少 modern 挂载结果边界`);
  assert(styles.includes(page.boundary), `${page.key} 缺少 legacy 隔离 CSS boundary`);
  assert(styles.includes(page.hiddenRoot), `${page.key} 缺少 legacy 模式下的 modern root 隐藏边界`);
  assert(styles.includes(page.visibleRoot), `${page.key} 缺少 modern 模式下的 root 展示边界`);
}

const m6ModernPages = new Map(
  inventory.pages.filter((page) => ["dashboard", "agent"].includes(page.pageKey)).map((page) => [page.pageKey, page])
);
assert(m6ModernPages.get("dashboard")?.status === "dual", "Dashboard 视觉等价完成前必须保持 dual 状态");
assert(m6ModernPages.get("agent")?.status === "modern", "Chat Agent 完成 Runtime 迁移后必须进入 modern 状态");
assert(m6ModernPages.get("dashboard")?.roots?.includes("#chatbotModernRoot"), "Dashboard 清单缺少 Chatbot modern root");
assert(m6ModernPages.get("agent")?.roots?.includes("#agentModernRoot"), "Chat Agent 清单缺少 Agent modern root");

const parityGate = app.match(/function modernChatbotAgentParityEnabled\(\) \{([\s\S]*?)\n  \}/);
assert(parityGate, "缺少 Chatbot/Agent modern parity gate");
assert(parityGate[1].includes("modernChatbotAgentBridgeAvailable()"), "Modern parity gate 必须保留 bridge 能力检查");
assert(parityGate[1].includes("__OI_MODERN_CHATBOT_AGENT_PARITY__ === true"), "Chatbot 视觉等价完成前必须显式 true 才启用 Modern 对照");
assert(!parityGate[1].includes("__OI_MODERN_CHATBOT_AGENT_PARITY__ !== false"), "Chatbot 视觉等价完成前不得默认启用 Modern");
assert(/function modernAgentRuntimeEnabled\(\)/.test(app), "Agent 必须使用独立的生产 Runtime 闸门");
assert(/isAgent && \(modernAgentRuntimeEnabled\(\) \|\| modernChatbotAgentParityEnabled\(\)\)/.test(app), "Agent 必须在服务端 Runtime 开关启用时默认挂载 Modern");

console.log("PASS: modern page cutover contract");
