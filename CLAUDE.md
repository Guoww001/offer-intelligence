# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Internal YeahPromos Amazon offer intelligence dashboard — a Python-served static frontend with a vanilla JS SPA, chatbot, payment tracking, and tier management. Deployed on Vercel as Python serverless functions.

**Chatbot**: For any chatbot work, start with `docs/chatbot-feature-report.md` — the authoritative reference for intent classification, analysis, LLM pipeline, and all related files.

## Commands

### Run locally
```bash
python server.py
# Opens at http://127.0.0.1:8765
```

Required env vars for full functionality: `LEVANTA_API_KEY`, `OI_AUTH_ENABLED`, `OI_ADMIN_USERNAME`, `OI_ADMIN_PASSWORD_HASH`, `OI_SESSION_SECRET`, `OFFER_DB_API_TOKEN`, and the `OFFER_DB_*` connection variables. The frontend can load from committed `protected_data/` payloads without the Levanta key or DB.

### Generate password hash
```bash
python scripts/hash_auth_password.py
```

### Rebuild static data payloads
```bash
python scripts/build_sheet_report_data.py
ruby scripts/build_offer_chatbot_data.rb
python scripts/build_publishers_data.py
python scripts/validate_db_migration.py --output output/db_migration_status.json
python scripts/build_db_static_snapshot.py --chatbot-output protected_data/chatbot_data.js
python scripts/import_product_name_keywords.py --source "/path/to/brand and asins t1-t3.xlsx"
```

### Run tests (same as CI)
```bash
node --check public/auth.js
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
python scripts/test_auth_helpers.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_category_drilldown.mjs
node scripts/test_tier_visual_status.mjs
node scripts/test_zh_chatbot.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py browser_payloads.py protected_payloads.py server.py offer_db.py api/auth/login.py api/auth/session.py api/auth/logout.py api/auth/data.py api/db/status.py api/db/merchant.py api/db/search.py scripts/validate_db_migration.py scripts/build_db_static_snapshot.py
```

## Architecture

### Dual runtime: local server + Vercel serverless

The codebase runs as a single `python server.py` process locally, but on Vercel each file under `api/` is deployed as a separate serverless function. This means:

- **`server.py`** is the monolith that handles all routes locally. It imports from `auth.py`, `offer_db.py`, `api/tier_moves.py`, etc.
- **`api/**/*.py`** files each export a `handler` class (extending `BaseHTTPRequestHandler`) that Vercel invokes independently. These files re-import shared logic from the root modules.
- Code shared between local and serverless paths lives in root-level `.py` files (`auth.py`, `offer_db.py`, `browser_payloads.py`, `protected_payloads.py`).

### Request flow (local)

```
Browser → server.py Handler.do_GET/POST
  ├── /api/auth/session  → auth.handle_auth_session()
  ├── /api/auth/login    → auth.handle_auth_login()      [POST]
  ├── /api/auth/logout   → auth.handle_auth_logout()     [POST]
  ├── /api/auth/data     → protected_payloads.handle_protected_data()
  ├── /api/levanta/payments → server.py internal handler
  ├── /api/tier_moves    → api/tier_moves.handle_tier_moves()
  ├── /api/ui/db/*       → server.py internal handler (session auth)
  └── /*                 → static file server from public/
```

### Auth model

Single admin user. No user registration, no roles table. Session-based with an `HttpOnly` signed cookie (`oi_session`). The cookie payload is base64url-encoded JSON with `sub`, `role`, `exp`, `iat`, HMAC-signed with `OI_SESSION_SECRET`. Payment sync can bypass session auth by presenting `PAYMENT_SYNC_TOKEN` as a Bearer token or `X-Payment-Sync-Token` header.

When `OI_AUTH_ENABLED` is `0`/`false`/`off`, all auth checks pass through (disabled mode).

### DB layer (`offer_db.py`)

Read-only MySQL access via PyMySQL. Column discovery is dynamic — the code runs `SHOW COLUMNS FROM` at runtime and fuzzy-matches against expected aliases, making it tolerant of schema variations. The reporting contract is documented in `docs/offer-db-reporting-contract.sql`. Key objects:

- `oi_offer_base` — one row per merchant
- `oi_offer_products` — ASIN-level product rows
- `oi_offer_monthly_amazon_metrics` — merchant-month metrics
- `oi_offer_monthly_aggregate_metrics` — aggregate-only metrics
- `oi_levanta_monthly_metrics` — Levanta historical metrics
- `oi_tier_assignments` — tier placement state
- `oi_tier_visual_status` — green/yellow/red color state
- `oi_category` / `oi_merchant_category` — category classification (added on current branch)

DB endpoints come in two flavors:
- **Server-only** (`/api/db/*`) — require `OFFER_DB_API_TOKEN` via `Authorization: Bearer` or `X-Offer-Db-Token` header
- **Browser-safe** (`/api/ui/db/*`) — require session auth, no DB token exposed to browser

### Frontend (`public/`)

Vanilla JS SPA with no framework or build step. GSAP loaded from CDN for motion. Three phases:

1. **`auth.js`** loads first — checks session, shows login form if unauthenticated, then loads protected data
2. **Protected data** (`chatbot_data.js`, `sheet_report_data.js`, `product_keywords.js`) loaded as `<script>` tags after auth
3. **`app.js`** (~420KB) bootstraps the dashboard — tier pages, category reports, chatbot, payment page, targets page, XLSX export

### Chatbot

See `docs/chatbot-feature-report.md` for the full architecture — LLM intent classifier (DeepSeek/Claude via `llm_classify.py` + `skills/`), 7-intent routing in `answerPrompt()`, analysis engine, i18n, and all 34 involved files.

### Category system

Main category resolution follows a priority chain: Google Sheet category → `mainCategory` field → Feishu main category → non-Feishu category → remaining category → `levantaCategory` → "Uncategorized". Feishu subcategory and category path data is searchable metadata but doesn't drive main-category grouping.

The current branch (`feat/add-category-tables`) adds `oi_category` and `oi_merchant_category` tables for DB-backed category storage.

### Tier system

Five tiers: Tier 1, Tier 2, Tier 3, Tier 4, BLACK TIER. Tier moves are persisted via Google Apps Script webhook (`scripts/tier_moves_apps_script.gs`). The browser calls `/api/tier_moves`, which proxies to the Apps Script URL with the server-side secret. When `TIER_MOVES_WEBHOOK_URL` is unset, moves work locally only.

### Payment data

Levanta invoice data is fetched from the Levanta API, normalized into payment records, enriched with offer metadata (tier, category, payment cycle), and augmented with pending placeholder records for months without invoice data. Payment statuses: Paid, Pending, Unpaid, Overdue, Partial. Zero-revenue+zero-commission records are excluded from all payment views and exports.

A GitHub Actions workflow (`.github/workflows/sync-levanta-payments.yml`) runs daily at 02:00 UTC to sync payment data and auto-commit updated `chatbot_data.js` back to the repo.

### `public/app.js` navigation index (~8900 lines)

**CRITICAL — NEVER read the entire file.** Use this index to read only the line ranges relevant to the task. The file is wrapped in an IIFE (`(function () { ... })();`). All functions are `function name(...)` inside the IIFE scope.

**Chatbot work**: the ranges below marked with ★ are chatbot-critical. For the full picture (intent flow, LLM pipeline, analysis engine, i18n), also read `docs/chatbot-feature-report.md` — it has a function-level chatbot index for `app.js`.

| Lines | Section | Key functions / what lives here |
|-------|---------|--------------------------------|
| 1–471 | **Init & global state** | `state` object (pages, filters, sort), `offersByMerchantId`, offer prep loop, `PAYMENT_MONTHS`, `TIER_MOVE_OPTIONS`, all `const` configs. Also `mergeProductKeywordsIntoOffers` (line ~700). |
| 472–719 | **i18n + formatting utils** | `t()`, `labelText()`, `optionText()`, `statusText()`, `chatCopy()`, `chatFormat()`, `applyStaticLanguage()`, `rerenderForLanguage()`, `toggleLanguage()`, `number()`, `money()`, `shortMoney()`, `pct()`, `shortPct()`, `epc()`, `countValue()`, `normalize()` |
| 720–870 | **Tier overrides & manual moves** | `canonicalTierName()`, `offerKey()`, `loadTierOverrides()`, `saveTierOverrides()`, `applyTierOverrideToOffer()`, `tierMoveOptionsHtml()`, `tierMoveControlHtml()`, `setManualTierMoveFromOffer()`, `moveOfferToTier()` [async], `handleTierMoveClick()` |
| 871–1120 | **Search/text utilities** | `words()`, `meaningfulTokens()`, `escapeHtml()`, `escapeRegExp()`, `textIncludesAlias()`, `cleanCategoryValue()`, `sheetMainCategory()`, `categoryParts()`, `displayCategory()`, `categorySearchText()`, `uniqueCategoryValues()`, `allCategoryValues()`, `keywordFieldGroups()`, `productTitleValues()`, `qualifiesAsSkincareBrand()`, `searchValueMatches()`, `searchValueExactMatches()`, `keywordAliasEntries()`, `addKeywordAlias()`, `cleanedKeywordPhrase()` |
| 1121–1376 | **Keyword search engine (chatbot)** ★ | `specificKeywordAliasAllowed()`, `keywordSearchRequest()`, `keywordTokenFuzzyScore()`, `keywordAliasIsPrimary()`, `keywordOfferMatch()`, `hasStrongTier3KeywordSignals()`, `keywordTierPriority()`, `compareKeywordMatches()`, `keywordSearchMatches()`, `hasDirectMerchantKeywordLookup()`, `hasKeywordSearchIntent()` |
| 1377–1786 | **Payment core** | `dateOnly()`, `localDateKey()`, `isoDate()`, `monthNameFromText()`, `monthKey()`, `addDaysIso()`, `calculatePaymentAvailabilityDate()`, `normalizePaymentCycle()`, `paymentCycleKeys()`, `buildSheetPaymentCycleIndex()`, `sheetPaymentCycleFor()`, `resolveOfferPaymentCycle()`, `inferRegionFromText()`, `normalizeRegion()`, `paymentRegionFor()`, `bestPaymentOffer()`, `isSafeBrandMatch()`, `resolvePaymentCycle()`, `offerForMerchant()`, `paymentDueDate()`, `calculatePaymentStatus()`, `normalizePaymentRecord()`, `offerForPaymentMerchant()`, `createPendingPaymentRecord()`, `withPendingPaymentPlaceholders()` |
| 1787–1978 | **Payment index, queries, risk** | `rebuildPaymentIndex()`, `getPaymentRecords()`, `hasPaymentRevenueOrCommission()`, `visiblePaymentRecords()`, `hasPayablePaymentAmount()`, `isTrackablePaymentRecord()`, `getPaymentByMerchant()`, `getPaymentByMonth()`, `getPaymentByStatus()`, `getUnpaidPayments()`, `getPendingPayments()`, `isPaymentOverdue()`, `getOverduePayments()`, `updatePaymentSummary()`, `syncLevantaPayments()`, `refreshLevantaPayments()` [async], `maybeAutoSyncLevantaPayments()`, `paymentRecordsForOffer()`, `hasOfferOverduePayment()`, `paymentRiskTextForOffer()`, `hasPaymentRisk()`, `hasPaidSignal()` |
| 1979–2141 | **Tier grouping & recommendations** | `tierGroup()`, `tierPriority()`, `highlightStatus()`, Tier 2 publisher strategy/optimization functions (`tier2PublisherStrategy()`, `tier2PublisherCountText()`, `tier2PublisherSuccessText()`, `tier2OptimizationIdea()`, `tier2RecommendationDetailsHtml()`, `tier2FieldRows()`), `recommendedAction()`, `caution()`, `bestAngle()` |
| 2142–2450 | **Data queries & dashboard sort/filter** | `aggregateRows()`, `bestBy()`, `uniqueValues()`, `fillSelect()`, `replaceSelectOptions()`, `parseSheetNumber()`, `isRateColumn()`, `percentageNumberForHeader()`, `formatSheetCell()`, `sortableReportValue()`, `compareReportValues()`, `defaultReportSortDirection()`, `sortReportRows()`, `sortableHeaderHtml()`, `updateReportSort()`, `handleReportSortClick()`, `rowValue()`, `getFiltered()`, `dashboardCategoryGroups()`, `fuzzyScore()`, `findMerchantMatches()`, `findByMerchantId()`, `findByAsin()` |
| 2451–2900 | **Metric/Cycle filtering & NL parsing** | `metricTermPattern()`, `comparisonTermPattern()`, `numberTokenPattern()`, `metricFilterPattern()`, `metricRangeFilterPattern()`, `metricTrailingComparisonPattern()`, `normalizeMetricName()`, `parseMetricNumber()`, `normalizeMetricThreshold()`, `normalizeComparisonOperator()`, `normalizeCycleComparisonOperator()`, `paymentCycleFilterPattern()`, `extractPaymentCycleFilter()`, `paymentCycleFilterMatches()`, `paymentCycleFilterText()`, `extractMetricFilters()`, `metricFilterMatches()`, `applyMetricFilters()`, `metricSortTermPattern()` and sort extraction utilities |
| 2901–3377 | **Category matching & intent detection** ★ | `cleanedCategoryPhrase()`, `hasCategoryIntentText()`, `categoryScore()`, `categoryForPrompt()`, `categoryMatches()`, `cleanedMerchantLookupPhrase()`, `merchantLookupForPrompt()`, `hasStrongMerchantLookup()`, `tierFromPrompt()`, `wantsRecommendationList()`, `collectCategories()`, `classifyWithLLM()` [async], `detectQueryIntent()`, `recommendationScore()`, `compareRecommendationOffers()`, `sortedForCategory()`, `rankedRecommendations()`, `topRecommendations()`, `whyRecommended()`, context builder functions (`setContext()`, `build*Context()`), `statCards()`, `miniTable()` |
| 3378–4385 | **Chatbot rendering (stats, answers, recommendations)** ★ | `renderRecommendationStats()`, `renderMerchantStats()`, `renderASINStats()`, `renderPaymentStats()`, `renderCategoryStats()`, `renderKeywordStats()`, `renderContextPanel()`, `paymentByMonthText()`, `fieldRows()`, `merchantOverviewHtml()`, `resultTable()`, `extractTopMetricRequest()`, `topMetricOfferAnswer()`, `keywordSearchAnswer()`, `findPaymentMerchantMatches()`, `requestedRecommendationCount()`, `parseTierOfferRequest()`, `rebuildRecommendationBundle()`, `recommendationBundleAnswer()`, `matchedOffersFromPrompt()`, `recommendationHtml()`, `paymentCycleOfferAnswer()` |
| 4386–4700 | **Chat message handling & prompt routing** ★ | `addMessage()` (line ~4862), functions for handling user prompts: routing to merchant/category/ASIN/payment/keyword search answer functions. Scroll management, download button injection for chatbot recommendations. |
| 4701–5540 | **DB lookup + Dashboard category report** | `dbMerchantProductRows()`, `dbMerchantInsightHtml()`, `dbLookupSkipPrompt()`, `dbSearchQueryForPrompt()`, `dbMerchantOfferForPrompt()`, `dbSearchRowsHtml()`, `dbSearchInsightHtml()`, `renderMetrics()`, `dashboardOfferPreviewLimit()`, `dashboardCategoryHeaderRow()`, `renderTable()`, `categoryReportTierLabel()`, `dashboardCategoryReportRows()`, `dashboardCategoryPieHtml()` (large SVG pie chart), `dashboardCategoryOptimizationPreviewsHtml()`, `renderDashboardCategoryReport()`, `handleCategoryPointerMove()`, `setCategoryHighlight()` |
| 5541–6145 | **Global render + XLSX export** | `renderAll()` (line ~5586), `syncControls()` (line ~5593), `resetFilters()`, `chatbotOfferDescriptor()`, `todayDownloadDateStamp()`, `registerRecommendationDownload()`, `recommendationExportColumns()`, `paymentExportColumns()`, `objectExportColumns()`, XLSX generation functions (`worksheetXml()`, `workbookXml()`, `crc32()`, `createZip()`, `createRecommendationWorkbook()`, `triggerWorkbookDownload()`), `downloadRowsAsXlsx()`, `downloadFilteredXlsx()`, `downloadPaymentsXlsx()`, `downloadSheetTargetsXlsx()`, `downloadTierSheetXlsx()`, `downloadRecommendationXlsx()` |
| 6146–6291 | **Payment page rendering** | `paymentStatusClass()`, `uniquePaymentValues()`, `refreshPaymentFilterOptions()`, `refreshPaymentSortOptions()`, `getFilteredPayments()`, `latestPaymentCheckedDate()`, `renderPaymentSummary()`, `paymentStatusSummaryItems()`, `renderPaymentHead()`, `renderPaymentRows()`, `renderPaymentsPage()` |
| 6292–7464 | **Tier sheet management** | `sheetByName()`, `storageApi()`, `isTierMoveTarget()`, `isTierDataSheet()`, `loadManualTierMoves()`, `persistManualTierMoves()`, `tierMoveAdminToken()`, `tierMovePayload()`, `renderAfterTierMoveSync()`, `defineTierRowMeta()`, `cloneTierRow()`, `cacheOriginalTierSheetRows()`, `applyManualTierMoves()`, `applyManualTierMovesToOffers()`, `hasManualTierMoves()`, `tierLogicItems()`, `renderTierLogicSummary()`, `renderTierSummary()`, `renderSheetTable()`, `tier2PhaseKind()`, `normalizeVisualStatusColor()`, `explicitVisualStatusColor()`, `tierRowRuleHighlightKind()`, `visualStatusForTierRow()`, `displayHeadersForSheet()`, `selectedHeadersForTierSheet()`, `visibleHeadersForSheet()`, `renderTierColumnPanel()`, `offerForSheetRow()`, `offerToTierSheetRow()`, `tierSheetRowsForDisplay()`, `renderTierSheetTable()`, `canExpandTierSheet()`, `syncTierSheetOverlay()`, `openTierSheetOverlay()`, `closeTierSheetOverlay()`, `renderTierMoveDialog()`, `getFilteredTierSheetRows()`, `tierCategorySummaryRows()`, `renderTierCategorySummary()`, `renderTierPage()` |
| 7465–8729 | **Targets page & DB status dashboard** | `targetOverrideKey()`, `applyTargetOverride()`, `targetRecords()`, `derivedTargetRecordsFromTierSheets()`, `filteredTargetRecords()`, `refreshTargetFilters()`, `targetRowsForMonth()`, `targetSummary()`, `compactNumber()`, `compactMoney()`, `dateKey()`, `monthKeyFromText()`, `dbDailyTrendRows()`, `dbStatusViewModel()`, `dbStatusDemoEnabled()`, `demoDbStatusPayload()`, `deltaText()`, `dbTrendPath()`, `dbDailyTrendChartHtml()` (SVG), `dbStatusPanelHtml()`, `refreshDbStatusUi()`, `targetMetricConfig()`, `targetDeltaHtml()`, `renderSheetSummary()`, `targetGoal()`, `targetGoalCardHtml()`, `targetProgressHtml()`, `targetTrendPlotHtml()` (SVG chart ~line 8336), `targetMatrixHtml()`, `renderSheetPage()`, `refreshTargetMetricViews()`, `handleTargetReportClick()`, `handleTargetReportSubmit()` |
| 8730–8901 | **`init()` — event bindings** | All DOM event listeners wired up: chat submit, report sort clicks, tier move buttons, payment filters, language toggle, download buttons, column toggle, overlay open/close, keyboard Escape handlers. `switchPage()` (line ~8695) handles SPA page routing. |

**How to use this index:**
1. Identify the feature area you need (e.g., "payment overdue logic")
2. Read only the matching line range (e.g., lines 1787–1978 for payment queries)
3. Use `grep -n "function name" public/app.js` to pinpoint exact line numbers within a range
4. For cross-cutting changes, check multiple ranges — but still never read the whole file
5. The `state` object (lines 69–110) defines all filter/sort/page state — read this first when adding new filters or pages
6. **For chatbot work**, rows marked ★ are your entry points, but also read `docs/chatbot-feature-report.md` — it maps every chatbot function to its line number and explains the full LLM→skills→frontend pipeline

### Data files

- `protected_data/` — committed browser payloads (JS files that assign to `window.CHATBOT_DATA`, `window.SHEET_REPORT_DATA`, `window.PRODUCT_KEYWORDS`)
- `data/feishu_merchant_categories.csv` — Feishu category mappings
- `data/product_name_keywords_t1_t3.csv` — product name keywords for Tier 1-3
- `api/static_merchant_ids.json` — known merchant ID list for DB search
