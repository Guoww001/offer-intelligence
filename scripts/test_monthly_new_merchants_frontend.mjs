import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
  Intl,
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

const offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: offersCache.summary || {},
  offers: offersCache.offers || [],
  paymentRecords: offersCache.paymentRecords || []
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
sandbox.window.PRODUCT_KEYWORDS = JSON.parse(
  fs.readFileSync("protected_data/db_keywords_cache.json", "utf8")
);

runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assert(hooks, "app should expose test hooks in test mode");

assertEqual(
  hooks.normalizeMonthlyNewMerchantRecord({
    recordId: "12",
    reportMonth: "2026-08",
    merchantId: null,
    merchantName: "  Acme  ",
    businessManager: " Dora ",
    isPriority: 1,
    gmvMonthlyTarget: "12500.50",
    completionReward: " Bonus "
  }),
  {
    recordId: 12,
    reportMonth: "2026-08",
    merchantId: "",
    merchantName: "Acme",
    businessManager: "Dora",
    isPriority: true,
    gmvMonthlyTarget: 12500.5,
    completionReward: "Bonus",
    createdBy: "",
    updatedBy: "",
    createdAt: "",
    updatedAt: ""
  },
  "record normalization should preserve manual fields and priority"
);

const records = [
  { recordId: 1, merchantId: "101", merchantName: "Alpha Home", businessManager: "Dora" },
  { recordId: 2, merchantId: "202", merchantName: "Beta Beauty", businessManager: "Alex" }
];
assertEqual(
  hooks.filteredMonthlyNewMerchantRecords(records, "alpha").map((record) => record.recordId),
  [1],
  "search should match merchant names"
);
assertEqual(
  hooks.filteredMonthlyNewMerchantRecords(records, "202").map((record) => record.recordId),
  [2],
  "search should match merchant IDs"
);
assertEqual(
  hooks.filteredMonthlyNewMerchantRecords(records, "dora").map((record) => record.recordId),
  [1],
  "search should match BD names"
);
assertEqual(
  hooks.monthlyNewMerchantTargetTotal([
    { gmvMonthlyTarget: 50000 },
    { gmvMonthlyTarget: null },
    { gmvMonthlyTarget: "12500.50" }
  ]),
  62500.5,
  "GMV target summary should total the currently visible records"
);

assertEqual(
  hooks.buildMonthlyNewMerchantPayload({
    reportMonth: "2026-08",
    merchantName: "Merchant only"
  }),
  {
    action: "upsert",
    reportMonth: "2026-08",
    merchantId: "",
    merchantName: "Merchant only",
    businessManager: "",
    isPriority: false,
    gmvMonthlyTarget: null,
    completionReward: ""
  },
  "merchant-only entries should keep every other field optional"
);

assertEqual(
  hooks.buildMonthlyNewMerchantPayload({
    recordId: "8",
    reportMonth: "2026-08",
    merchantId: "380001",
    merchantName: "Full merchant",
    businessManager: "Dora",
    isPriority: true,
    gmvMonthlyTarget: "50000.25",
    completionReward: "2% bonus"
  }),
  {
    action: "upsert",
    recordId: 8,
    reportMonth: "2026-08",
    merchantId: "380001",
    merchantName: "Full merchant",
    businessManager: "Dora",
    isPriority: true,
    gmvMonthlyTarget: 50000.25,
    completionReward: "2% bonus"
  },
  "complete entries should serialize to the manual database API contract"
);

const indexHtml = fs.readFileSync("public/index.html", "utf8");
assert(indexHtml.includes('id="monthlyNewMerchantsNav"'), "primary navigation should expose the new page");
assert(indexHtml.includes('id="monthlyNewMerchantsPage"'), "the monthly new merchants page should exist");
assert(indexHtml.includes('id="monthlyNewMerchantAdd"'), "the page should expose a manual add action");
assert(indexHtml.includes('id="monthlyNewMerchantForm"'), "the add and edit drawer form should exist");
assert(!indexHtml.includes('id="monthlyNewMerchantsRefresh"'), "database auto-discovery refresh should be removed");

const publishersNavIndex = indexHtml.indexOf('id="publishersNav"');
const monthlyNewMerchantsNavIndex = indexHtml.indexOf('id="monthlyNewMerchantsNav"');
const reportsNavIndex = indexHtml.indexOf('id="sheetsNav"');
assert(
  publishersNavIndex < monthlyNewMerchantsNavIndex
    && monthlyNewMerchantsNavIndex < reportsNavIndex,
  "monthly new merchants should be a top-level page between Publishers and Reports"
);
const reportsSubnavMatch = indexHtml.match(/<div class="nav-subnav" id="reportsSubnav"[\s\S]*?<\/div>/);
assert(
  reportsSubnavMatch && !reportsSubnavMatch[0].includes('id="monthlyNewMerchantsNav"'),
  "monthly new merchants should not be nested inside the Reports submenu"
);
assertEqual(
  [
    hooks.pageBelongsToReports("sheets"),
    hooks.pageBelongsToReports("category"),
    hooks.pageBelongsToReports("tier"),
    hooks.pageBelongsToReports("monthly-new-merchants")
  ],
  [true, true, true, false],
  "monthly new merchants should not activate the Reports parent"
);

const formMatch = indexHtml.match(/<form id="monthlyNewMerchantForm">([\s\S]*?)<\/form>/);
assert(formMatch, "monthly new merchant form markup should be readable");
const formHtml = formMatch[1];
[
  "monthlyNewMerchantId",
  "monthlyNewMerchantName",
  "monthlyNewMerchantManager",
  "monthlyNewMerchantPriority",
  "monthlyNewMerchantGmvTarget",
  "monthlyNewMerchantReward"
].forEach((id) => {
  assert(formHtml.includes(`id="${id}"`), `form should contain ${id}`);
});

const merchantNameTag = formHtml.match(/<input[^>]*id="monthlyNewMerchantName"[^>]*>/)?.[0] || "";
assert(/\brequired\b/.test(merchantNameTag), "merchant name should be required");
["monthlyNewMerchantId", "monthlyNewMerchantManager", "monthlyNewMerchantGmvTarget"].forEach((id) => {
  const tag = formHtml.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] || "";
  assert(tag && !/\brequired\b/.test(tag), `${id} should remain optional`);
});
const priorityTag = formHtml.match(/<input[^>]*id="monthlyNewMerchantPriority"[^>]*>/)?.[0] || "";
assert(/type="checkbox"/.test(priorityTag), "priority should be a checkbox in the manual form");

assert(indexHtml.includes('data-i18n="monthlyNewMerchants.priority">Priority</th>'),
  "the table should expose the priority marker");
assert(indexHtml.includes('class="monthly-new-merchant-number" data-i18n="monthlyNewMerchants.gmvTarget"'),
  "GMV target should use the right-aligned numeric column");
assert(indexHtml.includes('data-i18n="monthlyNewMerchants.updated">Updated</th>'),
  "the table should show the manual record update time");

const appSource = fs.readFileSync("public/app.js", "utf8");
assert(appSource.includes('data-monthly-new-merchant-action="priority"'),
  "each manual merchant should have a persistent priority toggle");
assert(appSource.includes('data-monthly-new-merchant-action="edit"'),
  "each manual merchant should be editable");
assert(appSource.includes('data-monthly-new-merchant-action="delete"'),
  "each manual merchant should be removable");

const styles = fs.readFileSync("public/styles.css", "utf8");
assert(styles.includes(".monthly-new-merchants-table tbody tr.is-priority td"),
  "priority merchants should receive a row highlight");
assert(styles.includes(".monthly-new-merchant-drawer-backdrop"),
  "manual add and edit drawer styles should be restored");

console.log("Monthly new merchants manual frontend checks passed");
