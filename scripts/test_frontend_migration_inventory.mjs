import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const inventoryPath = "docs/frontend-migration-inventory.md";
const appPath = "public/app.js";
const ciPath = ".github/workflows/ci.yml";

assert(fs.existsSync(inventoryPath), `${inventoryPath} 不存在`);

const app = fs.readFileSync(appPath, "utf8");
const switchPageStart = app.indexOf("function switchPage(page)");
const switchPageEnd = app.indexOf("function init()", switchPageStart);
assert(switchPageStart >= 0 && switchPageEnd > switchPageStart, "无法定位 switchPage() 页面权威入口");

const switchPageSource = app.slice(switchPageStart, switchPageEnd);
const routedPages = new Set(
  [...switchPageSource.matchAll(/page\s*[!=]==?\s*"([^"]+)"/g)].map((match) => match[1])
);
assert(routedPages.size > 0, "switchPage() 未提取到任何页面");

const markdown = fs.readFileSync(inventoryPath, "utf8");
const inventoryMatch = markdown.match(
  /<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/
);
assert(inventoryMatch, "迁移清单缺少受控 JSON 区块");

let inventory;
try {
  inventory = JSON.parse(inventoryMatch[1]);
} catch (error) {
  throw new Error(`迁移清单 JSON 无法解析: ${error.message}`);
}

assert(Array.isArray(inventory.pages), "迁移清单必须包含 pages 数组");

const allowedStatuses = new Set(["legacy", "dual", "modern", "removed"]);
const requiredArrayFields = [
  "roots",
  "legacyEntry",
  "state",
  "apis",
  "storage",
  "exports",
  "overlays",
  "tests"
];
const inventoryByPage = new Map();

for (const page of inventory.pages) {
  assert(page && typeof page === "object" && !Array.isArray(page), "每个页面条目必须是对象");
  assert(typeof page.pageKey === "string" && page.pageKey.trim(), "每个页面必须包含非空 pageKey");
  assert(!inventoryByPage.has(page.pageKey), `pageKey 重复: ${page.pageKey}`);
  assert(typeof page.label === "string" && page.label.trim(), `${page.pageKey} 缺少 label`);
  assert(allowedStatuses.has(page.status), `${page.pageKey} 使用了非法状态: ${page.status}`);
  assert(typeof page.notes === "string" && page.notes.trim(), `${page.pageKey} 缺少 notes`);
  assert(typeof page.testGap === "string", `${page.pageKey} 缺少 testGap`);
  for (const field of requiredArrayFields) {
    assert(Array.isArray(page[field]), `${page.pageKey}.${field} 必须是数组`);
  }
  assert(page.roots.length > 0, `${page.pageKey}.roots 不能为空`);
  assert(page.legacyEntry.length > 0, `${page.pageKey}.legacyEntry 不能为空`);
  assert(page.state.length > 0, `${page.pageKey}.state 不能为空`);
  assert(
    page.tests.length > 0 || page.testGap.trim(),
    `${page.pageKey} 没有现有测试时必须说明 testGap`
  );
  for (const testPath of page.tests) {
    assert(fs.existsSync(testPath), `${page.pageKey} 引用了不存在的测试: ${testPath}`);
  }
  inventoryByPage.set(page.pageKey, page);
}

const missingPages = [...routedPages].filter((pageKey) => !inventoryByPage.has(pageKey));
const unknownPages = [...inventoryByPage.keys()].filter((pageKey) => !routedPages.has(pageKey));
assert(missingPages.length === 0, `迁移清单缺少 switchPage() 页面: ${missingPages.join(", ")}`);
assert(unknownPages.length === 0, `迁移清单包含 switchPage() 未识别页面: ${unknownPages.join(", ")}`);
assert(inventoryByPage.get("offer-list-tracker")?.status === "dual", "Offer Tracker M2 完成后必须保持 dual 状态");
assert(inventoryByPage.get("payments")?.status === "modern", "Payments M4 完成后必须进入 modern 状态");
assert(
  inventoryByPage.get("monthly-new-merchants")?.status === "modern",
  "Monthly New Merchants M4 放行后必须进入 modern 状态"
);

const ci = fs.readFileSync(ciPath, "utf8");
assert(
  ci.includes("node scripts/test_frontend_migration_inventory.mjs"),
  "CI 未运行迁移清单契约测试"
);

console.log(`PASS: frontend migration inventory covers ${inventory.pages.length} pages`);
