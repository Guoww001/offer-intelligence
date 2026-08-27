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

assert(entry.includes("PaymentsPage"), "modern entry 未导入 PaymentsPage");
assert(entry.includes("paymentsFactory"), "modern entry 未定义 paymentsFactory");
assert(entry.includes("/api/levanta/payments"), "Payments modern loader 未连接既有 API");
assert(entry.includes('payments: paymentsFactory'), "modern entry 未注册 payments 页面");
assert(indexHtml.includes('id="paymentsModernRoot"'), "index.html 缺少 paymentsModernRoot");
assert(indexHtml.includes("oi-modern.css?v=20260827-vue-m4-payments"), "index.html 未更新 M4 modern CSS cache busting");
assert(auth.includes('oi-modern.js?v=20260827-vue-m4-payments'), "auth.js 未更新 M4 modern JS cache busting");

const switchPageStart = app.indexOf("function switchPage(page)");
const switchPageEnd = app.indexOf("function init()", switchPageStart);
assert(switchPageStart >= 0 && switchPageEnd > switchPageStart, "无法定位 switchPage() 页面入口");
const switchPageSource = app.slice(switchPageStart, switchPageEnd);
assert(switchPageSource.includes("paymentsModernRoot"), "switchPage() 未接入 Payments modern root");
assert(switchPageSource.includes('mountPage("payments"'), "switchPage() 未挂载 modern Payments");
assert(switchPageSource.includes('unmountPage("payments"'), "switchPage() 未卸载 modern Payments");
assert(switchPageSource.includes("renderPaymentsPage()"), "Payments 缺少 legacy fallback");

const bridgeStart = app.indexOf("window.OI_LEGACY_BRIDGE");
assert(bridgeStart >= 0, "legacy bridge 未注册");
const bridgeSource = app.slice(bridgeStart, bridgeStart + 500);
assert(bridgeSource.includes('type === "payments"'), "legacy bridge 未接入 Payments 导出");
assert(bridgeSource.includes("downloadModernPayments"), "legacy bridge 未接入 Payments XLSX 适配器");

console.log("PASS: payments frontend integration contract");
