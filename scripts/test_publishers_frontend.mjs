import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const entry = fs.readFileSync("frontend/src/entry.ts", "utf8");
const page = fs.readFileSync("frontend/src/features/publishers/PublishersPage.vue", "utf8");
const model = fs.readFileSync("frontend/src/features/publishers/publisherModel.ts", "utf8");
const indexHtml = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assert(entry.includes("PublishersPage"), "modern entry should register PublishersPage");
assert(entry.includes("loadPublisherPortfolio"), "modern entry should expose the portfolio API loader");
assert(entry.includes('publishers: publishersFactory'), "modern entry should register the publishers factory");
assert(indexHtml.includes('id="publishersModernRoot"'), "index.html should provide a Publishers modern root");
assert(styles.includes(".publishers-page.is-modern > :not(#publishersModernRoot)"), "legacy styles should isolate the modern Publishers root");
assert(app.includes('mountPage("publishers"'), "switchPage() should mount modern Publishers");
assert(app.includes('unmountPage("publishers"'), "switchPage() should unmount modern Publishers");
assert(app.includes('type === "publishers" && downloadModernPublishers(payload)'), "legacy bridge should keep Publishers export available");
assert(page.includes("publisher-layout" ) || page.includes("layout-editing"), "Publishers should expose layout editing state");
assert(page.includes("publisher-affinity-panel"), "Publishers should retain the affinity panel");
assert(page.includes("publisher-portfolio-table"), "Publishers should retain the portfolio table");
assert(model.includes("PUBLISHER_AFF_COMMISSION_SHARE"), "Publisher model should keep the AFF commission share rule");
assert(model.includes("applyDateFilter"), "Publisher model should support daily date aggregation");

console.log("Publishers frontend contract checks passed");
