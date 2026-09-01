# 前端框架迁移页面清单

> 盘点日期：2026-08-27  
> 最近更新：2026-09-01（Google Ads Vue 双轨接入；固定 fixture 云端旧版/Vue 对比）
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
      "status": "modern",
      "roots": ["#publishersPage", "#publishersModernRoot"],
      "legacyEntry": ["switchPage()", "renderPublishersPage()", "loadPublishersData()", "downloadPublishersXlsx()"],
      "modernEntry": ["frontend/src/entry.ts", "frontend/src/features/publishers/PublishersPage.vue", "frontend/src/features/publishers/publisherModel.ts", "frontend/src/features/publishers/usePublishers.ts"],
      "state": ["state.publisherMarket", "state.publisherNetwork", "state.publisherLinkType", "state.publisherManagerSearch", "state.publisherPortfolioSearch", "state.publisherSort", "state.publisherTablePage", "state.publisherLayoutEditing", "state.publisherLayout"],
      "apis": ["/api/ui/db/publishers"],
      "storage": ["publisherLayoutOrder"],
      "exports": ["downloadPublishersXlsx()"],
      "overlays": ["publisher layout editing mode"],
      "tests": ["scripts/test_publisher_manager_tier_frontend.mjs", "scripts/test_publishers_portfolio.py", "scripts/test_publishers_frontend.mjs", "scripts/test_chatbot_publisher_records.mjs", "scripts/test_chatbot_publisher_profile.mjs", "frontend/src/features/publishers/publisherModel.test.ts", "frontend/src/features/publishers/usePublishers.test.ts", "frontend/src/features/publishers/PublishersPage.test.ts"],
      "testGap": "",
      "notes": "Publishers 默认由 Vue modern root 渲染；保留 legacy fallback。页面包含 Overview、Manager、Site、Tracking、Portfolio、筛选、排序、分页、列设置、布局编辑和当前页/全部导出；离开页面必须退出布局编辑。选中 Publisher 后，顶部 KPI 与商家组合切换到该媒体的 profile/portfolio 口径；零订单商家仍保留在组合中，AOV 在订单为 0 时显示 N/A。已在持久化 Sites 视觉 QA 站点完成 modern/legacy 同视口对比。"
    },
    {
      "pageKey": "brand-media",
      "label": "Brand Media",
      "status": "dual",
      "roots": ["#brandMediaPage", "#brandMediaModernRoot"],
      "legacyEntry": ["switchPage()", "brandMediaFactory", "renderBrandMediaPage()", "_brandMediaLoadTrend()", "_bindBrandMediaPageInteractions()"],
      "state": ["state.brandMedia", "useBrandMedia() 的 merchant/date/manager/lockedKeys 状态"],
      "apis": ["/api/ui/db/publishers", "/api/ui/db/brand-media-trend"],
      "storage": [],
      "exports": [],
      "overlays": ["expanded brand media chart", "merchant combobox dropdown"],
      "tests": ["scripts/test_brand_media_trend.py", "scripts/test_brand_media_trend_frontend.mjs", "scripts/test_brand_media_frontend.mjs", "frontend/src/features/brand-media/brandMediaModel.test.ts", "frontend/src/features/brand-media/useBrandMedia.test.ts", "frontend/src/features/brand-media/BrandMediaPage.test.ts"],
      "testGap": "真实趋势接口在当前本地环境返回 503，已验证受控错误，但未能以真实数据完成图表对比；390px 视口已由用户验收通过。",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；品牌目录来自 Publishers；趋势请求使用 AbortController 和过期响应保护；订单折线图保留缺失日期断线、真实零值和 Revenue hover，媒体锁定后提供单媒体/累计点击图。桌面端已完成旧 CSS/HTML 几何对齐及 BrowserAct hover、Manager、锁定、展开/Escape 验收；390px 已由用户验收通过，真实趋势 populated 验收仍待数据环境补验。"
    },
    {
      "pageKey": "revenue-flow",
      "label": "Revenue Flow",
      "status": "dual",
      "roots": ["#revenueFlowPage", "#revenueFlowModernRoot"],
      "legacyEntry": ["switchPage()", "renderRevenueFlowPage()", "_revenueFlowLoad()", "_bindRevenueFlowPageInteractions()", "modernApp.mountPage(\"revenue-flow\")"],
      "state": ["state.revenueFlow", "useRevenueFlow() 的品牌选择/日期/请求/展开状态"],
      "apis": ["/api/ui/db/publishers", "/api/ui/db/brand-media-sankey"],
      "storage": [],
      "exports": [],
      "overlays": ["expanded revenue flow chart", "merchant multi-select dropdown"],
      "tests": ["frontend/src/features/revenue-flow/revenueFlowModel.test.ts", "frontend/src/features/revenue-flow/useRevenueFlow.test.ts", "frontend/src/features/revenue-flow/RevenueFlowPage.test.ts", "scripts/test_revenue_flow_frontend.mjs"],
      "testGap": "现代 Revenue Flow feature、请求契约和 Canvas 交互已有聚焦回归；当前真实数据与 390px BrowserAct 验收仍待补验，页面已具备完整公共壳层和构建产物。",
      "notes": "最多选择 12 个品牌，useRevenueFlow 维护模块级请求去重、进行中请求复用、AbortController、payload 缓存、日期快捷范围和展开生命周期；Revenue FlowSankey 使用 Canvas、可聚焦节点 overlay 与连线 Flow tooltip，entry 使用 /api/ui/db/publishers 和 /api/ui/db/brand-media-sankey，挂载失败保留 legacy fallback。"
    },
    {
      "pageKey": "google-ads",
      "label": "Google Ads Workbench",
      "status": "dual",
      "roots": ["#googleAdsPage", "#googleAdsModernRoot"],
      "legacyEntry": ["switchPage()", "renderGoogleAdsPage()", "_googleAdsLoad()", "_bindGoogleAdsPageInteractions()", "modernApp.mountPage(\"google-ads\")"],
      "modernEntry": ["frontend/src/entry.ts", "frontend/src/features/google-ads/GoogleAdsPage.vue", "frontend/src/features/google-ads/googleAdsModel.ts", "frontend/src/features/google-ads/useGoogleAds.ts"],
      "state": ["state.googleAds", "useGoogleAds() 的日期/请求/加载状态"],
      "apis": ["/api/ui/db/google-ads-workbench"],
      "storage": [],
      "exports": [],
      "overlays": [],
      "tests": ["scripts/test_google_ads_workbench.py", "scripts/test_google_ads_workbench_frontend.mjs", "frontend/src/features/google-ads/googleAdsModel.test.ts", "frontend/src/features/google-ads/useGoogleAds.test.ts", "frontend/src/features/google-ads/GoogleAdsPage.test.ts"],
      "testGap": "固定 fixture 的云端桌面对比、日期范围/刷新/图表浏览器验收已完成；真实 Google Ads API/auth、390px 与生产账号数据仍待验收。",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；聚合 Google Ads 与 Backend Orders，必须保留匹配覆盖率、ROAS、未匹配花费和归因边界说明。请求沿用 /api/ui/db/google-ads-workbench，快捷范围、显式日期和 force refresh 均由 composable 维护。"
    },
    {
      "pageKey": "monthly-new-merchants",
      "label": "Monthly New Merchants",
      "status": "dual",
      "roots": ["#monthlyNewMerchantsPage", "#monthlyNewMerchantsModernRoot"],
      "legacyEntry": ["switchPage()", "renderMonthlyNewMerchantsPage()", "loadMonthlyNewMerchants()", "openMonthlyNewMerchantDrawer()", "openMonthlyNewMerchantImport()"],
      "modernEntry": ["frontend/src/entry.ts", "frontend/src/features/monthly-new-merchants/MonthlyNewMerchantsPage.vue", "frontend/src/features/monthly-new-merchants/monthlyNewMerchantsModel.ts", "frontend/src/features/monthly-new-merchants/useMonthlyNewMerchants.ts"],
      "state": ["state.monthlyNewMerchants"],
      "apis": ["/api/ui/db/monthly-new-merchants"],
      "storage": [],
      "exports": ["downloadMonthlyNewMerchantTemplate()"],
      "overlays": ["monthly merchant edit drawer", "monthly merchant import dialog", "month picker"],
      "tests": ["scripts/test_monthly_new_merchants.py", "scripts/test_monthly_new_merchants_frontend.mjs", "frontend/src/features/monthly-new-merchants/monthlyNewMerchantsModel.test.ts", "frontend/src/features/monthly-new-merchants/useMonthlyNewMerchants.test.ts", "frontend/src/features/monthly-new-merchants/MonthlyNewMerchantsPage.test.ts"],
      "testGap": "当前 Cloud Browser 的 URL policy 拦截了本地预览地址，未能采集实际 modern/legacy 同视口截图；待提供可访问预览 URL 后补做桌面和 390px 视觉验收。",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；覆盖月度查询、14 列列表、重点标记、搜索、增改删抽屉、CSV/TSV/Excel 粘贴或文件导入、逐行错误预览、模板下载、批量保存和焦点恢复。XLS/XLSX 读取器由 entry 注入，API 与数据库 payload 沿用既有契约。"
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
      "status": "dual",
      "roots": ["#sheetPage", "#sheetModernRoot"],
      "legacyEntry": ["switchPage()", "renderSheetPage()", "refreshTargetMetricViews()", "downloadSheetTargetsXlsx()"],
      "modernEntry": ["frontend/src/entry.ts", "frontend/src/features/targets/TargetsPage.vue", "frontend/src/features/targets/targetModel.ts", "frontend/src/features/targets/useTargets.ts"],
      "state": ["state.targetFilters", "state.targetMetric", "state.targetTrendView", "state.targetOverrides", "state.targetSort", "state.dbStatus", "state.dbTierSummary"],
      "apis": ["/api/ui/db/status", "/api/ui/db/tier-summary"],
      "storage": ["offerTargetTextOverrides.v1"],
      "exports": ["downloadSheetTargetsXlsx()", "downloadTargets()", "downloadWorkbook()"],
      "overlays": ["inline target edit form"],
      "tests": ["scripts/test_target_month_selection.mjs", "scripts/test_db_status_view_model.mjs", "scripts/test_tier_report_frontend.mjs", "scripts/test_targets_frontend.mjs", "frontend/src/features/targets/targetModel.test.ts", "frontend/src/features/targets/useTargets.test.ts", "frontend/src/features/targets/TargetsPage.test.ts"],
      "testGap": "当前 Cloud Browser 的 URL policy 拦截了本地预览地址，未能采集实际 modern/legacy 同视口截图；目标导出已切换到共享 XLSX builder，待可访问预览 URL 后补做桌面、390px 和导出视觉验收。",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；覆盖月份/对比月份/Tier 筛选、5 个 KPI、月度/日度趋势、Tier 目标进度与 localStorage 编辑、Tier 对比矩阵和当前筛选结果导出。Sheet 快照与 2026-06 已核验目标模板作为回退，/api/ui/db/status 与 /api/ui/db/tier-summary 成功时覆盖数据库实际数据；目标 XLSX 保持 Month/Tier/Brand Count/Total Clicks/Order Count/Revenue/Avg Conversion/New Tier Entries/Tier Exits/Target 字段顺序。"
    },
    {
      "pageKey": "category",
      "label": "Category Report",
      "status": "dual",
      "roots": ["#categoryPage", "#categoryModernRoot"],
      "legacyEntry": ["switchPage()", "ensureDashboardCategoryReportData()", "renderDashboardCategoryReport()", "downloadFocusedCategoryRows()"],
      "modernEntry": ["frontend/src/entry.ts", "frontend/src/features/category-report/CategoryReportPage.vue", "frontend/src/features/category-report/categoryReportModel.ts", "frontend/src/features/category-report/useCategoryReport.ts", "frontend/src/shared/export/xlsx.ts"],
      "state": ["state.categoryReportTiers", "state.categoryReportSearch", "state.categoryReportSelection", "state.categoryReportSort", "state.categoryReportDirection", "state.categoryReportFocusKey", "state.expandedCategoryKey", "state.tierReport"],
      "apis": ["/api/ui/db/tier_sheet"],
      "storage": [],
      "exports": ["downloadFocusedCategoryRows()", "downloadCategory()", "downloadWorkbook()"],
      "overlays": ["category pie spotlight", "category focused detail"],
      "tests": ["scripts/test_sheet_categories.mjs", "scripts/test_category_drilldown.mjs", "scripts/test_category_trend.mjs", "scripts/test_tier_report_frontend.mjs", "scripts/test_category_frontend.mjs", "frontend/src/features/category-report/categoryReportModel.test.ts", "frontend/src/features/category-report/useCategoryReport.test.ts", "frontend/src/features/category-report/CategoryReportPage.test.ts"],
      "testGap": "当前 Cloud Browser 的 URL policy 拦截了本地预览地址，未能采集实际 modern/legacy 同视口截图；focused export 已切换到共享 XLSX builder，待可访问预览 URL 后补做桌面、390px、焦点/展开状态和导出字段视觉验收。",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；覆盖 DB sheetCategory → mainCategory → Feishu → 其他来源 → levantaCategory → Uncategorized 优先级、Tier 选择、分类/商家精确搜索、排序、饼图 Top 7 与 Other 下钻、趋势聚合、展开商家明细和 focused export。compact tier_sheet 响应按 Merchant ID 与 Sheet 快照合并，日期切换使用 AbortController/请求序号丢弃过期响应；页面复用旧版 dashboard-category class 和响应式规则，导出由 shared/export/xlsx.ts 生成。"
    },
    {
      "pageKey": "tier",
      "label": "Tier Sheet",
      "status": "dual",
      "roots": ["#tierPage", "#tierModernRoot"],
      "legacyEntry": ["switchPage()", "renderTierPage()", "renderTierSheetTable()", "openTierSheetOverlay()", "openTierMoveDialog()"],
      "modernEntry": ["frontend/src/entry.ts", "frontend/src/features/tier-sheet/TierSheetPage.vue", "frontend/src/features/tier-sheet/tierSheetModel.ts", "frontend/src/features/tier-sheet/useTierSheet.ts", "frontend/src/shared/export/xlsx.ts"],
      "state": ["state.selectedTierPage", "state.expandedTierSheet", "state.selectedTierRowKeys", "state.visibleTierRowKeys", "state.tierTablePages", "state.manualTierMoves", "state.tier1Management", "state.tierSheetFilters", "state.tierReport", "state.tierVisibleColumns", "state.trendVisibleColumns"],
      "apis": ["/api/ui/db/tier_sheet", "/api/ui/db/tier-summary", "/api/ui/db/tier1-merchants", "/api/tier_moves"],
      "storage": ["offerTierOverrides", "offerTierVisibleColumns.v4", "offerTrendVisibleColumns.v1", "offerTierSheetManualMoves.v1", "offerTierMoveAdminToken"],
      "exports": ["downloadTierSheetXlsx()", "downloadTier()", "downloadWorkbook()"],
      "overlays": ["Tier Sheet overlay", "Tier Move dialog", "Tier 1 additions overlay", "Tier 1 merchant dialog", "Tier column panel"],
      "tests": ["scripts/test_tier_report_frontend.mjs", "scripts/test_tier_visual_status.mjs", "scripts/test_tier_visual_status_rules.py", "scripts/test_tier1_merchant_frontend.mjs", "scripts/test_tier2_recommendation_rules.mjs", "scripts/test_manual_tier_automation.py", "scripts/test_tier_frontend.mjs", "scripts/test_shared_xlsx_frontend.mjs", "frontend/src/features/tier-sheet/tierSheetModel.test.ts", "frontend/src/features/tier-sheet/useTierSheet.test.ts", "frontend/src/features/tier-sheet/TierSheetPage.test.ts", "frontend/src/shared/export/xlsx.test.ts"],
      "testGap": "共享 Move API、管理员 token 和 Tier 1 merchant API 已有注入式/静态契约覆盖，但缺少完整真实浏览器端到端验收；当前 Cloud Browser 的 URL policy 也拦截本地预览地址，桌面、390px 和实际下载文件仍待可访问预览 URL。",
      "notes": "Tier 1–4 与 BLACK TIER、颜色状态、手动移动、列配置、分页、Overlay 和 XLSX 是同一迁移域。Vue modern root 默认渲染并保留 legacy fallback；共享 Move GET/POST、401 token 重试、Tier 1 additions/search/add、localStorage moves/columns 和三张 workbook sheets（Tier、Category Summary、Offer List）均已接入。旧版/Vue 代码级对照已修正 Tier/Category root 内边距及 Tier 弹层 z-index，真实截图和 computed styles 仍待可访问预览。"
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
| 导出 | `frontend/src/shared/export/xlsx.ts`、`downloadWorkbook()`；legacy `downloadRowsAsXlsx()` | M2–M5 逐步复用；Targets/Category/Tier 已以同一 fixture 比较列格式、worksheet XML、styles XML 和 workbook package parts，legacy bridge 继续保留回滚窗口 |
| Deep Window | `_deepPanels` 与相关渲染函数 | 页面切换、最小化、恢复和请求中止在 Chatbot 阶段统一迁移 |
| 数据启动对象 | `window.CHATBOT_DATA`、`window.SHEET_REPORT_DATA`、`window.PRODUCT_KEYWORDS` | 只在 `LegacyBootstrapData` 边界读取，Vue feature 不得直接读取任意全局对象 |
| 主题与移动导航 | `public/index.html` 内联主题脚本、`public/app.js` 事件绑定 | M4 Shell 阶段迁移，之前不能改变现有主题默认值和焦点陷阱 |

## 当前测试缺口优先级

1. P1：Revenue Flow 已建立 Sankey 数据、选择上限、缓存和图表生命周期回归；待补真实数据与 390px BrowserAct 验收。
2. P1：Offer Tracker 核心大数据路径和下载已完成浏览器验收；M3 后仍需补旧/新页面逐字段差异报告并迁移高级面板。
3. P1：Targets 缺少趋势、矩阵、编辑和导出的完整浏览器流程；Category/Tier 缺少同数据同视口截图与实际下载验收。
4. P1：Brand Media 已补齐桌面端 BrowserAct 交互证据，390px 已由用户验收通过；Google Ads 和 Tier 仍需补完整真实浏览器交互证据。

## 状态更新记录

| 日期 | 页面 | 旧状态 | 新状态 | 证据 |
| --- | --- | --- | --- | --- |
| 2026-08-27 | 全部页面 | 无清单 | `legacy` | M0 首次盘点；尚未开始框架运行时代码 |
| 2026-08-27 | Offer List Tracker | `legacy` | `dual` | Vue 核心筛选/排序/选择/分页/导出入口、legacy fallback、Vitest/构建契约和应用内浏览器验收通过；高级面板仍由 legacy 提供 |
| 2026-08-27 | 共享前端模块 | 未建立 | 已建立 | M3 新增 shared API/error、Tier/Payment 契约和 i18n；Offer Tracker 已接入，Vitest、类型检查、构建和旧回归通过；其他页面仍待后续迁移 |
| 2026-08-27 | Payments | `legacy` | `modern` | Vue model/composable/组件、live API 错误保留 saved rows、月份/状态/搜索/排序、零金额排除、窄 XLSX bridge、legacy fallback、全量 Vitest/类型检查/构建和应用内 Edge 浏览器验收通过；browser-act 无已配置浏览器，8766 隔离服务的 API 仍因缺少 `LEVANTA_API_KEY` 返回 503，受控错误路径已验证 |
| 2026-08-28 | Publishers | `legacy` | `modern` | Vue model/composable/组件覆盖筛选、排序、分页、列设置、布局编辑、Publisher profile/portfolio 和导出；选中媒体后的 profile KPI、零活动商家保留与 AOV N/A 边界已补回归；14 个 Vitest 文件/75 项测试、typecheck、build、页面契约和持久化 Sites 视觉对比通过；legacy fallback 仍保留 |
| 2026-08-28 | Brand Media | `legacy` | `dual` | Vue model/composable/组件、趋势请求取消与过期响应保护、订单/点击图、Manager/媒体锁定、展开/Escape、错误/空状态、legacy fallback、全量 Vitest/类型检查/构建和 Brand Media 契约通过；BrowserAct 已验证桌面新旧几何对齐及 populated fixture 的 hover/锁定/Manager/展开交互，390px 已由用户验收通过，真实趋势接口在本地返回 503，populated 数据验收仍待补 |
| 2026-08-28 | Revenue Flow | `legacy` | `dual` | 新增 Vue model/composable、Canvas Sankey、品牌多选/日期范围/展开与卸载清理、模块级缓存/进行中请求复用、Brand Media 初始状态继承和连线 Flow tooltip；stash 冲突已保留当前分支完整公共壳层并补入 Revenue Flow modern root；15 项 Revenue Flow Vitest、排除 Publishers 后前端 Vitest 14 个文件/77 项、全量 typecheck、build、build contract、Revenue Flow 前端契约、node --check public/app.js、Brand Media 后端回归和 git diff --check 通过；真实数据与 BrowserAct 验收待补 |
| 2026-08-31 | Targets/Category/Tier 与共享导出 | `Targets/Category dual，Tier legacy` | `Targets/Category/Tier dual` | Tier Vue model/composable/page 已接入 `#tierModernRoot`，保留 legacy fallback；Targets/Category/Tier 导出接入 shared `xlsx.ts`；shared fixture 对比 legacy/new 的列格式、worksheet XML、styles XML 和 ZIP package parts；旧版 CSS/HTML 与 Vue class/层级代码级对照完成，并修正 Tier/Category root 内边距与 Tier 弹层 z-index；30 个 Vitest 文件/137 项、typecheck/build、页面契约、旧版/Python 回归和 diff check 通过；真实浏览器截图和实际下载验收待可访问预览 URL |
