import fs from "node:fs";

const authSource = fs.readFileSync("public/auth.js", "utf8");
const appSource = fs.readFileSync("public/app.js", "utf8");
const indexSource = fs.readFileSync("public/index.html", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const appMatch = authSource.match(/APP_SCRIPT\s*=\s*["']([^"']+)["']/);
assert(appMatch, "auth.js must declare the dynamically loaded app script");
assert(
  appMatch[1] === "./app.js?v=20260817-tier-merchant-list1",
  "auth.js must bust the cache for the Tier merchant-list implementation"
);
assert(
  indexSource.includes('./auth.js?v=20260817-tier-merchant-list1'),
  "index.html must bust the cache for auth.js so the new app version can load"
);
assert(appSource.includes("compactAgentTierMerchantRows"), "app.js must compact Tier merchant rows");
assert(appSource.includes("merchantList"), "app.js must expose Tier merchant-list metadata");
assert(appSource.includes("ensureAgentTierMerchantDataVisible"), "app.js must guard against synthesis hiding Tier rows");

console.log("OK Tier Agent asset contract");
