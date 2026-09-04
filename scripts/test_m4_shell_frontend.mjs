import fs from "node:fs";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const read = (file) => fs.readFileSync(file, "utf8");
const shell = read("frontend/src/shell/AppShell.vue");
const navigation = read("frontend/src/shell/navigation.ts");
const pageState = read("frontend/src/shell/usePageState.ts");
const theme = read("frontend/src/shell/theme.ts");
const shellCss = read("frontend/src/shell/shell.css");
const entry = read("frontend/src/entry.ts");
const index = read("public/index.html");

for (const marker of ["data-shell-nav-page", "data-shell-theme", "data-shell-language", "modernLogoutButton", "handleShellKeydown", "pageTitle"]) {
  assert(shell.includes(marker), `AppShell 缺少 ${marker}`);
}
for (const marker of ["NAVIGATION_GROUPS", "GOOGLE_ADS_NAVIGATION_ITEM", "navigationGroupForPage", "pageTitle"]) {
  assert(navigation.includes(marker), `navigation.ts 缺少 ${marker}`);
}
for (const marker of ["setPage", "toggleGroup", "handleKeydown", "Escape", "Tab"]) {
  assert(pageState.includes(marker), `usePageState.ts 缺少 ${marker}`);
}
for (const marker of ["oi-dash-theme", "applyTheme", "readStoredTheme", "writeStoredTheme"]) {
  assert(theme.includes(marker), `theme.ts 缺少 ${marker}`);
}
assert(shellCss.includes(".modern-application"), "Shell 缺少 standalone modern 布局");
assert(shellCss.includes("prefers-reduced-motion"), "Shell 缺少 reduced-motion 保护");
assert(entry.includes('import AppShell from "./shell/AppShell.vue";'), "entry.ts 未注册 AppShell");
assert(entry.includes("const shellFactory"), "entry.ts 缺少 Shell factory");
assert(entry.includes("}, shellFactory);"), "entry.ts 未将 Shell factory交给 modern app");
assert(index.includes('id="modernAppRoot"'), "index.html 缺少 modernAppRoot");
assert(!/id="(?:modernShellRoot|primarySidebar|mobileShellBar)"/.test(index), "index.html 仍包含旧 Shell DOM");
console.log("PASS: standalone modern shell contract");
