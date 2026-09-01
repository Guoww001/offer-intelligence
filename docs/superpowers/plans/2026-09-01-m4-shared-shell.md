# M4 Shared Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 M4 共享 `AppShell`、统一导航、移动端导航状态、主题持久化和页面标题，并把 M4/M5 用户已完成的验收结果同步到迁移路线图与页面清单。

**Architecture:** Vue `AppShell` 负责共享导航模型、主题、语言和文档标题同步；可见桌面侧边栏与移动端导航继续使用 legacy 外壳及其既有样式，避免本轮改变用户已验收的视觉。`public/app.js` 的 `switchPage()` 继续作为唯一页面切换权威入口。现代 Shell 通过 `ModernAppApi` 以 headless root 挂载，并通过 `LegacyBridgeApi.navigate()` 委托 legacy 页面/bridge；legacy DOM 和业务回退代码继续保留在 rollback window。页面状态与导航元数据放在纯 TypeScript 模块中，便于不依赖 DOM 的回归测试。

**Tech Stack:** Vue 3.5、TypeScript、Vitest + happy-dom、Vite IIFE bundle、现有 vanilla JS legacy bridge。

## Global Constraints

- 所有新增说明、测试描述和代码注释使用简体中文；代码标识符保持英文。
- 不改后端 API、认证会话、Tier Move、导出字段或业务数据口径。
- 不删除 legacy sidebar、`switchPage()` 或业务页面回退；modern Shell 挂载失败时必须继续使用旧外壳。
- 新增的页面导航只能调用结构化 bridge，不直接改写 legacy 页面内部 DOM。
- 本次不提交、不推送、不创建 PR；完成后只汇报工作区变更和验证结果。
- 浏览器视觉验收由用户负责；文档只能记录用户明确提供的验收结论，不能把静态测试当作截图证据。

---

## Task 1: 先补失败测试和 Shell 数据模型

- [x] 新增 `frontend/src/shell/navigation.test.ts`，覆盖所有 `ModernPageName` 的分组、标签、页面标题、默认分组和 Tier 单一导航项。
- [x] 新增 `frontend/src/shell/usePageState.test.ts`，覆盖当前页面、分组展开、移动端菜单开关、Escape 关闭和导航后关闭菜单。
- [x] 扩展 `frontend/tests/build-contract.test.ts`，先断言 Shell API 还不存在，运行目标测试确认 RED。
- [x] 记录 RED 结果后再实现 `navigation.ts`、`usePageState.ts` 和 bridge 的 Shell 生命周期类型。

## Task 2: 实现 Vue AppShell、主题和页面标题

- [x] 新增 `frontend/src/shell/AppShell.vue` 与 `frontend/src/shell/shell.css`。
- [x] AppShell 提供 workspace、merchants、media、products 分组及 Google Ads 主入口；Tier 只显示一个导航项并默认委托 Tier 1。
- [x] 保留 AppShell 的 desktop/mobile 导航状态、焦点陷阱、Escape、`inert` 和 reduced-motion 能力；生产入口保持 legacy sidebar、sticky bar/drawer 的既有视觉，不替换用户已验收的侧边栏样式。
- [x] 实现 `oi-dash-theme` 的 light/dark 持久化，同时同步 `body[data-dash-theme]` 和 modern root 主题状态。
- [x] 实现 `document.title`、`document.documentElement.lang` 与当前页面/语言同步。
- [x] 页面组件测试覆盖导航点击、分组状态、主题切换、标题更新和卸载清理。

## Task 3: 接入入口与 legacy bridge

- [x] 扩展 `ModernAppApi` 与 `createModernAppApi()`：增加 `mountShell()`、`unmountShell()`、`setPage()`，并让 `setLanguage()` 同步 active Shell。
- [x] 在 `frontend/src/entry.ts` 注册 Shell factory，使用 `getLegacySnapshot()` 的语言和结构化 `OI_LEGACY_BRIDGE` 回调。
- [x] 在 `public/index.html` 增加 `#modernShellRoot`，移除旧的内联主题脚本，保留 legacy sidebar 与退出按钮作为 fallback。
- [x] 在 `public/app.js` 初始化现代 Shell、在 `switchPage()` 后同步页面、在语言切换时同步 modern Shell，并保留旧 DOM 接线。
- [x] 为 modern Shell 退出按钮补充 `public/auth.js` 的 modern 优先/legacy fallback 绑定。
- [x] 在 `frontend/src/shell/shell.css` 保持 `#modernShellRoot` headless，避免覆盖 legacy sidebar、移动端导航和主题按钮；`public/styles.css` 继续作为可见 legacy 外壳的样式来源，并保持页面 legacy/modern 边界。

## Task 4: 更新 M4/M5 验收文档

- [x] 在 `docs/frontend-migration-inventory.md` 记录用户明确确认已完成的 M4/M5 验收、缺口和说明；页面迁移状态按实际 `dual`/`modern` 保持，不把验收结论直接等同于 `modern`，保留历史记录并追加 2026-09-01 用户确认记录。
- [x] 在 `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md` 更新 M4/M5 状态表、退出步骤和后续路线，记录用户验收边界与本次 Shell 实现。
- [x] 不补写未提供的截图文件名、生产账号、API 返回值或 webhook 结果；将浏览器证据标注为用户确认。

## Task 5: 验证与交付

- [x] 运行 `npm --prefix frontend run test -- --run`，确认 Shell 和既有测试全部通过。
- [x] 运行 `npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、`node --check public/app.js`、`node --check public/auth.js`。
- [x] 运行 `node scripts/test_frontend_build_contract.mjs`、`node scripts/test_frontend_migration_inventory.mjs`、M4/M5 页面静态回归和 `git diff --check`。
- [x] 确认 `Get-NetTCPConnection -LocalPort 8765 -State Listen` 无监听；本次若不启动本地服务器，不创建残留进程。
- [x] 汇报变更文件、自动化证据、用户负责的浏览器验收边界和未执行的 Git 发布动作。

### 验证备注

- 全量 Vitest：37 个测试文件、168 项测试通过；typecheck、Vite build、`node --check public/app.js`、`node --check public/auth.js`、M4 Shell、迁移清单、build contract、M5 mobile、Brand Media、Revenue Flow、Google Ads、Monthly New Merchants、Targets、Category、Tier、shared XLSX 和 sidebar scrollbar 契约均通过。
- 额外广覆盖回归中的 `scripts/test_db_status_view_model.mjs` 与 `scripts/test_dashboard_chat_pages.mjs` 仍命中当前基线已有的 Targets inline editor/Agent mobile height 断言失败；本轮变更未触及对应渲染代码，因此不将其归因于 AppShell 任务。
- 侧边栏视觉回滚：根据用户反馈，撤销 modern Shell 对 legacy sidebar、移动端导航和主题按钮的隐藏/替换规则；`#modernShellRoot` 保持 headless 挂载，AppShell 的页面、语言、主题和标题同步能力继续保留。
- 未启动本地服务器，8765 端口无监听；本轮未提交、未推送、未创建 PR。
