import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy, got ${JSON.stringify(value)}`);
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) throw new Error(`${label}: expected HTML to match ${pattern}`);
}

function assertNoMatch(actual, pattern, label) {
  if (pattern.test(actual)) throw new Error(`${label}: expected HTML not to match ${pattern}`);
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {},
  removeAttribute() {},
  style: {}
};

const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  RegExp,
  Array,
  Object,
  Set,
  Map,
  JSON,
  URLSearchParams,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

runScript("protected_data/chatbot_data.js", sandbox);
runScript("protected_data/product_keywords.js", sandbox);
runScript("protected_data/sheet_report_data.js", sandbox);
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");
assertTruthy(hooks.dashboardCategoryFocusedGroups, "category focus helper should be exposed");
assertTruthy(hooks.dashboardCategoryPieHtml, "category pie renderer should be exposed");
assertTruthy(hooks.setCategoryReportFocusKey, "category focus setter should be exposed");

const categories = [
  "Electronics",
  "Home & Kitchen",
  "Beauty & Personal Care",
  "Patio, Lawn & Garden",
  "Health & Household",
  "Sports & Outdoors",
  "Baby",
  "Clothing, Shoes & Jewelry",
  "Automotive"
].map((category, index) => ({
  category,
  merchantCount: 20 - index,
  revenue: 9000 - index * 700,
  orders: 900 - index * 70,
  clicks: 1800 - index * 120,
  avgCvr: 0.5,
  avgEpc: 2.5,
  avgAov: 10,
  topMerchant: `${category} leader`,
  previewMerchants: `${category} leader`,
  tierBreakdown: { "Tier 1": 20 - index },
  rows: [{ "Merchant Name": `${category} leader`, "Merchant ID": String(index + 1) }]
}));

hooks.setCategoryReportFocusKey("");
assertEqual(hooks.dashboardCategoryFocusedGroups(categories).length, 9, "overview should keep every category");
const overviewHtml = hooks.dashboardCategoryPieHtml(categories);
assertMatch(overviewHtml, /data-category-focus="electronics"/, "overview slices should expose drill-down targets");
assertMatch(overviewHtml, /data-category-focus="other-categories"/, "grouped overflow should remain drillable");
assertNoMatch(overviewHtml, /data-category-focus-back/, "overview should not show a back control");

hooks.setCategoryReportFocusKey("beauty-personal-care");
const focusedCategories = hooks.dashboardCategoryFocusedGroups(categories);
assertEqual(focusedCategories.length, 1, "named category focus should return one category");
assertEqual(focusedCategories[0].category, "Beauty & Personal Care", "named category focus should preserve the selected category");
const focusedHtml = hooks.dashboardCategoryPieHtml(focusedCategories);
assertMatch(focusedHtml, /category-pie-focused/, "focused pie should expose its focused state");
assertMatch(focusedHtml, /data-category-focus-back/, "focused pie should show the back control");
assertMatch(focusedHtml, /All categories/, "back control should have a compact visible label");
assertMatch(focusedHtml, /stroke-dasharray="100\.0000 0\.0000"/, "focused category should render as a complete donut");

hooks.setCategoryReportFocusKey("other-categories");
const overflowCategories = hooks.dashboardCategoryFocusedGroups(categories);
assertEqual(overflowCategories.length, 2, "grouped overflow focus should reveal categories after the first seven");
assertEqual(overflowCategories[0].category, "Clothing, Shoes & Jewelry", "overflow focus should begin with the eighth visible category");

console.log("Category drill-down checks passed");
