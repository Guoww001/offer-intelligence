import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const indexHtml = read("public/index.html");
const sheetStart = indexHtml.indexOf('<section class="sheet-page hidden" id="sheetPage"');
const sheetEnd = indexHtml.indexOf('<section class="category-page', sheetStart);
assert(sheetStart >= 0 && sheetEnd > sheetStart, "无法定位 Targets 页面 HTML 边界");
const sheetHtml = indexHtml.slice(sheetStart, sheetEnd);
const modernRootIndex = sheetHtml.indexOf('id="sheetModernRoot"');
const legacyHeaderIndex = sheetHtml.indexOf('class="tier-header sheet-page-header"');
assert(modernRootIndex >= 0, "Targets 页面缺少 sheetModernRoot");
assert(legacyHeaderIndex > modernRootIndex, "Targets modern root 必须位于 legacy 内容之前");

const styles = read("public/styles.css");
for (const selector of [
  ".sheet-page.is-modern > :not(#sheetModernRoot)",
  ".sheet-page:not(.is-modern) > #sheetModernRoot",
  ".sheet-page.is-modern > #sheetModernRoot"
]) {
  assert(styles.includes(selector), `Targets 缺少双轨样式边界: ${selector}`);
}

const entry = read("frontend/src/entry.ts");
for (const contract of [
  'import "./features/targets/targets.css"',
  'import TargetsPage from "./features/targets/TargetsPage.vue"',
  'async function loadTargetStatus',
  'async function loadTargetTierSummary',
  'const targetsFactory',
  "sheets: targetsFactory"
]) {
  assert(entry.includes(contract), `entry.ts 缺少 Targets 接入契约: ${contract}`);
}

const app = read("public/app.js");
const switchStart = app.indexOf("function switchPage(page)");
const switchEnd = app.indexOf("function init()", switchStart);
assert(switchStart >= 0 && switchEnd > switchStart, "无法定位 switchPage() Targets 边界");
const switchSource = app.slice(switchStart, switchEnd);
assert(switchSource.includes("sheetModernRoot"), "switchPage() 未管理 Targets modern root");
assert(switchSource.includes('mountPage("sheets"'), "switchPage() 未挂载 Targets modern 页面");
assert(switchSource.includes('unmountPage("sheets"'), "switchPage() 未卸载 Targets modern 页面");
assert(switchSource.includes("renderSheetPage()"), "Targets 缺少 legacy fallback");
const languageBranch = app.slice(app.indexOf("function rerenderForLanguage()"), switchStart);
assert(languageBranch.includes("state.page === \"sheets\""), "Targets 未接入语言切换分支");

const inventory = read("docs/frontend-migration-inventory.md");
const inventoryMatch = inventory.match(/<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/);
assert(inventoryMatch, "迁移清单缺少受控 JSON 区块");
const parsedInventory = JSON.parse(inventoryMatch[1]);
const targets = parsedInventory.pages.find((page) => page.pageKey === "sheets");
assert(targets?.status === "dual", "Targets 完成后必须保持 dual 状态");
assert(targets.roots?.includes("#sheetModernRoot"), "迁移清单未记录 Targets modern root");
assert(targets.tests?.includes("scripts/test_targets_frontend.mjs"), "迁移清单未记录 Targets 静态契约测试");

console.log("PASS: Targets frontend migration contract");
