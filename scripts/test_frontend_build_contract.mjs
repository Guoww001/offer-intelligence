import fs from "node:fs";
import vm from "node:vm";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

const packagePath = "frontend/package.json";
const packageJson = JSON.parse(read(packagePath));
const requiredScripts = ["typecheck", "test", "build"];
for (const script of requiredScripts) {
  assert(typeof packageJson.scripts?.[script] === "string", `${packagePath} 缺少 ${script} script`);
}

assert(packageJson.dependencies?.vue, `${packagePath} 缺少 vue 运行时依赖`);
for (const dependency of [
  "@types/node",
  "@vitejs/plugin-vue",
  "@vue/test-utils",
  "happy-dom",
  "typescript",
  "vite",
  "vitest",
  "vue-tsc"
]) {
  assert(packageJson.devDependencies?.[dependency], `${packagePath} 缺少 ${dependency} 开发依赖`);
}

read("frontend/package-lock.json");
const gitignore = read(".gitignore");
assert(gitignore.includes("!frontend/package-lock.json"), ".gitignore 必须允许提交 frontend/package-lock.json");
assert(gitignore.includes("!frontend/tests/"), ".gitignore 必须允许提交 frontend/tests/");
assert(gitignore.includes("public/assets/modern/"), ".gitignore 必须忽略 modern 构建产物");

const tsconfig = read("frontend/tsconfig.json");
for (const option of ["strict", "noUncheckedIndexedAccess", "noImplicitOverride"]) {
  assert(new RegExp(`"${option}"\\s*:\\s*true`).test(tsconfig), `tsconfig 未启用 ${option}`);
}

const viteConfig = read("frontend/vite.config.ts");
assert(viteConfig.includes("../public/assets/modern"), "Vite 输出目录必须是 public/assets/modern");
assert(/emptyOutDir\s*:\s*true/.test(viteConfig), "Vite 必须只清理 modern 输出目录");
assert(viteConfig.includes('formats: ["iife"]'), "M1 modern bundle 必须使用 IIFE 兼容格式");
assert(viteConfig.includes('fileName: () => "oi-modern.js"'), "modern JS 文件名必须固定");
assert(viteConfig.includes('cssFileName: "oi-modern"'), "modern CSS 文件名必须固定");

read("frontend/vitest.config.ts");
read("frontend/tests/setup.ts");
read("frontend/tests/build-contract.test.ts");
read("frontend/src/env.d.ts");
read("frontend/src/legacy/contracts.ts");
read("frontend/src/legacy/bridge.ts");
read("frontend/src/shared/styles/modern-root.css");
read("frontend/src/entry.ts");

const indexHtml = read("public/index.html");
assert(
  indexHtml.includes('./assets/modern/oi-modern.css?v=20260827-vue-m2'),
  "index.html 缺少本地 modern CSS"
);
const remoteAssetUrls = [...indexHtml.matchAll(/\b(?:src|href)="(https?:[^"]+)"/g)].map((match) => match[1]);
assert(
  !remoteAssetUrls.some((url) => /(?:unpkg\.com\/vue(?:@|\/)|jsdelivr\.net\/npm\/vue(?:@|\/))/i.test(url)),
  "index.html 不得从 CDN 加载 Vue"
);

const auth = read("public/auth.js");
assert(
  auth.includes('const MODERN_APP_SCRIPT = "./assets/modern/oi-modern.js?v=20260827-vue-m2";'),
  "auth.js 缺少本地 modern bundle 常量"
);
assert(auth.includes("async function loadModernApp()"), "auth.js 缺少 modern 加载边界");
assert(auth.includes("window.OI_MODERN_APP.bootstrap("), "auth.js 未调用 modern bootstrap");
const modernLoaderStart = auth.indexOf("async function loadModernApp()");
const modernLoaderEnd = auth.indexOf("\n  let _dataLoading", modernLoaderStart);
const modernLoaderSource = auth.slice(modernLoaderStart, modernLoaderEnd);
assert(modernLoaderSource.includes("await loadScript(MODERN_APP_SCRIPT);"), "modern 加载边界未加载本地产物");
assert(modernLoaderSource.includes("catch (error)"), "modern 加载失败时必须进入受控回退");
assert(modernLoaderSource.includes("return false;"), "modern 加载失败时必须允许 legacy 继续启动");
assert(auth.indexOf("await loadModernApp();") < auth.indexOf("await loadScript(APP_SCRIPT);"), "modern bundle 必须在 legacy app.js 前初始化");

const vercel = JSON.parse(read("vercel.json"));
assert(vercel.installCommand === "npm --prefix frontend ci", "Vercel installCommand 不正确");
assert(vercel.buildCommand === "npm --prefix frontend run build", "Vercel buildCommand 不正确");
assert(vercel.outputDirectory === "public", "Vercel outputDirectory 必须保持 public");
assert(Array.isArray(vercel.routes) && vercel.routes.length > 0, "Vercel API routes 不得被构建配置覆盖");
assert(vercel.functions && Object.keys(vercel.functions).length > 0, "Vercel Functions 配置不得丢失");

const ci = read(".github/workflows/ci.yml");
for (const command of [
  "npm --prefix frontend ci",
  "npm --prefix frontend run typecheck",
  "npm --prefix frontend run test -- --run",
  "npm --prefix frontend run build",
  "node scripts/test_frontend_build_contract.mjs"
]) {
  assert(ci.includes(command), `CI 缺少命令: ${command}`);
}

const agents = read("AGENTS.md");
for (const command of [
  "npm --prefix frontend ci",
  "npm --prefix frontend run typecheck",
  "npm --prefix frontend run test -- --run",
  "npm --prefix frontend run build"
]) {
  assert(agents.includes(command), `AGENTS.md 缺少前端命令: ${command}`);
}

const bundlePath = "public/assets/modern/oi-modern.js";
const cssPath = "public/assets/modern/oi-modern.css";
assert(fs.existsSync(bundlePath), `${bundlePath} 未生成`);
assert(fs.existsSync(cssPath), `${cssPath} 未生成`);

const sandbox = { console, window: {} };
vm.runInNewContext(fs.readFileSync(bundlePath, "utf8"), sandbox, { filename: bundlePath });
const modernApp = sandbox.window.OI_MODERN_APP;
assert(modernApp && typeof modernApp.bootstrap === "function", "modern bundle 未注册 OI_MODERN_APP");
assert(modernApp.hasPage("offer-list-tracker") === true, "M2 必须注册 Offer Tracker 页面");

console.log("PASS: frontend build contract");
