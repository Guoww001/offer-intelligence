# 前端框架渐进迁移 Roadmap 与实施方案

> **给执行代理：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans` 按任务执行本方案。每一步使用复选框跟踪。

**目标：** 在保持现有 Python/Vercel API、认证方式、业务口径和用户可见行为不变的前提下，将当前大型原生 JavaScript SPA 渐进迁移到可组件化、可测试、可持续扩展的现代前端架构。

**架构：** 新前端默认采用 `Vue 3 + TypeScript + Vite`，先以页面岛形式与现有 `public/app.js` 共存，通过窄接口 `legacy bridge` 读取启动数据、接收页面导航并回传必要事件。迁移按页面边界推进，每个页面完成“契约测试 → 新实现 → 浏览器验收 → 切换默认渲染 → 删除对应旧代码”的闭环；认证、Python API 和 Vercel 路由在迁移期间保持兼容，Chatbot/Agent 因耦合与风险最高而最后迁移。

**技术栈：** Vue 3、TypeScript、Vite、Vitest、Vue Test Utils、`happy-dom`、现有 Python 3.12 服务、现有 Vercel Python Functions、现有 Node 22 CI、现有原生 JavaScript 回归脚本；运行时不引入 Pinia、Vue Router、组件库或 CSS 框架，除非后续独立 ADR 证明必要。

## 全局约束

- 本文是主 Roadmap；每个阶段必须独立产生可运行、可测试、可回滚的软件，不允许一次性重写 `public/app.js`、`public/styles.css` 或 `public/index.html`。
- 默认框架决策为 `Vue 3 + TypeScript + Vite`。若团队明确要求 React，必须先修改并重新评审本 Roadmap 和对应 ADR，不能在执行中临时替换技术栈。
- 保留本地 `python server.py` 与 Vercel 两条运行路径；所有 `/api/*` 路径、认证 Cookie、请求字段、响应字段和错误语义默认不变。
- 迁移期的生产静态输出继续位于 `public/`；Vite 只写入 `public/assets/modern/`，不得清空或覆盖现有 `public/`。
- 新代码全部使用 TypeScript 严格模式；禁止在新代码中使用无说明的 `any`、直接读写任意 `window.*`、拼接未转义 HTML 或复制现有巨型全局状态。
- 新代码不直接依赖 `public/app.js` 内部函数；跨新旧边界只能通过本文定义的 `window.OI_MODERN_APP` 和 `window.OI_LEGACY_BRIDGE` 临时接口。
- 新页面默认使用 Vue Composition API 和本地 composable；首期不引入 Pinia。只有三个以上已迁移页面需要共享可变状态时，才能通过独立 ADR 引入全局状态库。
- 首期不引入 Vue Router。旧 `switchPage(page)` 继续作为导航权威入口；共享 Shell 完成迁移后再决定是否将 URL 路由纳入范围。
- 中英文文案、指标定义、金额/百分比格式、Tier 规则、付款状态、搜索语义和导出列必须与旧实现一致；不得以“重构”为由改变业务口径。
- Chatbot/Agent 相关改动必须先阅读 `docs/chatbot-feature-report.md`；迁移不得改变 LLM 分类、Agent 工具协议、Trace 隐私边界、SSE 行为或 Report/Chat Mode 分流。
- 每个实现任务遵循 RED → GREEN → REFACTOR：先写失败测试并确认失败，再做最小实现，再运行目标测试和相关回归。
- 现有源码字符串测试在对应页面迁移完成前继续保留；只有新增了行为等价的 Vitest 或浏览器验收覆盖后才能删除或改写。
- 原项目 `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main` 是新前端的只读视觉基线；页面迁移完成后必须依据其中的 CSS、HTML、页面渲染结构和静态资源执行新旧页面对齐，不得只凭截图近似或自行重新设计。
- 每个页面只有同时通过功能等价验收和视觉基线对齐验收后，才能将迁移状态标记为 `modern`；静态测试、构建通过或页面能够显示，均不能替代新旧页面对齐。
- 所有新依赖使用 `npm install --save-exact` 固定版本并提交 `frontend/package-lock.json`；执行安装前核对官方维护状态和 Node 22 兼容性。
- 迁移期间禁止把框架运行时从 CDN 注入页面；所有新运行时依赖必须进入 Vite 构建产物并受 lockfile 管理。
- 用户可见文案、代码注释和项目文档使用简体中文；变量名、函数名、类型名、协议字段和命令保持英文。
- 任何 commit、push、PR 或 merge 都需要用户在执行阶段明确授权；获准后提交和 PR 内容必须中英双语。
- 若执行阶段启动 `http://127.0.0.1:8765/`，完成验证后必须解析当前监听 PID、关闭服务并复查端口。

---

## 1. 当前基线与迁移动因

### 1.1 代码规模

截至 2026-08-27 的只读盘点：

| 文件 | 规模 | 当前职责 |
| --- | ---: | --- |
| `public/app.js` | 约 33,140 行、1.60 MB | 全局状态、页面路由、数据查询、业务规则、DOM 渲染、事件绑定、导出、Chatbot/Agent |
| `public/styles.css` | 约 23,910 行、619 KB | 全站、Dashboard、Chatbot、Agent、Tier、Payments、Publishers 等全部样式 |
| `public/index.html` | 约 2,164 行、133 KB | 所有页面 Shell、弹窗、抽屉和脚本入口 |
| `public/auth.js` | 约 300 行 | 认证、数据预载、全局数据注入和动态加载 `app.js` |

`public/app.js` 当前包含约 1,428 个函数、324 处事件监听、202 处 `innerHTML` 赋值和 424 次 `getElementById`。`state`、`switchPage()` 和 `init()` 集中维护大量页面状态与 DOM 生命周期，新增页面会继续扩大共享修改面。

### 1.2 测试基线

- `scripts/` 下现有 44 个 `test_*.mjs`，约 9,285 行。
- 其中约 35 个测试直接读取 `public/app.js`，约 19 个依赖 `window.OFFER_INTELLIGENCE_TEST_HOOKS`。
- CI 当前运行 16 个前端 `.mjs` 脚本，其余脚本并未全部进入持续集成。
- 现有测试能够保护大量业务字符串和纯函数，但部分测试绑定源码形状、换行和函数名称，不能单独证明真实浏览器中的页面等价。

### 1.3 部署基线

- `vercel.json` 当前为 `framework: null`、`buildCommand: null`、`outputDirectory: "public"`。
- 仓库根目录没有有效前端依赖；`package-lock.json` 的 `packages` 为空。
- `public/auth.js` 先请求 `/api/ui/db/offers`，写入 `window.CHATBOT_DATA`、`window.SHEET_REPORT_DATA` 和 `window.PRODUCT_KEYWORDS`，再动态加载 `public/app.js`。
- 本地 `server.py` 与 Vercel Functions 共用 API 语义；框架迁移不能把后端改造成 Node 服务，也不能破坏 Python Serverless 打包边界。

### 1.4 结论

当前规模已经满足框架化收益条件，但风险同样足以排除大爆炸式重写。迁移策略必须先建立测试和构建护栏，再选择低耦合页面验证新架构，最后处理 Chatbot/Agent 和全局 Shell。

---

## 2. 目标架构

### 2.1 目录边界

```text
frontend/
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── src/
│   ├── entry.ts
│   ├── env.d.ts
│   ├── legacy/
│   │   ├── bridge.ts
│   │   └── contracts.ts
│   ├── shared/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   └── errors.ts
│   │   ├── contracts/
│   │   │   ├── offer.ts
│   │   │   ├── payment.ts
│   │   │   └── tier.ts
│   │   ├── format/
│   │   │   ├── money.ts
│   │   │   ├── number.ts
│   │   │   └── percentage.ts
│   │   ├── i18n/
│   │   │   └── index.ts
│   │   └── styles/
│   │       ├── tokens.css
│   │       └── modern-root.css
│   ├── shell/
│   │   ├── AppShell.vue
│   │   ├── navigation.ts
│   │   └── usePageState.ts
│   └── features/
│       ├── offer-tracker/
│       ├── payments/
│       ├── publishers/
│       ├── monthly-merchants/
│       ├── brand-media/
│       ├── revenue-flow/
│       ├── google-ads/
│       ├── targets/
│       ├── category-report/
│       ├── tier-sheet/
│       ├── chatbot/
│       └── agent/
└── tests/
    ├── setup.ts
    ├── legacy-bridge.test.ts
    └── build-contract.test.ts

public/
├── assets/modern/        # Vite 生成，不手工编辑
├── app.js                # 迁移期间保留并逐步缩小
├── auth.js
├── index.html
└── styles.css            # 迁移期间保留并逐步缩小
```

### 2.2 临时新旧桥接接口

迁移期只允许以下全局接口：

```ts
type ModernPageName =
  | "offer-list-tracker"
  | "payments"
  | "publishers"
  | "monthly-new-merchants"
  | "brand-media"
  | "revenue-flow"
  | "google-ads"
  | "sheets"
  | "category"
  | "tier"
  | "dashboard"
  | "agent";

interface LegacyBootstrapData {
  chatbotData: unknown;
  sheetReportData: unknown;
  productKeywords: unknown;
  language: "zh" | "en";
  llmEnabled: boolean;
  agentEnabled: boolean;
}

interface ModernAppApi {
  bootstrap(data: LegacyBootstrapData): void;
  mountPage(page: ModernPageName, element: HTMLElement): void;
  unmountPage(page: ModernPageName): void;
  setLanguage(language: "zh" | "en"): void;
  hasPage(page: ModernPageName): boolean;
}

interface LegacyBridgeApi {
  navigate(page: ModernPageName): void;
  download(type: string, payload: unknown): boolean;
}
```

`window.OI_MODERN_APP` 由 Vite 产物提供，`window.OI_LEGACY_BRIDGE` 由旧入口提供。接口只传结构化数据和受控事件，不暴露 `state`、`els`、任意旧函数或 DOM 查询能力。对应页面完成迁移并删除旧实现后，桥接接口同步收窄；全部页面切换完成后删除两个全局对象。

### 2.3 数据流

```text
Browser
  └─ public/auth.js
      ├─ 校验 /api/auth/session
      ├─ 请求 /api/ui/db/offers
      ├─ 加载 modern bundle
      ├─ window.OI_MODERN_APP.bootstrap(...)
      └─ 加载 legacy app.js（迁移期）
            ├─ 旧页面继续由 app.js 渲染
            └─ 已迁移页面委托 OI_MODERN_APP.mountPage(...)

Vue feature
  ├─ shared/contracts 解析和约束 API 数据
  ├─ shared/api 调用现有 /api/*
  ├─ composable 管理页面状态
  └─ component 渲染与交互
```

### 2.4 完成标准

框架迁移只有同时满足以下条件才算完成：

- `public/app.js` 不再承担页面渲染、全局路由、Chatbot/Agent 执行或业务状态职责；确认无引用后删除。
- `public/index.html` 只保留应用根节点、认证 Shell、必要的 meta 和脚本入口，不再包含各业务页面的完整 DOM。
- `public/styles.css` 只保留认证页或被新样式入口显式接管；确认无引用后拆分或删除。
- 所有新前端源码位于 `frontend/src/`，构建产物位于 `public/assets/modern/`。
- CI 必须执行 TypeScript 检查、Vitest、Vite build、现有 Python 测试和仍保留的旧 Node 回归。
- 认证、API、Tier、支付、导出、Chatbot、Agent、双语切换和移动端关键流程完成真实浏览器验收。
- Vercel 预览环境和本地 Python 服务都能加载同一构建产物，且不依赖开发机全局 npm 包。
- 所有已迁移页面均完成旧项目视觉基线对齐；至少保留同一数据、视口和关键状态下的新旧截图或等价浏览器证据，并记录无法完全复原的差异及原因。

---

### 2.5 原项目视觉基线与新旧页面对齐流程

**基线项目（只读，不允许向该目录写入迁移产物）：**

```text
D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main
```

优先参考以下旧项目文件和资产：

- `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main\public\styles.css`：全站视觉变量、布局、组件状态和响应式规则。
- `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main\public\index.html`：页面 Shell、旧 DOM 层级、class 名称和静态节点。
- `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main\public\app.js`：目标页面的渲染函数、事件状态、动态 class 和显示/隐藏边界；按现有函数索引读取，禁止一次性读取整个文件。
- `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main\public\auth.js`：认证后的启动顺序、数据注入和语言状态。
- `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main\m2-offer-tracker-desktop.png`、`D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main\payments-m4-visual-desktop.png`：Offer Tracker 与 Payments 的已知桌面基线截图；其他页面以旧项目真实渲染结果为准。
- 旧项目 `public/` 下被目标页面引用的图标、图片、字体和其他静态资源。

该流程在每个页面的 Vue 实现完成后、迁移清单从 `dual` 改为 `modern` 前执行；M7 清理 legacy 前再执行一次全站复核。流程顺序固定如下：

1. **冻结旧页面基线。**

   在只读旧项目目录中盘点目标页面使用的 CSS 变量、选择器、媒体查询、HTML 层级、动态 class、图标/字体和关键状态。使用以下命令确认来源文件和目标页面入口：

   ```powershell
   $oldProject = 'D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main'
   rg --files $oldProject\public -g '*.css' -g '*.html' -g '*.js' -g '*.svg' -g '*.woff*' -g '*.png' -g '*.jpg'
   rg -n 'renderPaymentsPage|renderOfferListTrackerPage|switchPage|styles\.css' $oldProject\public\app.js $oldProject\public\index.html
   ```

   记录目标页面的桌面视口、移动视口、语言、数据快照、筛选条件、滚动位置和加载/空数据/错误状态；旧项目目录只读，任何临时截图和探针必须写入新迁移工作树的专用验证目录或系统临时目录。

2. **建立旧页面可复现截图。**

   在旧项目目录启动独立服务，在新项目目录启动另一独立服务；两者使用相同的缓存数据、认证开关、语言、视口和页面状态。默认使用隔离端口 `8770`（旧项目）和 `8771`（Vue 迁移项目），避免占用 `8765`。至少采集以下状态：

   - 桌面端完整页面：侧边栏、页头、筛选/统计区域、表格或主内容区。
   - `390px` 移动端：折叠导航、布局换行、横向滚动和底部内容。
   - 默认状态、已选筛选、hover/focus/active、加载、空数据和受控错误状态。

   旧项目若因认证、数据库或外部 API 不可用而无法复现，必须记录实际阻断原因；不得用另一种数据或状态假装完成视觉对齐。

3. **建立旧样式到 Vue 组件的映射。**

   先将旧页面的 Shell、页面容器、卡片、控件、表头、表格行、弹层和状态 class 映射到 `frontend/src/shell/` 与对应 `frontend/src/features/<feature>/` 组件。优先复用旧项目已确认的设计 token 和 class 语义；若 Vue DOM 结构不同，则在组件边界内适配选择器，不直接把整份全局 `styles.css` 无差别复制到 modern 页面。

   映射表至少记录：旧选择器、旧计算样式或来源行、新 Vue 组件/选择器、是否保留 class、对应状态和验证截图名称。涉及全局 Shell 的样式只能在 Shell 迁移任务中统一调整，页面专项不能自行改变侧边栏和全局导航。

4. **在功能完成后执行视觉对齐。**

   按“整体几何 → 视觉 token → 内容密度 → 交互状态 → 响应式”的顺序调整：

   - 先对齐 viewport 下的页面宽高、侧边栏宽度、主内容起点、网格列数、面板位置、表格滚动边界和断点。
   - 再对齐字体族、字号、字重、行高、颜色、背景、边框、圆角、阴影、图标尺寸和间距。
   - 再对齐真实文案、数字格式、行高、列宽、空白和滚动条等内容密度。
   - 最后对齐 hover、focus-visible、active、disabled、展开/收起、错误提示和加载状态；不能只对齐默认静态截图。

   视觉修改必须保持 API、业务口径、筛选、排序、导出和权限行为不变；如果需要改变 DOM 才能复原样式，先增加组件回归断言，再做最小结构调整。

5. **执行新旧差异验收。**

   在相同视口和相同数据状态下逐项比较旧页面与 Vue 页面，至少检查 DOM 结构、关键元素的 `getBoundingClientRect()`、计算样式、页面级横向溢出、表格内部滚动、焦点可见性和截图差异。截图只作为证据，不能替代交互验证；登录门禁或 API 错误导致页面不可见时，必须标记为未完成。

   视觉差异达到以下任一情况时不得通过：页面主结构错位、主色/字体体系明显不同、表格密度明显不同、关键控件状态缺失、移动端出现意外页面级横向滚动，或错误/空数据状态与旧页面语义不一致。因浏览器、字体、外部资源或数据不可复现而无法完全一致时，在阶段记录中明确差异、证据和接受理由。

6. **记录和放行。**

   将基线来源、视口/数据状态、旧新截图路径、计算样式探针结果、行为测试命令、已知差异和回滚方式写入对应阶段实施记录。只有功能测试、视觉对齐和浏览器验收全部通过，才能更新 `docs/frontend-migration-inventory.md` 的状态并进入下一页面；M7 前必须重新检查旧 CSS 和旧 DOM 是否仍有未迁移的视觉责任。

---

## 3. 阶段总览

| 阶段 | 目标 | 相对规模 | 退出门槛 |
| --- | --- | --- | --- |
| M0 | 固化 ADR、基线和迁移契约 | S | 选型、范围、测试清单获确认 |
| M1 | 建立 Vite/Vue/TS 双运行骨架 | M | 旧页面零行为变化，现代 bundle 可加载和回滚 |
| M2 | Offer Tracker 试点 | L | 首个页面默认使用 Vue，旧实现仍可快速回退 |
| M3 | 抽取共享 API、类型、格式化和 i18n | M | 后续页面不复制 legacy helper |
| M4 | 迁移导航 Shell 与低风险数据页面 | XL | Payments/Publishers/媒体页面完成迁移 |
| M5 | 迁移 Targets、Category、Tier 管理 | XL | 数据口径、选择、导出和持久化全部等价 |
| M6 | 迁移 Chatbot 与 Agent | XL | 权威流程、SSE、工具执行、Trace 和记忆无回归 |
| M7 | 切断 legacy bridge、清理旧资源 | L | 无 legacy 运行时引用，CI 与浏览器验收通过 |
| M8 | 生产切换与观察 | M | 预览验证、回滚演练、性能与错误指标达标 |

阶段规模只用于排序，不等同于承诺日期。每个 M 阶段开始前，从本 Roadmap 派生一份独立的可执行实施计划，并重新核对当时的代码行号与工作区状态。

---

### 任务 1：M0——框架 ADR、功能盘点与验收基线

**文件：**

- 新增：`docs/architecture/adr-001-frontend-framework.md`
- 新增：`docs/frontend-migration-inventory.md`
- 新增：`scripts/test_frontend_migration_inventory.mjs`
- 修改：`.github/workflows/ci.yml`

**接口：**

- 产出：ADR 固定 `Vue 3 + TypeScript + Vite`、页面岛策略、临时 bridge 和不引入 Pinia/Vue Router 的首期边界。
- 产出：页面清单包含入口 DOM、旧渲染函数、状态字段、API、localStorage、导出、弹窗/抽屉和现有测试。
- 供后续使用：每个页面必须有稳定的 `pageKey` 和唯一迁移状态 `legacy | dual | modern | removed`。

- [x] **步骤 1：为迁移清单建立失败测试**

  新建 `scripts/test_frontend_migration_inventory.mjs`，断言清单至少覆盖 `switchPage()` 当前识别的页面、每项包含 `pageKey/status/legacyEntry/tests`，并且状态只能来自固定集合。

- [x] **步骤 2：运行测试确认 RED**

  运行：`node scripts/test_frontend_migration_inventory.mjs`

  预期：失败并提示 `docs/frontend-m