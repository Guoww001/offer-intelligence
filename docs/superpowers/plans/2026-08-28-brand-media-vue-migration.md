# Brand Media Vue3 页面迁移计划

## 目标

在不改动 Brand Media 后端接口和同伴负责的 Publishers 页面代码的前提下，将 `brand-media` 页面迁移到 Vue3，并保留 legacy fallback。页面迁移完成后，依据主 RoadMap 第 2.5 节，以旧项目 CSS、HTML、渲染结构和交互状态作为视觉基线完成新旧对齐。

## 范围

- 品牌/商户搜索下拉与选择。
- Manager 筛选。
- 30D、90D、180D、1Y 快捷范围和自定义日期范围。
- Brand Media 趋势 API 请求、AbortController 取消旧请求和过期响应保护。
- 每日订单折线图：缺失源记录保留断线，零订单记录保留为真实点，Revenue 保留在 hover 数据中。
- 媒体图例锁定/解除锁定、锁定媒体点击柱状图。
- 图表展开、Escape 退出并恢复焦点。
- KPI、媒体汇总表、未选择品牌/无数据/无权限/API 错误状态。
- Vue modern root、legacy fallback、迁移清单和本页测试。

## 不在本次范围

- `Publishers` 页面，由同伴负责。
- `Revenue Flow` 的 Sankey Canvas；该页面按主 RoadMap 后续顺序单独迁移。
- Brand Media 后端 SQL、API 响应字段和数据库权限。
- 全局 AppShell、移动导航和主题迁移。

## 执行顺序

1. [x] 读取旧项目 `public/index.html`、`public/styles.css`、索引范围内的 `public/app.js` 和现有 Brand Media 回归，冻结行为契约。
2. [x] 先写并运行 model、composable、页面组件的 RED 测试。
3. [x] 新增 `frontend/src/features/brand-media/` 下的类型、model、composable、组件、样式和测试。
4. [x] 在 `entry.ts` 注册 `brand-media`，使用 shared API client；在 legacy 入口增加 modern root 挂载和卸载边界。
5. [x] 保持旧 DOM 和旧事件作为 fallback，避免新旧事件同时绑定。
6. [ ] 按旧版相同数据、语言和视口对齐桌面端、移动端、加载/错误/空状态、hover、锁定和展开状态（桌面及交互状态已完成，390px BrowserAct 真实视口仍待补验）。
7. [x] 运行本页测试、旧版回归、typecheck、build、迁移清单契约和浏览器验收；证据完整后更新主 RoadMap 与迁移清单。

## 验收门槛

- Brand Media 不选择品牌时显示“请选择品牌”状态，不能误发趋势请求。
- 趋势请求包含 `merchantId`、`startDate`、`endDate`；新请求会取消旧请求，旧响应不能覆盖新状态。
- Manager 和锁定媒体只影响当前视图，不修改原始 payload。
- 缺失日期断线，真实零值不断线；折线图主指标为订单数并保留 Revenue。
- 单个锁定媒体使用普通点击柱状图，多个锁定媒体使用堆叠点击柱状图。
- 401/403 与普通 API 错误、无数据状态分别可见。
- 图表展开后阻止页面滚动，Escape 退出并把焦点还给展开按钮。
- 桌面和 390px 移动视口无页面级横向溢出；表格允许自身滚动。
- 验收期间 legacy fallback 可用，不能删除 Publishers 或 Revenue Flow 代码。

## 回滚

只需移除 `brand-media` modern factory 或让入口挂载失败，即可回到原有 `renderBrandMediaPage()`；不回滚 API、数据库或同伴的 Publishers 改动。

## 执行记录（2026-08-28）

- RED：目标模块尚不存在时，`brandMediaModel.test.ts`、`useBrandMedia.test.ts`、`BrandMediaPage.test.ts` 组成的 3 个套件按预期因模块解析失败而处于 RED。
- GREEN：新增 Brand Media model、`useBrandMedia`、订单折线图、点击柱状图、媒体表格、页面组件和 scoped 样式；趋势请求使用 `AbortController` 与过期响应保护；`entry.ts` 注册 modern factory，`public/app.js` 保留 legacy fallback 和页面切换卸载边界。
- 视觉对齐：读取旧项目 CSS/HTML/渲染结构，在 BrowserAct 相同桌面视口完成空状态几何对齐；旧版与 Vue 版页面、页头、筛选卡、空 KPI 占位、图表和表格的关键几何一致。旧版截图为 `C:\Users\yg\AppData\Local\Temp\brand-media-legacy-desktop.png`，对齐截图为 `C:\Users\yg\AppData\Local\Temp\brand-media-modern-aligned.png`。
- 交互验收：使用 BrowserAct 的会话 fixture 验证品牌选择、Manager 过滤、订单/Revenue hover、缺失日期断线、零订单点、媒体锁定、单媒体/累计点击图、展开、Escape 焦点恢复；验证截图为 `C:\Users\yg\AppData\Local\Temp\brand-media-modern-populated.png`。fixture 只存在于浏览器会话中，没有修改后端或仓库数据。
- 真实 API：`/api/ui/db/publishers` 返回 200；趋势接口在当前本地数据库权限/配置下返回 503，现代页面显示受控错误。未将真实接口失败宣称为 populated 成功。
- 未完成门槛：BrowserAct 当前 CLI 没有 viewport emulation 选项，因此 390px 真实视口验收待后续具备可调视口的 BrowserAct 环境后补做；在此之前页面保持 `dual`，不升级为 `modern`。
- 自动化结果：全量 Vitest 11 个文件/61 项通过；typecheck、build、Brand Media 前端与趋势契约、迁移清单/build 契约、既有 Payments 契约、Python 趋势聚合检查和 legacy JS 语法检查均通过。
