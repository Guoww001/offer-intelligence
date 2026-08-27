# 前端框架迁移页面清单

> 盘点日期：2026-08-27  
> 权威路由入口：`public/app.js` 的 `switchPage(page)`  
> 状态枚举：`legacy`、`dual`、`modern`、`removed`

## 使用规则

- 下方受控 JSON 区块是页面迁移状态的机器可读权威来源；说明文字用于补充跨页面依赖。
- `legacy` 表示完全由原生 JS 渲染；`dual` 表示新旧两套实现可切换；`modern` 表示默认使用 Vue 但旧代码仍在回滚窗口；`removed` 表示对应旧实现和桥接已删除。
- 状态变化必须附带目标测试、相关旧回归、构建、差异检查和浏览器验收证据。
- `tests` 只记录当前确实存在的测试。没有页面级覆盖时使用空数组，并在 `testGap` 中明确记录缺口。
- `apis`、`storage`、`exports` 或 `overlays` 可以为空数组，表示当前页面没有该类专属依赖，不表示跨页面启动链不存在。

## 机器可读清单

<!-- FRONTEND_MIGRATION_INVENTORY_START -->
```json
{
  "schemaVersion": 1,
  "pages": [
    {
      "pageKey": "agent",
      "label": "Chat Agent",
      "status": "legacy",
      "roots": ["#dashboardAgentPage"],
      "legacyEntry": ["switchPage()", "renderAgentPageWelcomeIfIdle()", "handleAgentPageSubmit()", "runChatAgent()"],
      "state": ["state.page", "state.agentPage", "state.language", "state.agentEnabled"],
      "apis": ["/api/chat/agent", "/api/chat/stream", "/api/chat/stream?operation=agent_trace", "/api/chat/stream?operation=questions", "/api/chat/stream?operation=feedback"],
      "storage": ["oi_agent_memory_v1", "oiChatbotQuestionSessionId.v1", "offerLanguage"],
      "exports": ["question log download", "answer feedback download", "agent trace download"],
      "overlays": ["agent execution timeline", "#answerFeedbackDialog"],
      "tests": ["scripts/test_dashboard_chat_pages.mjs", "scripts/test_chat_agent.mjs", "scripts/test_agent_memory_state.mjs", "scripts/test_agent_trace.mjs", "scripts/test_agent_stop_button.mjs", "scripts/test_agent_execution_timeline.mjs"],
      "testGap": "",
      "notes": "独立 Agent 页面复用浏览器只读工具、服务端计划证明、SSE 综合、Trace 和结构化记忆；必须最后迁移。"
    },
    {
      "pageKey": "dashboard",
      "label": "Chatbot Report/Chat Mode",
      "status": "legacy",
      "roots": [".topbar.dashboard-page", ".main-grid.dashboard-page"],
      "legacyEntry": ["switchPage()", "renderAll()", "answerPrompt()", "applyPrompt()"],
      "state": ["state.currentQuery", "state.currentContext", "state.deepMode", "state.deepReport", "state.deepHistory", "state.chatHistory", "state.reportMemory", "state.chatIntentOverride"],
      "apis": ["/api/chat/classify", "/api/chat/analyze", "/api/chat/stream", "/api/ui/db/chatbot-offers", "/api/ui/db/merchant", "/api/ui/db/search", "/api/chat/stream?operation=questions", "/api/chat/stream?operation=feedback"],
      "storage": ["offerLanguage", "oi_onboarding_done", "oi_welcome_collapsed", "oi_reminder_collapsed", "oi_starter_collapsed", "oiChatbotQuestionSessionId.v1"],
      "exports": ["downloadRecommendationXlsx()", "question log download", "answer feedback download"],
      "overlays": ["Deep Window stack", "#answerFeedbackDialog", "#userFlowImageLightbox"],
      "tests": ["scripts/test_chatbot_intent_flow.mjs", "scripts/test_zh_chatbot.mjs", "scripts/test_chatbot_mode_navigation.mjs", "scripts/test_report_mode_guide.mjs", "scripts/test_onboarding_tour.mjs", "scripts/test_chatbot_welcome.mjs", "scripts/test_chatbot_answer_feedback_frontend.mjs"],
      "testGap": "",
      "notes": "包含 Report/Chat Mode、上下文、记忆栏、Deep Window、推荐导出、问题日志、反馈和 onboarding；以 docs/chatbot-feature-report.md 为权威说明。"
    },
    {
      "pageKey": "payments",
      "label": "Payments",
      "status": "modern",
      "roots": ["#paymentsPage", "#paymentsModernRoot"],
      "legacyEntry": ["switchPage()", "renderPaymentsPage()", "refreshLevantaPayments()", "downloadPaymentsXlsx()", "downloadModernPayments()"],
      "state": ["state.payments", "state.paymentSort", "state.paymentSource", "state.livePaymentsLoaded", "state.livePaymentsLoading"],
      "apis": ["/api/levanta/payments"],
      "storage": ["offerPaymentLastAutoSync"],
      "exports": ["downloadPaymentsXlsx()"],
      "overlays": [],
      "tests": ["scripts/test_payment_placeholders.py", "scripts/test_zh_chatbot.mjs", "scripts/test_payments_frontend.mjs", "frontend/src/features/payments/paymentModel.test.ts", "frontend/src/features/payments/usePayments.test.ts", "frontend/src/features/payments/PaymentsPage.test.ts"],
      "testGap": "",
      "notes": "Payments 默认由 Vue modern root 渲染；保留 legacy fallback。付款记录包含 Paid、Pending、Unpaid、Overdue、Partial；零 Revenue 且零 Commission 记录必须从页面和导出排除。现代页面已对齐参考 Payments 布局：紧凑页头、4×2 摘要卡、两行筛选、固定高度可滚动表格和表头下载入口。"
    },
    {
      "pageKey": "publishers",
      "label": "Publishers",
      "status": "legacy",
      "roots": ["#publishersPage"],
      "legacyEntry": ["switchPage()", "renderPublishersPage()", "loadPublishersData()", "downloadPublishersXlsx()"],
      "state": ["state.publisherMarket", "state.publisherNetwork", "state.publisherLinkType", "state.publisherManagerSearch", "state.publisherPortfolioSearch", "state.publisherSort", "state.publisherTablePage", "state.publisherLayoutEditing", "state.publisherLayout"],
      "apis": ["/api/ui/db/publishers"],
      "storage": ["publisherLayoutOrder"],
      "exports": ["downloadPublishersXlsx()"],
      "overlays": ["publisher layout editing mode"],
      "tests": ["scripts/test_publisher_manager_tier_frontend.mjs", "scripts/test_publishers_portfolio.py", "scripts/test_chatbot_publisher_records.mjs", "scripts/test_chatbot_publisher_profile.mjs"],
      "testGap": "",
      "notes": "页面包含 Overview、Manager、Site、Tracking、Portfolio、布局编辑和当前页/组合导出；离开页面必须退出布局编辑。"
    },
    {
      "pageKey": "brand-media",
      "label": "Brand Media",
      "status": "legacy",
      "roots": ["#brandMediaPage"],
      "legacyEntry": ["switchPage()", "renderBrandMediaPage()", "_brandMediaLoadTrend()", "_bindBrandMediaPageInteractions()"],
      "state": ["state.brandMedia"],
      "apis": ["/api/ui/db/publishers", "/api/ui/db/brand-media-trend"],
      "storage": [],
      "exports": [],
      "overlays": ["expanded brand media chart", "merchant combobox dropdown"],
      "tests": ["scripts/test_brand_media_trend.py", "scripts/test_brand_media_trend_frontend.mjs"],
      "testGap": "缺少真实浏览器中的图表 hover、Manager 联动和展开/恢复回归。",
      "notes": "品牌目录来自 Publishers；趋势接口错误、无数据和未选择品牌必须保持不同状态。"
    },
    {
      "pageKey": "revenue-flow",
      "label": "Revenue Flow",
      "status": "legacy",
      "roots": ["#revenueFlowPage"],
      "legacyEntry": ["switchPage()", "renderRevenueFlowPage()", "_revenueFlowLoad()", "_bindRevenueFlowPageInteractions()"],
      "state": ["state.revenueFlow"],
      "apis": ["/api/ui/db/publishers", "/api/ui/db/brand-media-sankey"],
      "storage": [],
      "exports": [],
      "overlays": ["expanded revenue flow chart", "merchant multi-select dropdown"],
      "tests": [],
      "testGap": "当前没有 Revenue Flow 页面或 Sankey Canvas 的独立回归；进入 M4 前必须先补行为测试。",
      "notes": "最多选择 12 个品牌，页面维护请求去重、payload 缓存、延迟加载和图表展开生命周期。"
    },
    {
      "pageKey": "google-ads",
      "label": "Google Ads Workbench",
      "status": "legacy",
      "roots": ["#googleAdsPage"],
      "legacyEntry": ["switchPage()", "renderGoogleAdsPage()", "_googleAdsLoad()", "_bindGoogleAdsPageInteractions()"],
      "state": ["state.googleAds"],
      "apis": ["/api/ui/db/google-ads-workbench"],
      "storage": [],
      "exports": [],
      "overlays": [],
      "tests": ["scripts/test_google_ads_workbench.py", "scripts/test_google_ads_workbench_frontend.mjs"],
      "testGap": "缺少真实浏览器中的日期范围、刷新和图表渲染验收。",
      "notes": "聚合 Google Ads 与 Backend Orders，必须保留匹配覆盖率、ROAS 和归因边界说明。"
    },
    {
      "pageKey": "monthly-new-merchants",
      "label": "Monthly New Merchants",
      "status": "legacy",
      "roots": ["#monthlyNewMerchantsPage"],
      "legacyEntry": ["switchPage()", "renderMonthlyNewMerchantsPage()", "loadMonthlyNewMerchants()", "openMonthlyNewMerchantDrawer()", "openMonthlyNewMerchantImport()"],
      "state": ["state.monthlyNewMerchants"],
      "apis": ["/api/ui/db/monthly-new-merchants"],
      "storage": [],
      "exports": ["downloadMonthlyNewMerchantTemplate()"],
      "overlays": ["monthly merchant edit drawer", "monthly merchant import dialog", "month picker"],
      "tests": ["scripts/test_monthly_new_merchants.py", "scripts/test_monthly_new_merchants_frontend.mjs"],
      "testGap": "",
      "notes": "包含新增/编辑抽屉、文件或粘贴导入、模板下载、焦点恢复和批量保存。"
    },
    {
      "pageKey": "offer-list-tracker",
      "label": "Offer List Tracker",
      "status": "dual",
      "roots": ["#offerListTrackerPage", "#offerListTrackerModernRoot"],
      "legacyEntry": ["switchPage()", "renderOfferListTrackerPage()", "loadOfferTrackerRange()", "downloadOfferTrackerWorkbook()"],
      "state": ["state.offerListTracker"],
      "apis": ["/api/ui/db/offers"],
      "storage": ["offerListTrackerRulesV1", "offerListTrackerColumnsV1", "offerListTrackerSavedViewsV1"],
      "exports": ["downloadOfferTrackerWorkbook()", "triggerWorkbookDownload()"],
      "overlays": ["Offer Tracker export dialog", "column panel", "rules panel", "saved views menu"],
      "tests": ["scripts/test_offer_list_tracker_frontend.mjs", "scripts/test_offer_tracker_date_range.py", "frontend/src/features/offer-tracker/offerTrackerModel.test.ts", "frontend/src/features/offer-tracker/OfferTrackerPage.test.ts", "frontend/src/shared/api/client.test.ts", "frontend/src/shared/i18n/index.test.ts"],
      "testGap": "核心路径已完成真实浏览器验收；尚缺旧/新页面同一 fixture 的逐字段自动差异报告，高级保存视图、列面板、规则面板和导出对话框仍只在 legacy 回退实现。",
      "notes": "M2 首个试点已进入 dual：核心筛选、排序、选择、分页和导出入口由 Vue 接管；M3 已接入共享 API client、错误类型和 i18n；保存视图、列面板、规则面板和旧导出对话框仍保留在 legacy 回退实现。选择变化必须使用局部同步，不能对全部缓存 Offer 重新筛选、排序和重建 DOM。"
    },
    {
      "pageKey": "sheets",
      "label": "Targets",
      "status": "legacy",
      "roots": ["#sheetPage"],
      "legacyEntry": ["switchPage()", "renderSheetPage()", "refreshTargetMetricViews()", "downloadSheetTargetsXlsx()"],
      "state": ["state.targetFilters", "state.targetMetric", "state.targetTrendView", "state.targetOverrides", "state.targetSort", "state.dbStatus", "state.dbTierSummary"],
      "apis": ["/api/ui/db/status", "/api/ui/db/tier-summary"],
      "storage": ["offerTargetTextOverrides.v1"],
      "exports": ["downloadSheetTargetsXlsx()"],
      "overlays": ["inline target edit form"],
      "tests": ["scripts/test_target_month_selection.mjs", "scripts/test_db_status_view_model.mjs", "scripts/test_tier_report_frontend.mjs"],
      "testGap": "缺少完整 Targets 页面趋势、矩阵、编辑和导出浏览器回归。",
      "notes": "页面包含月份对比、目标文案编辑、趋势图和矩阵；Total 与各 Tier 的业务口径必须保持一致。"
    },
    {
      "pageKey": "category",
      "label": "Category Report",
      "status": "legacy",
      "roots": ["#categoryPage"],
      "legacyEntry": ["switchPage()", "ensureDashboardCategoryReportData()", "renderDashboardCategoryReport()", "downloadFocusedCategoryRows()"],
      "state": ["state.categoryReportTiers", "state.categoryReportSearch", "state.categoryReportSelection", "state.categoryReportSort", "state.categoryReportDirection", "state.categoryReportFocusKey", "state.expandedCategoryKey", "state.tierReport"],
      "apis": ["/api/ui/db/tier_sheet"],
      "storage": [],
      "exports": ["downloadFocusedCategoryRows()", "downloadRowsAsXlsx()"],
      "overlays": ["category pie spotlight", "category focused detail"],
      "tests": ["scripts/test_sheet_categories.mjs", "scripts/test_category_drilldown.mjs", "scripts/test_category_trend.mjs", "scripts/test_tier_report_frontend.mjs"],
      "testGap": "",
      "notes": "主分类解析、Tier 选择、排序、饼图、趋势和导出必须使用现有数据库与 Sheet 分类优先级。"
    },
    {
      "pageKey": "tier",
      "label": "Tier Sheet",
      "status": "legacy",
      "roots": ["#tierPage"],
      "legacyEntry": ["switchPage()", "renderTierPage()", "renderTierSheetTable()", "openTierSheetOverlay()", "openTierMoveDialog()"],
      "state": ["state.selectedTierPage", "state.expandedTierSheet", "state.selectedTierRowKeys", "state.visibleTierRowKeys", "state.tierTablePages", "state.manualTierMoves", "state.tier1Management", "state.tierSheetFilters", "state.tierReport", "state.tierVisibleColumns", "state.trendVisibleColumns"],
      "apis": ["/api/ui/db/tier_sheet", "/api/ui/db/tier-summary", "/api/ui/db/tier1-merchants", "/api/tier_moves"],
      "storage": ["offerTierOverrides", "offerTierVisibleColumns.v4", "offerTrendVisibleColumns.v1", "offerTierSheetManualMoves.v1", "offerTierMoveAdminToken"],
      "exports": ["downloadTierSheetXlsx()", "downloadRowsAsXlsx()"],
      "overlays": ["Tier Sheet overlay", "Tier Move dialog", "Tier 1 additions overlay", "Tier 1 merchant dialog", "Tier column panel"],
      "tests": ["scripts/test_tier_report_frontend.mjs", "scripts/test_tier_visual_status.mjs", "scripts/test_tier_visual_status_rules.py", "scripts/test_tier1_merchant_frontend.mjs", "scripts/test_tier2_recommendation_rules.mjs", "scripts/test_manual_tier_automation.py"],
      "testGap": "缺少完整 Tier Move 共享 webhook 的真实浏览器端到端验收。",
      "notes": "Tier 1–4 与 BLACK TIER、颜色状态、手动移动、列配置、分页、Overlay 和 XLSX 是同一迁移域。"
    }
  ]
}
```
<!-- FRONTEND_MIGRATION_INVENTORY_END -->

## 跨页面启动与共享依赖

| 依赖 | 当前入口 | 迁移要求 |
| --- | --- | --- |
| 认证与数据预载 | `public/auth.js` | M1 保持会话、登录和 `/api/ui/db/offers` 语义；modern bundle 失败时仍可进入旧应用 |
| 全局导航 | `switchPage()`、`syncNavigationGroupState()` | Shell 迁移前保持唯一权威入口，禁止新旧两侧各维护一套路由状态 |
| 语言 | `state.language`、`offerLanguage`、`chatbot_i18n.js`、`frontend/src/shared/i18n/` | legacy 仍由 `state.language` 管理，通过 `OI_MODERN_APP.setLanguage()` 同步 modern；迁移文案必须中文/英文成对维护 |
| 共享 API、错误与契约 | `frontend/src/shared/api/`、`frontend/src/shared/contracts/` | M3 的 modern 页面使用统一 JSON/错误/超时边界；契约只保留跨页面稳定字段，不复制完整数据库响应 |
| 导出 | `downloadRowsAsXlsx()`、`triggerWorkbookDownload()` | M2–M5 通过窄 bridge 复用，字段级等价后迁移为共享模块 |
| Deep Window | `_deepPanels` 与相关渲染函数 | 页面切换、最小化、恢复和请求中止在 Chatbot 阶段统一迁移 |
| 数据启动对象 | `window.CHATBOT_DATA`、`window.SHEET_REPORT_DATA`、`window.PRODUCT_KEYWORDS` | 只在 `LegacyBootstrapData` 边界读取，Vue feature 不得直接读取任意全局对象 |
| 主题与移动导航 | `public/index.html` 内联主题脚本、`public/app.js` 事件绑定 | M4 Shell 阶段迁移，之前不能改变现有主题默认值和焦点陷阱 |

## 当前测试缺口优先级

1. P0：Revenue Flow 没有独立回归，进入其迁移任务前必须建立 Sankey 数据、选择上限、缓存和图表生命周期测试。
2. P1：Offer Tracker 核心大数据路径和下载已完成浏览器验收；M3 后仍需补旧/新页面逐字段差异报告并迁移高级面板。
3. P1：Targets 缺少趋势、矩阵、编辑和导出的完整浏览器流程。
4. P1：Brand Media、Google Ads 和 Tier 的现有源码回归仍需补真实浏览器交互证据。

## 状态更新记录

| 日期 | 页面 | 旧状态 | 新状态 | 证据 |
| --- | --- | --- | --- | --- |
| 2026-08-27 | 全部页面 | 无清单 | `legacy` | M0 首次盘点；尚未开始框架运行时代码 |
| 2026-08-27 | Offer List Tracker | `legacy` | `dual` | Vue 核心筛选/排序/选择/分页/导出入口、legacy fallback、Vitest/构建契约和应用内浏览器验收通过；高级面板仍由 legacy 提供 |
| 2026-08-27 | 共享前端模块 | 未建立 | 已建立 | M3 新增 shared API/error、Tier/Payment 契约和 i18n；Offer Tracker 已接入，Vitest、类型检查、构建和旧回归通过；其他页面仍待后续迁移 |
| 2026-08-27 | Payments | `legacy` | `modern` | Vue model/composable/组件、live API 错误保留 saved rows、月份/状态/搜索/排序、零金额排除、窄 XLSX bridge、legacy fallback、全量 Vitest/类型检查/构建和应用内 Edge 浏览器验收通过；browser-act 无已配置浏览器，8766 隔离服务的 API 仍因缺少 `LEVANTA_API_KEY` 返回 503，受控错误路径已验证 |
