import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const targets = read("frontend/src/features/targets/targets.css");
assert(targets.includes("@media (max-width: 760px)"), "Targets 缺少 760px 移动端覆盖");
assert(targets.includes(".sheet-page-modern > .sheet-target-filters"), "Targets 移动端筛选器没有 scoped 单列布局");
assert(targets.includes(".sheet-page-modern > .tier-summary"), "Targets 移动端 KPI 没有 scoped 单列布局");
assert(targets.includes(".sheet-page-modern .target-kpi-card"), "Targets 移动端 KPI 缺少最小宽度保护");

const tier = read("frontend/src/features/tier-sheet/tierSheet.css");
assert(tier.includes("@media (max-width: 420px)"), "Tier 缺少 420px 移动端覆盖");
assert(tier.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"), "Tier 移动端 tabs 没有四列布局");
assert(tier.includes(".tier-modern-tabs button:last-child"), "Tier 移动端 Black Tier 没有独占整行");
assert(tier.includes(".tier-page-modern .tier-move-dialog"), "Tier modern Move dialog 缺少页面边界");
assert(tier.includes("@media (max-width: 560px)"), "Tier modern Move dialog 缺少窄屏覆盖");
assert(tier.includes(".tier-page-modern .tier-move-card .tier-move-footer button"), "Tier 移动端 Move 操作按钮缺少可点击宽度保护");

console.log("PASS: M5 mobile responsive migration contract");
