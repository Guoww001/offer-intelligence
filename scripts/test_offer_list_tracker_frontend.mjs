import fs from "node:fs";
import vm from "node:vm";

function assert(condition, label) {
  if (!condition) throw new Error(label);
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
  TextEncoder,
  TextDecoder,
  Uint8Array,
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
sandbox.window.PRODUCT_KEYWORDS = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));

for (const file of ["public/chatbot_i18n.js", "public/tier2_recommendation_rules.js", "public/app.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assert(hooks, "app should expose offer tracker test hooks");

const high = {
  merchantId: "101",
  merchantName: "Alpha Beauty",
  tier: "Tier 1",
  network: "Levanta",
  mainCategory: "Beauty & Personal Care",
  affCommissionRate: 20,
  commissionRate: 12,
  aov: 100,
  aovType: "actual",
  recommendation: "Source recommendation should not be exported",
  topAsins: [
    "B012345678", "B012345678", "B087654321", "not-an-asin",
    "B011223344", "B055667788", "B099887766", "B000000001"
  ]
};
const lowAov = {
  merchantId: "202",
  merchantName: "Beta Home",
  tier: "Tier 3",
  network: "Levanta",
  mainCategory: "Home & Kitchen",
  affCommissionRate: 12,
  aov: 80,
  aovType: "tentative",
  aovSampleProductCount: 5,
  aovSourceDate: "2026-07-09"
};
const recommended = {
  merchantId: "303",
  merchantName: "Gamma Fitness",
  tier: "Tier 3",
  network: "Amazon Associates",
  mainCategory: "Sports & Outdoors",
  affCommissionRate: 12,
  aov: 180,
  aovType: "actual"
};
const bbMind = { merchantName: "Mammotion US" };
const bbOpen = { merchantName: "Ottocast" };
const bbUnknown = { merchantName: "Unlisted Brand" };
const tierTwoFirst = {
  merchantId: "401",
  merchantName: "Tier Two First",
  tier: "Tier 2",
  affCommissionRate: 20,
  aov: 140
};
const tierTwoSecond = {
  merchantId: "402",
  merchantName: "Tier Two Second",
  tier: "Tier 2",
  affCommissionRate: 15,
  aov: 120
};

assertEqual(hooks.offerTrackerCommissionRate(high), 20, "affiliate commission should be preferred for tracker filtering");
assertEqual(hooks.offerTrackerCommissionRate({ commissionRate: 30 }), 0, "generic commission should never be presented as AFF Commission");
assertEqual(hooks.offerTrackerAovType(high), "actual", "actual AOV provenance should remain explicit");
assertEqual(hooks.offerTrackerAovType(lowAov), "estimated", "tentative AOV provenance should display as estimated");
assertEqual(hooks.offerTrackerAovTypeLabel(high, "en"), "Actual", "actual AOV should have an English source label");
assertEqual(hooks.offerTrackerAovTypeLabel(lowAov, "en"), "Estimated", "tentative AOV should have an English source label");
assert(hooks.offerTrackerAovCellHtml(high).includes("offer-tracker-aov-badge actual"), "actual AOV cells should show an actual badge");
assert(hooks.offerTrackerAovCellHtml(lowAov).includes("offer-tracker-aov-badge estimated"), "tentative AOV cells should show an estimated badge");
assertEqual(hooks.offerTrackerBbPolicyKey(bbMind), "mind", "brands that prohibit BB should be marked as minding BB");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "Mammotion" }), "mind", "known regional brand aliases should share the BB policy");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "Beatbot Amazon" }), "mind", "database merchant suffixes should preserve the brand BB policy");
assertEqual(hooks.offerTrackerBbPolicyKey(bbOpen), "open", "brands that allow BB should be marked as open");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "Shokz Official" }), "open", "official-store suffixes should preserve the brand BB policy");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "AutoPlay (Ottocast)" }), "open", "confirmed brands should match when the brand appears as a merchant suffix");
assertEqual(hooks.offerTrackerBbPolicyKey(bbUnknown), "unknown", "unlisted brands should have an unknown BB policy");
assertEqual(hooks.offerTrackerBbPolicyLabel(bbMind, "zh"), "介意 BB", "BB policy labels should support Chinese");
assertEqual(hooks.offerTrackerBbPolicyLabel(bbOpen, "en"), "Doesn't mind BB", "BB policy labels should support English");
assert(hooks.offerTrackerBbPolicyCellHtml(bbMind).includes("offer-tracker-bb-badge mind"), "BB-sensitive brands should render a red badge class");
assert(hooks.offerTrackerBbPolicyCellHtml(bbOpen).includes("offer-tracker-bb-badge open"), "BB-open brands should render a green badge class");
assert(hooks.offerTrackerBbPolicyCellHtml(bbUnknown).includes("offer-tracker-bb-badge unknown"), "unknown brands should render a gray badge class");
assertEqual(
  hooks.offerTrackerAsins(high),
  ["B012345678", "B087654321", "B011223344", "B055667788", "B099887766"],
  "ASIN display and export should deduplicate, validate, and keep the top five values"
);
assertEqual(hooks.offerTrackerScore(high), 11, "score should combine tier, commission, AOV, and ASIN signals");
assertEqual(hooks.offerTrackerPriority(high).key, "high", "strong commercial offers should be high priority");
assertEqual(hooks.offerTrackerPriority(lowAov).key, "low-aov", "accessible AOV offers should enter the low-AOV group");
assertEqual(hooks.offerTrackerPriority(recommended).key, "recommended", "remaining offers should enter the recommendation pool");
assertEqual(hooks.offerTrackerRecommendation(high), "", "recommendation values should remain blank");

const filtered = hooks.filterOfferTrackerRows(
  [recommended, lowAov, high],
  { tier: "all", category: "all", minAov: "70", maxAov: "150", minCommission: "10", maxCommission: "25", network: "Levanta" },
  "",
  hooks.defaultOfferTrackerRules()
);
assertEqual(filtered.map((offer) => offer.merchantId), ["101", "202"], "commercial filters should combine inclusively and keep priority order");
assertEqual(
  hooks.filterOfferTrackerRows([recommended, lowAov, high], { tier: "all", category: "all", network: "all" }, "303").map((offer) => offer.merchantId),
  ["303"],
  "search should match merchant IDs"
);
assert(
  hooks.offerTrackerFilterChipLabels({ tier: "all", category: "all", network: "all", minCommission: "10", maxCommission: "25" }).includes("AFF 10%–25%"),
  "commission filter chips should identify AFF Commission"
);

const exportSourceRows = [tierTwoFirst, tierTwoSecond, lowAov, recommended, high];
const tierQuantities = {
  "Tier 1": { enabled: false, quantity: 1 },
  "Tier 2": { enabled: true, quantity: 1 },
  "Tier 3": { enabled: true, quantity: 2 },
  "Tier 4": { enabled: false, quantity: 0 },
  "BLACK TIER": { enabled: false, quantity: 0 }
};
assertEqual(
  hooks.offerTrackerTierCounts(exportSourceRows),
  { "Tier 1": 1, "Tier 2": 2, "Tier 3": 2, "Tier 4": 0, "BLACK TIER": 0 },
  "export setup should count the available offers in each Tier"
);
assertEqual(
  hooks.offerTrackerExportRows(exportSourceRows, tierQuantities).map((offer) => offer.merchantId),
  ["401", "202", "303"],
  "per-Tier quantities should keep the current within-Tier order"
);
assertEqual(
  hooks.offerTrackerExportTierSpans(exportSourceRows, tierQuantities),
  {
    "Tier 1": null,
    "Tier 2": { start: 1, end: 1, quantity: 1 },
    "Tier 3": { start: 2, end: 3, quantity: 2 },
    "Tier 4": null,
    "BLACK TIER": null
  },
  "Tier output spans should use exported data row numbers"
);
assertEqual(
  hooks.validateOfferTrackerBackgroundRanges([
    { start: 1, end: 1, color: "#D6EEDD" },
    { start: 2, end: 3, color: "#CCFFFF" }
  ], 3).ok,
  true,
  "valid non-overlapping row highlights should pass"
);
assertEqual(
  hooks.validateOfferTrackerBackgroundRanges([
    { start: 1, end: 2, color: "#D6EEDD" },
    { start: 2, end: 3, color: "#CCFFFF" }
  ], 3).ok,
  false,
  "overlapping row highlights should be rejected"
);
assertEqual(
  hooks.worksheetRowBackgroundColor(1, [{ start: 1, end: 1, color: "#D6EEDD" }]),
  "#D6EEDD",
  "worksheet row backgrounds should resolve from exported data row numbers"
);

assertEqual(
  hooks.offerTrackerOfferExportColumns().map(([header]) => header),
  ["Priority", "Merchant ID", "Merchant Name", "Tier", "AFF Commission", "AOV", "AOV Type", "BB Preference", "Category", "Recommendation"],
  "offer worksheet should preserve the approved business columns"
);
assertEqual(
  hooks.offerTrackerProductExportColumns().map(([header]) => header),
  ["Priority", "Merchant ID", "Merchant Name", "AOV", "AOV Type", "BB Preference", "Category", "Top Rank ASINs"],
  "product worksheet should preserve the reference workbook columns"
);

const workbook = hooks.createRecommendationWorkbook([high, lowAov], {
  rowBackgroundRanges: [
    { start: 1, end: 1, color: "#D6EEDD" },
    { start: 2, end: 2, color: "#CCFFFF" }
  ],
  sheets: [
    { sheetName: "List of Offers", rows: [high, lowAov], columns: hooks.offerTrackerOfferExportColumns() },
    { sheetName: "Brand Product List", rows: [high, lowAov], columns: hooks.offerTrackerProductExportColumns() }
  ]
});
const workbookText = new TextDecoder().decode(workbook);
const styledWorksheetXml = hooks.worksheetXml([high, lowAov], {
  columns: hooks.offerTrackerOfferExportColumns(),
  rowBackgroundRanges: [
    { start: 1, end: 1, color: "#D6EEDD" },
    { start: 2, end: 2, color: "#CCFFFF" }
  ],
  workbookBackgroundColors: ["#D6EEDD", "#CCFFFF"]
});
assert(styledWorksheetXml.includes('r="A2" s="4"'), "worksheet XML should style the first highlighted data row");
assert(styledWorksheetXml.includes('r="A3" s="7"'), "worksheet XML should style the second highlighted data row");
assert(workbookText.includes("List of Offers"), "workbook should contain the List of Offers worksheet");
assert(workbookText.includes("Brand Product List"), "workbook should contain the Brand Product List worksheet");
assert(workbookText.includes("B099887766"), "workbook should include the fifth Top Rank ASIN");
assert(!workbookText.includes("B000000001"), "workbook should omit ASINs after the top five");
assert(!workbookText.includes("Source recommendation should not be exported"), "workbook recommendation cells should remain blank");
assert(workbookText.includes("FFD6EEDD"), "workbook styles should include the first configured row background");
assert(workbookText.includes("FFCCFFFF"), "workbook styles should include the second configured row background");
assert(workbookText.includes('r="A2" s="4"'), "the first data row should use the first configured background style");
assert(workbookText.includes('r="A3" s="7"'), "the second data row should use the second configured background style");

const html = fs.readFileSync("public/index.html", "utf8");
const targetIndex = html.indexOf('id="targetNav"');
const trackerIndex = html.indexOf('id="offerListTrackerNav"');
const reportsIndex = html.indexOf('id="sheetsNav"');
assert(targetIndex >= 0 && trackerIndex > targetIndex && reportsIndex > trackerIndex, "Targets and Offer List Tracker should be top-level items before Reports");
assert(html.includes('id="offerListTrackerPage"'), "Offer List Tracker page should exist");
assert(html.includes('id="offerTrackerExportSelected"'), "selected-row workbook export should exist");
assert(html.includes('data-i18n="offerTracker.commissionRange">AFF Commission range</span>'), "commission filters should be labeled as AFF Commission");

const appSource = fs.readFileSync("public/app.js", "utf8");
assert(appSource.includes('commission: "AFF Commission"'), "tracker table headers should identify AFF Commission");
assert(appSource.includes('class="offer-tracker-aov-badge ${type}"'), "tracker AOV cells should render provenance badges");
assert(appSource.includes('bbPolicy: "BB Preference"'), "tracker table headers should include the BB preference column");
assert(appSource.includes('"Mammotion", "3W", "Gosovr"'), "tracker should preserve the confirmed prohibited-BB brand list");

const styles = fs.readFileSync("public/styles.css", "utf8");
assert(styles.includes(".offer-tracker-aov-badge.actual"), "actual AOV badges should have dedicated styling");
assert(styles.includes(".offer-tracker-aov-badge.estimated"), "estimated AOV badges should have dedicated styling");
assert(styles.includes(".offer-tracker-bb-badge.mind"), "BB-sensitive brands should have red badge styling");
assert(styles.includes(".offer-tracker-bb-badge.open"), "BB-open brands should have green badge styling");
assert(styles.includes(".offer-tracker-bb-badge.unknown"), "unknown BB policies should have gray badge styling");
assert(html.includes('id="offerTrackerExportDialog"'), "workbook export setup dialog should exist");
assert(html.includes('id="offerTrackerExportTiers"'), "per-Tier export quantity controls should exist");
assert(html.includes('id="offerTrackerBackgroundRanges"'), "row background range controls should exist");

if (process.env.OFFER_TRACKER_FIXTURE_PATH) {
  const fixtureSource = hooks.filterOfferTrackerRows(
    sandbox.window.CHATBOT_DATA.offers,
    { tier: "all", category: "all", network: "all" },
    "",
    hooks.defaultOfferTrackerRules()
  );
  const fixtureRows = hooks.offerTrackerExportRows(fixtureSource, {
    "Tier 1": { enabled: false, quantity: 0 },
    "Tier 2": { enabled: true, quantity: 20 },
    "Tier 3": { enabled: true, quantity: 15 },
    "Tier 4": { enabled: false, quantity: 0 },
    "BLACK TIER": { enabled: false, quantity: 0 }
  });
  const fixtureWorkbook = hooks.createRecommendationWorkbook(fixtureRows, {
    referenceStyle: true,
    rowBackgroundRanges: [
      { start: 1, end: 20, color: "#D6EEDD" },
      { start: 21, end: 35, color: "#CCFFFF" }
    ],
    sheets: [
      { sheetName: "List of Offers", rows: fixtureRows, columns: hooks.offerTrackerOfferExportColumns() },
      { sheetName: "Brand Product List", rows: fixtureRows, columns: hooks.offerTrackerProductExportColumns() }
    ]
  });
  fs.writeFileSync(process.env.OFFER_TRACKER_FIXTURE_PATH, fixtureWorkbook);
}

console.log("Offer List Tracker frontend checks passed");
