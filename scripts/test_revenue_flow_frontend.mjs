import { execFileSync } from "node:child_process";
import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), path + " 不存在");
  return fs.readFileSync(path, "utf8");
}

const model = read("frontend/src/features/revenue-flow/revenueFlowModel.ts");
const composable = read("frontend/src/features/revenue-flow/useRevenueFlow.ts");
const page = read("frontend/src/features/revenue-flow/RevenueFlowPage.vue");
const sankey = read("frontend/src/features/revenue-flow/RevenueFlowSankey.vue");
const css = read("frontend/src/features/revenue-flow/revenueFlow.css");
const brandMediaPage = read("frontend/src/features/brand-media/BrandMediaPage.vue");
const entry = read("frontend/src/entry.ts");
const legacyApp = read("public/app.js");
const legacyStyles = read("public/styles.css");
const zh = read("frontend/src/shared/i18n/messages.zh.ts");
const en = read("frontend/src/shared/i18n/messages.en.ts");

for (const token of [
  "normalizeRevenueFlowPayload",
  "buildRevenueFlowModel",
  "buildRevenueFlowLayout",
  "revenueFlowHoverState",
  "toggleRevenueFlowNode",
  "revenueFlowFlowHitTest",
  "MAX_REVENUE_FLOW_BRANDS = 12"
]) {
  assert(model.includes(token), "Revenue Flow model 缺少 " + token);
}
for (const token of [
  "AbortController",
  "requestKeyFor",
  "cachePayload",
  "revenueFlowRequests",
  "initialMerchants",
  "revenueFlow.loading",
  "revenueFlow.noPermission"
]) {
  assert(composable.includes(token), "Revenue Flow composable 缺少 " + token);
}
for (const token of [
  'data-page="revenue-flow"',
  'role="combobox"',
  'role="listbox"',
  "revenue-flow-selected-brand",
  "revenue-flow-kpi",
  "data-testid=\"revenue-flow-expand\""
]) {
  assert(page.includes(token), "Revenue Flow 页面契约缺少 " + token);
}
for (const token of [
  "<canvas",
  "ResizeObserver",
  "setPointerCapture",
  "handleWheel",
  "revenue-flow-sankey-node-button"
]) {
  assert(sankey.includes(token), "Revenue Flow Sankey 交互缺少 " + token);
}
for (const token of [
  "revenueFlowFlowDetail",
  "revenue-flow-sankey-flow-tooltip",
  "flowSourceShare",
  "flowTargetShare"
]) {
  assert(sankey.includes(token), "Revenue Flow Flow tooltip 缺少 " + token);
}
for (const token of [
  ".revenue-flow-page",
  ".revenue-flow-kpis",
  ".revenue-flow-panel.is-expanded",
  "@media (max-width: 420px)",
  "prefers-reduced-motion"
]) {
  assert(css.includes(token), "Revenue Flow 样式缺少 " + token);
}
for (const token of [
  ".revenue-flow-page.is-modern",
  "#revenueFlowModernRoot"
]) {
  assert(legacyStyles.includes(token), "Revenue Flow legacy/modern 壳层缺少 " + token);
}

assert(entry.includes('import RevenueFlowPage from "./features/revenue-flow/RevenueFlowPage.vue";'), "entry.ts 未导入 RevenueFlowPage");
assert(entry.includes('"/api/ui/db/publishers"'), "Revenue Flow 未接入品牌目录 API");
assert(entry.includes('"/api/ui/db/brand-media-sankey?"'), "Revenue Flow 未接入 Sankey API");
assert(entry.includes('const revenueFlowFactory'), "entry.ts 未创建 revenueFlowFactory");
assert(entry.includes('"revenue-flow": revenueFlowFactory'), "modern app 未注册 revenue-flow");
assert(entry.includes("revenueFlowInitialState"), "entry.ts 未读取 Revenue Flow 初始状态");
assert(brandMediaPage.includes("syncRevenueFlowContext"), "Brand Media 缺少 Revenue Flow 初始状态桥接");
assert(brandMediaPage.includes("revenueFlowMerchantId"), "Brand Media 缺少 Revenue Flow 品牌 dataset");

const revenueSwitchStart = legacyApp.indexOf('if (previousPage === "revenue-flow"');
const revenueSwitchEnd = legacyApp.indexOf("if (isGoogleAds)", revenueSwitchStart);
assert(revenueSwitchStart >= 0 && revenueSwitchEnd > revenueSwitchStart, "Revenue Flow 页面切换边界不存在");
const revenueSwitchSource = legacyApp.slice(revenueSwitchStart, revenueSwitchEnd);
for (const token of [
  "revenueFlowModernRoot",
  "ensureRevenueFlowModernRoot",
  "syncRevenueFlowModernRoot",
  'unmountPage("revenue-flow")',
  'mountPage("revenue-flow"',
  "renderRevenueFlowPage()"
]) {
  assert(revenueSwitchSource.includes(token), "Revenue Flow SPA 边界缺少 " + token);
}

for (const key of [
  '"revenueFlow.title"',
  '"revenueFlow.loading"',
  '"revenueFlow.noPermission"',
  '"revenueFlow.canvasResetView"',
  '"revenueFlow.noMatch"'
]) {
  assert(zh.includes(key), "中文 i18n 缺少 " + key);
  assert(en.includes(key), "英文 i18n 缺少 " + key);
}

const publisherDiff = execFileSync("git", ["diff", "--name-only", "--", "frontend/src/features/publishers"], {
  encoding: "utf8"
}).trim();
assert(!publisherDiff, "Revenue Flow 迁移不应修改 Publishers 文件: " + publisherDiff);

const indexHtml = read("public/index.html");
if (!indexHtml.includes("revenueFlowModernRoot")) {
  console.warn("WARN: 当前公共壳层缺少 #revenueFlowModernRoot；该问题属于既有公共 HTML 截断，暂不跨范围修复 Publishers。");
}

console.log("PASS: Revenue Flow frontend contract");
