import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const inventorySource = read("docs/frontend-migration-inventory.md");
const inventoryMatch = inventorySource.match(
  /<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/
);
assert(inventoryMatch, "迁移清单缺少受控 JSON 区块");
const inventory = JSON.parse(inventoryMatch[1]);
const monthly = inventory.pages.find((page) => page.pageKey === "monthly-new-merchants");
assert(monthly?.status === "modern", "Monthly New Merchants 尚未进入 modern 状态");
assert(monthly?.roots?.includes("#monthlyNewMerchantsModernRoot"), "现代 root 未记录在迁移清单");
assert(monthly?.legacyEntry?.includes("renderMonthlyNewMerchantsPage()"), "legacy 回退入口不能在放行时丢失");

const indexHtml = read("public/index.html");
const entry = read("frontend/src/entry.ts");
const app = read("public/app.js");
const styles = read("public/styles.css");
const modernRoot = 'id="monthlyNewMerchantsModernRoot"';
assert(indexHtml.includes(modernRoot), "Monthly New Merchants 缺少 modern root");
assert(entry.includes('"monthly-new-merchants": monthlyNewMerchantsFactory'), "entry.ts 未注册 Monthly New Merchants factory");

const switchPageStart = app.indexOf("function switchPage(page)");
const switchPageEnd = app.indexOf("function init()", switchPageStart);
assert(switchPageStart >= 0 && switchPageEnd > switchPageStart, "无法定位 switchPage() 页面入口");
const switchPageSource = app.slice(switchPageStart, switchPageEnd);
const mountIndex = switchPageSource.indexOf('mountPage("monthly-new-merchants"');
const fallbackIndex = switchPageSource.indexOf("renderMonthlyNewMerchantsPage()");
assert(mountIndex >= 0, "switchPage() 未尝试挂载 Monthly New Merchants modern 页面");
assert(fallbackIndex > mountIndex, "legacy renderer 必须位于 modern mount fallback 分支之后");
assert(switchPageSource.includes('unmountPage("monthly-new-merchants"'), "离开页面时必须卸载 modern 页面");
assert(switchPageSource.includes("loadMonthlyNewMerchants()"), "legacy fallback 必须保留数据加载");
assert(
  styles.includes(".monthly-new-merchants-page.is-modern > :not(#monthlyNewMerchantsModernRoot)"),
  "modern 状态必须只隐藏 Monthly New Merchants 的 legacy 内容"
);

console.log("PASS: Monthly New Merchants modern cutover contract");
