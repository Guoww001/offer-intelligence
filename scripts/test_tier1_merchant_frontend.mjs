import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

function assertIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error(`${label}: missing ${JSON.stringify(fragment)}`);
  }
}

assertIncludes(html, 'id="tier1AddMerchant"', "primary Tier 1 add action");
assertIncludes(html, 'id="tier1AdditionsToggle"', "Tier 1 history toggle");
assertIncludes(html, 'aria-controls="tier1AdditionsPanel"', "history accessibility relationship");
assertIncludes(html, 'class="tier1-additions-overlay hidden"', "migration history page overlay");
assertIncludes(html, 'aria-labelledby="tier1AdditionsTitle"', "history dialog title relationship");
assertIncludes(html, 'id="tier1MerchantDialog"', "merchant confirmation dialog");
assertIncludes(html, 'role="dialog"', "dialog semantics");

assertIncludes(app, 'const DB_TIER1_MERCHANTS_UI_API = "/api/ui/db/tier1-merchants";', "database API");
assertIncludes(app, "expectedTier: merchant.currentTier || \"\"", "optimistic migration guard");
assertIncludes(app, "state.tierReport.payloads.clear();", "all-tier report cache invalidation after migration");
assertIncludes(app, "await refreshTier1ReportAfterAdd();", "database-backed report refresh");
assertIncludes(app, "Migration recorded:", "migration success confirmation");
assertIncludes(app, "previousTier", "migration source in history banner");
assertIncludes(app, "function openTier1AdditionsOverlay()", "history overlay open behavior");
assertIncludes(app, "function closeTier1AdditionsOverlay", "history overlay close behavior");
assertIncludes(app, "trapTier1AdditionsOverlayFocus", "history overlay keyboard focus trap");

assertIncludes(styles, ".tier1-add-merchant", "primary action styling");
assertIncludes(styles, ".tier1-additions-overlay", "history overlay styling");
assertIncludes(styles, ".tier1-additions-panel", "history banner styling");
assertIncludes(styles, "place-items: stretch end", "right-side history drawer placement");
assertIncludes(styles, "transform: translateX(32px)", "right-side drawer entry motion");
assertIncludes(styles, "height: 100dvh", "mobile full-page history layout");
assertIncludes(styles, ".tier1-merchant-dialog", "dialog styling");
assertIncludes(styles, "@media (prefers-reduced-motion: reduce)", "reduced-motion support");

console.log("Tier 1 merchant frontend checks passed");
