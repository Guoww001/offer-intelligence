# All Dual Pages Modern Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Each task ends with an independently verifiable result.

**Goal:** 将 Brand Media、Revenue Flow、Google Ads、Targets、Category、Tier 和 Offer List Tracker 从 `dual` 安全放行为 `modern`，同时保留 legacy fallback、回滚窗口、既有 API/数据口径和侧边栏视觉。

**Architecture:** 当前七个页面已经由 `public/app.js:switchPage(page)` 先尝试挂载 Vue modern root，挂载成功后才添加 `.is-modern` 并隐藏 legacy 内容；挂载失败或 modern bundle 不可用时继续执行 legacy renderer。此次只把已经满足该运行时边界的页面登记为 `modern`，新增统一的静态放行契约和页面状态回归，不删除旧渲染代码、不改变业务实现。

**Tech Stack:** Vanilla SPA shell、Vue 3、TypeScript/Vite、Node `.mjs` 静态契约、Vitest、PowerShell。

## Global Constraints

- `public/app.js:switchPage(page)` 继续是唯一页面切换权威入口。
- 七个页面必须保持 modern-first 挂载顺序、离开页面卸载和失败后的 legacy fallback。
- 不修改页面 API、数据库字段、认证链、数据聚合口径、导出字段或 Tier Move/webhook 行为。
- 不替换或重绘现有 legacy 桌面侧边栏、移动端 sticky bar 和 drawer 视觉。
- 不删除 `renderBrandMediaPage()`、`renderRevenueFlowPage()`、`renderGoogleAdsPage()`、`renderSheetPage()`、`ensureDashboardCategoryReportData()`、`renderTierPage()`、`renderOfferListTrackerPage()` 或对应 legacy 事件/加载函数。
- `modern` 只表示 Vue 默认渲染且 legacy 仍在回滚窗口；不表示本轮删除 legacy。
- 浏览器截图和真实账号数据验收沿用用户已完成的 M4/M5 验收；本轮不把静态测试冒充浏览器证明。
- 未经用户明确授权，不执行 `git commit`、`git push` 或创建 PR。
- 所有新增和修改的文档、脚本注释使用简体中文；Git 之外的代码标识符保持现有命名。

---

### Task 1: 建立七页面统一 modern 放行契约

**Files:**
- Create: `scripts/test_modern_page_cutover.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `docs/frontend-migration-inventory.md` 受控 JSON、`public/index.html` modern roots、`frontend/src/entry.ts` factories、`public/app.js:switchPage()`、`public/styles.css` 页面边界。
- Produces: 一个可单独运行的 Node 契约，覆盖七页状态、root、factory、挂载/卸载/fallback 顺序和 CSS 隔离边界。

- [x] **Step 1: Write the failing test**

  创建 `scripts/test_modern_page_cutover.mjs`，使用下面的页面配置作为唯一测试矩阵：

  ```js
  const pages = [
    { key: "brand-media", root: "brandMediaModernRoot", legacy: "renderBrandMediaPage()", factory: '"brand-media": brandMediaFactory', boundary: "#brandMediaPage.is-modern > :not(#brandMediaModernRoot)" },
    { key: "revenue-flow", root: "revenueFlowModernRoot", legacy: "renderRevenueFlowPage()", factory: '"revenue-flow": revenueFlowFactory', boundary: ".revenue-flow-page.is-modern > :not(#revenueFlowModernRoot)" },
    { key: "google-ads", root: "googleAdsModernRoot", legacy: "renderGoogleAdsPage()", factory: '"google-ads": googleAdsFactory', boundary: ".google-ads-page.is-modern > :not(#googleAdsModernRoot)" },
    { key: "sheets", root: "sheetModernRoot", legacy: "renderSheetPage()", factory: "sheets: targetsFactory", boundary: ".sheet-page.is-modern > :not(#sheetModernRoot)" },
    { key: "category", root: "categoryModernRoot", legacy: "ensureDashboardCategoryReportData()", factory: "category: categoryReportFactory", boundary: ".category-page.is-modern > :not(#categoryModernRoot)" },
    { key: "tier", root: "tierModernRoot", legacy: "renderTierPage(state.selectedTierPage)", factory: "tier: tierFactory", boundary: ".tier-page.is-modern > :not(#tierModernRoot)" },
    { key: "offer-list-tracker", root: "offerListTrackerModernRoot", legacy: "renderOfferListTrackerPage()", factory: '"offer-list-tracker": offerTrackerFactory', boundary: ".offer-tracker-page.is-modern > :not(#offerListTrackerModernRoot)" }
  ];
  ```

  测试必须：

  - 从受控 JSON 区块解析迁移清单，并断言每个配置页面的 `status === "modern"`；
  - 断言 `public/index.html` 存在对应 `id="..."` modern root；
  - 断言 `frontend/src/entry.ts` 存在对应 factory 注册；
  - 截取 `function switchPage(page)` 到 `function init()` 的源码片段，断言页面包含 `mountPage("key"`、`unmountPage("key"` 和 legacy fallback；
  - 断言 `mountPage("key"` 在该页面 fallback 文本之前，确保失败才进入 legacy；
  - 断言 `public/styles.css` 存在对应 boundary，且 boundary 只隐藏该页面 legacy 子节点；
  - 输出 `PASS: all dual pages modern cutover contract`。

- [x] **Step 2: Run test to verify it fails**

  运行：

  ```powershell
  node scripts/test_modern_page_cutover.mjs
  ```

  预期：测试因清单中的七个页面仍为 `"status": "dual"` 而失败；不能因为路径、JSON 解析或测试语法错误失败。

- [x] **Step 3: Register the contract**

  在 `.github/workflows/ci.yml` 的前端页面契约测试组加入：

  ```yaml
  - run: node scripts/test_modern_page_cutover.mjs
  ```

  在 `AGENTS.md` 的“Run tests”命令列表加入同一命令，确保本地与 CI 使用同一放行检查。

- [x] **Step 4: Run the contract after status changes**

  本任务的 GREEN 检查在 Task 2–4 更新状态和页面契约后执行，预期输出为：

  ```text
  PASS: all dual pages modern cutover contract
  ```

---

### Task 2: 放行 M4 页面：Brand Media、Revenue Flow、Google Ads

**Files:**
- Modify: `docs/frontend-migration-inventory.md` 的 `brand-media`、`revenue-flow`、`google-ads` 条目和状态记录
- Modify: `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md` 的 M4 状态表、后续路线和最新执行记录
- Modify: `scripts/test_m4_shell_frontend.mjs`
- Modify: `scripts/test_frontend_migration_inventory.mjs`

**Interfaces:**
- Consumes: Task 1 的统一放行矩阵；现有 M4 页面 feature tests 和 Google Ads mobile contract。
- Produces: 三个 M4 页面登记为 `modern`，仍明确记录 modern root 默认渲染和 legacy rollback window。

- [x] **Step 1: Write the failing status assertions**

  先将 `scripts/test_m4_shell_frontend.mjs` 的期望状态改为：

  ```js
  "brand-media": "modern",
  "revenue-flow": "modern",
  "google-ads": "modern",
  ```

  并在 `scripts/test_frontend_migration_inventory.mjs` 的页面状态断言中加入：

  ```js
  for (const pageKey of ["brand-media", "revenue-flow", "google-ads"]) {
    assert(inventoryByPage.get(pageKey)?.status === "modern", `${pageKey} 放行后必须进入 modern 状态`);
  }
  ```

- [x] **Step 2: Run the failing assertions**

  运行：

  ```powershell
  node scripts/test_m4_shell_frontend.mjs
  node scripts/test_frontend_migration_inventory.mjs
  ```

  预期：两个测试均因三页仍为 `dual` 而失败。

- [x] **Step 3: Update the migration inventory**

  仅将三页 `status` 改为 `modern`，保留 roots、legacyEntry、state、API、storage、exports、overlays 和现有 tests；三页 notes 统一补充：

  ```text
  Vue modern root 默认渲染；legacy fallback 继续保留在回滚窗口；本次放行不修改 API、数据口径、认证链或 legacy 侧边栏视觉。
  ```

  在状态更新记录中增加一行，说明三页的 M4 验收已由用户于 2026-09-01 确认完成，现完成 `dual → modern` 安全放行；不要改写旧的历史执行记录。

- [x] **Step 4: Update the roadmap current state**

  将最新状态表的 M4 行改为“Payments、Publishers、Monthly New Merchants、Brand Media、Revenue Flow、Google Ads 均为 `modern`，legacy fallback 保留”；将“下一步”改为 M5 三页和 Offer Tracker 的逐页放行，不再把 M4 页面列为待放行。

- [x] **Step 5: Run GREEN checks**

  运行：

  ```powershell
  node scripts/test_m4_shell_frontend.mjs
  node scripts/test_frontend_migration_inventory.mjs
  node scripts/test_modern_page_cutover.mjs
  node scripts/test_brand_media_frontend.mjs
  node scripts/test_revenue_flow_frontend.mjs
  node scripts/test_google_ads_workbench_frontend.mjs
  node scripts/test_google_ads_mobile_frontend.mjs
  ```

  预期：全部通过，且无页面业务测试失败。

---

### Task 3: 放行 M5 页面：Targets、Category、Tier

**Files:**
- Modify: `docs/frontend-migration-inventory.md` 的 `sheets`、`category`、`tier` 条目和状态记录
- Modify: `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md` 的 M5 状态、退出门槛和最新执行记录
- Modify: `scripts/test_targets_frontend.mjs`
- Modify: `scripts/test_category_frontend.mjs`
- Modify: `scripts/test_tier_frontend.mjs`
- Modify: `scripts/test_m4_shell_frontend.mjs`
- Modify: `scripts/test_frontend_migration_inventory.mjs`

**Interfaces:**
- Consumes: Task 1 的统一放行矩阵；M5 的 shared XLSX、Tier Move、分类聚合和目标报表现有契约。
- Produces: Targets、Category、Tier 登记为 `modern`，保留真实业务 fallback 和三页导出/Move 边界。

- [x] **Step 1: Write the failing status assertions**

  将三个页面契约中的状态断言分别改为：

  ```js
  assert(targets?.status === "modern", "Targets 放行后必须进入 modern 状态");
  assert(category?.status === "modern", "Category 放行后必须进入 modern 状态");
  assert(tier?.status === "modern", "Tier 放行后必须进入 modern 状态");
  ```

  同时把 `test_frontend_migration_inventory.mjs` 和 `test_m4_shell_frontend.mjs` 的期望状态更新为 `modern`，先不改清单状态。

- [x] **Step 2: Run the failing assertions**

  运行：

  ```powershell
  node scripts/test_targets_frontend.mjs
  node scripts/test_category_frontend.mjs
  node scripts/test_tier_frontend.mjs
  ```

  预期：分别因清单仍为 `dual` 而失败；若出现 root、CSS、Move 或导出失败，先停止本任务并按现有页面契约修复，不把状态修改当作修复。

- [x] **Step 3: Update the M5 inventory entries**

  将 `sheets`、`category`、`tier` 的 `status` 改为 `modern`，保留全部 legacyEntry、API、导出、Overlay 和测试字段；notes 记录 M5 验收已完成、modern root 默认渲染、legacy fallback 保留以及 shared XLSX/Tier Move/分类聚合/目标报表边界未改变。

- [x] **Step 4: Update M5 roadmap records**

  将 M5 状态表改为三页均为 `modern`；退出门槛记录为“验收完成且已完成逐页放行，legacy fallback 进入回滚窗口”，不删除旧的 M5 历史记录。

- [x] **Step 5: Run GREEN checks**

  运行：

  ```powershell
  node scripts/test_targets_frontend.mjs
  node scripts/test_category_frontend.mjs
  node scripts/test_tier_frontend.mjs
  node scripts/test_m4_shell_frontend.mjs
  node scripts/test_frontend_migration_inventory.mjs
  node scripts/test_modern_page_cutover.mjs
  node scripts/test_m5_mobile_frontend.mjs
  node scripts/test_shared_xlsx_frontend.mjs
  ```

  预期：全部通过，Targets/Category/Tier 的导出、Move、日期范围、分类聚合和移动边界测试不回退。

---

### Task 4: 放行 M2 Offer List Tracker 并完成清单收口

**Files:**
- Modify: `docs/frontend-migration-inventory.md` 的 `offer-list-tracker` 条目和状态记录
- Modify: `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md` 的当前路线、状态表和最新记录
- Modify: `scripts/test_frontend_migration_inventory.mjs`
- Modify: `scripts/test_m4_shell_frontend.mjs`

**Interfaces:**
- Consumes: Task 1 的 Offer Tracker mount/unmount/fallback/CSS boundary 验证，既有核心筛选、排序、选择、分页和下载测试。
- Produces: Offer List Tracker 登记为 `modern`；高级保存视图、列面板、规则面板和旧导出设置仍明确标记为 legacy rollback scope。

- [x] **Step 1: Write the failing status assertions**

  将 `scripts/test_frontend_migration_inventory.mjs` 中的断言从：

  ```js
  assert(inventoryByPage.get("offer-list-tracker")?.status === "dual", "Offer Tracker M2 完成后必须保持 dual 状态");
  ```

  改为：

  ```js
  assert(inventoryByPage.get("offer-list-tracker")?.status === "modern", "Offer Tracker 放行后必须进入 modern 状态");
  ```

  并同步更新 `test_m4_shell_frontend.mjs` 的期望状态。

- [x] **Step 2: Run the failing assertions**

  运行：

  ```powershell
  node scripts/test_frontend_migration_inventory.mjs
  node scripts/test_m4_shell_frontend.mjs
  ```

  预期：因 Offer Tracker 清单仍为 `dual` 而失败。

- [x] **Step 3: Update the Offer Tracker inventory and roadmap**

  将 Offer Tracker `status` 改为 `modern`，notes 明确“核心路径由 Vue 接管，legacy 高级面板和旧导出设置继续作为回滚范围”；roadmap 状态表改为 Offer Tracker 已完成 modern-first 放行，但保留高级面板迁移作为后续收尾项。

- [x] **Step 4: Run GREEN checks**

  运行：

  ```powershell
  node scripts/test_offer_list_tracker_frontend.mjs
  node scripts/test_frontend_migration_inventory.mjs
  node scripts/test_m4_shell_frontend.mjs
  node scripts/test_modern_page_cutover.mjs
  ```

  预期：全部通过，且高级面板没有被误标为已经迁移。

---

### Task 5: 全量验证和交付边界

**Files:**
- Modify: `docs/frontend-migration-inventory.md` 的当前测试缺口和状态更新记录
- Modify: `docs/superpowers/plans/2026-09-01-all-modern-page-cutover.md` 勾选已完成步骤

- [x] **Step 1: Run frontend tests**

  ```powershell
  npm --prefix frontend run test -- --run
  npm --prefix frontend run typecheck
  npm --prefix frontend run build
  ```

  预期：Vitest 全部通过、typecheck 退出码为 0、Vite 输出仍只写入 `public/assets/modern/`。

- [x] **Step 2: Run page and legacy regressions**

  ```powershell
  node --check public/app.js
  node --check public/auth.js
  node scripts/test_frontend_build_contract.mjs
  node scripts/test_frontend_migration_inventory.mjs
  node scripts/test_m4_shell_frontend.mjs
  node scripts/test_modern_page_cutover.mjs
  node scripts/test_brand_media_frontend.mjs
  node scripts/test_brand_media_trend_frontend.mjs
  node scripts/test_revenue_flow_frontend.mjs
  node scripts/test_google_ads_workbench_frontend.mjs
  node scripts/test_google_ads_mobile_frontend.mjs
  node scripts/test_targets_frontend.mjs
  node scripts/test_category_frontend.mjs
  node scripts/test_tier_frontend.mjs
  node scripts/test_m5_mobile_frontend.mjs
  node scripts/test_shared_xlsx_frontend.mjs
  node scripts/test_offer_list_tracker_frontend.mjs
  python scripts/test_monthly_new_merchants.py
  git diff --check
  ```

- [x] **Step 3: Verify repository state**

  运行 `git status --short`，确认只有本任务涉及的源代码/测试/文档改动；确认 `Get-NetTCPConnection -LocalPort 8765 -State Listen` 无本任务遗留服务器。

- [x] **Step 4: Record browser boundary**

  在清单和 roadmap 中记录：M4/M5 浏览器验收由用户已完成；本轮代码验证证明七页的 modern-first/fallback/CSS 状态边界，不新增浏览器截图声明。交付时不执行 commit/push，等待用户明确授权。

## Self-review checklist

- 页面清单中七个目标页面均为 `modern`，`dashboard`/`agent` 仍为 `legacy`。
- AppShell、legacy 侧边栏和移动端导航没有被本计划改写。
- 每页的 modern factory、root、mount、unmount、fallback 和 CSS boundary 都有可复核契约。
- Offer Tracker 的高级面板仍然列为后续工作，没有把 `modern` 状态误解为 legacy 已删除。
- M6 仅在本批次逐页放行完成后进入，并重新核对 `docs/chatbot-feature-report.md`。
