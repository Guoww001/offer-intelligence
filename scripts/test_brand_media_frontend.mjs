import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const entry = read("frontend/src/entry.ts");
const indexHtml = read("public/index.html");
const auth = read("public/auth.js");
const app = read("public/app.js");
const styles = read("public/styles.css");

assert(entry.includes('import BrandMediaPage from "./features/brand-media/BrandMediaPage.vue";'), "modern entry 未导入 BrandMediaPage");
assert(entry.includes("loadBrandMediaCatalog"), "Brand Media modern loader 未加载 Publishers 目录");
assert(entry.includes("loadBrandMediaTrend"), "Brand Media modern loader 未加载趋势数据");
assert(entry.includes("/api/ui/db/brand-media-trend?"), "Brand Media modern loader 未连接趋势接口");
const brandMediaTrendStart = entry.indexOf("async function loadBrandMediaTrend");
const brandMediaTrendEnd = entry.indexOf("async function loadRevenueFlowCatalog", brandMediaTrendStart);
assert(
  brandMediaTrendStart >= 0 && brandMediaTrendEnd > brandMediaTrendStart
    && entry.slice(brandMediaTrendStart, brandMediaTrendEnd).includes("timeoutMs: 30_000"),
  "Brand Media 趋势请求需要覆盖慢查询超时边界"
);
assert(entry.includes('"brand-media": brandMediaFactory'), "modern entry 未注册 brand-media 页面");

assert(indexHtml.includes('id="brandMediaPage"'), "index.html 缺少 legacy Brand Media root");
assert(indexHtml.includes('id="brandMediaModernRoot"'), "index.html 缺少 brandMediaModernRoot");
assert(indexHtml.includes('data-i18n="brandMedia.manager"'), "Brand Media legacy 控件缺少 Manager 文案标记");
assert(auth.includes("MODERN_APP_SCRIPT"), "auth.js 未加载 modern bundle");

const switchPageStart = app.indexOf("function switchPage(page)");
const switchPageEnd = app.indexOf("function init()", switchPageStart);
assert(switchPageStart >= 0 && switchPageEnd > switchPageStart, "无法定位 switchPage() 页面入口");
const switchPageSource = app.slice(switchPageStart, switchPageEnd);
assert(switchPageSource.includes('unmountPage("brand-media")'), "switchPage() 未卸载 modern Brand Media");
assert(switchPageSource.includes("brandMediaModernRoot"), "switchPage() 未接入 Brand Media modern root");
assert(switchPageSource.includes('mountPage("brand-media"'), "switchPage() 未挂载 modern Brand Media");
assert(switchPageSource.includes("renderBrandMediaPage()"), "Brand Media 缺少 legacy fallback");

assert(styles.includes('#brandMediaPage.is-modern > :not(#brandMediaModernRoot)'), "缺少 Brand Media modern/legacy 隔离样式");
assert(styles.includes("body.brand-media-chart-expanded"), "缺少 Brand Media 展开图表页面状态样式");

console.log("PASS: Brand Media frontend integration contract");
