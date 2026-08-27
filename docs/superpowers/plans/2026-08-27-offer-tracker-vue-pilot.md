# Offer Tracker Vue 试点实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `executing-plans`（当前会话 inline 执行）逐项实现本计划。步骤使用 checkbox (`- [ ]`) 跟踪；本计划不包含 commit/push/PR，提交仍需用户明确授权。

**Goal:** 在不改变 Offer Tracker 现有业务契约的前提下，用 Vue 3 接管该页面的核心筛选、排序、选择、分页和导出入口，并保留 legacy 渲染回退。

**Architecture:** 新页面只挂载到 `#offerListTrackerModernRoot`，旧 `#offerListTrackerPage` 及其高级面板保留在 DOM 中作为回退窗口。纯 TypeScript model 负责 Offer Tracker 的字段归一化、过滤、排序、选择和导出投影；Vue composable 负责响应式状态，组件只负责用户交互和可见语义；下载暂时通过 `OI_LEGACY_BRIDGE` 调用旧 XLSX 生成器。`switchPage()` 负责 dual mount/fallback，不让 Vue 直接改写 legacy 页面内部状态。

**Tech Stack:** Vue 3.5.42、TypeScript 5.9.3、Vite 8.2.2、Vitest 4.1.11、Vue Test Utils 2.4.11、happy-dom；现有 vanilla JS、Python server 和 XLSX 生成逻辑继续保留。

## Global Constraints

- 所有新增文档、代码注释和用户可见文案使用简体中文；代码标识符、HTML 属性和现有英文业务文案按现有项目契约保留。
- model 不访问 DOM、`window`、`localStorage`，不发起 fetch；输入输出使用显式 TypeScript 类型和不可变返回值。
- 选择复选框只更新选择集合、行状态和计数，不重新过滤、排序或重建 6,286 条源数据；分页仍使用 25 行默认页大小。
- Offer Tracker 必须继续以 `affCommissionRate` 作为佣金字段，以 `salesAmount` 作为 Revenue 字段；缺失 Revenue 归零，缺失佣金也归零。
- `aovType` 只允许 actual、estimated/tentative 或 unavailable 三类语义；ASIN 只接受 `B0` 加 8 位大写字母数字并最多保留 5 个。
- modern bundle 加载失败、页面未注册或挂载抛错时，必须回到 `renderOfferListTrackerPage()`，并输出受控 `console.warn`。
- 不修改认证、后端 API、数据库、Vercel 路由或其他页面的业务行为；不提交、不推送、不创建 PR。

---

### Task 1: 建立 Offer Tracker 契约和 model 的 RED 测试

**Files:**
- Create: `frontend/src/shared/contracts/offer.ts`
- Create: `frontend/src/shared/format/money.ts`
- Create: `frontend/src/shared/format/number.ts`
- Create: `frontend/src/shared/format/percentage.ts`
- Create: `frontend/src/features/offer-tracker/offerTrackerModel.test.ts`

**Interfaces:**
- `OfferRecord = Readonly<Record<string, unknown>>` 是 legacy Offer 的安全输入类型。
- `OfferTrackerFilters` 包含 `tiers`、`categories`、`networks`、日期、AOV/佣金范围、`bbPolicy`、`revenueStatus`、`revenueSort`。
- model 测试将依赖以下导出：`normalizeOfferRecord`、`normalizeOfferTrackerFilters`、`filterOfferTrackerRows`、`paginateOfferTrackerRows`、`updateOfferTrackerSelection`、`offerTrackerSelectionSummary`、`offerTrackerExportRows`、`offerTrackerExportColumns`。

- [x] **Step 1: 写失败测试 fixture 和类型入口**

  在 `offerTrackerModel.test.ts` 放入至少四个带差异的 Offer fixture：

  ```ts
  const offers = [
    { merchantId: "m-high", merchantName: "High Brand", tier: "Tier 1", network: "Awin", affCommissionRate: 20, commissionRate: 1, aov: 120, aovType: "actual", salesAmount: 900, brand: "High Brand", topAsins: ["b012345678", "B012345678", "B0ABCDEFGH"], category: "Beauty" },
    { merchantId: "m-low", merchantName: "Low Brand", tier: "Tier 3", network: "CJ", affCommissionRate: 5, aov: 80, aovType: "estimated", salesAmount: 0, brand: "Low Brand", productAsins: "B0ZZZZZZZZ B0YYYYYYYY", category: "Home" },
    { merchantId: "m-none", merchantName: "Unknown Brand", tier: "Tier 4", network: "CJ", commissionRate: 99, aov: 0, aovType: "not available", salesAmount: null, brand: "Unknown Brand", category: "Beauty" },
    { merchantId: "m-mind", merchantName: "Ulike", tier: "Tier 2", network: "Impact", affCommissionRate: 15, aov: 400, aovType: "actual", salesAmount: 200, brand: "Ulike", category: "Beauty" }
  ] as const;
  ```

  断言佣金只读 `affCommissionRate`、Revenue 缺失归零、AOV/BB/ASIN/score/priority 被归一化；断言日期逆序会回到默认日期范围，超过 366 天会被拒绝为默认范围；断言多选、AOV/佣金范围、正 Revenue/无 Revenue、搜索和三种排序；断言页码切片、跨页选择保留和去重；断言导出字段只包含现有 Offer/Product 白名单。测试不要读取旧 `app.js` 源码或依赖旧函数名。

- [x] **Step 2: 运行目标测试确认 RED**

  运行：`npm --prefix frontend run test -- --run offerTrackerModel`

  预期：失败，提示 `frontend/src/features/offer-tracker/offerTrackerModel` 尚未导出测试所需函数。

### Task 2: 实现纯 Offer Tracker model 并达到 GREEN

**Files:**
- Modify: `frontend/src/shared/contracts/offer.ts`
- Modify: `frontend/src/shared/format/money.ts`
- Modify: `frontend/src/shared/format/number.ts`
- Modify: `frontend/src/shared/format/percentage.ts`
- Create: `frontend/src/features/offer-tracker/offerTrackerModel.ts`
- Test: `frontend/src/features/offer-tracker/offerTrackerModel.test.ts`

**Interfaces:**
- `normalizeOfferRecord(record: OfferRecord, rules?: OfferTrackerRules): OfferTrackerRow` 将原始字段映射为稳定行模型，并保留 `source` 供 legacy 导出。
- `filterOfferTrackerRows(sourceRows: readonly OfferRecord[], filters: OfferTrackerFilters, search: string, rules?: OfferTrackerRules): readonly OfferTrackerRow[]` 返回新数组，不改变输入。
- `paginateOfferTrackerRows(rows, page, pageSize): OfferTrackerPage` 返回安全页码、总页数和当前页。
- `updateOfferTrackerSelection(rows, selected, selectedKeys): ReadonlySet<string>` 只复制并修改选择集合。
- `offerTrackerExportRows(rows, selectedKeys, selectedOnly): readonly OfferRecord[]` 返回原始 source；`offerTrackerExportColumns(view)` 返回现有白名单字段。

- [x] **Step 1: 实现共享的安全格式化函数**

  `number.ts` 提供 `toFiniteNumber(value, fallback = 0)`、`toNullableNumber(value)` 和带逗号的 `formatInteger(value)`；`money.ts` 提供 `formatMoney(value, currency = "$")`；`percentage.ts` 提供 `formatPercentage(value)`。这些函数只处理值，不读取语言或浏览器环境。

- [x] **Step 2: 实现字段归一化、日期和 score/priority**

  只使用 `affCommissionRate`、`salesAmount`、`aov`/`averageOrderValue`、`merchantId`、`merchantName`、`brand`、`tier`、`network`、`category`/`mainCategory`/`sheetCategory`、`aovType`、`topAsins`/`productAsins`。BB policy 使用旧页面的 mind/open 品牌集合；tier score、佣金分段、AOV 分段、ASIN 加分和 high/low-aov/recommended 优先级保持旧规则，默认 `highScore: 8`、`lowAovMax: 100`。

- [x] **Step 3: 实现过滤、排序、分页、选择和导出投影**

  过滤顺序固定为 tier → category → network → 日期 → AOV → AFF Commission → BB policy → Revenue status → search；排序固定为 Revenue asc/desc 或 priority → score → commission → AOV → merchant name。搜索串包含 merchantId、merchantName、brand、tier、network、category。选择摘要计算当前筛选集、当前页和全选状态，但不触碰源数组。

- [x] **Step 4: 运行 model 测试和旧回归**

  运行：`npm --prefix frontend run test -- --run offerTrackerModel`、`node scripts/test_offer_list_tracker_frontend.mjs`。

  预期：model 测试全部通过，旧 Offer Tracker 回归继续通过；若旧回归失败，只调整 model 兼容字段，不删除既有断言。

### Task 3: 建立 Vue 页面交互的 RED 测试

**Files:**
- Create: `frontend/src/features/offer-tracker/OfferTrackerPage.test.ts`
- Create: `frontend/src/features/offer-tracker/OfferTrackerPage.vue`
- Create: `frontend/src/features/offer-tracker/OfferTrackerFilters.vue`
- Create: `frontend/src/features/offer-tracker/OfferTrackerTable.vue`
- Create: `frontend/src/features/offer-tracker/useOfferTracker.ts`

**Interfaces:**
- `OfferTrackerPage` props：`offers: readonly OfferRecord[]`、`language: UiLanguage`、`defaultDateRange: OfferTrackerDateRange`、`download?: (payload: OfferTrackerExportPayload) => void`、可注入 `loadRange?: (range: OfferTrackerDateRange) => Promise<readonly OfferRecord[]>`。
- `useOfferTracker(options)` 暴露 `state`、`filteredRows`、`pageRows`、`selectionSummary`、`applyFilters`、`resetFilters`、`setSearch`、`setSort`、`setPage`、`toggleRow`、`toggleCurrentPage`、`toggleAllFiltered`、`exportRows`。
- 测试只使用按钮、输入框、checkbox、表格、可见文案和事件，不读取 Vue 内部实例。

- [x] **Step 1: 写失败的页面测试**

  覆盖：根节点带 `.oi-modern-page[data-page="offer-list-tracker"]`；首次显示表格和 25 行上限；输入搜索/选择 Tier 后只显示匹配行；切换 Revenue 排序后行顺序改变；当前页全选/取消和“选择全部匹配项”更新计数；下一页只切换页码；零结果显示空状态；非法/缺失字段不让组件崩溃；导出按钮调用注入 callback 并带 selectedOnly、view、原始 rows；键盘 Tab 能到搜索框、筛选按钮、行 checkbox 和导出按钮。

- [x] **Step 2: 运行目标组件测试确认 RED**

  运行：`npm --prefix frontend run test -- --run OfferTrackerPage`

  预期：失败，提示页面组件或交互元素不存在。

### Task 4: 实现 composable 和 Vue 组件并达到 GREEN

**Files:**
- Modify: `frontend/src/features/offer-tracker/useOfferTracker.ts`
- Modify: `frontend/src/features/offer-tracker/OfferTrackerPage.vue`
- Modify: `frontend/src/features/offer-tracker/OfferTrackerFilters.vue`
- Modify: `frontend/src/features/offer-tracker/OfferTrackerTable.vue`
- Create: `frontend/src/features/offer-tracker/offerTracker.css`
- Test: `frontend/src/features/offer-tracker/OfferTrackerPage.test.ts`

**Interfaces:**
- Filters 组件通过 `update:modelValue` 输出完整 `OfferTrackerFilters`，不直接修改父状态。
- Table 组件接收 `rows`、`page`、`selectedKeys`、`summary` 和 `view`，输出 `toggle-row`、`toggle-page`、`toggle-all`、`page-change`、`view-change`。
- 页面所有用户操作都委托给 `useOfferTracker`；checkbox 操作不得调用 `applyFilters` 或重新加载 source rows。

- [x] **Step 1: 实现 composable 的响应式状态**

  使用 `ref`/`computed` 保存 source rows、draft filters、search、sort、view、page、pageSize=25、selectedKeys、loading 和 error；初始数据来源只接受 props/注入 loader。加载失败时保留上一次 rows 并显示中文错误提示；请求序号防止过期响应覆盖较新筛选。

- [x] **Step 2: 实现筛选栏和表格**

  使用原生可访问控件：搜索输入框、日期输入、数值输入、`select multiple`（Tier/Category/Network）、BB/Revenue/Sort select、应用/重置按钮、Offers/Products tab、行 checkbox、当前页全选、全量选择、上一页/下一页和导出按钮。根节点和 CSS 只作用于 `.oi-modern-page[data-page="offer-list-tracker"]`，不覆盖旧页面选择器。

- [x] **Step 3: 实现导出回调和移动布局**

  页面将 `offerTrackerExportRows` 的结果交给 `download({ rows, view, selectedOnly })`；不在 Vue 中创建 Blob 或 XLSX。CSS 使用可换行的工具栏、横向滚动表格和不依赖固定宽度的分页，保证窄屏仍可操作。

- [x] **Step 4: 运行组件测试和完整 TypeScript 测试**

  运行：`npm --prefix frontend run test -- --run OfferTrackerPage`、`npm --prefix frontend run typecheck`。

  预期：组件交互测试与 model 测试通过，严格类型检查通过。

### Task 5: 扩展 modern bridge 并注册 Offer Tracker

**Files:**
- Modify: `frontend/src/legacy/contracts.ts`
- Modify: `frontend/src/legacy/bridge.ts`
- Modify: `frontend/src/entry.ts`
- Modify: `frontend/tests/build-contract.test.ts`

**Interfaces:**
- `ModernPageFactory = (element: HTMLElement) => ModernPageController`，controller 至少包含 `unmount(): void`。
- `createModernAppApi(definitions?: Partial<Record<ModernPageName, ModernPageFactory>>): ModernAppApi`；无 definitions 时保持 M1 的 `hasPage(...) === false`。
- `mountPage` 只接受已注册 page，成功返回 true；同一时间只保留一个 active page；factory 抛错时清空 active 记录并把异常交给 legacy 层处理。

- [x] **Step 1: 先补 bridge 注册/挂载/卸载测试**

  在 `build-contract.test.ts` 增加一个 fake page factory，断言注册前为 false、注册后为 true、mount 返回 true、重复 mount 先卸载旧 controller、unmount 调用一次；保留原有 5 个 M1 测试。

- [x] **Step 2: 运行 bridge 目标测试确认 RED**

  运行：`npm --prefix frontend run test -- --run build-contract`

  预期：新增注册测试失败，因为当前 bridge 没有 definitions/controller 管理。

- [x] **Step 3: 实现 bridge controller 生命周期并注册 Vue 页面**

  `entry.ts` 创建 Offer Tracker factory，读取 bridge snapshot 中安全的 `chatbotData.offers`、`startDate`、`endDate`；调用 `createApp(OfferTrackerPage, { offers, language, defaultDateRange, download })`，将 app 挂载到传入 element，controller 的 `unmount` 调用 `app.unmount()` 并清理 root。download 只通过 `legacyBridge.download("offer-tracker", payload)`，不存在时抛出可捕获错误。

- [x] **Step 4: 运行 bridge、typecheck、build**

  运行：`npm --prefix frontend run test -- --run build-contract`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`。

  预期：新增生命周期测试通过；modern bundle 能生成且不把 Vue 依赖留为外部全局。

### Task 6: 接入 legacy dual mount/fallback 和下载桥

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/auth.js`
- Modify: `scripts/test_offer_list_tracker_frontend.mjs`
- Modify: `scripts/test_frontend_migration_inventory.mjs`
- Modify: `docs/frontend-migration-inventory.md`

**Interfaces:**
- 新增 `#offerListTrackerModernRoot`，旧页面内容不移动；modern 激活时通过页面 class 隐藏旧内容，fallback 时移除 class。
- `window.OI_LEGACY_BRIDGE.download("offer-tracker", payload)` 调用现有 `offerTrackerOfferExportColumns()`、`offerTrackerProductExportColumns()`、`createRecommendationWorkbook()` 和 `triggerWorkbookDownload()`。
- `switchPage()` 捕获 modern `hasPage`/`mountPage` 异常，输出一次 `console.warn("Modern Offer Tracker unavailable; continuing with the legacy tracker.", error)` 并渲染旧页面。

- [x] **Step 1: 先更新静态契约测试为 dual 预期**

  保留旧导航、字段和导出断言，新增现代 root、`is-modern` fallback 选择器、`OI_LEGACY_BRIDGE` 和受控 warning 文案断言；清单测试允许 Offer Tracker 状态为 `dual`。

- [x] **Step 2: 运行旧回归确认接入前 RED**

  运行：`node scripts/test_offer_list_tracker_frontend.mjs`、`node scripts/test_frontend_migration_inventory.mjs`。

  预期：新增 root/bridge/dual 断言失败。

- [x] **Step 3: 添加 root、legacy bridge 和 dual switchPage**

  在旧 section 内插入现代 root；`switchPage()` 保存 `previousPage`，离开 Offer Tracker 时安全卸载，进入时先尝试 modern mount，成功则添加 `is-modern` 并跳过 legacy render，失败则移除 class 并执行 `renderOfferListTrackerPage()`。`rerenderForLanguage()` 在 modern 激活时调用 `OI_MODERN_APP.setLanguage(state.language)`，不要再重建隐藏的旧 tracker。

- [x] **Step 4: 实现 legacy XLSX 下载适配器**

  添加 `downloadModernOfferTracker(payload)`：校验 rows 数组、根据 view 构建现有两张工作表、复用旧 workbook builder；payload 无效或无行时返回 false，不抛出未处理异常。把 `navigate`、`requestRender`、`download` 挂到 `window.OI_LEGACY_BRIDGE`，只暴露迁移需要的能力。

- [x] **Step 5: 运行静态回归和 JS 语法检查**

  运行：`node scripts/test_offer_list_tracker_frontend.mjs`、`node scripts/test_frontend_migration_inventory.mjs`、`node --check public/auth.js`、`node --check public/app.js`。

  预期：旧业务断言和 dual 接入断言全部通过；旧页面仍可由 fallback 渲染。

### Task 7: 完整验证、更新 RoadMap 并记录浏览器边界

**Files:**
- Modify: `docs/frontend-migration-inventory.md`
- Modify: `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md`
- Test: `frontend/src/features/offer-tracker/offerTrackerModel.test.ts`
- Test: `frontend/src/features/offer-tracker/OfferTrackerPage.test.ts`

**Interfaces:**
- 清单状态只能从 `legacy` 更新为 `dual`；M2 未完成旧代码删除前不能标记 `modern`。
- RoadMap M2 execution record 必须区分 source-tested、build-tested、legacy fallback 和真实浏览器证据，不能把静态测试写成浏览器验收。

- [x] **Step 1: 运行完整目标验证**

  运行：

  ```powershell
  npm --prefix frontend ci
  npm --prefix frontend run typecheck
  npm --prefix frontend run test -- --run
  npm --prefix frontend run build
  node scripts/test_frontend_build_contract.mjs
  node scripts/test_frontend_migration_inventory.mjs
  node scripts/test_offer_list_tracker_frontend.mjs
  node --check public/auth.js
  node --check public/app.js
  git diff --check
  ```

  预期：全部退出码为 0，modern bundle、legacy 回归和 dual 清单契约同时通过。

- [x] **Step 2: 使用应用内浏览器做最小真实验收**

  启动隔离端口 8766，确认 Offer Tracker 页面能进入；检查现代根节点、可见行数、筛选、排序、选择计数、分页和导出按钮的 DOM/计算样式。若认证或浏览器环境阻止登录，记录为未完成的浏览器证据，不把 source/test 结果升级为浏览器通过；结束前停止本次启动的服务器并确认 8766 无监听。

- [x] **Step 3: 更新 M2 记录并复查差异**

  在 RoadMap 写入实际命令、测试数量、构建产物、浏览器限制、回退行为和未迁移的高级面板；执行 `git diff --check`、`git status --short`，确认没有修改认证/后端/其他页面，也没有生成未跟踪的临时探针或构建产物。

## 完成记录（2026-08-27）

- RED/GREEN：model、组件双语、bridge 生命周期和 dual 静态契约均先建立失败证据，再完成最小实现并恢复通过。
- 验证：`npm --prefix frontend run typecheck`、Vitest 3 个文件/24 项测试、Vite build、构建契约、12 页面清单、Offer Tracker 旧回归、日期范围、Vercel budget、JS 语法检查和 `git diff --check` 均通过。
- 构建：`oi-modern.js` 91.86 kB（gzip 33.84 kB）；`oi-modern.css` 7.54 kB（gzip 1.84 kB）。
- 浏览器：应用内 Edge 在隔离 8766 端口验证 6,286 条缓存 Offer、25 行分页、搜索/排序/跨页选择/导出、中文/英文和 390px 移动布局；modern 缺失时旧页面可恢复。高级保存视图、列面板、规则面板和旧导出对话框仍在 legacy 回退。
- 状态：Offer Tracker 清单保持 `dual`；未提交、未推送、未创建 PR。
