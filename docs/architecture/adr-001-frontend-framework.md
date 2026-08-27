# ADR-001：前端框架与渐进迁移架构

> 日期：2026-08-27  
> 状态：已接受，实施中  
> 决策范围：YeahPromos Offer Intelligence 浏览器端  
> 关联 Roadmap：`docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md`

## 背景

当前前端是由 Python 服务和 Vercel 直接发布的原生 JavaScript SPA。`public/auth.js` 在认证成功后加载 Offer、Sheet 和关键词数据，将其写入受控的 `window.*` 启动对象，再动态加载 `public/app.js`。后者目前同时承担全局状态、页面导航、API 请求、业务计算、DOM 渲染、导出、Chatbot 和 Agent 生命周期。

截至本 ADR 创建时：

- `public/app.js` 约 33,140 行、1.60 MB；
- `public/styles.css` 约 23,910 行、619 KB；
- `public/index.html` 约 2,164 行、133 KB；
- `switchPage()` 管理 12 个业务页面；
- 现有测试以 Node 源码契约、VM hooks 和 Python API 测试为主，尚无组件级测试体系；
- Vercel 仍使用 `framework: null`、`buildCommand: null`、`outputDirectory: "public"`。

继续只在 `public/app.js` 中增加功能会扩大共享修改面、状态与 DOM 同步风险和测试耦合。一次性重写又会同时触碰认证、业务口径、导出、Tier、Chatbot、Agent 和双运行部署，无法形成安全回滚单位。

## 决策

采用 `Vue 3 + TypeScript + Vite`，按页面岛渐进迁移，并维持本地 Python 服务与 Vercel Python Functions 的后端边界。

具体决策如下：

1. 新前端源码统一位于 `frontend/src/`，生产构建只写入 `public/assets/modern/`。
2. 迁移期间保留 `public/app.js`，已迁移页面通过临时 `window.OI_MODERN_APP` 与 `window.OI_LEGACY_BRIDGE` 窄接口和旧应用协作。
3. 每个页面按 `legacy → dual → modern → removed` 推进；只有行为测试和真实浏览器验收通过后才能改变状态。
4. 首个试点为 Offer Tracker。该页面有明确根节点、独立状态、专用 API、导出边界和现有回归，适合验证框架价值与桥接策略。
5. Chatbot 与 Agent 最后迁移。其 LLM 分类、SSE、工具调用、Trace、结构化记忆、Deep Window 和双语 onboarding 必须保持现有权威文档定义。
6. 首期不引入 Pinia、Vue Router、组件库或 CSS 框架。页面状态使用 Composition API 和本地 composable；旧 `switchPage()` 在共享 Shell 迁移前继续作为导航权威入口。
7. 新运行时依赖全部进入 Vite bundle，并由 `frontend/package-lock.json` 固定；禁止从 CDN 加载 Vue。
8. TypeScript 使用严格模式；跨 API 边界同时使用类型和必要的运行时校验，不能仅靠类型断言掩盖无效数据。
9. 新旧共存阶段允许 modern bundle 加载失败后回退旧页面；删除 legacy 后改为明确错误状态和上一构建回滚。

## 为什么选择 Vue 3

- Vue 可以挂载到单个现有页面根节点，适合与当前静态 HTML 和原生脚本渐进共存。
- 单文件组件能把模板、交互和页面作用域样式放在同一 feature 边界，降低当前 HTML/JS/CSS 三个巨型文件的共同修改频率。
- Composition API 适合先迁移纯 model 与 composable，再迁移视图，不要求一次重做全局 Store。
- 与当前以模板字符串和显式 DOM 渲染为主的实现相比，Vue 模板的认知迁移成本较低。
- Vite 能在不替换 Python 后端的前提下提供 TypeScript、测试和生产构建。

选择 Vue 不是基于“框架天然更快”。性能收益必须来自按页面加载、减少初始 DOM、局部响应式、避免整页重算、删除 legacy 资源和必要的数据分页/聚合。

## 被否决的方案

### 继续使用原生 JavaScript，只拆 ES Modules

优点是运行时依赖最少，初期改动小；缺点是仍需自行维护组件生命周期、局部状态、DOM 更新和测试装配，无法充分降低当前页面交互复杂度。该方式适合功能冻结项目，不符合当前持续新增页面和 Agent 能力的方向。

### 一次性重写整个 SPA

能够快速得到统一目录，但没有安全的页面级回滚单位，会同时改变认证加载顺序、业务 DOM、导出、SSE 和多个数据页面，现有源码契约测试也无法覆盖完整重写。风险不可接受。

### React + TypeScript + Vite

React 同样可行且生态成熟，但本项目当前没有既有 React 资产或团队约束。Vue 对现有模板式页面的渐进挂载更直接，首期需要的状态与路由依赖更少。如果未来出现明确团队标准，需要新 ADR 替换本决策，不能在实施中混用两套框架。

### 直接迁移到完整元框架

Next、Nuxt 等会同时改变静态构建、路由和服务端边界，与当前 Python/Vercel Functions 架构冲突。当前目标是前端组件化，不是替换后端运行时。

## 迁移接口边界

迁移期间只允许两个临时全局对象：

- `window.OI_MODERN_APP`：接收启动数据、挂载/卸载页面、同步语言、报告可用页面。
- `window.OI_LEGACY_BRIDGE`：向旧应用请求导航和尚未迁移的下载能力；M3 后不再暴露页面重渲染 helper。

禁止把旧 `state`、`els`、任意内部函数或 DOM 查询器暴露给 Vue。桥接 payload 必须是结构化数据；迁移完成后删除两个全局对象。

## 测试与验收决策

- 新纯函数和 composable 使用 Vitest。
- Vue 组件使用 Vue Test Utils 和 `happy-dom`，从用户可见文本、角色和事件验证行为。
- 现有 Node/Python 回归在对应业务迁移完成前继续保留。
- 每个页面必须有真实浏览器验收；静态字符串测试不能作为视觉或运行时完成证据。
- Offer Tracker 等大数据页面必须避免把整份数据深度响应式化；选择、筛选和分页需要固定 fixture 性能对比。

## 部署决策

- `vercel.json` 最终使用 `npm --prefix frontend ci` 安装、`npm --prefix frontend run build` 构建，并继续输出 `public`。
- 本地先构建 modern assets，再由 `python server.py` 统一服务静态文件和 API。
- Vite 不拥有 Python API，也不改变 `/api/*` URL。
- M1 仅建立兼容 bundle；按页面拆包和删除 legacy 后才能宣称首屏性能改善。

## 结果与代价

正向结果：页面和状态边界清晰、组件测试可执行、构建依赖可锁定、迁移可按页面回滚、后续功能不再扩大 `public/app.js`。

代价：M1–M6 会同时维护新旧运行时；首屏资源和内存可能短期增加；团队需要维护 TypeScript、Vue 和 Vite；桥接接口在删除前也是一项临时复杂度。

## 重新评审触发条件

出现以下任一情况时必须重新评审本 ADR：

- Vue 无法在不改变认证或 Vercel Functions 边界的情况下稳定构建；
- Offer Tracker 试点无法达到旧行为等价或性能不低于基线；
- 三个以上已迁移页面确实需要共享可变状态；
- 共享 Shell 迁移需要可复制、可后退的 URL 路由；
- 团队形成明确且长期的 React 或其他框架标准；
- modern 首屏 bundle 超过 Roadmap 的 250 KB gzip 门槛且无法合理拆分。
