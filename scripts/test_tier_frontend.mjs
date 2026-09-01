import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const indexHtml = read("public/index.html");
const pageNavStart = indexHtml.indexOf('<nav class="page-nav"');
const pageNavEnd = indexHtml.indexOf("</nav>", pageNavStart);
assert(pageNavStart >= 0 && pageNavEnd > pageNavStart, "无法定位侧边栏导航边界");
const pageNavHtml = indexHtml.slice(pageNavStart, pageNavEnd);
const tierNavButtons = [...pageNavHtml.matchAll(/class="page-nav-button tier-nav-button"/g)];
assert(tierNavButtons.length === 1, "侧边栏只能保留一个 Tier 入口");
assert(pageNavHtml.includes('id="tierNav"'), "Tier 入口缺少稳定的 tierNav 标识");
assert(pageNavHtml.includes('data-tier-page="Tier 1"'), "Tier 入口必须默认指向 Tier 1");
for (const tierName of ["Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]) {
  assert(!pageNavHtml.includes(`data-tier-page="${tierName}"`), `侧边栏不应保留 ${tierName} 入口`);
}
const tierStart = indexHtml.indexOf('<section class="tier-page hidden" id="tierPage"');
const tierEnd = indexHtml.indexOf('<section class="', tierStart + 20);
assert(tierStart >= 0 && tierEnd > tierStart, "无法定位 Tier 页面 HTML 边界");
const tierHtml = indexHtml.slice(tierStart, tierEnd);
const modernRootIndex = tierHtml.indexOf('id="tierModernRoot"');
const legacyHeaderIndex = tierHtml.indexOf('class="tier-header"');
assert(modernRootIndex >= 0, "Tier 页面缺少 tierModernRoot");
assert(legacyHeaderIndex > modernRootIndex, "Tier modern root 必须位于 legacy 内容之前");

const styles = read("public/styles.css");
for (const selector of [
  ".tier-page.is-modern > :not(#tierModernRoot)",
  ".tier-page:not(.is-modern) > #tierModernRoot",
  ".tier-page.is-modern > #tierModernRoot"
]) {
  assert(styles.includes(selector), `Tier 缺少双轨样式边界: ${selector}`);
}
const tierFeatureStyles = read("frontend/src/features/tier-sheet/tierSheet.css");
assert(tierFeatureStyles.includes(".tier-page-modern {\n  display: grid;"), "Tier Vue root 未保留旧版 grid 页面边界");
assert(tierFeatureStyles.includes("  padding: 0;"), "Tier Vue root 不应引入额外页面内边距");
assert(tierFeatureStyles.includes(".tier-page-modern .tier-move-dialog {\n  z-index: 45;"), "Tier Move 弹层层级未与旧版对齐");
assert(tierFeatureStyles.includes(".tier-page-modern .tier1-merchant-dialog {\n  z-index: 46;"), "Tier 新增商家弹层层级未与旧版对齐");

const entry = read("frontend/src/entry.ts");
for (const contract of [
  'import "./features/tier-sheet/tierSheet.css"',
  'import TierSheetPage, {',
  "async function loadTierReport",
  "async function loadSharedTierMoves",
  "async function saveSharedTierMoves",
  "async function loadTier1Additions",
  "async function searchTier1Merchants",
  "async function addTier1Merchant",
  "const tierFactory",
  "tier: tierFactory",
  "downloadWorkbook"
]) {
  assert(entry.includes(contract), `entry.ts 缺少 Tier 接入契约: ${contract}`);
}

const app = read("public/app.js");
const tierNavBindingStart = app.indexOf("els.tierNavButtons.forEach((button) => {");
const tierNavBindingEnd = app.indexOf("els.tier1AdditionsToggle", tierNavBindingStart);
assert(tierNavBindingStart >= 0 && tierNavBindingEnd > tierNavBindingStart, "无法定位 Tier 导航绑定");
const tierNavBinding = app.slice(tierNavBindingStart, tierNavBindingEnd);
assert(tierNavBinding.includes('state.selectedTierPage = "Tier 1"'), "Tier 入口点击后必须打开 Tier 1");
assert(tierNavBinding.includes('switchPage("tier")'), "Tier 入口缺少页面切换");
const switchStart = app.indexOf("function switchPage(page)");
const switchEnd = app.indexOf("function init()", switchStart);
assert(switchStart >= 0 && switchEnd > switchStart, "无法定位 switchPage() Tier 边界");
const switchSource = app.slice(switchStart, switchEnd);
assert(switchSource.includes("tierModernRoot"), "switchPage() 未管理 Tier modern root");
assert(switchSource.includes('mountPage("tier"'), "switchPage() 未挂载 Tier modern 页面");
assert(switchSource.includes('unmountPage("tier"'), "switchPage() 未卸载 Tier modern 页面");
assert(switchSource.includes("renderTierPage(state.selectedTierPage)"), "Tier 缺少 legacy fallback");
assert(
  !switchSource.includes("modernRoot.dataset.mountedTier === requestedTier"),
  "点击单一 Tier 入口时不能跳过 Tier 页面重新挂载"
);
assert(
  switchSource.includes("button.classList.toggle(\"active\", isTier)"),
  "单一 Tier 入口必须在所有 Tier 页面保持激活态"
);

for (const path of [
  "frontend/src/features/tier-sheet/TierSheetPage.vue",
  "frontend/src/features/tier-sheet/tierSheetModel.ts",
  "frontend/src/features/tier-sheet/useTierSheet.ts",
  "frontend/src/features/tier-sheet/tierSheet.css",
  "frontend/src/features/tier-sheet/tierSheetModel.test.ts",
  "frontend/src/features/tier-sheet/useTierSheet.test.ts",
  "frontend/src/features/tier-sheet/TierSheetPage.test.ts",
  "frontend/src/shared/export/xlsx.ts",
  "frontend/src/shared/export/xlsx.test.ts",
  "scripts/test_shared_xlsx_frontend.mjs"
]) read(path);

const inventory = read("docs/frontend-migration-inventory.md");
const inventoryMatch = inventory.match(/<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/);
assert(inventoryMatch, "迁移清单缺少受控 JSON 区块");
const parsedInventory = JSON.parse(inventoryMatch[1]);
const tier = parsedInventory.pages.find((page) => page.pageKey === "tier");
assert(tier?.status === "dual", "Tier 完成后必须保持 dual 状态");
assert(tier.roots?.includes("#tierModernRoot"), "迁移清单未记录 Tier modern root");
assert(tier.tests?.includes("scripts/test_tier_frontend.mjs"), "迁移清单未记录 Tier 静态契约测试");

console.log("PASS: Tier frontend migration contract");
