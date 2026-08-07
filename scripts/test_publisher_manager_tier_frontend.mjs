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

const merchantAssociationData = {
  merchantNameMap: {
    "380813": "MERACHFITNESS",
    "380945": "Merach",
    "123456": "Another Merchant"
  },
  publishers: [
    { userId: 11, userName: "Media Eleven", adminName: "Dora Long", merchantIds: [380945], markets: {}, networks: [], linkTypes: {}, total: { sales: 100 } },
    { userId: 12, userName: "Media Twelve", adminName: "Alex Chen", merchantIds: [380813, 380945], markets: {}, networks: [], linkTypes: {}, total: { sales: 80 } },
    { userId: 13, userName: "Merach Fan", adminName: "Alex Chen", merchantIds: [123456], markets: {}, networks: [], linkTypes: {}, total: { sales: 60 } }
  ]
};
hooks.setPublisherPortfolioFilters({
  market: "all",
  network: "all",
  merchantSearch: "merach"
});
const merchantPublishers = hooks.filteredPublishers(merchantAssociationData);
assertEqual(
  merchantPublishers.map((publisher) => publisher.userId),
  [11, 12],
  "merchant search should return associated publishers without matching publisher names"
);
const merchantAssociationSummary = hooks.publisherMerchantAssociationSummary(
  merchantAssociationData,
  merchantPublishers,
  "merach"
);
assertEqual(
  [merchantAssociationSummary.merchantCount, merchantAssociationSummary.publisherCount],
  [2, 2],
  "merchant search should expose matched merchant and associated publisher counts"
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
assertEqual(
  hooks.publisherMetricAffEpc(metric(100)),
  0.75,
  "publisher AFF EPC should use sales times AFF commission rate divided by clicks"
);
assertEqual(
  hooks.publisherMetricAffEpc({ clicks: 0, sales: 100, allCommission: 10 }),
  0,
  "publisher AFF EPC should be zero when clicks are unavailable"
);
assertEqual(
  hooks.publisherMetricConversionRate(metric(100)),
  0.2,
  "publisher conversion should use orders divided by clicks"
);
assertEqual(
  hooks.publisherMetricConversionRate({ clicks: 0, orders: 4, sales: 100 }),
  0,
  "publisher conversion should stay a ratio when clicks are unavailable"
);
assertEqual(
  hooks.publisherMetricAffCommission(metric(100)),
  7.5,
  "publisher AFF earned commission should be 75% of ALL commission"
);
assertEqual(
  hooks.publisherMetricAffCommissionRate(metric(100)),
  7.5,
  "publisher AFF commission rate should use 75% of ALL commission divided by sales"
);
assertEqual(
  hooks.publisherMetricAffCommissionRate({ sales: 0, allCommission: 10 }),
  null,
  "publisher AFF commission rate should be unavailable without sales"
);
const affSummary = hooks.publisherAffinitySummary(
  merchants.map((merchant) => ({ merchant, metrics: merchant.total }))
);
assertEqual(
  affSummary.weightedCommissionRate,
  7.5,
  "publisher weighted commission rate should use 75% of ALL commission"
);
assertEqual(
  affSummary.effectiveCommissionRate,
  7.5,
  "publisher effective commission rate should use 75% of ALL commission"
);

const indexHtml = fs.readFileSync("public/index.html", "utf8");
if (!indexHtml.includes('id="publisherPortfolioTier"')) {
  throw new Error("publisher portfolio should expose a Tier filter");
}
if (!indexHtml.includes("<th>Tier</th>")) {
  throw new Error("publisher portfolio table should expose a Tier column");
}
if (!indexHtml.includes('<th class="publisher-numeric">AFF EPC</th>')) {
  throw new Error("publisher portfolio table should expose a right-aligned AFF EPC column");
}
if (!indexHtml.includes('AFF EPC = Sales × AFF commission rate ÷ Clicks')) {
  throw new Error("publisher portfolio should explain the AFF EPC formula");
}
if (!indexHtml.includes('data-i18n="publishers.conversion">Conversion</th>')) {
  throw new Error("publisher portfolio table should expose a Conversion ratio column");
}
if (!indexHtml.includes('value="affCommissionRate">AFF 佣金率从高到低</option>')) {
  throw new Error("publisher portfolio should sort by AFF commission rate");
}
if (!indexHtml.includes('value="affCommission">AFF 实际佣金从高到低</option>')) {
  throw new Error("publisher portfolio should sort by AFF earned commission");
}
if (!indexHtml.includes('data-i18n="publishers.commissionRate">AFF commission rate</th>')) {
  throw new Error("publisher portfolio should label the AFF commission rate explicitly");
}
if (!indexHtml.includes('data-i18n="publishers.earnedCommission">AFF earned commission</th>')) {
  throw new Error("publisher portfolio should label AFF earned commission explicitly");
}

console.log("Publisher manager and Tier frontend checks passed");
