# Monthly New Merchants Modern Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有侧边栏视觉、API 和业务口径的前提下，将 Monthly New Merchants 从 `dual` 安全放行到 `modern`，并保留 legacy 回滚窗口。

**Architecture:** Monthly New Merchants 当前已经由 `public/app.js:switchPage()` 优先挂载 `monthlyNewMerchantsModernRoot`，Vue factory 负责现代页面，legacy DOM 和渲染函数只在现代挂载不可用时回退。本次只补齐“现代优先、页面边界、legacy fallback、验收证据和清单状态”的放行契约，不删除共享 Shell 或页面业务回退代码。

**Tech Stack:** Vue 3.5、TypeScript、Vite、Vitest、Node 静态契约测试、现有 Python/Node 回归脚本。

## Global Constraints

- 所有新增说明、测试描述和代码注释使用简体中文；代码标识符保持英文。
- 不修改 `/api/ui/db/monthly-new-merchants`、数据库字段、认证、导入/保存/删除数据口径或现有导出字段。
- 不修改 legacy 侧边栏、移动端导航和全局主题视觉；`public/styles.css` 继续作为可见 legacy 外壳的样式来源。
- 不删除 `renderMonthlyNewMerchantsPage()`、`loadMonthlyNewMerchants()` 或 legacy fallback；M7 再单独处理 legacy 清理。
- 浏览器视觉、真实生产 API/auth 和实际数据验收使用用户已提供的 M4 验收结论；自动化测试不能冒充截图证据。
- 本次不提交、不推送、不创建 PR；完成后只汇报工作区变更和验证结果。

---

## Task 1: 建立 Monthly New Merchants 放行契约

**Files:**

- Create: `scripts/test_monthly_new_merchants_modern_cutover.mjs`
- Modify: `scripts/test_m4_shell_frontend.mjs`
- Modify: `scripts/test_frontend_migration_inventory.mjs`

**Interfaces:**

- Consumes: `docs/frontend-migration-inventory.md`、`public/index.html`、`public/app.js`、`frontend/src/entry.ts`、`public/styles.css`。
- Produces: 可独立证明 Monthly New Merchants 已是 `modern`、现代 root 先挂载、legacy fallback 仍存在且页面边界未越界的 Node 契约。

- [x] **Step 1: 先修改测试，让目标状态失败**

  在 `scripts/test_m4_shell_frontend.mjs` 的状态表中把 `monthly-new-merchants` 的期望值改为 `modern`；在 `scripts/test_frontend_migration_inventory.mjs` 增加：

  ```js
  assert(
    inventoryByPage.get("monthly-new-merchants")?.status === "modern",
    "Monthly New Merchants M4 放行后必须进入 modern 状态"
  );
  ```

  新建 `scripts/test_monthly_new_merchants_modern_cutover.mjs`，至少断言：

  ```js
  const monthly = inventory.pages.find((page) => page.pageKey === "monthly-new-merchants");
  assert(monthly?.status === "modern");
  assert(indexHtml.includes('id="monthlyNewMerchantsModernRoot"'));
  assert(entry.includes('"monthly-new-merchants": monthlyNewMerchantsFactory'));
  assert(switchPageSource.indexOf('mountPage("monthly-new-merchants"') < switchPageSource.indexOf("renderMonthlyNewMerchantsPage()"));
  assert(switchPageSource.includes('unmountPage("monthly-new-merchants"'));
  assert(switchPageSource.includes('renderMonthlyNewMerchantsPage()'));
  assert(styles.includes('.monthly-new-merchants-page.is-modern > :not(#monthlyNewMerchantsModernRoot)'));
  ```

- [x] **Step 2: 运行 RED 测试**

  运行：

  ```powershell
  node scripts/test_monthly_new_merchants_modern_cutover.mjs
  node scripts/test_m4_shell_frontend.mjs
  node scripts/test_frontend_migration_inventory.mjs
  ```

  预期：测试因迁移清单仍为 `"status": "dual"` 而失败，不能因为缺少文件、语法错误或测试路径错误失败。

## Task 2: 执行状态放行并记录证据

**Files:**

- Modify: `docs/frontend-migration-inventory.md`
- Modify: `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md`
- Modify: `scripts/test_monthly_new_merchants_frontend.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: Task 1 的放行契约和用户于 2026-09-01 确认的 M4 验收结论。
- Produces: `monthly-new-merchants` 的 `modern` 清单状态、可追溯的放行记录和 CI 可执行的契约测试。

- [x] **Step 1: 更新机器可读清单**

  在 `docs/frontend-migration-inventory.md` 中只将 `monthly-new-merchants` 的 `status` 从 `dual` 改为 `modern`，保留 `roots`、legacyEntry、API、overlay 和测试列表；说明改为“Vue modern root 默认渲染，legacy fallback 仍保留在回滚窗口”。

- [x] **Step 2: 更新迁移路线图**

  在路线图最新状态和执行记录中记录：用户已完成 M4 验收，Monthly New Merchants 已满足 modern 放行条件；同时明确 Payments/Publishers/Monthly New Merchants 为 `modern`，其他 M4/M5 页面按清单保持 `dual`，不把其他页面一起放行。

- [x] **Step 3: 把放行契约纳入现有测试入口**

  在 `scripts/test_monthly_new_merchants_frontend.mjs` 中增加 `modern` 状态和 fallback 边界断言；在 `.github/workflows/ci.yml` 和 `AGENTS.md` 的 Node 回归命令中加入：

  ```powershell
  node scripts/test_monthly_new_merchants_modern_cutover.mjs
  ```

- [x] **Step 4: 运行 GREEN 测试**

  运行：

  ```powershell
  node scripts/test_monthly_new_merchants_modern_cutover.mjs
  node scripts/test_m4_shell_frontend.mjs
  node scripts/test_frontend_migration_inventory.mjs
  node scripts/test_monthly_new_merchants_frontend.mjs
  ```

  预期：4 个测试全部输出 PASS；Monthly New Merchants 仍存在现代挂载失败时的 legacy 回退路径。

## Task 3: 全量验证和交付边界

- [x] **Step 1: 运行页面相关 Vitest、类型检查和构建**

  ```powershell
  npm --prefix frontend run test -- --run
  npm --prefix frontend run typecheck
  npm --prefix frontend run build
  node --check public/app.js
  node --check public/auth.js
  ```

- [x] **Step 2: 运行相关旧回归和迁移契约**

  ```powershell
  python scripts/test_monthly_new_merchants.py
  node scripts/test_frontend_build_contract.mjs
  node scripts/test_frontend_migration_inventory.mjs
  git diff --check
  ```

- [x] **Step 3: 复核范围与服务状态**

  确认本次新增改动只落在 Monthly 放行的测试、文档和 CI 命令范围内；保留工作区中此前的 AppShell/侧边栏回滚改动，不隐藏/删除 legacy 侧边栏，不修改后端 API；确认 `Get-NetTCPConnection -LocalPort 8765 -State Listen` 无残留本地服务。

- [x] **Step 4: 汇报用户验收边界**

  汇报 modern 状态已由代码/契约放行，浏览器视觉与真实生产边界沿用用户已提供的 M4 验收结论；不提交、不推送、不创建 PR。

## 验证结果

- `npm --prefix frontend run test -- --run`：37 个文件、168 项测试通过。
- `npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、`node --check public/app.js` 和 `node --check public/auth.js` 通过。
- `python scripts/test_monthly_new_merchants.py`、Monthly New Merchants 页面契约、modern cutover 契约、M4 Shell 契约、迁移清单契约、build contract 和 `git diff --check` 通过。
- 未启动本地服务；`Get-NetTCPConnection -LocalPort 8765 -State Listen` 无监听结果。
- 浏览器视觉、移动端和真实生产边界沿用用户于 2026-09-01 提供的 M4 验收结论；本次未新增截图或生产接口证据。
