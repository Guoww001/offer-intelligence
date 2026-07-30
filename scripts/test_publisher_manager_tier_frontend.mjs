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
if (!hooks) throw new Error("app should expose test hooks in test mode");

const publishers = [
  { userId: 1, userName: "Media One", adminName: "Dora Long" },
  { userId: 2, userName: "Media Two", adminName: "Alex Chen" },
  { userId: 3, userName: "Media Three", adminName: "Dora Long" }
];

assertEqual(
  hooks.publishersForManager(publishers, "Dora Long").map((publisher) => publisher.userId),
  [1, 3],
  "manager selection should scope the publisher selector"
);
assertEqual(
  hooks.publisherManagerMatches(publishers[0], "dora"),
  true,
  "manager matching should stay case-insensitive"
);

const metric = (sales) => ({
  clicks: 10,
  dpv: 5,
  atc: 1,
  orders: 2,
  sales,
  allCommission: sales * 0.1,
  affCommission: sales * 0.05,
  aov: sales / 2
});
const merchants = [
  {
    merchantId: 101,
    merchantName: "Alpha",
    category: "Electronics",
    network: "Levanta",
    tier: "Tier 1",
    markets: { "amazon.com": metric(100) },
    total: metric(100)
  },
  {
    merchantId: 202,
    merchantName: "Beta",
    category: "Home & Kitchen",
    network: "Wayward",
    tier: "Tier 3",
    markets: { "amazon.com": metric(80) },
    total: metric(80)
  }
];

hooks.setPublisherPortfolioFilters({
  market: "all",
  network: "all",
  merchantSearch: "",
  portfolioSearch: "",
  category: "all",
  tier: "Tier 3"
});
assertEqual(
  hooks.publisherPortfolioRowsForState(merchants).map((row) => row.merchant.merchantId),
  [202],
  "portfolio tier filter should keep only merchants in the selected tier"
);
assertEqual(
  hooks.publisherTierOptions([
    { merchant: { tier: "Tier 3" } },
    { merchant: { tier: "Tier 1" } },
    { merchant: { tier: "BLACK TIER" } }
  ]),
  ["Tier 1", "Tier 3", "BLACK TIER"],
  "tier options should follow the dashboard tier order"
);
assertEqual(
  hooks.publisherTierOptions([], "Tier 3"),
  ["Tier 3"],
  "the selected Tier should survive the portfolio loading state"
);

const indexHtml = fs.readFileSync("public/index.html", "utf8");
if (!indexHtml.includes('id="publisherPortfolioTier"')) {
  throw new Error("publisher portfolio should expose a Tier filter");
}
if (!indexHtml.includes("<th>Tier</th>")) {
  throw new Error("publisher portfolio table should expose a Tier column");
}

console.log("Publisher manager and Tier frontend checks passed");
