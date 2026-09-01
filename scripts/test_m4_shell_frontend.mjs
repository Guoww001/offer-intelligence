import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const shell = read("frontend/src/shell/AppShell.vue");
const navigation = read("frontend/src/shell/navigation.ts");
const pageState = read("frontend/src/shell/usePageState.ts");
const theme = read("frontend/src/shell/theme.ts");
const shellCss = read("frontend/src/shell/shell.css");
const entry = read("frontend/src/entry.ts");
const app = read("public/app.js");
const auth = read("public/auth.js");
const index = read("public/index.html");

for (const marker of [
  "data-shell-nav-page",
  "data-shell-theme",
  "data-shell-language",
  "modernLogoutButton",
  "aria-expanded",
  "aria-hidden",
  "handleShellKeydown",
  "pageTitle"
]) {
  assert(shell.includes(marker), `AppShell 缺少 ${marker}`);
}
for (const marker of [
  "NAVIGATION_GROUPS",
  "GOOGLE_ADS_NAVIGATION_ITEM",
  "navigationGroupForPage",
  "pageTitle"
]) {
  assert(navigation.includes(marker), `navigation.ts 缺少 ${marker}`);
}
for (const marker of ["setPage", "toggleGroup", "handleKeydown", "Escape", "Tab"]) {
  assert(pageState.includes(marker), `usePageState.ts 缺少 ${marker}`);
}
for (const marker of ["oi-dash-theme", "applyTheme", "readStoredTheme", "writeStoredTheme"]) {
  assert(theme.includes(marker), `theme.ts 缺少 ${marker}`);
}
assert(shellCss.includes("#modernShellRoot"), "Shell 缺少 legacy 外壳兼容边界");
assert(shellCss.includes("display: none !important"), "Shell 未保持 headless 挂载");
assert(!shellCss.includes("#appShell.shell-modern-ready > .sidebar"), "Shell 不应隐藏 legacy 侧边栏");
assert(!shellCss.includes("#appShell.shell-modern-ready > .mobile-shell-bar"), "Shell 不应隐藏 legacy 移动端导航");

assert(entry.includes('import AppShell from "./shell/AppShell.vue";'), "entry.ts 未注册 AppShell");
assert(entry.includes("const shellFactory"), "entry.ts 缺少 Shell factory");
assert(entry.includes("}, shellFactory);"), "entry.ts 未将 Shell factory 交给 modern app");
assert(app.includes("function mountModernShell()"), "app.js 缺少现代 Shell 挂载函数");
assert(app.includes("modernApp.mountShell(root)"), "app.js 未挂载现代 Shell");
assert(app.includes('appShell.classList.remove("shell-modern-ready")'), "app.js 不应替换 legacy Shell 视觉");
assert(app.includes("syncModernShellPage(page)"), "switchPage() 未同步现代 Shell 当前页面");
assert(app.includes("setLanguage: (language) => setLegacyLanguage(language)"), "legacy bridge 未暴露语言同步");
assert(auth.includes('document.getElementById("modernLogoutButton") || document.getElementById("logoutButton")'), "auth.js 未优先绑定 modern logout");

assert(index.includes('id="modernShellRoot"'), "index.html 缺少 modernShellRoot");
assert(!index.includes('var THEME_KEY = "oi-dash-theme"'), "index.html 仍保留重复的内联主题实现");

const inventory = read("docs/frontend-migration-inventory.md");
const jsonBlock = inventory.match(/<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/);
assert(jsonBlock, "迁移清单缺少 JSON 区块");
const pages = JSON.parse(jsonBlock[1]).pages;
const expectedStatuses = {
  payments: "modern",
  publishers: "modern",
  "brand-media": "dual",
  "revenue-flow": "dual",
  "google-ads": "dual",
  "monthly-new-merchants": "modern",
  sheets: "dual",
  category: "dual",
  tier: "dual"
};
for (const [pageKey, expectedStatus] of Object.entries(expectedStatuses)) {
  assert(pages.find((page) => page.pageKey === pageKey)?.status === expectedStatus, `${pageKey} 状态不符合当前迁移边界`);
}

console.log("PASS: M4 shared AppShell contract");
