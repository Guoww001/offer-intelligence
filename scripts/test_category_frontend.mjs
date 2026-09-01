import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const indexHtml = read("public/index.html");
const categoryStart = indexHtml.indexOf('<section class="category-page hidden" id="categoryPage"');
const categoryEnd = indexHtml.indexOf('<section class="tier-page', categoryStart);
assert(categoryStart >= 0 && categoryEnd > categoryStart, "无法定位 Category 页面 HTML 边界");
const categoryHtml = indexHtml.slice(categoryStart, categoryEnd);
const modernRootIndex = categoryHtml.indexOf('id="categoryModernRoot"');
const legacyHeaderIndex = categoryHtml.indexOf('class="tier-header"');
assert(modernRootIndex >= 0, "Category 页面缺少 categoryModernRoot");
assert(legacyHeaderIndex > modernRootIndex, "Category modern root 必须位于 legacy 内容之前");

const styles = read("public/styles.css");
for (const selector of [
  ".category-page.is-modern > :not(#categoryModernRoot)",
  ".category-page:not(.is-modern) > #categoryModernRoot",
  ".category-page.is-modern > #categoryModernRoot"
]) {
  assert(styles.includes(selector), `Category 缺少双轨样式边界: ${selector}`);
}

const entry = read("frontend/src/entry.ts");
for (const contract of [
  'import "./features/category-report/categoryReport.css"',
  'import CategoryReportPage, {\n  type CategoryExportPayload\n} from "./features/category-report/CategoryReportPage.vue"',
  "async function loadCategoryTier",
  "/api/ui/db/tier_sheet",
  "const categoryReportFactory",
  "category: categoryReportFactory"
]) {
  assert(entry.includes(contract), `entry.ts 缺少 Category 接入契约: ${contract}`);
}

const app = read("public/app.js");
const switchStart = app.indexOf("function switchPage(page)");
const switchEnd = app.indexOf("function init()", switchStart);
assert(switchStart >= 0 && switchEnd > switchStart, "无法定位 switchPage() Category 边界");
const switchSource = app.slice(switchStart, switchEnd);
assert(switchSource.includes("categoryModernRoot"), "switchPage() 未管理 Category modern root");
assert(switchSource.includes('mountPage("category"'), "switchPage() 未挂载 Category modern 页面");
assert(switchSource.includes('unmountPage("category"'), "switchPage() 未卸载 Category modern 页面");
assert(switchSource.includes("ensureDashboardCategoryReportData()"), "Category 缺少 legacy fallback");
assert(app.includes("downloadModernCategory"), "Category 缺少 legacy XLSX bridge");
const languageBranch = app.slice(app.indexOf("function rerenderForLanguage()"), switchStart);
assert(languageBranch.includes("state.page === \"category\""), "Category 未接入语言切换分支");

for (const path of [
  "frontend/src/features/category-report/CategoryReportPage.vue",
  "frontend/src/features/category-report/categoryReportModel.ts",
  "frontend/src/features/category-report/useCategoryReport.ts",
  "frontend/src/features/category-report/categoryReport.css",
  "frontend/src/features/category-report/categoryReportModel.test.ts",
  "frontend/src/features/category-report/useCategoryReport.test.ts",
  "frontend/src/features/category-report/CategoryReportPage.test.ts"
]) read(path);

const inventory = read("docs/frontend-migration-inventory.md");
const inventoryMatch = inventory.match(/<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/);
assert(inventoryMatch, "迁移清单缺少受控 JSON 区块");
const parsedInventory = JSON.parse(inventoryMatch[1]);
const category = parsedInventory.pages.find((page) => page.pageKey === "category");
assert(category?.status === "dual", "Category 完成后必须保持 dual 状态");
assert(category.roots?.includes("#categoryModernRoot"), "迁移清单未记录 Category modern root");
assert(category.tests?.includes("scripts/test_category_frontend.mjs"), "迁移清单未记录 Category 静态契约测试");

console.log("PASS: Category frontend migration contract");
