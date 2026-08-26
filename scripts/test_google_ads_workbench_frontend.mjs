import fs from "node:fs";


function assertIncludes(source, value, label) {
  if (!source.includes(value)) {
    throw new Error(label + ": missing " + JSON.stringify(value));
  }
}


const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

[
  'id="googleAdsNav"',
  'id="googleAdsPage"',
  'id="googleAdsRangeButtons"',
  'id="googleAdsStartDate"',
  'id="googleAdsEndDate"',
  'id="googleAdsKpis"',
  'id="googleAdsChart"',
  'id="googleAdsMerchantRows"',
  'id="googleAdsUnmatchedList"',
  'id="googleAdsMethod"'
].forEach((value) => assertIncludes(html, value, "Google Ads workbench markup"));

[
  'switchPage("google-ads")',
  '/api/ui/db/google-ads-workbench?',
  'function _googleAdsRenderChart',
  'function _googleAdsRenderMerchantTable',
  'function _googleAdsLoad',
  'renderGoogleAdsPage();',
  '_bindGoogleAdsPageInteractions();'
].forEach((value) => assertIncludes(app, value, "Google Ads workbench behavior"));

[
  ".google-ads-page",
  ".google-ads-kpis",
  ".google-ads-chart",
  ".google-ads-table-wrap",
  "@media (max-width: 560px)"
].forEach((value) => assertIncludes(styles, value, "Google Ads workbench styles"));

const combined = html + app + styles;
[
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, "OAuth client secret"],
  [/1\/\/0[A-Za-z0-9_-]{20,}/, "OAuth refresh token"],
  [/\d{12}-[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com/, "OAuth client ID"]
].forEach(([pattern, label]) => {
  if (pattern.test(combined)) {
    throw new Error("browser assets must not contain a Google Ads " + label);
  }
});

console.log("Google Ads workbench frontend checks passed");
