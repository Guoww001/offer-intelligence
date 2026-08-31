(function () {
  const data = window.CHATBOT_DATA || { summary: {}, offers: [] };
  const sheetReport = window.SHEET_REPORT_DATA || { sheets: [], tierSheets: [] };
  const productKeywordData = window.PRODUCT_KEYWORDS || { merchants: [] };
  const offers = mergeProductKeywordsIntoOffers(data.offers || [], productKeywordData);
  const chatbotI18n = window.CHATBOT_I18N || {};
  const tier2Rules = window.TIER2_RECOMMENDATION_RULES || {};
  const agentMemoryApi = window.AGENT_MEMORY_STATE || null;
  const TIER_MOVE_OPTIONS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"];
  const TIER_VISUAL_STATUS_COLOR_KEYS = ["visualStatusColor", "visual_status_color", "Visual Status Color", "Visual Status", "Color"];
  const TIER_VISUAL_STATUS_CODE_KEYS = ["visualStatusCode", "visual_status_code", "Visual Status Code", "Reason Code"];
  const TIER_VISUAL_STATUS_REASON_KEYS = ["visualStatusReason", "visual_status_reason", "Visual Status Reason", "Reason Text"];
  const TIER_VISUAL_STATUS_SOURCE_KEYS = ["visualStatusSource", "visual_status_source", "Visual Status Source", "Source"];
  const TIER_OVERRIDE_KEY = "offerTierOverrides";
  const TIER_COLUMN_KEY = "offerTierVisibleColumns.v4";
  // â”€â”€ è¶‹åŠ¿åˆ†æé¢æ¿å¯é€‰æŒ‡æ ‡ï¼ˆä¸ Tier Sheet æ•°å€¼æŒ‡æ ‡å¯¹é½ï¼‰â”€â”€
  // source ä¸ºæœˆåº¦æ˜ç»†æ•°æ®ï¼ˆmerchant_amazon_metricsï¼‰ä¸­çš„å­—æ®µåï¼›
  // format å†³å®šè¶‹åŠ¿è¡¨æ ¼/å¡ç‰‡/å›¾è¡¨çš„æ•°å€¼æ ¼å¼åŒ–æ–¹å¼ã€‚
  const TREND_METRIC_DEFS = [
    { key: "revenue", label: "Revenue", source: "revenue", format: "money" },
    { key: "orders", label: "Orders", source: "orders", format: "count" },
    { key: "epc", label: "EPC", source: "epc", format: "epc" },
    { key: "aov", label: "AOV", source: "aov", format: "money" },
    { key: "clicks", label: "Clicks", source: "clicks", format: "count" },
    { key: "affiliatePayout", label: "Affiliate Payout", source: "affiliatePayout", format: "money" },
    { key: "dpv", label: "DPV", source: "dpv", format: "count" },
    { key: "atc", label: "ATC", source: "atc", format: "count" },
    { key: "conversionRate", label: "Conversion Rate", source: "conversionRate", format: "pct" },
    { key: "payout", label: "Payout", source: "payout", format: "money" },
    { key: "directSales", label: "Direct Sales", source: "directSales", format: "money" },
    { key: "haloSales", label: "Halo Sales", source: "haloSales", format: "money" }
  ];
  // é»˜è®¤é€‰ä¸­ 9 ä¸ªæ ¸å¿ƒæŒ‡æ ‡ï¼ˆæœªå‹¾é€‰æ—¶çš„é¦–æ¬¡æ‰“å¼€é»˜è®¤å€¼ï¼‰
  const DEFAULT_TREND_VISIBLE_METRICS = [
    "revenue", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate"
  ];
  const TREND_COLUMN_KEY = "offerTrendVisibleColumns.v1";
  const offersByMerchantId = new Map();
  const offerGroupsByMerchantId = new Map();
  const originalOfferTiers = [];
  let tierOverrides = loadTierOverrides();
  var _trendContextData = null;
  // â”€â”€ Live chatbot data (refreshed from DB to match Tier Sheet) â”€â”€
  var _liveChatbotOffers = null;        // Array of fresh offer objects
  var _liveChatbotOffersById = null;    // Map merchantId â†’ fresh offer
  var _liveChatbotDataLoaded = false;
  var _liveChatbotDataLoading = false;
  var _liveChatbotDataPromise = null;  // so callers can await an in-progress load
  // â”€â”€
  const sheetPaymentCycles = buildSheetPaymentCycleIndex();
  offers.forEach((offer, index) => {
    originalOfferTiers[index] = offer.tier || "";
    const merchantId = String(offer.merchantId || "").trim();
    if (merchantId) {
      if (!offersByMerchantId.has(merchantId)) offersByMerchantId.set(merchantId, offer);
      if (!offerGroupsByMerchantId.has(merchantId)) offerGroupsByMerchantId.set(merchantId, []);
      offerGroupsByMerchantId.get(merchantId).push(offer);
    }
    offer.originalTier = offer.originalTier || offer.tier || "Unknown";
    applyTierOverrideToOffer(offer);
    // å­—æ®µåå…¼å®¹ï¼šDB payload ç”¨ affiliatePayoutï¼Œå‰ç«¯ä»£ç æœŸæœ› affCommission
    if (offer.affCommission === undefined && offer.affiliatePayout !== undefined) {
      offer.affCommission = offer.affiliatePayout;
    }
    offer.paymentCycle = resolveOfferPaymentCycle(offer);
    offer.region = normalizeRegion(offer.region || offer.country || inferRegionFromText(offer.brand));
  });
  const PAYMENT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ACTIVE_PAYMENT_MONTHS = ["February", "March", "April", "May", "June"];
  const MAX_RECOMMENDATION_EXPORT = 1000;
  const AUTO_PAYMENT_SYNC_KEY = "offerPaymentLastAutoSync";
  const AUTO_PAYMENT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
  const CHAT_QUESTION_SESSION_KEY = "oiChatbotQuestionSessionId.v1";
  var chatQuestionPageSessionId = "";
  var activeAnswerFeedback = null;
  var answerFeedbackContextCounter = 0;
  var answerFeedbackContexts = new Map();
  const STANDARD_CATEGORY_REPORT_TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4"];
  const REMOVED_TIER_REVENUE_HEADERS = new Set(["May", "June"].map((month) => `${month} Revenue`));
  const LIVE_TIER_METRIC_HEADERS = new Set([
    "Order count", "Revenue", "Backend EPC", "EPC(All)", "EPC(Aff)", "AOV", "Conversion", "Conversion Rate",
    "Clicks", "DPV", "ATC", "Payout", "Affiliate Payout", "ALL Commission", "AFF Commission"
  ]);
  const TIER_INTEGER_METRIC_HEADERS = new Set([
    "clicks", "total clicks", "dpv", "atc", "order count", "orders",
    "brand count", "publisher count", "publisher count june",
    "new tier entries", "tier exits"
  ]);
  const DEFAULT_TIER_VISIBLE_COLUMNS = [
    "Merchant ID",
    "Merchant Name",
    "Brand",
    "Network",
    "ALL Commission",
    "AFF Commission",
    "Category",
    "Clicks",
    "DPV",
    "ATC",
    "AOV",
    "Conversion Rate",
    "Revenue",
    "EPC(All)",
    "EPC(Aff)"
  ];
  const DEFAULT_TIER_COLUMN_ALIASES = {
    "Network": ["Network", "Agency"],
    "ALL Commission": ["ALL Commission", "Commission Rate"],
    "AFF Commission": ["AFF Commission"],
    "Conversion Rate": ["Conversion Rate", "Conversion", "CVR"],
    "EPC(All)": ["EPC(All)", "All EPC"],
    "EPC(Aff)": ["EPC(Aff)", "Aff EPC", "Backend EPC", "EPC"]
  };
  const TIER_TABLE_PAGE_SIZE = 500;
  const CATEGORY_REPORT_TIER_OPTIONS = [...STANDARD_CATEGORY_REPORT_TIERS, "BLACK TIER"];
  const TIER_SHEET_EXPANDABLE_TIERS = new Set(STANDARD_CATEGORY_REPORT_TIERS);
  const TIER_SHEET_MOVE_TARGETS = CATEGORY_REPORT_TIER_OPTIONS.slice();
  const TIER_SHEET_MOVE_STORAGE_KEY = "offerTierSheetManualMoves.v1";
  const TIER_SHARED_MOVES_API = "/api/tier_moves";
  const TIER_MOVE_ADMIN_TOKEN_KEY = "offerTierMoveAdminToken";
  const CATEGORY_REPORT_ADDITIVE_SORTS = new Set(["merchantCount", "revenue", "orders", "clicks"]);
  const TARGET_OVERRIDES_KEY = "offerTargetTextOverrides.v1";
  const TARGET_TIER_ORDER = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Black Tier", "BLACK TIER"];
  const TARGET_METRICS = [
    { key: "revenue", label: "Revenue" },
    { key: "orders", label: "Orders" },
    { key: "clicks", label: "Clicks" },
    { key: "conversion", label: "Avg Conversion" },
    { key: "brands", label: "Active Brands" }
  ];
  const TARGET_TREND_VIEWS = [
    { key: "month", label: "Monthly report" },
    { key: "day", label: "Daily report" }
  ];
  const REPORT_OVERVIEW_MONTH_OFFSETS = [-2, -1, 0];
  const REPORT_OVERVIEW_REQUIRED_MONTH_KEYS = ["2026-05", "2026-06"];
  const TARGET_PROGRESS_DEFINITIONS = [
    { tier: "Tier 1", type: "gmv", label: "GMV target" },
    { tier: "Tier 2", type: "commission", label: "Commission target" },
    { tier: "Tier 3", type: "removal", label: "Merchant removal target" },
    { tier: "Tier 4", type: "removal", label: "Merchant removal target" }
  ];
  const TARGET_MONTH_PRESETS = {
    "2026-06": {
      "Tier 1": {
        target: "Revenue Target: $500K+",
        actuals: { brandCount: 42, clicks: 75460, orders: 47854, revenue: 655419.44, payout: 106170.6, conversion: 0.634164 }
      },
      "Tier 2": {
        target: "Revenue Target:$800K+; Brand Target: 60+",
        actuals: { brandCount: 52, clicks: 368157, orders: 130672, revenue: 1163175.35, payout: 196701.35, conversion: 0.354936 }
      },
      "Tier 3": {
        target: "Revenue Target:$250K+; Brand Target: Promote 10 Brands to Tier 2",
        actuals: { brandCount: 370, clicks: 108203, orders: 68965, revenue: 578972.2, payout: 77950.96, conversion: 0.637367, tierExits: 140 }
      },
      "Tier 4": {
        target: "Brand Target: Promote 30 Brands to Tier 3",
        actuals: { brandCount: 5807, clicks: 8513, orders: 4337, revenue: 6415.42, payout: 1011.87, conversion: 0.509456, tierExits: 212 }
      },
      "BLACK TIER": {
        target: "",
        actuals: { brandCount: 8, clicks: 9298, orders: 4305, revenue: 21843.58, payout: 2102.77, conversion: 0.463003 }
      },
      Total: {
        target: "",
        actuals: { brandCount: 6279, clicks: 569631, orders: 256133, revenue: 2425825.99, payout: 383937.55, conversion: 0.449647 }
      }
    }
  };
  const DB_STATUS_UI_API = "/api/ui/db/status";
  const DB_MERCHANT_UI_API = "/api/ui/db/merchant";
  const DB_SEARCH_UI_API = "/api/ui/db/search";
  const DB_TIER_SUMMARY_API = "/api/ui/db/tier-summary";
  const DB_TIER_SHEET_UI_API = "/api/ui/db/tier_sheet";
  const DB_TIER1_MERCHANTS_UI_API = "/api/ui/db/tier1-merchants";
  const DB_CHATBOT_OFFERS_UI_API = "/api/ui/db/chatbot-offers";
  const DB_MONTHLY_NEW_MERCHANTS_UI_API = "/api/ui/db/monthly-new-merchants";
  const DB_OFFERS_UI_API = "/api/ui/db/offers";
  const DB_STATUS_AUTO_REFRESH_MS = 5 * 60 * 1000;
  const PAYMENT_TODAY = new Date(`${localDateKey(new Date())}T00:00:00`);
  const DEFAULT_TIER_REPORT_END_DATE = localDateKey(new Date());
  const DEFAULT_TIER_REPORT_START_DATE = `${DEFAULT_TIER_REPORT_END_DATE.slice(0, 7)}-01`;
  const originalTierSheetRows = new Map();
  const originalTierSheetRowIndex = new Map();
  const dbMerchantCache = new Map();
  const dbMerchantLoading = new Set();
  const dbSearchCache = new Map();
  const dbSearchLoading = new Set();
  let dashboardCategorySearchOptions = new Map();
  let paymentRecords = visiblePaymentRecords(withPendingPaymentPlaceholders((data.paymentRecords || []).map(normalizePaymentRecord)));
  const paymentRecordsByMerchant = new Map();
  rebuildPaymentIndex();

  const OFFER_TRACKER_RULES_KEY = "offerListTrackerRulesV1";
  const OFFER_TRACKER_COLUMNS_KEY = "offerListTrackerColumnsV1";
  const OFFER_TRACKER_SAVED_VIEWS_KEY = "offerListTrackerSavedViewsV1";
  const OFFER_TRACKER_EXPORT_TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"];
  const OFFER_TRACKER_EXPORT_COLORS = ["#D6EEDD", "#CCFFFF", "#FFF2CC", "#FCE4D6", "#E4DFEC"];
  const DEFAULT_OFFER_TRACKER_RULES = Object.freeze({ highScore: 8, lowAovMax: 100 });
  const OFFER_TRACKER_BB_POLICY_BRANDS = Object.freeze({
    mind: Object.freeze([
      "ulike", "Aiper", "Neakasa", "Speediance", "WOLFBOX", "REDTIGER", "Beatbot",
      "Mammotion", "3W", "Gosovr", "WORX", "True classic", "VITURE",
      "TP-Link", "Sublue"
    ]),
    open: Object.freeze([
      "Merach", "Heyzoo", "Ottocast", "Rockbros", "Chebio", "Tabwee", "Shaperx", "Bluewood",
      "Featol", "AOCHUAN", "Edifier", "GaiaLoop", "Tagry", "Hisense", "Shokz", "Gyroor",
      "DJI", "Level8", "Bassbloom", "Derila", "Akusoli", "Matsato", "Nuubu", "Synoshi",
      "Enence", "Kinzeno"
    ])
  });
  const OFFER_TRACKER_BB_POLICY_KEYS = Object.freeze({
    mind: new Set(OFFER_TRACKER_BB_POLICY_BRANDS.mind.map(normalize)),
    open: new Set(OFFER_TRACKER_BB_POLICY_BRANDS.open.map(normalize))
  });
  const DEFAULT_OFFER_TRACKER_COLUMNS = Object.freeze({
    tier: true,
    commission: true,
    aov: true,
    revenue: true,
    bbPolicy: true,
    category: true,
    asins: true,
    recommendation: true
  });

  function offerTrackerDateOrdinal(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const [year, month, day] = text.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return Math.floor(date.getTime() / 86400000);
  }

  function offerTrackerDateRange(startDate = "", endDate = "") {
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    const startOrdinal = offerTrackerDateOrdinal(start);
    const endOrdinal = offerTrackerDateOrdinal(end);
    if (startOrdinal === null || endOrdinal === null) return { ok: false, reason: "invalid" };
    if (startOrdinal > endOrdinal) return { ok: false, reason: "order" };
    const dayCount = endOrdinal - startOrdinal + 1;
    if (dayCount > 366) return { ok: false, reason: "length", dayCount };
    return { ok: true, startDate: start, endDate: end, dayCount };
  }

  function offerTrackerDefaultDateRange(payload = data) {
    const explicit = offerTrackerDateRange(payload.startDate, payload.endDate);
    if (explicit.ok) return { startDate: explicit.startDate, endDate: explicit.endDate };
    const sources = payload.sources || {};
    const month = String(payload.month || sources.month || (payload.summary && payload.summary.month) || "").trim();
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      const [year, monthNumber] = month.split("-").map(Number);
      const lastDay = new Date(Date.UTC(year, monthNumber, 0));
      return {
        startDate: `${month}-01`,
        endDate: `${month}-${String(lastDay.getUTCDate()).padStart(2, "0")}`
      };
    }
    const today = localDateKey(new Date()) || "1970-01-01";
    return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
  }

  function offerTrackerRangeKey(startDate, endDate) {
    return `${String(startDate || "").trim()}|${String(endDate || "").trim()}`;
  }

  function offerTrackerRangeLabel(startDate, endDate) {
    return `${startDate} ${offerTrackerText("â€“", "è‡³")} ${endDate}`;
  }

  const OFFER_TRACKER_DEFAULT_DATE_RANGE = offerTrackerDefaultDateRange(data);
  const OFFER_TRACKER_DEFAULT_RANGE_KEY = offerTrackerRangeKey(
    OFFER_TRACKER_DEFAULT_DATE_RANGE.startDate,
    OFFER_TRACKER_DEFAULT_DATE_RANGE.endDate
  );

  const state = {
    page: "agent",
    tier: "all",
    network: "all",
    category: "all",
    minEpc: "",
    minAov: "",
    minCvr: "",
    notPaidOnly: false,
    sort: "epc",
    descending: true,
    categoryReportTiers: STANDARD_CATEGORY_REPORT_TIERS.slice(),
    categoryReportSearch: "",
    categoryReportSearchDraft: "",
    categoryReportSelection: null,
    categoryReportSort: "revenue",
    categoryReportDirection: "desc",
    categoryReportFocusKey: "",
    expandedCategoryKey: null,
    lastOffer: null,
    lastRows: [],
    currentQuery: "",
    llmClassifyResult: null,
    llmParams: null,
    currentContext: { type: "default", items: [], summary: {}, filters: {} },
    payments: {
      month: "all",
      network: "all",
      region: "all",
      tier: "all",
      status: "all",
      search: ""
    },
    paymentSort: {
      key: "",
      direction: "asc"
    },
    selectedTierPage: "Tier 1",
    expandedTierSheet: false,
    selectedTierRowKeys: new Set(),
    visibleTierRowKeys: [],
    tierTablePages: { "Tier 4": 1 },
    manualTierMoves: loadManualTierMoves(),
    sharedTierMovesConfigured: false,
    sharedTierMovesLoading: false,
    tierMoveTarget: "",
    tierMoveStatus: "",
    tier1Management: {
      additions: [],
      additionsLoaded: false,
      additionsLoading: false,
      additionsError: "",
      panelOpen: false,
      query: "",
      results: [],
      selectedMerchant: null,
      searchLoading: false,
      submitting: false,
      searchSequence: 0,
      additionsRestoreFocus: null,
      restoreFocus: null
    },
    monthlyNewMerchants: {
      month: localDateKey(new Date()).slice(0, 7),
      records: [],
      loadedMonth: "",
      loadSequence: 0,
      loading: false,
      error: "",
      notice: "",
      noticeType: "success",
      search: "",
      drawerOpen: false,
      editingRecordId: null,
      submitting: false,
      restoreFocus: null,
      importOpen: false,
      importing: false,
      importRows: [],
      importFileName: "",
      importRestoreFocus: null
    },
    offerListTracker: {
      draftFilters: {
        tiers: [],
        categories: [],
        startDate: OFFER_TRACKER_DEFAULT_DATE_RANGE.startDate,
        endDate: OFFER_TRACKER_DEFAULT_DATE_RANGE.endDate,
        minAov: "",
        maxAov: "",
        minCommission: "",
        maxCommission: "",
        networks: [],
        bbPolicy: "all",
        revenueStatus: "all",
        revenueSort: "priority"
      },
      filters: {
        tiers: [],
        categories: [],
        startDate: OFFER_TRACKER_DEFAULT_DATE_RANGE.startDate,
        endDate: OFFER_TRACKER_DEFAULT_DATE_RANGE.endDate,
        minAov: "",
        maxAov: "",
        minCommission: "",
        maxCommission: "",
        networks: [],
        bbPolicy: "all",
        revenueStatus: "all",
        revenueSort: "priority"
      },
      defaultDateRange: { ...OFFER_TRACKER_DEFAULT_DATE_RANGE },
      sourceRows: offers,
      sourceRangeKey: OFFER_TRACKER_DEFAULT_RANGE_KEY,
      sourceRowsByRange: new Map([[OFFER_TRACKER_DEFAULT_RANGE_KEY, offers]]),
      loading: false,
      requestSequence: 0,
      search: "",
      view: "offers",
      page: 1,
      pageSize: 25,
      selectedKeys: new Set(),
      visibleColumns: loadOfferTrackerVisibleColumns(),
      rules: loadOfferTrackerRules(),
      savedViews: loadOfferTrackerSavedViews(),
      exportDialogOpen: false,
      exportSelectedOnly: false,
      exportSourceRows: [],
      exportTierQuantities: {},
      exportBackgroundRanges: [],
      exportRangeSequence: 0,
      exportRestoreFocus: null,
      controlsReady: false,
      animated: false,
      renderedRows: [],
      renderedSelectedCount: 0
    },
    tierSheetFilters: {
      search: "",
      network: "all",
      country: "all",
      minEpc: "",
      minRevenue: ""
    },
    tierReport: {
      startDate: DEFAULT_TIER_REPORT_START_DATE,
      endDate: DEFAULT_TIER_REPORT_END_DATE,
      payloads: new Map(),
      activeKeys: new Map(),
      loadingKeys: new Set(),
      errors: new Map()
    },
    tierColumnPanelOpen: false,
    tierVisibleColumns: loadTierVisibleColumns(),
    trendVisibleColumns: loadTrendVisibleMetrics(),
    targetFilters: {
      month: "",
      compareMonth: "",
      tier: "all"
    },
    targetMetric: "revenue",
    targetTrendView: "month",
    publisherMarket: "all",
    publisherNetwork: "all",
    publisherLinkType: "all",
    publisherMerchantSearch: "",
    publisherMerchantSelectedId: "",
    publisherProductSearch: "",
    publisherManagerSearch: "",
    publisherSiteSearch: "",
    publisherTrackSearch: "",
    publisherSelectedId: "",
    publisherPortfolioSearch: "",
    publisherPortfolioCategory: "all",
    publisherPortfolioTier: "all",
    publisherPortfolioSort: "sales",
    publisherChartMetric: "clicks",
    publisherStartDate: "",
    publisherEndDate: "",
    publisherSort: { key: "", direction: "desc" },
    publisherTablePage: 1,
    publisherOverviewFocus: "",
    publisherOverviewExpanded: true,
    publisherChartExpanded: true,
    publisherLayoutEditing: false,
    publisherLayout: _loadPublisherLayout(),
    publisherOverviewType: "network",
    brandMedia: {
      merchantId: "",
      merchantName: "",
      merchantSearch: "",
      managerFilter: "",
      lockedPublisherKeys: [],
      chartExpanded: false,
      startDate: "",
      endDate: "",
      quickRange: "90",
      catalogLoading: false,
      catalogError: "",
      loading: false,
      error: "",
      payload: null,
      requestKey: "",
      requestSequence: 0
    },
    revenueFlow: {
      merchantId: "",
      merchantName: "",
      merchantSearch: "",
      merchantIds: [],
      merchants: [],
      chartExpanded: false,
      startDate: "",
      endDate: "",
      quickRange: "90",
      catalogLoading: false,
      catalogError: "",
      loading: false,
      error: "",
      payload: null,
      requestKey: "",
      requestSequence: 0
    },
    googleAds: {
      userId: "19",
      startDate: "",
      endDate: "",
      quickRange: "60",
      loading: false,
      error: "",
      payload: null,
      requestKey: "",
      requestSequence: 0
    },
    targetOverrides: loadTargetOverrides(),
    targetEditingKey: "",
    targetSort: {
      key: "Tier",
      direction: "asc"
    },
    dbStatus: {
      data: null,
      loading: false,
      error: "",
      monthKey: ""
    },
    dbTierSummary: {
      data: null,
      loading: false,
      monthKey: "",
      error: ""
    },
    tierSheetSort: {
      key: "",
      direction: "asc"
    },
    paymentSource: "saved invoice file",
    livePaymentsLoaded: false,
    livePaymentsLoading: false,
    activeRecommendationBundle: null,
    excludedRecommendationKeys: new Set(),
    recommendationDownloads: {},
    downloadSequence: 0,
    navigationOpenGroup: "workspace",
    language: localStorage.getItem("offerLanguage") === "en" ? "en" : "zh",
    deepMode: true,
    deepReport: null,
    deepHistory: [],
    chatHistory: [],
    agentPage: {
      history: [],
      memory: agentMemoryApi ? agentMemoryApi.load(localStorage) : null,
      submitting: false,
      abortController: null
    },
    reportMemory: [],
    reportMemoryContext: null,
    chatIntentOverride: null
  };

  const llmClassifyCache = new Map();

  const els = {
    primarySidebar: document.getElementById("primarySidebar"),
    workspace: document.querySelector(".workspace"),
    mobileShellBar: document.getElementById("mobileShellBar"),
    mobileNavToggle: document.getElementById("mobileNavToggle"),
    mobileNavClose: document.getElementById("mobileNavClose"),
    navDrawerBackdrop: document.getElementById("navDrawerBackdrop"),
    mobileCurrentPage: document.getElementById("mobileCurrentPage"),
    dashboardNav: document.getElementById("dashboardNav"),
    dashboardSubnav: document.getElementById("dashboardSubnav"),
    chatbotNav: document.getElementById("chatbotNav"),
    agentNav: document.getElementById("agentNav"),
    paymentsNav: document.getElementById("paymentsNav"),
    sheetsNav: document.getElementById("sheetsNav"),
    targetNav: document.getElementById("targetNav"),
    offerListTrackerNav: document.getElementById("offerListTrackerNav"),
    reportsSubnav: document.getElementById("reportsSubnav"),
    categoryNav: document.getElementById("categoryNav"),
    monthlyNewMerchantsNav: document.getElementById("monthlyNewMerchantsNav"),
    tier: document.getElementById("tierFilter"),
    network: document.getElementById("networkFilter"),
    category: document.getElementById("categoryFilter"),
    minEpc: document.getElementById("minEpc"),
    minAov: document.getElementById("minAov"),
    minCvr: document.getElementById("minCvr"),
    notPaidOnly: document.getElementById("notPaidOnly"),
    reset: document.getElementById("resetFilters"),
    metrics: document.getElementById("metrics"),
    dashboardCategoryTierPicker: document.getElementById("dashboardCategoryTierPicker"),
    dashboardCategoryReportSubtitle: document.getElementById("dashboardCategoryReportSubtitle"),
    dashboardCategoryReportBody: document.getElementById("dashboardCategoryReportBody"),
    dashboardCategorySearch: document.getElementById("dashboardCategorySearch"),
    dashboardCategoryOptions: document.getElementById("dashboardCategoryOptions"),
    dashboardCategorySearchStatus: document.getElementById("dashboardCategorySearchStatus"),
    categoryStartDate: document.getElementById("categoryStartDate"),
    categoryEndDate: document.getElementById("categoryEndDate"),
    categoryDateApply: document.getElementById("categoryDateApply"),
    categoryDateStatus: document.getElementById("categoryDateStatus"),
    table: document.getElementById("offerRows"),
    tableCount: document.getElementById("tableCount"),
    chatLog: document.getElementById("chatLog"),
    chatLogChat: document.getElementById("chatLogChat"),
    dashboardAgentPage: document.getElementById("dashboardAgentPage"),
    agentChatLog: document.getElementById("agentChatLog"),
    agentChatForm: document.getElementById("agentChatForm"),
    agentChatInput: document.getElementById("agentChatInput"),
    agentChatSubmit: document.getElementById("agentChatSubmit"),
    agentNewConversation: document.getElementById("agentNewConversation"),
    agentStopConversation: document.getElementById("agentStopConversation"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatInputCommandOverlay: document.getElementById("chatInputCommandOverlay"),
    chatIntentMenu: document.getElementById("chatIntentMenu"),
    chatIntentMenuTrack: document.getElementById("chatIntentMenuTrack"),
    reportHelpBtn: document.getElementById("reportHelpBtn"),
    userFlowGuideBtn: document.getElementById("userFlowGuideBtn"),
    chatLogsButton: document.getElementById("chatLogsButton"),
    chatLogsMenu: document.getElementById("chatLogsMenu"),
    answerFeedbackDialog: document.getElementById("answerFeedbackDialog"),
    answerFeedbackForm: document.getElementById("answerFeedbackForm"),
    answerFeedbackDetail: document.getElementById("answerFeedbackDetail"),
    answerFeedbackError: document.getElementById("answerFeedbackError"),
    answerFeedbackCancel: document.getElementById("answerFeedbackCancel"),
    answerFeedbackClose: document.getElementById("answerFeedbackClose"),
    answerFeedbackSubmit: document.getElementById("answerFeedbackSubmit"),
    reportHelpPanel: document.getElementById("reportHelpPanel"),
    reportHelpContent: document.getElementById("reportHelpContent"),
    reportHelpLangBtn: document.getElementById("reportHelpLangBtn"),
    userFlowGuidePanel: document.getElementById("userFlowGuidePanel"),
    userFlowGuideContent: document.getElementById("userFlowGuideContent"),
    userFlowGuideStatus: document.getElementById("userFlowGuideStatus"),
    userFlowImageLightbox: document.getElementById("userFlowImageLightbox"),
    userFlowImageLightboxClose: document.getElementById("userFlowImageLightboxClose"),
    userFlowImageLightboxImage: document.getElementById("userFlowImageLightboxImage"),
    userFlowImageLightboxCaption: document.getElementById("userFlowImageLightboxCaption"),
    quickActions: document.getElementById("quickActions"),
    recBox: document.getElementById("recommendationBox"),
    stamp: document.getElementById("datasetStamp"),
    download: document.getElementById("downloadCsv"),
    paymentDownload: document.getElementById("downloadPaymentsXlsx"),
    paymentHead: document.getElementById("paymentTableHead"),
    sheetDownload: document.getElementById("downloadSheetXlsx"),
    tierDownload: document.getElementById("downloadTierXlsx"),
    contextTitle: document.getElementById("contextTitle"),
    contextSubtitle: document.getElementById("contextSubtitle"),
    paymentsPage: document.getElementById("paymentsPage"),
    publishersNav: document.getElementById("publishersNav"),
    publishersPage: document.getElementById("publishersPage"),
    brandMediaNav: document.getElementById("brandMediaNav"),
    brandMediaPage: document.getElementById("brandMediaPage"),
    brandMediaMerchantSearch: document.getElementById("brandMediaMerchantSearch"),
    brandMediaMerchantDropdown: document.getElementById("brandMediaMerchantDropdown"),
    brandMediaManagerFilter: document.getElementById("brandMediaManagerFilter"),
    brandMediaRangeButtons: document.getElementById("brandMediaRangeButtons"),
    brandMediaStartDate: document.getElementById("brandMediaStartDate"),
    brandMediaEndDate: document.getElementById("brandMediaEndDate"),
    brandMediaStatus: document.getElementById("brandMediaStatus"),
    brandMediaKpis: document.getElementById("brandMediaKpis"),
    brandMediaChartPanel: document.getElementById("brandMediaChartPanel"),
    brandMediaChart: document.getElementById("brandMediaChart"),
    brandMediaChartExpand: document.getElementById("brandMediaChartExpand"),
    brandMediaChartSubtitle: document.getElementById("brandMediaChartSubtitle"),
    brandMediaTotalKey: document.getElementById("brandMediaTotalKey"),
    brandMediaLineCount: document.getElementById("brandMediaLineCount"),
    brandMediaLegend: document.getElementById("brandMediaLegend"),
    brandMediaClicksPanel: document.getElementById("brandMediaClicksPanel"),
    brandMediaClickChart: document.getElementById("brandMediaClickChart"),
    brandMediaClickChartCount: document.getElementById("brandMediaClickChartCount"),
    brandMediaTableRows: document.getElementById("brandMediaTableRows"),
    brandMediaTableCount: document.getElementById("brandMediaTableCount"),
    revenueFlowNav: document.getElementById("revenueFlowNav"),
    revenueFlowPage: document.getElementById("revenueFlowPage"),
    revenueFlowMerchantSearch: document.getElementById("revenueFlowMerchantSearch"),
    revenueFlowMerchantDropdown: document.getElementById("revenueFlowMerchantDropdown"),
    revenueFlowSelectedBrands: document.getElementById("revenueFlowSelectedBrands"),
    revenueFlowRangeButtons: document.getElementById("revenueFlowRangeButtons"),
    revenueFlowStartDate: document.getElementById("revenueFlowStartDate"),
    revenueFlowEndDate: document.getElementById("revenueFlowEndDate"),
    revenueFlowStatus: document.getElementById("revenueFlowStatus"),
    revenueFlowKpis: document.getElementById("revenueFlowKpis"),
    revenueFlowPanel: document.getElementById("revenueFlowPanel"),
    revenueFlowChart: document.getElementById("revenueFlowChart"),
    revenueFlowChartExpand: document.getElementById("revenueFlowChartExpand"),
    revenueFlowCount: document.getElementById("revenueFlowCount"),
    googleAdsNav: document.getElementById("googleAdsNav"),
    googleAdsPage: document.getElementById("googleAdsPage"),
    googleAdsIdentity: document.getElementById("googleAdsIdentity"),
    googleAdsAccountName: document.getElementById("googleAdsAccountName"),
    googleAdsAccountMeta: document.getElementById("googleAdsAccountMeta"),
    googleAdsRangeButtons: document.getElementById("googleAdsRangeButtons"),
    googleAdsStartDate: document.getElementById("googleAdsStartDate"),
    googleAdsEndDate: document.getElementById("googleAdsEndDate"),
    googleAdsRefresh: document.getElementById("googleAdsRefresh"),
    googleAdsStatus: document.getElementById("googleAdsStatus"),
    googleAdsKpis: document.getElementById("googleAdsKpis"),
    googleAdsChart: document.getElementById("googleAdsChart"),
    googleAdsMerchantRows: document.getElementById("googleAdsMerchantRows"),
    googleAdsMerchantCount: document.getElementById("googleAdsMerchantCount"),
    googleAdsUnmatchedList: document.getElementById("googleAdsUnmatchedList"),
    googleAdsMethod: document.getElementById("googleAdsMethod"),
    publisherSelectorSearch: document.getElementById("publisherSelectorSearch"),
    publisherSelectorDropdown: document.getElementById("publisherSelectorDropdown"),
    publisherStartDate: document.getElementById("publisherStartDate"),
    publisherEndDate: document.getElementById("publisherEndDate"),
    publisherMarketFilter: document.getElementById("publisherMarketFilter"),
    publisherNetworkFilter: document.getElementById("publisherNetworkFilter"),
    publisherLinkTypeFilter: document.getElementById("publisherLinkTypeFilter"),
    publisherMerchantSearch: document.getElementById("publisherMerchantSearch"),
    publisherMerchantDropdown: document.getElementById("publisherMerchantDropdown"),
    publisherProductSearch: document.getElementById("publisherProductSearch"),
    publisherManagerSearch: document.getElementById("publisherManagerSearch"),
    publisherSiteSearch: document.getElementById("publisherSiteSearch"),
    publisherTrackSearch: document.getElementById("publisherTrackSearch"),
    publisherSearchBtn: document.getElementById("publisherSearchBtn"),
    publisherResetBtn: document.getElementById("publisherResetBtn"),
    publisherExportBtn: document.getElementById("publisherExportBtn"),
    publisherMarketSummary: document.getElementById("publishersMarketSummary"),
    publisherMarketPie: document.getElementById("publishersMarketPie"),
    publisherMarketCards: document.getElementById("publishersMarketCards"),
    publisherMarketBody: document.getElementById("publishersMarketBody"),
    publishersKpiRow: document.getElementById("publishersKpiRow"),
    publishersChartPanel: document.getElementById("publishersChartPanel"),
    publishersChart: document.getElementById("publishersChart"),
    publishersChartTitle: document.getElementById("publishersChartTitle"),
    publishersChartChevron: document.getElementById("publishersChartChevron"),
    publishersTableHead: document.getElementById("publishersTableHead"),
    publishersTableRows: document.getElementById("publishersTableRows"),
    publishersTableCount: document.getElementById("publishersTableCount"),
    publisherPagination: document.getElementById("publisherPagination"),
    publisherPagePrev: document.getElementById("publisherPagePrev"),
    publisherPageNext: document.getElementById("publisherPageNext"),
    publisherPageIndicator: document.getElementById("publisherPageIndicator"),
    publisherLayoutBtn: document.getElementById("publisherLayoutBtn"),
    publisherLayoutToolbar: document.getElementById("publisherLayoutToolbar"),
    publisherLayoutSave: document.getElementById("publisherLayoutSave"),
    publisherLayoutCancel: document.getElementById("publisherLayoutCancel"),
    publisherLayoutReset: document.getElementById("publisherLayoutReset"),
    publisherAffinityPanel: document.getElementById("publisherAffinityPanel"),
    publisherAffinityEmpty: document.getElementById("publisherAffinityEmpty"),
    publisherAffinityContent: document.getElementById("publisherAffinityContent"),
    publisherAffinityAvatar: document.getElementById("publisherAffinityAvatar"),
    publisherAffinityName: document.getElementById("publisherAffinityName"),
    publisherAffinityMeta: document.getElementById("publisherAffinityMeta"),
    publisherAffinityStatus: document.getElementById("publisherAffinityStatus"),
    publisherAffinityMetrics: document.getElementById("publisherAffinityMetrics"),
    publisherCategoryAffinity: document.getElementById("publisherCategoryAffinity"),
    publisherAffinitySignals: document.getElementById("publisherAffinitySignals"),
    publisherClearSelection: document.getElementById("publisherClearSelection"),
    publisherPortfolioSearch: document.getElementById("publisherPortfolioSearch"),
    publisherPortfolioCategory: document.getElementById("publisherPortfolioCategory"),
    publisherPortfolioTier: document.getElementById("publisherPortfolioTier"),
    publisherPortfolioSort: document.getElementById("publisherPortfolioSort"),
    publisherPortfolioCount: document.getElementById("publisherPortfolioCount"),
    publisherPortfolioRows: document.getElementById("publisherPortfolioRows"),
    publishersTablePanel: document.getElementById("publishersTablePanel"),
    monthlyNewMerchantsPage: document.getElementById("monthlyNewMerchantsPage"),
    offerListTrackerPage: document.getElementById("offerListTrackerPage"),
    offerTrackerSavedViewsToggle: document.getElementById("offerTrackerSavedViewsToggle"),
    offerTrackerSavedViewsPanel: document.getElementById("offerTrackerSavedViewsPanel"),
    offerTrackerSavedViewsList: document.getElementById("offerTrackerSavedViewsList"),
    offerTrackerSavedViewName: document.getElementById("offerTrackerSavedViewName"),
    offerTrackerSaveView: document.getElementById("offerTrackerSaveView"),
    offerTrackerExport: document.getElementById("offerTrackerExport"),
    offerTrackerTier: document.getElementById("offerTrackerTier"),
    offerTrackerTierToggle: document.getElementById("offerTrackerTierToggle"),
    offerTrackerTierSummary: document.getElementById("offerTrackerTierSummary"),
    offerTrackerTierMenu: document.getElementById("offerTrackerTierMenu"),
    offerTrackerCategory: document.getElementById("offerTrackerCategory"),
    offerTrackerCategoryToggle: document.getElementById("offerTrackerCategoryToggle"),
    offerTrackerCategorySummary: document.getElementById("offerTrackerCategorySummary"),
    offerTrackerCategoryMenu: document.getElementById("offerTrackerCategoryMenu"),
    offerTrackerStartDate: document.getElementById("offerTrackerStartDate"),
    offerTrackerEndDate: document.getElementById("offerTrackerEndDate"),
    offerTrackerDateStatus: document.getElementById("offerTrackerDateStatus"),
    offerTrackerMinAov: document.getElementById("offerTrackerMinAov"),
    offerTrackerMaxAov: document.getElementById("offerTrackerMaxAov"),
    offerTrackerMinCommission: document.getElementById("offerTrackerMinCommission"),
    offerTrackerMaxCommission: document.getElementById("offerTrackerMaxCommission"),
    offerTrackerNetwork: document.getElementById("offerTrackerNetwork"),
    offerTrackerNetworkToggle: document.getElementById("offerTrackerNetworkToggle"),
    offerTrackerNetworkSummary: document.getElementById("offerTrackerNetworkSummary"),
    offerTrackerNetworkMenu: document.getElementById("offerTrackerNetworkMenu"),
    offerTrackerBbPolicy: document.getElementById("offerTrackerBbPolicy"),
    offerTrackerRevenueStatus: document.getElementById("offerTrackerRevenueStatus"),
    offerTrackerRevenueSort: document.getElementById("offerTrackerRevenueSort"),
    offerTrackerFilterChips: document.getElementById("offerTrackerFilterChips"),
    offerTrackerResetFilters: document.getElementById("offerTrackerResetFilters"),
    offerTrackerApplyFilters: document.getElementById("offerTrackerApplyFilters"),
    offerTrackerKpis: document.getElementById("offerTrackerKpis"),
    offerTrackerOffersTab: document.getElementById("offerTrackerOffersTab"),
    offerTrackerProductsTab: document.getElementById("offerTrackerProductsTab"),
    offerTrackerSearch: document.getElementById("offerTrackerSearch"),
    offerTrackerColumnsToggle: document.getElementById("offerTrackerColumnsToggle"),
    offerTrackerColumnsPanel: document.getElementById("offerTrackerColumnsPanel"),
    offerTrackerRulesToggle: document.getElementById("offerTrackerRulesToggle"),
    offerTrackerRulesPanel: document.getElementById("offerTrackerRulesPanel"),
    offerTrackerScoreLegend: document.getElementById("offerTrackerScoreLegend"),
    offerTrackerHighScore: document.getElementById("offerTrackerHighScore"),
    offerTrackerLowAovMax: document.getElementById("offerTrackerLowAovMax"),
    offerTrackerResetRules: document.getElementById("offerTrackerResetRules"),
    offerTrackerSaveRules: document.getElementById("offerTrackerSaveRules"),
    offerTrackerTableHead: document.getElementById("offerTrackerTableHead"),
    offerTrackerTableRows: document.getElementById("offerTrackerTableRows"),
    offerTrackerTableCount: document.getElementById("offerTrackerTableCount"),
    offerTrackerPagePrev: document.getElementById("offerTrackerPagePrev"),
    offerTrackerPageNext: document.getElementById("offerTrackerPageNext"),
    offerTrackerPageIndicator: document.getElementById("offerTrackerPageIndicator"),
    offerTrackerExportSelected: document.getElementById("offerTrackerExportSelected"),
    offerTrackerSelectedCount: document.getElementById("offerTrackerSelectedCount"),
    offerTrackerSelectAllFiltered: document.getElementById("offerTrackerSelectAllFiltered"),
    offerTrackerSelectAllFilteredLabel: document.getElementById("offerTrackerSelectAllFilteredLabel"),
    offerTrackerSelectAllFilteredCount: document.getElementById("offerTrackerSelectAllFilteredCount"),
    offerTrackerNotice: document.getElementById("offerTrackerNotice"),
    offerTrackerExportDialog: document.getElementById("offerTrackerExportDialog"),
    offerTrackerExportDialogClose: document.getElementById("offerTrackerExportDialogClose"),
    offerTrackerExportScope: document.getElementById("offerTrackerExportScope"),
    offerTrackerExportTiers: document.getElementById("offerTrackerExportTiers"),
    offerTrackerExportRowsPreview: document.getElementById("offerTrackerExportRowsPreview"),
    offerTrackerBackgroundRanges: document.getElementById("offerTrackerBackgroundRanges"),
    offerTrackerAddBackgroundRange: document.getElementById("offerTrackerAddBackgroundRange"),
    offerTrackerExportDialogNotice: document.getElementById("offerTrackerExportDialogNotice"),
    offerTrackerExportDialogCancel: document.getElementById("offerTrackerExportDialogCancel"),
    offerTrackerExportDialogSubmit: document.getElementById("offerTrackerExportDialogSubmit"),
    monthlyNewMerchantsMonth: document.getElementById("monthlyNewMerchantsMonth"),
    monthlyNewMerchantImport: document.getElementById("monthlyNewMerchantImport"),
    monthlyNewMerchantAdd: document.getElementById("monthlyNewMerchantAdd"),
    monthlyNewMerchantsNotice: document.getElementById("monthlyNewMerchantsNotice"),
    monthlyNewMerchantsSearch: document.getElementById("monthlyNewMerchantsSearch"),
    monthlyNewMerchantsCount: document.getElementById("monthlyNewMerchantsCount"),
    monthlyNewMerchantsRows: document.getElementById("monthlyNewMerchantsRows"),
    monthlyNewMerchantDrawerBackdrop: document.getElementById("monthlyNewMerchantDrawerBackdrop"),
    monthlyNewMerchantDrawer: document.getElementById("monthlyNewMerchantDrawer"),
    monthlyNewMerchantDrawerTitle: document.getElementById("monthlyNewMerchantDrawerTitle"),
    monthlyNewMerchantDrawerClose: document.getElementById("monthlyNewMerchantDrawerClose"),
    monthlyNewMerchantForm: document.getElementById("monthlyNewMerchantForm"),
    monthlyNewMerchantRecordId: document.getElementById("monthlyNewMerchantRecordId"),
    monthlyNewMerchantReportMonth: document.getElementById("monthlyNewMerchantReportMonth"),
    monthlyNewMerchantId: document.getElementById("monthlyNewMerchantId"),
    monthlyNewMerchantName: document.getElementById("monthlyNewMerchantName"),
    monthlyNewMerchantManager: document.getElementById("monthlyNewMerchantManager"),
    monthlyNewMerchantProgram: document.getElementById("monthlyNewMerchantProgram"),
    monthlyNewMerchantPlatform: document.getElementById("monthlyNewMerchantPlatform"),
    monthlyNewMerchantGmvRequirement: document.getElementById("monthlyNewMerchantGmvRequirement"),
    monthlyNewMerchantPastMonthPurchase: document.getElementById("monthlyNewMerchantPastMonthPurchase"),
    monthlyNewMerchantIndependentWebsites: document.getElementById("monthlyNewMerchantIndependentWebsites"),
    monthlyNewMerchantReviewSummary: document.getElementById("monthlyNewMerchantReviewSummary"),
    monthlyNewMerchantOurCommission: document.getElementById("monthlyNewMerchantOurCommission"),
    monthlyNewMerchantPresetCommission: document.getElementById("monthlyNewMerchantPresetCommission"),
    monthlyNewMerchantPriority: document.getElementById("monthlyNewMerchantPriority"),
    monthlyNewMerchantGmvTarget: document.getElementById("monthlyNewMerchantGmvTarget"),
    monthlyNewMerchantReward: document.getElementById("monthlyNewMerchantReward"),
    monthlyNewMerchantFormError: document.getElementById("monthlyNewMerchantFormError"),
    monthlyNewMerchantCancel: document.getElementById("monthlyNewMerchantCancel"),
    monthlyNewMerchantSave: document.getElementById("monthlyNewMerchantSave"),
    monthlyNewMerchantImportBackdrop: document.getElementById("monthlyNewMerchantImportBackdrop"),
    monthlyNewMerchantImportDialog: document.getElementById("monthlyNewMerchantImportDialog"),
    monthlyNewMerchantImportClose: document.getElementById("monthlyNewMerchantImportClose"),
    monthlyNewMerchantImportFile: document.getElementById("monthlyNewMerchantImportFile"),
    monthlyNewMerchantImportChoose: document.getElementById("monthlyNewMerchantImportChoose"),
    monthlyNewMerchantImportFileName: document.getElementById("monthlyNewMerchantImportFileName"),
    monthlyNewMerchantImportTemplate: document.getElementById("monthlyNewMerchantImportTemplate"),
    monthlyNewMerchantImportPaste: document.getElementById("monthlyNewMerchantImportPaste"),
    monthlyNewMerchantImportPreview: document.getElementById("monthlyNewMerchantImportPreview"),
    monthlyNewMerchantImportSummary: document.getElementById("monthlyNewMerchantImportSummary"),
    monthlyNewMerchantImportError: document.getElementById("monthlyNewMerchantImportError"),
    monthlyNewMerchantImportPreviewTable: document.getElementById("monthlyNewMerchantImportPreviewTable"),
    monthlyNewMerchantImportCancel: document.getElementById("monthlyNewMerchantImportCancel"),
    monthlyNewMerchantImportSave: document.getElementById("monthlyNewMerchantImportSave"),
    sheetPage: document.getElementById("sheetPage"),
    categoryPage: document.getElementById("categoryPage"),
    sheetPageTitle: document.getElementById("sheetPageTitle"),
    sheetPageSubtitle: document.getElementById("sheetPageSubtitle"),
    sheetPageSummary: document.getElementById("sheetPageSummary"),
    sheetPageNotes: document.getElementById("sheetPageNotes"),
    targetMonthSelect: document.getElementById("targetMonthSelect"),
    targetCompareMonthSelect: document.getElementById("targetCompareMonthSelect"),
    targetTierFilter: document.getElementById("targetTierFilter"),
    sheetTableTitle: document.getElementById("sheetTableTitle"),
    sheetTableCount: document.getElementById("sheetTableCount"),
    sheetGridHead: document.getElementById("sheetGridHead"),
    sheetGridRows: document.getElementById("sheetGridRows"),
    tierPage: document.getElementById("tierPage"),
    tierPageTitle: document.getElementById("tierPageTitle"),
    tierPageSubtitle: document.getElementById("tierPageSubtitle"),
    tier1ManagementActions: document.getElementById("tier1ManagementActions"),
    tier1AdditionsToggle: document.getElementById("tier1AdditionsToggle"),
    tier1AdditionsCount: document.getElementById("tier1AdditionsCount"),
    tier1AdditionsPanel: document.getElementById("tier1AdditionsPanel"),
    tier1AdditionsClose: document.getElementById("tier1AdditionsClose"),
    tier1AdditionsStatus: document.getElementById("tier1AdditionsStatus"),
    tier1AdditionsList: document.getElementById("tier1AdditionsList"),
    tier1AddMerchant: document.getElementById("tier1AddMerchant"),
    tier1MerchantDialog: document.getElementById("tier1MerchantDialog"),
    tier1MerchantClose: document.getElementById("tier1MerchantClose"),
    tier1MerchantCancel: document.getElementById("tier1MerchantCancel"),
    tier1MerchantSearchForm: document.getElementById("tier1MerchantSearchForm"),
    tier1MerchantQuery: document.getElementById("tier1MerchantQuery"),
    tier1MerchantSearchButton: document.getElementById("tier1MerchantSearchButton"),
    tier1MerchantStatus: document.getElementById("tier1MerchantStatus"),
    tier1MerchantResults: document.getElementById("tier1MerchantResults"),
    tier1MerchantConfirmation: document.getElementById("tier1MerchantConfirmation"),
    tier1SelectedMerchantName: document.getElementById("tier1SelectedMerchantName"),
    tier1SelectedMerchantId: document.getElementById("tier1SelectedMerchantId"),
    tier1SelectedMerchantNetwork: document.getElementById("tier1SelectedMerchantNetwork"),
    tier1SelectedMerchantTier: document.getElementById("tier1SelectedMerchantTier"),
    tier1SelectedMerchantContext: document.getElementById("tier1SelectedMerchantContext"),
    tier1MerchantConfirmationNotice: document.getElementById("tier1MerchantConfirmationNotice"),
    tier1MerchantBack: document.getElementById("tier1MerchantBack"),
    tier1MerchantConfirm: document.getElementById("tier1MerchantConfirm"),
    tierPageSummary: document.getElementById("tierPageSummary"),
    tierPageNotes: document.getElementById("tierPageNotes"),
    tierCategorySummary: document.getElementById("tierCategorySummary"),
    tierTableTitle: document.getElementById("tierTableTitle"),
    tierTableCount: document.getElementById("tierTableCount"),
    tierPagination: document.getElementById("tierPagination"),
    tierPagePrev: document.getElementById("tierPagePrev"),
    tierPageIndicator: document.getElementById("tierPageIndicator"),
    tierPageNext: document.getElementById("tierPageNext"),
    tierTablePanel: document.getElementById("tierTablePanel"),
    tierExpand: document.getElementById("expandTierSheet"),
    tierOverlayClose: document.getElementById("closeTierSheetOverlay"),
    tierMoveSelected: document.getElementById("moveTierRows"),
    tierResetMoves: document.getElementById("resetTierMoves"),
    tierMoveDialog: document.getElementById("tierMoveDialog"),
    tierMoveSummary: document.getElementById("tierMoveSummary"),
    tierMoveTargets: document.getElementById("tierMoveTargets"),
    tierMoveConfirm: document.getElementById("confirmTierMove"),
    tierMoveCancel: document.getElementById("cancelTierMove"),
    tierMoveClose: document.getElementById("closeTierMoveDialog"),
    tierMoveStatus: document.getElementById("tierMoveStatus"),
    tierMoveInlineStatus: document.getElementById("tierMoveInlineStatus"),
    sheetExpandedBackdrop: document.getElementById("sheetExpandedBackdrop"),
    tierSheetHead: document.getElementById("tierSheetHead"),
    tierSheetRows: document.getElementById("tierSheetRows"),
    tierSheetSearch: document.getElementById("tierSheetSearch"),
    tierStartDate: document.getElementById("tierStartDate"),
    tierEndDate: document.getElementById("tierEndDate"),
    tierDateApply: document.getElementById("tierDateApply"),
    tierDateStatus: document.getElementById("tierDateStatus"),
    tierSheetNetwork: document.getElementById("tierSheetNetwork"),
    tierSheetCountry: document.getElementById("tierSheetCountry"),
    tierSheetMinEpc: document.getElementById("tierSheetMinEpc"),
    tierSheetMinRevenue: document.getElementById("tierSheetMinRevenue"),
    tierColumnToggle: document.getElementById("tierColumnToggle"),
    tierColumnPanel: document.getElementById("tierColumnPanel"),
    tierColumnList: document.getElementById("tierColumnList"),
    tierColumnCore: document.getElementById("tierColumnCore"),
    tierColumnAll: document.getElementById("tierColumnAll"),
    tierNavButtons: Array.from(document.querySelectorAll(".tier-nav-button")),
    paymentSummary: document.getElementById("paymentSummary"),
    paymentRows: document.getElementById("paymentRows"),
    paymentTableCount: document.getElementById("paymentTableCount"),
    paymentStamp: document.getElementById("paymentStamp"),
    paymentSync: document.getElementById("paymentSync"),
    paymentMonth: document.getElementById("paymentMonthFilter"),
    paymentNetwork: document.getElementById("paymentNetworkFilter"),
    paymentRegion: document.getElementById("paymentRegionFilter"),
    paymentTier: document.getElementById("paymentTierFilter"),
    paymentStatus: document.getElementById("paymentStatusFilter"),
    paymentSort: document.getElementById("paymentSortFilter"),
    paymentSearch: document.getElementById("paymentSearch"),
    languageToggle: document.getElementById("languageToggle"),
    chatModeToggle: null,
    modeFastBtn: null,
    modeDeepBtn: null
  };

  const mobileNavigationMedia = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 1120px)")
    : {
        matches: false,
        addEventListener: null,
        addListener: null
      };

  var _deepPanelIdCounter = 0;
  var _deepPanels = [];
  var _deepMaxZIndex = 1000;
  var _deepCardKeyCounter = 0;
  var _deepReportCache = {};

  const quickPrompts = [
    { key: "quick.aiper", prompt: "Aiper" },
    { key: "quick.beauty", prompt: "Recommend 5 beauty offers" },
    { key: "quick.tier2", prompt: "Tier 2" },
    { key: "quick.unpaid", prompt: "Which offers are unpaid?" },
    { key: "quick.april", prompt: "April unpaid payments" },
    { key: "quick.asin", prompt: "Find ASIN B0D2HKCMBP" }
  ];

  const categoryAliases = {
    beauty: ["beauty", "personal care", "skin", "skin care", "skincare", "facial", "face", "hair", "makeup", "nail", "wrinkle", "anti aging", "anti-aging", "serum", "moisturizer", "sunscreen", "eyelash", "ç¾å¦†", "ç¾å®¹", "æŠ¤è‚¤", "ä¸ªæŠ¤", "çš®è‚¤", "é¢éƒ¨", "å¤´å‘", "å½©å¦†", "æŒ‡ç”²", "æŠ—è€", "ç²¾å", "é¢éœœ", "é˜²æ™’", "ç«æ¯›"],
    home: ["home", "kitchen", "furniture", "bedding", "mattress", "office", "chair", "desk", "cookware", "vacuum", "fireplace", "å®¶å±…", "å®¶ç”¨", "å¨æˆ¿", "å®¶å…·", "åºŠå“", "åºŠå«", "åŠå…¬", "æ¤…å­", "æ¡Œå­", "å¨å…·", "å¸å°˜å™¨", "æ‰«åœ°æœºå™¨äºº", "å£ç‚‰"],
    pet: ["pet", "dog", "cat", "pet supplies", "å® ç‰©", "ç‹—", "çŒ«", "å® ç‰©ç”¨å“"],
    electronics: ["electronics", "tech", "camera", "audio", "robot", "headphone", "earbud", "projector", "smartwatch", "smart watch", "wifi", "usb", "ç”µå­", "ç§‘æŠ€", "æ•°ç ", "ç›¸æœº", "æ‘„åƒå¤´", "éŸ³é¢‘", "è€³æœº", "æŠ•å½±ä»ª", "æ™ºèƒ½æ‰‹è¡¨", "æ™ºèƒ½æˆ’æŒ‡", "è·¯ç”±å™¨", "æ— çº¿ç½‘", "è“ç‰™"],
    supplement: ["supplement", "health", "vitamin", "nutrition", "wellness", "probiotic", "magnesium", "creatine", "protein", "ä¿å¥å“", "å¥åº·", "ç»´ç”Ÿç´ ", "è¥å…»", "ç›Šç”ŸèŒ", "é•", "è‚Œé…¸", "è›‹ç™½"],
    baby: ["baby", "kid", "kids", "stroller", "æ¯å©´", "å©´å„¿", "å®å®", "å„¿ç«¥", "ç«¥è½¦", "æ¨è½¦"],
    outdoors: ["sports", "outdoor", "outdoors", "patio", "lawn", "garden", "pool", "camping", "hiking", "fishing", "è¿åŠ¨", "æˆ·å¤–", "åº­é™¢", "è‰åª", "èŠ±å›­", "æ³³æ± ", "æ¸¸æ³³æ± ", "æ³³æ± æ¸…æ´", "éœ²è¥", "å¾’æ­¥", "é’“é±¼"],
    automotive: ["automotive", "car", "vehicle", "æ±½è½¦", "è½¦è½½", "è½¦è¾†"],
    tools: ["tools", "home improvement", "å·¥å…·", "å®¶è£…", "äº”é‡‘", "ç»´ä¿®"],
    shoes: ["shoes", "sneakers", "loafers", "slippers", "boots", "insoles", "é‹", "é‹å­", "è¿åŠ¨é‹", "ä¹ç¦é‹", "æ‹–é‹", "é´", "é‹å«"],
    fashion: ["clothing", "jewelry", "apparel", "fashion", "shirt", "jeans", "dress", "necklace", "æœè£…", "è¡£æœ", "ç å®", "é¥°å“", "ç‰›ä»”è£¤", "è£™å­", "é¡¹é“¾"],
    pool: ["pool cleaner", "pool cleaners", "robotic pool", "robotic pool cleaner", "æ³³æ± æœºå™¨äºº", "æ³³æ± æ¸…æ´æœºå™¨äºº", "æ³³æ± æ¸…æ´å™¨"]
  };

  const keywordSynonymMap = {
    headphones: ["headphone", "earbuds", "earbud", "earphones", "earphone", "headset", "headsets", "audio", "wireless earbuds", "bluetooth earbuds", "bluetooth headphones", "wireless headphones", "gaming headset", "open-ear headphones", "open ear headphones", "bone conduction"],
    skincare: ["skin care", "skin-care", "skin care products", "skincare products", "facial care", "serum", "toner", "moisturizer", "moisturiser", "sunscreen", "acne", "cleanser", "face wash", "cleansing oil", "cleansing foam", "anti aging", "anti-aging", "face cream", "face moisturizer", "sheet mask", "face mask"],
    "pool cleaner": ["pool cleaners", "pool robot", "pool robots", "robotic pool cleaner", "robotic pool cleaners", "pool vacuum", "pool vacuums", "pool maintenance", "pool cleaning", "æ³³æ± æœºå™¨äºº", "æ³³æ± æ¸…æ´æœºå™¨äºº", "æ³³æ± æ¸…æ´å™¨"],
    vacuum: ["vacuums", "robot vacuum", "robot vacuums", "stick vacuum", "stick vacuums", "cordless vacuum", "cordless vacuums", "cleaning appliance", "cleaning appliances", "vacuum cleaner", "vacuum cleaners"],
    chair: ["chairs", "office chair", "office chairs", "ergonomic chair", "ergonomic chairs", "gaming chair", "gaming chairs", "furniture"],
    supplements: ["supplement", "nutrition", "vitamins", "vitamin", "protein", "probiotic", "probiotics", "health supplement", "health supplements", "creatine", "magnesium"],
    shoes: ["shoe", "footwear", "sneakers", "sneaker", "running shoes", "running shoe", "sandals", "sandal", "boots", "boot", "slippers", "slipper", "insoles", "insole"],
    pet: ["pets", "dog", "dogs", "cat", "cats", "pet food", "dog food", "cat food", "pet supplement", "pet supplements", "pet supplies", "pet products"],
    baby: ["babies", "stroller", "strollers", "baby monitor", "baby monitors", "diaper", "diapers", "nursery", "baby product", "baby products", "kids", "kid"],
    speaker: ["speakers", "audio", "bluetooth speaker", "bluetooth speakers", "soundbar", "sound bar", "soundbars", "karaoke", "microphone", "microphones"]
  };

  const translations = {
    zh: {
      "brand.subtitle": "äºšé©¬é€Šåˆ†å±‚åˆ†æ",
      "nav.dashboard": "ä»ªè¡¨ç›˜",
      "nav.workspace": "æ™ºèƒ½å·¥ä½œå°",
      "nav.workspaceHint": "AI å·¥å…·",
      "nav.merchantOperations": "å•†å®¶ç»è¥",
      "nav.merchantOperationsHint": "è¿è¥ä¸åˆ†å±‚",
      "nav.mediaIntelligence": "åª’ä½“æ´å¯Ÿ",
      "nav.mediaIntelligenceHint": "åª’ä½“è¡¨ç°",
      "nav.productsOffers": "äº§å“ä¸ Offer",
      "nav.productsOffersHint": "å•†å“ä¸è·å®¢",
      "nav.chatbot": "Chatbot",
      "nav.agent": "Agent",
      "nav.payments": "ä»˜æ¬¾",
      "nav.publishers": "åª’ä½“",
      "nav.googleAds": "Google å¹¿å‘Š",
      "nav.googleAdsHint": "å¹¿å‘ŠæŠ•æ”¾",
      "nav.brandMedia": "å“ç‰Œåª’ä½“è¶‹åŠ¿",
      "nav.revenueFlow": "Revenue æµå‘",
      "nav.reports": "æŠ¥è¡¨",
      "nav.targets": "ç›®æ ‡",
      "nav.category": "å“ç±»",
      "nav.monthlyNewMerchants": "ä¸Šæ–°å•†å®¶",
      "nav.offerListTracker": "Offer æ¸…å•è¿½è¸ª",
      "offerTracker.eyebrow": "Offer è§„åˆ’å·¥ä½œå°",
      "offerTracker.title": "Offer List Tracker",
      "offerTracker.subtitle": "æŒ‰ä¼˜å…ˆçº§ç”Ÿæˆ Offer æ¸…å•ï¼Œå¹¶å¯¼å‡ºå¯ç›´æ¥åˆ†äº«çš„å·¥ä½œç°¿ã€‚",
      "offerTracker.savedViews": "å·²ä¿å­˜è§†å›¾",
      "offerTracker.viewName": "è§†å›¾åç§°",
      "offerTracker.viewNamePlaceholder": "ä¾‹å¦‚ï¼šTier 1 ç¾å¦†",
      "offerTracker.saveCurrentView": "ä¿å­˜å½“å‰è§†å›¾",
      "offerTracker.exportExcel": "å¯¼å‡º Excel",
      "offerTracker.defineRange": "å®šä¹‰ Offer èŒƒå›´",
      "offerTracker.defineRangeSubtitle": "å…ˆé€‰æ‹©å•†ä¸šèŒƒå›´ï¼Œå†æŸ¥çœ‹å¹¶å¯¼å‡ºå¯¹åº”çš„ä¼˜å…ˆçº§æ¸…å•ã€‚",
      "offerTracker.liveSource": "å®æ—¶ Offer ç¼“å­˜",
      "offerTracker.timeRange": "æ—¶é—´èŒƒå›´",
      "offerTracker.bbPreference": "æ˜¯å¦ä»‹æ„ BB",
      "offerTracker.bbAll": "å…¨éƒ¨ BB åå¥½",
      "offerTracker.bbMind": "ä»‹æ„ BB",
      "offerTracker.bbOpen": "ä¸ä»‹æ„ BB",
      "offerTracker.bbUnknown": "æœªçŸ¥",
      "offerTracker.rangeLoading": "æ­£åœ¨è¯»å–æ‰€é€‰æ—¶é—´èŒƒå›´â€¦",
      "offerTracker.rangeLoaded": "æ•°æ®èŒƒå›´ï¼š{range}",
      "offerTracker.rangeError": "æ— æ³•è¯»å–æ‰€é€‰æ—¶é—´èŒƒå›´ï¼Œè¯·ç¨åé‡è¯•ã€‚",
      "offerTracker.aovRange": "AOV èŒƒå›´",
      "offerTracker.commissionRange": "AFF ä½£é‡‘èŒƒå›´",
      "offerTracker.revenueStatus": "Revenue çŠ¶æ€",
      "offerTracker.revenueAll": "å…¨éƒ¨ Revenue",
      "offerTracker.revenuePositive": "å·²äº§ç”Ÿ Revenue",
      "offerTracker.revenueNone": "æœªäº§ç”Ÿ Revenue",
      "offerTracker.revenueSort": "Revenue æ’åº",
      "offerTracker.sortPriority": "é»˜è®¤ä¼˜å…ˆçº§",
      "offerTracker.sortRevenueDesc": "Revenueï¼šä»é«˜åˆ°ä½",
      "offerTracker.sortRevenueAsc": "Revenueï¼šä»ä½åˆ°é«˜",
      "offerTracker.applyFilters": "åº”ç”¨ç­›é€‰",
      "offerTracker.offerList": "Offer æ¸…å•",
      "offerTracker.productList": "å“ç‰Œäº§å“æ¸…å•",
      "offerTracker.search": "æœç´¢ Offer",
      "offerTracker.searchPlaceholder": "æœç´¢å•†å®¶æˆ– ID",
      "offerTracker.columns": "åˆ—è®¾ç½®",
      "offerTracker.priorityRules": "ä¼˜å…ˆçº§è§„åˆ™",
      "offerTracker.rulesSubtitle": "ä½¿ç”¨é€æ˜è¯„åˆ†å¯¹å¯¼å‡ºå†…å®¹åˆ†ç»„ã€‚",
      "offerTracker.highScore": "é«˜ä¼˜å…ˆçº§æœ€ä½åˆ†",
      "offerTracker.lowAovCeiling": "ä½ AOV ä¸Šé™",
      "offerTracker.resetRules": "é‡ç½®è§„åˆ™",
      "offerTracker.saveRules": "ä¿å­˜è§„åˆ™",
      "offerTracker.exportSelected": "å¯¼å‡ºå·²é€‰",
      "offerTracker.exportSetupEyebrow": "Excel å¯¼å‡ºè®¾ç½®",
      "offerTracker.exportSetupTitle": "é…ç½®å¯¼å‡ºå†…å®¹",
      "offerTracker.exportTierTitle": "Tier è¾“å‡ºæ•°é‡",
      "offerTracker.exportTierHelp": "é€‰æ‹©éœ€è¦åŒ…å«çš„ Tierï¼Œå¹¶è®¾ç½®æ¯ä¸ª Tier çš„è¾“å‡ºæ•°é‡ã€‚",
      "offerTracker.exportHighlightTitle": "è¾“å‡ºè¡ŒèƒŒæ™¯è‰²",
      "offerTracker.exportHighlightHelp": "è¡Œå·æŒ‰å¯¼å‡ºçš„æ•°æ®è¡Œè®¡ç®—ï¼Œä¸åŒ…å«è¡¨å¤´ï¼›èƒŒæ™¯è‰²ä¼šåŒæ—¶åº”ç”¨åˆ°ä¸¤ä¸ªå·¥ä½œè¡¨ã€‚",
      "offerTracker.exportAddRange": "+ æ·»åŠ åŒºé—´",
      "offerTracker.exportWorkbook": "å¯¼å‡ºå·¥ä½œç°¿",
      "monthlyNewMerchants.title": "æœ¬æœˆä¸Šæ–°å•†å®¶",
      "monthlyNewMerchants.subtitle": "æ‰‹åŠ¨æ–°å¢æœ¬æœˆå•†å®¶ï¼Œæ¯æ¡è®°å½•éƒ½ä¼šç›´æ¥ä¿å­˜åˆ°æ•°æ®åº“",
      "monthlyNewMerchants.add": "æ–°å¢å•†å®¶",
      "monthlyNewMerchants.import": "å¯¼å…¥è¡¨æ ¼",
      "monthlyNewMerchants.importTitle": "å¯¼å…¥å•†å®¶è¡¨æ ¼",
      "monthlyNewMerchants.importSubtitle": "å¯ç²˜è´´ Excel æˆ– Google Sheetsï¼Œæˆ–ä¸Šä¼  CSVã€TSVã€XLSã€XLSXï¼›ä¿å­˜å‰ä¼šå…ˆæ ‡è®°é”™è¯¯ã€‚",
      "monthlyNewMerchants.chooseFile": "é€‰æ‹©æ–‡ä»¶",
      "monthlyNewMerchants.noFile": "æœªé€‰æ‹©æ–‡ä»¶",
      "monthlyNewMerchants.downloadTemplate": "ä¸‹è½½ CSV æ¨¡æ¿",
      "monthlyNewMerchants.pasteLabel": "ç²˜è´´åŒ…å«è¡¨å¤´çš„å®Œæ•´è¡¨æ ¼",
      "monthlyNewMerchants.preview": "é¢„è§ˆç²˜è´´å†…å®¹",
      "monthlyNewMerchants.importValid": "å¯¼å…¥æœ‰æ•ˆè¡Œ",
      "monthlyNewMerchants.search": "æœç´¢ä¸Šæ–°å•†å®¶",
      "monthlyNewMerchants.searchPlaceholder": "æœç´¢å•†å®¶ã€ID æˆ– BD",
      "monthlyNewMerchants.merchantId": "å•†å®¶ ID",
      "monthlyNewMerchants.priority": "é‡ç‚¹",
      "monthlyNewMerchants.priorityAction": "é‡ç‚¹æ¨è",
      "monthlyNewMerchants.priorityHelp": "åœ¨æœˆåº¦åˆ—è¡¨ä¸­é«˜äº®è¯¥å•†å®¶",
      "monthlyNewMerchants.bd": "BD",
      "monthlyNewMerchants.brand": "å“ç‰Œ",
      "monthlyNewMerchants.program": "é¡¹ç›®",
      "monthlyNewMerchants.platform": "å¹³å°",
      "monthlyNewMerchants.gmvRequirement": "éœ€è¾¾åˆ°çš„ GMV",
      "monthlyNewMerchants.gmvTarget": "æ•°å­— GMV ç›®æ ‡",
      "monthlyNewMerchants.pastMonthPurchase": "ä¸Šæœˆè´­ä¹°æƒ…å†µ",
      "monthlyNewMerchants.independentWebsites": "ç‹¬ç«‹ç«™æ•°æ®",
      "monthlyNewMerchants.reviewSummary": "è¯„è®ºæ•°æ®",
      "monthlyNewMerchants.ourCommission": "æˆ‘ä»¬çš„ä½£é‡‘",
      "monthlyNewMerchants.presetCommission": "é¢„è®¾ä½£é‡‘",
      "monthlyNewMerchants.reward": "å•†å®¶å¥–åŠ±",
      "monthlyNewMerchants.rewardPlaceholder": "å¯å¡«å†™å¥–é‡‘ã€ä½£é‡‘æå‡æˆ–å…¶ä»–å¥–åŠ±",
      "monthlyNewMerchants.updated": "æ›´æ–°æ—¶é—´",
      "monthlyNewMerchants.actions": "æ“ä½œ",
      "monthlyNewMerchants.merchantName": "å•†å®¶",
      "monthlyNewMerchants.drawerSubtitle": "å•†å®¶åç§°å¿…å¡«ï¼›ä¿å­˜åå®Œæ•´è®°å½•ä¼šç›´æ¥å†™å…¥æ•°æ®åº“",
      "monthlyNewMerchants.save": "ä¿å­˜å•†å®¶",
      "monthlyNewMerchants.addTitle": "æ–°å¢ä¸Šæ–°å•†å®¶",
      "monthlyNewMerchants.editTitle": "ç¼–è¾‘ä¸Šæ–°å•†å®¶",
      "monthlyNewMerchants.loading": "æ­£åœ¨ä»æ•°æ®åº“è¯»å–æ‰‹å·¥æ–°å¢å•†å®¶â€¦",
      "monthlyNewMerchants.emptyTitle": "æœ¬æœˆè¿˜æ²¡æœ‰ä¸Šæ–°å•†å®¶",
      "monthlyNewMerchants.emptyBody": "ç‚¹å‡»â€œæ–°å¢å•†å®¶â€åˆ›å»ºç¬¬ä¸€æ¡æ•°æ®åº“è®°å½•ã€‚",
      "monthlyNewMerchants.noMatchesTitle": "æ²¡æœ‰åŒ¹é…çš„å•†å®¶",
      "monthlyNewMerchants.noMatchesBody": "è¯·è°ƒæ•´æœç´¢å…³é”®è¯ã€‚",
      "monthlyNewMerchants.saved": "å•†å®¶ä¿¡æ¯å’Œé‡ç‚¹æ ‡è®°å·²ä¿å­˜åˆ°æ•°æ®åº“ã€‚",
      "monthlyNewMerchants.deleted": "å•†å®¶è®°å½•å·²ä»æ•°æ®åº“åˆ é™¤ã€‚",
      "monthlyNewMerchants.deleteConfirm": "ç¡®å®šåˆ é™¤è¿™æ¡æœˆåº¦ä¸Šæ–°å•†å®¶è®°å½•å—ï¼Ÿ",
      "monthlyNewMerchants.edit": "ç¼–è¾‘",
      "monthlyNewMerchants.delete": "åˆ é™¤",
      "monthlyNewMerchants.databaseError": "æ•°æ®åº“æš‚æ—¶æ— æ³•è¯»å–ä¸Šæ–°å•†å®¶ä¿¡æ¯ã€‚",
      "action.cancel": "å–æ¶ˆ",
      "sidebar.status": "æ•°æ®çŠ¶æ€",
      "source.backendEpc": "åå° EPC",
      "source.payments": "2-6æœˆä»˜æ¬¾",
      "source.sheets": "åˆ†å±‚é€»è¾‘å·²åŠ è½½",
      "dashboard.title": "æ¨èèŠå¤©æœºå™¨äºº",
      "agent.title": "å¯¹è¯ Agent",
      "agent.subtitle": "ç›´æ¥è¯¢é—®å•†æˆ·ã€å“ç±»ã€Tierã€ä»˜æ¬¾å’Œè¶‹åŠ¿æ•°æ®ã€‚",
      "agent.status": "åªè¯»æ•°æ®å±‚",
      "agent.new": "æ–°å»ºå¯¹è¯",
      "agent.stop": "åœæ­¢",
      "agent.stopped": "æœ¬æ¬¡ Agent åˆ†æå·²åœæ­¢ã€‚",
      "agent.execution.title": "Agent å·¥ä½œè¿‡ç¨‹",
      "agent.execution.planning": "ç†è§£é—®é¢˜å¹¶è§„åˆ’æŸ¥è¯¢",
      "agent.execution.planningDetail": "æ­£åœ¨è¯†åˆ«å•†æˆ·ã€Tierã€æ—¶é—´èŒƒå›´å’ŒæŒ‡æ ‡",
      "agent.execution.replanning": "ä¿®æ­£æŸ¥è¯¢è®¡åˆ’",
      "agent.execution.tool": "æ‰§è¡Œæ•°æ®æŸ¥è¯¢",
      "agent.execution.synthesis": "æ•´ç†åˆ†æç»“æœ",
      "agent.execution.synthesisDetail": "æ­£åœ¨åŸºäºå·¥å…·ç»“æœç”Ÿæˆç»“è®º",
      "agent.execution.direct": "ç›´æ¥å›ç­”",
      "agent.execution.done": "å·²å®Œæˆ",
      "agent.execution.running": "æ‰§è¡Œä¸­",
      "agent.execution.failed": "æ‰§è¡Œå¤±è´¥",
      "agent.execution.stopped": "å·²åœæ­¢",
      "agent.execution.monthlyUnavailable": "æœˆåº¦æ•°æ®æš‚ä¸å¯ç”¨",
      "agent.execution.estimated": "ä¼°ç®—è¶‹åŠ¿",
      "agent.rail.title": "æ•°æ® Agent",
      "agent.rail.body": "Agent ä¼šè§„åˆ’å–æ•°ã€æ‰§è¡Œåªè¯»å·¥å…·ï¼Œå¹¶è§£é‡Šè¿”å›çš„æ•°æ®ã€‚",
      "agent.rail.eyebrow": "èƒ½åŠ›èŒƒå›´",
      "agent.rail.note": "åªè¯»åˆ†æã€‚éœ€è¦åŸæœ‰ Report Mode æµç¨‹å’Œ Deep Window æŠ¥å‘Šæ—¶ï¼Œè¯·ä½¿ç”¨ Chatbotã€‚",
      "agent.cap.merchant": "å•†æˆ·åˆ†æ",
      "agent.cap.category": "å“ç±»ä¸ Tier",
      "agent.cap.compare": "å•†æˆ· / å“ç±»å¯¹æ¯”",
      "agent.cap.payment": "ä»˜æ¬¾ä¸è¶‹åŠ¿",
      "agent.welcome.kicker": "ä»æ•°æ®é—®é¢˜å¼€å§‹",
      "agent.welcome.title": "ä½ æƒ³æŸ¥è¯¢ä»€ä¹ˆï¼Ÿ",
      "agent.welcome.body": "å¯ä»¥è¯¢é—®å•†æˆ·åˆ†æã€å“ç±»å¯¹æ¯”ã€ä»˜æ¬¾çŠ¶æ€æˆ–å¤šä¸ªæœˆä»½çš„è¶‹åŠ¿ã€‚",
      "agent.example.label": "ç¤ºä¾‹æé—®",
      "agent.example.prompt": "Tapoï¼ŒID398679ï¼Œepcå’Œconversionå¸®æˆ‘æŸ¥è¯¢ä¸‹",
      "agent.context": "åªè¯»æ•°æ®å·¥ä½œåŒº",
      "agent.placeholder": "è¯¢é—®å•†æˆ·ã€Tierã€ä»˜æ¬¾æˆ–è¶‹åŠ¿...",
      "agent.error": "Agent æš‚æ—¶æ— æ³•å›ç­”ï¼Œè¯·ç¨åé‡è¯•ã€‚",
      "filters.dashboard": "ä»ªè¡¨ç›˜ç­›é€‰",
      "filter.minEpc": "æœ€ä½ EPC",
      "filter.minAov": "æœ€ä½ AOV",
      "filter.minConversion": "æœ€ä½è½¬åŒ–ç‡",
      "filter.minRevenue": "æœ€ä½æ”¶å…¥",
      "filter.unpaidOnly": "ä»…æœªä»˜æ¬¾",
      "filter.pendingOnly": "ä»…å¾…å¤„ç†",
      "label.Sort by": "æ’åºå­—æ®µ",
      "label.Direction": "æ’åºæ–¹å‘",
      "action.reset": "é‡ç½®",
      "action.send": "å‘é€",
      "action.move": "ç§»åŠ¨",
      "action.select": "é€‰æ‹©",
      "action.download": "ä¸‹è½½",
      "action.expand": "å±•å¼€",
      "action.close": "å…³é—­",
      "chat.placeholder": "è¯¢é—® EPCã€åˆ†å±‚ã€AOVã€è½¬åŒ–ç‡ã€æœªä»˜æ¬¾ offer...",
      "chat.intent.title": "æé—®ç±»å‹",
      "chat.intent.merchant": "å•†æˆ·",
      "chat.intent.merchantHint": "å•†æˆ·æŸ¥è¯¢",
      "chat.intent.category": "å“ç±»",
      "chat.intent.categoryHint": "å“ç±»æŸ¥è¯¢",
      "chat.intent.tier": "åˆ†å±‚",
      "chat.intent.tierHint": "Tier æ¦‚è§ˆ",
      "chat.intent.categoryTier": "å“ç±» + Tier",
      "chat.intent.categoryTierHint": "æŸ Tier ä¸‹çš„å“ç±»æŸ¥è¯¢",
      "chat.intent.trend": "è¶‹åŠ¿",
      "chat.intent.trendHint": "è¶‹åŠ¿åˆ†æ",
      "chat.intent.payment": "ä»˜æ¬¾",
      "chat.intent.paymentHint": "ä»˜æ¬¾çŠ¶æ€",
      "chat.intent.asin": "ASIN",
      "chat.intent.asinHint": "ASIN æŸ¥è¯¢",
      "chat.intent.publisher": "åª’ä½“",
      "chat.intent.publisherHint": "åª’ä½“è®°å½•æŸ¥è¯¢",
      "chat.intent.publisherProfile": "åª’ä½“ç”»åƒ",
      "chat.intent.publisherProfileHint": "åª’ä½“ç”»åƒæŸ¥è¯¢",
      "table.offers": "Offer åˆ—è¡¨",
      "payments.title": "ä»˜æ¬¾",
      "payments.sync": "åŒæ­¥ Levanta",
      "payments.syncing": "åŒæ­¥ä¸­...",
      "payments.records": "ä»˜æ¬¾è®°å½•",
      "payments.search": "å•†å®¶æœç´¢",
      "payments.searchPlaceholder": "å•†å®¶åç§°æˆ– ID",
      "publishers.title": "åª’ä½“å€¾å‘åˆ†æ",
      "publishers.subtitle": "ä»åˆä½œå•†å®¶ã€å“ç±»ã€å®¢å•ä»·ä¸ä½£é‡‘ç»“æ„åˆ¤æ–­åª’ä½“åå¥½",
      "publishers.selectPublisher": "é€‰æ‹©è¦åˆ†æçš„åª’ä½“",
      "publishers.selectPublisherHint": "è¾“å…¥åª’ä½“åç§°æˆ– IDï¼ŒæŸ¥çœ‹å…¶åˆä½œå•†å®¶ä¸åå¥½ã€‚",
      "publishers.publisher": "åª’ä½“",
      "publishers.period": "æ—¥æœŸèŒƒå›´",
      "publishers.network": "æ‰€å±è”ç›Ÿ",
      "publishers.linkType": "é“¾æ¥ç±»å‹",
      "publishers.merchant": "å•†å®¶",
      "publishers.merchantPlaceholder": "å•†å®¶åç§°æˆ– ID",
      "publishers.product": "å•†å“",
      "publishers.productPlaceholder": "å•†å“ ASIN æˆ–åç§°",
      "publishers.manager": "åª’ä»‹ç»ç†",
      "publishers.managerPlaceholder": "ç»ç†åç§°",
      "publishers.affinityEmptyTitle": "é€‰æ‹©åª’ä½“åç”Ÿæˆå€¾å‘ç”»åƒ",
      "publishers.affinityEmptyBody": "ç³»ç»Ÿä¼šæŒ‰è¯¥åª’ä½“å®é™…åˆä½œçš„å•†å®¶ï¼Œè®¡ç®—å“ç±»è´¡çŒ®ã€AOV åŒºé—´ä¸ä½£é‡‘åå¥½ã€‚",
      "publishers.backToAll": "è¿”å›å…¨éƒ¨åª’ä½“",
      "publishers.categoryAffinity": "å“ç±»å€¾å‘",
      "publishers.bySales": "æŒ‰é”€å”®é¢è´¡çŒ®",
      "publishers.affinitySignals": "å€¾å‘ä¿¡å·",
      "publishers.signalHint": "ç”¨äºåˆ¤æ–­åˆä½œåå¥½",
      "publishers.merchantPortfolio": "åˆä½œå•†å®¶ç»„åˆ",
      "publishers.networkMarket": "è”ç›Ÿ / å¸‚åœº",
      "publishers.commissionRate": "AFF ä½£é‡‘ç‡",
      "publishers.conversion": "è½¬åŒ–ç‡",
      "publishers.earnedCommission": "AFF å®é™…ä½£é‡‘",
      "publishers.portfolioShare": "é”€å”®é¢å æ¯”",
      "publishers.allTiers": "å…¨éƒ¨ Tier",
      "publishers.portfolioMethod": "AOV = é”€å”®é¢ Ã· è®¢å•æ•°ï¼›AFF EPC = é”€å”®é¢ Ã— AFF ä½£é‡‘ç‡ Ã· ç‚¹å‡»é‡ï¼›Conversion = è®¢å•æ•° Ã· ç‚¹å‡»é‡ã€‚AFF å®é™…ä½£é‡‘ = ALL å®é™…ä½£é‡‘ Ã— 75%ï¼›AFF ä½£é‡‘ç‡ = AFF å®é™…ä½£é‡‘ Ã· é”€å”®é¢ã€‚",
      "publishers.weightedCommission": "AFF åŠ æƒä½£é‡‘ç‡",
      "publishers.weightedBySales": "æŒ‰å•†å®¶é”€å”®é¢åŠ æƒ",
      "publishers.commissionProfile": "AFF ä½£é‡‘æ¦‚å†µ",
      "publishers.effectiveEarned": "AFF å®é™…ä½£é‡‘ç‡",
      "publishers.portfolioExportEmpty": "å½“å‰å•†å®¶ç»„åˆç­›é€‰ä¸‹æ²¡æœ‰å¯å¯¼å‡ºçš„è®°å½•ã€‚",
      "publishers.chartTitle": "æŒ‰ç‚¹å‡»é‡æ’å",
      "publishers.clicks": "ç‚¹å‡»",
      "publishers.orders": "è®¢å•",
      "publishers.sales": "é”€å”®é¢",
      "publishers.commission": "ä½£é‡‘",
      "publishers.publisherCount": "åª’ä½“æ•°é‡",
      "publishers.associatedPublishers": "å…³è”åª’ä½“",
      "publishers.merchantMatchKicker": "å•†å®¶å…³è”ç»“æœ",
      "publishers.merchantMatches": "åŒ¹é…å•†å®¶",
      "publishers.merchantNoMatch": "æœªæ‰¾åˆ°åŒ¹é…å•†å®¶",
      "publishers.merchantMatchHint": "ç»“æœå·²æŒ‰å½“å‰é¡µé¢ç­›é€‰æ¡ä»¶æ›´æ–°ï¼Œå¯ç‚¹å‡»åª’ä½“ç»§ç»­æŸ¥çœ‹ç”»åƒã€‚",
      "publishers.marketSummary": "æ¦‚è§ˆ",
      "publishers.market": "å¸‚åœº",
      "publishers.exportPage": "å¯¼å‡ºå½“å‰é¡µ",
      "publishers.exportAll": "å¯¼å‡ºå…¨éƒ¨",
      "publishers.columnsButton": "æ˜¾ç¤º",
      "publishers.columnsTitle": "æ˜¾ç¤ºå­—æ®µ",
      "publishers.columnsHint": "é€‰æ‹©è¦æ˜¾ç¤ºçš„å­—æ®µ",
      "publishers.coreColumns": "é»˜è®¤",
      "publishers.allColumns": "å…¨éƒ¨",
      "publishers.tableTitle": "åª’ä»‹æ•°æ®",
      "publishers.startMonth": "èµ·å§‹æ—¥æœŸ",
      "publishers.endMonth": "æˆªæ­¢æ—¥æœŸ",
      "publishers.site": "ç«™ç‚¹",
      "publishers.track": "Track",
      "publishers.empty": "æš‚æ— æ•°æ®",
      "brandMedia.title": "å“ç‰Œåª’ä½“è¶‹åŠ¿",
      "brandMedia.subtitle": "æŸ¥çœ‹ä¸€ä¸ªå“ç‰Œåœ¨ä¸åŒæ—¥æœŸç”±å„åª’ä½“å¸¦æ¥çš„è®¢å•æ•°å˜åŒ–ï¼ŒRevenue ä¿ç•™åœ¨ hover ä¸­ã€‚",
      "brandMedia.liveSource": "æ¯æ—¥è®¢å•æ•°",
      "brandMedia.brand": "å“ç‰Œ",
      "brandMedia.brandPlaceholder": "æœç´¢å“ç‰Œæˆ–å•†å®¶ ID",
      "brandMedia.manager": "åª’ä»‹ç»ç†",
      "brandMedia.allManagers": "å…¨éƒ¨ç»ç†",
      "brandMedia.timeRange": "æ—¶é—´è·¨åº¦",
      "brandMedia.startDate": "å¼€å§‹æ—¥æœŸ",
      "brandMedia.endDate": "ç»“æŸæ—¥æœŸ",
      "brandMedia.sourceNote": "æŠ˜çº¿è¡¨ç¤ºæ¯æ—¥è®¢å•æ•°ï¼›ç¼ºå°‘æŸåª’ä½“å½“å¤©çš„æºè®°å½•æ—¶ï¼Œå›¾è¡¨ä¼šæ–­å¼€è€Œä¸ä¼šè¡¥ä¸º 0ï¼ŒRevenue ä¼šä¿ç•™åœ¨ hover ä¸­ã€‚",
      "brandMedia.chartTitle": "å„åª’ä½“æ¯æ—¥è®¢å•æ•°",
      "brandMedia.chartSubtitle": "ç‚¹å‡»å³ä¾§åª’ä½“å¯é”å®šï¼›å¯åŒæ—¶é”å®šå¤šå®¶ï¼Œå†æ¬¡ç‚¹å‡»è§£é™¤ã€‚é»‘çº¿è¡¨ç¤ºæœªé”å®šå‰çš„å…¨éƒ¨åª’ä½“è®¢å•æ•°ï¼ŒRevenue ä¼šä¿ç•™åœ¨ hover ä¸­ã€‚æ²¡æœ‰æ¯æ—¥æºè®°å½•æ—¶ä¼šæ–­å¼€ã€‚",
      "brandMedia.allOrderLine": "å…¨éƒ¨åª’ä½“è®¢å•æ•°",
      "brandMedia.sankeyTitle": "Revenue æµå‘ï¼šå“ç‰Œ â†’ å•å“ â†’ åª’ä½“",
      "brandMedia.sankeySubtitle": "æŒ‰æ‰€é€‰æ—¶é—´è·¨åº¦æ±‡æ€»äº§ç”Ÿ Revenue çš„å•å“åŠå…¶å¯¹åº”åª’ä½“ã€‚",
      "brandMedia.sankeyBrand": "å“ç‰Œ",
      "brandMedia.sankeyProducts": "äº§ç”Ÿ Revenue çš„å•å“",
      "brandMedia.sankeyMedia": "å¯¹åº”åª’ä½“",
      "brandMedia.sankeyProductCount": "ä¸ªå•å“",
      "brandMedia.sankeyMediaCount": "ä¸ªåª’ä½“",
      "brandMedia.sankeyLoading": "æ­£åœ¨åŠ è½½å“ç‰Œã€å•å“ä¸åª’ä½“çš„ Revenue æµå‘â€¦",
      "brandMedia.sankeyError": "æ— æ³•è¯»å–å•å“ Revenue æµå‘ï¼Œè¯·è°ƒæ•´æ—¥æœŸèŒƒå›´åé‡è¯•ã€‚",
      "brandMedia.sankeyEmpty": "å½“å‰æ—¶é—´è·¨åº¦æ²¡æœ‰å¯å±•ç¤ºçš„ Revenue å•å“â€”åª’ä½“æµå‘ã€‚",
      "brandMedia.sankeyUnavailable": "è®¢å•æ•°æ®æš‚æœªæä¾›å•å“å­—æ®µï¼Œæ— æ³•ç”Ÿæˆ Revenue æµå‘ã€‚",
      "brandMedia.expandChart": "å±•å¼€å›¾è¡¨",
      "brandMedia.collapseChart": "é€€å‡ºå±•å¼€è§†å›¾",
      "brandMedia.clicksTitle": "å·²é”å®šåª’ä½“çš„æ¯æ—¥ç‚¹å‡»",
      "brandMedia.clicksSubtitle": "é”å®šä¸€å®¶åª’ä½“æ—¶æ˜¾ç¤ºæ™®é€šæŸ±çŠ¶å›¾ï¼›é”å®šå¤šå®¶æ—¶æŒ‰åª’ä½“å †å æ˜¾ç¤ºæ¯æ—¥ç´¯è®¡ç‚¹å‡»ã€‚",
      "brandMedia.clicksCount": "ç‚¹å‡»æŸ±",
      "brandMedia.clicksEmpty": "å½“å‰é”å®šåª’ä½“åœ¨æ‰€é€‰æ—¶é—´å†…æ²¡æœ‰ç‚¹å‡»è®°å½•ã€‚",
      "brandMedia.clicksDateTotal": "ç´¯è®¡ç‚¹å‡»",
      "brandMedia.clicksMedia": "åª’ä½“ç‚¹å‡»",
      "brandMedia.tableTitle": "åª’ä½“æ±‡æ€»",
      "brandMedia.tableSubtitle": "å±•ç¤ºå›¾è¡¨ä¸­æ¯æ¡çº¿åœ¨é€‰å®šæ—¶é—´å†…çš„æ±‡æ€»å’Œæºè®°å½•è¦†ç›–æƒ…å†µã€‚",
      "brandMedia.media": "åª’ä½“",
      "brandMedia.revenue": "Revenue",
      "brandMedia.orders": "è®¢å•æ•°",
      "brandMedia.activeDays": "æ´»è·ƒå¤©æ•°",
      "brandMedia.firstSeen": "é¦–ä¸ªè®°å½•",
      "brandMedia.lastSeen": "æœ€åè®°å½•",
      "brandMedia.selectBrand": "å…ˆé€‰æ‹©ä¸€ä¸ªå“ç‰Œï¼Œå³å¯åŠ è½½è¯¥å“ç‰Œæ‰€æœ‰åª’ä½“çš„æ¯æ—¥è®¢å•æ•°ã€‚",
      "brandMedia.loading": "æ­£åœ¨è¯»å–è¯¥å“ç‰Œçš„åª’ä½“è®¢å•æ•°è¶‹åŠ¿â€¦",
      "brandMedia.noData": "è¿™ä¸ªå“ç‰Œåœ¨æ‰€é€‰æ—¶é—´å†…æ²¡æœ‰åª’ä½“è®¢å•è®°å½•ã€‚",
      "brandMedia.loadError": "æ— æ³•è¯»å–å“ç‰Œåª’ä½“è¶‹åŠ¿ï¼Œè¯·è°ƒæ•´æ—¥æœŸèŒƒå›´åé‡è¯•ã€‚",
      "brandMedia.lineCount": "æ¡åª’ä½“çº¿",
      "brandMedia.publisherCount": "æ´»è·ƒåª’ä½“",
      "brandMedia.totalRevenue": "Revenue",
      "brandMedia.totalOrders": "è®¢å•æ•°",
      "brandMedia.totalOrdersForDate": "å½“æ—¥æ€»è®¢å•æ•°",
      "brandMedia.totalRevenueForDate": "å½“æ—¥æ€» Revenue",
      "brandMedia.allMedia": "å…¨éƒ¨åª’ä½“",
      "brandMedia.lockedMedia": "å·²é”å®šåª’ä½“",
      "brandMedia.lockedCount": "å·²é”å®š",
      "brandMedia.lock": "ç‚¹å‡»é”å®šè¯¥åª’ä½“",
      "brandMedia.unlock": "ç‚¹å‡»è§£é™¤è¯¥åª’ä½“é”å®š",
      "brandMedia.noLockedData": "å½“å‰é”å®šåª’ä½“åœ¨æ‰€é€‰æ—¶é—´å†…æ²¡æœ‰æºè®°å½•ã€‚ç‚¹å‡»å³ä¾§åª’ä½“å¯è§£é™¤é”å®šã€‚",
      "brandMedia.mediaOrdersForDate": "è¯¥åª’ä½“å½“æ—¥è®¢å•æ•°",
      "brandMedia.mediaRevenueForDate": "è¯¥åª’ä½“å½“æ—¥ Revenue",
      "brandMedia.noRecord": "æ— æºè®°å½•",
      "brandMedia.observations": "åª’ä½“æ—¥æœŸè®°å½•",
      "brandMedia.coverage": "æ•°æ®è¦†ç›–",
      "revenueFlow.title": "Revenue æµå‘",
      "revenueFlow.subtitle": "è¿½è¸ªä¸€ä¸ªæˆ–å¤šä¸ªå“ç‰Œçš„ Revenue å¦‚ä½•ä»å•å“æµå‘äº§ç”Ÿ Revenue çš„åª’ä½“ã€‚",
      "revenueFlow.liveSource": "è®¢å•çº§ Revenue",
      "revenueFlow.brand": "å“ç‰Œï¼ˆå¯å¤é€‰ï¼‰",
      "revenueFlow.brandPlaceholder": "æœç´¢å¹¶å¤é€‰å“ç‰Œæˆ–å•†å®¶ ID",
      "revenueFlow.selectedBrands": "å·²é€‰å“ç‰Œ",
      "revenueFlow.clearBrands": "æ¸…ç©º",
      "revenueFlow.brandLimit": "æœ€å¤šå¯é€‰æ‹© 12 ä¸ªå“ç‰Œã€‚",
      "revenueFlow.brandCount": "ä¸ªå“ç‰Œ",
      "revenueFlow.timeRange": "æ—¶é—´è·¨åº¦",
      "revenueFlow.startDate": "å¼€å§‹æ—¥æœŸ",
      "revenueFlow.endDate": "ç»“æŸæ—¥æœŸ",
      "revenueFlow.sourceNote": "åªç»Ÿè®¡æ­£æ•°è®¢å• Revenueï¼›æ¯ä¸ªåª’ä½“éƒ½æ˜¯æµå‘çš„ç»ˆç‚¹ã€‚",
      "revenueFlow.chartTitle": "Revenue æµå‘ï¼šå“ç‰Œ â†’ å•å“ â†’ åª’ä½“",
      "revenueFlow.chartSubtitle": "æŒ‰æ‰€é€‰æ—¶é—´è·¨åº¦æ±‡æ€»äº§ç”Ÿ Revenue çš„å•å“åŠå…¶å¯¹åº”åª’ä½“ã€‚",
      "revenueFlow.brandColumn": "å“ç‰Œ",
      "revenueFlow.products": "äº§ç”Ÿ Revenue çš„å•å“",
      "revenueFlow.media": "å¯¹åº”åª’ä½“",
      "revenueFlow.productCount": "ä¸ªå•å“",
      "revenueFlow.mediaCount": "ä¸ªåª’ä½“",
      "revenueFlow.loading": "æ­£åœ¨åŠ è½½å“ç‰Œã€å•å“ä¸åª’ä½“çš„ Revenue æµå‘â€¦",
      "revenueFlow.error": "æ— æ³•è¯»å– Revenue æµå‘ï¼Œè¯·è°ƒæ•´æ—¥æœŸèŒƒå›´åé‡è¯•ã€‚",
      "revenueFlow.empty": "å½“å‰æ—¶é—´è·¨åº¦æ²¡æœ‰å¯å±•ç¤ºçš„ Revenue å•å“â€”åª’ä½“æµå‘ã€‚",
      "revenueFlow.unavailable": "è®¢å•æ•°æ®æš‚æœªæä¾›å•å“å­—æ®µï¼Œæ— æ³•ç”Ÿæˆ Revenue æµå‘ã€‚",
      "revenueFlow.selectBrand": "è¯·è‡³å°‘é€‰æ‹©ä¸€ä¸ªå“ç‰Œï¼Œå³å¯åŠ è½½ Revenue æµå‘ã€‚",
      "revenueFlow.totalRevenue": "Revenue",
      "revenueFlow.linkCount": "æ¡æµå‘",
      "revenueFlow.expandChart": "å±•å¼€å›¾è¡¨",
      "googleAds.title": "Google å¹¿å‘Šå·¥ä½œå°",
      "googleAds.subtitle": "è¿æ¥ Google å¹¿å‘ŠæŠ•æ”¾ä¸åª’ä½“ ID 19 çš„ Amazon å•†å®¶çº§åå°å›ä¼ ã€‚",
      "googleAds.account": "Google Ads è´¦æˆ·",
      "googleAds.accountPending": "ç­‰å¾…è´¦æˆ·æ•°æ®",
      "googleAds.timeRange": "æ—¶é—´è·¨åº¦",
      "googleAds.startDate": "å¼€å§‹æ—¥æœŸ",
      "googleAds.endDate": "ç»“æŸæ—¥æœŸ",
      "googleAds.refresh": "åˆ·æ–°",
      "googleAds.joinNote": "æŒ‰å•†å®¶ Ã— æ—¥æœŸä¿å®ˆè¿æ¥ï¼›æœªåŒ¹é…èŠ±è´¹ä¼šç»§ç»­å•ç‹¬å±•ç¤ºã€‚",
      "googleAds.trendTitle": "æ¯æ—¥èŠ±è´¹ä¸åå° Revenue",
      "googleAds.trendSubtitle": "æŸ±å½¢è¡¨ç¤º Google èŠ±è´¹ï¼ŒæŠ˜çº¿è¡¨ç¤º YeahPromos Amazon Revenueã€‚",
      "googleAds.spend": "å¹¿å‘ŠèŠ±è´¹",
      "googleAds.backendRevenue": "åå° Revenue",
      "googleAds.merchantTitle": "å•†å®¶è¿æ¥è¡¨",
      "googleAds.merchantSubtitle": "åå°ç»“æœæŒ‰å•†å®¶åªç»Ÿè®¡ä¸€æ¬¡ï¼›Google campaign æ±‡æ€»åˆ°åŒ¹é…å“ç‰Œã€‚",
      "googleAds.merchant": "å•†å®¶",
      "googleAds.match": "è¿æ¥çŠ¶æ€",
      "googleAds.campaigns": "Campaign",
      "googleAds.googleClicks": "Google ç‚¹å‡»",
      "googleAds.backendClicks": "åå°ç‚¹å‡»",
      "googleAds.orders": "è®¢å•",
      "googleAds.roas": "å•†å®¶çº§ ROAS",
      "googleAds.cpa": "å•å‡èŠ±è´¹",
      "googleAds.unmatchedTitle": "æœªåŒ¹é… Google campaign",
      "googleAds.unmatchedSubtitle": "åœ¨åŒ¹é…å•†å®¶åˆ«åæˆ– ASIN å‰ï¼Œç›¸å…³èŠ±è´¹ä¼šç»§ç»­ä¿ç•™ã€‚",
      "googleAds.methodTitle": "æ•°æ®å£å¾„",
      "googleAds.methodSubtitle": "å±•ç¤ºè¿æ¥èŒƒå›´ï¼Œä»¥åŠåˆ»æ„ä¿æŒåˆ†ç¦»çš„æ•°æ®ã€‚",
      "googleAds.loading": "æ­£åœ¨è¯»å– Google Ads ä¸åå°å›ä¼ â€¦",
      "googleAds.loaded": "æ•°æ®å·²è¿æ¥ï¼š{campaigns} ä¸ª campaignï¼Œ{merchants} ä¸ªå•†å®¶ã€‚",
      "googleAds.error": "æ— æ³•è¯»å– Google Ads å·¥ä½œå°ï¼Œè¯·æ£€æŸ¥æœåŠ¡ç«¯é…ç½®åé‡è¯•ã€‚",
      "googleAds.empty": "å½“å‰æ—¶é—´èŒƒå›´æ²¡æœ‰å¯å±•ç¤ºçš„æ•°æ®ã€‚",
      "googleAds.matchName": "å“ç‰ŒååŒ¹é…",
      "googleAds.matchAsin": "ASIN åŒ¹é…",
      "googleAds.matchManual": "æ‰‹åŠ¨åˆ«å",
      "googleAds.unmatched": "æœªåŒ¹é…",
      "googleAds.matchedSpend": "å·²åŒ¹é…èŠ±è´¹",
      "googleAds.coverage": "èŠ±è´¹åŒ¹é…ç‡",
      "googleAds.nativeConversions": "Google åŸç”Ÿè½¬åŒ–",
      "googleAds.merchantRoas": "å•†å®¶çº§ ROAS",
      "googleAds.sourceGoogle": "Google æ¥æº",
      "googleAds.sourceBackend": "åå°æ¥æº",
      "googleAds.joinGrain": "è¿æ¥ç²’åº¦",
      "googleAds.joinRule": "è¿æ¥è§„åˆ™",
      "googleAds.caveat": "å½’å› è¾¹ç•Œ",
      "revenueFlow.collapseChart": "é€€å‡ºå±•å¼€è§†å›¾",
      "revenueFlow.canvasHint": "æ‹–åŠ¨ä»»æ„ä½ç½®å³å¯å‘å·¦ã€å³ã€ä¸Šã€ä¸‹å¹³ç§»ï¼›æŒ‰ä½ Space å¯ä¸´æ—¶ä½¿ç”¨æŠ“æ‰‹å·¥å…·",
      "revenueFlow.canvasControls": "æ‹–åŠ¨å¹³ç§» Â· Shift+æ»šè½®æ¨ªå‘æ»šåŠ¨ Â· Ctrl/âŒ˜+æ»šè½®ç¼©æ”¾ Â· ç‚¹å‡»å•å“æˆ–åª’ä½“é”å®šå…³è”",
      "revenueFlow.canvasLocked": "å·²é”å®š",
      "revenueFlow.canvasPan": "å¹³ç§»ç”»å¸ƒ",
      "revenueFlow.canvasPanActive": "é€€å‡ºå¹³ç§»æ¨¡å¼",
      "revenueFlow.canvasZoomOut": "ç¼©å°",
      "revenueFlow.canvasZoomIn": "æ”¾å¤§",
      "revenueFlow.canvasResetView": "é‡ç½®è§†å›¾",
      "revenueFlow.canvasLabel": "å¯äº¤äº’çš„ Revenue æµå‘ç”»å¸ƒ",
      "revenueFlow.canvasToolbar": "ç”»å¸ƒæ§åˆ¶",
      "revenueFlow.flowTitle": "Flow è¯¦æƒ…",
      "revenueFlow.flowRevenue": "Revenue",
      "revenueFlow.flowSourceShare": "æ¥æºå æ¯”",
      "revenueFlow.flowTargetShare": "å»å‘å æ¯”",
      "label.All markets": "å…¨å¸‚åœº",
      "label.All": "å…¨éƒ¨",
      "action.search": "æœç´¢",
      "action.export": "å¯¼å‡º",
      "tier.searchPlaceholder": "å•†å®¶ã€IDã€åŸå› ã€æ¨è",
      "tier.networkAgency": "ç½‘ç»œ / Agency",
      "label.Brand": "å“ç‰Œ",
      "label.Merchant": "å•†å®¶",
      "label.Market": "å¸‚åœº",
      "label.Merchant ID": "å•†å®¶ ID",
      "label.Tier": "åˆ†å±‚",
      "label.Network": "ç½‘ç»œ",
      "label.Region": "åœ°åŒº",
      "label.Category": "å“ç±»",
      "label.Month": "æœˆä»½",
      "label.Status": "çŠ¶æ€",
      "label.Search": "æœç´¢",
      "label.Country": "å›½å®¶",
      "label.Orders": "è®¢å•",
      "label.Payment": "ä»˜æ¬¾",
      "label.Move": "ç§»åŠ¨",
      "label.Highlight": "é‡ç‚¹",
      "label.Publisher Count": "Publisher æ•°é‡",
      "label.Success Rate": "æˆåŠŸç‡",
      "label.Tier 2 Optimization Idea": "Tier 2 ä¼˜åŒ–å»ºè®®",
      "label.Revenue": "æ”¶å…¥",
      "label.Commission": "ä½£é‡‘",
      "label.Action": "åŠ¨ä½œ",
      "label.Cycle": "å‘¨æœŸ",
      "label.Available": "é¢„è®¡æ”¶æ¬¾æ—¥æœŸ",
      "label.Expected Payment Date": "é¢„è®¡æ”¶æ¬¾æ—¥æœŸ",
      "label.Payment Made": "ä»˜æ¬¾æ—¥æœŸ",
      "label.Notes": "å¤‡æ³¨",
      "label.Records": "è®°å½•",
      "label.Merchants": "å•†å®¶æ•°",
      "label.Columns": "åˆ—æ•°",
      "label.Offers": "Offer æ•°",
      "label.Commission EPC": "ä½£é‡‘ EPC",
      "label.AOV": "AOV",
      "label.CVR": "CVR",
      "label.Revenue made": "äº§ç”Ÿæ”¶å…¥",
      "label.Commission made": "äº§ç”Ÿä½£é‡‘",
      "label.All Commission": "æ€»ä½£é‡‘",
      "label.Aff Commission": "è”ç›Ÿä½£é‡‘",
      "label.EPC(All)": "EPC(All)",
      "label.EPC(Aff)": "EPC(Aff)",
      "label.Last checked": "ä¸Šæ¬¡æ£€æŸ¥",
      "label.Payment rate": "ä»˜æ¬¾ç‡",
      "label.Paid": "å·²ä»˜æ¬¾",
      "label.Pending": "å¾…å¤„ç†",
      "label.Unpaid": "æœªä»˜æ¬¾",
      "label.Overdue": "é€¾æœŸ",
      "label.Unpaid risk": "ä»˜æ¬¾é£é™©",
      "label.Unpaid merchants": "æœªä»˜æ¬¾å•†å®¶",
      "label.Pending merchants": "å¾…å¤„ç†å•†å®¶",
      "label.Overdue rows": "åˆ°æœŸ/é€¾æœŸè®°å½•",
      "label.Offers in category": "è¯¥å“ç±» Offer",
      "label.Average AOV": "å¹³å‡ AOV",
      "label.Blended EPC": "ç»¼åˆ EPC",
      "label.Average CVR": "å¹³å‡ CVR",
      "label.Best by EPC": "EPC æœ€ä½³",
      "label.Best by CVR": "CVR æœ€ä½³",
      "label.Best by revenue": "æ”¶å…¥æœ€ä½³",
      "label.Best by commission": "ä½£é‡‘æœ€ä½³",
      "label.Payment risk": "ä»˜æ¬¾é£é™©",
      "label.Caution watch": "æ³¨æ„è§‚å¯Ÿ",
      "label.Rows": "è¡Œæ•°",
      "label.Brand Count": "å“ç‰Œæ•°",
      "label.Total Clicks": "æ€»ç‚¹å‡»",
      "label.Order Count": "è®¢å•æ•°",
      "label.New Tier Entries": "æ–°è¿›åˆ†å±‚",
      "label.Tier Exits": "é€€å‡ºåˆ†å±‚",
      "label.Target": "ç›®æ ‡",
      "option.All tiers": "å…¨éƒ¨åˆ†å±‚",
      "option.All networks": "å…¨éƒ¨ç½‘ç»œ",
      "option.All regions": "å…¨éƒ¨åœ°åŒº",
      "option.All categories": "å…¨éƒ¨å“ç±»",
      "option.All months": "å…¨éƒ¨æœˆä»½",
      "option.All status": "å…¨éƒ¨çŠ¶æ€",
      "option.All countries": "å…¨éƒ¨å›½å®¶",
      "option.US": "ç¾å›½",
      "option.Canada": "åŠ æ‹¿å¤§",
      "option.UK": "è‹±å›½",
      "option.FR": "æ³•å›½",
      "option.DE": "å¾·å›½",
      "option.Paid": "å·²ä»˜æ¬¾",
      "option.Unpaid": "æœªä»˜æ¬¾",
      "option.Pending": "å¾…å¤„ç†",
      "option.Overdue": "é€¾æœŸ",
      "option.Partial": "éƒ¨åˆ†ä»˜æ¬¾",
      "option.Unknown": "æœªçŸ¥",
      "option.Default priority": "é»˜è®¤ä¼˜å…ˆçº§",
      "option.Ascending": "å‡åº",
      "option.Descending": "é™åº",
      "move.original": "åŸå§‹",
      "move.movedFrom": "ä»åŸå±‚çº§ç§»åŠ¨",
      "option.February": "äºŒæœˆ",
      "option.March": "ä¸‰æœˆ",
      "option.April": "å››æœˆ",
      "option.May": "äº”æœˆ",
      "option.June": "å…­æœˆ",
      "quick.aiper": "Aiper",
      "quick.beauty": "æ¨è 5 ä¸ªç¾å¦† offer",
      "quick.tier2": "Tier 2",
      "quick.unpaid": "å“ªäº› offer æœªä»˜æ¬¾ï¼Ÿ",
      "quick.april": "å››æœˆæœªä»˜æ¬¾",
      "quick.asin": "æŸ¥æ‰¾ ASIN B0D2HKCMBP",
      "context.defaultTitle": "ä¸Šä¸‹æ–‡æ¦‚è§ˆ",
      "context.defaultSubtitle": "æ•´ä½“ offer å¿«ç…§",
      "context.recommendationTitle": "æ¨èæ¦‚è§ˆ",
      "context.merchantTitle": "å•†å®¶æ•°æ®",
      "context.asinTitle": "ASIN æ•°æ®",
      "context.categoryTitle": "å“ç±»æ¦‚è§ˆ",
      "context.tierTitle": "åˆ†å±‚æ¦‚è§ˆ",
      "context.paymentTitle": "ä»˜æ¬¾æ¦‚è§ˆ",
      "context.generalFiltered": "å½“å‰ç­›é€‰è§†å›¾",
      "context.basedOn": "åŸºäºï¼š",
      "context.noMatches": "æ²¡æœ‰æ‰¾åˆ°åŒ¹é…è®°å½•ã€‚",
      "payment.followup": "éœ€è¦è·Ÿè¿›çš„å•†å®¶",
      "payment.none": "æ— ",
      "payment.checkable": "å¯æ£€æŸ¥",
      "payment.pending": "æœªåˆ°æ£€æŸ¥æ—¶é—´",
      "payment.summary": "ä»˜æ¬¾æ¦‚è§ˆ",
      "payment.recordsAcross": "æ¡è®°å½•ï¼Œè¦†ç›–",
      "payment.merchants": "ä¸ªå•†å®¶",
      "payment.unpaid": "æœªä»˜æ¬¾",
      "payment.pendingCount": "å¾…å¤„ç†",
      "payment.overdue": "åˆ°æœŸ/é€¾æœŸ",
      "payment.cycle": "ä»˜æ¬¾å‘¨æœŸ",
      "payment.notAvailable": "å½“å‰æ•°æ®ä¸å¯ç”¨",
      "payment.tableCount": "æ¡ä»˜æ¬¾è®°å½•åŒ¹é…",
      "table.offerCount": "ä¸ª offer åŒ¹é…",
      "dataset.loaded": "ä¸ª offers å·²åŠ è½½ / ç”Ÿæˆäº",
      "payments.stampSaved": "æ¡å·²ä¿å­˜ Levanta ä»˜æ¬¾è®°å½• / å¯æŒ‰å‘¨æœŸæ£€æŸ¥ / æ£€æŸ¥æ—¥æœŸ",
      "payments.stampLive": "æ¡ Levanta å®æ—¶ä»˜æ¬¾è®°å½• / æ£€æŸ¥æ—¥æœŸ",
      "payments.stampUnavailable": "æ¡å·²ä¿å­˜ Levanta ä»˜æ¬¾è®°å½• / å®æ—¶ API ä¸å¯ç”¨ / æ£€æŸ¥æ—¥æœŸ",
      "sheet.targets": "æœˆåº¦ç›®æ ‡",
      "sheet.noTargets": "å½“å‰è¡¨æ ¼å¯¼å‡ºä¸­æ²¡æœ‰ç›®æ ‡è¡Œ",
      "sheet.noTargetMatch": "å½“å‰ç­›é€‰æ²¡æœ‰åŒ¹é…çš„ç›®æ ‡æ•°æ®ã€‚",
      "sheet.targetSummary": "ç›®æ ‡å’Œè¡¨ç°æ±‡æ€»",
      "sheet.noTargetNotes": "å½“å‰é€‰æ‹©æ²¡æœ‰æ–‡å­—ç›®æ ‡å¤‡æ³¨ã€‚",
      "sheet.targetRecords": "æœˆåº¦ç›®æ ‡è®°å½•",
      "sheet.targetRows": "æ¡ç›®æ ‡è®°å½•",
      "tier.imported": "ä» Google Sheets å¯¼å…¥",
      "tier.notFound": "æœªæ‰¾åˆ° Google Sheet æ ‡ç­¾é¡µ",
      "tier.noMatch": "å½“å‰å¯¼å‡ºä¸­æ²¡æœ‰æ‰¾åˆ°åŒ¹é…çš„ Sheet æ ‡ç­¾é¡µã€‚",
      "tier.columnsButton": "æ˜¾ç¤º",
      "tier.columnsTitle": "æ˜¾ç¤ºå­—æ®µ",
      "tier.columnsHint": "é€‰æ‹©è¦æ˜¾ç¤ºçš„å­—æ®µ",
      "tier.coreColumns": "é»˜è®¤",
      "tier.allColumns": "å…¨éƒ¨",
      "language.button.zh": "ä¸­æ–‡ç®€ä½“",
      "language.button.en": "English",
      "memory.hint": "å°†é¢æ¿æ‹–å…¥æ­¤å¤„ä½œä¸ºä¸Šä¸‹æ–‡",
      "deep.title": "æ·±åº¦åˆ†æ",
      "deep.export": "å¯¼å‡º",
      "deep.close": "å…³é—­",
      "deep.skeleton.step1": "æ­£åœ¨åˆ†ææ•°æ®â€¦",
      "deep.skeleton.step2": "",
      "deep.skeleton.step3": "",
      "deep.error": "åˆ†æå¤±è´¥ï¼Œè¯·ç¨åé‡è¯•ã€‚",
      "deep.mode.fast": "èŠå¤©æ¨¡å¼",
      "deep.mode.deep": "æŠ¥å‘Šæ¨¡å¼",
      "deep.placeholder": "åœ¨ Deep Window ä¸­æŸ¥çœ‹åˆ†æç»“æœâ€¦",
      "deep.fast.placeholder": "è¯¢é—® EPCã€åˆ†å±‚ã€AOVã€è½¬åŒ–ç‡ã€æœªä»˜æ¬¾ offerâ€¦",
      "deep.report.defaultTitle": "åˆ†ææŠ¥å‘Š",
      "report.modeGuideKicker": "æŠ¥å‘Šæ¨¡å¼",
      "report.modeGuideTitle": "å…ˆè·å–æ•°æ®æŠ¥å‘Š",
      "report.modeGuideBody": "Report Mode ç”¨äºæŸ¥è¯¢å•†æˆ·ã€ASINã€å“ç±»å’ŒæŒ‡æ ‡ï¼Œç”Ÿæˆç»“æ„åŒ–åˆ†ææŠ¥å‘Šã€‚",
      "report.modeGuideReminder": "å…·ä½“è¦æ±‚è¯·è½¬è‡³èŠå¤©æ¨¡å¼",
      "deep.chat.summaryPrefix": "ğŸ“Š æ·±åº¦åˆ†æï¼š",
      "deep.chat.errorPrefix": "ğŸ“Š æ·±åº¦åˆ†æå¤±è´¥ï¼š",
      "deep.chat.clickToExpand": "ç‚¹å‡»æŸ¥çœ‹å®Œæ•´åˆ†æ",
      "deep.chart.title": "è¶‹åŠ¿å›¾è¡¨",
      "deep.error.http": "åˆ†æè¯·æ±‚å¤±è´¥ï¼ˆ{status}ï¼‰ï¼Œè¯·ç¨åé‡è¯•ã€‚",
      "deep.error.return": "åˆ†æè¿”å›å¼‚å¸¸ï¼Œè¯·ç¨åé‡è¯•ã€‚",
      "deep.error.network": "ç½‘ç»œè¯·æ±‚å¤±è´¥ï¼Œè¯·æ£€æŸ¥è¿æ¥åé‡è¯•ã€‚",
      "deep.stop": "åœæ­¢",
      "deep.stopAborted": "åˆ†æå·²å–æ¶ˆã€‚",
      "report.helpBtn": "ä½¿ç”¨è¯´æ˜",
      "report.userFlowGuideBtn": "ä½¿ç”¨æµç¨‹",
      "report.userFlowGuideTitle": "Chatbot ä½¿ç”¨æµç¨‹",
      "chat.logs": "æ—¥å¿—",
      "report.helpOpen": "æ”¶èµ·ä½¿ç”¨è¯´æ˜",
      "report.helpClose": "ä½¿ç”¨è¯´æ˜",
      "report.langBtn.zh": "ä¸­æ–‡",
      "report.langBtn.en": "English",
      "tour.button": "ğŸ“ æ–°æ‰‹å¼•å¯¼",
      "deep.chatAdd": "åŠ å…¥å¯¹è¯",
      "deep.chatAdded": "å·²åŠ å…¥",
      "chat.addedMessage": "æŠ¥å‘Šã€Œ{title}ã€å·²åŠ å…¥å¯¹è¯ï¼Œè¯•è¯•é—®ï¼š",
      "chat.goReport": "å»ç”ŸæˆæŠ¥å‘Š",
      "chat.starterAsk": "æ ¹æ®è®°å¿†æ çš„æŠ¥å‘Šï¼Œç»™æˆ‘åˆ†æå»ºè®®",
      "chat.starterPlan": "æ€»ç»“è®°å¿†æ çš„æ•°æ®ï¼Œåˆ†æä¸‹ä¸ªæœˆçš„è¿è¥æ–¹å‘"
    }
  };

  function t(key, fallback = key) {
    if (state.language !== "zh") return fallback;
    return translations.zh[key] || fallback;
  }

  function labelText(label) {
    return t(`label.${label}`, label);
  }

  function optionText(value) {
    return t(`option.${value}`, value);
  }

  function statusText(value) {
    return t(`option.${value}`, value || "Unknown");
  }

  function responseLanguageFor(prompt = state.currentQuery) {
    const language = chatbotI18n.normalizeLanguage
      ? chatbotI18n.normalizeLanguage(state.language)
      : (state.language === "zh" ? "zh" : "en");
    if (chatbotI18n.responseLanguage) return chatbotI18n.responseLanguage(prompt, language);
    return state.language === "zh" ? "zh" : "en";
  }

  function createChatQuestionSessionId() {
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    }
    return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`.slice(0, 64);
  }

  function getChatQuestionSessionId() {
    if (chatQuestionPageSessionId) return chatQuestionPageSessionId;
    try {
      const saved = String(localStorage.getItem(CHAT_QUESTION_SESSION_KEY) || "").trim();
      if (/^[A-Za-z0-9._:-]{16,64}$/.test(saved)) {
        chatQuestionPageSessionId = saved;
        return saved;
      }
      chatQuestionPageSessionId = createChatQuestionSessionId();
      localStorage.setItem(CHAT_QUESTION_SESSION_KEY, chatQuestionPageSessionId);
    } catch (error) {
      chatQuestionPageSessionId = createChatQuestionSessionId();
    }
    return chatQuestionPageSessionId;
  }

  function createChatQuestionEventId() {
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
    const bytes = new Uint8Array(16);
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      cryptoApi.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  function detectQuestionLogIntent(prompt) {
    try {
      const detected = chatbotI18n.detectIntent ? chatbotI18n.detectIntent(prompt) : "unknown";
      const normalized = String(detected || "unknown").trim().toLowerCase();
      return /^[a-z][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : "unknown";
    } catch (error) {
      return "unknown";
    }
  }

  async function beginQuestionLog(prompt, mode, language, intent, eventId) {
    const questionEventId = eventId || createChatQuestionEventId();
    try {
      const response = await fetch("/api/chat/stream?operation=questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          eventId: questionEventId,
          sessionId: getChatQuestionSessionId(),
          mode,
          prompt,
          language,
          intent: intent || "unknown"
        })
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload && payload.recordId ? payload : null;
    } catch (error) {
      console.warn("[chat-question-log] create failed:", error);
      return null;
    }
  }

  function completeQuestionLog(startPromise, status, intent) {
    return Promise.resolve(startPromise).then(async function (started) {
      if (!started || !started.recordId) return null;
      try {
        const response = await fetch("/api/chat/stream?operation=questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "complete",
            recordId: started.recordId,
            sessionId: getChatQuestionSessionId(),
            status,
            intent: intent || "unknown"
          })
        });
        if (!response.ok) {
          console.warn("[chat-question-log] completion failed: HTTP " + response.status);
          return null;
        }
        return started;
      } catch (error) {
        console.warn("[chat-question-log] completion failed:", error);
        return null;
      }
    }).catch(function (error) {
      console.warn("[chat-question-log] lifecycle failed:", error);
      return null;
    });
  }

  // Agent Trace åªå‘é€é˜¶æ®µå…ƒæ•°æ®ï¼Œä¸å‘é€ Promptã€å·¥å…·å‚æ•°ã€å·¥å…·ç»“æœæˆ–å›ç­”æ­£æ–‡ã€‚
  function normalizeAgentTraceError(error) {
    if (error && (error.name === "AbortError" || error.stopped)) return "stopped_by_user";
    var rawCode = error && typeof error === "object" && error.errorCode
      ? String(error.errorCode).trim().toLowerCase() : "";
    var allowedCodes = [
      "unknown", "validation_error", "request_error", "network_error", "database_error",
      "llm_unavailable", "llm_timeout", "provider_error", "tool_error", "tool_timeout",
      "synthesis_unavailable", "no_verifiable_source", "stopped_by_user", "trace_write_failed"
    ];
    if (allowedCodes.indexOf(rawCode) !== -1) return rawCode;
    var text = String(error && (error.message || error.error || error) || rawCode || "").toLowerCase();
    if (/timeout|timed out|è¶…æ—¶/.test(text)) return "llm_timeout";
    if (/synthesis|ç»¼åˆ|stream/.test(text)) return "synthesis_unavailable";
    if (/tool|å·¥å…·|invalid_filter|not_found|æœªæ‰¾åˆ°/.test(text)) return "tool_error";
    if (/no verifiable|å¯éªŒè¯|æ•°æ®æ¥æº/.test(text)) return "no_verifiable_source";
    if (/api key|unavailable|ä¸å¯ç”¨/.test(text)) return "llm_unavailable";
    if (/database|mysql|sql|æ•°æ®åº“/.test(text)) return "database_error";
    if (/network|fetch|http|ç½‘ç»œ/.test(text)) return "network_error";
    return "request_error";
  }

  function agentTraceDataMeta(result) {
    var source = result && result.trace && result.trace.dataSource;
    var data = result && result.data && typeof result.data === "object" ? result.data : (result || {});
    var estimated = !!(result && result.trace && result.trace.estimated);
    if (result && result.trace && result.trace.dataAsOf) {
      // ä¿ç•™æœåŠ¡ç«¯å·¥å…·å…ƒæ•°æ®ä¸­çš„å¿«ç…§æ—¶é—´ï¼Œä¸ç”¨æµè§ˆå™¨å½“å‰æ—¶é—´å¡«å……ã€‚
    }
    if (!["cache", "database", "mixed", "unknown"].includes(source)) {
      if (data.monthlyDataSource === "db") source = "mixed";
      else if (data.estimated || estimated) source = "cache";
      else if (data.tool || data.metrics || data.summary || data.rows) source = "cache";
      else source = "unknown";
    }
    var dataAsOf = result && result.trace && result.trace.dataAsOf
      ? String(result.trace.dataAsOf)
      : (data.dataAsOf ? String(data.dataAsOf) : null);
    if (!dataAsOf && source === "cache") {
      var sources = window.CHATBOT_DATA && window.CHATBOT_DATA.sources;
      dataAsOf = sources && sources.checkedAt ? String(sources.checkedAt) : null;
    }
    return { dataSource: source, dataAsOf: dataAsOf || null, estimated: !!(data.estimated || estimated) };
  }

  function createAgentTraceContext(questionEventId, language) {
    return {
      runId: createAgentTraceRunId(),
      questionEventId: String(questionEventId || ""),
      sessionId: getChatQuestionSessionId(),
      language: language === "en" ? "en" : "zh",
      sequence: 0,
      startedAt: Date.now(),
      steps: [],
      retryCounts: Object.create(null),
      writeChain: Promise.resolve(null),
      startPromise: null,
      completionPromise: null
    };
  }

  function agentTraceIsoTime(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") {
      try { return new Date(value).toISOString(); } catch (error) { return null; }
    }
    return String(value);
  }

  function agentTraceNumber(value) {
    var numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : null;
  }

  function agentTraceJsonBytes(value) {
    var textValue = "";
    try { textValue = JSON.stringify(value) || ""; } catch (error) { return null; }
    try {
      return encodeURIComponent(textValue).replace(/%[0-9a-f]{2}/gi, "x").length;
    } catch (error) {
      return textValue.length;
    }
  }

  function agentTraceArgumentSignature(value) {
    if (Array.isArray(value)) {
      return "[" + value.map(agentTraceArgumentSignature).join(",") + "]";
    }
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ":" + agentTraceArgumentSignature(value[key]);
      }).join(",") + "}";
    }
    var serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  }

  function createAgentTraceRunId() {
    var candidate = createChatQuestionEventId();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
      return candidate;
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
      var random = Math.random() * 16 | 0;
      var value = char === "x" ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function agentTraceStepPayload(context, step) {
    step = step || {};
    var allowedPhases = ["planning", "tool", "synthesis"];
    var allowedStatuses = ["success", "failed", "stopped", "timeout"];
    var phase = allowedPhases.indexOf(String(step.phase || "")) !== -1 ? String(step.phase) : "tool";
    var status = String(step.status || "failed");
    if (status === "done") status = "success";
    if (status === "error") status = "failed";
    if (allowedStatuses.indexOf(status) === -1) status = "failed";
    var usageAvailable = step.usageAvailable === true;
    var dataMeta = agentTraceDataMeta(step.result || step);
    var dataSource = step.dataSource || dataMeta.dataSource || "unknown";
    if (["cache", "database", "mixed", "unknown"].indexOf(String(dataSource)) === -1) dataSource = "unknown";
    var payload = {
      runId: context.runId,
      questionEventId: context.questionEventId,
      sequence: ++context.sequence,
      phase: phase,
      toolName: step.toolName ? String(step.toolName).slice(0, 64) : null,
      status: status,
      startedAt: agentTraceIsoTime(step.startedAt),
      completedAt: agentTraceIsoTime(step.completedAt || Date.now()),
      durationMs: agentTraceNumber(step.durationMs),
      provider: step.provider ? String(step.provider).slice(0, 64) : null,
      model: step.model ? String(step.model).slice(0, 128) : null,
      inputBytes: agentTraceNumber(step.inputBytes),
      inputTokens: usageAvailable ? agentTraceNumber(step.inputTokens) : null,
      outputTokens: usageAvailable ? agentTraceNumber(step.outputTokens) : null,
      totalTokens: usageAvailable ? agentTraceNumber(step.totalTokens) : null,
      usageAvailable: usageAvailable,
      outputChunks: agentTraceNumber(step.outputChunks),
      dataSource: dataSource,
      dataAsOf: step.dataAsOf || dataMeta.dataAsOf || null,
      estimated: step.estimated === true || dataMeta.estimated === true,
      errorCode: step.errorCode ? normalizeAgentTraceError(step.errorCode) : null,
      retryCount: agentTraceNumber(step.retryCount) || 0
    };
    if (payload.errorCode) payload.errorCode = String(payload.errorCode).slice(0, 64);
    return payload;
  }

  function agentTraceRequest(context, payload) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 2500);
    var options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    };
    if (controller) options.signal = controller.signal;
    return fetch("/api/chat/stream?operation=agent_trace", options)
      .then(function (response) {
        if (!response || !response.ok) throw new Error("Trace HTTP " + (response && response.status || 0));
        return response.json().catch(function () { return { ok: true }; });
      })
      .catch(function (error) {
        console.warn("[agent-trace] " + (context && context.runId || "unknown") + " write failed:", normalizeAgentTraceError(error));
        return null;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function startAgentTrace(context) {
    if (!context || context.startPromise) return context && context.startPromise;
    context.startPromise = agentTraceRequest(context, {
      action: "start",
      runId: context.runId,
      questionEventId: context.questionEventId,
      sessionId: context.sessionId,
      mode: "agent",
      language: context.language
    });
    context.writeChain = context.startPromise;
    return context.startPromise;
  }

  function appendAgentTraceSteps(context, steps) {
    if (!context || !Array.isArray(steps) || !steps.length) return Promise.resolve(null);
    if (!context.startPromise) startAgentTrace(context);
    var normalized = steps.map(function (step) {
      var payload = agentTraceStepPayload(context, step);
      context.steps.push(payload);
      return payload;
    });
    var requests = [];
    for (var offset = 0; offset < normalized.length; offset += 16) {
      var batch = normalized.slice(offset, offset + 16);
      var request = function (batch) {
        return function () {
          return agentTraceRequest(context, {
            action: "append",
            runId: context.runId,
            questionEventId: context.questionEventId,
            sessionId: context.sessionId,
            steps: batch
          });
        };
      }(batch);
      context.writeChain = Promise.resolve(context.writeChain).then(request, request);
      requests.push(context.writeChain);
    }
    return Promise.all(requests).then(function (results) { return results[results.length - 1] || null; });
  }

  function completeAgentTrace(context, summary) {
    if (!context) return Promise.resolve(null);
    if (context.completionPromise) return context.completionPromise;
    summary = summary || {};
    var status = ["success", "failed", "stopped", "timeout"].indexOf(String(summary.status || "")) !== -1
      ? String(summary.status) : "failed";
    context.completionPromise = Promise.resolve(context.writeChain).then(function () {
      return agentTraceRequest(context, {
        action: "complete",
        runId: context.runId,
        questionEventId: context.questionEventId,
        sessionId: context.sessionId,
        status: status,
        durationMs: agentTraceNumber(summary.durationMs === undefined ? Date.now() - context.startedAt : summary.durationMs),
        planningBypassed: summary.planningBypassed === true || context.planningBypassed === true,
        partial: summary.partial === true,
        fallbackDelivered: summary.fallbackDelivered === true,
        stoppedByUser: summary.stoppedByUser === true,
        plannedToolCalls: agentTraceNumber(summary.plannedToolCalls) || 0,
        executedToolCalls: agentTraceNumber(summary.executedToolCalls) || 0,
        failedToolCalls: agentTraceNumber(summary.failedToolCalls) || 0,
        errorCode: summary.errorCode ? normalizeAgentTraceError(summary.errorCode) : null
      });
    });
    return context.completionPromise;
  }

  function appendAgentTraceSynthesis(context, reply, status, errorCode, traceMeta) {
    if (!context) return Promise.resolve(null);
    reply = reply || {};
    var usage = reply.usage || {};
    return appendAgentTraceSteps(context, [Object.assign({
      phase: "synthesis"
    }, traceMeta || {}, {
      status: status || (reply.ok ? "success" : "failed"),
      startedAt: reply.startedAt || null,
      completedAt: Date.now(),
      durationMs: reply.durationMs,
      provider: usage.provider,
      model: usage.model,
      inputBytes: reply.inputBytes === undefined || reply.inputBytes === null ? usage.inputBytes : reply.inputBytes,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      usageAvailable: usage.usageAvailable === true,
      outputChunks: reply.responseChunks === undefined || reply.responseChunks === null
        ? usage.outputChunks : reply.responseChunks,
      dataSource: "unknown",
      estimated: false,
      errorCode: errorCode || usage.errorCode || null
    })]);
  }

  async function ensureQuestionLogSuccess(context) {
    let started = await Promise.resolve(context.questionPromise);
    if (started && started.recordId) return started;
    const startPromise = beginQuestionLog(
      context.prompt,
      context.mode,
      context.language,
      context.intent || "unknown",
      context.questionEventId
    );
    context.questionPromise = completeQuestionLog(startPromise, "success", context.intent || "unknown");
    started = await context.questionPromise;
    return started && started.recordId ? started : null;
  }

  async function sendAnswerFeedback(context, reasonCode, reasonDetail) {
    const started = await ensureQuestionLogSuccess(context);
    if (!started || !started.recordId) {
      throw new Error(context.language === "zh" ? "æé—®è®°å½•å°šæœªä¿å­˜ï¼Œè¯·ç¨åé‡è¯•ã€‚" : "The question record is not ready. Please retry.");
    }
    const answer = String(
      Object.prototype.hasOwnProperty.call(context, "answerSnapshot")
        ? context.answerSnapshot
        : (context.getAnswer ? context.getAnswer() : context.answer || "")
    );
    if (!answer.trim()) {
      throw new Error(context.language === "zh" ? "å½“å‰å›ç­”ä¸ºç©ºï¼Œæ— æ³•æäº¤åé¦ˆã€‚" : "This answer is empty and cannot be submitted.");
    }
    context.feedbackEventId = context.feedbackEventId || createChatQuestionEventId();
    const response = await fetch("/api/chat/stream?operation=feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedbackEventId: context.feedbackEventId,
        questionEventId: started.recordId,
        sessionId: getChatQuestionSessionId(),
        mode: context.mode,
        prompt: context.prompt,
        answer,
        language: context.language,
        reasonCode,
        reasonDetail: reasonDetail || ""
      })
    });
    let payload = null;
    try { payload = await response.json(); } catch (error) { payload = null; }
    if (response.status === 409 && payload && payload.code === "feedback_already_exists") {
      return { ok: true, alreadyExists: true };
    }
    if (!response.ok || !payload || payload.ok === false) {
      throw new Error((payload && payload.error) || `HTTP ${response.status}`);
    }
    return payload;
  }

  function closeAnswerFeedbackDialog() {
    if (!els.answerFeedbackDialog) return;
    els.answerFeedbackDialog.classList.add("hidden");
    els.answerFeedbackDialog.setAttribute("aria-hidden", "true");
    const trigger = activeAnswerFeedback && activeAnswerFeedback.button;
    activeAnswerFeedback = null;
    if (trigger && trigger.focus) trigger.focus();
  }

  function openAnswerFeedbackDialog(context, button) {
    if (!els.answerFeedbackDialog || !els.answerFeedbackForm) return;
    activeAnswerFeedback = { context, button };
    if (!Object.prototype.hasOwnProperty.call(context, "answerSnapshot")) {
      context.answerSnapshot = String(context.getAnswer ? context.getAnswer() : context.answer || "");
    }
    const isZh = context.language === "zh";
    const copy = isZh ? {
      title: "å“ªé‡Œä¸æ»¡æ„ï¼Ÿ",
      subtitle: "è¯·é€‰æ‹©ä¸€ä¸ªä¸»è¦åŸå› ï¼Œä¹Ÿå¯ä»¥è¡¥å……è¯´æ˜ã€‚",
      legend: "ä¸»è¦åŸå› ",
      detail: "è¡¥å……è¯´æ˜ï¼ˆå¯é€‰ï¼‰",
      placeholder: "è¯·å‘Šè¯‰æˆ‘ä»¬å“ªé‡Œéœ€è¦æ”¹è¿›",
      cancel: "å–æ¶ˆ",
      submit: "æäº¤åé¦ˆ",
      reasons: {
        inaccurate: "å›ç­”ä¸å‡†ç¡®",
        not_answered: "æ²¡æœ‰å›ç­”é—®é¢˜",
        incomplete_data: "æ•°æ®ä¸å®Œæ•´",
        unclear: "å†…å®¹éš¾ä»¥ç†è§£",
        other: "å…¶ä»–"
      }
    } : {
      title: "What went wrong?",
      subtitle: "Choose one main reason and optionally add details.",
      legend: "Main reason",
      detail: "Additional details (optional)",
      placeholder: "Tell us what could be improved",
      cancel: "Cancel",
      submit: "Submit feedback",
      reasons: {
        inaccurate: "The answer is inaccurate",
        not_answered: "It did not answer the question",
        incomplete_data: "The data is incomplete",
        unclear: "The content is hard to understand",
        other: "Other"
      }
    };
    const setText = function (selector, value) {
      const node = els.answerFeedbackDialog.querySelector(selector);
      if (node) node.textContent = value;
    };
    setText("#answerFeedbackTitle", copy.title);
    setText("#answerFeedbackSubtitle", copy.subtitle);
    setText("#answerFeedbackReasonLegend", copy.legend);
    setText("#answerFeedbackDetailLabel", copy.detail);
    setText("#answerFeedbackCancel", copy.cancel);
    setText("#answerFeedbackSubmit", copy.submit);
    if (els.answerFeedbackClose) {
      els.answerFeedbackClose.setAttribute("aria-label", isZh ? "å…³é—­åé¦ˆçª—å£" : "Close feedback dialog");
    }
    els.answerFeedbackDialog.querySelectorAll("[data-feedback-reason-label]").forEach(function (node) {
      node.textContent = copy.reasons[node.dataset.feedbackReasonLabel] || node.textContent;
    });
    if (els.answerFeedbackDetail) els.answerFeedbackDetail.placeholder = copy.placeholder;
    els.answerFeedbackForm.reset();
    if (els.answerFeedbackSubmit) els.answerFeedbackSubmit.disabled = false;
    if (els.answerFeedbackError) {
      els.answerFeedbackError.textContent = "";
      els.answerFeedbackError.classList.add("hidden");
    }
    els.answerFeedbackDialog.classList.remove("hidden");
    els.answerFeedbackDialog.setAttribute("aria-hidden", "false");
    const firstReason = els.answerFeedbackForm.querySelector('input[name="answerFeedbackReason"]');
    if (firstReason && firstReason.focus) firstReason.focus();
  }

  function trapAnswerFeedbackFocus(event) {
    if (!els.answerFeedbackDialog || els.answerFeedbackDialog.classList.contains("hidden")) return false;
    const focusable = Array.from(els.answerFeedbackDialog.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )).filter(function (node) { return !node.hidden; });
    if (!focusable.length) return false;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function attachAnswerFeedbackButton(host, context) {
    if (!host || !context || host.querySelector?.(".answer-feedback-button")) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-feedback-button";
    button.textContent = context.language === "zh" ? "ğŸ‘è¸©" : "ğŸ‘Dislike";
    const contextId = `answer-feedback-${++answerFeedbackContextCounter}`;
    button.dataset.answerFeedbackContext = contextId;
    answerFeedbackContexts.set(contextId, context);
    host.appendChild(button);
    return button;
  }

  function chatCopy(language) {
    return chatbotI18n.copy ? chatbotI18n.copy(language) : {};
  }

  function chatFormat(template, values) {
    if (chatbotI18n.format) return chatbotI18n.format(template, values);
    return String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
  }

  function chatLabelText(label, language) {
    if (chatbotI18n.label) return chatbotI18n.label(label, language);
    return language === "zh" ? label : labelText(label);
  }

  function promptHasPaymentTerms(text) {
    return /payment|paid|unpaid|late|issue|cycle|ä»˜æ¬¾|æœªä»˜æ¬¾|æ²¡ä»˜æ¬¾|å·²ä»˜æ¬¾|é€¾æœŸ|åˆ°æœŸ|å‘¨æœŸ|ä½£é‡‘|æ¬ æ¬¾|å¾…å¤„ç†|éƒ¨åˆ†ä»˜æ¬¾/.test(String(text || "").toLowerCase());
  }

  function applyStaticLanguage() {
    document.documentElement.lang = state.language === "zh" ? "zh-Hans" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (!el.dataset.i18nFallback) el.dataset.i18nFallback = el.textContent;
      el.textContent = t(el.dataset.i18n, el.dataset.i18nFallback);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      if (!el.dataset.i18nPlaceholderFallback) el.dataset.i18nPlaceholderFallback = el.getAttribute("placeholder") || "";
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder, el.dataset.i18nPlaceholderFallback));
    });
    if (els.languageToggle) {
      els.languageToggle.textContent = state.language === "zh"
        ? t("language.button.en", "English")
        : t("language.button.zh", "ä¸­æ–‡ç®€ä½“");
    }
  }

  function syncDashboardOptionLabels() {
    const defaults = [
      [els.tier, "All tiers"],
      [els.network, "All networks"],
      [els.category, "All categories"]
    ];
    defaults.forEach(([select, label]) => {
      const option = select && select.querySelector('option[value="all"]');
      if (option) option.textContent = optionText(label);
    });
  }

  function updateQuickPromptLabels() {
    Array.from(els.quickActions.querySelectorAll("[data-prompt-key]")).forEach((button) => {
      button.textContent = t(button.dataset.promptKey, button.dataset.prompt);
    });
  }

  function setDatasetStamp() {
    els.stamp.textContent = `${offers.length.toLocaleString()} ${t("dataset.loaded", "offers loaded / generated")} ${data.summary.generatedAt || ""}`;
  }

  function setPaymentStamp(mode = "saved", checkedAt = isoDate(PAYMENT_TODAY)) {
    const count = paymentRecords.length.toLocaleString();
    if (mode === "live") {
      els.paymentStamp.textContent = `${count} ${t("payments.stampLive", "live Levanta payment records / checked")} ${checkedAt}`;
      return;
    }
    if (mode === "unavailable") {
      els.paymentStamp.textContent = `${count} ${t("payments.stampUnavailable", "saved Levanta payment records / live API unavailable / checked")} ${checkedAt}`;
      return;
    }
    els.paymentStamp.textContent = `${count} ${t("payments.stampSaved", "saved Levanta payment records / cycle-aware availability / checked")} ${checkedAt}`;
  }

  function rerenderForLanguage() {
    applyStaticLanguage();
    if (els.userFlowGuidePanel && !els.userFlowGuidePanel.classList.contains("hidden")) {
      loadUserFlowGuide();
    }
    syncDashboardOptionLabels();
    updateQuickPromptLabels();
    _refreshChatStarterLanguage(); // ã€Œå·²åŠ å…¥å¯¹è¯ã€ç¤ºä¾‹ chips è·Ÿéšè¯­è¨€åˆ‡æ¢
    // deep windowã€ŒåŠ å…¥å¯¹è¯ã€æŒ‰é’®æ–‡æœ¬è·Ÿéšè¯­è¨€ï¼ˆAdded â†” å·²åŠ å…¥ï¼‰
    _deepPanels.forEach(function (p) { _syncChatAddButton(p); });
    refreshPaymentFilterOptions();
    refreshTargetFilters();
    syncControls();
    syncPaymentControls();
    setDatasetStamp();
    setPaymentStamp(state.livePaymentsLoaded ? "live" : "saved");
    if (state.page === "payments") {
      if (els.paymentsPage && els.paymentsPage.classList.contains("is-modern")) {
        if (window.OI_MODERN_APP && typeof window.OI_MODERN_APP.setLanguage === "function") {
          window.OI_MODERN_APP.setLanguage(state.language);
        }
      } else {
        renderPaymentsPage();
      }
    } else if (state.page === "publishers") {
      if (els.publishersPage && els.publishersPage.classList.contains("is-modern")) {
        if (window.OI_MODERN_APP && typeof window.OI_MODERN_APP.setLanguage === "function") {
          window.OI_MODERN_APP.setLanguage(state.language);
        }
      } else {
        renderPublishersPage();
      }
    } else if (state.page === "sheets") {
      if (els.sheetPage && els.sheetPage.classList.contains("is-modern")) {
        if (window.OI_MODERN_APP && typeof window.OI_MODERN_APP.setLanguage === "function") {
          window.OI_MODERN_APP.setLanguage(state.language);
        }
      } else {
        renderSheetPage();
      }
    } else if (state.page === "category") {
      if (els.categoryPage && els.categoryPage.classList.contains("is-modern")) {
        if (window.OI_MODERN_APP && typeof window.OI_MODERN_APP.setLanguage === "function") {
          window.OI_MODERN_APP.setLanguage(state.language);
        }
      } else {
        ensureDashboardCategoryReportData();
      }
    } else if (state.page === "tier") {
      renderTierPage(state.selectedTierPage);
    } else if (state.page === "monthly-new-merchants") {
      if (els.monthlyNewMerchantsPage && els.monthlyNewMerchantsPage.classList.contains("is-modern")) {
        if (window.OI_MODERN_APP && typeof window.OI_MODERN_APP.setLanguage === "function") {
          window.OI_MODERN_APP.setLanguage(state.language);
        }
      } else {
        renderMonthlyNewMerchantsPage();
      }
    } else if (state.page === "offer-list-tracker") {
      if (els.offerListTrackerPage && els.offerListTrackerPage.classList.contains("is-modern")) {
        if (window.OI_MODERN_APP && typeof window.OI_MODERN_APP.setLanguage === "function") {
          window.OI_MODERN_APP.setLanguage(state.language);
        }
      } else {
        renderOfferListTrackerPage();
      }
    } else if (state.page === "brand-media") {
      if (els.brandMediaPage && els.brandMediaPage.classList.contains("is-modern")) {
        if (window.OI_MODERN_APP && typeof window.OI_MODERN_APP.setLanguage === "function") {
          window.OI_MODERN_APP.setLanguage(state.language);
        }
      } else {
        renderBrandMediaPage();
      }
    } else if (state.page === "google-ads") {
      renderGoogleAdsPage();
    } else if (state.page === "agent") {
      // Agent é¡µé¢å†…å®¹ç”±ç‹¬ç«‹ä¼šè¯çŠ¶æ€ç»´æŠ¤ï¼›ç©ºä¼šè¯æ—¶åŒæ­¥æ¢å¤æç¤ºçš„è¯­è¨€ã€‚
      renderAgentPageWelcomeIfIdle();
    } else {
      renderAll();
      if (state.currentContext.type !== "default") renderContextPanel(state.currentContext);
    }
    updateMobileCurrentPage();
  }

  function toggleLanguage() {
    state.language = state.language === "zh" ? "en" : "zh";
    localStorage.setItem("offerLanguage", state.language);
    rerenderForLanguage();
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function isAvailable(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== "";
  }

  function textValue(value) {
    return isAvailable(value) ? String(value) : "not available in current data";
  }

  function money(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function shortMoney(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function moneyWithSymbol(value, symbol = "$") {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return `${symbol}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function paymentCurrencySymbol(record = {}) {
    const region = normalizeRegion(record.region || record.marketplace || record.country || record.countryCode);
    const currency = String(record.currency || "").trim().toUpperCase();
    if (region === "UK" || currency === "GBP") return "Â£";
    if (region === "DE" || region === "FR" || currency === "EUR") return "â‚¬";
    return "$";
  }

  function paymentMoney(record, value) {
    return moneyWithSymbol(value, paymentCurrencySymbol(record));
  }

  function paymentSummaryMoney(rows, value, regionFilter = "") {
    if (String(regionFilter || "").trim().toLowerCase() === "all") return moneyWithSymbol(value, "$");
    const symbols = new Set(rows.map(paymentCurrencySymbol).filter(Boolean));
    const symbol = symbols.size === 1 ? symbols.values().next().value : "$";
    return moneyWithSymbol(value, symbol || "$");
  }

  function paymentCycleText(offer, fallback = "not available in current data") {
    return offer && offer.paymentCycle ? `${offer.paymentCycle} days` : fallback;
  }

  function pct(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return (Number(value) * 100).toFixed(2) + "%";
  }

  function shortPct(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return (Number(value) * 100).toFixed(2) + "%";
  }

  function shortEpc(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return "$" + Number(value).toFixed(3);
  }

  function epc(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return "$" + Number(value).toFixed(3);
  }

  function offerAllCommission(offer) {
    return isAvailable(offer && offer.payout) ? Number(offer.payout) : null;
  }

  function offerAffCommission(offer) {
    return isAvailable(offer && offer.affCommission) ? Number(offer.affCommission) : null;
  }

  function normalizedCommissionRate(value) {
    if (!isAvailable(value)) return null;
    const rate = Number(String(value).replace(/%$/, "").trim());
    if (!Number.isFinite(rate) || rate < 0) return null;
    return Math.abs(rate) <= 1 ? rate : rate / 100;
  }

  function commissionEpcFromTotals(revenue, commission, clicks) {
    const revenueValue = Number(revenue);
    const commissionValue = Number(commission);
    const clicksValue = Number(clicks);
    if (!(revenueValue > 0) || !Number.isFinite(commissionValue) || !(clicksValue > 0)) return 0;
    const commissionRate = commissionValue / revenueValue;
    return revenueValue * commissionRate / clicksValue;
  }

  function offerAllEpc(offer) {
    const clicks = Number(offer && offer.clicks);
    if (!(clicks > 0)) return null;
    if (isAvailable(offer && offer.allEpc)) return Number(offer.allEpc);
    const revenue = Number(offer && offer.salesAmount);
    const all = offerAllCommission(offer);
    const rate = revenue > 0 && all !== null
      ? all / revenue
      : normalizedCommissionRate(offer && offer.commissionRate);
    return revenue > 0 && rate !== null ? revenue * rate / clicks : null;
  }

  function offerAffEpc(offer) {
    const clicks = Number(offer && offer.clicks);
    if (!(clicks > 0)) return null;
    if (isAvailable(offer && offer.affEpc)) return Number(offer.affEpc);
    const revenue = Number(offer && offer.salesAmount);
    const aff = offerAffCommission(offer);
    const rate = revenue > 0 && aff !== null ? aff / revenue : null;
    return revenue > 0 && rate !== null ? revenue * rate / clicks : null;
  }

  let merchantCardSeq = 0; // èŠå¤©åŒºæ¦‚è§ˆå¡ç‰‡å®¹å™¨å”¯ä¸€ id è®¡æ•°å™¨

  function mergeMonthIntoOffer(offer, row) {
    const clicks = Number(row.clicks);
    const allEpc = Number.isFinite(Number(row.payout)) && clicks > 0
      ? Number(row.payout) / clicks
      : null;
    const affEpc = Number.isFinite(Number(row.affiliatePayout)) && clicks > 0
      ? Number(row.affiliatePayout) / clicks
      : null;
    return Object.assign({}, offer, {
      salesAmount: row.revenue,            // Revenue made
      aov: row.aov,
      conversionRate: row.conversionRate,
      payout: row.payout,                  // All Commission
      affCommission: row.affiliatePayout,  // Aff Commissionï¼ˆæ˜ å°„å offerAffEpc/offerAffCommission ç›´æ¥å¤ç”¨ï¼‰
      orders: row.orders,
      clicks: row.clicks,
      allEpc,
      affEpc,
      dpv: row.dpv,
      atc: row.atc
    });
  }

  function selectedMonthRow(monthlyRows, selectedMonth) {
    if (!monthlyRows || !monthlyRows.length) return null;
    if (selectedMonth) {
      const found = monthlyRows.find((r) => r.month === selectedMonth);
      if (found) return found;
    }
    return monthlyRows[0]; // SQL ORDER BY month DESC â†’ [0] ä¸ºæœ€æ–°æœˆ
  }

  function formatMonthLabel(month, language) {
    const parts = String(month || "").split("-");
    const year = parts[0];
    const num = parseInt(parts[1], 10);
    if (!year || !num || isNaN(num)) return month || "";
    if (language === "zh") return year + "å¹´" + num + "æœˆ";
    const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return enMonths[num - 1] + " " + year;
  }

  function merchantMonthPickerHtml(offer, months, selectedMonth, scope, language) {
    const effectiveRow = selectedMonthRow(months, selectedMonth);
    const effective = effectiveRow && effectiveRow.month;
    const options = (months || []).map((m) => {
      const value = String(m.month || "");
      const sel = value && value === effective ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(formatMonthLabel(value, language))}</option>`;
    }).join("");
    const merchantId = escapeHtml(String(offer.merchantId || ""));
    const items = (months || []).map((m) => {
      const value = String(m.month || "");
      const sel = value === effective ? " is-selected" : "";
      const ariaSel = value === effective ? ' aria-selected="true"' : "";
      return `<li role="option" class="month-picker-option${sel}" data-value="${escapeHtml(value)}"${ariaSel}>${escapeHtml(formatMonthLabel(value, language))}</li>`;
    }).join("");
    return `<div class="month-picker" data-merchant-id="${merchantId}" data-card="${escapeHtml(scope)}">
      <select class="merchant-month-picker" data-merchant-id="${merchantId}" data-card="${escapeHtml(scope)}" aria-hidden="true" tabindex="-1">${options}</select>
      <button type="button" class="month-picker-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="month-picker-value">${escapeHtml(formatMonthLabel(effective, language))}</span>
        <svg class="month-picker-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <ul class="month-picker-menu" role="listbox" aria-label="Month">${items}</ul>
    </div>`;
  }

  function closeAllMonthPickers() {
    document.querySelectorAll(".month-picker.is-open").forEach(function (wrap) {
      wrap.classList.remove("is-open");
      const trigger = wrap.querySelector(".month-picker-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function openMonthPicker(wrap) {
    const trigger = wrap.querySelector(".month-picker-trigger");
    const rect = trigger ? trigger.getBoundingClientRect() : null;
    const spaceBelow = rect ? window.innerHeight - rect.bottom : 300;
    wrap.classList.toggle("open-up", spaceBelow < 288);
    wrap.classList.add("is-open");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
  }

  function toggleMonthPicker(wrap) {
    if (wrap.classList.contains("is-open")) closeAllMonthPickers();
    else openMonthPicker(wrap);
  }

  function monthPickerOptionFor(wrap, value) {
    const opts = wrap.querySelectorAll(".month-picker-option");
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].getAttribute("data-value") === value) return opts[i];
    }
    return null;
  }

  function selectMonthOption(wrap, value) {
    const select = wrap.querySelector(".merchant-month-picker");
    const option = monthPickerOptionFor(wrap, value);
    if (!select || !option) return;
    select.value = value;
    const valueEl = wrap.querySelector(".month-picker-value");
    if (valueEl) valueEl.textContent = option.textContent;
    closeAllMonthPickers();
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function monthlyMetricRows(active, language) {
    return [
      ["EPC(All)", epc(offerAllEpc(active))],
      ["EPC(Aff)", epc(offerAffEpc(active))],
      ["CVR", pct(active.conversionRate)],
      ["Revenue", money(active.salesAmount)],
      ["All Commission", money(offerAllCommission(active))],
      ["Aff Commission", money(offerAffCommission(active))],
      ["Orders", countValue(active.orders)],
      ["Clicks", countValue(active.clicks)]
    ];
  }

  function offerByMerchantId(merchantId) {
    const id = String(merchantId || "").trim();
    return id ? offersByMerchantId.get(id) || null : null;
  }

  async function fetchMerchantMonthlyRows(offer, signal) {
    if (!offer) return null;
    const merchantId = String(offer.merchantId || "").trim();
    if (!merchantId) return null;
    const payload = await fetchMerchantMetrics(merchantId, 12, signal);
    const rows = payload && Array.isArray(payload.monthlyAmazonMetrics) ? payload.monthlyAmazonMetrics : null;
    return rows && rows.length ? rows : null;
  }

  function countValue(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return Number(value).toLocaleString();
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  }

  function productKeywordBrandKey(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  }

  function arrayFromKeywordValue(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(arrayFromKeywordValue);
    return String(value)
      .split(/\s*\|\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function mergeUniqueValues(...groups) {
    const seen = new Set();
    const output = [];
    groups.flatMap(arrayFromKeywordValue).forEach((value) => {
      const key = String(value).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
    return output;
  }

  function mergeProductKeywordsIntoOffers(baseOffers, keywordData = {}) {
    const rows = Array.isArray(keywordData.merchants) ? keywordData.merchants : [];
    if (!rows.length) return baseOffers;
    const byId = new Map();
    const byBrand = new Map();
    rows.forEach((row) => {
      const merchantId = String(row.merchantId || "").trim();
      const brandKey = row.brandKey || productKeywordBrandKey(row.merchantName);
      if (merchantId && !byId.has(merchantId)) byId.set(merchantId, row);
      if (brandKey && !byBrand.has(brandKey)) byBrand.set(brandKey, row);
    });
    return baseOffers.map((offer) => {
      const merchantId = String(offer.merchantId || "").trim();
      const keywordRow = byId.get(merchantId) || byBrand.get(productKeywordBrandKey(offer.brand || offer.merchantName));
      if (!keywordRow) return offer;
      // å‘½ä¸­å·²çŸ¥å…³é”®è¯çš„ offerï¼šæ¬¢è¿å± merchantForExample æ®æ­¤è·³è¿‡ï¼Œç‚¹å‡»ç¤ºä¾‹ç¨³å®šèµ° merchant åˆ†æè·¯å¾„
      offer.knownKeyword = true;
      offer.productAsins = mergeUniqueValues(offer.productAsins, keywordRow.productAsins);
      offer.productTitles = mergeUniqueValues(offer.productTitles, keywordRow.productTitles);
      offer.productKeywords = mergeUniqueValues(offer.productKeywords, keywordRow.productKeywords);
      offer.productNameCount = Number(keywordRow.productNameCount) || offer.productNameCount;
      offer.productAsinCount = Number(keywordRow.productAsinCount) || offer.productAsinCount;
      offer.productKeywordSource = keywordData.summary && keywordData.summary.source ? keywordData.summary.source : "product keyword workbook";
      return offer;
    });
  }

  function canonicalTierName(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "black tier" || text === "black") return "BLACK TIER";
    const match = text.match(/tier\s*([1-4])/);
    return match ? `Tier ${match[1]}` : String(value || "").trim();
  }

  function offerKey(offer) {
    return String(offer && (offer.id || `${offer.merchantId || ""}::${normalize(offer.brand)}`));
  }

  function loadTierOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TIER_OVERRIDE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveTierOverrides() {
    localStorage.setItem(TIER_OVERRIDE_KEY, JSON.stringify(tierOverrides));
  }

  function loadTargetOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TARGET_OVERRIDES_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveTargetOverrides() {
    localStorage.setItem(TARGET_OVERRIDES_KEY, JSON.stringify(state.targetOverrides || {}));
  }

  function loadTierVisibleColumns() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TIER_COLUMN_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      if (Array.isArray(parsed["Tier 1"])) {
        parsed["Tier 1"] = parsed["Tier 1"].map((header) => (
          header === "Business Manager" ? "BD" : header
        ));
      }
      return parsed;
    } catch (error) {
      return {};
    }
  }

  function saveTierVisibleColumns() {
    localStorage.setItem(TIER_COLUMN_KEY, JSON.stringify(state.tierVisibleColumns));
  }

  // â”€â”€ è¶‹åŠ¿é¢æ¿ Display columnsï¼ˆåˆ—é€‰æ‹©ï¼‰æŒä¹…åŒ– â”€â”€
  function loadTrendVisibleMetrics() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TREND_COLUMN_KEY) || "null");
      if (Array.isArray(parsed)) {
        const known = TREND_METRIC_DEFS.map((def) => def.key);
        const valid = parsed.filter((key) => known.includes(key));
        if (valid.length) return valid;
      }
    } catch (error) { /* å¿½ç•¥æŸåçš„å­˜å‚¨ */ }
    return DEFAULT_TREND_VISIBLE_METRICS.slice();
  }

  function saveTrendVisibleMetrics() {
    localStorage.setItem(TREND_COLUMN_KEY, JSON.stringify(state.trendVisibleColumns));
  }

  // å½“å‰ç”Ÿæ•ˆçš„å¯è§æŒ‡æ ‡ï¼ˆè‡³å°‘ 1 ä¸ªï¼›æœªè®¾ç½®æ—¶ç”¨é»˜è®¤ 9 ä¸ªï¼‰
  function trendVisibleMetrics() {
    const known = TREND_METRIC_DEFS.map((def) => def.key);
    const filtered = (Array.isArray(state.trendVisibleColumns) ? state.trendVisibleColumns : [])
      .filter((key) => known.includes(key));
    return filtered.length ? filtered : DEFAULT_TREND_VISIBLE_METRICS.slice();
  }

  // æ›´æ–°å¯è§æŒ‡æ ‡å¹¶é‡æ¸²æŸ“è¶‹åŠ¿é¢æ¿
  function setTrendVisibleMetrics(metrics) {
    const known = TREND_METRIC_DEFS.map((def) => def.key);
    state.trendVisibleColumns = (Array.isArray(metrics) ? metrics : [])
      .filter((key) => known.includes(key));
    if (!state.trendVisibleColumns.length) state.trendVisibleColumns = DEFAULT_TREND_VISIBLE_METRICS.slice();
    saveTrendVisibleMetrics();
    rerenderTrendPanel();
  }

  function rerenderTrendPanel() {
    if (!_trendContextData || !els.recBox) return;
    // é‡æ¸²æŸ“å‰è®°å½•åˆ—é¢æ¿å±•å¼€çŠ¶æ€ï¼Œå‹¾é€‰åä¿æŒå±•å¼€ä¾¿äºè¿ç»­å‹¾é€‰
    var prevPanel = els.recBox.querySelector("[data-trend-column-panel]");
    var keepOpen = prevPanel ? !prevPanel.classList.contains("hidden") : false;
    els.recBox.innerHTML = renderTrendContext(_trendContextData);
    if (keepOpen) {
      var panel = els.recBox.querySelector("[data-trend-column-panel]");
      var toggle = els.recBox.querySelector("[data-trend-column-toggle]");
      if (panel && toggle) {
        panel.classList.remove("hidden");
        toggle.setAttribute("aria-expanded", "true");
      }
    }
    // ç›‘å¬å™¨ç»‘å®šåœ¨ recBox å…ƒç´ ä¸Šï¼ˆinnerHTML æ›¿æ¢ä¸å½±å“ï¼‰ï¼ŒbindTrendChartControls
    // å†…éƒ¨ç”¨ _trendBound ä¿æŠ¤ï¼Œä¸ä¼šé‡å¤ç»‘å®š
    bindTrendChartControls();
  }

  function applyTierOverrideToOffer(offer) {
    const targetTier = canonicalTierName(tierOverrides[offerKey(offer)]);
    if (TIER_MOVE_OPTIONS.includes(targetTier)) {
      offer.tier = targetTier;
      offer.tierOverride = true;
    } else {
      offer.tier = offer.originalTier || offer.tier || "Unknown";
      offer.tierOverride = false;
    }
    return offer;
  }

  function tierMoveOptionsHtml(currentTier) {
    const current = canonicalTierName(currentTier);
    return TIER_MOVE_OPTIONS.map((tier) => (
      `<option value="${escapeHtml(tier)}"${tier === current ? " selected" : ""}>${escapeHtml(optionText(tier))}</option>`
    )).join("");
  }

  function tierMoveControlHtml(offer) {
    if (!offer) return "";
    const key = offerKey(offer);
    return `<div class="tier-move-control" data-offer-key="${escapeHtml(key)}">
      <select class="tier-move-select" aria-label="Move ${escapeHtml(offer.brand || "brand")} to tier">
        ${tierMoveOptionsHtml(offer.tier)}
      </select>
      <button class="tier-move-button" type="button" data-offer-key="${escapeHtml(key)}">${escapeHtml(t("action.move", "Move"))}</button>
    </div>`;
  }

  function updatePaymentRowsForTierMove() {
    paymentRecords = visiblePaymentRecords(withPendingPaymentPlaceholders(paymentRecords.map(normalizePaymentRecord)));
    rebuildPaymentIndex();
  }

  function setManualTierMoveFromOffer(offer, targetTier) {
    const sourceTier = canonicalTierName(offer && offer.originalTier);
    const tier = canonicalTierName(targetTier);
    const merchantId = String(offer && offer.merchantId || "").trim();
    const key = originalMoveKeyForRecord({ merchantId, sourceTier });
    if (!key || !isTierMoveTarget(sourceTier) || !isTierMoveTarget(tier)) return false;
    if (tier === sourceTier) {
      delete state.manualTierMoves[key];
      return true;
    }
    const original = originalTierSheetRowIndex.get(key);
    state.manualTierMoves[key] = {
      sourceTier,
      targetTier: tier,
      merchantId,
      merchantName: String((offer && offer.brand) || (original && tierRowMerchantName(original.row)) || "").trim(),
      movedAt: localDateKey(new Date())
    };
    return true;
  }

  async function moveOfferToTier(key, targetTier) {
    const offer = offers.find((item) => offerKey(item) === key);
    const tier = canonicalTierName(targetTier);
    if (!offer || !TIER_MOVE_OPTIONS.includes(tier)) return;
    if (tier === canonicalTierName(offer.originalTier)) {
      delete tierOverrides[key];
    } else {
      tierOverrides[key] = tier;
    }
    const syncedCandidate = setManualTierMoveFromOffer(offer, tier);
    saveTierOverrides();
    applyTierOverrideToOffer(offer);
    if (syncedCandidate) {
      persistManualTierMoves();
      applyManualTierMoves();
    }
    updatePaymentRowsForTierMove();
    refreshPaymentFilterOptions();
    setPaymentStamp(state.livePaymentsLoaded ? "live" : "saved");
    if (state.page === "payments") {
      renderPaymentsPage();
    } else if (state.page === "tier") {
      renderTierPage(state.selectedTierPage);
    } else {
      renderAll();
    }
    if (syncedCandidate) {
      setTierMoveStatus(`Moved ${offer.brand || offer.merchantId || "merchant"}; syncing shared data...`);
      const result = await saveSharedTierMoves("replace");
      setTierMoveStatus(result.ok ? `Moved ${offer.brand || offer.merchantId || "merchant"}; synced for everyone` : `Moved ${offer.brand || offer.merchantId || "merchant"} locally only (${result.error})`);
    }
  }

  function handleTierMoveClick(event) {
    const button = event.target.closest(".tier-move-button");
    if (!button) return;
    const wrapper = button.closest(".tier-move-control");
    const select = wrapper && wrapper.querySelector(".tier-move-select");
    moveOfferToTier(button.dataset.offerKey, select ? select.value : "");
  }

  function words(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  }

  function singularToken(token) {
    const text = String(token || "").toLowerCase();
    if (text.length > 5 && text.endsWith("ies")) return `${text.slice(0, -3)}y`;
    if (text.length > 4 && text.endsWith("s")) return text.slice(0, -1);
    return text;
  }

  const categoryStopWords = new Set([
    "a", "an", "and", "are", "based", "best", "brand", "brands", "category", "for", "from",
    "give", "has", "have", "in", "list", "match", "me", "of", "offer", "offers", "or",
    "please", "pull", "recommend", "recommendation", "recommendations", "show", "that",
    "the", "tier", "to", "top", "want", "with", "æ¨è", "å“ç‰Œ", "å•†å®¶", "å“ç±»", "ç±»åˆ«", "ç±»ç›®",
    "ç»™æˆ‘", "æ˜¾ç¤º", "åˆ—å‡º", "æ‹‰å–", "ä¸‹è½½", "å¯¼å‡º", "æœ€å¥½", "æœ€ä½³", "å‰", "ä¸ª", "æ¬¾", "æ¡"
  ]);

  const keywordStopWords = new Set([
    ...categoryStopWords,
    "about", "all", "around", "candidate", "candidates", "find", "keyword", "keywords",
    "product", "products", "related", "search", "similar", "using", "åŒ…å«", "ç›¸å…³", "å…³é”®è¯",
    "äº§å“", "å•†å“", "ç›¸ä¼¼", "æœç´¢", "æŸ¥æ‰¾"
  ]);

  const skincareProductSignals = [
    "skin care", "skincare", "serum", "toner", "moisturizer", "moisturiser", "sunscreen",
    "cleanser", "face wash", "cleansing oil", "cleansing foam", "face cream", "face moisturizer",
    "lotion", "essence", "ampoule", "exfoliating", "retinol", "hyaluronic acid", "niacinamide",
    "ceramide", "collagen", "pdrn", "snail mucin", "acne", "blackhead", "pimple", "dark spot",
    "redness relief", "skin barrier", "pore care", "toner pad", "face mist", "sheet mask", "face mask",
    "korean skincare", "korean skin care"
  ];

  const nonSkincareDeviceSignals = [
    "hair removal", "laser hair", "ipl", "intense pulsed light", "hair reduction", "permanent hair",
    "permanent hair reduction", "epilator", "depilator", "armpit", "ushr", "sapphire air",
    "ice cooling", "ice-cooling", "body hair", "light hair removal", "laser hair removal", "hair removal device"
  ];

  function meaningfulTokens(value) {
    return words(value)
      .map(singularToken)
      .filter((token) => token.length > 1 && !categoryStopWords.has(token));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  /**
   * å°† Markdown æ–‡æœ¬æ¸²æŸ“ä¸º HTMLï¼ˆè½»é‡çº§æ¸²æŸ“å™¨ï¼‰
   * æ”¯æŒï¼šä»£ç å—ã€è¡Œå†…ä»£ç ã€æ ‡é¢˜ã€åŠ ç²—/æ–œä½“ã€é“¾æ¥ã€åˆ—è¡¨ã€è¡¨æ ¼ã€å¼•ç”¨ã€æ°´å¹³çº¿
   */
  function markdownToHtml(md) {
    if (!md) return "";
    var text = String(md);

    // 1. æå–å›´æ ä»£ç å—ï¼Œç”¨å ä½ç¬¦æ›¿æ¢
    var codeBlocks = [];
    var placeholderIdx = 0;
    text = text.replace(/```(\w*)\s*\n([\s\S]*?)```/g, function(_, lang, code) {
      var langClass = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
      var html = '<pre><code' + langClass + '>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>';
      var ph = '%%%CODEBLOCK' + (placeholderIdx++) + '%%%';
      codeBlocks.push({ ph: ph, html: html });
      return ph;
    });

    // 2. æå–è¡Œå†…ä»£ç 
    var inlineCodeBlocks = [];
    text = text.replace(/`([^`]+)`/g, function(_, code) {
      var html = '<code>' + escapeHtml(code) + '</code>';
      var ph = '%%%INLINECODE' + (placeholderIdx++) + '%%%';
      inlineCodeBlocks.push({ ph: ph, html: html });
      return ph;
    });

    // 3. è½¬ä¹‰ HTML ç‰¹æ®Šå­—ç¬¦ï¼ˆä»£ç å—å’Œè¡Œå†…ä»£ç å·²ç»å¤„ç†è¿‡ï¼Œä¸è½¬ä¹‰ï¼‰
    text = text.replace(/&(?!amp;|lt;|gt;|quot;|#39;)/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;');

    // 4. å¤„ç†è¡Œå†…æ ¼å¼ï¼šåŠ ç²—ã€æ–œä½“ã€åˆ é™¤çº¿ã€é“¾æ¥ã€å›¾ç‰‡
    // å›¾ç‰‡ ![alt](url) â€” å¿…é¡»åœ¨é“¾æ¥ä¹‹å‰å¤„ç†ï¼Œé¿å… ![ è¢«é“¾æ¥æ­£åˆ™æ•è·
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
    // é“¾æ¥ [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // åŠ ç²—+æ–œä½“ *** ***
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // åŠ ç²— ** **
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // æ–œä½“ * * ï¼ˆä½†ä¸æ˜¯è¢« ** åŒ…å›´çš„ï¼‰
    text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // åˆ é™¤çº¿ ~~ ~~
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // 5. æ¢å¤è¡Œå†…ä»£ç å ä½ç¬¦
    inlineCodeBlocks.forEach(function(item) {
      text = text.replace(item.ph, item.html);
    });

    // 6. å¤„ç†å—çº§å…ƒç´ 
    var lines = text.split('\n');
    var html = '';
    var inList = false;      // true æ—¶æ­£åœ¨ ul/ol ä¸­
    var listType = null;     // 'ul' æˆ– 'ol'
    var listBuffer = [];
    var inTable = false;
    var tableBuffer = [];
    var inBlockquote = false;

    function flushList() {
      if (listBuffer.length) {
        html += '<' + listType + '>\n' + listBuffer.join('\n') + '\n</' + listType + '>\n';
        listBuffer = [];
      }
      inList = false;
      listType = null;
    }

    function flushTable() {
      if (inTable) {
        html += '</tbody>\n</table>\n</div>\n';
        inTable = false;
      }
    }

    function flushBlockquote() {
      if (inBlockquote) {
        html += '</blockquote>\n';
        inBlockquote = false;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      // ç©ºè¡Œ
      if (!trimmed) {
        flushList();
        flushTable();
        flushBlockquote();
        html += '\n';
        continue;
      }

      // æ°´å¹³çº¿
      if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
        flushList();
        flushTable();
        flushBlockquote();
        html += '<hr>\n';
        continue;
      }

      // æ ‡é¢˜
      var headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        flushList();
        flushTable();
        flushBlockquote();
        var level = headerMatch[1].length;
        html += '<h' + level + '>' + headerMatch[2] + '</h' + level + '>\n';
        continue;
      }

      // å¼•ç”¨ï¼ˆ> å·²è¢« HTML è½¬ä¹‰ä¸º &gt;ï¼Œä¸¤è€…éƒ½åŒ¹é…ï¼‰
      var bqMatch = trimmed.match(/^(&gt;|>)\s?(.*)$/);
      if (bqMatch) {
        flushList();
        flushTable();
        if (!inBlockquote) {
          html += '<blockquote>\n';
          inBlockquote = true;
        }
        html += '<p>' + (bqMatch[2] || '<br>') + '</p>\n';
        continue;
      }

      // æ— åºåˆ—è¡¨
      var ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
      if (ulMatch) {
        flushTable();
        flushBlockquote();
        if (!inList || listType !== 'ul') {
          flushList();
          inList = true;
          listType = 'ul';
        }
        var _liContent = ulMatch[1];
        var _taskMatch = _liContent.match(/^\[(x| )\]\s+(.*)$/i);
        if (_taskMatch) {
          var _checked = _taskMatch[1].toLowerCase() === 'x';
          listBuffer.push('<li class="task-list-item' + (_checked ? ' done' : '') + '">' + (_checked ? '<input type="checkbox" checked disabled> ' : '<input type="checkbox" disabled> ') + _taskMatch[2] + '</li>');
        } else {
          listBuffer.push('<li>' + _liContent + '</li>');
        }
        continue;
      }

      // æœ‰åºåˆ—è¡¨
      var olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        flushTable();
        flushBlockquote();
        if (!inList || listType !== 'ol') {
          flushList();
          inList = true;
          listType = 'ol';
        }
        listBuffer.push('<li>' + olMatch[1] + '</li>');
        continue;
      }

      // è¡¨æ ¼ï¼ˆæ£€æµ‹è¡¨å¤´è¡Œï¼Œå¦‚ | col1 | col2 |ï¼‰
      var tableRowMatch = trimmed.match(/^\|(.+)\|$/);
      if (tableRowMatch) {
        flushList();
        flushBlockquote();
        if (!inTable) {
          inTable = true;
          // è¡¨å¤´
          var cells = tableRowMatch[1].split('|').map(function(c) { return c.trim(); });
          html += '<div class="table-wrap">\n<table>\n<thead><tr>';
          cells.forEach(function(c) { html += '<th>' + c + '</th>'; });
          html += '</tr></thead>\n<tbody>\n';
        } else {
          // æ£€æŸ¥æ˜¯å¦æ˜¯åˆ†éš”è¡Œï¼ˆ|---|ï¼‰
          if (/^[\s\|:-]+$/.test(trimmed)) continue;
          var cells = tableRowMatch[1].split('|').map(function(c) { return c.trim(); });
          html += '<tr>';
          cells.forEach(function(c) { html += '<td>' + c + '</td>'; });
          html += '</tr>\n';
        }
        continue;
      } else {
        if (inTable) {
          flushTable();
        }
      }

      // æ™®é€šæ®µè½
      flushList();
      flushTable();
      flushBlockquote();
      html += '<p>' + line + '</p>\n';
    }

    // æ¸…ç†æœ«å°¾æœªå…³é—­çš„å—
    flushList();
    flushTable();
    flushBlockquote();

    // 7. æ¢å¤ä»£ç å—å ä½ç¬¦ï¼ˆç§»é™¤åŒ…è£¹çš„ç©º &lt;p&gt;ï¼‰
    codeBlocks.forEach(function(item) {
      html = html.replace('<p>' + item.ph + '</p>', item.html);
      html = html.replace('<p>' + item.ph + '</p>', item.html); // second pass handles adjacent blocks
      html = html.replace(item.ph, item.html);
    });

    // æ¸…ç†å¤šä½™çš„ç©ºç™½æ®µè½
    html = html.replace(/<p>\s*<\/p>\n?/g, '');
    html = html.replace(/\n{2,}/g, '\n');

    return html.trim();
  }

  // â”€â”€ Report Mode ä½¿ç”¨è¯´æ˜ä¹¦ï¼ˆMarkdown æºæ–‡æœ¬ï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // æ¸²æŸ“åœ¨ Report Mode é—®ç­”åŒºçš„ã€Œä½¿ç”¨è¯´æ˜ã€æŒ‰é’®å±•å¼€é¢æ¿ä¸­ï¼Œç» markdownToHtml è½¬ HTMLã€‚
  // æ³¨æ„ï¼šå†…å®¹ä¸ºæ¨¡æ¿å­—ç¬¦ä¸²ï¼Œé¿å…ä½¿ç”¨æœªè½¬ä¹‰åå¼•å·ä¸ ${ æ’å€¼ã€‚
  const REPORT_MODE_HELP_MD = `# Report Mode ä½¿ç”¨è¯´æ˜

Report Modeï¼ˆæŠ¥å‘Šæ¨¡å¼ï¼‰ç”¨è‡ªç„¶è¯­è¨€æŸ¥è¯¢ä¸åˆ†æ**å•†æˆ· / å“ç±» / Tier / åª’ä½“**ï¼Œæ”¯æŒä¸­è‹±æ–‡æé—®ï¼ˆè‡ªåŠ¨è¯†åˆ«è¯­è¨€ï¼‰ã€‚æé—®åä¼šç”Ÿæˆåˆ†ææŠ¥å‘Šå¹¶å¼¹å‡º Deep Window æµ®çª—ï¼Œå¯ä¸€é”®å¯¼å‡º Excelã€‚

## ä¸€ã€æé—®ç±»å‹å‘½ä»¤

è¾“å…¥æ¡†æ”¯æŒ **/ å¿«æ·èœå•** ä¸ **ç±»å‹: å‘½ä»¤å‰ç¼€** ä¸¤ç§æ–¹å¼æŒ‡å®šæé—®ç±»å‹ï¼Œè®©ç³»ç»Ÿå‡†ç¡®ç†è§£ä½ çš„æ„å›¾ï¼Œå‡å°‘æ„å›¾åˆ¤æ–­é”™è¯¯ã€‚

### ç”¨æ³•

- åœ¨è¾“å…¥æ¡†è¾“å…¥ / å¼¹å‡ºæé—®ç±»å‹èœå•ï¼Œç»§ç»­è¾“å…¥å­—æ¯å¯å¿«é€Ÿè¿‡æ»¤ï¼›ç”¨ **â†‘ / â†“** é€‰æ‹©ï¼Œ**Enter** ç¡®è®¤ï¼Œ**Esc** å…³é—­ã€‚
- é€‰æ‹©åè¾“å…¥æ¡†è‡ªåŠ¨å†™å…¥ **ç±»å‹: ** å‰ç¼€ï¼ˆå¦‚ **trend: shokz**ï¼‰ï¼Œæ¥ç€è¾“å…¥é—®é¢˜å³å¯ã€‚
- ä¹Ÿå¯æ‰‹åŠ¨è¾“å…¥å‰ç¼€ï¼š**merchant:**ã€**category:**ã€**tier:**ã€**categorytier:**ã€**trend:**ã€**payment:**ã€**asin:**ã€**publisher:**ã€**publisherprofile:**ï¼Œæ”¯æŒåŠè§’ä¸å…¨è§’å†’å·ï¼ˆ: ä¸ ï¼šï¼‰ã€‚
- å‘½ä»¤å‰ç¼€åœ¨è¾“å…¥æ¡†ä¸­ä»¥**ç´«è‰²åŠ ç²—**æ˜¾ç¤ºã€‚

### 9 ç§æé—®ç±»å‹

| ç±»å‹ | å‘½ä»¤å‰ç¼€ | ç”¨é€” | ç¤ºä¾‹ |
| --- | --- | --- | --- |
| Merchantï¼ˆå•†æˆ·ï¼‰ | merchant: | æŸ¥è¯¢å•ä¸ªå•†æˆ· | merchant: shokz |
| Categoryï¼ˆå“ç±»ï¼‰ | category: | æŸ¥è¯¢å“ç±» | category: beauty |
| Tier | tier: | æŸ¥è¯¢å±‚çº§ | tier: tier 2 |
| Category & Tierï¼ˆå“ç±» + Tierï¼‰ | Category & Tier: / categorytier: | æŸ¥è¯¢æŸ Tier ä¸‹çš„å“ç±» | categorytier: electronics in tier2 |
| Trendï¼ˆè¶‹åŠ¿ï¼‰ | trend: | è¶‹åŠ¿åˆ†æ | trend: shokz |
| Paymentï¼ˆä»˜æ¬¾ï¼‰ | payment: | ä»˜æ¬¾æŸ¥è¯¢ | payment: é€¾æœŸå•†æˆ· |
| ASIN | asin: | ASIN æŸ¥è¯¢ | asin: B0015S8FPI |
| Publisherï¼ˆåª’ä½“ï¼‰ | publisher: | æŒ‰ç«™ç‚¹ / è”ç›Ÿ / å•†å®¶ / ç»ç†ç­›é€‰åª’ä½“è®°å½• | publisher: amazon.de Amazon å¼ ä¸‰ |
| Publisher Profileï¼ˆåª’ä½“ç”»åƒï¼‰ | publisherprofile: | è¾“å…¥åª’ä½“åç§°æˆ– ID æŸ¥çœ‹åˆä½œå•†å®¶ä¸åå¥½ | publisherprofile: 1022 |

Category & Tier é€‚åˆã€ŒæŸ Tier ä¸‹çš„å“ç±»ã€è¿™ç±»ç»„åˆæŸ¥è¯¢ï¼Œä¾‹å¦‚æŸ¥è¯¢ Tier 2 çš„ Beauty å“ç±»ï¼š**categorytier: beauty in tier2**ã€‚

## äºŒã€æ”¯æŒçš„æé—®ç±»å‹

### 1. å•†æˆ·æŸ¥è¯¢
ç›´æ¥è¾“å…¥å•†æˆ·å / å•†æˆ· ID / ASIN æŸ¥çœ‹æ¦‚è§ˆã€‚

| æ ‡å‡†æé—® | è¯´æ˜ |
| --- | --- |
| Shokz | å•†æˆ·æ¦‚è§ˆï¼ˆå“ç‰Œåï¼‰ |
| 362653 | å•†æˆ· ID æŸ¥è¯¢ |
| B0015S8FPI | ASIN å½’å±æŸ¥è¯¢ |
| åˆ†æ Shokz æ€ä¹ˆæ · | å•†æˆ·æ·±åº¦åˆ†æ |

### 2. å“ç±»æŸ¥è¯¢

| æ ‡å‡†æé—® | è¯´æ˜ |
| --- | --- |
| Beauty å“ç±» | å“ç±»æ¦‚è§ˆ |
| Electronics | å“ç±»ä¸‹ offer æ’è¡Œ |
| ç¾å¦†ç±»åˆ« | ä¸­æ–‡å“ç±»åˆ«å |

### 3. Tier æŸ¥è¯¢

| æ ‡å‡†æé—® | è¯´æ˜ |
| --- | --- |
| Tier 2 | Tier æ¦‚è§ˆ |

### 4. è¶‹åŠ¿åˆ†æ
å…¬å¼ï¼š**å®ä½“ + æ—¶é—´èŒƒå›´ + æŒ‡æ ‡ + è¶‹åŠ¿**ï¼Œæ”¯æŒå•†æˆ· / å“ç±» / Tier ä¸‰ç±»å®ä½“çš„æœˆåº¦è¶‹åŠ¿ã€‚

| æ ‡å‡†æé—® | è¯´æ˜ |
| --- | --- |
| Shokzè¶‹åŠ¿åˆ†æ | å•†æˆ·è¶‹åŠ¿ |
| Beauty ç±»åˆ«çš„è¶‹åŠ¿ | å“ç±»è¶‹åŠ¿ |
| Tier 2 è¿™ä¸ªå­£åº¦çš„è®¢å•è¶‹åŠ¿ | Tier è¶‹åŠ¿ |

### 5. æ”¯ä»˜æŸ¥è¯¢

| æ ‡å‡†æé—® | è¯´æ˜ |
| --- | --- |
| å››æœˆæœªä»˜æ¬¾æœ‰å“ªäº› | æŒ‡å®šæœˆæœªä»˜æ¬¾ |
| é€¾æœŸå•†æˆ· | é€¾æœŸè®°å½• |
| ä»˜æ¬¾å‘¨æœŸè¶…è¿‡ 90 å¤©çš„å•†æˆ· | ä»˜æ¬¾å‘¨æœŸç­›é€‰ |

### 6. åª’ä½“è®°å½•æŸ¥è¯¢

| æ ‡å‡†æé—® | è¯´æ˜ |
| --- | --- |
| åˆ—ä¸€ä¸‹åª’ä½“ | å…¨éƒ¨åª’ä½“åˆ—è¡¨ |
| amazon.de å¸‚åœºçš„åª’ä½“ | æŒ‰ç«™ç‚¹ç­›é€‰ |
| Amazon è”ç›Ÿçš„åª’ä½“ | æŒ‰è”ç›Ÿç­›é€‰ |
| å’Œ Shokz åˆä½œçš„åª’ä½“ | æŒ‰å•†å®¶ç­›é€‰ |
| ç»ç†å¼ ä¸‰çš„åª’ä½“ | æŒ‰ç»ç†ç­›é€‰ |
| é”€å”®æœ€é«˜çš„ 5 ä¸ªåª’ä½“ | æ’åº + é™é¢ |

### 7. åª’ä½“ç”»åƒæŸ¥è¯¢

| æ ‡å‡†æé—® | è¯´æ˜ |
| --- | --- |
| publisherprofile: 1022 | æŒ‰åª’ä½“ ID æŸ¥çœ‹ç”»åƒ |
| publisherprofile: åª’ä½“åç§° | æŒ‰åç§°æŸ¥çœ‹ï¼ˆå¤šåŒ¹é…æ—¶åˆ—å‡ºå€™é€‰ï¼‰ |
| publisherprofile: 1022 amazon.de | æŒ‰ç«™ç‚¹å£å¾„æŸ¥çœ‹ç”»åƒ |

## ä¸‰ã€äº¤äº’è¯´æ˜

- **Deep Window æµ®çª—**ï¼šæé—®åå¼¹å‡ºæŠ¥å‘Šæµ®çª—ï¼Œå¯æ‹–åŠ¨ã€æœ€å°åŒ–ã€å…³é—­ã€å¯¼å‡º Excelã€‚
- **å·¦æ  Context é¢æ¿**ï¼šåŒæ­¥æ˜¾ç¤ºå½“å‰æŸ¥è¯¢çš„ä¸Šä¸‹æ–‡ã€ç»Ÿè®¡å¡ç‰‡ã€è¶‹åŠ¿å›¾è¡¨ã€‚
- **ä¸€é”®å¯¼å‡º**ï¼šåˆ†æç»“æœè¡¨æ ¼å¯ä¸‹è½½ä¸º Excelï¼ˆxlsxï¼‰ã€‚
- **ä¸Šä¸‹æ–‡è¿½é—®**ï¼šå•†æˆ·åˆ†æåç›´æ¥è¿½é—®ã€Œå®ƒçš„ EPCã€ã€Œè®¢å•é‡ã€å³å¯ï¼Œæ— éœ€é‡å¤å•†æˆ·åã€‚
- **ä¸­è‹±æ–‡åˆ‡æ¢**ï¼šå³ä¸Šè§’æŒ‰é’®åˆ‡æ¢ç•Œé¢è¯­è¨€ï¼Œæé—®è¯­è¨€è‡ªåŠ¨è¯†åˆ«ã€‚

## å››ã€æ³¨æ„äº‹é¡¹

- æ•°æ®æ¥è‡ªæ•°æ®åº“ç¼“å­˜ï¼ˆ24h TTLï¼‰ï¼Œåå°è‡ªåŠ¨åˆ·æ–°ã€‚
- è¶‹åŠ¿åˆ†æè‡³å°‘éœ€è¦ 2 ä¸ªæœˆæ•°æ®ï¼›æœªè¿æ¥æ•°æ®åº“æ—¶è‡ªåŠ¨é™çº§ä¸ºä¼°ç®—ï¼ˆæ ‡æ³¨ âš¡ï¼‰ã€‚
- å“ç±»æ”¯æŒåˆ«åä¸å­åˆ†ç±»ï¼Œå¦‚ã€Œç¾å¦†ã€â†’ Beauty & Personal Careã€‚
- é‡‘é¢å•ä½é»˜è®¤ç¾å…ƒï¼ˆ$ï¼‰ï¼›EPC / è½¬åŒ–ç‡æŒ‰å°æ•°æ ¼å¼åŒ–ã€‚

# Chat Mode ä½¿ç”¨è¯´æ˜

Chat Modeï¼ˆèŠå¤©æ¨¡å¼ï¼‰æ˜¯ä¸€ä¸ªåªè¯»æ•°æ®åˆ†æ Agentï¼Œæ”¯æŒè¿ç»­æé—®ã€é€æ­¥è¿½é—®å’Œå¤šè½®è®¨è®ºã€‚

**è®°å¿†æ ä¸æ˜¯å–æ•°å‰æã€‚** Agent å¯ä»¥ç›´æ¥æŸ¥è¯¢å½“å‰ç¼“å­˜ä¸­çš„å•†æˆ·ã€å“ç±»ã€Tierã€ä»˜æ¬¾å’Œè¶‹åŠ¿æ•°æ®ï¼›å°† Report Mode æŠ¥å‘ŠåŠ å…¥è®°å¿†æ åï¼Œå¯ä»¥ç»§ç»­å›´ç»•å®Œæ•´æŠ¥å‘Šè¿½é—®ï¼Œæˆ–è¡¥å…… Agent å°šæœªè¦†ç›–çš„é¢†åŸŸã€‚

## 1. åŸºæœ¬ç”¨æ³•

- åœ¨è¾“å…¥æ¡†ç›´æ¥è¾“å…¥é—®é¢˜ï¼Œå›è½¦å‘é€ï¼Œå›ç­”ä»¥æµå¼é€å­—æ˜¾ç¤ºã€‚
- æ”¯æŒä¸­è‹±æ–‡ï¼Œè‡ªåŠ¨è¯†åˆ«æé—®è¯­è¨€ï¼Œæç¤ºæ–‡æ¡ˆè·Ÿéšç•Œé¢è¯­è¨€ã€‚
- å›ç­”æ”¯æŒ Markdown æ¸²æŸ“ï¼ˆè¡¨æ ¼ã€åˆ—è¡¨ã€åŠ ç²—ç­‰ï¼‰ï¼Œå¯ç”¨å›ç­”ä¸‹æ–¹çš„ã€Œè½¬ä¸º Viewã€æŒ‰é’®åœ¨æµ®çª—ä¸­æ‰“å¼€ã€‚

## 2. èƒ½åŠ›èŒƒå›´

- **å¤šè½®å¯¹è¯**ï¼šè‡ªåŠ¨è®°ä½æœ¬æ®µå¯¹è¯å†å²ï¼Œå¯åŸºäºå‰æ–‡è¿ç»­è¿½é—®ï¼Œæ— éœ€é‡å¤ä¸Šä¸‹æ–‡ã€‚
- **è®°å¿†ä¸Šä¸‹æ–‡**ï¼šå°† Report Mode ç”Ÿæˆçš„æŠ¥å‘Šé¢æ¿æ‹–å…¥èŠå¤©åŒºä¸Šæ–¹çš„è®°å¿†æ ï¼Œå³å¯æŠŠå®ƒä½œä¸ºå½“å‰è®¨è®ºçš„èƒŒæ™¯æ•°æ®ã€‚
- **Agent æ•°æ®åˆ†æ**ï¼šæ”¯æŒå•†æˆ·ã€å“ç±»ã€å•†æˆ·å¯¹æ¯”ã€Tierã€å“ç±»å¯¹æ¯”ã€ä»˜æ¬¾å’Œè¶‹åŠ¿ 7 ç±»åªè¯»å·¥å…·ï¼›å•†æˆ·åˆ†æåœ¨æ•°æ®åº“å¯ç”¨æ—¶é™„å¸¦æœ€è¿‘ 12 ä¸ªæœˆçœŸå®æœˆåº¦æ˜ç»†ã€‚
- **æœˆåº¦æ•°æ®å£å¾„**ï¼šå•†æˆ· metrics æ˜¯å½“å‰ç¼“å­˜æ±‡æ€»ï¼Œmonthly æ˜¯æŒ‰æœ€æ–°æœˆä»½åœ¨å‰æ’åˆ—çš„æ•°æ®åº“æœˆåº¦æ•°æ®ï¼›æœˆåº¦æ¥å£ä¸å¯ç”¨æ—¶è¿”å›ç©ºæ•°ç»„ï¼Œä¸ç”Ÿæˆä¼ªé€ æœˆä»½ã€‚
- **ç»“æœé™çº§**ï¼šå·¥å…·æˆåŠŸä½†è‡ªç„¶è¯­è¨€ç»¼åˆå¤±è´¥æ—¶ï¼Œä»ä¼šå±•ç¤ºç¡®å®šæ€§æ•°æ®æ‘˜è¦ï¼Œä¸ç¼–é€ ç»“è®ºã€‚
- **èŒè´£è¾¹ç•Œ**ï¼šReport Mode ä»æä¾›æ›´å®Œæ•´çš„ç»“æ„åŒ–æŠ¥å‘Šã€Deep Window å’Œ Excel å¯¼å‡ºï¼›ASINã€æ¨èã€å…³é”®è¯ã€åª’ä½“å’Œå†™å…¥æ“ä½œæš‚ä¸ç”± Agent æ‰§è¡Œã€‚

## 3. ä¸ Report Mode çš„åŒºåˆ«

| ç»´åº¦ | Report Mode | Chat Mode |
| --- | --- | --- |
| å®šä½ | ç»“æ„åŒ–æŸ¥è¯¢ä¸å®Œæ•´åˆ†ææŠ¥å‘Š | Agent æ•°æ®å¯¹è¯ä¸å¤šè½®è¿½é—® |
| å›ç­” | å³æ—¶åˆ†æ + Deep Window æµ®çª— | å·¥å…·å–æ•° + æµå¼ç»¼åˆå›ç­” |
| è¿½é—® | å¯¹ä¸Šä¸€å•†æˆ·çš„åŸºç¡€è¿½é—® | å®Œæ•´å¤šè½®ä¸Šä¸‹æ–‡ |
| å¯¼å‡º | ä¸€é”® Excel | è½¬ View åå¯å¯¼å‡º |

## 4. æç¤ºè¯æŠ€å·§

- æé—®å…·ä½“ï¼šå¸¦ä¸ŠæŒ‡æ ‡ä¸æ—¶é—´èŒƒå›´ï¼ˆå¦‚"è¿‡å» 3 ä¸ªæœˆ revenue è¶‹åŠ¿"ï¼‰æ¯”ç¬¼ç»Ÿæé—®æ›´æœ‰æ•ˆã€‚
- éœ€è¦å®Œæ•´æŠ¥å‘Šã€ASINã€æ¨èæˆ–åª’ä½“æ•°æ®æ—¶ï¼šå…ˆåœ¨ Report Mode ç”ŸæˆæŠ¥å‘Šå¹¶åŠ å…¥è®°å¿†æ ã€‚
- è¶‹åŠ¿é—®é¢˜è‡³å°‘éœ€è¦ 2 ä¸ªæœˆæ•°æ®ï¼›æ²¡æœ‰çœŸå®æœˆåº¦æ•°æ®æ—¶ï¼Œå›ç­”ä¼šæ ‡è®°ä¸ºä¼°ç®—ã€‚`;

  // â”€â”€ Report Mode ä½¿ç”¨è¯´æ˜ä¹¦ï¼ˆè‹±æ–‡ç‰ˆ Markdownï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // ä¸ REPORT_MODE_HELP_MD å†…å®¹ä¸€ä¸€å¯¹åº”ï¼Œä¾›è¯´æ˜é¢æ¿è¯­è¨€åˆ‡æ¢æŒ‰é’®åˆ‡æ¢æ˜¾ç¤ºã€‚
  const REPORT_MODE_HELP_MD_EN = `# Report Mode User Guide

Report Mode lets you query and analyze **merchants / categories / tiers / publishers** in natural language, in either Chinese or English (auto-detected). Each query produces an analysis report that opens in a Deep Window popup, with one-click Excel export.

## 1. Question Type Commands

The input box supports both a **/ quick menu** and **type: command prefixes** to specify the question type explicitly, reducing intent misclassification.

### Usage

- Type **/** in the input box to open the question type menu; keep typing letters to filter instantly. Use **â†‘ / â†“** to navigate, **Enter** to select, **Esc** to close.
- Selecting an option writes a **type: ** prefix automatically (e.g. **trend: shokz**); then type your question.
- You can also type a prefix manually: **merchant:**, **category:**, **tier:**, **categorytier:**, **trend:**, **payment:**, **asin:**, **publisher:**, **publisherprofile:**. Both half-width (:) and full-width (ï¼š) colons work.
- The prefix is shown in **bold purple** in the input box.

### The 9 Question Types

| Type | Command prefix | Use | Example |
| --- | --- | --- | --- |
| Merchant | merchant: | Look up a single merchant | merchant: shokz |
| Category | category: | Query a category | category: beauty |
| Tier | tier: | Query a tier | tier: tier 2 |
| Category & Tier | Category & Tier: / categorytier: | Query a category within a tier | categorytier: electronics in tier2 |
| Trend | trend: | Trend analysis | trend: shokz |
| Payment | payment: | Payment queries | payment: overdue merchants |
| ASIN | asin: | ASIN lookup | asin: B0015S8FPI |
| Publisher | publisher: | Filter publisher records by site / network / merchant / manager | publisher: amazon.de Amazon å¼ ä¸‰ |
| Publisher Profile | publisherprofile: | View partner merchants and preferences by publisher name or ID | publisherprofile: 1022 |

Category & Tier fits combined "category within a tier" queries, e.g. the Beauty category in Tier 2: **categorytier: beauty in tier2**.

## 2. Supported Query Types

### 1.1 Merchant Lookup
Type a merchant name / merchant ID / ASIN directly for an overview.

| Standard question | Description |
| --- | --- |
| Shokz | Merchant overview (brand name) |
| 362653 | Merchant ID lookup |
| B0015S8FPI | ASIN ownership lookup |
| Analyze Shokz performance | In-depth merchant analysis |

### 1.2 Category Queries

| Standard question | Description |
| --- | --- |
| Beauty category | Category overview |
| Electronics | Offer ranking within a category |
| Skincare | English category alias |

### 1.3 Tier Queries

| Standard question | Description |
| --- | --- |
| Tier 2 | Tier overview |

### 1.4 Trend Analysis
Formula: **entity + time range + metric + trend**, supporting monthly trends for merchants / categories / tiers.

| Standard question | Description |
| --- | --- |
| Shokz trend analysis | Merchant trend |
| Beauty category trend | Category trend |
| Tier 2 order trend this quarter | Tier trend |

### 1.5 Payment Queries

| Standard question | Description |
| --- | --- |
| Which April payments are unpaid | Unpaid payments in a given month |
| Overdue merchants | Overdue records |
| Merchants with a payment cycle over 90 days | Payment cycle filter |

### 1.6 Publisher Records

| Standard question | Description |
| --- | --- |
| List publishers | Full publisher list |
| Publishers in the amazon.de market | Filter by site |
| Publishers in the Amazon network | Filter by network |
| Publishers partnering with Shokz | Filter by merchant |
| Publishers managed by Zhang San | Filter by manager |
| Top 5 publishers by sales | Sort + limit |

### 1.7 Publisher Profile

| Standard question | Description |
| --- | --- |
| publisherprofile: 1022 | Profile by publisher ID |
| publisherprofile: publisher name | Profile by name (candidates listed on multiple matches) |
| publisherprofile: 1022 amazon.de | Profile scoped to a site |

## 3. Interactions

- **Deep Window**: reports open in a draggable, minimizable, closable popup with Excel export.
- **Context panel**: the left panel shows the current query context, stat cards, and trend charts.
- **One-click export**: analysis result tables can be downloaded as Excel (.xlsx).
- **Context follow-up**: after a merchant analysis, just ask "its EPC" or "order count" without repeating the merchant name.
- **Language**: switch the UI language with the button at the top right; query language is auto-detected.

## 4. Notes

- Data comes from the database cache (24h TTL) and refreshes in the background automatically.
- Trend analysis needs at least 2 months of data; without a DB connection it degrades to an estimate (marked with âš¡).
- Categories support aliases and subcategories, e.g. "skincare" â†’ Beauty & Personal Care.
- Currency defaults to USD ($); EPC / conversion rate are formatted as decimals.

# Chat Mode User Guide

Chat Mode is a read-only data analysis Agent for multi-turn questions and follow-ups.

**The memory bar is optional for data lookup.** The Agent can query supported merchant, category, tier, payment, comparison, and trend data directly. Drag a Report Mode panel into the memory bar when you want to discuss a complete report or a domain not yet covered by Agent tools.

## 1. Basic Usage

- Type a question in the input box and press Enter; the answer streams in token by token.
- Supports both Chinese and English; the input language is auto-detected and prompts follow the UI language.
- Answers are rendered as Markdown (tables, lists, bold, etc.). Use the "Open as View" button below a response to open it in a popup window.

## 2. Capabilities

- **Multi-turn conversation**: remembers the current thread, so you can follow up without restating context.
- **Memory context**: drag a Report Mode report panel into the memory bar above the chat area to use it as background data for the discussion.
- **Agent data analysis**: supports seven read-only tools for merchants, categories, merchant comparisons, tiers, category comparisons, payments, and trends; merchant analysis includes the latest 12 real monthly rows when the database is available.
- **Monthly data contract**: merchant metrics is the current cached summary, while monthly contains newest-first database rows; an unavailable monthly endpoint returns an empty array instead of fabricated months.
- **Graceful fallback**: if synthesis fails after a tool succeeds, the completed tool data remains visible as a deterministic summary.
- **Boundary**: Report Mode remains the full structured-report, Deep Window, and Excel-export path; ASIN, recommendations, keywords, publishers, and write actions are not Agent tools yet.

## 3. Report Mode vs Chat Mode

| Dimension | Report Mode | Chat Mode |
| --- | --- | --- |
| Focus | Structured queries & full analysis reports | Agent data conversation and follow-ups |
| Answer | Instant analysis + Deep Window | Tool execution + streaming synthesis |
| Follow-up | Basic follow-ups on the last merchant | Full multi-turn context |
| Export | One-click Excel | Open as View, then export |

## 4. Prompting Tips

- Be specific: include metrics and time ranges (e.g., "revenue trend for the last 3 months") for better answers than vague questions.
- For full reports, ASINs, recommendations, or publisher data: create a Report Mode report and add it to memory first.
- Trend questions need at least two months of data; answers based on aggregate estimation are marked accordingly.`;

  // å½“å‰è¯´æ˜ä¹¦é¢æ¿è¯­è¨€ï¼ˆ"zh" | "en"ï¼‰ï¼Œé»˜è®¤è·Ÿéšç•Œé¢è¯­è¨€
  function reportHelpLang() {
    var c = els.reportHelpContent;
    return c && c.dataset.lang === "en" ? "en" : "zh";
  }

  // æŒ‰å½“å‰é¢æ¿è¯­è¨€æ¸²æŸ“è¯´æ˜ä¹¦å†…å®¹ï¼Œå¹¶åŒæ­¥è¯­è¨€åˆ‡æ¢æŒ‰é’®æ–‡æ¡ˆ
  function renderReportHelpContent() {
    var c = els.reportHelpContent;
    if (!c) return;
    var en = c.dataset.lang === "en";
    c.innerHTML = markdownToHtml(en ? REPORT_MODE_HELP_MD_EN : REPORT_MODE_HELP_MD);
    injectReportHelpNav(c);
    var langBtn = els.reportHelpLangBtn;
    if (langBtn) langBtn.textContent = en ? t("report.langBtn.zh", "ä¸­æ–‡") : t("report.langBtn.en", "English");
  }

  // æ³¨å…¥è¯´æ˜ä¹¦å¯¼èˆªæ ï¼šé¡¶éƒ¨ä¸¤ä¸ªè·³è½¬æŒ‰é’®ï¼ˆReport Mode / Chat Modeï¼‰ï¼Œç‚¹å‡»å¹³æ»‘æ»šåŠ¨åˆ°å¯¹åº”å¤§èŠ‚ã€‚
  // ç”¨æ³¨å…¥å¼è€Œé markdown é”šç‚¹ï¼Œå› ä¸º markdownToHtml çš„æ ‡é¢˜ä¸ç”Ÿæˆ idã€é“¾æ¥åˆå¼ºåˆ¶æ–°çª—å£ã€‚
  function injectReportHelpNav(c) {
    if (!c) return;
    var nav = document.createElement("nav");
    nav.className = "report-help-nav";
    nav.setAttribute("aria-label", "Guide sections");
    var targets = ["Report Mode", "Chat Mode"];
    nav.innerHTML = targets.map(function (target) {
      return '<button type="button" data-help-nav="' + escapeHtml(target) + '">' + escapeHtml(target) + "</button>";
    }).join("");
    nav.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-help-nav]");
      if (!btn) return;
      var target = btn.getAttribute("data-help-nav");
      var heads = c.querySelectorAll("h1, h2, h3");
      var hit = null;
      heads.forEach(function (h) {
        if (h.textContent.trim().indexOf(target) === 0) hit = h;
      });
      if (hit) hit.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    c.insertBefore(nav, c.firstChild);
  }

  // åˆ‡æ¢è¯´æ˜ä¹¦é¢æ¿è¯­è¨€ï¼ˆä¸­æ–‡ â†” Englishï¼‰
  function toggleReportHelpLang() {
    var c = els.reportHelpContent;
    if (!c) return reportHelpLang();
    c.dataset.lang = c.dataset.lang === "en" ? "zh" : "en";
    renderReportHelpContent();
    return reportHelpLang();
  }

  // å±•å¼€/æ”¶èµ· Report Mode ä½¿ç”¨è¯´æ˜ä¹¦é¢æ¿
  var USER_FLOW_GUIDE_URL = "./chatbot-user-guide.md";
  var USER_FLOW_GUIDE_URL_EN = "./chatbot-user-guide-en.md";
  var userFlowGuideRequest = null;
  var userFlowGuideRequestUrl = null;

  function userFlowGuideUrl() {
    return state.language === "zh" ? USER_FLOW_GUIDE_URL : USER_FLOW_GUIDE_URL_EN;
  }

  function hideUserFlowGuide() {
    var panel = els.userFlowGuidePanel;
    var btn = els.userFlowGuideBtn;
    if (!panel || !btn) return;
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
    btn.classList.remove("active");
    btn.setAttribute("aria-expanded", "false");
  }

  var userFlowImagePreviousFocus = null;

  function enhanceUserFlowGuideImages(content) {
    if (!content || !content.querySelectorAll) return;
    Array.prototype.forEach.call(content.querySelectorAll("img"), function (image, index) {
      image.classList.add("user-flow-guide-image");
      image.setAttribute("tabindex", "0");
      image.setAttribute("role", "button");
      if (!image.getAttribute("aria-label")) {
        image.setAttribute("aria-label", (image.alt || "ä½¿ç”¨æµç¨‹ç¤ºä¾‹å›¾") + "ï¼Œç‚¹å‡»æ”¾å¤§æŸ¥çœ‹");
      }
      image.dataset.guideImageIndex = String(index + 1);
    });
  }

  function openUserFlowImage(image) {
    var lightbox = els.userFlowImageLightbox;
    var preview = els.userFlowImageLightboxImage;
    if (!lightbox || !preview || !image) return;
    userFlowImagePreviousFocus = document.activeElement;
    preview.src = image.currentSrc || image.src || image.getAttribute("src") || "";
    preview.alt = image.alt || "ä½¿ç”¨æµç¨‹ç¤ºä¾‹å›¾";
    if (els.userFlowImageLightboxCaption) {
      els.userFlowImageLightboxCaption.textContent = image.alt || "ä½¿ç”¨æµç¨‹ç¤ºä¾‹å›¾";
    }
    lightbox.classList.remove("hidden");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("user-flow-lightbox-open");
    if (els.userFlowImageLightboxClose) els.userFlowImageLightboxClose.focus();
  }

  function closeUserFlowImage() {
    var lightbox = els.userFlowImageLightbox;
    if (!lightbox) return;
    lightbox.classList.add("hidden");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("user-flow-lightbox-open");
    if (els.userFlowImageLightboxImage) {
      els.userFlowImageLightboxImage.removeAttribute("src");
      els.userFlowImageLightboxImage.alt = "";
    }
    if (userFlowImagePreviousFocus && typeof userFlowImagePreviousFocus.focus === "function") {
      userFlowImagePreviousFocus.focus();
    }
    userFlowImagePreviousFocus = null;
  }

  function userFlowGuideImageFromEvent(event) {
    var target = event && event.target;
    return target && target.closest ? target.closest("img.user-flow-guide-image") : null;
  }

  function handleUserFlowGuideImageClick(event) {
    var image = userFlowGuideImageFromEvent(event);
    if (!image) return;
    event.preventDefault();
    openUserFlowImage(image);
  }

  function handleUserFlowGuideImageKeydown(event) {
    if (!event || (event.key !== "Enter" && event.key !== " ")) return;
    var image = userFlowGuideImageFromEvent(event);
    if (!image) return;
    event.preventDefault();
    openUserFlowImage(image);
  }

  function handleUserFlowImageLightboxClick(event) {
    if (event && event.target === els.userFlowImageLightbox) closeUserFlowImage();
  }

  function handleUserFlowImageDocumentKeydown(event) {
    if (event.key === "Escape" && els.userFlowImageLightbox && !els.userFlowImageLightbox.classList.contains("hidden")) {
      closeUserFlowImage();
    }
  }

  function renderUserFlowGuideContent(markdown) {
    var content = els.userFlowGuideContent;
    if (!content) return;
    content.innerHTML = markdownToHtml(markdown);
    enhanceUserFlowGuideImages(content);
    content.dataset.rendered = "1";
    if (els.userFlowGuideStatus) els.userFlowGuideStatus.textContent = "";
  }

  function loadUserFlowGuide() {
    var content = els.userFlowGuideContent;
    if (!content) return Promise.resolve();
    var guideUrl = userFlowGuideUrl();
    if (userFlowGuideRequest && userFlowGuideRequestUrl === guideUrl) return userFlowGuideRequest;
    if (els.userFlowGuideStatus) {
      els.userFlowGuideStatus.textContent = state.language === "zh" ? "æ­£åœ¨åŠ è½½â€¦" : "Loadingâ€¦";
    }
    userFlowGuideRequestUrl = guideUrl;
    userFlowGuideRequest = fetch(guideUrl, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(function (markdown) {
        if (guideUrl === userFlowGuideUrl()) renderUserFlowGuideContent(markdown);
      })
      .catch(function (error) {
        if (guideUrl === userFlowGuideUrl() && els.userFlowGuideStatus) {
          els.userFlowGuideStatus.textContent = state.language === "zh"
            ? "ä½¿ç”¨æµç¨‹åŠ è½½å¤±è´¥ï¼Œè¯·åˆ·æ–°åé‡è¯•ã€‚"
            : "Unable to load the user guide. Please refresh and try again.";
        }
        console.warn("[user-flow-guide] load failed:", error);
      })
      .finally(function () {
        if (userFlowGuideRequestUrl === guideUrl) {
          userFlowGuideRequest = null;
          userFlowGuideRequestUrl = null;
        }
      });
    return userFlowGuideRequest;
  }

  function toggleUserFlowGuide() {
    var panel = els.userFlowGuidePanel;
    var btn = els.userFlowGuideBtn;
    if (!panel || !btn) return;
    var willShow = panel.classList.contains("hidden");
    if (willShow) {
      if (els.reportHelpPanel && !els.reportHelpPanel.classList.contains("hidden")) toggleReportHelp();
      loadUserFlowGuide();
    }
    panel.classList.toggle("hidden", !willShow);
    panel.setAttribute("aria-hidden", willShow ? "false" : "true");
    btn.classList.toggle("active", willShow);
    btn.setAttribute("aria-expanded", willShow ? "true" : "false");
  }

  function toggleReportHelp() {
    var panel = els.reportHelpPanel;
    var btn = els.reportHelpBtn;
    if (!panel || !btn) return;
    var willShow = panel.classList.contains("hidden");
    if (willShow) hideUserFlowGuide();
    if (willShow && els.reportHelpContent && !els.reportHelpContent.dataset.rendered) {
      els.reportHelpContent.dataset.lang = els.reportHelpContent.dataset.lang || "zh";
      renderReportHelpContent();
      els.reportHelpContent.dataset.rendered = "1";
    }
    panel.classList.toggle("hidden", !willShow);
    btn.classList.toggle("active", willShow);
    btn.setAttribute("aria-expanded", willShow ? "true" : "false");
  }

  function setChatLogsMenuOpen(open) {
    if (!els.chatLogsButton || !els.chatLogsMenu) return;
    els.chatLogsMenu.classList.toggle("hidden", !open);
    els.chatLogsButton.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function downloadChatLogs(kind, format) {
    const safeFormat = format === "jsonl" ? "jsonl" : "csv";
    const safeKind = kind === "feedback" ? "feedback" : "questions";
    const link = document.createElement("a");
    link.href = `/api/chat/stream?operation=${safeKind}&format=${safeFormat}`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setChatLogsMenuOpen(false);
  }

  function downloadChatQuestionLogs(format) {
    downloadChatLogs("questions", format);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function textIncludesAlias(haystack, alias) {
    const term = String(alias || "").toLowerCase().trim();
    if (!term) return false;
    if (/[^\x00-\x7f]/.test(term)) return haystack.includes(term);
    if (term.length <= 3) return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack);
    return haystack.includes(term);
  }

  function cleanCategoryValue(value) {
    const text = String(value || "").trim();
    return text && text !== "Uncategorized" ? text : "";
  }

  function sheetMainCategory(item) {
    if (!item) return "Uncategorized";
    const sheetCategory = cleanCategoryValue(item.sheetCategory);
    if (sheetCategory) return sheetCategory;
    const mainCategory = cleanCategoryValue(item.mainCategory);
    if (mainCategory) return mainCategory;
    const feishuMainCategory = cleanCategoryValue(item.feishuMainCategory);
    if (feishuMainCategory) return feishuMainCategory;
    const category = cleanCategoryValue(item.category);
    if (category && item.categorySource !== "Feishu") return category;
    if (category) return category;
    return cleanCategoryValue(item.levantaCategory) || "Uncategorized";
  }

  function categoryParts(item) {
    return [
      sheetMainCategory(item),
      item && item.sheetCategory,
      item && item.feishuMainCategory,
      item && item.feishuSubCategory,
      item && item.mainCategory,
      item && item.subCategory,
      item && item.mainCategoryCn,
      item && item.subCategoryCn,
      item && item.categoryPath,
      item && item.category,
      item && item.levantaCategory
    ].filter((value) => String(value || "").trim() && String(value).trim() !== "Uncategorized");
  }

  function displayCategory(item) {
    return sheetMainCategory(item);
  }

  function categorySearchText(item) {
    return categoryParts(item).concat(item && item.brand, item && item.merchantName).filter(Boolean).join(" ").toLowerCase();
  }

  let mainCategoryNormsCache = null;

  function uniqueCategoryValues() {
    const values = new Set();
    offers.forEach((offer) => {
      const category = sheetMainCategory(offer);
      if (category !== "Uncategorized") values.add(category);
    });
    return Array.from(values).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  let allCategoryValuesCache = null;

  function allCategoryValues() {
    if (!allCategoryValuesCache) {
      const values = new Set();
      offers.forEach((offer) => {
        categoryParts(offer).forEach((value) => values.add(String(value).trim()));
      });
      allCategoryValuesCache = Array.from(values).sort((a, b) => String(b).length - String(a).length);
    }
    return allCategoryValuesCache;
  }

  function hasMainCategoryValue(category) {
    if (!mainCategoryNormsCache) {
      mainCategoryNormsCache = new Set(uniqueCategoryValues().map((value) => normalize(value)));
    }
    return mainCategoryNormsCache.has(normalize(category));
  }

  function flattenSearchValues(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(flattenSearchValues);
    if (typeof value === "object") return Object.values(value).flatMap(flattenSearchValues);
    const text = String(value).trim();
    return text ? [text] : [];
  }

  function keywordFieldGroups(offer) {
    return {
      merchant: flattenSearchValues([offer.brand, offer.merchantName, offer.merchantId, offer.id]),
      category: flattenSearchValues(categoryParts(offer)),
      product: flattenSearchValues([
        offer.productType,
        offer.product_type,
        offer.productTitle,
        offer.product_title,
        offer.productName,
        offer.product_name,
        offer.productTitles,
        offer.product_titles,
        offer.title,
        offer.asinTitle,
        offer.asin_title,
        offer.asinTitles,
        offer.productKeywords,
        offer.product_keywords,
        offer.keywords,
        offer.dealInfo,
        offer.discountInfo
      ]),
      asin: flattenSearchValues([offer.topAsins, offer.productAsins, offer.asinsText, offer.feishuCategoryAsin]),
      notes: flattenSearchValues([offer.notes, offer.recommendation, offer.recommendationNotes, offer.reason])
    };
  }

  function valuesMatchingAliases(values, aliases) {
    return (values || []).filter((value) => aliases.some((alias) => searchValueMatches(value, alias)));
  }

  function productTitleValues(offer) {
    return flattenSearchValues([
      offer.productTitle,
      offer.product_title,
      offer.productName,
      offer.product_name,
      offer.productTitles,
      offer.product_titles,
      offer.title,
      offer.asinTitle,
      offer.asin_title,
      offer.asinTitles
    ]);
  }

  function qualifiesAsSkincareBrand(offer) {
    const groups = keywordFieldGroups(offer);
    const productValues = groups.product || [];
    const skincareSignals = valuesMatchingAliases(productValues, skincareProductSignals);
    if (!skincareSignals.length) return false;

    const nonSkincareDeviceSignalsFound = valuesMatchingAliases(productValues, nonSkincareDeviceSignals);
    if (!nonSkincareDeviceSignalsFound.length) return true;

    const titles = productTitleValues(offer);
    const skincareTitleCount = valuesMatchingAliases(titles, skincareProductSignals).length;
    const deviceTitleCount = valuesMatchingAliases(titles, nonSkincareDeviceSignals).length;
    return skincareTitleCount > deviceTitleCount;
  }

  function searchValueMatches(value, alias) {
    const haystack = String(value || "").toLowerCase();
    const term = String(alias || "").toLowerCase().trim();
    const termNorm = normalize(term);
    if (!haystack || !term || !termNorm) return false;
    return textIncludesAlias(haystack, term) || normalize(haystack).includes(termNorm);
  }

  function searchValueExactMatches(value, alias) {
    const text = String(value || "").trim();
    const term = String(alias || "").trim();
    if (!text || !term) return false;
    if (normalize(text) === normalize(term)) return true;
    return searchValueMatches(text, term);
  }

  function keywordAliasEntries() {
    const entries = [];
    Object.entries(keywordSynonymMap).forEach(([canonical, synonyms]) => {
      [canonical, ...synonyms].forEach((alias) => {
        entries.push({ canonical, alias });
      });
    });
    return entries.sort((a, b) => String(b.alias).length - String(a.alias).length);
  }

  function addKeywordAlias(aliases, value) {
    const text = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!text || keywordStopWords.has(text)) return;
    aliases.set(normalize(text), text);
    const tokenList = words(text).map(singularToken).filter((token) => token.length > 1 && !keywordStopWords.has(token));
    if (tokenList.length > 1) aliases.set(normalize(tokenList.join(" ")), tokenList.join(" "));
    if (tokenList.length === 1) aliases.set(normalize(tokenList[0]), tokenList[0]);
  }

  function cleanedKeywordPhrase(text) {
    return cleanedCategoryPhrase(text)
      .replace(/\b(?:find|search|keyword|keywords|product|products|related|similar|about|around|all|matching|match)\b/gi, " ")
      .replace(/æœç´¢|æŸ¥æ‰¾|å…³é”®è¯|äº§å“|å•†å“|ç›¸å…³|ç›¸ä¼¼|åŒ¹é…|å…¨éƒ¨|æ‰€æœ‰/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function specificKeywordAliasAllowed(alias, phraseTokens, phrase) {
    const aliasTokens = meaningfulTokens(alias).filter((token) => !keywordStopWords.has(token));
    if (!aliasTokens.length || !phraseTokens.length) return false;
    const phraseNorm = normalize(phrase);
    const aliasNorm = normalize(alias);
    if (aliasNorm.includes(phraseNorm) || phraseNorm.includes(aliasNorm)) return true;
    const overlap = aliasTokens.filter((token) => phraseTokens.includes(token));
    if (overlap.length >= Math.min(2, phraseTokens.length)) return true;
    const lastPhraseToken = phraseTokens[phraseTokens.length - 1];
    return lastPhraseToken && lastPhraseToken.length > 3 && aliasTokens.includes(lastPhraseToken);
  }

  function keywordSearchRequest(prompt) {
    const phrase = cleanedKeywordPhrase(prompt);
    const lower = String(prompt || "").toLowerCase();
    const phraseLower = phrase.toLowerCase();
    const aliases = new Map();
    let canonical = "";
    let matchedAlias = "";
    const phraseTokens = meaningfulTokens(phrase).filter((token) => !keywordStopWords.has(token));
    let restrictToSpecificAlias = false;

    keywordAliasEntries().some((entry) => {
      if (searchValueMatches(phraseLower, entry.alias) || searchValueMatches(lower, entry.alias)) {
        canonical = entry.canonical;
        matchedAlias = entry.alias;
        return true;
      }
      return false;
    });

    if (phrase) addKeywordAlias(aliases, phrase);
    if (canonical) {
      addKeywordAlias(aliases, matchedAlias);
      restrictToSpecificAlias = ["baby", "pet"].includes(canonical) &&
        phraseTokens.length > 1 &&
        normalize(phrase) !== normalize(canonical);
      if (!restrictToSpecificAlias) addKeywordAlias(aliases, canonical);
      (keywordSynonymMap[canonical] || [])
        .filter((alias) => !restrictToSpecificAlias || specificKeywordAliasAllowed(alias, phraseTokens, phrase))
        .forEach((alias) => addKeywordAlias(aliases, alias));
    }

    phraseTokens
      .filter(() => !(canonical && phraseTokens.length > 1))
      .forEach((token) => addKeywordAlias(aliases, token));

    const aliasList = Array.from(aliases.values()).sort((a, b) => b.length - a.length);
    const tokens = meaningfulTokens(aliasList.concat(phrase).join(" ")).filter((token) => !keywordStopWords.has(token));
    const keyword = phrase || canonical || matchedAlias;
    if (!keyword || (!aliasList.length && !tokens.length)) return null;
    return {
      keyword,
      canonical: canonical || "",
      matchedAlias,
      aliases: aliasList,
      primaryAliases: [keyword, canonical, matchedAlias].filter(Boolean),
      synonymAliases: canonical ? (keywordSynonymMap[canonical] || []) : [],
      tokens: Array.from(new Set(tokens)),
      knownKeyword: Boolean(canonical),
      specificKeyword: restrictToSpecificAlias
    };
  }

  function keywordTokenFuzzyScore(groups, request) {
    const tokens = request.tokens || [];
    if (!tokens.length) return 0;
    const haystackTokens = words(Object.values(groups).flat().join(" ")).map(singularToken);
    const matched = tokens.filter((queryToken) => (
      haystackTokens.some((token) => {
        if (token === queryToken) return true;
        if (token.length <= 3 || queryToken.length <= 3) return false;
        if (token.includes(queryToken)) return true;
        if (queryToken.includes(token)) return token.length >= Math.ceil(queryToken.length * 0.75);
        return false;
      })
    ));
    if (matched.length < (tokens.length <= 1 ? 1 : Math.min(2, tokens.length))) return 0;
    return matched.length ? (matched.length / tokens.length) * 260 : 0;
  }

  function keywordAliasIsPrimary(alias, request) {
    const aliasNorm = normalize(alias);
    const primaryNorms = new Set((request.primaryAliases || []).map((value) => normalize(value)).filter(Boolean));
    if (primaryNorms.has(aliasNorm)) return true;
    const primaryTokens = meaningfulTokens((request.primaryAliases || []).join(" ")).filter((token) => !keywordStopWords.has(token));
    const aliasTokens = meaningfulTokens(alias).filter((token) => !keywordStopWords.has(token));
    if (!primaryTokens.length || !aliasTokens.length) return false;
    const overlap = aliasTokens.filter((token) => primaryTokens.includes(token)).length;
    return overlap >= Math.min(primaryTokens.length, primaryTokens.length <= 1 ? 1 : 2);
  }

  function keywordOfferMatch(offer, request) {
    if (!offer || !request) return null;
    if (request.canonical === "skincare" && !qualifiesAsSkincareBrand(offer)) return null;
    const groups = keywordFieldGroups(offer);
    const groupValues = Object.values(groups).flat();
    const categoryValues = groups.category || [];
    const productValues = (groups.product || []).concat(groups.asin || []);
    const primaryAliases = new Set((request.primaryAliases || []).map((alias) => normalize(alias)).filter(Boolean));
    const allAliases = request.aliases || [];
    let best = { score: 0, priority: 99, matchType: "", matchedTerms: [], matchedFields: [] };

    const recordMatch = (priority, baseScore, matchType, alias, field) => {
      const aliasWeight = Math.min(String(alias || "").length, 40);
      const score = baseScore + aliasWeight;
      if (score > best.score || priority < best.priority) {
        best = {
          score,
          priority,
          matchType,
          matchedTerms: [alias],
          matchedFields: [field]
        };
      } else if (score === best.score) {
        best.matchedTerms.push(alias);
        best.matchedFields.push(field);
      }
    };

    allAliases.forEach((alias) => {
      const productExact = productValues.some((value) => searchValueExactMatches(value, alias));
      const categoryExact = categoryValues.some((value) => searchValueExactMatches(value, alias));
      if (productExact || categoryExact || groupValues.some((value) => searchValueExactMatches(value, alias))) {
        const primary = keywordAliasIsPrimary(alias, request);
        recordMatch(primary ? 1 : 3, primary ? 1000 : 660, primary ? "Exact match" : "Synonym match", alias, productExact ? "product" : categoryExact ? "category" : "offer data");
      }
    });

    allAliases.forEach((alias) => {
      if (categoryValues.some((value) => searchValueMatches(value, alias))) {
        const primary = keywordAliasIsPrimary(alias, request);
        recordMatch(primary ? 2 : 3, primary ? 820 : 660, primary ? "Category match" : "Synonym match", alias, "category");
      }
    });

    allAliases.forEach((alias) => {
      const isPrimary = primaryAliases.has(normalize(alias));
      if (!isPrimary && groupValues.some((value) => searchValueMatches(value, alias))) {
        recordMatch(3, 660, "Synonym match", alias, "synonym");
      }
    });

    allAliases.forEach((alias) => {
      if (productValues.some((value) => searchValueMatches(value, alias))) {
        recordMatch(4, 520, "Product/ASIN match", alias, "product");
      }
    });

    const fuzzy = keywordTokenFuzzyScore(groups, request);
    if (!request.specificKeyword && fuzzy >= 120) {
      recordMatch(5, fuzzy, "Fuzzy match", request.tokens.join(", "), "offer text");
    }

    if (!best.score) return null;
    return {
      offer,
      score: best.score,
      priority: best.priority,
      matchType: best.matchType,
      matchedTerms: Array.from(new Set(best.matchedTerms.filter(Boolean))).slice(0, 8),
      matchedFields: Array.from(new Set(best.matchedFields.filter(Boolean))).slice(0, 4)
    };
  }

  function keywordTierPriority(offer, includeTier4 = false, includeBlack = false) {
    if (offer.tier === "Tier 1") return 1;
    if (offer.tier === "Tier 2") return 2;
    if (offer.tier === "Tier 3") return 3;
    if (offer.tier === "Tier 4") return includeTier4 ? 4 : 99;
    if (offer.tier === "BLACK TIER") return includeBlack ? 5 : 100;
    return 50;
  }

  function compareKeywordMatches(a, b, context = {}) {
    const includeTier4 = context.includeTier4 || false;
    const includeBlack = context.includeBlack || false;
    if (context.topMetricRequest) {
      const metricDelta = compareTopMetricRows(a.offer, b.offer, context.topMetricRequest);
      if (metricDelta) return metricDelta;
    }
    return (
      keywordTierPriority(a.offer, includeTier4, includeBlack) - keywordTierPriority(b.offer, includeTier4, includeBlack) ||
      a.priority - b.priority ||
      number(b.score) - number(a.score) ||
      number(b.offer.salesAmount) - number(a.offer.salesAmount) ||
      number(b.offer.orders) - number(a.offer.orders) ||
      number(b.offer.conversionRate) - number(a.offer.conversionRate) ||
      number(b.offer.aov) - number(a.offer.aov) ||
      number(b.offer.epc) - number(a.offer.epc) ||
      String(a.offer.brand || "").localeCompare(String(b.offer.brand || ""), undefined, { numeric: true, sensitivity: "base" })
    );
  }

  function keywordSearchMatches(prompt, options = {}) {
    const request = options.request || keywordSearchRequest(prompt);
    if (!request) return [];
    const includeTier4 = options.includeTier4 || /tier\s*4|retest|ç¬¬å››å±‚|ç¬¬å››çº§|å››å±‚|å››çº§|é‡æµ‹|é‡æ–°æµ‹è¯•/i.test(prompt);
    const includeBlack = options.includeBlack || /black|blocked|é»‘åå•|é»‘è‰²|å±è”½|æš‚åœ/i.test(prompt);
    const tier = options.tier || tierFromPrompt(prompt);
    const metricFilters = options.metricFilters || extractMetricFilters(prompt);
    const topMetricRequest = options.topMetricRequest || null;
    const seen = new Set();
    return offers
      .map((offer) => keywordOfferMatch(offer, request))
      .filter(Boolean)
      .filter((match) => !tier || match.offer.tier === tier)
      .filter((match) => includeTier4 || match.offer.tier !== "Tier 4")
      .filter((match) => includeBlack || match.offer.tier !== "BLACK TIER")
      .filter((match) => !metricFilters.length || applyMetricFilters([match.offer], metricFilters).length)
      .filter((match) => {
        const key = offerIdentityKey(match.offer);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => compareKeywordMatches(a, b, { includeTier4, includeBlack, topMetricRequest }));
  }

  function hasDirectMerchantKeywordLookup(prompt) {
    const lookup = merchantLookupForPrompt(prompt);
    const first = lookup.matches[0];
    if (!first) return false;
    const cleanedNorm = normalize(lookup.cleaned);
    const brandNorm = normalize(first.offer.brand);
    const id = String(first.offer.merchantId || "").trim();
    if (!cleanedNorm || !brandNorm) return false;
    return (id && cleanedNorm === normalize(id)) ||
      brandNorm === cleanedNorm ||
      brandNorm.startsWith(cleanedNorm) ||
      brandNorm.includes(cleanedNorm) ||
      cleanedNorm.includes(brandNorm);
  }

  function hasKeywordSearchIntent(prompt, request, context = {}) {
    if (!request) return false;
    if (findByAsin(prompt) || findByMerchantId(prompt) || extractPaymentCycleFilter(prompt) || promptHasPaymentTerms(prompt)) return false;
    if (request.knownKeyword) return true;
    if (hasDirectMerchantKeywordLookup(prompt)) return false;
    if (context.category && hasMainCategoryValue(context.category) && normalize(context.category) === normalize(request.keyword)) return false;
    if (keywordSearchMatches(prompt).some((match) => (match.matchedFields || []).includes("product"))) return true;
    return wantsRecommendationList(prompt) ||
      /\b(?:find|search|keyword|keywords|related|similar|matching)\b/i.test(prompt) ||
      /æœç´¢|æŸ¥æ‰¾|æ‰¾|å…³é”®è¯|ç›¸å…³|ç›¸ä¼¼|åŒ¹é…/.test(prompt);
  }

  function dateOnly(value) {
    if (!value) return null;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isoDate(date) {
    return localDateKey(date);
  }

  function monthNameFromText(value) {
    const zhMonth = chatbotI18n.monthNameFromText && chatbotI18n.monthNameFromText(value);
    if (zhMonth) return zhMonth;
    const text = String(value || "").toLowerCase();
    const direct = PAYMENT_MONTHS.find((month) => textIncludesAlias(text, month.toLowerCase()));
    if (direct) return direct;
    const zhMonths = ["ä¸€æœˆ", "äºŒæœˆ", "ä¸‰æœˆ", "å››æœˆ", "äº”æœˆ", "å…­æœˆ", "ä¸ƒæœˆ", "å…«æœˆ", "ä¹æœˆ", "åæœˆ", "åä¸€æœˆ", "åäºŒæœˆ"];
    const zhDirect = zhMonths.findIndex((month) => text.includes(month));
    if (zhDirect >= 0) return PAYMENT_MONTHS[zhDirect];
    const numericMonth = text.match(/(?:^|[^0-9])([1-9]|1[0-2])\s*(?:æœˆ|æœˆä»½)/);
    if (numericMonth) return PAYMENT_MONTHS[Number(numericMonth[1]) - 1];
    const key = text.match(/\b2026-(0[1-9]|1[0-2])\b/);
    if (key) return PAYMENT_MONTHS[Number(key[1]) - 1];
    return null;
  }

  function monthKey(record) {
    if (record.reportMonthKey) return record.reportMonthKey;
    const month = monthNameFromText(record.reportMonth);
    const index = PAYMENT_MONTHS.indexOf(month);
    const year = Number(record.reportYear || 2026);
    return index >= 0 ? `${year}-${String(index + 1).padStart(2, "0")}` : "";
  }

  function addDaysIso(date, days) {
    const copy = new Date(date.getTime());
    copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
    return copy.toISOString().slice(0, 10);
  }

  function calculatePaymentAvailabilityDate(recordOrMonth, year = 2026) {
    const month = typeof recordOrMonth === "string" ? monthNameFromText(recordOrMonth) : monthNameFromText(recordOrMonth.reportMonth || recordOrMonth.reportMonthKey);
    const reportYear = typeof recordOrMonth === "object" ? Number(recordOrMonth.reportYear || year) : Number(year);
    const index = PAYMENT_MONTHS.indexOf(month);
    if (index < 0) return "";
    const cycle = typeof recordOrMonth === "object" ? number(recordOrMonth.paymentCycle) : 0;
    if (cycle > 0) {
      return addDaysIso(new Date(Date.UTC(reportYear, index, 2)), cycle);
    }
    const date = new Date(Date.UTC(reportYear, index + 2, 3));
    return date.toISOString().slice(0, 10);
  }

  function normalizePaymentCycle(value, network) {
    if (String(network || "").trim().toLowerCase() === "wayward") return 105;
    const cycle = number(value);
    return cycle > 0 ? Math.round(cycle) : 60;
  }

  function paymentCycleKeys(merchantId, merchantName) {
    const keys = [];
    const id = String(merchantId || "").trim();
    const name = normalize(merchantName);
    if (id) keys.push(`id:${id}`);
    if (name) keys.push(`name:${name}`);
    return keys;
  }

  function buildSheetPaymentCycleIndex() {
    const cycles = new Map();
    (sheetReport.sheets || []).forEach((sheet) => {
      (sheet.rows || []).forEach((row) => {
        const cycle = number(row["Payment Cycle"]);
        if (cycle <= 0) return;
        paymentCycleKeys(row["Merchant ID"] || row["Merchant Id"] || row.merchantId, row["Merchant Name"] || row.Brand || row.brand)
          .forEach((key) => cycles.set(key, Math.round(cycle)));
      });
    });
    return cycles;
  }

  function sheetPaymentCycleFor(merchantId, merchantName) {
    for (const key of paymentCycleKeys(merchantId, merchantName)) {
      const cycle = sheetPaymentCycles.get(key);
      if (cycle > 0) return cycle;
    }
    return 0;
  }

  function explicitPaymentCycleFrom(source) {
    if (!source) return 0;
    const keys = [
      "paymentCycle",
      "payment_cycle",
      "paymentCycleDays",
      "payment_cycle_days",
      "paymentTermDays",
      "payment_terms_days",
      "paymentTermsDays",
      "paymentDelayDays",
      "payoutDelayDays",
      "netDays",
      "net_days"
    ];
    for (const key of keys) {
      const cycle = number(source[key]);
      if (cycle > 0) return Math.round(cycle);
    }
    return 0;
  }

  function resolveOfferPaymentCycle(offer) {
    const sheetCycle = sheetPaymentCycleFor(offer && offer.merchantId, offer && offer.brand);
    if (sheetCycle > 0) return normalizePaymentCycle(sheetCycle, offer && offer.network);
    return normalizePaymentCycle(null, offer && offer.network);
  }

  function inferRegionFromText(value) {
    const text = String(value || "");
    const match = text.match(/(?:^|[\s()[\]-])(US|USA|UK|GB|DE|FR|CA|AU)(?:$|[\s()[\]-])/i);
    if (!match) return "";
    return match[1];
  }

  function normalizeRegion(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const marketplace = raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0]
      .toLowerCase();
    const compact = marketplace.replace(/[^a-z0-9.]+/g, "");
    const aliases = {
      "amazon.com": "US",
      com: "US",
      us: "US",
      usa: "US",
      unitedstates: "US",
      "amazon.ca": "Canada",
      ca: "Canada",
      can: "Canada",
      canada: "Canada",
      "amazon.co.uk": "UK",
      "amazon.uk": "UK",
      "co.uk": "UK",
      uk: "UK",
      gb: "UK",
      gbr: "UK",
      unitedkingdom: "UK",
      "amazon.fr": "FR",
      fr: "FR",
      fra: "FR",
      france: "FR",
      "amazon.de": "DE",
      de: "DE",
      deu: "DE",
      germany: "DE",
      deutschland: "DE"
    };
    return aliases[compact] || raw.toUpperCase();
  }

  function paymentRegionFor(record, matchedOffer = {}) {
    return normalizeRegion(
      record.region ||
      record.marketplace ||
      record.marketPlace ||
      record.market ||
      record.country ||
      record.countryCode ||
      matchedOffer.region ||
      matchedOffer.country ||
      inferRegionFromText(record.merchantName || record.brand || matchedOffer.brand)
    );
  }

  function bestPaymentOffer(candidates) {
    return candidates
      .filter(Boolean)
      .sort((a, b) => (
        tierPriority(a, true, true) - tierPriority(b, true, true) ||
        number(b.salesAmount) - number(a.salesAmount) ||
        String(a.brand || "").localeCompare(String(b.brand || ""))
      ))[0] || null;
  }

  function isSafeBrandMatch(offerBrand, merchantName) {
    if (!offerBrand || !merchantName) return false;
    if (offerBrand === merchantName) return true;
    const shorter = Math.min(offerBrand.length, merchantName.length);
    const longer = Math.max(offerBrand.length, merchantName.length);
    return shorter >= 5 && shorter / longer >= 0.65 && (offerBrand.includes(merchantName) || merchantName.includes(offerBrand));
  }

  function resolvePaymentCycle(record, matchedOffer, network) {
    const sheetCycle = sheetPaymentCycleFor(
      (record && record.merchantId) || (matchedOffer && matchedOffer.merchantId),
      (record && (record.merchantName || record.brand)) || (matchedOffer && matchedOffer.brand)
    );
    if (sheetCycle > 0) return normalizePaymentCycle(sheetCycle, (matchedOffer && matchedOffer.network) || network);
    const apiCycle = explicitPaymentCycleFrom(record);
    if (apiCycle > 0) return normalizePaymentCycle(apiCycle, network || (matchedOffer && matchedOffer.network));
    return normalizePaymentCycle(null, network || (matchedOffer && matchedOffer.network));
  }

  function offerForMerchant(merchantId, merchantName) {
    const cleanId = String(merchantId || "").trim();
    if (cleanId) {
      const byId = bestPaymentOffer(offers.filter((offer) => String(offer.merchantId || "").trim() === cleanId));
      if (byId) return byId;
    }
    const cleanName = normalize(merchantName);
    if (!cleanName) return null;
    const exact = bestPaymentOffer(offers.filter((offer) => normalize(offer.brand) === cleanName));
    if (exact) return exact;
    return bestPaymentOffer(offers.filter((offer) => isSafeBrandMatch(normalize(offer.brand), cleanName)));
  }

  function paymentDueDate(record, cycleOverride) {
    const cycle = cycleOverride === undefined
      ? Math.max(60, normalizePaymentCycle(record.paymentCycle, record.network))
      : Number(cycleOverride);
    const computed = calculatePaymentAvailabilityDate({ ...record, paymentCycle: cycle });
    return dateOnly(computed || record.expectedPaymentDate || record.paymentAvailabilityDate);
  }

  function calculatePaymentStatus(record) {
    const raw = String(record.rawStatus || record.paymentStatus || "").toLowerCase();
    const expected = number(record.expectedPaymentAmount ?? record.commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const baselineDate = paymentDueDate(record, 60);
    const cycleDate = paymentDueDate(record);
    const pastBaseline = baselineDate ? PAYMENT_TODAY > baselineDate : false;
    const pastCycle = cycleDate ? PAYMENT_TODAY > cycleDate : false;

    if (raw === "paid" || (expected > 0 && paid >= expected - 0.01 && !raw.includes("late") && !raw.includes("unpaid"))) return "Paid";
    if (expected <= 0 && paid <= 0) {
      if (raw.includes("pending")) return "Pending";
      return "Unknown";
    }
    if (!pastBaseline) return "Pending";
    if (pastCycle && remaining > 0.01) return "Overdue";
    if (paid > 0 && remaining > 0.01) return "Partial";
    if (raw.includes("pending") || raw.includes("late") || raw.includes("unpaid") || remaining > 0.01) return "Unpaid";
    return "Unknown";
  }

  function firstRecordNumber(record, keys) {
    for (const key of keys) {
      if (record[key] === undefined || record[key] === null || record[key] === "") continue;
      return number(record[key]);
    }
    return null;
  }

  function normalizePaymentRecord(record) {
    const revenueMade = firstRecordNumber(record, ["revenueMade", "sales", "revenue", "salesAmount", "totalSales"]) ?? 0;
    const directCommissionMade = firstRecordNumber(record, ["commissionMade", "totalCommission", "commissionOwed", "expectedPaymentAmount"]);
    const rawCommission = firstRecordNumber(record, ["commission"]);
    const cpcCommission = firstRecordNumber(record, ["cpcCommission", "cpc_commission"]) ?? 0;
    const commissionMade = directCommissionMade ?? ((rawCommission ?? 0) + cpcCommission);
    const expected = number(record.expectedPaymentAmount ?? commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const sourceMerchantId = String(record.merchantId || "").trim();
    const matchedOffer = offerForPaymentMerchant(record) || {};
    const network = record.network || matchedOffer.network || "Levanta";
    const matchedMerchantId = String(matchedOffer.merchantId || "").trim();
    const useMatchedLevantaId = normalize(network) === "levanta" && matchedMerchantId;
    // Levanta æ•°æ®å¯èƒ½æ˜¯ UUIDï¼Œå‘½ä¸­ offer æ—¶ç”¨çœŸå® merchantId
    const merchantId = useMatchedLevantaId ? matchedMerchantId : (sourceMerchantId || matchedMerchantId);
    const region = paymentRegionFor(record, matchedOffer);
    const levantaBrandId = record.levantaBrandId || "";
    const normalized = {
      ...record,
      merchantId,
      levantaBrandId,
      merchantName: String(record.merchantName || record.brand || "").trim(),
      network,
      region,
      tier: paymentMetadataValue(record.tier, matchedOffer.tier, "Unknown"),
      category: paymentMetadataValue(record.category, matchedOffer.category || matchedOffer.levantaCategory, "Uncategorized"),
      categoryPath: paymentMetadataValue(record.categoryPath, matchedOffer.categoryPath, ""),
      mainCategory: paymentMetadataValue(record.mainCategory, matchedOffer.mainCategory, ""),
      subCategory: paymentMetadataValue(record.subCategory, matchedOffer.subCategory, ""),
      mainCategoryCn: paymentMetadataValue(record.mainCategoryCn, matchedOffer.mainCategoryCn, ""),
      subCategoryCn: paymentMetadataValue(record.subCategoryCn, matchedOffer.subCategoryCn, ""),
      reportMonth: record.reportMonth || monthNameFromText(record.reportMonthKey) || "Unknown",
      reportYear: Number(record.reportYear || 2026),
      reportMonthKey: record.reportMonthKey || monthKey(record),
      revenueMade,
      commissionMade,
      expectedPaymentAmount: expected,
      paidAmount: paid,
      remainingAmount: remaining,
      paymentCycle: resolvePaymentCycle(record, matchedOffer, network),
      lastCheckedDate: record.lastCheckedDate || data.summary.generatedAt || "",
      paymentMadeDate: String(record.paymentMadeDate || "").slice(0, 10),
      notes: record.notes || ""
    };
    normalized.paymentAvailabilityDate = calculatePaymentAvailabilityDate(normalized) || record.paymentAvailabilityDate || "";
    normalized.expectedPaymentDate = normalized.paymentAvailabilityDate;
    normalized.paymentStatus = calculatePaymentStatus(normalized);
    if (normalized.paymentStatus === "Paid" && !normalized.paymentMadeDate) {
      normalized.paymentMadeDate = String(record.lastCheckedDate || data.summary?.paymentLastCheckedAt || data.summary?.generatedAt || "").slice(0, 10);
    }
    return normalized;
  }

  function paymentMetadataValue(recordValue, matchedValue, fallback) {
    const text = String(recordValue || "").trim();
    const generic = ["unknown", "uncategorized"].includes(normalize(text));
    if (text && !generic) return recordValue;
    return matchedValue || recordValue || fallback;
  }

  function offerForPaymentMerchant(record) {
    const merchantId = String(record.merchantId || "").trim();
    if (merchantId) {
      const byId = offers.find((offer) => String(offer.merchantId || "").trim() === merchantId);
      if (byId && (normalize(record.network) !== "levanta" || normalize(byId.network) === "levanta")) return byId;
    }
    const merchantName = normalize(record.merchantName || record.brand);
    if (!merchantName) return null;
    const exactMatches = offers.filter((offer) => normalize(offer.brand) === merchantName);
    if (normalize(record.network) === "levanta") {
      const levantaMatch = exactMatches.find((offer) => normalize(offer.network) === "levanta");
      if (levantaMatch) return levantaMatch;
    }
    if (exactMatches.length) return exactMatches[0];
    const fuzzyMatches = offers.filter((offer) => {
      const brand = normalize(offer.brand);
      return brand && (brand === merchantName || brand.includes(merchantName) || merchantName.includes(brand));
    });
    if (normalize(record.network) === "levanta") {
      const levantaFuzzyMatch = fuzzyMatches.find((offer) => normalize(offer.network) === "levanta");
      if (levantaFuzzyMatch) return levantaFuzzyMatch;
    }
    return fuzzyMatches[0] || null;
  }

  function paymentMerchantKey(record) {
    return String(record.merchantId || normalize(record.merchantName || record.brand)).trim();
  }

  function paymentRecordKey(record) {
    return [
      paymentMerchantKey(record) || String(record.levantaBrandId || "").trim(),
      record.reportMonthKey || monthKey(record),
      normalizeRegion(record.region || record.marketplace || "")
    ].join("::");
  }

  function mergePaymentMadeDates(records, previousRecords, checkedAt) {
    const previousByKey = new Map((previousRecords || []).map((record) => [paymentRecordKey(record), record]));
    const detectedDate = String(checkedAt || isoDate(PAYMENT_TODAY)).slice(0, 10);
    return (records || []).map((record) => {
      const previous = previousByKey.get(paymentRecordKey(record));
      const previousDate = String((previous && previous.paymentMadeDate) || "").slice(0, 10);
      if (record.paymentStatus === "Paid") {
        const firstKnownDate = previous && previous.paymentStatus === "Paid"
          ? previousDate || String(previous.lastCheckedDate || "").slice(0, 10)
          : previousDate;
        return { ...record, paymentMadeDate: firstKnownDate || record.paymentMadeDate || detectedDate };
      }
      return previousDate ? { ...record, paymentMadeDate: previousDate } : record;
    });
  }

  function paymentMadeDateText(record) {
    if (!record || record.paymentStatus !== "Paid") return "-";
    return String(record.paymentMadeDate || "").slice(0, 10) || "-";
  }

  function createPendingPaymentRecord(source, month) {
    const monthIndex = PAYMENT_MONTHS.indexOf(month);
    const reportYear = Number(source.reportYear || 2026);
    const offer = offerForPaymentMerchant(source) || {};
    const merchantId = String(source.merchantId || offer.merchantId || "").trim();
    const merchantName = String(source.merchantName || source.brand || offer.brand || merchantId || "Unknown merchant").trim();
    const network = source.network || offer.network || "Levanta";
    const paymentCycle = resolvePaymentCycle(source, offer, network);
    const record = {
      id: `${merchantId || normalize(merchantName)}::${reportYear}-${String(monthIndex + 1).padStart(2, "0")}::pending-placeholder`,
      merchantId,
      merchantName,
      network,
      region: paymentRegionFor(source, offer),
      tier: source.tier || offer.tier || "Unknown",
      category: source.category || offer.category || offer.levantaCategory || "Uncategorized",
      categoryPath: source.categoryPath || offer.categoryPath || "",
      mainCategory: source.mainCategory || offer.mainCategory || "",
      subCategory: source.subCategory || offer.subCategory || "",
      mainCategoryCn: source.mainCategoryCn || offer.mainCategoryCn || "",
      subCategoryCn: source.subCategoryCn || offer.subCategoryCn || "",
      reportMonth: month,
      reportYear,
      reportMonthKey: `${reportYear}-${String(monthIndex + 1).padStart(2, "0")}`,
      revenueMade: 0,
      commissionMade: 0,
      expectedPaymentAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      paymentCycle,
      rawStatus: "pending",
      lastCheckedDate: isoDate(PAYMENT_TODAY),
      currency: source.currency || "USD",
      isPlaceholder: true,
      notes: "No Levanta invoice row found yet; marked pending until the month becomes payable or Levanta returns a final status."
    };
    record.paymentAvailabilityDate = calculatePaymentAvailabilityDate(record);
    record.expectedPaymentDate = record.paymentAvailabilityDate;
    record.paymentStatus = "Pending";
    return normalizePaymentRecord(record);
  }

  function withPendingPaymentPlaceholders(records) {
    const normalized = records.map(normalizePaymentRecord);
    const existingKeys = new Set(normalized.map((record) => `${paymentMerchantKey(record)}::${record.reportMonthKey}`));
    const merchants = Array.from(new Map(normalized
      .filter((record) => paymentMerchantKey(record))
      .map((record) => [paymentMerchantKey(record), record])).values());
    const additions = [];

    merchants.forEach((merchant) => {
      ACTIVE_PAYMENT_MONTHS.forEach((month) => {
        const monthIndex = PAYMENT_MONTHS.indexOf(month);
        if (monthIndex < 0) return;
        const key = `${paymentMerchantKey(merchant)}::2026-${String(monthIndex + 1).padStart(2, "0")}`;
        if (existingKeys.has(key)) return;
        additions.push(createPendingPaymentRecord(merchant, month));
        existingKeys.add(key);
      });
    });

    return normalized.concat(additions);
  }

  function rebuildPaymentIndex() {
    paymentRecordsByMerchant.clear();
    paymentRecords.forEach((record) => {
      const key = String(record.merchantId || record.merchantName || "").trim();
      if (!key) return;
      if (!paymentRecordsByMerchant.has(key)) paymentRecordsByMerchant.set(key, []);
      paymentRecordsByMerchant.get(key).push(record);
    });
  }

  function getPaymentRecords() {
    return paymentRecords
      .map((record) => ({ ...record, paymentStatus: calculatePaymentStatus(record) }))
      .filter(isTrackablePaymentRecord);
  }

  function hasPaymentRevenueOrCommission(record) {
    return number(record.revenueMade) > 0 || number(record.commissionMade) > 0;
  }

  function visiblePaymentRecords(records) {
    return (records || []).map(normalizePaymentRecord).filter(isTrackablePaymentRecord);
  }

  function hasPayablePaymentAmount(record) {
    return (
      number(record.commissionMade) > 0 ||
      number(record.expectedPaymentAmount) > 0 ||
      number(record.paidAmount) > 0 ||
      number(record.remainingAmount) > 0
    );
  }

  function isTrackablePaymentRecord(record) {
    return hasPaymentRevenueOrCommission(record);
  }

  function getPaymentByMerchant(merchant) {
    const key = normalize(merchant);
    return getPaymentRecords().filter((record) => (
      normalize(record.merchantId) === key ||
      normalize(record.merchantName) === key ||
      normalize(record.merchantName).includes(key) ||
      normalize(record.merchantId).includes(key)
    ));
  }

  function getPaymentByMonth(reportMonth) {
    const month = monthNameFromText(reportMonth);
    const key = String(reportMonth || "");
    return getPaymentRecords().filter((record) => (
      (month && record.reportMonth === month) ||
      record.reportMonthKey === key
    ));
  }

  function getPaymentByStatus(status) {
    const wanted = String(status || "").toLowerCase();
    return getPaymentRecords().filter((record) => record.paymentStatus.toLowerCase() === wanted);
  }

  function getUnpaidPayments() {
    return getPaymentByStatus("Unpaid");
  }

  function getPendingPayments() {
    return getPaymentByStatus("Pending");
  }

  function isPaymentOverdue(record) {
    const dueDate = paymentDueDate(record);
    return Boolean(dueDate && PAYMENT_TODAY > dueDate && number(record.remainingAmount) > 0 && record.paymentStatus !== "Paid");
  }

  function getOverduePayments() {
    return getPaymentRecords().filter(isPaymentOverdue);
  }

  function updatePaymentSummary(rows = getPaymentRecords()) {
    const merchantIds = new Set(rows.map((record) => record.merchantId || record.merchantName).filter(Boolean));
    const unpaidMerchants = new Set(rows.filter((record) => record.paymentStatus === "Unpaid").map((record) => record.merchantId || record.merchantName));
    const pendingMerchants = new Set(rows.filter((record) => record.paymentStatus === "Pending").map((record) => record.merchantId || record.merchantName));
    const paidMerchants = new Set(rows.filter((record) => record.paymentStatus === "Paid").map((record) => record.merchantId || record.merchantName));
    const overdueRows = rows.filter(isPaymentOverdue);
    const overdueMerchants = new Set(overdueRows.map((record) => record.merchantId || record.merchantName).filter(Boolean));
    return {
      recordCount: rows.length,
      merchantCount: merchantIds.size,
      totalRevenueMade: rows.reduce((sum, record) => sum + number(record.revenueMade), 0),
      totalCommissionMade: rows.reduce((sum, record) => sum + number(record.commissionMade), 0),
      totalExpectedPayment: rows.reduce((sum, record) => sum + number(record.expectedPaymentAmount), 0),
      totalPaidAmount: rows.reduce((sum, record) => sum + number(record.paidAmount), 0),
      totalRemainingAmount: rows.reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalUnpaidAmount: rows.filter((record) => record.paymentStatus === "Unpaid").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalPendingAmount: rows.filter((record) => record.paymentStatus === "Pending").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalPartialAmount: rows.filter((record) => record.paymentStatus === "Partial").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      unpaidMerchantCount: unpaidMerchants.size,
      pendingMerchantCount: pendingMerchants.size,
      paidMerchantCount: paidMerchants.size,
      paymentRate: merchantIds.size ? paidMerchants.size / merchantIds.size : 0,
      overdueMerchantCount: overdueMerchants.size,
      overdueCount: overdueRows.length
    };
  }

  function syncLevantaPayments() {
    const summary = updatePaymentSummary(getPaymentRecords());
    return {
      status: "file-based",
      checkedAt: isoDate(PAYMENT_TODAY),
      summary
    };
  }

  async function refreshLevantaPayments(options = {}) {
    if (state.livePaymentsLoading) return;
    state.livePaymentsLoading = true;
    if (els.paymentSync) {
      els.paymentSync.disabled = true;
      els.paymentSync.textContent = t("payments.syncing", "Syncing...");
    }
    try {
      const response = await fetch("/api/levanta/payments", { cache: "no-store" });
      if (!response.ok) throw new Error(`Levanta API sync returned ${response.status}`);
      const payload = await response.json();
      if (!payload.records || !payload.records.length) throw new Error("Levanta API returned no payment records");
      const checkedAt = String(payload.checkedAt || "").slice(0, 10) || isoDate(PAYMENT_TODAY);
      const incomingRecords = visiblePaymentRecords(withPendingPaymentPlaceholders(payload.records.map(normalizePaymentRecord)));
      paymentRecords = mergePaymentMadeDates(incomingRecords, paymentRecords, checkedAt);
      rebuildPaymentIndex();
      state.paymentSource = "Levanta API";
      state.livePaymentsLoaded = true;
      if (options.auto) localStorage.setItem(AUTO_PAYMENT_SYNC_KEY, String(Date.now()));
      refreshPaymentFilterOptions();
      syncPaymentControls();
      setPaymentStamp("live", checkedAt);
      renderPaymentsPage();
      if (state.currentContext.type === "payment") {
        setContext(buildPaymentContext(getFilteredPayments().slice(0, 60), state.currentQuery || "Payment sync"));
      }
    } catch (error) {
      state.paymentSource = "saved invoice file";
      setPaymentStamp("unavailable", isoDate(PAYMENT_TODAY));
      if (!options.silent) {
        addMessage("assistant", `I could not reach the live Levanta API from this server, so I kept the saved invoice data loaded. The server needs <strong>LEVANTA_API_KEY</strong> configured for live sync.`);
      }
      renderPaymentsPage();
    } finally {
      if (els.paymentSync) {
        els.paymentSync.disabled = false;
        els.paymentSync.textContent = t("payments.sync", "Sync Levanta");
      }
      state.livePaymentsLoading = false;
    }
  }

  function maybeAutoSyncLevantaPayments() {
    const lastSync = Number(localStorage.getItem(AUTO_PAYMENT_SYNC_KEY) || 0);
    if (state.livePaymentsLoading) return;
    if (state.livePaymentsLoaded && Number.isFinite(lastSync) && Date.now() - lastSync < AUTO_PAYMENT_SYNC_INTERVAL_MS) return;
    refreshLevantaPayments({ silent: true, auto: true });
  }

  function paymentRecordsForOffer(offer) {
    const byId = paymentRecordsByMerchant.get(String(offer.merchantId || "").trim()) || [];
    if (byId.length) return byId;
    const brandKey = normalize(offer.brand);
    if (!brandKey) return [];
    return paymentRecords.filter((record) => normalize(record.merchantName) === brandKey);
  }

  function hasOfferOverduePayment(offer) {
    return paymentRecordsForOffer(offer).some(isPaymentOverdue);
  }

  function paymentRiskTextForOffer(offer) {
    const overdue = paymentRecordsForOffer(offer).filter(isPaymentOverdue);
    if (overdue.length) {
      const total = overdue.reduce((sum, record) => sum + number(record.remainingAmount), 0);
      const months = Array.from(new Set(overdue.map((record) => record.reportMonth))).join(", ");
      return `${months} overdue payment (${shortMoney(total)} remaining)`;
    }
    return offer.paymentStatus || "payment risk";
  }

  function hasPaymentRisk(offer) {
    return Boolean(offer.paymentRisk || offer.paymentState === "unpaid" || hasOfferOverduePayment(offer));
  }

  function hasPaidSignal(offer) {
    return offer.paymentState === "paid" || paymentRecordsForOffer(offer).some((record) => record.paymentStatus === "Paid");
  }

  function tierGroup(offer) {
    const tier = offer.tier || "";
    const reason = `${offer.reason || ""} ${offer.recommendation || ""}`.toLowerCase();
    if (tier === "BLACK TIER") return "Black Tier";
    if (tier === "Tier 1") return "Tier 1";
    if (tier === "Tier 2" && /manual keep|monitor|underperformance|declined|watch|careful/.test(reason)) return "Tier 2 Watch";
    if (tier === "Tier 2") return "Core Tier 2";
    if (tier === "Tier 3") return "Tier 3";
    if (tier === "Tier 4") return "Tier 4";
    return tier || "Unknown";
  }

  function tierPriority(offer, includeTier4 = false, includeBlack = false) {
    const group = tierGroup(offer);
    if (group === "Tier 1") return 1;
    if (group === "Core Tier 2") return 2;
    if (group === "Tier 2 Watch") return 3;
    if (group === "Tier 3") return 4;
    if (group === "Tier 4") return includeTier4 ? 5 : 99;
    if (group === "Black Tier") return includeBlack ? 6 : 100;
    return 50;
  }

  function highlightStatus(offer) {
    const group = tierGroup(offer);
    const phase = String(offer.phase || "").toLowerCase();
    if (group === "Tier 1") return "Strategic push";
    if (group === "Tier 2 Watch") return "Red caution test";
    if (group === "Core Tier 2" && phase.includes("growing")) return "Green active opportunity";
    if (group === "Core Tier 2") return "Yellow publisher expansion";
    if (group === "Tier 3") return "Development push";
    if (group === "Tier 4") return "Retest only";
    if (group === "Black Tier") return "No push";
    return "Optimization only";
  }

  function tier2PublisherStrategy(offer, language = state.language) {
    if (!tier2Rules.strategyForOffer || offer.tier !== "Tier 2") return null;
    return tier2Rules.strategyForOffer(offer, {
      language,
      tierGroup: tierGroup(offer),
      highlightStatus: highlightStatus(offer)
    });
  }

  function tier2PublisherCountText(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    return strategy.publisherCountText || "";
  }

  function tier2PublisherSuccessText(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    return strategy.successRateText || "";
  }

  function tier2OptimizationIdea(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    return strategy ? strategy.idea : "";
  }

  function tier2RecommendationDetailsHtml(offer, language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    const copy = chatCopy(language);
    const publisherLabel = language === "zh" ? chatLabelText("Publisher Count", language) : "Publisher count";
    const successLabel = language === "zh" ? chatLabelText("Success Rate", language) : "Success rate";
    const ideaLabel = language === "zh" ? (copy.tier2OptimizationIdea || chatLabelText("Tier 2 Optimization Idea", language)) : "Tier 2 optimization idea";
    return [
      `<li><strong>${escapeHtml(publisherLabel)}:</strong> ${escapeHtml(strategy.publisherCountText || (language === "zh" ? copy.notAvailable : "not available"))}</li>`,
      `<li><strong>${escapeHtml(successLabel)}:</strong> ${escapeHtml(strategy.successRateText || (language === "zh" ? copy.notAvailable : "not available"))}</li>`,
      `<li><strong>${escapeHtml(ideaLabel)}:</strong> ${escapeHtml(strategy.idea)}</li>`
    ].join("");
  }

  function tier2FieldRows(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return [];
    const notAvailable = language === "zh" ? chatCopy(language).notAvailable : "not available in current data";
    return [
      ["Publisher Count", strategy.publisherCountText || notAvailable],
      ["Success Rate", strategy.successRateText || notAvailable],
      ["Tier 2 Optimization Idea", strategy.idea]
    ];
  }

  function recommendedAction(offer, language = state.language) {
    const group = tierGroup(offer);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (language === "zh") {
      if (hasPaymentRisk(offer)) return "æ”¾é‡å‰å…ˆè·Ÿè¿›ä»˜æ¬¾é£é™©";
      if (group === "Tier 1") return "æˆ˜ç•¥æ€§æ¨è¿›";
      if (publisherStrategy) return publisherStrategy.action;
      if (group === "Core Tier 2") {
        const map = {
          "Green active opportunity": "ç»¿è‰²ä¸»åŠ¨æœºä¼š",
          "Yellow publisher expansion": "é»„è‰² publisher æ‰©å±•æœºä¼š",
          "Optimization only": "ä»…ä¼˜åŒ–"
        };
        return map[highlightStatus(offer)] || highlightStatus(offer);
      }
      if (group === "Tier 2 Watch") return "ä»…åšç²¾é€‰ publisher æµ‹è¯•";
      if (group === "Tier 3") return "æ§åˆ¶èŠ‚å¥åšå‘å±•æµ‹è¯•";
      if (group === "Tier 4") return "ä»…å¤æµ‹";
      if (group === "Black Tier") return "ä¸è¦æ¨è¿›";
      return "ä»…ä¼˜åŒ–";
    }
    if (hasPaymentRisk(offer)) return "Follow up payment before scaling";
    if (group === "Tier 1") return "Push strategically";
    if (publisherStrategy) return publisherStrategy.action;
    if (group === "Core Tier 2") return highlightStatus(offer);
    if (group === "Tier 2 Watch") return "Selected publisher test only";
    if (group === "Tier 3") return "Controlled development push";
    if (group === "Tier 4") return "Retest only";
    if (group === "Black Tier") return "Do not push";
    return "Optimize only";
  }

  function caution(offer, language = state.language) {
    const group = tierGroup(offer);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (language === "zh") {
      if (group === "Black Tier") return "Black Tierï¼Œä¸å»ºè®®æ¨è¿›ã€‚";
      if (hasPaymentRisk(offer)) return `ä»˜æ¬¾é£é™©ï¼š${paymentRiskTextForOffer(offer)}ã€‚`;
      if (publisherStrategy) return publisherStrategy.caution;
      if (group === "Tier 4") return "ä»…åœ¨è§’åº¦æ˜ç¡®æ—¶å¤æµ‹ã€‚";
      if (group === "Tier 2 Watch") return "æ”¾é‡å‰éœ€è¦ç»§ç»­è§‚å¯Ÿã€‚";
      if (number(offer.conversionRate) < 0.01) return "CVR ä½äº 1%ï¼Œå»ºè®®ä½¿ç”¨é«˜æ„å›¾æµé‡ã€‚";
      return "æŒç»­è§‚å¯Ÿ EPCã€CVR å’Œä»˜æ¬¾çŠ¶æ€ã€‚";
    }
    if (group === "Black Tier") return "Black tier; do not push.";
    if (hasPaymentRisk(offer)) return `Payment risk: ${paymentRiskTextForOffer(offer)}.`;
    if (publisherStrategy) return publisherStrategy.caution;
    if (group === "Tier 4") return "Retest only with a clear angle.";
    if (group === "Tier 2 Watch") return "Needs monitoring before broader scale.";
    if (number(offer.conversionRate) < 0.01) return "CVR is below 1%; use high-intent traffic.";
    return "Monitor EPC, CVR, and payment status.";
  }

  function bestAngle(offer, context = {}) {
    const category = displayCategory(offer) !== "Uncategorized" ? displayCategory(offer) : "category";
    const link = offer.recommendedLink ? `${offer.recommendedLink.toLowerCase()} traffic` : "selected publisher traffic";
    const language = context.language || responseLanguageFor(context.prompt || state.currentQuery);
    if (language === "zh") {
      const categoryText = category === "category" ? "è¯¥å“ç±»" : category;
      const linkText = offer.recommendedLink ? `${offer.recommendedLink} æµé‡` : "ç²¾é€‰ publisher æµé‡";
      if (context.google) {
        if (number(offer.orders) >= 50 && number(offer.conversionRate) >= 0.01) return `${categoryText} å…³é”®è¯ã€æµ‹è¯„ã€å¯¹æ¯”å’Œé«˜æ„å›¾æœç´¢æµé‡ã€‚`;
        return `${categoryText} å…³é”®è¯æµ‹è¯•ï¼Œå…ˆæ”¶ç´§æ„å›¾ï¼›CVR æ”¹å–„å‰ä¸è¦å¤§è§„æ¨¡æ”¾é‡ã€‚`;
      }
      if (offer.hasDiscount) return `${categoryText} dealã€couponã€å¯¹æ¯”å’Œæµ‹è¯„æµé‡ã€‚`;
      if (offer.hasAsin) return `${categoryText} ASIN æµ‹è¯„ã€å¯¹æ¯”å’Œè´­ä¹°æŒ‡å—æµé‡ã€‚`;
      return `${categoryText} ${linkText}ã€å¯¹æ¯”å†…å®¹å’Œæ§åˆ¶æµ‹è¯•æµé‡ã€‚`;
    }
    if (context.google) {
      if (number(offer.orders) >= 50 && number(offer.conversionRate) >= 0.01) return `${category} keyword, review, comparison, and high-intent search traffic.`;
      return `${category} keyword tests with tighter intent; avoid broad scaling until CVR improves.`;
    }
    if (offer.hasDiscount) return `${category} deal, coupon, comparison, and review traffic.`;
    if (offer.hasAsin) return `${category} ASIN review, comparison, and buying-guide traffic.`;
    return `${category} ${link}, comparison, and controlled test traffic.`;
  }

  function aggregateRows(rows) {
    const totalRevenue = rows.reduce((sum, offer) => sum + number(offer.salesAmount), 0);
    const totalCommission = rows.reduce((sum, offer) => sum + number(offer.affCommission), 0);
    const totalClicks = rows.reduce((sum, offer) => sum + number(offer.clicks), 0);
    const totalDpv = rows.reduce((sum, offer) => sum + number(offer.dpv), 0);
    const totalAtc = rows.reduce((sum, offer) => sum + number(offer.atc), 0);
    const totalOrders = rows.reduce((sum, offer) => sum + number(offer.orders), 0);
    const tierBreakdown = rows.reduce((acc, offer) => {
      const tier = tierGroup(offer);
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {});
    const tier2Breakdown = rows.filter((offer) => offer.tier === "Tier 2").reduce((acc, offer) => {
      const status = highlightStatus(offer);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    return {
      totalOffers: rows.length,
      totalRevenue,
      totalCommission,
      totalClicks,
      totalDpv,
      totalAtc,
      totalOrders,
      avgAov: totalOrders ? totalRevenue / totalOrders : null,
      blendedEpc: totalClicks ? totalCommission / totalClicks : null,
      avgCvr: totalClicks ? totalOrders / totalClicks : null,
      paymentRiskCount: rows.filter(hasPaymentRisk).length,
      tierBreakdown,
      tier2Breakdown
    };
  }

  function bestBy(rows, metric) {
    return rows.reduce((best, offer) => number(offer[metric]) > number(best && best[metric]) ? offer : best, null);
  }

  function uniqueValues(key) {
    return Array.from(new Set(offers.map((offer) => offer[key]).filter(Boolean))).sort((a, b) => {
      if (String(a).startsWith("Tier") && String(b).startsWith("Tier")) return String(a).localeCompare(String(b), undefined, { numeric: true });
      return String(a).localeCompare(String(b));
    });
  }

  function fillSelect(select, values) {
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionText(value);
      select.appendChild(option);
    });
  }

  function replaceSelectOptions(select, firstLabel, values, selectedValue) {
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "all";
    first.textContent = optionText(firstLabel);
    select.appendChild(first);
    fillSelect(select, values);
    select.value = values.includes(selectedValue) ? selectedValue : "all";
  }

  function replaceSelectWithOptions(select, options, selectedValue) {
    select.innerHTML = "";
    options.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = optionText(option.label);
      select.appendChild(el);
    });
    if (options.some((option) => option.value === selectedValue)) {
      select.value = selectedValue;
    } else if (options[0]) {
      select.value = options[0].value;
    }
  }

  function parseSheetNumber(value) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    const cleaned = text.replace(/[$,%]/g, "").replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function isRateColumn(header) {
    const lower = String(header || "").toLowerCase();
    return /(all commission|aff commission|commission rate|success rate|conversion rate|completion rate|avg conversion|\bconversion\b|\bcvr\b)/.test(lower) && !/count/.test(lower);
  }

  function percentageNumberForHeader(header, value) {
    if (!isRateColumn(header)) return null;
    const text = String(value ?? "").trim();
    if (!text) return null;
    const cleaned = text.replace(/%$/, "").replace(/,/g, "").trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const raw = Number(cleaned);
    if (!Number.isFinite(raw)) return null;
    if (text.includes("%")) return raw;
    return Math.abs(raw) <= 1 ? raw * 100 : raw;
  }

  function formatPercentNumber(value, minimumFractionDigits = 0) {
    return `${Number(value).toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits: 2 })}%`;
  }

  function formatSheetCell(header, value) {
    const text = String(value ?? "");
    if (text.includes("%")) return text;
    const percentage = percentageNumberForHeader(header, text);
    const minimumFractionDigits = /(all commission|aff commission|commission rate)/i.test(String(header || "")) ? 2 : 0;
    return percentage === null ? text : formatPercentNumber(percentage, minimumFractionDigits);
  }

  function tierCurrencySymbol(row = {}, preferredCurrency = "") {
    const currency = String(preferredCurrency || row.Currency || row.currency || "").trim().toUpperCase();
    const country = String(row.COUNTRY || row.Country || row.country || row.countryCode || "").trim().toUpperCase();
    const currencySymbols = {
      USD: "$",
      GBP: "Â£",
      EUR: "â‚¬",
      CAD: "C$",
      AUD: "A$",
      JPY: "Â¥"
    };
    if (currencySymbols[currency]) return currencySymbols[currency];
    if (["US", "USA", "UNITED STATES"].includes(country)) return "$";
    if (["UK", "GB", "UNITED KINGDOM"].includes(country)) return "Â£";
    if (["DE", "FR", "EU", "GERMANY", "FRANCE"].includes(country)) return "â‚¬";
    if (["CA", "CANADA"].includes(country)) return "C$";
    if (["AU", "AUSTRALIA"].includes(country)) return "A$";
    if (["JP", "JAPAN"].includes(country)) return "Â¥";
    return "";
  }

  function numericSheetCellValue(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const numeric = Number(text.replace(/[^\d.+-]/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function formatTierSheetCell(sheet, row, header) {
    const value = row ? row[header] : "";
    const text = String(value ?? "").trim();
    if (!sheet || !TIER_SHEET_MOVE_TARGETS.includes(sheet.name) || !text) {
      return formatSheetCell(header, value);
    }
    const normalizedHeader = String(header || "").trim().toLowerCase();
    const numeric = numericSheetCellValue(value);
    if (TIER_INTEGER_METRIC_HEADERS.has(normalizedHeader) && numeric !== null) {
      return numeric.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    if (["aov", "revenue"].includes(normalizedHeader) && numeric !== null) {
      const preferredCurrency = normalizedHeader === "aov" ? row["AOV Currency"] : "";
      return `${tierCurrencySymbol(row, preferredCurrency)}${numeric.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
    }
    return formatSheetCell(header, value);
  }

  function sortableReportValue(header, value) {
    const text = String(value ?? "").trim();
    if (!text) return { type: "empty", value: "" };
    const percentage = percentageNumberForHeader(header, text);
    if (percentage !== null) return { type: "number", value: percentage };
    const fraction = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (fraction && Number(fraction[2]) !== 0) return { type: "number", value: Number(fraction[1]) / Number(fraction[2]) };
    const dateValue = /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text.slice(0, 10)) : NaN;
    if (Number.isFinite(dateValue)) return { type: "number", value: dateValue };
    const cleaned = text.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return { type: "number", value: Number(cleaned) };
    return { type: "text", value: text.toLowerCase() };
  }

  function compareReportValues(header, left, right) {
    const a = sortableReportValue(header, left);
    const b = sortableReportValue(header, right);
    if (a.type === "empty" || b.type === "empty") {
      if (a.type === b.type) return 0;
      return a.type === "empty" ? 1 : -1;
    }
    if (a.type === "number" && b.type === "number") return a.value - b.value;
    return String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
  }

  function defaultReportSortDirection(header) {
    return /(rank|id|merchant|brand|network|agency|tier|phase|country|reason|recommendation|link|asin|target|objective|status)/i.test(String(header || "")) ? "asc" : "desc";
  }

  function sortReportRows(rows, sortState, getter) {
    if (!sortState || !sortState.key) return rows.slice();
    const multiplier = sortState.direction === "desc" ? -1 : 1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = getter(a.row, sortState.key);
        const right = getter(b.row, sortState.key);
        const leftEmpty = String(left ?? "").trim() === "";
        const rightEmpty = String(right ?? "").trim() === "";
        if (leftEmpty || rightEmpty) {
          if (leftEmpty === rightEmpty) return a.index - b.index;
          return leftEmpty ? 1 : -1;
        }
        const result = compareReportValues(sortState.key, left, right);
        return result ? result * multiplier : a.index - b.index;
      })
      .map((item) => item.row);
  }

  function sortableHeaderHtml(header, sortState, scope) {
    const active = sortState && sortState.key === header;
    const direction = active ? sortState.direction : "";
    const indicator = active ? (direction === "asc" ? "â–²" : "â–¼") : "â†•";
    return `<th><button class="table-sort-button${active ? " active" : ""}" type="button" data-report-sort-scope="${escapeHtml(scope)}" data-report-sort-key="${escapeHtml(header)}" aria-label="Sort by ${escapeHtml(labelText(header))}">
      <span>${escapeHtml(labelText(header))}</span>
      <span class="sort-indicator" aria-hidden="true">${escapeHtml(indicator)}</span>
    </button></th>`;
  }

  function updateReportSort(sortState, key) {
    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      return;
    }
    sortState.key = key;
    sortState.direction = defaultReportSortDirection(key);
  }

  function updateTargetMatrixSort(key) {
    if (state.targetSort.key === key) {
      state.targetSort.direction = state.targetSort.direction === "asc" ? "desc" : "asc";
      return;
    }
    state.targetSort.key = key;
    state.targetSort.direction = key === "Tier" ? "asc" : "desc";
  }

  function handleReportSortClick(event) {
    const button = event.target.closest("[data-report-sort-key]");
    if (!button) return;
    const key = button.dataset.reportSortKey || "";
    if (!key) return;
    if (button.dataset.reportSortScope === "target") {
      updateTargetMatrixSort(key);
      renderSheetPage();
      return;
    }
    if (button.dataset.reportSortScope === "payment") {
      updateReportSort(state.paymentSort, key);
      renderPaymentsPage();
      return;
    }
    if (button.dataset.reportSortScope === "publisher") {
      updateReportSort(state.publisherSort, key);
      renderPublishersPage();
      return;
    }
    updateReportSort(state.tierSheetSort, key);
    state.tierTablePages[state.selectedTierPage] = 1;
    renderTierPage(state.selectedTierPage);
  }

  function rowValue(row, keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
    }
    return "";
  }

  function getFiltered() {
    const minEpc = Number(state.minEpc || 0);
    const minAov = Number(state.minAov || 0);
    const minCvr = Number(state.minCvr || 0) / 100;
    return offers
      .filter((offer) => state.tier === "all" || offer.tier === state.tier)
      .filter((offer) => state.network === "all" || offer.network === state.network)
      .filter((offer) => state.category === "all" || categoryMatches(offer, state.category))
      .filter((offer) => number(offer.epc) >= minEpc)
      .filter((offer) => number(offer.aov) >= minAov)
      .filter((offer) => number(offer.conversionRate) >= minCvr)
      .filter((offer) => !state.notPaidOnly || hasPaymentRisk(offer))
      .sort((a, b) => (number(b[state.sort]) - number(a[state.sort])) * (state.descending ? 1 : -1));
  }

  function compareDashboardCategoryGroups(a, b) {
    if (a.category === "Uncategorized" && b.category !== "Uncategorized") return 1;
    if (b.category === "Uncategorized" && a.category !== "Uncategorized") return -1;
    return number(b.summary.totalRevenue) - number(a.summary.totalRevenue) ||
      number(b.summary.totalOrders) - number(a.summary.totalOrders) ||
      number(b.summary.totalOffers) - number(a.summary.totalOffers) ||
      String(a.category || "").localeCompare(String(b.category || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function dashboardCategoryGroups(rows) {
    const groups = new Map();
    rows.forEach((offer) => {
      const category = displayCategory(offer) || "Uncategorized";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(offer);
    });
    return Array.from(groups.entries())
      .map(([category, groupRows]) => ({
        category,
        rows: groupRows,
        summary: aggregateRows(groupRows)
      }))
      .sort(compareDashboardCategoryGroups);
  }

  function fuzzyScore(query, offer) {
    const q = normalize(query);
    const brand = normalize(offer.brand);
    if (!q || !brand) return 0;
    if (brand === q) return 100;
    if (offer.merchantId === query.trim()) return 100;
    if (brand.startsWith(q)) return 92;
    if (brand.includes(q)) return 82;
    const queryWords = words(query);
    const haystack = words(`${offer.brand} ${categorySearchText(offer)} ${offer.network}`);
    const matched = queryWords.filter((word) => haystack.some((item) => item.includes(word) || word.includes(item))).length;
    const tokenScore = queryWords.length ? (matched / queryWords.length) * 70 : 0;
    const overlap = [...q].filter((char) => brand.includes(char)).length / Math.max(q.length, 1);
    return Math.max(tokenScore, overlap * 45);
  }

  function findMerchantMatches(query) {
    const cleaned = query
      .replace(/\b(search|find|merchant|overview|info|information|about|for)\b/gi, " ")
      .replace(/æŸ¥æ‰¾|æœç´¢|æŸ¥çœ‹|çœ‹çœ‹|å•†å®¶|å“ç‰Œ|æ¦‚è§ˆ|ä¿¡æ¯|èµ„æ–™|å…³äº|å¸®æˆ‘|è¯·|æ‰¾|åˆ†æ|è¯„ä¼°|è¯Šæ–­|æ€ä¹ˆæ ·|è¡¨ç°|è¶‹åŠ¿|å¥åº·åº¦/g, " ")
      .replace(metricTermPattern(), " ")
      .replace(/çš„/g, " ")
      .trim();
    const scored = offers
      .map((offer) => {
        const score = fuzzyScore(cleaned, offer);
        let adjusted = score;
        if (tierPriority(offer, false, false) < 99) adjusted += 18;
        if (number(offer.orders) > 0 || number(offer.clicks) > 0) adjusted += 8;
        if (offer.tier === "Tier 4") adjusted -= 22;
        if (offer.tier === "BLACK TIER") adjusted -= 60;
        return { offer, score, adjusted };
      })
      .filter((item) => item.score >= 45)
      .sort((a, b) => b.adjusted - a.adjusted || b.score - a.score || tierPriority(a.offer, true, true) - tierPriority(b.offer, true, true));
    const seen = new Set();
    return scored.filter(({ offer }) => {
      const key = `${offer.merchantId}:${normalize(offer.brand)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  function findByMerchantId(text) {
    const match = text.match(/\b\d{5,8}(?:\.0)?\b/);
    if (!match) return null;
    const id = match[0].replace(/\.0$/, "");
    return offers.find((offer) => offer.merchantId === id) || null;
  }

  function findByAsin(text) {
    const match = text.toUpperCase().match(/\bB[A-Z0-9]{9}\b/);
    if (!match) return null;
    const asin = match[0];
    return { asin, rows: offers.filter((offer) => (
      (offer.topAsins || []).includes(asin) ||
      (offer.productAsins || []).includes(asin)
    )) };
  }

  // Return all ASINs found in a prompt (multi-ASIN support).
  function findAllAsins(text) {
    const matches = String(text || "").toUpperCase().match(/\bB[A-Z0-9]{9}\b/g);
    if (!matches || !matches.length) return [];
    const seen = {};
    const results = [];
    for (var i = 0; i < matches.length; i++) {
      var asin = matches[i];
      if (seen[asin]) continue;
      seen[asin] = true;
      results.push({ asin: asin, rows: offers.filter(function(offer) {
        return (offer.topAsins || []).includes(asin) || (offer.productAsins || []).includes(asin);
      }) });
    }
    return results;
  }

  function metricTermPattern() {
    return [
      "commission\\s+(?:made|amount|dollars?)",
      "affiliate\\s+commission",
      "aff\\s+commission",
      "commission\\s+(?:rate|percentage|percent)",
      "conversion(?:\\s+rate)?",
      "order\\s+count",
      "commissions?",
      "revenue",
      "sales",
      "clicks?",
      "orders?",
      "epc",
      "aov",
      "cvr",
      "dpv",
      "atc",
      "äº§ç”Ÿä½£é‡‘",
      "ä½£é‡‘æ”¶å…¥",
      "ä½£é‡‘é‡‘é¢",
      "ä½£é‡‘é¢",
      "è”ç›Ÿä½£é‡‘",
      "ä½£é‡‘ç‡",
      "ä½£é‡‘æ¯”ä¾‹",
      "ä½£é‡‘ç™¾åˆ†æ¯”",
      "ä½£é‡‘",
      "å®¢å•ä»·",
      "å¹³å‡è®¢å•é‡‘é¢",
      "è½¬åŒ–ç‡",
      "è½¬æ¢ç‡",
      "è®¢å•æ•°é‡",
      "è®¢å•æ•°",
      "è®¢å•",
      "é”€å”®é¢",
      "æ”¶å…¥",
      "è¥æ”¶",
      "ç‚¹å‡»é‡",
      "ç‚¹å‡»",
      "è¯¦æƒ…é¡µæµè§ˆé‡",
      "è¯¦æƒ…é¡µæµè§ˆ",
      "æµè§ˆé‡",
      "åŠ è´­æ•°",
      "åŠ è´­",
      "åŠ å…¥è´­ç‰©è½¦"
    ].join("|");
  }

  function comparisonTermPattern() {
    return [
      "greater\\s+than",
      "more\\s+than",
      "higher\\s+than",
      "at\\s+least",
      "less\\s+than",
      "lower\\s+than",
      "at\\s+most",
      "ä¸ä½äº",
      "ä¸å°‘äº",
      "å¤§äºç­‰äº",
      "ä¸è¶…è¿‡",
      "å°äºç­‰äº",
      "above",
      "over",
      "minimum",
      "maximum",
      "below",
      "under",
      "min",
      "max",
      ">=",
      "<=",
      ">",
      "<",
      "è‡³å°‘",
      "æœ€ä½",
      "æœ€å°‘",
      "é«˜äº",
      "è¶…è¿‡",
      "å¤§äº",
      "ä»¥ä¸Š",
      "æœ€å¤š",
      "æœ€é«˜",
      "ä½äº",
      "å°‘äº",
      "å°äº",
      "ä»¥ä¸‹",
      "ä»¥å†…"
    ].join("|");
  }

  function numberTokenPattern() {
    return "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:[kKmM]|åƒ|ä¸‡)?";
  }

  function metricFilterPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|ä¸º|æ˜¯|åœ¨|æœ‰|:|ï¼š)?\\s*(${comparisonTermPattern()})\\s*[$Â¥ï¿¥]?\\s*(${numberTokenPattern()})\\s*%?`, "gi");
  }

  function metricRangeFilterPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|ä¸º|æ˜¯|åœ¨|æœ‰|:|ï¼š)?\\s*(?:between|from|range|ranging|ä»‹äº|ä»|åœ¨)?\\s*[$Â¥ï¿¥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(?:and|to|-|â€“|â€”|åˆ°|è‡³|å’Œ|ä¸)\\s*[$Â¥ï¿¥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(?:ä¹‹é—´|èŒƒå›´)?`, "gi");
  }

  function metricTrailingComparisonPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|ä¸º|æ˜¯|åœ¨|æœ‰|:|ï¼š)?\\s*[$Â¥ï¿¥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(${comparisonTermPattern()})`, "gi");
  }

  function normalizeMetricName(metric) {
    const text = String(metric || "").toLowerCase().replace(/\s+/g, " ");
    if (text === "epc") return { field: "epc", label: "EPC", type: "money" };
    if (text === "aov" || /å®¢å•ä»·|å¹³å‡è®¢å•é‡‘é¢/.test(text)) return { field: "aov", label: "AOV", type: "money" };
    if (text === "cvr" || text.startsWith("conversion") || /è½¬åŒ–ç‡|è½¬æ¢ç‡/.test(text)) return { field: "conversionRate", label: "CVR", type: "percent" };
    if (/dpv|è¯¦æƒ…é¡µæµè§ˆ|æµè§ˆé‡/.test(text)) return { field: "dpv", label: "DPV", type: "count" };
    if (/atc|åŠ è´­|åŠ å…¥è´­ç‰©è½¦/.test(text)) return { field: "atc", label: "ATC", type: "count" };
    if (/click|ç‚¹å‡»/.test(text)) return { field: "clicks", label: "Clicks", type: "count" };
    if (text.includes("commission") || /ä½£é‡‘/.test(text)) {
      if (/made|amount|dollar|affiliate|\baff\b|äº§ç”Ÿ|æ”¶å…¥|é‡‘é¢|é‡‘é¢|è”ç›Ÿ/.test(text)) return { field: "affCommission", label: "Commission made", type: "money" };
      return { field: "commissionRate", label: "Commission rate", type: "percent" };
    }
    if (text === "revenue" || text === "sales" || /é”€å”®é¢|æ”¶å…¥|è¥æ”¶/.test(text)) return { field: "salesAmount", label: "Revenue", type: "money" };
    return { field: "orders", label: "Orders", type: "count" };
  }

  function parseMetricNumber(value) {
    const text = String(value || "").trim().replace(/,/g, "");
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([kKmM]|åƒ|ä¸‡)?$/);
    if (!match) return NaN;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return NaN;
    const suffix = String(match[2] || "").toLowerCase();
    if (suffix === "k") return base * 1000;
    if (suffix === "m") return base * 1000000;
    if (suffix === "åƒ") return base * 1000;
    if (suffix === "ä¸‡") return base * 10000;
    return base;
  }

  function normalizeMetricThreshold(metric, raw, sourceText = "") {
    if (!Number.isFinite(raw)) return NaN;
    const hasPercent = sourceText.includes("%");
    return metric.type === "percent"
      ? (hasPercent || raw > 1 ? raw / 100 : raw)
      : raw;
  }

  function normalizeComparisonOperator(operator) {
    const text = String(operator || "").toLowerCase();
    if (/lower\s+than/.test(text)) return "<";
    if (/below|under|less|at most|maximum|max|<=|<|ä½äº|å°‘äº|å°äº|ä»¥ä¸‹|ä»¥å†…|ä¸è¶…è¿‡|æœ€å¤š|æœ€é«˜|å°äºç­‰äº/.test(text)) {
      return text.includes("=") || /at most|maximum|max|ä¸è¶…è¿‡|æœ€å¤š|æœ€é«˜|å°äºç­‰äº|ä»¥å†…/.test(text) ? "<=" : "<";
    }
    return text.includes("=") || /at least|minimum|min|ä¸ä½äº|ä¸å°‘äº|å¤§äºç­‰äº|è‡³å°‘|æœ€ä½|æœ€å°‘|ä»¥ä¸Š/.test(text) ? ">=" : ">";
  }

  function normalizeCycleComparisonOperator(operator) {
    const text = String(operator || "").toLowerCase();
    if (/before|below|under|less|shorter|<|within|up to|at most|maximum|max|ä½äº|å°‘äº|å°äº|çŸ­äº|æ—©äº|ä»¥å†…|ä»¥ä¸‹|ä¸è¶…è¿‡|æœ€å¤š|è‡³å¤š|å°äºç­‰äº|å°‘äºç­‰äº|ä½äºç­‰äº/.test(text)) {
      return text.includes("=") || /within|up to|at most|maximum|max|ä»¥å†…|ä¸è¶…è¿‡|æœ€å¤š|è‡³å¤š|å°äºç­‰äº|å°‘äºç­‰äº|ä½äºç­‰äº/.test(text) ? "<=" : "<";
    }
    return text.includes("=") || /at least|minimum|min|ä¸ä½äº|ä¸å°‘äº|å¤§äºç­‰äº|è‡³å°‘/.test(text) ? ">=" : ">";
  }

  function paymentCycleFilterPattern() {
    return new RegExp(`(?:payment|pay)\\s+cycle|ä»˜æ¬¾å‘¨æœŸ|æ”¯ä»˜å‘¨æœŸ|ç»“ç®—å‘¨æœŸ|å›æ¬¾å‘¨æœŸ|å‘¨æœŸ`, "i");
  }

  function paymentCycleLeadingFilterPattern() {
    return new RegExp(`((?:(?:payment|pay)\\s+cycle)|ä»˜æ¬¾å‘¨æœŸ|æ”¯ä»˜å‘¨æœŸ|ç»“ç®—å‘¨æœŸ|å›æ¬¾å‘¨æœŸ|å‘¨æœŸ)\\s*(?:is|are|with|of|ä¸º|æ˜¯|åœ¨|æœ‰|:|ï¼š)?\\s*(before|below|under|less\\s+than|shorter\\s+than|within|up\\s+to|at\\s+most|maximum|max|<=|<|above|over|greater\\s+than|more\\s+than|at\\s+least|minimum|min|>=|>|ä½äº|å°‘äº|å°äº|çŸ­äº|æ—©äº|ä»¥å†…|ä»¥ä¸‹|ä¸è¶…è¿‡|æœ€å¤š|è‡³å¤š|å°äºç­‰äº|å°‘äºç­‰äº|ä½äºç­‰äº|é«˜äº|è¶…è¿‡|å¤§äº|è‡³å°‘|ä»¥ä¸Š|ä¸ä½äº|ä¸å°‘äº|å¤§äºç­‰äº)\\s*(${numberTokenPattern()})\\s*(?:days?|d|å¤©|æ—¥)?`, "i");
  }

  function paymentCycleTrailingFilterPattern() {
    return new RegExp(`((?:(?:payment|pay)\\s+cycle)|ä»˜æ¬¾å‘¨æœŸ|æ”¯ä»˜å‘¨æœŸ|ç»“ç®—å‘¨æœŸ|å›æ¬¾å‘¨æœŸ|å‘¨æœŸ)\\s*(?:is|are|with|of|ä¸º|æ˜¯|åœ¨|æœ‰|:|ï¼š)?\\s*(${numberTokenPattern()})\\s*(?:days?|d|å¤©|æ—¥)?\\s*(before|below|under|less\\s+than|shorter\\s+than|within|up\\s+to|at\\s+most|maximum|max|<=|<|above|over|greater\\s+than|more\\s+than|at\\s+least|minimum|min|>=|>|ä½äº|å°‘äº|å°äº|çŸ­äº|æ—©äº|ä»¥å†…|ä»¥ä¸‹|ä¸è¶…è¿‡|æœ€å¤š|è‡³å¤š|å°äºç­‰äº|å°‘äºç­‰äº|ä½äºç­‰äº|é«˜äº|è¶…è¿‡|å¤§äº|è‡³å°‘|ä»¥ä¸Š|ä¸ä½äº|ä¸å°‘äº|å¤§äºç­‰äº)`, "i");
  }

  function extractPaymentCycleFilter(prompt) {
    const text = String(prompt || "");
    if (!paymentCycleFilterPattern().test(text)) return null;
    const leading = paymentCycleLeadingFilterPattern().exec(text);
    const trailing = leading ? null : paymentCycleTrailingFilterPattern().exec(text);
    const match = leading || trailing;
    if (!match) return null;
    const threshold = parseMetricNumber(leading ? match[3] : match[2]);
    if (!Number.isFinite(threshold)) return null;
    return {
      operator: normalizeCycleComparisonOperator(leading ? match[2] : match[3]),
      threshold,
      raw: match[0].trim()
    };
  }

  function paymentCycleFilterMatches(offer, filter) {
    const cycle = number(offer.paymentCycle);
    if (cycle <= 0) return false;
    if (filter.operator === ">") return cycle > filter.threshold;
    if (filter.operator === ">=") return cycle >= filter.threshold;
    if (filter.operator === "<") return cycle < filter.threshold;
    if (filter.operator === "<=") return cycle <= filter.threshold;
    return true;
  }

  function paymentCycleFilterText(filter, language = "en") {
    if (!filter) return "";
    if (language === "zh") {
      const operatorText = {
        "<": "å°‘äº",
        "<=": "ä¸è¶…è¿‡",
        ">": "è¶…è¿‡",
        ">=": "è‡³å°‘"
      }[filter.operator] || filter.operator;
      return `ä»˜æ¬¾å‘¨æœŸ${operatorText}${Number(filter.threshold).toLocaleString()}å¤©`;
    }
    return `Payment cycle ${filter.operator} ${Number(filter.threshold).toLocaleString()} days`;
  }

  function normalizeLlmMetricFilter(filter) {
    // Convert LLM-extracted metric filter to internal format used by applyMetricFilters
    if (!filter || !filter.field || !filter.operator) return null;
    var field = String(filter.field || "").toLowerCase().trim();
    var fieldMap = {
      aov: { field: "aov", label: "AOV", type: "money" },
      epc: { field: "epc", label: "EPC", type: "money" },
      conversionrate: { field: "conversionRate", label: "CVR", type: "percent" },
      cvr: { field: "conversionRate", label: "CVR", type: "percent" },
      affcommission: { field: "affCommission", label: "Commission made", type: "money" },
      commissionrate: { field: "commissionRate", label: "Commission rate", type: "percent" },
      salesamount: { field: "salesAmount", label: "Revenue", type: "money" },
      orders: { field: "orders", label: "Orders", type: "count" },
      clicks: { field: "clicks", label: "Clicks", type: "count" },
      dpv: { field: "dpv", label: "DPV", type: "count" },
      atc: { field: "atc", label: "ATC", type: "count" }
    };
    var meta = fieldMap[field];
    if (!meta) return null;
    var value = Number(filter.value || 0);
    // Normalize percent values: LLM sends "5" for 5%, internal stores 0.05
    if (meta.type === "percent" && value > 1) value = value / 100;
    return {
      field: meta.field,
      label: meta.label,
      type: meta.type,
      operator: String(filter.operator),
      threshold: value,
      raw: ""
    };
  }

  function extractMetricFilters(prompt) {
    const filters = [];
    const text = String(prompt || "");
    let match;
    const rangePattern = metricRangeFilterPattern();
    while ((match = rangePattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const first = normalizeMetricThreshold(metric, parseMetricNumber(match[2]), match[0]);
      const second = normalizeMetricThreshold(metric, parseMetricNumber(match[3]), match[0]);
      if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
      filters.push({
        ...metric,
        operator: "between",
        min: Math.min(first, second),
        max: Math.max(first, second),
        raw: match[0].trim()
      });
    }
    const pattern = metricFilterPattern();
    while ((match = pattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const raw = parseMetricNumber(match[3]);
      if (!Number.isFinite(raw)) continue;
      const threshold = normalizeMetricThreshold(metric, raw, match[0]);
      filters.push({
        ...metric,
        operator: normalizeComparisonOperator(match[2]),
        threshold,
        raw: match[0].trim()
      });
    }
    const trailingPattern = metricTrailingComparisonPattern();
    while ((match = trailingPattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const raw = parseMetricNumber(match[2]);
      if (!Number.isFinite(raw)) continue;
      const threshold = normalizeMetricThreshold(metric, raw, match[0]);
      filters.push({
        ...metric,
        operator: normalizeComparisonOperator(match[3]),
        threshold,
        raw: match[0].trim()
      });
    }
    const seen = new Set();
    return filters.filter((filter) => {
      const key = `${filter.field}:${filter.operator}:${filter.threshold}:${filter.min}:${filter.max}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function metricFilterMatches(offer, filter) {
    const value = number(offer[filter.field]);
    if (filter.operator === "between") return value >= filter.min && value <= filter.max;
    if (filter.operator === ">") return value > filter.threshold;
    if (filter.operator === ">=") return value >= filter.threshold;
    if (filter.operator === "<") return value < filter.threshold;
    if (filter.operator === "<=") return value <= filter.threshold;
    return true;
  }

  function applyMetricFilters(rows, filters) {
    if (!filters || !filters.length) return rows;
    return rows.filter((offer) => filters.every((filter) => metricFilterMatches(offer, filter)));
  }

  function metricThresholdText(filter) {
    if (filter.operator === "between") {
      return `${filter.label} between ${metricValueText(filter, filter.min)} and ${metricValueText(filter, filter.max)}`;
    }
    return `${filter.label} ${filter.operator} ${metricValueText(filter, filter.threshold)}`;
  }

  function metricValueText(filter, metricValue) {
    if (filter.type === "percent") return formatPercentNumber(metricValue * 100);
    if (filter.type === "money") return `$${Number(metricValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return Number(metricValue).toLocaleString();
  }

  function metricFilterText(filters) {
    return filters && filters.length ? filters.map(metricThresholdText).join(", ") : "";
  }

  function metricSortTermPattern() {
    return [
      "highest",
      "lowest",
      "top",
      "best",
      "maximum",
      "minimum",
      "max",
      "min",
      "most",
      "least",
      "largest",
      "biggest",
      "smallest",
      "desc(?:ending)?",
      "asc(?:ending)?"
    ].join("|");
  }

  function metricSortLeadingPattern() {
    return new RegExp(`\\b(${metricSortTermPattern()})\\s+(?:by\\s+|for\\s+|of\\s+)?(${metricTermPattern()})`, "gi");
  }

  function metricSortTrailingPattern() {
    return new RegExp(`(${metricTermPattern()})\\s+(?:is\\s+|are\\s+)?(${metricSortTermPattern()})\\b`, "gi");
  }

  function metricSortByPattern() {
    return new RegExp(`\\b(?:sort(?:ed)?\\s+by|order(?:ed)?\\s+by|rank(?:ed)?\\s+by|based\\s+on|by)\\s+(${metricTermPattern()})(?:\\s+(${metricSortTermPattern()}))?`, "gi");
  }

  function metricSortPatterns() {
    return [metricSortLeadingPattern(), metricSortTrailingPattern(), metricSortByPattern()];
  }

  function normalizeMetricSortDirection(term) {
    const text = String(term || "").toLowerCase();
    if (/lowest|minimum|\bmin\b|least|smallest|asc/.test(text)) return "asc";
    return "desc";
  }

  function normalizeMetricSortName(metric) {
    const normalized = normalizeMetricName(metric);
    const text = String(metric || "").toLowerCase().replace(/\s+/g, " ");
    if (text.includes("commission") && !/(rate|percentage|percent)/.test(text)) {
      return { field: "affCommission", label: "Commission made", type: "money" };
    }
    return normalized;
  }

  function extractMetricSortIntent(prompt) {
    const text = String(prompt || "");
    const matches = [];
    let match;
    const leading = metricSortLeadingPattern();
    while ((match = leading.exec(text))) {
      matches.push({ term: match[1], metric: match[2], index: match.index, raw: match[0].trim() });
    }
    const trailing = metricSortTrailingPattern();
    while ((match = trailing.exec(text))) {
      matches.push({ term: match[2], metric: match[1], index: match.index, raw: match[0].trim() });
    }
    const byPattern = metricSortByPattern();
    while ((match = byPattern.exec(text))) {
      matches.push({ term: match[2] || "highest", metric: match[1], index: match.index, raw: match[0].trim() });
    }
    if (!matches.length) return null;
    const best = matches.sort((a, b) => a.index - b.index)[0];
    const metric = normalizeMetricSortName(best.metric);
    return {
      ...metric,
      direction: normalizeMetricSortDirection(best.term),
      raw: best.raw
    };
  }

  function stripMetricSortPhrases(text) {
    return metricSortPatterns().reduce((output, pattern) => output.replace(pattern, " "), String(text || ""));
  }

  function cleanedCategoryPhrase(text) {
    return stripMetricSortPhrases(text)
      .replace(metricRangeFilterPattern(), " ")
      .replace(metricFilterPattern(), " ")
      .replace(metricTrailingComparisonPattern(), " ")
      .replace(/\b(?:top|give|show|list|export|download|pull)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,4}\s+(?:offers?|brands?|recommendations?)\b/gi, " ")
      .replace(/\btier\s*[1-4]\b/gi, " ")
      .replace(/\bblack\s*tier\b/gi, " ")
      .replace(/\b(?:offers?|brands?|recommendations?|recommend|please|best|top|show|give|list|pull|download|export|with|that|has|have|above|over|below|under|greater|less|than|minimum|maximum|min|max|at|least|most|tier)\b/gi, " ")
      .replace(/æ¨è|è¯·|å¸®æˆ‘|ç»™æˆ‘|æ˜¾ç¤º|åˆ—å‡º|æ‹‰å–|ä¸‹è½½|å¯¼å‡º|æ‰¾|ç­›é€‰|æœ€å¥½|æœ€ä½³|å‰\s*\d*|ç¬¬?\s*[ä¸€äºŒä¸‰å››1-4]\s*(?:å±‚|çº§|æ¡£)|åˆ†å±‚|å±‚çº§|æ¡£ä½|å“ç±»|ç±»åˆ«|ç±»ç›®|å“ç‰Œ|å•†å®¶|ä¸ª|æ¬¾|æ¡|å¤§äºç­‰äº|å°äºç­‰äº|ä¸ä½äº|ä¸å°‘äº|ä¸è¶…è¿‡|å¤§äº|é«˜äº|è¶…è¿‡|ä»¥ä¸Š|è‡³å°‘|æœ€ä½|å°äº|ä½äº|å°‘äº|ä»¥ä¸‹|ä»¥å†…|æœ€å¤š|æœ€é«˜|ä»‹äº|ä¹‹é—´/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasCategoryIntentText(text) {
    return /\b(?:category|categories|subcategory|subcategories|main\s+category|category-wise|categorywise)\b/i.test(String(text || "")) ||
      /å“ç±»|ç±»åˆ«|ç±»ç›®|ä¸»å“ç±»|ä¸»ç±»ç›®|å­å“ç±»|å­ç±»ç›®|åˆ†ç±»/.test(String(text || ""));
  }

  function categoryScore(query, category) {
    const queryTokens = meaningfulTokens(query);
    if (!queryTokens.length) return 0;
    const categoryTokens = meaningfulTokens(category);
    const queryNorm = normalize(query);
    const categoryNorm = normalize(category);
    let score = 0;
    if (categoryNorm === queryNorm) score += 110;
    else if (categoryNorm.includes(queryNorm) || queryNorm.includes(categoryNorm)) score += 55;
    const matched = queryTokens.filter((queryToken) => (
      categoryTokens.some((categoryToken) => {
        if (categoryToken === queryToken) return true;
        if (categoryToken.length <= 3 || queryToken.length <= 3) return false;
        return categoryToken.includes(queryToken) || queryToken.includes(categoryToken);
      })
    )).length;
    score += (matched / queryTokens.length) * 70;
    score += categoryTokens.length ? (matched / categoryTokens.length) * 20 : 0;
    return score;
  }

  function categoryForPrompt(text, skipWantsRec) {
    const knownCategories = allCategoryValues();
    const zhCategory = /[\u4e00-\u9fff]/.test(String(text || "")) && chatbotI18n.categoryForPrompt && chatbotI18n.categoryForPrompt(text, knownCategories);
    if (zhCategory) return zhCategory;
    const lower = String(text || "").toLowerCase();
    const phrase = cleanedCategoryPhrase(text);
    const phraseTokens = meaningfulTokens(phrase);
    // skipWantsRec\uff1awantsRecommendationList \u5185\u90e8\u56de\u8c03\u672c\u51fd\u6570\u65f6\u7f6e true\uff0c\u6253\u7834
    // categoryForPrompt \u2194 wantsRecommendationList \u53cc\u5411\u65e0\u9650\u9012\u5f52\uff08\u540e\u8005\u672b\u884c\u518d\u67e5\u524d\u8005\uff09\u3002
    const allowFuzzyCategory = hasCategoryIntentText(text) || (!skipWantsRec && wantsRecommendationList(text)) || phraseTokens.length > 1;
    const mainCategories = uniqueCategoryValues()
      .filter((cat) => cat !== "Uncategorized")
      .sort((a, b) => String(b).length - String(a).length);
    const directMain = mainCategories.find((category) => {
      const categoryLower = String(category || "").toLowerCase();
      return categoryLower && (lower.includes(categoryLower) || String(phrase || "").toLowerCase().includes(categoryLower));
    });
    if (directMain) return directMain;
    if (phrase && allowFuzzyCategory) {
      const bestMain = mainCategories
        .map((category) => ({ category, score: categoryScore(phrase, category) }))
        .sort((a, b) => b.score - a.score)[0];
      const mainThreshold = hasCategoryIntentText(text) ? 52 : 68;
      if (bestMain && bestMain.score >= mainThreshold) return bestMain.category;
    }
    const direct = knownCategories.find((category) => {
      const categoryLower = String(category || "").toLowerCase();
      return categoryLower && categoryLower !== "uncategorized" && (lower.includes(categoryLower) || String(phrase || "").toLowerCase().includes(categoryLower));
    });
    if (direct) return direct;
    if (phrase && allowFuzzyCategory) {
      const best = knownCategories
        .map((category) => ({ category, score: categoryScore(phrase, category) }))
        .sort((a, b) => b.score - a.score)[0];
      const threshold = hasCategoryIntentText(text) ? 52 : 62;
      if (best && best.score >= threshold) return best.category;
    }
    for (const [canonical, aliases] of Object.entries(categoryAliases)) {
      if (aliases.some((alias) => words(alias).length > 1 && textIncludesAlias(lower, alias))) return canonical;
    }
    if (phraseTokens.length <= 1) {
      for (const [canonical, aliases] of Object.entries(categoryAliases)) {
        if (aliases.some((alias) => textIncludesAlias(lower, alias))) return canonical;
      }
    }
    for (const [canonical, aliases] of Object.entries(categoryAliases)) {
      if (aliases.some((alias) => textIncludesAlias(lower, alias))) return canonical;
    }
    return null;
  }

  // Return all categories mentioned in a prompt (supports multi-category
  // queries like "tier2ç¾å¦†å’Œç”µå­" or "beauty and electronics").
  function categoriesForPrompt(text) {
    const single = categoryForPrompt(text);
    if (!single) return [];

    // Separators that indicate multiple categories
    const sep = /å’Œ|ä¸|ä»¥åŠ|è¿˜æœ‰|åŠ ä¸Š|\band\b|,|ï¼Œ|ã€/i;
    const parts = String(text || "").split(sep).map(function(p) { return p.trim(); }).filter(Boolean);

    if (parts.length <= 1) return [single];

    const categories = [];
    const seen = {};
    for (var i = 0; i < parts.length; i++) {
      var cat = categoryForPrompt(parts[i]);
      if (cat && !seen[cat.toLowerCase()]) {
        seen[cat.toLowerCase()] = true;
        categories.push(cat);
      }
    }
    return categories.length > 0 ? categories : [single];
  }

  // Normalize category input to array form (handles LLM returning string OR array,
  // and also handles comma/å’Œ-separated strings).
  function normalizeCategories(cat) {
    if (!cat) return [];
    if (Array.isArray(cat)) return cat.filter(Boolean);
    // LLM may return comma-separated string for multiple categories
    var parts = String(cat).split(/[,ï¼Œå’Œã€]/).map(function(p) { return p.trim(); }).filter(Boolean);
    return parts;
  }

  function categoryMatches(offer, category) {
    if (!category) return true;
    // Support array of categories â€” match if ANY category fits (OR logic)
    if (Array.isArray(category)) {
      return category.some(function(c) { return categoryMatches(offer, c); });
    }
    const aliases = categoryAliases[category] || [category];
    const mainCategory = sheetMainCategory(offer).toLowerCase();
    if (aliases.some((alias) => textIncludesAlias(mainCategory, alias))) return true;
    if (hasMainCategoryValue(category)) return false;
    const haystack = categorySearchText(offer);
    if (aliases.some((alias) => textIncludesAlias(haystack, alias))) return true;
    const queryTokens = meaningfulTokens(category);
    if (!queryTokens.length) return true;
    const haystackTokens = meaningfulTokens(haystack);
    const matched = queryTokens.filter((queryToken) => (
      haystackTokens.some((token) => token === queryToken || token.includes(queryToken) || queryToken.includes(token))
    )).length;
    return matched >= Math.min(queryTokens.length, queryTokens.length <= 2 ? 2 : Math.ceil(queryTokens.length * 0.65));
  }

  function cleanedMerchantLookupPhrase(text) {
    return stripMetricSortPhrases(text)
      .replace(metricRangeFilterPattern(), " ")
      .replace(metricFilterPattern(), " ")
      .replace(metricTrailingComparisonPattern(), " ")
      .replace(metricTermPattern(), " ")
      .replace(/\b(?:top|give|show|list|export|download|pull|find|search|recommend)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,4}\s+(?:offers?|brands?|recommendations?)\b/gi, " ")
      .replace(/\b(?:offers?|brands?|recommendations?|recommend|please|best|top|show|give|list|pull|download|export|find|search|merchant|brand|overview|info|information|about|for|the)\b/gi, " ")
      .replace(/æ¨è|è¯·|å¸®æˆ‘|ç»™æˆ‘|æ˜¾ç¤º|åˆ—å‡º|æŸ¥æ‰¾|æœç´¢|æ‹‰å–|ä¸‹è½½|å¯¼å‡º|æœ€å¥½|æœ€ä½³|å‰\s*\d*|å•†å®¶|å“ç‰Œ|ä¿¡æ¯|æ¦‚è§ˆ|å…³äº|çš„/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function merchantLookupForPrompt(text) {
    const cleaned = cleanedMerchantLookupPhrase(text);
    if (meaningfulTokens(cleaned).length === 0 && normalize(cleaned).length < 2) return { cleaned, matches: [] };
    return { cleaned, matches: findMerchantMatches(cleaned) };
  }

  function hasStrongMerchantLookup(text, category = null) {
    if (category || hasCategoryIntentText(text) || findByAsin(text) || findByMerchantId(text)) return false;
    if (tierFromPrompt(text) || promptHasPaymentTerms(String(text || "").toLowerCase())) return false;
    if (extractMetricFilters(text).length || extractMetricSortIntent(text)) return false;
    const { cleaned, matches } = merchantLookupForPrompt(text);
    const first = matches[0];
    if (!first) return false;
    const cleanedNorm = normalize(cleaned);
    const brandNorm = normalize(first.offer.brand);
    if (!cleanedNorm || !brandNorm) return false;
    const directBrandMatch = brandNorm === cleanedNorm || brandNorm.startsWith(cleanedNorm) || brandNorm.includes(cleanedNorm) || cleanedNorm.includes(brandNorm);
    const second = matches[1];
    return (directBrandMatch && first.score >= 60) ||
      first.adjusted >= 95 ||
      (first.adjusted >= 85 && (!second || first.adjusted - second.adjusted > 12));
  }

  function tierFromPrompt(text) {
    const zhTier = chatbotI18n.tierFromPrompt && chatbotI18n.tierFromPrompt(text);
    if (zhTier) return zhTier;
    const black = /black\s*tier|blocked|é»‘åå•|é»‘è‰²\s*tier|é»‘è‰²åˆ†å±‚|å±è”½|æš‚åœ/i.test(text);
    if (black) return "BLACK TIER";
    const match = text.match(/tier\s*([1-4ä¸€äºŒä¸‰å››])/i) ||
      text.match(/(?:ç¬¬\s*)?([ä¸€äºŒä¸‰å››1-4])\s*(?:å±‚|çº§|æ¡£)/) ||
      text.match(/(?:åˆ†å±‚|å±‚çº§|æ¡£ä½)\s*([ä¸€äºŒä¸‰å››1-4])/);
    if (!match) return null;
    const tier = { ä¸€: "1", äºŒ: "2", ä¸‰: "3", å››: "4" }[match[1]] || match[1];
    return `Tier ${tier}`;
  }

  // Return all tiers mentioned in a prompt (multi-tier support).
  function tiersFromPrompt(text) {
    const single = tierFromPrompt(text);
    if (!single) return [];
    const sep = /å’Œ|ä¸|ä»¥åŠ|è¿˜æœ‰|åŠ ä¸Š|\band\b|,|ï¼Œ|ã€/i;
    const parts = String(text || "").split(sep).map(function(p) { return p.trim(); }).filter(Boolean);
    if (parts.length <= 1) return [single];
    const tiers = [];
    const seen = {};
    for (var i = 0; i < parts.length; i++) {
      var t = tierFromPrompt(parts[i]);
      if (t && !seen[t]) { seen[t] = true; tiers.push(t); }
    }
    return tiers.length > 0 ? tiers : [single];
  }

  function normalizeTiers(t) {
    if (!t) return [];
    if (Array.isArray(t)) return t.filter(Boolean);
    return [String(t).trim()].filter(Boolean);
  }

  function wantsRecommendationList(text) {
    const lower = String(text || "").toLowerCase();
    const hasRankCommand = /\b(?:recommend|top|give|show|list|export|download|pull|filter)\b/.test(lower) || /æ¨è|æ’è¡Œ|æ’å|ç»™æˆ‘|æ˜¾ç¤º|åˆ—å‡º|æ‹‰å–|å¯¼å‡º|ä¸‹è½½|ç­›é€‰|å‰\s*\d+/.test(text);
    const endsLikeOfferRequest = /\b(?:offers?|brands?|recommendations?)\s*$/.test(lower) || /(?:offer|offers|å“ç‰Œ|å•†å®¶|æ¨è)\s*$/.test(text);
    const hasMetricFilter = extractMetricFilters(text).length > 0;
    const metricSort = extractMetricSortIntent(text);
    if (!hasRankCommand && !endsLikeOfferRequest && !hasMetricFilter && !metricSort) return false;
    return requestedRecommendationCount(text, 0) > 0 ||
      /\b(?:offers?|brands?|recommendations?)\b/.test(lower) ||
      /offer|offers|å“ç‰Œ|å•†å®¶|æ¨è/.test(text) ||
      hasMetricFilter ||
      Boolean(metricSort) ||
      Boolean(tierFromPrompt(text)) ||
      Boolean(categoryForPrompt(text, true));
  }

  function collectCategories() {
    const cats = new Set();
    for (let i = 0; i < offers.length; i++) {
      const cat = offers[i].mainCategory || offers[i].category;
      if (cat && cat !== "Uncategorized") cats.add(cat);
    }
    return Array.from(cats).sort();
  }

  // â”€â”€ Analysis utility functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const ANALYSIS_MIN_CLICKS = 100;
  const ANALYSIS_MIN_ORDERS = 10;
  const ANALYSIS_FIELDS = ["epc", "aov", "conversionRate", "orders", "clicks", "affCommission", "commissionRate", "salesAmount"];
  const ANALYSIS_SAMPLE_RULES = {
    epc: { field: "clicks", minimum: ANALYSIS_MIN_CLICKS },
    conversionRate: { field: "clicks", minimum: ANALYSIS_MIN_CLICKS },
    aov: { field: "orders", minimum: ANALYSIS_MIN_ORDERS },
    commissionRate: { field: "orders", minimum: ANALYSIS_MIN_ORDERS }
  };

  function analysisAffiliateCommission(offer) {
    if (!offer) return null;
    if (isAvailable(offer.affCommission) && Number.isFinite(Number(offer.affCommission))) {
      return Number(offer.affCommission);
    }
    if (isAvailable(offer.affiliatePayout) && Number.isFinite(Number(offer.affiliatePayout))) {
      return Number(offer.affiliatePayout);
    }
    return null;
  }

  // Chat Mode åˆ†æç»Ÿä¸€ä½¿ç”¨ Affiliate EPCï¼›è¿”å›å€¼å•ä½ä¸ºç¾å…ƒ/ç‚¹å‡»ã€‚
  function analysisMetricValueForOffer(offer, field) {
    if (!offer) return null;
    if (field === "epc") {
      var clicks = Number(offer.clicks);
      var commission = analysisAffiliateCommission(offer);
      return clicks > 0 && commission !== null ? commission / clicks : null;
    }
    if (field === "commissionRate") {
      var revenue = Number(offer.salesAmount);
      var affiliateCommission = analysisAffiliateCommission(offer);
      if (revenue > 0 && affiliateCommission !== null) {
        return affiliateCommission / revenue * 100;
      }
      var fallbackRate = isAvailable(offer.affCommissionRate)
        ? offer.affCommissionRate
        : offer.commissionRate;
      var normalizedRate = normalizedCommissionRate(fallbackRate);
      return normalizedRate === null ? null : normalizedRate * 100;
    }
    if (field === "conversionRate") {
      if (isAvailable(offer.conversionRate) && Number.isFinite(Number(offer.conversionRate))) {
        return Number(offer.conversionRate) * 100;
      }
      var fallbackClicks = Number(offer.clicks);
      var fallbackOrders = Number(offer.orders);
      return fallbackClicks > 0 && Number.isFinite(fallbackOrders)
        ? fallbackOrders / fallbackClicks * 100
        : null;
    }
    if (!isAvailable(offer[field]) || !Number.isFinite(Number(offer[field]))) return null;
    return Number(offer[field]);
  }

  function analysisMetricSampleSize(offer, field) {
    var rule = ANALYSIS_SAMPLE_RULES[field];
    if (!rule || !offer) return null;
    var sample = Number(offer[rule.field]);
    return Number.isFinite(sample) ? sample : 0;
  }

  function analysisMetricSampleEligible(offer, field) {
    var rule = ANALYSIS_SAMPLE_RULES[field];
    if (!rule) return true;
    return analysisMetricSampleSize(offer, field) >= rule.minimum;
  }

  function analysisComparableOffers(offList, field) {
    return (offList || []).filter(function(offer) {
      var value = analysisMetricValueForOffer(offer, field);
      return value !== null
        && Number.isFinite(Number(value))
        && analysisMetricSampleEligible(offer, field);
    });
  }

  function analysisAverage(offList, field) {
    var comparable = analysisComparableOffers(offList, field);
    if (!comparable.length) return null;
    var total = 0;
    for (var i = 0; i < comparable.length; i++) {
      total += analysisMetricValueForOffer(comparable[i], field);
    }
    return total / comparable.length;
  }

  function percentileRank(value, values) {
    if (!values || !values.length) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var countLower = 0;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i] < value) countLower++;
    }
    return Math.round((countLower / sorted.length) * 100);
  }

  function segmentedStats(offers, field) {
    if (!offers || !offers.length) return { head: { count: 0, avg: 0 }, mid: { count: 0, avg: 0 }, tail: { count: 0, avg: 0 } };
    var sorted = offers.slice().sort(function(a, b) { return (b[field] || 0) - (a[field] || 0); });
    var total = sorted.length;
    var headCount = Math.max(1, Math.round(total * 0.2));
    var tailCount = Math.max(1, Math.round(total * 0.2));
    var midCount = total - headCount - tailCount;
    function avg(slice) {
      if (!slice.length) return 0;
      var sum = 0;
      for (var i = 0; i < slice.length; i++) sum += (slice[i][field] || 0);
      return sum / slice.length;
    }
    return {
      head: { count: headCount, avg: avg(sorted.slice(0, headCount)) },
      mid: { count: midCount, avg: avg(sorted.slice(headCount, headCount + midCount)) },
      tail: { count: tailCount, avg: avg(sorted.slice(headCount + midCount)) }
    };
  }

  function metricLabel(field) {
    var labels = { epc: "EPC(Aff)", aov: "AOV", conversionRate: "CVR", orders: "Orders", clicks: "Clicks", affCommission: "Aff Commission", commissionRate: "AFF Comm %", salesAmount: "Sales", revenue: "Revenue", affiliatePayout: "Commission", dpv: "DPV", atc: "ATC", payout: "Payout", directSales: "Direct Sales", haloSales: "Halo Sales" };
    return labels[field] || field;
  }

  function pctDelta(selfVal, otherVal) {
    if (selfVal == null || otherVal == null || !Number.isFinite(Number(selfVal)) || !Number.isFinite(Number(otherVal)) || otherVal === 0) return "N/A";
    var delta = ((selfVal - otherVal) / Math.abs(otherVal)) * 100;
    var sign = delta >= 0 ? "+" : "";
    return sign + delta.toFixed(1) + "%";
  }

  function metricValueForOffer(offer, field) {
    var value = analysisMetricValueForOffer(offer, field);
    return value === null ? 0 : value;
  }

  function formatAnalysisMetric(value, field) {
    if (value == null) return "N/A";
    if (field === "conversionRate" || field === "commissionRate") return pct(value / 100);
    if (field === "epc") return epc(value);
    if (field === "aov" || field === "salesAmount" || field === "affCommission" || field === "affiliatePayout" || field === "revenue") return money(value);
    if (field === "orders" || field === "clicks" || field === "dpv" || field === "atc") return number(value).toLocaleString();
    return String(value);
  }

  // Determine whether regex alone can confidently classify this query,
  // allowing us to skip the LLM API call entirely.
  //
  // We skip LLM for formulaic queries where regex is just as accurate:
  //   ASIN, merchant ID, help/greeting, attribute filters, top-N metric,
  //   tier offer plans, and any query with EXACTLY ONE clear intent signal
  //   (simple tier browse, simple category browse, simple payment, simple
  //   metric filter, simple payment-cycle filter).
  //
  // We keep LLM for:
  //   - Analysis queries (better type/target extraction + narrative text)
  //   - Recommendation queries (better multi-param disambiguation)
  //   - Multi-signal queries (tier + category, tier + metric, etc.)
  //   - Truly ambiguous queries (no regex signal at all)
  function canSkipLLMClassify(prompt) {
    var lower = String(prompt || "").toLowerCase().trim();
    if (!lower) return true;

    // â”€â”€ Formulaic patterns: regex is EXACT, LLM adds ZERO value â”€â”€

    // ASIN: rigid B + 9 alphanumeric format
    if (findByAsin(prompt)) return true;

    // Merchant ID: rigid 5-8 digit format that matches a known offer
    if (findByMerchantId(prompt)) return true;

    // Help / greeting / very short prompts
    if (lower.length < 3) return true;
    if (/^(help|hello|hi|what can you do)\??$/.test(lower)) return true;
    if (/^å¸®åŠ©$|^ä½ å¥½$|^èƒ½åšä»€ä¹ˆ/.test(prompt)) return true;

    // Special attribute filters â€” keyword matching is deterministic
    if (/high epc|high aov|low conversion|low cvr|tracking issue|has asin|discount/.test(lower)) return true;
    if (/é«˜\s*epc|é«˜\s*aov|ä½è½¬åŒ–|ä½è½¬æ¢|è·Ÿè¸ªé—®é¢˜|è¿½è¸ªé—®é¢˜|æœ‰\s*asin|æŠ˜æ‰£|ä¼˜æƒ /.test(prompt)) return true;

    // Top metric request â€” formulaic "top/highest EPC/AOV/commission" patterns
    if (extractTopMetricRequest(prompt)) return true;

    // Merchant name + optional metric â€” "Shokz EPC", "Shokzçš„AOV", etc.
    // The merchant name is the primary entity; metric suffix adds no ambiguity.
    // hasDirectMerchantKeywordLookup uses cleanedMerchantLookupPhrase which
    // strips metric terms ("EPC", "AOV", â€¦) and "çš„" before matching.
    if (hasDirectMerchantKeywordLookup(prompt)) return true;

    // â”€â”€ Intent signals (computed early â€” used by checks below) â”€â”€

    var tier = tierFromPrompt(prompt);
    var category = categoryForPrompt(prompt);
    var hasPaymentKeywords = /payment|paid|unpaid|late|issue|cycle/.test(lower) ||
      /ä»˜æ¬¾|æœªä»˜æ¬¾|æ²¡ä»˜æ¬¾|æœªæ”¯ä»˜|å·²ä»˜æ¬¾|å·²æ”¯ä»˜|é€¾æœŸ|åˆ°æœŸ|å¾…å¤„ç†|æ”¯ä»˜|ç»“ç®—|æ¬¾é¡¹|ä»˜æ¬¾å‘¨æœŸ|æ”¯ä»˜å‘¨æœŸ|ç»“ç®—å‘¨æœŸ/.test(prompt);
    var hasRecommendationKeywords = /recommend|push|focus|best|should we/.test(lower) ||
      /æ¨è|æ’è¡Œ|æ’å|æœ€å¥½|æœ€ä½³|ä¸»æ¨|é‡ç‚¹|åº”è¯¥|ç­›é€‰|å‰\s*\d+/.test(prompt) ||
      wantsRecommendationList(prompt);
    var hasAnalysisKeywords = /åˆ†æ|è¯„ä¼°|è¯Šæ–­|æ€ä¹ˆæ ·|è¡¨ç°å¦‚ä½•|è¶‹åŠ¿|å¥åº·åº¦|çŠ¶æ€|è¯„æµ‹|æµ‹æµ‹|çœ‹çœ‹|å‡çº§|é™çº§|å‡é™çº§|æå‡åˆ°|å¯¹æ¯”|æ¯”è¾ƒ|å’Œ.*å¯¹æ¯”|ä¸.*ç›¸æ¯”/.test(prompt) ||
      /\b(?:analyze|analysis|evaluate|diagnose|assess|how\s+is|how\s+are|how\s+about|performance|health\s+check|trend|promotion|demotion|upgrade|downgrade)\b/i.test(lower);
    var hasMetricSignal = extractMetricSortIntent(prompt) || extractMetricFilters(prompt).length > 0;
    var hasPaymentCycleFilter = !!extractPaymentCycleFilter(prompt);

    // â”€â”€ Keep LLM for analysis and recommendation â”€â”€
    // These are checked FIRST because other patterns (tier offer plan, metric
    // signals) may also match recommendation queries â€” but the user wants
    // analysis and recommendation to always use LLM for better param extraction.
    if (hasAnalysisKeywords) return false;
    if (hasRecommendationKeywords) return false;

    // â”€â”€ Tier offer plan without recommendation keywords â”€â”€
    // Formulaic "Tier 1: 5, Tier 2: 10" with no æ¨è/analysis keywords â†’
    // regex handles perfectly.  If recommendation keywords were present,
    // the check above already returned false.
    if (parseTierOfferRequest(prompt).length > 0) return true;

    // â”€â”€ Multi-signal queries â†’ LLM helps disambiguate â”€â”€
    // Count the non-merchant intent signals present in the prompt.
    // A single signal = simple browse ("Tier 1", "beauty", "unpaid", "EPC>1").
    // Multiple signals = complex query that benefits from LLM routing.
    var signalCount = 0;
    if (tier) signalCount++;
    if (category) signalCount++;
    if (hasPaymentKeywords) signalCount++;
    if (hasMetricSignal) signalCount++;
    if (hasPaymentCycleFilter) signalCount++;
    if (signalCount >= 2) return false;

    // â”€â”€ Single clear signal â†’ regex handles it perfectly â”€â”€
    if (signalCount === 1) return true;

    // â”€â”€ No domain signal â€” check alternative regex paths â”€â”€

    // Strong merchant name lookup (high-confidence fuzzy match)
    if (hasStrongMerchantLookup(prompt, category)) return true;

    // Context followup (pronouns / metric references to last viewed merchant)
    if (contextFollowup(lower)) return true;

    // Keyword search intent
    if (hasKeywordSearchIntent(prompt, keywordSearchRequest(prompt), {})) return true;

    // No clear signal â€” ambiguous query.  Let LLM try to disambiguate.
    return false;
  }

  async function classifyWithLLM(prompt, categories) {
    const trimmed = String(prompt || "").trim();
    if (!trimmed) return null;
    if (llmClassifyCache.has(trimmed)) return llmClassifyCache.get(trimmed);
    if (state.llmEnabled === false) return null;
    try {
      const response = await fetch("/api/chat/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        credentials: "same-origin",
        body: JSON.stringify({ prompt: trimmed, categories: categories || [] }),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        console.warn("[LLM] fallback to regex: HTTP " + response.status);
        llmClassifyCache.set(trimmed, null);
        return null;
      }
      const data = await response.json().catch(() => ({}));
      const intent = data.intent || null;
      const params = (data.params && typeof data.params === "object" && !Array.isArray(data.params)) ? data.params : null;
      if (!intent) {
        llmClassifyCache.set(trimmed, null);
        return null;
      }
      const result = { intent: intent, params: params };
      llmClassifyCache.set(trimmed, result);
      return result;
    } catch (error) {
      const reason = error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : error.message || "unknown";
      console.warn("[LLM] fallback to regex: " + reason);
      llmClassifyCache.set(trimmed, null);
      return null;
    }
  }

  // â”€â”€ Analysis computation functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // è§„èŒƒåŒ–å•†æˆ·åç©ºç™½ï¼ˆæŠ˜å è¿ç»­ç©ºæ ¼ã€å»é¦–å°¾ç©ºæ ¼ï¼‰ï¼Œ
  // é¿å… "Our  Place"ï¼ˆæ•°æ®æºåŒç©ºæ ¼ï¼‰åŒ¹é…ä¸åˆ°ç”¨æˆ·è¾“å…¥çš„ "Our Place"
  function normalizedOfferName(offer, field) {
    return ((offer && offer[field]) || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function findOfferByMerchantName(name) {
    if (!name) return null;
    var lower = name.toLowerCase().replace(/\s+/g, " ").trim();
    // Try exact match first
    for (var i = 0; i < offers.length; i++) {
      if (normalizedOfferName(offers[i], "brand") === lower || normalizedOfferName(offers[i], "merchantName") === lower) {
        return offers[i];
      }
    }
    // Try includes match
    for (var i = 0; i < offers.length; i++) {
      if (normalizedOfferName(offers[i], "brand").indexOf(lower) !== -1 || normalizedOfferName(offers[i], "merchantName").indexOf(lower) !== -1) {
        return offers[i];
      }
    }
    // Try fuzzy match via existing lookup
    var matches = findMerchantMatches(name);
    if (matches && matches.length) return matches[0].offer;
    return null;
  }

  /** Load fresh offers data from the live DB endpoint (bypasses 24h cache). */
  async function loadLiveChatbotData() {
    if (_liveChatbotDataLoaded) return;
    if (_liveChatbotDataLoading) return _liveChatbotDataPromise;
    if (window.__OFFER_INTELLIGENCE_TEST__) return;  // no fetch in test env
    _liveChatbotDataLoading = true;
    _liveChatbotDataPromise = (async function() {
      try {
        var resp = await fetch(DB_CHATBOT_OFFERS_UI_API, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          var json = await resp.json();
          if (json && Array.isArray(json.offers) && json.offers.length > 0) {
            _liveChatbotOffers = json.offers;
            _liveChatbotOffersById = new Map();
            for (var i = 0; i < _liveChatbotOffers.length; i++) {
              var o = _liveChatbotOffers[i];
              var mid = String(o.merchantId || "").trim();
              if (mid) _liveChatbotOffersById.set(mid, o);
            }
            _liveChatbotDataLoaded = true;
          }
        }
      } catch (_e) {
        // Live data unavailable â€” fall back to cached offers
      } finally {
        _liveChatbotDataLoading = false;
      }
    })();
    return _liveChatbotDataPromise;
  }

  /** Find a merchant's offer, preferring live data (loaded from DB) over cached. */
  function findLiveOffer(name) {
    if (!name) return null;
    var lower = name.toLowerCase().replace(/\s+/g, " ").trim();
    // Try live data first
    if (_liveChatbotDataLoaded && _liveChatbotOffers) {
      for (var i = 0; i < _liveChatbotOffers.length; i++) {
        if (normalizedOfferName(_liveChatbotOffers[i], "brand") === lower
            || normalizedOfferName(_liveChatbotOffers[i], "merchantName") === lower) {
          return _liveChatbotOffers[i];
        }
      }
      for (var i = 0; i < _liveChatbotOffers.length; i++) {
        if (normalizedOfferName(_liveChatbotOffers[i], "brand").indexOf(lower) !== -1
            || normalizedOfferName(_liveChatbotOffers[i], "merchantName").indexOf(lower) !== -1) {
          return _liveChatbotOffers[i];
        }
      }
    }
    // Fall back to cached offers
    return findOfferByMerchantName(name);
  }

  // Tier 4 / BLACK TIER åˆ¤æ–­ï¼ˆå“ç±»è¶‹åŠ¿å£å¾„ï¼šæ’é™¤ä¸¤è€…ï¼Œä¸å“ç±»åˆ†æ sortedForCategory ä¸€è‡´ï¼‰
  function isTier4OrBlack(tierName) {
    var t = canonicalTierName(tierName);
    return t === "Tier 4" || t === "BLACK TIER";
  }

  // opts.excludeTier4Black: true æ—¶æ’é™¤ Tier 4 / BLACK TIERï¼ˆä»…å“ç±»è¶‹åŠ¿è·¯å¾„ä¼  trueï¼›
  // analyzeCategory ç­‰å…¶ä»–è°ƒç”¨æ–¹ä¿æŒé»˜è®¤å…¨é‡ï¼Œå£å¾„ä¸å˜ï¼‰
  function offersInCategory(categoryName, opts) {
    if (!categoryName) return [];
    var excludeTier4Black = !!(opts && opts.excludeTier4Black);
    var lower = categoryName.toLowerCase().trim();
    return offers.filter(function(o) {
      if (excludeTier4Black && isTier4OrBlack(o.tier)) return false;
      var cat = (o.mainCategory || o.category || "").toLowerCase();
      return cat === lower || cat.indexOf(lower) !== -1;
    });
  }

  function offersInTier(tierName) {
    if (!tierName) return [];
    return offers.filter(function(o) { return o.tier === tierName; });
  }

  function globalAverages() {
    var result = {};
    for (var i = 0; i < ANALYSIS_FIELDS.length; i++) {
      var field = ANALYSIS_FIELDS[i];
      result[field] = analysisAverage(offers, field);
    }
    return result;
  }

  function analyzeMerchant(name) {
    var offer = findOfferByMerchantName(name);
    if (!offer) return null;

    var category = offer.mainCategory || offer.category || "Uncategorized";
    var tier = offer.tier || "Unknown";
    var categoryOffers = offersInCategory(category);
    var tierOffers = offersInTier(tier);
    var globals = globalAverages();

    var fields = ANALYSIS_FIELDS;
    var metrics = {};
    for (var f = 0; f < fields.length; f++) {
      metrics[fields[f]] = metricValueForOffer(offer, fields[f]);
    }

    // Percentile ranks within category
    var ranks = {};
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var comparableOffers = analysisComparableOffers(categoryOffers, field);
      var catValues = comparableOffers.map(function(comparableOffer) {
        return metricValueForOffer(comparableOffer, field);
      });
      var sampleEligible = analysisMetricSampleEligible(offer, field);
      var percentile = sampleEligible && catValues.length
        ? percentileRank(metrics[field], catValues)
        : null;
      var rankStatus = !sampleEligible
        ? "insufficient_sample"
        : (catValues.length ? "ok" : "no_comparison");
      ranks[field] = {
        value: metrics[field],
        percentile: percentile,
        totalInCategory: comparableOffers.length,
        comparisonCount: comparableOffers.length,
        sampleSize: analysisMetricSampleSize(offer, field),
        sampleEligible: sampleEligible,
        status: rankStatus
      };
    }

    function compare(selfVal, otherAvg) {
      return { self: selfVal, avg: otherAvg, delta: pctDelta(selfVal, otherAvg) };
    }

    var comparisons = { vsCategory: {}, vsTier: {}, vsGlobal: {} };
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      comparisons.vsCategory[field] = compare(metrics[field], analysisAverage(categoryOffers, field));
      comparisons.vsTier[field] = compare(metrics[field], analysisAverage(tierOffers, field));
      comparisons.vsGlobal[field] = compare(metrics[field], globals[field]);
    }

    // Strengths and weaknesses (based on category percentile)
    var strengths = [];
    var weaknesses = [];
    for (var f = 0; f < fields.length; f++) {
      if (!ranks[fields[f]].sampleEligible || ranks[fields[f]].percentile === null) continue;
      if (ranks[fields[f]].percentile >= 70) strengths.push(fields[f]);
      if (ranks[fields[f]].percentile <= 30) weaknesses.push(fields[f]);
    }

    // Payment risk
    var paymentRisk = {
      hasOverdue: hasOfferOverduePayment ? hasOfferOverduePayment(offer) : false,
      riskText: paymentRiskTextForOffer ? paymentRiskTextForOffer(offer) : "N/A"
    };

    // Peers (same category + same tier, top 3 by commission)
    var peers = categoryOffers.filter(function(o) {
      return o.tier === tier && (o.brand || o.merchantName) !== (offer.brand || offer.merchantName);
    }).sort(function(a, b) {
      return (b.affCommission || 0) - (a.affCommission || 0);
    }).slice(0, 3).map(function(o) {
      var pm = {};
      for (var f = 0; f < fields.length; f++) {
        pm[fields[f]] = metricValueForOffer(o, fields[f]);
      }
      return { name: o.brand || o.merchantName || "Unknown", metrics: pm };
    });

    return {
      type: "merchant",
      target: { name: offer.brand || offer.merchantName || name, id: offer.merchantId || "", tier: tier, category: category },
      metrics: metrics,
      ranks: ranks,
      comparisons: comparisons,
      strengths: strengths,
      weaknesses: weaknesses,
      paymentRisk: paymentRisk,
      peers: peers
    };
  }

  function analyzeMerchantComparison(targets) {
    if (!targets || targets.length < 2) return null;
    var language = state.language || "en";
    var zh = language === "zh";

    // Resolve each target to an offer
    var offers = [];
    var notFound = [];
    for (var i = 0; i < targets.length; i++) {
      var o = findOfferByMerchantName(targets[i]);
      if (o) offers.push(o); else notFound.push(targets[i]);
    }
    if (!offers.length) return null;

    var fields = ["epc", "aov", "conversionRate", "orders", "clicks", "affCommission", "commissionRate", "salesAmount"];
    var entities = [];
    for (var i = 0; i < offers.length; i++) {
      var offer = offers[i];
      var metrics = {};
      for (var f = 0; f < fields.length; f++) metrics[fields[f]] = metricValueForOffer(offer, fields[f]);
      entities.push({
        name: offer.brand || offer.merchantName || targets[i],
        tier: offer.tier || "Unknown",
        category: offer.mainCategory || offer.category || "Uncategorized",
        visualStatus: highlightStatus(offer),
        paymentRisk: paymentRiskTextForOffer ? paymentRiskTextForOffer(offer) : "N/A",
        metrics: metrics
      });
    }

    // Compute pairwise deltas (first vs rest as reference)
    var deltas = (entities.length >= 2) ? {} : null;
    if (deltas) {
      var ref = entities[0];
      for (var f = 0; f < fields.length; f++) {
        var field = fields[f];
        var refVal = ref.metrics[field];
        var otherVal = entities[1].metrics[field];
        var abs = otherVal - refVal;
        var pct = refVal !== 0 ? ((otherVal - refVal) / Math.abs(refVal)) * 100 : 0;
        deltas[field] = {
          abs: abs,
          pct: pct,
          better: abs > 0 ? entities[1].name : (abs < 0 ? ref.name : "tie")
        };
      }
    }

    // ä¿ç•™åŸæœ‰ä¸¤å®ä½“ deltas ä¾› Report Mode è¡¨æ ¼ä½¿ç”¨ï¼›Agent é¢å¤–æ‹¿åˆ°
    // å‚è€ƒå•†æˆ·ä¸æ¯ä¸ªåŒè¡Œçš„å®Œæ•´å·®å¼‚ï¼Œé¿å… 3+ å•†æˆ·æ—¶åªæ¯”è¾ƒç¬¬äºŒä¸ªå®ä½“ã€‚
    var pairwiseDeltas = [];
    if (entities.length >= 2) {
      var reference = entities[0];
      for (var p = 1; p < entities.length; p++) {
        var peer = entities[p];
        var peerMetrics = {};
        for (var pf = 0; pf < fields.length; pf++) {
          var peerField = fields[pf];
          var referenceValue = reference.metrics[peerField];
          var peerValue = peer.metrics[peerField];
          var peerAbs = peerValue - referenceValue;
          var peerPct = referenceValue !== 0
            ? ((peerValue - referenceValue) / Math.abs(referenceValue)) * 100
            : 0;
          peerMetrics[peerField] = {
            abs: peerAbs,
            pct: peerPct,
            better: peerAbs > 0 ? peer.name : (peerAbs < 0 ? reference.name : "tie")
          };
        }
        pairwiseDeltas.push({
          reference: reference.name,
          target: peer.name,
          metrics: peerMetrics
        });
      }
    }

    return {
      type: "merchant_comparison",
      entities: entities,
      targetCount: entities.length,
      notFound: notFound.length ? notFound : null,
      deltas: deltas,
      pairwiseDeltas: pairwiseDeltas
    };
  }

  function computeTrend(monthlyMetrics, trendMetric) {
    if (!monthlyMetrics || !monthlyMetrics.length || monthlyMetrics.length < 2) return null;
    var language = state.language || "en";
    var zh = language === "zh";

    // Sort by month ASC (oldest first)
    var sorted = monthlyMetrics.slice().sort(function(a, b) {
      return (a.month || "").localeCompare(b.month || "");
    });

    // Determine which metrics to showï¼ˆå¯é€‰æŒ‡æ ‡æ¥è‡ª TREND_METRIC_DEFSï¼Œè¦†ç›– Tier Sheet æ•°å€¼æŒ‡æ ‡ï¼‰
    var allMetrics = TREND_METRIC_DEFS.map(function(def) { return def.key; });
    var displayMetrics = trendMetric
      ? (allMetrics.indexOf(trendMetric) !== -1 ? [trendMetric] : allMetrics)
      : allMetrics;

    // Map metric key â†’ æ•°æ®è¡Œå­—æ®µåï¼ˆcommission åˆ«åæ˜ å°„åˆ° affiliatePayoutï¼‰
    var metricFieldMap = {};
    TREND_METRIC_DEFS.forEach(function(def) { metricFieldMap[def.key] = def.source; });
    metricFieldMap.commission = "affiliatePayout";

    // Build month data rows
    var months = [];
    for (var i = 0; i < sorted.length; i++) {
      var row = sorted[i];
      // If months > 12, trim to last 12
      if (sorted.length > 12 && i < sorted.length - 12) continue;
      var monthData = { month: row.month || "unknown" };
      for (var m = 0; m < displayMetrics.length; m++) {
        var field = metricFieldMap[displayMetrics[m]] || displayMetrics[m];
        monthData[displayMetrics[m]] = Number(row[field]) || 0;
      }
      months.push(monthData);
    }

    // Compute deltas (month-over-month)
    var deltas = {};
    for (var i = 1; i < months.length; i++) {
      var curr = months[i];
      var prev = months[i - 1];
      var monthKey = curr.month;
      var monthDeltas = {};
      for (var m = 0; m < displayMetrics.length; m++) {
        var metric = displayMetrics[m];
        var currVal = curr[metric] || 0;
        var prevVal = prev[metric] || 0;
        var abs = currVal - prevVal;
        var pct = prevVal !== 0 ? ((currVal - prevVal) / Math.abs(prevVal)) * 100 : 0;
        monthDeltas[metric] = {
          abs: abs,
          pct: pct,
          dir: abs > 0 ? "up" : (abs < 0 ? "down" : "flat")
        };
      }
      deltas[monthKey] = monthDeltas;
    }

    // Overall summary (first vs last)
    var first = months[0];
    var last = months[months.length - 1];
    var summary = {};
    for (var m = 0; m < displayMetrics.length; m++) {
      var metric = displayMetrics[m];
      var fVal = first[metric] || 0;
      var lVal = last[metric] || 0;
      var absDelta = lVal - fVal;
      var pctDelta2 = fVal !== 0 ? ((lVal - fVal) / Math.abs(fVal)) * 100 : 0;
      summary[metric] = {
        first: fVal,
        last: lVal,
        abs: absDelta,
        pct: pctDelta2,
        dir: absDelta > 0 ? "up" : (absDelta < 0 ? "down" : "flat")
      };
    }

    return {
      type: "trend",
      metrics: displayMetrics,
      months: months,
      deltas: deltas,
      summary: summary
    };
  }

  function generateTrendFromOfferSummary(offer, monthCount) {
    if (!offer) return null;
    var invoiceMonths = offer.invoiceMonths;
    if (!Array.isArray(invoiceMonths) || invoiceMonths.length < 2) {
      // Fall back to last N months if no invoiceMonths
      var defaultCount = (typeof monthCount === "number" && monthCount >= 2) ? monthCount : 3;
      var now = new Date();
      invoiceMonths = [];
      for (var i = defaultCount - 1; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        invoiceMonths.push(y + "-" + m);
      }
    }
    // Use the available months (at most 12), respecting requested count
    var months = invoiceMonths.slice(-12);
    if (typeof monthCount === "number" && monthCount >= 2 && months.length > monthCount) {
      months = months.slice(-monthCount);
    }
    if (months.length < 2) return null;

    // Aggregate totals from the offer
    var totalRevenue = Number(offer.salesAmount) || 0;
    var totalOrders = Number(offer.orders) || 0;
    // clicks å¯èƒ½æ˜¯ 0ï¼ˆç¼“å­˜æ•°æ®ä¸å®Œæ•´ï¼‰ï¼Œæ­¤æ—¶ç”¨ dpv/atc ä½œä¸ºæ›¿ä»£ä¼°ç®—
    var totalClicks = Number(offer.clicks)
      || Number(offer.dpv)       // Detail Page Views
      || Number(offer.atc)       // Add To Cart
      || 0;
    var totalCommission = Number(offer.affCommission || offer.affiliatePayout) || 0;
    var n = months.length;

    // Build monthly entries by distributing totals evenly across active months
    var metricRows = [];
    for (var i = 0; i < months.length; i++) {
      var rev = totalRevenue / n;
      var ord = totalOrders / n;
      var clk = totalClicks / n;
      var comm = totalCommission / n;

      metricRows.push({
        month: months[i],
        revenue: Math.round(rev * 100) / 100,
        orders: Math.round(ord),
        epc: clk > 0 ? Math.round((comm / clk) * 10000) / 10000 : 0,
        aov: ord > 0 ? Math.round((rev / ord) * 100) / 100 : 0,
        clicks: Math.round(clk),
        affiliatePayout: Math.round(comm * 100) / 100
      });
    }

    // Let computeTrend do the heavy lifting (deltas, MoM, summary)
    return computeTrend(metricRows, null);
  }

  function analyzeCategory(name) {
    var catOffers = offersInCategory(name);
    if (!catOffers.length) return null;

    var canonicalName = catOffers[0].mainCategory || catOffers[0].category || name;
    var globals = globalAverages();

    // Tier distribution
    var tierDist = {};
    for (var i = 0; i < catOffers.length; i++) {
      var t = catOffers[i].tier || "Unknown";
      tierDist[t] = (tierDist[t] || 0) + 1;
    }

    // Aggregates
    function sumField(list, field) {
      var s = 0;
      for (var i = 0; i < list.length; i++) s += metricValueForOffer(list[i], field);
      return s;
    }
    function avgField(list, field) {
      return analysisAverage(list, field);
    }

    var aggregates = {
      merchantCount: catOffers.length,
      totalRevenue: sumField(catOffers, "salesAmount"),
      totalCommission: sumField(catOffers, "affCommission"),
      totalOrders: sumField(catOffers, "orders"),
      avgEpc: avgField(catOffers, "epc"),
      avgAov: avgField(catOffers, "aov"),
      avgCvr: avgField(catOffers, "conversionRate"),
      avgCommissionRate: avgField(catOffers, "commissionRate")
    };

    // vs Global
    var vsGlobal = {};
    var compFields = ["epc", "aov", "conversionRate", "commissionRate"];
    for (var f = 0; f < compFields.length; f++) {
      var field = compFields[f];
      vsGlobal[field] = { self: aggregates["avg" + field.charAt(0).toUpperCase() + field.slice(1)] || avgField(catOffers, field), global: globals[field], delta: pctDelta(avgField(catOffers, field), globals[field]) };
    }

    // Top 5 and Bottom 3 by commission
    var byCommission = catOffers.slice().sort(function(a, b) { return (b.affCommission || 0) - (a.affCommission || 0); });
    function briefOffer(o) {
      return {
        name: o.brand || o.merchantName || "Unknown",
        tier: o.tier || "Unknown",
        epc: o.epc || 0,
        aov: o.aov || 0,
        conversionRate: (o.conversionRate || 0) * 100,
        affCommission: o.affCommission || 0,
        allCommission: o.payout || 0,
        allEpc: offerAllEpc(o),
        affEpc: offerAffEpc(o)
      };
    }
    var topMerchants = byCommission.slice(0, 5).map(briefOffer);
    var bottomMerchants = byCommission.slice(-3).reverse().map(briefOffer);

    return {
      type: "category",
      target: { name: canonicalName, merchantCount: catOffers.length, tierDistribution: tierDist },
      aggregates: aggregates,
      vsGlobal: vsGlobal,
      topMerchants: topMerchants,
      bottomMerchants: bottomMerchants
    };
  }

  function analyzeTier(name) {
    var tierOffers = offersInTier(name);
    if (!tierOffers.length) return null;

    var allTiers = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"];
    var globals = globalAverages();

    function sumField(list, field) {
      var s = 0;
      for (var i = 0; i < list.length; i++) s += metricValueForOffer(list[i], field);
      return s;
    }
    function avgField(list, field) {
      return analysisAverage(list, field);
    }

    var aggregates = {
      merchantCount: tierOffers.length,
      totalRevenue: sumField(tierOffers, "salesAmount"),
      totalCommission: sumField(tierOffers, "affCommission"),
      totalOrders: sumField(tierOffers, "orders"),
      avgEpc: avgField(tierOffers, "epc"),
      avgAov: avgField(tierOffers, "aov"),
      avgCvr: avgField(tierOffers, "conversionRate"),
      avgCommissionRate: avgField(tierOffers, "commissionRate")
    };

    // vs Other Tiers
    var vsOtherTiers = {};
    for (var t = 0; t < allTiers.length; t++) {
      var otherTier = allTiers[t];
      if (otherTier === name) continue;
      var otherOffers = offersInTier(otherTier);
      if (!otherOffers.length) continue;
      var comp = {};
      var compFields = ["epc", "aov", "conversionRate", "commissionRate"];
      for (var f = 0; f < compFields.length; f++) {
        var field = compFields[f];
        var selfAvg = avgField(tierOffers, field);
        var otherAvg = avgField(otherOffers, field);
        comp[field] = { self: selfAvg, other: otherAvg, delta: pctDelta(selfAvg, otherAvg) };
      }
      vsOtherTiers[otherTier] = comp;
    }

    // Segments (by commission)
    var segments = segmentedStats(tierOffers, "affCommission");

    // Outliers
    var tierAvgEpc = aggregates.avgEpc;
    var tierAvgCvr = aggregates.avgCvr;
    var outliers = [];
    for (var i = 0; i < tierOffers.length; i++) {
      var o = tierOffers[i];
      var oEpc = metricValueForOffer(o, "epc") || 0;
      var oCvr = metricValueForOffer(o, "conversionRate") || 0;
      var nameO = o.brand || o.merchantName || "Unknown";
      if (tierAvgEpc > 0 && oEpc > tierAvgEpc * 3) {
        outliers.push({ name: nameO, reason: "EPC " + epc(oEpc) + "è¿œè¶…åŒçº§å‡å€¼ " + epc(tierAvgEpc) });
      }
      if (tierAvgCvr > 0 && oCvr > tierAvgCvr * 2) {
        outliers.push({ name: nameO, reason: "CVR " + pct(oCvr / 100) + "è¿œè¶…åŒçº§å‡å€¼ " + pct(tierAvgCvr / 100) });
      }
    }

    return {
      type: "tier",
      target: { name: name, merchantCount: tierOffers.length },
      aggregates: aggregates,
      vsOtherTiers: vsOtherTiers,
      segments: segments,
      outliers: outliers.slice(0, 5)
    };
  }

  // â”€â”€ Multi-entity analysis (category & tier comparison) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function analyzeMultiCategory(categories, tierFilter) {
    if (!categories || !categories.length) return null;
    var language = state.language || "en";
    var zh = language === "zh";
    var entities = [];

    for (var i = 0; i < categories.length; i++) {
      var catName = categories[i];
      var catOffers = offersInCategory(catName);
      if (tierFilter) {
        catOffers = catOffers.filter(function(o) { return o.tier === tierFilter; });
      }
      if (!catOffers.length) continue;

      // Compute aggregates for this category
      var totalRevenue = 0, totalCommission = 0, totalClicks = 0, totalOrders = 0;
      for (var j = 0; j < catOffers.length; j++) {
        var o = catOffers[j];
        totalRevenue += Number(o.salesAmount || 0);
        totalCommission += Number(o.affCommission || 0);
        totalClicks += Number(o.clicks || 0);
        totalOrders += Number(o.orders || 0);
      }
      var avgEpc = analysisAverage(catOffers, "epc") || 0;
      var avgAov = analysisAverage(catOffers, "aov") || 0;
      var avgCvr = analysisAverage(catOffers, "conversionRate") || 0;
      var avgCommRate = analysisAverage(catOffers, "commissionRate") || 0;

      // Top 5 brands by commission
      var sorted = catOffers.slice().sort(function(a, b) { return (b.affCommission || 0) - (a.affCommission || 0); });
      var topBrands = sorted.slice(0, 5).map(function(o) {
        return {
          name: o.brand || o.merchantName || "Unknown",
          tier: o.tier || "",
          epc: o.epc || 0,
          aov: o.aov || 0,
          orders: o.orders || 0,
          affCommission: o.affCommission || 0,
          allCommission: o.payout || 0,
          allEpc: offerAllEpc(o),
          affEpc: offerAffEpc(o)
        };
      });

      entities.push({
        name: catName,
        merchantCount: catOffers.length,
        totals: {
          revenue: totalRevenue,
          commission: totalCommission,
          clicks: totalClicks,
          orders: totalOrders
        },
        averages: {
          epc: avgEpc,
          aov: avgAov,
          cvr: avgCvr,
          commissionRate: avgCommRate
        },
        topBrands: topBrands
      });
    }

    if (!entities.length) return null;

    return {
      type: "multi_category",
      target: {
        names: categories,
        tierFilter: tierFilter || null,
        entityCount: entities.length
      },
      entities: entities
    };
  }

  function analyzeMultiTier(tiers, categoryFilter) {
    if (!tiers || !tiers.length) return null;
    var language = state.language || "en";
    var zh = language === "zh";
    var entities = [];

    for (var i = 0; i < tiers.length; i++) {
      var tierName = tiers[i];
      var tierOffers = offersInTier(tierName);
      if (categoryFilter) {
        tierOffers = tierOffers.filter(function(o) { return categoryMatches(o, categoryFilter); });
      }
      if (!tierOffers.length) continue;

      // Compute aggregates for this tier
      var totalRevenue = 0, totalCommission = 0, totalClicks = 0, totalOrders = 0;
      for (var j = 0; j < tierOffers.length; j++) {
        var o = tierOffers[j];
        totalRevenue += Number(o.salesAmount || 0);
        totalCommission += Number(o.affCommission || 0);
        totalClicks += Number(o.clicks || 0);
        totalOrders += Number(o.orders || 0);
      }
      var avgEpc = analysisAverage(tierOffers, "epc") || 0;
      var avgAov = analysisAverage(tierOffers, "aov") || 0;
      var avgCvr = analysisAverage(tierOffers, "conversionRate") || 0;
      var avgCommRate = analysisAverage(tierOffers, "commissionRate") || 0;

      // Top 5 brands by commission
      var sorted = tierOffers.slice().sort(function(a, b) { return (b.affCommission || 0) - (a.affCommission || 0); });
      var topBrands = sorted.slice(0, 5).map(function(o) {
        return {
          name: o.brand || o.merchantName || "Unknown",
          epc: o.epc || 0,
          aov: o.aov || 0,
          orders: o.orders || 0,
          affCommission: o.affCommission || 0,
          allCommission: o.payout || 0,
          allEpc: offerAllEpc(o),
          affEpc: offerAffEpc(o)
        };
      });

      // Category distribution within this tier
      var catDist = {};
      for (var j = 0; j < tierOffers.length; j++) {
        var cat = tierOffers[j].mainCategory || tierOffers[j].category || "Uncategorized";
        catDist[cat] = (catDist[cat] || 0) + 1;
      }

      entities.push({
        name: tierName,
        merchantCount: tierOffers.length,
        totals: {
          revenue: totalRevenue,
          commission: totalCommission,
          clicks: totalClicks,
          orders: totalOrders
        },
        averages: {
          epc: avgEpc,
          aov: avgAov,
          cvr: avgCvr,
          commissionRate: avgCommRate
        },
        topBrands: topBrands,
        categoryDistribution: catDist
      });
    }

    if (!entities.length) return null;

    return {
      type: "multi_tier",
      target: {
        names: tiers,
        categoryFilter: categoryFilter || null,
        entityCount: entities.length
      },
      entities: entities
    };
  }

  // â”€â”€ Analysis table rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function renderAnalysisTable(summary) {
    if (!summary) return "<p>No analysis data available.</p>";
    if (summary.type === "merchant") return renderMerchantAnalysisTable(summary);
    if (summary.type === "merchant_comparison") return renderMerchantComparisonTable(summary);
    if (summary.type === "category") return renderCategoryAnalysisTable(summary);
    if (summary.type === "tier") return renderTierAnalysisTable(summary);
    if (summary.type === "multi_category") return renderMultiCategoryAnalysisTable(summary);
    if (summary.type === "multi_tier") return renderMultiTierAnalysisTable(summary);
    if (summary.type === "trend") return renderTrendTable(summary);
    return "<p>Unknown analysis type.</p>";
  }

  function renderMerchantAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var fields = ["epc", "aov", "conversionRate", "orders", "affCommission", "commissionRate"];
    var html = "";

    // Core metrics table with percentile ranks
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "æ ¸å¿ƒæŒ‡æ ‡" : "Core Metrics") + "</h4>";
    var firstRank = s.ranks[fields[0]];
    var totalCat = firstRank ? firstRank.totalInCategory : 0;
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th><th>" + (zh ? "æ•°å€¼" : "Value") + "</th><th>" + (zh ? "å“ç±»æ’å" : "Category Rank") + (totalCat ? " (" + totalCat + " " + (zh ? "ä¸ªå•†æˆ·" : "merchants") + ")" : "") + "</th></tr></thead><tbody>";
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var rank = s.ranks[field];
      var rankText = rank.percentile === null
        ? (zh ? "æ ·æœ¬ä¸è¶³" : "Insufficient sample")
        : ((zh ? "å‰" : "Top ") + (100 - rank.percentile) + "%");
      html += "<tr><td>" + metricLabel(field) + "</td><td>" + formatAnalysisMetric(rank.value, field) + "</td><td>" + rankText + "</td></tr>";
    }
    html += "</tbody></table></div>";

    // Comparisons
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "æ¨ªå‘å¯¹æ¯”" : "Comparisons") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th><th>" + (zh ? "å½“å‰" : "Current") + "</th><th>" + (zh ? "å“ç±»å‡å€¼" : "Category Avg") + "</th><th>" + (zh ? "å·®å¼‚" : "Delta") + "</th></tr></thead><tbody>";
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var comp = s.comparisons.vsCategory[field];
      html += "<tr><td>" + metricLabel(field) + "</td><td>" + formatAnalysisMetric(comp.self, field) + "</td><td>" + formatAnalysisMetric(comp.avg, field) + "</td><td>" + escapeHtml(comp.delta) + "</td></tr>";
    }
    html += "</tbody></table></div>";

    // Strengths & Weaknesses
    html += "<div class=\"analysis-section\">";
    if (s.strengths.length) {
      html += "<p><strong>" + (zh ? "äº®ç‚¹ï¼š" : "Strengths: ") + "</strong>";
      var strLabels = [];
      for (var i = 0; i < s.strengths.length; i++) strLabels.push(metricLabel(s.strengths[i]) + " (" + (zh ? "å“ç±»å‰" : "top ") + (100 - s.ranks[s.strengths[i]].percentile) + "%)");
      html += escapeHtml(strLabels.join(", ")) + "</p>";
    }
    if (s.weaknesses.length) {
      html += "<p><strong>" + (zh ? "çŸ­æ¿ï¼š" : "Weaknesses: ") + "</strong>";
      var weakLabels = [];
      for (var i = 0; i < s.weaknesses.length; i++) weakLabels.push(metricLabel(s.weaknesses[i]) + " (" + (zh ? "å“ç±»å" : "bottom ") + (100 - s.ranks[s.weaknesses[i]].percentile) + "%)");
      html += escapeHtml(weakLabels.join(", ")) + "</p>";
    }
    if (!s.strengths.length && !s.weaknesses.length) {
      html += "<p>" + (zh ? "è¯¥å•†æˆ·å„é¡¹æŒ‡æ ‡å¤„äºå“ç±»ä¸­ç­‰æ°´å¹³ã€‚" : "All metrics are near the category median.") + "</p>";
    }
    var insufficientFields = Object.keys(s.ranks || {}).filter(function(field) {
      return s.ranks[field] && s.ranks[field].status === "insufficient_sample";
    });
    if (insufficientFields.length) {
      html += "<p class=\"analysis-sample-note\"><strong>" + (zh ? "æ ·æœ¬æç¤ºï¼š" : "Sample note: ") + "</strong>" +
        (zh ? "éƒ¨åˆ†æŒ‡æ ‡æ ·æœ¬é‡ä¸è¶³ï¼Œæœªå°†å…¶åˆ¤å®šä¸ºäº®ç‚¹æˆ–çŸ­æ¿ã€‚" : "Some metrics have insufficient sample size and were not classified as strengths or weaknesses.") +
        "</p>";
    }
    html += "<p><strong>" + (zh ? "æ”¯ä»˜çŠ¶æ€ï¼š" : "Payment: ") + "</strong>" + escapeHtml(s.paymentRisk.riskText || (zh ? "æ— é£é™©" : "No risk")) + "</p>";
    html += "</div>";

    // Peers
    if (s.peers && s.peers.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "åŒç±»å•†æˆ·å¯¹æ¯”" : "Peer Comparison") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "å•†æˆ·" : "Merchant") + "</th>";
      for (var f = 0; f < fields.length; f++) html += "<th>" + metricLabel(fields[f]) + "</th>";
      html += "</tr></thead><tbody>";
      // Current merchant row
      html += "<tr style=\"font-weight:bold\"><td>" + escapeHtml(s.target.name) + "</td>";
      for (var f = 0; f < fields.length; f++) html += "<td>" + formatAnalysisMetric(s.metrics[fields[f]], fields[f]) + "</td>";
      html += "</tr>";
      // Peer rows
      for (var p = 0; p < s.peers.length; p++) {
        var peer = s.peers[p];
        html += "<tr><td>" + escapeHtml(peer.name) + "</td>";
        for (var f = 0; f < fields.length; f++) html += "<td>" + formatAnalysisMetric(peer.metrics[fields[f]] || 0, fields[f]) + "</td>";
        html += "</tr>";
      }
      html += "</tbody></table></div>";
    }

    return html;
  }

  function renderMerchantComparisonTable(s) {
    if (!s || !s.entities || s.entities.length < 1) return "<p>No data for comparison.</p>";
    var lang = state.language || "en";
    var zh = lang === "zh";
    var fields = ["epc", "aov", "conversionRate", "orders", "affCommission", "commissionRate"];
    var names = s.entities.map(function(e) { return e.name; });
    var title = zh ? "å•†æˆ·å¯¹æ¯”: " : "Merchant Comparison: ";
    var hasDelta = s.deltas !== null && s.entities.length === 2;
    var extraCol = hasDelta ? 1 : 0;

    var html = "<div class=\"analysis-section\"><h4>" + escapeHtml(title + names.join(" vs ")) + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th>";
    for (var i = 0; i < s.entities.length; i++) {
      html += "<th>" + escapeHtml(names[i]) + "</th>";
    }
    if (hasDelta) html += "<th>" + (zh ? "å·®å¼‚" : "Delta") + "</th>";
    html += "</tr></thead><tbody>";

    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      html += "<tr><td>" + metricLabel(field) + "</td>";
      for (var i = 0; i < s.entities.length; i++) {
        html += "<td>" + formatAnalysisMetric(s.entities[i].metrics[field] || 0, field) + "</td>";
      }
      if (hasDelta) {
        var d = s.deltas[field];
        var deltaText = "";
        if (d.abs === 0) {
          deltaText = "=";
        } else if (Math.abs(d.pct) < 1) {
          deltaText = "â‰ˆ";
        } else {
          var sign = d.pct > 0 ? "+" : "";
          var dir = d.pct > 0 ? " â†‘" : " â†“";
          deltaText = sign + d.pct.toFixed(1) + "%" + dir;
        }
        html += "<td" + (d.pct > 0 ? " class=\"up\"" : (d.pct < 0 ? " class=\"down\"" : "")) + ">" + escapeHtml(deltaText) + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table>";

    // Merchant info line
    var infoLines = [];
    for (var i = 0; i < s.entities.length; i++) {
      var e = s.entities[i];
      infoLines.push(escapeHtml(e.name) + ": " + (e.tier || "?") + " Â· " + (e.category || "?"));
    }
    html += "<p class=\"comparison-info\">" + infoLines.join(" &nbsp;|&nbsp; ") + "</p>";

    // NotFound warning
    if (s.notFound && s.notFound.length) {
      html += "<p class=\"warning\">" + (zh ? "æœªæ‰¾åˆ°ä»¥ä¸‹å•†æˆ·: " : "Not found: ") + escapeHtml(s.notFound.join(", ")) + "</p>";
    }

    html += "</div>";
    return html;
  }

  function renderTrendTable(s) {
    if (!s || !s.months || s.months.length < 2) return "<p>Trend data is not available.</p>";
    var lang = state.language || "en";
    var zh = lang === "zh";
    // è¡¨æ ¼ä»…å±•ç¤ºç”¨æˆ·å‹¾é€‰çš„å¯è§æŒ‡æ ‡ï¼ˆDisplay columnsï¼‰ï¼Œè‡³å°‘ä¿ç•™ 1 ä¸ª
    var visible = trendVisibleMetrics();
    var metrics = (s.metrics || []).filter(function(m) { return visible.indexOf(m) !== -1; });
    if (!metrics.length) metrics = s.metrics || [];
    var months = s.months || [];
    var hasDelta = Object.keys(s.deltas || {}).length > 0;

    // Build table header
    var html = "<div class=\"analysis-section\"><h4>" + (zh ? "è¶‹åŠ¿åˆ†æ" : "Trend Analysis") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æœˆä»½" : "Month") + "</th>";
    for (var m = 0; m < metrics.length; m++) {
      html += "<th>" + metricLabel(metrics[m]) + "</th>";
      if (hasDelta) html += "<th class=\"delta-col\">Î”</th>";
    }
    html += "</tr></thead><tbody>";

    for (var i = 0; i < months.length; i++) {
      var month = months[i];
      html += "<tr><td>" + escapeHtml(month.month) + "</td>";
      for (var m = 0; m < metrics.length; m++) {
        var metric = metrics[m];
        var val = month[metric] || 0;
        html += "<td>" + formatTrendMetric(val, metric) + "</td>";
        if (hasDelta && i > 0) {
          var delta = s.deltas[month.month] ? s.deltas[month.month][metric] : null;
          if (delta) {
            var dir = delta.dir === "up" ? " â†‘" : (delta.dir === "down" ? " â†“" : "");
            var cls = delta.dir === "up" ? "up" : (delta.dir === "down" ? "down" : "");
            var sign = delta.pct > 0 ? "+" : "";
            html += "<td class=\"" + cls + "\">" + sign + delta.pct.toFixed(1) + "%" + dir + "</td>";
          } else {
            html += "<td>â€“</td>";
          }
        } else if (hasDelta) {
          html += "<td>â€“</td>";
        }
      }
      html += "</tr>";
    }
    html += "</tbody></table>";

    // Summary line (first vs last)
    if (s.summary) {
      html += "<div class=\"trend-summary\"><p><strong>" + (zh ? "æ•´ä½“è¶‹åŠ¿: " : "Overall: ") + "</strong>";
      var summaryParts = [];
      for (var m = 0; m < metrics.length; m++) {
        var metric = metrics[m];
        var sum = s.summary[metric];
        if (sum && sum.pct !== 0) {
          var dir2 = sum.dir === "up" ? " â†‘" : (sum.dir === "down" ? " â†“" : "");
          var sign2 = sum.pct > 0 ? "+" : "";
          summaryParts.push(metricLabel(metric) + " " + sign2 + sum.pct.toFixed(1) + "%" + dir2);
        }
      }
      if (summaryParts.length) {
        html += escapeHtml(summaryParts.join(", "));
      } else {
        html += "<em>" + (zh ? "å„æŒ‡æ ‡æ— æ˜æ˜¾å˜åŒ–" : "No significant change across metrics") + "</em>";
      }
      html += "</p></div>";
    }

    html += "</div>";
    return html;
  }

  function extractMonthCount(promptText) {
    if (!promptText) return 0;
    var text = promptText.trim();
    // Chinese: è¿‘Nä¸ªæœˆ, æœ€è¿‘Nä¸ªæœˆ, è¿‡å»Nä¸ªæœˆ, N can be Chinese or Arabic
    var zhMatch = text.match(/(?:è¿‘|æœ€è¿‘|è¿‡å»|å‰)\s*([ä¸€äºŒä¸‰å››äº”å…­ä¸ƒå…«ä¹åç™¾é›¶\d]+)\s*(?:ä¸ª?æœˆ)/);
    if (zhMatch) {
      var numStr = zhMatch[1];
      // Convert Chinese numerals to Arabic
      var chnMap = {"ä¸€":1,"äºŒ":2,"ä¸‰":3,"å››":4,"äº”":5,"å…­":6,"ä¸ƒ":7,"å…«":8,"ä¹":9,"å":10,"ç™¾":100};
      if (chnMap[numStr] !== undefined) return chnMap[numStr];
      var n = parseInt(numStr, 10);
      if (!isNaN(n) && n > 0) return n;
    }
    // Chinese: è¿‘åŠå¹´ â†’ 6, è¿‘ä¸€å¹´ â†’ 12
    var zhSpecial = text.match(/(?:è¿‘|æœ€è¿‘|è¿‡å»|å‰)\s*(åŠ\s*å¹´|ä¸€\s*å¹´|1\s*å¹´)/);
    if (zhSpecial) {
      var spec = zhSpecial[1].replace(/\s+/g, "");
      if (spec === "åŠå¹´") return 6;
      if (spec === "ä¸€å¹´" || spec === "1å¹´") return 12;
    }
    // English: last / recent / past N months
    var enMatch = text.match(/(?:last|recent|past)\s+(\d+)\s*(?:months?|month)/i);
    if (enMatch) {
      var n2 = parseInt(enMatch[1], 10);
      if (!isNaN(n2) && n2 > 0) return n2;
    }
    return 0;
  }

  async function fetchMerchantMetrics(merchantId, months, signal) {
    if (!merchantId || typeof fetch !== "function") return null;
    var id = String(merchantId).trim();
    if (!id) return null;
    months = (typeof months === "number" && months >= 1 && months <= 24) ? months : 12;
    // Check cache first (merged merchantId + months)
    var cacheKey = id + ":" + months;
    if (dbMerchantCache.has(cacheKey)) {
      return dbMerchantCache.get(cacheKey);
    }
    // Also check if a larger months bucket is cached (e.g., 12 available, need 3)
    for (var entry of dbMerchantCache) {
      var key = entry[0];
      if (key === id || key.startsWith(id + ":")) {
        var cachedMonths = parseInt(key.split(":")[1], 10);
        if (cachedMonths >= months && cachedMonths >= 12) {
          return entry[1];
        }
      }
    }
    try {
      // 20s è¶…æ—¶ï¼šDB ä¸å¯ç”¨/æ…¢æ—¶é¿å…è¶‹åŠ¿å ä½æ— é™æŒ‚èµ·ï¼Œå›é€€åˆ°ä¼°ç®—è¶‹åŠ¿
      // minimal=1ï¼šåªå–æœˆåº¦æŒ‡æ ‡ï¼Œè·³è¿‡æ…¢çš„ products/base æŸ¥è¯¢ï¼ˆå¦åˆ™ ~40s è¶…è¿‡è¶…æ—¶ï¼Œ
      // ä¼š fallback åˆ°ä¼°ç®—è¶‹åŠ¿ï¼Œæ•°æ®ä¸ Tier Sheet ä¸ä¸€è‡´ï¼‰ã€‚è¶…æ—¶æ”¾å®½åˆ° 60s å…œåº•ã€‚
      var timeoutSignal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(60000) : null;
      var requestSignal = timeoutSignal;
      if (signal) {
        requestSignal = timeoutSignal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([signal, timeoutSignal]) : signal;
      }
      var fetchOptions = { cache: "no-store" };
      if (requestSignal) fetchOptions.signal = requestSignal;
      var response = await fetch(DB_MERCHANT_UI_API + "?merchantId=" + encodeURIComponent(id) + "&limit=1&months=" + months + "&minimal=1", fetchOptions);
      if (!response.ok) return null;
      var payload = await response.json();
      if (payload && payload.ok !== false) {
        dbMerchantCache.set(cacheKey, payload);
        return payload;
      }
    } catch (e) {
      console.warn("[trend] fetch merchant metrics failed:", e);
    }
    return null;
  }

  // ç²¾ç¡®åŒ¹é…å“ç±»å€¼ï¼štarget æ•´ä¸²å°±æ˜¯ä¸€ä¸ªå“ç±»åã€‚ä¸ categoryForPrompt çš„"åŒ…å«åŒ¹é…"
  // ä¸åŒï¼Œè¿™é‡Œæ’é™¤"å•†æˆ·åæ°å¥½å«å“ç±»è¯"ï¼ˆå¦‚ "Cobra Electronics " â†’ "Electronics"ï¼‰çš„è¯¯åˆ¤ã€‚
  function exactCategoryValue(text) {
    var lower = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!lower) return null;
    var values = allCategoryValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i] || "").toLowerCase().replace(/\s+/g, " ").trim() === lower) return values[i];
    }
    return null;
  }

  // å•†æˆ·åç²¾ç¡®åŒ¹é…ï¼šå“ç‰Œ/å•†æˆ·åå®Œæ•´ç­‰äºç›®æ ‡ã€‚findLiveOffer çš„ includes åŒ¹é…ä¼šæŠŠ
  // å“ç±»è¯ï¼ˆå¦‚ "Beauty"ã€"Electronics"ï¼‰å‘½ä¸­åˆ°å“ç‰Œåå«è¯¥è¯çš„å•†æˆ·ï¼Œéœ€è¦å…ˆå‰¥ç¦»ã€‚
  function exactMerchantNameMatch(name) {
    if (!name) return null;
    var lower = name.toLowerCase().replace(/\s+/g, " ").trim();
    var list = (_liveChatbotDataLoaded && _liveChatbotOffers) ? _liveChatbotOffers : offers;
    for (var i = 0; i < list.length; i++) {
      if (normalizedOfferName(list[i], "brand") === lower || normalizedOfferName(list[i], "merchantName") === lower) {
        return list[i];
      }
    }
    return null;
  }

  function detectTrendEntityType(target, prompt) {
    if (!target) {
      // æ— ç›®æ ‡ + prompt å«å“ç±»æŒ‡ç¤ºè¯ï¼ˆ"å“ç±»è¶‹åŠ¿"/"category trend analysis"ï¼‰â†’ å“ç±»è¶‹åŠ¿ä¸‹æ‹‰æ¨¡å¼
      if (hasCategoryIntentText(prompt)) return "category";
      return "merchant";
    }
    var t = tierFromPrompt(target);
    if (t) return "tier";
    // åŸå§‹ prompt ä¸­æ˜ç¡®çš„å“ç±»æŒ‡ç¤ºè¯ï¼ˆ"Xç±»åˆ«/å“ç±»/åˆ†ç±»/ç±»ç›®/category"ï¼‰ä¼˜å…ˆï¼Œ
    // ä¿®å¤ "åˆ†æBeautyç±»åˆ«çš„è¶‹åŠ¿" è¢« LLM å‰¥ç¦»æˆ "Beauty" åä¸¢å¤±å“ç±»ä¿¡å·çš„é—®é¢˜ã€‚
    var hint = hasCategoryIntentText(target) || hasCategoryIntentText(prompt);
    var cat = categoryForPrompt(target);
    if (hint && cat && offersInCategory(cat).length > 0) return "category";
    // å•†æˆ·åç²¾ç¡®åŒ¹é…ä¼˜å…ˆï¼Œé¿å…å“ç‰Œåå«å“ç±»è¯æ—¶è¢«è¯¯åˆ¤ä¸ºå“ç±»
    if (exactMerchantNameMatch(target)) return "merchant";
    // target æœ¬èº«å°±æ˜¯å“ç±»åï¼ˆç²¾ç¡®åŒ¹é…ï¼‰ä¸”æœ‰æ•°æ® â†’ å“ç±»ï¼Œä¼˜å…ˆäºå“ç‰Œ includes æ¨¡ç³ŠåŒ¹é…
    var exactCat = exactCategoryValue(target);
    if (exactCat && offersInCategory(exactCat).length > 0) return "category";
    // å•†æˆ· includes/fuzzy åŒ¹é…
    if (findLiveOffer(target)) return "merchant";
    // å“ç±»æ¨¡ç³Šå…œåº•
    if (cat && offersInCategory(cat).length > 0) return "category";
    return "merchant";
  }

  function trendAnalysisTitle(entityType, target, zh) {
    if (entityType === "category" && !target) return (zh ? "å“ç±»è¶‹åŠ¿" : "Category Trend");
    if (entityType === "tier") return (zh ? "å±‚çº§è¶‹åŠ¿åˆ†æ: " : "Tier Trend: ") + escapeHtml(target);
    if (entityType === "category") return (zh ? "åˆ†ç±»è¶‹åŠ¿åˆ†æ: " : "Category Trend: ") + escapeHtml(target);
    return (zh ? "è¶‹åŠ¿åˆ†æ: " : "Trend: ") + escapeHtml(target);
  }

  function renderTrendLoadingPlaceholder(prompt, params, extra, language) {
    var zh = language === "zh";
    var analysisTarget = params && params.analysisTarget;
    var trendMetric = params && params.trendMetric || null;
    var entityType = detectTrendEntityType(analysisTarget, prompt);
    var placeholderId = "trend-placeholder-" + Date.now();

    var html = "<div id=\"" + placeholderId + "\" class=\"analysis-section\"><h4>" + trendAnalysisTitle(entityType, analysisTarget, zh) + "</h4>";
    html += "<p><em>" + (zh ? "æ­£åœ¨åŠ è½½è¶‹åŠ¿æ•°æ®â€¦" : "Loading trend dataâ€¦") + "</em></p></div>";

    setTimeout(async function() {
      var container = document.getElementById(placeholderId);
      if (!container) return;

      // Load fresh data in background so trend fallback uses live DB data
      loadLiveChatbotData();

      try {
        // Extract month count from prompt (e.g., "è¿‘ä¸‰ä¸ªæœˆ" â†’ 3)
        var requestedMonthCount = extractMonthCount(prompt) || 0;
        // For trend we need at least 2 months; if user asks for 1, fetch 2 anyway
        var apiMonthCount = requestedMonthCount > 0 ? Math.max(requestedMonthCount, 2) : 12;
        var trimTarget = requestedMonthCount > 0 ? Math.max(requestedMonthCount, 2) : 0;

        var label = analysisTarget;
        var monthlyMetrics = null;

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // Merchant trend path
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        if (entityType === "merchant") {
          // Ensure live data is loaded so metrics match Tier Sheet
          await loadLiveChatbotData();
          // ç›®æ ‡ä¸ºç©ºæ—¶ä» prompt æå–ï¼šanalysisAnswer åŒæ­¥é˜¶æ®µå¯èƒ½å›  live data
          // å°šæœªåŠ è½½å¯¼è‡´ findLiveOffer å¤±è´¥ï¼ˆå¦‚ Our Place ä¸åœ¨ offers ç¼“å­˜ï¼‰ï¼Œ
          // æ­¤æ—¶ live data å·²å°±ç»ªï¼Œå¯æ­£ç¡®åŒ¹é…
          if (!analysisTarget && prompt) {
            var cleanedTarget = String(prompt)
              .replace(/è¶‹åŠ¿|trend|åˆ†æ|analysis|è¯„ä¼°|è¯Šæ–­|è¿‘\s*\d+\s*(ä¸ª\s*)?æœˆ|ä¸Šä¸ªå­£åº¦|ä»Šå¹´ä»¥æ¥|è¿‡å»|æœ€è¿‘/gi, " ")
              .replace(/\s+/g, " ").trim();
            if (cleanedTarget && cleanedTarget !== String(prompt).trim()) {
              var liveMatch = findLiveOffer(cleanedTarget);
              if (liveMatch) {
                analysisTarget = liveMatch.brand || liveMatch.merchantName;
                params = Object.assign({}, params, { analysisTarget: analysisTarget });
              }
            }
          }
          var offer = analysisTarget ? findLiveOffer(analysisTarget) : null;
          if (!offer) {
            var missName = analysisTarget || cleanedTarget || "è¯¥å•†æˆ·";
            container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
              + (zh ? "æœªæ‰¾åˆ° <strong>" + escapeHtml(missName) + "</strong> çš„æ•°æ®ã€‚" : "No data found for <strong>" + escapeHtml(missName) + "</strong>.")
              + "</p></div>";
            return;
          }
          label = offer.brand || offer.merchantName || analysisTarget;

          var payload = await fetchMerchantMetrics(offer.merchantId, apiMonthCount);
          monthlyMetrics = payload && Array.isArray(payload.monthlyAmazonMetrics) ? payload.monthlyAmazonMetrics : null;
          if (monthlyMetrics && trimTarget > 0 && monthlyMetrics.length > trimTarget) {
            monthlyMetrics = monthlyMetrics.slice(0, trimTarget);
          }

          // Estimated fallback for merchant
          if (!monthlyMetrics || monthlyMetrics.length < 2) {
            // Use live DB data if available for accurate metrics (clicks, orders, revenue, etc.)
            var fallbackOffer = offer;
            if (_liveChatbotDataLoaded && _liveChatbotOffersById) {
              var mid = String(offer.merchantId || "").trim();
              if (mid && _liveChatbotOffersById.has(mid)) {
                fallbackOffer = _liveChatbotOffersById.get(mid);
              }
            }
            var basicTrend = generateTrendFromOfferSummary(fallbackOffer, requestedMonthCount);
            if (basicTrend) {
              renderEstimatedTrend(basicTrend, label, container, zh, language);
              return;
            }
            renderMerchantInsufficientData(fallbackOffer, analysisTarget, zh, container);
            return;
          }
        }
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // Category trend path
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        else if (entityType === "category") {
          // å“ç±»è¶‹åŠ¿ä¸‹æ‹‰æ¨¡å¼ï¼šæ— å“ç±»åï¼ˆ"å“ç±»è¶‹åŠ¿"è£¸è¾“å…¥ï¼‰â†’ åˆå§‹é€‰ revenue æœ€å¤§å“ç±»ï¼›
          // å¸¦å“ç±»å â†’ åˆå§‹é€‰ä¸­è¯¥å“ç±»ï¼ˆä¸åœ¨ Tier1-3 åˆ—è¡¨åˆ™æç¤ºå¹¶å›é€€ç¬¬ä¸€é¡¹ï¼‰ã€‚
          // æ¸²æŸ“é€»è¾‘ç‹¬ç«‹ä¸º renderCategoryTrendï¼Œå·¦é¢æ¿/æµ®çª—å†…ä¸‹æ‹‰åˆ‡æ¢å¤ç”¨åŒä¸€å…¥å£ã€‚
          renderCategoryTrend(container, analysisTarget, zh, language, requestedMonthCount, apiMonthCount, trimTarget);
          return;
        }
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // Tier trend path
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        else if (entityType === "tier") {
          var tierOffers = offersInTier(analysisTarget);
          if (!tierOffers || tierOffers.length === 0) {
            container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
              + (zh ? "æœªæ‰¾åˆ°å±‚çº§ <strong>" + escapeHtml(analysisTarget) + "</strong> çš„æ•°æ®ã€‚" : "No data found for tier <strong>" + escapeHtml(analysisTarget) + "</strong>.")
              + "</p></div>";
            return;
          }
          label = analysisTarget;
          monthlyMetrics = await timeoutPromise(fetchAggregatedMonthlyMetrics(tierOffers, apiMonthCount), 8000, null);
          if (monthlyMetrics && trimTarget > 0 && monthlyMetrics.length > trimTarget) {
            monthlyMetrics = monthlyMetrics.slice(0, trimTarget);
          }

          if (!monthlyMetrics || monthlyMetrics.length < 2) {
            var tierEstimated = estimateAggregatedTrend(tierOffers, requestedMonthCount);
            if (tierEstimated) {
              renderEstimatedTrend(tierEstimated, label, container, zh, language);
              return;
            }
            container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
              + (zh ? "å±‚çº§ <strong>" + escapeHtml(analysisTarget) + "</strong> çš„æ•°æ®ä¸è¶³ä»¥åˆ†æè¶‹åŠ¿ï¼ˆéœ€è¦è‡³å°‘ 2 ä¸ªæœˆçš„æœˆåº¦æ•°æ®ï¼‰ã€‚" : "Insufficient data for tier <strong>" + escapeHtml(analysisTarget) + "</strong> trend (need at least 2 months).")
              + "</p></div>";
            return;
          }
        } else {
          container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
            + (zh ? "æœªçŸ¥çš„åˆ†æç›®æ ‡ç±»å‹ã€‚" : "Unknown analysis target type.")
            + "</p></div>";
          return;
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // Shared compute & render (all entity types)
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        var summary = computeTrend(monthlyMetrics, trendMetric);
        if (!summary) {
          container.innerHTML = "<div class=\"analysis-section\"><p>" + (zh ? "æ— æ³•è®¡ç®—è¶‹åŠ¿ã€‚" : "Unable to compute trend.") + "</p></div>";
          return;
        }

        summary.target = label;

        // Trend table only appears in the left context panel, not here
        container.innerHTML = "<p class=\"info\">" + (zh ? "è¶‹åŠ¿æ•°æ®å·²åŠ è½½ï¼Œè¯¦è§å·¦ä¾§é¢æ¿" : "Trend data loaded, see left panel for details.") + "</p>";

        // Update the left context panel with trend chart + table
        setContext(buildTrendContext(summary));

        // Append narrative (non-blocking)
        appendTrendNarrative(container, summary, zh, language);
      } catch (error) {
        console.error("[trend] async trend error:", error);
        container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
          + (zh ? "è¶‹åŠ¿åˆ†æå‡ºé”™ï¼š" : "Trend analysis error: ") + escapeHtml(error.message || "unknown")
          + "</p></div>";
      }
    }, 0);

    return html;
  }

  // å“ç±»è¶‹åŠ¿åˆ‡æ¢ç«æ€å®ˆå«ï¼šä¸‹æ‹‰å¿«é€Ÿè¿ç»­åˆ‡æ¢æ—¶ï¼Œåªå…è®¸æœ€æ–°ä¸€æ¬¡è¯·æ±‚çš„ç»“æœè½åœ°æ¸²æŸ“
  var _trendSwitchSeq = 0;
  // å½“å‰é€‰ä¸­çš„è¶‹åŠ¿å“ç±»ï¼ˆä¸‹æ‹‰ selected çŠ¶æ€ä¸æµ®çª—å…‹éš†åŒæ­¥ç”¨ï¼‰
  var _activeTrendCategory = null;

  // å“ç±»è¶‹åŠ¿æ ¸å¿ƒæ¸²æŸ“ï¼šå·¦ä¾§å›ç­”åŒºå ä½ + å·¦ä¸Šä¸‹æ–‡é¢æ¿è¶‹åŠ¿ + æµ®çª—ï¼ˆå…‹éš†åŒæ­¥ï¼‰ã€‚
  // ç”±è¶‹åŠ¿è·¯å¾„åˆæ¬¡è°ƒç”¨ï¼Œä¹Ÿç”±å“ç±»ä¸‹æ‹‰åˆ‡æ¢ï¼ˆå·¦é¢æ¿/æµ®çª—å†…ï¼‰å¤ç”¨ã€‚
  // targetCategory ä¸ºç©º = è£¸"å“ç±»è¶‹åŠ¿"è¾“å…¥ â†’ åˆå§‹é€‰ revenue æœ€å¤§å“ç±»ã€‚
  async function renderCategoryTrend(container, targetCategory, zh, language, requestedMonthCount, apiMonthCount, trimTarget) {
    var categoryList = categoryListForTrend();
    var activeCategory = null;
    var mismatchWarning = false;
    if (targetCategory) {
      var lowerTarget = String(targetCategory).toLowerCase().trim();
      for (var i = 0; i < categoryList.length; i++) {
        var cName = String(categoryList[i].name);
        if (cName.toLowerCase() === lowerTarget || cName.toLowerCase().indexOf(lowerTarget) !== -1) {
          activeCategory = cName;
          break;
        }
      }
      if (!activeCategory) mismatchWarning = true;
    }
    if (!activeCategory && categoryList.length) activeCategory = categoryList[0].name;

    if (!activeCategory) {
      container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
        + (zh ? "æœªæ‰¾åˆ°ä»»ä½• Tier 1-3 å“ç±»çš„æ•°æ®ã€‚" : "No Tier 1-3 category data found.")
        + "</p></div>";
      return null;
    }

    var warningHtml = mismatchWarning
      ? "<p class=\"warning\">" + (zh ? "å“ç±» <strong>" + escapeHtml(targetCategory) + "</strong> åœ¨ Tier 1-3 ä¸­æ— æ•°æ®ï¼Œå·²åˆ‡æ¢ä¸º <strong>" + escapeHtml(activeCategory) + "</strong>ã€‚" : "Category <strong>" + escapeHtml(targetCategory) + "</strong> has no Tier 1-3 data; switched to <strong>" + escapeHtml(activeCategory) + "</strong>.") + "</p>"
      : "";
    var catOffers = offersInCategory(activeCategory, { excludeTier4Black: true });
    if (!catOffers || catOffers.length === 0) {
      container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
        + (zh ? "æœªæ‰¾åˆ°åˆ†ç±» <strong>" + escapeHtml(activeCategory) + "</strong> çš„æ•°æ®ã€‚" : "No data found for category <strong>" + escapeHtml(activeCategory) + "</strong>.")
        + "</p></div>";
      return null;
    }
    container.innerHTML = warningHtml + "<div class=\"analysis-section\"><p class=\"info\">"
      + (zh ? "æ­£åœ¨åŠ è½½ <strong>" + escapeHtml(activeCategory) + "</strong> çš„è¶‹åŠ¿æ•°æ®â€¦" : "Loading trend for <strong>" + escapeHtml(activeCategory) + "</strong>â€¦")
      + "</p></div>";

    var monthlyMetrics = await fetchCategoryTrendMetrics(activeCategory, apiMonthCount);
    if (monthlyMetrics && trimTarget > 0 && monthlyMetrics.length > trimTarget) {
      monthlyMetrics = monthlyMetrics.slice(0, trimTarget);
    }
    if (!monthlyMetrics || monthlyMetrics.length < 2) {
      var catEstimated = estimateAggregatedTrend(catOffers, requestedMonthCount);
      if (catEstimated) {
        // æŒ‚å“ç±»ä¸‹æ‹‰æ ‡è®°ï¼Œä¼°ç®—æ¨¡å¼åŒæ ·æ”¯æŒä¸‹æ‹‰åˆ‡æ¢
        catEstimated.categoryTrend = true;
        catEstimated.categoryList = categoryList;
        catEstimated.activeCategory = activeCategory;
        renderEstimatedTrend(catEstimated, activeCategory, container, zh, language);
        return catEstimated;
      }
      container.innerHTML = "<div class=\"analysis-section\"><p class=\"warning\">"
        + (zh ? "åˆ†ç±» <strong>" + escapeHtml(activeCategory) + "</strong> çš„æ•°æ®ä¸è¶³ä»¥åˆ†æè¶‹åŠ¿ï¼ˆéœ€è¦è‡³å°‘ 2 ä¸ªæœˆçš„æœˆåº¦æ•°æ®ï¼‰ã€‚" : "Insufficient data for category <strong>" + escapeHtml(activeCategory) + "</strong> trend (need at least 2 months).")
        + "</p></div>";
      return null;
    }

    var summary = computeTrend(monthlyMetrics, null);
    if (!summary) {
      container.innerHTML = "<div class=\"analysis-section\"><p>" + (zh ? "æ— æ³•è®¡ç®—è¶‹åŠ¿ã€‚" : "Unable to compute trend.") + "</p></div>";
      return null;
    }
    summary.target = activeCategory;
    // ä¿ç•™å“ç±»ä¸åœ¨ Tier1-3 æ—¶çš„å›é€€è­¦å‘Šï¼ˆä¸éšæˆåŠŸæ¸²æŸ“è¢«è¦†ç›–ï¼‰
    container.innerHTML = warningHtml + "<p class=\"info\">" + (zh ? "è¶‹åŠ¿æ•°æ®å·²åŠ è½½ï¼Œè¯¦è§å·¦ä¾§é¢æ¿" : "Trend data loaded, see left panel for details.") + "</p>";

    // å·¦ä¸Šä¸‹æ–‡é¢æ¿ï¼šæºå¸¦å“ç±»ä¸‹æ‹‰çŠ¶æ€ï¼Œæµ®çª—ç» MutationObserver è‡ªåŠ¨åŒæ­¥
    _publishCategoryTrendContext(summary, categoryList, activeCategory);
    appendTrendNarrative(container, summary, zh, language);
    return summary;
  }

  // å“ç±»è¶‹åŠ¿ï¼šä¸‹æ‹‰åˆ‡æ¢å½“å‰å“ç±»ï¼ˆå·¦é¢æ¿/æµ®çª—å†…å…±ç”¨ï¼‰ã€‚
  // æµç¨‹ï¼šç«‹å³æ›´æ–°å·¦ä¸Šä¸‹æ–‡é¢æ¿ä¸º loading â†’ æ‹‰å–å“ç±»æœˆåº¦æ•°æ®ï¼ˆå“ç±»ç¼“å­˜å‘½ä¸­ç§’å¼€ï¼‰â†’
  // computeTrend â†’ é‡æ¸²æŸ“å·¦é¢æ¿ â†’ æµ®çª— MutationObserverï¼ˆ_updateDeepPanelFromContextï¼‰è‡ªåŠ¨åŒæ­¥ã€‚
  // ç«æ€ï¼š_trendSwitchSeq åºå·å®ˆå«ï¼Œå¿«é€Ÿè¿ç»­åˆ‡æ¢æ—¶ä¸¢å¼ƒè¿‡æœŸå“åº”ã€‚
  async function switchTrendCategory(categoryName) {
    var seq = ++_trendSwitchSeq;
    var zh = state.language === "zh";
    var categoryList = categoryListForTrend();
    var activeCategory = String(categoryName || "");
    if (!activeCategory && categoryList.length) activeCategory = categoryList[0].name;
    if (!activeCategory) return null;
    _activeTrendCategory = activeCategory;

    // Loading ä¸Šä¸‹æ–‡ï¼šå·¦é¢æ¿å…ˆæ¸²æŸ“ä¸‹æ‹‰ + åŠ è½½ä¸­ï¼ˆå« trend-context-wrap å¤–å£³ï¼Œ
    // ä¿è¯æµ®çª— observer åŒæ­¥ loading æ€ï¼‰ï¼Œæ•°æ®åˆ°ä½åå†æ›¿æ¢ä¸ºå®Œæ•´è¶‹åŠ¿
    var loadingSummary = { target: activeCategory, categoryTrend: true, categoryList: categoryList, activeCategory: activeCategory, loading: true };
    setContext(buildTrendContext(loadingSummary));

    var catOffers = offersInCategory(activeCategory, { excludeTier4Black: true });
    var monthlyMetrics = catOffers.length ? await fetchCategoryTrendMetrics(activeCategory, 12) : null;
    if (seq !== _trendSwitchSeq) return null; // ç«æ€ï¼šæœŸé—´ç”¨æˆ·åˆåˆ‡æ¢äº†å“ç±»ï¼Œä¸¢å¼ƒæœ¬æ¬¡ç»“æœ

    var summary = null;
    if (!monthlyMetrics || monthlyMetrics.length < 2) {
      var estimated = estimateAggregatedTrend(catOffers, 3);
      if (estimated) {
        estimated.target = activeCategory;
        estimated.estimated = true;
        summary = estimated;
      }
    } else {
      summary = computeTrend(monthlyMetrics, null);
      if (summary) summary.target = activeCategory;
    }
    if (!summary) return null;
    _publishCategoryTrendContext(summary, categoryList, activeCategory);
    return summary;
  }

  // â”€â”€ Trend helper: render estimated trend (used by all entity types) â”€â”€
  function renderEstimatedTrend(summary, label, container, zh, language) {
    summary.target = label;
    summary.estimated = true;
    container.innerHTML = "<div class=\"analysis-section\">"
      + "<p class=\"info\" style=\"margin-bottom:8px;font-size:0.85em;color:#888;\">"
      + (zh ? "âš¡ æ•°æ®åº“æœªè¿æ¥ï¼Œè¶‹åŠ¿æ•°æ®åŸºäºæ±‡æ€»å†å²ä¼°ç®—ï¼ˆè¯¦è§å·¦ä¾§é¢æ¿ï¼‰ã€‚è¿æ¥æ•°æ®åº“åå¯è·å–ç²¾ç¡®æœˆåº¦æŒ‡æ ‡ã€‚" : "âš¡ Database not connected; trend data estimated from aggregate totals (see left panel). Connect DB for precise monthly metrics.")
      + "</p>"
      + "</div>";
    setContext(buildTrendContext(summary));
    appendTrendNarrative(container, summary, zh, language);
  }

  // â”€â”€ Trend helper: merchant insufficient data fallback â”€â”€
  function renderMerchantInsufficientData(offer, analysisTarget, zh, container) {
    container.innerHTML = "<div class=\"analysis-section\"><h4>" + (zh ? "è¶‹åŠ¿åˆ†æ: " : "Trend: ") + escapeHtml(offer.brand || offer.merchantName || analysisTarget) + "</h4>"
      + "<p>" + (zh ? "æ•°æ®ä¸è¶³ä»¥åˆ†æè¶‹åŠ¿ï¼ˆéœ€è¦è‡³å°‘ 2 ä¸ªæœˆçš„æœˆåº¦æ•°æ®ï¼‰ã€‚å½“å‰å·²çŸ¥æ•°æ®ï¼š" : "Insufficient data for trend analysis (need at least 2 months). Current snapshot: ")
      + (zh ? "è®¢å• " : "Orders ") + number(offer.orders || 0).toLocaleString()
      + (zh ? "ï¼ŒRevenue " : ", Revenue ") + money(offer.salesAmount || 0)
      + (zh ? "ï¼ŒEPC " : ", EPC ") + epc(offer.epc || 0)
      + "</p>"
      + "<p class=\"info\" style=\"font-size:0.85em;color:#888;\">"
      + (zh ? "ğŸ’¡ æç¤ºï¼šè¶‹åŠ¿åˆ†æéœ€è¦æ•°æ®åº“ä¸­çš„æœˆåº¦æ—¶é—´åºåˆ—æ•°æ®ã€‚è¯·è®¾ç½® OFFER_DB_* ç¯å¢ƒå˜é‡æˆ–éƒ¨ç½²åˆ°ç”Ÿäº§ç¯å¢ƒã€‚" : "ğŸ’¡ Trend analysis requires monthly time-series data from the database. Set OFFER_DB_* env vars or deploy to production.")
      + "</p></div>";
  }

  // â”€â”€ Trend helper: append narrative prose (non-blocking) â”€â”€
  function appendTrendNarrative(container, summary, zh, language) {
    setTimeout(async function() {
      var narrativeId = "trend-narrative-" + Date.now();
      var narrativeHtml = "<div id=\"" + narrativeId + "\" class=\"analysis-narrative-placeholder\"><p><em>" + (zh ? "æ­£åœ¨ç”Ÿæˆè¶‹åŠ¿åˆ†æâ€¦" : "Generating trend analysisâ€¦") + "</em></p></div>";
      container.innerHTML += narrativeHtml;
      try {
        var text = await fetchAnalysisText(summary, language);
        if (!text) text = fallbackAnalysisText(summary, language);
        var narrativeContainer = document.getElementById(narrativeId);
        if (narrativeContainer) {
          narrativeContainer.innerHTML = "";
          renderAnalysisNarrative(narrativeContainer, text);
        }
      } catch (e) {
        var fallbackText = fallbackAnalysisText(summary, language);
        var fallbackContainer = document.getElementById(narrativeId);
        if (fallbackContainer) fallbackContainer.innerHTML = "<p>" + escapeHtml(fallbackText) + "</p>";
      }
    }, 0);
  }

  // â”€â”€ Trend helper: wrap a promise with a timeout â”€â”€
  function timeoutPromise(promise, ms, fallback) {
    var timer = null;
    var timeout = new Promise(function(_, reject) {
      timer = setTimeout(function() { reject(new Error("timeout")); }, ms);
    });
    return Promise.race([promise, timeout])
      .catch(function() { return fallback; })
      .finally(function() {
        if (timer !== null) clearTimeout(timer);
      });
  }

  // â”€â”€ Trend helper: fetch aggregated monthly metrics from DB for multiple offers â”€â”€
  async function fetchAggregatedMonthlyMetrics(offers, monthCount) {
    if (!offers || offers.length === 0) return null;

    // å…¨é‡èšåˆï¼ˆä¸æˆªæ–­ Top 25ï¼‰ï¼šå“ç±»è¶‹åŠ¿éœ€è¦ä»£è¡¨å“ç±»æ•´ä½“è€Œéå¤´éƒ¨å•†æˆ·ã€‚
    // å•†æˆ·æœˆåº¦æ•°æ®æœ‰ fetchMerchantMetrics çš„ dbMerchantCache ç¼“å­˜ï¼ŒåŒä¸€å•†æˆ·è·¨å“ç±»/è·¨è¯·æ±‚å¤ç”¨ï¼Œ
    // æ‰¹å¤„ç†ä»æŒ‰ 6 å¹¶å‘æ§åˆ¶ API å‹åŠ›ã€‚
    var allMerchantRows = [];
    var dataAsOf = null;
    var batchSize = 6;
    for (var i = 0; i < offers.length; i += batchSize) {
      var batch = offers.slice(i, i + batchSize);
      var batchResults = await Promise.all(batch.map(function(o) {
        return fetchMerchantMetrics(o.merchantId, monthCount);
      }));
      for (var r = 0; r < batchResults.length; r++) {
        var payload = batchResults[r];
        if (payload && Array.isArray(payload.monthlyAmazonMetrics)) {
          allMerchantRows.push(payload.monthlyAmazonMetrics);
          if (payload.checkedAt) {
            var candidateCheckedAt = String(payload.checkedAt);
            if (!dataAsOf || candidateCheckedAt > dataAsOf) dataAsOf = candidateCheckedAt;
          }
        }
      }
    }

    if (allMerchantRows.length === 0) return null;

    // Aggregate by month: sum additive fields across all merchants
    var monthMap = {};
    for (var i = 0; i < allMerchantRows.length; i++) {
      var merchantMonths = allMerchantRows[i];
      for (var m = 0; m < merchantMonths.length; m++) {
        var row = merchantMonths[m];
        var monthKey = row.month;
        if (!monthMap[monthKey]) {
          monthMap[monthKey] = { month: monthKey, revenue: 0, orders: 0, clicks: 0, payout: 0, affiliatePayout: 0 };
        }
        monthMap[monthKey].revenue += Number(row.revenue) || 0;
        monthMap[monthKey].orders += Number(row.orders) || 0;
        monthMap[monthKey].clicks += Number(row.clicks) || 0;
        monthMap[monthKey].payout += Number(row.payout) || 0;
        monthMap[monthKey].affiliatePayout += Number(row.affiliatePayout || row.affCommission) || 0;
      }
    }

    var result = Object.values(monthMap).sort(function(a, b) {
      return a.month.localeCompare(b.month);
    });

    // Compute weighted rates for each month
    for (var i = 0; i < result.length; i++) {
      var entry = result[i];
      entry.allEpc = commissionEpcFromTotals(entry.revenue, entry.payout, entry.clicks);
      entry.affEpc = commissionEpcFromTotals(entry.revenue, entry.affiliatePayout, entry.clicks);
      entry.epc = entry.affEpc;
      entry.aov = entry.orders > 0 ? entry.revenue / entry.orders : 0;
    }

    result.checkedAt = dataAsOf;
    return result;
  }

  // å“ç±»è¶‹åŠ¿æœˆåº¦æ•°æ®ç¼“å­˜ï¼ˆä¼šè¯å†…ï¼‰ï¼šé”® = å“ç±»å + æœˆä»½æ•°ã€‚
  // å•†æˆ·çº§ç¼“å­˜ç”± fetchMerchantMetrics çš„ dbMerchantCache æä¾›ï¼Œè¿™é‡Œåªç¼“å­˜å“ç±»èšåˆç»“æœï¼Œ
  // ä¸‹æ‹‰åˆ‡æ¢å“ç±»/åˆ‡å›å·²çœ‹å“ç±»æ—¶ç§’å¼€ã€‚
  var _categoryMonthlyCache = {};

  // å“ç±»è¶‹åŠ¿æ•°æ®ï¼šTier 1-3 å…¨é‡èšåˆæœˆåº¦æ•°æ®ï¼ˆæ’é™¤ Tier 4/BLACKï¼Œä¸å“ç±»åˆ†æå£å¾„ä¸€è‡´ï¼‰ã€‚
  // 25s è¶…æ—¶å…œåº•ï¼ˆä¸åŸ category trend path ä¸€è‡´ï¼‰ï¼Œè¶…æ—¶è¿”å› null ç”±è°ƒç”¨æ–¹èµ°ä¼°ç®—è¶‹åŠ¿ã€‚
  async function fetchCategoryTrendMetrics(categoryName, monthCount) {
    var cacheKey = String(categoryName || "") + ":" + (typeof monthCount === "number" ? monthCount : 12);
    if (_categoryMonthlyCache[cacheKey]) return _categoryMonthlyCache[cacheKey];
    var catOffers = offersInCategory(categoryName, { excludeTier4Black: true });
    if (!catOffers || catOffers.length === 0) return null;
    var metrics = await timeoutPromise(fetchAggregatedMonthlyMetrics(catOffers, monthCount), 25000, null);
    if (metrics && metrics.length >= 1) _categoryMonthlyCache[cacheKey] = metrics;
    return metrics;
  }

  // å“ç±»è¶‹åŠ¿ä¸‹æ‹‰åˆ—è¡¨ï¼šTier 1-3 å•†æˆ·æŒ‰ä¸»å“ç±»èšåˆï¼Œrevenue é™åºï¼ˆä¸‹æ‹‰é»˜è®¤é¡¹ä¸æ’åºï¼‰ã€‚
  // å£å¾„ä¸ offersInCategory(cat, {excludeTier4Black:true}) ä¸€è‡´ï¼šo.mainCategory || o.categoryã€‚
  function categoryListForTrend() {
    var map = {};
    offers.forEach(function(o) {
      if (isTier4OrBlack(o.tier)) return;
      var cat = String(o.mainCategory || o.category || "Uncategorized").trim();
      if (!cat) cat = "Uncategorized";
      if (!map[cat]) map[cat] = { name: cat, revenue: 0, count: 0 };
      map[cat].revenue += Number(o.salesAmount) || 0;
      map[cat].count += 1;
    });
    var list = Object.keys(map).map(function(k) { return map[k]; });
    list.sort(function(a, b) { return (b.revenue - a.revenue) || (b.count - a.count); });
    return list;
  }

  // å“ç±»è¶‹åŠ¿å‘å¸ƒåˆ°å·¦ä¸Šä¸‹æ–‡é¢æ¿ï¼šsummary æŒ‚å“ç±»ä¸‹æ‹‰çŠ¶æ€æ ‡è®°ï¼ŒsetContext â†’ recBox é‡æ¸²æŸ“ â†’
  // æµ®çª— MutationObserverï¼ˆ_updateDeepPanelFromContextï¼‰è‡ªåŠ¨åŒæ­¥ï¼Œä¸¤ä¾§è”åŠ¨ã€‚
  function _publishCategoryTrendContext(summary, categoryList, activeCategory) {
    summary.categoryTrend = true;
    summary.categoryList = categoryList;
    summary.activeCategory = activeCategory;
    _activeTrendCategory = activeCategory;
    setContext(buildTrendContext(summary));
  }

  // â”€â”€ Trend helper: estimated aggregated trend from offer totals (no DB) â”€â”€
  function estimateAggregatedTrend(offers, monthCount) {
    if (!offers || offers.length === 0) return null;

    // Collect all months across all offers' invoiceMonths, then aggregate
    var monthMap = {};
    for (var i = 0; i < offers.length; i++) {
      var o = offers[i];
      var invoiceMonths = o.invoiceMonths;
      if (!Array.isArray(invoiceMonths) || invoiceMonths.length < 2) {
        // Generate synthetic months if no invoiceMonths
        var count = Math.max(typeof monthCount === "number" ? monthCount : 3, 2);
        var now = new Date();
        invoiceMonths = [];
        for (var j = count - 1; j >= 0; j--) {
          var d = new Date(now.getFullYear(), now.getMonth() - j, 1);
          invoiceMonths.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
        }
      }

      var months = invoiceMonths.slice();
      if (typeof monthCount === "number" && monthCount >= 2 && months.length > monthCount) {
        months = months.slice(-monthCount);
      }
      var n = months.length;
      if (n < 1) continue;

      var totalRevenue = Number(o.salesAmount) || 0;
      var totalOrders = Number(o.orders) || 0;
      // clicks å¯èƒ½æ˜¯ 0ï¼ˆç¼“å­˜æ•°æ®ä¸å®Œæ•´ï¼‰ï¼Œç”¨ dpv/atc ä»£æ›¿ä¼°ç®—
      var totalClicks = Number(o.clicks)
        || Number(o.dpv)
        || Number(o.atc)
        || 0;
      var totalPayout = Number(o.payout) || 0;
      var totalCommission = Number(o.affCommission || o.affiliatePayout) || 0;

      for (var j = 0; j < months.length; j++) {
        if (!monthMap[months[j]]) {
          monthMap[months[j]] = { month: months[j], revenue: 0, orders: 0, clicks: 0, payout: 0, affiliatePayout: 0 };
        }
        monthMap[months[j]].revenue += totalRevenue / n;
        monthMap[months[j]].orders += totalOrders / n;
        monthMap[months[j]].clicks += totalClicks / n;
        monthMap[months[j]].payout += totalPayout / n;
        monthMap[months[j]].affiliatePayout += totalCommission / n;
      }
    }

    var monthKeys = Object.keys(monthMap).sort();
    if (monthKeys.length < 2) return null;

    if (typeof monthCount === "number" && monthCount >= 2 && monthKeys.length > monthCount) {
      monthKeys = monthKeys.slice(-monthCount);
    }

    var metricRows = [];
    for (var i = 0; i < monthKeys.length; i++) {
      var m = monthMap[monthKeys[i]];
      var allEpc = commissionEpcFromTotals(m.revenue, m.payout, m.clicks);
      var affEpc = commissionEpcFromTotals(m.revenue, m.affiliatePayout, m.clicks);
      metricRows.push({
        month: m.month,
        revenue: Math.round(m.revenue * 100) / 100,
        orders: Math.round(m.orders),
        epc: Math.round(affEpc * 10000) / 10000,
        allEpc: Math.round(allEpc * 10000) / 10000,
        affEpc: Math.round(affEpc * 10000) / 10000,
        aov: m.orders > 0 ? Math.round((m.revenue / m.orders) * 100) / 100 : 0,
        clicks: Math.round(m.clicks),
        affiliatePayout: Math.round(m.affiliatePayout * 100) / 100
      });
    }

    return computeTrend(metricRows, null);
  }

  function renderCategoryAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var html = "";

    // Aggregates
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "å“ç±»æ¦‚è§ˆ" : "Category Overview") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th><th>" + (zh ? "æ•°å€¼" : "Value") + "</th></tr></thead><tbody>";
    html += "<tr><td>" + (zh ? "å•†æˆ·æ•°" : "Merchants") + "</td><td>" + s.aggregates.merchantCount + "</td></tr>";
    html += "<tr><td>" + (zh ? "æ€»æ”¶å…¥" : "Total Revenue") + "</td><td>" + money(s.aggregates.totalRevenue) + "</td></tr>";
    html += "<tr><td>" + (zh ? "æ€»ä½£é‡‘" : "Total Commission") + "</td><td>" + money(s.aggregates.totalCommission) + "</td></tr>";
    html += "<tr><td>" + (zh ? "æ€»è®¢å•" : "Total Orders") + "</td><td>" + number(s.aggregates.totalOrders).toLocaleString() + "</td></tr>";
    html += "<tr><td>Avg EPC(Aff)</td><td>" + epc(s.aggregates.avgEpc) + "</td></tr>";
    html += "<tr><td>Avg AOV</td><td>" + money(s.aggregates.avgAov) + "</td></tr>";
    html += "<tr><td>Avg CVR</td><td>" + pct(s.aggregates.avgCvr / 100) + "</td></tr>";
    html += "<tr><td>" + (zh ? "å¹³å‡ä½£é‡‘ç‡" : "Avg Comm Rate") + "</td><td>" + pct(s.aggregates.avgCommissionRate / 100) + "</td></tr>";
    html += "</tbody></table></div>";

    // vs Global
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "ä¸å…¨ç«™å‡å€¼å¯¹æ¯”" : "vs Global Average") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th><th>" + (zh ? "å“ç±»" : "Category") + "</th><th>" + (zh ? "å…¨ç«™" : "Global") + "</th><th>Delta</th></tr></thead><tbody>";
    var keys = Object.keys(s.vsGlobal);
    for (var i = 0; i < keys.length; i++) {
      var v = s.vsGlobal[keys[i]];
      html += "<tr><td>" + metricLabel(keys[i]) + "</td><td>" + formatAnalysisMetric(v.self, keys[i]) + "</td><td>" + formatAnalysisMetric(v.global, keys[i]) + "</td><td>" + escapeHtml(v.delta) + "</td></tr>";
    }
    html += "</tbody></table></div>";

    // Top & Bottom
    if (s.topMerchants && s.topMerchants.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "å“ç±» Top 5ï¼ˆæŒ‰ä½£é‡‘ï¼‰" : "Top 5 by Commission") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "å•†æˆ·" : "Merchant") + "</th><th>Tier</th><th>EPC(All)</th><th>EPC(Aff)</th><th>CVR</th><th>" + (zh ? "æ€»ä½£é‡‘" : "All Commission") + "</th><th>" + (zh ? "è”ç›Ÿä½£é‡‘" : "Aff Commission") + "</th></tr></thead><tbody>";
      for (var i = 0; i < s.topMerchants.length; i++) {
        var m = s.topMerchants[i];
        html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHtml(m.name) + "</td><td>" + escapeHtml(m.tier) + "</td><td>" + epc(m.allEpc) + "</td><td>" + epc(m.affEpc) + "</td><td>" + pct(m.conversionRate / 100) + "</td><td>" + money(m.allCommission) + "</td><td>" + money(m.affCommission) + "</td></tr>";
      }
      html += "</tbody></table></div>";
    }

    return html;
  }

  function renderTierAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var html = "";

    // Aggregates
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "å±‚çº§æ¦‚è§ˆ" : "Tier Overview") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th><th>" + (zh ? "æ•°å€¼" : "Value") + "</th></tr></thead><tbody>";
    html += "<tr><td>" + (zh ? "å•†æˆ·æ•°" : "Merchants") + "</td><td>" + s.aggregates.merchantCount + "</td></tr>";
    html += "<tr><td>" + (zh ? "æ€»æ”¶å…¥" : "Total Revenue") + "</td><td>" + money(s.aggregates.totalRevenue) + "</td></tr>";
    html += "<tr><td>" + (zh ? "æ€»ä½£é‡‘" : "Total Commission") + "</td><td>" + money(s.aggregates.totalCommission) + "</td></tr>";
    html += "<tr><td>" + (zh ? "æ€»è®¢å•" : "Total Orders") + "</td><td>" + number(s.aggregates.totalOrders).toLocaleString() + "</td></tr>";
    html += "<tr><td>Avg EPC(Aff)</td><td>" + epc(s.aggregates.avgEpc) + "</td></tr>";
    html += "<tr><td>Avg AOV</td><td>" + money(s.aggregates.avgAov) + "</td></tr>";
    html += "<tr><td>Avg CVR</td><td>" + pct(s.aggregates.avgCvr / 100) + "</td></tr>";
    html += "</tbody></table></div>";

    // vs Other Tiers
    var tierKeys = Object.keys(s.vsOtherTiers);
    if (tierKeys.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "è·¨å±‚å¯¹æ¯”" : "Cross-Tier Comparison") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th><th>" + escapeHtml(s.target.name) + "</th>";
      for (var t = 0; t < tierKeys.length; t++) html += "<th>" + escapeHtml(tierKeys[t]) + " (Delta)</th>";
      html += "</tr></thead><tbody>";
      var compFields = ["epc", "aov", "conversionRate", "commissionRate"];
      for (var f = 0; f < compFields.length; f++) {
        var field = compFields[f];
        html += "<tr><td>" + metricLabel(field) + "</td><td>" + formatAnalysisMetric(s.vsOtherTiers[tierKeys[0]][field].self, field) + "</td>";
        for (var t = 0; t < tierKeys.length; t++) {
          var comp = s.vsOtherTiers[tierKeys[t]][field];
          html += "<td>" + formatAnalysisMetric(comp.other, field) + " (" + escapeHtml(comp.delta) + ")</td>";
        }
        html += "</tr>";
      }
      html += "</tbody></table></div>";
    }

    // Segments
    if (s.segments) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "å•†æˆ·åˆ†åŒ–ï¼ˆæŒ‰ä½£é‡‘ï¼‰" : "Segmentation (by Commission)") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "åˆ†æ®µ" : "Segment") + "</th><th>" + (zh ? "å•†æˆ·æ•°" : "Count") + "</th><th>" + (zh ? "å¹³å‡ä½£é‡‘" : "Avg Commission") + "</th></tr></thead><tbody>";
      html += "<tr><td>" + (zh ? "å¤´éƒ¨ (Top 20%)" : "Head (Top 20%)") + "</td><td>" + s.segments.head.count + "</td><td>" + money(s.segments.head.avg) + "</td></tr>";
      html += "<tr><td>" + (zh ? "ä¸­éƒ¨ (Mid 60%)" : "Mid (60%)") + "</td><td>" + s.segments.mid.count + "</td><td>" + money(s.segments.mid.avg) + "</td></tr>";
      html += "<tr><td>" + (zh ? "å°¾éƒ¨ (Bottom 20%)" : "Tail (Bottom 20%)") + "</td><td>" + s.segments.tail.count + "</td><td>" + money(s.segments.tail.avg) + "</td></tr>";
      html += "</tbody></table></div>";
    }

    // Outliers
    if (s.outliers && s.outliers.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "å¼‚å¸¸å€¼" : "Outliers") + "</h4><ul>";
      for (var i = 0; i < s.outliers.length; i++) {
        html += "<li><strong>" + escapeHtml(s.outliers[i].name) + "</strong>: " + escapeHtml(s.outliers[i].reason) + "</li>";
      }
      html += "</ul></div>";
    }

    return html;
  }

  // â”€â”€ Multi-entity rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function renderMultiCategoryAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var entities = s.entities;
    if (!entities || !entities.length) return "<p>" + (zh ? "æ— å¯¹æ¯”æ•°æ®ã€‚" : "No comparison data.") + "</p>";

    var entityNames = entities.map(function(e) { return e.name; });
    var html = "";

    // Title
    var tierLabel = s.target.tierFilter ? " (" + s.target.tierFilter + ")" : "";
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "å“ç±»å¯¹æ¯”åˆ†æ" : "Category Comparison") + escapeHtml(tierLabel) + "</h4>";

    // Comparison table: rows = metrics, columns = categories
    var metrics = [
      { key: "merchantCount", label: zh ? "å•†æˆ·æ•°" : "Merchants", fmt: "number" },
      { key: "revenue", label: zh ? "æ€»æ”¶å…¥" : "Revenue", fmt: "money" },
      { key: "commission", label: zh ? "æ€»ä½£é‡‘" : "Commission", fmt: "money" },
      { key: "orders", label: zh ? "æ€»è®¢å•" : "Orders", fmt: "number" },
      { key: "epc", label: "Avg EPC(Aff)", fmt: "epc" },
      { key: "aov", label: "Avg AOV", fmt: "money" },
      { key: "cvr", label: "Avg CVR", fmt: "pct" },
      { key: "commissionRate", label: zh ? "ä½£é‡‘ç‡" : "Comm Rate", fmt: "pct" },
    ];

    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th>";
    for (var i = 0; i < entityNames.length; i++) {
      html += "<th>" + escapeHtml(entityNames[i]) + "</th>";
    }
    html += "</tr></thead><tbody>";

    for (var m = 0; m < metrics.length; m++) {
      var metric = metrics[m];
      html += "<tr><td>" + metric.label + "</td>";
      for (var i = 0; i < entities.length; i++) {
        var val;
        if (metric.key === "merchantCount") {
          val = entities[i].merchantCount;
        } else if (metric.key === "revenue" || metric.key === "commission" || metric.key === "orders" || metric.key === "clicks") {
          val = entities[i].totals[metric.key];
        } else {
          val = entities[i].averages[metric.key];
        }
        if (metric.fmt === "money") {
          html += "<td>" + money(val) + "</td>";
        } else if (metric.fmt === "epc") {
          html += "<td>" + epc(val) + "</td>";
        } else if (metric.fmt === "pct") {
          // cvr and commissionRate are stored as percentages
          html += "<td>" + pct((metric.key === "commissionRate" ? val : val) / 100) + "</td>";
        } else {
          html += "<td>" + (typeof val === "number" ? number(val).toLocaleString() : escapeHtml(String(val))) + "</td>";
        }
      }
      html += "</tr>";
    }
    html += "</tbody></table></div>";

    // Each entity's top brands
    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      html += "<div class=\"analysis-section\"><h4>" + escapeHtml(ent.name) + (zh ? " â€” Top å“ç‰Œ" : " â€” Top Brands") + "</h4>";
      if (ent.topBrands && ent.topBrands.length) {
        html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "å“ç‰Œ" : "Brand") + "</th><th>" + (zh ? "Tier" : "Tier") + "</th><th>EPC(All)</th><th>EPC(Aff)</th><th>AOV</th><th>" + (zh ? "è®¢å•" : "Orders") + "</th><th>" + (zh ? "æ€»ä½£é‡‘" : "All Commission") + "</th><th>" + (zh ? "è”ç›Ÿä½£é‡‘" : "Aff Commission") + "</th></tr></thead><tbody>";
        for (var b = 0; b < ent.topBrands.length; b++) {
          var brand = ent.topBrands[b];
          html += "<tr><td>" + (b + 1) + "</td><td>" + escapeHtml(brand.name) + "</td><td>" + escapeHtml(brand.tier) + "</td><td>" + epc(brand.allEpc) + "</td><td>" + epc(brand.affEpc) + "</td><td>" + money(brand.aov) + "</td><td>" + number(brand.orders).toLocaleString() + "</td><td>" + money(brand.allCommission) + "</td><td>" + money(brand.affCommission) + "</td></tr>";
        }
        html += "</tbody></table>";
      }
      html += "</div>";
    }

    // Key findings
    if (entities.length >= 2) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "å·®å¼‚å‘ç°" : "Key Differences") + "</h4><ul>";
      // Compare orders
      var byOrders = entities.slice().sort(function(a, b) { return b.totals.orders - a.totals.orders; });
      if (byOrders[0].totals.orders > 0 && byOrders[1].totals.orders > 0) {
        var ratio = (byOrders[0].totals.orders / byOrders[1].totals.orders).toFixed(1);
        html += "<li>" + escapeHtml(byOrders[0].name) + (zh ? " è®¢å•é‡ (" : " orders (") + number(byOrders[0].totals.orders).toLocaleString() + (zh ? ") æ˜¯ " : ") is ") + ratio + "x " + escapeHtml(byOrders[1].name) + (zh ? " çš„ " : "'s ") + number(byOrders[1].totals.orders).toLocaleString() + (zh ? " å•" : " orders") + "</li>";
      }
      // Compare EPC
      var byEpc = entities.slice().sort(function(a, b) { return b.averages.epc - a.averages.epc; });
      if (byEpc[0].averages.epc > 0 && byEpc[1].averages.epc > 0) {
        var epcDelta = ((byEpc[0].averages.epc - byEpc[1].averages.epc) / byEpc[1].averages.epc * 100).toFixed(1);
        html += "<li>" + escapeHtml(byEpc[0].name) + " Avg EPC(Aff) (" + epc(byEpc[0].averages.epc) + (zh ? ") æ¯” " : ") is ") + epcDelta + "% " + (zh ? "é«˜äº " : "higher than ") + escapeHtml(byEpc[1].name) + " (" + epc(byEpc[1].averages.epc) + ")</li>";
      }
      // Compare AOV
      var byAov = entities.slice().sort(function(a, b) { return b.averages.aov - a.averages.aov; });
      if (byAov[0].averages.aov > 0 && byAov[1].averages.aov > 0) {
        var aovDelta = ((byAov[0].averages.aov - byAov[1].averages.aov) / byAov[1].averages.aov * 100).toFixed(1);
        html += "<li>" + escapeHtml(byAov[0].name) + " Avg AOV (" + money(byAov[0].averages.aov) + (zh ? ") æ¯” " : ") is ") + aovDelta + "% " + (zh ? "é«˜äº " : "higher than ") + escapeHtml(byAov[1].name) + " (" + money(byAov[1].averages.aov) + ")</li>";
      }
      // Compare merchant count
      var byCount = entities.slice().sort(function(a, b) { return b.merchantCount - a.merchantCount; });
      if (byCount[0].merchantCount > byCount[1].merchantCount) {
        html += "<li>" + escapeHtml(byCount[0].name) + (zh ? " æœ‰ " : " has ") + byCount[0].merchantCount + (zh ? " ä¸ªå•†æˆ·ï¼Œæ˜¯ " : " merchants, vs ") + escapeHtml(byCount[1].name) + " " + byCount[1].merchantCount + (zh ? " ä¸ª" : " merchants") + "</li>";
      }
      html += "</ul></div>";
    }

    return html;
  }

  function renderMultiTierAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var entities = s.entities;
    if (!entities || !entities.length) return "<p>" + (zh ? "æ— å¯¹æ¯”æ•°æ®ã€‚" : "No comparison data.") + "</p>";

    var entityNames = entities.map(function(e) { return e.name; });
    var html = "";

    var catLabel = s.target.categoryFilter ? " (" + escapeHtml(s.target.categoryFilter) + ")" : "";
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "Tier å¯¹æ¯”åˆ†æ" : "Tier Comparison") + catLabel + "</h4>";

    // Comparison table: rows = metrics, columns = tiers
    var metrics = [
      { key: "merchantCount", label: zh ? "å•†æˆ·æ•°" : "Merchants", fmt: "number" },
      { key: "revenue", label: zh ? "æ€»æ”¶å…¥" : "Revenue", fmt: "money" },
      { key: "commission", label: zh ? "æ€»ä½£é‡‘" : "Commission", fmt: "money" },
      { key: "orders", label: zh ? "æ€»è®¢å•" : "Orders", fmt: "number" },
      { key: "epc", label: "Avg EPC(Aff)", fmt: "epc" },
      { key: "aov", label: "Avg AOV", fmt: "money" },
      { key: "cvr", label: "Avg CVR", fmt: "pct" },
    ];

    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "æŒ‡æ ‡" : "Metric") + "</th>";
    for (var i = 0; i < entityNames.length; i++) {
      html += "<th>" + escapeHtml(entityNames[i]) + "</th>";
    }
    html += "</tr></thead><tbody>";

    for (var m = 0; m < metrics.length; m++) {
      var metric = metrics[m];
      html += "<tr><td>" + metric.label + "</td>";
      for (var i = 0; i < entities.length; i++) {
        var val;
        if (metric.key === "merchantCount") {
          val = entities[i].merchantCount;
        } else if (["revenue", "commission", "orders", "clicks"].indexOf(metric.key) !== -1) {
          val = entities[i].totals[metric.key];
        } else {
          val = entities[i].averages[metric.key];
        }
        if (metric.fmt === "money") {
          html += "<td>" + money(val) + "</td>";
        } else if (metric.fmt === "epc") {
          html += "<td>" + epc(val) + "</td>";
        } else if (metric.fmt === "pct") {
          html += "<td>" + pct(val / 100) + "</td>";
        } else {
          html += "<td>" + (typeof val === "number" ? number(val).toLocaleString() : escapeHtml(String(val))) + "</td>";
        }
      }
      html += "</tr>";
    }
    html += "</tbody></table></div>";

    // Each tier's top brands
    for (var i = 0; i < entities.length; i++) {
      var ent = entities[i];
      html += "<div class=\"analysis-section\"><h4>" + escapeHtml(ent.name) + (zh ? " â€” Top å“ç‰Œ" : " â€” Top Brands") + "</h4>";
      if (ent.topBrands && ent.topBrands.length) {
        html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "å“ç‰Œ" : "Brand") + "</th><th>EPC(All)</th><th>EPC(Aff)</th><th>AOV</th><th>" + (zh ? "è®¢å•" : "Orders") + "</th><th>" + (zh ? "æ€»ä½£é‡‘" : "All Commission") + "</th><th>" + (zh ? "è”ç›Ÿä½£é‡‘" : "Aff Commission") + "</th></tr></thead><tbody>";
        for (var b = 0; b < ent.topBrands.length; b++) {
          var brand = ent.topBrands[b];
          html += "<tr><td>" + (b + 1) + "</td><td>" + escapeHtml(brand.name) + "</td><td>" + epc(brand.allEpc) + "</td><td>" + epc(brand.affEpc) + "</td><td>" + money(brand.aov) + "</td><td>" + number(brand.orders).toLocaleString() + "</td><td>" + money(brand.allCommission) + "</td><td>" + money(brand.affCommission) + "</td></tr>";
        }
        html += "</tbody></table>";
      }
      html += "</div>";
    }

    // Category distribution for each tier (only when no category filter)
    if (!s.target.categoryFilter) {
      for (var i = 0; i < entities.length; i++) {
        var ent = entities[i];
        if (ent.categoryDistribution) {
          var cats = Object.keys(ent.categoryDistribution).sort(function(a, b) { return ent.categoryDistribution[b] - ent.categoryDistribution[a]; });
          if (cats.length) {
            html += "<div class=\"analysis-section\"><h5>" + escapeHtml(ent.name) + (zh ? " å“ç±»åˆ†å¸ƒ" : " Category Distribution") + "</h5>";
            html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "å“ç±»" : "Category") + "</th><th>" + (zh ? "å•†æˆ·æ•°" : "Count") + "</th></tr></thead><tbody>";
            for (var c = 0; c < cats.length; c++) {
              html += "<tr><td>" + escapeHtml(cats[c]) + "</td><td>" + ent.categoryDistribution[cats[c]] + "</td></tr>";
            }
            html += "</tbody></table></div>";
          }
        }
      }
    }

    // Key findings
    if (entities.length >= 2) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "å·®å¼‚å‘ç°" : "Key Differences") + "</h4><ul>";
      var byOrders = entities.slice().sort(function(a, b) { return b.totals.orders - a.totals.orders; });
      if (byOrders[0].totals.orders > 0 && byOrders[1].totals.orders > 0) {
        var ratio = (byOrders[0].totals.orders / byOrders[1].totals.orders).toFixed(1);
        html += "<li>" + escapeHtml(byOrders[0].name) + (zh ? " è®¢å•é‡ (" : " orders (") + number(byOrders[0].totals.orders).toLocaleString() + (zh ? ") æ˜¯ " : ") is ") + ratio + "x " + escapeHtml(byOrders[1].name) + (zh ? " çš„ " : "'s ") + number(byOrders[1].totals.orders).toLocaleString() + (zh ? " å•" : " orders") + "</li>";
      }
      var byEpc = entities.slice().sort(function(a, b) { return b.averages.epc - a.averages.epc; });
      if (byEpc[0].averages.epc > 0 && byEpc[1].averages.epc > 0) {
        var epcDelta = ((byEpc[0].averages.epc - byEpc[1].averages.epc) / byEpc[1].averages.epc * 100).toFixed(1);
        html += "<li>" + escapeHtml(byEpc[0].name) + " Avg EPC(Aff) (" + epc(byEpc[0].averages.epc) + (zh ? ") æ¯” " : ") is ") + epcDelta + "% " + (zh ? "é«˜äº " : "higher than ") + escapeHtml(byEpc[1].name) + " (" + epc(byEpc[1].averages.epc) + ")</li>";
      }
      html += "</ul></div>";
    }

    return html;
  }

  // â”€â”€ LLM analysis text (async) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function fetchAnalysisText(summary, language) {
    try {
      var response = await fetch("/api/chat/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        credentials: "same-origin",
        body: JSON.stringify({ summary: summary, language: language || "en" }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        console.warn("[analysis] HTTP " + response.status);
        return null;
      }
      var data = await response.json().catch(function() { return {}; });
      if (data.ok && data.text) return data.text;
      return null;
    } catch (error) {
      console.warn("[analysis] fetch error: " + (error.message || "unknown"));
      return null;
    }
  }

  function renderAnalysisNarrative(containerEl, text) {
    if (!containerEl || !text) return;
    var p = document.createElement("div");
    p.className = "analysis-narrative";
    p.innerHTML = "<p>" + escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
    containerEl.appendChild(p);
  }

  function fallbackAnalysisText(summary, language) {
    var zh = language === "zh";
    var lines = [];
    if (summary.type === "merchant") {
      var name = summary.target.name;
      if (summary.strengths && summary.strengths.length) {
        var sNames = [];
        for (var i = 0; i < summary.strengths.length; i++) sNames.push(metricLabel(summary.strengths[i]));
        lines.push(zh ? (escapeHtml(name) + " çš„äº®ç‚¹æ˜¯ " + sNames.join("ã€") + " å¤„äºå“ç±»å‰åˆ—ã€‚") : (escapeHtml(name) + " stands out in " + sNames.join(", ") + " within its category."));
      }
      if (summary.weaknesses && summary.weaknesses.length) {
        var wNames = [];
        for (var i = 0; i < summary.weaknesses.length; i++) wNames.push(metricLabel(summary.weaknesses[i]));
        lines.push(zh ? ("å…³æ³¨ç‚¹ï¼š" + wNames.join("ã€") + " ä½äºå“ç±»å‡å€¼ï¼Œå»ºè®®ä¼˜åŒ–ã€‚") : ("Areas to watch: " + wNames.join(", ") + " are below category average."));
      }
      var insufficientFields = Object.keys(summary.ranks || {}).filter(function(field) {
        return summary.ranks[field] && summary.ranks[field].status === "insufficient_sample";
      });
      if (insufficientFields.length) {
        lines.push(zh
          ? "éƒ¨åˆ†æŒ‡æ ‡æ ·æœ¬é‡ä¸è¶³ï¼Œæœªå°†å…¶åˆ¤å®šä¸ºäº®ç‚¹æˆ–çŸ­æ¿ã€‚"
          : "Some metrics have insufficient sample size and were not classified as strengths or weaknesses.");
      }
      if (!lines.length) {
        lines.push(zh ? (escapeHtml(name) + " å„é¡¹æŒ‡æ ‡å¤„äºå“ç±»ä¸­ç­‰æ°´å¹³ï¼Œè¡¨ç°ç¨³å®šã€‚") : (escapeHtml(name) + " metrics are near the category median â€” stable performance."));
      }
      if (summary.paymentRisk && summary.paymentRisk.hasOverdue) {
        lines.push(zh ? "âš  è¯¥å•†æˆ·å­˜åœ¨é€¾æœŸä»˜æ¬¾é£é™©ï¼Œå»ºè®®å…³æ³¨ã€‚" : "âš  This merchant has overdue payment risk.");
      }
    } else if (summary.type === "category") {
      var catName = summary.target.name;
      lines.push(zh ? (escapeHtml(catName) + " å“ç±»å…± " + summary.aggregates.merchantCount + " ä¸ªå•†æˆ·ã€‚") : (escapeHtml(catName) + " has " + summary.aggregates.merchantCount + " merchants."));
      var vsGlobalKeys = Object.keys(summary.vsGlobal || {});
      for (var i = 0; i < vsGlobalKeys.length; i++) {
        var v = summary.vsGlobal[vsGlobalKeys[i]];
        if (v.delta && v.delta.indexOf("+") === 0) {
          lines.push(metricLabel(vsGlobalKeys[i]) + (zh ? " é«˜äºå…¨ç«™å‡å€¼ " : " above global average by ") + escapeHtml(v.delta) + "ã€‚");
        }
      }
      if (!lines.length) lines.push(zh ? "è¯¥å“ç±»æ•´ä½“è¡¨ç°ä¸å…¨ç«™å‡å€¼æŒå¹³ã€‚" : "This category performs at global average levels.");
    } else if (summary.type === "tier") {
      var tierName = summary.target.name;
      lines.push(zh ? (escapeHtml(tierName) + " å…± " + summary.aggregates.merchantCount + " ä¸ªå•†æˆ·ã€‚") : (escapeHtml(tierName) + " has " + summary.aggregates.merchantCount + " merchants."));
      if (summary.segments) {
        lines.push(zh ? ("å¤´éƒ¨ " + summary.segments.head.count + " ä¸ªå•†æˆ·è´¡çŒ®ä¸»è¦ä½£é‡‘ï¼Œå°¾éƒ¨ " + summary.segments.tail.count + " ä¸ªå•†æˆ·å¯èƒ½éœ€å…³æ³¨ã€‚") : ("Top " + summary.segments.head.count + " merchants drive most commission; bottom " + summary.segments.tail.count + " may need attention."));
      }
    } else if (summary.type === "multi_category") {
      var entities = summary.entities;
      if (entities && entities.length) {
        var names = entities.map(function(e) { return e.name; });
        if (summary.target.tierFilter) {
          lines.push(zh
            ? (escapeHtml(names.join(" vs ")) + " åœ¨ " + summary.target.tierFilter + " ä¸­çš„å¯¹æ¯”åˆ†æï¼š")
            : ("Comparison of " + escapeHtml(names.join(" vs ")) + " in " + summary.target.tierFilter + ":"));
        } else {
          lines.push(zh
            ? (escapeHtml(names.join(" vs ")) + " å“ç±»å¯¹æ¯”åˆ†æï¼š")
            : ("Category comparison: " + escapeHtml(names.join(" vs "))));
        }
        for (var i = 0; i < entities.length; i++) {
          var e = entities[i];
          lines.push(escapeHtml(e.name) + (zh ? ": " + e.merchantCount + " ä¸ªå•†æˆ·ï¼Œæ€»è®¢å• " : ": " + e.merchantCount + " merchants, ") + number(e.totals.orders).toLocaleString() + (zh ? " å•ï¼ŒEPC " : " orders, EPC ") + epc(e.averages.epc) + (zh ? "ï¼ŒAOV " : ", AOV ") + money(e.averages.aov));
        }
        // Highlight the leader by orders
        var byOrders = entities.slice().sort(function(a, b) { return b.totals.orders - a.totals.orders; });
        if (byOrders.length >= 2 && byOrders[0].totals.orders > 0 && byOrders[1].totals.orders > 0) {
          var ratioOrders = (byOrders[0].totals.orders / byOrders[1].totals.orders).toFixed(1);
          lines.push(zh
            ? (escapeHtml(byOrders[0].name) + " çš„è®¢å•é‡æ˜¯ " + escapeHtml(byOrders[1].name) + " çš„ " + ratioOrders + " å€ã€‚")
            : (escapeHtml(byOrders[0].name) + " has " + ratioOrders + "x the orders of " + escapeHtml(byOrders[1].name) + "."));
        }
      }
    } else if (summary.type === "multi_tier") {
      var entities2 = summary.entities;
      if (entities2 && entities2.length) {
        var names2 = entities2.map(function(e) { return e.name; });
        if (summary.target.categoryFilter) {
          lines.push(zh
            ? (escapeHtml(summary.target.categoryFilter) + " å“ç±»åœ¨ " + escapeHtml(names2.join(" vs ")) + " ä¸­çš„å¯¹æ¯”åˆ†æï¼š")
            : ("Comparison of " + escapeHtml(summary.target.categoryFilter) + " across " + escapeHtml(names2.join(" vs ")) + ":"));
        } else {
          lines.push(zh
            ? (escapeHtml(names2.join(" vs ")) + " å±‚çº§å¯¹æ¯”åˆ†æï¼š")
            : ("Tier comparison: " + escapeHtml(names2.join(" vs "))));
        }
        for (var i = 0; i < entities2.length; i++) {
          var e2 = entities2[i];
          lines.push(escapeHtml(e2.name) + (zh ? ": " + e2.merchantCount + " ä¸ªå•†æˆ·ï¼Œæ€»è®¢å• " : ": " + e2.merchantCount + " merchants, ") + number(e2.totals.orders).toLocaleString() + (zh ? " å•ï¼ŒEPC " : " orders, EPC ") + epc(e2.averages.epc));
        }
        var byOrders2 = entities2.slice().sort(function(a, b) { return b.totals.orders - a.totals.orders; });
        if (byOrders2.length >= 2 && byOrders2[0].totals.orders > 0 && byOrders2[1].totals.orders > 0) {
          var ratioOrders2 = (byOrders2[0].totals.orders / byOrders2[1].totals.orders).toFixed(1);
          lines.push(zh
            ? (escapeHtml(byOrders2[0].name) + " çš„è®¢å•é‡æ˜¯ " + escapeHtml(byOrders2[1].name) + " çš„ " + ratioOrders2 + " å€ã€‚")
            : (escapeHtml(byOrders2[0].name) + " has " + ratioOrders2 + "x the orders of " + escapeHtml(byOrders2[1].name) + "."));
        }
      }
    } else if (summary.type === "merchant_comparison") {
      var ents = summary.entities;
      if (ents && ents.length) {
        var names = ents.map(function(e) { return e.name; });
        lines.push(zh ? (escapeHtml(names.join(" vs ")) + " å•†æˆ·å¯¹æ¯”åˆ†æï¼š") : ("Merchant comparison: " + escapeHtml(names.join(" vs ")) + ":"));
        for (var i = 0; i < ents.length; i++) {
          var e = ents[i];
          lines.push(escapeHtml(e.name) + (zh ? ": " + e.tier + " Â· " + e.category + "ï¼ŒEPC " : ": " + e.tier + " Â· " + e.category + ", EPC ") + epc(e.metrics.epc || 0) + (zh ? "ï¼ŒAOV " : ", AOV ") + money(e.metrics.aov || 0) + (zh ? "ï¼Œè®¢å• " : ", orders ") + number(e.metrics.orders || 0).toLocaleString());
        }
        if (summary.deltas) {
          var bestDelta = null, bestField = "";
          for (var key in summary.deltas) {
            if (!Object.prototype.hasOwnProperty.call(summary.deltas, key)) continue;
            var d = summary.deltas[key];
            if (d.abs !== 0 && (!bestDelta || Math.abs(d.pct) > Math.abs(bestDelta.pct))) {
              bestDelta = d;
              bestField = key;
            }
          }
          if (bestDelta) {
            lines.push(zh
              ? ("æœ€å¤§å·®å¼‚åœ¨ " + metricLabel(bestField) + "ï¼š" + escapeHtml(bestDelta.better) + " é¢†å…ˆ " + (bestDelta.pct > 0 ? "+" : "") + bestDelta.pct.toFixed(1) + "%")
              : ("Biggest gap in " + metricLabel(bestField) + ": " + escapeHtml(bestDelta.better) + " leads by " + (bestDelta.pct > 0 ? "+" : "") + bestDelta.pct.toFixed(1) + "%"));
          }
        }
        if (summary.notFound) {
          lines.push(zh ? "æœªæ‰¾åˆ°ä»¥ä¸‹å•†æˆ·: " + escapeHtml(summary.notFound.join(", ")) : "Not found: " + escapeHtml(summary.notFound.join(", ")));
        }
      }
    } else if (summary.type === "trend") {
      if (summary.target) {
        lines.push(zh ? (escapeHtml(summary.target) + " è¶‹åŠ¿åˆ†æï¼š") : (escapeHtml(summary.target) + " trend analysis:"));
      }
      if (summary.months && summary.months.length >= 2) {
        var firstMonth = summary.months[0];
        var lastMonth = summary.months[summary.months.length - 1];
        lines.push(zh
          ? ("ä» " + escapeHtml(firstMonth.month) + " åˆ°×OwïOÊ×¬¢h­µçHÛÛœİ˜]ÈHİš[™Ê˜[YHˆŠKš[J
NÂˆYˆ
\˜]ÊH™]\›ˆ•[YH›İ™XÛÜ™YÂˆÛÛœİ\œÙYH™]È]J˜]Ëš[˜ÛY\Ê•ŠHÈ˜]Èˆ˜]Ëœ™\XÙJˆ‹•ŠJNÂˆYˆ
[X™\‹š\Ó˜SŠ\œÙY™Ù][YJ
JJH™]\›ˆ˜]ÎÂˆ™]\›ˆ\œÙYÓØØ[Tİš[™Ê[™Yš[™YÂˆYX\ˆ›[Y\šXÈ‹ˆ[ÛˆœÚÜ‹ˆ^Nˆ›[Y\šXÈ‹ˆİ\ˆŒ‹YYÚ]‹ˆZ[]NˆŒ‹YYÚ]‚ˆJNÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\ŒPY][ÛœÊ
HÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆÛÛœİY][ÛœÈHX[˜YÙ[Y[˜Y][ÛœÈ×NÂˆYˆ
[ËY\ŒPY][ÛœĞÛİ[
H[ËY\ŒPY][ÛœĞÛİ[^ÛÛ[HY][ÛœË›[™İÓØØ[Tİš[™Ê
NÂˆYˆ
[ËY\ŒPY][ÛœÕÙÙÛJHÂˆ[ËY\ŒPY][ÛœÕÙÙÛKœÙ]]šX]J˜\šXKY^[™Y‹X[˜YÙ[Y[œ[™[Ü[ˆÈYHˆˆ™˜[ÙHŠNÂˆBˆYˆ
[ËY\ŒPY][ÛœÔ[™[
HÂˆ[ËY\ŒPY][ÛœÔ[™[˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[X[˜YÙ[Y[œ[™[Ü[ŠNÂˆBˆØİ[Y[™Øİ[Y[[[Y[˜Û\ÜÓ\İÙÙÛJY\ŒKXY][ÛœË[Ü[ˆ‹X[˜YÙ[Y[œ[™[Ü[ŠNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İÙÙÛJY\ŒKXY][ÛœË[Ü[ˆ‹X[˜YÙ[Y[œ[™[Ü[ŠNÂˆYˆ
[ËY\ŒPY][ÛœÔİ]\ÊHÂˆ[ËY\ŒPY][ÛœÔİ]\Ë˜Û\ÜÓ\İÙÙÛJ™\œ›Üˆ‹›ÛÛX[ŠX[˜YÙ[Y[˜Y][ÛœÑ\œ›ÜŠJNÂˆ[ËY\ŒPY][ÛœÔİ]\Ë^ÛÛ[HX[˜YÙ[Y[˜Y][ÛœÓØY[™ÂˆÈ“ØY[™ÈYYY\˜Ú[Ë‹‹ˆ‚ˆˆX[˜YÙ[Y[˜Y][ÛœÑ\œ›ÜÂˆBˆYˆ
Y[ËY\ŒPY][ÛœÓ\İ
H™]\›ÂˆYˆ
X[˜YÙ[Y[˜Y][ÛœÓØY[™È	‰ˆ[X[˜YÙ[Y[˜Y][ÛœÓØYY
HÂˆ[ËY\ŒPY][ÛœÓ\İš[›™\’SH]ˆÛ\ÜÏHY\ŒKXY][ÛœËY[\H“ØY[™ÈHY\ˆHY][Ûˆ\İÜK‹‹Ù]˜Âˆ™]\›ÂˆBˆYˆ
XY][ÛœË›[™İ
HÂˆÛÛœİ[\SY\ÜØYÙHHX[˜YÙ[Y[˜Y][ÛœÑ\œ›Ü‚ˆÈ“ZYÜ˜][Ûˆ\İÜH\È[˜]˜Z[X›H[[H]X˜\ÙHÛÛ›™Xİ[Ûˆ\È™\İÜ™Yˆ‚ˆˆ“›ÈY\˜Ú[È]™H™Y[ˆYY›İYÚ\ÈÛÛY]ˆÂˆ[ËY\ŒPY][ÛœÓ\İš[›™\’SH]ˆÛ\ÜÏHY\ŒKXY][ÛœËY[\H‰Ù\ØØ\R[
[\SY\ÜØYÙJ_OÙ]˜Âˆ™]\›ÂˆBˆ[ËY\ŒPY][ÛœÓ\İš[›™\’SHY][ÛœË›X\

][JHOˆÂˆÛÛœİ[İ™[Y[H][Kœ™]š[İ\ÕY\ˆÈ	Ú][Kœ™]š[İ\ÕY\ŸHÈY\ˆXˆ“™]ÈY\ˆH\ÜÚYÛ›Y[ÂˆÛÛœİYYHH][K˜YYHÈYYH	Ú][K˜YY_XˆYY›İYÚÙ™™\ˆ[[YÙ[˜ÙHÂˆÛÛœİİ\œ™[Y\ˆH][K˜İ\œ™[Y\ˆ	‰ˆ][K˜İ\œ™[Y\ˆOOH•Y\ˆH‚ˆÈÈİ\œ™[Y\ˆ	Ú][K˜İ\œ™[Y\ŸXˆˆˆÂˆ™]\›ˆ\XÛHÛ\ÜÏHY\ŒKXY][Û‹\›İÈ‚ˆİ›Û™Ï‰Ù\ØØ\R[
][K›Y\˜Ú[˜[YH][K›Y\˜Ú[Y•[šÛ›İÛˆY\˜Ú[Š_OÛX[’Q	Ù\ØØ\R[
][K›Y\˜Ú[Y‹HŠ_OÜÛX[Üİ›Û™Ï‚ˆÜ[‰Ù\ØØ\R[
][K›™]ÛÜšÈ•[šÛ›İÛˆŠ_OÜÜ[‚ˆÜ[ˆÛ\ÜÏHY\ŒKXY][Û‹[Y]H‰Ù\ØØ\R[
[İ™[Y[
_IÙ\ØØ\R[
İ\œ™[Y\Š_Oœ‰Ù\ØØ\R[
›Ü›X]Y\ŒPYY]
][K˜YY]
J_HÈ	Ù\ØØ\R[
YYJ_OÜÜ[‚ˆØ\XÛO˜ÂˆJKš›Ú[ŠˆŠNÂˆB‚ˆ[˜İ[ÛˆÜ[•Y\ŒPY][ÛœÓİ™\›^J
HÂˆYˆ
İ]KœÙ[XİYY\”YÙHOOH•Y\ˆHˆY[ËY\ŒPY][ÛœÔ[™[
H™]\›ÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆX[˜YÙ[Y[˜Y][ÛœÔ™\İÜ™Q›Øİ\ÈHØİ[Y[˜Xİ]™Q[[Y[ÂˆX[˜YÙ[Y[œ[™[Ü[ˆHYNÂˆ™[™\•Y\ŒPY][ÛœÊ
NÂˆØYY\ŒPY][ÛœÊÈ›Ü˜ÙNˆ›ÛÛX[ŠX[˜YÙ[Y[˜Y][ÛœÑ\œ›ÜŠHJNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
[ËY\ŒPY][ÛœĞÛÜÙJH[ËY\ŒPY][ÛœĞÛÜÙK™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[ÛˆÛÜÙUY\ŒPY][ÛœÓİ™\›^JÈ™\İÜ™Q›Øİ\ÈHYHHHßJHÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆX[˜YÙ[Y[œ[™[Ü[ˆH˜[ÙNÂˆ™[™\•Y\ŒPY][ÛœÊ
NÂˆYˆ
ˆ™\İÜ™Q›Øİ\Âˆ	‰ˆX[˜YÙ[Y[˜Y][ÛœÔ™\İÜ™Q›Øİ\Âˆ	‰ˆ\[ÙˆX[˜YÙ[Y[˜Y][ÛœÔ™\İÜ™Q›Øİ\Ë™›Øİ\ÈOOH™[˜İ[Ûˆ‚ˆ
HÂˆX[˜YÙ[Y[˜Y][ÛœÔ™\İÜ™Q›Øİ\Ë™›Øİ\Ê
NÂˆBˆB‚ˆ\Ş[˜È[˜İ[ÛˆØYY\ŒPY][ÛœÊÈ›Ü˜ÙHH˜[ÙHHHßJHÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆYˆ
X[˜YÙ[Y[˜Y][ÛœÓØY[™È
X[˜YÙ[Y[˜Y][ÛœÓØYY	‰ˆY›Ü˜ÙJJH™]\›ÂˆX[˜YÙ[Y[˜Y][ÛœÓØY[™ÈHYNÂˆX[˜YÙ[Y[˜Y][ÛœÑ\œ›ÜˆHˆÂˆ™[™\•Y\ŒPY][ÛœÊ
NÂˆHÂˆÛÛœİ\˜[\ÈH™]ÈT“ÙX\˜Ú\˜[\ÊÈXİ[Ûˆ˜Y][ÛœÈ‹[Z]ˆŒLˆJNÂˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
	Ñ—ÕQTŒWÓQTÒS•×ÕRWĞT_OÉÜ\˜[\ËÔİš[™Ê
_XÂˆØXÚNˆ››Ë\İÜ™H‹ˆÜ™Y[X[ÎˆœØ[YK[ÜšYÚ[ˆ‚ˆJNÂˆÛÛœİ^[ØYH]ØZ]™\ÜÛœÙKšœÛÛŠ
K˜Ø]Ú


HOˆ
ßJJNÂˆYˆ
\™\ÜÛœÙK›ÚÈ^[ØY›ÚÈOOH˜[ÙJHÂˆ›İÈ™]È\œ›ÜŠ^[ØY™\œ›ÜˆÛİ[›İØYYYY\˜Ú[È
	Ü™\ÜÛœÙKœİ]\ßJX
NÂˆBˆX[˜YÙ[Y[˜Y][ÛœÈH\œ˜^Kš\Ğ\œ˜^J^[ØY˜Y][ÛœÊHÈ^[ØY˜Y][ÛœÈˆ×NÂˆX[˜YÙ[Y[˜Y][ÛœÓØYYHYNÂˆHØ]Ú
\œ›ÜŠHÂˆX[˜YÙ[Y[˜Y][ÛœÑ\œ›ÜˆH\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠNÂˆHš[˜[HÂˆX[˜YÙ[Y[˜Y][ÛœÓØY[™ÈH˜[ÙNÂˆ™[™\•Y\ŒPY][ÛœÊ
NÂˆBˆB‚ˆ[˜İ[Ûˆ™[™\•Y\ŒSX[˜YÙ[Y[
Y\“˜[YJHÂˆÛÛœİ\ÕY\ŒHHY\“˜[YHOOH•Y\ˆHÂˆYˆ
[ËY\ŒSX[˜YÙ[Y[Xİ[ÛœÊH[ËY\ŒSX[˜YÙ[Y[Xİ[ÛœË˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ÕY\ŒJNÂˆYˆ
Z\ÕY\ŒJHÂˆİ]KY\ŒSX[˜YÙ[Y[œ[™[Ü[ˆH˜[ÙNÂˆH[ÙHYˆ
\İ]KY\ŒSX[˜YÙ[Y[˜Y][ÛœÓØYY	‰ˆ\İ]KY\ŒSX[˜YÙ[Y[˜Y][ÛœÓØY[™ÊHÂˆØYY\ŒPY][ÛœÊ
NÂˆBˆ™[™\•Y\ŒPY][ÛœÊ
NÂˆB‚ˆ[˜İ[Ûˆ˜\Y\ŒPY][ÛœÓİ™\›^Q›Øİ\Ê]™[
HÂˆYˆ
ˆ]™[šÙ^HOOH•Xˆ‚ˆY[ËY\ŒPY][ÛœÔ[™[ˆ[ËY\ŒPY][ÛœÔ[™[˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
H™]\›ˆ˜[ÙNÂˆÛÛœİ›Øİ\ØX›HH\œ˜^K™œ›ÛJ[ËY\ŒPY][ÛœÔ[™[œ]Y\TÙ[XİÜ[
ˆ˜]Û››İ
Ù\ØX›YJK[œ]››İ
Ù\ØX›YJKÙ[Xİ››İ
Ù\ØX›YJKİXš[™^N››İ
İXš[™^IËLI×JH‚ˆ
JK™š[\Š
[[Y[
HOˆY[[Y[˜ÛÜÙ\İ
‹šY[ˆŠJNÂˆYˆ
Y›Øİ\ØX›K›[™İ
H™]\›ˆ˜[ÙNÂˆÛÛœİš\œİH›Øİ\ØX›VÌNÂˆÛÛœİ\İH›Øİ\ØX›VÙ›Øİ\ØX›K›[™İHWNÂˆYˆ
]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOHš\œİ
HÂˆ]™[œ™]™[Y˜][

NÂˆ\İ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆYˆ
Y]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOH\İ
HÂˆ]™[œ™]™[Y˜][

NÂˆš\œİ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆ™]\›ˆ˜[ÙNÂˆB‚ˆ[˜İ[ÛˆÙ]Y\ŒSY\˜Ú[İ]\ÊY\ÜØYÙK\HHˆŠHÂˆYˆ
Y[ËY\ŒSY\˜Ú[İ]\ÊH™]\›Âˆ[ËY\ŒSY\˜Ú[İ]\Ë^ÛÛ[HY\ÜØYÙHˆÂˆ[ËY\ŒSY\˜Ú[İ]\Ë˜Û\ÜÓ\İÙÙÛJ™\œ›Üˆ‹\HOOH™\œ›ÜˆŠNÂˆ[ËY\ŒSY\˜Ú[İ]\Ë˜Û\ÜÓ\İÙÙÛJœİXØÙ\ÜÈ‹\HOOHœİXØÙ\ÜÈŠNÂˆB‚ˆ[˜İ[Ûˆ™\Ù]Y\ŒSY\˜Ú[X[ÙÊ
HÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆX[˜YÙ[Y[œ]Y\HHˆÂˆX[˜YÙ[Y[œ™\İ[ÈH×NÂˆX[˜YÙ[Y[œÙ[XİYY\˜Ú[H[ÂˆX[˜YÙ[Y[œÙX\˜ÚØY[™ÈH˜[ÙNÂˆX[˜YÙ[Y[œİX›Z][™ÈH˜[ÙNÂˆX[˜YÙ[Y[œÙX\˜ÚÙ\]Y[˜ÙH
ÏHNÂˆYˆ
[ËY\ŒSY\˜Ú[]Y\JH[ËY\ŒSY\˜Ú[]Y\K˜[YHHˆÂˆYˆ
[ËY\ŒSY\˜Ú[ÙX\˜Ú›Ü›JH[ËY\ŒSY\˜Ú[ÙX\˜Ú›Ü›K˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›X][ÛŠH[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û‹˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[™\İ[ÊHÂˆ[ËY\ŒSY\˜Ú[™\İ[Ë˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆ[ËY\ŒSY\˜Ú[™\İ[Ëš[›™\’SHˆÂˆBˆYˆ
[ËY\ŒSY\˜Ú[ÙX\˜Ú]ÛŠHÂˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú]Û‹™\ØX›YH˜[ÙNÂˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú]Û‹^ÛÛ[H‘š[™Y\˜Ú[ÂˆBˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›JHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K™\ØX›YHYNÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K^ÛÛ[HYÈY\ˆHÂˆBˆYˆ
[ËY\ŒSY\˜Ú[Ø[˜Ù[
H[ËY\ŒSY\˜Ú[Ø[˜Ù[^ÛÛ[HØ[˜Ù[ÂˆÙ]Y\ŒSY\˜Ú[İ]\ÊˆŠNÂˆB‚ˆ[˜İ[ÛˆÜ[•Y\ŒSY\˜Ú[X[ÙÊ
HÂˆYˆ
İ]KœÙ[XİYY\”YÙHOOH•Y\ˆHˆY[ËY\ŒSY\˜Ú[X[ÙÊH™]\›Âˆİ]KY\ŒSX[˜YÙ[Y[œ™\İÜ™Q›Øİ\ÈHØİ[Y[˜Xİ]™Q[[Y[Âˆ™\Ù]Y\ŒSY\˜Ú[X[ÙÊ
NÂˆ[ËY\ŒSY\˜Ú[X[ÙË˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İ˜Y
Y\ŒK[Y\˜Ú[[Ü[ˆŠNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
[ËY\ŒSY\˜Ú[]Y\JH[ËY\ŒSY\˜Ú[]Y\K™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[ÛˆÛÜÙUY\ŒSY\˜Ú[X[ÙÊÈ™\İÜ™Q›Øİ\ÈHYHHHßJHÂˆYˆ
Y[ËY\ŒSY\˜Ú[X[ÙÊH™]\›Âˆİ]KY\ŒSX[˜YÙ[Y[œÙX\˜ÚÙ\]Y[˜ÙH
ÏHNÂˆ[ËY\ŒSY\˜Ú[X[ÙË˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İœ™[[İ™JY\ŒK[Y\˜Ú[[Ü[ˆŠNÂˆYˆ
ˆ™\İÜ™Q›Øİ\Âˆ	‰ˆİ]KY\ŒSX[˜YÙ[Y[œ™\İÜ™Q›Øİ\Âˆ	‰ˆ\[Ùˆİ]KY\ŒSX[˜YÙ[Y[œ™\İÜ™Q›Øİ\Ë™›Øİ\ÈOOH™[˜İ[Ûˆ‚ˆ
HÂˆİ]KY\ŒSX[˜YÙ[Y[œ™\İÜ™Q›Øİ\Ë™›Øİ\Ê
NÂˆBˆB‚ˆ[˜İ[Ûˆ™[™\•Y\ŒSY\˜Ú[™\İ[Ê
HÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆYˆ
Y[ËY\ŒSY\˜Ú[™\İ[ÊH™]\›ÂˆYˆ
X[˜YÙ[Y[œÙX\˜ÚØY[™ÊHÂˆ[ËY\ŒSY\˜Ú[™\İ[Ëš[›™\’SH]ˆÛ\ÜÏHY\ŒK\™\İ[\ÚÙ[]ÛˆÙ]]ˆÛ\ÜÏHY\ŒK\™\İ[\ÚÙ[]ÛˆÙ]]ˆÛ\ÜÏHY\ŒK\™\İ[\ÚÙ[]ÛˆÙ]˜Âˆ™]\›ÂˆBˆ[ËY\ŒSY\˜Ú[™\İ[Ëš[›™\’SHX[˜YÙ[Y[œ™\İ[Ë›X\

Y\˜Ú[
HOˆÂˆÛÛœİİ\œ™[Y\ˆHY\˜Ú[˜İ\œ™[Y\ˆ“›İ\ÜÚYÛ™YÂˆÛÛœİ[™XYUY\ŒHHİ\œ™[Y\ˆOOH•Y\ˆHÂˆÛÛœİÛÛ^HÛY\˜Ú[˜Ø]YÛÜKY\˜Ú[˜Ûİ[WK™š[\Š›ÛÛX[ŠKš›Ú[ŠˆÈŠH“›ÈØ]YÛÜH]Z[ÈÂˆ™]\›ˆ]Û‚ˆÛ\ÜÏHY\ŒK[Y\˜Ú[\™\İ[‚ˆ\OH˜]Ûˆ‚ˆ›ÛOH›Ü[Ûˆ‚ˆ]K]Y\ŒK[Y\˜Ú[ZYH‰Ù\ØØ\R[
Y\˜Ú[›Y\˜Ú[YˆŠ_H‚ˆ\šXK[X™[H‰Ù\ØØ\R[
[™XYUY\ŒHÈ	ÛY\˜Ú[›Y\˜Ú[˜[YHY\˜Ú[›Y\˜Ú[YH\È[™XYH[ˆY\ˆXˆ™]šY]È	ÛY\˜Ú[›Y\˜Ú[˜[YHY\˜Ú[›Y\˜Ú[YX
_H‚ˆ	Ø[™XYUY\ŒHÈ™\ØX›YˆˆˆŸBˆ‚ˆİ›Û™Ï‰Ù\ØØ\R[
Y\˜Ú[›Y\˜Ú[˜[YH•[›˜[YYY\˜Ú[Š_OÛX[’Q	Ù\ØØ\R[
Y\˜Ú[›Y\˜Ú[Y‹HŠ_OÜÛX[Üİ›Û™Ï‚ˆÜ[‰Ù\ØØ\R[
Y\˜Ú[›™]ÛÜšÈ•[šÛ›İÛˆŠ_OÜÜ[‚ˆÜ[‰Ù\ØØ\R[
İ\œ™[Y\Š_OÜÜ[‚ˆÜ[ˆÛ\ÜÏHY\ŒK\™\İ[XXİ[Ûˆ‰Ø[™XYUY\ŒHÈ[™XYH[ˆY\ˆHˆˆ”™]šY]ÈX]ÚŸOÜÜ[‚ˆÜ[ˆÛ\ÜÏHšY[ˆ‰Ù\ØØ\R[
ÛÛ^
_OÜÜ[‚ˆØ]Û˜ÂˆJKš›Ú[ŠˆŠNÂˆB‚ˆ[˜İ[ÛˆÙ[XİY\ŒSY\˜Ú[
Y\˜Ú[Y
HÂˆÛÛœİY\˜Ú[Hİ]KY\ŒSX[˜YÙ[Y[œ™\İ[Ë™š[™

][JHOˆİš[™Ê][K›Y\˜Ú[YˆŠHOOHİš[™ÊY\˜Ú[YˆŠJNÂˆYˆ
[Y\˜Ú[
H™]\›Âˆİ]KY\ŒSX[˜YÙ[Y[œÙ[XİYY\˜Ú[HY\˜Ú[ÂˆYˆ
[ËY\ŒSY\˜Ú[ÙX\˜Ú›Ü›JH[ËY\ŒSY\˜Ú[ÙX\˜Ú›Ü›K˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[™\İ[ÊH[ËY\ŒSY\˜Ú[™\İ[Ë˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›X][ÛŠH[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û‹˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆYˆ
[ËY\ŒTÙ[XİYY\˜Ú[˜[YJH[ËY\ŒTÙ[XİYY\˜Ú[˜[YK^ÛÛ[HY\˜Ú[›Y\˜Ú[˜[YH•[›˜[YYY\˜Ú[ÂˆYˆ
[ËY\ŒTÙ[XİYY\˜Ú[Y
H[ËY\ŒTÙ[XİYY\˜Ú[Y^ÛÛ[HY\˜Ú[›Y\˜Ú[Y‹HÂˆYˆ
[ËY\ŒTÙ[XİYY\˜Ú[™]ÛÜšÊH[ËY\ŒTÙ[XİYY\˜Ú[™]ÛÜšË^ÛÛ[HY\˜Ú[›™]ÛÜšÈ•[šÛ›İÛˆÂˆYˆ
[ËY\ŒTÙ[XİYY\˜Ú[Y\ŠH[ËY\ŒTÙ[XİYY\˜Ú[Y\‹^ÛÛ[HY\˜Ú[˜İ\œ™[Y\ˆ“›İ\ÜÚYÛ™YÂˆYˆ
[ËY\ŒTÙ[XİYY\˜Ú[ÛÛ^
HÂˆ[ËY\ŒTÙ[XİYY\˜Ú[ÛÛ^^ÛÛ[HÛY\˜Ú[˜Ø]YÛÜKY\˜Ú[˜Ûİ[WK™š[\Š›ÛÛX[ŠKš›Ú[ŠˆÈŠH“›İ]˜Z[X›HÂˆBˆÛÛœİİ\œ™[Y\ˆHY\˜Ú[˜İ\œ™[Y\ˆˆÂˆÛÛœİ[™XYUY\ŒHHİ\œ™[Y\ˆOOH•Y\ˆHÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙJHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK˜Û\ÜÓ˜[YHHY\ŒKXÛÛ™š\›X][Û‹[›İXÙHÂˆYˆ
[™XYUY\ŒJHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK˜Û\ÜÓ\İ˜Y
˜›ØÚÙYŠNÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK^ÛÛ[H•\ÈY\˜Ú[\È[™XYH\ÜÚYÛ™YÈY\ˆKˆ›ÈÚ[™ÙHÚ[™HXYKˆÂˆH[ÙHYˆ
İ\œ™[Y\ŠHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK˜Û\ÜÓ\İ˜Y
Ø\›š[™ÈŠNÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK^ÛÛ[HÛÛ™š\›Z[™ÈÚ[[İ™H\ÈY\˜Ú[œ›ÛH	Øİ\œ™[Y\ŸHÈY\ˆK˜ÂˆH[ÙHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK^ÛÛ[HÛÛ™š\›Z[™ÈÚ[Ü™X]HHY\ˆH\ÜÚYÛ›Y[›Üˆ\ÈY\˜Ú[ˆÂˆBˆBˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›JH[ËY\ŒSY\˜Ú[ÛÛ™š\›K™\ØX›YH[™XYUY\ŒNÂˆÙ]Y\ŒSY\˜Ú[İ]\ÊˆŠNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
[™XYUY\ŒH	‰ˆ[ËY\ŒSY\˜Ú[˜XÚÊH[ËY\ŒSY\˜Ú[˜XÚË™›Øİ\Ê
NÂˆ[ÙHYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›JH[ËY\ŒSY\˜Ú[ÛÛ™š\›K™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[ÛˆÚİÕY\ŒSY\˜Ú[ÙX\˜Ú

HÂˆİ]KY\ŒSX[˜YÙ[Y[œÙ[XİYY\˜Ú[H[ÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›X][ÛŠH[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û‹˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[ÙX\˜Ú›Ü›JH[ËY\ŒSY\˜Ú[ÙX\˜Ú›Ü›K˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[™\İ[ÊH[ËY\ŒSY\˜Ú[™\İ[Ë˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›JH[ËY\ŒSY\˜Ú[ÛÛ™š\›K™\ØX›YHYNÂˆÙ]Y\ŒSY\˜Ú[İ]\ÊˆŠNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
[ËY\ŒSY\˜Ú[]Y\JH[ËY\ŒSY\˜Ú[]Y\K™›Øİ\Ê
NÂˆJNÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆÙX\˜ÚY\ŒSY\˜Ú[Ê
HÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆÛÛœİ]Y\HHİš[™Ê[ËY\ŒSY\˜Ú[]Y\H	‰ˆ[ËY\ŒSY\˜Ú[]Y\K˜[YHˆŠKš[J
NÂˆYˆ
]Y\K›[™İŠHÂˆÙ]Y\ŒSY\˜Ú[İ]\Ê‘[\ˆ]X\İˆÚ\˜Xİ\œÈÜˆH[Y\˜Ú[Qˆ‹™\œ›ÜˆŠNÂˆYˆ
[ËY\ŒSY\˜Ú[]Y\JH[ËY\ŒSY\˜Ú[]Y\K™›Øİ\Ê
NÂˆ™]\›ÂˆBˆX[˜YÙ[Y[œ]Y\HH]Y\NÂˆX[˜YÙ[Y[œÙ[XİYY\˜Ú[H[ÂˆX[˜YÙ[Y[œÙX\˜ÚØY[™ÈHYNÂˆX[˜YÙ[Y[œ™\İ[ÈH×NÂˆÛÛœİÙ\]Y[˜ÙHH
ÊÛX[˜YÙ[Y[œÙX\˜ÚÙ\]Y[˜ÙNÂˆYˆ
[ËY\ŒSY\˜Ú[ÙX\˜Ú]ÛŠHÂˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú]Û‹™\ØX›YHYNÂˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú]Û‹^ÛÛ[H”ÙX\˜Ú[™Ë‹‹ˆÂˆBˆÙ]Y\ŒSY\˜Ú[İ]\Ê”ÙX\˜Ú[™ÈHYXZ›Û[ÜÈ]X˜\ÙK‹‹ˆŠNÂˆ™[™\•Y\ŒSY\˜Ú[™\İ[Ê
NÂˆHÂˆÛÛœİ\˜[\ÈH™]ÈT“ÙX\˜Ú\˜[\ÊÈXİ[ÛˆœÙX\˜Ú‹Nˆ]Y\K[Z]ˆŒLˆJNÂˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
	Ñ—ÕQTŒWÓQTÒS•×ÕRWĞT_OÉÜ\˜[\ËÔİš[™Ê
_XÂˆØXÚNˆ››Ë\İÜ™H‹ˆÜ™Y[X[ÎˆœØ[YK[ÜšYÚ[ˆ‚ˆJNÂˆÛÛœİ^[ØYH]ØZ]™\ÜÛœÙKšœÛÛŠ
K˜Ø]Ú


HOˆ
ßJJNÂˆYˆ
\™\ÜÛœÙK›ÚÈ^[ØY›ÚÈOOH˜[ÙJHÂˆ›İÈ™]È\œ›ÜŠ^[ØY™\œ›ÜˆÙX\˜Ú˜Z[Y
	Ü™\ÜÛœÙKœİ]\ßJX
NÂˆBˆYˆ
Ù\]Y[˜ÙHOOHX[˜YÙ[Y[œÙX\˜ÚÙ\]Y[˜ÙJH™]\›ÂˆX[˜YÙ[Y[œ™\İ[ÈH\œ˜^Kš\Ğ\œ˜^J^[ØYœ™\İ[ÊHÈ^[ØYœ™\İ[Èˆ×NÂˆX[˜YÙ[Y[œÙX\˜ÚØY[™ÈH˜[ÙNÂˆ™[™\•Y\ŒSY\˜Ú[™\İ[Ê
NÂˆYˆ
[X[˜YÙ[Y[œ™\İ[Ë›[™İ
HÂˆÙ]Y\ŒSY\˜Ú[İ]\Ê“›ÈXİ]™HY\˜Ú[ÈX]ÚY]QÜˆ˜[YKˆ‹™\œ›ÜˆŠNÂˆ™]\›ÂˆBˆÙ]Y\ŒSY\˜Ú[İ]\Ê	ÛX[˜YÙ[Y[œ™\İ[Ë›[™İÓØØ[Tİš[™Ê
_HY\˜Ú[X]Ú	ÛX[˜YÙ[Y[œ™\İ[Ë›[™İOOHHÈˆˆˆ™\ÈŸH›İ[™ˆÙ[XİÛ™HÈ™]šY]Ë˜
NÂˆÛÛœİ^XİYX]ÚH×—
ÉË\İ
]Y\JBˆÈX[˜YÙ[Y[œ™\İ[Ë™š[™

][JHOˆİš[™Ê][K›Y\˜Ú[YˆŠHOOH]Y\JBˆˆ[ÂˆYˆ
^XİYX]Ú
HÙ[XİY\ŒSY\˜Ú[
^XİYX]Ú›Y\˜Ú[Y
NÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
Ù\]Y[˜ÙHOOHX[˜YÙ[Y[œÙX\˜ÚÙ\]Y[˜ÙJH™]\›ÂˆX[˜YÙ[Y[œÙX\˜ÚØY[™ÈH˜[ÙNÂˆX[˜YÙ[Y[œ™\İ[ÈH×NÂˆ™[™\•Y\ŒSY\˜Ú[™\İ[Ê
NÂˆÙ]Y\ŒSY\˜Ú[İ]\Ê\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠK™\œ›ÜˆŠNÂˆHš[˜[HÂˆYˆ
Ù\]Y[˜ÙHOOHX[˜YÙ[Y[œÙX\˜ÚÙ\]Y[˜ÙH	‰ˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú]ÛŠHÂˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú]Û‹™\ØX›YH˜[ÙNÂˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú]Û‹^ÛÛ[H‘š[™Y\˜Ú[ÂˆBˆBˆB‚ˆ\Ş[˜È[˜İ[Ûˆ™Yœ™\ÚY\ŒT™\ÜY\Y

HÂˆİ]KY\”™\Üœ^[ØYË˜ÛX\Š
NÂˆİ]KY\”™\Ü˜Xİ]™RÙ^\Ë˜ÛX\Š
NÂˆİ]KY\”™\Ü™\œ›ÜœË˜ÛX\Š
NÂˆ]ØZ]ØYY\”™\Ü
•Y\ˆH‹İ]KY\”™\Üœİ\]Kİ]KY\”™\Ü™[™]JNÂˆYˆ
İ]KœYÙHOOHY\ˆˆ	‰ˆİ]KœÙ[XİYY\”YÙHOOH•Y\ˆHŠH™[™\•Y\”YÙJ•Y\ˆHŠNÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆÛÛ™š\›UY\ŒSY\˜Ú[Y

HÂˆÛÛœİX[˜YÙ[Y[Hİ]KY\ŒSX[˜YÙ[Y[ÂˆÛÛœİY\˜Ú[HX[˜YÙ[Y[œÙ[XİYY\˜Ú[ÂˆYˆ
[Y\˜Ú[Y\˜Ú[˜İ\œ™[Y\ˆOOH•Y\ˆHˆX[˜YÙ[Y[œİX›Z][™ÊH™]\›ÂˆX[˜YÙ[Y[œİX›Z][™ÈHYNÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›JHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K™\ØX›YHYNÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K^ÛÛ[HY[™Ë‹‹ˆÂˆBˆÙ]Y\ŒSY\˜Ú[İ]\Ê”Ø]š[™ÈHY\ˆH\ÜÚYÛ›Y[‹‹ˆŠNÂˆHÂˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
—ÕQTŒWÓQTÒS•×ÕRWĞTKÂˆY]Ùˆ”ÔÕ‹ˆXY\œÎˆÈÛÛ[U\Hˆ˜\XØ][Û‹ÚœÛÛÈÚ\œÙ]]]‹NˆKˆÜ™Y[X[ÎˆœØ[YK[ÜšYÚ[ˆ‹ˆ›ÙNˆ”ÓÓ‹œİš[™ÚYJÂˆY\˜Ú[YˆY\˜Ú[›Y\˜Ú[Yˆ^XİYY\ˆY\˜Ú[˜İ\œ™[Y\ˆˆ‚ˆJBˆJNÂˆÛÛœİ^[ØYH]ØZ]™\ÜÛœÙKšœÛÛŠ
K˜Ø]Ú


HOˆ
ßJJNÂˆYˆ
\™\ÜÛœÙK›ÚÈ^[ØY›ÚÈOOH˜[ÙJHÂˆÛÛœİ\œ›ÜˆH™]È\œ›ÜŠ^[ØY™\œ›ÜˆÛİ[›İYY\˜Ú[
	Ü™\ÜÛœÙKœİ]\ßJX
NÂˆ\œ›Ü‹œ^[ØYH^[ØYÂˆ›İÈ\œ›ÜÂˆBˆYˆ
\œ˜^Kš\Ğ\œ˜^J^[ØY˜Y][ÛœÊJHÂˆX[˜YÙ[Y[˜Y][ÛœÈH^[ØY˜Y][ÛœÎÂˆX[˜YÙ[Y[˜Y][ÛœÓØYYHYNÂˆX[˜YÙ[Y[˜Y][ÛœÑ\œ›ÜˆHˆÂˆ™[™\•Y\ŒPY][ÛœÊ
NÂˆBˆÛÛœİÛÛ™š\›YYY\˜Ú[HÂˆ‹‹›Y\˜Ú[ˆ‹‹Š^[ØY›Y\˜Ú[ßJKˆİ\œ™[Y\ˆ•Y\ˆH‚ˆNÂˆX[˜YÙ[Y[œ™\İ[ÈHX[˜YÙ[Y[œ™\İ[Ë›X\

][JHOˆ
ˆİš[™Ê][K›Y\˜Ú[YˆŠHOOHİš[™ÊÛÛ™š\›YYY\˜Ú[›Y\˜Ú[YˆŠBˆÈÛÛ™š\›YYY\˜Ú[ˆˆ][Bˆ
JNÂˆÙ[XİY\ŒSY\˜Ú[
Y\˜Ú[›Y\˜Ú[Y
NÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙJHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK˜Û\ÜÓ˜[YHHY\ŒKXÛÛ™š\›X][Û‹[›İXÙHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›X][Û“›İXÙK^ÛÛ[HY\˜Ú[˜İ\œ™[Y\‚ˆÈZYÜ˜][Ûˆ™XÛÜ™Yˆ	ÛY\˜Ú[˜İ\œ™[Y\ŸHÈY\ˆK˜ˆˆ•Y\ˆH\ÜÚYÛ›Y[Ü™X]Y[™™XÛÜ™Y[ˆH]X˜\ÙKˆÂˆBˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›JHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K™\ØX›YHYNÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K^ÛÛ[HYYÂˆBˆÛÛœİİXØÙ\ÜÓY\ÜØYÙHHY\˜Ú[˜İ\œ™[Y\‚ˆÈ	ÛY\˜Ú[›Y\˜Ú[˜[YHY\˜Ú[›Y\˜Ú[YHØ\ÈZYÜ˜]Yœ›ÛH	ÛY\˜Ú[˜İ\œ™[Y\ŸHÈY\ˆK˜ˆˆ	ÛY\˜Ú[›Y\˜Ú[˜[YHY\˜Ú[›Y\˜Ú[YHØ\ÈYYÈY\ˆK˜ÂˆÙ]Y\ŒSY\˜Ú[İ]\ÊİXØÙ\ÜÓY\ÜØYÙKœİXØÙ\ÜÈŠNÂˆYˆ
[ËY\ŒSY\˜Ú[Ø[˜Ù[
H[ËY\ŒSY\˜Ú[Ø[˜Ù[^ÛÛ[HÛÜÙHÂˆ]ØZ]™Yœ™\ÚY\ŒT™\ÜY\Y

NÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœİ^[ØYH\œ›Üˆ	‰ˆ\œ›Ü‹œ^[ØYÂˆYˆ
^[ØY	‰ˆ^[ØY›Y\˜Ú[
HÂˆX[˜YÙ[Y[œ™\İ[ÈHX[˜YÙ[Y[œ™\İ[Ë›X\

][JHOˆ
ˆİš[™Ê][K›Y\˜Ú[YˆŠHOOHİš[™Ê^[ØY›Y\˜Ú[›Y\˜Ú[YˆŠBˆÈÈ‹‹š][K‹‹œ^[ØY›Y\˜Ú[Bˆˆ][Bˆ
JNÂˆÚİÕY\ŒSY\˜Ú[ÙX\˜Ú

NÂˆ™[™\•Y\ŒSY\˜Ú[™\İ[Ê
NÂˆBˆÙ]Y\ŒSY\˜Ú[İ]\Ê\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠK™\œ›ÜˆŠNÂˆHš[˜[HÂˆX[˜YÙ[Y[œİX›Z][™ÈH˜[ÙNÂˆYˆ
[ËY\ŒSY\˜Ú[ÛÛ™š\›H	‰ˆX[˜YÙ[Y[œÙ[XİYY\˜Ú[
HÂˆÛÛœİYYHX[˜YÙ[Y[œÙ[XİYY\˜Ú[˜İ\œ™[Y\ˆOOH•Y\ˆHÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K™\ØX›YHYYÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K^ÛÛ[HYYÈYYˆˆYÈY\ˆHÂˆBˆBˆB‚ˆ[˜İ[Ûˆ˜\Y\ŒSY\˜Ú[X[ÙÑ›Øİ\Ê]™[
HÂˆYˆ
ˆ]™[šÙ^HOOH•Xˆ‚ˆY[ËY\ŒSY\˜Ú[X[ÙÂˆ[ËY\ŒSY\˜Ú[X[ÙË˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
H™]\›ˆ˜[ÙNÂˆÛÛœİ›Øİ\ØX›HH\œ˜^K™œ›ÛJ[ËY\ŒSY\˜Ú[X[ÙËœ]Y\TÙ[XİÜ[
ˆ˜]Û››İ
Ù\ØX›YJK[œ]››İ
Ù\ØX›YJKÙ[Xİ››İ
Ù\ØX›YJKİXš[™^N››İ
İXš[™^IËLI×JH‚ˆ
JK™š[\Š
[[Y[
HOˆY[[Y[˜ÛÜÙ\İ
‹šY[ˆŠJNÂˆYˆ
Y›Øİ\ØX›K›[™İ
H™]\›ˆ˜[ÙNÂˆÛÛœİš\œİH›Øİ\ØX›VÌNÂˆÛÛœİ\İH›Øİ\ØX›VÙ›Øİ\ØX›K›[™İHWNÂˆYˆ
]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOHš\œİ
HÂˆ]™[œ™]™[Y˜][

NÂˆ\İ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆYˆ
Y]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOH\İ
HÂˆ]™[œ™]™[Y˜][

NÂˆš\œİ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆ™]\›ˆ˜[ÙNÂˆB‚ˆ[˜İ[ÛˆÛÛ[[“X™[
[™^
HÂˆ]X™[HˆÂˆ]˜[YHH[™^
ÈNÂˆÚ[H
˜[YHˆ
HÂˆÛÛœİ™[XZ[™\ˆH
˜[YHHJH	HÂˆX™[Hİš[™Ë™œ›ÛPÚ\ÛÙJH
È™[XZ[™\ŠH
ÈX™[Âˆ˜[YHHX]™›ÛÜŠ
˜[YHHJHÈŠNÂˆBˆ™]\›ˆX™[ÂˆB‚ˆ[˜İ[ÛˆY\”›İÔÙ[Xİ[Û’Ù^J›İÊHÂˆ™]\›ˆ›İÈ	‰ˆ
›İË—×İY\”›İÒÙ^HY\”›İĞ˜\ÙRÙ^J›İËİ]KœÙ[XİYY\”YÙK
JNÂˆB‚ˆ[˜İ[Ûˆ[™UY\”Ù[Xİ[Û•Õš\ÚX›J
HÂˆÛÛœİš\ÚX›HH™]ÈÙ]
İ]Kš\ÚX›UY\”›İÒÙ^\È×JNÂˆ\œ˜^K™œ›ÛJİ]KœÙ[XİYY\”›İÒÙ^\ÊK™›Ü‘XXÚ

Ù^JHOˆÂˆYˆ
]š\ÚX›Kš\ÊÙ^JJHİ]KœÙ[XİYY\”›İÒÙ^\Ë™[]JÙ^JNÂˆJNÂˆB‚ˆ[˜İ[ÛˆY\”Ù[Xİ[Û’XY\’[

HÂˆ™]\›ˆÛ\ÜÏHY\‹\Ù[XİXÙ[[œ]Û\ÜÏHY\‹\›İËXÚXÚØ›Şˆ\OH˜ÚXÚØ›Şˆ]K]Y\‹\Ù[XİX[\šXK[X™[H”Ù[Xİ[š\ÚX›HY\˜Ú[ÈˆÏİ˜ÂˆB‚ˆ[˜İ[ÛˆY\”Ù[Xİ[ÛÙ[[
›İÊHÂˆÛÛœİÙ^HHY\”›İÔÙ[Xİ[Û’Ù^J›İÊNÂˆÛÛœİÚXÚÙYHİ]KœÙ[XİYY\”›İÒÙ^\Ëš\ÊÙ^JHÈˆÚXÚÙYˆˆˆÂˆÛÛœİY\˜Ú[˜[YHHY\”›İÓY\˜Ú[˜[YJ›İÊHY\”›İÓY\˜Ú[Y
›İÊH›Y\˜Ú[Âˆ™]\›ˆÛ\ÜÏHY\‹\Ù[XİXÙ[[œ]Û\ÜÏHY\‹\›İËXÚXÚØ›Şˆ\OH˜ÚXÚØ›Şˆ]K]Y\‹\Ù[Xİ\›İÏH‰Ù\ØØ\R[
Ù^J_Hˆ\šXK[X™[H”Ù[Xİ	Ù\ØØ\R[
Y\˜Ú[˜[YJ_Hˆ	ØÚXÚÙYHÏİ˜ÂˆB‚ˆ[˜İ[ÛˆÙ]Y\“[İ™Tİ]\ÊY\ÜØYÙJHÂˆİ]KY\“[İ™Tİ]\ÈHY\ÜØYÙHˆÂˆYˆ
[ËY\“[İ™R[›[™Tİ]\ÊH[ËY\“[İ™R[›[™Tİ]\Ë^ÛÛ[Hİ]KY\“[İ™Tİ]\ÎÂˆYˆ
[ËY\“[İ™Tİ]\ÊH[ËY\“[İ™Tİ]\Ë^ÛÛ[Hİ]KY\“[İ™Tİ]\ÎÂˆB‚ˆ[˜İ[ÛˆŞ[˜ÕY\[ĞÛÛ›ÛÊ
HÂˆÛÛœİš\ÚX›RÙ^\ÈHİ]Kš\ÚX›UY\”›İÒÙ^\È×NÂˆÛÛœİš\ÚX›TÙ]H™]ÈÙ]
š\ÚX›RÙ^\ÊNÂˆÛÛœİš\ÚX›TÙ[XİYÛİ[Hš\ÚX›RÙ^\Ë™š[\Š
Ù^JHOˆİ]KœÙ[XİYY\”›İÒÙ^\Ëš\ÊÙ^JJK›[™İÂˆÛÛœİİ[Ù[XİYÛİ[Hİ]KœÙ[XİYY\”›İÒÙ^\ËœÚ^™NÂ‚ˆYˆ
[ËY\“[İ™TÙ[XİY
HÂˆ[ËY\“[İ™TÙ[XİY™\ØX›YHİ[Ù[XİYÛİ[OOHÂˆ[ËY\“[İ™TÙ[XİY^ÛÛ[H
˜Xİ[Û‹›[İ™H‹“[İ™HŠNÂˆ[ËY\“[İ™TÙ[XİYœÙ]]šX]J˜\šXK[X™[‹İ[Ù[XİYÛİ[È[İ™H	İİ[Ù[XİYÛİ[ÓØØ[Tİš[™Ê
_HÙ[XİYY\˜Ú[Øˆ“[İ™HÙ[XİYY\˜Ú[ÈŠNÂˆBˆYˆ
[ËY\”™\Ù][İ™\ÊHÂˆ[ËY\”™\Ù][İ™\Ë˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ÓX[X[Y\“[İ™\Ê
JNÂˆBˆYˆ
[ËY\”ÚY]XY
HÂˆÛÛœİ[ÚXÚØ›ŞH[ËY\”ÚY]XYœ]Y\TÙ[XİÜŠ–Ù]K]Y\‹\Ù[XİX[HŠNÂˆYˆ
[ÚXÚØ›Ş
HÂˆ[ÚXÚØ›Ş˜ÚXÚÙYH›ÛÛX[Šš\ÚX›RÙ^\Ë›[™İ	‰ˆš\ÚX›TÙ[XİYÛİ[OOHš\ÚX›RÙ^\Ë›[™İ
NÂˆ[ÚXÚØ›Şš[™]\›Z[˜]HHš\ÚX›TÙ[XİYÛİ[ˆ	‰ˆš\ÚX›TÙ[XİYÛİ[š\ÚX›RÙ^\Ë›[™İÂˆ[ÚXÚØ›Ş™\ØX›YHš\ÚX›RÙ^\Ë›[™İOOHÂˆBˆBˆYˆ
[ËY\”ÚY]›İÜÊHÂˆ[ËY\”ÚY]›İÜËœ]Y\TÙ[XİÜ[
–Ù]K]Y\‹\Ù[Xİ\›İ×HŠK™›Ü‘XXÚ

ÚXÚØ›Ş
HOˆÂˆÛÛœİÙ^HHÚXÚØ›Ş™]\Ù]Y\”Ù[Xİ›İÈˆÂˆÚXÚØ›Ş˜ÚXÚÙYHİ]KœÙ[XİYY\”›İÒÙ^\Ëš\ÊÙ^JNÂˆÚXÚØ›Ş™\ØX›YH]š\ÚX›TÙ]š\ÊÙ^JNÂˆJNÂˆBˆB‚ˆ[˜İ[ÛˆY\•X›TYÚ[˜][ÛŠ›İÜËYÙKYÙTÚ^™HHQT—ÕP“WÔQÑWÔÒV‘JHÂˆÛÛœİ[›İÜÈH\œ˜^Kš\Ğ\œ˜^J›İÜÊHÈ›İÜÈˆ×NÂˆÛÛœİØY™TYÙTÚ^™HHX]›X^
K[X™\ŠYÙTÚ^™JHQT—ÕP“WÔQÑWÔÒV‘JNÂˆÛÛœİİ[YÙ\ÈHX]›X^
KX]˜ÙZ[
[›İÜË›[™İÈØY™TYÙTÚ^™JJNÂˆÛÛœİİ\œ™[YÙHHX]›Z[Šİ[YÙ\ËX]›X^
K[X™\ŠYÙJHJJNÂˆÛÛœİİ\[™^H
İ\œ™[YÙHHJH
ˆØY™TYÙTÚ^™NÂˆÛÛœİ[™[™^HX]›Z[Š[›İÜË›[™İİ\[™^
ÈØY™TYÙTÚ^™JNÂˆ™]\›ˆÂˆYÙNˆİ\œ™[YÙKˆYÙTÚ^™NˆØY™TYÙTÚ^™Kˆİ[YÙ\Ëˆİ[›İÜÎˆ[›İÜË›[™İˆİ\[™^ˆ[™[™^ˆ›İÜÎˆ[›İÜËœÛXÙJİ\[™^[™[™^
BˆNÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\”YÚ[˜][ÛŠY\“˜[YKYÚ[˜][ÛŠHÂˆÛÛœİš\ÚX›HHY\“˜[YHOOH•Y\ˆˆ	‰ˆ›ÛÛX[ŠYÚ[˜][ÛŠNÂˆ[ËY\”YÚ[˜][Û‹˜Û\ÜÓ\İÙÙÛJšY[ˆ‹]š\ÚX›JNÂˆYˆ
]š\ÚX›JH™]\›Âˆ[ËY\”YÙR[™XØ]Ü‹^ÛÛ[HYÙH	ÜYÚ[˜][Û‹œYÙKÓØØ[Tİš[™Ê
_HÙˆ	ÜYÚ[˜][Û‹İ[YÙ\ËÓØØ[Tİš[™Ê
_XÂˆ[ËY\”YÙT™]‹™\ØX›YHYÚ[˜][Û‹œYÙHHNÂˆ[ËY\”YÙS™^™\ØX›YHYÚ[˜][Û‹œYÙHHYÚ[˜][Û‹İ[YÙ\ÎÂˆB‚ˆ[˜İ[ÛˆÚ[™ÙUY\•X›TYÙJ[JHÂˆÛÛœİY\“˜[YHHİ]KœÙ[XİYY\”YÙNÂˆYˆ
Y\“˜[YHOOH•Y\ˆŠH™]\›ÂˆÛÛœİİ\œ™[YÙHH[X™\Šİ]KY\•X›TYÙ\ÖİY\“˜[YWJHNÂˆİ]KY\•X›TYÙ\ÖİY\“˜[YWHHX]›X^
Kİ\œ™[YÙH
È[JNÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆÙ]Y\“[İ™Tİ]\ÊˆŠNÂˆ™[™\•Y\”YÙJY\“˜[YJNÂˆB‚ˆ[˜İ[Ûˆ™\Ù]Y\•X›TYÙJY\“˜[YHHİ]KœÙ[XİYY\”YÙJHÂˆİ]KY\•X›TYÙ\ÖİY\“˜[YWHHNÂˆB‚ˆ[˜İ[Ûˆ™[™\”ÚY]X›JÚY]]Q[Ûİ[[XY[›İÜÑ[İ\İÛT›İÜÈH[YÚ[˜][Û“Ü[ÛœÈH[
HÂˆÛÛœİXY\œÈHÚY]šXY\œÈ×NÂˆÛÛœİ[\Ü^RXY\œÈH\Ü^RXY\œÑ›Ü”ÚY]
ÚY]XY\œÊNÂˆÛÛœİ\Ü^RXY\œÈHš\ÚX›RXY\œÑ›Ü”ÚY]
ÚY][\Ü^RXY\œÊNÂˆÛÛœİÛİ\˜ÙT›İÜÈHİ\İÛT›İÜÈÚY]œ›İÜÈ×NÂˆÛÛœİÛÜY›İÜÈHXY\œË›[™İˆÈÛÜ™\Ü›İÜÊÛİ\˜ÙT›İÜËİ]KY\”ÚY]ÛÜ
›İËÙ^JHOˆ›İÖÚÙ^WJBˆˆÛİ\˜ÙT›İÜÎÂˆÛÛœİYÚ[˜][ÛˆHYÚ[˜][Û“Ü[ÛœÂˆÈY\•X›TYÚ[˜][ÛŠÛÜY›İÜËYÚ[˜][Û“Ü[ÛœËœYÙKYÚ[˜][Û“Ü[ÛœËœYÙTÚ^™JBˆˆ[ÂˆÛÛœİ›İÜÈHYÚ[˜][ÛˆÈYÚ[˜][Û‹œ›İÜÈˆÛÜY›İÜÎÂˆÛÛœİÜšYHÚY]™ÜšY×NÂˆÛÛœİÙ[XİX›HH\ÕY\‘]TÚY]
ÚY]
NÂˆ]Q[^ÛÛ[H	ÜÚY]›˜[Y_H	İ
œÚY]\™Ù]™XÛÜ™È‹”ÚY]™XÛÜ™ÈŠ_XÂˆYˆ
XY\œË›[™İ
HÂˆ™[™\•Y\ÛÛ[[”[™[
ÚY][\Ü^RXY\œË\Ü^RXY\œÊNÂˆÛÛœİX›HHXY[˜ÛÜÙ\İ
X›HŠNÂˆYˆ
X›JHÂˆX›Kœİ[K›Z[•ÚYH\Ü^RXY\œË›[™İHˆÈŒL	H‚ˆˆ	ÓX]›Z[ŠŒX]›X^
LŒ\Ü^RXY\œË›[™İ
ˆLÌ
J_\ÂˆBˆİ]Kš\ÚX›UY\”›İÒÙ^\ÈHÙ[XİX›HÈ›İÜË›X\
Y\”›İÔÙ[Xİ[Û’Ù^JHˆ×NÂˆYˆ
Ù[XİX›JH[™UY\”Ù[Xİ[Û•Õš\ÚX›J
NÂˆYˆ
YÚ[˜][ÛŠHİ]KY\•X›TYÙ\ÖÜÚY]›˜[YWHHYÚ[˜][Û‹œYÙNÂˆ™[™\•Y\”YÚ[˜][ÛŠÚY]›˜[YKYÚ[˜][ÛŠNÂˆÛÛœİ™[™\™YX™[HYÚ[˜][Û‚ˆÈÈÚİÚ[™È	ÜYÚ[˜][Û‹İ[›İÜÈÈYÚ[˜][Û‹œİ\[™^
ÈHˆx $ÉÜYÚ[˜][Û‹™[™[™^HÛˆYÙH	ÜYÚ[˜][Û‹œYÙ_XˆˆˆÂˆÛİ[[^ÛÛ[H	ÜÛÜY›İÜË›[™İÓØØ[Tİš[™Ê
_H›İÜÉÜ™[™\™YX™[HÈ	Ù\Ü^RXY\œË›[™İÓØØ[Tİš[™Ê
_HÙˆ	Ø[\Ü^RXY\œË›[™İÓØØ[Tİš[™Ê
_HÛÛ[[œØÂˆXY[š[›™\’SH‰ÜÙ[XİX›HÈY\”Ù[Xİ[Û’XY\’[

HˆˆŸIÙ\Ü^RXY\œË›X\

XY\ŠHOˆÛÜX›RXY\’[
XY\‹İ]KY\”ÚY]ÛÜY\ˆŠJKš›Ú[ŠˆŠ_Oİ˜Âˆ›İÜÑ[š[›™\’SH›İÜË›X\

›İÊHOˆ
ˆˆÛ\ÜÏH‰Ù\ØØ\R[
Y\”›İĞÛ\ÜÊÚY]›İÊJ_Hˆ]K]Y\‹\›İËZÙ^OH‰Ù\ØØ\R[
Y\”›İÔÙ[Xİ[Û’Ù^J›İÊJ_H‰ÜÙ[XİX›HÈY\”Ù[Xİ[ÛÙ[[
›İÊHˆˆŸIÙ\Ü^RXY\œË›X\

XY\ŠHOˆ‰ÜÚY]Ù[[
ÚY]›İËXY\Š_Oİ˜
Kš›Ú[ŠˆŠ_Oİ˜ˆ
JKš›Ú[ŠˆŠNÂˆŞ[˜ÕY\[ĞÛÛ›ÛÊ
NÂˆ™]\›ÂˆB‚ˆ™[™\•Y\ÛÛ[[”[™[
ÚY]×K×JNÂˆ™[™\•Y\”YÚ[˜][ÛŠÚY]›˜[YK[
NÂˆİ]Kš\ÚX›UY\”›İÒÙ^\ÈH×NÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆ™[™\•Y\ÛÛ[[”[™[
ÚY]×K×JNÂˆÛÛœİX^ÛÛÈHÜšYœ™YXÙJ
X^›İÊHOˆX]›X^
X^›İË›[™İ
K
NÂˆÛİ[[^ÛÛ[H	ÙÜšY›[™İÓØØ[Tİš[™Ê
_H›İÜÈÈ	ÛX^ÛÛËÓØØ[Tİš[™Ê
_HÛÛ[[œØÂˆXY[š[›™\’SHX^ÛÛÂˆÈ‰Ğ\œ˜^K™œ›ÛJÈ[™İˆX^ÛÛÈK
Ë[™^
HOˆ‰ØÛÛ[[“X™[
[™^
_Oİ˜
Kš›Ú[ŠˆŠ_Oİ˜ˆˆˆÂˆ›İÜÑ[š[›™\’SHÜšY›X\

›İÊHOˆ
ˆ‰Ğ\œ˜^K™œ›ÛJÈ[™İˆX^ÛÛÈK
Ë[™^
HOˆ‰Ù\ØØ\R[
›İÖÚ[™^HˆŠ_Oİ˜
Kš›Ú[ŠˆŠ_Oİ˜ˆ
JKš›Ú[ŠˆŠNÂˆŞ[˜ÕY\[ĞÛÛ›ÛÊ
NÂˆB‚ˆ[˜İ[ÛˆY\Œ”\ÙRÚ[™
ÚY]›İÊHÂˆYˆ
\ÚY]ÚY]›˜[YHOOH•Y\ˆˆŠH™]\›ˆˆÂˆÛÛœİ\ÙHHİš[™Ê›İË”\ÙHˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆYˆ
\ÙKš[˜ÛY\Ê™Ü›İÚ[™ÈŠJH™]\›ˆ™Ü™Y[ˆÂˆYˆ
\ÙKš[˜ÛY\ÊœİX›HŠJH™]\›ˆY[İÈÂˆYˆ
\ÙKš[˜ÛY\Ê™XÛ[š[™ÈŠJH™]\›ˆœ™YÂˆ™]\›ˆˆÂˆB‚ˆ[˜İ[Ûˆ›Ü›X[^™Uš\İX[İ]\ĞÛÛÜŠ˜[YJHÂˆÛÛœİ^Hİš[™Ê˜[YHˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆYˆ
]^
H™]\›ˆ[ÂˆYˆ
È™Ü™Y[ˆ‹Y[İÈ‹œ™Y—Kš[˜ÛY\Ê^
JH™]\›ˆ^ÂˆYˆ
È››Û™H‹›™]]˜[‹››ÈÛÛÜˆ‹››ËXÛÛÜˆ‹˜ÛX\ˆ—Kš[˜ÛY\Ê^
JH™]\›ˆˆÂˆ™]\›ˆ[ÂˆB‚ˆ[˜İ[Ûˆš\œİ™\Ù[›İÕ˜[YJ›İËÙ^\ÊHÂˆYˆ
\›İÊH™]\›ˆˆÂˆ›Üˆ
ÛÛœİÙ^HÙˆÙ^\ÊHÂˆYˆ
Øš™Xİœ›İİ\Kš\ÓİÛ”›Ü\K˜Ø[
›İËÙ^JH	‰ˆ›İÖÚÙ^WHOH[	‰ˆİš[™Ê›İÖÚÙ^WJKš[J
HOOHˆŠHÂˆ™]\›ˆ›İÖÚÙ^WNÂˆBˆBˆ™]\›ˆˆÂˆB‚ˆ[˜İ[Ûˆ^XÚ]š\İX[İ]\ĞÛÛÜŠ›İÊHÂˆYˆ
\›İÊH™]\›ˆ[ÂˆÛÛœİ™\İYÛÛÜˆH›İËš\İX[İ]\È	‰ˆ\[Ùˆ›İËš\İX[İ]\ÈOOH›Øš™XİˆÈ›İËš\İX[İ]\Ë˜ÛÛÜˆˆˆÂˆÛÛœİÛÛÜˆH›Ü›X[^™Uš\İX[İ]\ĞÛÛÜŠ™\İYÛÛÜˆš\œİ™\Ù[›İÕ˜[YJ›İËQT—Õ’TÕPSÔÕUT×ĞÓÓÔ—ÒÑVTÊJNÂˆ™]\›ˆÛÛÜÂˆB‚ˆ[˜İ[ÛˆY\”›İÔ[RYÚYÚÚ[™
ÚY]›İÊHÂˆËÈÛÛÜœÈ\™HİÜ™Y[ˆH]X˜\ÙKÔÚY][™]\İ›İ™H[™™\œ™YHHRK‚ˆ™]\›ˆˆÂˆB‚ˆ[˜İ[Ûˆš\İX[İ]\Ñ›Ü•Y\”›İÊÚY]›İÊHÂˆÛÛœİ^XÚ]ÛÛÜˆH^XÚ]š\İX[İ]\ĞÛÛÜŠ›İÊNÂˆYˆ
^XÚ]ÛÛÜˆOOH[
HÂˆ™]\›ˆÂˆÛÛÜˆ^XÚ]ÛÛÜ‹ˆÛÙNˆš\œİ™\Ù[›İÕ˜[YJ›İËQT—Õ’TÕPSÔÕUT×ĞÓÑWÒÑVTÊKˆ™X\ÛÛˆš\œİ™\Ù[›İÕ˜[YJ›İËQT—Õ’TÕPSÔÕUT×Ô‘PTÓÓ—ÒÑVTÊKˆÛİ\˜ÙNˆš\œİ™\Ù[›İÕ˜[YJ›İËQT—Õ’TÕPSÔÕUT×ÔÓÕTÑWÒÑVTÊH›X[X[‚ˆNÂˆBˆ™]\›ˆÈÛÛÜˆˆ‹ÛÙNˆˆ‹™X\ÛÛˆˆ‹Ûİ\˜ÙNˆˆˆNÂˆB‚ˆ[˜İ[Ûˆ\Ü^RXY\œÑ›Ü”ÚY]
ÚY]XY\œÊHÂˆYˆ
\ÚY]JÚY]™\ÜY\”ÚY]È×JKš[˜ÛY\ÊÚY]›˜[YJJH™]\›ˆXY\œÈ×NÂˆYˆ
ÚY]›˜[YHOOH•Y\ˆHŠH™]\›ˆXY\œÈ×NÂˆÛÛœİ\Ú\™YHÈÛÛ\][Ûˆ˜]H—NÂˆÛÛœİİ]]H×NÂˆ
XY\œÈ×JK™›Ü‘XXÚ

XY\ŠHOˆÂˆYˆ
\Ú\™Yš[˜ÛY\ÊXY\ŠJH™]\›Âˆİ]]œ\Ú
XY\ŠNÂˆYˆ
XY\ˆOOH“Ü™\ˆÛİ[ŠHÂˆ\Ú\™Y™›Ü‘XXÚ

^˜JHOˆÂˆYˆ

XY\œÈ×JKš[˜ÛY\Ê^˜JJHİ]]œ\Ú
^˜JNÂˆJNÂˆBˆJNÂˆ™]\›ˆİ]]ÂˆB‚ˆ[˜İ[ÛˆÙ[XİYXY\œÑ›Ü•Y\”ÚY]
ÚY]˜[YKXY\œÊHÂˆÛÛœİØ]™YHİ]KY\•š\ÚX›PÛÛ[[œÖÜÚY]˜[YWNÂˆYˆ
P\œ˜^Kš\Ğ\œ˜^JØ]™Y
JH™]\›ˆ×NÂˆÛÛœİZYÜ˜]YØ]™YHØ]™Y™›]X\

XY\ŠHOˆXY\ˆOOHÛÛ[Z\ÜÚ[Ûˆ˜]H‚ˆÈÈSÛÛ[Z\ÜÚ[Ûˆ‹Q‘ˆÛÛ[Z\ÜÚ[Ûˆ—BˆˆÚXY\—JNÂˆÛÛœİÙ[XİYHZYÜ˜]YØ]™Y™š[\Š
XY\ŠHOˆXY\œËš[˜ÛY\ÊXY\ŠJNÂˆÛÛœİYØXŞR[™^HÙ[XİYš[™^ÙŠ˜XÚÙ[™TÈŠNÂˆYˆ
YØXŞR[™^H	‰ˆXY\œËš[˜ÛY\Ê‘TÊ[
HŠH	‰ˆXY\œËš[˜ÛY\Ê‘TÊY™ŠHŠJHÂˆÙ[XİYœÜXÙJYØXŞR[™^K‘TÊ[
H‹‘TÊY™ŠHŠNÂˆBˆ™]\›ˆ\œ˜^K™œ›ÛJ™]ÈÙ]
Ù[XİY
JNÂˆB‚ˆ[˜İ[ÛˆY˜][Y\’XY\œÑ›Ü”ÚY]
ÚY]XY\œÊHÂˆÛÛœİ[XY\œÈHXY\œÈ×NÂˆYˆ
\ÚY]JÚY]™\ÜY\”ÚY]È×JKš[˜ÛY\ÊÚY]›˜[YJJH™]\›ˆ[XY\œÎÂˆÛÛœİ]˜Z[X›HH™]ÈÙ]
[XY\œÊNÂˆÛÛœİÙ[XİYH×NÂˆQUSÕQT—Õ’TÒP“WĞÓÓSS”Ë™›Ü‘XXÚ

™Y™\œ™YXY\ŠHOˆÂˆÛÛœİØ[™Y]\ÈHQUSÕQT—ĞÓÓSS—ĞSPTÑTÖÜ™Y™\œ™YXY\—HÜ™Y™\œ™YXY\—NÂˆÛÛœİX]ÚYXY\ˆHØ[™Y]\Ë™š[™

XY\ŠHOˆ]˜Z[X›Kš\ÊXY\ŠJNÂˆYˆ
X]ÚYXY\ˆ	‰ˆ\Ù[XİYš[˜ÛY\ÊX]ÚYXY\ŠJHÙ[XİYœ\Ú
X]ÚYXY\ŠNÂˆJNÂˆYˆ
ÚY]›˜[YHOOH•Y\ˆHˆ	‰ˆ]˜Z[X›Kš\ÊYÙ[˜ŞHŠH	‰ˆ\Ù[XİYš[˜ÛY\ÊYÙ[˜ŞHŠJHÂˆÛÛœİ™]ÛÜšÒ[™^HÙ[XİYš[™^ÙŠ“™]ÛÜšÈŠNÂˆÙ[XİYœÜXÙJ™]ÛÜšÒ[™^HÈ™]ÛÜšÒ[™^
ÈHˆYÙ[˜ŞHŠNÂˆBˆYˆ
ÚY]›˜[YHOOH•Y\ˆHˆ	‰ˆ]˜Z[X›Kš\Ê‘ŠH	‰ˆ\Ù[XİYš[˜ÛY\Ê‘ŠJHÂˆÛÛœİYÙ[˜ŞR[™^HÙ[XİYš[™^ÙŠYÙ[˜ŞHŠNÂˆÛÛœİ™]ÛÜšÒ[™^HÙ[XİYš[™^ÙŠ“™]ÛÜšÈŠNÂˆÛÛœİ[œÙ\Y\ˆHYÙ[˜ŞR[™^HÈYÙ[˜ŞR[™^ˆ™]ÛÜšÒ[™^ÂˆÙ[XİYœÜXÙJ[œÙ\Y\ˆHÈ[œÙ\Y\ˆ
ÈHˆ‘ŠNÂˆBˆ™]\›ˆÙ[XİY›[™İÈÙ[XİYˆ[XY\œÎÂˆB‚ˆ[˜İ[Ûˆš\ÚX›RXY\œÑ›Ü”ÚY]
ÚY]XY\œÊHÂˆÛÛœİ[XY\œÈHXY\œÈ×NÂˆYˆ
\ÚY]JÚY]™\ÜY\”ÚY]È×JKš[˜ÛY\ÊÚY]›˜[YJJH™]\›ˆ[XY\œÎÂˆÛÛœİÙ[XİYHÙ[XİYXY\œÑ›Ü•Y\”ÚY]
ÚY]›˜[YK[XY\œÊNÂˆ™]\›ˆÙ[XİY›[™İÈÙ[XİYˆY˜][Y\’XY\œÑ›Ü”ÚY]
ÚY][XY\œÊNÂˆB‚ˆ[˜İ[ÛˆÛÜ™RXY\œÑ›Ü”ÚY]
ÚY]XY\œÊHÂˆ™]\›ˆY˜][Y\’XY\œÑ›Ü”ÚY]
ÚY]XY\œÊNÂˆB‚ˆ[˜İ[ÛˆÙ]Y\•š\ÚX›RXY\œÊÚY]XY\œÊHÂˆYˆ
\ÚY]ZXY\œË›[™İ
H™]\›Âˆİ]KY\•š\ÚX›PÛÛ[[œÖÜÚY]›˜[YWHHXY\œÎÂˆØ]™UY\•š\ÚX›PÛÛ[[œÊ
NÂˆ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÂˆB‚ˆ[˜İ[Ûˆ™\Ù]Y\•š\ÚX›RXY\œÊÚY]
HÂˆYˆ
\ÚY]
H™]\›Âˆ[]Hİ]KY\•š\ÚX›PÛÛ[[œÖÜÚY]›˜[YWNÂˆØ]™UY\•š\ÚX›PÛÛ[[œÊ
NÂˆ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\ÛÛ[[”[™[
ÚY][XY\œËš\ÚX›RXY\œÊHÂˆYˆ
Y[ËY\ÛÛ[[“\İY[ËY\ÛÛ[[”[™[Y[ËY\ÛÛ[[•ÙÙÛJH™]\›ÂˆYˆ
\ÚY]X[XY\œË›[™İ
HÂˆ[ËY\ÛÛ[[“\İš[›™\’SHˆÂˆ[ËY\ÛÛ[[”[™[˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆ[ËY\ÛÛ[[•ÙÙÛKœÙ]]šX]J˜\šXKY^[™Y‹™˜[ÙHŠNÂˆ™]\›ÂˆBˆÛÛœİš\ÚX›HH™]ÈÙ]
š\ÚX›RXY\œÊNÂˆÛÛœİXÚÙ\’XY\œÈHÂˆ‹‹š\ÚX›RXY\œËˆ‹‹˜[XY\œË™š[\Š
XY\ŠHOˆ]š\ÚX›Kš\ÊXY\ŠJBˆNÂˆ[ËY\ÛÛ[[“\İš[›™\’SHXÚÙ\’XY\œË›X\

XY\ŠHOˆÂˆÛÛœİYHY\‹XÛÛ[[‹IÜØY™Qš[T\
ÚY]›˜[YJ_KIÜØY™Qš[T\
XY\Š_XÂˆ™]\›ˆX™[Û\ÜÏH˜ÛÛ[[‹XÚXÚÈˆ›ÜH‰Ù\ØØ\R[
Y
_H‚ˆ[œ]YH‰Ù\ØØ\R[
Y
_Hˆ\OH˜ÚXÚØ›Şˆ˜[YOH‰Ù\ØØ\R[
XY\Š_H‰İš\ÚX›Kš\ÊXY\ŠHÈˆÚXÚÙYˆˆˆŸHÏ‚ˆÜ[‰Ù\ØØ\R[
X™[^
XY\ŠJ_OÜÜ[‚ˆÛX™[˜ÂˆJKš›Ú[ŠˆŠNÂˆ[ËY\ÛÛ[[”[™[˜Û\ÜÓ\İÙÙÛJšY[ˆ‹\İ]KY\ÛÛ[[”[™[Ü[ŠNÂˆ[ËY\ÛÛ[[•ÙÙÛKœÙ]]šX]J˜\šXKY^[™Y‹İ]KY\ÛÛ[[”[™[Ü[ˆÈYHˆˆ™˜[ÙHŠNÂˆB‚ˆ[˜İ[ÛˆÙ™™\‘›Ü”ÚY]›İÊ›İÊHÂˆ™]\›ˆÙ™™\‘›Ü“Y\˜Ú[
›İÕ˜[YJ›İËÈ“Y\˜Ú[Q‹“Y\˜Ú[Y‹›Y\˜Ú[Y—JK›İÕ˜[YJ›İËÈ“Y\˜Ú[˜[YH‹œ˜[™‹˜œ˜[™—JJNÂˆB‚ˆ[˜İ[ÛˆÚY]˜[YSX]Ú\ÕY\ŠÚY]˜[YKY\ŠHÂˆ™]\›ˆØ[›ÛšXØ[Y\“˜[YJÚY]˜[YJHOOHØ[›ÛšXØ[Y\“˜[YJY\ŠNÂˆB‚ˆ[˜İ[ÛˆÚY]›İÒÙ^J›İÊHÂˆÛÛœİY\˜Ú[YHİš[™Ê›İÕ˜[YJ›İËÈ“Y\˜Ú[Q‹“Y\˜Ú[Y‹›Y\˜Ú[Y—JHˆŠKš[J
NÂˆ™]\›ˆY\˜Ú[Y›Ü›X[^™J›İÕ˜[YJ›İËÈ“Y\˜Ú[˜[YH‹œ˜[™‹˜œ˜[™—JJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•ÕY\”ÚY]›İÊÙ™™\‹ÚY]
HÂˆÛÛœİ›İÈHÈİY\“İ™\œšYT›İÎˆYKÛÙ™™\’Ù^NˆÙ™™\’Ù^JÙ™™\ŠHNÂˆ
ÚY]šXY\œÈ×JK™›Ü‘XXÚ

XY\ŠHOˆÂˆYˆ
XY\ˆOOH“ÜšYÚ[˜[˜[šÈŠH›İÖÚXY\—HHÙ™™\‹›ÜšYÚ[˜[˜[šÈˆÂˆ[ÙHYˆ
XY\ˆOOH“Y\˜Ú[QŠH›İÖÚXY\—HHÙ™™\‹›Y\˜Ú[YˆÂˆ[ÙHYˆ
XY\ˆOOH“Y\˜Ú[˜[YHŠH›İÖÚXY\—HHÙ™™\‹˜œ˜[™ˆÂˆ[ÙHYˆ
XY\ˆOOH“™]ÛÜšÈŠH›İÖÚXY\—HHÙ™™\‹›™]ÛÜšÈˆÂˆ[ÙHYˆ
XY\ˆOOHYÙ[˜ŞHŠH›İÖÚXY\—HHÙ™™\‹˜YÙ[˜ŞHˆÂˆ[ÙHYˆ
XY\ˆOOH‘ŠH›İÖÚXY\—HHÙ™™\‹˜\Ú[™\ÜÓX[˜YÙ\ˆÙ™™\‹˜™ˆÂˆ[ÙHYˆ
XY\ˆOOHÛXÚÜÈŠH›İÖÚXY\—HH[X™\ŠÙ™™\‹˜ÛXÚÜÊKÓØØ[Tİš[™Ê
NÂˆ[ÙHYˆ
XY\ˆOOHÛÛ™\œÚ[ÛˆŠH›İÖÚXY\—HHÚÜİ
Ù™™\‹˜ÛÛ™\œÚ[Û”˜]JNÂˆ[ÙHYˆ
XY\ˆOOH‘ˆŠH›İÖÚXY\—HH[X™\ŠÙ™™\‹™ŠKÓØØ[Tİš[™Ê
NÂˆ[ÙHYˆ
XY\ˆOOHUÈŠH›İÖÚXY\—HH[X™\ŠÙ™™\‹˜]ÊKÓØØ[Tİš[™Ê
NÂˆ[ÙHYˆ
XY\ˆOOH“Ü™\ˆÛİ[ŠH›İÖÚXY\—HH[X™\ŠÙ™™\‹›Ü™\œÊKÓØØ[Tİš[™Ê
NÂˆ[ÙHYˆ
XY\ˆOOH‘TÊ[
HˆXY\ˆOOH[TÈŠH›İÖÚXY\—HHÚÜ\ÊÙ™™\[\ÊÙ™™\ŠJNÂˆ[ÙHYˆ
XY\ˆOOH‘TÊY™ŠHˆXY\ˆOOHY™ˆTÈˆXY\ˆOOH˜XÚÙ[™TÈˆXY\ˆOOH‘TÈŠH›İÖÚXY\—HHÚÜ\ÊÙ™™\Y™‘\ÊÙ™™\ŠJNÂˆ[ÙHYˆ
XY\ˆOOHSÕˆŠH›İÖÚXY\—HHÙ™™\‹˜[İˆOH[ÈˆˆˆÙ™™\‹˜[İÂˆ[ÙHYˆ
XY\ˆOOHSÕˆ\HŠH›İÖÚXY\—HHÙ™™\‹˜[İ•\HˆÂˆ[ÙHYˆ
XY\ˆOOHSÕˆY]ÙŠH›İÖÚXY\—HHÙ™™\‹˜[İ“Y]ÙˆÂˆ[ÙHYˆ
XY\ˆOOHSÕˆÛİ\˜ÙHŠH›İÖÚXY\—HHÙ™™\‹˜[İ”Ûİ\˜ÙHˆÂˆ[ÙHYˆ
XY\ˆOOHSÕˆØ[\H›ÙXİÈŠH›İÖÚXY\—HHÙ™™\‹˜[İ”Ø[\T›ÙXİÛİ[ˆÂˆ[ÙHYˆ
XY\ˆOOHSÕˆİ\œ™[˜ŞHŠH›İÖÚXY\—HHÙ™™\‹˜[İİ\œ™[˜ŞHˆÂˆ[ÙHYˆ
XY\ˆOOHSÕˆÛİ\˜ÙH]HŠH›İÖÚXY\—HHÙ™™\‹˜[İ”Ûİ\˜ÙQ]HˆÂˆ[ÙHYˆ
XY\ˆOOHSÕˆÛİ\˜ÙHš[HŠH›İÖÚXY\—HHÙ™™\‹˜[İ”Ûİ\˜ÙQš[HˆÂˆ[ÙHYˆ
XY\ˆOOH”™]™[YHŠH›İÖÚXY\—HHÚÜ[Û™^JÙ™™\‹œØ[\Ğ[[İ[
NÂˆ[ÙHYˆ
XY\ˆOOHÛÛ\][Ûˆ˜]HŠH›İÖÚXY\—HHÚÜİ
Ù™™\‹˜ÛÛ\][Û”˜]JNÂˆ[ÙHYˆ
XY\ˆOOH”^[Y[ŞXÛHŠH›İÖÚXY\—HHÙ™™\‹œ^[Y[ŞXÛHÈ	ÛÙ™™\‹œ^[Y[ŞXÛ_XˆˆÂˆ[ÙHYˆ
XY\ˆOOH\Ú[œÈŠH›İÖÚXY\—HHÙ™™\‹˜\Ú[œÕ^
Ù™™\‹Ü\Ú[œÈ×JKš›Ú[Š‹ŠNÂˆ[ÙHYˆ
XY\ˆOOHÓÕS•–HˆXY\ˆOOHÛİ[HŠH›İÖÚXY\—HHÙ™™\‹˜Ûİ[HˆÂˆ[ÙHYˆ
XY\ˆOOH•Y\ˆ™X\ÛÛˆˆXY\ˆOOH”™X\ÛÛˆŠH›İÖÚXY\—HH	İ
›[İ™K›[İ™Yœ›ÛH‹“[İ™Yœ›ÛHŠ_H	ÛÜ[Û•^
Ù™™\‹›ÜšYÚ[˜[Y\ˆ•[šÛ›İÛˆŠ_XÂˆ[ÙHYˆ
XY\ˆOOH”™XÛÛ[Y[™][ÛˆŠH›İÖÚXY\—HHÙ™™\‹œ™XÛÛ[Y[™][Ûˆ™XÛÛ[Y[™YXİ[ÛŠÙ™™\ŠNÂˆ[ÙHYˆ
XY\ˆOOH•š\İX[İ]\ÈÛÛÜˆŠH›İÖÚXY\—HHÙ™™\‹š\İX[İ]\ĞÛÛÜˆˆÂˆ[ÙHYˆ
XY\ˆOOH•š\İX[İ]\ÈÛÙHŠH›İÖÚXY\—HHÙ™™\‹š\İX[İ]\ĞÛÙHˆÂˆ[ÙHYˆ
XY\ˆOOH•š\İX[İ]\È™X\ÛÛˆŠH›İÖÚXY\—HHÙ™™\‹š\İX[İ]\Ô™X\ÛÛˆˆÂˆ[ÙHYˆ
XY\ˆOOH•š\İX[İ]\ÈÛİ\˜ÙHŠH›İÖÚXY\—HHÙ™™\‹š\İX[İ]\ÔÛİ\˜ÙHˆÂˆ[ÙH›İÖÚXY\—HHÙ™™\–ÚXY\—HˆÂˆJNÂˆÈš\İX[İ]\ĞÛÛÜˆ‹š\İX[İ]\ĞÛÙH‹š\İX[İ]\Ô™X\ÛÛˆ‹š\İX[İ]\ÔÛİ\˜ÙH—K™›Ü‘XXÚ

Ù^JHOˆÂˆYˆ
Ù™™\–ÚÙ^WHOOH[™Yš[™Y
H›İÖÚÙ^WHHÙ™™\–ÚÙ^WNÂˆJNÂˆ™]\›ˆ›İÎÂˆB‚ˆ[˜İ[ÛˆY\”ÚY]›İÜÑ›Ü‘\Ü^JÚY]
HÂˆYˆ
\ÚY]JÚY]šXY\œÈ×JK›[™İ
H™]\›ˆÚY]È
ÚY]œ›İÜÈ×JHˆ×NÂˆÛÛœİÚY]Y\ˆHØ[›ÛšXØ[Y\“˜[YJÚY]›˜[YJNÂˆÛÛœİÙ\›İÜÈH×NÂˆÛÛœİ›İÒÙ^\ÈH™]ÈÙ]

NÂ‚ˆ
ÚY]œ›İÜÈ×JK™›Ü‘XXÚ

›İÊHOˆÂˆÛÛœİÙ™™\ˆHÙ™™\‘›Ü”ÚY]›İÊ›İÊNÂˆYˆ
Ù™™\ˆ	‰ˆÙ™™\‹Y\“İ™\œšYH	‰ˆ\ÚY]˜[YSX]Ú\ÕY\ŠÚY]Y\‹Ù™™\‹Y\ŠJH™]\›ÂˆÙ\›İÜËœ\Ú
›İÊNÂˆÛÛœİÙ^HHÚY]›İÒÙ^J›İÊNÂˆYˆ
Ù^JH›İÒÙ^\Ë˜Y
Ù^JNÂˆJNÂ‚ˆÙ™™\œÂˆ™š[\Š
Ù™™\ŠHOˆÙ™™\‹Y\“İ™\œšYH	‰ˆÚY]˜[YSX]Ú\ÕY\ŠÚY]Y\‹Ù™™\‹Y\ŠJBˆ™›Ü‘XXÚ

Ù™™\ŠHOˆÂˆÛÛœİÙ^HHİš[™ÊÙ™™\‹›Y\˜Ú[YˆŠKš[J
H›Ü›X[^™JÙ™™\‹˜œ˜[™
NÂˆYˆ
Ù^H	‰ˆ›İÒÙ^\Ëš\ÊÙ^JJH™]\›ÂˆÙ\›İÜËœ\Ú
Ù™™\•ÕY\”ÚY]›İÊÙ™™\‹ÚY]
JNÂˆJNÂ‚ˆ™]\›ˆÙ\›İÜÎÂˆB‚ˆ[˜İ[ÛˆY\”™X\ÛÛ•^
›İÊHÂˆ™]\›ˆİš[™Ê›İÖÈ•Y\ˆ™X\ÛÛˆ—H›İË”™X\ÛÛˆ›İË”™XÛÛ[Y[™][ÛˆˆŠKš[J
NÂˆB‚ˆ[˜İ[ÛˆY\”›İÒYÚYÚÚ[™
ÚY]›İÊHÂˆ™]\›ˆš\İX[İ]\Ñ›Ü•Y\”›İÊÚY]›İÊK˜ÛÛÜˆˆÂˆB‚ˆ[˜İ[ÛˆY\”›İĞÛ\ÜÊÚY]›İÊHÂˆYˆ
›İÈ	‰ˆ›İË—İY\“İ™\œšYT›İÊH™]\›ˆY\‹ZYÚYÚ\›İÈY\‹ZYÚYÚYÜ™Y[ˆÂˆÛÛœİÚ[™HY\”›İÒYÚYÚÚ[™
ÚY]›İÊNÂˆ™]\›ˆÚ[™ÈY\‹ZYÚYÚ\›İÈY\‹ZYÚYÚIÚÚ[™XˆˆÂˆB‚ˆ[˜İ[Ûˆ[İÙ[[
›İË›Ü›X]Y˜[YJHÂˆÛÛœİ[İ•\HHİš[™Ê
›İÈ	‰ˆ›İÖÈSÕˆ\H—JHˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆYˆ
Y›Ü›X]Y˜[YHVÈ˜XİX[‹[]]™H—Kš[˜ÛY\Ê[İ•\JJHÂˆ™]\›ˆ\ØØ\R[
›Ü›X]Y˜[YJNÂˆBˆÛÛœİ\ĞXİX[H[İ•\HOOH˜XİX[ÂˆÛÛœİX\šÙ\ˆHİ]K›[™İXYÙHOOHš‚ˆÈ
\ĞXİX[È¹k§ˆˆˆ¹¦ ˆŠBˆˆ
\ĞXİX[ÈXİX[ˆˆ‘\İˆŠNÂˆÛÛœİØ[\PÛİ[H[X™\Š›İÈ	‰ˆ›İÖÈSÕˆØ[\H›ÙXİÈ—JHNÂˆÛÛœİÛİ\˜ÙQ]HHİš[™Ê
›İÈ	‰ˆ›İÖÈSÕˆÛİ\˜ÙH]H—JHˆŠKš[J
NÂˆÛÛœİ\ØÜš\[ÛˆH\ĞXİX[ˆÈ
İ]K›[™İXYÙHOOHšˆÈ¹ç'ùk§ˆSÕ»ï&”™]™[YH0íÈÜ™\ˆÛİ[ˆˆXİX[SÕˆ™]™[YH0íÈÜ™\ˆÛİ[ŠBˆˆ
İ]K›[™İXYÙHOOHš‚ˆÈ9¦ ¹k¦ˆSÕ»ï&‰ÜØ[\PÛİ[H9«/¹.©ùdàynlùgaù`/	ÜÛİ\˜ÙQ]HÈ0­È	ÜÛİ\˜ÙQ]_XˆˆŸXˆˆ\İ[X]YSÕˆ	ÜØ[\PÛİ[K\›ÙXİ]™\˜YÙIÜÛİ\˜ÙQ]HÈ0­È	ÜÛİ\˜ÙQ]_XˆˆŸX
NÂˆ™]\›ˆÜ[ˆÛ\ÜÏH˜[İ‹]˜[YH[İ‹IÙ\ØØ\R[
[İ•\J_Hˆ]OH‰Ù\ØØ\R[
\ØÜš\[ÛŠ_Hˆ\šXK[X™[H‰Ù\ØØ\R[
\ØÜš\[ÛŠ_H‚ˆÜ[‰Ù\ØØ\R[
›Ü›X]Y˜[YJ_OÜÜ[ÛX[‰Ù\ØØ\R[
X\šÙ\Š_OÜÛX[‚ˆÜÜ[˜ÂˆB‚ˆ[˜İ[ÛˆÚY]Ù[[
ÚY]›İËXY\ŠHÂˆÛÛœİ˜[YHH›Ü›X]Y\”ÚY]Ù[
ÚY]›İËXY\ŠNÂˆYˆ
XY\ˆOOHSÕˆŠH™]\›ˆ[İÙ[[
›İË˜[YJNÂˆYˆ
XY\ˆOOH•š\İX[İ]\ÈÛÛÜˆˆXY\ˆOOHš\İX[İ]\ĞÛÛÜˆŠHÂˆÛÛœİÛÛÜˆH›Ü›X[^™Uš\İX[İ]\ĞÛÛÜŠ˜[YJNÂˆYˆ
XÛÛÜˆ]˜[YJH™]\›ˆ\ØØ\R[
˜[YJNÂˆ™]\›ˆÜ[ˆÛ\ÜÏHœ\ÙK\[\ÙKIÙ\ØØ\R[
ÛÛÜŠ_H‰Ù\ØØ\R[
˜[YJ_OÜÜ[˜ÂˆBˆÛÛœİÚ[™HXY\ˆOOH”\ÙHˆÈY\Œ”\ÙRÚ[™
ÚY]›İÊHˆˆÂˆYˆ
ZÚ[™]˜[YJH™]\›ˆ\ØØ\R[
˜[YJNÂˆ™]\›ˆÜ[ˆÛ\ÜÏHœ\ÙK\[\ÙKIÙ\ØØ\R[
Ú[™
_H‰Ù\ØØ\R[
˜[YJ_OÜÜ[˜ÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\”ÚY]X›JÚY]
HÂˆ™[™\”ÚY]X›JÚY][ËY\•X›U]K[ËY\•X›PÛİ[[ËY\”ÚY]XY[ËY\”ÚY]›İÜËÙ]š[\™YY\”ÚY]›İÜÊÚY]
JNÂˆB‚ˆ[˜İ[ÛˆØ[‘^[™Y\”ÚY]
Y\“˜[YHHİ]KœÙ[XİYY\”YÙJHÂˆ™]\›ˆQT—ÔÒQUÑVS‘P“WÕQT”Ëš\ÊY\“˜[YJNÂˆB‚ˆ[˜İ[ÛˆŞ[˜ÕY\”ÚY]İ™\›^J
HÂˆÛÛœİÜ[ˆH›ÛÛX[Šİ]K™^[™YY\”ÚY]
H	‰ˆØ[‘^[™Y\”ÚY]

H	‰ˆİ]KœYÙHOOHY\ˆÂˆYˆ
İ]K™^[™YY\”ÚY]	‰ˆ[Ü[ŠHİ]K™^[™YY\”ÚY]H˜[ÙNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İÙÙÛJœÚY]Y^[™Y[Ü[ˆ‹Ü[ŠNÂˆYˆ
[ËœÚY]^[™Y˜XÚÙ›Ü
HÂˆ[ËœÚY]^[™Y˜XÚÙ›ÜœÙ]]šX]J˜\šXKZY[ˆ‹Ü[ˆÈ™˜[ÙHˆˆYHŠNÂˆBˆYˆ
[ËY\•X›T[™[
HÂˆ[ËY\•X›T[™[˜Û\ÜÓ\İÙÙÛJœÚY]Y^[™Y\[™[‹Ü[ŠNÂˆYˆ
Ü[ŠHÂˆ[ËY\•X›T[™[œÙ]]šX]Jœ›ÛH‹™X[ÙÈŠNÂˆ[ËY\•X›T[™[œÙ]]šX]J˜\šXK[[Ù[‹YHŠNÂˆH[ÙHÂˆ[ËY\•X›T[™[œ™[[İ™P]šX]Jœ›ÛHŠNÂˆ[ËY\•X›T[™[œ™[[İ™P]šX]J˜\šXK[[Ù[ŠNÂˆBˆBˆÛÛœİ]˜Z[X›HHØ[‘^[™Y\”ÚY]

H	‰ˆİ]KœYÙHOOHY\ˆÂˆYˆ
[ËY\‘^[™
HÂˆ[ËY\‘^[™˜Û\ÜÓ\İÙÙÛJšY[ˆ‹X]˜Z[X›HÜ[ŠNÂˆ[ËY\‘^[™™\ØX›YHX]˜Z[X›NÂˆ[ËY\‘^[™œÙ]]šX]J˜\šXKY^[™Y‹Ü[ˆÈYHˆˆ™˜[ÙHŠNÂˆBˆYˆ
[ËY\“İ™\›^PÛÜÙJHÂˆ[ËY\“İ™\›^PÛÜÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[Ü[ŠNÂˆBˆB‚ˆ[˜İ[ÛˆÜ[•Y\”ÚY]İ™\›^J
HÂˆYˆ
XØ[‘^[™Y\”ÚY]

JH™]\›Âˆİ]K™^[™YY\”ÚY]HYNÂˆŞ[˜ÕY\”ÚY]İ™\›^J
NÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
[ËY\“İ™\›^PÛÜÙJH[ËY\“İ™\›^PÛÜÙK™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[ÛˆÛÜÙUY\”ÚY]İ™\›^JÈ™\İÜ™Q›Øİ\ÈHYHHHßJHÂˆÛÛœİØ\ÓÜ[ˆH›ÛÛX[Šİ]K™^[™YY\”ÚY]
NÂˆİ]K™^[™YY\”ÚY]H˜[ÙNÂˆŞ[˜ÕY\”ÚY]İ™\›^J
NÂˆYˆ
™\İÜ™Q›Øİ\È	‰ˆØ\ÓÜ[ˆ	‰ˆ[ËY\‘^[™	‰ˆY[ËY\‘^[™˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠJHÂˆ[ËY\‘^[™™›Øİ\Ê
NÂˆBˆB‚ˆ[˜İ[ÛˆÙ[XİYY\”›İÜÊÚY]
HÂˆÛÛœİÙ[XİYHİ]KœÙ[XİYY\”›İÒÙ^\ÎÂˆ™]\›ˆ

ÚY]	‰ˆÚY]œ›İÜÊH×JK™š[\Š
›İÊHOˆÙ[XİYš\ÊY\”›İÔÙ[Xİ[Û’Ù^J›İÊJJNÂˆB‚ˆ[˜İ[ÛˆY˜][Y\“[İ™U\™Ù]

HÂˆ™]\›ˆQT—ÔÒQUÓSÕ‘WÕT‘ÑUË™š[™

Y\“˜[YJHOˆY\“˜[YHOOHİ]KœÙ[XİYY\”YÙJHˆÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\“[İ™QX[ÙÊ
HÂˆYˆ
Y[ËY\“[İ™QX[ÙÊH™]\›ÂˆÛÛœİÙ[XİYÛİ[Hİ]KœÙ[XİYY\”›İÒÙ^\ËœÚ^™NÂˆÛÛœİÛİ\˜ÙUY\ˆHİ]KœÙ[XİYY\”YÙNÂˆYˆ
\İ]KY\“[İ™U\™Ù]İ]KY\“[İ™U\™Ù]OOHÛİ\˜ÙUY\ŠHÂˆİ]KY\“[İ™U\™Ù]HY˜][Y\“[İ™U\™Ù]

NÂˆBˆYˆ
[ËY\“[İ™Tİ[[X\JHÂˆ[ËY\“[İ™Tİ[[X\K^ÛÛ[H	ÜÙ[XİYÛİ[ÓØØ[Tİš[™Ê
_HÙ[XİYœ›ÛH	ÜÛİ\˜ÙUY\ŸXÂˆBˆYˆ
[ËY\“[İ™U\™Ù]ÊHÂˆ[ËY\“[İ™U\™Ù]Ëš[›™\’SHQT—ÔÒQUÓSÕ‘WÕT‘ÑUË›X\

Y\“˜[YJHOˆÂˆÛÛœİİ\œ™[HY\“˜[YHOOHÛİ\˜ÙUY\ÂˆÛÛœİXİ]™HHY\“˜[YHOOHİ]KY\“[İ™U\™Ù]Âˆ™]\›ˆ]ÛˆÛ\ÜÏHY\‹[[İ™K]\™Ù]	ØXİ]™HÈˆXİ]™HˆˆˆŸHˆ\OH˜]Ûˆˆ]K]Y\‹[[İ™K]\™Ù]H‰Ù\ØØ\R[
Y\“˜[YJ_H‰Øİ\œ™[Èˆ\ØX›YˆˆˆŸO‚ˆÜ[‰Ù\ØØ\R[
Ø]YÛÜT™\ÜY\“X™[
Y\“˜[YJJ_OÜÜ[‚ˆÛX[‰Øİ\œ™[Èİ\œ™[Y\ˆˆˆ	Ê
ÚY]S˜[YJY\“˜[YJH	‰ˆÚY]S˜[YJY\“˜[YJKœ›İÜÊH×JK›[™İÓØØ[Tİš[™Ê
_H›İÜØOÜÛX[‚ˆØ]Û˜ÂˆJKš›Ú[ŠˆŠNÂˆBˆYˆ
[ËY\“[İ™PÛÛ™š\›JHÂˆ[ËY\“[İ™PÛÛ™š\›K™\ØX›YH\Ù[XİYÛİ[\İ]KY\“[İ™U\™Ù]İ]KY\“[İ™U\™Ù]OOHÛİ\˜ÙUY\Âˆ[ËY\“[İ™PÛÛ™š\›K^ÛÛ[Hİ]KY\“[İ™U\™Ù]È[İ™HÈ	ØØ]YÛÜT™\ÜY\“X™[
İ]KY\“[İ™U\™Ù]
_Xˆ“[İ™HY\˜Ú[ÈÂˆBˆYˆ
[ËY\“[İ™Tİ]\ÊH[ËY\“[İ™Tİ]\Ë^ÛÛ[Hİ]KY\“[İ™Tİ]\ÈˆÂˆB‚ˆ[˜İ[ÛˆÜ[•Y\“[İ™QX[ÙÊ
HÂˆYˆ
\İ]KœÙ[XİYY\”›İÒÙ^\ËœÚ^™HY[ËY\“[İ™QX[ÙÊH™]\›Âˆİ]KY\“[İ™U\™Ù]HY˜][Y\“[İ™U\™Ù]

NÂˆ™[™\•Y\“[İ™QX[ÙÊ
NÂˆ[ËY\“[İ™QX[ÙË˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İ˜Y
Y\‹[[İ™K[Ü[ˆŠNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆÛÛœİXİ]™HH[ËY\“[İ™U\™Ù]È	‰ˆ[ËY\“[İ™U\™Ù]Ëœ]Y\TÙ[XİÜŠ‹Y\‹[[İ™K]\™Ù]˜Xİ]™N››İ
™\ØX›Y
HŠNÂˆYˆ
Xİ]™JHXİ]™K™›Øİ\Ê
NÂˆ[ÙHYˆ
[ËY\“[İ™PÛÛ™š\›JH[ËY\“[İ™PÛÛ™š\›K™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[ÛˆÛÜÙUY\“[İ™QX[ÙÊ
HÂˆYˆ
Y[ËY\“[İ™QX[ÙÊH™]\›Âˆ[ËY\“[İ™QX[ÙË˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İœ™[[İ™JY\‹[[İ™K[Ü[ˆŠNÂˆYˆ
[ËY\“[İ™TÙ[XİY	‰ˆY[ËY\“[İ™TÙ[XİY™\ØX›Y
H[ËY\“[İ™TÙ[XİY™›Øİ\Ê
NÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ[İ™TÙ[XİYY\”›İÜÊ
HÂˆÛÛœİÛİ\˜ÙUY\ˆHİ]KœÙ[XİYY\”YÙNÂˆÛÛœİ\™Ù]Y\ˆHİ]KY\“[İ™U\™Ù]ÂˆÛÛœİÚY]HÚY]S˜[YJÛİ\˜ÙUY\ŠNÂˆYˆ
\ÚY]Z\ÕY\“[İ™U\™Ù]
\™Ù]Y\ŠH\™Ù]Y\ˆOOHÛİ\˜ÙUY\ˆ\İ]KœÙ[XİYY\”›İÒÙ^\ËœÚ^™JH™]\›Â‚ˆÛÛœİÙ[XİY›İÜÈHÙ[XİYY\”›İÜÊÚY]
NÂˆ][İ™YÛİ[HÂˆÙ[XİY›İÜË™›Ü‘XXÚ

›İÊHOˆÂˆÛÛœİÙ^HHY\”›İÔÙ[Xİ[Û’Ù^J›İÊNÂˆÛÛœİÜšYÚ[˜[HÜšYÚ[˜[Y\”ÚY]›İÒ[™^™Ù]
Ù^JNÂˆYˆ
[ÜšYÚ[˜[
H™]\›ÂˆYˆ
\™Ù]Y\ˆOOHÜšYÚ[˜[œÛİ\˜ÙUY\ŠHÂˆYˆ
İ]K›X[X[Y\“[İ™\ÖÚÙ^WJHÂˆ[]Hİ]K›X[X[Y\“[İ™\ÖÚÙ^WNÂˆ[İ™YÛİ[
ÏHNÂˆBˆ™]\›ÂˆBˆİ]K›X[X[Y\“[İ™\ÖÚÙ^WHHÂˆÛİ\˜ÙUY\ˆÜšYÚ[˜[œÛİ\˜ÙUY\‹ˆ\™Ù]Y\‹ˆY\˜Ú[YˆY\”›İÓY\˜Ú[Y
ÜšYÚ[˜[œ›İÊKˆY\˜Ú[˜[YNˆY\”›İÓY\˜Ú[˜[YJÜšYÚ[˜[œ›İÊKˆ[İ™Y]ˆØØ[]RÙ^J™]È]J
JBˆNÂˆ[İ™YÛİ[
ÏHNÂˆJNÂ‚ˆ\œÚ\İX[X[Y\“[İ™\Ê
NÂˆ\SX[X[Y\“[İ™\Ê
NÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆÛÛœİØØ[Y\ÜØYÙHH[İ™YÛİ[È[İ™Y	Û[İ™YÛİ[ÓØØ[Tİš[™Ê
_HÈ	ØØ]YÛÜT™\ÜY\“X™[
\™Ù]Y\Š_Xˆ“›ÈY\˜Ú[È[İ™YÂˆÙ]Y\“[İ™Tİ]\Ê[İ™YÛİ[È	ÛØØ[Y\ÜØYÙ_NÈŞ[˜Ú[™ÈÚ\™Y]K‹‹˜ˆØØ[Y\ÜØYÙJNÂˆÛÜÙUY\“[İ™QX[ÙÊ
NÂˆ™[™\•Y\”YÙJÛİ\˜ÙUY\ŠNÂˆ™[™\‘\Ú›Ø\™Ø]YÛÜT™\Ü

NÂˆYˆ
[[İ™YÛİ[
H™]\›ÂˆÛÛœİ™\İ[H]ØZ]Ø]™TÚ\™YY\“[İ™\Êœ™\XÙHŠNÂˆÙ]Y\“[İ™Tİ]\Ê™\İ[›ÚÈÈ	ÛØØ[Y\ÜØYÙ_NÈŞ[˜ÙY›Üˆ]™\[Û™Xˆ	ÛØØ[Y\ÜØYÙ_NÈØØ[Û›H
	Ü™\İ[™\œ›ÜŸJX
NÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ™\Ù]Y\“[İ™\Ê
HÂˆYˆ
Z\ÓX[X[Y\“[İ™\Ê
JH™]\›Âˆİ]K›X[X[Y\“[İ™\ÈHßNÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆ\œÚ\İX[X[Y\“[İ™\Ê
NÂˆ\SX[X[Y\“[İ™\Ê
NÂˆÙ]Y\“[İ™Tİ]\Ê“X[X[Y\ˆ[İ™\È™\Ù]ÈŞ[˜Ú[™ÈÚ\™Y]K‹‹ˆŠNÂˆ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÂˆ™[™\‘\Ú›Ø\™Ø]YÛÜT™\Ü

NÂˆÛÛœİ™\İ[H]ØZ]Ø]™TÚ\™YY\“[İ™\Ê˜ÛX\ˆŠNÂˆÙ]Y\“[İ™Tİ]\Ê™\İ[›ÚÈÈ“X[X[Y\ˆ[İ™\È™\Ù]›Üˆ]™\[Û™HˆˆX[X[Y\ˆ[İ™\È™\Ù]ØØ[HÛ›H
	Ü™\İ[™\œ›ÜŸJX
NÂˆB‚ˆ[˜İ[Ûˆ[™UY\”Ù[Xİ[ÛÚ[™ÙJ]™[
HÂˆÛÛœİÚXÚØ›ŞH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K]Y\‹\Ù[XİX[KÙ]K]Y\‹\Ù[Xİ\›İ×HŠNÂˆYˆ
XÚXÚØ›Ş
H™]\›ÂˆÙ]Y\“[İ™Tİ]\ÊˆŠNÂˆYˆ
ÚXÚØ›Ş™]\Ù]Y\”Ù[Xİ[OOH[™Yš[™Y
HÂˆÛÛœİš\ÚX›RÙ^\ÈHİ]Kš\ÚX›UY\”›İÒÙ^\È×NÂˆš\ÚX›RÙ^\Ë™›Ü‘XXÚ

Ù^JHOˆÂˆYˆ
ÚXÚØ›Ş˜ÚXÚÙY
Hİ]KœÙ[XİYY\”›İÒÙ^\Ë˜Y
Ù^JNÂˆ[ÙHİ]KœÙ[XİYY\”›İÒÙ^\Ë™[]JÙ^JNÂˆJNÂˆŞ[˜ÕY\[ĞÛÛ›ÛÊ
NÂˆ™]\›ÂˆBˆÛÛœİÙ^HHÚXÚØ›Ş™]\Ù]Y\”Ù[Xİ›İÈˆÂˆYˆ
ZÙ^JH™]\›ÂˆYˆ
ÚXÚØ›Ş˜ÚXÚÙY
Hİ]KœÙ[XİYY\”›İÒÙ^\Ë˜Y
Ù^JNÂˆ[ÙHİ]KœÙ[XİYY\”›İÒÙ^\Ë™[]JÙ^JNÂˆŞ[˜ÕY\[ĞÛÛ›ÛÊ
NÂˆB‚ˆ[˜İ[ÛˆÚY]›İÕ[š\]YU˜[Y\Ê›İÜËÙ^\ÊHÂˆ™]\›ˆ\œ˜^K™œ›ÛJ™]ÈÙ]
›İÜË›X\

›İÊHOˆİš[™Ê›İÕ˜[YJ›İËÙ^\ÊHˆŠKš[J
JK™š[\Š›ÛÛX[ŠJJKœÛÜ

KŠHOˆK›ØØ[PÛÛ\\™JŠJNÂˆB‚ˆ[˜İ[Ûˆ™Yœ™\ÚY\”ÚY]š[\œÊÚY]
HÂˆÛÛœİ›İÜÈHY\”ÚY]›İÜÑ›Ü‘\Ü^JÚY]
NÂˆÛÛœİİ\œ™[™]ÛÜšÈHİ]KY\”ÚY]š[\œË›™]ÛÜšÎÂˆÛÛœİİ\œ™[Ûİ[HHİ]KY\”ÚY]š[\œË˜Ûİ[NÂˆ™\XÙTÙ[XİÜ[ÛœÊ[ËY\”ÚY]™]ÛÜšË[™]ÛÜšÜÈ‹ÚY]›İÕ[š\]YU˜[Y\Ê›İÜËÈ“™]ÛÜšÈ‹YÙ[˜ŞH—JKİ\œ™[™]ÛÜšÊNÂˆ™\XÙTÙ[XİÜ[ÛœÊ[ËY\”ÚY]Ûİ[K[Ûİ[šY\È‹ÚY]›İÕ[š\]YU˜[Y\Ê›İÜËÈÓÕS•–H‹Ûİ[H—JKİ\œ™[Ûİ[JNÂˆİ]KY\”ÚY]š[\œË›™]ÛÜšÈH[ËY\”ÚY]™]ÛÜšË˜[YNÂˆİ]KY\”ÚY]š[\œË˜Ûİ[HH[ËY\”ÚY]Ûİ[K˜[YNÂˆ[ËY\”ÚY]ÙX\˜Ú˜[YHHİ]KY\”ÚY]š[\œËœÙX\˜ÚÂˆ[ËY\”ÚY]Z[‘\Ë˜[YHHİ]KY\”ÚY]š[\œË›Z[‘\ÎÂˆ[ËY\”ÚY]Z[”™]™[YK˜[YHHİ]KY\”ÚY]š[\œË›Z[”™]™[YNÂˆB‚ˆ[˜İ[ÛˆÙ]š[\™YY\”ÚY]›İÜÊÚY]
HÂˆÛÛœİÙX\˜ÚH›Ü›X[^™Jİ]KY\”ÚY]š[\œËœÙX\˜Ú
NÂˆÛÛœİZ[‘\ÈH[X™\Šİ]KY\”ÚY]š[\œË›Z[‘\È
NÂˆÛÛœİZ[”™]™[YHH[X™\Šİ]KY\”ÚY]š[\œË›Z[”™]™[YH
NÂˆ™]\›ˆY\”ÚY]›İÜÑ›Ü‘\Ü^JÚY]
Bˆ™š[\Š
›İÊHOˆ\ÙX\˜Ú›Ü›X[^™JØš™Xİ˜[Y\Ê›İÊKš›Ú[ŠˆŠJKš[˜ÛY\ÊÙX\˜Ú
JBˆ™š[\Š
›İÊHOˆİ]KY\”ÚY]š[\œË›™]ÛÜšÈOOH˜[ˆİš[™Ê›İÕ˜[YJ›İËÈ“™]ÛÜšÈ‹YÙ[˜ŞH—JJHOOHİ]KY\”ÚY]š[\œË›™]ÛÜšÊBˆ™š[\Š
›İÊHOˆİ]KY\”ÚY]š[\œË˜Ûİ[HOOH˜[ˆİš[™Ê›İÕ˜[YJ›İËÈÓÕS•–H‹Ûİ[H—JJHOOHİ]KY\”ÚY]š[\œË˜Ûİ[JBˆ™š[\Š
›İÊHOˆ\œÙTÚY][X™\Š›İÕ˜[YJ›İËÈ‘TÊY™ŠH‹Y™ˆTÈ‹˜XÚÙ[™TÈ‹‘TÈ‹‘TÊ[
H‹[TÈ—JJHHZ[‘\ÊBˆ™š[\Š
›İÊHOˆ\œÙTÚY][X™\Š›İÕ˜[YJ›İËÈ”™]™[YH‹”Ø[\È[[İ[‹”Ø[\È—JJHHZ[”™]™[YJNÂˆB‚ˆ[˜İ[ÛˆY\”›İÓY\˜Ú[Y
›İÊHÂˆ™]\›ˆİš[™Ê›İÕ˜[YJ›İËÈ“Y\˜Ú[Q‹“Y\˜Ú[Q‹’Q—JHˆŠKš[J
Kœ™\XÙJ×Œ	ËˆŠNÂˆB‚ˆ[˜İ[ÛˆY\”›İÓY\˜Ú[˜[YJ›İÊHÂˆ™]\›ˆİš[™Ê›İÕ˜[YJ›İËÈ“Y\˜Ú[˜[YH‹œ˜[™‹“Y\˜Ú[—JHˆŠKš[J
NÂˆB‚ˆ[˜İ[ÛˆÙ™™\‘›Ü•Y\”›İÊ›İÊHÂˆÛÛœİY\˜Ú[YHY\”›İÓY\˜Ú[Y
›İÊNÂˆ™]\›ˆY\˜Ú[YÈÙ™™\œĞSY\˜Ú[Y™Ù]
Y\˜Ú[Y
H[ˆ[ÂˆB‚ˆ[˜İ[ÛˆÙ™™\œÑ›Ü•Y\”›İÊ›İÊHÂˆÛÛœİY\˜Ú[YHY\”›İÓY\˜Ú[Y
›İÊNÂˆ™]\›ˆY\˜Ú[YÈÙ™™\‘Ü›İ\ĞSY\˜Ú[Y™Ù]
Y\˜Ú[Y
H×Hˆ×NÂˆB‚ˆ[˜İ[ÛˆY\”›İĞØ]YÛÜJ›İÊHÂˆÛÛœİÙ™™\ˆHÙ™™\‘›Ü•Y\”›İÊ›İÊNÂˆYˆ
Ù™™\ŠH™]\›ˆ\Ü^PØ]YÛÜJÙ™™\ŠH•[˜Ø]YÛÜš^™YÂˆ™]\›ˆÛX[Ø]YÛÜU˜[YJ›İÕ˜[YJ›İËÈØ]YÛÜH‹“XZ[ˆØ]YÛÜH‹“XZ[ˆØ]YÛÜH‹”ÚY]Ø]YÛÜH—JJH•[˜Ø]YÛÜš^™YÂˆB‚ˆ[˜İ[ÛˆY\”›İÓ[X™\Š›İËÙ^\ÊHÂˆ™]\›ˆ\œÙTÚY][X™\Š›İÕ˜[YJ›İËÙ^\ÊJNÂˆB‚ˆ[˜İ[ÛˆY\”›İÔ™]™[YJ›İÊHÂˆ™]\›ˆY\”›İÓ[X™\Š›İËÈ”™]™[YH‹”Ø[\È[[İ[‹”Ø[\È—JNÂˆB‚ˆ[˜İ[ÛˆY\”›İÓÜ™\œÊ›İÊHÂˆ™]\›ˆY\”›İÓ[X™\Š›İËÈ“Ü™\ˆÛİ[‹“Ü™\ˆÛİ[‹“Ü™\œÈ—JNÂˆB‚ˆ[˜İ[ÛˆY\”›İĞÛXÚÜÊ›İÊHÂˆ™]\›ˆY\”›İÓ[X™\Š›İËÈÛXÚÜÈ‹•İ[ÛXÚÜÈ—JNÂˆB‚ˆ[˜İ[ÛˆY\”›İÔ^[İ]
›İÊHÂˆÛÛœİ^[İ]H›İÕ˜[YJ›İËÈ”^[İ]‹•İ[ÛÛ[Z\ÜÚ[Ûˆ‹ÛÛ[Z\ÜÚ[ÛˆXYH—JNÂˆYˆ
^[İ]OOH[™Yš[™Y	‰ˆ^[İ]OOH[	‰ˆİš[™Ê^[İ]
Kš[J
HOOHˆŠHÂˆ™]\›ˆ\œÙTÚY][X™\Š^[İ]
NÂˆBˆ™]\›ˆY\”›İÓ[X™\Š›İËÈY™š[X]H^[İ]—JNÂˆB‚ˆ[˜İ[ÛˆY\”›İÑ\Ê›İÊHÂˆ™]\›ˆY\”›İÓ[X™\Š›İËÈ‘TÊY™ŠH‹Y™ˆTÈ‹˜XÚÙ[™TÈ‹‘TÈ‹‘TÊ[
H‹[TÈ—JNÂˆB‚ˆ[˜İ[ÛˆÛÛ\\™UY\Ø]YÛÜTİ[[X\T›İÜÊKŠHÂˆYˆ
K˜Ø]YÛÜHOOH•[˜Ø]YÛÜš^™Yˆ	‰ˆ‹˜Ø]YÛÜHOOH•[˜Ø]YÛÜš^™YŠH™]\›ˆNÂˆYˆ
‹˜Ø]YÛÜHOOH•[˜Ø]YÛÜš^™Yˆ	‰ˆK˜Ø]YÛÜHOOH•[˜Ø]YÛÜš^™YŠH™]\›ˆLNÂˆ™]\›ˆ[X™\Š‹œ™]™[YJHH[X™\ŠKœ™]™[YJHˆ[X™\Š‹›Ü™\œÊHH[X™\ŠK›Ü™\œÊHˆ[X™\Š‹›Y\˜Ú[Ûİ[
HH[X™\ŠK›Y\˜Ú[Ûİ[
Hˆİš[™ÊK˜Ø]YÛÜHˆŠK›ØØ[PÛÛ\\™Jİš[™Ê‹˜Ø]YÛÜHˆŠK[™Yš[™YÈ[Y\šXÎˆYKÙ[œÚ]]š]Nˆ˜˜\ÙHˆJNÂˆB‚ˆ[˜İ[ÛˆY\Ø]YÛÜTİ[[X\T›İÜÊÚY]›İÜÊHÂˆÛÛœİÜ›İ\ÈH™]ÈX\

NÂˆ
›İÜÈ×JK™›Ü‘XXÚ

›İÊHOˆÂˆÛÛœİØ]YÛÜHHY\”›İĞØ]YÛÜJ›İÊNÂˆYˆ
YÜ›İ\Ëš\ÊØ]YÛÜJJHÂˆÜ›İ\ËœÙ]
Ø]YÛÜKÂˆØ]YÛÜKˆ›İÜÎˆ×KˆY\˜Ú[YÎˆ™]ÈÙ]

Kˆ™]™[YNˆˆÜ™\œÎˆˆÛXÚÜÎˆˆ\ÕÙZYÚYPÛXÚÜÎˆˆ\Ôİ[Nˆˆ\ĞÛİ[ˆˆY\œ™XZÙİÛˆßBˆJNÂˆBˆÛÛœİÜ›İ\HÜ›İ\Ë™Ù]
Ø]YÛÜJNÂˆÛÛœİY\˜Ú[YHY\”›İÓY\˜Ú[Y
›İÊNÂˆÛÛœİÛXÚÜÈHY\”›İĞÛXÚÜÊ›İÊNÂˆÛÛœİ\ÈHY\”›İÑ\Ê›İÊNÂˆÛÛœİY\“˜[YHH›İË—×İY\“˜[YH
ÚY]	‰ˆÚY]›˜[YJHˆÂˆÜ›İ\œ›İÜËœ\Ú
›İÊNÂˆYˆ
Y\˜Ú[Y
HÜ›İ\›Y\˜Ú[YË˜Y
Y\˜Ú[Y
NÂˆÜ›İ\œ™]™[YH
ÏHY\”›İÔ™]™[YJ›İÊNÂˆÜ›İ\›Ü™\œÈ
ÏHY\”›İÓÜ™\œÊ›İÊNÂˆÜ›İ\˜ÛXÚÜÈ
ÏHÛXÚÜÎÂˆYˆ
Y\“˜[YJHÜ›İ\Y\œ™XZÙİÛ–İY\“˜[YWHH
Ü›İ\Y\œ™XZÙİÛ–İY\“˜[YWH
H
ÈNÂˆYˆ
\ÊHÂˆYˆ
ÛXÚÜÊHÜ›İ\™\ÕÙZYÚYPÛXÚÜÈ
ÏH\È
ˆÛXÚÜÎÂˆÜ›İ\™\Ôİ[H
ÏH\ÎÂˆÜ›İ\™\ĞÛİ[
ÏHNÂˆBˆJNÂ‚ˆ™]\›ˆ\œ˜^K™œ›ÛJÜ›İ\Ë˜[Y\Ê
JK›X\

Ü›İ\
HOˆÂˆÛÛœİÛÜY›İÜÈHÜ›İ\œ›İÜËœÛXÙJ
KœÛÜ

KŠHOˆY\”›İÔ™]™[YJŠHHY\”›İÔ™]™[YJJHY\”›İÓÜ™\œÊŠHHY\”›İÓÜ™\œÊJHY\”›İĞÛXÚÜÊŠHHY\”›İĞÛXÚÜÊJJNÂˆÛÛœİÜ›İÈHÛÜY›İÜÖÌHßNÂˆÛÛœİ™]šY]ÓY\˜Ú[ÈHÛÜY›İÜËœÛXÙJÊK›X\
Y\”›İÓY\˜Ú[˜[YJK™š[\Š›ÛÛX[ŠKš›Ú[Š‹ŠNÂˆ™]\›ˆÂˆØ]YÛÜNˆÜ›İ\˜Ø]YÛÜKˆ›İÜÎˆÛÜY›İÜËˆY\˜Ú[Ûİ[ˆÜ›İ\›Y\˜Ú[YËœÚ^™HÜ›İ\œ›İÜË›[™İˆ›İĞÛİ[ˆÜ›İ\œ›İÜË›[™İˆ™]™[YNˆÜ›İ\œ™]™[YKˆÜ™\œÎˆÜ›İ\›Ü™\œËˆÛXÚÜÎˆÜ›İ\˜ÛXÚÜËˆ]™ĞİœˆÜ›İ\˜ÛXÚÜÈÈÜ›İ\›Ü™\œÈÈÜ›İ\˜ÛXÚÜÈˆ[ˆ]™Ñ\ÎˆÜ›İ\˜ÛXÚÜÈ	‰ˆÜ›İ\™\ÕÙZYÚYPÛXÚÜÈÈÜ›İ\™\ÕÙZYÚYPÛXÚÜÈÈÜ›İ\˜ÛXÚÜÈˆ
Ü›İ\™\ĞÛİ[ÈÜ›İ\™\Ôİ[HÈÜ›İ\™\ĞÛİ[ˆ[
Kˆ]™Ğ[İˆÜ›İ\›Ü™\œÈÈÜ›İ\œ™]™[YHÈÜ›İ\›Ü™\œÈˆ[ˆÜY\˜Ú[ˆY\”›İÓY\˜Ú[˜[YJÜ›İÊKˆ™]šY]ÓY\˜Ú[ËˆY\œ™XZÙİÛˆÜ›İ\Y\œ™XZÙİÛ‚ˆNÂˆJKœÛÜ
ÛÛ\\™UY\Ø]YÛÜTİ[[X\T›İÜÊNÂˆB‚ˆ[˜İ[ÛˆY\Ø]YÛÜTİ[[X\UX›T›İÜÊÜ›İ\ÊHÂˆ™]\›ˆÜ›İ\Ë›X\

Ü›İ\
HOˆ‚ˆİ›Û™Ï‰Ù\ØØ\R[
Ü›İ\˜Ø]YÛÜJ_OÜİ›Û™Ï‰Ù\ØØ\R[
Ü›İ\œ™]šY]ÓY\˜Ú[È‹HŠ_OÜİ‚ˆ‰Û[X™\ŠÜ›İ\›Y\˜Ú[Ûİ[
KÓØØ[Tİš[™Ê
_Oİ‚ˆ‰ÜÚÜ[Û™^JÜ›İ\œ™]™[YJ_Oİ‚ˆ‰Û[X™\ŠÜ›İ\›Ü™\œÊKÓØØ[Tİš[™Ê
_Oİ‚ˆ‰ÜÚÜİ
Ü›İ\˜]™ĞİœŠ_Oİ‚ˆ‰ÜÚÜ\ÊÜ›İ\˜]™Ñ\Ê_Oİ‚ˆ‰Ù\ØØ\R[
Ü›İ\ÜY\˜Ú[‹HŠ_Oİ‚ˆİ˜
Kš›Ú[ŠˆŠNÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\Ø]YÛÜTİ[[X\JÚY]›İÜÊHÂˆÛÛœİÜ›İ\ÈHY\Ø]YÛÜTİ[[X\T›İÜÊÚY]›İÜÊNÂˆÛÛœİİ[™]™[YHHÜ›İ\Ëœ™YXÙJ
İ[KÜ›İ\
HOˆİ[H
È[X™\ŠÜ›İ\œ™]™[YJK
NÂˆÛÛœİİ[Ü™\œÈHÜ›İ\Ëœ™YXÙJ
İ[KÜ›İ\
HOˆİ[H
È[X™\ŠÜ›İ\›Ü™\œÊK
NÂˆÛÛœİİ[ÛXÚÜÈHÜ›İ\Ëœ™YXÙJ
İ[KÜ›İ\
HOˆİ[H
È[X™\ŠÜ›İ\˜ÛXÚÜÊK
NÂˆÛÛœİY\˜Ú[Ûİ[HÜ›İ\Ëœ™YXÙJ
İ[KÜ›İ\
HOˆİ[H
È[X™\ŠÜ›İ\›Y\˜Ú[Ûİ[
K
NÂˆ[ËY\Ø]YÛÜTİ[[X\Kš[›™\’SH]ˆÛ\ÜÏHY\‹XØ]YÛÜKZXY\ˆ‚ˆ]‚ˆÏØ]YÛÜK]Ú\ÙH™\ÜÚÏ‚ˆ‰Û[X™\Š›İÜË›[™İ
KÓØØ[Tİš[™Ê
_H›İÜÈÈ	Û[X™\ŠÜ›İ\Ë›[™İ
KÓØØ[Tİš[™Ê
_HØ]YÛÜšY\ÏÜ‚ˆÙ]‚ˆ‚ˆ]‰Ù\ØØ\R[
X™[^
“Y\˜Ú[ÈŠJ_OÙ‰ÛY\˜Ú[Ûİ[ÓØØ[Tİš[™Ê
_OÙÙ]‚ˆ]‰Ù\ØØ\R[
X™[^
”™]™[YHŠJ_OÙ‰ÜÚÜ[Û™^Jİ[™]™[YJ_OÙÙ]‚ˆ]‰Ù\ØØ\R[
X™[^
“Ü™\œÈŠJ_OÙ‰İİ[Ü™\œËÓØØ[Tİš[™Ê
_OÙÙ]‚ˆ]‰Ù\ØØ\R[
X™[^
Õ”ˆŠJ_OÙ‰ÜÚÜİ
İ[ÛXÚÜÈÈİ[Ü™\œÈÈİ[ÛXÚÜÈˆ[
_OÙÙ]‚ˆÙ‚ˆÙ]‚ˆ]ˆÛ\ÜÏHX›K]Ü˜\Y\‹XØ]YÛÜK]X›K]Ü˜\‚ˆX›HÛ\ÜÏHœÚY]]X›HY\‹XØ]YÛÜK]X›H‚ˆXY‚ˆ‚ˆ‰Ù\ØØ\R[
X™[^
Ø]YÛÜHŠJ_Oİ‚ˆ‰Ù\ØØ\R[
X™[^
“Y\˜Ú[ÈŠJ_Oİ‚ˆ‰Ù\ØØ\R[
X™[^
”™]™[YHŠJ_Oİ‚ˆ‰Ù\ØØ\R[
X™[^
“Ü™\œÈŠJ_Oİ‚ˆ‰Ù\ØØ\R[
X™[^
Õ”ˆŠJ_Oİ‚ˆ‘TÏİ‚ˆ•ÜY\˜Ú[İ‚ˆİ‚ˆİXY‚ˆ›ÙO‰ÙÜ›İ\Ë›[™İÈY\Ø]YÛÜTİ[[X\UX›T›İÜÊÜ›İ\ÊHˆÛÛÜ[HÈ“›ÈØ]YÛÜH›İÜÈX]ÚHİ\œ™[š[\œËİİ˜Oİ›ÙO‚ˆİX›O‚ˆÙ]˜ÂˆB‚ˆ[˜İ[ÛˆY\Ø]YÛÜTİ[[X\Q^ÜXY\œÊ
HÂˆ™]\›ˆÈØ]YÛÜH‹“Y\˜Ú[Ûİ[‹”›İÈÛİ[‹”™]™[YH‹“Ü™\œÈ‹ÛXÚÜÈ‹]™ÈÛÛ™\œÚ[Ûˆ‹]™ÈTÈ‹SÕˆ‹•ÜY\˜Ú[‹•ÜY\˜Ú[È—NÂˆB‚ˆ[˜İ[ÛˆY\Ø]YÛÜTİ[[X\Q^Ü›İÜÊÚY]›İÜÊHÂˆ™]\›ˆY\Ø]YÛÜTİ[[X\T›İÜÊÚY]›İÜÊK›X\

Ü›İ\
HOˆ
ÂˆØ]YÛÜHˆÜ›İ\˜Ø]YÛÜKˆ“Y\˜Ú[Ûİ[ˆÜ›İ\›Y\˜Ú[Ûİ[ˆ”›İÈÛİ[ˆÜ›İ\œ›İĞÛİ[ˆ”™]™[YHˆÜ›İ\œ™]™[YKˆ“Ü™\œÈˆÜ›İ\›Ü™\œËˆÛXÚÜÈˆÜ›İ\˜ÛXÚÜËˆ]™ÈÛÛ™\œÚ[ÛˆˆÜ›İ\˜]™Ğİœ‹ˆ]™ÈTÈˆÜ›İ\˜]™Ñ\ËˆSÕˆˆÜ›İ\˜]™Ğ[İ‹ˆ•ÜY\˜Ú[ˆÜ›İ\ÜY\˜Ú[ˆ•ÜY\˜Ú[ÈˆÜ›İ\œ™]šY]ÓY\˜Ú[ÂˆJJNÂˆB‚ˆ[˜İ[Ûˆ]™\˜YÙPÛÛ[Z\ÜÚ[Û”˜]Q›Ü•Y\”›İÊ›İÊHÂˆÛÛœİ˜]\ÈHÙ™™\œÑ›Ü•Y\”›İÊ›İÊBˆ›X\

Ù™™\ŠHOˆ[X™\ŠÙ™™\‹˜ÛÛ[Z\ÜÚ[Û”˜]JJBˆ™š[\Š
˜]JHOˆ[X™\‹š\Ñš[š]J˜]JJNÂˆYˆ
\˜]\Ë›[™İ
H™]\›ˆ[Âˆ™]\›ˆ˜]\Ëœ™YXÙJ
İ[K˜]JHOˆİ[H
È˜]K
HÈ˜]\Ë›[™İÂˆB‚ˆ[˜İ[Ûˆ›İ[™Y\ÛÛ[Z\ÜÚ[Û”˜]U^
›İÊHÂˆÛÛœİ˜]HH]™\˜YÙPÛÛ[Z\ÜÚ[Û”˜]Q›Ü•Y\”›İÊ›İÊNÂˆYˆ
˜]HOOH[
H™]\›ˆˆÂˆ™]\›ˆ	ÓX]˜ÙZ[
˜]H
ˆL
_IXÂˆB‚ˆ[˜İ[ÛˆY\“Ù™™\“\İ^ÜXY\œÊ
HÂˆ™]\›ˆÈ“Y\˜Ú[Q‹“Y\˜Ú[˜[YH‹Ø]YÛÜH‹]™ÈÛÛ[Z\ÜÚ[Ûˆ˜]H—NÂˆB‚ˆ[˜İ[ÛˆY\“Ù™™\“\İ^Ü›İÜÊÚY]›İÜÊHÂˆ™]\›ˆ
›İÜÈ×JK›X\

›İÊHOˆ
Âˆ“Y\˜Ú[QˆY\”›İÓY\˜Ú[Y
›İÊKˆ“Y\˜Ú[˜[YHˆY\”›İÓY\˜Ú[˜[YJ›İÊKˆØ]YÛÜHˆY\”›İĞØ]YÛÜJ›İÊKˆ]™ÈÛÛ[Z\ÜÚ[Ûˆ˜]Hˆ›İ[™Y\ÛÛ[Z\ÜÚ[Û”˜]U^
›İÊBˆJJNÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\”™\Ü[™[™ÊY\“˜[YKY\ÜØYÙJHÂˆ™[™\•Y\ŒSX[˜YÙ[Y[
Y\“˜[YJNÂˆ[ËY\”YÙU]K^ÛÛ[HY\“˜[YNÂˆ[ËY\”YÙTİX]K^ÛÛ[H	İY\”™\Ü˜[™ÙSX™[
İ]KY\”™\Üœİ\]Kİ]KY\”™\Ü™[™]J_HÈYXZ›Û[ÜÈ[X^›Ûˆ™\Ü]X˜\ÙXÂˆ[ËY\”YÙTİ[[X\Kš[›™\’SHˆÂˆ[ËY\”YÙS›İ\Ëš[›™\’SH‰Ù\ØØ\R[
Y\ÜØYÙJ_OÜ˜Âˆ[ËY\Ø]YÛÜTİ[[X\Kš[›™\’SHˆÂˆ[ËY\”ÚY]XYš[›™\’SHˆÂˆ[ËY\”ÚY]›İÜËš[›™\’SH‰Ù\ØØ\R[
Y\ÜØYÙJ_Oİİ˜Âˆ[ËY\•X›U]K^ÛÛ[H[X^›Ûˆ™\Ü™XÛÜ™ÈÂˆ[ËY\•X›PÛİ[^ÛÛ[HˆÂˆ™[™\•Y\”YÚ[˜][ÛŠY\“˜[YK[
NÂˆ™[™\•Y\ÛÛ[[”[™[
[×K×JNÂˆİ]Kš\ÚX›UY\”›İÒÙ^\ÈH×NÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆŞ[˜ÕY\[ĞÛÛ›ÛÊ
NÂˆÛÜÙUY\”ÚY]İ™\›^JÈ™\İÜ™Q›Øİ\Îˆ˜[ÙHJNÂˆŞ[˜ÕY\”ÚY]İ™\›^J
NÂˆB‚ˆ[˜İ[Ûˆ™[™\•Y\”YÙJY\“˜[YJHÂˆ™[™\•Y\ŒSX[˜YÙ[Y[
Y\“˜[YJNÂˆÙ]Y\”™\ÜÛÛ›ÛÊY\“˜[YJNÂˆYˆ
ÕS‘T‘ĞĞUQÓÔ–WÔ‘TÔ•ÕQT”Ëš[˜ÛY\ÊY\“˜[YJJHÂˆÛÛœİ\[™[˜ÚY\ÈHY\”™\Ü\[™[˜ŞUY\œÊY\“˜[YJNÂˆÛÛœİZ\ÜÚ[™ÈH\[™[˜ÚY\Ë™š[\Š
\[™[˜ŞUY\ŠHOˆ
ˆ\İ]KY\”™\Üœ^[ØYËš\ÊY\”™\ÜÙ^J\[™[˜ŞUY\ŠJBˆ
JNÂˆYˆ
Z\ÜÚ[™Ë›[™İ
HÂˆÛÛœİ˜Z[YY\ˆHZ\ÜÚ[™Ë™š[™

\[™[˜ŞUY\ŠHOˆİ]KY\”™\Ü™\œ›ÜœËš\ÊY\”™\ÜÙ^J\[™[˜ŞUY\ŠJJNÂˆÛÛœİ\œ›ÜˆH˜Z[YY\ˆÈİ]KY\”™\Ü™\œ›ÜœË™Ù]
Y\”™\ÜÙ^J˜Z[YY\ŠJHˆˆÂˆ™[™\•Y\”™\Ü[™[™ÊˆY\“˜[YKˆ\œ›Ü‚ˆÈÛİ[›İØY	Ù˜Z[YY\ŸH›ÜˆHÙ[XİY˜[™ÙNˆ	Ù\œ›ÜŸXˆˆ“ØY[™ÈHÙ[XİYYXZ›Û[ÜÈ™\Ü˜[™Ùx )ˆ‚ˆ
NÂˆZ\ÜÚ[™Ë™›Ü‘XXÚ

\[™[˜ŞUY\ŠHOˆÂˆÛÛœİ\[™[˜ŞRÙ^HHY\”™\ÜÙ^J\[™[˜ŞUY\ŠNÂˆYˆ
\İ]KY\”™\Ü™\œ›ÜœËš\Ê\[™[˜ŞRÙ^JJHÂˆØYY\”™\Ü
\[™[˜ŞUY\‹İ]KY\”™\Üœİ\]Kİ]KY\”™\Ü™[™]JNÂˆBˆJNÂˆ™]\›ÂˆBˆ\[™[˜ÚY\Ë™›Ü‘XXÚ

\[™[˜ŞUY\ŠHOˆÂˆÛÛœİ\[™[˜ŞRÙ^HHY\”™\ÜÙ^J\[™[˜ŞUY\ŠNÂˆXİ]˜]UY\”™\Ü^[ØY
\[™[˜ŞUY\‹\[™[˜ŞRÙ^Kİ]KY\”™\Üœ^[ØYË™Ù]
\[™[˜ŞRÙ^JJNÂˆJNÂˆBˆÛÛœİÚY]HÚY]S˜[YJY\“˜[YJNÂˆ[ËY\”YÙU]K^ÛÛ[HY\“˜[YNÂˆ[ËY\”YÙTİX]K^ÛÛ[HÚY]ˆÈ
ÕS‘T‘ĞĞUQÓÔ–WÔ‘TÔ•ÕQT”Ëš[˜ÛY\ÊY\“˜[YJBˆÈ	İY\”™\Ü˜[™ÙSX™[
İ]KY\”™\Üœİ\]Kİ]KY\”™\Ü™[™]J_HÈYXZ›Û[ÜÈ[X^›Ûˆ™\Ü]X˜\ÙXˆˆ	ÜÚY]]_HÈ]X˜\ÙHÛ˜\Úİ
Bˆˆ•Y\ˆ]H›İ›İ[™ÂˆYˆ
\ÚY]
HÂˆ[ËY\”YÙTİ[[X\Kš[›™\’SHˆÂˆ[ËY\”YÙS›İ\Ëš[›™\’SH‰Ù\ØØ\R[

Y\‹››ÓX]Ú‹“›ÈX]Ú[™ÈY\ˆ]HØ\È›İ[™ˆŠJ_OÜ˜Âˆ[ËY\Ø]YÛÜTİ[[X\Kš[›™\’SHˆÂˆ[ËY\”ÚY]XYš[›™\’SHˆÂˆ[ËY\”ÚY]›İÜËš[›™\’SHˆÂˆ[ËY\•X›PÛİ[^ÛÛ[HˆÂˆ™[™\•Y\”YÚ[˜][ÛŠY\“˜[YK[
NÂˆ™[™\•Y\ÛÛ[[”[™[
[×K×JNÂˆİ]Kš\ÚX›UY\”›İÒÙ^\ÈH×NÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆŞ[˜ÕY\[ĞÛÛ›ÛÊ
NÂˆÛÜÙUY\”ÚY]İ™\›^JÈ™\İÜ™Q›Øİ\Îˆ˜[ÙHJNÂˆŞ[˜ÕY\”ÚY]İ™\›^J
NÂˆ™]\›ÂˆBˆ™Yœ™\ÚY\”ÚY]š[\œÊÚY]
NÂˆ™[™\•Y\”İ[[X\JÚY]
NÂˆ[ËY\”YÙS›İ\Ëš[›™\’SH™[™\•Y\“ÙÚXÔİ[[X\JÚY]
NÂˆÛÛœİš[\™Y›İÜÈHÙ]š[\™YY\”ÚY]›İÜÊÚY]
NÂˆ™[™\•Y\Ø]YÛÜTİ[[X\JÚY]š[\™Y›İÜÊNÂˆÛÛœİYÚ[˜][ÛˆHY\“˜[YHOOH•Y\ˆ‚ˆÈÈYÙNˆİ]KY\•X›TYÙ\ÖİY\“˜[YWHKYÙTÚ^™NˆQT—ÕP“WÔQÑWÔÒV‘HBˆˆ[Âˆ™[™\”ÚY]X›JÚY][ËY\•X›U]K[ËY\•X›PÛİ[[ËY\”ÚY]XY[ËY\”ÚY]›İÜËš[\™Y›İÜËYÚ[˜][ÛŠNÂˆŞ[˜ÕY\”ÚY]İ™\›^J
NÂˆB‚ˆ[˜İ[Ûˆ\™Ù]İ™\œšYRÙ^J™XÛÜ™
HÂˆ™]\›ˆ	Ü™XÛÜ™—×Û[ÛÙ^H™XÛÜ™“[Û[šÛ›İÛˆŸN‰Ü™XÛÜ™•Y\ˆ[šÛ›İÛˆŸXÂˆB‚ˆ[˜İ[Ûˆ\U\™Ù]İ™\œšYJ™XÛÜ™
HÂˆÛÛœİÙ^HH\™Ù]İ™\œšYRÙ^J™XÛÜ™
NÂˆÛÛœİİ™\œšYHHİ]K\™Ù]İ™\œšY\È	‰ˆİ]K\™Ù]İ™\œšY\ÖÚÙ^WNÂˆYˆ
İ™\œšYHOOH[™Yš[™Y	‰ˆİš[™Êİ™\œšYJKš[J
HOOHˆŠHÂˆÛÛœİØ[™Y]HHÈ‹‹œ™XÛÜ™\™Ù]ˆİ™\œšYHNÂˆYˆ
\™Ù]ÛØ[
Ø[™Y]JJHÂˆ™XÛÜ™•\™Ù]Hİ™\œšYNÂˆH[ÙHÂˆ™XÛÜ™—×Ú[˜[Y\™Ù]İ™\œšYHHİ™\œšYNÂˆBˆBˆ™XÛÜ™—×İ\™Ù]İ™\œšYRÙ^HHÙ^NÂˆ™]\›ˆ™XÛÜ™ÂˆB‚ˆ[˜İ[Ûˆİ\œ™[™\Ü[™Ó[ÛÙ^J™Y™\™[˜ÙQ]HH™]È]J
JHÂˆ™]\›ˆØØ[]RÙ^J™Y™\™[˜ÙQ]JKœÛXÙJÊNÂˆB‚ˆ[˜İ[ÛˆÚY[ÛÙ^J[ÛÙ^KÙ™œÙ]
HÂˆÛÛœİ›Ü›X[^™Y[ÛÙ^HH[ÛÙ^Qœ›ÛU^
[ÛÙ^JNÂˆYˆ
[›Ü›X[^™Y[ÛÙ^JH™]\›ˆˆÂˆÛÛœİ]HH™]È]J	Û›Ü›X[^™Y[ÛÙ^_KLUŒŒ
NÂˆYˆ
[X™\‹š\Ó˜SŠ]K™Ù][YJ
JJH™]\›ˆˆÂˆ]KœÙ][Û
]K™Ù][Û

H
È[X™\ŠÙ™œÙ]
JNÂˆ™]\›ˆØØ[]RÙ^J]JKœÛXÙJÊNÂˆB‚ˆ[˜İ[Ûˆ™\Üİ™\šY]Ó[ÛÙ^\Ê™Y™\™[˜ÙS[ÛÙ^HHİ\œ™[™\Ü[™Ó[ÛÙ^J
JHÂˆ™]\›ˆ\œ˜^K™œ›ÛJ™]ÈÙ]
Âˆ‹‹”‘TÔ•ÓÕ‘T•’QU×Ô‘TURT‘QÓSÓ•ÒÑVTËˆ‹‹”‘TÔ•ÓÕ‘T•’QU×ÓSÓ•ÓÑ‘”ÑUË›X\

Ù™œÙ]
HOˆÚY[ÛÙ^J™Y™\™[˜ÙS[ÛÙ^KÙ™œÙ]
JBˆJJBˆ™š[\Š›ÛÛX[ŠBˆœÛÜ

NÂˆB‚ˆ[˜İ[Ûˆ[œİ\™T™\Ü[™Ó[Û™XÛÜ™
™XÛÜ™Ë[ÛÙ^HHİ\œ™[™\Ü[™Ó[ÛÙ^J
JHÂˆÛÛœİ›Ü›X[^™Y[ÛÙ^HH[ÛÙ^Qœ›ÛU^
[ÛÙ^JNÂˆÛÛœİ›Ü›X[^™Y™XÛÜ™ÈH\œ˜^Kš\Ğ\œ˜^J™XÛÜ™ÊHÈ™XÛÜ™ËœÛXÙJ
Hˆ×NÂˆYˆ
[›Ü›X[^™Y[ÛÙ^H›Ü›X[^™Y™XÛÜ™ËœÛÛYJ
™XÛÜ™
HOˆ[ÛÙ^Qœ›ÛU^
™XÛÜ™—×Û[ÛÙ^JHOOH›Ü›X[^™Y[ÛÙ^JJHÂˆ™]\›ˆ›Ü›X[^™Y™XÛÜ™ÎÂˆBˆ™]\›ˆ›Ü›X[^™Y™XÛÜ™Ë˜ÛÛ˜Ø]
\U\™Ù]İ™\œšYJÂˆ[Ûˆ[Û^\ÓX™[
›Ü›X[^™Y[ÛÙ^JKˆ×Û[ÛÙ^Nˆ›Ü›X[^™Y[ÛÙ^Kˆ×Ù]X˜\ÙSÛ›NˆYKˆY\ˆ•İ[‹ˆœ˜[™Ûİ[ˆˆ•İ[ÛXÚÜÈˆˆ“Ü™\ˆÛİ[ˆˆ™]™[YNˆˆ]™ÈÛÛ™\œÚ[Ûˆˆˆ“™]ÈY\ˆ[šY\Èˆˆ•Y\ˆ^]Èˆˆ\™Ù]ˆˆ‚ˆJJNÂˆB‚ˆ[˜İ[Ûˆ[œİ\™T™\Üİ™\šY]Ó[Û™XÛÜ™Ê™XÛÜ™Ë™Y™\™[˜ÙS[ÛÙ^HHİ\œ™[™\Ü[™Ó[ÛÙ^J
JHÂˆ™]\›ˆ™\Üİ™\šY]Ó[ÛÙ^\Ê™Y™\™[˜ÙS[ÛÙ^JBˆœ™YXÙJ
[Û™XÛÜ™Ë[ÛÙ^JHOˆ[œİ\™T™\Ü[™Ó[Û™XÛÜ™
[Û™XÛÜ™Ë[ÛÙ^JK\œ˜^Kš\Ğ\œ˜^J™XÛÜ™ÊHÈ™XÛÜ™Èˆ×JNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™\Ù]™XÛÜ™
[ÛÙ^KY\‹™\Ù]
HÂˆÛÛœİXİX[ÈH™\Ù]˜XİX[ÈßNÂˆ™]\›ˆÂˆ[Ûˆ[Û^\ÓX™[
[ÛÙ^JKˆ×Û[ÛÙ^Nˆ[ÛÙ^Kˆ×Ù]X˜\ÙSÛ›NˆYKˆ×ÜÛİ\˜ÙNˆ™\šYšYY]Y\‹\Û˜\Úİ‹ˆY\ˆY\‹ˆœ˜[™Ûİ[ˆXİX[Ë˜œ˜[™Ûİ[ˆ•İ[ÛXÚÜÈˆXİX[Ë˜ÛXÚÜÈˆ“Ü™\ˆÛİ[ˆXİX[Ë›Ü™\œÈˆ™]™[YNˆXİX[Ëœ™]™[YHˆ^[İ]ˆXİX[Ëœ^[İ]ˆ]™ÈÛÛ™\œÚ[ÛˆˆXİX[Ë˜ÛÛ™\œÚ[Ûˆˆ“™]ÈY\ˆ[šY\ÈˆXİX[Ë›™]ÕY\‘[šY\Èˆ•Y\ˆ^]ÈˆXİX[ËY\‘^]Èˆ\™Ù]ˆ™\Ù]\™Ù]ˆ‚ˆNÂˆB‚ˆ[˜İ[ÛˆÚ]\™Ù][Û™\Ù]Ê™XÛÜ™ÊHÂˆÛÛœİY\™ÙYH\œ˜^Kš\Ğ\œ˜^J™XÛÜ™ÊHÈ™XÛÜ™Ë›X\

™XÛÜ™
HOˆ
È‹‹œ™XÛÜ™JJHˆ×NÂˆØš™Xİ™[šY\ÊT‘ÑUÓSÓ•Ô‘TÑUÊK™›Ü‘XXÚ

Û[ÛÙ^KY\œ×JHOˆÂˆØš™Xİ™[šY\ÊY\œÊK™›Ü‘XXÚ

İY\‹™\Ù]JHOˆÂˆÛÛœİ[™^HY\™ÙY™š[™[™^

™XÛÜ™
HOˆ
ˆ[ÛÙ^Qœ›ÛU^
™XÛÜ™—×Û[ÛÙ^H™XÛÜ™“[Û
HOOH[ÛÙ^H	‰‚ˆİš[™Ê™XÛÜ™•Y\ˆˆŠKš[J
KÓİÙ\Ø\ÙJ
HOOHY\‹ÓİÙ\Ø\ÙJ
Bˆ
JNÂˆYˆ
[™^
HÂˆY\™ÙYœ\Ú
\™Ù]™\Ù]™XÛÜ™
[ÛÙ^KY\‹™\Ù]
JNÂˆ™]\›ÂˆBˆÛÛœİ™XÛÜ™HY\™ÙYÚ[™^NÂˆÛÛœİ˜[˜XÚÈH\™Ù]™\Ù]™XÛÜ™
[ÛÙ^KY\‹™\Ù]
NÂˆÛÛœİ\Ñ]X˜\ÙSY]šXÜÈH™XÛÜ™—×ÜÛİ\˜ÙHOOH™]X˜\ÙHÂˆÛÛœİ\ÔÚY]Y]šXÜÈH\™XÛÜ™—×Ù]X˜\ÙSÛ›H	‰ˆ
ˆ\œÙTÚY][X™\Š™XÛÜ™Èœ˜[™Ûİ[—JHˆˆ\œÙTÚY][X™\Š™XÛÜ™È•İ[ÛXÚÜÈ—JHˆˆ\œÙTÚY][X™\Š™XÛÜ™È“Ü™\ˆÛİ[—JHˆˆ\œÙTÚY][X™\Š™XÛÜ™”™]™[YJHˆˆ
NÂˆÛÛœİY˜]YH
\Ñ]X˜\ÙSY]šXÜÈ\ÔÚY]Y]šXÜÊHÈÈ‹‹œ™XÛÜ™HˆÈ‹‹œ™XÛÜ™‹‹™˜[˜XÚÈNÂˆYˆ
Tİš[™ÊY˜]Y•\™Ù]ˆŠKš[J
JHY˜]Y•\™Ù]H™\Ù]\™Ù]ˆÂˆYˆ
ˆ™\Ù]˜XİX[È	‰‚ˆ™\Ù]˜XİX[ËY\‘^]ÈOOH[™Yš[™Y	‰‚ˆ\™XÛÜ™—×İY\‘^]Ğ]˜Z[X›H	‰‚ˆ
™XÛÜ™—×Ù]X˜\ÙSÛ›Hİš[™Ê™XÛÜ™È•Y\ˆ^]È—HÏÈˆŠKš[J
HOOHˆŠBˆ
HÂˆY˜]YÈ•Y\ˆ^]È—HH™\Ù]˜XİX[ËY\‘^]ÎÂˆBˆY\™ÙYÚ[™^HHY˜]YÂˆJNÂˆJNÂˆ™]\›ˆY\™ÙY›X\

™XÛÜ™
HOˆ\U\™Ù]İ™\œšYJ™XÛÜ™
JNÂˆB‚ˆ[˜İ[Ûˆ•\™Ù]™XÛÜ™Ñœ›ÛUY\”İ[[X\J
HÂˆÛÛœİ‘]HHİ]K™•Y\”İ[[X\H	‰ˆİ]K™•Y\”İ[[X\K™]NÂˆYˆ
Y‘]HY‘]K›ÚÈY‘]K›[ÛY‘]KY\œÈY‘]KY\œË›[™İ
H™]\›ˆ[ÂˆÛÛœİ[ÛÙ^HH‘]K›[ÛÂˆÛÛœİ]HH™]È]J	Û[ÛÙ^_KLUŒŒ
NÂˆÛÛœİ[ÛH[X™\‹š\Ó˜SŠ]K™Ù][YJ
JBˆÈ[ÛÙ^Bˆˆ]KÓØØ[Tİš[™Ê™[‹UTÈ‹È[Ûˆ›Û™È‹YX\ˆ›[Y\šXÈˆJNÂˆÛÛœİ™XÛÜ™ÈH‘]KY\œË›X\


HO‚ˆ\U\™Ù]İ™\œšYJÂˆ[Ûˆ[Ûˆ×Û[ÛÙ^Nˆ[ÛÙ^Kˆ×Ù]X˜\ÙSÛ›NˆYKˆ×ÜÛİ\˜ÙNˆ™]X˜\ÙH‹ˆY\ˆY\‹ˆœ˜[™Ûİ[ˆ˜œ˜[™Ûİ[ˆ•İ[ÛXÚÜÈˆ˜ÛXÚÜËˆ“Ü™\ˆÛİ[ˆ›Ü™\œËˆ™]™[YNˆœ™]™[YKˆ^[İ]ˆœ^[İ]ˆ]™ÈÛÛ™\œÚ[Ûˆˆ˜ÛÛ™\œÚ[Û”˜]Kˆ“™]ÈY\ˆ[šY\Èˆ›™]Ñ[šY\Èˆ•Y\ˆ^]ÈˆY\‘^]Èˆ×İY\‘^]Ğ]˜Z[X›NˆY\‘^]ÈOOH[™Yš[™Y	‰ˆY\‘^]ÈOOH[ˆ\™Ù]ˆˆ‚ˆJBˆ
NÂˆÛÛœİİ[H‘]Kİ[ÂˆYˆ
İ[
HÂˆ™XÛÜ™Ëœ\Ú
\U\™Ù]İ™\œšYJÂˆ[Ûˆ[Ûˆ×Û[ÛÙ^Nˆ[ÛÙ^Kˆ×Ù]X˜\ÙSÛ›NˆYKˆ×ÜÛİ\˜ÙNˆ™]X˜\ÙH‹ˆY\ˆ•İ[‹ˆœ˜[™Ûİ[ˆİ[˜œ˜[™Ûİ[ˆ•İ[ÛXÚÜÈˆİ[˜ÛXÚÜËˆ“Ü™\ˆÛİ[ˆİ[›Ü™\œËˆ™]™[YNˆİ[œ™]™[YKˆ^[İ]ˆİ[œ^[İ]ˆ]™ÈÛÛ™\œÚ[Ûˆˆİ[˜ÛÛ™\œÚ[Û”˜]Kˆ“™]ÈY\ˆ[šY\Èˆİ[›™]Ñ[šY\Èˆ•Y\ˆ^]Èˆİ[Y\‘^]Èˆ×İY\‘^]Ğ]˜Z[X›Nˆİ[Y\‘^]ÈOOH[™Yš[™Y	‰ˆİ[Y\‘^]ÈOOH[ˆ\™Ù]ˆˆ‚ˆJJNÂˆBˆ™]\›ˆÚ]\™Ù][Û™\Ù]Ê[œİ\™T™\Üİ™\šY]Ó[Û™XÛÜ™Ê™XÛÜ™ÊJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™XÛÜ™Ê
HÂˆÛÛœİ”™XÛÜ™ÈH•\™Ù]™XÛÜ™Ñœ›ÛUY\”İ[[X\J
NÂˆYˆ
”™XÛÜ™ÊH™]\›ˆ”™XÛÜ™ÎÂ‚ˆÛÛœİÚY]HÚY]S˜[YJ•Y\ˆİ[[X\H	ˆ\™Ù]ŠNÂˆÛÛœİÜšYH
ÚY]	‰ˆÚY]™ÜšY
H×NÂˆÛÛœİ™XÛÜ™ÈH×NÂˆ]XY\œÈH×NÂˆ]İ\œ™[[ÛHˆÂˆ]İ\œ™[[ÛÙ^HHˆÂˆÜšY™›Ü‘XXÚ

›İÊHOˆÂˆÛÛœİš\œİHİš[™Ê›İÖÌHˆŠKš[J
NÂˆÛÛœİY\ˆHİš[™Ê›İÖÌWHˆŠKš[J
NÂˆYˆ
›İËœÛÛYJ
˜[YJHOˆİš[™Ê˜[YHˆŠKš[J
HOOH•Y\ˆŠJHÂˆXY\œÈH›İË›X\

˜[YJHOˆİš[™Ê˜[YHˆŠKš[J
JNÂˆ™]\›ÂˆBˆYˆ
š\œİ	‰ˆ×—ÍKWÌŸKWÌŸKË\İ
š\œİ
JHÂˆÛÛœİ]HH™]È]J	Ùš\œİœÛXÙJL
_UŒŒ
NÂˆİ\œ™[[ÛÙ^HHš\œİœÛXÙJÊNÂˆİ\œ™[[ÛH[X™\‹š\Ó˜SŠ]K™Ù][YJ
JBˆÈš\œİˆˆ]KÓØØ[Tİš[™Ê™[‹UTÈ‹È[Ûˆ›Û™È‹YX\ˆ›[Y\šXÈˆJNÂˆBˆYˆ
ZXY\œË›[™İ]Y\ŠH™]\›ÂˆÛÛœİ™XÛÜ™HÈ[Ûˆİ\œ™[[Û×Û[ÛÙ^Nˆİ\œ™[[ÛÙ^HNÂˆXY\œË™›Ü‘XXÚ

XY\‹[™^
HOˆÂˆYˆ
ZXY\ŠH™]\›Âˆ™XÛÜ™ÚXY\—HH›İÖÚ[™^HˆÂˆJNÂˆ™XÛÜ™—×ÜÛİ\˜ÙU\™Ù]H™XÛÜ™•\™Ù]ˆÂˆYˆ
™XÛÜ™•Y\ŠH™XÛÜ™Ëœ\Ú
\U\™Ù]İ™\œšYJ™XÛÜ™
JNÂˆJNÂˆ™]\›ˆÚ]\™Ù][Û™\Ù]Ê[œİ\™T™\Üİ™\šY]Ó[Û™XÛÜ™Ê™XÛÜ™Ë›[™İÈ™XÛÜ™Èˆ\š]™Y\™Ù]™XÛÜ™Ñœ›ÛUY\”ÚY]Ê
JJNÂˆB‚ˆ[˜İ[Ûˆ\š]™Y\™Ù]™XÛÜ™Ñœ›ÛUY\”ÚY]Ê
HÂˆÛÛœİ[ÛÙ^HH]Kœİ[[X\H	‰ˆ]Kœİ[[X\K™Ù[™\˜]Y]Èİš[™Ê]Kœİ[[X\K™Ù[™\˜]Y]
KœÛXÙJÊHˆØØ[]RÙ^J™]È]J
JKœÛXÙJÊNÂˆÛÛœİ]HH™]È]J	Û[ÛÙ^_KLUŒŒ
NÂˆÛÛœİ[ÛH[X™\‹š\Ó˜SŠ]K™Ù][YJ
JHÈ[ÛÙ^Hˆ]KÓØØ[Tİš[™Ê™[‹UTÈ‹È[Ûˆ›Û™È‹YX\ˆ›[Y\šXÈˆJNÂˆÛÛœİ™XÛÜ™ÈHQT—ÓSÕ‘WÓÔSÓ”Ë›X\

Y\“˜[YJHOˆÂˆÛÛœİÚY]HÚY]S˜[YJY\“˜[YJNÂˆÛÛœİ›İÜÈH
ÚY]	‰ˆ\œ˜^Kš\Ğ\œ˜^JÚY]œ›İÜÊJHÈÚY]œ›İÜÈˆ×NÂˆÛÛœİÛXÚÜÈH›İÜËœ™YXÙJ
İ[K›İÊHOˆİ[H
ÈY\”›İĞÛXÚÜÊ›İÊK
NÂˆÛÛœİÜ™\œÈH›İÜËœ™YXÙJ
İ[K›İÊHOˆİ[H
ÈY\”›İÓÜ™\œÊ›İÊK
NÂˆÛÛœİ™]™[YHH›İÜËœ™YXÙJ
İ[K›İÊHOˆİ[H
ÈY\”›İÔ™]™[YJ›İÊK
NÂˆÛÛœİ^[İ]H›İÜËœ™YXÙJ
İ[K›İÊHOˆİ[H
ÈY\”›İÔ^[İ]
›İÊK
NÂˆÛÛœİÛÛ™\œÚ[ÛˆHÛXÚÜÈÈÜ™\œÈÈÛXÚÜÈˆÂˆ™]\›ˆ\U\™Ù]İ™\œšYJÂˆ[Ûˆ[Ûˆ×Û[ÛÙ^Nˆ[ÛÙ^Kˆ×Ù\š]™Yœ›ÛUY\”ÚY]ÎˆYKˆY\ˆY\“˜[YHOOH“PÒÈQTˆˆÈ›XÚÈY\ˆˆˆY\“˜[YKˆœ˜[™Ûİ[ˆ›İÜË›[™İˆ•İ[ÛXÚÜÈˆÛXÚÜËˆ“Ü™\ˆÛİ[ˆÜ™\œËˆ™]™[YNˆ™]™[YKˆ^[İ]ˆ^[İ]ˆ]™ÈÛÛ™\œÚ[ÛˆˆÛÛ™\œÚ[Û‹ˆ“™]ÈY\ˆ[šY\Èˆˆ•Y\ˆ^]Èˆˆ\™Ù]ˆˆ‚ˆJNÂˆJNÂˆÛÛœİİ[H™XÛÜ™Ëœ™YXÙJ
XØË™XÛÜ™
HOˆÂˆXØË˜œ˜[™È
ÏH\œÙTÚY][X™\Š™XÛÜ™Èœ˜[™Ûİ[—JNÂˆXØË˜ÛXÚÜÈ
ÏH\œÙTÚY][X™\Š™XÛÜ™È•İ[ÛXÚÜÈ—JNÂˆXØË›Ü™\œÈ
ÏH\œÙTÚY][X™\Š™XÛÜ™È“Ü™\ˆÛİ[—JNÂˆXØËœ™]™[YH
ÏH\œÙTÚY][X™\Š™XÛÜ™”™]™[YJNÂˆXØËœ^[İ]
ÏH\œÙTÚY][X™\Š™XÛÜ™”^[İ]
NÂˆ™]\›ˆXØÎÂˆKÈœ˜[™ÎˆÛXÚÜÎˆÜ™\œÎˆ™]™[YNˆ^[İ]ˆJNÂˆ™XÛÜ™Ëœ\Ú
\U\™Ù]İ™\œšYJÂˆ[Ûˆ[Ûˆ×Û[ÛÙ^Nˆ[ÛÙ^Kˆ×Ù\š]™Yœ›ÛUY\”ÚY]ÎˆYKˆY\ˆ•İ[‹ˆœ˜[™Ûİ[ˆİ[˜œ˜[™Ëˆ•İ[ÛXÚÜÈˆİ[˜ÛXÚÜËˆ“Ü™\ˆÛİ[ˆİ[›Ü™\œËˆ™]™[YNˆİ[œ™]™[YKˆ^[İ]ˆİ[œ^[İ]ˆ]™ÈÛÛ™\œÚ[Ûˆˆİ[˜ÛXÚÜÈÈİ[›Ü™\œÈÈİ[˜ÛXÚÜÈˆˆ“™]ÈY\ˆ[šY\Èˆˆ•Y\ˆ^]Èˆˆ\™Ù]ˆˆ‚ˆJJNÂˆ™]\›ˆ™XÛÜ™ÎÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™XÛÜ™Y]šXÕİ[
™XÛÜ™
HÂˆ™]\›ˆ\œÙTÚY][X™\Š™XÛÜ™	‰ˆ™XÛÜ™Èœ˜[™Ûİ[—JH
Âˆ\œÙTÚY][X™\Š™XÛÜ™	‰ˆ™XÛÜ™È•İ[ÛXÚÜÈ—JH
Âˆ\œÙTÚY][X™\Š™XÛÜ™	‰ˆ™XÛÜ™È“Ü™\ˆÛİ[—JH
Âˆ\œÙTÚY][X™\Š™XÛÜ™	‰ˆ™XÛÜ™”™]™[YJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù][Û\ÓY]šXÜÊ™XÛÜ™Ë[Û
HÂˆ™]\›ˆ
™XÛÜ™È×JBˆ™š[\Š
™XÛÜ™
HOˆ™XÛÜ™“[ÛOOH[Û
BˆœÛÛYJ
™XÛÜ™
HOˆ\™Ù]™XÛÜ™Y]šXÕİ[
™XÛÜ™
Hˆ
NÂˆB‚ˆ[˜İ[Ûˆ™Y™\œ™Y\™Ù][Û
™XÛÜ™ÊHÂˆÛÛœİ[ÛÈH\œ˜^K™œ›ÛJ™]ÈÙ]

™XÛÜ™È×JK›X\

™XÛÜ™
HOˆ™XÛÜ™“[Û
K™š[\Š›ÛÛX[ŠJJBˆœÛÜ

KŠHOˆİš[™Ê\™Ù][ÛÛÜ˜[YJJJK›ØØ[PÛÛ\\™Jİš[™Ê\™Ù][ÛÛÜ˜[YJŠJJJNÂˆÛÛœİ[ÛÕÚ]Y]šXÜÈH[ÛË™š[\Š
[Û
HOˆ\™Ù][Û\ÓY]šXÜÊ™XÛÜ™Ë[Û
JNÂˆ™]\›ˆ[ÛÕÚ]Y]šXÜÖÛ[ÛÕÚ]Y]šXÜË›[™İHWH[ÛÖÛ[ÛË›[™İHWHˆÂˆB‚ˆ[˜İ[Ûˆš[\™Y\™Ù]™XÛÜ™Ê
HÂˆ™]\›ˆ\™Ù]™XÛÜ™Ê
Bˆ™š[\Š
™XÛÜ™
HOˆİ]K\™Ù]š[\œË›[ÛOOH˜[ˆ™XÛÜ™“[ÛOOHİ]K\™Ù]š[\œË›[Û
Bˆ™š[\Š
™XÛÜ™
HOˆİ]K\™Ù]š[\œËY\ˆOOH˜[ˆ™XÛÜ™•Y\ˆOOHİ]K\™Ù]š[\œËY\ŠNÂˆB‚ˆ[˜İ[Ûˆ\™Ù][ÛÛÜ˜[YJ[Û
HÂˆÛÛœİX]ÚH\™Ù]™XÛÜ™Ê
K™š[™

™XÛÜ™
HOˆ™XÛÜ™“[ÛOOH[Û
NÂˆ™]\›ˆX]ÚÈX]Ú—×Û[ÛÙ^H[Ûˆ[ÛÙ^Qœ›ÛU^
[Û
H[ÛÂˆB‚ˆ[˜İ[Ûˆ™Yœ™\Ú\™Ù]š[\œÊ
HÂˆÛÛœİ™XÛÜ™ÈH\™Ù]™XÛÜ™Ê
NÂˆÛÛœİ[ÛÈH\œ˜^K™œ›ÛJ™]ÈÙ]
™XÛÜ™Ë›X\

™XÛÜ™
HOˆ™XÛÜ™“[Û
K™š[\Š›ÛÛX[ŠJJBˆœÛÜ

KŠHOˆİš[™Ê\™Ù][ÛÛÜ˜[YJJJK›ØØ[PÛÛ\\™Jİš[™Ê\™Ù][ÛÛÜ˜[YJŠJJJNÂˆÛÛœİY\œÈH\œ˜^K™œ›ÛJ™]ÈÙ]
™XÛÜ™Ë›X\

™XÛÜ™
HOˆ™XÛÜ™•Y\ŠK™š[\Š
Y\ŠHOˆY\ˆ	‰ˆİš[™ÊY\ŠKÓİÙ\Ø\ÙJ
HOOHİ[ŠJJKœÛÜ

KŠHOˆK›ØØ[PÛÛ\\™J‹[™Yš[™YÈ[Y\šXÎˆYHJJNÂˆÛÛœİ[ÛÜ[ÛœÈH[ÛË›X\

[Û
HOˆ
È˜[YNˆ[ÛX™[ˆ[ÛJJNÂˆYˆ

\İ]K\™Ù]š[\œË›[Û
İ]K\™Ù]š[\œË›[ÛOOH˜[ˆ	‰ˆ[[ÛËš[˜ÛY\Êİ]K\™Ù]š[\œË›[Û
JJH	‰ˆ[ÛÜ[ÛœË›[™İ
HÂˆİ]K\™Ù]š[\œË›[ÛH™Y™\œ™Y\™Ù][Û
™XÛÜ™ÊNÂˆBˆYˆ
İ]K\™Ù]š[\œË˜ÛÛ\\™S[ÛOOHİ]K\™Ù]š[\œË›[Û
HÂˆÛÛœİİ\œ™[[™^H[ÛËš[™^ÙŠİ]K\™Ù]š[\œË›[Û
NÂˆİ]K\™Ù]š[\œË˜ÛÛ\\™S[ÛH[ÛÖØİ\œ™[[™^HWH[ÛÖØİ\œ™[[™^
ÈWHˆÂˆBˆ™\XÙTÙ[XİÚ]Ü[ÛœÊ[Ë\™Ù][ÛÙ[XİŞÈ˜[YNˆ˜[‹X™[ˆ[[ÛÈˆK‹‹›[ÛÜ[Ûœ×Kİ]K\™Ù]š[\œË›[Û˜[ŠNÂˆ™\XÙTÙ[XİÚ]Ü[ÛœÊˆ[Ë\™Ù]ÛÛ\\™S[ÛÙ[XİˆŞÈ˜[YNˆˆ‹X™[ˆ“›ÈÛÛ\\š\ÛÛˆˆK‹‹›[ÛÜ[ÛœË™š[\Š
Ü[ÛŠHOˆÜ[Û‹˜[YHOOH[Ë\™Ù][ÛÙ[Xİ˜[YJWKˆİ]K\™Ù]š[\œË˜ÛÛ\\™S[Ûˆ‚ˆ
NÂˆ™\XÙTÙ[XİÜ[ÛœÊ[Ë\™Ù]Y\‘š[\‹[Y\œÈ‹Y\œËİ]K\™Ù]š[\œËY\ŠNÂˆİ]K\™Ù]š[\œË›[ÛH[Ë\™Ù][ÛÙ[Xİ˜[YNÂˆİ]K\™Ù]š[\œË˜ÛÛ\\™S[ÛH[Ë\™Ù]ÛÛ\\™S[ÛÙ[Xİ˜[YNÂˆİ]K\™Ù]š[\œËY\ˆH[Ë\™Ù]Y\‘š[\‹˜[YNÂˆB‚ˆ[˜İ[Ûˆ\Õ\™Ù]İ[›İÊ™XÛÜ™
HÂˆ™]\›ˆİš[™Ê™XÛÜ™	‰ˆ™XÛÜ™•Y\ˆˆŠKÓİÙ\Ø\ÙJ
HOOHİ[ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y\”ÛÜ˜[šÊY\ŠHÂˆÛÛœİ^Hİš[™ÊY\ˆˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆÛÛœİ[™^HT‘ÑUÕQT—ÓÔ‘T‹™š[™[™^

][JHOˆ][KÓİÙ\Ø\ÙJ
HOOH^
NÂˆYˆ
[™^H
H™]\›ˆ[™^ÂˆÛÛœİX]ÚH^›X]Ú
İY\—ÊŠÌNWJÊKÊNÂˆ™]\›ˆX]ÚÈ[X™\ŠX]ÚÌWJHHHˆNNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]›İÜÑ›Ü“[Û
™XÛÜ™Ë[ÛY\ˆHİ]K\™Ù]š[\œËY\ŠHÂˆ™]\›ˆ
™XÛÜ™È×JBˆ™š[\Š
™XÛÜ™
HOˆ[ÛOOH˜[ˆ™XÛÜ™“[ÛOOH[Û
Bˆ™š[\Š
™XÛÜ™
HOˆY\ˆOOH˜[ˆ™XÛÜ™•Y\ˆOOHY\ŠNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]šXÔ›İÜÊ™XÛÜ™ÊHÂˆ™]\›ˆ
™XÛÜ™È×JBˆ™š[\Š
™XÛÜ™
HOˆZ\Õ\™Ù]İ[›İÊ™XÛÜ™
JBˆœÛÜ

KŠHOˆ\™Ù]Y\”ÛÜ˜[šÊK•Y\ŠHH\™Ù]Y\”ÛÜ˜[šÊ‹•Y\ŠHİš[™ÊK•Y\ŠK›ØØ[PÛÛ\\™Jİš[™Ê‹•Y\ŠK[™Yš[™YÈ[Y\šXÎˆYHJJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]İ[[X\J™XÛÜ™ÊHÂˆÛÛœİİ[[X\T›İÜÈH™XÛÜ™ËœÛÛYJ
™XÛÜ™
HOˆ™XÛÜ™•Y\ˆOOH•İ[ŠBˆÈ™XÛÜ™Ë™š[\Š
™XÛÜ™
HOˆ™XÛÜ™•Y\ˆOOH•İ[ŠBˆˆ\™Ù]Y]šXÔ›İÜÊ™XÛÜ™ÊNÂˆ™]\›ˆİ[[X\T›İÜËœ™YXÙJ
XØË™XÛÜ™
HOˆÂˆXØË˜œ˜[™È
ÏH\œÙTÚY][X™\Š™XÛÜ™Èœ˜[™Ûİ[—JNÂˆXØË˜ÛXÚÜÈ
ÏH\œÙTÚY][X™\Š™XÛÜ™È•İ[ÛXÚÜÈ—JNÂˆXØË›Ü™\œÈ
ÏH\œÙTÚY][X™\Š™XÛÜ™È“Ü™\ˆÛİ[—JNÂˆXØËœ™]™[YH
ÏH\œÙTÚY][X™\Š™XÛÜ™”™]™[YJNÂˆÛÛœİÛÛ™\œÚ[ÛˆH\˜Ù[YÙS[X™\‘›Ü’XY\Š]™ÈÛÛ™\œÚ[Ûˆ‹™XÛÜ™È]™ÈÛÛ™\œÚ[Ûˆ—JNÂˆYˆ
ÛÛ™\œÚ[ÛˆOOH[
HÂˆXØË˜ÛÛ™\œÚ[Û•ÙZYÚY
ÏHÛÛ™\œÚ[Ûˆ
ˆ\œÙTÚY][X™\Š™XÛÜ™È•İ[ÛXÚÜÈ—JNÂˆXØË˜ÛÛ™\œÚ[Û‘˜[˜XÚÈ
ÏHÛÛ™\œÚ[ÛÂˆXØË˜ÛÛ™\œÚ[ÛÛİ[
ÏHNÂˆBˆXØË›™]Ñ[šY\È
ÏH\œÙTÚY][X™\Š™XÛÜ™È“™]ÈY\ˆ[šY\È—JNÂˆXØË™^]È
ÏH\œÙTÚY][X™\Š™XÛÜ™È•Y\ˆ^]È—JNÂˆ™]\›ˆXØÎÂˆKÈœ˜[™ÎˆÛXÚÜÎˆÜ™\œÎˆ™]™[YNˆÛÛ™\œÚ[Û•ÙZYÚYˆÛÛ™\œÚ[Û‘˜[˜XÚÎˆÛÛ™\œÚ[ÛÛİ[ˆ™]Ñ[šY\Îˆ^]ÎˆJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]]™ĞÛÛ™\œÚ[ÛŠİ[[X\JHÂˆYˆ
İ[[X\K˜ÛXÚÜÈ	‰ˆİ[[X\K›Ü™\œÊH™]\›ˆİ[[X\K›Ü™\œÈÈİ[[X\K˜ÛXÚÜÎÂˆYˆ
İ[[X\K˜ÛXÚÜÈ	‰ˆİ[[X\K˜ÛÛ™\œÚ[Û•ÙZYÚY
H™]\›ˆ
İ[[X\K˜ÛÛ™\œÚ[Û•ÙZYÚYÈİ[[X\K˜ÛXÚÜÊHÈLÂˆYˆ
İ[[X\K˜ÛÛ™\œÚ[ÛÛİ[
H™]\›ˆ
İ[[X\K˜ÛÛ™\œÚ[Û‘˜[˜XÚÈÈİ[[X\K˜ÛÛ™\œÚ[ÛÛİ[
HÈLÂˆ™]\›ˆÂˆB‚ˆ[˜İ[ÛˆÛÛ\Xİ[X™\Š˜[YJHÂˆÛÛœİˆH[X™\Š˜[YJHÂˆYˆ
X]˜XœÊŠHHL
H™]\›ˆ	ÊˆÈL
KÓØØ[Tİš[™Ê[™Yš[™YÈX^[][Qœ˜Xİ[Û‘YÚ]ÎˆˆJ_SXÂˆYˆ
X]˜XœÊŠHHL
H™]\›ˆ	ÊˆÈL
KÓØØ[Tİš[™Ê[™Yš[™YÈX^[][Qœ˜Xİ[Û‘YÚ]ÎˆHJ_RØÂˆ™]\›ˆ‹ÓØØ[Tİš[™Ê
NÂˆB‚ˆ[˜İ[ÛˆÛÛ\Xİ[Û™^J˜[YJHÂˆÛÛœİˆH[X™\Š˜[YJHÂˆYˆ
X]˜XœÊŠHHL
H™]\›ˆ		ÊˆÈL
KÓØØ[Tİš[™Ê[™Yš[™YÈX^[][Qœ˜Xİ[Û‘YÚ]ÎˆˆJ_SXÂˆYˆ
X]˜XœÊŠHHL
H™]\›ˆ		ÊˆÈL
KÓØØ[Tİš[™Ê[™Yš[™YÈX^[][Qœ˜Xİ[Û‘YÚ]ÎˆHJ_RØÂˆ™]\›ˆÚÜ[Û™^JŠNÂˆB‚ˆ[˜İ[Ûˆ]RÙ^J˜[YJHÂˆÛÛœİX]ÚHİš[™Ê˜[YHˆŠK›X]Ú
×ŠÍJKJÌŸJKJÌŸJKÊNÂˆ™]\›ˆX]ÚÈ	ÛX]ÚÌW_KIÛX]ÚÌ—_KIÛX]ÚÌ×_XˆˆÂˆB‚ˆ[˜İ[Ûˆ[ÛÙ^Qœ›ÛU^
˜[YJHÂˆÛÛœİ^Hİš[™Ê˜[YHˆŠKš[J
NÂˆÛÛœİX]ÚH^›X]Ú
×ŠÍJKJÌŸJKÊNÂˆYˆ
X]Ú
H™]\›ˆ	ÛX]ÚÌW_KIÛX]ÚÌ—_XÂˆÛÛœİX™[X]ÚH^›X]Ú
×ŠĞKV˜K^—JÊWÊÊÍJIÊNÂˆYˆ
[X™[X]Ú
H™]\›ˆˆÂˆÛÛœİ[Û[™^HÂˆš˜[X\H‹™™XœX\H‹›X\˜Ú‹˜\š[‹›X^H‹š[™H‹ˆš[H‹˜]Yİ\İ‹œÙ\[X™\ˆ‹›ØİØ™\ˆ‹››İ™[X™\ˆ‹™XÙ[X™\ˆ‚ˆKš[™^ÙŠX™[X]ÚÌWKÓİÙ\Ø\ÙJ
JNÂˆ™]\›ˆ[Û[™^HÈ	ÛX™[X]ÚÌ—_KIÔİš[™Ê[Û[™^
ÈJKœYİ\
‹ŒŠ_XˆˆÂˆB‚ˆ[˜İ[Ûˆ[ÛX™[œ›ÛRÙ^J˜[YJHÂˆÛÛœİÙ^HH[ÛÙ^Qœ›ÛU^
˜[YJNÂˆYˆ
ZÙ^JH™]\›ˆ”™\Ü[™ÈÂˆÛÛœİ]HH™]È]J	ÚÙ^_KLUŒŒ
NÂˆ™]\›ˆ[X™\‹š\Ó˜SŠ]K™Ù][YJ
JHÈÙ^Hˆ]KÓØØ[Tİš[™Ê™[‹UTÈ‹È[Ûˆ›Û™ÈˆJNÂˆB‚ˆ[˜İ[Ûˆ”İ]\Õ]Q›Ü“[Û
˜[YJHÂˆÛÛœİX™[H[ÛX™[œ›ÛRÙ^J˜[YJNÂˆ™]\›ˆX™[OOH”™\Ü[™ÈˆÈ”™\Ü[™ÈÛİ™\˜YÙHˆˆ	ÛX™[H™\Ü[™ÈÛİ™\˜YÙXÂˆB‚ˆ[˜İ[ÛˆY^\ÕÑ]RÙ^J˜[YK^\ÊHÂˆÛÛœİÙ^HH]RÙ^J˜[YJNÂˆYˆ
ZÙ^JH™]\›ˆˆÂˆÛÛœİ]HH™]È]J	ÚÙ^_UŒŒ
NÂˆYˆ
[X™\‹š\Ó˜SŠ]K™Ù][YJ
JJH™]\›ˆˆÂˆ]KœÙ]]J]K™Ù]]J
H
È[X™\Š^\È
JNÂˆ™]\›ˆØØ[]RÙ^J]JNÂˆB‚ˆ[˜İ[ÛˆÛÛ\\™Q]RÙ^\ÊYšYÚ
HÂˆÛÛœİHH]RÙ^JY
NÂˆÛÛœİˆH]RÙ^JšYÚ
NÂˆYˆ
XH	‰ˆXŠH™]\›ˆÂˆYˆ
XJH™]\›ˆLNÂˆYˆ
XŠH™]\›ˆNÂˆ™]\›ˆK›ØØ[PÛÛ\\™JŠNÂˆB‚ˆ[˜İ[ÛˆÚÜ]SX™[
˜[YJHÂˆÛÛœİÙ^HH]RÙ^J˜[YJNÂˆYˆ
ZÙ^JH™]\›ˆ‹HÂˆÛÛœİ]HH™]È]J	ÚÙ^_UŒŒ
NÂˆYˆ
[X™\‹š\Ó˜SŠ]K™Ù][YJ
JJH™]\›ˆÙ^NÂˆ™]\›ˆ]KÓØØ[Q]Tİš[™Ê™[‹UTÈ‹È[ÛˆœÚÜ‹^Nˆ›[Y\šXÈˆJNÂˆB‚ˆ[˜İ[Ûˆ^\Ñ]SX™[
˜[YJHÂˆÛÛœİÙ^HH]RÙ^J˜[YJNÂˆYˆ
ZÙ^JH™]\›ˆ‹HÂˆÛÛœİ]HH™]È]J	ÚÙ^_UŒŒ
NÂˆYˆ
[X™\‹š\Ó˜SŠ]K™Ù][YJ
JJH™]\›ˆÙ^NÂˆ™]\›ˆ]KÓØØ[Q]Tİš[™Ê™[‹UTÈ‹È[Ûˆ›[Y\šXÈ‹^Nˆ›[Y\šXÈˆJNÂˆB‚ˆ[˜İ[Ûˆ]T˜[™ÙSX™[
İ\[™
HÂˆÛÛœİİ\X™[HÚÜ]SX™[
İ\
NÂˆÛÛœİ[™X™[HÚÜ]SX™[
[™
NÂˆYˆ
İ\X™[OOH‹Hˆ	‰ˆ[™X™[OOH‹HŠH™]\›ˆ‹HÂˆYˆ
İ\X™[OOH[™X™[[™X™[OOH‹HŠH™]\›ˆİ\X™[ÂˆYˆ
İ\X™[OOH‹HŠH™]\›ˆ[™X™[Âˆ™]\›ˆ	Üİ\X™[KIÙ[™X™[XÂˆB‚ˆ[˜İ[Ûˆ\™Ù]”İ]\Ó[ÛÙ^J
HÂˆYˆ
İ]K\™Ù]š[\œË›[Û	‰ˆİ]K\™Ù]š[\œË›[ÛOOH˜[ŠHÂˆ™]\›ˆ[ÛÙ^Qœ›ÛU^
\™Ù][ÛÛÜ˜[YJİ]K\™Ù]š[\œË›[Û
JNÂˆBˆ™]\›ˆˆÂˆB‚ˆ[˜İ[ÛˆÛİ™\˜YÙU˜[YJ][HHßJHÂˆÛÛœİX]ÚYH[X™\Š][K›X]ÚY
NÂˆÛÛœİİ[H[X™\Š][Kİ[
NÂˆYˆ
[X™\‹š\Ñš[š]JX]ÚY
H	‰ˆ[X™\‹š\Ñš[š]Jİ[
H	‰ˆİ[ˆ
HÂˆ™]\›ˆ	ÛX]ÚYÓØØ[Tİš[™Ê
_HÈ	İİ[ÓØØ[Tİš[™Ê
_XÂˆBˆYˆ
[X™\‹š\Ñš[š]JX]ÚY
JH™]\›ˆX]ÚYÓØØ[Tİš[™Ê
NÂˆ™]\›ˆ‹HÂˆB‚ˆ[˜İ[ÛˆÛİ™\˜YÙQ]Z[
][HHßJHÂˆÛÛœİÛİ™\˜YÙHH[X™\Š][K˜Ûİ™\˜YÙJNÂˆYˆ
[X™\‹š\Ñš[š]JÛİ™\˜YÙJJH™]\›ˆÚÜİ
Ûİ™\˜YÙJNÂˆ™]\›ˆ][K˜]˜Z[X›HOOH˜[ÙHÈ•[˜]˜Z[X›HˆˆÛİ™\˜YÙHÂˆB‚ˆ[˜İ[Ûˆ‘Z[U™[™›İÜÊ^[ØYHİ]K™”İ]\Ë™]JHÂˆÛÛœİ™[™H^[ØY	‰ˆ^[ØY™Z[U™[™È^[ØY™Z[U™[™ˆßNÂˆÛÛœİ›İÜÈH\œ˜^Kš\Ğ\œ˜^J™[™œ›İÜÊHÈ™[™œ›İÜËœÛXÙJ
Hˆ×NÂˆÛÛœİØœÙ\™Y›İYÚH]RÙ^J™[™›ØœÙ\™Y›İYÚ^[ØYË›]\İ]\ÏË˜YÙÜ™YØ]SÜ™\œÏË›]\İ^[ØYË›]\İ]\ÏË˜[X^›Û“Ü™\œÏË›]\İ
NÂˆÛÛœİ^XİYÛÛ\]U›İYÚH]RÙ^J™[™™^XİYÛÛ\]U›İYÚ
NÂˆÛÛœİ›Ü›X[^™YH›İÜÂˆ›X\

›İÊHOˆÂˆÛÛœİ^HH]RÙ^J›İË™]H›İË™^JNÂˆYˆ
Y^JH™]\›ˆ[ÂˆÛÛœİİ]HH›İËœİ]H
ˆ^XİYÛÛ\]U›İYÚ	‰ˆÛÛ\\™Q]RÙ^\Ê^K^XİYÛÛ\]U›İYÚ
HˆˆÈ™[^H‚ˆˆØœÙ\™Y›İYÚ	‰ˆÛÛ\\™Q]RÙ^\Ê^KØœÙ\™Y›İYÚ
HˆˆÈœİ[H‚ˆˆ›ØœÙ\™Y‚ˆ
NÂˆÛÛœİÜ™\œÈH›İË›Ü™\œÈOOH[›İË›Ü™\œÈOOH[™Yš[™YÈ[ˆ[X™\Š›İË›Ü™\œÊHÂˆÛÛœİ™]™[YHH›İËœ™]™[YHOOH[›İËœ™]™[YHOOH[™Yš[™YÈ[ˆ[X™\Š›İËœ™]™[YJHÂˆÛÛœİÛXÚÜÈH›İË˜ÛXÚÜÈOOH[›İË˜ÛXÚÜÈOOH[™Yš[™YÈ[ˆ[X™\Š›İË˜ÛXÚÜÊHÂˆ™]\›ˆÂˆ‹‹œ›İËˆ]Nˆ^Kˆİ]Kˆ\Ñ[^Nˆİ]HOOH™[^H‹ˆ\ĞÛÛ\]Nˆ›İËš\ĞÛÛ\]HOOH[™Yš[™YÈ›ÛÛX[Š›İËš\ĞÛÛ\]JHˆİ]HOOH™[^H‹ˆÜ™\œËˆ™]™[YKˆÛXÚÜÂˆNÂˆJBˆ™š[\Š›ÛÛX[ŠBˆœÛÜ

KŠHOˆK™]K›ØØ[PÛÛ\\™J‹™]JJNÂ‚ˆ]™]š[İ\ÓØœÙ\™YH[Âˆ›Ü›X[^™Y™›Ü‘XXÚ

›İÊHOˆÂˆ›İË›Ü™\œÑ[HH[Âˆ›İËœ™]™[YQ[HH[Âˆ›İË˜ÛXÚÜÑ[HH[ÂˆYˆ
›İËœİ]HOOH™[^Hˆ	‰ˆ[X™\‹š\Ñš[š]J›İË›Ü™\œÊJHÂˆYˆ
™]š[İ\ÓØœÙ\™Y
HÂˆ›İË›Ü™\œÑ[HH›İË›Ü™\œÈH™]š[İ\ÓØœÙ\™Y›Ü™\œÎÂˆ›İËœ™]™[YQ[HH›İËœ™]™[YHH™]š[İ\ÓØœÙ\™Yœ™]™[YNÂˆ›İË˜ÛXÚÜÑ[HH›İË˜ÛXÚÜÈH™]š[İ\ÓØœÙ\™Y˜ÛXÚÜÎÂˆBˆ™]š[İ\ÓØœÙ\™YH›İÎÂˆBˆJNÂˆ™]\›ˆ›Ü›X[^™YÂˆB‚ˆ[˜İ[Ûˆ[Û^\ÓX™[
˜[YKÜ[ÛœÈHßJHÂˆÛÛœİÙ^HH[ÛÙ^Qœ›ÛU^
˜[YJNÂˆYˆ
ZÙ^JH™]\›ˆİš[™Ê˜[YH‹HŠNÂˆÛÛœİ]HH™]È]J	ÚÙ^_KLUŒŒ
NÂˆYˆ
[X™\‹š\Ó˜SŠ]K™Ù][YJ
JJH™]\›ˆÙ^NÂˆ™]\›ˆ]KÓØØ[Q]Tİš[™Ê™[‹UTÈ‹Âˆ[ÛˆÜ[ÛœËœÚÜÈœÚÜˆˆ›Û™È‹ˆYX\ˆ›[Y\šXÈ‚ˆJNÂˆB‚ˆ[˜İ[Ûˆ“[ÛU™[™›İÜÊ^[ØYHİ]K™”İ]\Ë™]JHÂˆÛÛœİ™XÙ[H^[ØY	‰ˆ^[ØYœ™XÙ[[ÛÈÈ^[ØYœ™XÙ[[ÛÈˆßNÂˆÛÛœİYÙÜ™YØ]T›İÜÈH\œ˜^Kš\Ğ\œ˜^J™XÙ[˜YÙÜ™YØ]SÜ™\œÊHÈ™XÙ[˜YÙÜ™YØ]SÜ™\œÈˆ×NÂˆÛÛœİÛXÚÔ›İÜÈH\œ˜^Kš\Ğ\œ˜^J™XÙ[˜[X^›ÛÛXÚÜÊHÈ™XÙ[˜[X^›ÛÛXÚÜÈˆ×NÂˆÛÛœİS[ÛH™]ÈX\

NÂˆYÙÜ™YØ]T›İÜË™›Ü‘XXÚ

›İÊHOˆÂˆÛÛœİ[ÛÙ^HH[ÛÙ^Qœ›ÛU^
›İË›[Û
NÂˆYˆ
[[ÛÙ^JH™]\›ÂˆS[ÛœÙ]
[ÛÙ^KÂˆ[ÛÙ^Kˆ™]™[YNˆ[X™\Š›İËœ™]™[YJHˆÜ™\œÎˆ[X™\Š›İË›Ü™\œÊHˆXİ]™Pœ˜[™Îˆ[X™\Š›İË˜Xİ]™Pœ˜[™ÊHˆYÙÜ™YØ]T›İÜÎˆ[X™\Š›İË˜YÙÜ™YØ]T›İÜÊHˆÛXÚÜÎˆˆJNÂˆJNÂˆÛXÚÔ›İÜË™›Ü‘XXÚ

›İÊHOˆÂˆÛÛœİ[ÛÙ^HH[ÛÙ^Qœ›ÛU^
›İË›[Û
NÂˆYˆ
[[ÛÙ^JH™]\›ÂˆÛÛœİ\™Ù]HS[Û™Ù]
[ÛÙ^JHÂˆ[ÛÙ^Kˆ™]™[YNˆˆÜ™\œÎˆˆXİ]™Pœ˜[™ÎˆˆYÙÜ™YØ]T›İÜÎˆˆÛXÚÜÎˆˆNÂˆ\™Ù]˜ÛXÚÜÈH[X™\Š›İË˜ÛXÚÜÊHÂˆ\™Ù]˜ÛXÚÔ›İÜÈH[X™\Š›İË˜ÛXÚÔ›İÜÊHÂˆS[ÛœÙ]
[ÛÙ^K\™Ù]
NÂˆJNÂˆ™]\›ˆ\œ˜^K™œ›ÛJS[Û˜[Y\Ê
JBˆœÛÜ

KŠHOˆK›[ÛÙ^K›ØØ[PÛÛ\\™J‹›[ÛÙ^JJBˆ›X\

›İÊHOˆ
Âˆ‹‹œ›İËˆÛÛ™\œÚ[Û”˜]Nˆ›İË˜ÛXÚÜÈÈ›İË›Ü™\œÈÈ›İË˜ÛXÚÜÈˆˆX™[ˆ[Û^\ÓX™[
›İË›[ÛÙ^JKˆÚÜX™[ˆ[Û^\ÓX™[
›İË›[ÛÙ^KÈÚÜˆYHJKˆÛİ\˜ÙNˆ™]X˜\ÙH‚ˆJJNÂˆB‚ˆ[˜İ[Ûˆ“[ÛT›İÑ›Ü’Ù^J[ÛÙ^K^[ØYHİ]K™”İ]\Ë™]JHÂˆÛÛœİ›Ü›X[^™YH[ÛÙ^Qœ›ÛU^
[ÛÙ^JNÂˆ™]\›ˆ“[ÛU™[™›İÜÊ^[ØY
K™š[™

›İÊHOˆ›İË›[ÛÙ^HOOH›Ü›X[^™Y
H[ÂˆB‚ˆ[˜İ[Ûˆ”İ]\ÕšY]Ó[Ù[
^[ØYHİ]K™”İ]\Ë™]JHÂˆÛÛœİ™[™H^[ØY	‰ˆ^[ØY™Z[U™[™È^[ØY™Z[U™[™ˆßNÂˆÛÛœİ]\İ]\ÈH^[ØY	‰ˆ^[ØY›]\İ]\ÈÈ^[ØY›]\İ]\ÈˆßNÂˆÛÛœİİ\œ™[]HH]RÙ^J™[™˜İ\œ™[]JHØØ[]RÙ^J™]È]J
JNÂˆÛÛœİ[^Q^\ÈH[X™\‹š\Ñš[š]J[X™\Š™[™™[^Q^\ÊJHÈ[X™\Š™[™™[^Q^\ÊHˆÂˆÛÛœİ^XİYÛÛ\]U›İYÚH]RÙ^J™[™™^XİYÛÛ\]U›İYÚ
HY^\ÕÑ]RÙ^Jİ\œ™[]KY[^Q^\ÊNÂˆÛÛœİØœÙ\™Y›İYÚH]RÙ^J™[™›ØœÙ\™Y›İYÚ]\İ]\Ë˜YÙÜ™YØ]SÜ™\œÏË›]\İ]\İ]\Ë˜[X^›Û“Ü™\œÏË›]\İ
NÂˆÛÛœİ]\İ]Q]HH]RÙ^J™[™›]\İ]Q]H]\İ]\Ë˜YÙÜ™YØ]SÜ™\œÏË›]\İ]\İ]\Ë˜[X^›Û“Ü™\œÏË›]\İ
NÂˆÛÛœİ™[™[ÛÙ^HH[ÛÙ^Qœ›ÛU^
™[™›[Ûİ\œ™[]Hİ]K™”İ]\Ë›[ÛÙ^JNÂˆÛÛœİ[^UÚ[™İÔİ\HY^\ÕÑ]RÙ^J^XİYÛÛ\]U›İYÚJNÂˆÛÛœİX[H[ØœÙ\™Y›İYÚY^XİYÛÛ\]U›İYÚˆÈ[šÛ›İÛˆ‚ˆˆÛÛ\\™Q]RÙ^\ÊØœÙ\™Y›İYÚ^XİYÛÛ\]U›İYÚ
HHˆÈ™œ™\Ú‚ˆˆœİ[HÂˆÛÛœİÛİ™\˜YÙHH^[ØY	‰ˆ^[ØY˜Ûİ™\˜YÙHÈ^[ØY˜Ûİ™\˜YÙHˆßNÂˆÛÛœİÛİ™\˜YÙPØ\™ÈHÂˆÈX™[ˆ“Ù™™\ˆÛİ™\˜YÙH‹˜[YNˆÛİ™\˜YÙU˜[YJÛİ™\˜YÙK˜ÛœØŞWØY™\
K]Z[ˆÛİ™\˜YÙQ]Z[
Ûİ™\˜YÙK˜ÛœØŞWØY™\
KÛ™Nˆ™Ü™Y[ˆˆKˆÈX™[ˆYÙÜ™YØ]HÛİ™\˜YÙH‹˜[YNˆÛİ™\˜YÙU˜[YJÛİ™\˜YÙK˜ÛœØŞWÛÜ™\—Û™]×ØYÙÜ™YØ]JK]Z[ˆÛİ™\˜YÙQ]Z[
Ûİ™\˜YÙK˜ÛœØŞWÛÜ™\—Û™]×ØYÙÜ™YØ]JKÛ™Nˆ˜›YHˆKˆÈX™[ˆ”›ÙXİÛİ™\˜YÙH‹˜[YNˆÛİ™\˜YÙU˜[YJÛİ™\˜YÙK˜ÛœØŞWØ[X^›Û—Ü›ÙXİ
K]Z[ˆÛİ™\˜YÙQ]Z[
Ûİ™\˜YÙK˜ÛœØŞWØ[X^›Û—Ü›ÙXİ
KÛ™Nˆ˜›YHˆKˆÈX™[ˆ”Û˜\ÚİQÈ‹˜[YNˆ[X™\Š^[ØYËœİ]XÔÛ˜\ÚİË›Y\˜Ú[YÈÛİ™\˜YÙKœİ]XÓ[Y\šXÓY\˜Ú[YÈ
KÓØØ[Tİš[™Ê
K]Z[ˆ^[ØYËœİ]XÔÛ˜\ÚİË™Ù[™\˜]Y]ÈZ[	ÜÚÜ]SX™[
^[ØYœİ]XÔÛ˜\Úİ™Ù[™\˜]Y]
_Xˆ”İ]XÈYÙH‹Û™NˆœÛ]HˆBˆNÂˆÛÛœİ]\İØ\™ÈHÂˆÈX™[ˆ“Ù™™\ˆYÙÜ™YØ]H‹˜[YNˆ]RÙ^J]\İ]\Ë˜YÙÜ™YØ]SÜ™\œÏË›]\İ
H‹H‹]Z[ˆ]\İ]\Ë˜YÙÜ™YØ]SÜ™\œÏËX›H˜ÛœØŞWÛÜ™\—Û™]×ØYÙÜ™YØ]HˆKˆÈX™[ˆ[X^›ÛˆÜ™\œÈ‹˜[YNˆ]RÙ^J]\İ]\Ë˜[X^›Û“Ü™\œÏË›]\İ
H‹H‹]Z[ˆ]\İ]\Ë˜[X^›Û“Ü™\œÏËX›H˜ÛœØŞWØ[X^›Û—ÛÜ™\ˆˆKˆÈX™[ˆ[X^›ÛˆÛXÚÜÈ‹˜[YNˆ]RÙ^J]\İ]\Ë˜[X^›ÛÛXÚÜÏË›]\İ
H‹H‹]Z[ˆ]\İ]\Ë˜[X^›ÛÛXÚÜÏËX›H˜ÛœØŞWØ[X^›Û—ØÛXÚÈˆKˆÈX™[ˆ”›ÙXİÈ‹˜[YNˆ]RÙ^J]\İ]\Ëœ›ÙXİÏË›]\İ
H‹H‹]Z[ˆ]\İ]\Ëœ›ÙXİÏËX›H˜ÛœØŞWØ[X^›Û—Ü›ÙXİˆBˆNÂˆ™]\›ˆÂˆ]Nˆ”İ]\Õ]Q›Ü“[Û
™[™[ÛÙ^JKˆ[ÛÙ^Nˆ™[™[ÛÙ^KˆX[ˆ[^Q^\Ëˆİ\œ™[]Kˆ^XİYÛÛ\]U›İYÚˆØœÙ\™Y›İYÚˆ]\İ]Q]Kˆ[^UÚ[™İÕ^ˆ]T˜[™ÙSX™[
[^UÚ[™İÔİ\İ\œ™[]JKˆÛİ™\˜YÙPØ\™Ëˆ]\İØ\™Ëˆš[X\TÛİ\˜ÙNˆ™[™œš[X\TÛİ\˜ÙH˜ÛœØŞWÛÜ™\—Û™]×ØYÙÜ™YØ]H‹ˆÚXÚÙY]ˆ^[ØYË˜ÚXÚÙY]ˆ‚ˆNÂˆB‚ˆ[˜İ[Ûˆ”İ]\Ñ[[Ñ[˜X›Y

HÂˆÛÛœİØØ][ÛˆHÚ[™İË›ØØ][ÛˆßNÂˆÛÛœİÜİHİš[™ÊØØ][Û‹šÜİ˜[YHˆŠNÂˆYˆ
ÜİOOH›ØØ[Üİˆ	‰ˆÜİOOHŒLËŒŒŒHŠH™]\›ˆ˜[ÙNÂˆÛÛœİÙX\˜ÚHİš[™ÊØØ][Û‹œÙX\˜ÚˆŠNÂˆ™]\›ˆ™]ÈT“ÙX\˜Ú\˜[\ÊÙX\˜Ú
K™Ù]
™”İ]\Ñ[[ÈŠHOOHŒHÂˆB‚ˆ[˜İ[Ûˆ[[Ñ”İ]\Ô^[ØY
[ÛÙ^HHˆŠHÂˆÛÛœİÙ^HHØØ[]RÙ^J™]È]J
JNÂˆÛÛœİ™\]Y\İY[ÛH[ÛÙ^Qœ›ÛU^
[ÛÙ^JNÂˆÛÛœİİ\œ™[[ÛHÙ^KœÛXÙJÊNÂˆÛÛœİ™[™[ÛH™\]Y\İY[Ûİ\œ™[[ÛÂˆÛÛœİ[Û\ÈH™[™[Û›X]Ú
×ŠÍJKJÌŸJIÊNÂˆÛÛœİ[Û[™H[Û\ÂˆÈØØ[]RÙ^J™]È]J[X™\Š[Û\ÖÌWJK[X™\Š[Û\ÖÌ—JK
JBˆˆÙ^NÂˆÛÛœİİ\œ™[]HH™[™[ÛOOHİ\œ™[[ÛÈÙ^Hˆ[Û[™ÂˆÛÛœİ^XİYÛÛ\]U›İYÚH™[™[ÛOOHİ\œ™[[ÛÈY^\ÕÑ]RÙ^Jİ\œ™[]KLŠHˆ[Û[™ÂˆÛÛœİ›İÜÈH×NÂˆ]İ\œÛÜˆH[Û\ÈÈ	İ™[™[ÛKLXˆY^\ÕÑ]RÙ^Jİ\œ™[]KN
NÂˆ]ÛÛ\]R[™^HÂˆÚ[H
İ\œÛÜˆ	‰ˆÛÛ\\™Q]RÙ^\Êİ\œÛÜ‹İ\œ™[]JHH
HÂˆÛÛœİ^HHİ\œÛÜÂˆÛÛœİİ]HHÛÛ\\™Q]RÙ^\Ê^K^XİYÛÛ\]U›İYÚ
HˆÈ™[^Hˆˆ›ØœÙ\™YÂˆÛÛœİÜ™\œÈHİ]HOOH™[^HˆÈ[ˆÌˆ
È
ÛÛ\]R[™^	HÊH
ˆH
È
ÛÛ\]R[™^	HÊH
ˆÂˆÛÛœİ™]™[YHHİ]HOOH™[^HˆÈ[ˆÌŒ
È

ÛÛ\]R[™^
ˆÊH	HLJH
ˆŒÂˆÛÛœİÛXÚÜÈHİ]HOOH™[^HˆÈ[ˆŒ
È

ÛÛ\]R[™^
ˆJH	HJH
ˆMNÂˆ›İÜËœ\Ú
Âˆ]Nˆ^Kˆİ]Kˆ\ĞÛÛ\]Nˆİ]HOOH™[^H‹ˆÜ™\œËˆ™]™[YKˆÛXÚÜËˆXİ]™Pœ˜[™Îˆİ]HOOH™[^HˆÈ[ˆˆ
È
ÛÛ\]R[™^	HN
KˆÛÛ™\œÚ[Û”˜]NˆÛXÚÜÈÈÜ™\œÈÈÛXÚÜÈˆˆJNÂˆİ\œÛÜˆHY^\ÕÑ]RÙ^Jİ\œÛÜ‹JNÂˆÛÛ\]R[™^
ÏHNÂˆBˆÛÛœİÛÛ\]Y›İÜÈH›İÜË™š[\Š
›İÊHOˆ›İËœİ]HOOH™[^HŠNÂˆÛÛœİÙ[XİYÜ™\œÈHÛÛ\]Y›İÜËœ™YXÙJ
İ[K›İÊHOˆİ[H
È
[X™\Š›İË›Ü™\œÊH
K
NÂˆÛÛœİÙ[XİY™]™[YHHÛÛ\]Y›İÜËœ™YXÙJ
İ[K›İÊHOˆİ[H
È
[X™\Š›İËœ™]™[YJH
K
NÂˆÛÛœİÙ[XİYÛXÚÜÈHÛÛ\]Y›İÜËœ™YXÙJ
İ[K›İÊHOˆİ[H
È
[X™\Š›İË˜ÛXÚÜÊH
K
NÂˆÛÛœİ™XÙ[YÙÜ™YØ]HH×NÂˆÛÛœİ™XÙ[ÛXÚÜÈH×NÂˆ›Üˆ
]Ù™œÙ]HNÈÙ™œÙ]HÈÙ™œÙ]OHJHÂˆÛÛœİ]HH™]È]J	İ™[™[ÛKLUŒŒ
NÂˆ]KœÙ][Û
]K™Ù][Û

HHÙ™œÙ]
NÂˆÛÛœİÙ^HHØØ[]RÙ^J]JKœÛXÙJÊNÂˆÛÛœİ˜XİÜˆHÌˆ
È
HHÙ™œÙ]
H
ˆŒMÂˆ™XÙ[YÙÜ™YØ]Kœ\Ú
Âˆ[ÛˆÙ^KˆYÙÜ™YØ]T›İÜÎˆX]œ›İ[™
Ù[XİYÜ™\œÈ
ˆ˜XİÜˆ
ˆÍ
KˆXİ]™Pœ˜[™ÎˆX]œ›İ[™

Ù™™\œË›[™İL
H
ˆ
ŒMH
È˜XİÜˆ
ˆŒÊJKˆÜ™\œÎˆX]œ›İ[™
Ù[XİYÜ™\œÈ
ˆ˜XİÜŠKˆ™]™[YNˆX]œ›İ[™
Ù[XİY™]™[YH
ˆ˜XİÜˆ
ˆL
HÈLˆJNÂˆ™XÙ[ÛXÚÜËœ\Ú
Âˆ[ÛˆÙ^KˆÛXÚÔ›İÜÎˆX]œ›İ[™
Ù[XİYÛXÚÜÈ
ˆ˜XİÜˆ
ˆŒÌJKˆÛXÚÜÎˆX]œ›İ[™
Ù[XİYÛXÚÜÈ
ˆ˜XİÜŠBˆJNÂˆBˆ™]\›ˆÂˆÚÎˆYKˆ[[ÎˆYKˆÚXÚÙY]ˆ™]È]J
KÒTÓÔİš[™Ê
Kˆİ]XÔÛ˜\ÚİˆÈÙ[™\˜]Y]ˆ™]È]J
KÒTÓÔİš[™Ê
KY\˜Ú[YÎˆÙ™™\œË›[™İKˆ]\İ]\ÎˆÂˆ[X^›Û“Ü™\œÎˆÈ]\İˆ^XİYÛÛ\]U›İYÚX›Nˆ˜ÛœØŞWØ[X^›Û—ÛÜ™\ˆˆKˆ[X^›ÛÛXÚÜÎˆÈ]\İˆY^\ÕÑ]RÙ^J^XİYÛÛ\]U›İYÚLJKX›Nˆ˜ÛœØŞWØ[X^›Û—ØÛXÚÈˆKˆYÙÜ™YØ]SÜ™\œÎˆÈ]\İˆ^XİYÛÛ\]U›İYÚX›Nˆ˜ÛœØŞWÛÜ™\—Û™]×ØYÙÜ™YØ]HˆKˆ›ÙXİÎˆÈ]\İˆ^XİYÛÛ\]U›İYÚX›Nˆ˜ÛœØŞWØ[X^›Û—Ü›ÙXİˆBˆKˆÛİ™\˜YÙNˆÂˆİ]XÓ[Y\šXÓY\˜Ú[YÎˆÙ™™\œË›[™İˆÛœØŞWØY™\ˆÈX]ÚYˆÙ™™\œË›[™İİ[ˆÙ™™\œË›[™İÛİ™\˜YÙNˆHKˆÛœØŞWÛÜ™\—Û™]×ØYÙÜ™YØ]NˆÈX]ÚYˆÙ™™\œË›[™İİ[ˆÙ™™\œË›[™İÛİ™\˜YÙNˆHKˆÛœØŞWØ[X^›Û—Ü›ÙXİˆÈX]ÚYˆX]›X^
Ù™™\œË›[™İHŠKİ[ˆÙ™™\œË›[™İÛİ™\˜YÙNˆÙ™™\œË›[™İÈ
Ù™™\œË›[™İHŠHÈÙ™™\œË›[™İˆKˆÛœØŞWØ[X^›Û—Ü›ÙXİÙ^˜NˆÈX]ÚYˆX]›X^
Ù™™\œË›[™İHÌ
Kİ[ˆÙ™™\œË›[™İÛİ™\˜YÙNˆÙ™™\œË›[™İÈ
Ù™™\œË›[™İHÌ
HÈÙ™™\œË›[™İˆBˆKˆZ[U™[™ˆÂˆ[Ûˆ™[™[Ûˆ[^Q^\Îˆ‹ˆİ\œ™[]KˆØœÙ\™Y›İYÚˆ^XİYÛÛ\]U›İYÚˆ^XİYÛÛ\]U›İYÚˆ›İÜÂˆKˆ™XÙ[[ÛÎˆÂˆYÙÜ™YØ][Ûˆ˜Ø[[™\—Û[Û‹ˆİ[][]]™Nˆ˜[ÙKˆÚ[™İÎˆÂˆİ\[Ûˆ™XÙ[YÙÜ™YØ]VÌOË›[Û™[™[Ûˆ[™[Ûˆ™[™[Ûˆ›İYÚ]Nˆİ\œ™[]Kˆ[ÛÎˆ™XÙ[YÙÜ™YØ]K›[™İˆKˆYÙÜ™YØ]SÜ™\œÎˆ™XÙ[YÙÜ™YØ]Kˆ[X^›ÛÛXÚÜÎˆ™XÙ[ÛXÚÜÂˆBˆNÂˆB‚ˆ[˜İ[Ûˆ[U^
˜[YK›Ü›X]\ˆHÛÛ\Xİ[X™\ŠHÂˆYˆ
S[X™\‹š\Ñš[š]J[X™\Š˜[YJJJH™]\›ˆ“›Èš[Üˆ^HÂˆÛÛœİ[X™\ˆH[X™\Š˜[YJNÂˆYˆ
X]˜XœÊ[X™\ŠHŒJH™]\›ˆŒœÈ™]š[İ\È^HÂˆ™]\›ˆ	Û[X™\ˆˆÈŠÈˆˆ‹HŸIÙ›Ü›X]\ŠX]˜XœÊ[X™\ŠJ_HœÈ™]š[İ\È^XÂˆB‚ˆ[˜İ[Ûˆ•™[™]
Ú[ÊHÂˆYˆ
\Ú[Ë›[™İ
H™]\›ˆˆÂˆ™]\›ˆÚ[Ë›X\

Ú[[™^
HOˆ	Ú[™^È“ˆˆ“HŸH	ÜÚ[Ñš^Y
Š_H	ÜÚ[KÑš^Y
Š_X
Kš›Ú[ŠˆŠNÂˆB‚ˆ[˜İ[Ûˆ‘Z[U™[™Ú\[
›İÜË[^Q^\ÈHŠHÂˆYˆ
\›İÜË›[™İ
HÂˆ™]\›ˆ]ˆÛ\ÜÏH\™Ù]Y[\K\İ]H‘ˆZ[H™[™Ú[\X\ˆY\ˆHİ]\ÈTH™\ÜÛ™ËÙ]˜ÂˆBˆÛÛœİX^˜[YHHX]›X^
K‹‹œ›İÜË›X\

›İÊHOˆ[X™\Š›İË›Ü™\œÊH
JNÂˆÛÛœİÚYHÍŒÂˆÛÛœİZYÚHLÂˆÛÛœİYHÈYˆ‹šYÚˆNÜˆ›İÛNˆNÂˆÛÛœİ[›™\•ÚYHÚYHY›YHYœšYÚÂˆÛÛœİ[›™\’ZYÚHZYÚHYÜHY˜›İÛNÂˆÛÛœİİ\H›İÜË›[™İˆHÈ[›™\•ÚYÈ
›İÜË›[™İHJHˆ[›™\•ÚYÂˆÛÛœİ˜\•ÚYHX]›X^
L‹X]›Z[ŠÍİ\
ˆJJNÂˆÛÛœİÚ[ÈH×NÂˆÛÛœİ˜\œÈH›İÜË›X\

›İË[™^
HOˆÂˆÛÛœİHY›Y
È[™^
ˆİ\ÂˆÛÛœİ˜[YHH[X™\Š›İË›Ü™\œÊHÂˆÛÛœİ˜\’ZYÚHX]›X^
›İËœİ]HOOH™[^HˆÈMˆË
˜[YHÈX^˜[YJH
ˆ[›™\’ZYÚ
NÂˆÛÛœİHHYÜ
È[›™\’ZYÚH˜\’ZYÚÂˆYˆ
›İËœİ]HOOH™[^Hˆ˜[YHˆ
HÚ[Ëœ\Ú
ÈK›İÈJNÂˆÛÛœİÛÛ\ÚYHMÍÂˆÛÛœİÛÛ\ZYÚHÌÂˆÛÛœİÛÛ\HX]›Z[ŠÚYHYœšYÚHÛÛ\ÚYX]›X^
Y›YHÛÛ\ÚYÈŠJNÂˆÛÛœİÛÛ\HHX]›X^
HHÛÛ\ZYÚHLŠNÂˆÛÛœİİ]\ÈH›İËœİ]HOOH™[^HˆÈ”\X[YÈÚ[™İÈˆˆ›İËœİ]HOOHœİ[HˆÈ“Z\ÜÚ[™ÈY\ˆ^XİY]HˆˆÛÛ\]HÂˆÛÛœİ™]™[YHHÛÛ\Xİ[Û™^J›İËœ™]™[YH
NÂˆÛÛœİÛXÚÜÈHÛÛ\Xİ[X™\Š›İË˜ÛXÚÜÈ
NÂˆÛÛœİX™[H	ÜÚÜ]SX™[
›İË™]J_Nˆ	ØÛÛ\Xİ[X™\Š˜[YJ_HÜ™\œË	Ü™]™[Y_K	ØÛXÚÜßHÛXÚÜØÂˆ™]\›ˆÈÛ\ÜÏH™‹]™[™Y^H	Ù\ØØ\R[
›İËœİ]J_HˆXš[™^HŒˆ›ÛOHš[YÈˆ\šXK[X™[H‰Ù\ØØ\R[
X™[
_H‚ˆ™XİÛ\ÜÏH™‹]™[™Zİ™\‹X˜[™ˆH‰ÊHİ\ÈŠKÑš^Y
Š_HˆOH‰ÜYÜHˆÚYH‰ÓX]›X^
İ\˜\•ÚY
KÑš^Y
Š_HˆZYÚH‰Ú[›™\’ZYÚHˆHˆÜ™Xİ‚ˆ™XİÛ\ÜÏH™‹]™[™X˜\ˆˆH‰ÊH˜\•ÚYÈŠKÑš^Y
Š_HˆOH‰ŞKÑš^Y
Š_HˆÚYH‰Ø˜\•ÚYÑš^Y
Š_HˆZYÚH‰Ø˜\’ZYÚÑš^Y
Š_HˆHHÜ™Xİ‚ˆ^H‰ŞÑš^Y
Š_HˆOH‰ÚZYÚHŒŸHˆ^X[˜ÚÜH›ZYH‰Ù\ØØ\R[
^\Ñ]SX™[
›İË™]JJ_Oİ^‚ˆÈÛ\ÜÏH™‹]™[™]ÛÛ\ˆ˜[œÙ›Ü›OH˜[œÛ]J	İÛÛ\Ñš^Y
Š_H	İÛÛ\KÑš^Y
Š_JH‚ˆ™XİÚYH‰İÛÛ\ÚYHˆZYÚH‰İÛÛ\ZYÚHˆHÜ™Xİ‚ˆ^HŒLˆOHŒN‰Ù\ØØ\R[
ÚÜ]SX™[
›İË™]JJ_HÈ	Ù\ØØ\R[
İ]\Ê_Oİ^‚ˆ^HŒLˆOHŒÍˆ‰Ù\ØØ\R[
ÛÛ\Xİ[X™\Š˜[YJJ_HÜ™\œÈÈ	Ù\ØØ\R[
™]™[YJ_Oİ^‚ˆ^HŒLˆOHM‰Ù\ØØ\R[
ÛXÚÜÊ_HÛXÚÜÈÈÕ”ˆ	Ù\ØØ\R[
ÚÜİ
›İË˜ÛÛ™\œÚ[Û”˜]H
J_Oİ^‚ˆÙÏ‚ˆÙÏ˜ÂˆJKš›Ú[ŠˆŠNÂˆÛÛœİ[^Tİ\[™^H›İÜË™š[™[™^

›İÊHOˆ›İËœİ]HOOH™[^HŠNÂˆÛÛœİ[^V›Û™HH[^Tİ\[™^HˆÈ™XİÛ\ÜÏH™‹Y[^K^›Û™HˆH‰ÓX]›X^
Y›YY›Y
È[^Tİ\[™^
ˆİ\Hİ\ÈŠKÑš^Y
Š_HˆOH‰ÜYÜHˆÚYH‰ÊÚYHYœšYÚHX]›X^
Y›YY›Y
È[^Tİ\[™^
ˆİ\Hİ\ÈŠJKÑš^Y
Š_HˆZYÚH‰Ú[›™\’ZYÚHˆHÜ™Xİ‚ˆ^Û\ÜÏH™‹Y[^K[X™[ˆH‰ÊÚYHYœšYÚH
KÑš^Y
Š_HˆOH‰ÊYÜ
ÈN
KÑš^Y
Š_Hˆ^X[˜ÚÜH™[™‰Ó[X™\Š[^Q^\ÊHŸKY^H™\Ü[™È[^Oİ^˜ˆˆˆÂˆÛÛœİØœÙ\™Y›İÜÈH›İÜË™š[\Š
›İÊHOˆ›İËœİ]HOOH™[^Hˆ	‰ˆ[X™\‹š\Ñš[š]J›İË›Ü™\œÊJNÂˆÛÛœİ]\İHØœÙ\™Y›İÜÖÛØœÙ\™Y›İÜË›[™İHWNÂˆ™]\›ˆİ™ÈšY]Ğ›ŞHŒ	İÚYH	ÚZYÚHˆ›ÛOHš[YÈˆ\šXK[X™[H‘Z[HˆÜ™\œÈ™[™Ú]™\Ü[™È[^H‚ˆ	Ù[^V›Û™_Bˆ[™HÛ\ÜÏH™[™X^\ÈˆOH‰ÜY›YHˆLOH‰ÜYÜ
È[›™\’ZYÚHˆH‰İÚYHYœšYÚHˆLH‰ÜYÜ
È[›™\’ZYÚHÛ[™O‚ˆ[™HÛ\ÜÏH™[™X^\ÈˆOH‰ÜY›YHˆLOH‰ÜYÜHˆH‰ÜY›YHˆLH‰ÜYÜ
È[›™\’ZYÚHÛ[™O‚ˆ	Ø˜\œßBˆ]Û\ÜÏH™[™[[™H‹]™[™[[™HˆH‰Ù\ØØ\R[
•™[™]
Ú[ÊJ_HÜ]‚ˆ	ÜÚ[Ë›X\

Ú[
HOˆÚ\˜ÛHÛ\ÜÏH™[™Yİ‹]™[™Yİ	Ù\ØØ\R[
Ú[œ›İËœİ]J_HˆŞH‰ÜÚ[Ñš^Y
Š_HˆŞOH‰ÜÚ[KÑš^Y
Š_HˆHØÚ\˜ÛO˜
Kš›Ú[ŠˆŠ_Bˆ^H‰ÜY›YHˆOHŒMˆ“Ù™™\ˆYÙÜ™YØ]HÜ™\œÈ\ˆ^Oİ^‚ˆ	Û]\İÈ^Û\ÜÏH™‹[]\İ[X™[ˆH‰İÚYHYœšYÚHˆOH‰ÚZYÚHHˆ^X[˜ÚÜH™[™“]\İÛÛ\]Nˆ	Ù\ØØ\R[
ÚÜ]SX™[
]\İ™]JJ_Oİ^˜ˆˆŸBˆÜİ™Ï˜ÂˆB‚ˆ[˜İ[Ûˆ™Yœ™\Ú”İ]\ÕZJ
HÂˆYˆ
İ]KœYÙHOOHœÚY]ÈˆY[ËœÚY]YÙS›İ\ÊH™]\›ÂˆÛÛœİÈ[™XÛÜ™Ë›İÜËÛÛ\\š\ÛÛ”›İÜÈHHİ\œ™[\™Ù]YÙQ]J
NÂˆ™[™\”ÚY]İ[[X\J›İÜËÛÛ\\š\ÛÛ”›İÜËİ]K\™Ù]š[\œË˜ÛÛ\\™S[Û
NÂˆYˆ
\™Yœ™\Ú\™Ù]™[™Û›J[™XÛÜ™ÊJH™[™\”ÚY]YÙJ
NÂˆB‚ˆ[˜İ[Ûˆ[œİ\™Q”İ]\Ñ›Ü”Ù[XİY[Û

HÂˆYˆ
Ú[™İË—×ÓÑ‘‘T—ÒS•SQÑSÑWÕTÕ×ÊH™]\›ÂˆYˆ
İ]KœYÙHOOHœÚY]ÈŠH™]\›ÂˆÛÛœİ\Ú\™Y[ÛÙ^HH\™Ù]”İ]\Ó[ÛÙ^J
NÂˆYˆ
İ]K™”İ]\Ë›ØY[™ÊH™]\›ÂˆYˆ
Y\Ú\™Y[ÛÙ^H	‰ˆ
İ]K™”İ]\Ë™]Hİ]K™”İ]\Ë™\œ›ÜŠJH™]\›ÂˆYˆ
\Ú\™Y[ÛÙ^H	‰ˆİ]K™”İ]\Ë›[ÛÙ^HOOH\Ú\™Y[ÛÙ^H	‰ˆ
İ]K™”İ]\Ë™]Hİ]K™”İ]\Ë™\œ›ÜŠJH™]\›ÂˆÚ[™İËœÙ][Y[İ]


HOˆØY”İ]\Ê\Ú\™Y[ÛÙ^JK
NÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆØY”İ]\Ê[ÛÙ^HH\™Ù]”İ]\Ó[ÛÙ^J
JHÂˆYˆ
\[Ùˆ™]ÚOOH™[˜İ[ÛˆŠH™]\›ÂˆÛÛœİ›Ü›X[^™Y[ÛÙ^HH[ÛÙ^Qœ›ÛU^
[ÛÙ^JNÂˆÛÛœİ^\İ[™Ó[ÛÙ^HH[ÛÙ^Qœ›ÛU^
İ]K™”İ]\Ë™]OË™Z[U™[™Ë›[Ûİ]K™”İ]\Ë›[ÛÙ^JNÂˆYˆ
›Ü›X[^™Y[ÛÙ^H	‰ˆ^\İ[™Ó[ÛÙ^HOOH›Ü›X[^™Y[ÛÙ^JHİ]K™”İ]\Ë™]HH[Âˆİ]K™”İ]\Ë›ØY[™ÈHYNÂˆİ]K™”İ]\Ë™\œ›ÜˆHˆÂˆİ]K™”İ]\Ë›[ÛÙ^HH›Ü›X[^™Y[ÛÙ^NÂˆ™Yœ™\Ú”İ]\ÕZJ
NÂˆHÂˆÛÛœİ\›H›Ü›X[^™Y[ÛÙ^HÈ	Ñ—ÔÕUT×ÕRWĞT_OÛ[ÛIÙ[˜ÛÙUT’PÛÛ\Û™[
›Ü›X[^™Y[ÛÙ^J_Xˆ—ÔÕUT×ÕRWĞTNÂˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
\›ÈØXÚNˆ››Ë\İÜ™HˆJNÂˆ]^[ØYH[ÂˆHÂˆ^[ØYH]ØZ]™\ÜÛœÙKšœÛÛŠ
NÂˆHØ]Ú
\œ›ÜŠHÂˆ^[ØYH[ÂˆBˆYˆ
\™\ÜÛœÙK›ÚÈ
^[ØY	‰ˆ^[ØY›ÚÈOOH˜[ÙJJHÂˆ›İÈ™]È\œ›ÜŠ
^[ØY	‰ˆ^[ØY™\œ›ÜŠH	Ü™\ÜÛœÙKœİ]\ßX
NÂˆBˆİ]K™”İ]\Ë™]HH^[ØYÂˆİ]K™”İ]\Ë›[ÛÙ^HH[ÛÙ^Qœ›ÛU^
^[ØYË™Z[U™[™Ë›[Û›Ü›X[^™Y[ÛÙ^JNÂˆİ]K™”İ]\Ë™\œ›ÜˆHˆÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
”İ]\Ñ[[Ñ[˜X›Y

JHÂˆİ]K™”İ]\Ë™]HH[[Ñ”İ]\Ô^[ØY
›Ü›X[^™Y[ÛÙ^JNÂˆİ]K™”İ]\Ë›[ÛÙ^HH[ÛÙ^Qœ›ÛU^
İ]K™”İ]\Ë™]OË™Z[U™[™Ë›[Û›Ü›X[^™Y[ÛÙ^JNÂˆİ]K™”İ]\Ë™\œ›ÜˆHˆÂˆ™]\›ÂˆBˆİ]K™”İ]\Ë™\œ›ÜˆHˆİ]\ÈTH[˜]˜Z[X›NÈÚİÚ[™Èİ]XÈÛ˜\Úİ]Kˆ	Ù\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆˆŸXš[J
NÂˆHš[˜[HÂˆİ]K™”İ]\Ë›ØY[™ÈH˜[ÙNÂˆ™Yœ™\Ú”İ]\ÕZJ
NÂˆBˆB‚ˆ\Ş[˜È[˜İ[ÛˆØY•Y\”İ[[X\J[ÛÙ^JHÂˆYˆ
\[Ùˆ™]ÚOOH™[˜İ[ÛˆŠH™]\›ÂˆÛÛœİ›Ü›X[^™Y[ÛÙ^HH[ÛÙ^Qœ›ÛU^
[ÛÙ^JNÂˆYˆ
[›Ü›X[^™Y[ÛÙ^JH™]\›ÂˆYˆ
İ]K™•Y\”İ[[X\K›[ÛÙ^HOOH›Ü›X[^™Y[ÛÙ^H	‰ˆİ]K™•Y\”İ[[X\K™]JH™]\›Âˆİ]K™•Y\”İ[[X\K›ØY[™ÈHYNÂˆİ]K™•Y\”İ[[X\K›[ÛÙ^HH›Ü›X[^™Y[ÛÙ^NÂˆİ]K™•Y\”İ[[X\K™\œ›ÜˆHˆÂˆHÂˆÛÛœİ\›H	Ñ—ÕQT—ÔÕSSPT–WĞT_OÛ[ÛIÙ[˜ÛÙUT’PÛÛ\Û™[
›Ü›X[^™Y[ÛÙ^J_XÂˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
\›ÈØXÚNˆ››Ë\İÜ™HˆJNÂˆÛÛœİ^[ØYH]ØZ]™\ÜÛœÙKšœÛÛŠ
NÂˆYˆ
\™\ÜÛœÙK›ÚÈ
^[ØY	‰ˆ^[ØY›ÚÈOOH˜[ÙJJHÂˆ›İÈ™]È\œ›ÜŠ
^[ØY	‰ˆ^[ØY™\œ›ÜŠH	Ü™\ÜÛœÙKœİ]\ßX
NÂˆBˆİ]K™•Y\”İ[[X\K™]HH^[ØYÂˆİ]K™•Y\”İ[[X\K™\œ›ÜˆHˆÂˆHØ]Ú
\œ›ÜŠHÂˆİ]K™•Y\”İ[[X\K™]HH[Âˆİ]K™•Y\”İ[[X\K™\œ›ÜˆH\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆ•Y\ˆİ[[X\H[˜]˜Z[X›HÂˆHš[˜[HÂˆİ]K™•Y\”İ[[X\K›ØY[™ÈH˜[ÙNÂˆ™[™\”ÚY]YÙJ
NÂˆBˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]šXĞÛÛ™šYÊÙ^HHİ]K\™Ù]Y]šXÊHÂˆ™]\›ˆT‘ÑUÓQU’PÔË™š[™

Y]šXÊHOˆY]šXËšÙ^HOOHÙ^JHT‘ÑUÓQU’PÔÖÌNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]›İÓY]šXÕ˜[YJ™XÛÜ™Ù^HHİ]K\™Ù]Y]šXÊHÂˆYˆ
Ù^HOOH›Ü™\œÈŠH™]\›ˆ\œÙTÚY][X™\Š™XÛÜ™È“Ü™\ˆÛİ[—JNÂˆYˆ
Ù^HOOH˜ÛXÚÜÈŠH™]\›ˆ\œÙTÚY][X™\Š™XÛÜ™È•İ[ÛXÚÜÈ—JNÂˆYˆ
Ù^HOOH˜ÛÛ™\œÚ[ÛˆŠH™]\›ˆ
\˜Ù[YÙS[X™\‘›Ü’XY\Š]™ÈÛÛ™\œÚ[Ûˆ‹™XÛÜ™È]™ÈÛÛ™\œÚ[Ûˆ—JH
HÈLÂˆYˆ
Ù^HOOH˜œ˜[™ÈŠH™]\›ˆ\œÙTÚY][X™\Š™XÛÜ™Èœ˜[™Ûİ[—JNÂˆ™]\›ˆ\œÙTÚY][X™\Š™XÛÜ™”™]™[YJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]İ[[X\SY]šXÕ˜[YJİ[[X\KÙ^HHİ]K\™Ù]Y]šXÊHÂˆYˆ
Ù^HOOH›Ü™\œÈŠH™]\›ˆİ[[X\K›Ü™\œÎÂˆYˆ
Ù^HOOH˜ÛXÚÜÈŠH™]\›ˆİ[[X\K˜ÛXÚÜÎÂˆYˆ
Ù^HOOH˜ÛÛ™\œÚ[ÛˆŠH™]\›ˆ\™Ù]]™ĞÛÛ™\œÚ[ÛŠİ[[X\JNÂˆYˆ
Ù^HOOH˜œ˜[™ÈŠH™]\›ˆİ[[X\K˜œ˜[™ÎÂˆ™]\›ˆİ[[X\Kœ™]™[YNÂˆB‚ˆ[˜İ[Ûˆ›Ü›X]\™Ù]Y]šXÕ˜[YJÙ^K˜[YJHÂˆYˆ
Ù^HOOHœ™]™[YHŠH™]\›ˆÛÛ\Xİ[Û™^J˜[YJNÂˆYˆ
Ù^HOOH˜ÛÛ™\œÚ[ÛˆŠH™]\›ˆÚÜİ
˜[YJNÂˆYˆ
Ù^HOOH˜ÛÛ™\œÚ[Û”˜]HŠH™]\›ˆÚÜİ
˜[YJNÂˆYˆ
Ù^HOOH™\ÈŠH™]\›ˆ‰ˆ
È[X™\Š˜[YJKÑš^Y
ŠNÂˆ™]\›ˆÛÛ\Xİ[X™\Š˜[YJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]ÛÛ\\š\ÛÛ“X\
›İÜÊHÂˆ™]\›ˆ™]ÈX\
\™Ù]Y]šXÔ›İÜÊ›İÜÊK›X\

›İÊHOˆÔİš[™Ê›İË•Y\ˆˆŠK›İ×JJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù][R[
İ\œ™[ÛÛ\\š\ÛÛ‹[ÙKÛÛ\\š\ÛÛ“X™[
HÂˆYˆ
XÛÛ\\š\ÛÛ“X™[ÛÛ\\š\ÛÛˆOOH[ÛÛ\\š\ÛÛˆOOH[™Yš[™Y
H™]\›ˆÜ[ˆÛ\ÜÏH\™Ù]Y[H›]“›ÈÛÛ\\š\ÛÛÜÜ[˜ÂˆÛÛœİY™ˆH[X™\Šİ\œ™[
HH[X™\ŠÛÛ\\š\ÛÛˆ
NÂˆYˆ
S[X™\‹š\Ñš[š]JY™ŠHX]˜XœÊY™ŠHŒJH™]\›ˆÜ[ˆÛ\ÜÏH\™Ù]Y[H›]ŒœÈ	Ù\ØØ\R[
ÛÛ\\š\ÛÛ“X™[
_OÜÜ[˜ÂˆÛÛœİ\™Xİ[ÛˆHY™ˆˆÈ\ˆˆ™İÛˆÂˆ]^HˆÂˆYˆ
[ÙHOOHœ˜]HŠHÂˆ^H	ÓX]˜XœÊY™ˆ
ˆL
KÑš^Y
Š_\œÈ	ØÛÛ\\š\ÛÛ“X™[XÂˆH[ÙHÂˆÛÛœİ[›ÛHHX]˜XœÊ[X™\ŠÛÛ\\š\ÛÛˆ
JNÂˆÛÛœİİÚ[™ÙHH[›ÛHÈY™ˆÈ[›ÛHˆ[Âˆ^HİÚ[™ÙHOOH[ˆÈ	ØÛÛ\Xİ[X™\ŠX]˜XœÊY™ŠJ_HœÈ	ØÛÛ\\š\ÛÛ“X™[Xˆˆ	ÓX]˜XœÊİÚ[™ÙH
ˆL
KÑš^Y
J_IHœÈ	ØÛÛ\\š\ÛÛ“X™[XÂˆBˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù]Y[H	Ù\™Xİ[ÛŸH‰Ù\™Xİ[ÛˆOOH\ˆÈŠÈˆˆ‹HŸH	Ù\ØØ\R[
^
_OÜÜ[˜ÂˆB‚ˆ[˜İ[Ûˆ™[™\”ÚY]İ[[X\J™XÛÜ™ËÛÛ\\š\ÛÛ”™XÛÜ™ËÛÛ\\š\ÛÛ“X™[
HÂˆÛÛœİÙ[XİY[ÛÙ^HH\™Ù]”İ]\Ó[ÛÙ^J
NÂˆÛÛœİ\ÙQ]X˜\ÙHHİ]K\™Ù]š[\œËY\ˆOOH˜[ˆ	‰ˆ›ÛÛX[ŠÙ[XİY[ÛÙ^JNÂˆÛÛœİ]X˜\ÙUİ[ÈH\ÙQ]X˜\ÙHÈ“[ÛT›İÑ›Ü’Ù^JÙ[XİY[ÛÙ^JHˆ[ÂˆÛÛœİÛÛ\\š\ÛÛ“[ÛÙ^HH[ÛÙ^Qœ›ÛU^
\™Ù][ÛÛÜ˜[YJÛÛ\\š\ÛÛ“X™[
JNÂˆÛÛœİ]X˜\ÙPÛÛ\\š\ÛÛˆH\ÙQ]X˜\ÙH	‰ˆÛÛ\\š\ÛÛ“[ÛÙ^HÈ“[ÛT›İÑ›Ü’Ù^JÛÛ\\š\ÛÛ“[ÛÙ^JHˆ[ÂˆÛÛœİİ]XÕİ[ÈH\™Ù]İ[[X\J™XÛÜ™ÊNÂˆÛÛœİİ]XĞÛÛ\\š\ÛÛˆHÛÛ\\š\ÛÛ”™XÛÜ™È	‰ˆÛÛ\\š\ÛÛ”™XÛÜ™Ë›[™İÈ\™Ù]İ[[X\JÛÛ\\š\ÛÛ”™XÛÜ™ÊHˆ[ÂˆÛÛœİİ[ÈH]X˜\ÙUİ[ÂˆÈÂˆ™]™[YNˆ]X˜\ÙUİ[Ëœ™]™[YKˆÜ™\œÎˆ]X˜\ÙUİ[Ë›Ü™\œËˆÛXÚÜÎˆ]X˜\ÙUİ[Ë˜ÛXÚÜËˆœ˜[™Îˆ]X˜\ÙUİ[Ë˜Xİ]™Pœ˜[™ÂˆBˆˆİ]XÕİ[ÎÂˆÛÛœİÛÛ\\š\ÛÛˆH]X˜\ÙPÛÛ\\š\ÛÛ‚ˆÈÂˆ™]™[YNˆ]X˜\ÙPÛÛ\\š\ÛÛ‹œ™]™[YKˆÜ™\œÎˆ]X˜\ÙPÛÛ\\š\ÛÛ‹›Ü™\œËˆÛXÚÜÎˆ]X˜\ÙPÛÛ\\š\ÛÛ‹˜ÛXÚÜËˆœ˜[™Îˆ]X˜\ÙPÛÛ\\š\ÛÛ‹˜Xİ]™Pœ˜[™ÂˆBˆˆİ]XĞÛÛ\\š\ÛÛÂˆÛÛœİ]™ĞÛÛ™\œÚ[ÛˆH]X˜\ÙUİ[ÈÈ]X˜\ÙUİ[Ë˜ÛÛ™\œÚ[Û”˜]Hˆ\™Ù]]™ĞÛÛ™\œÚ[ÛŠİ[ÊNÂˆÛÛœİÛÛ\\š\ÛÛÛÛ™\œÚ[ÛˆH]X˜\ÙPÛÛ\\š\ÛÛ‚ˆÈ]X˜\ÙPÛÛ\\š\ÛÛ‹˜ÛÛ™\œÚ[Û”˜]BˆˆÛÛ\\š\ÛÛˆÈ\™Ù]]™ĞÛÛ™\œÚ[ÛŠÛÛ\\š\ÛÛŠHˆ[ÂˆÛÛœİØ\™ÈHÂˆÈXÛÛˆ‰‹X™[ˆ”™]™[YH‹˜[YNˆÛÛ\Xİ[Û™^Jİ[Ëœ™]™[YJK[Nˆ\™Ù][R[
İ[Ëœ™]™[YKÛÛ\\š\ÛÛˆ	‰ˆÛÛ\\š\ÛÛ‹œ™]™[YK›[X™\ˆ‹ÛÛ\\š\ÛÛ“X™[
KÛ™Nˆ˜›YHˆKˆÈXÛÛˆˆÈ‹X™[ˆ“Ü™\œÈ‹˜[YNˆÛÛ\Xİ[X™\Šİ[Ë›Ü™\œÊK[Nˆ\™Ù][R[
İ[Ë›Ü™\œËÛÛ\\š\ÛÛˆ	‰ˆÛÛ\\š\ÛÛ‹›Ü™\œË›[X™\ˆ‹ÛÛ\\š\ÛÛ“X™[
KÛ™Nˆ™Ü™Y[ˆˆKˆÈXÛÛˆÈ‹X™[ˆÛXÚÜÈ‹˜[YNˆÛÛ\Xİ[X™\Šİ[Ë˜ÛXÚÜÊK[Nˆ\™Ù][R[
İ[Ë˜ÛXÚÜËÛÛ\\š\ÛÛˆ	‰ˆÛÛ\\š\ÛÛ‹˜ÛXÚÜË›[X™\ˆ‹ÛÛ\\š\ÛÛ“X™[
KÛ™Nˆ˜[X™\ˆˆKˆÈXÛÛˆ‰H‹X™[ˆ]™ÈÛÛ™\œÚ[Ûˆ‹˜[YNˆÚÜİ
]™ĞÛÛ™\œÚ[ÛŠK[Nˆ\™Ù][R[
]™ĞÛÛ™\œÚ[Û‹ÛÛ\\š\ÛÛÛÛ™\œÚ[Û‹œ˜]H‹ÛÛ\\š\ÛÛ“X™[
KÛ™Nˆš[Û]ˆKˆÈXÛÛˆˆ‹X™[ˆ]X˜\ÙUİ[ÈÈXİ]™HY\˜Ú[ÈˆˆXİ]™Hœ˜[™È‹˜[YNˆÛÛ\Xİ[X™\Šİ[Ë˜œ˜[™ÊK[Nˆ\™Ù][R[
İ[Ë˜œ˜[™ËÛÛ\\š\ÛÛˆ	‰ˆÛÛ\\š\ÛÛ‹˜œ˜[™Ë›[X™\ˆ‹ÛÛ\\š\ÛÛ“X™[
KÛ™NˆœÛ]HˆBˆNÂˆ[ËœÚY]YÙTİ[[X\Kš[›™\’SHØ\™Ë›X\

Ø\™[™^
HOˆ
ˆ\XÛHÛ\ÜÏH\™Ù]ZÜKXØ\™\™Ù]XØ\™Y[\ˆˆİ[OH‹KZN‰Ú[™^H‚ˆ]ˆÛ\ÜÏH\™Ù]ZÜKZXÛÛˆ	Ù\ØØ\R[
Ø\™Û™J_H‰Ù\ØØ\R[
Ø\™šXÛÛŠ_OÙ]‚ˆ]‚ˆÜ[‰Ù\ØØ\R[
X™[^
Ø\™›X™[
J_OÜÜ[‚ˆİ›Û™Ï‰Ù\ØØ\R[
Ø\™˜[YJ_OÜİ›Û™Ï‚ˆ	ØØ\™™[_BˆÙ]‚ˆØ\XÛO˜ˆ
JKš›Ú[ŠˆŠNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]ÛØ[
™XÛÜ™
HÂˆÛÛœİ^Hİš[™Ê™XÛÜ™•\™Ù]ˆŠNÂˆÛÛœİY\‘Yš[š][ÛˆH\™Ù]›ÙÜ™\ÜÑYš[š][ÛŠ™XÛÜ™•Y\ŠNÂˆÛÛœİ™]™[YQÛØ[H

HOˆÂˆÛÛœİ™]™[YHH^›X]Ú
ÊÎ‘ÓUŸ™]™[YJH\™Ù]—Ê—	×ÊŠ×—JÊWÊŠÒÓP—JO×
ÏËÚJNÂˆYˆ
\™]™[YJH™]\›ˆ[ÂˆÛÛœİØØ[HHÈÎˆLNˆLˆLVÔİš[™Ê™]™[YVÌ—HˆŠKÕ\\Ø\ÙJ
WHNÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\Š™]™[YVÌWJH
ˆØØ[NÂˆ™]\›ˆÈ\Nˆ™Û]ˆ‹X™[ˆY\‘Yš[š][ÛË\HOOH™Û]ˆˆÈY\‘Yš[š][Û‹›X™[ˆ”™]™[YH\™Ù]‹\™Ù]XİX[ˆ\œÙTÚY][X™\Š™XÛÜ™”™]™[YJK\™Ù]^ˆÛÛ\Xİ[Û™^J\™Ù]
KXİX[^ˆÛÛ\Xİ[Û™^J\œÙTÚY][X™\Š™XÛÜ™”™]™[YJJHNÂˆNÂˆÛÛœİÛÛ[Z\ÜÚ[Û‘ÛØ[H

HOˆÂˆÛÛœİÛÛ[Z\ÜÚ[ÛˆH^›X]Ú
ĞÛÛ[Z\ÜÚ[Ûˆ\™Ù]—Ê—	×ÊŠ×—JÊWÊŠÒÓP—JO×
ÏËÚJNÂˆYˆ
XÛÛ[Z\ÜÚ[ÛŠH™]\›ˆ[ÂˆÛÛœİØØ[HHÈÎˆLNˆLˆLVÔİš[™ÊÛÛ[Z\ÜÚ[Û–Ì—HˆŠKÕ\\Ø\ÙJ
WHNÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\ŠÛÛ[Z\ÜÚ[Û–ÌWJH
ˆØØ[NÂˆÛÛœİXİX[H\™Ù]Ü[Û˜[Y]šXÕ˜[YJ™XÛÜ™È”^[İ]‹•İ[ÛÛ[Z\ÜÚ[Ûˆ‹ÛÛ[Z\ÜÚ[ÛˆXYH‹Y™š[X]H^[İ]—JNÂˆ™]\›ˆÈ\Nˆ˜ÛÛ[Z\ÜÚ[Ûˆ‹X™[ˆÛÛ[Z\ÜÚ[Ûˆ\™Ù]‹\™Ù]XİX[\™Ù]^ˆÛÛ\Xİ[Û™^J\™Ù]
KXİX[^ˆXİX[OOH[È]ØZ][™È]HˆˆÛÛ\Xİ[Û™^JXİX[
HNÂˆNÂˆÛÛœİ™[[İ˜[ÛØ[H

HOˆÂˆÛÛœİ™[[İ˜[H^›X]Ú
ÓY\˜Ú[™[[İ˜[\™Ù]—ÊŠ×—JÊW
ÏËÚJNÂˆYˆ
™[[İ˜[
HÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\Š™[[İ˜[ÌWJNÂˆÛÛœİXİX[H\œÙTÚY][X™\Š™XÛÜ™È•Y\ˆ^]È—JNÂˆ™]\›ˆÈ\Nˆœ™[[İ˜[‹X™[ˆ“Y\˜Ú[™[[İ˜[\™Ù]‹\™Ù]XİX[\™Ù]^ˆ	İ\™Ù]ÓØØ[Tİš[™Ê
_HY\˜Ú[ØXİX[^ˆ	ØXİX[ÓØØ[Tİš[™Ê
_H™[[İ™YNÂˆBˆÛÛœİ›Û[İHH^›X]Ú
Ğœ˜[™\™Ù]—Ê”›Û[İWÊŠ×—JÊWÊœ˜[™ÏËÚJNÂˆYˆ
\›Û[İJH™]\›ˆ[ÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\Š›Û[İVÌWJNÂˆÛÛœİXİX[H\œÙTÚY][X™\Š™XÛÜ™È•Y\ˆ^]È—JNÂˆÛÛœİ\Ô™[[İ˜[Y\ˆHY\‘Yš[š][ÛË\HOOHœ™[[İ˜[Âˆ™]\›ˆÂˆ\Nˆ\Ô™[[İ˜[Y\ˆÈœ™[[İ˜[ˆˆœ›Û[İ[Ûˆ‹ˆX™[ˆ\Ô™[[İ˜[Y\ˆÈY\‘Yš[š][Û‹›X™[ˆ”›Û[İ[Ûˆ\™Ù]‹ˆ\™Ù]ˆXİX[ˆ\™Ù]^ˆ	İ\™Ù]ÓØØ[Tİš[™Ê
_H	Ú\Ô™[[İ˜[Y\ˆÈ›Y\˜Ú[Èˆˆ˜œ˜[™ÈŸXˆXİX[^ˆ	ØXİX[ÓØØ[Tİš[™Ê
_H	Ú\Ô™[[İ˜[Y\ˆÈœ™[[İ™Yˆˆ›[İ™YŸXˆNÂˆNÂˆYˆ
Y\‘Yš[š][ÛË\HOOH™Û]ˆŠH™]\›ˆ™]™[YQÛØ[

NÂˆYˆ
Y\‘Yš[š][ÛË\HOOH˜ÛÛ[Z\ÜÚ[ÛˆŠH™]\›ˆÛÛ[Z\ÜÚ[Û‘ÛØ[

NÂˆYˆ
Y\‘Yš[š][ÛË\HOOHœ™[[İ˜[ŠH™]\›ˆ™[[İ˜[ÛØ[

NÂˆÛÛœİš[X\QÛØ[H™]™[YQÛØ[

HÛÛ[Z\ÜÚ[Û‘ÛØ[

H™[[İ˜[ÛØ[

NÂˆYˆ
š[X\QÛØ[
H™]\›ˆš[X\QÛØ[ÂˆÛÛœİœ˜[™H^›X]Ú
Ğœ˜[™\™Ù]—ÊŠ×—JÊW
ÏËÚJNÂˆYˆ
œ˜[™
HÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\Šœ˜[™ÌWJNÂˆÛÛœİXİX[H\œÙTÚY][X™\Š™XÛÜ™Èœ˜[™Ûİ[—JNÂˆ™]\›ˆÈ\Nˆ˜œ˜[™‹X™[ˆœ˜[™\™Ù]‹\™Ù]XİX[\™Ù]^ˆ	İ\™Ù]ÓØØ[Tİš[™Ê
_Hœ˜[™ØXİX[^ˆ	ØXİX[ÓØØ[Tİš[™Ê
_HXİ]™XNÂˆBˆ™]\›ˆ[ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]›ÙÜ™\ÜÑYš[š][ÛŠY\ŠHÂˆÛÛœİ›Ü›X[^™YY\ˆHİš[™ÊY\ˆˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆ™]\›ˆT‘ÑUÔ“ÑÔ‘TÔ×ÑQ’S’USÓ”Ë™š[™

][JHOˆ][KY\‹ÓİÙ\Ø\ÙJ
HOOH›Ü›X[^™YY\ŠH[ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]X›T™XÛÜ™
Yš[š][Û‹™XÛÜ™H[[ÛHİ]K\™Ù]š[\œË›[Û
HÂˆYˆ
™XÛÜ™
H™]\›ˆ™XÛÜ™ÂˆÛÛœİ[ÛX™[Hİš[™Ê[ÛˆŠKš[J
NÂˆÛÛœİ[ÛÙ^HH[ÛÙ^Qœ›ÛU^
[ÛX™[
NÂˆYˆ
YYš[š][Ûˆ[[ÛX™[[ÛX™[OOH˜[ˆ[[ÛÙ^JH™]\›ˆ[Âˆ™]\›ˆ\U\™Ù]İ™\œšYJÂˆ[Ûˆ[ÛX™[ˆ×Û[ÛÙ^Nˆ[ÛÙ^Kˆ×Ù]X˜\ÙSÛ›NˆYKˆ×İ\™Ù]XÙZÛ\“Û›NˆYKˆ×ÜÛİ\˜ÙNˆ\™Ù]\XÙZÛ\ˆ‹ˆY\ˆYš[š][Û‹Y\‹ˆœ˜[™Ûİ[ˆˆ•İ[ÛXÚÜÈˆˆ“Ü™\ˆÛİ[ˆˆ™]™[YNˆˆ]™ÈÛÛ™\œÚ[Ûˆˆˆ“™]ÈY\ˆ[šY\Èˆˆ•Y\ˆ^]Èˆˆ\™Ù]ˆˆ‚ˆJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Ü[Û˜[Y]šXÕ˜[YJ™XÛÜ™XY\œÊHÂˆ›Üˆ
ÛÛœİXY\ˆÙˆXY\œÊHÂˆÛÛœİ˜]ÈH™XÛÜ™	‰ˆ™XÛÜ™ÚXY\—NÂˆYˆ
˜]ÈOOH[™Yš[™Y	‰ˆ˜]ÈOOH[	‰ˆİš[™Ê˜]ÊKš[J
HOOHˆŠH™]\›ˆ\œÙTÚY][X™\Š˜]ÊNÂˆBˆ™]\›ˆ[ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]ÛØ[X]Ú\ÑYš[š][ÛŠÛØ[Yš[š][ÛŠHÂˆYˆ
YÛØ[YYš[š][ÛŠH™]\›ˆ˜[ÙNÂˆ™]\›ˆÛØ[\HOOHYš[š][Û‹\NÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]˜[YJ™XÛÜ™ÛØ[
HÂˆÛÛœİ^Hİš[™Ê™XÛÜ™•\™Ù]ˆŠNÂˆYˆ
ÛØ[	‰ˆÛØ[\HOOH™Û]ˆŠHÂˆÛÛœİX]ÚH^›X]Ú
ÊÎ‘ÓUŸ™]™[YJH\™Ù]—ÊŠ××JÊKÚJNÂˆ™]\›ˆX]ÚÈX]ÚÌWKš[J
Hˆ
ÛØ[\™Ù]^ˆŠNÂˆBˆYˆ
ÛØ[	‰ˆÛØ[\HOOH˜ÛÛ[Z\ÜÚ[ÛˆŠHÂˆÛÛœİX]ÚH^›X]Ú
ĞÛÛ[Z\ÜÚ[Ûˆ\™Ù]—ÊŠ××JÊKÚJNÂˆ™]\›ˆX]ÚÈX]ÚÌWKš[J
Hˆ
ÛØ[\™Ù]^ˆŠNÂˆBˆYˆ
ÛØ[	‰ˆÛØ[\HOOHœ™[[İ˜[ŠHÂˆÛÛœİX]ÚH^›X]Ú
ÊÎ“Y\˜Ú[™[[İ˜[\™Ù]—ÊŸœ˜[™\™Ù]—Ê”›Û[İWÊŠJ×—JÊKÚJNÂˆ™]\›ˆX]ÚÈX]ÚÌWKš[J
Kœ™\XÙJËÙËˆŠHˆİš[™ÊÛØ[\™Ù]ˆŠNÂˆBˆYˆ
ÛØ[	‰ˆÛØ[\HOOHœ›Û[İ[ÛˆŠHÂˆÛÛœİX]ÚH^›X]Ú
Ğœ˜[™\™Ù]—Ê”›Û[İWÊŠ×—JÊWÊœ˜[™ÏËÚJNÂˆ™]\›ˆX]ÚÈX]ÚÌWKš[J
Kœ™\XÙJËÙËˆŠHˆİš[™ÊÛØ[\™Ù]ˆŠNÂˆBˆYˆ
ÛØ[	‰ˆÛØ[\HOOH˜œ˜[™ŠHÂˆÛÛœİX]ÚH^›X]Ú
Ğœ˜[™\™Ù]—ÊŠ×—JÊKÚJNÂˆ™]\›ˆX]ÚÈX]ÚÌWKš[J
Kœ™\XÙJËÙËˆŠHˆİš[™ÊÛØ[\™Ù]ˆŠNÂˆBˆ™]\›ˆİš[™Ê™XÛÜ™•\™Ù]ˆŠKš[J
NÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y][œ]]šX]\ÊÛØ[
HÂˆYˆ
ÛØ[	‰ˆ
ÛØ[\HOOHœ™[[İ˜[ˆÛØ[\HOOHœ›Û[İ[ÛˆˆÛØ[\HOOH˜œ˜[™ŠJHÂˆ™]\›ˆ\OH›[X™\ˆˆ[œ][ÙOH›[Y\šXÈˆZ[HŒHˆİ\HŒH˜ÂˆBˆ™]\›ˆ\OH^˜ÂˆB‚ˆ[˜İ[Ûˆ™\XÙU\™Ù]Û]\ÙJ^]\›‹™\XÙ[Y[
HÂˆÛÛœİİ\œ™[Hİš[™Ê^ˆŠKš[J
NÂˆYˆ
Xİ\œ™[
H™]\›ˆ™\XÙ[Y[Âˆ™]\›ˆ]\›‹\İ
İ\œ™[
HÈİ\œ™[œ™\XÙJ]\›‹™\XÙ[Y[
Hˆ	Øİ\œ™[NÈ	Ü™\XÙ[Y[XÂˆB‚ˆ[˜İ[Ûˆ\™Ù]^œ›ÛQY]˜[YJ™XÛÜ™˜[YKYš[š][ÛˆH\™Ù]›ÙÜ™\ÜÑYš[š][ÛŠ™XÛÜ™	‰ˆ™XÛÜ™•Y\ŠJHÂˆÛÛœİÛØ[H\™Ù]ÛØ[
™XÛÜ™
NÂˆÛÛœİÛX[ˆHİš[™Ê˜[YHˆŠKš[J
NÂˆYˆ
XÛX[ŠH™]\›ˆÛX[ÂˆÛÛœİÛØ[\HH
ÛØ[	‰ˆÛØ[\JH
Yš[š][Ûˆ	‰ˆYš[š][Û‹\JNÂˆYˆ
YÛØ[\JH™]\›ˆÛX[ÂˆÛÛœİİ\œ™[Hİš[™Ê™XÛÜ™•\™Ù]ˆŠKš[J
NÂˆYˆ
ÛØ[\HOOH™Û]ˆŠHÂˆ™]\›ˆ™\XÙU\™Ù]Û]\ÙJİ\œ™[ÊÎ‘ÓUŸ™]™[YJH\™Ù]—Ê–××JËÚKÓUˆ\™Ù]ˆ	ØÛX[ŸX
NÂˆBˆYˆ
ÛØ[\HOOH˜ÛÛ[Z\ÜÚ[ÛˆŠHÂˆ™]\›ˆ™\XÙU\™Ù]Û]\ÙJİ\œ™[ĞÛÛ[Z\ÜÚ[Ûˆ\™Ù]—Ê–××JËÚKÛÛ[Z\ÜÚ[Ûˆ\™Ù]ˆ	ØÛX[ŸX
NÂˆBˆYˆ
ÛØ[\HOOHœ™[[İ˜[ŠHÂˆÛÛœİÛİ[H
ÛX[‹›X]Ú
Ö×—JËÊHÈˆ—JVÌHÛX[Âˆ™]\›ˆ™\XÙU\™Ù]Û]\ÙJİ\œ™[ÊÎ“Y\˜Ú[™[[İ˜[\™Ù]—ÊŸœ˜[™\™Ù]—Ê”›Û[İWÊŠV××JËÚKY\˜Ú[™[[İ˜[\™Ù]ˆ	ØÛİ[X
NÂˆBˆYˆ
ÛØ[\HOOHœ›Û[İ[ÛˆŠHÂˆÛÛœİÛİ[H
ÛX[‹›X]Ú
Ö×—JËÊHÈˆ—JVÌHÛX[ÂˆÛÛœİİY™š^X]ÚHİ\œ™[›X]Ú
Ğœ˜[™\™Ù]—Ê”›Û[İWÊ–×—J×Êœ˜[™ÏÊ××JŠKÚJNÂˆÛÛœİİY™š^HİY™š^X]Ú	‰ˆİY™š^X]ÚÌWHÈİY™š^X]ÚÌWKš[J
HˆˆÂˆ™]\›ˆ™\XÙU\™Ù]Û]\ÙJİ\œ™[Ğœ˜[™\™Ù]—Ê”›Û[İWÊ–××JËÚKœ˜[™\™Ù]ˆ›Û[İH	ØÛİ[Hœ˜[™ÉÜİY™š^È	ÜİY™š^XˆˆŸX
NÂˆBˆYˆ
ÛØ[\HOOH˜œ˜[™ŠHÂˆ™]\›ˆ™\XÙU\™Ù]Û]\ÙJİ\œ™[Ğœ˜[™\™Ù]—ÊŠÈT›Û[İJV××JËÚKœ˜[™\™Ù]ˆ	ØÛX[ŸX
NÂˆBˆ™]\›ˆÛX[ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]›Ü›R[
™XÛÜ™ÛØ[Yš[š][ÛŠHÂˆÛÛœİY]Ù^HH™XÛÜ™—×İ\™Ù]İ™\œšYRÙ^H\™Ù]İ™\œšYRÙ^J™XÛÜ™
NÂˆ™]\›ˆ›Ü›HÛ\ÜÏH\™Ù]YY]Y›Ü›Hˆ]K]\™Ù]YY]Y›Ü›H]K]\™Ù]YY]ZÙ^OH‰Ù\ØØ\R[
Y]Ù^J_Hˆ]K]\™Ù]]Y\H‰Ù\ØØ\R[
Yš[š][Û‹Y\Š_Hˆ]K]\™Ù]]\OH‰Ù\ØØ\R[
Yš[š][Û‹\J_Hˆ]K]\™Ù][[ÛH‰Ù\ØØ\R[
™XÛÜ™“[Û
_H‚ˆ[œ]˜[YOH\™Ù]ˆ	İ\™Ù]Y][œ]]šX]\ÊÛØ[Yš[š][ÛŠ_H˜[YOH‰Ù\ØØ\R[
\™Ù]Y]˜[YJ™XÛÜ™ÛØ[Yš[š][ÛŠJ_Hˆ\šXK[X™[H•\™Ù]˜[YH›Üˆ	Ù\ØØ\R[
Yš[š][Û‹Y\Š_HˆÏ‚ˆ]Ûˆ\OHœİX›Z]”Ø]™OØ]Û‚ˆ]Ûˆ\OH˜]Ûˆˆ]K]\™Ù]YY]XØ[˜Ù[Ø[˜Ù[Ø]Û‚ˆÙ›Ü›O˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]XİX[]˜Z[X›J™XÛÜ™ÛØ[
HÂˆYˆ
\™XÛÜ™™XÛÜ™—×İ\™Ù]XÙZÛ\“Û›HYÛØ[S[X™\‹š\Ñš[š]JÛØ[˜XİX[
JH™]\›ˆ˜[ÙNÂˆYˆ
ÛØ[\HOOHœ™[[İ˜[ˆ	‰ˆ™XÛÜ™—×ÜÛİ\˜ÙHOOH™]X˜\ÙHˆ	‰ˆ\™XÛÜ™—×İY\‘^]Ğ]˜Z[X›JH™]\›ˆ˜[ÙNÂˆ™]\›ˆYNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]ÛØ[Ø\™[
™XÛÜ™[™^™\ÛÛ™YÛØ[H[
HÂˆÛÛœİÛØ[H™\ÛÛ™YÛØ[\™Ù]ÛØ[
™XÛÜ™
NÂˆYˆ
YÛØ[YÛØ[\™Ù]
H™]\›ˆˆÂˆÛÛœİYš[š][ÛˆH\™Ù]›ÙÜ™\ÜÑYš[š][ÛŠ™XÛÜ™•Y\ŠHÈY\ˆ™XÛÜ™•Y\‹\NˆÛØ[\HNÂˆÛÛœİ\ĞXİX[H\™Ù]XİX[]˜Z[X›J™XÛÜ™ÛØ[
NÂˆÛÛœİ›ÙÜ™\ÜÈH\ĞXİX[ÈÛØ[˜XİX[ÈÛØ[\™Ù]ˆÂˆÛÛœİØ\YHX]›X^
X]›Z[ŠL›ÙÜ™\ÜÈ
ˆL
JNÂˆÛÛœİ[HH\ĞXİX[ÈÛØ[˜XİX[HÛØ[\™Ù]ˆ[ÂˆÛÛœİY]H\ĞXİX[	‰ˆ[HHÂˆÛÛœİ›ÙÜ™\ÜÕ^H\ĞXİX[ˆÈ	Ê›ÙÜ™\ÜÈ
ˆL
KÓØØ[Tİš[™Ê[™Yš[™YÈZ[š[][Qœ˜Xİ[Û‘YÚ]ÎˆKX^[][Qœ˜Xİ[Û‘YÚ]ÎˆHJ_IXˆˆ]ØZ][™È]HÂˆÛÛœİY]Ù^HH™XÛÜ™—×İ\™Ù]İ™\œšYRÙ^H\™Ù]İ™\œšYRÙ^J™XÛÜ™
NÂˆÛÛœİ\™Ù]ÛÛ›ÛHİ]K\™Ù]Y][™ÒÙ^HOOHY]Ù^BˆÈ\™Ù]Y]›Ü›R[
™XÛÜ™ÛØ[Yš[š][ÛŠBˆˆÜ[ˆÛ\ÜÏH\™Ù]]˜[YK[[™H‚ˆİ›Û™Ï‰Ù\ØØ\R[
ÛØ[\™Ù]^
_OÜİ›Û™Ï‚ˆ]ÛˆÛ\ÜÏH\™Ù]YY]X]Ûˆˆ\OH˜]Ûˆˆ]K]\™Ù]YY]ZÙ^OH‰Ù\ØØ\R[
Y]Ù^J_Hˆ\šXK[X™[H‘Y]\™Ù]›Üˆ	Ù\ØØ\R[
™XÛÜ™•Y\Š_H‘Y]Ø]Û‚ˆÜÜ[˜Âˆ™]\›ˆ\XÛHÛ\ÜÏH\™Ù]\›ÙÜ™\ÜËXØ\™\™Ù]XØ\™Y[\ˆˆİ[OH‹KZN‰Ú[™^H‚ˆ]ˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜËXØ\™ZXY‚ˆ]‚ˆİ›Û™Ï‰Ù\ØØ\R[
™XÛÜ™•Y\Š_OÜİ›Û™Ï‚ˆÜ[‰Ù\ØØ\R[
ÛØ[›X™[
_OÜÜ[‚ˆÙ]‚ˆÜ[ˆÛ\ÜÏH\™Ù]\İ]\Ë\[	Ú\ĞXİX[È
Y]È›Y]ˆˆ›Z\ÜÈŠHˆœXÙZÛ\ˆŸH‰Ù\ØØ\R[
›ÙÜ™\ÜÕ^
_OÜÜ[‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜË]˜[Y\È‚ˆ]‚ˆÜ[•\™Ù]ÜÜ[‚ˆ	İ\™Ù]ÛÛ›ÛBˆÙ]‚ˆ]Ü[XİX[ÜÜ[İ›Û™Ï‰Ù\ØØ\R[
\ĞXİX[ÈÛØ[˜XİX[^ˆ]ØZ][™È]HŠ_OÜİ›Û™ÏÙ]‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜËX˜\ˆˆ\šXKZY[HYHÜ[ˆİ[OHÚY‰ØØ\YÑš^Y
Š_IHÜÜ[Ù]‚ˆÛ\ÜÏH‰Ú\ĞXİX[È
Y]ÈœÜÚ]]™Hˆˆ›™YØ]]™HŠHˆˆŸH‰Ú\ĞXİX[È	ÛY]ÈŠÈˆˆ‹HŸH	Ù\ØØ\R[
[HHÈ	ØÛÛ\Xİ[X™\Š[J_HX›İ™H\™Ù]ˆ	ØÛÛ\Xİ[X™\ŠX]˜XœÊ[JJ_HÈ\™Ù]
_Xˆ]ØZ][™ÈXİX[]KˆŸOÜ‚ˆØ\XÛO˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]XÙZÛ\XİX[^
Yš[š][Û‹™XÛÜ™
HÂˆYˆ
\™XÛÜ™
H™]\›ˆ]ØZ][™È]HÂˆYˆ
Yš[š][Û‹\HOOH™Û]ˆŠH™]\›ˆÛÛ\Xİ[Û™^J\œÙTÚY][X™\Š™XÛÜ™”™]™[YJJNÂˆYˆ
Yš[š][Û‹\HOOH˜ÛÛ[Z\ÜÚ[ÛˆŠHÂˆÛÛœİXİX[H\™Ù]Ü[Û˜[Y]šXÕ˜[YJ™XÛÜ™È”^[İ]‹•İ[ÛÛ[Z\ÜÚ[Ûˆ‹ÛÛ[Z\ÜÚ[ÛˆXYH‹Y™š[X]H^[İ]—JNÂˆ™]\›ˆXİX[OOH[È]ØZ][™È]HˆˆÛÛ\Xİ[Û™^JXİX[
NÂˆBˆYˆ
Yš[š][Û‹\HOOHœ™[[İ˜[ŠHÂˆYˆ
™XÛÜ™—×ÜÛİ\˜ÙHOOH™]X˜\ÙHˆ	‰ˆ\™XÛÜ™—×İY\‘^]Ğ]˜Z[X›JH™]\›ˆ]ØZ][™È]HÂˆ™]\›ˆ	Ü\œÙTÚY][X™\Š™XÛÜ™È•Y\ˆ^]È—JKÓØØ[Tİš[™Ê
_H™[[İ™YÂˆBˆ™]\›ˆ]ØZ][™È]HÂˆB‚ˆ[˜İ[Ûˆ\™Ù]XÙZÛ\Ø\™[
Yš[š][Û‹™XÛÜ™[™^
HÂˆÛÛœİ[ÛX™[Hİ]K\™Ù]š[\œË›[ÛOOH˜[ˆÈHÙ[XİY[Ûˆˆİ]K\™Ù]š[\œË›[ÛÂˆÛÛœİY]X›T™XÛÜ™H\™Ù]Y]X›T™XÛÜ™
Yš[š][Û‹™XÛÜ™
NÂˆÛÛœİY]Ù^HHY]X›T™XÛÜ™	‰ˆ
Y]X›T™XÛÜ™—×İ\™Ù]İ™\œšYRÙ^H\™Ù]İ™\œšYRÙ^JY]X›T™XÛÜ™
JNÂˆÛÛœİ\™Ù]ÛÛ›ÛHY]X›T™XÛÜ™	‰ˆİ]K\™Ù]Y][™ÒÙ^HOOHY]Ù^BˆÈ\™Ù]Y]›Ü›R[
Y]X›T™XÛÜ™[Yš[š][ÛŠBˆˆY]Ù^BˆÈ]ÛˆÛ\ÜÏH\™Ù]YY]X]Ûˆ\™Ù]\Ù]X]Ûˆˆ\OH˜]Ûˆˆ]K]\™Ù]YY]ZÙ^OH‰Ù\ØØ\R[
Y]Ù^J_Hˆ\šXK[X™[H”Ù]\™Ù]›Üˆ	Ù\ØØ\R[
Yš[š][Û‹Y\Š_H”Ù]\™Ù]Ø]Û˜ˆˆİ›Û™ÈÛ\ÜÏH\™Ù]\XÙZÛ\‹]˜[YH”Ù]\™Ù]Üİ›Û™Ï˜Âˆ™]\›ˆ\XÛHÛ\ÜÏH\™Ù]\›ÙÜ™\ÜËXØ\™\™Ù]\›ÙÜ™\ÜË\XÙZÛ\ˆ\™Ù]XØ\™Y[\ˆˆİ[OH‹KZN‰Ú[™^H‚ˆ]ˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜËXØ\™ZXY‚ˆ]‚ˆİ›Û™Ï‰Ù\ØØ\R[
Yš[š][Û‹Y\Š_OÜİ›Û™Ï‚ˆÜ[‰Ù\ØØ\R[
Yš[š][Û‹›X™[
_OÜÜ[‚ˆÙ]‚ˆÜ[ˆÛ\ÜÏH\™Ù]\İ]\Ë\[XÙZÛ\ˆ•\™Ù]™YYYÜÜ[‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜË]˜[Y\È‚ˆ]Ü[•\™Ù]ÜÜ[‰İ\™Ù]ÛÛ›ÛOÙ]‚ˆ]Ü[XİX[ÜÜ[İ›Û™Ï‰Ù\ØØ\R[
\™Ù]XÙZÛ\XİX[^
Yš[š][Û‹™XÛÜ™
J_OÜİ›Û™ÏÙ]‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜËX˜\ˆXÙZÛ\ˆˆ\šXKZY[HYHÜ[ÜÜ[Ù]‚ˆ”Ù]H	Ù\ØØ\R[
Yš[š][Û‹›X™[ÓİÙ\Ø\ÙJ
J_H›Üˆ	Ù\ØØ\R[
[ÛX™[
_KÜ‚ˆØ\XÛO˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]›ÙÜ™\ÜÒ[
™XÛÜ™ÊHÂˆÛÛœİY]šXÔ›İÜÈH\™Ù]Y]šXÔ›İÜÊ™XÛÜ™ÊNÂˆÛÛœİÙ[XİYY\ˆHİ]K\™Ù]š[\œËY\ÂˆÛÛœİYš[š][ÛœÈHT‘ÑUÔ“ÑÔ‘TÔ×ÑQ’S’USÓ”Ë™š[\Š
Yš[š][ÛŠHOˆ
ˆÙ[XİYY\ˆOOH˜[ˆYš[š][Û‹Y\‹ÓİÙ\Ø\ÙJ
HOOHİš[™ÊÙ[XİYY\ŠKÓİÙ\Ø\ÙJ
Bˆ
JNÂˆ]Xİ]™PÛİ[HÂˆÛÛœİØ\™ÈHYš[š][ÛœË›X\

Yš[š][Û‹[™^
HOˆÂˆÛÛœİ™XÛÜ™HY]šXÔ›İÜË™š[™

›İÊHOˆİš[™Ê›İË•Y\ŠKÓİÙ\Ø\ÙJ
HOOHYš[š][Û‹Y\‹ÓİÙ\Ø\ÙJ
JH[ÂˆÛÛœİY]X›T™XÛÜ™H\™Ù]Y]X›T™XÛÜ™
Yš[š][Û‹™XÛÜ™
NÂˆÛÛœİÛØ[HY]X›T™XÛÜ™È\™Ù]ÛØ[
Y]X›T™XÛÜ™
Hˆ[ÂˆYˆ
Y]X›T™XÛÜ™	‰ˆ\™Ù]ÛØ[X]Ú\ÑYš[š][ÛŠÛØ[Yš[š][ÛŠJHÂˆXİ]™PÛİ[
ÏHNÂˆ™]\›ˆ\™Ù]ÛØ[Ø\™[
Y]X›T™XÛÜ™[™^ÛØ[
NÂˆBˆ™]\›ˆ\™Ù]XÙZÛ\Ø\™[
Yš[š][Û‹™XÛÜ™[™^
NÂˆJNÂˆÛÛœİİ[™\™Y\œÈH™]ÈÙ]
T‘ÑUÔ“ÑÔ‘TÔ×ÑQ’S’USÓ”Ë›X\

Yš[š][ÛŠHOˆYš[š][Û‹Y\‹ÓİÙ\Ø\ÙJ
JJNÂˆY]šXÔ›İÜÂˆ™š[\Š
™XÛÜ™
HOˆ\İ[™\™Y\œËš\Êİš[™Ê™XÛÜ™•Y\ŠKÓİÙ\Ø\ÙJ
JJBˆ™›Ü‘XXÚ

™XÛÜ™
HOˆÂˆÛÛœİØ\™H\™Ù]ÛØ[Ø\™[
™XÛÜ™Ø\™Ë›[™İ
NÂˆYˆ
Ø\™
HÂˆØ\™Ëœ\Ú
Ø\™
NÂˆXİ]™PÛİ[
ÏHNÂˆBˆJNÂˆÛÛœİÛİ[X™[H	ØXİ]™PÛİ[ÓØØ[Tİš[™Ê
_HXİ]™H\™Ù]ØÂˆ™]\›ˆÙXİ[ÛˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜË\ÙXİ[Ûˆ\™Ù]XØ\™Y[\ˆˆİ[OH‹KZNˆ‚ˆ]ˆÛ\ÜÏH\™Ù]\ÙXİ[Û‹ZXY\ˆ‚ˆ]‚ˆÏ•Y\ˆ\™Ù]›ÙÜ™\ÜÏÚÏ‚ˆ‰Ù\ØØ\R[
İ]K\™Ù]š[\œË›[ÛOOH˜[ˆÈ[[ÛÈˆˆİ]K\™Ù]š[\œË›[Û
_H\™Ù]ÈHY\Ü‚ˆÙ]‚ˆÜ[‰Ù\ØØ\R[
Ûİ[X™[
_OÜÜ[‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]\›ÙÜ™\ÜËYÜšY‰ØØ\™Ë›[™İÈØ\™Ëš›Ú[ŠˆŠHˆ]ˆÛ\ÜÏH\™Ù]Y[\K\İ]H“›È\™Ù]ÛÛ™šYİ\˜][Ûˆ\È]˜Z[X›H›Üˆ\ÈY\‹Ù]˜OÙ]‚ˆÜÙXİ[Û˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™šY]Ê
HÂˆ™]\›ˆİ]K\™Ù]™[™šY]ÈOOH™^HˆÈ™^Hˆˆ›[ÛÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™İX]JY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
JHÂˆYˆ
\™Ù]™[™šY]Ê
HOOH™^HŠHÂˆÛÛœİ[ÛÙ^HH\™Ù]”İ]\Ó[ÛÙ^J
Hİ]K™”İ]\Ë›[ÛÙ^H[ÛÙ^Qœ›ÛU^
İ]K™”İ]\Ë™]OË™Z[U™[™Ë›[ÛˆŠNÂˆÛÛœİ[ÛX™[H[ÛX™[œ›ÛRÙ^J[ÛÙ^JNÂˆÛÛœİ™Yš^H[ÛX™[OOH”™\Ü[™ÈˆÈ“]\İZ[Hˆˆ	Û[ÛX™[HZ[XÂˆ™]\›ˆ	Ü™Yš^H	ÛY]šXË›X™[ÓİÙ\Ø\ÙJ
_XÂˆBˆÛÛœİY\ˆHİ]K\™Ù]š[\œËY\Âˆ™]\›ˆY\ˆOOH˜[ˆÈ[™\[™[[ÛH	ÛY]šXË›X™[ÓİÙ\Ø\ÙJ
_HXÜ›ÜÜÈHÚ^[[ÛÚ[™İÈ[™[™È]HÙ[XİY[Ûˆ	İY\ŸH[™\[™[[ÛH	ÛY]šXË›X™[ÓİÙ\Ø\ÙJ
_Hœ›ÛHHY\ˆÛ˜\ÚİÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™šY]ÕXœÒ[

HÂˆÛÛœİšY]ÈH\™Ù]™[™šY]Ê
NÂˆ™]\›ˆT‘ÑUÕ‘S‘Õ’QUÔË›X\

][JHOˆ
ˆ]ÛˆÛ\ÜÏH\™Ù]]™[™]šY]Ë]X‰Ú][KšÙ^HOOHšY]ÈÈˆXİ]™HˆˆˆŸHˆ\OH˜]Ûˆˆ]K]\™Ù]]™[™]šY]ÏH‰Ù\ØØ\R[
][KšÙ^J_Hˆ\šXK\™\ÜÙYH‰Ú][KšÙ^HOOHšY]ÈÈYHˆˆ™˜[ÙHŸH‰Ù\ØØ\R[
][K›X™[
_OØ]Û˜ˆ
JKš›Ú[ŠˆŠNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]šXÕXœÒ[
Y]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
JHÂˆ™]\›ˆT‘ÑUÓQU’PÔË›X\

][JHOˆ
ˆ]ÛˆÛ\ÜÏH\™Ù][Y]šXË]X‰Ú][KšÙ^HOOHY]šXËšÙ^HÈˆXİ]™HˆˆˆŸHˆ\OH˜]Ûˆˆ]K]\™Ù][Y]šXÏH‰Ù\ØØ\R[
][KšÙ^J_Hˆ\šXK\™\ÜÙYH‰Ú][KšÙ^HOOHY]šXËšÙ^HÈYHˆˆ™˜[ÙHŸH‰Ù\ØØ\R[
][K›X™[
_OØ]Û˜ˆ
JKš›Ú[ŠˆŠNÂˆB‚ˆ[˜İ[Ûˆ\™Ù][ÛU™[™›İÜÊ[™XÛÜ™ËY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
JHÂˆÛÛœİY\ˆHİ]K\™Ù]š[\œËY\ÂˆÛÛœİÙ[XİY[ÛHİ]K\™Ù]š[\œË›[ÛÂˆÛÛœİÙ[XİY[ÛÙ^HH\™Ù]”İ]\Ó[ÛÙ^J
NÂˆÛÛœİ\S[ÛÙ^HH[ÛÙ^Qœ›ÛU^
İ]K™”İ]\Ë™]OËœ™XÙ[[ÛÏËÚ[™İÏË™[™[Ûİ]K™”İ]\Ë™]OË™Z[U™[™Ë›[ÛˆŠNÂˆÛÛœİ]™T›İÜÈHY\ˆOOH˜[ˆ	‰ˆİ]K™”İ]\Ë™]H	‰ˆ
\Ù[XİY[ÛÙ^HX\S[ÛÙ^HÙ[XİY[ÛÙ^HOOH\S[ÛÙ^JBˆÈ“[ÛU™[™›İÜÊİ]K™”İ]\Ë™]JBˆˆ×NÂˆYˆ
]™T›İÜË›[™İ
HÂˆ™]\›ˆ]™T›İÜË›X\

›İÊHOˆÂˆÛÛœİ˜[YHH\™Ù]Z[SY]šXÕ˜[YJ›İËY]šXËšÙ^JNÂˆÛÛœİÛİ\˜ÙU^Hİ]K™”İ]\Ë™]OË™[[ÈÈ›ØØ[™]šY]È]Hˆˆœ›ÙXİ[Ûˆ]X˜\ÙHÂˆ™]\›ˆÂˆ‹‹œ›İËˆ˜[YKˆÙ[XİYˆ›ÛÛX[ŠÙ[XİY[ÛÙ^H	‰ˆ›İË›[ÛÙ^HOOHÙ[XİY[ÛÙ^JKˆİ]Nˆ›[Û]X˜\ÙH‹ˆ]Z[ˆ	Ü›İË›X™[Nˆ	Ù›Ü›X]\™Ù]Y]šXÕ˜[YJY]šXËšÙ^K˜[YJ_Hœ›ÛH	ÜÛİ\˜ÙU^XˆNÂˆJNÂˆBˆÛÛœİ[ÛÈH\œ˜^K™œ›ÛJ™]ÈÙ]
[™XÛÜ™Ë›X\

™XÛÜ™
HOˆ™XÛÜ™“[Û
K™š[\Š›ÛÛX[ŠJJBˆœÛÜ

KŠHOˆİš[™Ê\™Ù][ÛÛÜ˜[YJJJK›ØØ[PÛÛ\\™Jİš[™Ê\™Ù][ÛÛÜ˜[YJŠJJJNÂˆÛÛœİÙ[XİY[™^HÙ[XİY[Û	‰ˆÙ[XİY[ÛOOH˜[ˆÈ[ÛËš[™^ÙŠÙ[XİY[Û
Hˆ[ÛË›[™İHNÂˆÛÛœİÚ[™İÑ[™HÙ[XİY[™^HÈÙ[XİY[™^
ÈHˆ[ÛË›[™İÂˆÛÛœİÚ[™İÓ[ÛÈH[ÛËœÛXÙJX]›X^
Ú[™İÑ[™HŠKÚ[™İÑ[™
NÂˆ™]\›ˆÚ[™İÓ[ÛÂˆ›X\

[Û
HOˆÂˆÛÛœİİ[[X\HH\™Ù]İ[[X\J\™Ù]›İÜÑ›Ü“[Û
[™XÛÜ™Ë[ÛY\ŠJNÂˆÛÛœİ˜[YHH\™Ù]İ[[X\SY]šXÕ˜[YJİ[[X\KY]šXËšÙ^JNÂˆ™]\›ˆÂˆX™[ˆ[ÛˆÚÜX™[ˆ[Û^\ÓX™[
\™Ù][ÛÛÜ˜[YJ[Û
KÈÚÜˆYHJKˆ[ÛÙ^Nˆ[ÛÙ^Qœ›ÛU^
\™Ù][ÛÛÜ˜[YJ[Û
JKˆ˜[YKˆÙ[XİYˆ[ÛOOHÙ[XİY[Ûˆİ]Nˆ›[ÛÛ˜\Úİ‹ˆ]Z[ˆ	Û[ÛNˆ	Ù›Ü›X]\™Ù]Y]šXÕ˜[YJY]šXËšÙ^K˜[YJ_XˆNÂˆJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Z[SY]šXÕ˜[YJ›İËÙ^HHİ]K\™Ù]Y]šXÊHÂˆYˆ
Ù^HOOH›Ü™\œÈŠH™]\›ˆ[X™\Š›İË›Ü™\œÊHÂˆYˆ
Ù^HOOH˜ÛXÚÜÈŠH™]\›ˆ[X™\Š›İË˜ÛXÚÜÊHÂˆYˆ
Ù^HOOH˜ÛÛ™\œÚ[ÛˆŠH™]\›ˆ[X™\Š›İË˜ÛÛ™\œÚ[Û”˜]JHÂˆYˆ
Ù^HOOH˜œ˜[™ÈŠH™]\›ˆ[X™\Š›İË˜Xİ]™Pœ˜[™ÈÏÈ›İË˜œ˜[™Ûİ[ÏÈ›İË˜Xİ]™PY™\\Ù\œÊHÂˆ™]\›ˆ[X™\Š›İËœ™]™[YJHÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Z[U™[™›İÜÊY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
JHÂˆÛÛœİ›İÜÈH‘Z[U™[™›İÜÊİ]K™”İ]\Ë™]JNÂˆÛÛœİİ[][]]™HHİ]K™”İ]\Ë™]OË™Z[U™[™Ë˜İ[][]]™HOOHYNÂˆÛÛœİY]]™SY]šXÈHÈœ™]™[YH‹›Ü™\œÈ‹˜ÛXÚÜÈ—Kš[˜ÛY\ÊY]šXËšÙ^JNÂˆ]™]š[İ\Ğİ[][]]™U˜[YHH[Âˆ™]\›ˆ›İÜË›X\

›İÊHOˆÂˆÛÛœİÛİ\˜ÙU˜[YHH\™Ù]Z[SY]šXÕ˜[YJ›İËY]šXËšÙ^JNÂˆÛÛœİ˜]Õ˜[YHHİ[][]]™H	‰ˆY]]™SY]šXÈ	‰ˆ™]š[İ\Ğİ[][]]™U˜[YHOOH[ˆÈX]›X^
Ûİ\˜ÙU˜[YHH™]š[İ\Ğİ[][]]™U˜[YJBˆˆÛİ\˜ÙU˜[YNÂˆYˆ
İ[][]]™H	‰ˆY]]™SY]šXÈ	‰ˆ›İËœİ]HOOH™[^HŠH™]š[İ\Ğİ[][]]™U˜[YHHÛİ\˜ÙU˜[YNÂˆÛÛœİ\Ô\X[˜[YHH›İËœİ]HOOH™[^Hˆ	‰ˆX]˜XœÊ˜]Õ˜[YJHˆŒNÂˆÛÛœİ\Õ˜[YHH›İËœİ]HOOH™[^Hˆ\Ô\X[˜[YNÂˆÛÛœİ˜[YHH\Õ˜[YHÈ˜]Õ˜[YHˆ[Âˆ™]\›ˆÂˆX™[ˆÚÜ]SX™[
›İË™]JKˆÚÜX™[ˆ^\Ñ]SX™[
›İË™]JKˆ˜[YKˆİ]Nˆ›İËœİ]H›ØœÙ\™Y‹ˆ]Z[ˆ	ÜÚÜ]SX™[
›İË™]J_Nˆ	Ú\Õ˜[YHÈ›Ü›X]\™Ù]Y]šXÕ˜[YJY]šXËšÙ^K˜]Õ˜[YJHˆ”[™[™ÈŸIÜ›İËœİ]HOOH™[^HˆÈˆ
\X[
HˆˆˆŸXˆNÂˆJNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™İ™Ò[
™[™›İÜËY]šXËšY]ÓX™[
HÂˆÛÛœİ˜[Y\ÈH™[™›İÜË›X\

›İÊHOˆ›İË˜[YJNÂˆÛÛœİ[Y\šXÕ˜[Y\ÈH˜[Y\Ë™š[\Š
˜[YJHOˆ[X™\‹š\Ñš[š]J˜[YJJNÂˆYˆ
[[Y\šXÕ˜[Y\Ë›[™İ
HÂˆ™]\›ˆ]ˆÛ\ÜÏH\™Ù]Y[\K\İ]H‰İšY]ÓX™[OOH‘^HˆÈ‘Z[H™[™]H\Èİ[ØY[™Ëˆˆˆ“›È™[™]H\È]˜Z[X›H›Üˆ\ÈÙ[Xİ[Û‹ˆŸOÙ]˜ÂˆBˆÛÛœİX^HX]›X^
‹‹›[Y\šXÕ˜[Y\ËJNÂˆÛÛœİZ[ˆHÂˆÛÛœİÚYHÍŒÂˆÛÛœİZYÚHÂˆÛÛœİYHÈYˆšYÚˆÜˆÍ›İÛNˆˆNÂˆÛÛœİ[›™\•ÚYHÚYHY›YHYœšYÚÂˆÛÛœİ[›™\’ZYÚHZYÚHYÜHY˜›İÛNÂˆÛÛœİ˜[™ÙHHX^HZ[ˆNÂˆÛÛœİÚ[ÈH™[™›İÜË›X\

›İË[™^
HOˆÂˆÛÛœİHY›Y
È
™[™›İÜË›[™İHHÈ[›™\•ÚYÈˆˆ
[™^È
™[™›İÜË›[™İHJJH
ˆ[›™\•ÚY
NÂˆÛÛœİ\Õ˜[YHH[X™\‹š\Ñš[š]J›İË˜[YJNÂˆÛÛœİHH\Õ˜[YHÈYÜ
È[›™\’ZYÚH

›İË˜[YHHZ[ŠHÈ˜[™ÙJH
ˆ[›™\’ZYÚˆZYÚHY˜›İÛNÂˆ™]\›ˆÈ‹‹œ›İËK\Õ˜[YHNÂˆJNÂˆÛÛœİ\ÑZ[HHšY]ÓX™[OOH‘^HÂˆÛÛœİÛ[[™HHÚ[Ë™š[\Š
Ú[
HOˆÚ[š\Õ˜[YJK›X\

Ú[
HOˆ	ÜÚ[Ñš^Y
Š_K	ÜÚ[KÑš^Y
Š_X
Kš›Ú[ŠˆŠNÂˆÛÛœİX™[]™\HHšY]ÓX™[OOH‘^Hˆ	‰ˆÚ[Ë›[™İˆMÈX]˜ÙZ[
Ú[Ë›[™İÈJHˆNÂˆÛÛœİÜšYXÚÜÈHÌŒKKÍKWNÂˆÛÛœİZ[Tİ\HÚ[Ë›[™İˆHÈ[›™\•ÚYÈ
Ú[Ë›[™İHJHˆ[›™\•ÚYÂˆÛÛœİZ[P˜\•ÚYHX]›X^
KX]›Z[ŠNZ[Tİ\
ˆN
JNÂˆËÈÛÙ\™XHš[›Üˆ[ÛH™[™Ú\Ë‚ˆ˜\ˆÜ˜YY[YH\™Ù]™[™\™XQÜ˜YY[Âˆ˜\ˆ™[™\™XT]HˆÂˆYˆ
Z\ÑZ[JHÂˆ˜\ˆ˜[Y›Ü\™XHHÚ[Ë™š[\Š[˜İ[ÛŠ
HÈ™]\›ˆš\Õ˜[YNÈJNÂˆYˆ
˜[Y›Ü\™XK›[™İHŠHÂˆ˜\ˆ\™XTÚ[ÈH˜[Y›Ü\™XK›X\
[˜İ[ÛŠ
HÈ™]\›ˆÑš^Y
ŠH
È‹ˆ
ÈKÑš^Y
ŠNÈJNÂˆ˜\ˆ›İÛVHHZYÚHY˜›İÛNÂˆ™[™\™XT]H“Hˆ
È˜[Y›Ü\™XVÌKÑš^Y
ŠH
È‹ˆ
È›İÛVKÑš^Y
ŠBˆ
Èˆˆ
È\™XTÚ[Ëš›Ú[ŠˆŠBˆ
Èˆˆ
È˜[Y›Ü\™XVİ˜[Y›Ü\™XK›[™İHWKÑš^Y
ŠH
È‹ˆ
È›İÛVKÑš^Y
ŠH
ÈˆˆÂˆBˆBˆ™]\›ˆİ™ÈšY]Ğ›ŞHŒ	İÚYH	ÚZYÚHˆ›ÛOHš[YÈˆ\šXK[X™[H‰Ù\ØØ\R[
šY]ÓX™[
_H	Ù\ØØ\R[
Y]šXË›X™[
_H™[™ˆ]K]™[™XYÙÜ™YØ][ÛH‰Ú\ÑZ[HÈ™Z[KZ[™\[™[ˆˆ›[ÛKZ[™\[™[ŸH‚ˆ	ÈZ\ÑZ[HÈYœÏ[™X\‘Ü˜YY[YH‰ÙÜ˜YY[YHˆOHŒˆLOHŒˆHŒˆLHŒHİÜÙ™œÙ]HŒ	HˆİÜXÛÛÜHˆÍY™HˆİÜ[ÜXÚ]OHŒŒN‹ÏİÜÙ™œÙ]HMIHˆİÜXÛÛÜHˆÎ˜ŒYÈˆİÜ[ÜXÚ]OHŒŒ‹ÏİÜÙ™œÙ]HŒL	HˆİÜXÛÛÜHˆÙÙN™ˆˆİÜ[ÜXÚ]OHŒŒˆ‹ÏÛ[™X\‘Ü˜YY[ÙYœÏ˜ˆˆŸBˆ	ÙÜšYXÚÜË›X\

˜][ÊHOˆÂˆÛÛœİHHYÜ
È[›™\’ZYÚH˜][È
ˆ[›™\’ZYÚÂˆÛÛœİ˜[YHHZ[ˆ
È˜][È
ˆ˜[™ÙNÂˆ™]\›ˆÈÛ\ÜÏH™[™YÜšY[™HOH‰ÜY›YHˆLOH‰ŞKÑš^Y
Š_HˆH‰İÚYHYœšYÚHˆLH‰ŞKÑš^Y
Š_HÛ[™O^H‰ÜY›YHLŸHˆOH‰ÊH
È
KÑš^Y
Š_Hˆ^X[˜ÚÜH™[™‰Ù\ØØ\R[
›Ü›X]\™Ù]Y]šXÕ˜[YJY]šXËšÙ^K˜[YJJ_Oİ^ÙÏ˜ÂˆJKš›Ú[ŠˆŠ_Bˆ	ÈZ\ÑZ[H	‰ˆ™[™\™XT]È]H‰İ™[™\™XT]HˆÛ\ÜÏH™[™X\™XHÜ]˜ˆˆŸBˆ	Ú\ÑZ[HÈˆˆˆÛ[[™HÚ[ÏH‰ÜÛ[[™_HˆÛ\ÜÏH™[™[[™HÜÛ[[™O˜Bˆ	ÜÚ[Ë›X\

Ú[[™^
HOˆÂˆÛÛœİ\İÚ[[™^HÚ[Ë›[™İHNÂˆÛÛœİÚİĞ^\ÓX™[HZ\ÑZ[Hˆ[™^OOHˆ[™^OOH\İÚ[[™^ˆ
[™^	HX™[]™\HOOH	‰ˆ\İÚ[[™^H[™^HX]›X^
‹X™[]™\HHJJNÂˆÛÛœİÛÛ\ÚYHMMÂˆÛÛœİÛÛ\ZYÚHÂˆÛÛœİÛÛ\HX]›X^
X]›Z[ŠÚYHÛÛ\ÚYHÚ[HÛÛ\ÚYÈŠJNÂˆÛÛœİÛÛ\HHÚ[HYÜ
ÈÛÛ\ZYÚ
ÈÈÚ[H
ÈLˆˆÚ[HHÛÛ\ZYÚHLÂˆÛÛœİÛÛ\˜[YHHÚ[š\Õ˜[YHÈ›Ü›X]\™Ù]Y]šXÕ˜[YJY]šXËšÙ^KÚ[˜[YJHˆ”[™[™ÈÂˆ™]\›ˆÈÛ\ÜÏH\™Ù]]™[™\Ú[	Ù\ØØ\R[
Ú[œİ]HˆŠ_IÜÚ[œÙ[XİYÈˆÙ[XİYˆˆˆŸHˆXš[™^HŒˆ›Øİ\ØX›OHYHˆ›ÛOHš[YÈˆ\šXK[X™[H‰Ù\ØØ\R[
Ú[™]Z[Ú[›X™[
_H‚ˆ]O‰Ù\ØØ\R[
Ú[™]Z[Ú[›X™[
_Oİ]O‚ˆ	Ú\ÑZ[BˆÈ™XİH‰ÊÚ[HZ[P˜\•ÚYÈŠKÑš^Y
Š_HˆOH‰ÜÚ[š\Õ˜[YHÈÚ[KÑš^Y
ŠHˆ
ZYÚHY˜›İÛHH
KÑš^Y
Š_HˆÚYH‰ÙZ[P˜\•ÚYÑš^Y
Š_HˆZYÚH‰ÜÚ[š\Õ˜[YHÈX]›X^
ZYÚHY˜›İÛHHÚ[JKÑš^Y
ŠHˆŸHˆHŒ‹HˆÛ\ÜÏH\™Ù]YZ[KX˜\ˆ	ÜÚ[š\Õ˜[YHÈˆˆˆ›]]YŸH	Ù\ØØ\R[
Ú[œİ]HˆŠ_HÜ™Xİ˜ˆˆÚ\˜ÛHŞH‰ÜÚ[Ñš^Y
Š_HˆŞOH‰ÜÚ[KÑš^Y
Š_HˆH‰ÜÚ[œÙ[XİYÈˆˆˆHŸHˆÛ\ÜÏH™[™Yİ	ÜÚ[š\Õ˜[YHÈˆˆˆ›]]YŸH	Ù\ØØ\R[
Ú[œİ]HˆŠ_HØÚ\˜ÛO˜Bˆ	ÜÚ[š\Õ˜[YH	‰ˆ
Ú[œÙ[XİY
šY]ÓX™[OOH‘^Hˆ	‰ˆ[™^OOHÚ[Ë›[™İHJJHÈ^H‰ÜÚ[Ñš^Y
Š_HˆOH‰ÓX]›X^
NÚ[HHM
KÑš^Y
Š_Hˆ^X[˜ÚÜH›ZYHˆÛ\ÜÏH™[™]˜[YK[X™[‰Ù\ØØ\R[
›Ü›X]\™Ù]Y]šXÕ˜[YJY]šXËšÙ^KÚ[˜[YJJ_Oİ^˜ˆˆŸBˆ	ÜÚİĞ^\ÓX™[È^H‰ÜÚ[Ñš^Y
Š_HˆOH‰ÚZYÚHLŸHˆ^X[˜ÚÜH›ZYHˆÛ\ÜÏH™[™[[Û‰Ù\ØØ\R[
Ú[œÚÜX™[Ú[›X™[
_Oİ^˜ˆˆŸBˆÈÛ\ÜÏH\™Ù]]™[™]ÛÛ\ˆ˜[œÙ›Ü›OH˜[œÛ]J	İÛÛ\Ñš^Y
Š_H	İÛÛ\KÑš^Y
Š_JHˆ\šXKZY[HYH‚ˆ™XİÚYH‰İÛÛ\ÚYHˆZYÚH‰İÛÛ\ZYÚHˆHÈÜ™Xİ‚ˆ^HŒLHˆOHŒNˆÛ\ÜÏH\™Ù]]™[™]ÛÛ\Y]H‰Ù\ØØ\R[
Ú[›X™[
_Oİ^‚ˆ^HŒLHˆOHŒÍˆˆÛ\ÜÏH\™Ù]]™[™]ÛÛ\]˜[YH‰Ù\ØØ\R[
ÛÛ\˜[YJ_Oİ^‚ˆÙÏ‚ˆÙÏ˜ÂˆJKš›Ú[ŠˆŠ_BˆÜİ™Ï˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™İ[
[™XÛÜ™ÊHÂˆÛÛœİY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
NÂˆYˆ
\™Ù]™[™šY]Ê
HOOH™^HŠHÂˆÛÛœİ\Ú\™Y[ÛH\™Ù]”İ]\Ó[ÛÙ^J
NÂˆÛÛœİ]S[ÛH[ÛÙ^Qœ›ÛU^
İ]K™”İ]\Ë™]OË™Z[U™[™Ë›[ÛˆŠNÂˆYˆ
\Ú\™Y[Û	‰ˆ]S[Û	‰ˆ]S[ÛOOH\Ú\™Y[Û
HÂˆ™]\›ˆ]ˆÛ\ÜÏH\™Ù]Y[\K\İ]H“ØY[™È	Ù\ØØ\R[
[ÛX™[œ›ÛRÙ^J\Ú\™Y[Û
J_HZ[H™[™]KÙ]˜ÂˆBˆYˆ
\İ]K™”İ]\Ë™]H	‰ˆİ]K™”İ]\Ë›ØY[™ÊHÂˆ™]\›ˆ]ˆÛ\ÜÏH\™Ù]Y[\K\İ]H“ØY[™ÈZ[H™[™]KÙ]˜ÂˆBˆYˆ
\İ]K™”İ]\Ë™]H	‰ˆİ]K™”İ]\Ë™\œ›ÜŠHÂˆ™]\›ˆ]ˆÛ\ÜÏH\™Ù]Y[\K\İ]H‰Ù\ØØ\R[
İ]K™”İ]\Ë™\œ›ÜŠ_OÙ]˜ÂˆBˆ™]\›ˆ\™Ù]™[™İ™Ò[
\™Ù]Z[U™[™›İÜÊY]šXÊKY]šXË‘^HŠNÂˆBˆÛÛœİ\Ú\™Y[ÛH\™Ù]”İ]\Ó[ÛÙ^J
NÂˆÛÛœİ]S[ÛH[ÛÙ^Qœ›ÛU^
İ]K™”İ]\Ë™]OËœ™XÙ[[ÛÏËÚ[™İÏË™[™[Ûİ]K™”İ]\Ë™]OË™Z[U™[™Ë›[ÛˆŠNÂˆYˆ
İ]K\™Ù]š[\œËY\ˆOOH˜[ˆ	‰ˆ\Ú\™Y[Û	‰ˆİ]K™”İ]\Ë›ØY[™È	‰ˆ]S[ÛOOH\Ú\™Y[Û
HÂˆ™]\›ˆ]ˆÛ\ÜÏH\™Ù]Y[\K\İ]H“ØY[™ÈHÚ^[[Û]X˜\ÙHÚ[™İÈ[™[™È	Ù\ØØ\R[
[Û^\ÓX™[
\Ú\™Y[Û
J_KÙ]˜ÂˆBˆ™]\›ˆ\™Ù]™[™İ™Ò[
\™Ù][ÛU™[™›İÜÊ[™XÛÜ™ËY]šXÊKY]šXË“[ÛHŠNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™XY[™Ê
HÂˆ™]\›ˆ\™Ù]™[™šY]Ê
HOOH™^HˆÈ‘Z[H™[™ˆˆ“[ÛH™[™ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™Ûİ\˜ÙR[

HÂˆÛÛœİY\’\Ñ]X˜\ÙQ[YÚX›HHİ]K\™Ù]š[\œËY\ˆOOH˜[ÂˆÛÛœİ\Ú\™Y[ÛH\™Ù]”İ]\Ó[ÛÙ^J
NÂˆÛÛœİ]S[ÛH[ÛÙ^Qœ›ÛU^
İ]K™”İ]\Ë™]OË™Z[U™[™Ë›[Ûİ]K™”İ]\Ë™]OËœ™XÙ[[ÛÏËÚ[™İÏË™[™[ÛˆŠNÂˆYˆ
Y\’\Ñ]X˜\ÙQ[YÚX›H	‰ˆİ]K™”İ]\Ë™]H	‰ˆ
Y\Ú\™Y[ÛY]S[Û\Ú\™Y[ÛOOH]S[Û
JHÂˆÛÛœİ[Ù[H”İ]\ÕšY]Ó[Ù[
İ]K™”İ]\Ë™]JNÂˆÛÛœİÛÛ\]U›İYÚH[Ù[›ØœÙ\™Y›İYÚ[Ù[™^XİYÛÛ\]U›İYÚİ]K™”İ]\Ë™]OËœ™XÙ[[ÛÏËÚ[™İÏË›İYÚ]NÂˆÛÛœİİ]\ÈHİ]K™”İ]\Ë™]K™[[ÂˆÈ“ØØ[™]šY]È‚ˆˆ[Ù[šX[OOHœİ[HˆÈ‘]X˜\ÙH[^YYˆˆ”›ÙXİ[Ûˆ]X˜\ÙHÂˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù]\Ûİ\˜ÙK\İ]\È	Ù\ØØ\R[
[Ù[šX[
_HH\šXKZY[HYHÚO‰Ù\ØØ\R[
İ]\Ê_OÜÜ[‚ˆÜ[“Ü™\œÈ[™™]™[YNˆÛœØŞWÛÜ™\—Û™]×ØYÙÜ™YØ]OÜÜ[‚ˆÜ[ÛXÚÜÎˆÛœØŞWØ[X^›Û—ØÛXÚÏÜÜ[‚ˆÜ[ÛÛ\]H›İYÚ	Ù\ØØ\R[
ÚÜ]SX™[
ÛÛ\]U›İYÚ
J_OÜÜ[˜ÂˆBˆYˆ
Y\’\Ñ]X˜\ÙQ[YÚX›H	‰ˆİ]K™”İ]\Ë›ØY[™ÊHÂˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù]\Ûİ\˜ÙK\İ]\ÈŞ[˜Ú[™ÈH\šXKZY[HYHÚO”Ş[˜Ú[™È]X˜\ÙOÜÜ[Ü[“ØY[™È™\šYšYY[ÛH[™Z[Hİ[ÏÜÜ[˜ÂˆBˆYˆ
Y\’\Ñ]X˜\ÙQ[YÚX›H	‰ˆİ]K™”İ]\Ë™\œ›ÜŠHÂˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù]\Ûİ\˜ÙK\İ]\È˜[˜XÚÈH\šXKZY[HYHÚO”ÚY]˜[˜XÚÏÜÜ[Ü[‰Ù\ØØ\R[
İ]K™”İ]\Ë™\œ›ÜŠ_OÜÜ[˜ÂˆBˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù]\Ûİ\˜ÙK\İ]\ÈÛ˜\ÚİH\šXKZY[HYHÚO•Y\ˆÛ˜\ÚİÜÜ[Ü[•Y\ˆš[\š[™È\Ù\ÈH™\Ü[™ÈÚY]™XØ]\ÙHH›ÙXİ[ÛˆX›\ÈÈ›İÛÛZ[ˆH™\šYšYYY\ˆX\[™ÏÜÜ[˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]™[™[
[™XÛÜ™ÊHÂˆÛÛœİY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
NÂˆ™]\›ˆÙXİ[ÛˆÛ\ÜÏH\™Ù]\™\ÜXØ\™\™Ù]]™[™XØ\™\™Ù]XØ\™Y[\ˆˆİ[OH‹KZNH‚ˆ]ˆÛ\ÜÏH\™Ù]\ÙXİ[Û‹ZXY\ˆ‚ˆ]‚ˆÈ]K]\™Ù]]™[™ZXY[™Ï‰Ù\ØØ\R[
\™Ù]™[™XY[™Ê
J_OÚÏ‚ˆ]K]\™Ù]]™[™\İX]O‰Ù\ØØ\R[
\™Ù]™[™İX]JY]šXÊJ_OÜ‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]]™[™XÛÛ›ÛÈ‚ˆ]ˆÛ\ÜÏH\™Ù]]™[™]šY]Ë]XœÈˆ\šXK[X™[H•™[™šY]È‰İ\™Ù]™[™šY]ÕXœÒ[

_OÙ]‚ˆ]ˆÛ\ÜÏH\™Ù][Y]šXË]XœÈˆ\šXK[X™[H•™[™Y]šXÈ‰İ\™Ù]Y]šXÕXœÒ[
Y]šXÊ_OÙ]‚ˆÙ]‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]]™[™\Ûİ\˜ÙHˆ]K]\™Ù]]™[™\Ûİ\˜ÙO‰İ\™Ù]™[™Ûİ\˜ÙR[

_OÙ]‚ˆ]ˆÛ\ÜÏH\™Ù]]™[™\İ‚ˆ	İ\™Ù]™[™İ[
[™XÛÜ™Ê_BˆÙ]‚ˆÜÙXİ[Û˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Üš][‘ÛØ[›Ü“Y]šXÊ™XÛÜ™Ù^HHİ]K\™Ù]Y]šXÊHÂˆÛÛœİ^Hİš[™Ê™XÛÜ™•\™Ù]ˆŠNÂˆYˆ
Ù^HOOHœ™]™[YHŠHÂˆÛÛœİ™]™[YHH^›X]Ú
Ô™]™[YH\™Ù]—Ê—	×ÊŠ×—JÊWÊŠÒÓP—JO×
ÏËÚJNÂˆYˆ
\™]™[YJH™]\›ˆ[ÂˆÛÛœİØØ[HHÈÎˆLNˆLˆLVÔİš[™Ê™]™[YVÌ—HˆŠKÕ\\Ø\ÙJ
WHNÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\Š™]™[YVÌWJH
ˆØØ[NÂˆ™]\›ˆÈ˜\Ú\Îˆ\™Ù]‹X™[ˆ”™]™[YH\™Ù]‹\™Ù]XİX[ˆ\™Ù]›İÓY]šXÕ˜[YJ™XÛÜ™Ù^JHNÂˆBˆYˆ
Ù^HOOH˜œ˜[™ÈŠHÂˆÛÛœİ›Û[İHH^›X]Ú
Ğœ˜[™\™Ù]—Ê”›Û[İWÊŠ×—JÊWÊœ˜[™ÏËÚJNÂˆYˆ
›Û[İJHÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\Š›Û[İVÌWJNÂˆ™]\›ˆÈ˜\Ú\Îˆ\™Ù]‹X™[ˆ”›Û[İ[Ûˆ\™Ù]‹\™Ù]XİX[ˆ\œÙTÚY][X™\Š™XÛÜ™È•Y\ˆ^]È—JHNÂˆBˆÛÛœİœ˜[™H^›X]Ú
Ğœ˜[™\™Ù]—ÊŠ×—JÊW
ÏËÚJNÂˆYˆ
Xœ˜[™
H™]\›ˆ[ÂˆÛÛœİ\™Ù]H\œÙTÚY][X™\Šœ˜[™ÌWJNÂˆ™]\›ˆÈ˜\Ú\Îˆ\™Ù]‹X™[ˆœ˜[™\™Ù]‹\™Ù]XİX[ˆ\™Ù]›İÓY]šXÕ˜[YJ™XÛÜ™Ù^JHNÂˆBˆ™]\›ˆ[ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]šXĞÛÛ\\š\ÛÛ”ØÛÜ™J™XÛÜ™ÛÛ\\š\ÛÛ“X\
HÂˆÛÛœİY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
NÂˆÛÛœİÛØ[H\™Ù]Üš][‘ÛØ[›Ü“Y]šXÊ™XÛÜ™Y]šXËšÙ^JNÂˆYˆ
ÛØ[	‰ˆÛØ[\™Ù]
H™]\›ˆÛØ[˜XİX[ÈÛØ[\™Ù]ÂˆÛÛœİÛÛ\\š\ÛÛˆHÛÛ\\š\ÛÛ“X\	‰ˆÛÛ\\š\ÛÛ“X\™Ù]
İš[™Ê™XÛÜ™•Y\ˆˆŠJNÂˆYˆ
XÛÛ\\š\ÛÛŠH™]\›ˆˆÂˆÛÛœİİ\œ™[H\™Ù]›İÓY]šXÕ˜[YJ™XÛÜ™Y]šXËšÙ^JNÂˆÛÛœİ™]š[İ\ÈH\™Ù]›İÓY]šXÕ˜[YJÛÛ\\š\ÛÛ‹Y]šXËšÙ^JNÂˆYˆ
\™]š[İ\ÊH™]\›ˆİ\œ™[ÈHˆÂˆ™]\›ˆ
İ\œ™[H™]š[İ\ÊHÈX]˜XœÊ™]š[İ\ÊNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]Y]šXÕœÒ[
™XÛÜ™ÛÛ\\š\ÛÛ“X\ÛÛ\\š\ÛÛ“X™[
HÂˆYˆ
\Õ\™Ù]İ[›İÊ™XÛÜ™
JH™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[Hİ[”Ü›Û[ÏÜÜ[˜ÂˆÛÛœİY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
NÂˆÛÛœİÛØ[H\™Ù]Üš][‘ÛØ[›Ü“Y]šXÊ™XÛÜ™Y]šXËšÙ^JNÂˆYˆ
ÛØ[	‰ˆÛØ[\™Ù]
HÂˆÛÛœİİ˜[YHHÛØ[˜XİX[ÈÛØ[\™Ù]ÂˆÛÛœİ[HHÛØ[˜XİX[HÛØ[\™Ù]Âˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[H	Ù[HHÈ\ˆˆ™İÛˆŸH‰Ù[HHÈŠÈˆˆ‹HŸH	Êİ˜[YH
ˆL
KÑš^Y

_IH\™Ù]ÜÜ[˜ÂˆBˆÛÛœİÛÛ\\š\ÛÛˆHÛÛ\\š\ÛÛ“X\	‰ˆÛÛ\\š\ÛÛ“X\™Ù]
İš[™Ê™XÛÜ™•Y\ˆˆŠJNÂˆYˆ
XÛÛ\\š\ÛÛˆXÛÛ\\š\ÛÛ“X™[
H™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[H›]“›È™[˜ÚX\šÏÜÜ[˜ÂˆÛÛœİİ\œ™[H\™Ù]›İÓY]šXÕ˜[YJ™XÛÜ™Y]šXËšÙ^JNÂˆÛÛœİ™]š[İ\ÈH\™Ù]›İÓY]šXÕ˜[YJÛÛ\\š\ÛÛ‹Y]šXËšÙ^JNÂˆÛÛœİY™ˆHİ\œ™[H™]š[İ\ÎÂˆYˆ
X]˜XœÊY™ŠHŒJH™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[H›]ŒœÈ	Ù\ØØ\R[
ÛÛ\\š\ÛÛ“X™[
_OÜÜ[˜ÂˆÛÛœİ\™Xİ[ÛˆHY™ˆˆÈ\ˆˆ™İÛˆÂˆÛÛœİ^HY]šXËšÙ^HOOH˜ÛÛ™\œÚ[Ûˆ‚ˆÈ	ÓX]˜XœÊY™ˆ
ˆL
KÑš^Y
Š_\ˆˆ
™]š[İ\ÈÈ	ÓX]˜XœÊ
Y™ˆÈX]˜XœÊ™]š[İ\ÊJH
ˆL
KÑš^Y
J_IXˆ›Ü›X]\™Ù]Y]šXÕ˜[YJY]šXËšÙ^KX]˜XœÊY™ŠJJNÂˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[H	Ù\™Xİ[ÛŸH‰Ù\™Xİ[ÛˆOOH\ˆÈŠÈˆˆ‹HŸH	Ù\ØØ\R[
^
_HœÈ	Ù\ØØ\R[
ÛÛ\\š\ÛÛ“X™[
_OÜÜ[˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]X]š^ÛÜXY\’[
Ù^KX™[
HÂˆÛÛœİXİ]™HHİ]K\™Ù]ÛÜšÙ^HOOHÙ^NÂˆÛÛœİ\™Xİ[ÛˆHXİ]™HÈİ]K\™Ù]ÛÜ™\™Xİ[ÛˆˆˆÂˆÛÛœİ[™XØ]ÜˆHXİ]™HÈ
\™Xİ[ÛˆOOH˜\ØÈˆÈ‰ˆÎNLÎÈˆˆ‰ˆÎNMNÈŠHˆ‰ˆÎNMÎÈÂˆ™]\›ˆ]ÛˆÛ\ÜÏHX›K\ÛÜX]Ûˆ\™Ù]\ÛÜX]Û‰ØXİ]™HÈˆXİ]™HˆˆˆŸHˆ\OH˜]Ûˆˆ]K\™\Ü\ÛÜ\ØÛÜOH\™Ù]ˆ]K\™\Ü\ÛÜZÙ^OH‰Ù\ØØ\R[
Ù^J_Hˆ\šXK[X™[H”ÛÜH	Ù\ØØ\R[
X™[
_H‚ˆÜ[‰Ù\ØØ\R[
X™[
_OÜÜ[‚ˆÜ[ˆÛ\ÜÏHœÛÜZ[™XØ]Üˆˆ\šXKZY[HYH‰Ú[™XØ]ÜŸOÜÜ[‚ˆØ]Ûİ˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]X]š^ÛÜ˜[YJ›İËÙ^KÛÛ\\š\ÛÛ“X\
HÂˆYˆ
Ù^HOOH•Y\ˆŠH™]\›ˆ\™Ù]Y\”ÛÜ˜[šÊ›İË•Y\ŠNÂˆYˆ
Ù^HOOHXİ]™Hœ˜[™ÈŠH™]\›ˆ\™Ù]›İÓY]šXÕ˜[YJ›İË˜œ˜[™ÈŠNÂˆYˆ
Ù^HOOH”™]™[YHŠH™]\›ˆ\™Ù]›İÓY]šXÕ˜[YJ›İËœ™]™[YHŠNÂˆYˆ
Ù^HOOH“Ü™\œÈŠH™]\›ˆ\™Ù]›İÓY]šXÕ˜[YJ›İË›Ü™\œÈŠNÂˆYˆ
Ù^HOOHÛXÚÜÈŠH™]\›ˆ\™Ù]›İÓY]šXÕ˜[YJ›İË˜ÛXÚÜÈŠNÂˆYˆ
Ù^HOOH]™ÈÛÛ™\œÚ[ÛˆŠH™]\›ˆ\™Ù]›İÓY]šXÕ˜[YJ›İË˜ÛÛ™\œÚ[ÛˆŠNÂˆYˆ
Ù^HOOH“™]È[šY\ÈŠH™]\›ˆ\œÙTÚY][X™\Š›İÖÈ“™]ÈY\ˆ[šY\È—JNÂˆYˆ
Ù^HOOH‘^]ÈŠH™]\›ˆ\œÙTÚY][X™\Š›İÖÈ•Y\ˆ^]È—JNÂˆYˆ
Ù^HOOHœÈ\™Ù]ŠH™]\›ˆ\™Ù]Y]šXĞÛÛ\\š\ÛÛ”ØÛÜ™J›İËÛÛ\\š\ÛÛ“X\
NÂˆ™]\›ˆ›İÖÚÙ^WNÂˆB‚ˆ[˜İ[ÛˆÛÜY\™Ù]X]š^›İÜÊ™XÛÜ™ËÛÛ\\š\ÛÛ“X\
HÂˆÛÛœİ›İÜÈH\™Ù]Y]šXÔ›İÜÊ™XÛÜ™ÊNÂˆÛÛœİÛÜİ]HHİ]K\™Ù]ÛÜ	‰ˆİ]K\™Ù]ÛÜšÙ^HÈİ]K\™Ù]ÛÜˆÈÙ^Nˆ•Y\ˆ‹\™Xİ[Ûˆ˜\ØÈˆNÂˆÛÛœİ][\Y\ˆHÛÜİ]K™\™Xİ[ÛˆOOH™\ØÈˆÈLHˆNÂˆ™]\›ˆ›İÜÂˆ›X\

›İË[™^
HOˆ
È›İË[™^JJBˆœÛÜ

KŠHOˆÂˆÛÛœİYH\™Ù]X]š^ÛÜ˜[YJKœ›İËÛÜİ]KšÙ^KÛÛ\\š\ÛÛ“X\
NÂˆÛÛœİšYÚH\™Ù]X]š^ÛÜ˜[YJ‹œ›İËÛÜİ]KšÙ^KÛÛ\\š\ÛÛ“X\
NÂˆÛÛœİY[\HHİš[™ÊYÏÈˆŠKš[J
HOOHˆÂˆÛÛœİšYÚ[\HHİš[™ÊšYÚÏÈˆŠKš[J
HOOHˆÂˆYˆ
Y[\HšYÚ[\JHÂˆYˆ
Y[\HOOHšYÚ[\JH™]\›ˆKš[™^H‹š[™^Âˆ™]\›ˆY[\HÈHˆLNÂˆBˆÛÛœİ™\İ[HÛÛ\\™T™\Ü˜[Y\ÊÛÜİ]KšÙ^KYšYÚ
NÂˆ™]\›ˆ™\İ[È™\İ[
ˆ][\Y\ˆˆKš[™^H‹š[™^ÂˆJBˆ›X\

][JHOˆ][Kœ›İÊNÂˆB‚ˆ[˜İ[Ûˆ\™Ù]œÑÛØ[[
™XÛÜ™
HÂˆYˆ
\Õ\™Ù]İ[›İÊ™XÛÜ™
JH™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[Hİ[”Ü›Û[ÏÜÜ[˜ÂˆÛÛœİÛØ[H\™Ù]ÛØ[
™XÛÜ™
NÂˆYˆ
YÛØ[YÛØ[\™Ù]
H™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[H›]“›È\™Ù]ÜÜ[˜ÂˆÛÛœİ[HHÛØ[˜XİX[HÛØ[\™Ù]ÂˆÛÛœİİ˜[YHHÛØ[˜XİX[ÈÛØ[\™Ù]Âˆ™]\›ˆÜ[ˆÛ\ÜÏH\™Ù][X]š^Y[H	Ù[HHÈ\ˆˆ™İÛˆŸH‰Ù[HHÈŠÈˆˆ‹HŸH	Êİ˜[YH
ˆL
KÑš^Y

_IOÜÜ[˜ÂˆB‚ˆ[˜İ[Ûˆ\™Ù]X]š^[
™XÛÜ™ËÛÛ\\š\ÛÛ”›İÜÈH×KÜ[ÛœÈHßJHÂˆÛÛœİY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
NÂˆÛÛœİÛÛ\\š\ÛÛ“X\H\™Ù]ÛÛ\\š\ÛÛ“X\
ÛÛ\\š\ÛÛ”›İÜÊNÂˆÛÛœİ›İÜÈHÛÜY\™Ù]X]š^›İÜÊ™XÛÜ™ËÛÛ\\š\ÛÛ“X\
NÂˆÛÛœİİ[H\™Ù]İ[[X\J›İÜÊNÂˆÛÛœİ[\Û\ÜÈHÜ[ÛœË˜[š[X]HOOH˜[ÙHÈˆˆˆˆ\™Ù]XØ\™Y[\ˆÂˆÛÛœİ[\”İ[HHÜ[ÛœË˜[š[X]HOOH˜[ÙHÈˆˆˆİ[OH‹KZNÈ˜ÂˆÛÛœİXY\œÈHÂˆÈ•Y\ˆ‹•Y\ˆ—KˆÈXİ]™Hœ˜[™È‹Xİ]™Hœ˜[™È—KˆÈ”™]™[YH‹”™]™[YH—KˆÈ“Ü™\œÈ‹“Ü™\œÈ—KˆÈÛXÚÜÈ‹ÛXÚÜÈ—KˆÈ]™ÈÛÛ™\œÚ[Ûˆ‹]™ÈÛÛ‹ˆ—KˆÈ“™]È[šY\È‹“™]È[šY\È—KˆÈ‘^]È‹‘^]È—KˆÈœÈ\™Ù]‹œÈ\™Ù]—BˆNÂˆÛÛœİXY\“X\H™]ÈX\
XY\œÊNÂˆÛÛœİ[Øš[TÛÜÛÛ›ÛÈHXY\œË›X\

ÚÙ^KX™[JHOˆ\™Ù]X]š^ÛÜXY\’[
Ù^KX™[
Kœ™\XÙJ×Ÿİ‰ÙËˆŠJKš›Ú[ŠˆŠNÂˆÛÛœİÙ[H
Ù^K˜[YJHOˆ]K[X™[H‰Ù\ØØ\R[
XY\“X\™Ù]
Ù^JHÙ^J_H‰İ˜[Y_Oİ˜Âˆ™]\›ˆÙXİ[ÛˆÛ\ÜÏH\™Ù]\™\ÜXØ\™\™Ù][X]š^XØ\™	Ù[\Û\ÜßH‰Ù[\”İ[_O‚ˆ]ˆÛ\ÜÏH\™Ù]\ÙXİ[Û‹ZXY\ˆ‚ˆ]‚ˆÏ•Y\ˆÛÛ\\š\ÛÛˆX]š^ÚÏ‚ˆ‰Ù\ØØ\R[
Y]šXË›X™[
_HÛÛ\\š\ÛÛˆÚ]\™Ù][šY\È[™^]ÈHY\Ü‚ˆÙ]‚ˆÙ]‚ˆ]ˆÛ\ÜÏH\™Ù][[Øš[K\ÛÜXÛÛ›ÛÈˆ\šXK[X™[H”ÛÜY\ˆÛÛ\\š\ÛÛˆX]š^‚ˆ	Û[Øš[TÛÜÛÛ›ÛßBˆÙ]‚ˆ]ˆÛ\ÜÏHX›K]Ü˜\\™Ù][X]š^]Ü˜\‚ˆX›HÛ\ÜÏH\™Ù][X]š^]X›H‚ˆXY‰ÚXY\œË›X\

ÚÙ^KX™[JHOˆ\™Ù]X]š^ÛÜXY\’[
Ù^KX™[
JKš›Ú[ŠˆŠ_OİİXY‚ˆ›ÙO‚ˆ	Ü›İÜË›X\

›İÊHOˆ‚ˆ	ØÙ[
•Y\ˆ‹Ü[ˆÛ\ÜÏH\™Ù]]Y\‹[X™[Ü[ˆÛ\ÜÏHY\‹Yİ	Ù\ØØ\R[
İš[™Ê›İË•Y\ŠKÓİÙ\Ø\ÙJ
Kœ™\XÙJÖ×˜K^ŒNWJËÙË‹HŠJ_HÜÜ[İ›Û™Ï‰Ù\ØØ\R[
›İË•Y\Š_OÜİ›Û™ÏÜÜ[˜
_Bˆ	ØÙ[
Xİ]™Hœ˜[™È‹\œÙTÚY][X™\Š›İÖÈœ˜[™Ûİ[—JKÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
”™]™[YH‹ÛÛ\Xİ[Û™^J\œÙTÚY][X™\Š›İË”™]™[YJJJ_Bˆ	ØÙ[
“Ü™\œÈ‹\œÙTÚY][X™\Š›İÖÈ“Ü™\ˆÛİ[—JKÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
ÛXÚÜÈ‹\œÙTÚY][X™\Š›İÖÈ•İ[ÛXÚÜÈ—JKÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
]™ÈÛÛ™\œÚ[Ûˆ‹\ØØ\R[
›Ü›X]ÚY]Ù[
]™ÈÛÛ™\œÚ[Ûˆ‹›İÖÈ]™ÈÛÛ™\œÚ[Ûˆ—JJJ_Bˆ	ØÙ[
“™]È[šY\È‹\œÙTÚY][X™\Š›İÖÈ“™]ÈY\ˆ[šY\È—JKÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
‘^]È‹\œÙTÚY][X™\Š›İÖÈ•Y\ˆ^]È—JKÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
œÈ\™Ù]‹\™Ù]Y]šXÕœÒ[
›İËÛÛ\\š\ÛÛ“X\İ]K\™Ù]š[\œË˜ÛÛ\\™S[Û
J_Bˆİ˜
Kš›Ú[ŠˆŠ_BˆˆÛ\ÜÏH\™Ù][X]š^]İ[‚ˆ	ØÙ[
•Y\ˆ‹İ›Û™Ï•İ[Üİ›Û™ÏˆŠ_Bˆ	ØÙ[
Xİ]™Hœ˜[™È‹İ[˜œ˜[™ËÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
”™]™[YH‹ÛÛ\Xİ[Û™^Jİ[œ™]™[YJJ_Bˆ	ØÙ[
“Ü™\œÈ‹İ[›Ü™\œËÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
ÛXÚÜÈ‹İ[˜ÛXÚÜËÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
]™ÈÛÛ™\œÚ[Ûˆ‹ÚÜİ
\™Ù]]™ĞÛÛ™\œÚ[ÛŠİ[
JJ_Bˆ	ØÙ[
“™]È[šY\È‹İ[›™]Ñ[šY\ËÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
‘^]È‹İ[™^]ËÓØØ[Tİš[™Ê
J_Bˆ	ØÙ[
œÈ\™Ù]‹Ü[ˆÛ\ÜÏH\™Ù][X]š^Y[Hİ[”Ü›Û[ÏÜÜ[˜
_Bˆİ‚ˆİ›ÙO‚ˆİX›O‚ˆÙ]‚ˆÜÙXİ[Û˜ÂˆB‚ˆ[˜İ[Ûˆ™[™\”ÚY]YÙJ
HÂˆ™Yœ™\Ú\™Ù]š[\œÊ
NÂˆÛÛœİ[™XÛÜ™ÈH\™Ù]™XÛÜ™Ê
NÂˆÛÛœİ›İÜÈHš[\™Y\™Ù]™XÛÜ™Ê
NÂˆÛÛœİÛÛ\\š\ÛÛ”›İÜÈHİ]K\™Ù]š[\œË˜ÛÛ\\™S[ÛˆÈ\™Ù]›İÜÑ›Ü“[Û
[™XÛÜ™Ëİ]K\™Ù]š[\œË˜ÛÛ\\™S[Ûİ]K\™Ù]š[\œËY\ŠBˆˆ×NÂˆYˆ
\›İÜË›[™İ
HÂˆ[ËœÚY]YÙU]K^ÛÛ[H”™\Üİ™\šY]ÈÂˆ[ËœÚY]YÙTİX]K^ÛÛ[H
œÚY]››Õ\™Ù]È‹“›È\™Ù]›İÜÈ›İ[™[ˆHİ\œ™[ÚY]^ÜŠNÂˆ[ËœÚY]YÙTİ[[X\Kš[›™\’SHˆÂˆ[ËœÚY]YÙS›İ\Ëš[›™\’SH‰Ù\ØØ\R[

œÚY]››Õ\™Ù]X]Ú‹“›È\™Ù]]HX]ÚYHÙ[XİYš[\œËˆŠJ_OÜ˜ÂˆYˆ
[ËœÚY]ÜšYXY
H[ËœÚY]ÜšYXYš[›™\’SHˆÂˆYˆ
[ËœÚY]ÜšY›İÜÊH[ËœÚY]ÜšY›İÜËš[›™\’SHˆÂˆYˆ
[ËœÚY]X›PÛİ[
H[ËœÚY]X›PÛİ[^ÛÛ[HˆÂˆ™]\›ÂˆBˆÛÛœİ[Û^Hİ]K\™Ù]š[\œË›[ÛOOH˜[ˆÈÜ[Û•^
[[ÛÈŠHˆİ]K\™Ù]š[\œË›[ÛÂˆÛÛœİY\•^Hİ]K\™Ù]š[\œËY\ˆOOH˜[ˆÈ˜[Y\œÈˆˆİ]K\™Ù]š[\œËY\Âˆ[ËœÚY]YÙU]K^ÛÛ[H”™\Üİ™\šY]ÈÂˆ[ËœÚY]YÙTİX]K^ÛÛ[H	Û[Û^H\™›Ü›X[˜ÙHİ[[X\H›Üˆ	İY\•^XÂˆ™[™\”ÚY]İ[[X\J›İÜËÛÛ\\š\ÛÛ”›İÜËİ]K\™Ù]š[\œË˜ÛÛ\\™S[Û
NÂˆ[ËœÚY]YÙS›İ\Ëš[›™\’SH	İ\™Ù]™[™[
[™XÛÜ™Ê_Iİ\™Ù]›ÙÜ™\ÜÒ[
›İÜÊ_Iİ\™Ù]X]š^[
›İÜËÛÛ\\š\ÛÛ”›İÜÊ_XÂˆ[œİ\™Q”İ]\Ñ›Ü”Ù[XİY[Û

NÂˆÛÛœİY\”İ[[X\S[ÛÙ^HH\™Ù]”İ]\Ó[ÛÙ^J
NÂˆÛÛœİY\”İ[[X\S™YYÓØYHY\”İ[[X\S[ÛÙ^H	‰ˆ
ˆİ]K™•Y\”İ[[X\K›[ÛÙ^HOOHY\”İ[[X\S[ÛÙ^Hˆ
\İ]K™•Y\”İ[[X\K™]H	‰ˆ\İ]K™•Y\”İ[[X\K™\œ›ÜŠBˆ
NÂˆYˆ
Y\”İ[[X\S™YYÓØY	‰ˆ\İ]K™•Y\”İ[[X\K›ØY[™ÊHÂˆÚ[™İËœÙ][Y[İ]


HOˆØY•Y\”İ[[X\JY\”İ[[X\S[ÛÙ^JK
NÂˆBˆB‚ˆ[˜İ[Ûˆİ\œ™[\™Ù]YÙQ]J
HÂˆÛÛœİ[™XÛÜ™ÈH\™Ù]™XÛÜ™Ê
NÂˆÛÛœİ›İÜÈHš[\™Y\™Ù]™XÛÜ™Ê
NÂˆÛÛœİÛÛ\\š\ÛÛ”›İÜÈHİ]K\™Ù]š[\œË˜ÛÛ\\™S[ÛˆÈ\™Ù]›İÜÑ›Ü“[Û
[™XÛÜ™Ëİ]K\™Ù]š[\œË˜ÛÛ\\™S[Ûİ]K\™Ù]š[\œËY\ŠBˆˆ×NÂˆ™]\›ˆÈ[™XÛÜ™Ë›İÜËÛÛ\\š\ÛÛ”›İÜÈNÂˆB‚ˆ[˜İ[Ûˆ[š[X]U\™Ù]™[™İ
İ
HÂˆYˆ
\İ]Ú[™İË™ÜØ\\[ÙˆÚ[™İË™ÜØ\™œ›ÛUÈOOH™[˜İ[ÛˆŠH™]\›ÂˆYˆ
Ú[™İË›X]ÚYYXH	‰ˆÚ[™İË›X]ÚYYXJŠ™Y™\œË\™YXÙY[[İ[Ûˆ™YXÙJHŠK›X]Ú\ÊH™]\›ÂˆÚ[™İË™ÜØ\™œ›ÛUÊˆİˆÈ]]Ğ[NˆŒÍKNˆKˆÈ]]Ğ[NˆKNˆ\˜][ÛˆŒÌ‹X\ÙNˆœİÙ\Œ‹›İ]‹İ™\Üš]Nˆ˜]]È‹ÛX\”›ÜÎˆ˜[œÙ›Ü›KÜXÚ]Kš\ÚXš[]HˆBˆ
NÂˆB‚ˆ[˜İ[Ûˆ™Yœ™\Ú\™Ù]™[™Û›J[™XÛÜ™ÊHÂˆÛÛœİ™[™Ø\™H[ËœÚY]YÙS›İ\È	‰ˆ[ËœÚY]YÙS›İ\Ëœ]Y\TÙ[XİÜŠ‹\™Ù]]™[™XØ\™ŠNÂˆYˆ
]™[™Ø\™
H™]\›ˆ˜[ÙNÂˆÛÛœİY]šXÈH\™Ù]Y]šXĞÛÛ™šYÊ
NÂˆÛÛœİXY[™ÈH™[™Ø\™œ]Y\TÙ[XİÜŠ–Ù]K]\™Ù]]™[™ZXY[™×HŠNÂˆÛÛœİİX]HH™[™Ø\™œ]Y\TÙ[XİÜŠ–Ù]K]\™Ù]]™[™\İX]WHŠNÂˆÛÛœİÛİ\˜ÙHH™[™Ø\™œ]Y\TÙ[XİÜŠ–Ù]K]\™Ù]]™[™\Ûİ\˜ÙWHŠNÂˆÛÛœİİH™[™Ø\™œ]Y\TÙ[XİÜŠ‹\™Ù]]™[™\İŠNÂˆYˆ
XY[™ÊHXY[™Ë^ÛÛ[H\™Ù]™[™XY[™Ê
NÂˆYˆ
İX]JHİX]K^ÛÛ[H\™Ù]™[™İX]JY]šXÊNÂˆYˆ
Ûİ\˜ÙJHÛİ\˜ÙKš[›™\’SH\™Ù]™[™Ûİ\˜ÙR[

NÂˆYˆ
İ
Hİš[›™\’SH\™Ù]™[™İ[
[™XÛÜ™ÊNÂˆ™[™Ø\™œ]Y\TÙ[XİÜ[
–Ù]K]\™Ù]]™[™]šY]×HŠK™›Ü‘XXÚ

]ÛŠHOˆÂˆÛÛœİXİ]™HH]Û‹™]\Ù]\™Ù]™[™šY]ÈOOH\™Ù]™[™šY]Ê
NÂˆ]Û‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹Xİ]™JNÂˆ]Û‹œÙ]]šX]J˜\šXK\™\ÜÙY‹Xİ]™HÈYHˆˆ™˜[ÙHŠNÂˆJNÂˆ™[™Ø\™œ]Y\TÙ[XİÜ[
–Ù]K]\™Ù][Y]šX×HŠK™›Ü‘XXÚ

]ÛŠHOˆÂˆÛÛœİXİ]™HH]Û‹™]\Ù]\™Ù]Y]šXÈOOHY]šXËšÙ^NÂˆ]Û‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹Xİ]™JNÂˆ]Û‹œÙ]]šX]J˜\šXK\™\ÜÙY‹Xİ]™HÈYHˆˆ™˜[ÙHŠNÂˆJNÂˆ[š[X]U\™Ù]™[™İ
İ
NÂˆ™]\›ˆYNÂˆB‚ˆ[˜İ[Ûˆ™Yœ™\Ú\™Ù]X]š^Û›J›İÜËÛÛ\\š\ÛÛ”›İÜÊHÂˆÛÛœİX]š^Ø\™H[ËœÚY]YÙS›İ\È	‰ˆ[ËœÚY]YÙS›İ\Ëœ]Y\TÙ[XİÜŠ‹\™Ù][X]š^XØ\™ŠNÂˆYˆ
[X]š^Ø\™
H™]\›ˆ˜[ÙNÂˆX]š^Ø\™›İ]\’SH\™Ù]X]š^[
›İÜËÛÛ\\š\ÛÛ”›İÜËÈ[š[X]Nˆ˜[ÙHJNÂˆ™]\›ˆYNÂˆB‚ˆ[˜İ[Ûˆ™Yœ™\Ú\™Ù]Y]šXÕšY]ÜÊ
HÂˆÛÛœİÈ[™XÛÜ™Ë›İÜËÛÛ\\š\ÛÛ”›İÜÈHHİ\œ™[\™Ù]YÙQ]J
NÂˆÛÛœİ™[™\]YH™Yœ™\Ú\™Ù]™[™Û›J[™XÛÜ™ÊNÂˆÛÛœİX]š^\]YH™Yœ™\Ú\™Ù]X]š^Û›J›İÜËÛÛ\\š\ÛÛ”›İÜÊNÂˆYˆ
]™[™\]Y[X]š^\]Y
H™[™\”ÚY]YÙJ
NÂˆB‚ˆ[˜İ[Ûˆ›Øİ\Õ\™Ù]Y]šY[

HÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆÛÛœİ[œ]H[ËœÚY]YÙS›İ\È	‰ˆ[ËœÚY]YÙS›İ\Ëœ]Y\TÙ[XİÜŠ‹\™Ù]YY]Y›Ü›H[œ]ŠNÂˆYˆ
[œ]
H[œ]™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[Ûˆ[™U\™Ù]™[™Xİ]˜]J]™[
HÂˆÛÛœİÚ[H]™[\™Ù]˜ÛÜÙ\İ
‹\™Ù]]™[™\Ú[ŠNÂˆYˆ
\Ú[Y[ËœÚY]YÙS›İ\Ë˜ÛÛZ[œÊÚ[
JH™]\›ÂˆÚ[˜Û\ÜÓ\İ˜Y
š\ËZİ™\™YŠNÂˆB‚ˆ[˜İ[Ûˆ[™U\™Ù]™[™XXİ]˜]J]™[
HÂˆÛÛœİÚ[H]™[\™Ù]˜ÛÜÙ\İ
‹\™Ù]]™[™\Ú[ŠNÂˆYˆ
\Ú[Y[ËœÚY]YÙS›İ\Ë˜ÛÛZ[œÊÚ[
JH™]\›ÂˆYˆ
]™[œ™[]Y\™Ù]	‰ˆÚ[˜ÛÛZ[œÊ]™[œ™[]Y\™Ù]
JH™]\›ÂˆÚ[˜Û\ÜÓ\İœ™[[İ™Jš\ËZİ™\™YŠNÂˆB‚ˆ[˜İ[Ûˆ[™U\™Ù]™\ÜÛXÚÊ]™[
HÂˆÛÛœİ™[™Ú[H]™[\™Ù]˜ÛÜÙ\İ
‹\™Ù]]™[™\Ú[ŠNÂˆYˆ
™[™Ú[
HÂˆÛÛœİØ\ĞXİ]™HH™[™Ú[˜Û\ÜÓ\İ˜ÛÛZ[œÊš\ËZİ™\™YŠNÂˆ™[™Ú[˜ÛÜÙ\İ
‹\™Ù]]™[™\İŠOËœ]Y\TÙ[XİÜ[
‹\™Ù]]™[™\Ú[š\ËZİ™\™YŠK™›Ü‘XXÚ

Ú[
HOˆÚ[˜Û\ÜÓ\İœ™[[İ™Jš\ËZİ™\™YŠJNÂˆYˆ
]Ø\ĞXİ]™JH™[™Ú[˜Û\ÜÓ\İ˜Y
š\ËZİ™\™YŠNÂˆ™]\›ÂˆBˆÛÛœİØ[˜Ù[]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K]\™Ù]YY]XØ[˜Ù[HŠNÂˆYˆ
Ø[˜Ù[]ÛŠHÂˆİ]K\™Ù]Y][™ÒÙ^HHˆÂˆ™[™\”ÚY]YÙJ
NÂˆ™]\›ÂˆBˆÛÛœİY]šXĞ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K]\™Ù][Y]šX×HŠNÂˆYˆ
Y]šXĞ]ÛŠHÂˆİ]K\™Ù]Y]šXÈHY]šXĞ]Û‹™]\Ù]\™Ù]Y]šXÈœ™]™[YHÂˆ™Yœ™\Ú\™Ù]Y]šXÕšY]ÜÊ
NÂˆ™]\›ÂˆBˆÛÛœİ™[™šY]Ğ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K]\™Ù]]™[™]šY]×HŠNÂˆYˆ
™[™šY]Ğ]ÛŠHÂˆİ]K\™Ù]™[™šY]ÈH™[™šY]Ğ]Û‹™]\Ù]\™Ù]™[™šY]ÈOOH™^HˆÈ™^Hˆˆ›[ÛÂˆÛÛœİÈ[™XÛÜ™ÈHHİ\œ™[\™Ù]YÙQ]J
NÂˆ™Yœ™\Ú\™Ù]™[™Û›J[™XÛÜ™ÊNÂˆ[œİ\™Q”İ]\Ñ›Ü”Ù[XİY[Û

NÂˆ™]\›ÂˆBˆÛÛœİY]]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
‹\™Ù]YY]X]Û–Ù]K]\™Ù]YY]ZÙ^WHŠNÂˆYˆ
Y]]ÛŠHÂˆİ]K\™Ù]Y][™ÒÙ^HHY]]Û‹™]\Ù]\™Ù]Y]Ù^HˆÂˆ™[™\”ÚY]YÙJ
NÂˆ›Øİ\Õ\™Ù]Y]šY[

NÂˆ™]\›ÂˆBˆYˆ
]™[\™Ù]˜ÛÜÙ\İ
–Ù]K\™\Ü\ÛÜZÙ^WHŠJH[™T™\ÜÛÜÛXÚÊ]™[
NÂˆB‚ˆ[˜İ[Ûˆ[™U\™Ù]™\ÜİX›Z]
]™[
HÂˆÛÛœİ›Ü›HH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K]\™Ù]YY]Y›Ü›WHŠNÂˆYˆ
Y›Ü›JH™]\›Âˆ]™[œ™]™[Y˜][

NÂˆÛÛœİÙ^HH›Ü›K™]\Ù]\™Ù]Y]Ù^HˆÂˆÛÛœİ[œ]H›Ü›Kœ]Y\TÙ[XİÜŠš[œ]Û˜[YOIİ\™Ù]	×HŠNÂˆYˆ
ZÙ^HZ[œ]
H™]\›ÂˆÛÛœİ˜[YHH[œ]˜[YKš[J
NÂˆÛÛœİYš[š][ÛˆH\™Ù]›ÙÜ™\ÜÑYš[š][ÛŠ›Ü›K™]\Ù]\™Ù]Y\ŠHÂˆY\ˆ›Ü›K™]\Ù]\™Ù]Y\ˆˆ‹ˆ\Nˆ›Ü›K™]\Ù]\™Ù]\Hˆ‚ˆNÂˆÛÛœİİ\œ™[™XÛÜ™H\™Ù]™XÛÜ™Ê
K™š[™

™XÛÜ™
HOˆ™XÛÜ™—×İ\™Ù]İ™\œšYRÙ^HOOHÙ^JHˆ\™Ù]Y]X›T™XÛÜ™
Yš[š][Û‹[›Ü›K™]\Ù]\™Ù][Û
NÂˆÛÛœİ\™Ù]^Hİ\œ™[™XÛÜ™È\™Ù]^œ›ÛQY]˜[YJİ\œ™[™XÛÜ™˜[YKYš[š][ÛŠHˆ˜[YNÂˆYˆ
˜[YJHÂˆÛÛœİØ[™Y]HHİ\œ™[™XÛÜ™ÈÈ‹‹˜İ\œ™[™XÛÜ™\™Ù]ˆ\™Ù]^HˆÈ\™Ù]ˆ\™Ù]^NÂˆYˆ
]\™Ù]ÛØ[X]Ú\ÑYš[š][ÛŠ\™Ù]ÛØ[
Ø[™Y]JKYš[š][ÛŠJHÂˆ[œ]œÙ]İ\İÛU˜[Y]J‘[\ˆH˜[Y\™Ù]˜[YKˆŠNÂˆ[œ]œ™\Ü˜[Y]J
NÂˆ™]\›ÂˆBˆ[œ]œÙ]İ\İÛU˜[Y]JˆŠNÂˆBˆYˆ
˜[YJHÂˆİ]K\™Ù]İ™\œšY\ÖÚÙ^WHH\™Ù]^ÂˆH[ÙHÂˆ[]Hİ]K\™Ù]İ™\œšY\ÖÚÙ^WNÂˆBˆØ]™U\™Ù]İ™\œšY\Ê
NÂˆİ]K\™Ù]Y][™ÒÙ^HHˆÂˆ™[™\”ÚY]YÙJ
NÂˆB‚ˆÛÛœİSÓ•WÓ‘U×ÓQTÒS•ÒSTÔ•ÒPQT”ÈHÂˆœ˜[™ˆ›Y\˜Ú[˜[YH‹ˆY\˜Ú[ˆ›Y\˜Ú[˜[YH‹ˆ›Y\˜Ú[˜[YHˆ›Y\˜Ú[˜[YH‹ˆY\˜Ú[˜[YNˆ›Y\˜Ú[˜[YH‹ˆ¹dàyâcˆ›Y\˜Ú[˜[YH‹ˆ¹ea¹k­ˆˆ›Y\˜Ú[˜[YH‹ˆ¹ea¹k­¹d#yéìˆ›Y\˜Ú[˜[YH‹ˆ›Y\˜Ú[Yˆ›Y\˜Ú[Y‹ˆY\˜Ú[Yˆ›Y\˜Ú[Y‹ˆYˆ›Y\˜Ú[Y‹ˆ¹ea¹k­ˆYˆ›Y\˜Ú[Y‹ˆ¹ea¹k­šYˆ›Y\˜Ú[Y‹ˆ›ÙÜ˜[Nˆœ›ÙÜ˜[H‹ˆœ›ÙÜ˜[H˜[YHˆœ›ÙÜ˜[H‹ˆºhnyæëˆˆœ›ÙÜ˜[H‹ˆº+¨yb$ˆˆœ›ÙÜ˜[H‹ˆ]›Ü›Nˆœ]›Ü›H‹ˆ¹nlùcìˆœ]›Ü›H‹ˆ™Û]ˆ™YYÈ™H™XXÚˆ™Û]”™\]Z\™[Y[‹ˆ™Û]ˆ™YYÈ™H™XXÚYˆ™Û]”™\]Z\™[Y[‹ˆ™Û]ˆ™\]Z\™[Y[ˆ™Û]”™\]Z\™[Y[‹ˆ™Û]ˆ\™Ù]ˆ™Û]”™\]Z\™[Y[‹ˆ›[ÛHÛ]ˆ\™Ù]ˆ™Û]”™\]Z\™[Y[‹ˆºg :/¯¹b,9æ¡Û]ˆˆ™Û]”™\]Z\™[Y[‹ˆ™Û]ˆ9æë¹¨!Èˆ™Û]”™\]Z\™[Y[‹ˆ™Û]¹æë¹¨!Èˆ™Û]”™\]Z\™[Y[‹ˆ›[Y\šXÈÛ]ˆ\™Ù]ˆ™Û]“[ÛU\™Ù]‹ˆœ\İ[Û\˜Ú\ÙHˆœ\İ[Û\˜Ú\ÙH‹ˆœ\İ[[Û\˜Ú\ÙHˆœ\İ[Û\˜Ú\ÙH‹ˆ¹."¹§":-+y.lˆœ\İ[Û\˜Ú\ÙH‹ˆ¹."¹§":-+y.l9 áya­Hˆœ\İ[Û\˜Ú\ÙH‹ˆš[™\[™[ÙXœÚ]\Èˆš[™\[™[ÙXœÚ]\È‹ˆš[™\[™[ÙXœÚ]Hˆš[™\[™[ÙXœÚ]\È‹ˆ¹âë9êâùêæHˆš[™\[™[ÙXœÚ]\È‹ˆ¹âë9êâùêæy¥l9£kˆˆš[™\[™[ÙXœÚ]\È‹ˆœ™]šY]ÜÈ[X™\œÈˆœ™]šY]Ôİ[[X\H‹ˆœ™]šY]È[X™\œÈˆœ™]šY]Ôİ[[X\H‹ˆ™]šY]ÜÎˆœ™]šY]Ôİ[[X\H‹ˆº+á:+®¹¥lˆœ™]šY]Ôİ[[X\H‹ˆº+á:+®¹¥l9£kˆˆœ™]šY]Ôİ[[X\H‹ˆ›İ\ˆÛÛ[Z\ÜÚ[Ûˆˆ›İ\ÛÛ[Z\ÜÚ[Ûˆ‹ˆÛÛ[Z\ÜÚ[Ûˆ›İ\ÛÛ[Z\ÜÚ[Ûˆ‹ˆ¹¢$y.ë9æ¡9/húaäHˆ›İ\ÛÛ[Z\ÜÚ[Ûˆ‹ˆ¹/húaäHˆ›İ\ÛÛ[Z\ÜÚ[Ûˆ‹ˆœ™\Ù]ÛÛ[Z\ÜÚ[Ûˆˆœ™\Ù]ÛÛ[Z\ÜÚ[Ûˆ‹ˆºh¡:+¯¹/húaäHˆœ™\Ù]ÛÛ[Z\ÜÚ[Ûˆ‹ˆ™ˆ˜\Ú[™\ÜÓX[˜YÙ\ˆ‹ˆ˜\Ú[™\ÜÈX[˜YÙ\ˆˆ˜\Ú[™\ÜÓX[˜YÙ\ˆ‹ˆ˜™İÛ™\ˆˆ˜\Ú[™\ÜÓX[˜YÙ\ˆ‹ˆº-'ú-(ù.®ˆˆ˜\Ú[™\ÜÓX[˜YÙ\ˆ‹ˆš[Üš]Nˆš\Ôš[Üš]H‹ˆºaãyà®Hˆš\Ôš[Üš]H‹ˆ™]Ø\™ˆ˜ÛÛ\][Û”™]Ø\™‹ˆ˜ÛÛ\][Ûˆ™]Ø\™ˆ˜ÛÛ\][Û”™]Ø\™‹ˆ¹ea¹k­¹ie¹b¬Hˆ˜ÛÛ\][Û”™]Ø\™‚ˆNÂ‚ˆ[˜İ[Ûˆ›Ü›X[^™S[ÛS™]ÓY\˜Ú[[\ÜXY\Š˜[YJHÂˆ™]\›ˆİš[™Ê˜[YHˆŠBˆœ™\XÙJ×—Q‘Q‘‹ËˆŠBˆš[J
BˆÓİÙ\Ø\ÙJ
Bˆœ™\XÙJÖË—Ë×

WJËÙËˆŠBˆœ™\XÙJ×ÊËÙËˆŠNÂˆB‚ˆ[˜İ[Ûˆ\œÙS[ÛS™]ÓY\˜Ú[X›J˜[YK[[Z]\ˆHˆŠHÂˆÛÛœİ^Hİš[™Ê˜[YHˆŠKœ™\XÙJ×—Q‘Q‘‹ËˆŠNÂˆYˆ
]^š[J
JH™]\›ˆ×NÂˆÛÛœİš\œİ[™HH^œÜ]
××‹ÊK™š[™

[™JHOˆ[™Kš[J
JHˆÂˆÛÛœİÙ\\˜]ÜˆH[[Z]\ˆ
š\œİ[™Kš[˜ÛY\Ê—ŠHÈ—ˆˆ‹ŠNÂˆÛÛœİ›İÜÈH×NÂˆ]›İÈH×NÂˆ]Ù[HˆÂˆ]][İYH˜[ÙNÂˆ›Üˆ
][™^HÈ[™^^›[™İÈ[™^
ÏHJHÂˆÛÛœİÚ\ˆH^Ú[™^NÂˆYˆ
][İY
HÂˆYˆ
Ú\ˆOOH	È‰È	‰ˆ^Ú[™^
ÈWHOOH	È‰ÊHÂˆÙ[
ÏH	È‰ÎÂˆ[™^
ÏHNÂˆH[ÙHYˆ
Ú\ˆOOH	È‰ÊHÂˆ][İYH˜[ÙNÂˆH[ÙHÂˆÙ[
ÏHÚ\ÂˆBˆH[ÙHYˆ
Ú\ˆOOH	È‰È	‰ˆXÙ[
HÂˆ][İYHYNÂˆH[ÙHYˆ
Ú\ˆOOHÙ\\˜]ÜŠHÂˆ›İËœ\Ú
Ù[
NÂˆÙ[HˆÂˆH[ÙHYˆ
Ú\ˆOOH—ˆˆÚ\ˆOOH—ˆŠHÂˆ›İËœ\Ú
Ù[
NÂˆ›İÜËœ\Ú
›İÊNÂˆ›İÈH×NÂˆÙ[HˆÂˆYˆ
Ú\ˆOOH—ˆˆ	‰ˆ^Ú[™^
ÈWHOOH—ˆŠH[™^
ÏHNÂˆH[ÙHÂˆÙ[
ÏHÚ\ÂˆBˆBˆ›İËœ\Ú
Ù[
NÂˆ›İÜËœ\Ú
›İÊNÂˆÚ[H
›İÜË›[™İ	‰ˆ›İÜÖÜ›İÜË›[™İHWK™]™\J
˜[YJHOˆTİš[™Ê˜[YHˆŠKš[J
JJHÂˆ›İÜËœÜ

NÂˆBˆ™]\›ˆ›İÜÎÂˆB‚ˆ[˜İ[Ûˆ\œÙS[ÛS™]ÓY\˜Ú[[Û™^J˜[YJHÂˆÛÛœİ˜]ÈHİš[™Ê˜[YHOH[Èˆˆˆ˜[YJKš[J
NÂˆYˆ
\˜]ÊH™]\›ˆ[ÂˆÛÛœİ›Ü›X[^™YH˜]Âˆœ™\XÙJ×ŠÎ•TÑTÈÓT”ÏÊW‹ÙÚKˆŠBˆœ™\XÙJÖË	0¨ø «0©{ïéW×KÙËˆŠNÂˆYˆ
K×—
ÊÎ——
ÊOÉË\İ
›Ü›X[^™Y
JH™]\›ˆ[ÂˆÛÛœİ[[İ[H[X™\Š›Ü›X[^™Y
NÂˆ™]\›ˆ[X™\‹š\Ñš[š]J[[İ[
H	‰ˆ[[İ[HÈ[[İ[ˆ[ÂˆB‚ˆ[˜İ[Ûˆ\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[ÛŠ˜[YJHÂˆÛÛœİ˜]ÈHİš[™Ê˜[YHOH[Èˆˆˆ˜[YJKš[J
NÂˆYˆ
\˜]È˜]ÈOOH‹HŠH™]\›ˆÈ˜[YNˆ[\œ›ÜˆˆˆNÂˆÛÛœİ›Ü›X[^™YH˜]Ëœ™\XÙJÉIËˆŠKœ™\XÙJÖË×KÙËˆŠNÂˆYˆ
K×—
ÊÎ——
ÊOÉË\İ
›Ü›X[^™Y
JHÂˆ™]\›ˆÈ˜[YNˆ[\œ›Üˆ[˜[YÛÛ[Z\ÜÚ[Ûˆ	Ü˜]ßXNÂˆBˆÛÛœİ[[İ[H[X™\Š›Ü›X[^™Y
NÂˆYˆ
S[X™\‹š\Ñš[š]J[[İ[
H[[İ[[[İ[ˆL
HÂˆ™]\›ˆÈ˜[YNˆ[\œ›ÜˆÛÛ[Z\ÜÚ[Ûˆ]\İ™H™]ÙY[ˆ	H[™L	Nˆ	Ü˜]ßXNÂˆBˆ™]\›ˆÈ˜[YNˆ[[İ[\œ›ÜˆˆˆNÂˆB‚ˆ[˜İ[Ûˆ[ÛS™]ÓY\˜Ú[[\Ü›İÜÊX›K™\Ü[Û
HÂˆÛÛœİÛİ\˜ÙT›İÜÈH
\œ˜^Kš\Ğ\œ˜^JX›JHÈX›Hˆ×JK™š[\Š
›İÊHOˆ
ˆ\œ˜^Kš\Ğ\œ˜^J›İÊH	‰ˆ›İËœÛÛYJ
˜[YJHOˆİš[™Ê˜[YHˆŠKš[J
JBˆ
JNÂˆYˆ
\Ûİ\˜ÙT›İÜË›[™İ
HÂˆ™]\›ˆÈXY\œÎˆ×K™XÛÙÛš^™YXY\œÎˆ›İÜÎˆ×K\œ›ÜœÎˆÈ“›ÈX›H›İÜÈ›İ[™ˆ—HNÂˆBˆÛÛœİXY\œÈHÛİ\˜ÙT›İÜÖÌK›X\

˜[YJHOˆİš[™Ê˜[YHˆŠKš[J
JNÂˆÛÛœİšY[ÈHXY\œË›X\

XY\ŠHOˆ
ˆSÓ•WÓ‘U×ÓQTÒS•ÒSTÔ•ÒPQT”ÖÛ›Ü›X[^™S[ÛS™]ÓY\˜Ú[[\ÜXY\ŠXY\ŠWHˆ‚ˆ
JNÂˆÛÛœİ™XÛÙÛš^™YXY\œÈHšY[Ë™š[\Š›ÛÛX[ŠK›[™İÂˆÛÛœİ\œ›ÜœÈH×NÂˆYˆ
YšY[Ëš[˜ÛY\Ê›Y\˜Ú[˜[YHŠJHÂˆ\œ›ÜœËœ\Ú
Hœ˜[™ÜˆY\˜Ú[XY\ˆ\È™\]Z\™YˆŠNÂˆBˆÛÛœİ›İÜÈHÛİ\˜ÙT›İÜËœÛXÙJJK›X\

Ûİ\˜ÙT›İËÙ™œÙ]
HOˆÂˆÛÛœİX\YHßNÂˆšY[Ë™›Ü‘XXÚ

šY[[™^
HOˆÂˆYˆ
šY[	‰ˆX\YÙšY[HOOH[™Yš[™Y
HX\YÙšY[HHİš[™ÊÛİ\˜ÙT›İÖÚ[™^HˆŠKš[J
NÂˆJNÂˆÛÛœİ›İÑ\œ›ÜœÈH×NÂˆYˆ
[X\Y›Y\˜Ú[˜[YJH›İÑ\œ›ÜœËœ\Ú
œ˜[™\È™\]Z\™YˆŠNÂˆYˆ
X\Y›Y\˜Ú[Y	‰ˆK×—
ÉË\İ
X\Y›Y\˜Ú[Y
JHÂˆ›İÑ\œ›ÜœËœ\Ú
“Y\˜Ú[Q]\İ™H[Y\šXËˆŠNÂˆBˆÛÛœİİÛÛÛ[Z\ÜÚ[ÛˆH\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[ÛŠX\Y›İ\ÛÛ[Z\ÜÚ[ÛŠNÂˆÛÛœİ™\Ù]ÛÛ[Z\ÜÚ[ÛˆH\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[ÛŠX\Yœ™\Ù]ÛÛ[Z\ÜÚ[ÛŠNÂˆYˆ
İÛÛÛ[Z\ÜÚ[Û‹™\œ›ÜŠH›İÑ\œ›ÜœËœ\Ú
İÛÛÛ[Z\ÜÚ[Û‹™\œ›ÜŠNÂˆYˆ
™\Ù]ÛÛ[Z\ÜÚ[Û‹™\œ›ÜŠH›İÑ\œ›ÜœËœ\Ú
™\Ù]ÛÛ[Z\ÜÚ[Û‹™\œ›ÜŠNÂˆÛÛœİÛ]•\™Ù]HX\Y™Û]“[ÛU\™Ù]ˆÈ\œÙS[ÛS™]ÓY\˜Ú[[Û™^JX\Y™Û]“[ÛU\™Ù]
Bˆˆ\œÙS[ÛS™]ÓY\˜Ú[[Û™^JX\Y™Û]”™\]Z\™[Y[
NÂˆÛÛœİ^[ØYHZ[[ÛS™]ÓY\˜Ú[^[ØY
Âˆ™\Ü[ÛˆY\˜Ú[YˆX\Y›Y\˜Ú[YˆY\˜Ú[˜[YNˆX\Y›Y\˜Ú[˜[YKˆ\Ú[™\ÜÓX[˜YÙ\ˆX\Y˜\Ú[™\ÜÓX[˜YÙ\‹ˆ›ÙÜ˜[NˆX\Yœ›ÙÜ˜[Kˆ]›Ü›NˆX\Yœ]›Ü›KˆÛ]”™\]Z\™[Y[ˆX\Y™Û]”™\]Z\™[Y[ˆ\İ[Û\˜Ú\ÙNˆX\Yœ\İ[Û\˜Ú\ÙKˆ[™\[™[ÙXœÚ]\ÎˆX\Yš[™\[™[ÙXœÚ]\Ëˆ™]šY]Ôİ[[X\NˆX\Yœ™]šY]Ôİ[[X\Kˆİ\ÛÛ[Z\ÜÚ[ÛˆİÛÛÛ[Z\ÜÚ[Û‹˜[YKˆ™\Ù]ÛÛ[Z\ÜÚ[Ûˆ™\Ù]ÛÛ[Z\ÜÚ[Û‹˜[YKˆ\Ôš[Üš]NˆÈŒH‹YH‹Y\È‹H‹ºaãyà®H‹¹¦+È—Kš[˜ÛY\Êİš[™ÊX\Yš\Ôš[Üš]HˆŠKš[J
KÓİÙ\Ø\ÙJ
JKˆÛ]“[ÛU\™Ù]ˆÛ]•\™Ù]ˆÛÛ\][Û”™]Ø\™ˆX\Y˜ÛÛ\][Û”™]Ø\™ˆJNÂˆ™]\›ˆÂˆ›İÓ[X™\ˆÙ™œÙ]
È‹ˆ^[ØYˆ\œ›ÜœÎˆ›İÑ\œ›ÜœËˆİ]\Îˆœ[™[™È‹ˆØ]™Q\œ›Üˆˆ‚ˆNÂˆJNÂˆÛÛœİÙY[“˜[Y\ÈH™]ÈX\

NÂˆÛÛœİÙY[’YÈH™]ÈX\

NÂˆ›İÜË™›Ü‘XXÚ

›İÊHOˆÂˆÛÛœİ˜[YRÙ^HH›İËœ^[ØY›Y\˜Ú[˜[YKÓİÙ\Ø\ÙJ
NÂˆYˆ
˜[YRÙ^JHÂˆYˆ
ÙY[“˜[Y\Ëš\Ê˜[YRÙ^JJHÂˆ›İË™\œ›ÜœËœ\Ú
‘\XØ]Hœ˜[™[ˆ\È[\ÜˆŠNÂˆÙY[“˜[Y\Ë™Ù]
˜[YRÙ^JK™\œ›ÜœËœ\Ú
‘\XØ]Hœ˜[™[ˆ\È[\ÜˆŠNÂˆH[ÙHÂˆÙY[“˜[Y\ËœÙ]
˜[YRÙ^K›İÊNÂˆBˆBˆÛÛœİYÙ^HH›İËœ^[ØY›Y\˜Ú[YÂˆYˆ
YÙ^JHÂˆYˆ
ÙY[’YËš\ÊYÙ^JJHÂˆ›İË™\œ›ÜœËœ\Ú
‘\XØ]HY\˜Ú[Q[ˆ\È[\ÜˆŠNÂˆÙY[’YË™Ù]
YÙ^JK™\œ›ÜœËœ\Ú
‘\XØ]HY\˜Ú[Q[ˆ\È[\ÜˆŠNÂˆH[ÙHÂˆÙY[’YËœÙ]
YÙ^K›İÊNÂˆBˆBˆJNÂˆ™]\›ˆÈXY\œË™XÛÙÛš^™YXY\œË›İÜË\œ›ÜœÈNÂˆB‚ˆ[˜İ[Ûˆ›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™
™XÛÜ™HßJHÂˆÛÛœİ˜]Õ\™Ù]H™XÛÜ™™Û]“[ÛU\™Ù]ÂˆÛÛœİ\œÙY\™Ù]H˜]Õ\™Ù]OOH[˜]Õ\™Ù]OOH[™Yš[™Y˜]Õ\™Ù]OOHˆ‚ˆÈ[ˆˆ[X™\Š˜]Õ\™Ù]
NÂˆÛÛœİ›Ü›X[^™Y™XÛÜ™HÂˆ™XÛÜ™Yˆ[X™\Š™XÛÜ™œ™XÛÜ™Y
Hˆ™\Ü[Ûˆİš[™Ê™XÛÜ™œ™\Ü[ÛˆŠKˆY\˜Ú[Yˆİš[™Ê™XÛÜ™›Y\˜Ú[YˆŠKš[J
KˆY\˜Ú[˜[YNˆİš[™Ê™XÛÜ™›Y\˜Ú[˜[YHˆŠKš[J
Kˆ\Ú[™\ÜÓX[˜YÙ\ˆİš[™Ê™XÛÜ™˜\Ú[™\ÜÓX[˜YÙ\ˆˆŠKš[J
Kˆ›ÙÜ˜[Nˆİš[™Ê™XÛÜ™œ›ÙÜ˜[HˆŠKš[J
Kˆ]›Ü›Nˆİš[™Ê™XÛÜ™œ]›Ü›HˆŠKš[J
KˆÛ]”™\]Z\™[Y[ˆİš[™Ê™XÛÜ™™Û]”™\]Z\™[Y[ˆŠKš[J
Kˆ\İ[Û\˜Ú\ÙNˆİš[™Ê™XÛÜ™œ\İ[Û\˜Ú\ÙHˆŠKš[J
Kˆ[™\[™[ÙXœÚ]\Îˆİš[™Ê™XÛÜ™š[™\[™[ÙXœÚ]\ÈˆŠKš[J
Kˆ™]šY]Ôİ[[X\Nˆİš[™Ê™XÛÜ™œ™]šY]Ôİ[[X\HˆŠKš[J
Kˆİ\ÛÛ[Z\ÜÚ[Ûˆ\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[ÛŠ™XÛÜ™›İ\ÛÛ[Z\ÜÚ[ÛŠK˜[YKˆ™\Ù]ÛÛ[Z\ÜÚ[Ûˆ\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[ÛŠ™XÛÜ™œ™\Ù]ÛÛ[Z\ÜÚ[ÛŠK˜[YKˆ\Ôš[Üš]Nˆ™XÛÜ™š\Ôš[Üš]HOOHYH™XÛÜ™š\Ôš[Üš]HOOHH™XÛÜ™š\Ôš[Üš]HOOHŒH‹ˆÛ]“[ÛU\™Ù]ˆ[X™\‹š\Ñš[š]J\œÙY\™Ù]
HÈ\œÙY\™Ù]ˆ[ˆÛÛ\][Û”™]Ø\™ˆİš[™Ê™XÛÜ™˜ÛÛ\][Û”™]Ø\™ˆŠKš[J
KˆÜ™X]YNˆİš[™Ê™XÛÜ™˜Ü™X]YHˆŠKš[J
Kˆ\]YNˆİš[™Ê™XÛÜ™\]YHˆŠKš[J
KˆÜ™X]Y]ˆİš[™Ê™XÛÜ™˜Ü™X]Y]ˆŠKš[J
Kˆ\]Y]ˆİš[™Ê™XÛÜ™\]Y]ˆŠKš[J
BˆNÂˆ›Ü›X[^™Y™XÛÜ™›Y\˜Ú[YH™\ÛÛ™S[ÛS™]ÓY\˜Ú[Y
›Ü›X[^™Y™XÛÜ™
NÂˆ™]\›ˆ›Ü›X[^™Y™XÛÜ™ÂˆB‚ˆ[˜İ[Ûˆ™\ÛÛ™S[ÛS™]ÓY\˜Ú[Y
™XÛÜ™HßJHÂˆÛÛœİ^XÚ]YHİš[™Ê™XÛÜ™›Y\˜Ú[YˆŠKš[J
NÂˆYˆ
^XÚ]Y
H™]\›ˆ^XÚ]YÂ‚ˆÛÛœİY\˜Ú[˜[YHH›Ü›X[^™J™XÛÜ™›Y\˜Ú[˜[YJNÂˆYˆ
[Y\˜Ú[˜[YJH™]\›ˆˆÂˆÛÛœİ^XİX]Ú\ÈHÙ™™\œË™š[\Š
Ù™™\ŠHOˆ
ˆÛÙ™™\‹›Y\˜Ú[˜[YKÙ™™\‹˜œ˜[™KœÛÛYJ
˜[YJHOˆ›Ü›X[^™J˜[YJHOOHY\˜Ú[˜[YJBˆ
JNÂˆÛÛœİ[š\]YRYH
X]Ú\ÊHOˆÂˆÛÛœİYÈHË‹‹›™]ÈÙ]
ˆX]Ú\Âˆ›X\

Ù™™\ŠHOˆİš[™ÊÙ™™\‹›Y\˜Ú[YˆŠKš[J
JBˆ™š[\Š›ÛÛX[ŠBˆ
WNÂˆ™]\›ˆYË›[™İOOHHÈYÖÌHˆˆÂˆNÂ‚ˆÛÛœİY\ŒRYH[š\]YRY
ˆ^XİX]Ú\Ë™š[\Š
Ù™™\ŠHOˆØ[›ÛšXØ[Y\“˜[YJÙ™™\‹Y\ŠHOOH•Y\ˆHŠBˆ
NÂˆYˆ
Y\ŒRY
H™]\›ˆY\ŒRYÂ‚ˆÛÛœİ]›Ü›HH›Ü›X[^™J™XÛÜ™œ]›Ü›JNÂˆYˆ
]›Ü›JHÂˆÛÛœİ]›Ü›RYH[š\]YRY
ˆ^XİX]Ú\Ë™š[\Š
Ù™™\ŠHOˆ›Ü›X[^™JÙ™™\‹›™]ÛÜšÊHOOH]›Ü›JBˆ
NÂˆYˆ
]›Ü›RY
H™]\›ˆ]›Ü›RYÂˆBˆ™]\›ˆ[š\]YRY
^XİX]Ú\ÊNÂˆB‚ˆ[˜İ[Ûˆš[\™Y[ÛS™]ÓY\˜Ú[™XÛÜ™Ê™XÛÜ™ËÙX\˜ÚHˆŠHÂˆÛÛœİ]Y\HHİš[™ÊÙX\˜ÚˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆÛÛœİ›Ü›X[^™Y™XÛÜ™ÈH
™XÛÜ™È×JK›X\
›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™
NÂˆYˆ
\]Y\JH™]\›ˆ›Ü›X[^™Y™XÛÜ™ÎÂˆ™]\›ˆ›Ü›X[^™Y™XÛÜ™Ë™š[\Š
™XÛÜ™
HOˆ
ˆÂˆ™XÛÜ™›Y\˜Ú[˜[YKˆ™XÛÜ™›Y\˜Ú[Yˆ™XÛÜ™˜\Ú[™\ÜÓX[˜YÙ\‹ˆ™XÛÜ™œ›ÙÜ˜[Kˆ™XÛÜ™œ]›Ü›Kˆ™XÛÜ™™Û]”™\]Z\™[Y[ˆ™XÛÜ™œ\İ[Û\˜Ú\ÙKˆ™XÛÜ™š[™\[™[ÙXœÚ]\Ëˆ™XÛÜ™œ™]šY]Ôİ[[X\Kˆ™XÛÜ™˜ÛÛ\][Û”™]Ø\™ˆKœÛÛYJ
˜[YJHOˆİš[™Ê˜[YHˆŠKÓİÙ\Ø\ÙJ
Kš[˜ÛY\Ê]Y\JJBˆ
JNÂˆB‚ˆ[˜İ[Ûˆ[ÛS™]ÓY\˜Ú[\™Ù]İ[
™XÛÜ™ÊHÂˆ™]\›ˆ
™XÛÜ™È×JKœ™YXÙJ
İ[™XÛÜ™
HOˆÂˆÛÛœİ[[İ[H[X™\Š™XÛÜ™	‰ˆ™XÛÜ™™Û]“[ÛU\™Ù]
NÂˆ™]\›ˆ[X™\‹š\Ñš[š]J[[İ[
HÈİ[
È[[İ[ˆİ[ÂˆK
NÂˆB‚ˆ[˜İ[ÛˆZ[[ÛS™]ÓY\˜Ú[^[ØY
Ûİ\˜ÙHHßJHÂˆÛÛœİ˜]Õ\™Ù]Hİš[™ÊˆÛİ\˜ÙK™Û]“[ÛU\™Ù]OOH[Ûİ\˜ÙK™Û]“[ÛU\™Ù]OOH[™Yš[™YˆÈˆ‚ˆˆÛİ\˜ÙK™Û]“[ÛU\™Ù]ˆ
Kš[J
NÂˆÛÛœİ™XÛÜ™YH[X™\ŠÛİ\˜ÙKœ™XÛÜ™Y
HÂˆÛÛœİİÛÛÛ[Z\ÜÚ[ÛˆH\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[ÛŠÛİ\˜ÙK›İ\ÛÛ[Z\ÜÚ[ÛŠNÂˆÛÛœİ™\Ù]ÛÛ[Z\ÜÚ[ÛˆH\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[ÛŠÛİ\˜ÙKœ™\Ù]ÛÛ[Z\ÜÚ[ÛŠNÂˆ™]\›ˆÂˆXİ[Ûˆ\Ù\‹ˆ‹‹Š™XÛÜ™YÈÈ™XÛÜ™YHˆßJKˆ™\Ü[Ûˆİš[™ÊÛİ\˜ÙKœ™\Ü[ÛˆŠKš[J
KˆY\˜Ú[Yˆİš[™ÊÛİ\˜ÙK›Y\˜Ú[YˆŠKš[J
KˆY\˜Ú[˜[YNˆİš[™ÊÛİ\˜ÙK›Y\˜Ú[˜[YHˆŠKš[J
Kˆ\Ú[™\ÜÓX[˜YÙ\ˆİš[™ÊÛİ\˜ÙK˜\Ú[™\ÜÓX[˜YÙ\ˆˆŠKš[J
Kˆ›ÙÜ˜[Nˆİš[™ÊÛİ\˜ÙKœ›ÙÜ˜[HˆŠKš[J
Kˆ]›Ü›Nˆİš[™ÊÛİ\˜ÙKœ]›Ü›HˆŠKš[J
KˆÛ]”™\]Z\™[Y[ˆİš[™ÊÛİ\˜ÙK™Û]”™\]Z\™[Y[ˆŠKš[J
Kˆ\İ[Û\˜Ú\ÙNˆİš[™ÊÛİ\˜ÙKœ\İ[Û\˜Ú\ÙHˆŠKš[J
Kˆ[™\[™[ÙXœÚ]\Îˆİš[™ÊÛİ\˜ÙKš[™\[™[ÙXœÚ]\ÈˆŠKš[J
Kˆ™]šY]Ôİ[[X\Nˆİš[™ÊÛİ\˜ÙKœ™]šY]Ôİ[[X\HˆŠKš[J
Kˆİ\ÛÛ[Z\ÜÚ[ÛˆİÛÛÛ[Z\ÜÚ[Û‹˜[YKˆ™\Ù]ÛÛ[Z\ÜÚ[Ûˆ™\Ù]ÛÛ[Z\ÜÚ[Û‹˜[YKˆ\Ôš[Üš]Nˆ›ÛÛX[ŠÛİ\˜ÙKš\Ôš[Üš]JKˆÛ]“[ÛU\™Ù]ˆ˜]Õ\™Ù]È[X™\Š˜]Õ\™Ù]
Hˆ[ˆÛÛ\][Û”™]Ø\™ˆİš[™ÊÛİ\˜ÙK˜ÛÛ\][Û”™]Ø\™ˆŠKš[J
BˆNÂˆB‚ˆ[˜İ[Ûˆ[ÛS™]ÓY\˜Ú[[ÛX™[
[Û
HÂˆÛÛœİ˜[YHHİš[™Ê[ÛˆŠNÂˆYˆ
K×—ÍKWÌŸIË\İ
˜[YJJH™]\›ˆ˜[YNÂˆÛÛœİ]HH™]È]J	İ˜[Y_KLULŒŒ
NÂˆYˆ
[X™\‹š\Ó˜SŠ]K™Ù][YJ
JJH™]\›ˆ˜[YNÂˆ™]\›ˆ™]È[‘]U[YQ›Ü›X]
İ]K›[™İXYÙHOOHšˆÈšPÓˆˆˆ™[‹UTÈ‹ÂˆYX\ˆ›[Y\šXÈ‹ˆ[Ûˆ›Û™È‚ˆJK™›Ü›X]
]JNÂˆB‚ˆ[˜İ[Ûˆ[ÛS™]ÓY\˜Ú[\]Y^
˜[YJHÂˆÛÛœİ^Hİš[™Ê˜[YHˆŠKš[J
NÂˆYˆ
]^
H™]\›ˆ¸ %ÂˆÛÛœİ]HH™]È]Jˆ×—ÍKWÌŸKWÌŸIË\İ
^
BˆÈ	İ^UŒŒˆˆ^ˆ
NÂˆYˆ
[X™\‹š\Ó˜SŠ]K™Ù][YJ
JJH™]\›ˆ^Âˆ™]\›ˆ™]È[‘]U[YQ›Ü›X]
İ]K›[™İXYÙHOOHšˆÈšPÓˆˆˆ™[‹UTÈ‹ÂˆYX\ˆ›[Y\šXÈ‹ˆ[ÛˆœÚÜ‹ˆ^Nˆ›[Y\šXÈ‚ˆJK™›Ü›X]
]JNÂˆB‚ˆ[˜İ[ÛˆÜ[“[ÛS™]ÓY\˜Ú[[ÛXÚÙ\Š
HÂˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[Ó[Û
H™]\›Âˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[Û™›Øİ\ÊÈ™]™[ØÜ›ÛˆYHJNÂˆYˆ
\[Ùˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[ÛœÚİÔXÚÙ\ˆOOH™[˜İ[ÛˆŠH™]\›ÂˆHÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[ÛœÚİÔXÚÙ\Š
NÂˆHØ]Ú
Ù\œ›ÜŠHÂˆËÈH›Øİ\ÙY˜]]™H[Û[œ]™[XZ[œÈ\ØX›HÚ[ˆÚİÔXÚÙ\ˆ\È[˜]˜Z[X›K‚ˆBˆB‚ˆ[˜İ[ÛˆÙ][ÛS™]ÓY\˜Ú[›İXÙJY\ÜØYÙHHˆ‹\HHœİXØÙ\ÜÈŠHÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆX[˜YÙ[Y[››İXÙHHİš[™ÊY\ÜØYÙHˆŠNÂˆX[˜YÙ[Y[››İXÙU\HH\HOOH™\œ›ÜˆˆÈ™\œ›ÜˆˆˆœİXØÙ\ÜÈÂˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[Ó›İXÙJH™]\›Âˆ[Ë›[ÛS™]ÓY\˜Ú[Ó›İXÙK^ÛÛ[HX[˜YÙ[Y[››İXÙNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó›İXÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[X[˜YÙ[Y[››İXÙJNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó›İXÙK˜Û\ÜÓ\İÙÙÛJ™\œ›Üˆ‹X[˜YÙ[Y[››İXÙU\HOOH™\œ›ÜˆŠNÂˆB‚ˆ[˜İ[ÛˆÙ][ÛS™]ÓY\˜Ú[›Ü›Q\œ›ÜŠY\ÜØYÙHHˆŠHÂˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[›Ü›Q\œ›ÜŠH™]\›Âˆ[Ë›[ÛS™]ÓY\˜Ú[›Ü›Q\œ›Ü‹^ÛÛ[Hİš[™ÊY\ÜØYÙHˆŠNÂˆ[Ë›[ÛS™]ÓY\˜Ú[›Ü›Q\œ›Ü‹˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[Y\ÜØYÙJNÂˆB‚ˆ[˜İ[Ûˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
HÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[ÔYÙJH™]\›ÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Ó[Û
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[Û˜[YHHX[˜YÙ[Y[›[ÛÂˆBˆÙ][ÛS™]ÓY\˜Ú[›İXÙJX[˜YÙ[Y[››İXÙKX[˜YÙ[Y[››İXÙU\JNÂ‚ˆÛÛœİ›İÜÈHš[\™Y[ÛS™]ÓY\˜Ú[™XÛÜ™ÊˆX[˜YÙ[Y[œ™XÛÜ™ËˆX[˜YÙ[Y[œÙX\˜Úˆ
NÂˆÛÛœİİ[\™Ù]H[ÛS™]ÓY\˜Ú[\™Ù]İ[
›İÜÊNÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[ĞÛİ[
HÂˆÛÛœİ[Û^H[ÛS™]ÓY\˜Ú[[ÛX™[
X[˜YÙ[Y[›[Û
NÂˆÛÛœİÛİ[^Hİ]K›[™İXYÙHOOHš‚ˆÈ	Û[Û^H0­È	Ü›İÜË›[™İH9.*¹ea¹k­˜ˆˆ	Û[Û^H0­È	Ü›İÜË›[™İHY\˜Ú[	Ü›İÜË›[™İOOHHÈˆˆˆœÈŸXÂˆÛÛœİ\™Ù]^Hİ[\™Ù]ˆˆÈ
İ]K›[™İXYÙHOOHš‚ˆÈ0­ÈÓUˆ9æë¹¨!È	Û[Û™^Jİ[\™Ù]
_Xˆˆ0­ÈÓUˆ\™Ù]	Û[Û™^Jİ[\™Ù]
_X
BˆˆˆÂˆÛÛœİš[Üš]PÛİ[H›İÜË™š[\Š
™XÛÜ™
HOˆ™XÛÜ™š\Ôš[Üš]JK›[™İÂˆÛÛœİš[Üš]U^Hš[Üš]PÛİ[ˆÈ
İ]K›[™İXYÙHOOHšˆÈ0­È	Üš[Üš]PÛİ[H9.*ºaãyà®y£ª:#dˆ0­È	Üš[Üš]PÛİ[Hš[Üš]X
BˆˆˆÂˆ[Ë›[ÛS™]ÓY\˜Ú[ĞÛİ[^ÛÛ[HÛİ[^
Èš[Üš]U^
È\™Ù]^ÂˆBˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[Ô›İÜÊH™]\›Â‚ˆYˆ
X[˜YÙ[Y[›ØY[™È	‰ˆ[X[˜YÙ[Y[œ™XÛÜ™Ë›[™İ
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ô›İÜËš[›™\’SHˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[ËY[\HÛÛÜ[HŒM‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ë›ØY[™È‹“ØY[™È™]ÈY\˜Ú[Èœ›ÛHH]X˜\Ùx )ˆŠJ_Oİİ˜Âˆ™]\›ÂˆBˆYˆ
X[˜YÙ[Y[™\œ›Üˆ	‰ˆ[X[˜YÙ[Y[œ™XÛÜ™Ë›[™İ
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ô›İÜËš[›™\’SHˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[ËY[\HÛÛÜ[HŒMİ›Û™Ï‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ë™]X˜\ÙQ\œ›Üˆ‹•H]X˜\ÙH\È[\Ü˜\š[H[˜]˜Z[X›KˆŠJ_OÜİ›Û™ÏÜ[‰Ù\ØØ\R[
X[˜YÙ[Y[™\œ›ÜŠ_OÜÜ[İİ˜Âˆ™]\›ÂˆBˆYˆ
\›İÜË›[™İ
HÂˆÛÛœİÙX\˜Ú[™ÈH›ÛÛX[ŠX[˜YÙ[Y[œÙX\˜Úš[J
JNÂˆÛÛœİ]HHÙX\˜Ú[™ÂˆÈ
›[ÛS™]ÓY\˜Ú[Ë››ÓX]Ú\Õ]H‹“›ÈY\˜Ú[ÈX]Ú[İ\ˆÙX\˜ÚŠBˆˆ
›[ÛS™]ÓY\˜Ú[Ë™[\U]H‹“›È™]ÈY\˜Ú[È]™H™Y[ˆYY›Üˆ\È[ÛŠNÂˆÛÛœİ›ÙHHÙX\˜Ú[™ÂˆÈ
›[ÛS™]ÓY\˜Ú[Ë››ÓX]Ú\Ğ›ÙH‹•HHY™™\™[Y\˜Ú[QÜˆ‘ˆŠBˆˆ
›[ÛS™]ÓY\˜Ú[Ë™[\P›ÙH‹“›È™]ÛHYYY\˜Ú[ÈÙ\™H›İ[™[ˆH˜XÚÙ[™]X˜\ÙH›Üˆ\È[ÛˆŠNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ô›İÜËš[›™\’SHˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[ËY[\HÛÛÜ[HŒMİ›Û™Ï‰Ù\ØØ\R[
]J_OÜİ›Û™ÏÜ[‰Ù\ØØ\R[
›ÙJ_OÜÜ[İİ˜Âˆ™]\›ÂˆB‚ˆ[Ë›[ÛS™]ÓY\˜Ú[Ô›İÜËš[›™\’SH›İÜË›X\

™XÛÜ™
HOˆÂˆÛÛœİY\˜Ú[X™[H™XÛÜ™›Y\˜Ú[˜[YH
›[ÛS™]ÓY\˜Ú[Ë›Y\˜Ú[˜[YH‹“Y\˜Ú[ŠNÂˆÛÛœİØ]š[™ÈHX[˜YÙ[Y[œİX›Z][™ÎÂˆÛÛœİ›İĞÛ\ÜÙ\ÈH™XÛÜ™š\Ôš[Üš]HÈš\Ë\š[Üš]HˆˆˆÂˆÛÛœİš[Üš]SX™[H
›[ÛS™]ÓY\˜Ú[Ëœš[Üš]PXİ[Ûˆ‹”š[Üš]H™XÛÛ[Y[™][ÛˆŠNÂˆÛÛœİ\™Ù]^H™XÛÜ™™Û]”™\]Z\™[Y[ˆÈ\ØØ\R[
™XÛÜ™™Û]”™\]Z\™[Y[
Bˆˆ™XÛÜ™™Û]“[ÛU\™Ù]OOH[ˆÈ	ÏÜ[ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[[]]Y¸ %ÜÜ[‰Âˆˆ\ØØ\R[
[Û™^J™XÛÜ™™Û]“[ÛU\™Ù]
JNÂˆÛÛœİ^Ù[H
˜[YJHOˆ˜[YBˆÈÜ[ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[[›İ\È‰Ù\ØØ\R[
˜[YJ_OÜÜ[˜ˆˆ	ÏÜ[ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[[]]Y¸ %ÜÜ[‰ÎÂˆÛÛœİÛÛ[Z\ÜÚ[ÛÙ[H
˜[YJHOˆ˜[YHOOH[ˆÈ	ÏÜ[ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[[]]Y¸ %ÜÜ[‰Âˆˆ	Ù\ØØ\R[
[X™\Š˜[YJKÓØØ[Tİš[™Ê[™Yš[™YÈX^[][Qœ˜Xİ[Û‘YÚ]ÎˆˆJJ_IXÂˆ™]\›ˆˆÛ\ÜÏH‰Ü›İĞÛ\ÜÙ\ßHˆ]K[[ÛK[™]Ë[Y\˜Ú[ZYH‰Ü™XÛÜ™œ™XÛÜ™YH‚ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[\š[Üš]KXÙ[‚ˆ]ÛˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[\š[Üš]Hˆ\OH˜]Ûˆˆ]K[[ÛK[™]Ë[Y\˜Ú[XXİ[ÛHœš[Üš]Hˆ\šXK\™\ÜÙYH‰Ü™XÛÜ™š\Ôš[Üš]HÈYHˆˆ™˜[ÙHŸHˆ\šXK[X™[H‰Ù\ØØ\R[
	Üš[Üš]SX™[Nˆ	ÛY\˜Ú[X™[X
_Hˆ	È\™XÛÜ™œ™XÛÜ™YØ]š[™ÈÈ™\ØX›YˆˆˆŸO‚ˆİ™ÈšY]Ğ›ŞHŒˆ\šXKZY[HYH]H›LLˆÈ‹ÈKH‹ŒKKMŒÈH‹ŒKMKL‹KMK‹HKM‹ŒKMMŒÈ‹ŒKKSLˆÖˆ‹ÏÜİ™Ï‚ˆØ]Û‚ˆİ‚ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[ZYXÙ[‰İ^Ù[
™XÛÜ™›Y\˜Ú[Y
_Oİ‚ˆ]ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[[˜[YHİ›Û™Ï‰Ù\ØØ\R[
Y\˜Ú[X™[
_OÜİ›Û™ÏÙ]İ‚ˆ‰İ^Ù[
™XÛÜ™œ›ÙÜ˜[J_Oİ‚ˆ‰İ^Ù[
™XÛÜ™œ]›Ü›J_Oİ‚ˆ‰İ\™Ù]^Oİ‚ˆ‰İ^Ù[
™XÛÜ™œ\İ[Û\˜Ú\ÙJ_Oİ‚ˆ‰İ^Ù[
™XÛÜ™š[™\[™[ÙXœÚ]\Ê_Oİ‚ˆ‰İ^Ù[
™XÛÜ™œ™]šY]Ôİ[[X\J_Oİ‚ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[[[X™\ˆ‰ØÛÛ[Z\ÜÚ[ÛÙ[
™XÛÜ™›İ\ÛÛ[Z\ÜÚ[ÛŠ_Oİ‚ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[[[X™\ˆ‰ØÛÛ[Z\ÜÚ[ÛÙ[
™XÛÜ™œ™\Ù]ÛÛ[Z\ÜÚ[ÛŠ_Oİ‚ˆ‰İ^Ù[
™XÛÜ™˜\Ú[™\ÜÓX[˜YÙ\Š_Oİ‚ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[]\]Y‰Ù\ØØ\R[
[ÛS™]ÓY\˜Ú[\]Y^
™XÛÜ™\]Y]™XÛÜ™˜Ü™X]Y]
J_Oİ‚ˆ]ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[XXİ[ÛœÈ‚ˆ]Ûˆ\OH˜]Ûˆˆ]K[[ÛK[™]Ë[Y\˜Ú[XXİ[ÛH™Y]ˆ	ÜØ]š[™ÈÈ™\ØX›YˆˆˆŸO‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ë™Y]‹‘Y]ŠJ_OØ]Û‚ˆ]ÛˆÛ\ÜÏHš\ËY[™Ù\ˆˆ\OH˜]Ûˆˆ]K[[ÛK[™]Ë[Y\˜Ú[XXİ[ÛH™[]Hˆ	ÜØ]š[™ÈÈ™\ØX›YˆˆˆŸO‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ë™[]H‹‘[]HŠJ_OØ]Û‚ˆÙ]İ‚ˆİ˜ÂˆJKš›Ú[ŠˆŠNÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ™\]Y\İ[ÛS™]ÓY\˜Ú[Ê›ÙHH[
HÂˆÛÛœİÜ[ÛœÈHÂˆØXÚNˆ››Ë\İÜ™H‹ˆÜ™Y[X[ÎˆœØ[YK[ÜšYÚ[ˆ‚ˆNÂˆ]\›H—ÓSÓ•WÓ‘U×ÓQTÒS•×ÕRWĞTNÂˆYˆ
›ÙJHÂˆÜ[ÛœË›Y]ÙH”ÔÕÂˆÜ[ÛœËšXY\œÈHÈÛÛ[U\Hˆ˜\XØ][Û‹ÚœÛÛÈÚ\œÙ]]]‹NˆNÂˆÜ[ÛœË˜›ÙHH”ÓÓ‹œİš[™ÚYJ›ÙJNÂˆH[ÙHÂˆÛÛœİ\˜[\ÈH™]ÈT“ÙX\˜Ú\˜[\ÊÈ[Ûˆİ]K›[ÛS™]ÓY\˜Ú[Ë›[ÛJNÂˆ\›
ÏHÉÜ\˜[\ËÔİš[™Ê
_XÂˆBˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
\›Ü[ÛœÊNÂˆÛÛœİ^[ØYH]ØZ]™\ÜÛœÙKšœÛÛŠ
K˜Ø]Ú


HOˆ
ßJJNÂˆYˆ
\™\ÜÛœÙK›ÚÈ^[ØY›ÚÈOOH˜[ÙJHÂˆ›İÈ™]È\œ›ÜŠ^[ØY™\œ›Üˆ[ÛH™]ÈY\˜Ú[™\]Y\İ˜Z[Y
	Ü™\ÜÛœÙKœİ]\ßJX
NÂˆBˆ™]\›ˆ^[ØYÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆØY[ÛS™]ÓY\˜Ú[ÊÈ›Ü˜ÙHH˜[ÙHHHßJHÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆYˆ
Y›Ü˜ÙH	‰ˆX[˜YÙ[Y[›ØYY[ÛOOHX[˜YÙ[Y[›[Û	‰ˆ[X[˜YÙ[Y[™\œ›ÜŠHÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆ™]\›ÂˆBˆÛÛœİ™\]Y\İY[ÛHX[˜YÙ[Y[›[ÛÂˆÛÛœİÙ\]Y[˜ÙHH
ÊÛX[˜YÙ[Y[›ØYÙ\]Y[˜ÙNÂˆX[˜YÙ[Y[›ØY[™ÈHYNÂˆX[˜YÙ[Y[™\œ›ÜˆHˆÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆHÂˆÛÛœİ^[ØYH]ØZ]™\]Y\İ[ÛS™]ÓY\˜Ú[Ê
NÂˆYˆ
Ù\]Y[˜ÙHOOHX[˜YÙ[Y[›ØYÙ\]Y[˜ÙH™\]Y\İY[ÛOOHX[˜YÙ[Y[›[Û
H™]\›ÂˆX[˜YÙ[Y[œ™XÛÜ™ÈH
^[ØYœ™XÛÜ™È×JK›X\
›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™
NÂˆX[˜YÙ[Y[›ØYY[ÛH™\]Y\İY[ÛÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
Ù\]Y[˜ÙHOOHX[˜YÙ[Y[›ØYÙ\]Y[˜ÙH™\]Y\İY[ÛOOHX[˜YÙ[Y[›[Û
H™]\›ÂˆX[˜YÙ[Y[œ™XÛÜ™ÈH×NÂˆX[˜YÙ[Y[›ØYY[ÛHˆÂˆX[˜YÙ[Y[™\œ›ÜˆH\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠNÂˆHš[˜[HÂˆYˆ
Ù\]Y[˜ÙHOOHX[˜YÙ[Y[›ØYÙ\]Y[˜ÙH	‰ˆ™\]Y\İY[ÛOOHX[˜YÙ[Y[›[Û
HÂˆX[˜YÙ[Y[›ØY[™ÈH˜[ÙNÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆBˆBˆB‚ˆ[˜İ[ÛˆÜ[“[ÛS™]ÓY\˜Ú[˜]Ù\Š™XÛÜ™H[
HÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆÛÛœİ›Ü›X[^™Y™XÛÜ™H™XÛÜ™È›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™
™XÛÜ™
Hˆ[ÂˆX[˜YÙ[Y[œ™\İÜ™Q›Øİ\ÈHØİ[Y[˜Xİ]™Q[[Y[ÂˆX[˜YÙ[Y[™˜]Ù\“Ü[ˆHYNÂˆX[˜YÙ[Y[™Y][™Ô™XÛÜ™YH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™œ™XÛÜ™Yˆ[ÂˆÙ][ÛS™]ÓY\˜Ú[›Ü›Q\œ›ÜŠˆŠNÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[›Ü›JH[Ë›[ÛS™]ÓY\˜Ú[›Ü›Kœ™\Ù]

NÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[™XÛÜ™Y
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[™XÛÜ™Y˜[YHH›Ü›X[^™Y™XÛÜ™Èİš[™Ê›Ü›X[^™Y™XÛÜ™œ™XÛÜ™Y
HˆˆÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[™\Ü[Û
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[™\Ü[Û˜[YHH›Ü›X[^™Y™XÛÜ™ˆÈ›Ü›X[^™Y™XÛÜ™œ™\Ü[ÛˆˆX[˜YÙ[Y[›[ÛÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Y
H[Ë›[ÛS™]ÓY\˜Ú[Y˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™›Y\˜Ú[YˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[˜[YJH[Ë›[ÛS™]ÓY\˜Ú[˜[YK˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™›Y\˜Ú[˜[YHˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[X[˜YÙ\ŠH[Ë›[ÛS™]ÓY\˜Ú[X[˜YÙ\‹˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™˜\Ú[™\ÜÓX[˜YÙ\ˆˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[›ÙÜ˜[JH[Ë›[ÛS™]ÓY\˜Ú[›ÙÜ˜[K˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™œ›ÙÜ˜[HˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[]›Ü›JH[Ë›[ÛS™]ÓY\˜Ú[]›Ü›K˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™œ]›Ü›HˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Û]”™\]Z\™[Y[
H[Ë›[ÛS™]ÓY\˜Ú[Û]”™\]Z\™[Y[˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™™Û]”™\]Z\™[Y[ˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[\İ[Û\˜Ú\ÙJH[Ë›[ÛS™]ÓY\˜Ú[\İ[Û\˜Ú\ÙK˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™œ\İ[Û\˜Ú\ÙHˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[™\[™[ÙXœÚ]\ÊH[Ë›[ÛS™]ÓY\˜Ú[[™\[™[ÙXœÚ]\Ë˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™š[™\[™[ÙXœÚ]\ÈˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[™]šY]Ôİ[[X\JH[Ë›[ÛS™]ÓY\˜Ú[™]šY]Ôİ[[X\K˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™œ™]šY]Ôİ[[X\HˆˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[İ\ÛÛ[Z\ÜÚ[ÛŠHÂˆ[Ë›[ÛS™]ÓY\˜Ú[İ\ÛÛ[Z\ÜÚ[Û‹˜[YHH›Ü›X[^™Y™XÛÜ™	‰ˆ›Ü›X[^™Y™XÛÜ™›İ\ÛÛ[Z\ÜÚ[ÛˆOOH[ˆÈİš[™Ê›Ü›X[^™Y™XÛÜ™›İ\ÛÛ[Z\ÜÚ[ÛŠBˆˆˆÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[™\Ù]ÛÛ[Z\ÜÚ[ÛŠHÂˆ[Ë›[ÛS™]ÓY\˜Ú[™\Ù]ÛÛ[Z\ÜÚ[Û‹˜[YHH›Ü›X[^™Y™XÛÜ™	‰ˆ›Ü›X[^™Y™XÛÜ™œ™\Ù]ÛÛ[Z\ÜÚ[ÛˆOOH[ˆÈİš[™Ê›Ü›X[^™Y™XÛÜ™œ™\Ù]ÛÛ[Z\ÜÚ[ÛŠBˆˆˆÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[š[Üš]JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[š[Üš]K˜ÚXÚÙYH›ÛÛX[Š›Ü›X[^™Y™XÛÜ™	‰ˆ›Ü›X[^™Y™XÛÜ™š\Ôš[Üš]JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Û]•\™Ù]
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[Û]•\™Ù]˜[YHH›Ü›X[^™Y™XÛÜ™	‰ˆ›Ü›X[^™Y™XÛÜ™™Û]“[ÛU\™Ù]OOH[ˆÈİš[™Ê›Ü›X[^™Y™XÛÜ™™Û]“[ÛU\™Ù]
BˆˆˆÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[™]Ø\™
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[™]Ø\™˜[YHH›Ü›X[^™Y™XÛÜ™È›Ü›X[^™Y™XÛÜ™˜ÛÛ\][Û”™]Ø\™ˆˆÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\•]JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\•]K^ÛÛ[H›Ü›X[^™Y™XÛÜ™ˆÈ
›[ÛS™]ÓY\˜Ú[Ë™Y]]H‹‘Y]™]ÈY\˜Ú[ŠBˆˆ
›[ÛS™]ÓY\˜Ú[Ë˜Y]H‹Y™]ÈY\˜Ú[ŠNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›Ü
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›Ü˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›ÜœÙ]]šX]J˜\šXKZY[ˆ‹™˜[ÙHŠNÂˆBˆØİ[Y[˜›ÙK˜Û\ÜÓ\İ˜Y
›[ÛK[™]Ë[Y\˜Ú[Y˜]Ù\‹[Ü[ˆŠNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[˜[YJH[Ë›[ÛS™]ÓY\˜Ú[˜[YK™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[ÛˆÛÜÙS[ÛS™]ÓY\˜Ú[˜]Ù\ŠÈ™\İÜ™Q›Øİ\ÈHYHHHßJHÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆX[˜YÙ[Y[™˜]Ù\“Ü[ˆH˜[ÙNÂˆX[˜YÙ[Y[™Y][™Ô™XÛÜ™YH[ÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›Ü
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›Ü˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›ÜœÙ]]šX]J˜\šXKZY[ˆ‹YHŠNÂˆBˆØİ[Y[˜›ÙK˜Û\ÜÓ\İœ™[[İ™J›[ÛK[™]Ë[Y\˜Ú[Y˜]Ù\‹[Ü[ˆŠNÂˆÙ][ÛS™]ÓY\˜Ú[›Ü›Q\œ›ÜŠˆŠNÂˆYˆ
ˆ™\İÜ™Q›Øİ\Âˆ	‰ˆX[˜YÙ[Y[œ™\İÜ™Q›Øİ\Âˆ	‰ˆ\[ÙˆX[˜YÙ[Y[œ™\İÜ™Q›Øİ\Ë™›Øİ\ÈOOH™[˜İ[Ûˆ‚ˆ
HÂˆX[˜YÙ[Y[œ™\İÜ™Q›Øİ\Ë™›Øİ\Ê
NÂˆBˆX[˜YÙ[Y[œ™\İÜ™Q›Øİ\ÈH[ÂˆB‚ˆ][ÛS™]ÓY\˜Ú[ÚY]œÔ›ÛZ\ÙHH[Â‚ˆ[˜İ[Ûˆ[ÛS™]ÓY\˜Ú[[\Ü\ÜİYU^
Y\ÜØYÙJHÂˆÛÛœİ^Hİš[™ÊY\ÜØYÙHˆŠNÂˆYˆ
İ]K›[™İXYÙHOOHšŠH™]\›ˆ^ÂˆÛÛœİ^XİHÂˆ“›ÈX›H›İÜÈ›İ[™ˆˆ¹¬¨y§"y¢o¹b,9cëú+îùcå¹æ¡:(j9¨/:(c8à ˆ‹ˆHœ˜[™ÜˆY\˜Ú[XY\ˆ\È™\]Z\™Yˆˆº(j9¨/9oázhnùc!yd*Èœ˜[™9¢%ˆY\˜Ú[:(j9i-8à ˆ‹ˆ“›Èİ\ÜYXY\œÈÙ\™H™XÛÙÛš^™Yˆˆ¹§*º+á¹b*ùb,9cåù¥+ù£ yæ¡:(j9i-8à ˆ‹ˆœ˜[™\È™\]Z\™Yˆˆ¹dàyâc9.#z ïy..¹ên¸à ˆ‹ˆ“Y\˜Ú[Q]\İ™H[Y\šXËˆˆ¹ea¹k­ˆQ9oázhnù..¹¥l9keøà ˆ‹ˆ‘\XØ]Hœ˜[™[ˆ\È[\Üˆˆ¹kï9aiz(j9.+ydàyâc:aãyi#xà ˆ‹ˆ‘\XØ]HY\˜Ú[Q[ˆ\È[\Üˆˆ¹kï9aiz(j9.+yea¹k­ˆQ:aãyi#xà ˆ‚ˆNÂˆYˆ
^Xİİ^JH™]\›ˆ^Xİİ^NÂˆYˆ
^œİ\ÕÚ]
’[˜[YÛÛ[Z\ÜÚ[ÛˆŠJHÂˆ™]\›ˆ9/húaäy¨/9o#ù¥è9¥b;ï&‰İ^œÛXÙJ’[˜[YÛÛ[Z\ÜÚ[Ûˆ‹›[™İ
_XÂˆBˆYˆ
^œİ\ÕÚ]
ÛÛ[Z\ÜÚ[Ûˆ]\İ™H™]ÙY[ˆ	H[™L	NˆŠJHÂˆ™]\›ˆ9/húaäyoázhnùg*	H9b,L	H9.búeí;ï&‰İ^œÛXÙJÛÛ[Z\ÜÚ[Ûˆ]\İ™H™]ÙY[ˆ	H[™L	Nˆ‹›[™İ
_XÂˆBˆ™]\›ˆ^ÂˆB‚ˆ[˜İ[ÛˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠY\ÜØYÙHHˆŠHÂˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠH™]\›Âˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü\œ›Ü‹^ÛÛ[H[ÛS™]ÓY\˜Ú[[\Ü\ÜİYU^
Y\ÜØYÙJNÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü\œ›Ü‹˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[Y\ÜØYÙJNÂˆB‚ˆ[˜İ[Ûˆ™[™\“[ÛS™]ÓY\˜Ú[[\Ü

HÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆÛÛœİ›İÜÈHX[˜YÙ[Y[š[\Ü›İÜÈ×NÂˆÛÛœİ˜[Y›İÜÈH›İÜË™š[\Š
›İÊHOˆ\›İË™\œ›ÜœË›[™İ	‰ˆ›İËœİ]\ÈOOHœØ]™YŠNÂˆÛÛœİ\ÜİYT›İÜÈH›İÜË™š[\Š
›İÊHOˆ›İË™\œ›ÜœË›[™İ›İËœİ]\ÈOOH™\œ›ÜˆŠNÂˆÛÛœİØ]™Y›İÜÈH›İÜË™š[\Š
›İÊHOˆ›İËœİ]\ÈOOHœØ]™YŠNÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Üš[S˜[YJHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Üš[S˜[YK^ÛÛ[HX[˜YÙ[Y[š[\Üš[S˜[YBˆ
›[ÛS™]ÓY\˜Ú[Ë››Ñš[H‹“›Èš[HÙ[XİYŠNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Üİ[[X\JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Üİ[[X\K^ÛÛ[Hİ]K›[™İXYÙHOOHš‚ˆÈ	Ü›İÜË›[™İH:(c0­È	İ˜[Y›İÜË›[™İH:(c9cëùkï9aiH0­È	Ú\ÜİYT›İÜË›[™İH:(c:g 9i!9ä!‰ÜØ]™Y›İÜË›[™İÈ0­È	ÜØ]™Y›İÜË›[™İH:(c9mì¹/çykfˆˆŸXˆˆ	Ü›İÜË›[™İH›İÉÜ›İÜË›[™İOOHHÈˆˆˆœÈŸH0­È	İ˜[Y›İÜË›[™İH™XYH0­È	Ú\ÜİYT›İÜË›[™İHÚ]\ÜİY\ÉÜØ]™Y›İÜË›[™İÈ0­È	ÜØ]™Y›İÜË›[™İHØ]™YˆˆŸXÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\ÜØ]™JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\ÜØ]™K™\ØX›YHX[˜YÙ[Y[š[\Ü[™È]˜[Y›İÜË›[™İÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\ÜØ]™K^ÛÛ[HX[˜YÙ[Y[š[\Ü[™ÂˆÈ
İ]K›[™İXYÙHOOHšˆÈ¹«hùg*9kï9aix )ˆˆˆ’[\Ü[™ø )ˆŠBˆˆ
›[ÛS™]ÓY\˜Ú[Ëš[\Ü˜[Y‹’[\Ü˜[Y›İÜÈŠNÂˆBˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[[\Ü™]šY]ÕX›JH™]\›ÂˆYˆ
\›İÜË›[™İ
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü™]šY]ÕX›Kš[›™\’SH]ˆÛ\ÜÏH›[ÛK[™]Ë[Y\˜Ú[ËY[\HÜ[‰Ù\ØØ\R[
İ]K›[™İXYÙHOOHšˆÈº`"y¢êy¥¡ù.í¹¢%¹ì¦:--:(j9¨/9d#¹clùcëúh¡:)â8à ˆˆˆÚÛÜÙHHš[HÜˆ\İHHX›HÈ™]šY]È]\™KˆŠ_OÜÜ[Ù]˜Âˆ™]\›ÂˆBˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü™]šY]ÕX›Kš[›™\’SHX›O‚ˆXY‚ˆ‰Ù\ØØ\R[
İ]K›[™İXYÙHOOHšˆÈº(cˆˆ”›İÈŠ_Oİ‚ˆ‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ë˜œ˜[™‹œ˜[™ŠJ_Oİ‚ˆ‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ëœ›ÙÜ˜[H‹”›ÙÜ˜[HŠJ_Oİ‚ˆ‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ëœ]›Ü›H‹”]›Ü›HŠJ_Oİ‚ˆ‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ë™Û]”™\]Z\™[Y[‹‘ÓUˆ™YYÈ™H™XXÚYŠJ_Oİ‚ˆ‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ë›İ\ÛÛ[Z\ÜÚ[Ûˆ‹“İ\ˆÛÛ[Z\ÜÚ[ÛˆŠJ_Oİ‚ˆ‰Ù\ØØ\R[

›[ÛS™]ÓY\˜Ú[Ëœ™\Ù]ÛÛ[Z\ÜÚ[Ûˆ‹”™\Ù]ÛÛ[Z\ÜÚ[ÛˆŠJ_Oİ‚ˆ‰Ù\ØØ\R[
İ]K›[™İXYÙHOOHšˆÈ¹â­¹  Hˆˆ”İ]\ÈŠ_Oİ‚ˆİİXY‚ˆ›ÙO‰Ü›İÜË›X\

›İÊHOˆÂˆÛÛœİ›İÒ\ÜİY\ÈHË‹‹œ›İË™\œ›ÜœË‹‹Š›İËœØ]™Q\œ›ÜˆÈÜ›İËœØ]™Q\œ›Ü—Hˆ×JWNÂˆ]İ]\ÈHİ]K›[™İXYÙHOOHšˆÈ¹cëùkï9aiHˆˆ”™XYHÂˆ]İ]\ĞÛ\ÜÈHš[\Ü\İ]\Ë[ÚÈÂˆYˆ
›İËœİ]\ÈOOHœØ]™YŠHÂˆİ]\ÈHİ]K›[™İXYÙHOOHšˆÈ¹mì¹/çykfˆˆ”Ø]™YÂˆH[ÙHYˆ
›İËœİ]\ÈOOHœØ]š[™ÈŠHÂˆİ]\ÈHİ]K›[™İXYÙHOOHšˆÈ¹/çykf9.+x )ˆˆˆ”Ø]š[™ø )ˆÂˆH[ÙHYˆ
›İÒ\ÜİY\Ë›[™İ
HÂˆİ]\ÈH›İÒ\ÜİY\Ë›X\
[ÛS™]ÓY\˜Ú[[\Ü\ÜİYU^
Kš›Ú[ŠˆŠNÂˆİ]\ĞÛ\ÜÈHš[\Ü\İ]\ËY\œ›ÜˆÂˆBˆÛÛœİÛÛ[Z\ÜÚ[Û•^H
˜[YJHOˆ˜[YHOOH[È¸ %ˆˆ	İ˜[Y_IXÂˆ™]\›ˆˆÛ\ÜÏH‰Ü›İÒ\ÜİY\Ë›[™İÈš\ËY\œ›ÜˆˆˆˆŸH‚ˆ‰Ü›İËœ›İÓ[X™\ŸOİ‚ˆİ›Û™Ï‰Ù\ØØ\R[
›İËœ^[ØY›Y\˜Ú[˜[YH¸ %Š_OÜİ›Û™Ï‰Ü›İËœ^[ØY›Y\˜Ú[YÈœÛX[’Q	Ù\ØØ\R[
›İËœ^[ØY›Y\˜Ú[Y
_OÜÛX[˜ˆˆŸOİ‚ˆ‰Ù\ØØ\R[
›İËœ^[ØYœ›ÙÜ˜[H¸ %Š_Oİ‚ˆ‰Ù\ØØ\R[
›İËœ^[ØYœ]›Ü›H¸ %Š_Oİ‚ˆ‰Ù\ØØ\R[
›İËœ^[ØY™Û]”™\]Z\™[Y[¸ %Š_Oİ‚ˆ‰Ù\ØØ\R[
ÛÛ[Z\ÜÚ[Û•^
›İËœ^[ØY›İ\ÛÛ[Z\ÜÚ[ÛŠJ_Oİ‚ˆ‰Ù\ØØ\R[
ÛÛ[Z\ÜÚ[Û•^
›İËœ^[ØYœ™\Ù]ÛÛ[Z\ÜÚ[ÛŠJ_Oİ‚ˆÛ\ÜÏH‰Üİ]\ĞÛ\ÜßH‰Ù\ØØ\R[
İ]\Ê_Oİ‚ˆİ˜ÂˆJKš›Ú[ŠˆŠ_Oİ›ÙO‚ˆİX›O˜ÂˆB‚ˆ[˜İ[Ûˆ\S[ÛS™]ÓY\˜Ú[[\Ü™\İ[
™\İ[š[S˜[YHHˆŠHÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆX[˜YÙ[Y[š[\Ü›İÜÈH™\İ[œ›İÜÈ×NÂˆX[˜YÙ[Y[š[\Üš[S˜[YHHš[S˜[YNÂˆÛÛœİY\ÜØYÙ\ÈHË‹‹Š™\İ[™\œ›ÜœÈ×JWNÂˆYˆ
™\İ[šXY\œÈ	‰ˆ™\İ[šXY\œË›[™İ	‰ˆ\™\İ[œ™XÛÙÛš^™YXY\œÊHÂˆY\ÜØYÙ\Ëœ\Ú
“›Èİ\ÜYXY\œÈÙ\™H™XÛÙÛš^™YˆŠNÂˆBˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠY\ÜØYÙ\Ë›X\
[ÛS™]ÓY\˜Ú[[\Ü\ÜİYU^
Kš›Ú[ŠˆŠJNÂˆ™[™\“[ÛS™]ÓY\˜Ú[[\Ü

NÂˆB‚ˆ[˜İ[ÛˆÜ[“[ÛS™]ÓY\˜Ú[[\Ü

HÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆX[˜YÙ[Y[š[\Ü™\İÜ™Q›Øİ\ÈHØİ[Y[˜Xİ]™Q[[Y[ÂˆX[˜YÙ[Y[š[\ÜÜ[ˆHYNÂˆX[˜YÙ[Y[š[\Ü[™ÈH˜[ÙNÂˆX[˜YÙ[Y[š[\Ü›İÜÈH×NÂˆX[˜YÙ[Y[š[\Üš[S˜[YHHˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü\İJH[Ë›[ÛS™]ÓY\˜Ú[[\Ü\İK˜[YHHˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Üš[JH[Ë›[ÛS™]ÓY\˜Ú[[\Üš[K˜[YHHˆÂˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠˆŠNÂˆ™[™\“[ÛS™]ÓY\˜Ú[[\Ü

NÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›Ü
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›Ü˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›ÜœÙ]]šX]J˜\šXKZY[ˆ‹™˜[ÙHŠNÂˆBˆØİ[Y[˜›ÙK˜Û\ÜÓ\İ˜Y
›[ÛK[™]Ë[Y\˜Ú[Y˜]Ù\‹[Ü[ˆŠNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\ÜÚÛÜÙJH[Ë›[ÛS™]ÓY\˜Ú[[\ÜÚÛÜÙK™›Øİ\Ê
NÂˆJNÂˆB‚ˆ[˜İ[ÛˆÛÜÙS[ÛS™]ÓY\˜Ú[[\Ü
È™\İÜ™Q›Øİ\ÈHYHHHßJHÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆYˆ
X[˜YÙ[Y[š[\Ü[™ÊH™]\›ÂˆX[˜YÙ[Y[š[\ÜÜ[ˆH˜[ÙNÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›Ü
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›Ü˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›ÜœÙ]]šX]J˜\šXKZY[ˆ‹YHŠNÂˆBˆØİ[Y[˜›ÙK˜Û\ÜÓ\İœ™[[İ™J›[ÛK[™]Ë[Y\˜Ú[Y˜]Ù\‹[Ü[ˆŠNÂˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠˆŠNÂˆYˆ
ˆ™\İÜ™Q›Øİ\Âˆ	‰ˆX[˜YÙ[Y[š[\Ü™\İÜ™Q›Øİ\Âˆ	‰ˆ\[ÙˆX[˜YÙ[Y[š[\Ü™\İÜ™Q›Øİ\Ë™›Øİ\ÈOOH™[˜İ[Ûˆ‚ˆ
HÂˆX[˜YÙ[Y[š[\Ü™\İÜ™Q›Øİ\Ë™›Øİ\Ê
NÂˆBˆX[˜YÙ[Y[š[\Ü™\İÜ™Q›Øİ\ÈH[ÂˆB‚ˆ[˜İ[Ûˆ™]šY]Ó[ÛS™]ÓY\˜Ú[\İJ
HÂˆÛÛœİ^H[Ë›[ÛS™]ÓY\˜Ú[[\Ü\İBˆÈ[Ë›[ÛS™]ÓY\˜Ú[[\Ü\İK˜[YBˆˆˆÂˆ\S[ÛS™]ÓY\˜Ú[[\Ü™\İ[
ˆ[ÛS™]ÓY\˜Ú[[\Ü›İÜÊ\œÙS[ÛS™]ÓY\˜Ú[X›J^
Kİ]K›[ÛS™]ÓY\˜Ú[Ë›[Û
Bˆ
NÂˆB‚ˆ[˜İ[ÛˆØY[ÛS™]ÓY\˜Ú[ÚY]œÊ
HÂˆYˆ
Ú[™İË–Ö
H™]\›ˆ›ÛZ\ÙKœ™\ÛÛ™JÚ[™İË–Ö
NÂˆYˆ
[ÛS™]ÓY\˜Ú[ÚY]œÔ›ÛZ\ÙJH™]\›ˆ[ÛS™]ÓY\˜Ú[ÚY]œÔ›ÛZ\ÙNÂˆ[ÛS™]ÓY\˜Ú[ÚY]œÔ›ÛZ\ÙHH™]È›ÛZ\ÙJ
™\ÛÛ™K™Z™Xİ
HOˆÂˆÛÛœİØÜš\HØİ[Y[˜Ü™X]Q[[Y[
œØÜš\ŠNÂˆØÜš\œÜ˜ÈHšÎ‹ËØÙ‹šœÙ[]œ‹›™]ÛœKŞŞŒNKÙ\İŞŞ™[›Z[‹šœÈÂˆØÜš\˜\Ş[˜ÈHYNÂˆØÜš\›Û›ØYH

HOˆÚ[™İË–ÖˆÈ™\ÛÛ™JÚ[™İË–Ö
Bˆˆ™Z™Xİ
™]È\œ›ÜŠ”Ü™XYÚY]™XY\ˆY›İØYˆŠJNÂˆØÜš\›Û™\œ›ÜˆH

HOˆ™Z™Xİ
™]È\œ›ÜŠÛİ[›İØYHËÖÖ™XY\‹ˆHÔÕˆÜˆ\İHHX›H[œİXYˆŠJNÂˆØİ[Y[šXY˜\[™Ú[
ØÜš\
NÂˆJK˜Ø]Ú

\œ›ÜŠHOˆÂˆ[ÛS™]ÓY\˜Ú[ÚY]œÔ›ÛZ\ÙHH[Âˆ›İÈ\œ›ÜÂˆJNÂˆ™]\›ˆ[ÛS™]ÓY\˜Ú[ÚY]œÔ›ÛZ\ÙNÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ™XY[ÛS™]ÓY\˜Ú[[\Üš[Jš[JHÂˆÛÛœİ^[œÚ[ÛˆHİš[™Êš[H	‰ˆš[K›˜[YHˆŠKœÜ]
‹ˆŠKœÜ

KÓİÙ\Ø\ÙJ
NÂˆYˆ
^[œÚ[ÛˆOOHŞˆ^[œÚ[ÛˆOOHÈŠHÂˆÛÛœİÖH]ØZ]ØY[ÛS™]ÓY\˜Ú[ÚY]œÊ
NÂˆÛÛœİÛÜšØ›ÛÚÈHÖœ™XY
]ØZ]š[K˜\œ˜^PY™™\Š
KÈ\Nˆ˜\œ˜^HˆJNÂˆÛÛœİš\œİÚY]HÛÜšØ›ÛÚË”ÚY]ÖİÛÜšØ›ÛÚË”ÚY]˜[Y\ÖÌWNÂˆYˆ
Yš\œİÚY]
H™]\›ˆ×NÂˆ™]\›ˆÖ][ËœÚY]İ×ÚœÛÛŠš\œİÚY]ÈXY\ˆK˜]Îˆ˜[ÙKY˜[ˆˆˆJNÂˆBˆÛÛœİ[[Z]\ˆH^[œÚ[ÛˆOOHİˆˆÈ—ˆˆˆÂˆ™]\›ˆ\œÙS[ÛS™]ÓY\˜Ú[X›J]ØZ]š[K^

K[[Z]\ŠNÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ[™S[ÛS™]ÓY\˜Ú[[\Üš[J
HÂˆÛÛœİš[HH[Ë›[ÛS™]ÓY\˜Ú[[\Üš[H	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[[\Üš[K™š[\ÂˆÈ[Ë›[ÛS™]ÓY\˜Ú[[\Üš[K™š[\ÖÌBˆˆ[ÂˆYˆ
Yš[JH™]\›ÂˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠˆŠNÂˆİ]K›[ÛS™]ÓY\˜Ú[Ëš[\Üš[S˜[YHHš[K›˜[YNÂˆ™[™\“[ÛS™]ÓY\˜Ú[[\Ü

NÂˆHÂˆÛÛœİX›HH]ØZ]™XY[ÛS™]ÓY\˜Ú[[\Üš[Jš[JNÂˆ\S[ÛS™]ÓY\˜Ú[[\Ü™\İ[
ˆ[ÛS™]ÓY\˜Ú[[\Ü›İÜÊX›Kİ]K›[ÛS™]ÓY\˜Ú[Ë›[Û
Kˆš[K›˜[YBˆ
NÂˆHØ]Ú
\œ›ÜŠHÂˆİ]K›[ÛS™]ÓY\˜Ú[Ëš[\Ü›İÜÈH×NÂˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠ\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠJNÂˆ™[™\“[ÛS™]ÓY\˜Ú[[\Ü

NÂˆBˆB‚ˆ[˜İ[ÛˆİÛ›ØY[ÛS™]ÓY\˜Ú[[\]J
HÂˆÛÛœİXY\œÈHÂˆœ˜[™‹“Y\˜Ú[Q‹”›ÙÜ˜[H‹”]›Ü›H‹‘ÓUˆ™YYÈ™H™XXÚ‹ˆ”\İ[Û\˜Ú\ÙH‹’[™\[™[ÙXœÚ]\È‹”™]šY]ÜÈ[X™\œÈ‹ˆ“İ\ˆÛÛ[Z\ÜÚ[Ûˆ‹”™\Ù]ÛÛ[Z\ÜÚ[Ûˆ‹‘‹”š[Üš]H‹ÛÛ\][Ûˆ™]Ø\™‚ˆNÂˆÛÛœİ›ØˆH™]È›ØŠØQ‘Q‘‰ÚXY\œËš›Ú[Š‹Š_W—˜KÈ\Nˆ^ØÜİØÚ\œÙ]]]‹NˆJNÂˆÛÛœİ\›HT“˜Ü™X]SØš™XİT“
›ØŠNÂˆÛÛœİ[˜ÚÜˆHØİ[Y[˜Ü™X]Q[[Y[
˜HŠNÂˆ[˜ÚÜ‹š™YˆH\›Âˆ[˜ÚÜ‹™İÛ›ØYH[ÛK[™]Ë[Y\˜Ú[ËIÜİ]K›[ÛS™]ÓY\˜Ú[Ë›[ÛK˜Üİ˜ÂˆØİ[Y[˜›ÙK˜\[™Ú[
[˜ÚÜŠNÂˆ[˜ÚÜ‹˜ÛXÚÊ
NÂˆ[˜ÚÜ‹œ™[[İ™J
NÂˆT“œ™]›ÚÙSØš™XİT“
\›
NÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ[\Ü[ÛS™]ÓY\˜Ú[›İÜÊ
HÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆYˆ
X[˜YÙ[Y[š[\Ü[™ÊH™]\›ÂˆÛÛœİ™XYT›İÜÈHX[˜YÙ[Y[š[\Ü›İÜË™š[\Š
›İÊHOˆ\›İË™\œ›ÜœË›[™İ	‰ˆ›İËœİ]\ÈOOHœØ]™YŠNÂˆYˆ
\™XYT›İÜË›[™İ
H™]\›ÂˆX[˜YÙ[Y[š[\Ü[™ÈHYNÂˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠˆŠNÂˆ]Ø]™YÛİ[HÂˆ›Üˆ
ÛÛœİ›İÈÙˆ™XYT›İÜÊHÂˆ›İËœİ]\ÈHœØ]š[™ÈÂˆ›İËœØ]™Q\œ›ÜˆHˆÂˆ™[™\“[ÛS™]ÓY\˜Ú[[\Ü

NÂˆHÂˆ]ØZ]™\]Y\İ[ÛS™]ÓY\˜Ú[Ê›İËœ^[ØY
NÂˆ›İËœİ]\ÈHœØ]™YÂˆØ]™YÛİ[
ÏHNÂˆHØ]Ú
\œ›ÜŠHÂˆ›İËœİ]\ÈH™\œ›ÜˆÂˆ›İËœØ]™Q\œ›ÜˆH\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠNÂˆBˆBˆX[˜YÙ[Y[š[\Ü[™ÈH˜[ÙNÂˆX[˜YÙ[Y[›ØYY[ÛHˆÂˆ]ØZ]ØY[ÛS™]ÓY\˜Ú[ÊÈ›Ü˜ÙNˆYHJNÂˆÛÛœİ˜Z[YÛİ[H™XYT›İÜË›[™İHØ]™YÛİ[ÂˆYˆ
Y˜Z[YÛİ[
HÂˆÛÜÙS[ÛS™]ÓY\˜Ú[[\Ü
È™\İÜ™Q›Øİ\Îˆ˜[ÙHJNÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJİ]K›[™İXYÙHOOHš‚ˆÈ9mì¹l!ˆ	ÜØ]™YÛİ[H9.*¹ea¹k­¹/çykf9b,9¥l9£k¹n¤øà ˜ˆˆ	ÜØ]™YÛİ[HY\˜Ú[	ÜØ]™YÛİ[OOHHÈˆˆˆœÈŸH[\ÜYÈH]X˜\ÙK˜
NÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü
H[Ë›[ÛS™]ÓY\˜Ú[[\Ü™›Øİ\Ê
NÂˆH[ÙHÂˆÙ][ÛS™]ÓY\˜Ú[[\Ü\œ›ÜŠİ]K›[™İXYÙHOOHš‚ˆÈ	ÜØ]™YÛİ[H:(c9mì¹/çykf;ï#	Ù˜Z[YÛİ[H:(c9i,z-){ï&ùi,z-)yc§ùfè9mìºjæ9.«¸à ˜ˆˆ	ÜØ]™YÛİ[HØ]™Y[™	Ù˜Z[YÛİ[H˜Z[YˆH˜Z[Y›İÜÈ\™HYÚYÚY˜
NÂˆ™[™\“[ÛS™]ÓY\˜Ú[[\Ü

NÂˆBˆB‚ˆ[˜İ[Ûˆ˜\[ÛS™]ÓY\˜Ú[[\Ü›Øİ\Ê]™[
HÂˆYˆ
ˆ]™[šÙ^HOOH•Xˆ‚ˆ\İ]K›[ÛS™]ÓY\˜Ú[Ëš[\ÜÜ[‚ˆY[Ë›[ÛS™]ÓY\˜Ú[[\ÜX[ÙÂˆ
H™]\›ˆ˜[ÙNÂˆÛÛœİ›Øİ\ØX›HH\œ˜^K™œ›ÛJ[Ë›[ÛS™]ÓY\˜Ú[[\ÜX[ÙËœ]Y\TÙ[XİÜ[
ˆ˜]Û››İ
Ù\ØX›YJK[œ]››İ
Ù\ØX›YJK^\™XN››İ
Ù\ØX›YJKİXš[™^N››İ
İXš[™^IËLI×JH‚ˆ
JK™š[\Š
[[Y[
HOˆY[[Y[˜ÛÜÙ\İ
‹šY[ˆŠJNÂˆYˆ
Y›Øİ\ØX›K›[™İ
H™]\›ˆ˜[ÙNÂˆÛÛœİš\œİH›Øİ\ØX›VÌNÂˆÛÛœİ\İH›Øİ\ØX›VÙ›Øİ\ØX›K›[™İHWNÂˆYˆ
]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOHš\œİ
HÂˆ]™[œ™]™[Y˜][

NÂˆ\İ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆYˆ
Y]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOH\İ
HÂˆ]™[œ™]™[Y˜][

NÂˆš\œİ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆ™]\›ˆ˜[ÙNÂˆB‚ˆ[˜İ[Ûˆ˜\[ÛS™]ÓY\˜Ú[˜]Ù\‘›Øİ\Ê]™[
HÂˆYˆ
ˆ]™[šÙ^HOOH•Xˆ‚ˆ\İ]K›[ÛS™]ÓY\˜Ú[Ë™˜]Ù\“Ü[‚ˆY[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\‚ˆ
H™]\›ˆ˜[ÙNÂˆÛÛœİ›Øİ\ØX›HH\œ˜^K™œ›ÛJ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\‹œ]Y\TÙ[XİÜ[
ˆ˜]Û››İ
Ù\ØX›YJK[œ]››İ
Ù\ØX›YJK^\™XN››İ
Ù\ØX›YJKİXš[™^N››İ
İXš[™^IËLI×JH‚ˆ
JK™š[\Š
[[Y[
HOˆY[[Y[˜ÛÜÙ\İ
‹šY[ˆŠJNÂˆYˆ
Y›Øİ\ØX›K›[™İ
H™]\›ˆ˜[ÙNÂˆÛÛœİš\œİH›Øİ\ØX›VÌNÂˆÛÛœİ\İH›Øİ\ØX›VÙ›Øİ\ØX›K›[™İHWNÂˆYˆ
]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOHš\œİ
HÂˆ]™[œ™]™[Y˜][

NÂˆ\İ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆYˆ
Y]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOH\İ
HÂˆ]™[œ™]™[Y˜][

NÂˆš\œİ™›Øİ\Ê
NÂˆ™]\›ˆYNÂˆBˆ™]\›ˆ˜[ÙNÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆİX›Z][ÛS™]ÓY\˜Ú[
]™[
HÂˆ]™[œ™]™[Y˜][

NÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆYˆ
X[˜YÙ[Y[œİX›Z][™ÈY[Ë›[ÛS™]ÓY\˜Ú[›Ü›JH™]\›ÂˆYˆ
Y[Ë›[ÛS™]ÓY\˜Ú[›Ü›Kœ™\Ü˜[Y]J
JH™]\›ÂˆÛÛœİ^[ØYHZ[[ÛS™]ÓY\˜Ú[^[ØY
Âˆ™XÛÜ™Yˆ[Ë›[ÛS™]ÓY\˜Ú[™XÛÜ™Y	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[™XÛÜ™Y˜[YKˆ™\Ü[Ûˆ[Ë›[ÛS™]ÓY\˜Ú[™\Ü[Û	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[™\Ü[Û˜[YKˆY\˜Ú[Yˆ[Ë›[ÛS™]ÓY\˜Ú[Y	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[Y˜[YKˆY\˜Ú[˜[YNˆ[Ë›[ÛS™]ÓY\˜Ú[˜[YH	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[˜[YK˜[YKˆ\Ú[™\ÜÓX[˜YÙ\ˆ[Ë›[ÛS™]ÓY\˜Ú[X[˜YÙ\ˆ	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[X[˜YÙ\‹˜[YKˆ›ÙÜ˜[Nˆ[Ë›[ÛS™]ÓY\˜Ú[›ÙÜ˜[H	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[›ÙÜ˜[K˜[YKˆ]›Ü›Nˆ[Ë›[ÛS™]ÓY\˜Ú[]›Ü›H	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[]›Ü›K˜[YKˆÛ]”™\]Z\™[Y[ˆ[Ë›[ÛS™]ÓY\˜Ú[Û]”™\]Z\™[Y[	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[Û]”™\]Z\™[Y[˜[YKˆ\İ[Û\˜Ú\ÙNˆ[Ë›[ÛS™]ÓY\˜Ú[\İ[Û\˜Ú\ÙH	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[\İ[Û\˜Ú\ÙK˜[YKˆ[™\[™[ÙXœÚ]\Îˆ[Ë›[ÛS™]ÓY\˜Ú[[™\[™[ÙXœÚ]\È	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[[™\[™[ÙXœÚ]\Ë˜[YKˆ™]šY]Ôİ[[X\Nˆ[Ë›[ÛS™]ÓY\˜Ú[™]šY]Ôİ[[X\H	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[™]šY]Ôİ[[X\K˜[YKˆİ\ÛÛ[Z\ÜÚ[Ûˆ[Ë›[ÛS™]ÓY\˜Ú[İ\ÛÛ[Z\ÜÚ[Ûˆ	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[İ\ÛÛ[Z\ÜÚ[Û‹˜[YKˆ™\Ù]ÛÛ[Z\ÜÚ[Ûˆ[Ë›[ÛS™]ÓY\˜Ú[™\Ù]ÛÛ[Z\ÜÚ[Ûˆ	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[™\Ù]ÛÛ[Z\ÜÚ[Û‹˜[YKˆ\Ôš[Üš]Nˆ[Ë›[ÛS™]ÓY\˜Ú[š[Üš]H	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[š[Üš]K˜ÚXÚÙYˆÛ]“[ÛU\™Ù]ˆ[Ë›[ÛS™]ÓY\˜Ú[Û]•\™Ù]	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[Û]•\™Ù]˜[YKˆÛÛ\][Û”™]Ø\™ˆ[Ë›[ÛS™]ÓY\˜Ú[™]Ø\™	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[™]Ø\™˜[YBˆJNÂˆX[˜YÙ[Y[œİX›Z][™ÈHYNÂˆÙ][ÛS™]ÓY\˜Ú[›Ü›Q\œ›ÜŠˆŠNÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Ø]™JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ø]™K™\ØX›YHYNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ø]™K^ÛÛ[Hİ]K›[™İXYÙHOOHšˆÈ¹/çykf9.+x )ˆˆˆ”Ø]š[™ø )ˆÂˆBˆHÂˆ]ØZ]™\]Y\İ[ÛS™]ÓY\˜Ú[Ê^[ØY
NÂˆÛÜÙS[ÛS™]ÓY\˜Ú[˜]Ù\ŠÈ™\İÜ™Q›Øİ\Îˆ˜[ÙHJNÂˆX[˜YÙ[Y[›ØYY[ÛHˆÂˆ]ØZ]ØY[ÛS™]ÓY\˜Ú[ÊÈ›Ü˜ÙNˆYHJNÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJˆ
›[ÛS™]ÓY\˜Ú[ËœØ]™Y‹“Y\˜Ú[[™›Ü›X][Ûˆ[™š[Üš]HÙ\™HØ]™YÈH]X˜\ÙKˆŠBˆ
NÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Y
H[Ë›[ÛS™]ÓY\˜Ú[Y™›Øİ\Ê
NÂˆHØ]Ú
\œ›ÜŠHÂˆÙ][ÛS™]ÓY\˜Ú[›Ü›Q\œ›ÜŠ\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠJNÂˆHš[˜[HÂˆX[˜YÙ[Y[œİX›Z][™ÈH˜[ÙNÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Ø]™JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ø]™K™\ØX›YH˜[ÙNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ø]™K^ÛÛ[H
›[ÛS™]ÓY\˜Ú[ËœØ]™H‹”Ø]™HY\˜Ú[ŠNÂˆBˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆBˆB‚ˆ\Ş[˜È[˜İ[ÛˆÙÙÛS[ÛS™]ÓY\˜Ú[š[Üš]J™XÛÜ™
HÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆÛÛœİ›Ü›X[^™Y™XÛÜ™H›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™
™XÛÜ™
NÂˆYˆ
[›Ü›X[^™Y™XÛÜ™œ™XÛÜ™YX[˜YÙ[Y[œİX›Z][™ÊH™]\›ÂˆX[˜YÙ[Y[œİX›Z][™ÈHYNÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJˆŠNÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆHÂˆÛÛœİ™\ÜÛœÙHH]ØZ]™\]Y\İ[ÛS™]ÓY\˜Ú[ÊZ[[ÛS™]ÓY\˜Ú[^[ØY
Âˆ‹‹››Ü›X[^™Y™XÛÜ™ˆ\Ôš[Üš]Nˆ[›Ü›X[^™Y™XÛÜ™š\Ôš[Üš]BˆJJNÂˆÛÛœİØ]™YH™\ÜÛœÙKœ™XÛÜ™È›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™
™\ÜÛœÙKœ™XÛÜ™
Hˆ[ÂˆYˆ
Ø]™Y
HÂˆX[˜YÙ[Y[œ™XÛÜ™ÈHX[˜YÙ[Y[œ™XÛÜ™Ë›X\

][JHOˆ
ˆ[X™\Š][Kœ™XÛÜ™Y
HOOHØ]™Yœ™XÛÜ™YÈØ]™Yˆ][Bˆ
JNÂˆH[ÙHÂˆX[˜YÙ[Y[›ØYY[ÛHˆÂˆ]ØZ]ØY[ÛS™]ÓY\˜Ú[ÊÈ›Ü˜ÙNˆYHJNÂˆBˆÙ][ÛS™]ÓY\˜Ú[›İXÙJˆ
›[ÛS™]ÓY\˜Ú[ËœØ]™Y‹“Y\˜Ú[[™›Ü›X][Ûˆ[™š[Üš]HÙ\™HØ]™YÈH]X˜\ÙKˆŠBˆ
NÂˆHØ]Ú
\œ›ÜŠHÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJ\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠK™\œ›ÜˆŠNÂˆHš[˜[HÂˆX[˜YÙ[Y[œİX›Z][™ÈH˜[ÙNÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆBˆB‚ˆ\Ş[˜È[˜İ[Ûˆ[]S[ÛS™]ÓY\˜Ú[
™XÛÜ™
HÂˆÛÛœİX[˜YÙ[Y[Hİ]K›[ÛS™]ÓY\˜Ú[ÎÂˆÛÛœİ›Ü›X[^™Y™XÛÜ™H›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™
™XÛÜ™
NÂˆYˆ
[›Ü›X[^™Y™XÛÜ™œ™XÛÜ™YX[˜YÙ[Y[œİX›Z][™ÊH™]\›ÂˆÛÛœİ›Û\H
›[ÛS™]ÓY\˜Ú[Ë™[]PÛÛ™š\›H‹‘[]H\È[ÛH™]ÈY\˜Ú[™XÛÜ™ÈŠNÂˆYˆ
]Ú[™İË˜ÛÛ™š\›J	Ü›Û\W‰Û›Ü›X[^™Y™XÛÜ™›Y\˜Ú[˜[Y_X
JH™]\›ÂˆX[˜YÙ[Y[œİX›Z][™ÈHYNÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJˆŠNÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆHÂˆ]ØZ]™\]Y\İ[ÛS™]ÓY\˜Ú[ÊÈXİ[Ûˆ™[]H‹™XÛÜ™Yˆ›Ü›X[^™Y™XÛÜ™œ™XÛÜ™YJNÂˆX[˜YÙ[Y[›ØYY[ÛHˆÂˆ]ØZ]ØY[ÛS™]ÓY\˜Ú[ÊÈ›Ü˜ÙNˆYHJNÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJˆ
›[ÛS™]ÓY\˜Ú[Ë™[]Y‹•HY\˜Ú[™XÛÜ™Ø\È[]Yœ›ÛHH]X˜\ÙKˆŠBˆ
NÂˆHØ]Ú
\œ›ÜŠHÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJ\œ›Üˆ	‰ˆ\œ›Ü‹›Y\ÜØYÙHÈ\œ›Ü‹›Y\ÜØYÙHˆİš[™Ê\œ›ÜŠK™\œ›ÜˆŠNÂˆHš[˜[HÂˆX[˜YÙ[Y[œİX›Z][™ÈH˜[ÙNÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆBˆB‚ˆ[˜İ[Ûˆ[™S[ÛS™]ÓY\˜Ú[X›PÛXÚÊ]™[
HÂˆÛÛœİ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[[ÛK[™]Ë[Y\˜Ú[XXİ[Û—HŠNÂˆYˆ
X]ÛŠH™]\›ÂˆÛÛœİ›İÈH]Û‹˜ÛÜÙ\İ
–Ù]K[[ÛK[™]Ë[Y\˜Ú[ZYHŠNÂˆÛÛœİ™XÛÜ™YH[X™\Š›İÈ	‰ˆ›İË™]\Ù]›[ÛS™]ÓY\˜Ú[Y
HÂˆÛÛœİ™XÛÜ™Hİ]K›[ÛS™]ÓY\˜Ú[Ëœ™XÛÜ™Ë™š[™
ˆ
][JHOˆ[X™\Š][Kœ™XÛÜ™Y
HOOH™XÛÜ™Yˆ
NÂˆYˆ
\™XÛÜ™
H™]\›ÂˆÛÛœİXİ[ÛˆH]Û‹™]\Ù]›[ÛS™]ÓY\˜Ú[Xİ[ÛÂˆYˆ
Xİ[ÛˆOOHœš[Üš]HŠHÂˆÙÙÛS[ÛS™]ÓY\˜Ú[š[Üš]J™XÛÜ™
NÂˆH[ÙHYˆ
Xİ[ÛˆOOH™Y]ŠHÂˆÜ[“[ÛS™]ÓY\˜Ú[˜]Ù\Š™XÛÜ™
NÂˆH[ÙHYˆ
Xİ[ÛˆOOH™[]HŠHÂˆ[]S[ÛS™]ÓY\˜Ú[
™XÛÜ™
NÂˆBˆB‚ˆ[˜İ[ÛˆØYÙ™™\•˜XÚÙ\”[\Ê
HÂˆHÂˆÛÛœİ\œÙYH”ÓÓ‹œ\œÙJØØ[İÜ˜YÙK™Ù]][JÑ‘‘T—ÕPÒÑT—Ô•ST×ÒÑVJHßHŠNÂˆ™]\›ˆÂˆYÚØÛÜ™NˆX]›Z[ŠLKX]›X^
X]œ›İ[™
[X™\Š\œÙYšYÚØÛÜ™JHQUSÓÑ‘‘T—ÕPÒÑT—Ô•STËšYÚØÛÜ™JJJKˆİĞ[İ“X^ˆX]›X^
K[X™\Š\œÙY›İĞ[İ“X^
HQUSÓÑ‘‘T—ÕPÒÑT—Ô•STË›İĞ[İ“X^
BˆNÂˆHØ]Ú
\œ›ÜŠHÂˆ™]\›ˆÈ‹‹‘QUSÓÑ‘‘T—ÕPÒÑT—Ô•STÈNÂˆBˆB‚ˆ[˜İ[ÛˆØYÙ™™\•˜XÚÙ\•š\ÚX›PÛÛ[[œÊ
HÂˆHÂˆÛÛœİ\œÙYH”ÓÓ‹œ\œÙJØØ[İÜ˜YÙK™Ù]][JÑ‘‘T—ÕPÒÑT—ĞÓÓSS”×ÒÑVJHßHŠNÂˆ™]\›ˆØš™XİšÙ^\ÊQUSÓÑ‘‘T—ÕPÒÑT—ĞÓÓSS”ÊKœ™YXÙJ
™\İ[Ù^JHOˆÂˆ™\İ[ÚÙ^WHH\œÙYÚÙ^WHOH[ÈQUSÓÑ‘‘T—ÕPÒÑT—ĞÓÓSS”ÖÚÙ^WHˆ›ÛÛX[Š\œÙYÚÙ^WJNÂˆ™]\›ˆ™\İ[ÂˆKßJNÂˆHØ]Ú
\œ›ÜŠHÂˆ™]\›ˆÈ‹‹‘QUSÓÑ‘‘T—ÕPÒÑT—ĞÓÓSS”ÈNÂˆBˆB‚ˆ[˜İ[ÛˆØYÙ™™\•˜XÚÙ\”Ø]™YšY]ÜÊ
HÂˆHÂˆÛÛœİ\œÙYH”ÓÓ‹œ\œÙJØØ[İÜ˜YÙK™Ù]][JÑ‘‘T—ÕPÒÑT—ÔĞU‘QÕ’QUÔ×ÒÑVJH–×HŠNÂˆ™]\›ˆ\œ˜^Kš\Ğ\œ˜^J\œÙY
HÈ\œÙY™š[\Š
šY]ÊHOˆšY]È	‰ˆšY]ËšY	‰ˆšY]Ë›˜[YJKœÛXÙJ
Hˆ×NÂˆHØ]Ú
\œ›ÜŠHÂˆ™]\›ˆ×NÂˆBˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\•^
[‹š
HÂˆ™]\›ˆİ]K›[™İXYÙHOOHšˆÈšˆ[ÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”Ù[XİYš[\•˜[Y\Êš[\œË\˜[Ù^KYØXŞRÙ^K›Ü›X[^™U˜[YHH
˜[YJHOˆ˜[YJHÂˆÛÛœİ˜]Õ˜[Y\ÈH\œ˜^Kš\Ğ\œ˜^Jš[\œÈ	‰ˆš[\œÖÜ\˜[Ù^WJBˆÈš[\œÖÜ\˜[Ù^WBˆˆš[\œÈ	‰ˆš[\œÖÛYØXŞRÙ^WH	‰ˆš[\œÖÛYØXŞRÙ^WHOOH˜[‚ˆÈÙš[\œÖÛYØXŞRÙ^WWBˆˆ×NÂˆ™]\›ˆ\œ˜^K™œ›ÛJ™]ÈÙ]
˜]Õ˜[Y\Âˆ›X\

˜[YJHOˆ›Ü›X[^™U˜[YJİš[™Ê˜[YHˆŠKš[J
JJBˆ™š[\Š
˜[YJHOˆ˜[YH	‰ˆ˜[YHOOH˜[ŠJJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”Ù[XİYY\œÊš[\œÈHßJHÂˆ™]\›ˆÙ™™\•˜XÚÙ\”Ù[XİYš[\•˜[Y\Êš[\œËY\œÈ‹Y\ˆ‹Ø[›ÛšXØ[Y\“˜[YJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”Ù[XİYØ]YÛÜšY\Êš[\œÈHßJHÂˆ™]\›ˆÙ™™\•˜XÚÙ\”Ù[XİYš[\•˜[Y\Êš[\œË˜Ø]YÛÜšY\È‹˜Ø]YÛÜHŠNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”Ù[XİY™]ÛÜšÜÊš[\œÈHßJHÂˆ™]\›ˆÙ™™\•˜XÚÙ\”Ù[XİYš[\•˜[Y\Êš[\œË›™]ÛÜšÜÈ‹›™]ÛÜšÈŠNÂˆB‚ˆ[˜İ[Ûˆ›Ü›X[^™SÙ™™\•˜XÚÙ\‘š[\œÊš[\œÈHßJHÂˆÛÛœİY˜][˜[™ÙHHİ]K›Ù™™\“\İ˜XÚÙ\ˆ	‰ˆİ]K›Ù™™\“\İ˜XÚÙ\‹™Y˜][]T˜[™ÙBˆÈİ]K›Ù™™\“\İ˜XÚÙ\‹™Y˜][]T˜[™ÙBˆˆÑ‘‘T—ÕPÒÑT—ÑQUSÑUWÔS‘ÑNÂˆÛÛœİ™\]Y\İY˜[™ÙHHÙ™™\•˜XÚÙ\‘]T˜[™ÙJš[\œËœİ\]Kš[\œË™[™]JNÂˆÛÛœİ˜”ÛXŞHHİš[™Êš[\œË˜˜”ÛXŞH˜[ŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆ™]\›ˆÂˆY\œÎˆÙ™™\•˜XÚÙ\”Ù[XİYY\œÊš[\œÊKˆØ]YÛÜšY\ÎˆÙ™™\•˜XÚÙ\”Ù[XİYØ]YÛÜšY\Êš[\œÊKˆİ\]Nˆ™\]Y\İY˜[™ÙK›ÚÈÈ™\]Y\İY˜[™ÙKœİ\]HˆY˜][˜[™ÙKœİ\]Kˆ[™]Nˆ™\]Y\İY˜[™ÙK›ÚÈÈ™\]Y\İY˜[™ÙK™[™]HˆY˜][˜[™ÙK™[™]KˆZ[[İˆš[\œË›Z[[İˆOH[Èˆˆˆİš[™Êš[\œË›Z[[İŠKˆX^[İˆš[\œË›X^[İˆOH[Èˆˆˆİš[™Êš[\œË›X^[İŠKˆZ[ÛÛ[Z\ÜÚ[Ûˆš[\œË›Z[ÛÛ[Z\ÜÚ[ÛˆOH[Èˆˆˆİš[™Êš[\œË›Z[ÛÛ[Z\ÜÚ[ÛŠKˆX^ÛÛ[Z\ÜÚ[Ûˆš[\œË›X^ÛÛ[Z\ÜÚ[ÛˆOH[Èˆˆˆİš[™Êš[\œË›X^ÛÛ[Z\ÜÚ[ÛŠKˆ™]ÛÜšÜÎˆÙ™™\•˜XÚÙ\”Ù[XİY™]ÛÜšÜÊš[\œÊKˆ˜”ÛXŞNˆÈ›Z[™‹›Ü[ˆ‹[šÛ›İÛˆ—Kš[˜ÛY\Ê˜”ÛXŞJHÈ˜”ÛXŞHˆ˜[‹ˆ™]™[YTİ]\Îˆš[\œËœ™]™[YTİ]\È˜[‹ˆ™]™[YTÛÜˆš[\œËœ™]™[YTÛÜœš[Üš]H‚ˆNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Š˜[YJHÂˆYˆ
˜[YHOH[İš[™Ê˜[YJKš[J
HOOHˆŠH™]\›ˆ[ÂˆÛÛœİ\œÙYH[X™\Šİš[™Ê˜[YJKœ™\XÙJÖÉ	WKÙËˆŠKœ™\XÙJËÙËˆŠKš[J
JNÂˆ™]\›ˆ[X™\‹š\Ñš[š]J\œÙY
HÈ\œÙYˆ[ÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]JÙ™™\ŠHÂˆÛÛœİ\œÙYHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\ŠÙ™™\ˆ	‰ˆÙ™™\‹˜Y™ÛÛ[Z\ÜÚ[Û”˜]JNÂˆ™]\›ˆ\œÙYOOH[Èˆ\œÙYÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”™]™[YJÙ™™\ŠHÂˆÛÛœİ\œÙYHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\ŠÙ™™\ˆ	‰ˆÙ™™\‹œØ[\Ğ[[İ[
NÂˆ™]\›ˆ\œÙYOOH[ÈˆX]›X^
\œÙY
NÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\[İ•\JÙ™™\ŠHÂˆÛÛœİ\HHİš[™Ê
Ù™™\ˆ	‰ˆÙ™™\‹˜[İ•\JHˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆYˆ
\HOOH˜XİX[ŠH™]\›ˆ˜XİX[ÂˆYˆ
È[]]™H‹™\İ[X]Y‹™\İ[X]H—Kš[˜ÛY\Ê\JJH™]\›ˆ™\İ[X]YÂˆ™]\›ˆ[˜]˜Z[X›HÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\[İ•\SX™[
Ù™™\‹[™İXYÙHHİ]K›[™İXYÙJHÂˆÛÛœİ\HHÙ™™\•˜XÚÙ\[İ•\JÙ™™\ŠNÂˆÛÛœİX™[ÈH[™İXYÙHOOHš‚ˆÈÈXİX[ˆ¹ç'ùk§ˆ‹\İ[X]Yˆºh¡9/,‹[˜]˜Z[X›Nˆ¹¥è9cëùå*9¥l9£kˆˆBˆˆÈXİX[ˆXİX[‹\İ[X]Yˆ‘\İ[X]Y‹[˜]˜Z[X›Nˆ•[˜]˜Z[X›HˆNÂˆ™]\›ˆX™[Öİ\WNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\[İÙ[[
Ù™™\ŠHÂˆÛÛœİ˜[YHHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\ŠÙ™™\ˆ	‰ˆÙ™™\‹˜[İŠNÂˆYˆ
˜[YHOOH[˜[YHH
HÂˆ™]\›ˆ	ÏÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹[[X™\‹XÙ[¸ %ÜÜ[‰ÎÂˆBˆÛÛœİ\HHÙ™™\•˜XÚÙ\[İ•\JÙ™™\ŠNÂˆÛÛœİX™[HÙ™™\•˜XÚÙ\[İ•\SX™[
Ù™™\ŠNÂˆÛÛœİØ[\PÛİ[H[X™\ŠÙ™™\ˆ	‰ˆÙ™™\‹˜[İ”Ø[\T›ÙXİÛİ[
HNÂˆÛÛœİÛİ\˜ÙQ]HHİš[™Ê
Ù™™\ˆ	‰ˆÙ™™\‹˜[İ”Ûİ\˜ÙQ]JHˆŠKš[J
NÂˆÛÛœİ\ØÜš\[ÛˆH\HOOH˜XİX[‚ˆÈÙ™™\•˜XÚÙ\•^
XİX[SÕˆ™]™[YH0íÈÜ™\ˆÛİ[‹¹ç'ùk§ˆSÕ»ï&”™]™[YH0íÈÜ™\ˆÛİ[ŠBˆˆ\HOOH™\İ[X]Y‚ˆÈÙ™™\•˜XÚÙ\•^
ˆ\İ[X]YSÕˆ	ÜØ[\PÛİ[K\›ÙXİ]™\˜YÙIÜÛİ\˜ÙQ]HÈ0­È	ÜÛİ\˜ÙQ]_XˆˆŸXˆ:h¡9/,SÕ»ï&‰ÜØ[\PÛİ[H9«/¹.©ùdàynlùgaù`/	ÜÛİ\˜ÙQ]HÈ0­È	ÜÛİ\˜ÙQ]_XˆˆŸXˆ
BˆˆÙ™™\•˜XÚÙ\•^
SÕˆÛİ\˜ÙH\È›İÜXÚYšYY‹SÕˆ9§iy®¤9§*¹¨!ù¦#ˆŠNÂˆ™]\›ˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹X[İ‹XÙ[ˆ]OH‰Ù\ØØ\R[
\ØÜš\[ÛŠ_Hˆ\šXK[X™[H‰Ù\ØØ\R[
\ØÜš\[ÛŠ_HÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹[[X™\‹XÙ[‰Ù\ØØ\R[
[Û™^J˜[YJJ_OÜÜ[ÛX[Û\ÜÏH›Ù™™\‹]˜XÚÙ\‹X[İ‹X˜YÙH	İ\_H‰Ù\ØØ\R[
X™[
_OÜÛX[ÜÜ[˜ÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\\Ú[œÊÙ™™\ŠHÂˆÛÛœİ˜[Y\ÈHÛÙ™™\ˆ	‰ˆÙ™™\‹Ü\Ú[œËÙ™™\ˆ	‰ˆÙ™™\‹œ›ÙXİ\Ú[œËÙ™™\ˆ	‰ˆÙ™™\‹˜\Ú[œÕ^Bˆ™›]X\

˜[YJHOˆ\œ˜^Kš\Ğ\œ˜^J˜[YJHÈ˜[YHˆİš[™Ê˜[YHˆŠKœÜ]
Öß××JËÊJNÂˆÛÛœİÙY[ˆH™]ÈÙ]

NÂˆ™]\›ˆ˜[Y\Ë›X\

˜[YJHOˆİš[™Ê˜[YHˆŠKš[J
KÕ\\Ø\ÙJ
JK™š[\Š
˜[YJHOˆÂˆYˆ
K×ŒĞKVŒNW^ÎIË\İ
˜[YJHÙY[‹š\Ê˜[YJJH™]\›ˆ˜[ÙNÂˆÙY[‹˜Y
˜[YJNÂˆ™]\›ˆYNÂˆJKœÛXÙJJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”ØÛÜ™JÙ™™\ŠHÂˆÛÛœİY\ˆHØ[›ÛšXØ[Y\“˜[YJÙ™™\ˆ	‰ˆÙ™™\‹Y\ŠNÂˆÛÛœİY\”Ú[ÈHY\ˆOOH•Y\ˆHˆÈˆY\ˆOOH•Y\ˆˆˆÈÈˆY\ˆOOH•Y\ˆÈˆÈˆˆY\ˆOOH•Y\ˆˆÈHˆÂˆÛÛœİÛÛ[Z\ÜÚ[ÛˆHÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]JÙ™™\ŠNÂˆÛÛœİÛÛ[Z\ÜÚ[Û”Ú[ÈHÛÛ[Z\ÜÚ[ÛˆHŒÈˆÛÛ[Z\ÜÚ[ÛˆHMHÈÈˆÛÛ[Z\ÜÚ[ÛˆHLÈˆˆÛÛ[Z\ÜÚ[ÛˆHHÈHˆÂˆÛÛœİ[İˆH[X™\ŠÙ™™\ˆ	‰ˆÙ™™\‹˜[İŠNÂˆÛÛœİ[İ”Ú[ÈH[İˆHÍH	‰ˆ[İˆHÍLÈˆˆ[İˆˆÍLÈHˆÂˆÛÛœİ\Ú[”Ú[ÈHÙ™™\•˜XÚÙ\\Ú[œÊÙ™™\ŠK›[™İÈHˆÂˆ™]\›ˆY\”Ú[È
ÈÛÛ[Z\ÜÚ[Û”Ú[È
È[İ”Ú[È
È\Ú[”Ú[ÎÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”š[Üš]JÙ™™\‹[\ÈHQUSÓÑ‘‘T—ÕPÒÑT—Ô•STÊHÂˆÛÛœİØÛÜ™HHÙ™™\•˜XÚÙ\”ØÛÜ™JÙ™™\ŠNÂˆÛÛœİ[İˆH[X™\ŠÙ™™\ˆ	‰ˆÙ™™\‹˜[İŠNÂˆYˆ
ØÛÜ™HH[X™\Š[\ËšYÚØÛÜ™JJH™]\›ˆÈÙ^NˆšYÚ‹ØÛÜ™KÜ™\ˆNÂˆYˆ
[İˆˆ	‰ˆ[İˆH[X™\Š[\Ë›İĞ[İ“X^
JH™]\›ˆÈÙ^Nˆ›İËX[İˆ‹ØÛÜ™KÜ™\ˆˆNÂˆ™]\›ˆÈÙ^Nˆœ™XÛÛ[Y[™Y‹ØÛÜ™KÜ™\ˆHNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”š[Üš]SX™[
Ù^K[™İXYÙHHİ]K›[™İXYÙJHÂˆÛÛœİX™[ÈHÂˆYÚˆ[™İXYÙHOOHšˆÈºjæ9/&9ab9î©ÈÙ™™\ˆˆˆ’YÚš[Üš]H‹ˆ™XÛÛ[Y[™Yˆ[™İXYÙHOOHšˆÈ¹£ª:#dÙ™™\ˆˆˆ”™XÛÛ[Y[™Y‹ˆ›İËX[İˆˆ[™İXYÙHOOHšˆÈ¹/cˆSÕˆ9/&:`"Hˆˆ“İËPSÕˆXÚÈ‚ˆNÂˆ™]\›ˆX™[ÖÚÙ^WHX™[Ëœ™XÛÛ[Y[™YÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠHÂˆ™]\›ˆİš[™Ê
Ù™™\ˆ	‰ˆ
Ù™™\‹›Y\˜Ú[˜[YHÙ™™\‹˜œ˜[™
JH•[›˜[YYY\˜Ú[ŠKš[J
NÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\˜”ÛXŞRÙ^JÙ™™\ŠHÂˆÛÛœİœ˜[™Ù^HH›Ü›X[^™JÙ™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠJNÂˆÛÛœİX]Ú\ÈH
Ù^\ÊHOˆ\œ˜^K™œ›ÛJÙ^\ÊKœÛÛYJ
Ù^JHO‚ˆœ˜[™Ù^HOOHÙ^Hœ˜[™Ù^Kœİ\ÕÚ]
Ù^JHœ˜[™Ù^K™[™ÕÚ]
Ù^JBˆ
NÂˆYˆ
X]Ú\ÊÑ‘‘T—ÕPÒÑT—Ğ—ÔÓPÖWÒÑVTË›Z[™
JH™]\›ˆ›Z[™ÂˆYˆ
X]Ú\ÊÑ‘‘T—ÕPÒÑT—Ğ—ÔÓPÖWÒÑVTË›Ü[ŠJH™]\›ˆ›Ü[ˆÂˆ™]\›ˆ[šÛ›İÛˆÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\˜”ÛXŞSX™[
Ù™™\‹[™İXYÙHHİ]K›[™İXYÙJHÂˆÛÛœİX™[ÈH[™İXYÙHOOHš‚ˆÈÈZ[™ˆ¹.âù¡#Èˆ‹Ü[ˆ¹.#y.âù¡#Èˆ‹[šÛ›İÛˆ¹§*¹çéHˆBˆˆÈZ[™ˆ“Z[™ˆ‹Ü[ˆ‘Ù\Û‰İZ[™ˆ‹[šÛ›İÛˆ•[šÛ›İÛˆˆNÂˆ™]\›ˆX™[ÖÛÙ™™\•˜XÚÙ\˜”ÛXŞRÙ^JÙ™™\ŠWNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\˜”ÛXŞPÙ[[
Ù™™\ŠHÂˆÛÛœİÙ^HHÙ™™\•˜XÚÙ\˜”ÛXŞRÙ^JÙ™™\ŠNÂˆ™]\›ˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹X˜‹X˜YÙH	ÚÙ^_H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\˜”ÛXŞSX™[
Ù™™\ŠJ_OÜÜ[˜ÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”™XÛÛ[Y[™][ÛŠ
HÂˆ™]\›ˆˆÂˆB‚ˆ[˜İ[Ûˆš[\“Ù™™\•˜XÚÙ\”›İÜÊÛİ\˜ÙT›İÜËš[\œÈHßKÙX\˜ÚHˆ‹[\ÈHQUSÓÑ‘‘T—ÕPÒÑT—Ô•STÊHÂˆÛÛœİZ[[İˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›Z[[İŠNÂˆÛÛœİX^[İˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›X^[İŠNÂˆÛÛœİZ[ÛÛ[Z\ÜÚ[ÛˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›Z[ÛÛ[Z\ÜÚ[ÛŠNÂˆÛÛœİX^ÛÛ[Z\ÜÚ[ÛˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›X^ÛÛ[Z\ÜÚ[ÛŠNÂˆÛÛœİÙ[XİYY\œÈHÙ™™\•˜XÚÙ\”Ù[XİYY\œÊš[\œÊNÂˆÛÛœİÙ[XİYØ]YÛÜšY\ÈHÙ™™\•˜XÚÙ\”Ù[XİYØ]YÛÜšY\Êš[\œÊNÂˆÛÛœİÙ[XİY™]ÛÜšÜÈHÙ™™\•˜XÚÙ\”Ù[XİY™]ÛÜšÜÊš[\œÊNÂˆÛÛœİ™\]Y\İY˜”ÛXŞHHİš[™Êš[\œË˜˜”ÛXŞH˜[ŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆÛÛœİÙ[XİY˜”ÛXŞHHÈ›Z[™‹›Ü[ˆ‹[šÛ›İÛˆ—Kš[˜ÛY\Ê™\]Y\İY˜”ÛXŞJHÈ™\]Y\İY˜”ÛXŞHˆ˜[ÂˆÛÛœİ]Y\HHİš[™ÊÙX\˜ÚˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆ™]\›ˆ
Ûİ\˜ÙT›İÜÈ×JK™š[\Š
Ù™™\ŠHOˆÂˆÛÛœİY\ˆHØ[›ÛšXØ[Y\“˜[YJÙ™™\‹Y\ŠNÂˆÛÛœİØ]YÛÜHH\Ü^PØ]YÛÜJÙ™™\ŠNÂˆÛÛœİ[İˆH[X™\ŠÙ™™\‹˜[İŠNÂˆÛÛœİÛÛ[Z\ÜÚ[ÛˆHÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]JÙ™™\ŠNÂˆÛÛœİ™]™[YHHÙ™™\•˜XÚÙ\”™]™[YJÙ™™\ŠNÂˆYˆ
Ù[XİYY\œË›[™İ	‰ˆ\Ù[XİYY\œËš[˜ÛY\ÊY\ŠJH™]\›ˆ˜[ÙNÂˆYˆ
Ù[XİYØ]YÛÜšY\Ë›[™İ	‰ˆ\Ù[XİYØ]YÛÜšY\Ëš[˜ÛY\ÊØ]YÛÜJJH™]\›ˆ˜[ÙNÂˆYˆ
Ù[XİY™]ÛÜšÜË›[™İ	‰ˆ\Ù[XİY™]ÛÜšÜËš[˜ÛY\Êİš[™ÊÙ™™\‹›™]ÛÜšÈˆŠJJH™]\›ˆ˜[ÙNÂˆYˆ
Ù[XİY˜”ÛXŞHOOH˜[ˆ	‰ˆÙ™™\•˜XÚÙ\˜”ÛXŞRÙ^JÙ™™\ŠHOOHÙ[XİY˜”ÛXŞJH™]\›ˆ˜[ÙNÂˆYˆ
Z[[İˆOOH[	‰ˆ[İˆZ[[İŠH™]\›ˆ˜[ÙNÂˆYˆ
X^[İˆOOH[	‰ˆ[İˆˆX^[İŠH™]\›ˆ˜[ÙNÂˆYˆ
Z[ÛÛ[Z\ÜÚ[ÛˆOOH[	‰ˆÛÛ[Z\ÜÚ[ÛˆZ[ÛÛ[Z\ÜÚ[ÛŠH™]\›ˆ˜[ÙNÂˆYˆ
X^ÛÛ[Z\ÜÚ[ÛˆOOH[	‰ˆÛÛ[Z\ÜÚ[ÛˆˆX^ÛÛ[Z\ÜÚ[ÛŠH™]\›ˆ˜[ÙNÂˆYˆ
š[\œËœ™]™[YTİ]\ÈOOHœÜÚ]]™Hˆ	‰ˆ™]™[YHH
H™]\›ˆ˜[ÙNÂˆYˆ
š[\œËœ™]™[YTİ]\ÈOOH››Û™Hˆ	‰ˆ™]™[YHˆ
H™]\›ˆ˜[ÙNÂˆYˆ
]Y\JHÂˆÛÛœİ^\İXÚÈHÛÙ™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠKÙ™™\‹˜œ˜[™Ù™™\‹›Y\˜Ú[YY\‹Ù™™\‹›™]ÛÜšËØ]YÛÜWBˆ™š[\Š›ÛÛX[ŠKš›Ú[ŠˆŠKÓİÙ\Ø\ÙJ
NÂˆYˆ
Z^\İXÚËš[˜ÛY\Ê]Y\JJH™]\›ˆ˜[ÙNÂˆBˆ™]\›ˆYNÂˆJKœÛÜ

KŠHOˆÂˆÛÛœİ™]™[YTÛÜHİš[™Êš[\œËœ™]™[YTÛÜœš[Üš]HŠNÂˆYˆ
™]™[YTÛÜOOHœ™]™[YKY\ØÈˆ™]™[YTÛÜOOHœ™]™[YKX\ØÈŠHÂˆÛÛœİ™]™[YQY™™\™[˜ÙHHÙ™™\•˜XÚÙ\”™]™[YJŠHHÙ™™\•˜XÚÙ\”™]™[YJJNÂˆYˆ
™]™[YQY™™\™[˜ÙJH™]\›ˆ™]™[YTÛÜOOHœ™]™[YKY\ØÈˆÈ™]™[YQY™™\™[˜ÙHˆ\™]™[YQY™™\™[˜ÙNÂˆBˆÛÛœİTš[Üš]HHÙ™™\•˜XÚÙ\”š[Üš]JK[\ÊNÂˆÛÛœİ”š[Üš]HHÙ™™\•˜XÚÙ\”š[Üš]J‹[\ÊNÂˆ™]\›ˆTš[Üš]K›Ü™\ˆH”š[Üš]K›Ü™\‚ˆ”š[Üš]KœØÛÜ™HHTš[Üš]KœØÛÜ™BˆÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]JŠHHÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]JJBˆ[X™\Š‹˜[İŠHH[X™\ŠK˜[İŠBˆÙ™™\•˜XÚÙ\“Y\˜Ú[˜[YJJK›ØØ[PÛÛ\\™JÙ™™\•˜XÚÙ\“Y\˜Ú[˜[YJŠJNÂˆJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\‘š[\™Y›İÜÊ
HÂˆ™]\›ˆš[\“Ù™™\•˜XÚÙ\”›İÜÊˆİ]K›Ù™™\“\İ˜XÚÙ\‹œÛİ\˜ÙT›İÜÈÙ™™\œËˆİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œËˆİ]K›Ù™™\“\İ˜XÚÙ\‹œÙX\˜Úˆİ]K›Ù™™\“\İ˜XÚÙ\‹œ[\Âˆ
NÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”›İÜĞ\™TÙ[XİY
Ûİ\˜ÙT›İÜËÙ[XİYÙ^\ÈHİ]K›Ù™™\“\İ˜XÚÙ\‹œÙ[XİYÙ^\ÊHÂˆÛÛœİ›İÜÈHÛİ\˜ÙT›İÜÈ×NÂˆ™]\›ˆ›İÜË›[™İˆ	‰ˆ›İÜË™]™\J
Ù™™\ŠHOˆÙ[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJJNÂˆB‚ˆ[˜İ[Ûˆ\]SÙ™™\•˜XÚÙ\”›İÔÙ[Xİ[ÛŠÛİ\˜ÙT›İÜËÙ[XİYÙ[XİYÙ^\ÈHİ]K›Ù™™\“\İ˜XÚÙ\‹œÙ[XİYÙ^\ÊHÂˆÛÛœİ™^Ù^\ÈH™]ÈÙ]
Ù[XİYÙ^\È×JNÂˆ
Ûİ\˜ÙT›İÜÈ×JK™›Ü‘XXÚ

Ù™™\ŠHOˆÂˆÛÛœİÙ^HHÙ™™\’Ù^JÙ™™\ŠNÂˆYˆ
Ù[XİY
H™^Ù^\Ë˜Y
Ù^JNÂˆ[ÙH™^Ù^\Ë™[]JÙ^JNÂˆJNÂˆ™]\›ˆ™^Ù^\ÎÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”Ù[Xİ[Û”İ[[X\JÛİ\˜ÙT›İÜËYÙT›İÜËÙ[XİYÙ^\ÈHİ]K›Ù™™\“\İ˜XÚÙ\‹œÙ[XİYÙ^\ÊHÂˆÛÛœİ›İÜÈHÛİ\˜ÙT›İÜÈ×NÂˆÛÛœİİ\œ™[YÙT›İÜÈHYÙT›İÜÈ×NÂˆÛÛœİÙ[XİYÛİ[H›İÜËœ™YXÙJˆ
Ûİ[Ù™™\ŠHOˆÛİ[
È
Ù[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJHÈHˆ
Kˆˆ
NÂˆ™]\›ˆÂˆÙ[XİYÛİ[ˆ[š[\™YÙ[XİYˆ›İÜË›[™İˆ	‰ˆÙ[XİYÛİ[OOH›İÜË›[™İˆ[YÙTÙ[XİYˆİ\œ™[YÙT›İÜË›[™İˆ	‰ˆİ\œ™[YÙT›İÜË™]™\J
Ù™™\ŠHOˆÙ[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJJBˆNÂˆB‚ˆ[˜İ[ÛˆŞ[˜ÓÙ™™\•˜XÚÙ\”Ù[Xİ[Û•ZJ
HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆÛÛœİ›İÜÈH\œ˜^Kš\Ğ\œ˜^J˜XÚÙ\‹œ™[™\™Y›İÜÊHÈ˜XÚÙ\‹œ™[™\™Y›İÜÈˆ[ÂˆYˆ
\›İÜÊHÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆ™]\›ÂˆBˆÛÛœİİ[YÙ\ÈHX]›X^
KX]˜ÙZ[
›İÜË›[™İÈ˜XÚÙ\‹œYÙTÚ^™JJNÂˆ˜XÚÙ\‹œYÙHHX]›Z[ŠX]›X^
K˜XÚÙ\‹œYÙJKİ[YÙ\ÊNÂˆÛÛœİİ\H
˜XÚÙ\‹œYÙHHJH
ˆ˜XÚÙ\‹œYÙTÚ^™NÂˆÛÛœİYÙT›İÜÈH›İÜËœÛXÙJİ\İ\
È˜XÚÙ\‹œYÙTÚ^™JNÂˆÛÛœİ[YÙTÙ[XİYHYÙT›İÜË›[™İˆ	‰ˆYÙT›İÜË™]™\J
Ù™™\ŠHOˆ˜XÚÙ\‹œÙ[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJJNÂˆÛÛœİÙ[XİYÛİ[H˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[ÂˆÛÛœİ[š[\™YÙ[XİYH›İÜË›[™İˆ	‰ˆÙ[XİYÛİ[OOH›İÜË›[™İÂ‚ˆYˆ
[Ë›Ù™™\•˜XÚÙ\•X›T›İÜÊHÂˆ[Ë›Ù™™\•˜XÚÙ\•X›T›İÜËœ]Y\TÙ[XİÜ[
–Ù]K[Ù™™\‹]˜XÚÙ\‹ZÙ^WHŠK™›Ü‘XXÚ

ÚXÚØ›Ş
HOˆÂˆÛÛœİÙ[XİYH˜XÚÙ\‹œÙ[XİYÙ^\Ëš\ÊÚXÚØ›Ş™]\Ù]›Ù™™\•˜XÚÙ\’Ù^HˆŠNÂˆÚXÚØ›Ş˜ÚXÚÙYHÙ[XİYÂˆÛÛœİ›İÈHÚXÚØ›Ş˜ÛÜÙ\İ
ˆŠNÂˆYˆ
›İÊH›İË˜Û\ÜÓ\İÙÙÛJš\Ë\Ù[XİY‹Ù[XİY
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\•X›RXY
HÂˆÛÛœİ[ÚXÚØ›ŞH[Ë›Ù™™\•˜XÚÙ\•X›RXYœ]Y\TÙ[XİÜŠ‹›Ù™™\‹]˜XÚÙ\‹\Ù[XİX[ŠNÂˆYˆ
[ÚXÚØ›Ş
H[ÚXÚØ›Ş˜ÚXÚÙYH[YÙTÙ[XİYÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[XİYÛİ[
H[Ë›Ù™™\•˜XÚÙ\”Ù[XİYÛİ[^ÛÛ[HÙ[XİYÛİ[ÓØØ[Tİš[™Ê
NÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜÙ[XİY
H[Ë›Ù™™\•˜XÚÙ\‘^ÜÙ[XİY™\ØX›YHÙ[XİYÛİ[OOHÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y
HÂˆÛÛœİXİ[Û“X™[H[š[\™YÙ[XİYˆÈÙ™™\•˜XÚÙ\•^
ÛX\ˆX]Ú[™ÈÙ[Xİ[Ûˆ‹¹®!zfi9c.zacz`"y¢êHŠBˆˆÙ™™\•˜XÚÙ\•^
”Ù[Xİ[X]Ú[™È‹º`"y¢êyaj:`ê9c.zacHŠNÂˆÛÛœİXİ[Û‘\ØÜš\[ÛˆH[š[\™YÙ[XİYˆÈÙ™™\•˜XÚÙ\•^
ˆÛX\ˆ[	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_HX]Ú[™ÈÙ™™\œÈXÜ›ÜÜÈ[YÙ\Øˆ9®!zfi:-ê9¢`9§"zhmzgh¹æ¡	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_H9.*¹c.zacHÙ™™\˜ˆ
BˆˆÙ™™\•˜XÚÙ\•^
ˆÙ[Xİ[	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_HX]Ú[™ÈÙ™™\œÈXÜ›ÜÜÈ[YÙ\Øˆ:-ê9¢`9§"zhmzghº`"y¢êyaj:`ê	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_H9.*¹c.zacHÙ™™\˜ˆ
NÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y™\ØX›YH›İÜË›[™İOOHÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YœÙ]]šX]J˜\šXK\™\ÜÙY‹[š[\™YÙ[XİYÈYHˆˆ™˜[ÙHŠNÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YœÙ]]šX]J˜\šXK[X™[‹Xİ[Û‘\ØÜš\[ÛŠNÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y]HHXİ[Û‘\ØÜš\[ÛÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YX™[
H[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YX™[^ÛÛ[HXİ[Û“X™[ÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YÛİ[
H[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YÛİ[^ÛÛ[H›İÜË›[™İÓØØ[Tİš[™Ê
NÂˆBˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\ÛÛ[[‘Yš[š][ÛœÊšY]ÈHİ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÊHÂˆÛÛœİX™[ÈHİ]K›[™İXYÙHOOHš‚ˆÈÈš[Üš]Nˆ¹/&9ab9î©È‹Y\˜Ú[ˆ¹ea¹k­ˆ‹Y\ˆ¹l`¹î©È‹ÛÛ[Z\ÜÚ[ÛˆQ‘ˆ9/húaäH‹[İˆSÕˆ‹™]™[YNˆ”™]™[YH‹˜”ÛXŞNˆ¹¦+ùd)¹.âù¡#Èˆ‹Ø]YÛÜNˆ¹dàyìnÈ‹\Ú[œÎˆ•Ü˜[šÈTÒSœÈ‹™XÛÛ[Y[™][Ûˆ¹£ª:#d9/èy kÈˆBˆˆÈš[Üš]Nˆ”š[Üš]H‹Y\˜Ú[ˆ“Y\˜Ú[‹Y\ˆ•Y\ˆ‹ÛÛ[Z\ÜÚ[ÛˆQ‘ˆÛÛ[Z\ÜÚ[Ûˆ‹[İˆSÕˆ‹™]™[YNˆ”™]™[YH‹˜”ÛXŞNˆˆ™Y™\™[˜ÙH‹Ø]YÛÜNˆØ]YÛÜH‹\Ú[œÎˆ•Ü˜[šÈTÒSœÈ‹™XÛÛ[Y[™][Ûˆ”™XÛÛ[Y[™][ÛˆˆNÂˆÛÛœİ[HÂˆÈÙ^Nˆœš[Üš]H‹X™[ˆX™[Ëœš[Üš]KX[™]ÜNˆYHKˆÈÙ^Nˆ›Y\˜Ú[‹X™[ˆX™[Ë›Y\˜Ú[X[™]ÜNˆYHKˆÈÙ^NˆY\ˆ‹X™[ˆX™[ËY\ˆKˆÈÙ^Nˆ˜ÛÛ[Z\ÜÚ[Ûˆ‹X™[ˆX™[Ë˜ÛÛ[Z\ÜÚ[ÛˆKˆÈÙ^Nˆ˜[İˆ‹X™[ˆX™[Ë˜[İˆKˆÈÙ^Nˆœ™]™[YH‹X™[ˆX™[Ëœ™]™[YHKˆÈÙ^Nˆ˜˜”ÛXŞH‹X™[ˆX™[Ë˜˜”ÛXŞHKˆÈÙ^Nˆ˜Ø]YÛÜH‹X™[ˆX™[Ë˜Ø]YÛÜHKˆÈÙ^Nˆ˜\Ú[œÈ‹X™[ˆX™[Ë˜\Ú[œÈKˆÈÙ^Nˆœ™XÛÛ[Y[™][Ûˆ‹X™[ˆX™[Ëœ™XÛÛ[Y[™][ÛˆBˆNÂˆÛÛœİ[İÙYHšY]ÈOOHœ›ÙXİÈ‚ˆÈ™]ÈÙ]
Èœš[Üš]H‹›Y\˜Ú[‹˜[İˆ‹œ™]™[YH‹˜˜”ÛXŞH‹˜Ø]YÛÜH‹˜\Ú[œÈ—JBˆˆ™]ÈÙ]
[›X\

ÛÛ[[ŠHOˆÛÛ[[‹šÙ^JJNÂˆ™]\›ˆ[™š[\Š
ÛÛ[[ŠHOˆ[İÙYš\ÊÛÛ[[‹šÙ^JH	‰ˆ
ÛÛ[[‹›X[™]ÜHİ]K›Ù™™\“\İ˜XÚÙ\‹š\ÚX›PÛÛ[[œÖØÛÛ[[‹šÙ^WHOOH˜[ÙJJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\Ù[[
Ù™™\‹ÛÛ[[ŠHÂˆÛÛœİš[Üš]HHÙ™™\•˜XÚÙ\”š[Üš]JÙ™™\‹İ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ÊNÂˆYˆ
ÛÛ[[‹šÙ^HOOHœš[Üš]HŠHÂˆÛÛœİÚXÚÙYHİ]K›Ù™™\“\İ˜XÚÙ\‹œÙ[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJNÂˆ™]\›ˆ]ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹\š[Üš]KXÙ[[œ]Û\ÜÏH›Ù™™\‹]˜XÚÙ\‹\›İË\Ù[Xİˆ\OH˜ÚXÚØ›Şˆ]K[Ù™™\‹]˜XÚÙ\‹ZÙ^OH‰Ù\ØØ\R[
Ù™™\’Ù^JÙ™™\ŠJ_Hˆ	ØÚXÚÙYÈ˜ÚXÚÙYˆˆˆŸH\šXK[X™[H”Ù[Xİ	Ù\ØØ\R[
Ù™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠJ_H‹ÏÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹\š[Üš]KX˜YÙH	Üš[Üš]KšÙ^_H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\”š[Üš]SX™[
š[Üš]KšÙ^JJ_OÜÜ[Ù]˜ÂˆBˆYˆ
ÛÛ[[‹šÙ^HOOH›Y\˜Ú[ŠHÂˆ™]\›ˆ]ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹[Y\˜Ú[XÙ[İ›Û™È]OH‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠJ_H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠJ_OÜİ›Û™ÏÜ[’Q	Ù\ØØ\R[
Ù™™\‹›Y\˜Ú[Y¸ %Š_OÜÜ[Ù]˜ÂˆBˆYˆ
ÛÛ[[‹šÙ^HOOHY\ˆŠH™]\›ˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹]Y\‹X˜YÙH‰Ù\ØØ\R[
Ø[›ÛšXØ[Y\“˜[YJÙ™™\‹Y\ŠH•[šÛ›İÛˆŠ_OÜÜ[˜ÂˆYˆ
ÛÛ[[‹šÙ^HOOH˜ÛÛ[Z\ÜÚ[ÛˆŠH™]\›ˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹[[X™\‹XÙ[‰Ù\ØØ\R[
	ÛÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]JÙ™™\ŠKÑš^Y
ŠKœ™\XÙJ×Œ	ËˆŠ_IX
_OÜÜ[˜ÂˆYˆ
ÛÛ[[‹šÙ^HOOH˜[İˆŠH™]\›ˆÙ™™\•˜XÚÙ\[İÙ[[
Ù™™\ŠNÂˆYˆ
ÛÛ[[‹šÙ^HOOHœ™]™[YHŠH™]\›ˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹[[X™\‹XÙ[‰Ù\ØØ\R[
[Û™^JÙ™™\•˜XÚÙ\”™]™[YJÙ™™\ŠJJ_OÜÜ[˜ÂˆYˆ
ÛÛ[[‹šÙ^HOOH˜˜”ÛXŞHŠH™]\›ˆÙ™™\•˜XÚÙ\˜”ÛXŞPÙ[[
Ù™™\ŠNÂˆYˆ
ÛÛ[[‹šÙ^HOOH˜Ø]YÛÜHŠH™]\›ˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹XØ]YÛÜKXÙ[‰Ù\ØØ\R[
\Ü^PØ]YÛÜJÙ™™\ŠJ_OÜÜ[˜ÂˆYˆ
ÛÛ[[‹šÙ^HOOH˜\Ú[œÈŠHÂˆÛÛœİ\Ú[œÈHÙ™™\•˜XÚÙ\\Ú[œÊÙ™™\ŠNÂˆ™]\›ˆ\Ú[œË›[™İÈ]ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹X\Ú[œÈ‰Ø\Ú[œË›X\

\Ú[ŠHOˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹X\Ú[ˆ‰Ù\ØØ\R[
\Ú[Š_OÜÜ[˜
Kš›Ú[ŠˆŠ_OÙ]˜ˆ¸ %ÂˆBˆYˆ
ÛÛ[[‹šÙ^HOOHœ™XÛÛ[Y[™][ÛˆŠH™]\›ˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹\™XÛÛ[Y[™][Û‹XÙ[‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\”™XÛÛ[Y[™][ÛŠÙ™™\‹š[Üš]JJ_OÜÜ[˜Âˆ™]\›ˆˆÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\“Ù™™\‘^ÜÛÛ[[œÊ
HÂˆ™]\›ˆÂˆÈ”š[Üš]H‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\”š[Üš]SX™[
Ù™™\•˜XÚÙ\”š[Üš]JÙ™™\‹İ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ÊKšÙ^K™[ˆŠKŒ—KˆÈ“Y\˜Ú[Q‹
Ù™™\ŠHOˆÙ™™\‹›Y\˜Ú[Yˆ‹M—KˆÈ“Y\˜Ú[˜[YH‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠKKˆÈ•Y\ˆ‹
Ù™™\ŠHOˆØ[›ÛšXØ[Y\“˜[YJÙ™™\‹Y\ŠH•[šÛ›İÛˆ‹MKˆÈQ‘ˆÛÛ[Z\ÜÚ[Ûˆ‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]JÙ™™\ŠKM‹œ\˜Ù[YÙH—KˆÈSÕˆ‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\ŠÙ™™\‹˜[İŠKMKˆÈ”™]™[YH‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\”™]™[YJÙ™™\ŠKM—KˆÈSÕˆ\H‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\[İ•\SX™[
Ù™™\‹™[ˆŠKMKˆÈˆ™Y™\™[˜ÙH‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\˜”ÛXŞSX™[
Ù™™\‹™[ˆŠKNKˆÈØ]YÛÜH‹
Ù™™\ŠHOˆ\Ü^PØ]YÛÜJÙ™™\ŠKÍKˆÈ”™XÛÛ[Y[™][Ûˆ‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\”™XÛÛ[Y[™][ÛŠÙ™™\‹Ù™™\•˜XÚÙ\”š[Üš]JÙ™™\‹İ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ÊJKMBˆNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\”›ÙXİ^ÜÛÛ[[œÊ
HÂˆ™]\›ˆÂˆÈ”š[Üš]H‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\”š[Üš]SX™[
Ù™™\•˜XÚÙ\”š[Üš]JÙ™™\‹İ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ÊKšÙ^K™[ˆŠKŒ—KˆÈ“Y\˜Ú[Q‹
Ù™™\ŠHOˆÙ™™\‹›Y\˜Ú[Yˆ‹M—KˆÈ“Y\˜Ú[˜[YH‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\“Y\˜Ú[˜[YJÙ™™\ŠKKˆÈSÕˆ‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\ŠÙ™™\‹˜[İŠKMKˆÈ”™]™[YH‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\”™]™[YJÙ™™\ŠKM—KˆÈSÕˆ\H‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\[İ•\SX™[
Ù™™\‹™[ˆŠKMKˆÈˆ™Y™\™[˜ÙH‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\˜”ÛXŞSX™[
Ù™™\‹™[ˆŠKNKˆÈØ]YÛÜH‹
Ù™™\ŠHOˆ\Ü^PØ]YÛÜJÙ™™\ŠKÍKˆÈ•Ü˜[šÈTÒSœÈ‹
Ù™™\ŠHOˆÙ™™\•˜XÚÙ\\Ú[œÊÙ™™\ŠKš›Ú[Š‹ŠK—BˆNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\•Y\Ûİ[Ê›İÜÊHÂˆ™]\›ˆÑ‘‘T—ÕPÒÑT—ÑVÔ•ÕQT”Ëœ™YXÙJ
™\İ[Y\ŠHOˆÂˆ™\İ[İY\—HH›İÜË™š[\Š
Ù™™\ŠHOˆØ[›ÛšXØ[Y\“˜[YJÙ™™\‹Y\ŠHOOHY\ŠK›[™İÂˆ™]\›ˆ™\İ[ÂˆKßJNÂˆB‚ˆ[˜İ[Ûˆ›Ü›X[^™SÙ™™\•˜XÚÙ\•Y\”]X[]J˜[YK]˜Z[X›JHÂˆÛÛœİ\œÙYHX]™›ÛÜŠ[X™\Š˜[YJJNÂˆ™]\›ˆX]›Z[ŠX]›X^
\œÙY
KX]›X^
]˜Z[X›JJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\‘^Ü›İÜÊÛİ\˜ÙT›İÜËY\”]X[]Y\ÊHÂˆÛÛœİÛİ[ÈHÙ™™\•˜XÚÙ\•Y\Ûİ[ÊÛİ\˜ÙT›İÜÈ×JNÂˆ™]\›ˆÑ‘‘T—ÕPÒÑT—ÑVÔ•ÕQT”Ë™›]X\

Y\ŠHOˆÂˆÛÛœİÛÛ™šYÈHY\”]X[]Y\È	‰ˆY\”]X[]Y\ÖİY\—NÂˆYˆ
XÛÛ™šYÈXÛÛ™šYË™[˜X›Y
H™]\›ˆ×NÂˆÛÛœİ]X[]HH›Ü›X[^™SÙ™™\•˜XÚÙ\•Y\”]X[]JÛÛ™šYËœ]X[]KÛİ[ÖİY\—JNÂˆ™]\›ˆ
Ûİ\˜ÙT›İÜÈ×JBˆ™š[\Š
Ù™™\ŠHOˆØ[›ÛšXØ[Y\“˜[YJÙ™™\‹Y\ŠHOOHY\ŠBˆœÛXÙJ]X[]JNÂˆJNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\‘^ÜY\”Ü[œÊÛİ\˜ÙT›İÜËY\”]X[]Y\ÊHÂˆÛÛœİÛİ[ÈHÙ™™\•˜XÚÙ\•Y\Ûİ[ÊÛİ\˜ÙT›İÜÈ×JNÂˆ]İ\HNÂˆ™]\›ˆÑ‘‘T—ÕPÒÑT—ÑVÔ•ÕQT”Ëœ™YXÙJ
™\İ[Y\ŠHOˆÂˆÛÛœİÛÛ™šYÈHY\”]X[]Y\È	‰ˆY\”]X[]Y\ÖİY\—NÂˆÛÛœİ]X[]HHÛÛ™šYÈ	‰ˆÛÛ™šYË™[˜X›YˆÈ›Ü›X[^™SÙ™™\•˜XÚÙ\•Y\”]X[]JÛÛ™šYËœ]X[]KÛİ[ÖİY\—JBˆˆÂˆ™\İ[İY\—HH]X[]HˆÈÈİ\[™ˆİ\
È]X[]HHK]X[]HHˆ[Âˆİ\
ÏH]X[]NÂˆ™]\›ˆ™\İ[ÂˆKßJNÂˆB‚ˆ[˜İ[Ûˆ›Ü›X[^™SÙ™™\•˜XÚÙ\‘^ÜÛÛÜŠ˜[YJHÂˆÛÛœİÛÛÜˆHİš[™Ê˜[YHˆŠKš[J
KÕ\\Ø\ÙJ
NÂˆ™]\›ˆ×ˆÖÌNPKQ—^ÍŸIË\İ
ÛÛÜŠHÈÛÛÜˆˆˆÂˆB‚ˆ[˜İ[Ûˆ˜[Y]SÙ™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ê˜[™Ù\Ëİ[›İÜÊHÂˆÛÛœİ›Ü›X[^™YH×NÂˆ›Üˆ
ÛÛœİ˜[™ÙHÙˆ˜[™Ù\È×JHÂˆÛÛœİİ\HX]™›ÛÜŠ[X™\Š˜[™ÙKœİ\
JNÂˆÛÛœİ[™HX]™›ÛÜŠ[X™\Š˜[™ÙK™[™
JNÂˆÛÛœİÛÛÜˆH›Ü›X[^™SÙ™™\•˜XÚÙ\‘^ÜÛÛÜŠ˜[™ÙK˜ÛÛÜŠNÂˆYˆ
\İ\Y[™İ\Hİ\ˆ[™[™ˆİ[›İÜÊHÂˆ™]\›ˆÂˆÚÎˆ˜[ÙKˆY\ÜØYÙNˆÙ™™\•˜XÚÙ\•^
ˆYÚYÚ›İÜÈ]\İİ^H™]ÙY[ˆH[™	İİ[›İÜßKÚ]Hİ\™Y›Ü™HH[™˜ˆ:jæ9.«º(c9oázhnù/cy.£ˆx $Éİİ[›İÜßH9.búeí;ï#9.%:-mùiâú(c9.#z ïyi)ù.£¹îäù§gú(c8à ˜ˆ
BˆNÂˆBˆYˆ
XÛÛÜŠHÂˆ™]\›ˆÈÚÎˆ˜[ÙKY\ÜØYÙNˆÙ™™\•˜XÚÙ\•^
ÚÛÜÙHH˜[YYÚYÚÛÛÜ‹ˆ‹º+íú`"y¢êy§"y¥b9æ¡:jæ9.«ºh§:"l¸à ˆŠHNÂˆBˆ›Ü›X[^™Yœ\Ú
Èİ\[™ÛÛÜˆJNÂˆBˆÛÛœİÜ™\™YH›Ü›X[^™YœÛXÙJ
KœÛÜ

KŠHOˆKœİ\H‹œİ\K™[™H‹™[™
NÂˆ›Üˆ
][™^HNÈ[™^Ü™\™Y›[™İÈ[™^
ÏHJHÂˆYˆ
Ü™\™YÚ[™^Kœİ\HÜ™\™YÚ[™^HWK™[™
HÂˆ™]\›ˆÈÚÎˆ˜[ÙKY\ÜØYÙNˆÙ™™\•˜XÚÙ\•^
’YÚYÚ˜[™Ù\ÈØ[››İİ™\›\ˆ‹ºjæ9.«º(c9c.ºeí9.#z ïzaãycè8à ˆŠHNÂˆBˆBˆ™]\›ˆÈÚÎˆYK˜[™Ù\Îˆ›Ü›X[^™YNÂˆB‚ˆ[˜İ[ÛˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJY\ÜØYÙHHˆŠHÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJH™]\›Âˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙK^ÛÛ[HY\ÜØYÙNÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[Y\ÜØYÙJNÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\‘^Ü™]šY]Ê
HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆÛÛœİİ]]›İÜÈHÙ™™\•˜XÚÙ\‘^Ü›İÜÊ˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜË˜XÚÙ\‹™^ÜY\”]X[]Y\ÊNÂˆÛÛœİÜ[œÈHÙ™™\•˜XÚÙ\‘^ÜY\”Ü[œÊ˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜË˜XÚÙ\‹™^ÜY\”]X[]Y\ÊNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^Ü›İÜÔ™]šY]ÊHÂˆ[Ë›Ù™™\•˜XÚÙ\‘^Ü›İÜÔ™]šY]Ë^ÛÛ[HÙ™™\•˜XÚÙ\•^
ˆ	Ûİ]]›İÜË›[™İÓØØ[Tİš[™Ê
_Hİ]]›İÜØˆ:/¤ùaîˆ	Ûİ]]›İÜË›[™İÓØØ[Tİš[™Ê
_H:(cˆ
NÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜY\œÊHÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜY\œËœ]Y\TÙ[XİÜ[
–Ù]K[Ù™™\‹]˜XÚÙ\‹]Y\‹\Ü[—HŠK™›Ü‘XXÚ

[[Y[
HOˆÂˆÛÛœİÜ[ˆHÜ[œÖÙ[[Y[™]\Ù]›Ù™™\•˜XÚÙ\•Y\”Ü[—NÂˆ[[Y[^ÛÛ[HÜ[‚ˆÈÙ™™\•˜XÚÙ\•^
İ]]›İÜÈ	ÜÜ[‹œİ\x $ÉÜÜ[‹™[™X:/¤ùaî¹ë+	ÜÜ[‹œİ\x $ÉÜÜ[‹™[™H:(c
BˆˆÙ™™\•˜XÚÙ\•^
“›İ[˜ÛYY‹¹.#z/¤ùaîˆŠNÂˆJNÂˆBˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\‘^ÜY\œÊ
HÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\‘^ÜY\œÊH™]\›ÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆÛÛœİÛİ[ÈHÙ™™\•˜XÚÙ\•Y\Ûİ[Ê˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜÊNÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜY\œËš[›™\’SHÑ‘‘T—ÕPÒÑT—ÑVÔ•ÕQT”Ë›X\

Y\ŠHOˆÂˆÛÛœİÛÛ™šYÈH˜XÚÙ\‹™^ÜY\”]X[]Y\ÖİY\—HÈ[˜X›Yˆ˜[ÙK]X[]NˆNÂˆÛÛœİ]˜Z[X›HHÛİ[ÖİY\—NÂˆÛÛœİ\ØX›YH]˜Z[X›HOOHÂˆ™]\›ˆ\XÛHÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹Y^Ü]Y\‹\›İÈ	ØÛÛ™šYË™[˜X›Y	‰ˆY\ØX›YÈˆˆˆš\ËY\ØX›YŸHˆ]K[Ù™™\‹]˜XÚÙ\‹]Y\‹\›İÏH‰Ù\ØØ\R[
Y\Š_H‚ˆ[œ]\OH˜ÚXÚØ›Şˆ]K[Ù™™\‹]˜XÚÙ\‹]Y\‹]ÙÙÛOH‰Ù\ØØ\R[
Y\Š_Hˆ	ØÛÛ™šYË™[˜X›Y	‰ˆY\ØX›YÈ˜ÚXÚÙYˆˆˆŸH	Ù\ØX›YÈ™\ØX›YˆˆˆŸH\šXK[X™[H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
[˜ÛYH	İY\ŸX9c!yd*È	İY\ŸX
J_H‹Ï‚ˆİ›Û™Ï‰Ù\ØØ\R[
Y\Š_OÜİ›Û™Ï‚ˆÛX[]K[Ù™™\‹]˜XÚÙ\‹]Y\‹\Ü[H‰Ù\ØØ\R[
Y\Š_HÜÛX[‚ˆX™[Ü[‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
Ùˆ	Ø]˜Z[X›_X9alH	Ø]˜Z[X›_H9.*˜
J_OÜÜ[[œ]\OH›[X™\ˆˆZ[HŒˆX^H‰Ø]˜Z[X›_Hˆİ\HŒHˆ˜[YOH‰Û›Ü›X[^™SÙ™™\•˜XÚÙ\•Y\”]X[]JÛÛ™šYËœ]X[]K]˜Z[X›J_Hˆ]K[Ù™™\‹]˜XÚÙ\‹]Y\‹\]X[]OH‰Ù\ØØ\R[
Y\Š_Hˆ	ØÛÛ™šYË™[˜X›Y	‰ˆY\ØX›YÈˆˆˆ™\ØX›YŸKÏÛX™[‚ˆØ\XÛO˜ÂˆJKš›Ú[ŠˆŠNÂˆ™[™\“Ù™™\•˜XÚÙ\‘^Ü™]šY]Ê
NÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ê
HÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\ÊH™]\›ÂˆÛÛœİ˜[™Ù\ÈHİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\ÎÂˆ[Ë›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ëš[›™\’SH˜[™Ù\Ë›[™İˆÈ˜[™Ù\Ë›X\

˜[™ÙJHOˆ\XÛHÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™\˜[™ÙHˆ]K[Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™ZYH‰Ü˜[™ÙKšYH‚ˆX™[Ü[‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
”İ\]H›İÈ‹º-mùiâù¥l9£kº(cŠJ_OÜÜ[[œ]\OH›[X™\ˆˆZ[HŒHˆİ\HŒHˆ˜[YOH‰Ù\ØØ\R[
˜[™ÙKœİ\
_Hˆ]K[Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™\İ\H‰Ü˜[™ÙKšYH‹ÏÛX™[‚ˆX™[Ü[‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
‘[™]H›İÈ‹¹îäù§gù¥l9£kº(cŠJ_OÜÜ[[œ]\OH›[X™\ˆˆZ[HŒHˆİ\HŒHˆ˜[YOH‰Ù\ØØ\R[
˜[™ÙK™[™
_Hˆ]K[Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™Y[™H‰Ü˜[™ÙKšYH‹ÏÛX™[‚ˆX™[Ü[‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
˜XÚÙÜ›İ[™ÛÛÜˆ‹º ã9¦kúh§:"lˆŠJ_OÜÜ[Ü[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™XÛÛÜˆ[œ]\OH˜ÛÛÜˆˆ˜[YOH‰Ù\ØØ\R[
˜[™ÙK˜ÛÛÜŠ_Hˆ]K[Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™XÛÛÜH‰Ü˜[™ÙKšYH‹Ïİ]]‰Ù\ØØ\R[
˜[™ÙK˜ÛÛÜŠ_OÛİ]]ÜÜ[ÛX™[‚ˆ]Ûˆ\OH˜]Ûˆˆ]K[Ù™™\‹]˜XÚÙ\‹\™[[İ™KX˜XÚÙÜ›İ[™H‰Ü˜[™ÙKšYHˆ\šXK[X™[H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
”™[[İ™HYÚYÚ˜[™ÙH‹¹éîúfi:jæ9.«¹c.ºeíŠJ_H°åÏØ]Û‚ˆØ\XÛO˜
Kš›Ú[ŠˆŠBˆˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™Y[\H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
“›È›İÈYÚYÚËˆYH˜[™ÙHÚ[ˆ[İHØ[ÈÛÛÜ‹XÛÙH]™[È[ˆHÛÜšØ›ÛÚËˆ‹¹¦ ¹§*º+¯¹ïkº(c:jæ9.«»ï&úg :) yg*9méy/g9ì/ù.+yc.¹b!¹ëbyî©ù¥í»ï#:+íù­îùb¨9c.ºeí8à ˆŠJ_OÜ˜ÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\‘^ÜX[ÙÊ
HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÊH™]\›Âˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙË˜Û\ÜÓ\İÙÙÛJšY[ˆ‹]˜XÚÙ\‹™^ÜX[ÙÓÜ[ŠNÂˆYˆ
]˜XÚÙ\‹™^ÜX[ÙÓÜ[ŠH™]\›ÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜØÛÜJHÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜØÛÜK^ÛÛ[H˜XÚÙ\‹™^ÜÙ[XİYÛ›BˆÈÙ™™\•˜XÚÙ\•^
ÛÛ™šYİ\™HHÙ[XİYÙ™™\œÈ™Y›Ü™H^Üˆ‹ºacyïk¹mìº`"HÙ™™\ˆ9æ¡9d!Y\ˆ:/¤ùaî¹¥l:aãù.#º ã9¦kú"l¸à ˆŠBˆˆÙ™™\•˜XÚÙ\•^
ÛÛ™šYİ\™HHš[\™YÙ™™\œÈ™Y›Ü™H^Üˆ‹ºacyïk¹ëfú`"yîäù§§9æ¡9d!Y\ˆ:/¤ùaî¹¥l:aãù.#º ã9¦kú"l¸à ˆŠNÂˆBˆ™[™\“Ù™™\•˜XÚÙ\‘^ÜY\œÊ
NÂˆ™[™\“Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ê
NÂˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJˆŠNÂˆB‚ˆ[˜İ[ÛˆÜ[“Ù™™\•˜XÚÙ\‘^ÜX[ÙÊÙ[XİYÛ›HH˜[ÙKšYÙÙ\‘[[Y[H[
HÂˆÛÛœİš[\™Y›İÜÈHÙ™™\•˜XÚÙ\‘š[\™Y›İÜÊ
NÂˆÛÛœİÛİ\˜ÙT›İÜÈHÙ[XİYÛ›BˆÈš[\™Y›İÜË™š[\Š
Ù™™\ŠHOˆİ]K›Ù™™\“\İ˜XÚÙ\‹œÙ[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJJBˆˆš[\™Y›İÜÎÂˆYˆ
\Ûİ\˜ÙT›İÜË›[™İ
HÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJÙ™™\•˜XÚÙ\•^
“›ÈX]Ú[™ÈÙ™™\œÈ\™H]˜Z[X›HÈ^Üˆ‹¹odùbcy¬¨y§"ycëùkï9aî¹æ¡9c.zacHÙ™™\¸à ˆŠJNÂˆ™]\›ÂˆBˆÛÛœİÛİ[ÈHÙ™™\•˜XÚÙ\•Y\Ûİ[ÊÛİ\˜ÙT›İÜÊNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜÙ[XİYÛ›HHÙ[XİYÛ›NÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜÈHÛİ\˜ÙT›İÜÎÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜY\”]X[]Y\ÈHÑ‘‘T—ÕPÒÑT—ÑVÔ•ÕQT”Ëœ™YXÙJ
™\İ[Y\ŠHOˆÂˆ™\İ[İY\—HHÈ[˜X›YˆÛİ[ÖİY\—Hˆ]X[]NˆÛİ[ÖİY\—HNÂˆ™]\›ˆ™\İ[ÂˆKßJNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\ÈH×NÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜX[ÙÓÜ[ˆHYNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü™\İÜ™Q›Øİ\ÈHšYÙÙ\‘[[Y[Âˆ™[™\“Ù™™\•˜XÚÙ\‘^ÜX[ÙÊ
NÂˆÛÛœİš\œİ[œ]H[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙËœ]Y\TÙ[XİÜŠš[œ]››İ
Ù\ØX›YJHŠNÂˆYˆ
š\œİ[œ]
Hš\œİ[œ]™›Øİ\Ê
NÂˆB‚ˆ[˜İ[ÛˆÛÜÙSÙ™™\•˜XÚÙ\‘^ÜX[ÙÊ
HÂˆÛÛœİ™\İÜ™Q›Øİ\ÈHİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü™\İÜ™Q›Øİ\ÎÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜX[ÙÓÜ[ˆH˜[ÙNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü™\İÜ™Q›Øİ\ÈH[Âˆ™[™\“Ù™™\•˜XÚÙ\‘^ÜX[ÙÊ
NÂˆYˆ
™\İÜ™Q›Øİ\È	‰ˆ\[Ùˆ™\İÜ™Q›Øİ\Ë™›Øİ\ÈOOH™[˜İ[ÛˆŠH™\İÜ™Q›Øİ\Ë™›Øİ\Ê
NÂˆB‚ˆ[˜İ[ÛˆYÙ™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™ÙJ
HÂˆÛÛœİİ[›İÜÈHÙ™™\•˜XÚÙ\‘^Ü›İÜÊˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜËˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜY\”]X[]Y\Âˆ
K›[™İÂˆYˆ
]İ[›İÜÊHÂˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJÙ™™\•˜XÚÙ\•^
”Ù[Xİ]X\İÛ™HY\ˆ[™]X[]Hš\œİˆ‹º+íùab:`"y¢êz!ìùl$y. 9.*ˆY\ˆ9nmº+¯¹ïkº/¤ùaî¹¥l:aãøà ˆŠJNÂˆ™]\›ÂˆBˆÛÛœİ[™^Hİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\Ë›[™İÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜[™ÙTÙ\]Y[˜ÙH
ÏHNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\Ëœ\Ú
ÂˆYˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜[™ÙTÙ\]Y[˜ÙKˆİ\ˆKˆ[™ˆİ[›İÜËˆÛÛÜˆÑ‘‘T—ÕPÒÑT—ÑVÔ•ĞÓÓÔ”ÖÚ[™^	HÑ‘‘T—ÕPÒÑT—ÑVÔ•ĞÓÓÔ”Ë›[™İBˆJNÂˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJˆŠNÂˆ™[™\“Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ê
NÂˆB‚ˆ[˜İ[ÛˆÛÛ™š\›SÙ™™\•˜XÚÙ\‘^Ü

HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆÛÛœİ›İÜÈHÙ™™\•˜XÚÙ\‘^Ü›İÜÊ˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜË˜XÚÙ\‹™^ÜY\”]X[]Y\ÊNÂˆYˆ
\›İÜË›[™İ
HÂˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJÙ™™\•˜XÚÙ\•^
”Ù[Xİ]X\İÛ™HY\ˆÚ][ˆİ]]]X[]HX›İ™H™\›Ëˆ‹º+íú!ìùl$z`"y¢êy. 9.*ˆY\»ï#9nm¹l!º/¤ùaî¹¥l:aãú+¯¹..¹i)ù.£ˆ8à ˆŠJNÂˆ™]\›ÂˆBˆÛÛœİ˜[Y][ÛˆH˜[Y]SÙ™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ê˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\Ë›İÜË›[™İ
NÂˆYˆ
]˜[Y][Û‹›ÚÊHÂˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJ˜[Y][Û‹›Y\ÜØYÙJNÂˆ™]\›ÂˆBˆÛÛœİÙ™™\ÛÛ[[œÈHÙ™™\•˜XÚÙ\“Ù™™\‘^ÜÛÛ[[œÊ
NÂˆÛÛœİ›ÙXİÛÛ[[œÈHÙ™™\•˜XÚÙ\”›ÙXİ^ÜÛÛ[[œÊ
NÂˆÛÛœİÛÜšØ›ÛÚÈHÜ™X]T™XÛÛ[Y[™][Û•ÛÜšØ›ÛÚÊ›İÜËÂˆ™Y™\™[˜ÙTİ[NˆYKˆ›İĞ˜XÚÙÜ›İ[™˜[™Ù\Îˆ˜[Y][Û‹œ˜[™Ù\ËˆÚY]ÎˆÂˆÈÚY]˜[YNˆ“\İÙˆÙ™™\œÈ‹›İÜËÛÛ[[œÎˆÙ™™\ÛÛ[[œÈKˆÈÚY]˜[YNˆœ˜[™›ÙXİ\İ‹›İÜËÛÛ[[œÎˆ›ÙXİÛÛ[[œÈBˆBˆJNÂˆÛÛœİØÛÜHH˜XÚÙ\‹™^ÜÙ[XİYÛ›HÈœÙ[XİYˆˆ™š[\™YÂˆšYÙÙ\•ÛÜšØ›ÛÚÑİÛ›ØY
ÛÜšØ›ÛÚËTĞ[X^›Û—ÓÙ™™\—Ó\İÕ˜XÚÙ\—ÉÜØÛÜ_WÉÜ›İÜË›[™İWÉİÙ^Qš[Tİ[\

_KŞ
NÂˆÛÜÙSÙ™™\•˜XÚÙ\‘^ÜX[ÙÊ
NÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJÙ™™\•˜XÚÙ\•^
ˆ^ÜY	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_HÙ™™\œÈ[ˆÛÈÛÜšÜÚY]Ë˜ˆ9mì¹kï9aîˆ	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_H9.*ˆÙ™™\»ï#9aly.)9.*¹méy/g:(j8à ˜ˆ
JNÂˆB‚ˆ[˜İ[ÛˆÙ]Ù™™\•˜XÚÙ\“›İXÙJY\ÜØYÙHHˆŠHÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\“›İXÙJH™]\›Âˆ[Ë›Ù™™\•˜XÚÙ\“›İXÙK^ÛÛ[HY\ÜØYÙNÂˆ[Ë›Ù™™\•˜XÚÙ\“›İXÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[Y\ÜØYÙJNÂˆB‚ˆ[˜İ[Ûˆ›Ü›X[^™SÙ™™\•˜XÚÙ\”Ûİ\˜ÙT›İÜÊ›İÜÊHÂˆÛÛœİ›Ü›X[^™YH\œ˜^Kš\Ğ\œ˜^J›İÜÊHÈ›İÜË›X\

Ù™™\ŠHOˆ
È‹‹ŠÙ™™\ˆßJHJJHˆ×NÂˆÛÛœİY\™ÙYHY\™ÙT›ÙXİÙ^]ÛÜ™Ò[ÓÙ™™\œÊ›Ü›X[^™Y›ÙXİÙ^]ÛÜ™]JNÂˆY\™ÙY™›Ü‘XXÚ

Ù™™\ŠHOˆÂˆÙ™™\‹›ÜšYÚ[˜[Y\ˆHÙ™™\‹›ÜšYÚ[˜[Y\ˆÙ™™\‹Y\ˆ•[šÛ›İÛˆÂˆ\UY\“İ™\œšYUÓÙ™™\ŠÙ™™\ŠNÂˆYˆ
Ù™™\‹˜Y™ÛÛ[Z\ÜÚ[ÛˆOOH[™Yš[™Y	‰ˆÙ™™\‹˜Y™š[X]T^[İ]OOH[™Yš[™Y
HÂˆÙ™™\‹˜Y™ÛÛ[Z\ÜÚ[ÛˆHÙ™™\‹˜Y™š[X]T^[İ]ÂˆBˆÙ™™\‹œ^[Y[ŞXÛHH™\ÛÛ™SÙ™™\”^[Y[ŞXÛJÙ™™\ŠNÂˆÙ™™\‹œ™YÚ[ÛˆH›Ü›X[^™T™YÚ[ÛŠÙ™™\‹œ™YÚ[ÛˆÙ™™\‹˜Ûİ[H[™™\”™YÚ[Û‘œ›ÛU^
Ù™™\‹˜œ˜[™
JNÂˆJNÂˆ™]\›ˆY\™ÙYÂˆB‚ˆ\Ş[˜È[˜İ[ÛˆØYÙ™™\•˜XÚÙ\”˜[™ÙJ˜[™ÙJHÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆÛÛœİ›Ü›X[^™Y˜[™ÙHHÙ™™\•˜XÚÙ\‘]T˜[™ÙJ˜[™ÙH	‰ˆ˜[™ÙKœİ\]K˜[™ÙH	‰ˆ˜[™ÙK™[™]JNÂˆYˆ
[›Ü›X[^™Y˜[™ÙK›ÚÊH™]\›ˆ˜[ÙNÂˆÛÛœİÙ^HHÙ™™\•˜XÚÙ\”˜[™ÙRÙ^J›Ü›X[^™Y˜[™ÙKœİ\]K›Ü›X[^™Y˜[™ÙK™[™]JNÂˆYˆ
˜XÚÙ\‹œÛİ\˜ÙT›İÜĞT˜[™ÙKš\ÊÙ^JJHÂˆ˜XÚÙ\‹œ™\]Y\İÙ\]Y[˜ÙH
ÏHNÂˆ˜XÚÙ\‹›ØY[™ÈH˜[ÙNÂˆ˜XÚÙ\‹œÛİ\˜ÙT›İÜÈH˜XÚÙ\‹œÛİ\˜ÙT›İÜĞT˜[™ÙK™Ù]
Ù^JH×NÂˆ˜XÚÙ\‹œÛİ\˜ÙT˜[™ÙRÙ^HHÙ^NÂˆŞ[˜ÓÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂˆ™]\›ˆYNÂˆB‚ˆÛÛœİÙ\]Y[˜ÙHH
Êİ˜XÚÙ\‹œ™\]Y\İÙ\]Y[˜ÙNÂˆ˜XÚÙ\‹›ØY[™ÈHYNÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJÙ™™\•˜XÚÙ\•^
“ØY[™ÈÙ[XİY]H˜[™Ùx )ˆ‹¹«hùg*:+îùcå¹¢`:`"y¥íºeí:# ùfí8 )ˆŠJNÂˆŞ[˜ÓÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂˆHÂˆÛÛœİ\˜[\ÈH™]ÈT“ÙX\˜Ú\˜[\ÊÂˆİ\Ù]Nˆ›Ü›X[^™Y˜[™ÙKœİ\]Kˆ[™Ù]Nˆ›Ü›X[^™Y˜[™ÙK™[™]BˆJNÂˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
	Ñ—ÓÑ‘‘T”×ÕRWĞT_OÉÜ\˜[\ËÔİš[™Ê
_XÂˆØXÚNˆ››Ë\İÜ™H‹ˆÜ™Y[X[ÎˆœØ[YK[ÜšYÚ[ˆ‚ˆJNÂˆÛÛœİ^[ØYH]ØZ]™\ÜÛœÙKšœÛÛŠ
K˜Ø]Ú


HOˆ
ßJJNÂˆYˆ
\™\ÜÛœÙK›ÚÈ^[ØY›ÚÈOOH˜[ÙHP\œ˜^Kš\Ğ\œ˜^J^[ØY›Ù™™\œÊJHÂˆ›İÈ™]È\œ›ÜŠ›Ù™™\ˆ˜[™ÙH™\]Y\İ˜Z[YŠNÂˆBˆYˆ
Ù\]Y[˜ÙHOOH˜XÚÙ\‹œ™\]Y\İÙ\]Y[˜ÙJH™]\›ˆ˜[ÙNÂˆÛÛœİ›İÜÈH›Ü›X[^™SÙ™™\•˜XÚÙ\”Ûİ\˜ÙT›İÜÊ^[ØY›Ù™™\œÊNÂˆ˜XÚÙ\‹œÛİ\˜ÙT›İÜĞT˜[™ÙKœÙ]
Ù^K›İÜÊNÂˆ˜XÚÙ\‹œÛİ\˜ÙT›İÜÈH›İÜÎÂˆ˜XÚÙ\‹œÛİ\˜ÙT˜[™ÙRÙ^HHÙ^NÂˆ™]\›ˆYNÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
Ù\]Y[˜ÙHOOH˜XÚÙ\‹œ™\]Y\İÙ\]Y[˜ÙJHÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJÙ™™\•˜XÚÙ\•^
Ûİ[›İØYHÙ[XİY]H˜[™ÙKˆHYØZ[ˆ]\‹ˆ‹¹¥è9¬åz+îùcå¹¢`:`"y¥íºeí:# ùfí;ï#:+íùê#yd#ºaãz+åxà ˆŠJNÂˆBˆ™]\›ˆ˜[ÙNÂˆHš[˜[HÂˆYˆ
Ù\]Y[˜ÙHOOH˜XÚÙ\‹œ™\]Y\İÙ\]Y[˜ÙJHÂˆ˜XÚÙ\‹›ØY[™ÈH˜[ÙNÂˆŞ[˜ÓÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂˆBˆBˆB‚ˆ[˜İ[ÛˆİÛ›ØYÙ™™\•˜XÚÙ\•ÛÜšØ›ÛÚÊÙ[XİYÛ›HH˜[ÙJHÂˆÜ[“Ù™™\•˜XÚÙ\‘^ÜX[ÙÊˆÙ[XİYÛ›KˆÙ[XİYÛ›HÈ[Ë›Ù™™\•˜XÚÙ\‘^ÜÙ[XİYˆ[Ë›Ù™™\•˜XÚÙ\‘^Üˆ
NÂˆB‚ˆ[˜İ[Ûˆ[š]X[^™SÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
HÂˆYˆ
İ]K›Ù™™\“\İ˜XÚÙ\‹˜ÛÛ›ÛÔ™XYHY[Ë›Ù™™\•˜XÚÙ\•Y\ŠH™]\›Âˆİ]K›Ù™™\“\İ˜XÚÙ\‹˜ÛÛ›ÛÔ™XYHHYNÂˆŞ[˜ÓÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
HÂˆ™]\›ˆÂˆÂˆÙ^NˆY\œÈ‹ˆ›Ûİˆ[Ë›Ù™™\•˜XÚÙ\•Y\‹ˆÙÙÛNˆ[Ë›Ù™™\•˜XÚÙ\•Y\•ÙÙÛKˆİ[[X\Nˆ[Ë›Ù™™\•˜XÚÙ\•Y\”İ[[X\KˆY[Nˆ[Ë›Ù™™\•˜XÚÙ\•Y\“Y[Kˆ[X™[ˆ[Y\œÈ‹ˆ\šXSX™[ˆÙ™™\•˜XÚÙ\•^
•Y\œÈ‹¹l`¹î©ÈŠKˆ˜[Y\Îˆ\œ˜^K™œ›ÛJ™]ÈÙ]
[š\]YU˜[Y\ÊY\ˆŠK›X\
Ø[›ÛšXØ[Y\“˜[YJJJKˆÙ[XİY˜[Y\ÎˆÙ™™\•˜XÚÙ\”Ù[XİYY\œÂˆKˆÂˆÙ^Nˆ˜Ø]YÛÜšY\È‹ˆ›Ûİˆ[Ë›Ù™™\•˜XÚÙ\Ø]YÛÜKˆÙÙÛNˆ[Ë›Ù™™\•˜XÚÙ\Ø]YÛÜUÙÙÛKˆİ[[X\Nˆ[Ë›Ù™™\•˜XÚÙ\Ø]YÛÜTİ[[X\KˆY[Nˆ[Ë›Ù™™\•˜XÚÙ\Ø]YÛÜSY[Kˆ[X™[ˆ[Ø]YÛÜšY\È‹ˆ\šXSX™[ˆÙ™™\•˜XÚÙ\•^
Ø]YÛÜšY\È‹¹dàyìnÈŠKˆ˜[Y\Îˆ[š\]YPØ]YÛÜU˜[Y\Ê
KˆÙ[XİY˜[Y\ÎˆÙ™™\•˜XÚÙ\”Ù[XİYØ]YÛÜšY\ÂˆKˆÂˆÙ^Nˆ›™]ÛÜšÜÈ‹ˆ›Ûİˆ[Ë›Ù™™\•˜XÚÙ\“™]ÛÜšËˆÙÙÛNˆ[Ë›Ù™™\•˜XÚÙ\“™]ÛÜšÕÙÙÛKˆİ[[X\Nˆ[Ë›Ù™™\•˜XÚÙ\“™]ÛÜšÔİ[[X\KˆY[Nˆ[Ë›Ù™™\•˜XÚÙ\“™]ÛÜšÓY[Kˆ[X™[ˆ[™]ÛÜšÜÈ‹ˆ\šXSX™[ˆÙ™™\•˜XÚÙ\•^
“™]ÛÜšÜÈ‹º e9æçÈŠKˆ˜[Y\Îˆ[š\]YU˜[Y\Ê›™]ÛÜšÈŠKˆÙ[XİY˜[Y\ÎˆÙ™™\•˜XÚÙ\”Ù[XİY™]ÛÜšÜÂˆBˆNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÊÙ^JHÂˆ™]\›ˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™š[™

ÛÛ™šYÊHOˆÛÛ™šYËšÙ^HOOHÙ^JNÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\“][TÙ[XİÜ[ÛœÑ›ÜÛÛ™šYÊÛÛ™šYÊHÂˆYˆ
XÛÛ™šYÈXÛÛ™šYË›Y[JH™]\›ÂˆÛÛœİÙ[XİYH™]ÈÙ]
ÛÛ™šYËœÙ[XİY˜[Y\Êİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÊJNÂˆÛÛœİ[X™[HÜ[Û•^
ÛÛ™šYË˜[X™[
NÂˆÛÛ™šYË›Y[KœÙ]]šX]J˜\šXK[X™[‹ÛÛ™šYË˜\šXSX™[
NÂˆÛÛ™šYË›Y[Kš[›™\’SHÂˆX™[Û\ÜÏH›Ù™™\‹]˜XÚÙ\‹[™]ÛÜšË[Ü[Ûˆ[œ]\OH˜ÚXÚØ›Şˆ]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹X[	ÜÙ[XİYœÚ^™HÈˆˆˆ˜ÚXÚÙYŸKÏÜ[‰Ù\ØØ\R[
[X™[
_OÜÜ[ÛX™[˜ˆ‹‹˜ÛÛ™šYË˜[Y\Ë›X\

˜[YJHOˆX™[Û\ÜÏH›Ù™™\‹]˜XÚÙ\‹[™]ÛÜšË[Ü[Ûˆ[œ]\OH˜ÚXÚØ›Şˆ]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹]˜[YOH‰Ù\ØØ\R[
˜[YJ_Hˆ	ÜÙ[XİYš\Ê˜[YJHÈ˜ÚXÚÙYˆˆˆŸKÏÜ[ˆ]OH‰Ù\ØØ\R[
˜[YJ_H‰Ù\ØØ\R[
˜[YJ_OÜÜ[ÛX™[˜
BˆKš›Ú[ŠˆŠNÂˆŞ[˜ÓÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ›Û
ÛÛ™šYÊNÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\“][TÙ[XİÜ[ÛœÊ
HÂˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™›Ü‘XXÚ
™[™\“Ù™™\•˜XÚÙ\“][TÙ[XİÜ[ÛœÑ›ÜÛÛ™šYÊNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\“][TÙ[XİÙ[Xİ[Û‘œ›ÛPÛÛ›Û
ÛÛ™šYÊHÂˆYˆ
XÛÛ™šYÈXÛÛ™šYË›Y[JH™]\›ˆÛÛ™šYÈÈÛÛ™šYËœÙ[XİY˜[Y\Êİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÊHˆ×NÂˆ™]\›ˆ\œ˜^K™œ›ÛJÛÛ™šYË›Y[Kœ]Y\TÙ[XİÜ[
–Ù]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹]˜[YWN˜ÚXÚÙYŠJBˆ›X\

[œ]
HOˆ[œ]™]\Ù]›Ù™™\•˜XÚÙ\‘š[\•˜[YJBˆ™š[\Š›ÛÛX[ŠNÂˆB‚ˆ[˜İ[ÛˆŞ[˜ÓÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ›Û
ÛÛ™šYÊHÂˆYˆ
XÛÛ™šYÊH™]\›ÂˆÛÛœİÙ[XİYHÛÛ™šYËœÙ[XİY˜[Y\Êİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÊNÂˆÛÛœİÙ[XİYÙ]H™]ÈÙ]
Ù[XİY
NÂˆYˆ
ÛÛ™šYË›Y[JHÂˆÛÛœİ[[œ]HÛÛ™šYË›Y[Kœ]Y\TÙ[XİÜŠ–Ù]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹X[HŠNÂˆYˆ
[[œ]
H[[œ]˜ÚXÚÙYHÙ[XİY›[™İOOHÂˆÛÛ™šYË›Y[Kœ]Y\TÙ[XİÜ[
–Ù]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹]˜[YWHŠK™›Ü‘XXÚ

[œ]
HOˆÂˆ[œ]˜ÚXÚÙYHÙ[XİYÙ]š\Ê[œ]™]\Ù]›Ù™™\•˜XÚÙ\‘š[\•˜[YJNÂˆJNÂˆBˆYˆ
ÛÛ™šYËœİ[[X\JHÂˆÛÛœİİ[[X\HHÙ[XİY›[™İOOHˆÈÜ[Û•^
ÛÛ™šYË˜[X™[
BˆˆÙ[XİY›[™İH‚ˆÈÙ[XİYš›Ú[Š‹ŠBˆˆ	ÜÙ[XİYœÛXÙJŠKš›Ú[Š‹Š_H
ÉÜÙ[XİY›[™İHŸXÂˆÛÛ™šYËœİ[[X\K^ÛÛ[Hİ[[X\NÂˆÛÛ™šYËœİ[[X\K]HHÙ[XİY›[™İÈÙ[XİYš›Ú[Š‹ŠHˆÜ[Û•^
ÛÛ™šYË˜[X™[
NÂˆBˆYˆ
ÛÛ™šYËÙÙÛJHÂˆÛÛ™šYËÙÙÛK˜Û\ÜÓ\İÙÙÛJš\ËXXİ]™H‹Ù[XİY›[™İˆ
NÂˆBˆB‚ˆ[˜İ[ÛˆÙÙÛSÙ™™\•˜XÚÙ\“][TÙ[XİY[JÛÛ™šYË›Ü˜ÙSÜ[ŠHÂˆYˆ
XÛÛ™šYÈXÛÛ™šYË›Y[HXÛÛ™šYËÙÙÛJH™]\›ÂˆÛÛœİÜ[ˆH›Ü˜ÙSÜ[ˆOH[ÈÛÛ™šYË›Y[K˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠHˆ›ÛÛX[Š›Ü˜ÙSÜ[ŠNÂˆYˆ
Ü[ŠHÂˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™›Ü‘XXÚ

İ\ŠHOˆÂˆYˆ
[İ\‹›Y[H[İ\‹ÙÙÛHİ\‹šÙ^HOOHÛÛ™šYËšÙ^JH™]\›Âˆİ\‹›Y[K˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆİ\‹ÙÙÛKœÙ]]šX]J˜\šXKY^[™Y‹™˜[ÙHŠNÂˆJNÂˆBˆÛÛ™šYË›Y[K˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[Ü[ŠNÂˆÛÛ™šYËÙÙÛKœÙ]]šX]J˜\šXKY^[™Y‹Ü[ˆÈYHˆˆ™˜[ÙHŠNÂˆB‚ˆ[˜İ[ÛˆÛÜÙSÙ™™\•˜XÚÙ\“][TÙ[XİY[\Ê
HÂˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™›Ü‘XXÚ

ÛÛ™šYÊHOˆÙÙÛSÙ™™\•˜XÚÙ\“][TÙ[XİY[JÛÛ™šYË˜[ÙJJNÂˆB‚ˆ[˜İ[ÛˆŞ[˜ÓÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆÛÛœİ˜YHİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÎÂˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™›Ü‘XXÚ
Ş[˜ÓÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ›Û
NÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”İ\]JH[Ë›Ù™™\•˜XÚÙ\”İ\]K˜[YHH˜Yœİ\]HˆÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘[™]JH[Ë›Ù™™\•˜XÚÙ\‘[™]K˜[YHH˜Y™[™]HˆÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\˜”ÛXŞJH[Ë›Ù™™\•˜XÚÙ\˜”ÛXŞK˜[YHH˜Y˜˜”ÛXŞH˜[ÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”™]™[YTİ]\ÊH[Ë›Ù™™\•˜XÚÙ\”™]™[YTİ]\Ë˜[YHH˜Yœ™]™[YTİ]\È˜[ÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”™]™[YTÛÜ
H[Ë›Ù™™\•˜XÚÙ\”™]™[YTÛÜ˜[YHH˜Yœ™]™[YTÛÜœš[Üš]HÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\“Z[[İŠH[Ë›Ù™™\•˜XÚÙ\“Z[[İ‹˜[YHH˜Y›Z[[İÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\“X^[İŠH[Ë›Ù™™\•˜XÚÙ\“X^[İ‹˜[YHH˜Y›X^[İÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\“Z[ÛÛ[Z\ÜÚ[ÛŠH[Ë›Ù™™\•˜XÚÙ\“Z[ÛÛ[Z\ÜÚ[Û‹˜[YHH˜Y›Z[ÛÛ[Z\ÜÚ[ÛÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\“X^ÛÛ[Z\ÜÚ[ÛŠH[Ë›Ù™™\•˜XÚÙ\“X^ÛÛ[Z\ÜÚ[Û‹˜[YHH˜Y›X^ÛÛ[Z\ÜÚ[ÛÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘]Tİ]\ÊHÂˆÛÛœİ˜[™ÙHHÙ™™\•˜XÚÙ\‘]T˜[™ÙJ˜Yœİ\]K˜Y™[™]JNÂˆ[Ë›Ù™™\•˜XÚÙ\‘]Tİ]\Ë^ÛÛ[H˜XÚÙ\‹›ØY[™ÂˆÈÙ™™\•˜XÚÙ\•^
“ØY[™ÈÙ[XİY]H˜[™Ùx )ˆ‹¹«hùg*:+îùcå¹¢`:`"y¥íºeí:# ùfí8 )ˆŠBˆˆ˜[™ÙK›ÚÂˆÈÙ™™\•˜XÚÙ\•^
ˆ]H˜[™ÙNˆ	ÛÙ™™\•˜XÚÙ\”˜[™ÙSX™[
˜[™ÙKœİ\]K˜[™ÙK™[™]J_Xˆ9¥l9£kº# ùfí;ï&‰ÛÙ™™\•˜XÚÙ\”˜[™ÙSX™[
˜[™ÙKœİ\]K˜[™ÙK™[™]J_Xˆ
BˆˆÙ™™\•˜XÚÙ\•^
”Ù[XİH˜[Y]H˜[™ÙH‹º+íú`"y¢êy§"y¥b9æ¡9¥éy§'ú# ùfíŠNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\\Qš[\œÊH[Ë›Ù™™\•˜XÚÙ\\Qš[\œË™\ØX›YH˜XÚÙ\‹›ØY[™ÎÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”ÙX\˜Ú	‰ˆ[Ë›Ù™™\•˜XÚÙ\”ÙX\˜Ú˜[YHOOHİ]K›Ù™™\“\İ˜XÚÙ\‹œÙX\˜Ú
HÂˆ[Ë›Ù™™\•˜XÚÙ\”ÙX\˜Ú˜[YHHİ]K›Ù™™\“\İ˜XÚÙ\‹œÙX\˜ÚÂˆBˆB‚ˆ[˜İ[Ûˆ™XYÙ™™\•˜XÚÙ\‘˜Yš[\œÊ
HÂˆ™]\›ˆÂˆY\œÎˆÙ™™\•˜XÚÙ\“][TÙ[XİÙ[Xİ[Û‘œ›ÛPÛÛ›Û
Ù™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÊY\œÈŠJKˆØ]YÛÜšY\ÎˆÙ™™\•˜XÚÙ\“][TÙ[XİÙ[Xİ[Û‘œ›ÛPÛÛ›Û
Ù™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÊ˜Ø]YÛÜšY\ÈŠJKˆİ\]Nˆİš[™Ê
[Ë›Ù™™\•˜XÚÙ\”İ\]H	‰ˆ[Ë›Ù™™\•˜XÚÙ\”İ\]K˜[YJHˆŠKš[J
Kˆ[™]Nˆİš[™Ê
[Ë›Ù™™\•˜XÚÙ\‘[™]H	‰ˆ[Ë›Ù™™\•˜XÚÙ\‘[™]K˜[YJHˆŠKš[J
KˆZ[[İˆ[Ë›Ù™™\•˜XÚÙ\“Z[[İ‹˜[YKš[J
KˆX^[İˆ[Ë›Ù™™\•˜XÚÙ\“X^[İ‹˜[YKš[J
KˆZ[ÛÛ[Z\ÜÚ[Ûˆ[Ë›Ù™™\•˜XÚÙ\“Z[ÛÛ[Z\ÜÚ[Û‹˜[YKš[J
KˆX^ÛÛ[Z\ÜÚ[Ûˆ[Ë›Ù™™\•˜XÚÙ\“X^ÛÛ[Z\ÜÚ[Û‹˜[YKš[J
Kˆ™]ÛÜšÜÎˆÙ™™\•˜XÚÙ\“][TÙ[XİÙ[Xİ[Û‘œ›ÛPÛÛ›Û
Ù™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÊ›™]ÛÜšÜÈŠJKˆ˜”ÛXŞNˆ
[Ë›Ù™™\•˜XÚÙ\˜”ÛXŞH	‰ˆ[Ë›Ù™™\•˜XÚÙ\˜”ÛXŞK˜[YJH˜[‹ˆ™]™[YTİ]\Îˆ[Ë›Ù™™\•˜XÚÙ\”™]™[YTİ]\Ë˜[YH˜[‹ˆ™]™[YTÛÜˆ[Ë›Ù™™\•˜XÚÙ\”™]™[YTÛÜ˜[YHœš[Üš]H‚ˆNÂˆB‚ˆ[˜İ[ÛˆÙ™™\•˜XÚÙ\‘š[\Ú\X™[Êš[\œÈHİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œÊHÂˆÛÛœİÚ\ÈH×NÂˆÙ™™\•˜XÚÙ\”Ù[XİYY\œÊš[\œÊK™›Ü‘XXÚ

Y\ŠHOˆÚ\Ëœ\Ú
Y\ŠJNÂˆÙ™™\•˜XÚÙ\”Ù[XİYØ]YÛÜšY\Êš[\œÊK™›Ü‘XXÚ

Ø]YÛÜJHOˆÚ\Ëœ\Ú
Ø]YÛÜJJNÂˆÙ™™\•˜XÚÙ\”Ù[XİY™]ÛÜšÜÊš[\œÊK™›Ü‘XXÚ

™]ÛÜšÊHOˆÚ\Ëœ\Ú
™]ÛÜšÊJNÂˆÛÛœİ]T˜[™ÙHHÙ™™\•˜XÚÙ\‘]T˜[™ÙJš[\œËœİ\]Kš[\œË™[™]JNÂˆYˆ
]T˜[™ÙK›ÚÊHÚ\Ëœ\Ú
	ÛÙ™™\•˜XÚÙ\•^
‘]H‹¹¥éy§'ÈŠ_H	ÛÙ™™\•˜XÚÙ\”˜[™ÙSX™[
]T˜[™ÙKœİ\]K]T˜[™ÙK™[™]J_X
NÂˆYˆ
š[\œË˜˜”ÛXŞHOOH›Z[™ŠHÚ\Ëœ\Ú
Ù™™\•˜XÚÙ\•^
“Z[™ˆ‹¹.âù¡#ÈˆŠJNÂˆYˆ
š[\œË˜˜”ÛXŞHOOH›Ü[ˆŠHÚ\Ëœ\Ú
Ù™™\•˜XÚÙ\•^
‘Ù\Û‰İZ[™ˆ‹¹.#y.âù¡#ÈˆŠJNÂˆYˆ
š[\œË˜˜”ÛXŞHOOH[šÛ›İÛˆŠHÚ\Ëœ\Ú
Ù™™\•˜XÚÙ\•^
•[šÛ›İÛˆˆ™Y™\™[˜ÙH‹¹§*¹çéHˆ9`cùioHŠJNÂˆYˆ
š[\œËœ™]™[YTİ]\ÈOOHœÜÚ]]™HŠHÚ\Ëœ\Ú
Ù™™\•˜XÚÙ\•^
”™]™[YHˆ	‹¹mì¹.©ùå'È™]™[YHŠJNÂˆYˆ
š[\œËœ™]™[YTİ]\ÈOOH››Û™HŠHÚ\Ëœ\Ú
Ù™™\•˜XÚÙ\•^
”™]™[YHH	‹¹§*¹.©ùå'È™]™[YHŠJNÂˆYˆ
š[\œËœ™]™[YTÛÜOOHœ™]™[YKY\ØÈŠHÚ\Ëœ\Ú
Ù™™\•˜XÚÙ\•^
”™]™[YHYÚÈİÈ‹”™]™[YH9.ãºjæ9b,9/cˆŠJNÂˆYˆ
š[\œËœ™]™[YTÛÜOOHœ™]™[YKX\ØÈŠHÚ\Ëœ\Ú
Ù™™\•˜XÚÙ\•^
”™]™[YHİÈÈYÚ‹”™]™[YH9.ã¹/c¹b,:jæŠJNÂˆYˆ
š[\œË›Z[[İˆš[\œË›X^[İŠHÚ\Ëœ\Ú
SÕˆ	Ùš[\œË›Z[[İˆÈ		Ùš[\œË›Z[[İŸXˆ‰Ÿx $ÉÙš[\œË›X^[İˆÈ		Ùš[\œË›X^[İŸXˆ¸¢'ˆŸX
NÂˆYˆ
š[\œË›Z[ÛÛ[Z\ÜÚ[Ûˆš[\œË›X^ÛÛ[Z\ÜÚ[ÛŠHÚ\Ëœ\Ú
Q‘ˆ	Ùš[\œË›Z[ÛÛ[Z\ÜÚ[ÛˆŒŸIx $ÉÙš[\œË›X^ÛÛ[Z\ÜÚ[ÛˆŒLŸIX
NÂˆ™]\›ˆÚ\ÎÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\‘š[\Ú\Ê
HÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\‘š[\Ú\ÊH™]\›ÂˆÛÛœİÚ\ÈHÙ™™\•˜XÚÙ\‘š[\Ú\X™[Ê
NÂˆ[Ë›Ù™™\•˜XÚÙ\‘š[\Ú\Ëš[›™\’SHÚ\Ë›[™İˆÈÚ\Ë›X\

X™[
HOˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹Yš[\‹XÚ\‰Ù\ØØ\R[
X™[
_OÜÜ[˜
Kš›Ú[ŠˆŠBˆˆÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹Yš[\‹Y[\H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
[Ù™™\œÈ\™H[˜ÛYY‹¹odùbcyc!yd*ùaj:`êÙ™™\ˆŠJ_OÜÜ[˜ÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\ÛÛ[[œÔ[™[

HÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÔ[™[
H™]\›ÂˆÛÛœİX™[ÈHİ]K›[™İXYÙHOOHš‚ˆÈÈY\ˆ¹l`¹î©È‹ÛÛ[Z\ÜÚ[ÛˆQ‘ˆ9/húaäH‹[İˆSÕˆ‹™]™[YNˆ”™]™[YH‹˜”ÛXŞNˆ¹¦+ùd)¹.âù¡#Èˆ‹Ø]YÛÜNˆ¹dàyìnÈ‹\Ú[œÎˆ•Ü˜[šÈTÒSœÈ‹™XÛÛ[Y[™][Ûˆ¹£ª:#d9/èy kÈˆBˆˆÈY\ˆ•Y\ˆ‹ÛÛ[Z\ÜÚ[ÛˆQ‘ˆÛÛ[Z\ÜÚ[Ûˆ‹[İˆSÕˆ‹™]™[YNˆ”™]™[YH‹˜”ÛXŞNˆˆ™Y™\™[˜ÙH‹Ø]YÛÜNˆØ]YÛÜH‹\Ú[œÎˆ•Ü˜[šÈTÒSœÈ‹™XÛÛ[Y[™][Ûˆ”™XÛÛ[Y[™][ÛˆˆNÂˆ[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÔ[™[š[›™\’SH]ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹\Üİ™\‹ZXY\ˆİ›Û™Ï‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
•š\ÚX›HÛÛ[[œÈ‹¹¦/¹é.¹b%ÈŠJ_OÜİ›Û™Ï]Ûˆ\OH˜]Ûˆˆ]K[Ù™™\‹]˜XÚÙ\‹XÛÜÙOH˜ÛÛ[[œÈˆ\šXK[X™[HÛÜÙHÛÛ[[œÈ°åÏØ]ÛÙ]‰ÓØš™XİšÙ^\ÊX™[ÊK›X\

Ù^JHOˆX™[Û\ÜÏH›Ù™™\‹]˜XÚÙ\‹XÛÛ[[‹[Ü[Ûˆ[œ]\OH˜ÚXÚØ›Şˆ]K[Ù™™\‹]˜XÚÙ\‹XÛÛ[[H‰ÚÙ^_Hˆ	Üİ]K›Ù™™\“\İ˜XÚÙ\‹š\ÚX›PÛÛ[[œÖÚÙ^WHOOH˜[ÙHÈ˜ÚXÚÙYˆˆˆŸKÏÜ[‰Ù\ØØ\R[
X™[ÖÚÙ^WJ_OÜÜ[ÛX™[˜
Kš›Ú[ŠˆŠ_XÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\”[\Ô[™[

HÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\”[\Ô[™[
H™]\›Âˆ[Ë›Ù™™\•˜XÚÙ\’YÚØÛÜ™K˜[YHHİ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ËšYÚØÛÜ™NÂˆ[Ë›Ù™™\•˜XÚÙ\“İĞ[İ“X^˜[YHHİ]K›Ù™™\“\İ˜XÚÙ\‹œ[\Ë›İĞ[İ“X^Âˆ[Ë›Ù™™\•˜XÚÙ\”ØÛÜ™SYÙ[™š[›™\’SHİ]K›[™İXYÙHOOHš‚ˆÈÜ[¹l`¹î©ûï&•Y\ˆH
ÍÈY\ˆˆ
ÌÈÈY\ˆÈ
ÌˆÈY\ˆ
ÌOÜÜ[Ü[Q‘ˆ9/húaä{ï&¸¢iLŒ	H
ÍÈ8¢iLMIH
ÌÈÈ8¢iLL	H
ÌˆÈ8¢iMIH
ÌOÜÜ[Ü[SÕ»ï&‰Íx $ÉÍL
ÌˆÈ	™İÉÍL
Ì{ï&ù§"HTÒSˆ
ÌOÜÜ[ˆ‚ˆˆÜ[•Y\ˆH
ÍÈˆ
ÌÈÈÈ
ÌˆÈ
ÌOÜÜ[Ü[Q‘ˆÛÛ[Z\ÜÚ[Ûˆ8¢iLŒ	H
ÍÈ8¢iLMIH
ÌÈÈ8¢iLL	H
ÌˆÈ8¢iMIH
ÌOÜÜ[Ü[SÕˆ	Íx $ÉÍL
ÌˆÈ	™İÉÍL
ÌNÈTÒSˆÛİ™\˜YÙH
ÌOÜÜ[ˆÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÊ
HÂˆYˆ
Y[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÓ\İ
H™]\›ÂˆÛÛœİšY]ÜÈHİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]ÜÎÂˆ[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÓ\İš[›™\’SHšY]ÜË›[™İˆÈšY]ÜË›X\

šY]ÊHOˆ]ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹\Ø]™Y]šY]È]Ûˆ\OH˜]Ûˆˆ]K[Ù™™\‹]˜XÚÙ\‹[ØY]šY]ÏH‰Ù\ØØ\R[
šY]ËšY
_Hˆ]OH‰Ù\ØØ\R[
šY]Ë›˜[YJ_H‰Ù\ØØ\R[
šY]Ë›˜[YJ_OØ]Û]Ûˆ\OH˜]Ûˆˆ]K[Ù™™\‹]˜XÚÙ\‹Y[]K]šY]ÏH‰Ù\ØØ\R[
šY]ËšY
_Hˆ\šXK[X™[H‘[]H	Ù\ØØ\R[
šY]Ë›˜[YJ_H°åÏØ]ÛÙ]˜
Kš›Ú[ŠˆŠBˆˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹\Ø]™YY[\H‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
“›ÈØ]™YšY]ÜÈY]ˆ‹º/æ9¬¨y§"y/çykf9æ¡:)á¹fï¸à ˆŠJ_OÜ˜ÂˆB‚ˆ[˜İ[Ûˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
HÂˆYˆ
Y[Ë›Ù™™\“\İ˜XÚÙ\”YÙJH™]\›Âˆ[š]X[^™SÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂˆ™[™\“Ù™™\•˜XÚÙ\“][TÙ[XİÜ[ÛœÊ
NÂˆÛÛœİ›İÜÈHÙ™™\•˜XÚÙ\‘š[\™Y›İÜÊ
NÂˆÛÛœİİ[YÙ\ÈHX]›X^
KX]˜ÙZ[
›İÜË›[™İÈİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙTÚ^™JJNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHX]›Z[ŠX]›X^
Kİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙJKİ[YÙ\ÊNÂˆÛÛœİİ\H
İ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHJH
ˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙTÚ^™NÂˆÛÛœİYÙT›İÜÈH›İÜËœÛXÙJİ\İ\
Èİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙTÚ^™JNÂˆÛÛœİÛİ[ÈH›İÜËœ™YXÙJ
™\İ[Ù™™\ŠHOˆÂˆ™\İ[ÛÙ™™\•˜XÚÙ\”š[Üš]JÙ™™\‹İ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ÊKšÙ^WH
ÏHNÂˆ™]\›ˆ™\İ[ÂˆKÈYÚˆ™XÛÛ[Y[™Yˆ›İËX[İˆˆJNÂˆÛÛœİÙ[Xİ[Û”İ[[X\HHÙ™™\•˜XÚÙ\”Ù[Xİ[Û”İ[[X\J›İÜËYÙT›İÜÊNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œ™[™\™Y›İÜÈH›İÜÎÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[HÙ[Xİ[Û”İ[[X\KœÙ[XİYÛİ[ÂˆÛÛœİÜ\ÈHÂˆÈX™[ˆÙ™™\•˜XÚÙ\•^
“X]ÚYÙ™™\œÈ‹¹c.zacHÙ™™\ˆŠK˜[YNˆ›İÜË›[™İ›İNˆÙ™™\•˜XÚÙ\•^
˜İ\œ™[š[\ˆ˜[™ÙH‹¹odùbcyëfú`"z# ùfíŠKXÛÛˆˆÈ‹ÛÛÜˆˆÌMÍYˆ‹ÛÙˆˆÙXYŒ™˜ÈˆKˆÈX™[ˆÙ™™\•˜XÚÙ\•^
’YÚš[Üš]H‹ºjæ9/&9ab9î©ÈŠK˜[YNˆÛİ[ËšYÚ›İNˆ	ÛÙ™™\•˜XÚÙ\•^
œØÛÜ™H‹º+á9b!ˆŠ_H8¢iH	Üİ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ËšYÚØÛÜ™_XXÛÛˆ¸¦!H‹ÛÛÜˆˆØŒÍ™‹ÛÙˆˆÙ™™ŒÙÈˆKˆÈX™[ˆÙ™™\•˜XÚÙ\•^
”™XÛÛ[Y[™Y‹¹£ª:#dŠK˜[YNˆÛİ[Ëœ™XÛÛ[Y[™Y›İNˆÙ™™\•˜XÚÙ\•^
œİ[™\™ÜÜ[š]HÛÛ‹¹n.:)á9§.¹/&¹¬hŠKXÛÛˆ¸¡¤H‹ÛÛÜˆˆÌ™XN‹ÛÙˆˆÙXYŒ™˜ÈˆKˆÈX™[ˆÙ™™\•˜XÚÙ\•^
“İËPSÕˆXÚÜÈ‹¹/cˆSÕˆ9/&:`"HŠK˜[YNˆÛİ[ÖÈ›İËX[İˆ—K›İNˆSÕˆ8¢i	Û[Û™^Jİ]K›Ù™™\“\İ˜XÚÙ\‹œ[\Ë›İĞ[İ“X^
_XXÛÛˆ‰‹ÛÛÜˆˆÌÌÍNH‹ÛÙˆˆÙYÙŒˆˆBˆNÂˆ[Ë›Ù™™\•˜XÚÙ\’Ü\Ëš[›™\’SHÜ\Ë›X\

ÜJHOˆ\XÛHÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹ZÜHˆİ[OH‹KZÜKXXØÙ[‰ÚÜK˜ÛÛÜŸNËKZÜK\ÛÙ‰ÚÜKœÛÙHÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹ZÜKZXÛÛˆ‰Ù\ØØ\R[
ÜKšXÛÛŠ_OÜÜ[]ÛX[‰Ù\ØØ\R[
ÜK›X™[
_OÜÛX[İ›Û™Ï‰Û[X™\ŠÜK˜[YJKÓØØ[Tİš[™Ê
_OÜİ›Û™ÏÜ[‰Ù\ØØ\R[
ÜK››İJ_OÜÜ[Ù]Ø\XÛO˜
Kš›Ú[ŠˆŠNÂ‚ˆÛÛœİÛÛ[[œÈHÙ™™\•˜XÚÙ\ÛÛ[[‘Yš[š][ÛœÊ
NÂˆÛÛœİ[YÙTÙ[XİYHÙ[Xİ[Û”İ[[X\K˜[YÙTÙ[XİYÂˆÛÛœİ[š[\™YÙ[XİYHÙ[Xİ[Û”İ[[X\K˜[š[\™YÙ[XİYÂˆ[Ë›Ù™™\•˜XÚÙ\•X›RXYš[›™\’SH‰ØÛÛ[[œË›X\

ÛÛ[[ŠHOˆ‰ØÛÛ[[‹šÙ^HOOHœš[Üš]HˆÈÜ[ˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹\š[Üš]KXÙ[[œ]Û\ÜÏH›Ù™™\‹]˜XÚÙ\‹\Ù[XİX[ˆ\OH˜ÚXÚØ›Şˆ	Ø[YÙTÙ[XİYÈ˜ÚXÚÙYˆˆˆŸH\šXK[X™[H”Ù[Xİİ\œ™[YÙH‹ÏÜ[‰Ù\ØØ\R[
ÛÛ[[‹›X™[
_OÜÜ[ÜÜ[˜ˆ\ØØ\R[
ÛÛ[[‹›X™[
_Oİ˜
Kš›Ú[ŠˆŠ_Oİ˜Âˆ[Ë›Ù™™\•˜XÚÙ\•X›T›İÜËš[›™\’SHYÙT›İÜË›[™İˆÈYÙT›İÜË›X\

Ù™™\ŠHOˆˆÛ\ÜÏH‰Üİ]K›Ù™™\“\İ˜XÚÙ\‹œÙ[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJHÈš\Ë\Ù[XİYˆˆˆŸH‰ØÛÛ[[œË›X\

ÛÛ[[ŠHOˆ‰ÛÙ™™\•˜XÚÙ\Ù[[
Ù™™\‹ÛÛ[[Š_Oİ˜
Kš›Ú[ŠˆŠ_Oİ˜
Kš›Ú[ŠˆŠBˆˆˆÛ\ÜÏH›Ù™™\‹]˜XÚÙ\‹Y[\K\›İÈÛÛÜ[H‰ØÛÛ[[œË›[™İH‰Ù\ØØ\R[
Ù™™\•˜XÚÙ\•^
“›ÈÙ™™\œÈX]Ú\È˜[™ÙKˆY\İHš[\œÈ[™HYØZ[‹ˆ‹¹¬¨y§"yë)¹d"9odùbcz# ùfí9æ¡Ù™™\»ï#:+íú, ù¥m9ëfú`"y§hy.í¸à ˆŠJ_Oİİ˜Â‚ˆ[Ë›Ù™™\•˜XÚÙ\“Ù™™\œÕX‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹İ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÈOOH›Ù™™\œÈŠNÂˆ[Ë›Ù™™\•˜XÚÙ\”›ÙXİÕX‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹İ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÈOOHœ›ÙXİÈŠNÂˆ[Ë›Ù™™\•˜XÚÙ\“Ù™™\œÕX‹œÙ]]šX]J˜\šXK\Ù[XİY‹İ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÈOOH›Ù™™\œÈˆÈYHˆˆ™˜[ÙHŠNÂˆ[Ë›Ù™™\•˜XÚÙ\”›ÙXİÕX‹œÙ]]šX]J˜\šXK\Ù[XİY‹İ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÈOOHœ›ÙXİÈˆÈYHˆˆ™˜[ÙHŠNÂˆ[Ë›Ù™™\•˜XÚÙ\•X›PÛİ[^ÛÛ[H›İÜË›[™İˆÈÙ™™\•˜XÚÙ\•^
ÚİÚ[™È	Üİ\
È_x $ÉÓX]›Z[Šİ\
ÈYÙT›İÜË›[™İ›İÜË›[™İ
_HÙˆ	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_HÙ™™\œØ9¦/¹é.¹ë+	Üİ\
È_x $ÉÓX]›Z[Šİ\
ÈYÙT›İÜË›[™İ›İÜË›[™İ
_H9§h{ï#9alH	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_H9.*ˆÙ™™\˜
BˆˆÙ™™\•˜XÚÙ\•^
ŒÙ™™\œÈ‹Œ9.*ˆÙ™™\ˆŠNÂˆ[Ë›Ù™™\•˜XÚÙ\”YÙR[™XØ]Ü‹^ÛÛ[H	Üİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙ_HÈ	İİ[YÙ\ßXÂˆ[Ë›Ù™™\•˜XÚÙ\”YÙT™]‹™\ØX›YHİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHNÂˆ[Ë›Ù™™\•˜XÚÙ\”YÙS™^™\ØX›YHİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHİ[YÙ\ÎÂˆÛÛœİÙ[XİYÛİ[Hİ]K›Ù™™\“\İ˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[Âˆ[Ë›Ù™™\•˜XÚÙ\”Ù[XİYÛİ[^ÛÛ[HÙ[XİYÛİ[ÓØØ[Tİš[™Ê
NÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜÙ[XİY™\ØX›YHÙ[XİYÛİ[OOHÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y
HÂˆÛÛœİXİ[Û“X™[H[š[\™YÙ[XİYˆÈÙ™™\•˜XÚÙ\•^
ÛX\ˆX]Ú[™ÈÙ[Xİ[Ûˆ‹¹®!zfi9c.zacz`"y¢êHŠBˆˆÙ™™\•˜XÚÙ\•^
”Ù[Xİ[X]Ú[™È‹º`"y¢êyaj:`ê9c.zacHŠNÂˆÛÛœİXİ[Û‘\ØÜš\[ÛˆH[š[\™YÙ[XİYˆÈÙ™™\•˜XÚÙ\•^
ˆÛX\ˆ[	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_HX]Ú[™ÈÙ™™\œÈXÜ›ÜÜÈ[YÙ\Øˆ9®!zfi:-ê9¢`9§"zhmzgh¹æ¡	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_H9.*¹c.zacHÙ™™\˜ˆ
BˆˆÙ™™\•˜XÚÙ\•^
ˆÙ[Xİ[	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_HX]Ú[™ÈÙ™™\œÈXÜ›ÜÜÈ[YÙ\Øˆ:-ê9¢`9§"zhmzghº`"y¢êyaj:`ê	Ü›İÜË›[™İÓØØ[Tİš[™Ê
_H9.*¹c.zacHÙ™™\˜ˆ
NÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y™\ØX›YH›İÜË›[™İOOHÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YœÙ]]šX]J˜\šXK\™\ÜÙY‹[š[\™YÙ[XİYÈYHˆˆ™˜[ÙHŠNÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YœÙ]]šX]J˜\šXK[X™[‹Xİ[Û‘\ØÜš\[ÛŠNÂˆ[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y]HHXİ[Û‘\ØÜš\[ÛÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YX™[
H[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YX™[^ÛÛ[HXİ[Û“X™[ÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YÛİ[
H[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™YÛİ[^ÛÛ[H›İÜË›[™İÓØØ[Tİš[™Ê
NÂˆBˆ™[™\“Ù™™\•˜XÚÙ\‘š[\Ú\Ê
NÂˆ™[™\“Ù™™\•˜XÚÙ\ÛÛ[[œÔ[™[

NÂˆ™[™\“Ù™™\•˜XÚÙ\”[\Ô[™[

NÂˆ™[™\“Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÊ
NÂˆŞ[˜ÓÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂ‚ˆYˆ
\İ]K›Ù™™\“\İ˜XÚÙ\‹˜[š[X]Y	‰ˆİ]KœYÙHOOH›Ù™™\‹[\İ]˜XÚÙ\ˆŠHÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹˜[š[X]YHYNÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
]Ú[™İË™ÜØ\
H™]\›ÂˆÚ[™İË™ÜØ\™œ›ÛUÊˆ[Ë›Ù™™\“\İ˜XÚÙ\”YÙKœ]Y\TÙ[XİÜ[
‹›Ù™™\‹]˜XÚÙ\‹ZXY\‹›Ù™™\‹]˜XÚÙ\‹Yš[\‹XØ\™›Ù™™\‹]˜XÚÙ\‹ZÜK›Ù™™\‹]˜XÚÙ\‹]X›K\[™[ŠKˆÈÜXÚ]NˆNˆLˆKˆÈÜXÚ]NˆKNˆ\˜][Ûˆ‹İYÙÙ\ˆŒKX\ÙNˆœİÙ\Œ‹›İ]‹ÛX\”›ÜÎˆ›ÜXÚ]K˜[œÙ›Ü›HˆBˆ
NÂˆJNÂˆBˆB‚ˆ\Ş[˜È[˜İ[Ûˆ\SÙ™™\•˜XÚÙ\‘š[\œÊ
HÂˆÛÛœİš[\œÈH™XYÙ™™\•˜XÚÙ\‘˜Yš[\œÊ
NÂˆÛÛœİZ[[İˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›Z[[İŠNÂˆÛÛœİX^[İˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›X^[İŠNÂˆÛÛœİZ[ÛÛ[Z\ÜÚ[ÛˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›Z[ÛÛ[Z\ÜÚ[ÛŠNÂˆÛÛœİX^ÛÛ[Z\ÜÚ[ÛˆHÙ™™\•˜XÚÙ\“Ü[Û˜[[X™\Šš[\œË›X^ÛÛ[Z\ÜÚ[ÛŠNÂˆYˆ

Z[[İˆOOH[	‰ˆX^[İˆOOH[	‰ˆZ[[İˆˆX^[İŠH
Z[ÛÛ[Z\ÜÚ[ÛˆOOH[	‰ˆX^ÛÛ[Z\ÜÚ[ÛˆOOH[	‰ˆZ[ÛÛ[Z\ÜÚ[ÛˆˆX^ÛÛ[Z\ÜÚ[ÛŠJHÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJÙ™™\•˜XÚÙ\•^
HZ[š[][H˜[YHØ[››İ™HÜ™X]\ˆ[ˆ]ÈX^[][Kˆ‹¹§ 9l#ù`/9.#z ïyi)ù.£¹§ 9i)ù`/8à ˆŠJNÂˆ™]\›ÂˆBˆÛÛœİ]T˜[™ÙHHÙ™™\•˜XÚÙ\‘]T˜[™ÙJš[\œËœİ\]Kš[\œË™[™]JNÂˆYˆ
Y]T˜[™ÙK›ÚÊHÂˆÛÛœİY\ÜØYÙHH]T˜[™ÙKœ™X\ÛÛˆOOH›Ü™\ˆ‚ˆÈÙ™™\•˜XÚÙ\•^
•Hİ\]HØ[››İ™HY\ˆH[™]Kˆ‹¹o 9iâù¥éy§'ù.#z ïy¦f¹.£¹îäù§gù¥éy§'øà ˆŠBˆˆ]T˜[™ÙKœ™X\ÛÛˆOOH›[™İ‚ˆÈÙ™™\•˜XÚÙ\•^
•H]H˜[™ÙHØ[››İ^ÙYYÍˆ^\Ëˆ‹¹¥éy§'ú# ùfí9.#z ïz-¡z/áÈÍˆ9i*xà ˆŠBˆˆÙ™™\•˜XÚÙ\•^
”Ù[XİH˜[Y]H˜[™ÙKˆ‹º+íú`"y¢êy§"y¥b9æ¡9¥éy§'ú# ùfí8à ˆˆ
NÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJY\ÜØYÙJNÂˆ™]\›ÂˆBˆÛÛœİ›Ü›X[^™Yš[\œÈH›Ü›X[^™SÙ™™\•˜XÚÙ\‘š[\œÊš[\œÊNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÈHÈ‹‹››Ü›X[^™Yš[\œÈNÂˆYˆ
X]ØZ]ØYÙ™™\•˜XÚÙ\”˜[™ÙJ]T˜[™ÙJJH™]\›Âˆİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œÈHÈ‹‹››Ü›X[^™Yš[\œÈNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHNÂˆÛÜÙSÙ™™\•˜XÚÙ\“][TÙ[XİY[\Ê
NÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJˆŠNÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ™\Ù]Ù™™\•˜XÚÙ\‘š[\œÊ
HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\Âˆ˜XÚÙ\‹œ™\]Y\İÙ\]Y[˜ÙH
ÏHNÂˆ˜XÚÙ\‹›ØY[™ÈH˜[ÙNÂˆÛÛœİš[\œÈHÂˆY\œÎˆ×KˆØ]YÛÜšY\Îˆ×Kˆİ\]Nˆ˜XÚÙ\‹™Y˜][]T˜[™ÙKœİ\]Kˆ[™]Nˆ˜XÚÙ\‹™Y˜][]T˜[™ÙK™[™]KˆZ[[İˆˆ‹ˆX^[İˆˆ‹ˆZ[ÛÛ[Z\ÜÚ[Ûˆˆ‹ˆX^ÛÛ[Z\ÜÚ[Ûˆˆ‹ˆ™]ÛÜšÜÎˆ×Kˆ˜”ÛXŞNˆ˜[‹ˆ™]™[YTİ]\Îˆ˜[‹ˆ™]™[YTÛÜˆœš[Üš]H‚ˆNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÈHÈ‹‹™š[\œÈNÂˆYˆ
X]ØZ]ØYÙ™™\•˜XÚÙ\”˜[™ÙJš[\œÊJH™]\›Âˆİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œÈHÈ‹‹™š[\œÈNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œÙX\˜ÚHˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHNÂˆÛÜÙSÙ™™\•˜XÚÙ\“][TÙ[XİY[\Ê
NÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJˆŠNÂˆŞ[˜ÓÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆB‚ˆ[˜İ[ÛˆÙÙÛSÙ™™\•˜XÚÙ\”[™[
[™[˜[YJHÂˆÛÛœİ[™[ÈHÂˆØ]™YˆÙ[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÔ[™[[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÕÙÙÛWKˆÛÛ[[œÎˆÙ[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÔ[™[[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÕÙÙÛWKˆ[\ÎˆÙ[Ë›Ù™™\•˜XÚÙ\”[\Ô[™[[Ë›Ù™™\•˜XÚÙ\”[\ÕÙÙÛWBˆNÂˆÛÛœİ\™Ù]H[™[ÖÜ[™[˜[YWNÂˆYˆ
]\™Ù]]\™Ù]ÌJH™]\›ÂˆÛÛœİÚİ[Ü[ˆH\™Ù]ÌK˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠNÂˆØš™Xİ™[šY\Ê[™[ÊK™›Ü‘XXÚ

Û˜[YKÜ[™[]Û—WJHOˆÂˆYˆ
\[™[
H™]\›ÂˆÛÛœİÜ[ˆH˜[YHOOH[™[˜[YH	‰ˆÚİ[Ü[Âˆ[™[˜Û\ÜÓ\İÙÙÛJšY[ˆ‹[Ü[ŠNÂˆYˆ
]ÛŠH]Û‹œÙ]]šX]J˜\šXKY^[™Y‹Ü[ˆÈYHˆˆ™˜[ÙHŠNÂˆJNÂˆB‚ˆ[˜İ[ÛˆØ]™SÙ™™\•˜XÚÙ\”[\Ê
HÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ÈHÂˆYÚØÛÜ™NˆX]›Z[ŠLKX]›X^
X]œ›İ[™
[X™\Š[Ë›Ù™™\•˜XÚÙ\’YÚØÛÜ™K˜[YJHQUSÓÑ‘‘T—ÕPÒÑT—Ô•STËšYÚØÛÜ™JJJKˆİĞ[İ“X^ˆX]›X^
K[X™\Š[Ë›Ù™™\•˜XÚÙ\“İĞ[İ“X^˜[YJHQUSÓÑ‘‘T—ÕPÒÑT—Ô•STË›İĞ[İ“X^
BˆNÂˆØØ[İÜ˜YÙKœÙ]][JÑ‘‘T—ÕPÒÑT—Ô•ST×ÒÑVK”ÓÓ‹œİš[™ÚYJİ]K›Ù™™\“\İ˜XÚÙ\‹œ[\ÊJNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHNÂˆÙÙÛSÙ™™\•˜XÚÙ\”[™[
œ[\ÈŠNÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆB‚ˆ[˜İ[ÛˆØ]™SÙ™™\•˜XÚÙ\•šY]Ê
HÂˆÛÛœİ˜[YHHİš[™Ê[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]Ó˜[YK˜[YHˆŠKš[J
NÂˆYˆ
[˜[YJHÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJÙ™™\•˜XÚÙ\•^
‘[\ˆH˜[YH™Y›Ü™HØ]š[™È\ÈšY]Ëˆ‹¹/çykf:)á¹fï¹bcz+íùab9hjùa¦yd#yéì8à ˆŠJNÂˆ[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]Ó˜[YK™›Øİ\Ê
NÂˆ™]\›ÂˆBˆÛÛœİšY]ÈHÂˆYˆšY]ËIÑ]K››İÊ
_Xˆ˜[YKˆš[\œÎˆÂˆ‹‹œİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œËˆY\œÎˆÙ™™\•˜XÚÙ\”Ù[XİYY\œÊİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œÊKˆØ]YÛÜšY\ÎˆÙ™™\•˜XÚÙ\”Ù[XİYØ]YÛÜšY\Êİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œÊKˆ™]ÛÜšÜÎˆÙ™™\•˜XÚÙ\”Ù[XİY™]ÛÜšÜÊİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œÊBˆKˆÙX\˜Úˆİ]K›Ù™™\“\İ˜XÚÙ\‹œÙX\˜ÚˆšY]Îˆİ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÂˆNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]ÜÈHİšY]Ë‹‹œİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]Ü×KœÛXÙJ
NÂˆØØ[İÜ˜YÙKœÙ]][JÑ‘‘T—ÕPÒÑT—ÔĞU‘QÕ’QUÔ×ÒÑVK”ÓÓ‹œİš[™ÚYJİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]ÜÊJNÂˆ[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]Ó˜[YK˜[YHHˆÂˆ™[™\“Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÊ
NÂˆÙ]Ù™™\•˜XÚÙ\“›İXÙJÙ™™\•˜XÚÙ\•^
Ø]™YšY]È8 '	Û˜[Y_x 'K˜9mì¹/çykf:)á¹fï¸ '	Û˜[Y_x 'xà ˜
JNÂˆB‚ˆ\Ş[˜È[˜İ[Ûˆ[™SÙ™™\•˜XÚÙ\”Ø]™YšY]ÜĞÛXÚÊ]™[
HÂˆÛÛœİØY]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹[ØY]šY]×HŠNÂˆÛÛœİ[]P]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹Y[]K]šY]×HŠNÂˆYˆ
ØY]ÛŠHÂˆÛÛœİØ]™YHİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]ÜË™š[™

šY]ÊHOˆšY]ËšYOOHØY]Û‹™]\Ù]›Ù™™\•˜XÚÙ\“ØYšY]ÊNÂˆYˆ
\Ø]™Y
H™]\›ÂˆÛÛœİš[\œÈH›Ü›X[^™SÙ™™\•˜XÚÙ\‘š[\œÊØ]™Y™š[\œÈßJNÂˆYˆ
X]ØZ]ØYÙ™™\•˜XÚÙ\”˜[™ÙJš[\œÊJH™]\›Âˆİ]K›Ù™™\“\İ˜XÚÙ\‹™š[\œÈHš[\œÎÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÈHÈ‹‹™š[\œÈNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œÙX\˜ÚHØ]™YœÙX\˜ÚˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÈHØ]™YšY]ÈOOHœ›ÙXİÈˆÈœ›ÙXİÈˆˆ›Ù™™\œÈÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHNÂˆÙÙÛSÙ™™\•˜XÚÙ\”[™[
œØ]™YŠNÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆH[ÙHYˆ
[]P]ÛŠHÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]ÜÈHİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]ÜË™š[\Š
šY]ÊHOˆšY]ËšYOOH[]P]Û‹™]\Ù]›Ù™™\•˜XÚÙ\‘[]UšY]ÊNÂˆØØ[İÜ˜YÙKœÙ]][JÑ‘‘T—ÕPÒÑT—ÔĞU‘QÕ’QUÔ×ÒÑVK”ÓÓ‹œİš[™ÚYJİ]K›Ù™™\“\İ˜XÚÙ\‹œØ]™YšY]ÜÊJNÂˆ™[™\“Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÊ
NÂˆBˆB‚ˆ[˜İ[Ûˆ[™SÙ™™\•˜XÚÙ\”Ù[Xİ[ÛÚ[™ÙJ]™[
HÂˆÛÛœİ›İĞÚXÚØ›ŞH]™[\™Ù]˜ÛÜÙ\İ
‹›Ù™™\‹]˜XÚÙ\‹\›İË\Ù[XİŠNÂˆYˆ
›İĞÚXÚØ›Ş
HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆÛÛœİÙ^HH›İĞÚXÚØ›Ş™]\Ù]›Ù™™\•˜XÚÙ\’Ù^HˆÂˆÛÛœİØ\ÔÙ[XİYH˜XÚÙ\‹œÙ[XİYÙ^\Ëš\ÊÙ^JNÂˆYˆ
›İĞÚXÚØ›Ş˜ÚXÚÙY	‰ˆ]Ø\ÔÙ[XİY
HÂˆ˜XÚÙ\‹œÙ[XİYÙ^\Ë˜Y
Ù^JNÂˆ˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[
ÏHNÂˆH[ÙHYˆ
\›İĞÚXÚØ›Ş˜ÚXÚÙY	‰ˆØ\ÔÙ[XİY
HÂˆ˜XÚÙ\‹œÙ[XİYÙ^\Ë™[]JÙ^JNÂˆ˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[HX]›X^
˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[HJNÂˆBˆŞ[˜ÓÙ™™\•˜XÚÙ\”Ù[Xİ[Û•ZJ
NÂˆ™]\›ÂˆBˆÛÛœİ[ÚXÚØ›ŞH]™[\™Ù]˜ÛÜÙ\İ
‹›Ù™™\‹]˜XÚÙ\‹\Ù[XİX[ŠNÂˆYˆ
X[ÚXÚØ›Ş
H™]\›ÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆYˆ
P\œ˜^Kš\Ğ\œ˜^J˜XÚÙ\‹œ™[™\™Y›İÜÊJHÂˆŞ[˜ÓÙ™™\•˜XÚÙ\”Ù[Xİ[Û•ZJ
NÂˆ™]\›ÂˆBˆÛÛœİ›İÜÈH˜XÚÙ\‹œ™[™\™Y›İÜÎÂˆÛÛœİİ\H
˜XÚÙ\‹œYÙHHJH
ˆ˜XÚÙ\‹œYÙTÚ^™NÂˆÛÛœİYÙT›İÜÈH›İÜËœÛXÙJİ\İ\
È˜XÚÙ\‹œYÙTÚ^™JNÂˆÛÛœİ™]š[İ\ÔÙ[XİYÛİ[HYÙT›İÜËœ™YXÙJˆ
Ûİ[Ù™™\ŠHOˆÛİ[
È
˜XÚÙ\‹œÙ[XİYÙ^\Ëš\ÊÙ™™\’Ù^JÙ™™\ŠJHÈHˆ
Kˆˆ
NÂˆ˜XÚÙ\‹œÙ[XİYÙ^\ÈH\]SÙ™™\•˜XÚÙ\”›İÔÙ[Xİ[ÛŠYÙT›İÜË[ÚXÚØ›Ş˜ÚXÚÙY
NÂˆ˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[H[ÚXÚØ›Ş˜ÚXÚÙYˆÈ˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[
ÈYÙT›İÜË›[™İH™]š[İ\ÔÙ[XİYÛİ[ˆˆX]›X^
˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[H™]š[İ\ÔÙ[XİYÛİ[
NÂˆŞ[˜ÓÙ™™\•˜XÚÙ\”Ù[Xİ[Û•ZJ
NÂˆB‚ˆ[˜İ[ÛˆÙÙÛSÙ™™\•˜XÚÙ\‘š[\™YÙ[Xİ[ÛŠ
HÂˆÛÛœİ˜XÚÙ\ˆHİ]K›Ù™™\“\İ˜XÚÙ\ÂˆYˆ
P\œ˜^Kš\Ğ\œ˜^J˜XÚÙ\‹œ™[™\™Y›İÜÊJHÂˆŞ[˜ÓÙ™™\•˜XÚÙ\”Ù[Xİ[Û•ZJ
NÂˆ™]\›ÂˆBˆÛÛœİ›İÜÈH˜XÚÙ\‹œ™[™\™Y›İÜÎÂˆÛÛœİÚİ[Ù[XİH˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[OOH›İÜË›[™İÂˆ˜XÚÙ\‹œÙ[XİYÙ^\ÈH\]SÙ™™\•˜XÚÙ\”›İÔÙ[Xİ[ÛŠ›İÜËÚİ[Ù[Xİ
NÂˆ˜XÚÙ\‹œ™[™\™YÙ[XİYÛİ[HÚİ[Ù[XİÈ›İÜË›[™İˆÂˆŞ[˜ÓÙ™™\•˜XÚÙ\”Ù[Xİ[Û•ZJ
NÂˆB‚ˆ[˜İ[Ûˆ˜]šYØ][Û‘Ü›İ\›Ü”YÙJYÙJHÂˆYˆ
YÙHOOH™\Ú›Ø\™ˆYÙHOOH˜YÙ[ŠH™]\›ˆÛÜšÜÜXÙHÂˆYˆ
Èœ^[Y[È‹œÚY]È‹›[ÛK[™]Ë[Y\˜Ú[È‹Y\ˆ—Kš[˜ÛY\ÊYÙJJH™]\›ˆ›Y\˜Ú[ÈÂˆYˆ
ÈœX›\Ú\œÈ‹˜œ˜[™[YYXH‹œ™]™[YKY›İÈ—Kš[˜ÛY\ÊYÙJJH™]\›ˆ›YYXHÂˆYˆ
YÙHOOH™ÛÛÙÛKXYÈŠH™]\›ˆ™ÛÛÙÛKXYÈÂˆYˆ
È›Ù™™\‹[\İ]˜XÚÙ\ˆ‹˜Ø]YÛÜH—Kš[˜ÛY\ÊYÙJJH™]\›ˆœ›ÙXİÈÂˆ™]\›ˆÛÜšÜÜXÙHÂˆB‚ˆ[˜İ[Ûˆ˜]šYØ][Û‘Ü›İ\Ê
HÂˆYˆ
Y[Ëœš[X\TÚYX˜\ŠH™]\›ˆ×NÂˆ™]\›ˆ\œ˜^K™œ›ÛJ[Ëœš[X\TÚYX˜\‹œ]Y\TÙ[XİÜ[
‹›˜]‹YÜ›İ\Ù]K[˜]‹YÜ›İ\HŠJNÂˆB‚ˆ[˜İ[ÛˆÙ]˜]šYØ][Û‘Ü›İ\Ü[ŠÜ›İ\Ü[ŠHÂˆYˆ
YÜ›İ\
H™]\›ÂˆÛÛœİÙÙÛHHÜ›İ\œ]Y\TÙ[XİÜŠ–Ù]K[˜]‹YÜ›İ\]ÙÙÛWHŠNÂˆÛÛœİİX›˜]’YHÙÙÛH	‰ˆÙÙÛK™Ù]]šX]J˜\šXKXÛÛ›ÛÈŠNÂˆÛÛœİİX›˜]ˆHİX›˜]’YÈØİ[Y[™Ù][[Y[RY
İX›˜]’Y
Hˆ[ÂˆÜ›İ\˜Û\ÜÓ\İÙÙÛJš\Ë[Ü[ˆ‹›ÛÛX[ŠÜ[ŠJNÂˆYˆ
ÙÙÛJHÙÙÛKœÙ]]šX]J˜\šXKY^[™Y‹Ü[ˆÈYHˆˆ™˜[ÙHŠNÂˆYˆ
İX›˜]ŠHÂˆİX›˜]‹˜Û\ÜÓ\İÙÙÛJ˜ÛÛ\ÙY‹[Ü[ŠNÂˆİX›˜]‹œÙ]]šX]J˜\šXKZY[ˆ‹Ü[ˆÈ™˜[ÙHˆˆYHŠNÂˆBˆB‚ˆ[˜İ[ÛˆŞ[˜Ó˜]šYØ][Û‘Ü›İ\İ]JYÙHHİ]KœYÙJHÂˆÛÛœİİ\œ™[Ü›İ\˜[YHH˜]šYØ][Û‘Ü›İ\›Ü”YÙJYÙJNÂˆİ]K›˜]šYØ][Û“Ü[‘Ü›İ\Hİ\œ™[Ü›İ\˜[YNÂˆ˜]šYØ][Û‘Ü›İ\Ê
K™›Ü‘XXÚ

Ü›İ\
HOˆÂˆÛÛœİ\Ğİ\œ™[HÜ›İ\™]\Ù]›˜]‘Ü›İ\OOHİ\œ™[Ü›İ\˜[YNÂˆÛÛœİÙÙÛHHÜ›İ\œ]Y\TÙ[XİÜŠ–Ù]K[˜]‹YÜ›İ\]ÙÙÛWHŠNÂˆÜ›İ\˜Û\ÜÓ\İÙÙÛJš\ËXİ\œ™[‹\Ğİ\œ™[
NÂˆYˆ
ÙÙÛJHÙÙÛK˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\Ğİ\œ™[
NÂˆÙ]˜]šYØ][Û‘Ü›İ\Ü[ŠÜ›İ\\Ğİ\œ™[
NÂˆJNÂˆYˆ
[Ë™ÛÛÙÛPYÓ˜]ŠHÂˆ[Ë™ÛÛÙÛPYÓ˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹İ\œ™[Ü›İ\˜[YHOOH™ÛÛÙÛKXYÈŠNÂˆBˆB‚ˆ[˜İ[ÛˆÙÙÛS˜]šYØ][Û‘Ü›İ\
ÙÙÛJHÂˆÛÛœİÜ›İ\HÙÙÛH	‰ˆÙÙÛK˜ÛÜÙ\İ
‹›˜]‹YÜ›İ\Ù]K[˜]‹YÜ›İ\HŠNÂˆYˆ
YÜ›İ\
H™]\›Â‚ˆÛÛœİİ\œ™[Ü›İ\˜[YHH˜]šYØ][Û‘Ü›İ\›Ü”YÙJİ]KœYÙJNÂˆÛÛœİ\Ğİ\œ™[YÙQÜ›İ\HÜ›İ\™]\Ù]›˜]‘Ü›İ\OOHİ\œ™[Ü›İ\˜[YNÂˆÛÛœİ\ÓÜ[ˆHÙÙÛK™Ù]]šX]J˜\šXKY^[™YŠHOOHYHÂ‚ˆËÈÙY\Hİ\œ™[YÙIÜÈİX›Y[H]˜Z[X›H[[H\Ù\ˆÙ[XİÈ[›İ\ˆYÙK‚ˆYˆ
\Ğİ\œ™[YÙQÜ›İ\	‰ˆ\ÓÜ[ŠHÂˆÙ]˜]šYØ][Û‘Ü›İ\Ü[ŠÜ›İ\YJNÂˆİ]K›˜]šYØ][Û“Ü[‘Ü›İ\HÜ›İ\™]\Ù]›˜]‘Ü›İ\Âˆ™]\›ÂˆB‚ˆÛÛœİÚİ[Ü[ˆHZ\ÓÜ[ÂˆÙ]˜]šYØ][Û‘Ü›İ\Ü[ŠÜ›İ\Úİ[Ü[ŠNÂˆYˆ
Úİ[Ü[ŠHÂˆİ]K›˜]šYØ][Û“Ü[‘Ü›İ\HÜ›İ\™]\Ù]›˜]‘Ü›İ\ÂˆH[ÙHYˆ
İ]K›˜]šYØ][Û“Ü[‘Ü›İ\OOHÜ›İ\™]\Ù]›˜]‘Ü›İ\
HÂˆİ]K›˜]šYØ][Û“Ü[‘Ü›İ\H\Ğİ\œ™[YÙQÜ›İ\Èİ\œ™[Ü›İ\˜[YHˆˆÂˆBˆB‚ˆ[˜İ[ÛˆYÙP™[Û™ÜÕÑ\Ú›Ø\™
YÙJHÂˆ™]\›ˆYÙHOOH™\Ú›Ø\™ˆYÙHOOH˜YÙ[ÂˆB‚ˆ[˜İ[ÛˆYÙP™[Û™ÜÕÔ™\ÜÊYÙJHÂˆ™]\›ˆYÙHOOH˜Ø]YÛÜHˆYÙHOOHY\ˆÂˆB‚ˆ[˜İ[Ûˆ\]TYÙS[ÙPÛ\ÜÊYÙHHİ]KœYÙJHÂˆYˆ
YØİ[Y[˜›ÙJH™]\›ÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İÙÙÛJ™\Ú›Ø\™[[ÙH‹YÙP™[Û™ÜÕÑ\Ú›Ø\™
YÙJJNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İÙÙÛJ™\Ú›Ø\™XYÙ[[[ÙH‹YÙHOOH˜YÙ[ŠNÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İÙÙÛJY\‹\ØÜ›Û[[ÙH‹YÙHOOHY\ˆŠNÂˆB‚ˆ[˜İ[Ûˆ[Øš[Pİ\œ™[YÙSX™[

HÂˆYˆ
İ]KœYÙHOOHY\ˆŠH™]\›ˆİ]KœÙ[XİYY\”YÙH•Y\ˆHÂˆÛÛœİX™[ÈHÂˆ\Ú›Ø\™ˆ
›˜]‹˜Ú]›İ‹Ú]›İŠKˆYÙ[ˆ
›˜]‹˜YÙ[‹YÙ[ŠKˆ^[Y[Îˆ
›˜]‹œ^[Y[È‹”^[Y[ÈŠKˆX›\Ú\œÎˆ
›˜]‹œX›\Ú\œÈ‹”X›\Ú\œÈŠKˆ™ÛÛÙÛKXYÈˆ
›˜]‹™ÛÛÙÛPYÈ‹‘ÛÛÙÛHYÈŠKˆ˜œ˜[™[YYXHˆ
›˜]‹˜œ˜[™YYXH‹œ˜[™YYXHŠKˆœ™]™[YKY›İÈˆ
›˜]‹œ™]™[YQ›İÈ‹”™]™[YH›İÈŠKˆÚY]Îˆ
›˜]‹\™Ù]È‹•\™Ù]ÈŠKˆ›Ù™™\‹[\İ]˜XÚÙ\ˆˆ
›˜]‹›Ù™™\“\İ˜XÚÙ\ˆ‹“Ù™™\ˆ\İ˜XÚÙ\ˆŠKˆØ]YÛÜNˆ
›˜]‹˜Ø]YÛÜH‹Ø]YÛÜHŠKˆ›[ÛK[™]Ë[Y\˜Ú[Èˆ
›˜]‹›[ÛS™]ÓY\˜Ú[È‹“™]ÈY\˜Ú[ÈŠBˆNÂˆ™]\›ˆX™[ÖÜİ]KœYÙWH
›˜]‹™\Ú›Ø\™‹‘\Ú›Ø\™ŠNÂˆB‚ˆ[˜İ[Ûˆ\]S[Øš[Pİ\œ™[YÙJ
HÂˆYˆ
[Ë›[Øš[Pİ\œ™[YÙJHÂˆ[Ë›[Øš[Pİ\œ™[YÙK^ÛÛ[H[Øš[Pİ\œ™[YÙSX™[

NÂˆBˆB‚ˆ[˜İ[Ûˆ[Øš[S˜]šYØ][Û‘›Øİ\ØX›Q[[Y[Ê
HÂˆYˆ
Y[Ëœš[X\TÚYX˜\ŠH™]\›ˆ×NÂˆ™]\›ˆ\œ˜^K™œ›ÛJ[Ëœš[X\TÚYX˜\‹œ]Y\TÙ[XİÜ[
ˆ	ØVÚ™Y—K]Û››İ
Ù\ØX›YJK[œ]››İ
Ù\ØX›YJKÙ[Xİ››İ
Ù\ØX›YJK^\™XN››İ
Ù\ØX›YJKİXš[™^N››İ
İXš[™^H‹LH—JIÂˆ
JK™š[\Š
[[Y[
HOˆ[[Y[™Ù]ÛY[™XİÊ
K›[™İˆ	‰ˆ[[Y[™Ù]]šX]J˜\šXKZY[ˆŠHOOHYHŠNÂˆB‚ˆ[˜İ[ÛˆÙ][Øš[S˜]šYØ][Û“Ü[ŠÜ[‹È™\İÜ™Q›Øİ\ÈH˜[ÙHHHßJHÂˆYˆ
YØİ[Y[˜›ÙHY[Ëœš[X\TÚYX˜\ŠH™]\›ÂˆÛÛœİÛÛ\Xİ˜]šYØ][ÛˆH[Øš[S˜]šYØ][Û“YYXK›X]Ú\ÎÂˆÛÛœİÚİ[Ü[ˆH›ÛÛX[ŠÜ[ˆ	‰ˆÛÛ\Xİ˜]šYØ][ÛŠNÂˆÛÛœİØ\ÓÜ[ˆHØİ[Y[˜›ÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊ›˜]‹Y˜]Ù\‹[Ü[ˆŠNÂˆÛÛœİ›Øİ\ÕØ\Ò[œÚYHH[Ëœš[X\TÚYX˜\‹˜ÛÛZ[œÊØİ[Y[˜Xİ]™Q[[Y[
NÂ‚ˆYˆ
\Úİ[Ü[ˆ	‰ˆÛÛ\Xİ˜]šYØ][Ûˆ	‰ˆ›Øİ\ÕØ\Ò[œÚYH	‰ˆ[Ë›[Øš[S˜]•ÙÙÛJHÂˆ[Ë›[Øš[S˜]•ÙÙÛK™›Øİ\ÊÈ™]™[ØÜ›ÛˆYHJNÂˆH[ÙHYˆ
\Úİ[Ü[ˆ	‰ˆ™\İÜ™Q›Øİ\È	‰ˆØ\ÓÜ[ˆ	‰ˆÛÛ\Xİ˜]šYØ][Ûˆ	‰ˆ[Ë›[Øš[S˜]•ÙÙÛJHÂˆ[Ë›[Øš[S˜]•ÙÙÛK™›Øİ\ÊÈ™]™[ØÜ›ÛˆYHJNÂˆB‚ˆØİ[Y[˜›ÙK˜Û\ÜÓ\İÙÙÛJ›˜]‹Y˜]Ù\‹[Ü[ˆ‹Úİ[Ü[ŠNÂˆYˆ
[Ë›[Øš[S˜]•ÙÙÛJHÂˆ[Ë›[Øš[S˜]•ÙÙÛKœÙ]]šX]J˜\šXKY^[™Y‹Úİ[Ü[ˆÈYHˆˆ™˜[ÙHŠNÂˆB‚ˆYˆ
ÛÛ\Xİ˜]šYØ][ÛŠHÂˆ[Ëœš[X\TÚYX˜\‹œÙ]]šX]J˜\šXKZY[ˆ‹Úİ[Ü[ˆÈ™˜[ÙHˆˆYHŠNÂˆ[Ëœš[X\TÚYX˜\‹š[™\H\Úİ[Ü[ÂˆYˆ
[ËÛÜšÜÜXÙJHÂˆ[ËÛÜšÜÜXÙKš[™\HÚİ[Ü[ÂˆYˆ
Úİ[Ü[ŠHÂˆ[ËÛÜšÜÜXÙKœÙ]]šX]J˜\šXKZY[ˆ‹YHŠNÂˆH[ÙHÂˆ[ËÛÜšÜÜXÙKœ™[[İ™P]šX]J˜\šXKZY[ˆŠNÂˆBˆBˆH[ÙHÂˆ[Ëœš[X\TÚYX˜\‹œ™[[İ™P]šX]J˜\šXKZY[ˆŠNÂˆ[Ëœš[X\TÚYX˜\‹š[™\H˜[ÙNÂˆYˆ
[ËÛÜšÜÜXÙJHÂˆ[ËÛÜšÜÜXÙKš[™\H˜[ÙNÂˆ[ËÛÜšÜÜXÙKœ™[[İ™P]šX]J˜\šXKZY[ˆŠNÂˆBˆB‚ˆYˆ
Úİ[Ü[ˆ	‰ˆ[Ë›[Øš[S˜]ÛÜÙJHÂˆÚ[™İËœ™\]Y\İ[š[X][Û‘œ˜[YJ

HOˆÂˆYˆ
Øİ[Y[˜›ÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊ›˜]‹Y˜]Ù\‹[Ü[ˆŠJHÂˆ[Ë›[Øš[S˜]ÛÜÙK™›Øİ\ÊÈ™]™[ØÜ›ÛˆYHJNÂˆBˆJNÂˆBˆB‚ˆ[˜İ[ÛˆÛÜÙS[Øš[S˜]šYØ][ÛŠ™\İÜ™Q›Øİ\ÈH˜[ÙJHÂˆÙ][Øš[S˜]šYØ][Û“Ü[Š˜[ÙKÈ™\İÜ™Q›Øİ\ÈJNÂˆB‚ˆ[˜İ[ÛˆŞ[˜Ó[Øš[S˜]šYØ][Û“[ÙJ
HÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠ˜[ÙJNÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆB‚ˆ[˜İ[Ûˆ[™S[Øš[S˜]šYØ][Û’Ù^YİÛŠ]™[
HÂˆYˆ
[[Øš[S˜]šYØ][Û“YYXK›X]Ú\ÈYØİ[Y[˜›ÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊ›˜]‹Y˜]Ù\‹[Ü[ˆŠJHÂˆ™]\›ˆ˜[ÙNÂˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\HŠHÂˆ]™[œ™]™[Y˜][

NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ˆYNÂˆBˆYˆ
]™[šÙ^HOOH•XˆŠH™]\›ˆ˜[ÙNÂ‚ˆÛÛœİ›Øİ\ØX›HH[Øš[S˜]šYØ][Û‘›Øİ\ØX›Q[[Y[Ê
NÂˆYˆ
Y›Øİ\ØX›K›[™İ
HÂˆ]™[œ™]™[Y˜][

NÂˆ™]\›ˆYNÂˆBˆÛÛœİš\œİH›Øİ\ØX›VÌNÂˆÛÛœİ\İH›Øİ\ØX›VÙ›Øİ\ØX›K›[™İHWNÂˆYˆ
]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOHš\œİ
HÂˆ]™[œ™]™[Y˜][

NÂˆ\İ™›Øİ\Ê
NÂˆH[ÙHYˆ
Y]™[œÚYÙ^H	‰ˆØİ[Y[˜Xİ]™Q[[Y[OOH\İ
HÂˆ]™[œ™]™[Y˜][

NÂˆš\œİ™›Øİ\Ê
NÂˆBˆ™]\›ˆYNÂˆB‚ˆ[˜İ[Ûˆ[œİ\™T™]™[YQ›İÓ[Ù\›”›Ûİ

HÂˆÛÛœİ^\İ[™Ô›ÛİHØİ[Y[™Ù][[Y[RY
œ™]™[YQ›İÓ[Ù\›”›ÛİŠNÂˆYˆ
^\İ[™Ô›Ûİ
H™]\›ˆ^\İ[™Ô›ÛİÂˆYˆ
Y[Ëœ™]™[YQ›İÔYÙJH™]\›ˆ[ÂˆÛÛœİ›ÛİHØİ[Y[˜Ü™X]Q[[Y[
™]ˆŠNÂˆ›ÛİšYHœ™]™[YQ›İÓ[Ù\›”›ÛİÂˆ›Ûİ˜Û\ÜÓ˜[YHHšY[ˆÂˆ›ÛİœÙ]]šX]J™]K[[Ù\›‹\›Ûİ‹œ™]™[YKY›İÈŠNÂˆ[Ëœ™]™[YQ›İÔYÙK˜\[™Ú[
›Ûİ
NÂˆ™]\›ˆ›ÛİÂˆB‚ˆ[˜İ[ÛˆŞ[˜Ô™]™[YQ›İÓ[Ù\›”›Ûİ
›Ûİ
HÂˆYˆ
\›Ûİ
H™]\›ÂˆÛÛœİİ\œ™[Hİ]Kœ™]™[YQ›İÈßNÂˆÛÛœİœ˜[™YYXHHİ]K˜œ˜[™YYXHßNÂˆÛÛœİ[Ù\›œ˜[™YYXT›ÛİHØİ[Y[™Ù][[Y[RY
˜œ˜[™YYXS[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›œ˜[™YYXPÛÛ^H[Ù\›œ˜[™YYXT›ÛİÈ[Ù\›œ˜[™YYXT›Ûİ™]\Ù]ˆßNÂˆ]Ù[XİYH\œ˜^Kš\Ğ\œ˜^Jİ\œ™[›Y\˜Ú[ÊHÈİ\œ™[›Y\˜Ú[Èˆ×NÂˆYˆ
\Ù[XİY›[™İ	‰ˆİš[™Êİ\œ™[›Y\˜Ú[YˆŠKš[J
JHÂˆÙ[XİYHŞÂˆY\˜Ú[Yˆİ\œ™[›Y\˜Ú[Yˆ˜[YNˆİ\œ™[›Y\˜Ú[˜[YHİ\œ™[›Y\˜Ú[YˆWNÂˆBˆYˆ
\Ù[XİY›[™İ	‰ˆİš[™Êœ˜[™YYXK›Y\˜Ú[YˆŠKš[J
JHÂˆÙ[XİYHŞÂˆY\˜Ú[Yˆœ˜[™YYXK›Y\˜Ú[Yˆ˜[YNˆœ˜[™YYXK›Y\˜Ú[˜[YHœ˜[™YYXK›Y\˜Ú[YˆWNÂˆBˆYˆ
\Ù[XİY›[™İ	‰ˆİš[™Ê[Ù\›œ˜[™YYXPÛÛ^œ™]™[YQ›İÓY\˜Ú[YˆŠKš[J
JHÂˆÙ[XİYHŞÂˆY\˜Ú[Yˆ[Ù\›œ˜[™YYXPÛÛ^œ™]™[YQ›İÓY\˜Ú[Yˆ˜[YNˆ[Ù\›œ˜[™YYXPÛÛ^œ™]™[YQ›İÓY\˜Ú[˜[YH[Ù\›œ˜[™YYXPÛÛ^œ™]™[YQ›İÓY\˜Ú[YˆWNÂˆBˆÛÛœİÙY[ˆH™]ÈÙ]

NÂˆÛÛœİ›Ü›X[^™YHÙ[XİY›X\

Y\˜Ú[
HOˆ
ÂˆY\˜Ú[Yˆİš[™ÊY\˜Ú[	‰ˆ
Y\˜Ú[›Y\˜Ú[YY\˜Ú[šY
HˆŠKš[J
Kˆ˜[YNˆİš[™ÊY\˜Ú[	‰ˆ
Y\˜Ú[›˜[YHY\˜Ú[›Y\˜Ú[˜[YJHˆŠKš[J
KˆÛİ[ˆ[X™\ŠY\˜Ú[	‰ˆY\˜Ú[˜Ûİ[
BˆJJK™š[\Š
Y\˜Ú[
HOˆÂˆYˆ
[Y\˜Ú[›Y\˜Ú[YÙY[‹š\ÊY\˜Ú[›Y\˜Ú[Y
JH™]\›ˆ˜[ÙNÂˆÙY[‹˜Y
Y\˜Ú[›Y\˜Ú[Y
NÂˆYˆ
[Y\˜Ú[›˜[YJHY\˜Ú[›˜[YHHY\˜Ú[›Y\˜Ú[YÂˆ™]\›ˆYNÂˆJKœÛXÙJLŠNÂˆÛÛœİ\Ô™]™[YQ›İÔÙ[Xİ[ÛˆH\œ˜^Kš\Ğ\œ˜^Jİ\œ™[›Y\˜Ú[ÊH	‰ˆİ\œ™[›Y\˜Ú[Ë›[™İˆˆİš[™Êİ\œ™[›Y\˜Ú[YˆŠKš[J
NÂˆ›Ûİ™]\Ù]š[š]X[Y\˜Ú[ÈH”ÓÓ‹œİš[™ÚYJ›Ü›X[^™Y
NÂˆ›Ûİ™]\Ù]š[š]X[İ\]HHİš[™Êˆİ\œ™[œİ\]Bˆ
Z\Ô™]™[YQ›İÔÙ[Xİ[Û‚ˆÈœ˜[™YYXKœİ\]H[Ù\›œ˜[™YYXPÛÛ^œ™]™[YQ›İÔİ\]BˆˆˆŠBˆˆ‚ˆ
Kš[J
NÂˆ›Ûİ™]\Ù]š[š]X[[™]HHİš[™Êˆİ\œ™[™[™]Bˆ
Z\Ô™]™[YQ›İÔÙ[Xİ[Û‚ˆÈœ˜[™YYXK™[™]H[Ù\›œ˜[™YYXPÛÛ^œ™]™[YQ›İÑ[™]BˆˆˆŠBˆˆ‚ˆ
Kš[J
NÂˆB‚ˆ[˜İ[ÛˆİÚ]ÚYÙJYÙJHÂˆÛÛœİ™]š[İ\ÔYÙHHİ]KœYÙNÂˆYˆ
™]š[İ\ÔYÙHOOH›Ù™™\‹[\İ]˜XÚÙ\ˆˆ	‰ˆYÙHOOH›Ù™™\‹[\İ]˜XÚÙ\ˆŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJ›Ù™™\‹[\İ]˜XÚÙ\ˆŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆÙ™™\ˆ˜XÚÙ\ˆ[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞH˜XÚÙ\‹ˆ‹\œ›ÜŠNÂˆBˆYˆ
[Ë›Ù™™\“\İ˜XÚÙ\”YÙJH[Ë›Ù™™\“\İ˜XÚÙ\”YÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
›Ù™™\“\İ˜XÚÙ\“[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOHœ^[Y[Èˆ	‰ˆYÙHOOHœ^[Y[ÈŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJœ^[Y[ÈŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ^[Y[È[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞH^[Y[ÈYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[Ëœ^[Y[ÔYÙJH[Ëœ^[Y[ÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
œ^[Y[Ó[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOHœX›\Ú\œÈˆ	‰ˆYÙHOOHœX›\Ú\œÈŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJœX›\Ú\œÈŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆX›\Ú\œÈ[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞHX›\Ú\œÈYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[ËœX›\Ú\œÔYÙJH[ËœX›\Ú\œÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
œX›\Ú\œÓ[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOH˜œ˜[™[YYXHˆ	‰ˆYÙHOOH˜œ˜[™[YYXHŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJ˜œ˜[™[YYXHŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆœ˜[™YYXH[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞHœ˜[™YYXHYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[Ë˜œ˜[™YYXTYÙJH[Ë˜œ˜[™YYXTYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
˜œ˜[™YYXS[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOHœ™]™[YKY›İÈˆ	‰ˆYÙHOOHœ™]™[YKY›İÈŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJœ™]™[YKY›İÈŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ™]™[YH›İÈ[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞH™]™[YH›İÈYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[Ëœ™]™[YQ›İÔYÙJH[Ëœ™]™[YQ›İÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
œ™]™[YQ›İÓ[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOH›[ÛK[™]Ë[Y\˜Ú[Èˆ	‰ˆYÙHOOH›[ÛK[™]Ë[Y\˜Ú[ÈŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJ›[ÛK[™]Ë[Y\˜Ú[ÈŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ[ÛH™]ÈY\˜Ú[È[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞHYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[ÔYÙJH[Ë›[ÛS™]ÓY\˜Ú[ÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
›[ÛS™]ÓY\˜Ú[Ó[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOHœÚY]Èˆ	‰ˆYÙHOOHœÚY]ÈŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJœÚY]ÈŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ\™Ù]È[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞH\™Ù]ÈYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[ËœÚY]YÙJH[ËœÚY]YÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
œÚY][Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOH˜Ø]YÛÜHˆ	‰ˆYÙHOOH˜Ø]YÛÜHŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJ˜Ø]YÛÜHŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆØ]YÛÜH™\Ü[›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞHØ]YÛÜHYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[Ë˜Ø]YÛÜTYÙJH[Ë˜Ø]YÛÜTYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
˜Ø]YÛÜS[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
™]š[İ\ÔYÙHOOHY\ˆˆ	‰ˆYÙHOOHY\ˆŠHÂˆHÂˆYˆ
Ú[™İË“ÒWÓSÑT“—ĞT	‰ˆ\[ÙˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙHOOH™[˜İ[ÛˆŠHÂˆÚ[™İË“ÒWÓSÑT“—ĞT[›[İ[YÙJY\ˆŠNÂˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆY\ˆÚY][›[İ[˜Z[YÈÛÛ[Z[™ÈÚ]HYØXŞHY\ˆYÙKˆ‹\œ›ÜŠNÂˆBˆYˆ
[ËY\”YÙJH[ËY\”YÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
Y\“[Ù\›”›ÛİŠNÂˆYˆ
[Ù\›”›Ûİ
HÂˆ[]H[Ù\›”›Ûİ™]\Ù]›[İ[YY\Âˆ[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆBˆYˆ
YÙHOOH›[ÛK[™]Ë[Y\˜Ú[Èˆ	‰ˆİ]K›[ÛS™]ÓY\˜Ú[Ë™˜]Ù\“Ü[ŠHÂˆÛÜÙS[ÛS™]ÓY\˜Ú[˜]Ù\ŠÈ™\İÜ™Q›Øİ\Îˆ˜[ÙHJNÂˆBˆYˆ
YÙHOOH›[ÛK[™]Ë[Y\˜Ú[Èˆ	‰ˆİ]K›[ÛS™]ÓY\˜Ú[Ëš[\ÜÜ[ŠHÂˆÛÜÙS[ÛS™]ÓY\˜Ú[[\Ü
È™\İÜ™Q›Øİ\Îˆ˜[ÙHJNÂˆBˆYˆ
YÙHOOH˜œ˜[™[YYXHˆ	‰ˆİ]K˜œ˜[™YYXH	‰ˆİ]K˜œ˜[™YYXK˜Ú\^[™Y
HÂˆØœ˜[™YYXTÙ]Ú\^[™Y
˜[ÙJNÂˆBˆYˆ
YÙHOOHœ™]™[YKY›İÈˆ	‰ˆİ]Kœ™]™[YQ›İÈ	‰ˆİ]Kœ™]™[YQ›İË˜Ú\^[™Y
HÂˆÜ™]™[YQ›İÔÙ]Ú\^[™Y
˜[ÙJNÂˆBˆİ]KœYÙHHYÙNÂˆ\]TYÙS[ÙPÛ\ÜÊYÙJNÂˆYˆ
YÙHOOHY\ˆŠHÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆÛÜÙUY\”ÚY]İ™\›^JÈ™\İÜ™Q›Øİ\Îˆ˜[ÙHJNÂˆÛÜÙUY\“[İ™QX[ÙÊ
NÂˆBˆÛÛœİ\ÕY\ˆHYÙHOOHY\ˆÂˆÛÛœİ\ÔÚY]ÈHYÙHOOHœÚY]ÈÂˆÛÛœİ\ĞØ]YÛÜHHYÙHOOH˜Ø]YÛÜHÂˆÛÛœİ\ĞYÙ[HYÙHOOH˜YÙ[ÂˆÛÛœİ\Ó[ÛS™]ÓY\˜Ú[ÈHYÙHOOH›[ÛK[™]Ë[Y\˜Ú[ÈÂˆÛÛœİ\ÓÙ™™\“\İ˜XÚÙ\ˆHYÙHOOH›Ù™™\‹[\İ]˜XÚÙ\ˆÂˆÛÛœİ\Ô^[Y[ÈHYÙHOOHœ^[Y[ÈÂˆÛÛœİ\ÔX›\Ú\œÈHYÙHOOHœX›\Ú\œÈÂˆÛÛœİ\Ğœ˜[™YYXHHYÙHOOH˜œ˜[™[YYXHÂˆÛÛœİ\Ô™]™[YQ›İÈHYÙHOOHœ™]™[YKY›İÈÂˆÛÛœİ\ÑÛÛÙÛPYÈHYÙHOOH™ÛÛÙÛKXYÈÂˆØİ[Y[œ]Y\TÙ[XİÜ[
‹™\Ú›Ø\™\YÙHŠK™›Ü‘XXÚ

[
HOˆ[˜Û\ÜÓ\İÙÙÛJšY[ˆ‹YÙHOOH™\Ú›Ø\™ŠJNÂˆYˆ
[Ë™\Ú›Ø\™YÙ[YÙJH[Ë™\Ú›Ø\™YÙ[YÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ĞYÙ[
NÂˆYˆ
\ĞYÙ[
H™[™\YÙ[YÙUÙ[ÛÛYRY’YJ
NÂˆ[Ëœ^[Y[ÔYÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹YÙHOOHœ^[Y[ÈŠNÂˆ[ËœX›\Ú\œÔYÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹YÙHOOHœX›\Ú\œÈŠNÂˆYˆ
[Ë™ÛÛÙÛPYÔYÙJH[Ë™ÛÛÙÛPYÔYÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ÑÛÛÙÛPYÊNÂˆYˆ
[Ë˜œ˜[™YYXTYÙJH[Ë˜œ˜[™YYXTYÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\Ğœ˜[™YYXJNÂˆYˆ
[Ëœ™]™[YQ›İÔYÙJH[Ëœ™]™[YQ›İÔYÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\Ô™]™[YQ›İÊNÂˆ[Ë›[ÛS™]ÓY\˜Ú[ÔYÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\Ó[ÛS™]ÓY\˜Ú[ÊNÂˆYˆ
[Ë›Ù™™\“\İ˜XÚÙ\”YÙJH[Ë›Ù™™\“\İ˜XÚÙ\”YÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ÓÙ™™\“\İ˜XÚÙ\ŠNÂˆËÈ9é®ùo X›\Ú\œÈ:hmzgh¹¥íº` 9aî¹n ùl`9ï%º/¤yª(yo#ÂˆYˆ
YÙHOOHœX›\Ú\œÈˆ	‰ˆİ]KœX›\Ú\“^[İ]Y][™ÊHÂˆÙ^]X›\Ú\“^[İ]Y][ÙJ˜[ÙJNÂˆBˆ[ËœÚY]YÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ÔÚY]ÊNÂˆ[Ë˜Ø]YÛÜTYÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ĞØ]YÛÜJNÂˆ[ËY\”YÙK˜Û\ÜÓ\İÙÙÛJšY[ˆ‹Z\ÕY\ŠNÂˆYˆ
[Ë˜Ú]›İ˜]ŠH[Ë˜Ú]›İ˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹YÙHOOH™\Ú›Ø\™ŠNÂˆYˆ
[Ë˜YÙ[˜]ŠH[Ë˜YÙ[˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\ĞYÙ[
NÂˆ[Ëœ^[Y[Ó˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹YÙHOOHœ^[Y[ÈŠNÂˆ[ËœX›\Ú\œÓ˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹YÙHOOHœX›\Ú\œÈŠNÂˆYˆ
[Ë™ÛÛÙÛPYÓ˜]ŠH[Ë™ÛÛÙÛPYÓ˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\ÑÛÛÙÛPYÊNÂˆYˆ
[Ë˜œ˜[™YYXS˜]ŠH[Ë˜œ˜[™YYXS˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\Ğœ˜[™YYXJNÂˆYˆ
[Ëœ™]™[YQ›İÓ˜]ŠH[Ëœ™]™[YQ›İÓ˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\Ô™]™[YQ›İÊNÂˆ[Ë\™Ù]˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\ÔÚY]ÊNÂˆYˆ
[Ë›Ù™™\“\İ˜XÚÙ\“˜]ŠH[Ë›Ù™™\“\İ˜XÚÙ\“˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\ÓÙ™™\“\İ˜XÚÙ\ŠNÂˆ[Ë˜Ø]YÛÜS˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\ĞØ]YÛÜJNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó˜]‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\Ó[ÛS™]ÓY\˜Ú[ÊNÂˆ[ËY\“˜]]ÛœË™›Ü‘XXÚ

]ÛŠHOˆÂˆ]Û‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹\ÕY\ˆ	‰ˆ]Û‹™]\Ù]Y\”YÙHOOHİ]KœÙ[XİYY\”YÙJNÂˆJNÂˆŞ[˜Ó˜]šYØ][Û‘Ü›İ\İ]JYÙJNÂˆËÈ9b!ù£hºhmzgh¹¥íº!ê¹bª9§ 9l#ùc%¹¢`9§"zgg¹£ª9ä!¹.+yæ¡9­ìyn©¹b!¹§¤9­k¹ê¥ÂˆÙY\[™[Ë™›Ü‘XXÚ
[˜İ[Ûˆ

HÂˆYˆ
\›Z[š[Z^™Y	‰ˆ\˜X›ÜÛÛ›Û\ŠHÂˆÛZ[š[Z^™QY\[™[
šY
NÂˆBˆJNÂˆYˆ
\Ô^[Y[ÊHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
œ^[Y[Ó[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOHœ^[Y[È‚ˆ	‰ˆ[Ëœ^[Y[ÔYÙBˆ	‰ˆ[Ëœ^[Y[ÔYÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJœ^[Y[ÈŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJœ^[Y[È‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ^[Y[È[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH^[Y[ÈYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[Ëœ^[Y[ÔYÙJH[Ëœ^[Y[ÔYÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[Ëœ^[Y[ÔYÙJH[Ëœ^[Y[ÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆ^[Y[È[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH^[Y[ÈYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\”^[Y[ÔYÙJ
NÂˆYˆ
\İ]K›]™T^[Y[ÓØYY
H™Yœ™\Ú]˜[T^[Y[ÊÈÚ[[ˆYHJNÂˆBˆBˆYˆ
\ÔX›\Ú\œÊHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
œX›\Ú\œÓ[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOHœX›\Ú\œÈ‚ˆ	‰ˆ[ËœX›\Ú\œÔYÙBˆ	‰ˆ[ËœX›\Ú\œÔYÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJœX›\Ú\œÈŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJœX›\Ú\œÈ‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆX›\Ú\œÈ[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHX›\Ú\œÈYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[ËœX›\Ú\œÔYÙJH[ËœX›\Ú\œÔYÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[ËœX›\Ú\œÔYÙJH[ËœX›\Ú\œÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[ÛˆŠBˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆX›\Ú\œÈ[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHX›\Ú\œÈYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\”X›\Ú\œÔYÙJ
NÂˆBˆBˆYˆ
\Ğœ˜[™YYXJHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
˜œ˜[™YYXS[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOH˜œ˜[™[YYXH‚ˆ	‰ˆ[Ë˜œ˜[™YYXTYÙBˆ	‰ˆ[Ë˜œ˜[™YYXTYÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJ˜œ˜[™[YYXHŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJ˜œ˜[™[YYXH‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆœ˜[™YYXH[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHœ˜[™YYXHYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[Ë˜œ˜[™YYXTYÙJH[Ë˜œ˜[™YYXTYÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[Ë˜œ˜[™YYXTYÙJH[Ë˜œ˜[™YYXTYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆœ˜[™YYXH[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHœ˜[™YYXHYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\œ˜[™YYXTYÙJ
NÂˆBˆBˆYˆ
\Ô™]™[YQ›İÊHÂˆÛÛœİ[Ù\›”›ÛİH[œİ\™T™]™[YQ›İÓ[Ù\›”›Ûİ

NÂˆŞ[˜Ô™]™[YQ›İÓ[Ù\›”›Ûİ
[Ù\›”›Ûİ
NÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOHœ™]™[YKY›İÈ‚ˆ	‰ˆ[Ëœ™]™[YQ›İÔYÙBˆ	‰ˆ[Ëœ™]™[YQ›İÔYÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJœ™]™[YKY›İÈŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJœ™]™[YKY›İÈ‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ™]™[YH›İÈ[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH™]™[YH›İÈYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[Ëœ™]™[YQ›İÔYÙJH[Ëœ™]™[YQ›İÔYÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[Ëœ™]™[YQ›İÔYÙJH[Ëœ™]™[YQ›İÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆ™]™[YH›İÈ[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH™]™[YH›İÈYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\”™]™[YQ›İÔYÙJ
NÂˆBˆBˆYˆ
\ÑÛÛÙÛPYÊH™[™\‘ÛÛÙÛPYÔYÙJ
NÂˆYˆ
\ÔÚY]ÊHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
œÚY][Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOHœÚY]È‚ˆ	‰ˆ[ËœÚY]YÙBˆ	‰ˆ[ËœÚY]YÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJœÚY]ÈŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJœÚY]È‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ\™Ù]È[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH\™Ù]ÈYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[ËœÚY]YÙJH[ËœÚY]YÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[ËœÚY]YÙJH[ËœÚY]YÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆ\™Ù]È[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH\™Ù]ÈYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\”ÚY]YÙJ
NÂˆBˆBˆYˆ
\ĞØ]YÛÜJHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
˜Ø]YÛÜS[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOH˜Ø]YÛÜH‚ˆ	‰ˆ[Ë˜Ø]YÛÜTYÙBˆ	‰ˆ[Ë˜Ø]YÛÜTYÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJ˜Ø]YÛÜHŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJ˜Ø]YÛÜH‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆØ]YÛÜH™\Ü[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHØ]YÛÜHYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[Ë˜Ø]YÛÜTYÙJH[Ë˜Ø]YÛÜTYÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[Ë˜Ø]YÛÜTYÙJH[Ë˜Ø]YÛÜTYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆØ]YÛÜH™\Ü[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHØ]YÛÜHYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ[œİ\™Q\Ú›Ø\™Ø]YÛÜT™\Ü]J
NÂˆBˆBˆYˆ
\ÕY\ŠHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
Y\“[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆÛÛœİ™\]Y\İYY\ˆHİ]KœÙ[XİYY\”YÙH•Y\ˆHÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ™]\Ù]š[š]X[Y\ˆH™\]Y\İYY\ÂˆYˆ
ˆ™]š[İ\ÔYÙHOOHY\ˆ‚ˆ	‰ˆ[ËY\”YÙBˆ	‰ˆ[ËY\”YÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ	‰ˆ[Ù\›”›Ûİ™]\Ù]›[İ[YY\ˆOOH™\]Y\İYY\‚ˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆYˆ
ˆ™]š[İ\ÔYÙHOOHY\ˆ‚ˆ	‰ˆ[ËY\”YÙBˆ	‰ˆ[ËY\”YÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\[›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›\[›[İ[YÙJY\ˆŠNÂˆ[ËY\”YÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆ[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJY\ˆŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJY\ˆ‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆY\ˆÚY][˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHY\ˆYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[ËY\”YÙJH[ËY\”YÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
HÂˆ[Ù\›”›Ûİ™]\Ù]›[İ[YY\ˆH™\]Y\İYY\Âˆ[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆBˆH[ÙHÂˆYˆ
[ËY\”YÙJH[ËY\”YÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
HÂˆ[]H[Ù\›”›Ûİ™]\Ù]›[İ[YY\Âˆ[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆBˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆY\ˆÚY][˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHY\ˆYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÂˆBˆBˆYˆ
\Ó[ÛS™]ÓY\˜Ú[ÊHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
›[ÛS™]ÓY\˜Ú[Ó[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOH›[ÛK[™]Ë[Y\˜Ú[È‚ˆ	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[ÔYÙBˆ	‰ˆ[Ë›[ÛS™]ÓY\˜Ú[ÔYÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
[Ù\›\	‰ˆ\[Ùˆ[Ù\›\œÙ][™İXYÙHOOH™[˜İ[ÛˆŠHÂˆ[Ù\›\œÙ][™İXYÙJİ]K›[™İXYÙJNÂˆBˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJ›[ÛK[™]Ë[Y\˜Ú[ÈŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJ›[ÛK[™]Ë[Y\˜Ú[È‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆ[ÛH™]ÈY\˜Ú[È[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHYÙKˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[ÔYÙJH[Ë›[ÛS™]ÓY\˜Ú[ÔYÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[ÔYÙJH[Ë›[ÛS™]ÓY\˜Ú[ÔYÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆ[ÛH™]ÈY\˜Ú[È[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞHYÙKˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆØY[ÛS™]ÓY\˜Ú[Ê
NÂˆBˆBˆYˆ
\ÓÙ™™\“\İ˜XÚÙ\ŠHÂˆÛÛœİ[Ù\›”›ÛİHØİ[Y[™Ù][[Y[RY
›Ù™™\“\İ˜XÚÙ\“[Ù\›”›ÛİŠNÂˆÛÛœİ[Ù\›\HÚ[™İË“ÒWÓSÑT“—ĞTÂˆ][Ù\›“[İ[YH˜[ÙNÂˆ][Ù\›”YÙP]˜Z[X›HH˜[ÙNÂˆ]˜[˜XÚÕØ\›š[™ÔÚİÛˆH˜[ÙNÂˆYˆ
ˆ™]š[İ\ÔYÙHOOH›Ù™™\‹[\İ]˜XÚÙ\ˆ‚ˆ	‰ˆ[Ë›Ù™™\“\İ˜XÚÙ\”YÙBˆ	‰ˆ[Ë›Ù™™\“\İ˜XÚÙ\”YÙK˜Û\ÜÓ\İ˜ÛÛZ[œÊš\Ë[[Ù\›ˆŠBˆ	‰ˆ[Ù\›”›Ûİˆ	‰ˆ[[Ù\›”›Ûİ˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠBˆ
HÂˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆ™]\›ÂˆBˆHÂˆYˆ
ˆ[Ù\›”›Ûİˆ	‰ˆ[Ù\›\ˆ	‰ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ	‰ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
HÂˆ[Ù\›”YÙP]˜Z[X›HH›ÛÛX[Š[Ù\›\š\ÔYÙJ›Ù™™\‹[\İ]˜XÚÙ\ˆŠJNÂˆYˆ
[Ù\›”YÙP]˜Z[X›JHÂˆ[Ù\›“[İ[YH›ÛÛX[Š[Ù\›\›[İ[YÙJ›Ù™™\‹[\İ]˜XÚÙ\ˆ‹[Ù\›”›Ûİ
JNÂˆBˆBˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛKØ\›Š“[Ù\›ˆÙ™™\ˆ˜XÚÙ\ˆ[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH˜XÚÙ\‹ˆ‹\œ›ÜŠNÂˆ˜[˜XÚÕØ\›š[™ÔÚİÛˆHYNÂˆBˆYˆ
[Ù\›“[İ[Y
HÂˆYˆ
[Ë›Ù™™\“\İ˜XÚÙ\”YÙJH[Ë›Ù™™\“\İ˜XÚÙ\”YÙK˜Û\ÜÓ\İ˜Y
š\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆH[ÙHÂˆYˆ
[Ë›Ù™™\“\İ˜XÚÙ\”YÙJH[Ë›Ù™™\“\İ˜XÚÙ\”YÙK˜Û\ÜÓ\İœ™[[İ™Jš\Ë[[Ù\›ˆŠNÂˆYˆ
[Ù\›”›Ûİ
H[Ù\›”›Ûİ˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆYˆ
ˆ
ˆ[[Ù\›”YÙP]˜Z[X›Bˆ[[Ù\›\ˆ\[Ùˆ[Ù\›\š\ÔYÙHOOH™[˜İ[Ûˆ‚ˆ\[Ùˆ[Ù\›\›[İ[YÙHOOH™[˜İ[Ûˆ‚ˆ
Bˆ	‰ˆY˜[˜XÚÕØ\›š[™ÔÚİÛ‚ˆ
HÂˆÛÛœÛÛKØ\›Šˆ“[Ù\›ˆÙ™™\ˆ˜XÚÙ\ˆ[˜]˜Z[X›NÈÛÛ[Z[™ÈÚ]HYØXŞH˜XÚÙ\‹ˆ‹ˆ™]È\œ›ÜŠ“[Ù\›ˆœ›Û[™YÙHTH\È[˜]˜Z[X›HŠBˆ
NÂˆBˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆBˆBˆ\]S[Øš[Pİ\œ™[YÙJ
NÂˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJNÂˆB‚ˆ[˜İ[Ûˆ[š]

HÂˆİ]K›Q[˜X›YHÚ[™İË—×ÓÒWÓWÑSP“QOOH˜[ÙNÂˆİ]K˜YÙ[[˜X›YHÚ[™İË—×ÓÒWĞQÑS•ÑSP“QOOH˜[ÙNÂ‚ˆËÈ9ª(yo#ùb!ù£h‚ˆ[Ë˜Ú][ÙUÙÙÛHHØİ[Y[™Ù][[Y[RY
˜Ú][ÙUÙÙÛHŠNÂˆ[Ë›[ÙQ˜\İˆH[Ë˜Ú][ÙUÙÙÛOËœ]Y\TÙ[XİÜŠ	ÖÙ]K[[ÙOH™˜\İ—IÊNÂˆ[Ë›[ÙQY\ˆH[Ë˜Ú][ÙUÙÙÛOËœ]Y\TÙ[XİÜŠ	ÖÙ]K[[ÙOH™Y\—IÊNÂˆ[Ë˜Ú]ÙÜĞ]ÛˆHØİ[Y[™Ù][[Y[RY
˜Ú]ÙÜĞ]ÛˆŠNÂˆ[Ë˜Ú]ÙÜÓY[HHØİ[Y[™Ù][[Y[RY
˜Ú]ÙÜÓY[HŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑX[ÙÈHØİ[Y[™Ù][[Y[RY
˜[œİÙ\‘™YY˜XÚÑX[ÙÈŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ›Ü›HHØİ[Y[™Ù][[Y[RY
˜[œİÙ\‘™YY˜XÚÑ›Ü›HŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ]Z[HØİ[Y[™Ù][[Y[RY
˜[œİÙ\‘™YY˜XÚÑ]Z[ŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›ÜˆHØİ[Y[™Ù][[Y[RY
˜[œİÙ\‘™YY˜XÚÑ\œ›ÜˆŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚĞØ[˜Ù[HØİ[Y[™Ù][[Y[RY
˜[œİÙ\‘™YY˜XÚĞØ[˜Ù[ŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚĞÛÜÙHHØİ[Y[™Ù][[Y[RY
˜[œİÙ\‘™YY˜XÚĞÛÜÙHŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÔİX›Z]HØİ[Y[™Ù][[Y[RY
˜[œİÙ\‘™YY˜XÚÔİX›Z]ŠNÂ‚ˆ[Ë˜Ú]Y[[ÜP˜\ˆHØİ[Y[™Ù][[Y[RY
˜Ú]Y[[ÜP˜\ˆŠNÂˆ[Ë˜Ú]Y[[ÜPÚ\ÈHØİ[Y[™Ù][[Y[RY
˜Ú]Y[[ÜPÚ\ÈŠNÂ‚ˆYˆ
[ËY\ŠHš[Ù[Xİ
[ËY\‹[š\]YU˜[Y\ÊY\ˆŠJNÂˆYˆ
[Ë›™]ÛÜšÊHš[Ù[Xİ
[Ë›™]ÛÜšË[š\]YU˜[Y\Ê›™]ÛÜšÈŠJNÂˆYˆ
[Ë˜Ø]YÛÜJHš[Ù[Xİ
[Ë˜Ø]YÛÜK[š\]YPØ]YÛÜU˜[Y\Ê
JNÂˆ[š]X[^™SÙ™™\•˜XÚÙ\ÛÛ›ÛÊ
NÂˆ™Yœ™\Ú^[Y[š[\“Ü[ÛœÊ
NÂˆ™Yœ™\Ú\™Ù]š[\œÊ
NÂˆÙ]]\Ù]İ[\

NÂˆÙ]^[Y[İ[\
œØ]™Y‹\ÛÑ]JVSQS•ÕÑVJJNÂˆ™[™\‘\Ú›Ø\™Ø]YÛÜUY\”XÚÙ\Š
NÂˆŞ[˜Ñ\Ú›Ø\™Ø]YÛÜT™\ÜÛÛ›ÛÊ
NÂˆŞ[˜Ó˜]šYØ][Û‘Ü›İ\İ]Jİ]KœYÙJNÂˆİÚ]ÚYÙJİ]KœYÙJNÂˆŞ[˜Ó[Øš[S˜]šYØ][Û“[ÙJ
NÂˆ]ZXÚÔ›Û\Ë™›Ü‘XXÚ

ÈÙ^K›Û\JHOˆÂˆÛÛœİ]ÛˆHØİ[Y[˜Ü™X]Q[[Y[
˜]ÛˆŠNÂˆ]Û‹\HH˜]ÛˆÂˆ]Û‹™]\Ù]œ›Û\Ù^HHÙ^NÂˆ]Û‹™]\Ù]œ›Û\H›Û\Âˆ]Û‹^ÛÛ[H
Ù^K›Û\
NÂˆ]Û‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆ\T›Û\
›Û\
JNÂˆ[Ëœ]ZXÚĞXİ[ÛœË˜\[™Ú[
]ÛŠNÂˆJNÂ‚ˆÙ[ËY\‹[Ë›™]ÛÜšË[Ë˜Ø]YÛÜWK™š[\Š›ÛÛX[ŠK™›Ü‘XXÚ

Ù[Xİ
HOˆÂˆÙ[Xİ˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆİ]VÜÙ[XİšYœ™\XÙJ‘š[\ˆ‹ˆŠWHHÙ[Xİ˜[YNÂˆ™[™\[

NÂˆJNÂˆJNÂˆYˆ
[Ë›Z[‘\ÊH[Ë›Z[‘\Ë˜Y]™[\İ[™\Šš[œ]‹

HOˆÈİ]K›Z[‘\ÈH[Ë›Z[‘\Ë˜[YNÈ™[™\[

NÈJNÂˆYˆ
[Ë›Z[[İŠH[Ë›Z[[İ‹˜Y]™[\İ[™\Šš[œ]‹

HOˆÈİ]K›Z[[İˆH[Ë›Z[[İ‹˜[YNÈ™[™\[

NÈJNÂˆYˆ
[Ë›Z[İœŠH[Ë›Z[İœ‹˜Y]™[\İ[™\Šš[œ]‹

HOˆÈİ]K›Z[İœˆH[Ë›Z[İœ‹˜[YNÈ™[™\[

NÈJNÂˆYˆ
[Ë››İZYÛ›JH[Ë››İZYÛ›K˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]K››İZYÛ›HH[Ë››İZYÛ›K˜ÚXÚÙYÈ™[™\[

NÈJNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜUY\”XÚÙ\‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹[™Q\Ú›Ø\™Ø]YÛÜUY\Ú[™ÙJNÂˆËÈ9ea¹¢-ù/èy kù§"9.ïy."ù¢â{ï&º!ê¹k¦¹.byã®ùä ú)é¹cäy.©9.¤‚ˆØİ[Y[˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
JHÂˆÛÛœİšYÙÙ\ˆHK\™Ù]	‰ˆK\™Ù]˜ÛÜÙ\İÈK\™Ù]˜ÛÜÙ\İ
‹›[Û\XÚÙ\‹]šYÙÙ\ˆŠHˆ[ÂˆYˆ
šYÙÙ\ŠHÂˆÛÛœİÜ˜\HšYÙÙ\‹˜ÛÜÙ\İ
‹›[Û\XÚÙ\ˆŠNÂˆYˆ
Ü˜\
HÈKœ™]™[Y˜][

NÈKœİÜ›ÜYØ][ÛŠ
NÈÙÙÛS[ÛXÚÙ\ŠÜ˜\
NÈBˆ™]\›ÂˆBˆÛÛœİÜ[ÛˆHK\™Ù]	‰ˆK\™Ù]˜ÛÜÙ\İÈK\™Ù]˜ÛÜÙ\İ
‹›[Û\XÚÙ\‹[Ü[ÛˆŠHˆ[ÂˆYˆ
Ü[ÛŠHÂˆÛÛœİÜ˜\HÜ[Û‹˜ÛÜÙ\İ
‹›[Û\XÚÙ\ˆŠNÂˆYˆ
Ü˜\
HÈKœ™]™[Y˜][

NÈKœİÜ›ÜYØ][ÛŠ
NÈÙ[Xİ[ÛÜ[ÛŠÜ˜\Ü[Û‹™Ù]]šX]J™]K]˜[YHŠJNÈBˆ™]\›ÂˆBˆÛÜÙP[[ÛXÚÙ\œÊ
NÂˆJNÂˆØİ[Y[˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[˜İ[Ûˆ
JHÂˆYˆ
KšÙ^HOOH‘\ØØ\HŠHÈÛÜÙP[[ÛXÚÙ\œÊ
NÈ™]\›ÈBˆÛÛœİšYÙÙ\ˆHK\™Ù]	‰ˆK\™Ù]˜ÛÜÙ\İÈK\™Ù]˜ÛÜÙ\İ
‹›[Û\XÚÙ\‹]šYÙÙ\ˆŠHˆ[ÂˆYˆ
]šYÙÙ\ŠH™]\›ÂˆÛÛœİÜ˜\HšYÙÙ\‹˜ÛÜÙ\İ
‹›[Û\XÚÙ\ˆŠNÂˆYˆ
]Ü˜\
H™]\›ÂˆYˆ
KšÙ^HOOH‘[\ˆˆKšÙ^HOOHˆŠHÈKœ™]™[Y˜][

NÈÙÙÛS[ÛXÚÙ\ŠÜ˜\
NÈBˆ[ÙHYˆ
KšÙ^HOOH\œ›İÑİÛˆŠHÈKœ™]™[Y˜][

NÈÜ[“[ÛXÚÙ\ŠÜ˜\
NÈBˆJNÂˆËÈ9ea¹¢-ù/èy kù§"9.ïyb!ù£h»ï&¹.¢ù.í¹iå9¢f9£ez#­ÈÛÛ^Ûİ™\šY]È9."ù¢âBˆØİ[Y[˜Y]™[\İ[™\Š˜Ú[™ÙH‹\Ş[˜È[˜İ[Ûˆ
JHÂˆÛÛœİXÚÙ\ˆHK\™Ù]	‰ˆK\™Ù]˜ÛÜÙ\İÈK\™Ù]˜ÛÜÙ\İ
‹›Y\˜Ú[[[Û\XÚÙ\ˆŠHˆ[ÂˆYˆ
\XÚÙ\ŠH™]\›ÂˆÛÛœİÙ™™\ˆHÙ™™\SY\˜Ú[Y
XÚÙ\‹™Ù]]šX]J™]K[Y\˜Ú[ZYŠJNÂˆYˆ
[Ù™™\ŠH™]\›ÂˆÛÛœİØ\™\HHXÚÙ\‹™Ù]]šX]J™]KXØ\™ŠNÂˆÛÛœİ[ÛHXÚÙ\‹˜[YNÂˆÛÛœİÙ[XİY[ÛHXÚÙ\‹˜[YNÂˆYˆ
Ø\™\HOOH˜ÛÛ^ŠHÂˆÛÛœİ[ÛT›İÜÈH]ØZ]™]ÚY\˜Ú[[ÛT›İÜÊÙ™™\ŠNÂˆYˆ
[[ÛT›İÜÊH™]\›ÂˆYˆ
XÚÙ\‹˜[YHOOHÙ[XİY[Û
H™]\›Âˆ[Ëœ™XĞ›Şš[›™\’SH™[™\“Y\˜Ú[İ]ÊÙ™™\‹[ÛT›İÜË[Û
NÂˆËÈ9d#9«iHY\Ú[™İÈ9.+yd#9ea¹¢-ùæ¡Y\˜Ú[9© º)â;ï#9/çz+ày§"9.ïyb!ù£h¹. :!íˆÛÛœİZYHXÚÙ\‹™Ù]]šX]J™]K[Y\˜Ú[ZYŠNÂˆØİ[Y[œ]Y\TÙ[XİÜ[
‹™Y\XÛÛ^[İ™\šY]È™Y\[İ™\šY]ËX›ÙVÙ]K[Y\˜Ú[ZYHŠK™›Ü‘XXÚ
[˜İ[Ûˆ
›ÙJHÂˆYˆ
›ÙK™Ù]]šX]J™]K[Y\˜Ú[ZYŠHOOHZY
HÂˆ›ÙKš[›™\’SH™[™\“Y\˜Ú[İ]ÊÙ™™\‹[ÛT›İÜË[Û
NÂˆBˆJNÂˆH[ÙHYˆ
Ø\™\HOOH›İ™\šY]ÈŠHÂˆÛÛœİÛÛZ[™\ˆHXÚÙ\‹˜ÛÜÙ\İ
‹›Y\˜Ú[XØ\™ŠNÂˆYˆ
XÛÛZ[™\ŠH™]\›ÂˆÛÛœİ[ÛT›İÜÈH]ØZ]™]ÚY\˜Ú[[ÛT›İÜÊÙ™™\ŠNÂˆYˆ
[[ÛT›İÜÊH™]\›ÂˆYˆ
XÚÙ\‹˜[YHOOHÙ[XİY[Û
H™]\›ÂˆÛÛZ[™\‹š[›™\’SHY\˜Ú[İ™\šY]ĞØ\™[›™\ŠÙ™™\‹[ÛT›İÜË[ÛˆÛÛZ[™\‹™Ù]]šX]J™]KY^˜HŠHˆ‹ˆÛÛZ[™\‹™Ù]]šX]J™]K[[™İXYÙHŠH™\ÜÛœÙS[™İXYÙQ›ÜŠ
JNÂˆBˆJNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜTÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹

HOˆÂˆİ]K˜Ø]YÛÜT™\ÜÙX\˜Ú˜YH[Ë™\Ú›Ø\™Ø]YÛÜTÙX\˜Ú˜[YNÂˆÙ]\Ú›Ø\™Ø]YÛÜTÙX\˜Úİ]\Êˆİ]K˜Ø]YÛÜT™\ÜÙX\˜Ú˜YˆÈÚÛÜÙHHİYÙÙ\İ[ÛˆÜˆ™\ÜÈ[\ˆÈ\]HH™\Üˆ‚ˆˆÛX\ˆHšY[[™™\ÜÈ[\ˆÈÚİÈ[Ø]YÛÜšY\Ëˆ‚ˆ
NÂˆJNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜTÙX\˜Ú˜Y]™[\İ[™\Š˜Ú[™ÙH‹\Q\Ú›Ø\™Ø]YÛÜTÙ[Xİ[ÛŠNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜTÙX\˜Ú˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹
]™[
HOˆÂˆYˆ
]™[šÙ^HOOH‘[\ˆŠHÂˆ]™[œ™]™[Y˜][

NÂˆ\Q\Ú›Ø\™Ø]YÛÜTÙ[Xİ[ÛŠ
NÂˆBˆJNÂˆ[Ë˜Ø]YÛÜQ]P\K˜Y]™[\İ[™\Š˜ÛXÚÈ‹\PØ]YÛÜT™\Ü]T˜[™ÙJNÂˆÙ[Ë˜Ø]YÛÜTİ\]K[Ë˜Ø]YÛÜQ[™]WK™›Ü‘XXÚ

[œ]
HOˆÂˆ[œ]˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹
]™[
HOˆÂˆYˆ
]™[šÙ^HOOH‘[\ˆŠH\PØ]YÛÜT™\Ü]T˜[™ÙJ
NÂˆJNÂˆJNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜT™\Ü›ÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™Q\Ú›Ø\™Ø]YÛÜT™\ÜÛXÚÊNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜT™\Ü›ÙK˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[™Q\Ú›Ø\™Ø]YÛÜT™\ÜÙ^YİÛŠNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜT™\Ü›ÙK˜Y]™[\İ[™\ŠœÚ[\›[İ™H‹[™PØ]YÛÜTÚ[\“[İ™JNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜT™\Ü›ÙK˜Y]™[\İ[™\ŠœÚ[\›X]™H‹ÛX\Ø]YÛÜRYÚYÚ
NÂˆ[Ë™\Ú›Ø\™Ø]YÛÜT™\Ü›ÙK˜Y]™[\İ[™\Š™›Øİ\Ú[ˆ‹[™PØ]YÛÜQ›Øİ\ÊNÂˆ[Ë™\Ú›Ø\™Ø]YÛÜT™\Ü›ÙK˜Y]™[\İ[™\Š™›Øİ\Ûİ]‹ÛX\Ø]YÛÜRYÚYÚ
NÂˆYˆ
[Ë›[Øš[S˜]•ÙÙÛJHÂˆ[Ë›[Øš[S˜]•ÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÙ][Øš[S˜]šYØ][Û“Ü[ŠYJJNÂˆBˆYˆ
[Ë›[Øš[S˜]ÛÜÙJHÂˆ[Ë›[Øš[S˜]ÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJJNÂˆBˆYˆ
[Ë›˜]‘˜]Ù\˜XÚÙ›Ü
HÂˆ[Ë›˜]‘˜]Ù\˜XÚÙ›Ü˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙS[Øš[S˜]šYØ][ÛŠYJJNÂˆBˆYˆ
\[Ùˆ[Øš[S˜]šYØ][Û“YYXK˜Y]™[\İ[™\ˆOOH™[˜İ[ÛˆŠHÂˆ[Øš[S˜]šYØ][Û“YYXK˜Y]™[\İ[™\Š˜Ú[™ÙH‹Ş[˜Ó[Øš[S˜]šYØ][Û“[ÙJNÂˆH[ÙHYˆ
\[Ùˆ[Øš[S˜]šYØ][Û“YYXK˜Y\İ[™\ˆOOH™[˜İ[ÛˆŠHÂˆ[Øš[S˜]šYØ][Û“YYXK˜Y\İ[™\ŠŞ[˜Ó[Øš[S˜]šYØ][Û“[ÙJNÂˆBˆYˆ
[Ëœš[X\TÚYX˜\ŠHÂˆ[Ëœš[X\TÚYX˜\‹œ]Y\TÙ[XİÜ[
–Ù]K[˜]‹YÜ›İ\]ÙÙÛWHŠK™›Ü‘XXÚ

ÙÙÛJHOˆÂˆÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÙÙÛS˜]šYØ][Û‘Ü›İ\
ÙÙÛJJNÂˆJNÂˆBˆYˆ
[Ë˜Ú]›İ˜]ŠH[Ë˜Ú]›İ˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJ™\Ú›Ø\™ŠJNÂˆYˆ
[Ë˜YÙ[˜]ŠH[Ë˜YÙ[˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJ˜YÙ[ŠJNÂˆ[Ëœ^[Y[Ó˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJœ^[Y[ÈŠJNÂˆ[ËœX›\Ú\œÓ˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJœX›\Ú\œÈŠJNÂˆYˆ
[Ë™ÛÛÙÛPYÓ˜]ŠH[Ë™ÛÛÙÛPYÓ˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJ™ÛÛÙÛKXYÈŠJNÂˆØš[™ÛÛÙÛPYÔYÙR[\˜Xİ[ÛœÊ
NÂˆYˆ
[Ë˜œ˜[™YYXS˜]ŠH[Ë˜œ˜[™YYXS˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJ˜œ˜[™[YYXHŠJNÂˆØš[™œ˜[™YYXTYÙR[\˜Xİ[ÛœÊ
NÂˆYˆ
[Ëœ™]™[YQ›İÓ˜]ŠH[Ëœ™]™[YQ›İÓ˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJœ™]™[YKY›İÈŠJNÂˆØš[™™]™[YQ›İÔYÙR[\˜Xİ[ÛœÊ
NÂˆ[Ë\™Ù]˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJœÚY]ÈŠJNÂˆYˆ
[Ë›Ù™™\“\İ˜XÚÙ\“˜]ŠHÂˆ[Ë›Ù™™\“\İ˜XÚÙ\“˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJ›Ù™™\‹[\İ]˜XÚÙ\ˆŠJNÂˆBˆ[Ë˜Ø]YÛÜS˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJ˜Ø]YÛÜHŠJNÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Ó˜]ŠHÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó˜]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÚ]ÚYÙJ›[ÛK[™]Ë[Y\˜Ú[ÈŠJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\\Qš[\œÊH[Ë›Ù™™\•˜XÚÙ\\Qš[\œË˜Y]™[\İ[™\Š˜ÛXÚÈ‹\SÙ™™\•˜XÚÙ\‘š[\œÊNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”™\Ù]š[\œÊH[Ë›Ù™™\•˜XÚÙ\”™\Ù]š[\œË˜Y]™[\İ[™\Š˜ÛXÚÈ‹™\Ù]Ù™™\•˜XÚÙ\‘š[\œÊNÂˆÂˆ[Ë›Ù™™\•˜XÚÙ\˜”ÛXŞKˆ[Ë›Ù™™\•˜XÚÙ\”™]™[YTİ]\Ëˆ[Ë›Ù™™\•˜XÚÙ\”™]™[YTÛÜˆK™š[\Š›ÛÛX[ŠK™›Ü‘XXÚ

Ù[Xİ
HOˆÂˆÙ[Xİ˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÈH™XYÙ™™\•˜XÚÙ\‘˜Yš[\œÊ
NÂˆJNÂˆJNÂˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™›Ü‘XXÚ

ÛÛ™šYÊHOˆÂˆYˆ
ÛÛ™šYËÙÙÛJHÂˆÛÛ™šYËÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÙÙÛSÙ™™\•˜XÚÙ\“][TÙ[XİY[JÛÛ™šYÊJNÂˆBˆYˆ
ÛÛ™šYË›Y[JHÂˆÛÛ™šYË›Y[K˜Y]™[\İ[™\Š˜Ú[™ÙH‹
]™[
HOˆÂˆÛÛœİ[[œ]H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹X[HŠNÂˆÛÛœİ˜[YR[œ]H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹]˜[YWHŠNÂˆYˆ
X[[œ]	‰ˆ]˜[YR[œ]
H™]\›ÂˆYˆ
[[œ]
HÂˆÛÛ™šYË›Y[Kœ]Y\TÙ[XİÜ[
–Ù]K[Ù™™\‹]˜XÚÙ\‹Yš[\‹]˜[YWHŠK™›Ü‘XXÚ

[œ]
HOˆÂˆ[œ]˜ÚXÚÙYH˜[ÙNÂˆJNÂˆBˆİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÈH™XYÙ™™\•˜XÚÙ\‘˜Yš[\œÊ
NÂˆŞ[˜ÓÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ›Û
ÛÛ™šYÊNÂˆJNÂˆBˆJNÂˆØİ[Y[˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™›Ü‘XXÚ

ÛÛ™šYÊHOˆÂˆYˆ
ÛÛ™šYËœ›Ûİ	‰ˆXÛÛ™šYËœ›Ûİ˜ÛÛZ[œÊ]™[\™Ù]
JHÂˆÙÙÛSÙ™™\•˜XÚÙ\“][TÙ[XİY[JÛÛ™šYË˜[ÙJNÂˆBˆJNÂˆJNÂˆÙ[Ë›Ù™™\•˜XÚÙ\”İ\]K[Ë›Ù™™\•˜XÚÙ\‘[™]K[Ë›Ù™™\•˜XÚÙ\“Z[[İ‹[Ë›Ù™™\•˜XÚÙ\“X^[İ‹[Ë›Ù™™\•˜XÚÙ\“Z[ÛÛ[Z\ÜÚ[Û‹[Ë›Ù™™\•˜XÚÙ\“X^ÛÛ[Z\ÜÚ[Û—K™š[\Š›ÛÛX[ŠK™›Ü‘XXÚ

[œ]
HOˆÂˆ[œ]˜Y]™[\İ[™\Šš[œ]‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÈH™XYÙ™™\•˜XÚÙ\‘˜Yš[\œÊ
NÂˆJNÂˆYˆ
[œ]\HOOH™]HŠHÂˆ[œ]˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™˜Yš[\œÈH™XYÙ™™\•˜XÚÙ\‘˜Yš[\œÊ
NÂˆJNÂˆBˆJNÂˆÙ[Ë›Ù™™\•˜XÚÙ\”İ\]K[Ë›Ù™™\•˜XÚÙ\‘[™]K[Ë›Ù™™\•˜XÚÙ\“Z[[İ‹[Ë›Ù™™\•˜XÚÙ\“X^[İ‹[Ë›Ù™™\•˜XÚÙ\“Z[ÛÛ[Z\ÜÚ[Û‹[Ë›Ù™™\•˜XÚÙ\“X^ÛÛ[Z\ÜÚ[Û—K™š[\Š›ÛÛX[ŠK™›Ü‘XXÚ

[œ]
HOˆÂˆ[œ]˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹
]™[
HOˆÂˆYˆ
]™[šÙ^HOOH‘[\ˆŠH\SÙ™™\•˜XÚÙ\‘š[\œÊ
NÂˆJNÂˆJNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”ÙX\˜Ú
HÂˆ[Ë›Ù™™\•˜XÚÙ\”ÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œÙX\˜ÚH[Ë›Ù™™\•˜XÚÙ\”ÙX\˜Ú˜[YNÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHNÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\“Ù™™\œÕXŠHÂˆ[Ë›Ù™™\•˜XÚÙ\“Ù™™\œÕX‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÈH›Ù™™\œÈÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\”›ÙXİÕXŠHÂˆ[Ë›Ù™™\•˜XÚÙ\”›ÙXİÕX‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹šY]ÈHœ›ÙXİÈÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÕÙÙÛJH[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÕÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÙÙÛSÙ™™\•˜XÚÙ\”[™[
œØ]™YŠJNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÕÙÙÛJH[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÕÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÙÙÛSÙ™™\•˜XÚÙ\”[™[
˜ÛÛ[[œÈŠJNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”[\ÕÙÙÛJH[Ë›Ù™™\•˜XÚÙ\”[\ÕÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÙÙÛSÙ™™\•˜XÚÙ\”[™[
œ[\ÈŠJNÂˆYˆ
[Ë›Ù™™\“\İ˜XÚÙ\”YÙJHÂˆ[Ë›Ù™™\“\İ˜XÚÙ\”YÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆÛÛœİÛÜÙHH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹XÛÜÙWHŠNÂˆYˆ
ÛÜÙJHÙÙÛSÙ™™\•˜XÚÙ\”[™[
ÛÜÙK™]\Ù]›Ù™™\•˜XÚÙ\ÛÜÙJNÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÔ[™[
HÂˆ[Ë›Ù™™\•˜XÚÙ\ÛÛ[[œÔ[™[˜Y]™[\İ[™\Š˜Ú[™ÙH‹
]™[
HOˆÂˆÛÛœİ[œ]H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹XÛÛ[[—HŠNÂˆYˆ
Z[œ]
H™]\›Âˆİ]K›Ù™™\“\İ˜XÚÙ\‹š\ÚX›PÛÛ[[œÖÚ[œ]™]\Ù]›Ù™™\•˜XÚÙ\ÛÛ[[—HH[œ]˜ÚXÚÙYÂˆØØ[İÜ˜YÙKœÙ]][JÑ‘‘T—ÕPÒÑT—ĞÓÓSS”×ÒÑVK”ÓÓ‹œİš[™ÚYJİ]K›Ù™™\“\İ˜XÚÙ\‹š\ÚX›PÛÛ[[œÊJNÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ø]™T[\ÊH[Ë›Ù™™\•˜XÚÙ\”Ø]™T[\Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ø]™SÙ™™\•˜XÚÙ\”[\ÊNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”™\Ù][\ÊHÂˆ[Ë›Ù™™\•˜XÚÙ\”™\Ù][\Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆ[Ë›Ù™™\•˜XÚÙ\’YÚØÛÜ™K˜[YHHQUSÓÑ‘‘T—ÕPÒÑT—Ô•STËšYÚØÛÜ™NÂˆ[Ë›Ù™™\•˜XÚÙ\“İĞ[İ“X^˜[YHHQUSÓÑ‘‘T—ÕPÒÑT—Ô•STË›İĞ[İ“X^ÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ø]™UšY]ÊH[Ë›Ù™™\•˜XÚÙ\”Ø]™UšY]Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ø]™SÙ™™\•˜XÚÙ\•šY]ÊNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]Ó˜[YJHÂˆ[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]Ó˜[YK˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹
]™[
HOˆÂˆYˆ
]™[šÙ^HOOH‘[\ˆŠHØ]™SÙ™™\•˜XÚÙ\•šY]Ê
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÓ\İ
H[Ë›Ù™™\•˜XÚÙ\”Ø]™YšY]ÜÓ\İ˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™SÙ™™\•˜XÚÙ\”Ø]™YšY]ÜĞÛXÚÊNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\•X›RXY
H[Ë›Ù™™\•˜XÚÙ\•X›RXY˜Y]™[\İ[™\Š˜Ú[™ÙH‹[™SÙ™™\•˜XÚÙ\”Ù[Xİ[ÛÚ[™ÙJNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\•X›T›İÜÊH[Ë›Ù™™\•˜XÚÙ\•X›T›İÜË˜Y]™[\İ[™\Š˜Ú[™ÙH‹[™SÙ™™\•˜XÚÙ\”Ù[Xİ[ÛÚ[™ÙJNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y
H[Ë›Ù™™\•˜XÚÙ\”Ù[Xİ[š[\™Y˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÙÙÛSÙ™™\•˜XÚÙ\‘š[\™YÙ[Xİ[ÛŠNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\”YÙT™]ŠHÂˆ[Ë›Ù™™\•˜XÚÙ\”YÙT™]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHX]›X^
Kİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙHHJNÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\”YÙS™^
HÂˆ[Ë›Ù™™\•˜XÚÙ\”YÙS™^˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹œYÙH
ÏHNÂˆ™[™\“Ù™™\“\İ˜XÚÙ\”YÙJ
NÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^Ü
H[Ë›Ù™™\•˜XÚÙ\‘^Ü˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÛ›ØYÙ™™\•˜XÚÙ\•ÛÜšØ›ÛÚÊ˜[ÙJJNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜÙ[XİY
H[Ë›Ù™™\•˜XÚÙ\‘^ÜÙ[XİY˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆİÛ›ØYÙ™™\•˜XÚÙ\•ÛÜšØ›ÛÚÊYJJNÂˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜY\œÊHÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜY\œË˜Y]™[\İ[™\Š˜Ú[™ÙH‹
]™[
HOˆÂˆÛÛœİÙÙÛHH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹]Y\‹]ÙÙÛWHŠNÂˆÛÛœİ]X[]R[œ]H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹]Y\‹\]X[]WHŠNÂˆYˆ
ÙÙÛJHÂˆÛÛœİY\ˆHÙÙÛK™]\Ù]›Ù™™\•˜XÚÙ\•Y\•ÙÙÛNÂˆÛÛœİÛİ[ÈHÙ™™\•˜XÚÙ\•Y\Ûİ[Êİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜÊNÂˆÛÛœİÛÛ™šYÈHİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜY\”]X[]Y\ÖİY\—NÂˆYˆ
XÛÛ™šYÊH™]\›ÂˆÛÛ™šYË™[˜X›YHÙÙÛK˜ÚXÚÙYÂˆYˆ
ÛÛ™šYË™[˜X›Y	‰ˆÛÛ™šYËœ]X[]HOOH
HÛÛ™šYËœ]X[]HHÛİ[ÖİY\—NÂˆ™[™\“Ù™™\•˜XÚÙ\‘^ÜY\œÊ
NÂˆ™]\›ÂˆBˆYˆ
]X[]R[œ]
HÂˆÛÛœİY\ˆH]X[]R[œ]™]\Ù]›Ù™™\•˜XÚÙ\•Y\”]X[]NÂˆÛÛœİÛİ[ÈHÙ™™\•˜XÚÙ\•Y\Ûİ[Êİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜÛİ\˜ÙT›İÜÊNÂˆÛÛœİÛÛ™šYÈHİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜY\”]X[]Y\ÖİY\—NÂˆYˆ
XÛÛ™šYÊH™]\›ÂˆÛÛ™šYËœ]X[]HH›Ü›X[^™SÙ™™\•˜XÚÙ\•Y\”]X[]J]X[]R[œ]˜[YKÛİ[ÖİY\—JNÂˆ]X[]R[œ]˜[YHHÛÛ™šYËœ]X[]NÂˆ™[™\“Ù™™\•˜XÚÙ\‘^Ü™]šY]Ê
NÂˆBˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\ÊHÂˆ[Ë›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ë˜Y]™[\İ[™\Šš[œ]‹
]™[
HOˆÂˆÛÛœİİ\[œ]H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™\İ\HŠNÂˆÛÛœİ[™[œ]H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™Y[™HŠNÂˆÛÛœİÛÛÜ’[œ]H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹X˜XÚÙÜ›İ[™XÛÛÜ—HŠNÂˆÛÛœİ[œ]Hİ\[œ][™[œ]ÛÛÜ’[œ]ÂˆYˆ
Z[œ]
H™]\›ÂˆÛÛœİYH[X™\Šˆ[œ]™]\Ù]›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™İ\ˆ[œ]™]\Ù]›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™[™ˆ[œ]™]\Ù]›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™ÛÛÜ‚ˆ
NÂˆÛÛœİ˜[™ÙHHİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\Ë™š[™

][JHOˆ][KšYOOHY
NÂˆYˆ
\˜[™ÙJH™]\›ÂˆYˆ
İ\[œ]
H˜[™ÙKœİ\Hİ\[œ]˜[YNÂˆYˆ
[™[œ]
H˜[™ÙK™[™H[™[œ]˜[YNÂˆYˆ
ÛÛÜ’[œ]
HÂˆ˜[™ÙK˜ÛÛÜˆHÛÛÜ’[œ]˜[YKÕ\\Ø\ÙJ
NÂˆÛÛœİİ]]HÛÛÜ’[œ]œ\™[[[Y[œ]Y\TÙ[XİÜŠ›İ]]ŠNÂˆYˆ
İ]]
Hİ]]^ÛÛ[H˜[™ÙK˜ÛÛÜÂˆBˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJˆŠNÂˆJNÂˆ[Ë›Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆÛÛœİ™[[İ™P]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Ù™™\‹]˜XÚÙ\‹\™[[İ™KX˜XÚÙÜ›İ[™HŠNÂˆYˆ
\™[[İ™P]ÛŠH™]\›ÂˆÛÛœİYH[X™\Š™[[İ™P]Û‹™]\Ù]›Ù™™\•˜XÚÙ\”™[[İ™P˜XÚÙÜ›İ[™
NÂˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\ÈHİ]K›Ù™™\“\İ˜XÚÙ\‹™^Ü˜XÚÙÜ›İ[™˜[™Ù\Âˆ™š[\Š
˜[™ÙJHOˆ˜[™ÙKšYOOHY
NÂˆ™[™\“Ù™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\Ê
NÂˆÙ]Ù™™\•˜XÚÙ\‘^ÜX[ÙÓ›İXÙJˆŠNÂˆJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\Y˜XÚÙÜ›İ[™˜[™ÙJHÂˆ[Ë›Ù™™\•˜XÚÙ\Y˜XÚÙÜ›İ[™˜[™ÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹YÙ™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™ÙJNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙĞÛÜÙJHÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙĞÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÜÙSÙ™™\•˜XÚÙ\‘^ÜX[ÙÊNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙĞØ[˜Ù[
HÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙĞØ[˜Ù[˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÜÙSÙ™™\•˜XÚÙ\‘^ÜX[ÙÊNÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÔİX›Z]
HÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÔİX›Z]˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÛ™š\›SÙ™™\•˜XÚÙ\‘^Ü
NÂˆBˆYˆ
[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÊHÂˆ[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙË˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆYˆ
]™[\™Ù]OOH[Ë›Ù™™\•˜XÚÙ\‘^ÜX[ÙÊHÛÜÙSÙ™™\•˜XÚÙ\‘^ÜX[ÙÊ
NÂˆJNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Ó[Û
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[Û˜[YHHİ]K›[ÛS™]ÓY\˜Ú[Ë›[ÛÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[Û˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ü[“[ÛS™]ÓY\˜Ú[[ÛXÚÙ\ŠNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[Û˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹
]™[
HOˆÂˆYˆ
]™[šÙ^HOOH‘[\ˆˆ	‰ˆ]™[šÙ^HOOHˆŠH™]\›Âˆ]™[œ™]™[Y˜][

NÂˆÜ[“[ÛS™]ÓY\˜Ú[[ÛXÚÙ\Š
NÂˆJNÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ó[Û˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆÛÛœİ[ÛHİš[™Ê[Ë›[ÛS™]ÓY\˜Ú[Ó[Û˜[YHˆŠKš[J
NÂˆYˆ
[[Û[ÛOOHİ]K›[ÛS™]ÓY\˜Ú[Ë›[Û
H™]\›Âˆİ]K›[ÛS™]ÓY\˜Ú[Ë›[ÛH[ÛÂˆİ]K›[ÛS™]ÓY\˜Ú[Ëœ™XÛÜ™ÈH×NÂˆİ]K›[ÛS™]ÓY\˜Ú[Ë›ØYY[ÛHˆÂˆİ]K›[ÛS™]ÓY\˜Ú[Ë™\œ›ÜˆHˆÂˆÙ][ÛS™]ÓY\˜Ú[›İXÙJˆŠNÂˆØY[ÛS™]ÓY\˜Ú[ÊÈ›Ü˜ÙNˆYHJNÂˆJNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[ÔÙX\˜Ú
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[ÔÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹

HOˆÂˆİ]K›[ÛS™]ÓY\˜Ú[ËœÙX\˜ÚH[Ë›[ÛS™]ÓY\˜Ú[ÔÙX\˜Ú˜[YNÂˆ™[™\“[ÛS™]ÓY\˜Ú[ÔYÙJ
NÂˆJNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Y
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[Y˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÜ[“[ÛS™]ÓY\˜Ú[˜]Ù\Š
JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ü[“[ÛS™]ÓY\˜Ú[[\Ü
NÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\ÜÚÛÜÙJHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\ÜÚÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Üš[JH[Ë›[ÛS™]ÓY\˜Ú[[\Üš[K˜ÛXÚÊ
NÂˆJNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Üš[JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Üš[K˜Y]™[\İ[™\Š˜Ú[™ÙH‹[™S[ÛS™]ÓY\˜Ú[[\Üš[JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü[\]JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü[\]K˜Y]™[\İ[™\Š˜ÛXÚÈ‹İÛ›ØY[ÛS™]ÓY\˜Ú[[\]JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü™]šY]ÊHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü™]šY]Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹™]šY]Ó[ÛS™]ÓY\˜Ú[\İJNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\ÜØ]™JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\ÜØ]™K˜Y]™[\İ[™\Š˜ÛXÚÈ‹[\Ü[ÛS™]ÓY\˜Ú[›İÜÊNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\ÜÛÜÙJHÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\ÜÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙS[ÛS™]ÓY\˜Ú[[\Ü

JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\ÜØ[˜Ù[
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\ÜØ[˜Ù[˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙS[ÛS™]ÓY\˜Ú[[\Ü

JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›Ü
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›Ü˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆYˆ
]™[\™Ù]OOH[Ë›[ÛS™]ÓY\˜Ú[[\Ü˜XÚÙ›Ü
HÛÜÙS[ÛS™]ÓY\˜Ú[[\Ü

NÂˆJNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Ô›İÜÊHÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ô›İÜË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™S[ÛS™]ÓY\˜Ú[X›PÛXÚÊNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[›Ü›JHÂˆ[Ë›[ÛS™]ÓY\˜Ú[›Ü›K˜Y]™[\İ[™\ŠœİX›Z]‹İX›Z][ÛS™]ÓY\˜Ú[
NÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\ÛÜÙJHÂˆ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\ÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙS[ÛS™]ÓY\˜Ú[˜]Ù\Š
JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[Ø[˜Ù[
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[Ø[˜Ù[˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙS[ÛS™]ÓY\˜Ú[˜]Ù\Š
JNÂˆBˆYˆ
[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›Ü
HÂˆ[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›Ü˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆYˆ
]™[\™Ù]OOH[Ë›[ÛS™]ÓY\˜Ú[˜]Ù\˜XÚÙ›Ü
HÛÜÙS[ÛS™]ÓY\˜Ú[˜]Ù\Š
NÂˆJNÂˆBˆ[Ë\™Ù][ÛÙ[Xİ˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆİ]K\™Ù]š[\œË›[ÛH[Ë\™Ù][ÛÙ[Xİ˜[YNÂˆ™[™\”ÚY]YÙJ
NÂˆJNÂˆ[Ë\™Ù]ÛÛ\\™S[ÛÙ[Xİ˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆİ]K\™Ù]š[\œË˜ÛÛ\\™S[ÛH[Ë\™Ù]ÛÛ\\™S[ÛÙ[Xİ˜[YNÂˆ™[™\”ÚY]YÙJ
NÂˆJNÂˆ[Ë\™Ù]Y\‘š[\‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆİ]K\™Ù]š[\œËY\ˆH[Ë\™Ù]Y\‘š[\‹˜[YNÂˆ™[™\”ÚY]YÙJ
NÂˆJNÂˆ[ËY\“˜]]ÛœË™›Ü‘XXÚ

]ÛŠHOˆÂˆ]Û‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆİ]KœÙ[XİYY\”YÙHH]Û‹™]\Ù]Y\”YÙNÂˆİ]KœÙ[XİYY\”›İÒÙ^\Ë˜ÛX\Š
NÂˆÙ]Y\“[İ™Tİ]\ÊˆŠNÂˆİÚ]ÚYÙJY\ˆŠNÂˆJNÂˆJNÂˆ[ËY\ŒPY][ÛœÕÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ü[•Y\ŒPY][ÛœÓİ™\›^JNÂˆ[ËY\ŒPY][ÛœĞÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙUY\ŒPY][ÛœÓİ™\›^J
JNÂˆ[ËY\ŒPY][ÛœÔ[™[˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆYˆ
]™[\™Ù]OOH[ËY\ŒPY][ÛœÔ[™[
HÛÜÙUY\ŒPY][ÛœÓİ™\›^J
NÂˆJNÂˆ[ËY\ŒPYY\˜Ú[˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ü[•Y\ŒSY\˜Ú[X[ÙÊNÂˆ[ËY\ŒSY\˜Ú[ÙX\˜Ú›Ü›K˜Y]™[\İ[™\ŠœİX›Z]‹
]™[
HOˆÂˆ]™[œ™]™[Y˜][

NÂˆÙX\˜ÚY\ŒSY\˜Ú[Ê
NÂˆJNÂˆ[ËY\ŒSY\˜Ú[™\İ[Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆÛÛœİ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K]Y\ŒK[Y\˜Ú[ZYHŠNÂˆYˆ
X]Ûˆ]Û‹™\ØX›Y
H™]\›ÂˆÙ[XİY\ŒSY\˜Ú[
]Û‹™]\Ù]Y\ŒSY\˜Ú[Y
NÂˆJNÂˆ[ËY\ŒSY\˜Ú[˜XÚË˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÚİÕY\ŒSY\˜Ú[ÙX\˜Ú
NÂˆ[ËY\ŒSY\˜Ú[ÛÛ™š\›K˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÛ™š\›UY\ŒSY\˜Ú[Y
NÂˆ[ËY\ŒSY\˜Ú[Ø[˜Ù[˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙUY\ŒSY\˜Ú[X[ÙÊ
JNÂˆ[ËY\ŒSY\˜Ú[ÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙUY\ŒSY\˜Ú[X[ÙÊ
JNÂˆ[ËY\ŒSY\˜Ú[X[ÙË˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆYˆ
]™[\™Ù]OOH[ËY\ŒSY\˜Ú[X[ÙÊHÛÜÙUY\ŒSY\˜Ú[X[ÙÊ
NÂˆJNÂˆ[ËY\”ÚY]ÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹

HOˆÈİ]KY\”ÚY]š[\œËœÙX\˜ÚH[ËY\”ÚY]ÙX\˜Ú˜[YNÈ™\Ù]Y\•X›TYÙJ
NÈ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÈJNÂˆ[ËY\‘]P\K˜Y]™[\İ[™\Š˜ÛXÚÈ‹\UY\”™\Ü]T˜[™ÙJNÂˆÙ[ËY\”İ\]K[ËY\‘[™]WK™›Ü‘XXÚ

[œ]
HOˆÂˆ[œ]˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹
]™[
HOˆÂˆYˆ
]™[šÙ^HOOH‘[\ˆŠH\UY\”™\Ü]T˜[™ÙJ
NÂˆJNÂˆJNÂˆ[ËY\”ÚY]™]ÛÜšË˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]KY\”ÚY]š[\œË›™]ÛÜšÈH[ËY\”ÚY]™]ÛÜšË˜[YNÈ™\Ù]Y\•X›TYÙJ
NÈ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÈJNÂˆ[ËY\”ÚY]Ûİ[K˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]KY\”ÚY]š[\œË˜Ûİ[HH[ËY\”ÚY]Ûİ[K˜[YNÈ™\Ù]Y\•X›TYÙJ
NÈ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÈJNÂˆ[ËY\”ÚY]Z[‘\Ë˜Y]™[\İ[™\Šš[œ]‹

HOˆÈİ]KY\”ÚY]š[\œË›Z[‘\ÈH[ËY\”ÚY]Z[‘\Ë˜[YNÈ™\Ù]Y\•X›TYÙJ
NÈ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÈJNÂˆ[ËY\”ÚY]Z[”™]™[YK˜Y]™[\İ[™\Šš[œ]‹

HOˆÈİ]KY\”ÚY]š[\œË›Z[”™]™[YHH[ËY\”ÚY]Z[”™]™[YK˜[YNÈ™\Ù]Y\•X›TYÙJ
NÈ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÈJNÂˆ[ËY\”YÙT™]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÚ[™ÙUY\•X›TYÙJLJJNÂˆ[ËY\”YÙS™^˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÚ[™ÙUY\•X›TYÙJJJNÂˆ[ËY\ÛÛ[[•ÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆİ]KY\ÛÛ[[”[™[Ü[ˆH\İ]KY\ÛÛ[[”[™[Ü[Âˆ™[™\•Y\”YÙJİ]KœÙ[XİYY\”YÙJNÂˆJNÂˆ[ËY\ÛÛ[[“\İ˜Y]™[\İ[™\Š˜Ú[™ÙH‹
]™[
HOˆÂˆÛÛœİ[œ]H]™[\™Ù]˜ÛÜÙ\İ
š[œ]İ\OIØÚXÚØ›Ş	×HŠNÂˆÛÛœİÚY]HÚY]S˜[YJİ]KœÙ[XİYY\”YÙJNÂˆYˆ
Z[œ]\ÚY]
H™]\›ÂˆÛÛœİ[XY\œÈH\Ü^RXY\œÑ›Ü”ÚY]
ÚY]ÚY]šXY\œÈ×JNÂˆÛÛœİÙ[XİYH\œ˜^K™œ›ÛJ[ËY\ÛÛ[[“\İœ]Y\TÙ[XİÜ[
š[œ]İ\OIØÚXÚØ›Ş	×N˜ÚXÚÙYŠJBˆ›X\

ÚXÚØ›Ş
HOˆÚXÚØ›Ş˜[YJBˆ™š[\Š
XY\ŠHOˆ[XY\œËš[˜ÛY\ÊXY\ŠJNÂˆYˆ
\Ù[XİY›[™İ
HÂˆ[œ]˜ÚXÚÙYHYNÂˆ™]\›ÂˆBˆÙ]Y\•š\ÚX›RXY\œÊÚY]Ù[XİY
NÂˆJNÂˆ[ËY\ÛÛ[[ÛÜ™K˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆÛÛœİÚY]HÚY]S˜[YJİ]KœÙ[XİYY\”YÙJNÂˆYˆ
\ÚY]
H™]\›ÂˆÛÛœİ[XY\œÈH\Ü^RXY\œÑ›Ü”ÚY]
ÚY]ÚY]šXY\œÈ×JNÂˆÙ]Y\•š\ÚX›RXY\œÊÚY]ÛÜ™RXY\œÑ›Ü”ÚY]
ÚY][XY\œÊJNÂˆJNÂˆ[ËY\ÛÛ[[[˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆÛÛœİÚY]HÚY]S˜[YJİ]KœÙ[XİYY\”YÙJNÂˆYˆ
\ÚY]
H™]\›ÂˆÙ]Y\•š\ÚX›RXY\œÊÚY]\Ü^RXY\œÑ›Ü”ÚY]
ÚY]ÚY]šXY\œÈ×JJNÂˆJNÂˆ[ËœÚY]YÙS›İ\Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™U\™Ù]™\ÜÛXÚÊNÂˆ[ËœÚY]YÙS›İ\Ë˜Y]™[\İ[™\ŠœİX›Z]‹[™U\™Ù]™\ÜİX›Z]
NÂˆ[ËœÚY]YÙS›İ\Ë˜Y]™[\İ[™\ŠœÚ[\›İ™\ˆ‹[™U\™Ù]™[™Xİ]˜]JNÂˆ[ËœÚY]YÙS›İ\Ë˜Y]™[\İ[™\ŠœÚ[\›İ]‹[™U\™Ù]™[™XXİ]˜]JNÂˆ[ËœÚY]YÙS›İ\Ë˜Y]™[\İ[™\Š™›Øİ\Ú[ˆ‹[™U\™Ù]™[™Xİ]˜]JNÂˆ[ËœÚY]YÙS›İ\Ë˜Y]™[\İ[™\Š™›Øİ\Ûİ]‹[™U\™Ù]™[™XXİ]˜]JNÂˆYˆ
[ËœÚY]ÜšYXY
H[ËœÚY]ÜšYXY˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™T™\ÜÛÜÛXÚÊNÂˆ[ËY\”ÚY]XY˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™T™\ÜÛÜÛXÚÊNÂˆ[ËœX›\Ú\œÕX›RXY˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™T™\ÜÛÜÛXÚÊNÂˆ[ËY\”ÚY]XY˜Y]™[\İ[™\Š˜Ú[™ÙH‹[™UY\”Ù[Xİ[ÛÚ[™ÙJNÂˆ[ËY\”ÚY]›İÜË˜Y]™[\İ[™\Š˜Ú[™ÙH‹[™UY\”Ù[Xİ[ÛÚ[™ÙJNÂˆ[ËY\“[İ™TÙ[XİY˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ü[•Y\“[İ™QX[ÙÊNÂˆ[ËY\”™\Ù][İ™\Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹™\Ù]Y\“[İ™\ÊNÂˆ[ËY\“[İ™U\™Ù]Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆÛÛœİ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K]Y\‹[[İ™K]\™Ù]HŠNÂˆYˆ
X]Ûˆ]Û‹™\ØX›Y
H™]\›Âˆİ]KY\“[İ™U\™Ù]H]Û‹™]\Ù]Y\“[İ™U\™Ù]Âˆ™[™\•Y\“[İ™QX[ÙÊ
NÂˆJNÂˆ[ËY\“[İ™PÛÛ™š\›K˜Y]™[\İ[™\Š˜ÛXÚÈ‹[İ™TÙ[XİYY\”›İÜÊNÂˆ[ËY\“[İ™PØ[˜Ù[˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÜÙUY\“[İ™QX[ÙÊNÂˆ[ËY\“[İ™PÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÜÙUY\“[İ™QX[ÙÊNÂˆ[ËY\“[İ™QX[ÙË˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆYˆ
]™[\™Ù]OOH[ËY\“[İ™QX[ÙÊHÛÜÙUY\“[İ™QX[ÙÊ
NÂˆJNÂˆ[ËY\‘^[™˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ü[•Y\”ÚY]İ™\›^JNÂˆ[ËY\“İ™\›^PÛÜÙK˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙUY\”ÚY]İ™\›^J
JNÂˆ[ËœÚY]^[™Y˜XÚÙ›Ü˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÛÜÙUY\”ÚY]İ™\›^J
JNÂˆØİ[Y[˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹
]™[
HOˆÂˆYˆ
[™S[Øš[S˜]šYØ][Û’Ù^YİÛŠ]™[
JH™]\›ÂˆYˆ
˜\[ÛS™]ÓY\˜Ú[[\Ü›Øİ\Ê]™[
JH™]\›ÂˆYˆ
˜\[ÛS™]ÓY\˜Ú[˜]Ù\‘›Øİ\Ê]™[
JH™]\›ÂˆYˆ
˜\Y\ŒPY][ÛœÓİ™\›^Q›Øİ\Ê]™[
JH™]\›ÂˆYˆ
˜\Y\ŒSY\˜Ú[X[ÙÑ›Øİ\Ê]™[
JH™]\›ÂˆYˆ
]™[šÙ^HOOH‘\ØØ\HŠHÂˆÛÛœİÜ[‘š[\ˆHÙ™™\•˜XÚÙ\“][TÙ[XİÛÛ™šYÜÊ
K™š[™

ÛÛ™šYÊHOˆÛÛ™šYË›Y[H	‰ˆXÛÛ™šYË›Y[K˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠJNÂˆYˆ
Ü[‘š[\ŠHÂˆÙÙÛSÙ™™\•˜XÚÙ\“][TÙ[XİY[JÜ[‘š[\‹˜[ÙJNÂˆYˆ
Ü[‘š[\‹ÙÙÛJHÜ[‘š[\‹ÙÙÛK™›Øİ\Ê
NÂˆ™]\›ÂˆBˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\Hˆ	‰ˆİ]K›Ù™™\“\İ˜XÚÙ\‹™^ÜX[ÙÓÜ[ŠHÂˆÛÜÙSÙ™™\•˜XÚÙ\‘^ÜX[ÙÊ
NÂˆ™]\›ÂˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\Hˆ	‰ˆİ]K›[ÛS™]ÓY\˜Ú[Ëš[\ÜÜ[ŠHÂˆÛÜÙS[ÛS™]ÓY\˜Ú[[\Ü

NÂˆ™]\›ÂˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\Hˆ	‰ˆİ]K›[ÛS™]ÓY\˜Ú[Ë™˜]Ù\“Ü[ŠHÂˆÛÜÙS[ÛS™]ÓY\˜Ú[˜]Ù\Š
NÂˆ™]\›ÂˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\Hˆ	‰ˆİ]KY\ŒSX[˜YÙ[Y[œ[™[Ü[ŠHÂˆÛÜÙUY\ŒPY][ÛœÓİ™\›^J
NÂˆ™]\›ÂˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\Hˆ	‰ˆ[ËY\ŒSY\˜Ú[X[ÙÈ	‰ˆY[ËY\ŒSY\˜Ú[X[ÙË˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠJHÂˆÛÜÙUY\ŒSY\˜Ú[X[ÙÊ
NÂˆ™]\›ÂˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\Hˆ	‰ˆ[ËY\“[İ™QX[ÙÈ	‰ˆY[ËY\“[İ™QX[ÙË˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠJHÂˆÛÜÙUY\“[İ™QX[ÙÊ
NÂˆ™]\›ÂˆBˆYˆ
]™[šÙ^HOOH‘\ØØ\Hˆ	‰ˆİ]K™^[™YY\”ÚY]
HÛÜÙUY\”ÚY]İ™\›^J
NÂˆJNÂˆ[Ëœ^[Y[[Û˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]Kœ^[Y[Ë›[ÛH[Ëœ^[Y[[Û˜[YNÈ™[™\”^[Y[ÔYÙJ
NÈJNÂˆ[Ëœ^[Y[™]ÛÜšË˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]Kœ^[Y[Ë›™]ÛÜšÈH[Ëœ^[Y[™]ÛÜšË˜[YNÈ™[™\”^[Y[ÔYÙJ
NÈJNÂˆ[Ëœ^[Y[™YÚ[Û‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]Kœ^[Y[Ëœ™YÚ[ÛˆH[Ëœ^[Y[™YÚ[Û‹˜[YNÈ™[™\”^[Y[ÔYÙJ
NÈJNÂˆ[Ëœ^[Y[Y\‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]Kœ^[Y[ËY\ˆH[Ëœ^[Y[Y\‹˜[YNÈ™[™\”^[Y[ÔYÙJ
NÈJNÂˆ[Ëœ^[Y[İ]\Ë˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÈİ]Kœ^[Y[Ëœİ]\ÈH[Ëœ^[Y[İ]\Ë˜[YNÈ™[™\”^[Y[ÔYÙJ
NÈJNÂˆ[Ëœ^[Y[ÛÜ˜Y]™[\İ[™\Š˜Ú[™ÙH‹

HOˆÂˆİ]Kœ^[Y[ÛÜšÙ^HH[Ëœ^[Y[ÛÜ˜[YNÂˆİ]Kœ^[Y[ÛÜ™\™Xİ[ÛˆHİ]Kœ^[Y[ÛÜšÙ^HÈY˜][™\ÜÛÜ\™Xİ[ÛŠİ]Kœ^[Y[ÛÜšÙ^JHˆ˜\ØÈÂˆ™[™\”^[Y[ÔYÙJ
NÂˆJNÂˆ[Ëœ^[Y[ÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹

HOˆÈİ]Kœ^[Y[ËœÙX\˜ÚH[Ëœ^[Y[ÙX\˜Ú˜[YNÈ™[™\”^[Y[ÔYÙJ
NÈJNÂˆYˆ
[Ëœ^[Y[XY
H[Ëœ^[Y[XY˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™T™\ÜÛÜÛXÚÊNÂˆ[Ëœ^[Y[Ş[˜Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆ™Yœ™\Ú]˜[T^[Y[Ê
JNÂˆ[Ë›[™İXYÙUÙÙÛK˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÙÙÛS[™İXYÙJNÂˆYˆ
[Ëœ™\Ù]
H[Ëœ™\Ù]˜Y]™[\İ[™\Š˜ÛXÚÈ‹™\Ù]š[\œÊNÂˆ[Ë™İÛ›ØY˜Y]™[\İ[™\Š˜ÛXÚÈ‹İÛ›ØYš[\™YŞ
NÂˆËÈ8¥ 8¥ İ™\šY]È9b!ù£hˆÈ9¢¦9cè8¥ 8¥ ˆ[ËœX›\Ú\“X\šÙ]İ[[X\K˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
JHÂˆ˜\ˆÙÙÛPˆHK\™Ù]˜ÛÜÙ\İ
‹›İ™\šY]Ë]ÙÙÛKXˆŠNÂˆYˆ
ÙÙÛPŠHÂˆ˜\ˆ\HHÙÙÛP‹™Ù]]šX]J™]K[İ™\šY]Ë]\HŠNÂˆYˆ
\H	‰ˆ\HOOHİ]KœX›\Ú\“İ™\šY]Õ\JHÂˆİ]KœX›\Ú\“İ™\šY]Õ\HH\NÂˆ[ËœX›\Ú\“X\šÙ]İ[[X\Kœ]Y\TÙ[XİÜ[
‹›İ™\šY]Ë]ÙÙÛKXˆŠK™›Ü‘XXÚ
[˜İ[Ûˆ
ŠHÂˆ‹˜Û\ÜÓ\İÙÙÛJ˜Xİ]™H‹‹™Ù]]šX]J™]K[İ™\šY]Ë]\HŠHOOH\JNÂˆJNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆBˆ™]\›ÂˆBˆ˜\ˆÚ]œ›ÛˆHK\™Ù]˜ÛÜÙ\İ
‹›İ™\šY]ËXÚ]œ›ÛˆŠNÂˆYˆ
Ú]œ›ÛŠHÂˆİ]KœX›\Ú\“İ™\šY]Ñ^[™YH\İ]KœX›\Ú\“İ™\šY]Ñ^[™YÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆ™]\›ÂˆBˆ˜\ˆ˜XÚĞˆHK\™Ù]˜ÛÜÙ\İ
–Ù]K[İ™\šY]ËX˜XÚ×HŠNÂˆYˆ
˜XÚĞŠHÂˆİ]KœX›\Ú\“İ™\šY]Ñ›Øİ\ÈHˆÂˆËÈ9d#9¥íºaãyïk¹."ù¢âyëfú`"Bˆ˜\ˆİ™\šY]Õ\HHİ]KœX›\Ú\“İ™\šY]Õ\H›X\šÙ]ÂˆYˆ
İ™\šY]Õ\HOOH›™]ÛÜšÈŠHÂˆİ]KœX›\Ú\“™]ÛÜšÈH˜[ÂˆYˆ
[ËœX›\Ú\“™]ÛÜšÑš[\ŠH[ËœX›\Ú\“™]ÛÜšÑš[\‹˜[YHH˜[ÂˆH[ÙHÂˆİ]KœX›\Ú\“X\šÙ]H˜[ÂˆYˆ
[ËœX›\Ú\“X\šÙ]š[\ŠH[ËœX›\Ú\“X\šÙ]š[\‹˜[YHH˜[ÂˆBˆ™[™\”X›\Ú\œÔYÙJ
NÂˆ™]\›ÂˆBˆJNÂˆËÈ8¥ 8¥ 9§ìyâ­¹fï¹¢¦9cè8¥ 8¥ ˆYˆ
[ËœX›\Ú\œĞÚ\Ú]œ›ÛŠHÂˆ[ËœX›\Ú\œĞÚ\Ú]œ›Û‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
JHÂˆİ]KœX›\Ú\Ú\^[™YH\İ]KœX›\Ú\Ú\^[™YÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆKœİÜ›ÜYØ][ÛŠ
NÂˆJNÂˆBˆ[ËœX›\Ú\“™]ÛÜšÑš[\‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\“™]ÛÜšÈH[ËœX›\Ú\“™]ÛÜšÑš[\‹˜[YNÂˆİ]KœX›\Ú\“İ™\šY]Ñ›Øİ\ÈHİ]KœX›\Ú\“™]ÛÜšÈOOH˜[ˆÈˆˆˆİ]KœX›\Ú\“™]ÛÜšÎÂˆËÈ:!ê¹bª9b!ù£h¹b,™]ÛÜšÈ:)á¹fï‚ˆYˆ
İ]KœX›\Ú\“™]ÛÜšÈOOH˜[ˆ	‰ˆİ]KœX›\Ú\“İ™\šY]Õ\HOOH›™]ÛÜšÈŠHÂˆİ]KœX›\Ú\“İ™\šY]Õ\HH›™]ÛÜšÈÂˆBˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆ[ËœX›\Ú\“[šÕ\Qš[\‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\“[šÕ\HH[ËœX›\Ú\“[šÕ\Qš[\‹˜[YNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆ[ËœX›\Ú\”İ\]K˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\”İ\]HH[ËœX›\Ú\”İ\]K˜[YNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆ[ËœX›\Ú\‘[™]K˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\‘[™]HH[ËœX›\Ú\‘[™]K˜[YNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆ[ËœX›\Ú\“X\šÙ]š[\‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\“X\šÙ]H[ËœX›\Ú\“X\šÙ]š[\‹˜[YNÂˆİ]KœX›\Ú\“İ™\šY]Ñ›Øİ\ÈHİ]KœX›\Ú\“X\šÙ]OOH˜[ˆÈˆˆˆİ]KœX›\Ú\“X\šÙ]ÂˆËÈ:!ê¹bª9b!ù£h¹b,X\šÙ]:)á¹fï‚ˆYˆ
İ]KœX›\Ú\“X\šÙ]OOH˜[ˆ	‰ˆİ]KœX›\Ú\“İ™\šY]Õ\HOOH›X\šÙ]ŠHÂˆİ]KœX›\Ú\“İ™\šY]Õ\HH›X\šÙ]ÂˆBˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆYˆ
[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú
HÂˆ[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú˜Y]™[\İ[™\Š™›Øİ\È‹ÜÚİÔX›\Ú\”Ù[XİÜ‘›ÜİÛŠNÂˆ[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹ÜÚİÔX›\Ú\”Ù[XİÜ‘›ÜİÛŠNÂˆ[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[˜İ[Ûˆ
]™[
HÂˆYˆ
]™[šÙ^HOOH‘[\ˆŠHÂˆ˜\ˆš\œİÜ[ÛˆH[ËœX›\Ú\”Ù[XİÜ‘›ÜİÛˆ	‰‚ˆ[ËœX›\Ú\”Ù[XİÜ‘›ÜİÛ‹œ]Y\TÙ[XİÜŠ–Ù]K\X›\Ú\‹ZYHŠNÂˆYˆ
š\œİÜ[ÛŠHÂˆ]™[œ™]™[Y˜][

NÂˆš\œİÜ[Û‹˜ÛXÚÊ
NÂˆBˆH[ÙHYˆ
]™[šÙ^HOOH‘\ØØ\HŠHÂˆ˜\ˆÙ[XİYHÜX›\Ú\RY
ÜX›\Ú\œĞØXÚKİ]KœX›\Ú\”Ù[XİYY
NÂˆ[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú˜[YHHÙ[XİYˆÈ
Ù[XİY\Ù\“˜[YHİš[™ÊÙ[XİY\Ù\’Y
JBˆˆˆÂˆÚYTX›\Ú\”Ù[XİÜ‘›ÜİÛŠ
NÂˆBˆJNÂˆ[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú˜Y]™[\İ[™\Š˜›\ˆ‹[˜İ[Ûˆ

HÂˆÙ][Y[İ]
[˜İ[Ûˆ

HÂˆ˜\ˆÙ[XİYHÜX›\Ú\RY
ÜX›\Ú\œĞØXÚKİ]KœX›\Ú\”Ù[XİYY
NÂˆYˆ
Ù[XİY
HÂˆ[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú˜[YHHÙ[XİY\Ù\“˜[YHİš[™ÊÙ[XİY\Ù\’Y
NÂˆBˆÚYTX›\Ú\”Ù[XİÜ‘›ÜİÛŠ
NÂˆKN
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\”Ù[XİÜ‘›ÜİÛŠHÂˆ[ËœX›\Ú\”Ù[XİÜ‘›ÜİÛ‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆ˜\ˆÜ[ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K\X›\Ú\‹ZYHŠNÂˆYˆ
[Ü[ÛŠH™]\›Âˆ˜\ˆX›\Ú\ˆHÜX›\Ú\RY
ÜX›\Ú\œĞØXÚKÜ[Û‹™Ù]]šX]J™]K\X›\Ú\‹ZYŠJNÂˆYˆ
\X›\Ú\ŠH™]\›ÂˆÜÙ]Ù[XİYX›\Ú\ŠX›\Ú\ŠNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\ÛX\”Ù[Xİ[ÛŠHÂˆ[ËœX›\Ú\ÛX\”Ù[Xİ[Û‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆÜÙ]Ù[XİYX›\Ú\Š[
NÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆËÈ9îãùä!¹îá9d"9¨a»ï&º/¤ùaiz/áù®é
È9clù¥í¹®,¹§äÂˆ[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\“X[˜YÙ\”ÙX\˜ÚH[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜[YNÂˆÜÚİÓX[˜YÙ\‘›ÜİÛŠ
NÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆ[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜Y]™[\İ[™\Š™›Øİ\È‹[˜İ[Ûˆ

HÂˆÜ™XZ[X[˜YÙ\“Ü[ÛœÊ
ÜX›\Ú\œĞØXÚHßJKœX›\Ú\œÊNÂˆÜÚİÓX[˜YÙ\‘›ÜİÛŠ
NÂˆJNÂˆ[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜Y]™[\İ[™\Š˜›\ˆ‹[˜İ[Ûˆ

HÂˆÙ][Y[İ]
ÚYSX[˜YÙ\‘›ÜİÛ‹Œ
NÂˆJNÂˆËÈ9îãùä!¹."ù¢âz`"zhnyà®yaîÂˆØİ[Y[™Ù][[Y[RY
œX›\Ú\“X[˜YÙ\‘›ÜİÛˆŠK˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
JHÂˆ˜\ˆÜHK\™Ù]˜ÛÜÙ\İ
‹˜ÛÛX›Ø›Ş[Ü[ÛˆŠNÂˆYˆ
[Ü[Ü™Ù]]šX]J™]K]˜[YHŠJH™]\›Âˆ˜\ˆ˜[HÜ™Ù]]šX]J™]K]˜[YHŠNÂˆİ]KœX›\Ú\“X[˜YÙ\”ÙX\˜ÚH˜[Âˆ[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜[YHH˜[ÂˆÚYSX[˜YÙ\‘›ÜİÛŠ
NÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆËÈ9ea¹k­¹îá9d"9¨a»ï&¹£"yd#yéì9¢%ˆQ9¤'9í(»ï&ùçëyníº/çú`oùacz/ç¹îëz/¤ùaiy¥í¹cãyi#zaãyîæ9i)ú(j8à ‚ˆ[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\“Y\˜Ú[ÙX\˜ÚH[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜[YNÂˆİ]KœX›\Ú\“Y\˜Ú[Ù[XİYYHˆÂˆYˆ
İ]KœX›\Ú\”Ù[XİYY
HÜÙ]Ù[XİYX›\Ú\Š[
NÂˆÜÚİÓY\˜Ú[›ÜİÛŠ
NÂˆYˆ
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠHÛX\•[Y[İ]
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠNÂˆÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ˆHÙ][Y[İ]
[˜İ[Ûˆ

HÂˆÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ˆH[Âˆ™[™\”X›\Ú\œÔYÙJ
NÂˆKN
NÂˆJNÂˆ[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[˜İ[Ûˆ
]™[
HÂˆYˆ
]™[šÙ^HOOH‘[\ˆŠHÂˆ]™[œ™]™[Y˜][

NÂˆYˆ
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠHÛX\•[Y[İ]
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠNÂˆÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ˆH[Âˆİ]KœX›\Ú\“Y\˜Ú[ÙX\˜ÚH[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜[YNÂˆÚYSY\˜Ú[›ÜİÛŠ
NÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆH[ÙHYˆ
]™[šÙ^HOOH‘\ØØ\HŠHÂˆÚYSY\˜Ú[›ÜİÛŠ
NÂˆBˆJNÂˆ[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜Y]™[\İ[™\Š™›Øİ\È‹[˜İ[Ûˆ

HÂˆÜ™XZ[Y\˜Ú[Ü[ÛœÊÜX›\Ú\œĞØXÚHßJNÂˆÜÚİÓY\˜Ú[›ÜİÛŠ
NÂˆJNÂˆ[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜Y]™[\İ[™\Š˜›\ˆ‹[˜İ[Ûˆ

HÂˆÙ][Y[İ]
ÚYSY\˜Ú[›ÜİÛ‹Œ
NÂˆJNÂˆYˆ
[ËœX›\Ú\“Y\˜Ú[›ÜİÛŠHÂˆ[ËœX›\Ú\“Y\˜Ú[›ÜİÛ‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆ˜\ˆÜ[ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K[Y\˜Ú[ZYHŠNÂˆYˆ
[Ü[ÛŠH™]\›Âˆ˜\ˆY\˜Ú[YHÜ[Û‹™Ù]]šX]J™]K[Y\˜Ú[ZYŠNÂˆ˜\ˆY\˜Ú[HÛY\˜Ú[Ü[ÛœË™š[™
[˜İ[Ûˆ
Ø[™Y]JHÂˆ™]\›ˆØ[™Y]K›Y\˜Ú[YOOHY\˜Ú[YÂˆJNÂˆYˆ
[Y\˜Ú[
H™]\›ÂˆYˆ
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠHÛX\•[Y[İ]
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠNÂˆÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ˆH[Âˆİ]KœX›\Ú\“Y\˜Ú[Ù[XİYYHY\˜Ú[›Y\˜Ú[YÂˆİ]KœX›\Ú\“Y\˜Ú[ÙX\˜ÚHY\˜Ú[›˜[YNÂˆ[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜[YHHY\˜Ú[›˜[YNÂˆYˆ
İ]KœX›\Ú\”Ù[XİYY
HÜÙ]Ù[XİYX›\Ú\Š[
NÂˆÚYSY\˜Ú[›ÜİÛŠ
NÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\Y™š[š]Q[\JHÂˆ[ËœX›\Ú\Y™š[š]Q[\K˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆ˜\ˆÜ[ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]K\X›\Ú\‹ZYHŠNÂˆYˆ
[Ü[ÛŠH™]\›Âˆ˜\ˆX›\Ú\ˆHÜX›\Ú\RY
ÜX›\Ú\œĞØXÚKÜ[Û‹™Ù]]šX]J™]K\X›\Ú\‹ZYŠJNÂˆYˆ
\X›\Ú\ŠH™]\›ÂˆÜÙ]Ù[XİYX›\Ú\ŠX›\Ú\ŠNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\”›ÙXİÙX\˜Ú
HÂˆ[ËœX›\Ú\”›ÙXİÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\”›ÙXİÙX\˜ÚH[ËœX›\Ú\”›ÙXİÙX\˜Ú˜[YNÂˆJNÂˆBˆ[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\“X[˜YÙ\”ÙX\˜ÚH[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜[YNÂˆJNÂˆYˆ
[ËœX›\Ú\”Ú]TÙX\˜Ú
HÂˆ[ËœX›\Ú\”Ú]TÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\”Ú]TÙX\˜ÚH[ËœX›\Ú\”Ú]TÙX\˜Ú˜[YNÂˆJNÂˆBˆYˆ
[ËœX›\Ú\•˜XÚÔÙX\˜Ú
HÂˆ[ËœX›\Ú\•˜XÚÔÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\•˜XÚÔÙX\˜ÚH[ËœX›\Ú\•˜XÚÔÙX\˜Ú˜[YNÂˆJNÂˆBˆYˆ
[ËœX›\Ú\”Ü›Û[ÔÙX\˜Ú
HÂˆ[ËœX›\Ú\”Ü›Û[ÔÙX\˜Ú˜Y]™[\İ[™\Šš[œ]‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\”Ü›Û[ÔÙX\˜ÚH[ËœX›\Ú\”Ü›Û[ÔÙX\˜Ú˜[YNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\”Ü›Û[ĞØ]YÛÜJHÂˆ[ËœX›\Ú\”Ü›Û[ĞØ]YÛÜK˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\”Ü›Û[ĞØ]YÛÜHH[ËœX›\Ú\”Ü›Û[ĞØ]YÛÜK˜[YNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\”Ü›Û[ÕY\ŠHÂˆ[ËœX›\Ú\”Ü›Û[ÕY\‹˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\”Ü›Û[ÕY\ˆH[ËœX›\Ú\”Ü›Û[ÕY\‹˜[YNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\”Ü›Û[ÔÛÜ
HÂˆ[ËœX›\Ú\”Ü›Û[ÔÛÜ˜Y]™[\İ[™\Š˜Ú[™ÙH‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\”Ü›Û[ÔÛÜH[ËœX›\Ú\”Ü›Û[ÔÛÜ˜[YNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆ[ËœX›\Ú\”ÙX\˜Ú‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆYˆ
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠHÛX\•[Y[İ]
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠNÂˆÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ˆH[Âˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆËÈ9¥éy§'ùoêù£mù£"zd«‚ˆØİ[Y[™Ù][[Y[RY
œX›\Ú\‘]T]ZXÚĞœÈŠK˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
JHÂˆ˜\ˆˆHK\™Ù]˜ÛÜÙ\İ
–Ù]K\]ZXÚ×HŠNÂˆYˆ
XŠH™]\›Âˆ˜\ˆ[ÙHH‹™Ù]]šX]J™]K\]ZXÚÈŠNÂˆ˜\ˆ›İÈH™]È]J
NÂˆ˜\ˆHH›İË™Ù][YX\Š
NÂˆ˜\ˆHH›İË™Ù][Û

NÈËÈR˜[‚ˆ˜\ˆH›İË™Ù]]J
NÂˆ˜\ˆÙYÂˆİÚ]Ú
[ÙJHÂˆØ\ÙH›\İ[Û‚ˆÙH™]È]JKHHKJNÂˆYH™]È]JKK
NÂˆœ™XZÎÂˆØ\ÙHœ\İÌ‚ˆÙH™]È]JKKHÌ
NÂˆYH›İÎÂˆœ™XZÎÂˆØ\ÙHœ\İÛH‚ˆÙH™]È]JKHHË
NÂˆYH›İÎÂˆœ™XZÎÂˆØ\ÙHœ\İ›H‚ˆÙH™]È]JKHH‹
NÂˆYH›İÎÂˆœ™XZÎÂˆBˆ[˜İ[ÛˆY
ŠHÈ™]\›ˆˆLÈŒˆ
Èˆˆˆˆ
ÈÈBˆİ]KœX›\Ú\”İ\]HHÙ™Ù][YX\Š
H
È‹Hˆ
ÈY
Ù™Ù][Û

H
ÈJH
È‹Hˆ
ÈY
Ù™Ù]]J
JNÂˆİ]KœX›\Ú\‘[™]HHY™Ù][YX\Š
H
È‹Hˆ
ÈY
Y™Ù][Û

H
ÈJH
È‹Hˆ
ÈY
Y™Ù]]J
JNÂˆ[ËœX›\Ú\”İ\]K˜[YHHİ]KœX›\Ú\”İ\]NÂˆ[ËœX›\Ú\‘[™]K˜[YHHİ]KœX›\Ú\‘[™]NÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆ[ËœX›\Ú\”™\Ù]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆYˆ
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠHÛX\•[Y[İ]
ÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ŠNÂˆÜX›\Ú\“Y\˜Ú[ÙX\˜Ú[Y\ˆH[Âˆİ]KœX›\Ú\“X\šÙ]H˜[Âˆİ]KœX›\Ú\“™]ÛÜšÈH˜[Âˆİ]KœX›\Ú\“[šÕ\HH˜[Âˆİ]KœX›\Ú\”İ\]HHˆÂˆİ]KœX›\Ú\‘[™]HHˆÂˆİ]KœX›\Ú\“Y\˜Ú[ÙX\˜ÚHˆÂˆİ]KœX›\Ú\“Y\˜Ú[Ù[XİYYHˆÂˆİ]KœX›\Ú\”›ÙXİÙX\˜ÚHˆÂˆİ]KœX›\Ú\“X[˜YÙ\”ÙX\˜ÚHˆÂˆİ]KœX›\Ú\”Ú]TÙX\˜ÚHˆÂˆİ]KœX›\Ú\•˜XÚÔÙX\˜ÚHˆÂˆİ]KœX›\Ú\”Ù[XİYYHˆÂˆİ]KœX›\Ú\”Ü›Û[ÔÙX\˜ÚHˆÂˆİ]KœX›\Ú\”Ü›Û[ĞØ]YÛÜHH˜[Âˆİ]KœX›\Ú\”Ü›Û[ÕY\ˆH˜[Âˆİ]KœX›\Ú\”Ü›Û[ÔÛÜHœØ[\ÈÂˆ[ËœX›\Ú\“X\šÙ]š[\‹˜[YHH˜[Âˆ[ËœX›\Ú\“™]ÛÜšÑš[\‹˜[YHH˜[Âˆ[ËœX›\Ú\“[šÕ\Qš[\‹˜[YHH˜[Âˆ[ËœX›\Ú\”İ\]K˜[YHHˆÂˆ[ËœX›\Ú\‘[™]K˜[YHHˆÂˆ[ËœX›\Ú\“Y\˜Ú[ÙX\˜Ú˜[YHHˆÂˆYˆ
[ËœX›\Ú\”›ÙXİÙX\˜Ú
H[ËœX›\Ú\”›ÙXİÙX\˜Ú˜[YHHˆÂˆ[ËœX›\Ú\“X[˜YÙ\”ÙX\˜Ú˜[YHHˆÂˆYˆ
[ËœX›\Ú\”Ú]TÙX\˜Ú
H[ËœX›\Ú\”Ú]TÙX\˜Ú˜[YHHˆÂˆYˆ
[ËœX›\Ú\•˜XÚÔÙX\˜Ú
H[ËœX›\Ú\•˜XÚÔÙX\˜Ú˜[YHHˆÂˆYˆ
[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú
H[ËœX›\Ú\”Ù[XİÜ”ÙX\˜Ú˜[YHHˆÂˆYˆ
[ËœX›\Ú\”Ü›Û[ÔÙX\˜Ú
H[ËœX›\Ú\”Ü›Û[ÔÙX\˜Ú˜[YHHˆÂˆYˆ
[ËœX›\Ú\”Ü›Û[ĞØ]YÛÜJH[ËœX›\Ú\”Ü›Û[ĞØ]YÛÜK˜[YHH˜[ÂˆYˆ
[ËœX›\Ú\”Ü›Û[ÕY\ŠH[ËœX›\Ú\”Ü›Û[ÕY\‹˜[YHH˜[ÂˆYˆ
[ËœX›\Ú\”Ü›Û[ÔÛÜ
H[ËœX›\Ú\”Ü›Û[ÔÛÜ˜[YHHœØ[\ÈÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆ[ËœX›\Ú\‘^Ü‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹İÛ›ØYX›\Ú\œÖŞ
NÂˆËÈÔH9chyâaùà®yaîùb!ù£h¹fïº(j9£!ù¨!Âˆ[ËœX›\Ú\œÒÜT›İË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆ˜\ˆØ\™H]™[\™Ù]˜ÛÜÙ\İ
–Ù]K\X›\Ú\‹ZÜWHŠNÂˆYˆ
XØ\™
H™]\›Âˆ˜\ˆY]šXÈHØ\™™Ù]]šX]J™]K\X›\Ú\‹ZÜHŠNÂˆYˆ
Y]šXÈ	‰ˆY]šXÈOOHİ]KœX›\Ú\Ú\Y]šXÊHÂˆİ]KœX›\Ú\Ú\Y]šXÈHY]šXÎÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆBˆJNÂˆËÈ:(j9¨/9b!ºhm{ï&¹."¹. :hmHÈ9."ù. :hmBˆYˆ
[ËœX›\Ú\”YÙT™]ŠHÂˆ[ËœX›\Ú\”YÙT™]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\•X›TYÙHHX]›X^
K
[X™\Šİ]KœX›\Ú\•X›TYÙJHJHHJNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\”YÙS™^
HÂˆ[ËœX›\Ú\”YÙS™^˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆİ]KœX›\Ú\•X›TYÙHHX]›X^
K
[X™\Šİ]KœX›\Ú\•X›TYÙJHJH
ÈJNÂˆ™[™\”X›\Ú\œÔYÙJ
NÂˆJNÂˆBˆËÈ8¥ 8¥ :!ê¹k¦¹.byn ùl`9£"zd«ˆ8¥ 8¥ ˆYˆ
[ËœX›\Ú\“^[İ]ŠHÂˆ[ËœX›\Ú\“^[İ]‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆİÙÙÛTX›\Ú\“^[İ][ÙJ
NÂˆJNÂˆBˆYˆ
[ËœX›\Ú\“^[İ]Ø]™JHÂˆ[ËœX›\Ú\“^[İ]Ø]™K˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆÙ^]X›\Ú\“^[İ]Y][ÙJYJNÂˆJNÂˆBˆYˆ
[ËœX›\Ú\“^[İ]Ø[˜Ù[
HÂˆ[ËœX›\Ú\“^[İ]Ø[˜Ù[˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆÙ^]X›\Ú\“^[İ]Y][ÙJ˜[ÙJNÂˆJNÂˆBˆYˆ
[ËœX›\Ú\“^[İ]™\Ù]
HÂˆ[ËœX›\Ú\“^[İ]™\Ù]˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ

HÂˆÜ™\Ù]X›\Ú\“^[İ]

NÂˆJNÂˆBˆËÈ9n ¹g.ºio9fïˆÛÛ\;ï":f£ùodùbcy£!ù¨!ú e9bª;ï"BˆÚ[™İË—ÛX\šÙ]ÚİÕÛÛ\H[˜İ[Ûˆ
ÛXÙK]™[
HÂˆ˜\ˆš\İX[HØİ[Y[œ]Y\TÙ[XİÜŠ‹›X\šÙ]\YK]š\İX[ŠNÂˆYˆ
]š\İX[
H™]\›Âˆ˜\ˆÛÛ\[Hš\İX[œ]Y\TÙ[XİÜŠ‹›X\šÙ]\YK]ÛÛ\ŠNÂˆYˆ
]ÛÛ\[
H™]\›Âˆ˜\ˆZİHÛXÙK™Ù]]šX]J™]K[X\šÙ]ZÙ^HŠNÂˆ˜\ˆ˜]Õ˜[HÛXÙK™Ù]]šX]J™]K]˜[YHŠNÂˆ˜\ˆY]šXÈHÛXÙK™Ù]]šX]J™]K[Y]šXÈŠH˜ÛXÚÜÈÂˆ˜\ˆÜ™\œÈHÛXÙK™Ù]]šX]J™]K[Ü™\œÈŠNÂˆ˜\ˆ[ÛÛ[Z\ÜÚ[ÛˆHÛXÙK™Ù]]šX]J™]KX[ÛÛ[Z\ÜÚ[ÛˆŠNÂˆ˜\ˆİHÛXÙK™Ù]]šX]J™]K\İŠNÂˆYˆ
[Zİ
H™]\›ÂˆËÈ9§éy¢o¹odùbcy£!ù¨!ù¨/9o#Âˆ˜\ˆYH[Âˆ›Üˆ
˜\ˆHHÈHP“TÒT—ÒÔWÓQU’PÔË›[™İÈJÊÊHÂˆYˆ
P“TÒT—ÒÔWÓQU’PÔÖİWKšÙ^HOOHY]šXÊHÈYHP“TÒT—ÒÔWÓQU’PÔÖİWNÈœ™XZÎÈBˆBˆ˜\ˆY]Q›]HYÈY™›Ü›X]ˆ[X™\Âˆ˜\ˆY]SX™[HYÈY›X™[ˆÛXÚÜÈÂˆÛÛ\[šY[ˆH˜[ÙNÂˆÛÛ\[š[›™\’SH	Ïİ›Û™Ï‰È
È\ØØ\R[
Zİ
H
È	ÏÜİ›Û™Ï‰È
Âˆ	ÏÜ[‰È
È\ØØ\R[
Y]SX™[
H
È	Îˆ	È
ÈY]Q›]
[X™\Š˜]Õ˜[
JH
È	È
	È
Èİ
È	ÉJOÜÜ[‰È
Âˆ	ÏÜ[‰È
È\ØØ\R[

œX›\Ú\œË›Ü™\œÈ‹“Ü™\œÈŠJH
È	Îˆ	È
È[X™\Š[X™\ŠÜ™\œÊJH
È	ÏÜÜ[‰È
Âˆ	ÏÛX[‰È
È\ØØ\R[

œX›\Ú\œË˜ÛÛ[Z\ÜÚ[Ûˆ‹ÛÛ[Z\ÜÚ[ÛˆŠJH
È	Îˆ	È
È[Û™^J[X™\Š[ÛÛ[Z\ÜÚ[ÛŠJH
È	ÏÜÛX[‰ÎÂˆ˜\ˆ™XİHš\İX[™Ù]›İ[™[™ĞÛY[™Xİ

NÂˆ˜\ˆH]™[˜ÛY[H™Xİ›Y
ÈLÂˆ˜\ˆHH]™[˜ÛY[HH™XİÜHLÂˆYˆ

ÈŒŒˆ™XİÚY
HH™XİÚYHŒÌÂˆYˆ
H
HHHÂˆÛÛ\[œİ[K›YH
ÈœÂˆÛÛ\[œİ[KÜHH
ÈœÂˆNÂˆÚ[™İË—ÛX\šÙ]YUÛÛ\H[˜İ[Ûˆ

HÂˆ˜\ˆÛÛ\[HØİ[Y[œ]Y\TÙ[XİÜŠ‹›X\šÙ]\YK]ÛÛ\ŠNÂˆYˆ
ÛÛ\[
HÛÛ\[šY[ˆHYNÂˆNÂˆ[Ëœ^[Y[İÛ›ØY˜Y]™[\İ[™\Š˜ÛXÚÈ‹İÛ›ØY^[Y[ÖŞ
NÂˆYˆ
[ËœÚY]İÛ›ØY
H[ËœÚY]İÛ›ØY˜Y]™[\İ[™\Š˜ÛXÚÈ‹İÛ›ØYÚY]\™Ù]ÖŞ
NÂˆ[ËY\‘İÛ›ØY˜Y]™[\İ[™\Š˜ÛXÚÈ‹İÛ›ØYY\”ÚY]Ş
NÂˆØİ[Y[œ]Y\TÙ[XİÜ[
‹œÛÜX]ÛˆŠK™›Ü‘XXÚ

]ÛŠHOˆÂˆ]Û‹˜Y]™[\İ[™\Š˜ÛXÚÈ‹

HOˆÂˆİ]KœÛÜH]Û‹™]\Ù]œÛÜÂˆİ]K™\ØÙ[™[™ÈHYNÂˆŞ[˜ĞÛÛ›ÛÊ
NÂˆ™[™\[

NÂˆJNÂˆJNÂˆ[Ë˜Ú][œ]Ë˜Y]™[\İ[™\Šš[œ]‹[™PÚ][[[œ]
NÂˆ[Ë˜Ú][œ]Ë˜Y]™[\İ[™\ŠœØÜ›Û‹Ş[˜ĞÚ][œ]ÛÛ[X[™İ™\›^JNÂˆ[Ë˜Ú][œ]Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹Ş[˜ĞÚ][œ]ÛÛ[X[™İ™\›^JNÂˆ[Ë˜Ú][œ]Ë˜Y]™[\İ[™\ŠšÙ^]\‹Ş[˜ĞÚ][œ]ÛÛ[X[™İ™\›^JNÂˆ[Ë˜Ú][œ]Ë˜Y]™[\İ[™\ŠœÙ[Xİ‹Ş[˜ĞÚ][œ]ÛÛ[X[™İ™\›^JNÂˆ[Ë˜Ú][œ]Ë˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[™PÚ][[Ù^YİÛŠNÂˆ[Ë˜Ú][[Y[OË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™PÚ][[Y[PÛXÚÊNÂˆØİ[Y[˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆYˆ
Y]™[\™Ù]˜ÛÜÙ\İ
‹˜Ú]Z[œ]YšY[ŠJHYPÚ][[Y[J
NÂˆJNÂˆ[Ë˜Ú]›Ü›K˜Y]™[\İ[™\ŠœİX›Z]‹
]™[
HOˆÂˆ]™[œ™]™[Y˜][

NÂˆÛÛœİ›Û\H[Ë˜Ú][œ]˜[YKš[J
NÂˆYˆ
\›Û\
H™]\›ÂˆYˆ
Ú][[Y[R\ÓÜ[Š
JHÂˆÛÛœİÜ[ÛœÈHÚ][[Ü[Û‘[[Y[Ê
NÂˆÛÛœİÙ[XİYHÜ[ÛœÖØÚ][[Xİ]™R[™^HÜ[ÛœÖÌNÂˆYˆ
Ù[XİY
HÙ[XİÚ][[
Ù[XİY™Ù]]šX]J™]KXÚ]Z[[ŠJNÂˆ™]\›ÂˆBˆÛÛœİ^XÚ][[Hİ]K™Y\[ÙHÈ\œÙPÚ][[™Yš^
›Û\
Hˆ[ÂˆYˆ
^XÚ][[	‰ˆY^XÚ][[^
HÂˆ[Ë˜Ú][œ]™›Øİ\Ê
NÂˆÚİĞÚ][[Y[J
NÂˆ™]\›ÂˆBˆ[Ë˜Ú][œ]˜[YHHˆÂˆŞ[˜ĞÚ][œ]ÛÛ[X[™İ™\›^J
NÂˆYPÚ][[Y[J
NÂˆYˆ
Ú[™İËÒU“ÕÕÑSÓÓQJHÂˆÚ[™İËÒU“ÕÕÑSÓÓQK››İYJ˜Ú]\Ù[‹Âˆ[ÙNˆİ]K™Y\[ÙHÈœ™\Üˆˆ˜Ú]‚ˆJNÂˆBˆ\T›Û\
›Û\
NÂˆJNÂˆ[Ë˜YÙ[Ú]›Ü›OË˜Y]™[\İ[™\ŠœİX›Z]‹[™PYÙ[YÙTİX›Z]
NÂˆ[Ë˜YÙ[Ú]ÙÏË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™PYÙ[^[\T›Û\ÛXÚÊNÂˆ[Ë˜YÙ[™]ĞÛÛ™\œØ][ÛË˜Y]™[\İ[™\Š˜ÛXÚÈ‹™\Ù]YÙ[YÙPÛÛ™\œØ][ÛŠNÂˆ[Ë˜YÙ[İÜÛÛ™\œØ][ÛË˜Y]™[\İ[™\Š˜ÛXÚÈ‹İÜYÙ[YÙPÛÛ™\œØ][ÛŠNÂˆ[Ë˜Ú]ÙË˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆÛÛœİ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]KYİÛ›ØYZYHŠNÂˆYˆ
X]ÛŠH™]\›ÂˆİÛ›ØY™XÛÛ[Y[™][Û–Ş
]Û‹™]\Ù]™İÛ›ØYY
NÂˆJNÂˆËÈ™\Ü[ÙH9­k¹ê¥úgh¹§où.+yæ¡9."ú/oy£"zd«ˆ8 %:gh¹§où£ ¹g*Øİ[Y[˜›ÙH9."ûï#9a¤¹¬èy.#yb,Ú]ÙÂˆØİ[Y[˜Y]™[\İ[™\Š˜ÛXÚÈ‹
]™[
HOˆÂˆ˜\ˆ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
–Ù]KYİÛ›ØYZYHŠNÂˆYˆ
X]ÛŠH™]\›ÂˆËÈ:f,¹«hˆÚ]ÙÈ9a¡yæ¡9£"zd«º(ªúaãyi#z)é¹cä{ï"Ú]ÙÈ9æäyd+9fj9mì¹îãùi!9ä!º/áù.¡»ï"BˆYˆ
[Ë˜Ú]ÙÈ	‰ˆ[Ë˜Ú]ÙË˜ÛÛZ[œÊ]ÛŠJH™]\›ÂˆİÛ›ØY™XÛÛ[Y[™][Û–Ş
]Û‹™]\Ù]™İÛ›ØYY
NÂˆJNÂ‚ˆËÈ9ª(yo#ùb!ù£h‚ˆ[Ë›[ÙQ˜\İË˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÜİÚ]ÚĞÚ][ÙJNÂˆ[Ë›[ÙQY\Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÜİÚ]ÚÔ™\Ü[ÙJNÂ‚ˆËÈ9ênº+¬9oáˆÚ]9£ä:a¤¹chyâaøà#9c®ùå'ù¢$9¢©ydb¸à#x¡¤ˆ9b!ùfçˆ™\Ü[Ù{ï"9hjùaiyé.¹/¢ùå,y«(º/ã¹lcú-'ú-(ûï"BˆØİ[Y[˜Y]™[\İ[™\Š˜Ú]›İYÛË\™\Ü‹[˜İ[Ûˆ

HÂˆÜİÚ]ÚÔ™\Ü[ÙJ
NÂˆJNÂ‚ˆËÈÚ]›İ9/oùå*9bªy¢búgh¹§oùæ¡™\ÜÈÚ]9b!¹c.ˆ8¡¤ˆ9b!ù£h¹b,9kîyn¥9ª(yo#ÂˆØİ[Y[˜Y]™[\İ[™\Š˜Ú]›İ[[ÙK\™\]Y\İY‹[˜İ[Ûˆ
]™[
HÂˆ˜\ˆ[ÙHH]™[	‰ˆ]™[™]Z[	‰ˆ]™[™]Z[›[ÙNÂˆYˆ
[ÙHOOH˜Ú]ŠHÜİÚ]ÚĞÚ][ÙJ
NÂˆYˆ
[ÙHOOHœ™\ÜŠHÜİÚ]ÚÔ™\Ü[ÙJ
NÂˆJNÂ‚ˆËÈ™\Ü[ÙH9/oùå*:+í9¦#¹.i¹leyo ù¥-º-mÂˆ[Ëœ™\Ü[Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÙÙÛT™\Ü[
NÂˆ[Ëœ™\Ü[[™ĞË˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÙÙÛT™\Ü[[™ÊNÂˆ[Ë\Ù\‘›İÑİZYPË˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÙÙÛU\Ù\‘›İÑİZYJNÂˆ[Ë\Ù\‘›İÑİZYPÛÛ[Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™U\Ù\‘›İÑİZYR[XYÙPÛXÚÊNÂˆ[Ë\Ù\‘›İÑİZYPÛÛ[Ë˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[™U\Ù\‘›İÑİZYR[XYÙRÙ^YİÛŠNÂˆ[Ë\Ù\‘›İÒ[XYÙSYÚ›ŞÛÜÙOË˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÜÙU\Ù\‘›İÒ[XYÙJNÂˆ[Ë\Ù\‘›İÒ[XYÙSYÚ›ŞË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[™U\Ù\‘›İÒ[XYÙSYÚ›ŞÛXÚÊNÂˆØİ[Y[˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[™U\Ù\‘›İÒ[XYÙQØİ[Y[Ù^YİÛŠNÂˆ[Ë˜Ú]ÙÜĞ]ÛË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆ]™[œİÜ›ÜYØ][ÛŠ
NÂˆÙ]Ú]ÙÜÓY[SÜ[Š[Ë˜Ú]ÙÜÓY[OË˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠJNÂˆJNÂˆ[Ë˜Ú]ÙÜÓY[OË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆÛÛœİ][HH]™[\™Ù]˜ÛÜÙ\İ
–Ù]KXÚ][ÙËY›Ü›X]HŠNÂˆYˆ
][JHİÛ›ØYÚ]ÙÜÊ][K™]\Ù]˜Ú]ÙÒÚ[™][K™]\Ù]˜Ú]ÙÑ›Ü›X]
NÂˆJNÂˆØİ[Y[˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆYˆ
Y]™[\™Ù]˜ÛÜÙ\İ
‹˜Ú][ÙÜËXÛÛ›ÛŠJHÙ]Ú]ÙÜÓY[SÜ[Š˜[ÙJNÂˆJNÂˆØİ[Y[˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆÛÛœİ]ÛˆH]™[\™Ù]˜ÛÜÙ\İ
‹˜[œİÙ\‹Y™YY˜XÚËX]Û–Ù]KX[œİÙ\‹Y™YY˜XÚËXÛÛ^HŠNÂˆYˆ
X]Ûˆ]Û‹™\ØX›Y
H™]\›ÂˆÛÛœİÛÛ^H[œİÙ\‘™YY˜XÚĞÛÛ^Ë™Ù]
]Û‹™]\Ù]˜[œİÙ\‘™YY˜XÚĞÛÛ^
NÂˆYˆ
ÛÛ^
HÜ[[œİÙ\‘™YY˜XÚÑX[ÙÊÛÛ^]ÛŠNÂˆJNÂˆ[Ë˜[œİÙ\‘™YY˜XÚĞÛÜÙOË˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÜÙP[œİÙ\‘™YY˜XÚÑX[ÙÊNÂˆ[Ë˜[œİÙ\‘™YY˜XÚĞØ[˜Ù[Ë˜Y]™[\İ[™\Š˜ÛXÚÈ‹ÛÜÙP[œİÙ\‘™YY˜XÚÑX[ÙÊNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑX[ÙÏË˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[Ûˆ
]™[
HÂˆYˆ
]™[\™Ù]OOH[Ë˜[œİÙ\‘™YY˜XÚÑX[ÙÊHÛÜÙP[œİÙ\‘™YY˜XÚÑX[ÙÊ
NÂˆJNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ›Ü›OË˜Y]™[\İ[™\ŠœİX›Z]‹\Ş[˜È[˜İ[Ûˆ
]™[
HÂˆ]™[œ™]™[Y˜][

NÂˆYˆ
XXİ]™P[œİÙ\‘™YY˜XÚÊH™]\›ÂˆÛÛœİİX›Z\ÜÚ[ÛˆHXİ]™P[œİÙ\‘™YY˜XÚÎÂˆÛÛœİÙ[XİYH[Ë˜[œİÙ\‘™YY˜XÚÑ›Ü›Kœ]Y\TÙ[XİÜŠ	Ú[œ]Û˜[YOH˜[œİÙ\‘™YY˜XÚÔ™X\ÛÛˆ—N˜ÚXÚÙY	ÊNÂˆÛÛœİ[™İXYÙHHİX›Z\ÜÚ[Û‹˜ÛÛ^›[™İXYÙNÂˆYˆ
\Ù[XİY
HÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›Ü‹^ÛÛ[H[™İXYÙHOOHšˆÈº+íú`"y¢êy. 9.*¹.#y®èy¡#ùc§ùfè8à ˆˆˆ”X\ÙHÙ[XİH™X\ÛÛ‹ˆÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›Ü‹˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆ™]\›ÂˆBˆÛÛœİ]Z[Hİš[™Ê[Ë˜[œİÙ\‘™YY˜XÚÑ]Z[Ë˜[YHˆŠKš[J
NÂˆYˆ
™]È^[˜ÛÙ\Š
K™[˜ÛÙJ]Z[
K›[™İˆMŠHÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›Ü‹^ÛÛ[H[™İXYÙHOOHšˆÈº(iyaaz+í9¦#º/áúeoûï#:+íùì¯¹ë 9d#ºaãz+åxà ˆˆˆ•H]Z[È\™HÛÈÛ™ËˆX\ÙHÚÜ[ˆ[KˆÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›Ü‹˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆ™]\›ÂˆBˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›Ü‹˜Û\ÜÓ\İ˜Y
šY[ˆŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÔİX›Z]™\ØX›YHYNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÔİX›Z]^ÛÛ[H[™İXYÙHOOHšˆÈ¹£ä9.©9.+x )ˆˆˆ”İX›Z][™ø )ˆÂˆHÂˆ]ØZ]Ù[™[œİÙ\‘™YY˜XÚÊİX›Z\ÜÚ[Û‹˜ÛÛ^Ù[XİY˜[YK]Z[
NÂˆÛÛœİ]ÛˆHİX›Z\ÜÚ[Û‹˜]ÛÂˆ]Û‹™\ØX›YHYNÂˆ]Û‹™]\Ù]™™YY˜XÚÔİX›Z]YHYHÂˆ]Û‹^ÛÛ[H[™İXYÙHOOHšˆÈ¹mì¹cãzi¢ˆˆ‘™YY˜XÚÈÙ[ÂˆYˆ
Xİ]™P[œİÙ\‘™YY˜XÚÈOOHİX›Z\ÜÚ[ÛŠHÛÜÙP[œİÙ\‘™YY˜XÚÑX[ÙÊ
NÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
Xİ]™P[œİÙ\‘™YY˜XÚÈOOHİX›Z\ÜÚ[ÛŠHÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›Ü‹^ÛÛ[H
[™İXYÙHOOHšˆÈ¹£ä9.©9i,z-){ï#:+íúaãz+å{ï&ˆˆˆ”İX›Z\ÜÚ[Ûˆ˜Z[YˆX\ÙH™]NˆŠH
È
\œ›Ü‹›Y\ÜØYÙH[šÛ›İÛˆŠNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÑ\œ›Ü‹˜Û\ÜÓ\İœ™[[İ™JšY[ˆŠNÂˆBˆHš[˜[HÂˆYˆ
Xİ]™P[œİÙ\‘™YY˜XÚÈOOHİX›Z\ÜÚ[ÛŠHÂˆ[Ë˜[œİÙ\‘™YY˜XÚÔİX›Z]™\ØX›YH˜[ÙNÂˆ[Ë˜[œİÙ\‘™YY˜XÚÔİX›Z]^ÛÛ[H[™İXYÙHOOHšˆÈ¹£ä9.©9cãzi¢ˆˆ”İX›Z]™YY˜XÚÈÂˆBˆBˆJNÂ‚ˆËÈ\ØØ\H9§ 9l#ùc%¹§ 9."¹l`ºgg¹£ª9ä!¹.+yæ¡:gh¹§oÂˆØİ[Y[˜Y]™[\İ[™\ŠšÙ^YİÛˆ‹[˜İ[Ûˆ
JHÂˆYˆ
KšÙ^HOOH•Xˆˆ	‰ˆ˜\[œİÙ\‘™YY˜XÚÑ›Øİ\ÊJJH™]\›ÂˆYˆ
KšÙ^HOOH‘\ØØ\HŠHÂˆYˆ
[Ë˜[œİÙ\‘™YY˜XÚÑX[ÙÈ	‰ˆY[Ë˜[œİÙ\‘™YY˜XÚÑX[ÙË˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠJHÂˆÛÜÙP[œİÙ\‘™YY˜XÚÑX[ÙÊ
NÂˆ™]\›ÂˆBˆYˆ
[Ë˜Ú]ÙÜÓY[H	‰ˆY[Ë˜Ú]ÙÜÓY[K˜Û\ÜÓ\İ˜ÛÛZ[œÊšY[ˆŠJHÂˆÙ]Ú]ÙÜÓY[SÜ[Š˜[ÙJNÂˆ[Ë˜Ú]ÙÜĞ]ÛË™›Øİ\Ê
NÂˆ™]\›ÂˆBˆ›Üˆ
˜\ˆHHÙY\[™[Ë›[™İHNÈHHÈKKJHÂˆ˜\ˆHÙY\[™[ÖÚWNÂˆYˆ
\›Z[š[Z^™Y	‰ˆ\˜X›ÜÛÛ›Û\ŠHÂˆÛZ[š[Z^™QY\[™[
šY
NÂˆœ™XZÎÂˆBˆBˆBˆJNÂ‚ˆËÈ9æäyd+: b¹i*y¤f:) y.+yæ¡9leyo 9.¢ù.í»ï"9¥+ù£ zaãynî¹mì¹alúeëyæ¡:gh¹§oûï"BˆØİ[Y[˜Y]™[\İ[™\Š™Y\Y^[™\[™[‹[˜İ[Ûˆ
JHÂˆ˜\ˆÙ^HHK™]Z[šÙ^NÂˆ˜\ˆ[™[YHK™]Z[œ[™[YÂˆËÈ9/&9ab:`&º/áÈ[™[Y9§éy¢o»ï"9ë 9c%¹d#¹æ¡Y\[Ù{ï"BˆYˆ
[™[Y
HÂˆ˜\ˆHÙY\[™[Ë™š[™
[˜İ[Ûˆ
ŠHÈ™]\›ˆ‹šYOOH[™[YÈJNÂˆYˆ

HÂˆYˆ
—ÚY[ŠHÂˆÜ™\Ù][™[ÑY˜][ÜÊ
NÂˆÜÚİÑY\[™[
šY
NÂˆBˆ[ÙHYˆ
›Z[š[Z^™Y
HÙ^[™Y\[™[
šY
NÂˆ[ÙHØœš[™Ô[™[Ñœ›Û

NÂˆ™]\›ÂˆBˆBˆYˆ
ZÙ^JH™]\›ÂˆËÈ9a£z`&º/áÈØ\™Ù^H9§éy¢o‚ˆ˜\ˆ[™[HÙY\[™[Ë™š[™
[˜İ[Ûˆ
ŠHÈ™]\›ˆ‹—ØØ\™Ù^HOOHÙ^NÈJNÂˆYˆ
[™[
HÂˆYˆ
[™[—ÚY[ŠHÂˆÜ™\Ù][™[ÑY˜][ÜÊ[™[
NÂˆÜÚİÑY\[™[
[™[šY
NÂˆBˆ[ÙHYˆ
[™[›Z[š[Z^™Y
HÙ^[™Y\[™[
[™[šY
NÂˆ[ÙHØœš[™Ô[™[Ñœ›Û
[™[
NÂˆ™]\›ÂˆBˆËÈ:gh¹§oùmì¹alúeë{ï#9l'z+åy.ã¹ï$ùkf:aãynî‚ˆ˜\ˆØXÚYHÙY\™\ÜØXÚVÚÙ^WNÂˆYˆ
ØXÚY
HÂˆ˜\ˆ™]Ô[™[HØÜ™X]QY\[™[
ØXÚYœ›Û\
NÂˆ™]Ô[™[—Û[ÙHHØXÚY›[ÙHœ™\ÜÂˆ™]Ô[™[™[˜Û\ÜÓ\İ˜Y
œÛİ\˜ÙKHˆ
È™]Ô[™[—Û[ÙJNÂˆ™]Ô[™[—ØØ\™Ù^HHÙ^NÂˆYˆ
ØXÚYš[
HÂˆËÈ9ë 9c%ˆY\[Ù{ï&¹æí9£©z/æ9c§ÈS9a¡yk®BˆÜÚİÔ]ZXÚÔ™\İ[[‘Y\[™[
™]Ô[™[ØXÚYš[ØXÚYœ›Û\
NÂˆH[ÙHYˆ
ØXÚYœ™\Ü
HÂˆËÈ9¥éùâbY\™X\ÛÛš[™È9¢©ydbº-ëùo¡ˆÜ™[™\”[™[™\Ü
™]Ô[™[ØXÚYœ™\Ü
NÂˆBˆØœš[™Ô[™[Ñœ›Û
™]Ô[™[
NÂˆBˆJNÂ‚ˆËÈ9«(º/ã¹lcùcå¹.èú"ìy¥¡ù«(º/ã¹­¢9 kûï&¹ênº b¹i*yc.¹æ¡: ïyb¦ùg,9fïˆ
È9é.¹/¢úeëºh¦;ï"Ú]›İİÙ[ÛÛYKšœûï"BˆYˆ
Ú[™İËÒU“ÕÕÑSÓÓQJHÂˆÚ[™İËÒU“ÕÕÑSÓÓQK›X^X™T™[™\Šœ™\Ü‹ÈÙ™™\œÎˆÙ™™\œË\ÓY[[ÜNˆ˜[ÙHJNÂˆBˆİ]K˜İ\œ™[ÛÛ^HÈ\Nˆ™Y˜][‹][\Îˆ×Kİ[[X\NˆßKš[\œÎˆßHNÂˆŞ[˜Ô^[Y[ÛÛ›ÛÊ
NÂˆ™[™\[

NÂˆ™[™\”^[Y[ÔYÙJ
NÂˆ™\™[™\‘›Ü“[™İXYÙJ
NÂˆYˆ
Ú[™İË—×ÓÒWÓĞQS‘×Ô“ÑÔ‘TÔ××È	‰ˆ\[ÙˆÚ[™İË—×ÓÒWÓĞQS‘×Ô“ÑÔ‘TÔ××Ë™š[š\ÚOOH™[˜İ[ÛˆŠHÂˆÚ[™İË—×ÓÒWÓĞQS‘×Ô“ÑÔ‘TÔ××Ë™š[š\Ú
ˆ‘\Ú›Ø\™™XYH‹ˆ	ÛÙ™™\œË›[™İÓØØ[Tİš[™Ê
_HÙ™™\œÈØYYˆ
NÂˆH[ÙHÂˆØİ[Y[˜›ÙK˜Û\ÜÓ\İœ™[[İ™J˜\[ØY[™ÈŠNÂˆBˆØYÚ\™YY\“[İ™\ÊÈÚ[[ˆYHJNÂˆX^X™P]]ÔŞ[˜Ó]˜[T^[Y[Ê
NÂˆÚ[™İËœÙ][\˜[
X^X™P]]ÔŞ[˜Ó]˜[T^[Y[ËUU×ÔVSQS•ÔÖS×ÒS•T•SÓTÊNÂˆÚ[™İËœÙ][\˜[


HOˆÂˆYˆ
İ]KœYÙHOOHœÚY]Èˆİ]K™”İ]\Ë›ØY[™ÊH™]\›ÂˆYˆ
Øİ[Y[š\ÚXš[]Tİ]H	‰ˆØİ[Y[š\ÚXš[]Tİ]HOOHš\ÚX›HŠH™]\›ÂˆØY”İ]\Ê\™Ù]”İ]\Ó[ÛÙ^J
JNÂˆK—ÔÕUT×ĞUU×Ô‘Q”‘TÒÓTÊNÂ‚ˆËÈ9¥¬9¢bùo%ykï;ï&ºi¥¹«(z/æùaiz!ê¹bª9o.yaî»ï"Û˜›Ø\™[™×İİ\‹šœûï#9§*¹k£9¢$:/áù¢cyo.{ï"BˆYˆ
Ú[™İË“Ó“ĞT‘S‘×ÕÕTŠHÂˆÚ[™İË“Ó“ĞT‘S‘×ÕÕT‹›X^X™P]]Ôİ\

NÂˆBˆB‚ˆ[˜İ[ÛˆİÛ›ØY[Ù\›“Ù™™\•˜XÚÙ\Š^[ØY
HÂˆYˆ
\^[ØY\[Ùˆ^[ØYOOH›Øš™XİˆP\œ˜^Kš\Ğ\œ˜^J^[ØYœ›İÜÊJH™]\›ˆ˜[ÙNÂˆÛÛœİ›İÜÈH^[ØYœ›İÜË™š[\Š
›İÊHOˆ›İÈ	‰ˆ\[Ùˆ›İÈOOH›Øš™Xİˆ	‰ˆP\œ˜^Kš\Ğ\œ˜^J›İÊJNÂˆYˆ
\›İÜË›[™İ
H™]\›ˆ˜[ÙNÂˆÛÛœİšY]ÈH^[ØYšY]ÈOOHœ›ÙXİÈˆÈœ›ÙXİÈˆˆ›Ù™™\œÈÂˆÛÛœİØÛÜHH^[ØYœÙ[XİYÛ›HÈœÙ[XİYˆˆ™š[\™YÂˆÛÛœİÛÜšØ›ÛÚÈHÜ™X]T™XÛÛ[Y[™][Û•ÛÜšØ›ÛÚÊ›İÜËÂˆ™Y™\™[˜ÙTİ[NˆYKˆÚY]ÎˆÂˆÈÚY]˜[YNˆ“\İÙˆÙ™™\œÈ‹›İÜËÛÛ[[œÎˆÙ™™\•˜XÚÙ\“Ù™™\‘^ÜÛÛ[[œÊ
HKˆÈÚY]˜[YNˆœ˜[™›ÙXİ\İ‹›İÜËÛÛ[[œÎˆÙ™™\•˜XÚÙ\”›ÙXİ^ÜÛÛ[[œÊ
HBˆBˆJNÂˆšYÙÙ\•ÛÜšØ›ÛÚÑİÛ›ØY
ˆÛÜšØ›ÛÚËˆTĞ[X^›Û—ÓÙ™™\—Ó\İÕ˜XÚÙ\—Û[Ù\›—ÉİšY]ßWÉÜØÛÜ_WÉÜ›İÜË›[™İWÉİÙ^Qš[Tİ[\

_KŞˆ
NÂˆ™]\›ˆYNÂˆB‚ˆ[˜İ[ÛˆİÛ›ØY[Ù\›”^[Y[Ê^[ØY
HÂˆYˆ
\^[ØY\[Ùˆ^[ØYOOH›Øš™XİˆP\œ˜^Kš\Ğ\œ˜^J^[ØYœ›İÜÊJH™]\›ˆ˜[ÙNÂˆÛÛœİ›İÜÈH^[ØYœ›İÜË™š[\Š
›İÊHOˆ›İÈ	‰ˆ\[Ùˆ›İÈOOH›Øš™Xİˆ	‰ˆP\œ˜^Kš\Ğ\œ˜^J›İÊJNÂˆYˆ
\›İÜË›[™İ
H™]\›ˆ˜[ÙNÂˆİÛ›ØY›İÜĞ\ÖŞ
›İÜËÂˆİÛ›ØY\Nˆœ^[Y[È‹ˆš[T™Yš^ˆœ^[Y[Ü™XÛÜ™×Û[Ù\›ˆ‹ˆ^ÜØÛÜNˆ˜İ\œ™[Ùš[\œÈ‹ˆÚY]˜[YNˆ”^[Y[È‹ˆİÛ›ØYÛÛ[[œÎˆ^[Y[^ÜÛÛ[[œÊ
BˆJNÂˆ™]\›ˆYNÂˆB‚ˆ[˜İ[ÛˆİÛ›ØY[Ù\›”X›\Ú\œÊ^[ØY
HÂˆYˆ
\^[ØY\[Ùˆ^[ØYOOH›Øš™XİˆP\œ˜^Kš\Ğ\œ˜^J^[ØYœ›İÜÊJH™]\›ˆ˜[ÙNÂˆÛÛœİ›İÜÈH^[ØYœ›İÜË™š[\Š
›İÊHOˆ›İÈ	‰ˆ\[Ùˆ›İÈOOH›Øš™Xİˆ	‰ˆP\œ˜^Kš\Ğ\œ˜^J›İÊJNÂˆYˆ
\›İÜË›[™İ
H™]\›ˆ˜[ÙNÂˆÛÛœİš[\œÈH^[ØY™š[\œÈ	‰ˆ\[Ùˆ^[ØY™š[\œÈOOH›Øš™XİˆÈ^[ØY™š[\œÈˆßNÂˆÛÛœİØÛÜHH^[ØYœØÛÜHOOHœÜ›Û[ÈˆÈœÜ›Û[Èˆˆ^[ØYœØÛÜHOOHœYÙHˆÈœYÙHˆˆ˜[ÂˆYˆ
ØÛÜHOOHœÜ›Û[ÈŠHÂˆÛÛœİX›\Ú\’YHİš[™Ê^[ØYœX›\Ú\’Y[šÛ›İÛˆŠNÂˆİÛ›ØY›İÜĞ\ÖŞ
›İÜËÂˆİÛ›ØY\NˆœÚY]‹ˆš[T™Yš^ˆœX›\Ú\‹\Ü›Û[ËHˆ
ÈX›\Ú\’Yˆ^ÜØÛÜNˆİš[™Êš[\œË›X\šÙ]˜[ŠKˆÚY]˜[YNˆ”X›\Ú\ˆÜ›Û[È‹ˆİÛ›ØYÛÛ[[œÎˆÂˆÈ“Y\˜Ú[Q‹
›İÊHOˆ›İÖÈ“Y\˜Ú[Q—WKˆÈ“Y\˜Ú[˜[YH‹
›İÊHOˆ›İË“Y\˜Ú[KˆÈ“™]ÛÜšÈ‹
›İÊHOˆ›İË“™]ÛÜš×KˆÈ“X\šÙ]È‹
›İÊHOˆ›İË“X\šÙ]KˆÈØ]YÛÜH‹
›İÊHOˆ›İËØ]YÛÜWKˆÈ•Y\ˆ‹
›İÊHOˆ›İË•Y\—KˆÈSÕˆ‹
›İÊHOˆ›İËSÕ—KˆÈQ‘ˆTÈ‹
›İÊHOˆ›İÖÈQ‘ˆTÈ—WKˆÈÛÛ™\œÚ[Ûˆ‹
›İÊHOˆ›İËÛÛ™\œÚ[Û—KˆÈQ‘ˆÛÛ[Z\ÜÚ[Ûˆ˜]H‹
›İÊHOˆ›İÖÈQ‘ˆÛÛ[Z\ÜÚ[Ûˆ˜]H—WKˆÈ“Ü™\œÈ‹
›İÊHOˆ›İË“Ü™\œ×KˆÈ”Ø[\È‹
›İÊHOˆ›İË”Ø[\×KˆÈQ‘ˆX\›™YÛÛ[Z\ÜÚ[Ûˆ‹
›İÊHOˆ›İÖÈQ‘ˆX\›™YÛÛ[Z\ÜÚ[Ûˆ—WKˆÈ”Ø[\ÈÚ\™H‹
›İÊHOˆ›İÖÈ”Ø[\ÈÚ\™H—WBˆBˆJNÂˆ™]\›ˆYNÂˆBˆİÛ›ØY›İÜĞ\ÖŞ
›İÜËÂˆİÛ›ØY\NˆœÚY]‹ˆš[T™Yš^ˆœX›\Ú\œÈ‹ˆ^ÜØÛÜNˆİš[™Êš[\œË›X\šÙ]ØÛÜJKˆÚY]˜[YNˆ”X›\Ú\œÈ‹ˆİÛ›ØYÛÛ[[œÎˆÂˆÈ”˜[šÈ‹
›İÊHOˆ›İË”˜[š×KˆÈ”X›\Ú\ˆQ‹
›İÊHOˆ›İÖÈ”X›\Ú\ˆQ—WKˆÈ”X›\Ú\ˆ˜[YH‹
›İÊHOˆ›İÖÈ”X›\Ú\ˆ˜[YH—WKˆÈ“X[˜YÙ\ˆ‹
›İÊHOˆ›İË“X[˜YÙ\—KˆÈÛXÚÜÈ‹
›İÊHOˆ›İËÛXÚÜ×KˆÈÕ”ˆ‹
›İÊHOˆ›İËÕ”—KˆÈ‘ˆ‹
›İÊHOˆ›İË‘—KˆÈUÈ‹
›İÊHOˆ›İËU×KˆÈ“Ü™\œÈ‹
›İÊHOˆ›İË“Ü™\œ×KˆÈ”Ø[\È‹
›İÊHOˆ›İË”Ø[\×KˆÈ[ÛÛ[Z\ÜÚ[Ûˆ‹
›İÊHOˆ›İÖÈ[ÛÛ[Z\ÜÚ[Ûˆ—WKˆÈY™ˆÛÛ[Z\ÜÚ[Ûˆ‹
›İÊHOˆ›İÖÈY™ˆÛÛ[Z\ÜÚ[Ûˆ—WKˆÈ‘Ü›ÜÜÈ›Ùš]‹
›İÊHOˆ›İÖÈ‘Ü›ÜÜÈ›Ùš]—WBˆBˆJNÂˆ™]\›ˆYNÂˆB‚ˆ[˜İ[ÛˆİÛ›ØY[Ù\›Ø]YÛÜJ^[ØY
HÂˆYˆ
\^[ØYP\œ˜^Kš\Ğ\œ˜^J^[ØYœ›İÜÊH\^[ØYœ›İÜË›[™İ
H™]\›ˆ˜[ÙNÂˆÛÛœİX™[Hİš[™Ê^[ØY›X™[˜Ø]YÛÜHŠKš[J
H˜Ø]YÛÜHÂˆİÛ›ØY›İÜĞ\ÖŞ
^[ØYœ›İÜËÂˆİÛ›ØY\NˆœÚY]‹ˆš[T™Yš^ˆ˜Ø]YÛÜWÙ›Øİ\È‹ˆ^ÜØÛÜNˆX™[ˆÚY]˜[YNˆX™[œÛXÙJÌJKˆİÛ›ØYÛÛ[[œÎˆØš™Xİ^ÜÛÛ[[œÊ^[ØYœ›İÜÊBˆJNÂˆ™]\›ˆYNÂˆB‚ˆÚ[™İË“ÒWÓQĞPÖWĞ”’QÑHHÂˆ˜]šYØ]Nˆ
YÙJHOˆİÚ]ÚYÙJYÙJKˆİÛ›ØYˆ
\K^[ØY
HOˆ
ˆ\HOOH›Ù™™\‹]˜XÚÙ\ˆ‚ˆÈİÛ›ØY[Ù\›“Ù™™\•˜XÚÙ\Š^[ØY
Bˆˆ\HOOHœ^[Y[È‚ˆÈİÛ›ØY[Ù\›”^[Y[Ê^[ØY
Bˆˆ\HOOHœX›\Ú\œÈ‚ˆÈİÛ›ØY[Ù\›”X›\Ú\œÊ^[ØY
Bˆˆ\HOOH˜Ø]YÛÜHˆ	‰ˆİÛ›ØY[Ù\›Ø]YÛÜJ^[ØY
Bˆ
BˆNÂ‚ˆØXÚSÜšYÚ[˜[Y\”ÚY]›İÜÊ
NÂˆ\SX[X[Y\“[İ™\Ê
NÂ‚ˆYˆ
Ú[™İË—×ÓÑ‘‘T—ÒS•SQÑSÑWÕTÕ×ÊHÂˆÚ[™İË“Ñ‘‘T—ÒS•SQÑSÑWÕTÕÒÓÒÔÈHÂˆYÙ[ÛÛYš[š][ÛœËˆYÙ[[˜X›YÛÛ˜[Y\ËˆZ[YÙ[[›š[™Ô™\]Y\İˆ›Ú™XİYÙ[ÛÛ™\İ[›Ü”Ù\™\‹ˆZ[YÙ[Ş[\Ú\Ô™\]Y\İˆYÙ[^Xİ]UÛÛˆ™[™\YÙ[™[™Ú\[ˆ\[™YÙ[™[™Ú\ËˆYÙ[›Û\™\]Y\İÕ™[™ˆYÙ[›Û\™\]Y\İÓY\˜Ú[ÛÛ\\š\ÛÛ‹ˆ›Ü›X[^™PYÙ[ÛÛØ[ËˆÛÛ\XİYÙ[ÛÛ™\İ[ˆ[œİ\™PYÙ[Y\“Y\˜Ú[]Uš\ÚX›Kˆ[œİ\™PYÙ[^[Y[]Uš\ÚX›KˆYÙ[Úİ[\\ÜÔ[›š[™ËˆYÙ[›Û\™\]Z\™\Õ™\šYšXX›Q]KˆYÙ[^[Y[[Û›Ü”]Y\KˆYÙ[ÛÛ›Û\]KˆZ[YÙ[[›š[™ÓY\ÜØYÙ\ËˆZ[YÙ[Ş[\Ú\ÓY\ÜØYÙ\ËˆYÙ[˜[˜XÚÒ\İÜKˆYÙ[\İÜPY\“İ]ÛÛYKˆÜ™X]PYÙ[˜XÙPÛÛ^ˆİ\YÙ[˜XÙKˆ\[™YÙ[˜XÙTİ\ËˆÛÛ\]PYÙ[˜XÙKˆ›Ü›X[^™PYÙ[˜XÙQ\œ›Ü‹ˆYÙ[˜XÙQ]SY]KˆYÙ[Y[[ÜSY]šXÒÙ^\ËˆYÙ[Y[[ÜQ]™[œ›ÛUÛÛ][KˆYÙ[Y[[ÜQ]™[Ñœ›ÛUÛÛ™\İ[ËˆYÙ[YÙSY[[ÜU^ˆÛÛ[Z]YÙ[YÙSY[[ÜKˆYÙ[YÙUÙ[ÛÛYR[ˆ™\Ù]YÙ[YÙPÛÛ™\œØ][Û‹ˆÙ]YÙ[YÙSY[[ÜQ›Ü•\İˆ[˜İ[Ûˆ

HÂˆ™]\›ˆİ]K˜YÙ[YÙK›Y[[ÜNÂˆKˆÜ™X]PYÙ[^Xİ][Û•[Y[[™Kˆ[Ú]YÙ[ˆš\œİÙ™™\“˜[YNˆ[˜İ[Ûˆ

HÂˆ™]\›ˆÙ™™\œË›[™İÈ
Ù™™\œÖÌK˜œ˜[™Ù™™\œÖÌK›Y\˜Ú[˜[YHˆŠHˆˆÂˆKˆÙ][™İXYÙNˆ[˜İ[ÛŠ[™ÊHÈİ]K›[™İXYÙHH[™ÎÈKˆİÚ]ÚĞÚ][ÙNˆÜİÚ]ÚĞÚ][ÙKˆİÚ]ÚÔ™\Ü[ÙNˆÜİÚ]ÚÔ™\Ü[ÙKˆÜ™X]PÚ]]Y\İ[Û”Ù\ÜÚ[Û’YˆÜ™X]PÚ]]Y\İ[Û‘]™[YˆÙ]Ú]]Y\İ[Û”Ù\ÜÚ[Û’Yˆ™\Ù]Ú]]Y\İ[Û”Ù\ÜÚ[Û‘›Ü•\İˆ[˜İ[Ûˆ

HÈÚ]]Y\İ[Û”YÙTÙ\ÜÚ[Û’YHˆÈKˆ]Xİ]Y\İ[Û“ÙÒ[[ˆ™YÚ[”]Y\İ[Û“ÙËˆÛÛ\]T]Y\İ[Û“ÙËˆÙ[™[œİÙ\‘™YY˜XÚËˆØ]YÛÜQ›Ü”›Û\ˆ]Xİ™[™[]U\Kˆ™\Ü[ÙR[X\šÙİÛˆ

HOˆ‘TÔ•ÓSÑWÒSÓQˆ™\Ü[ÙR[X\šÙİÛ‘[ˆ

HOˆ‘TÔ•ÓSÑWÒSÓQÑS‹ˆ™[™\”™\Ü[ÙR[ˆ
Y[™ÊHOˆX\šÙİÛ•Ò[
Y
[™ÈOOH™[ˆˆÈ‘TÔ•ÓSÑWÒSÓQÑSˆˆ‘TÔ•ÓSÑWÒSÓQ
JKˆ™\Ü[[™ËˆÙÙÛT™\Ü[[™ËˆÙÙÛU\Ù\‘›İÑİZYKˆØY\Ù\‘›İÑİZYKˆ\Ù\‘›İÑİZYU\›ˆÚİĞÚ][[Y[KˆYPÚ][[Y[KˆÙ[XİÚ][[ˆ\œÙPÚ][[™Yš^ˆÚ][[™Yš^^ˆ]Xİ]Y\R[[ˆ\ÔX›\Ú\’[[ˆ\ÔX›\Ú\”›Ùš[R[[ˆ\œÙTX›\Ú\”›Ùš[T]Y\KˆX›\Ú\”›Ùš[T›İÜÑ›Ü“X\šÙ]ˆ™[™\”X›\Ú\”›Ùš[R[ˆ™[™\”X›\Ú\”›Ùš[PØ[™Y]\Ò[ˆ™[™\”X›\Ú\”›Ùš[S›İ›İ[™[ˆ™[™\”X›\Ú\”›Ùš[U\ØYÙR[ˆX›\Ú\”›Ùš[P[œİÙ\‹ˆØYX›\Ú\œÑ]Kˆœ˜[™YYXQ]RÙ^Kˆœ˜[™YYXQ^SÜ™[˜[ˆœ˜[™YYXS[™TÙYÛY[Ëˆœ˜[™YYXPÛÛÜ‹ˆœ˜[™YYXTX›\Ú\’Ù^NˆØœ˜[™YYXTX›\Ú\’Ù^Kˆœ˜[™YYXTX›\Ú\“X[˜YÙ\ˆØœ˜[™YYXTX›\Ú\“X[˜YÙ\‹ˆœ˜[™YYXSX[˜YÙ\“Ü[ÛœÎˆØœ˜[™YYXSX[˜YÙ\“Ü[ÛœËˆœ˜[™YYXSX[˜YÙ\‘š[\™YX›\Ú\œÎˆØœ˜[™YYXSX[˜YÙ\‘š[\™YX›\Ú\œËˆœ˜[™YYXUš\ÚX›TX›\Ú\œÎˆØœ˜[™YYXUš\ÚX›TX›\Ú\œËˆœ˜[™YYXPØ][ÙÓÜ[ÛœÎˆØœ˜[™YYXPØ][ÙÓÜ[ÛœËˆœ˜[™YYXPÚ\[Ù[ˆØœ˜[™YYXPZ[Ú\[Ù[ˆœ˜[™YYXPÚ\^[ØYˆØœ˜[™YYXPÚ\^[ØYˆœ˜[™YYXPÛXÚĞÚ\[Ù[ˆØœ˜[™YYXPZ[ÛXÚÜĞÚ\[Ù[ˆœ˜[™YYXTØ[šÙ^S[Ù[ˆØœ˜[™YYXPZ[Ø[šÙ^S[Ù[ˆœ˜[™YYXTØ[šÙ^S^[İ]ˆØœ˜[™YYXPZ[Ø[šÙ^S^[İ]ˆœ˜[™YYXTØ[šÙ^Uš\ÚX›Q[šY\ÎˆØœ˜[™YYXTØ[šÙ^Uš\ÚX›Q[šY\Ëˆœ˜[™YYXTØ[šÙ^U[S^[İ]ˆØœ˜[™YYXPZ[Ø[šÙ^U[S^[İ]ˆœ˜[™YYXTØ[šÙ^T›ÙXİ\Ú[ˆØœ˜[™YYXTØ[šÙ^T›ÙXİ\Ú[‹ˆœ˜[™YYXTØ[šÙ^Rİ™\”İ]NˆØœ˜[™YYXTØ[šÙ^Rİ™\”İ]Kˆœ˜[™YYXTØ[šÙ^Q›İÑ]Z[ˆØœ˜[™YYXTØ[šÙ^Q›İÑ]Z[ˆœ˜[™YYXTØ[šÙ^Q›İÒ]\İˆØœ˜[™YYXTØ[šÙ^Q›İÒ]\İˆœ˜[™YYXTØ[šÙ^Q›İÕÛÛ\ÜÚ][ÛˆØœ˜[™YYXTØ[šÙ^Q›İÕÛÛ\ÜÚ][Û‹ˆœ˜[™YYXTØ[šÙ^UÙÙÛTÙ[Xİ[ÛˆØœ˜[™YYXTØ[šÙ^UÙÙÛTÙ[Xİ[Û‹ˆ™]™[YQ›İÔÙ[XİYY\˜Ú[ÎˆÜ™]™[YQ›İÔÙ[XİYY\˜Ú[Ëˆ™]™[YQ›İÔÙ[XİYYÎˆÜ™]™[YQ›İÔÙ[XİYYËˆœ˜[™YYXTØ[šÙ^T^[ØYˆ[˜İ[Ûˆ
^[ØY
HÂˆ™]\›ˆØœ˜[™YYXPZ[Ø[šÙ^S[Ù[
^[ØY
NÂˆKˆœ˜[™YYXPÛXÚĞÚ\^[ØYˆ[˜İ[Ûˆ
^[ØYX›\Ú\œÊHÂˆ˜\ˆ[Ù[HØœ˜[™YYXPZ[ÛXÚÜĞÚ\[Ù[
^[ØYX›\Ú\œÊNÂˆ™]\›ˆ[Ù[È[Ù[œİ™ÈˆˆÂˆKˆ\œÙTX›\Ú\‘š[\œËˆ™[™\”X›\Ú\”™XÛÜ™Ò[ˆX›\Ú\”™XÛÜ™Ğ[œİÙ\‹ˆÛX[™YY\˜Ú[ÛÚİ\˜\ÙKˆ\Ôİ›Û™ÓY\˜Ú[ÛÚİ\ˆ^˜XİY]šXÑš[\œËˆ^˜XİY]šXÔÛÜ[[ˆ^˜Xİ^[Y[ŞXÛQš[\‹ˆ^[Y[ŞXÛQš[\•^ˆ›Ü›X[^™T™YÚ[Û‹ˆ^[Y[İ\œ™[˜ŞTŞ[X›Ûˆ^[Y[[Û™^Kˆ^[Y[İ[[X\S[Û™^Kˆ^[Y[İ]\Ôİ[[X\R][\Ëˆ^[Y[İ]\Ñš[\•˜[Y\Ëˆ^[Y[ÛÜÜ[ÛœËˆÛÜ^[Y[›İÜÑ›Ü•X›Kˆ^[Y[X›TÛÜ˜[YKˆÙ^]ÛÜ™ÙX\˜Ú™\]Y\İˆÙ^]ÛÜ™ÙX\˜ÚX]Ú\ËˆÙ]^[Y[™XÛÜ™ËˆÚ][™[™Ô^[Y[XÙZÛ\œËˆ™\]Y\İY™XÛÛ[Y[™][ÛÛİ[ˆ\œÙUY\“Ù™™\”™\]Y\İˆ[œİÙ\”›Û\ˆ^˜Xİ[™[Y[[ÜNˆÙ^˜Xİ[™[Y[[ÜKˆİ\œ™[ÛÛ^ˆ

HOˆİ]K˜İ\œ™[ÛÛ^ˆİ\œ™[™XÛÛ[Y[™][Û[™Nˆ

HOˆİ]K˜Xİ]™T™XÛÛ[Y[™][Û[™Kˆ™XÛÛ[Y[™][Û‘İÛ›ØYÎˆ

HOˆİ]Kœ™XÛÛ[Y[™][Û‘İÛ›ØYËˆ™YÚ\İ\”™XÛÛ[Y[™][Û‘İÛ›ØYˆ™YÚ\İ\”™\Ü™XÛÛ[Y[™][Û‘İÛ›ØYˆ™[™\“Y[[ÜT™XÛÛ[Y[™][Û‘İÛ›ØYØ\™ˆÚİ[™\\™PÚ]Y[[ÜT™XÛÛ[Y[™][Û‹ˆ™\\™PÚ]Y[[ÜT™XÛÛ[Y[™][Û‹ˆ\[™Ú]Y[[ÜT™XÛÛ[Y[™][ÛÛÛ^ˆ^ÛYY™XÛÛ[Y[™][Û’Ù^\Îˆ

HOˆ\œ˜^K™œ›ÛJİ]K™^ÛYY™XÛÛ[Y[™][Û’Ù^\ÊKˆ˜[šÙY™XÛÛ[Y[™][ÛœËˆZ[™\Ü^ÜÛ˜\ÚİˆZ[Y[[ÜT™XÛÛ[Y[™][Û”™\İ[ˆš[\”™\ÜÛÜšØ›ÛÚÔÛ˜\ÚİˆÚ]İ™\šY]ĞÛÛ[[“X™[Îˆ

HOˆÚ]İ™\šY]ĞÛÛ[[œË›X\

ÛÛ[[ŠHOˆÛÛ[[‹›X™[
KˆÛÛ^ÛÛ[[“X™[Îˆ

HOˆÛÛ^ÛÛ[[œÑ›ÜŠ
K›X\

ÛÛ[[ŠHOˆÛÛ[[‹›X™[
Kˆ™\Ü[X\šÙİÛˆ
[ŠHOˆ
[ˆÈ‘TÔ•ÓSÑWÒSÓQÑSˆˆ‘TÔ•ÓSÑWÒSÓQ
Kˆ›Ü›X]ÚY]Ù[ˆ[İÙ[[ˆØš™Xİ^ÜÛÛ[[œËˆY\”ÚY]^ÜÛÛ[[œËˆÛÜšÜÚY][ˆİ[\Ö[ˆÛÜšØ›ÛÚÖ[ˆÛÜšØ›ÛÚÔ™[Ö[ˆ›Ûİ™[Ö[ˆÛÛ[\\Ö[ˆÜ™X]UÛÜšØ›ÛÚÔÚY]Ëˆ›Ü›X]Y\”ÚY]Ù[ˆ
ÚY]˜[YK›İËXY\ŠHOˆ›Ü›X]Y\”ÚY]Ù[
ˆÚY]S˜[YJÚY]˜[YJHÈ˜[YNˆÚY]˜[YHKˆ›İÈßKˆXY\‚ˆ
Kˆ\Ü^PØ]YÛÜKˆ\Ú›Ø\™Ø]YÛÜQÜ›İ\Ëˆ\Ú›Ø\™Ø]YÛÜQ›Øİ\ÙYÜ›İ\Ëˆ\Ú›Ø\™Ø]YÛÜTYR[ˆ\Ú›Ø\™Ø]YÛÜTÙX\˜Ú[šY\Ëˆš[\‘\Ú›Ø\™Ø]YÛÜT™\ÜÜ›İ\ËˆØ]YÛÜT™\Ü\[™[˜ŞUY\œËˆÙ]Ø]YÛÜT™\Ü›Øİ\ÒÙ^Nˆ
Ù^JHOˆÈİ]K˜Ø]YÛÜT™\Ü›Øİ\ÒÙ^HHİš[™ÊÙ^HˆŠNÈKˆØ]YÛÜT™\Ü›Øİ\ÒÙ^Nˆ

HOˆİ]K˜Ø]YÛÜT™\Ü›Øİ\ÒÙ^KˆY\”ÚY]›İÜÑ›Ü‘\Ü^Nˆ
ÚY]˜[YJHOˆY\”ÚY]›İÜÑ›Ü‘\Ü^JÚY]S˜[YJÚY]˜[YJJKˆY\”™\Ü˜[™ÙKˆY\”™\Ü\[™[˜ŞUY\œËˆY\”›İĞ˜\ÙRÙ^KˆY\•X›TYÚ[˜][Û‹ˆY˜][Y\’XY\œÑ›Ü”ÚY]ˆ
ÚY]˜[YKXY\œÊHOˆY˜][Y\’XY\œÑ›Ü”ÚY]
ˆÚY]S˜[YJÚY]˜[YJHÈ˜[YNˆÚY]˜[YHKˆXY\œÂˆ
Kˆš\ÚX›UY\’XY\œÑ›Ü”ÚY]ˆ
ÚY]˜[YKXY\œÊHOˆš\ÚX›RXY\œÑ›Ü”ÚY]
ˆÚY]S˜[YJÚY]˜[YJHÈ˜[YNˆÚY]˜[YHKˆXY\œÂˆ
Kˆ™ZÙ^SX[X[Y\“[İ™\Ñ›Ü•\İˆ
[İ™\ÊHOˆÂˆÛÛœİ™]š[İ\Ó[İ™\ÈHİ]K›X[X[Y\“[İ™\ÎÂˆİ]K›X[X[Y\“[İ™\ÈHÈ‹‹Š[İ™\ÈßJHNÂˆÛÛœİÚ[™ÙYH™ZÙ^SX[X[Y\“[İ™\Ê
NÂˆÛÛœİ›Ü›X[^™Y[İ™\ÈH”ÓÓ‹œ\œÙJ”ÓÓ‹œİš[™ÚYJİ]K›X[X[Y\“[İ™\ÊJNÂˆİ]K›X[X[Y\“[İ™\ÈH™]š[İ\Ó[İ™\ÎÂˆ™]\›ˆÈÚ[™ÙY[İ™\Îˆ›Ü›X[^™Y[İ™\ÈNÂˆKˆY\”›İÒYÚYÚÚ[™ˆ
ÚY]˜[YK›İÊHOˆY\”›İÒYÚYÚÚ[™
ÚY]S˜[YJÚY]˜[YJHÈ˜[YNˆÚY]˜[YHK›İÈßJKˆš\İX[İ]\Ñ›Ü•Y\”›İÎˆ
ÚY]˜[YK›İÊHOˆš\İX[İ]\Ñ›Ü•Y\”›İÊÚY]S˜[YJÚY]˜[YJHÈ˜[YNˆÚY]˜[YHK›İÈßJKˆ\™Ù]™XÛÜ™Ëˆ™Y™\œ™Y\™Ù][Ûˆİ\œ™[™\Ü[™Ó[ÛÙ^Kˆ™\Üİ™\šY]Ó[ÛÙ^\Ëˆ[œİ\™T™\Ü[™Ó[Û™XÛÜ™ˆ\™Ù]”İ]\Ó[ÛÙ^Kˆ\™Ù][Û\ÓY]šXÜÎˆ
[Û
HOˆ\™Ù][Û\ÓY]šXÜÊ\™Ù]™XÛÜ™Ê
K[Û
Kˆ\™Ù]›ÙÜ™\ÜÒ[ˆ\™Ù]›ÙÜ™\ÜÑYš[š][Û‹ˆ\™Ù]^œ›ÛQY]˜[YKˆ\™Ù]™[™[ˆ\™Ù]™[™İ[ˆ\™Ù][ÛU™[™›İÜËˆ\™Ù]Z[U™[™›İÜËˆ“[ÛU™[™›İÜËˆ“[ÛT›İÑ›Ü’Ù^KˆÙ]\™Ù]š[\œÎˆ
š[\œÈHßJHOˆÈİ]K\™Ù]š[\œÈHÈ‹‹œİ]K\™Ù]š[\œË‹‹™š[\œÈNÈKˆÙ]\™Ù]™[™šY]Îˆ
šY]ÊHOˆÈİ]K\™Ù]™[™šY]ÈHšY]ÈOOH™^HˆÈ™^Hˆˆ›[ÛÈKˆÙ]”İ]\Ñ]Nˆ
^[ØY
HOˆÈİ]K™”İ]\Ë™]HH^[ØYÈİ]K™”İ]\Ë™\œ›ÜˆHˆÈİ]K™”İ]\Ë›ØY[™ÈH˜[ÙNÈİ]K™”İ]\Ë›[ÛÙ^HH[ÛÙ^Qœ›ÛU^
^[ØYË™Z[U™[™Ë›[ÛˆŠNÈKˆÙ]•Y\”İ[[X\Q]Nˆ
^[ØY
HOˆÈİ]K™•Y\”İ[[X\K™]HH^[ØYÈİ]K™•Y\”İ[[X\K™\œ›ÜˆHˆÈİ]K™•Y\”İ[[X\K›ØY[™ÈH˜[ÙNÈİ]K™•Y\”İ[[X\K›[ÛÙ^HH[ÛÙ^Qœ›ÛU^
^[ØYË›[ÛˆŠNÈKˆ[[Ñ”İ]\Ô^[ØYˆ”İ]\ÕšY]Ó[Ù[ˆ‘Z[U™[™›İÜËˆ‘Z[U™[™Ú\[ˆX›\Ú\“X[˜YÙ\“X]Ú\ÎˆÜX›\Ú\“X[˜YÙ\“X]Ú\ËˆX›\Ú\œÑ›Ü“X[˜YÙ\ˆÜX›\Ú\œÑ›Ü“X[˜YÙ\‹ˆš[\™YX›\Ú\œÎˆÙ]š[\™YX›\Ú\œËˆX›\Ú\“Y\˜Ú[X]Ú\ÎˆÜX›\Ú\“Y\˜Ú[X]Ú\ËˆX›\Ú\“Y\˜Ú[Ü[ÛœÎˆÜX›\Ú\“Y\˜Ú[Ü[ÛœËˆX›\Ú\“Y\˜Ú[\ÜÛØÚX][Û”İ[[X\NˆÜX›\Ú\“Y\˜Ú[\ÜÛØÚX][Û”İ[[X\KˆX›\Ú\•Y\“Ü[ÛœÎˆÜX›\Ú\•Y\“Ü[ÛœËˆX›\Ú\“Y]šXĞY™‘\ÎˆÜX›\Ú\“Y]šXĞY™‘\ËˆX›\Ú\“Y]šXÑ\ÎˆÜX›\Ú\“Y]šXĞY™‘\ËˆX›\Ú\“Y]šXĞÛÛ™\œÚ[Û”˜]NˆÜX›\Ú\“Y]šXĞÛÛ™\œÚ[Û”˜]KˆX›\Ú\“Y]šXĞY™ÛÛ[Z\ÜÚ[ÛˆÜX›\Ú\“Y]šXĞY™ÛÛ[Z\ÜÚ[Û‹ˆX›\Ú\“Y]šXĞY™ÛÛ[Z\ÜÚ[Û”˜]NˆÜX›\Ú\“Y]šXĞY™ÛÛ[Z\ÜÚ[Û”˜]KˆX›\Ú\Y™š[š]Tİ[[X\NˆÜX›\Ú\Y™š[š]Tİ[[X\Kˆ›Ü›X[^™S[ÛS™]ÓY\˜Ú[™XÛÜ™ˆ™\ÛÛ™S[ÛS™]ÓY\˜Ú[Yˆš[\™Y[ÛS™]ÓY\˜Ú[™XÛÜ™Ëˆ[ÛS™]ÓY\˜Ú[\™Ù]İ[ˆZ[[ÛS™]ÓY\˜Ú[^[ØYˆ›Ü›X[^™S[ÛS™]ÓY\˜Ú[[\ÜXY\‹ˆ\œÙS[ÛS™]ÓY\˜Ú[X›Kˆ\œÙS[ÛS™]ÓY\˜Ú[[Û™^Kˆ\œÙS[ÛS™]ÓY\˜Ú[ÛÛ[Z\ÜÚ[Û‹ˆ[ÛS™]ÓY\˜Ú[[\Ü›İÜËˆ˜]šYØ][Û‘Ü›İ\›Ü”YÙKˆYÙP™[Û™ÜÕÔ™\ÜËˆÙ™™\•˜XÚÙ\ÛÛ[Z\ÜÚ[Û”˜]KˆÙ™™\•˜XÚÙ\”™]™[YKˆÙ™™\•˜XÚÙ\[İ•\KˆÙ™™\•˜XÚÙ\[İ•\SX™[ˆÙ™™\•˜XÚÙ\[İÙ[[ˆÙ™™\•˜XÚÙ\‘]T˜[™ÙKˆÙ™™\•˜XÚÙ\”˜[™ÙSX™[ˆÙ™™\•˜XÚÙ\˜”ÛXŞRÙ^KˆÙ™™\•˜XÚÙ\˜”ÛXŞSX™[ˆÙ™™\•˜XÚÙ\˜”ÛXŞPÙ[[ˆÙ™™\•˜XÚÙ\\Ú[œËˆÙ™™\•˜XÚÙ\”ØÛÜ™KˆÙ™™\•˜XÚÙ\”š[Üš]KˆÙ™™\•˜XÚÙ\”š[Üš]SX™[ˆÙ™™\•˜XÚÙ\”™XÛÛ[Y[™][Û‹ˆÙ™™\•˜XÚÙ\”Ù[XİYY\œËˆÙ™™\•˜XÚÙ\”Ù[XİYØ]YÛÜšY\ËˆÙ™™\•˜XÚÙ\”Ù[XİY™]ÛÜšÜËˆš[\“Ù™™\•˜XÚÙ\”›İÜËˆÙ™™\•˜XÚÙ\”›İÜĞ\™TÙ[XİYˆ\]SÙ™™\•˜XÚÙ\”›İÔÙ[Xİ[Û‹ˆÙ™™\•˜XÚÙ\”Ù[Xİ[Û”İ[[X\KˆÙ™™\•˜XÚÙ\“Ù™™\‘^ÜÛÛ[[œËˆÙ™™\•˜XÚÙ\”›ÙXİ^ÜÛÛ[[œËˆÙ™™\•˜XÚÙ\‘š[\Ú\X™[ËˆÙ™™\•˜XÚÙ\•Y\Ûİ[ËˆÙ™™\•˜XÚÙ\‘^Ü›İÜËˆÙ™™\•˜XÚÙ\‘^ÜY\”Ü[œËˆ˜[Y]SÙ™™\•˜XÚÙ\˜XÚÙÜ›İ[™˜[™Ù\ËˆÛÜšÜÚY]›İĞ˜XÚÙÜ›İ[™ÛÛÜ‹ˆÜ™X]T™XÛÛ[Y[™][Û•ÛÜšØ›ÛÚËˆY˜][Ù™™\•˜XÚÙ\”[\Îˆ

HOˆ
È‹‹‘QUSÓÑ‘‘T—ÕPÒÑT—Ô•STÈJKˆÙ]X›\Ú\”Ü›Û[Ñš[\œÎˆ
š[\œÈHßJHOˆÂˆİ]KœX›\Ú\“X\šÙ]Hš[\œË›X\šÙ]OH[Èİ]KœX›\Ú\“X\šÙ]ˆš[\œË›X\šÙ]Âˆİ]KœX›\Ú\“™]ÛÜšÈHš[\œË›™]ÛÜšÈOH[Èİ]KœX›\Ú\“™]ÛÜšÈˆš[\œË›™]ÛÜšÎÂˆİ]KœX›\Ú\“Y\˜Ú[ÙX\˜ÚHš[\œË›Y\˜Ú[ÙX\˜ÚOH[ˆÈİ]KœX›\Ú\“Y\˜Ú[ÙX\˜Úˆˆš[\œË›Y\˜Ú[ÙX\˜ÚÂˆİ]KœX›\Ú\“Y\˜Ú[Ù[XİYYHš[\œË›Y\˜Ú[YOH[ˆÈİ]KœX›\Ú\“Y\˜Ú[Ù[XİYYˆˆİš[™Êš[\œË›Y\˜Ú[YˆŠNÂˆİ]KœX›\Ú\”Ü›Û[ÔÙX\˜ÚHš[\œËœÜ›Û[ÔÙX\˜ÚOH[ˆÈİ]KœX›\Ú\”Ü›Û[ÔÙX\˜Úˆˆš[\œËœÜ›Û[ÔÙX\˜ÚÂˆİ]KœX›\Ú\”Ü›Û[ĞØ]YÛÜHHš[\œË˜Ø]YÛÜHOH[ˆÈİ]KœX›\Ú\”Ü›Û[ĞØ]YÛÜBˆˆš[\œË˜Ø]YÛÜNÂˆİ]KœX›\Ú\”Ü›Û[ÕY\ˆHš[\œËY\ˆOH[ˆÈİ]KœX›\Ú\”Ü›Û[ÕY\‚ˆˆš[\œËY\ÂˆKˆX›\Ú\”Ü›Û[Ô›İÜÑ›Ü”İ]Nˆ
Y\˜Ú[Ë[˜ÛYTÜ›Û[ĞÛÛ›ÛÈHYJHO‚ˆÜX›\Ú\”Ü›Û[Ô›İÜÑ›Ü”İ]JY\˜Ú[È×K[˜ÛYTÜ›Û[ĞÛÛ›ÛÊKˆ[˜[^™SY\˜Ú[ˆ[˜[^™PØ]YÛÜKˆ[˜[^™UY\‹ˆ[˜[\Ú\ÓY]šXÕ˜[YQ›Ü“Ù™™\‹ˆ[˜[\Ú\ÓY]šXÔØ[\TÚ^™Kˆ[˜[\Ú\ÓY]šXÔØ[\Q[YÚX›Kˆ[˜[\Ú\Ğ]™\˜YÙKˆÙ™™\[ÛÛ[Z\ÜÚ[Û‹ˆÙ™™\Y™ÛÛ[Z\ÜÚ[Û‹ˆÛÛ[Z\ÜÚ[Û‘\Ñœ›ÛUİ[ËˆÙ™™\[\ËˆÙ™™\Y™‘\Ëˆ[Û™^KˆÚÜ\ËˆX™[^ˆ™[™\“Y\˜Ú[İ]Ëˆ\ËˆİˆÛİ[˜[YKˆ›Ü›X][ÛX™[ˆY\™ÙS[Û[ÓÙ™™\‹ˆÙ[XİY[Û›İËˆY\˜Ú[[ÛXÚÙ\’[ˆ[ÛSY]šXÔ›İÜËˆÙ™™\SY\˜Ú[Yˆ™]ÚY\˜Ú[[ÛT›İÜËˆY\˜Ú[İ™\šY]Ò[ˆY\˜Ú[İ™\šY]ĞØ\™[›™\‹ˆ[š[˜ÙSY\˜Ú[Ø\™Ëˆ™XÛÛ[Y[™][Û‘^ÜÛÛ[[œËˆËÈ9dàyìnú-¢ùb¯ÈY\šY]ûï"9dàyìnù."ù¢âKùaj:aãú f¹d"ùb!ù£hº e9bª;ï"Bˆ\ÕY\Ü›XÚËˆÙ™™\œÒ[Ø]YÛÜKˆØ]YÛÜS\İ›Ü•™[™ˆ™]ÚYÙÜ™YØ]Y[ÛSY]šXÜËˆ™]ÚØ]YÛÜU™[™Y]šXÜËˆ™[™[˜[\Ú\Õ]Kˆ™[™\•™[™ÛÛ^ˆ™[™\Ø]YÛÜU™[™ˆİÚ]Ú™[™Ø]YÛÜKˆZ[™[™ÛÛ^ˆÛÛ\]U™[™ˆ™[™ÛÛ^]Nˆ

HOˆİ™[™ÛÛ^]KˆXİ]™U™[™Ø]YÛÜNˆ

HOˆØXİ]™U™[™Ø]YÛÜKˆØ]YÛÜS[ÛPØXÚNˆ

HOˆØØ]YÛÜS[ÛPØXÚKˆ™\Ù]YÙ[™[™ØXÚNˆ

HOˆÈ“Y\˜Ú[ØXÚK˜ÛX\Š
NÈØØ]YÛÜS[ÛPØXÚHHßNÈBˆNÂˆH[ÙHÂˆ[š]

NÂˆB‚ˆËÈ™YÚ\İ\ˆØ[˜XÚÈ›Üˆ^K[ØYYÙ^]ÛÜ™]H
œ›ÛH]]šœÊBˆÚ[™İË—×ÛÛ“Ù™™\’Ù^]ÛÜ™ÓØYYH[˜İ[Ûˆ
İÔ™\Ü
HÂˆYˆ
ZİÔ™\ÜP\œ˜^Kš\Ğ\œ˜^JİÔ™\Ü›Y\˜Ú[ÊJH™]\›ÂˆY\™ÙT›ÙXİÙ^]ÛÜ™Ò[ÓÙ™™\œÊÙ™™\œËİÔ™\Ü
NÂˆNÂŸJJ
NÂ