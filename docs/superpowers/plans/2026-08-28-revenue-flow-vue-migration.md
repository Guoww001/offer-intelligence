# Revenue Flow Vue3 迁移实施计划

> **执行说明：** 使用 executing-plans 按任务逐项执行，并在检查点进行复核；任务使用 `- [ ]` 复选框跟踪。

**目标：** 在不触碰 Publishers 页面实现的前提下，将 Revenue Flow 页面迁移到现有 Vue 3 modern root，保留旧页面的品牌多选、日期快捷范围、Sankey 收入流、图表展开、节点交互、请求去重与缓存行为。

**架构：** 新建独立的 `frontend/src/features/revenue-flow/` 功能边界。纯数据归一化、Sankey 模型和布局放在 `revenueFlowModel.ts`；请求、选择状态、日期范围、取消请求和缓存放在 `useRevenueFlow.ts`；页面结构放在 `RevenueFlowPage.vue`；Canvas 图表与缩放/平移交互放在 `RevenueFlowSankey.vue`。`entry.ts` 通过现有 `createModernAppApi` 注册页面，`public/app.js` 只负责 SPA 页面切换时的挂载、卸载和旧页面 fallback。

**技术栈：** Vue 3 Composition API、TypeScript、Vite、Vitest、Canvas 2D、现有 `/api/ui/db/publishers` 和 `/api/ui/db/brand-media-sankey` 接口。

## 全局约束

- 不修改 frontend/src/features/publishers/*，不修复或重排 Publishers 页面代码。
- 不修改 Revenue Flow 后端接口、SQL、缓存协议或旧版 Sankey 业务数据规则。
- 旧版 public/app.js 的 Revenue Flow 函数作为行为基线；新实现不得把产品/媒体节点的正收入过滤、最多 12 个品牌、日期范围限制和请求去重删除。
- 旧版 CSS 作为视觉基线；不恢复或重写当前分支中由既有 Publishers 提交造成的公共 HTML/CSS 大范围缺失。本任务只做 Revenue Flow 所需的最小现代入口接线；若公共壳层仍阻止构建或浏览器验收，必须在交付中明确记录为既有阻塞。
- 不提交、不推送、不创建 PR；除非用户另行明确授权。
- 所有新增文档、注释和交付说明使用简体中文；代码标识符保持项目既有英文命名。

## 旧页面契约冻结

- 页面键：revenue-flow。
- 旧根节点：#revenueFlowPage；现代根节点约定为 #revenueFlowModernRoot。
- 旧页面状态：state.revenueFlow，包含品牌搜索、多选品牌、快捷日期、开始/结束日期、payload、请求序号、payload 缓存和展开状态。
- 旧接口：
  - GET /api/ui/db/publishers：品牌目录。
  - GET /api/ui/db/brand-media-sankey?merchantIds=...&startDate=...&endDate=...：收入流数据。
- 旧行为：品牌最多选择 12 个；默认快捷范围 90 天；结束日期为昨天；只展示正收入数据；同一参数请求必须去重或命中缓存；离开页面时取消/失效进行中的请求并收起展开图表。
- 旧视觉基线：D:/Code/offer-intelligence-main-worktrees/offer-intelligence-main/public/index.html 与 public/styles.css 中的 Revenue Flow 结构和 .revenue-flow-* / .brand-media-sankey-* 样式。视觉对齐在页面能够挂载到现代壳层后继续验收。

## 实施任务

### 1. 先写 Revenue Flow 纯逻辑回归测试

- [x] 新建 frontend/src/features/revenue-flow/revenueFlowModel.test.ts。
- [x] 使用包含两个品牌、重复 ASIN、产品节点、媒体节点、品牌→产品和产品→媒体 links 的固定 payload；同时覆盖负值/零值、无效节点和无效 link。
- [x] 测试 normalizeRevenueFlowPayload() 只接受可用 Sankey payload，并保留日期范围和品牌名称。
- [x] 测试 buildRevenueFlowModel() 的品牌数、产品数、媒体数、link 数、总 Revenue、节点类型和重复 ASIN 的 merchant scope。
- [x] 测试 buildRevenueFlowLayout() 生成三列节点、正高度、可绘制 link 区间和足够的 surface 宽度。
- [x] 测试 hover/锁定关系只关联同一收入流路径；品牌节点不可作为产品/媒体锁定目标。
- [x] 测试 revenueFlowCatalogOptions() 对重复品牌 ID 去重并稳定排序。
- [x] 测试应先失败：运行 npm --prefix frontend run test -- --run src/features/revenue-flow/revenueFlowModel.test.ts，失败原因必须是目标模块尚不存在或导出尚不存在，而不是 Publishers 代码。

### 2. 实现纯模型、布局和格式化边界

- [x] 新建 frontend/src/features/revenue-flow/revenueFlowModel.ts，定义并导出：
  - RevenueFlowNodeType、RevenueFlowNode、RevenueFlowLink、RevenueFlowPayload、RevenueFlowModel。
  - RevenueFlowLayoutNode、RevenueFlowLayoutLink、RevenueFlowLayout、RevenueFlowFlowDetail。
  - MAX_REVENUE_FLOW_BRANDS = 12。
  - normalizeRevenueFlowPayload(value, fallbackRange)。
  - revenueFlowCatalogOptions(value)。
  - buildRevenueFlowModel(payload)。
  - buildRevenueFlowLayout(model, width)。
  - revenueFlowHoverState(model, nodeId)、toggleRevenueFlowNode(model, lockedNodeId, nodeId)、revenueFlowFlowDetail(model, link)。
- [x] 归一化逻辑兼容接口返回的 { ok, sankey, merchants, dateRange } 和直接 Sankey payload；过滤非正值节点和 link；过滤不存在节点或不属于 brand → product → media 的 link。
- [x] layout 采用固定三列 brand/product/media，按节点值分配高度，给每条 link 计算 source/target 的上下边界，保证 Canvas 可以绘制比例流带。
- [x] 使用纯函数和显式输入输出，不读取 DOM、不读取全局 state，便于 Vue 单测和后续复用。
- [x] 立即重跑任务 1 的模型测试，确认 GREEN；必要时只在测试保持绿色的情况下重构。

### 3. 实现 Revenue Flow 状态与请求 composable

- [x] 新建 frontend/src/features/revenue-flow/useRevenueFlow.test.ts，先覆盖并验证 RED：
  - 最多 12 个品牌，重复选择不会增加数量。
  - 快捷范围 30/90/180/365 的开始日期按“结束日期为昨天”计算。
  - 同一品牌集合和日期范围只发起一次请求；第二次命中 payload 缓存。
  - 新请求会 abort 旧请求；旧响应不能覆盖新状态。
  - 清除品牌、切换日期和卸载时状态正确重置。
- [x] 新建 frontend/src/features/revenue-flow/useRevenueFlow.ts，定义：
  - RevenueFlowCatalogLoader：无参数返回 Promise<unknown>。
  - RevenueFlowTrendLoader：接收 { merchantIds, startDate, endDate, signal } 并返回 Promise<unknown>。
  - RevenueFlowOptions、RevenueFlowState 和 composable 返回的 refs/actions。
- [x] 使用 Vue ref/computed 管理目录、搜索词、下拉框、选中品牌、日期、快捷范围、loading/error、payload、展开状态和 zoom。
- [x] 使用 AbortController、请求序号和稳定 key（排序后的 merchant IDs + 日期）实现取消、竞态保护、请求去重和最多 12 项的模块级内存缓存；不同 composable 实例复用进行中的同参数请求。
- [x] 不在 composable 中拼接 DOM 或操作旧版 state；只通过 loader 访问 API，供 entry.ts 注入真实请求。
- [x] 重跑 composable 测试并确认 GREEN。

### 4. 实现 Vue 页面和 Canvas Sankey

- [x] 新建 frontend/src/features/revenue-flow/RevenueFlowSankey.vue：
  - 使用 canvas 绘制比例流带和节点标题，使用 Vue overlay 渲染可聚焦的产品/媒体节点。
  - 节点 hover/focus/click 显示相关路径；产品和媒体节点支持锁定/解除锁定，锁定路径上的连线支持 Revenue、来源占比和去向占比 tooltip。
  - 支持鼠标拖拽平移、Ctrl/Cmd + wheel 缩放、放大/缩小/重置工具栏按钮和键盘 Escape 交由页面收起。
  - 在 onMounted、数据变化和尺寸变化时绘制；在 onBeforeUnmount 移除 ResizeObserver、pointer、wheel 和键盘相关监听器。
  - 空数据、loading、unavailable、error 状态必须有可访问的 status/empty 文案，不调用未实现的 Canvas context。
- [x] 新建 frontend/src/features/revenue-flow/RevenueFlowPage.vue：
  - 保留旧结构语义：eyebrow、标题/副标题、品牌多选 combobox、已选品牌 chips、30/90/180/365 快捷范围、起止日期、状态/数据来源说明、五个 KPI、Sankey panel、展开按钮。
  - 使用 role=combobox、role=listbox、aria-multiselectable、aria-expanded、aria-live 和键盘 Escape/Enter 行为。
  - 页面卸载时调用 composable 的 cleanup；展开态通过页面 class 和按钮 aria-expanded 同步。
  - 通过 props 注入 loadCatalog、loadTrend、language、初始品牌和可选初始日期，保持页面可测试，并可继承 Brand Media 当前选择。
- [x] 新建 frontend/src/features/revenue-flow/revenueFlow.css，以旧版 Revenue Flow/Sankey CSS 为视觉基线，范围限定在 .oi-modern-page.revenue-flow-page；覆盖桌面、390px 视口、展开态、滚动、focus-visible 和 reduced-motion。
- [x] 新建 frontend/src/features/revenue-flow/RevenueFlowPage.test.ts，先验证 RED 再实现后验证 GREEN：页面标题、控件、5 个 KPI、Canvas、最多 12 个选中品牌、展开按钮和卸载清理。

### 5. 接入 Vue entry、i18n 和 SPA 路由边界

- [x] 在 frontend/src/shared/i18n/messages.zh.ts 和 messages.en.ts 增加旧版已存在的 revenueFlow.* 文案：标题、说明、品牌选择、日期范围、KPI、loading/error/empty/unavailable、展开/收起、Canvas 操作和 flow tooltip。
- [x] 在 frontend/src/entry.ts 导入 revenueFlow.css 与 RevenueFlowPage.vue，增加：
  - loadRevenueFlowCatalog() → /api/ui/db/publishers。
  - loadRevenueFlowTrend({ merchantIds, startDate, endDate, signal }) → /api/ui/db/brand-media-sankey，保留 query 参数和 AbortSignal。
  - revenueFlowFactory，并注册 revenue-flow: revenueFlowFactory。
- [x] 只在 public/app.js 的 Revenue Flow 页面边界增加 modern mount/unmount 分支：离开页面时调用 modernApp.unmountPage(revenue-flow) 并收起展开态；进入页面时同步 Brand Media 的初始品牌/日期到 root dataset，优先挂载 #revenueFlowModernRoot，挂载失败才调用原 renderRevenueFlowPage()。
- [x] 在 public/styles.css 增加仅针对 Revenue Flow 的 modern root 显示/legacy 子节点隐藏规则，避免旧 brand-media-page 选择器遮蔽 Revenue Flow；同时更新 public/auth.js 和 public/index.html 的 modern 资源版本号。
- [x] 不改 Publishers 的 mount/unmount 逻辑，不改变其 route key、组件或数据模型。
- [x] 若当前公共壳层缺少 #revenueFlowPage/#revenueFlowModernRoot 或因既有 Publishers 提交保持截断，只做 Revenue Flow 入口所需的最小接线，不跨范围恢复整个 public/index.html。

### 6. 增加专用契约检查并更新迁移文档

- [x] 新建 scripts/test_revenue_flow_frontend.mjs，检查 Revenue Flow feature 文件、entry 注册、两个 API 路径、public/app.js 的 modern mount/unmount/fallback 和无 Publishers 文件改动。
- [x] 更新 docs/frontend-migration-inventory.md 的 Revenue Flow 条目：记录 modern root、组件、model/composable、自动化测试和浏览器验收状态；未进行真实浏览器验收前保持 dual，不直接标记 modern。
- [x] 更新 docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md，追加本次 Revenue Flow 执行记录、冲突解决后的验证结果和下一步视觉验收项。
- [x] 运行 node scripts/test_revenue_flow_frontend.mjs、Revenue Flow Vitest、node --check public/app.js、python scripts/test_brand_media_trend.py 和 git diff --check。
- [x] 运行全量前端测试、typecheck、build 和 build contract 作为边界验证；冲突解决后均已通过，未修改 Publishers。
- [ ] 在未获得用户视觉验收前，不宣称 390px BrowserAct 或真实数据页面已通过；明确区分源代码测试、构建、浏览器验收和部署状态。

## 验收标准

- Revenue Flow 可通过 modern app API 注册和挂载，核心页面结构与旧版一致，且仍处于 Vue 3 feature 边界。
- 真实 loader 使用既有 /api/ui/db/publishers 和 /api/ui/db/brand-media-sankey，请求带 signal，重复请求不会并发污染当前视图。
- 选中品牌不超过 12 个；日期快捷范围、手动日期、清除选择、展开/收起和页面离开 cleanup 均有自动化覆盖。
- Sankey 使用 Canvas 绘制，产品/媒体节点可通过键盘和鼠标聚焦/锁定，空态和错误态可读。
- Publishers 文件没有改动；全量失败若只来自既有 Publishers 提交，交付说明中明确隔离该阻塞。
- 视觉对齐以旧版 CSS 为基线；真实浏览器和 390px 视口验收完成后，才把清单状态从 dual 更新为 modern。
