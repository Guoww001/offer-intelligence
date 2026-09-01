import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const page = read("frontend/src/features/google-ads/GoogleAdsPage.vue");
const entry = read("frontend/src/entry.ts");
const styles = read("frontend/src/features/google-ads/googleAds.css");

assert(page.includes("<h2>{{ copy.title }}</h2>"), "Google Ads Vue 标题必须复用 legacy h2 视觉契约");
assert(page.includes('data-google-ads-action="refresh"'), "Google Ads Refresh 缺少稳定移动端交互入口");
assert(entry.includes('import "./features/google-ads/googleAds.css";'), "Google Ads feature CSS 未进入 modern bundle");
assert(styles.includes("@media (max-width: 560px)"), "Google Ads 缺少 560px 移动端覆盖");
assert(styles.includes("min-width: 0"), "Google Ads 移动端缺少最小宽度保护");
assert(styles.includes("overflow-wrap: anywhere"), "Google Ads 移动端长文案缺少换行保护");
assert(styles.includes(".oi-modern-page.google-ads-page .google-ads-chart"), "Google Ads modern chart 缺少局部横向滚动边界");
assert(styles.includes(".oi-modern-page.google-ads-page .google-ads-table-wrap"), "Google Ads modern table 缺少局部横向滚动边界");

console.log("PASS: Google Ads mobile responsive migration contract");
