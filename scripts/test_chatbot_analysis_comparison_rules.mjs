import fs from "node:fs";
import vm from "node:vm";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertApprox(actual, expected, label, tolerance = 1e-9) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {},
  appendChild() {},
  insertBefore() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {},
  removeAttribute() {},
  style: {},
  value: "",
  innerHTML: "",
  textContent: ""
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
  Promise,
  URLSearchParams,
  AbortSignal: { timeout() { return undefined; } },
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
    createElement() { return { ...elementStub }; },
    body: elementStub,
    addEventListener() {}
  }
};
sandbox.window.document = sandbox.document;

const offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
const keywordsCache = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: offersCache.summary || {},
  offers: offersCache.offers || [],
  paymentRecords: offersCache.paymentRecords || [],
  sources: { mode: "db", month: offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
sandbox.window.PRODUCT_KEYWORDS = keywordsCache;

vm.runInNewContext(fs.readFileSync("public/chatbot_i18n.js", "utf8"), sandbox, { filename: "public/chatbot_i18n.js" });
vm.runInNewContext(fs.readFileSync("public/tier2_recommendation_rules.js", "utf8"), sandbox, { filename: "public/tier2_recommendation_rules.js" });
vm.runInNewContext(fs.readFileSync("public/app.js", "utf8"), sandbox, { filename: "public/app.js" });

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks");
assertEqual(typeof hooks.analyzeMerchant, "function", "analysis hook should be exposed");
assertEqual(typeof hooks.analyzeCategory, "function", "category analysis hook should be exposed");
assertEqual(typeof hooks.analyzeTier, "function", "tier analysis hook should be exposed");
assertEqual(typeof hooks.analysisMetricValueForOffer, "function", "metric value helper should be exposed");
assertEqual(typeof hooks.analysisMetricSampleSize, "function", "sample size helper should be exposed");
assertEqual(typeof hooks.analysisMetricSampleEligible, "function", "sample eligibility helper should be exposed");
assertEqual(typeof hooks.analysisAverage, "function", "aligned average helper should be exposed");

const shokz = offersCache.offers.find((offer) => String(offer.merchantId) === "362653");
assertTruthy(shokz, "fixture requires Shokz");
const shokzAnalysis = hooks.analyzeMerchant("Shokz");
assertTruthy(shokzAnalysis, "Shokz analysis should exist");

const expectedAffEpc = Number(shokz.affCommission) / Number(shokz.clicks);
const expectedAffRate = Number(shokz.affCommission) / Number(shokz.salesAmount) * 100;
assertApprox(shokzAnalysis.metrics.epc, expectedAffEpc, "analysis EPC must use Affiliate EPC");
assertApprox(shokzAnalysis.metrics.commissionRate, expectedAffRate, "analysis Commission Rate must use AFF percent");

const shokzCategory = String(shokz.mainCategory || shokz.category || "").toLowerCase();
const categoryOffers = offersCache.offers.filter((offer) => {
  const category = String(offer.mainCategory || offer.category || "").toLowerCase();
  return category === shokzCategory || category.includes(shokzCategory);
});
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const categoryAffEpcs = categoryOffers
  .filter((offer) => Number(offer.clicks) >= 100 && Number.isFinite(Number(offer.affCommission ?? offer.affiliatePayout)))
  .map((offer) => Number(offer.affCommission ?? offer.affiliatePayout) / Number(offer.clicks));
const categoryAffRates = categoryOffers
  .filter((offer) => Number(offer.salesAmount) > 0 && Number(offer.orders) >= 10 && Number.isFinite(Number(offer.affCommission ?? offer.affiliatePayout)))
  .map((offer) => Number(offer.affCommission ?? offer.affiliatePayout) / Number(offer.salesAmount) * 100);
assertApprox(
  shokzAnalysis.comparisons.vsCategory.epc.avg,
  average(categoryAffEpcs),
  "EPC average and percentile must use the same Affiliate EPC values"
);
assertApprox(
  shokzAnalysis.comparisons.vsCategory.commissionRate.avg,
  average(categoryAffRates),
  "Commission Rate average and percentile must use the same AFF percent values"
);

const electronicsAnalysis = hooks.analyzeCategory("Electronics");
assertTruthy(electronicsAnalysis, "Electronics analysis should exist");
assertApprox(
  electronicsAnalysis.aggregates.avgEpc,
  hooks.analysisAverage(categoryOffers, "epc"),
  "category EPC aggregate should use the aligned Affiliate EPC average"
);
assertApprox(
  electronicsAnalysis.aggregates.avgCommissionRate,
  hooks.analysisAverage(categoryOffers, "commissionRate"),
  "category Commission Rate aggregate should use the aligned AFF percent average"
);

const tier1Offers = offersCache.offers.filter((offer) => offer.tier === "Tier 1");
const tier1Analysis = hooks.analyzeTier("Tier 1");
assertTruthy(tier1Analysis, "Tier 1 analysis should exist");
assertApprox(
  tier1Analysis.aggregates.avgEpc,
  hooks.analysisAverage(tier1Offers, "epc"),
  "Tier EPC aggregate should use the aligned Affiliate EPC average"
);

assertEqual(hooks.analysisMetricSampleSize({ clicks: 99 }, "epc"), 99, "EPC sample size uses clicks");
assertEqual(hooks.analysisMetricSampleEligible({ clicks: 99 }, "epc"), false, "EPC needs minimum clicks");
assertEqual(hooks.analysisMetricSampleEligible({ clicks: 100 }, "epc"), true, "EPC passes minimum clicks");
assertEqual(hooks.analysisMetricSampleSize({ orders: 9 }, "aov"), 9, "AOV sample size uses orders");
assertEqual(hooks.analysisMetricSampleEligible({ orders: 9 }, "aov"), false, "AOV needs minimum orders");
assertEqual(hooks.analysisMetricSampleEligible({ orders: 10 }, "aov"), true, "AOV passes minimum orders");

const lowSample = offersCache.offers.find((offer) => (
  (offer.brand || offer.merchantName) && Number(offer.clicks) > 0 && Number(offer.clicks) < 100
));
assertTruthy(lowSample, "fixture requires a low-click merchant");
const lowSampleAnalysis = hooks.analyzeMerchant(lowSample.brand || lowSample.merchantName);
assertEqual(lowSampleAnalysis.ranks.epc.status, "insufficient_sample", "low-click EPC should not receive a percentile status");
assertEqual(lowSampleAnalysis.strengths.includes("epc"), false, "low-click EPC should not be a strength");
assertEqual(lowSampleAnalysis.weaknesses.includes("epc"), false, "low-click EPC should not be a weakness");

console.log("Chatbot analysis comparison rule tests passed");
