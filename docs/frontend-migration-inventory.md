# 前端框架迁移页面清单

> 盘点日期：2026-08-27  
> 最近更新：2026-09-01（M5 Tier Move 生产边界与移动交互；M4/M5 验收完成；Monthly New Merchants 已完成 dual → modern 安全放行；共享 AppShell、导航、主题与页面标题接入；公开 Sites version 10）
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
      "testGap": "",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；品牌目录来自 Publishers；趋势请求使用 AbortController 和过期响应保护；订单折线图保留缺失日期断线、真实零值和 Revenue hover，媒体锁定后提供单媒体/累计点击图。桌面端、关键交互和 390px 视觉验收已完成，2026-09-01 由用户确认 M4 验收完成。"
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
      "testGap": "",
      "notes": "最多选择 12 个品牌，useRevenueFlow 维护模块级请求去重、进行中请求复用、AbortController、payload 缓存、日期快捷范围和展开生命周期；Revenue FlowSankey 使用 Canvas、可聚焦节点 overlay 与连线 Flow tooltip，entry 使用 /api/ui/db/publishers 和 /api/ui/db/brand-media-sankey，挂载失败保留 legacy fallback。M4 真实数据、关键交互和移动端视觉验收已由用户于 2026-09-01 确认完成。"
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
      "tests": ["scripts/test_google_ads_workbench.py", "scripts/test_google_ads_workbench_frontend.mjs", "scripts/test_google_ads_mobile_frontend.mjs", "frontend/src/features/google-ads/googleAdsModel.test.ts", "frontend/src/features/google-ads/useGoogleAds.test.ts", "frontend/src/features/google-ads/GoogleAdsPage.test.ts"],
      "testGap": "Sites version 9 fixed fixture 已完成 1363×936 legacy/Vue 桌面对比、390×844 legacy/Vue 截图、日期范围/刷新交互和标题 computed-style 对齐；M4 浏览器验收已由用户于 2026-09-01 确认完成；页面仍保留 legacy fallback，逐页 dual → modern 安全放行尚待执行。",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；聚合 Google Ads 与 Backend Orders，必须保留匹配覆盖率、ROAS、未匹配花费和归因边界说明。请求沿用 /api/ui/db/google-ads-workbench，快捷范围、显式日期和 force refresh 均由 composable 维护；Google Ads feature CSS 负责 modern mount 的窄屏最小宽度、局部横向滚动和长文案换行，页面标题复用 legacy h2 视觉契约；M4 真实数据、关键交互和移动端视觉验收已由用户于 2026-09-01 确认完成。"
    },
    {
      "pageKey": "monthly-new-merchants",
      "label": "Monthly New Merchants",
      "status": "modern",
      "roots": ["#monthlyNewMerchantsPage", "#monthlyNewMerchantsModernRoot"],
      "legacyEntry": ["switchPage()", "renderMonthlyNewMerchantsPage()", "loadMonthlyNewMerchants()", "openMonthlyNewMerchantDrawer()", "openMonthlyNewMerchantImport()"],
      "modernEntry": ["frontend/src/entry.ts", "frontend/src/features/monthly-new-merchants/MonthlyNewMerchantsPage.vue", "frontend/src/features/monthly-new-merchants/monthlyNewMerchantsModel.ts", "frontend/src/features/monthly-new-merchants/useMonthlyNewMerchants.ts"],
      "state": ["state.monthlyNewMerchants"],
      "apis": ["/api/ui/db/monthly-new-merchants"],
      "storage": [],
      "exports": ["downloadMonthlyNewMerchantTemplate()"],
      "overlays": ["monthly merchant edit drawer", "monthly merchant import dialog", "month picker"],
      "tests": ["scripts/test_monthly_new_merchants.py", "scripts/test_monthly_new_merchants_frontend.mjs", "scripts/test_monthly_new_merchants_modern_cutover.mjs", "frontend/src/features/monthly-new-merchants/monthlyNewMerchantsModel.test.ts", "frontend/src/features/monthly-new-merchants/useMonthlyNewMerchants.test.ts", "frontend/src/features/monthly-new-merchants/MonthlyNewMerchantsPage.test.ts"],
      "testGap": "",
      "notes": "Vue modern root 默认渲染；legacy fallback 继续保留在回滚窗口。覆盖月度查询、14 列列表、重点标记、搜索、增改删抽屉、CSV/TSV/Excel 粘贴或文件导入、逐行错误预览、模板下载、批量保存和焦点恢复。XLS/XLSX 读取器由 entry 注入，API 与数据库 payload 沿用既有契约。M4 桌面、移动端和关键交互验收已由用户于 2026-09-01 确认完成，并据此完成 modern 放行。"
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
      "tests": ["scripts/test_target_month_selection.mjs", "scripts/test_db_status_view_model.mjs", "scripts/test_tier_report_frontend.mjs", "scripts/test_targets_frontend.mjs", "scripts/test_m5_mobile_frontend.mjs", "frontend/src/features/targets/targetModel.test.ts", "frontend/src/features/targets/useTargets.test.ts", "frontend/src/features/targets/TargetsPage.test.ts"],
      "testGap": "M5 Targets 验收已由用户于 2026-09-01 确认完成；Sites version 8 fixed fixture 已完成 1363×936 legacy/Vue 对比、390×844 Vue focused 截图，并在公开 Browser 中验证 month/compare-month/Tier hooks、metric 和 daily trend 切换；后续仅需按回滚安全规则逐页完成 dual → modern 放行。",
      "notes": "Vue modern root 默认渲染并保留 legacy fallback；覆盖月份/对比月份/Tier 筛选、5 个 KPI、月度/日度趋势、Tier 目标进度与 localStorage 编辑、Tier 对比矩阵和当前筛选结果导出。Sheet 快照与 2026-06 已核验目标模板作为回退，/api/ui/db/status 与 /api/ui/db/tier-summary 成功时覆盖数据库实际数据；目标 XLSX 保持 Month/Tier/Brand Count/Total Clicks/Order Count/Revenue/Avg Conversion/New Tier Entries/Tier Exits/Target 字段顺序。TargetsPage、CategoryReportPage、TierSheetPage 的关键控件提供稳定 data-* hooks，便于公开固定 fixture smoke 验收；Sites version 7 的 390×844 focused 验收由 `scripts/test_m5_mobile_frontend.mjs` 与 Firecrawl screenshot 记录。"
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
      "testGap": "M5 Category 验收已由用户于 2026-09-01 确认完成；Sites version 8 fixed fixture 已完成 1363×936 legacy/Vue 对比和 390×844 Vue focused 页面加载，并在公开 Browser 验证 Orders lens、pie focus/reset 与分类行展开；后续仅需按回滚安全规则逐页完成 dual → modern 放行。",
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
      "tests": ["scripts/test_tier_report_frontend.mjs","scripts/test_tier_visual_status.mjs","scripts/test_tier_visual_status_rules.py","scripts/test_tier1_merchant_frontend.mjs","scripts/test_tier2_recommendation_rules.mjs","scripts/test_manual_tier_automation.py","scripts/test_tier_moves_api.py","scripts/test_tier_frontend.mjs","scripts/test_m5_mobile_frontend.mjs","scripts/test_shared_xlsx_frontend.mjs","frontend/src/features/tier-sheet/tierSheetModel.test.ts","frontend/src/features/tier-sheet/useTierSheet.test.ts","frontend/src/features/tier-sheet/TierSheetPage.test.ts","frontend/src/shared/export/xlsx.test.ts"],
      "testGap": "M5 Tier 验收已由用户于 2026-09-01 确认完成；Sites version 10 fixed fixture 已完成 1363×936 legacy/Vue 对比、390×844 legacy/Vue focused 截图；公开 Browser 已验证 Tier 2、行选择、Move dialog、目标 Tier 激活和安全关闭，页面级无横向溢出且宽表由局部滚动容器承载。新增 Tier Move API 边界测试覆盖非对象 JSON、256 KiB 请求体上限、1000 条记录上限和 webhook JSON 形状归一化；Vue 共享保存 busy/disabled/aria-busy 和 560px 移动弹窗契约已覆盖；后续按回滚安全规则逐页完成 dual → modern 放行。",
      "notes": "Tier 1–4 与 BLACK TIER、颜色状态、手动移动、列配置、分页、Overlay 和 XLSX 是同一迁移域。Vue modern root 默认渲染并保留 legacy fallback；共享 Move GET/POST、401 token 重试、Tier 1 additions/search/add、localStorage moves/columns 和三张 workbook sheets（Tier、Category Summary、Offer List）均已接入。认证启动链、legacy 与 Vue loader 统一沿用缓存报告的 startDate/endDate，避免实时刷新覆盖缓存指标；旧版/Vue 代码级对照已修正 Tier/Category root 内边距及 Tier 弹层 z-index；Tier/Category/Targets 关键控件提供稳定 data-* hooks；version 10 增加 `api/tier_moves.py` 的请求/响应边界保护、`useTierSheet` 的 `moveSyncing` 状态和 modern 移动弹窗约束，并由 Firecrawl screenshot 与公开 Browser 交互记录验证。"
    }
  ]
}
```
<!-- FRONTEND_MIGRATION_INVENTORY_END -->

## 跨页面启动与共享依赖

| 依赖 | 当前入口 | 迁移要求 |
| --- | --- | --- |
| 认证与数据预载 | `public/auth.js` | M1 保持会话、登录和 `/api/ui/db/offers` 语义；modern bundle 失败时仍可进入旧应用 |
| 全局导航 | `frontend/src/shell/AppShell.vue`、`public/app.js:switchPage()`、`syncNavigationGroupState()` | legacy 侧边栏继续负责可见展示和交互，AppShell 负责共享导航模型与页面同步；`switchPage()` 仍是唯一页面切换权威入口，禁止新旧两侧各维护一套路由状态 |
| 语言 | `state.language`、`offerLanguage`、`chatbot_i18n.js`、`frontend/src/shared/i18n/` | legacy 仍由 `state.language` 管理，通过 `OI_MODERN_APP.setLanguage()` 同步 modern；迁移文案必须中文/英文成对维护 |
| 共享 API、错误与契约 | `frontend/src/shared/api/`、`frontend/src/shared/contracts/` | M3 的 modern 页面使用统一 JSON/错误/超时边界；契约只保留跨页面稳定字段，不复制完整数据库响应 |
| 导出 | `frontend/src/shared/export/xlsx.ts`、`downloadWorkbook()`；legacy `downloadRowsAsXlsx()` | M2–M5 逐步复用；Targets/Category/Tier 已以同一 fixture 比较列格式、worksheet XML、styles XML 和 workbook package parts，legacy bridge 继续保留回滚窗口 |
| Deep Window | `_deepPanels` 与相关渲染函数 | 页面切换、最小化、恢复和请求中止在 Chatbot 阶段统一迁移 |
| 数据启动对象 | `window.CHATBOT_DATA`、`window.SHEET_REPORT_DATA`、`window.PRODUCT_KEYWORDS` | 只在 `LegacyBootstrapData` 边界读取，Vue feature 不得直接读取任意全局对象 |
| 主题与移动导航 | `frontend/src/shell/AppShell.vue`、`frontend/src/shell/theme.ts`、`public/app.js` | AppShell 负责主题状态与页面标题同步；可见移动端 sticky bar/drawer 和桌面侧边栏继续由 legacy 外壳提供，避免改变既有视觉；modern 挂载失败时 legacy 外壳和主题事件继续工作 |

## 当前测试缺口优先级

1. P1：Brand Media、Revenue Flow、Google Ads、Targets、Category、Tier 已完成当前 M4/M5 验收，下一步按页面逐一执行 dual → modern 安全放行并保留 legacy rollback window。
2. P1：M2 Offer Tracker 仍需旧/新页面逐字段差异报告，并迁移高级保存视图、列面板、规则面板和导出对话框。
3. P1：M6 Chatbot/Agent 仍由 legacy 执行，进入迁移前需按 `docs/chatbot-feature-report.md` 重新核对协议、工具和 Trace。
4. P2：modern 页面仍保留 legacy rollback window；后续阶段再按删除安全规则清理旧渲染与事件代码。

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
| 2026-09-01 | M5 Targets/Category/Tier 移动端续验 | `Targets/Category/Tier dual` | `Targets/Category/Tier dual` | 新增移动端 CSS 契约并按 TDD 完成 RED → GREEN；Targets 窄屏筛选/KPI 单列、Tier 390px tabs 采用 4+1 布局；同步 Tier 侧栏简化并修复本地重复/未闭合 nav button；Sites version 7 公开部署成功，完成 1363×936 compare、390×844 focused 截图和 Category/Targets/Tier 页面加载验收；真实生产 API/auth、Move webhook/持久化和完整移动交互仍待补 |
| 2026-09-01 | M5 Targets/Category/Tier 交互入口续验 | `Targets/Category/Tier dual` | `Targets/Category/Tier dual` | 按 TDD 为三页补齐稳定 data-* hooks；公开 Sites version 8（source `f99c2a48b6b419063d7e0449f73c8effb0dbd59b`）完成 1363×936 compare、390×844 legacy/Vue screenshots，并在公开 Browser 验证 Targets metric/day、Category focus/reset/expand、Tier tab/select/Move dialog/Display/Expand-Close；真实生产 API/auth、Move 确认持久化和完整移动交互仍待补 |
| 2026-09-01 | Google Ads 390px 与视觉边界 | `dual` | `dual` | 修复 Vue 标题与 legacy `h2` 样式不一致；新增 `googleAds.css` 和 `test_google_ads_mobile_frontend.mjs`，补齐 modern mount 的窄屏宽度、局部 chart/table 横向滚动、长文案换行和稳定 Refresh hook；Google Ads feature 8 项 Vitest、typecheck/build、旧版/Python 回归与公开 Sites version 9 通过；Firecrawl 390×844 legacy/Vue 截图及 Browser 1363×936 compare、标题 computed-style（两侧 35.438px）和 30D/Refresh smoke 已验证；真实 API/auth、生产账号和共享 Shell 仍待 |
| 2026-09-01 | M4/M5 页面验收与共享 Shell | `M4/M5 dual` | `M4/M5 dual` | 用户明确确认 M4 与 M5 验收任务全部完成；本次实现补齐 `AppShell`、统一导航模型、单一 Tier 入口、主题持久化和页面标题同步；可见桌面/移动侧边栏继续沿用 legacy 样式，页面迁移状态不因验收记录被误改，继续按实际 `dual`/`modern` 保留 legacy fallback |
| 2026-09-01 | Monthly New Merchants modern 放行 | `Monthly New Merchants dual` | `Monthly New Merchants modern` | M4 验收已由用户确认完成；modern root、Vue factory、modern-first `switchPage()` 顺序、卸载清理、legacy fallback 和 `.is-modern` 页面边界均通过放行契约；不修改月度商家 API、数据字段、认证或侧边栏视觉 |
| 2026-09-01 | M5 Tier Move 生产边界与移动交互 | `Targets/Category/Tier dual` | `Targets/Category/Tier dual` | 按 TDD 新增 `scripts/test_tier_moves_api.py`，先以 RED 锁定非对象 JSON、超大请求体和非对象 webhook 响应缺口，再由 `api/tier_moves.py` 加入 256 KiB/1000 条记录/JSON object/`moves` list 校验及 502 响应归一化；Vue 新增 `moveSyncing`、重复 Move/Reset 防护、按钮 disabled/`aria-busy` 和 modern 560px Move dialog 边界，前端全量 33 个 Vitest 文件/160 项、typecheck/build、Tier/M5/Google Ads 契约、旧版/Python 回归与 diff check 通过；公开 Sites version 10（QA commit `97f93d99ab833fdaf64932c9bd8a216007245393`）完成 Firecrawl 390×844 legacy/Vue 截图、Browser 1363×936 compare 及 Tier 2/选行/Move dialog/目标切换 smoke；按既有 M5 验收结论保持 `dual`，后续按回滚安全规则逐页放行 |
