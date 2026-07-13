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
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
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

assertEqual(
  hooks.tierRowHighlightKind("Tier 3", { "Tier Reason": "New June raw offer with orders", visualStatusColor: "red" }),
  "red",
  "stored visual status should be displayed"
);
assertEqual(
  hooks.tierRowHighlightKind("Tier 4", { "Tier Reason": "0 orders", "Visual Status Color": "none" }),
  "",
  "stored none should clear the row color"
);
assertEqual(
  hooks.tierRowHighlightKind("Tier 2", { Phase: "Stable", visual_status_color: "green" }),
  "green",
  "snake-case stored visual status should be displayed"
);
assertEqual(
  hooks.tierRowHighlightKind("Tier 2", { Phase: "Stable" }),
  "",
  "rows without a stored visual status should remain uncolored"
);
assertEqual(
  hooks.visualStatusForTierRow("Tier 1", { "Original Rank": "45", visualStatus: { color: "yellow" } }).source,
  "manual",
  "nested visual status should be treated as an explicit override"
);
