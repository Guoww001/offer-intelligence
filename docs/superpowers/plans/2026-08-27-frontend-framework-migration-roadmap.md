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

  预期：失败并提示 `docs/frontend-migration-inventory.md` 不存在。

- [x] **步骤 3：编写 ADR 和完整页面清单**

  ADR 必须记录以下已确认结论：Vue 3、TypeScript、Vite、页面岛、Offer Tracker 试点、Chatbot/Agent 最后迁移、构建输出到 `public/assets/modern/`、旧 API 不变。清单逐页引用准确函数名，不复制整段源码。

- [x] **步骤 4：把清单测试加入 CI**

  在现有前端回归段加入：

  ```yaml
  node scripts/test_frontend_migration_inventory.mjs
  ```

- [x] **步骤 5：运行目标检查确认 GREEN**

  运行：

  ```powershell
  node scripts/test_frontend_migration_inventory.mjs
  node --check public/auth.js
  node --check public/app.js
  ```

  预期：三条命令均退出码为 0。

- [x] **步骤 6：评审门槛**

  人工确认页面清单没有漏掉 Chatbot/Agent、Deep Window、下载导出、语言切换、主题、登录和移动导航。未通过时不能进入 M1。

---

### 任务 2：M1——建立 Vue/TypeScript/Vite 双运行骨架

**文件：**

- 新增：`frontend/package.json`
- 新增：`frontend/package-lock.json`
- 新增：`frontend/tsconfig.json`
- 新增：`frontend/vite.config.ts`
- 新增：`frontend/vitest.config.ts`
- 新增：`frontend/src/env.d.ts`
- 新增：`frontend/src/entry.ts`
- 新增：`frontend/src/legacy/contracts.ts`
- 新增：`frontend/src/legacy/bridge.ts`
- 新增：`frontend/src/shared/styles/modern-root.css`
- 新增：`frontend/tests/setup.ts`
- 新增：`frontend/tests/build-contract.test.ts`
- 新增：`scripts/test_frontend_build_contract.mjs`
- 修改：`.gitignore`
- 修改：`public/index.html`
- 修改：`public/auth.js`
- 修改：`vercel.json`
- 修改：`.github/workflows/ci.yml`
- 修改：`AGENTS.md`

**接口：**

- 产出：`window.OI_MODERN_APP.bootstrap()`、`mountPage()`、`unmountPage()`、`setLanguage()`、`hasPage()`。
- 消费：M0 定义的 `pageKey` 和当前 `auth.js` 启动数据。
- 构建输出：`public/assets/modern/oi-modern.js` 和 `public/assets/modern/oi-modern.css`，文件名稳定，缓存版本由 `public/index.html` 与测试共同管理。

- [x] **步骤 1：建立失败的构建契约测试**

  `scripts/test_frontend_build_contract.mjs` 必须断言：

  - `frontend/package.json` 声明 `typecheck`、`test`、`build`；
  - Vite 输出目录严格为 `../public/assets/modern`；
  - `emptyOutDir` 只清理上述子目录；
  - `public/index.html` 只从本地加载 modern bundle；
  - `vercel.json` 仍输出 `public`，并运行前端安装和构建命令。

- [x] **步骤 2：运行契约测试确认 RED**

  运行：`node scripts/test_frontend_build_contract.mjs`

  预期：失败并提示 `frontend/package.json` 不存在。

- [x] **步骤 3：安装并锁定最小依赖**

  运行：

  ```powershell
  New-Item -ItemType Directory -Force -Path frontend
  npm --prefix frontend init -y
  npm --prefix frontend install --save-exact vue
  npm --prefix frontend install --save-dev --save-exact typescript vue-tsc vite @vitejs/plugin-vue vitest @vue/test-utils happy-dom @types/node
  ```

  预期：生成 `frontend/package.json` 和 `frontend/package-lock.json`，`npm --prefix frontend ls --depth=0` 无缺失依赖。

- [x] **步骤 4：配置严格 TypeScript、Vitest 和安全输出目录**

  `vite.config.ts` 使用 Vue 插件、库模式 IIFE 输出和固定文件名；`emptyOutDir: true` 只能作用于 `public/assets/modern/`。`tsconfig.json` 启用 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride` 和 DOM 类型。

- [x] **步骤 5：实现空 modern API**

  `entry.ts` 只注册 `window.OI_MODERN_APP`，初始 `hasPage()` 对所有页面返回 `false`；不得挂载业务页面。`bootstrap()` 必须校验只读启动数据并允许重复调用但不重复注册事件。

- [x] **步骤 6：接入认证启动链但保持旧行为**

  `auth.js` 在加载 `app.js` 前加载 modern bundle 并调用 `bootstrap()`；modern bundle 加载失败时记录受控警告并继续加载旧应用。不得修改登录成功、登录失败和 offers 请求的现有语义。

- [x] **步骤 7：配置 Vercel 与 CI**

  `vercel.json` 使用：

  ```json
  {
    "installCommand": "npm --prefix frontend ci",
    "buildCommand": "npm --prefix frontend run build",
    "outputDirectory": "public"
  }
  ```

  保留现有 routes/functions；只替换这三个顶层字段。CI 在 Node 语法检查前依次执行 `npm --prefix frontend ci`、`typecheck`、`test -- --run` 和 `build`。

- [x] **步骤 8：运行构建与旧回归确认 GREEN**

  运行：

  ```powershell
  npm --prefix frontend ci
  npm --prefix frontend run typecheck
  npm --prefix frontend run test -- --run
  npm --prefix frontend run build
  node scripts/test_frontend_build_contract.mjs
  node --check public/auth.js
  node --check public/app.js
  python scripts/test_vercel_function_budget.py
  ```

  预期：全部退出码为 0；构建只新增 `public/assets/modern/` 内容，`git diff` 不显示其他 `public/` 文件被删除。

- [x] **步骤 9：浏览器兼容验收与服务器清理**

  使用 `browser-act` 验证登录、加载骨架、Dashboard 默认 Agent 页面和旧页面导航与迁移前一致。完成后关闭 8765 监听并复查端口。

**M1 执行记录（2026-08-27）：**

- RED 证据：构建契约先因 `frontend/package.json` 不存在失败；Vitest 先因 `src/legacy/bridge.ts` 不存在失败；运行时输入校验测试先以 2 项失败证明无效语言未被拒绝且快照未冻结。
- 依赖与兼容性：所有依赖均使用精确版本并写入 `frontend/package-lock.json`。TypeScript 7 与 `vue-tsc 3.3.11` 的 `typescript/lib/tsc` 导出路径不兼容，因此固定为支持 Node 22 的 `typescript 5.9.3`。
- GREEN 证据：`npm ci`、严格类型检查、Vitest 5/5、Vite 构建、构建契约、12 页面清单契约、`auth.js/app.js` 语法检查、Vercel Function budget 和 `git diff --check` 均通过。modern 产物为 `oi-modern.js` 10.56 kB（gzip 4.11 kB）与 `oi-modern.css` 0.17 kB（gzip 0.14 kB）。
- 浏览器证据：`browser-act` 当前没有已配置浏览器，未越过其确认门槛新建浏览器；改用应用内 Edge 浏览器完成真实页面验收。认证变量缺失状态可见；在仅作用于隔离测试进程的 `OI_AUTH_ENABLED=0` 下，旧 Dashboard 正常渲染。临时探针确认 `bootstrap=function`、`hasPage("offer-list-tracker")=false`，未提前接管业务页面；探针随后删除。
- 清理证据：测试使用 8766，结束后已关闭并确认无监听；复查时 8765 也无监听，本次未停止先前占用 8765 的外部进程。构建产物目录保持忽略，由本地/Vercel 构建生成。
- 已知非阻塞项：`npm ci` 报告 Vitest 依赖树中的 `glob@10.5.0` 弃用提示，但 `npm audit` 为 0 个漏洞；后续升级工具链时复查。

---

### 任务 3：M2——Offer Tracker 试点迁移

**文件：**

- 新增：`frontend/src/shared/contracts/offer.ts`
- 新增：`frontend/src/shared/format/money.ts`
- 新增：`frontend/src/shared/format/number.ts`
- 新增：`frontend/src/shared/format/percentage.ts`
- 新增：`frontend/src/features/offer-tracker/OfferTrackerPage.vue`
- 新增：`frontend/src/features/offer-tracker/offerTrackerModel.ts`
- 新增：`frontend/src/features/offer-tracker/useOfferTracker.ts`
- 新增：`frontend/src/features/offer-tracker/OfferTrackerTable.vue`
- 新增：`frontend/src/features/offer-tracker/OfferTrackerFilters.vue`
- 新增：`frontend/src/features/offer-tracker/offerTracker.css`
- 新增：`frontend/src/features/offer-tracker/offerTrackerModel.test.ts`
- 新增：`frontend/src/features/offer-tracker/OfferTrackerPage.test.ts`
- 修改：`frontend/src/entry.ts`
- 修改：`frontend/src/legacy/bridge.ts`
- 修改：`frontend/src/legacy/contracts.ts`
- 修改：`frontend/vitest.config.ts`
- 修改：`public/index.html`
- 修改：`public/app.js`
- 修改：`public/auth.js`
- 修改：`public/styles.css`
- 修改：`scripts/test_frontend_build_contract.mjs`
- 修改：`scripts/test_frontend_migration_inventory.mjs`
- 修改：`scripts/test_offer_list_tracker_frontend.mjs`
- 修改：`docs/frontend-migration-inventory.md`

**接口：**

- 消费：`LegacyBootstrapData.chatbotData.offers` 和现有 Offer Tracker 默认日期范围。
- 产出：`mountPage("offer-list-tracker", root)`；筛选、排序、选择、分页和导出事件使用显式 TypeScript 类型。
- 临时回调：下载继续通过 `window.OI_LEGACY_BRIDGE.download("offer-tracker", payload)` 复用旧 XLSX 生成器，直到导出模块独立迁移。

- [x] **步骤 1：从旧测试提取行为契约并建立失败的 model 测试**

  覆盖佣金字段优先级、Revenue、AOV 来源、BB policy、ASIN 去重、日期范围、筛选顺序、选择集合和导出字段；断言不得依赖旧函数名或源码字符串。

- [x] **步骤 2：运行 Vitest 确认 RED**

  运行：`npm --prefix frontend run test -- --run offerTrackerModel`

  预期：失败并提示 `offerTrackerModel` 导出不存在。

- [x] **步骤 3：实现纯 TypeScript model**

  只迁移 Offer Tracker 使用的业务函数；输入输出均为不可变数据。禁止从 model 访问 DOM、`window`、localStorage 或发起 fetch。

- [x] **步骤 4：运行 model 测试确认 GREEN**

  运行：`npm --prefix frontend run test -- --run offerTrackerModel`

  预期：全部通过，且旧 `scripts/test_offer_list_tracker_frontend.mjs` 继续通过。

- [x] **步骤 5：建立失败的组件交互测试**

  覆盖初始渲染、筛选、排序、全选/取消、分页、空状态、错误数据降级、键盘焦点和导出事件。测试使用用户可见角色/文本，不查询 Vue 内部实例。

- [x] **步骤 6：实现 Offer Tracker Vue 页面**

  复用现有可见文案和布局语义；根节点使用 `.oi-modern-page[data-page="offer-list-tracker"]` 限定样式作用域。表格在选择变化时只更新相关行，不重新构建整页数据。

- [x] **步骤 7：接入 dual 模式**

  `entry.ts` 令 `hasPage("offer-list-tracker")` 返回 `true`。`switchPage()` 在该页面先尝试 modern mount；若 modern API 不存在或 mount 抛错，则回退旧 `renderOfferListTrackerPage()` 并显示受控 console warning。

- [x] **步骤 8：更新旧回归测试与迁移清单**

  保留旧业务纯函数断言；将依赖旧 DOM 字符串的断言替换为 modern 组件测试。清单状态从 `legacy` 改为 `dual`，不能直接标记 `modern`。

- [x] **步骤 9：运行完整目标验证**

  运行：

  ```powershell
  npm --prefix frontend run typecheck
  npm --prefix frontend run test -- --run
  npm --prefix frontend run build
  node scripts/test_offer_list_tracker_frontend.mjs
  node --check public/app.js
  git diff --check
  ```

  预期：全部通过。

- [x] **步骤 10：浏览器验收并切换默认渲染**

  使用应用内浏览器对同一数据集检查现代页面的行数、筛选结果、排序、选择、导出按钮、桌面/移动布局和计算样式。核心路径验收通过后将清单状态保持为 `dual`；现代页面已接入保存视图基础流程、列设置和优先级规则，旧导出设置对话框及 legacy 页面仍保留为阶段回滚窗口。

---

**M2 执行记录（2026-08-27）：**

- RED 证据：model 测试先因 `offerTrackerModel` 尚不存在失败；组件测试先因页面 SFC 尚不存在失败；bridge 生命周期测试先以 M1 的空注册实现失败；dual 静态回归先因现代 root、bridge 和 `dual` 状态尚未接入失败。
- GREEN 证据：`npm ci`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run test -- --run`、`npm --prefix frontend run build`、`node scripts/test_frontend_build_contract.mjs`、`node scripts/test_frontend_migration_inventory.mjs`、`node scripts/test_offer_list_tracker_frontend.mjs`、`python scripts/test_offer_tracker_date_range.py`、`node --check public/auth.js`、`node --check public/app.js` 和 `git diff --check` 均通过；Vitest 为 3 个测试文件、24 项测试；modern 产物为 `oi-modern.js` 91.86 kB（gzip 33.84 kB）与 `oi-modern.css` 7.54 kB（gzip 1.84 kB）。
- 架构边界：`offerTrackerModel.ts` 不访问 DOM、`window`、localStorage 或 fetch；Vue composable 维护本地筛选/排序/选择/分页和评分规则状态；列设置与优先级规则面板由 Vue 管理并复用原版 localStorage 键；导出仍通过窄 `OI_LEGACY_BRIDGE` 复用旧 XLSX 生成器；`switchPage()` 支持 modern mount、离开卸载和受控 legacy fallback。旧导出设置对话框仍未迁移，清单状态因此保持 `dual`。
- 浏览器证据：browser-act 当前无已配置浏览器，因此使用应用内 Edge 浏览器在隔离的 `OI_AUTH_ENABLED=0`、8766 端口完成验收。真实缓存显示 6,286 条 Offer，默认每页 25 行；已验证搜索、Tier 多选、Revenue 排序、跨页选择保留、选择全部匹配项、现代 XLSX 下载、中文/英文文案和 390px 移动布局。桌面端横向溢出已定位为 Grid 最小内容宽度问题并修复；修复后文档 `scrollWidth` 与视口一致，表格仍由内部滚动容器承载。
- 浏览器边界：本地运行期间仍记录了既有的 `/api/tier_moves` 和 `/api/levanta/payments` 503 控制台错误；未发现 modern bundle 或 Offer Tracker 自身错误。认证关闭只用于隔离验收，不代表生产认证流程已重新验证。
- 清理与范围：M2 测试服务器使用 8766，收尾后停止并确认无监听；未提交、未推送、未创建 PR；未修改后端、数据库或其他页面业务逻辑，构建产物仍由 `public/assets/modern/` 的忽略目录生成。

**已迁移页面视觉基线对齐记录（2026-08-28）：**

- 基线来源：只读检查 `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main` 的 `public/styles.css`、`public/index.html`、`public/app.js` 对应渲染区间和已有页面截图；对比范围限定为当前已由 Vue 接管的 Offer Tracker 与 Payments，不改动旧项目。
- RED 证据：先在 `OfferTrackerPage.test.ts` 与 `PaymentsPage.test.ts` 增加旧页面结构断言；实现前分别因旧式页面层级、筛选卡、工具栏、表格容器和状态摘要结构缺失而失败，随后以 Vue 组件补齐。
- Offer Tracker 映射：保留旧页面的 `.offer-tracker-page` 外层回退边界，并在 Vue 内复原 `.offer-tracker-header`、`.offer-tracker-filter-card`、四列/三行筛选网格、KPI 卡、`.offer-tracker-table-panel`、视图标签、搜索/批量操作、10 列 Offer 表格、内部滚动容器和页脚；恢复旧项目的蓝色 token、字体层级、边框、圆角、间距及桌面最小表格宽度。
- Payments 映射：复原 `.payments-page` 的四行页面网格、`.payment-summary` 的 4×2 摘要/状态卡、`.payment-filters` 的四列筛选布局、`.payment-layout`、`.payment-table-panel`、`.table-toolbar`、`.payment-table-wrap` 和 1500px 表格最小宽度；保留 saved rows、空数据和受控同步错误状态。
- 桌面证据：在 1909×947、相同本地缓存和中文状态下，Offer Tracker 的旧/新关键几何均为 header 83px、筛选卡 342px、筛选网格 197px、KPI 75px、表格面板 546px、工具栏 59px、表格滚动区 427px；Payments 的关键几何均为页头 41px、摘要区 149px、筛选区 160px、结果区 519px、表格工具栏 61px、表格滚动区 456px。页面级 `scrollWidth` 均与视口一致，宽表格仍由内部滚动承载。
- 移动证据：在 390×844 下，两页均无页面级横向溢出；Offer Tracker 保留长筛选/表格内容的纵向流，Payments 摘要与筛选器改为单列，表格保留独立横向滚动。
- 错误状态证据：当前环境缺少 `LEVANTA_API_KEY`，`/api/levanta/payments` 返回既有 503；Payments 仍显示中文受控提示，但提示使用固定层，不改变桌面四行网格或移动页面宽度。未发现 modern bundle 或页面组件自身的未捕获错误。
- 当前结论：Offer Tracker 与 Payments 的 CSS/HTML 视觉基线对齐项已完成；列设置和优先级规则面板已在 Vue 中接入并完成事件验证，页面仍保留 legacy fallback，旧导出设置对话框等尚未迁移的能力不能据此宣称旧逻辑已全部删除。
- 验收工具边界：`browser-act` 当前无可配置浏览器/API key，本轮使用应用内 Edge/Playwright 完成同视口 DOM、计算样式、响应式和错误状态复核；因此不把本轮结果表述为 BrowserAct 验收。

**Offer Tracker 工具按钮事件补齐记录（2026-08-28）：**

- 根因：现代 `OfferTrackerTable.vue` 只渲染“列设置”和“优先级规则”按钮，没有对应面板、状态或事件；旧版 `public/app.js` 则通过 `toggleOfferTrackerPanel()`、列 change handler 和规则 save handler 完成这三条链路。
- RED → GREEN：新增组件回归测试，先验证面板缺失导致 2 项测试失败；实现后覆盖列面板开合、列隐藏、规则输入、保存关闭、优先级重算和 localStorage 持久化。
- Vue 实现：列设置使用 `offerListTrackerColumnsV1`，支持隐藏可选列并同步表头、数据单元格和空状态跨度；规则使用 `offerListTrackerRulesV1`，复原高优先级最低分 4–11、低 AOV 上限至少为 1 的边界，并接入 `useOfferTracker` 的评分计算。
- 浏览器证据：桌面端点击列设置后面板可见，取消 Revenue 后表格由 10 列变为 9 列；点击优先级规则会关闭列面板并打开规则面板，保存 `11 / 90` 后面板关闭、KPI 文案更新；390px 下两个面板均无页面级横向溢出，关闭按钮 25×25，规则按钮保持 88×33。
- 验证结果：8 个 Vitest 文件、50 项测试通过；typecheck、build、Offer/Payments 页面契约、build 契约、迁移清单契约和 `git diff --check` 通过；本地 8771 服务已停止并确认无 LISTENING 监听。

---

### 任务 4：M3——抽取共享 API、契约、格式化和双语能力

**文件：**

- 新增：`frontend/src/shared/api/client.ts`
- 新增：`frontend/src/shared/api/errors.ts`
- 新增：`frontend/src/shared/contracts/payment.ts`
- 新增：`frontend/src/shared/contracts/tier.ts`
- 新增：`frontend/src/shared/i18n/index.ts`
- 新增：`frontend/src/shared/i18n/messages.zh.ts`
- 新增：`frontend/src/shared/i18n/messages.en.ts`
- 新增：`frontend/src/shared/api/client.test.ts`
- 新增：`frontend/src/shared/i18n/index.test.ts`
- 修改：`frontend/src/shared/contracts/offer.ts`
- 修改：`frontend/src/features/offer-tracker/offerTrackerModel.ts`
- 修改：`frontend/src/features/offer-tracker/OfferTrackerPage.vue`
- 修改：`frontend/src/features/offer-tracker/OfferTrackerFilters.vue`
- 修改：`frontend/src/features/offer-tracker/OfferTrackerTable.vue`
- 修改：`frontend/src/legacy/contracts.ts`
- 修改：`frontend/src/entry.ts`
- 修改：`public/app.js`
- 修改：`public/chatbot_i18n.js`
- 修改：`scripts/test_zh_chatbot.mjs`
- 修改：`scripts/test_offer_list_tracker_frontend.mjs`
- 修改：`docs/frontend-migration-inventory.md`

**接口：**

- `apiRequest<T>(path, options): Promise<T>` 统一处理 JSON、非 2xx、超时和受控错误码，不隐藏后端错误状态。
- `setLanguage("zh" | "en")` 更新已迁移页面；legacy 语言切换通过 bridge 同步。
- 共享契约只定义已被两个以上页面复用的字段，不复制完整数据库响应。

- [x] **步骤 1：为 API 错误和语言同步建立失败测试**
- [x] **步骤 2：运行目标测试确认 RED**
- [x] **步骤 3：实现最小 API client、错误类型和 i18n store**
- [x] **步骤 4：让 Offer Tracker 改用共享模块，确认没有行为变化**
- [x] **步骤 5：删除 Offer Tracker 对同类 legacy helper 的调用**
- [x] **步骤 6：运行 TypeScript、Vitest、旧中英文回归和构建**

验证命令：

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node scripts/test_zh_chatbot.mjs
node scripts/test_offer_list_tracker_frontend.mjs
```

退出门槛：Offer Tracker 不再通过 bridge 调用格式化、语言或筛选函数；bridge 只保留导航与尚未迁移的 XLSX 下载。

**M3 执行记录（2026-08-27）：**

- RED 证据：共享 API 与 i18n 目标测试先因 `./client`、`./errors` 和 `./index` 不存在而失败；实现前未改动 Offer Tracker 生产代码。
- 共享模块：新增 `apiRequest<T>()`、`ApiError`、Tier/Payment 最小稳定契约、中文/英文成对消息目录和基于 Vue `ref` 的 i18n store。API client 统一处理 JSON、非 2xx、业务 `ok: false`、无效 JSON、网络错误和超时，并保留状态码与 `errorCode`。
- Offer Tracker 接入：`entry.ts` 使用 shared API client 加载日期范围；页面、筛选器、表格和 model 使用 shared i18n 与既有格式化模块；现代入口仍只通过 `OI_LEGACY_BRIDGE.download("offer-tracker", payload)` 复用 XLSX，未引入 legacy 筛选、排序或格式化 helper。
- bridge 收口：删除 `LegacyBridgeApi.requestRender` 及 `public/app.js` 对应暴露；`OI_LEGACY_BRIDGE` 当前只保留 `navigate` 和 `download`。`chatbot_i18n.js` 增加受控语言归一化，旧应用仍由 `state.language` 管理并通过 `OI_MODERN_APP.setLanguage()` 同步现代页面。
- 验证证据：`npm --prefix frontend run typecheck`、`npm --prefix frontend run test -- --run`、`npm --prefix frontend run build`、`node scripts/test_frontend_build_contract.mjs`、`node scripts/test_frontend_migration_inventory.mjs`、`node scripts/test_zh_chatbot.mjs`、`node scripts/test_offer_list_tracker_frontend.mjs`、`python scripts/test_offer_tracker_date_range.py`、`python scripts/test_vercel_function_budget.py`、`node --check public/app.js`、`node --check public/chatbot_i18n.js` 和 `git diff --check` 均退出码为 0；Vitest 为 5 个测试文件、32 项测试；modern 产物为 `oi-modern.js` 100.61 kB（gzip 35.73 kB）与 `oi-modern.css` 7.54 kB（gzip 1.84 kB）。
- 浏览器证据：在隔离的 `OI_AUTH_ENABLED=0`、8766 端口验证 modern root、Offer Tracker 默认数据渲染、日期范围提交和中文/英文语言同步。日期接口在当前本地数据库环境返回既有 503，页面显示受控英文/中文错误提示且无未捕获 console error；API client 的非 2xx 状态保留由 4 项单测覆盖。服务已停止并复查 8766 无监听。
- 交付边界：M3 未提交、未推送、未部署；Offer Tracker 的旧导出设置对话框仍保留在 dual fallback，现代保存视图、列设置和优先级规则已在后续对齐批次补齐。

---

### 任务 5：M4——迁移共享导航 Shell 与低风险数据页面

**迁移顺序：**

1. `payments`
2. `publishers`
3. `monthly-new-merchants`
4. `brand-media`
5. `revenue-flow`
6. `google-ads`
7. 共享 `AppShell`、移动导航、主题和页面标题

**文件：**

- 新增：`frontend/src/features/<feature>/` 下的页面、model、composable、组件、样式和测试
- 新增：`frontend/src/shell/AppShell.vue`
- 新增：`frontend/src/shell/navigation.ts`
- 新增：`frontend/src/shell/usePageState.ts`
- 修改：`frontend/src/entry.ts`
- 修改：`public/index.html`
- 修改：`public/app.js`
- 修改：`public/styles.css`
- 修改：对应 `scripts/test_*.mjs`
- 修改：`docs/frontend-migration-inventory.md`

**统一执行模板：**

- [ ] 为当前页面建立不依赖旧源码形状的 model/组件失败测试。
- [ ] 运行目标测试确认 RED，记录具体失败原因。
- [ ] 迁移纯数据转换和 API 调用，先让 model 测试变绿。
- [ ] 迁移页面结构、交互、空状态、加载状态、错误状态和焦点恢复。
- [ ] 通过 `hasPage(pageKey)` 开启 dual 模式，保留旧页面回退。
- [ ] 运行该页面旧 Node 回归、Vitest、typecheck、build 和 `git diff --check`。
- [ ] 使用 `browser-act` 验证桌面、移动端、键盘、API 请求和关键计算样式。
- [ ] 从只读旧项目 `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main` 读取 CSS、HTML、渲染结构和静态资源，建立旧选择器到 Vue 组件的视觉映射。
- [ ] 在相同数据、语言、视口和关键交互状态下采集旧页面与 Vue 页面证据，逐项对齐几何、设计 token、内容密度、交互状态和响应式布局。
- [ ] 将迁移清单从 `legacy` 改为 `dual`；功能测试和新旧视觉对齐均通过后，才改为 `modern`。
- [ ] 在下一个页面完成并验证后，删除上一个页面对应的旧渲染与事件代码。

**页面专项门槛：**

- Payments：状态计算、placeholder、零金额排除、月份/地区/Tier 筛选和 XLSX 一致。
- Publishers：布局编辑、Tier 数据、筛选和页面离开时退出编辑状态一致。
- Monthly New Merchants：抽屉、导入、提交、焦点恢复和 API 错误可见。
- Brand Media：趋势图、日期范围、请求取消、无权限/无数据状态可区分；Revenue Flow 的 Sankey 另按独立页面迁移。
- Revenue Flow：Canvas/SVG 生命周期、展开状态和页面离开清理一致。
- Google Ads：筛选、工作台请求、加载/错误状态和导出一致。
- Shell：活动导航、分组展开、移动端焦点陷阱、Escape、主题与当前页面标题一致。

退出门槛：上述页面均为 `modern`，`switchPage()` 只负责尚未迁移页面和 bridge 委托，不再直接操作这些页面的内部 DOM。

---

**M4 Payments 执行记录（2026-08-27）：**

- 计划与范围：根据 M4 低风险数据页面顺序，先独立迁移 Payments；未修改 `/api/levanta/payments`、认证、数据库或其他页面，Payments legacy markup、渲染和事件代码仍作为受控 fallback 保留。
- RED 证据：`paymentModel.test.ts`、`usePayments.test.ts`、`PaymentsPage.test.ts` 和 `scripts/test_payments_frontend.mjs` 均先在目标模块、组件或入口尚不存在时失败；月份筛选回归也先捕获了重复暴露 `reportMonthKey` 的问题。
- 实现边界：新增 PaymentRecord/筛选/排序/摘要契约、纯 model、`usePayments`、Payments modern 页面组件和 scoped 样式；live sync 失败不替换 saved rows；placeholder 生成后仍经过零金额过滤；导出通过 `OI_LEGACY_BRIDGE.download("payments", payload)` 复用现有 XLSX 生成器；首轮页面结构参考图的紧凑页头、4×2 摘要卡、两行筛选、品类副标题和面板内下载入口。
- 入口与回退：`entry.ts` 注册 `payments` factory；`switchPage()` 挂载前同步 `state.language`，成功 mount 后跳过 legacy Payments 内部渲染和自动同步，离开页面先卸载；modern bundle 不可用时恢复 `renderPaymentsPage()` 和原有静默同步。
- 验证证据：8 个 Vitest 文件、48 项测试通过；`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、Payments/build/inventory 契约、`node scripts/test_zh_chatbot.mjs`、`node --check public/auth.js`、`node --check public/app.js`、Python 编译检查和 `git diff --check` 通过；`python -m scripts.test_payment_placeholders` 已运行并返回 0，但当前环境缺少 `output/payment_records.json`，其集成部分按脚本逻辑跳过。
- 浏览器证据：browser-act 当前无已配置浏览器，因此使用应用内 Edge，在 `OI_AUTH_ENABLED=0`、8766 隔离服务验证 Payments modern root、legacy 父级隐藏边界、桌面/390px 移动布局、4×2 摘要卡、固定高度结果区和表格独立滚动、语言切换后再进入 Payments、状态/搜索筛选、同步失败 alert 和 saved rows 保留；页面级横向溢出为 false，桌面表格保留横向滚动。`/api/levanta/payments` 因缺少 `LEVANTA_API_KEY` 返回受控 503，未将其误判为成功同步；导出按钮可用，浏览器下载事件监听未捕获 Blob 下载，字段级导出由组件测试与 bridge/build 契约覆盖。
- 视觉基线状态：已依据 2.5 节流程完成旧项目 CSS/HTML/渲染结构盘点、同数据同视口几何对比、计算样式核对、移动响应式检查和受控错误状态检查；详细证据见上方“已迁移页面视觉基线对齐记录（2026-08-28）”。
- 当前状态：Payments 的功能验收与视觉基线对齐均已完成，仍保留 legacy fallback；该记录完成后 M4 已继续进入 Publishers。本轮使用的 8770/8771 本地服务在收尾时停止并复查端口。

**M4 Publishers 执行记录（2026-08-28）：**

- 计划与范围：新增 Publishers 的 Vue modern root、纯 model、`usePublishers` 和页面组件；保留原生 Publishers markup、渲染、数据加载和导出作为受控 fallback，未修改 `/api/ui/db/publishers` 的服务端口径。
- 实现边界：覆盖 Publisher/Tier 数据归一化、市场/网络/链接类型/商家/经理/日期筛选、排序、分页、列设置、Overview、Publisher Affinity、merchant portfolio、当前页/全部导出，以及布局编辑的拖拽、重置、取消、完成和卸载清理。选中 Publisher 后，顶部 KPI 和商家组合使用该媒体的 profile/portfolio 结果；零订单商家仍保留，AOV 在订单为 0 时显示 N/A。
- 验证证据：Publishers 的 model/composable/component Vitest、`scripts/test_publishers_frontend.mjs`、`scripts/test_publisher_manager_tier_frontend.mjs`、`scripts/test_publishers_portfolio.py`、聊天上下文回归、typecheck、build、迁移清单契约、Node/Python 检查和 `git diff --check` 均通过；当前合并分支全量 Vitest 为 14 个文件、75 项测试。
- 浏览器与视觉证据：在持久化 Sites 视觉 QA 站点的同数据、中文、同桌面视口下验证 `?view=modern`、`?view=target` 和 `?view=compare`；完成布局编辑交互检查，并对齐首屏几何、筛选工作区、KPI、Affinity 和 Overview 起始位置。截图入口支持 `&focus=1`，便于后续回归对比。
- 当前状态：Publishers 的功能验收与视觉基线对齐均已完成，默认使用 Vue modern root，仍保留 legacy fallback；变更已直接更新到 `FRONTEND-VUE-MIGRATION` 分支提交 `69d1968555680bd6ad51342a76953e81b3b88d59`，未创建 PR。发布清单未包含示例数据、fixture 或截图；M4 下一步是 Monthly New Merchants。

**M4 Brand Media 执行记录（2026-08-28）：**

- 计划与范围：本批次只迁移 Brand Media 趋势页面；`Publishers` 由同伴并行负责，`Revenue Flow` 的 Sankey 不纳入本批次；未修改 Brand Media 后端 SQL、API 字段、数据库权限、认证或全局 AppShell。
- 旧版基线：只读盘点旧项目 `public/index.html` 的 `#brandMediaPage`、`public/styles.css` 的 Brand Media 选择器与响应式规则，以及 `public/app.js` 的品牌目录、趋势请求、Manager/媒体锁定、点击图和展开生命周期；Vue 样式保留旧页面宽度、页头、筛选卡、KPI 空间、图表面板、点击图和表格的布局与 token。
- RED → GREEN：先运行缺失 `brandMediaModel`、`useBrandMedia` 和 `BrandMediaPage.vue` 时的目标测试，3 个套件因模块不存在而失败；随后新增 model、composable、Vue 页面/图表/表格组件及样式，目标套件和全量 Vitest 均通过。
- 实现边界：`entry.ts` 注册 `brand-media` factory，并通过 shared API client 请求 `/api/ui/db/publishers` 与 `/api/ui/db/brand-media-trend`；趋势请求携带 `merchantId`、`startDate`、`endDate`，由 `AbortController` 取消旧请求并用序列号阻止过期响应覆盖新状态；异常、无权限、无数据和未选择品牌分别呈现；挂载失败或 modern bundle 不可用时回退 `renderBrandMediaPage()`。
- 业务等价：订单为折线图主指标；缺失源日期形成断线，真实零订单保留为点；Revenue 继续进入 hover；无锁定媒体显示全部媒体和总订单线，锁定媒体后只显示当前视图；单个锁定媒体显示普通点击柱，多个锁定媒体显示累计点击柱；Manager 过滤不修改原始 payload。
- 浏览器与视觉证据：通过 BrowserAct 在相同 1904×985 视口、中文空状态下对比旧版 `C:\Users\yg\AppData\Local\Temp\brand-media-legacy-desktop.png` 与 Vue 版 `C:\Users\yg\AppData\Local\Temp\brand-media-modern-aligned.png`；页面、页头、筛选卡、空 KPI 占位、图表面板、图表布局和表格关键几何值一致（页面 `1589×1477.5625`，图表 `1485×798.78125`，内部布局 `1423×624`）。使用 BrowserAct 注入仅存在于浏览器会话的 fixture 后，验证品牌选择、Manager、订单/Revenue hover、缺失日期断线、真实零值、媒体锁定、单媒体/累计点击图、图表展开、Escape 焦点恢复；populated 证据为 `C:\Users\yg\AppData\Local\Temp\brand-media-modern-populated.png`。
- 真实请求边界：`/api/ui/db/publishers` 在本地返回 200；趋势接口在当前本地数据库权限/配置下返回 503，页面显示受控错误提示，没有把失败伪装成无数据；因此未宣称真实数据图表验收完成。BrowserAct 当前 CLI 没有 viewport emulation 选项，390px 真实视口验收仍是未完成门槛，旧版响应式 CSS 已保留并通过静态样式检查。
- 验证结果：本页原始执行批次的 `npm --prefix frontend run test -- --run` 为 11 个文件、61 项测试通过；合并 Publishers 后的最新分支全量结果为 14 个文件、75 项测试通过，并通过 `npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、Brand Media/Publishers 前端契约、迁移清单/build 契约、Payments 前端契约、`python scripts/test_brand_media_trend.py`、`node --check public/app.js`、`node --check public/auth.js` 和 `git diff --check`。
- 当前状态：Brand Media 已进入 `dual`，默认由 Vue modern root 渲染并保留 legacy fallback；桌面视觉和关键交互已验收，390px BrowserAct 真实视口与真实趋势数据 populated 验收待补。Brand Media 与 Publishers 的合并代码已直接更新到 `FRONTEND-VUE-MIGRATION` 分支，未创建 PR；浏览器会话 fixture 未写入仓库。

### 任务 6：M5——迁移 Targets、Category Report 与 Tier 管理

**迁移顺序：** `sheets` → `category` → `tier`

**文件：**

- 新增：`frontend/src/features/targets/`
- 新增：`frontend/src/features/category-report/`
- 新增：`frontend/src/features/tier-sheet/`
- 新增：`frontend/src/shared/export/`
- 修改：`frontend/src/shared/contracts/tier.ts`
- 修改：`frontend/src/entry.ts`
- 修改：`public/app.js`
- 修改：`public/styles.css`
- 修改：`api/tier_moves.py`（仅当现有契约测试证明前端迁移需要兼容修正）
- 修改：对应 Tier、Category、Target 和 XLSX 回归脚本
- 修改：`docs/frontend-migration-inventory.md`

**专项约束：**

- Tier 1–4 与 BLACK TIER 的名称、顺序和移动目标保持不变。
- 手动 Tier Move 的 localStorage、共享 API、管理员 token 和 webhook 降级行为保持不变。
- 绿色/黄色/红色视觉状态必须继续由现有显式字段和规则驱动，不能由组件样式自行推断。
- Category 主分类解析优先级保持 DB `sheetCategory` → `mainCategory` → Feishu → 其他来源 → `levantaCategory` → `Uncategorized`。
- XLSX 列、数值类型、百分比格式和 sheet 名必须通过现有导出测试逐项比较。

**执行步骤：**

- [ ] 为 Targets 的日期、目标、趋势和矩阵建立失败测试并迁移。
- [ ] 为 Category 的匹配、排序、饼图/趋势、选择联动建立失败测试并迁移。
- [ ] 为 Tier 的行转换、列面板、选择、Overlay、Move Dialog 和持久化建立失败测试并迁移。
- [ ] 抽取共享 XLSX 模块；用同一 fixture 比较新旧 workbook XML 和单元格类型。
- [ ] 逐页完成 dual → modern 门槛，并保留一个后续页面的回滚窗口。
- [ ] 运行所有 Tier/Category/Target/Python API 回归和浏览器验收。

退出门槛：三类页面均为 `modern`，Tier Move、导出、分类聚合和目标报表与旧实现字段级一致。

---

### 任务 7：M6——迁移 Chatbot 与 Agent

**前置条件：** M1–M5 全部退出门槛已通过；`docs/chatbot-feature-report.md` 已按当前代码重新核对；Agent 协议、工具注册表和 Trace 测试全部进入 CI。

**迁移顺序：**

1. 纯分析/搜索 model 与结果 View
2. Report Mode 路由与上下文
3. Chat Mode 流式渲染与记忆栏
4. Deep Window 生命周期
5. Agent 页面、时间线和停止行为
6. onboarding、help guide、反馈与问题日志

**文件：**

- 新增：`frontend/src/features/chatbot/`
- 新增：`frontend/src/features/agent/`
- 新增：`frontend/src/shared/stream/sse.ts`
- 新增：`frontend/src/shared/markdown/`
- 修改：`frontend/src/entry.ts`
- 修改：`public/chatbot_i18n.js`
- 修改：`public/chatbot_welcome.js`
- 修改：`public/onboarding_tour.js`
- 修改：`public/agent_memory_state.js`
- 修改：`public/app.js`
- 修改：Chatbot/Agent 全部 Node 回归脚本
- 修改：`docs/chatbot-feature-report.md`
- 修改：`docs/frontend-migration-inventory.md`

**不可改变的契约：**

- LLM 分类失败继续回退现有规则路径。
- 具体数据结论必须来自可验证数据源；没有来源时不能把模型文本当事实。
- Agent 工具调用名称、参数、计划证明、结果白名单和服务端校验保持不变。
- Trace 写入失败不得阻断回答；不得记录 prompt、完整工具 JSON、答案正文或异常堆栈。
- SSE 停止、超时、重试、usage 事件和 fallback 必须维持现有语义。
- 失败或停止的本轮用户消息不得进入正式历史；结构化记忆的隐私边界保持不变。
- Report/Chat Mode、Agent 独立页面和 Deep Window 的关系保持权威文档定义。

**执行步骤：**

- [ ] 将无 DOM 的搜索、分类后路由、分析和结果压缩函数迁移为 TypeScript model，逐组建立 RED/GREEN。
- [ ] 建立 SSE parser 测试，覆盖分块、UTF-8、usage、`[DONE]`、中止和非 2xx。
- [ ] 迁移 Report Mode，并对同一 fixture 比较统计卡、表格和导出上下文。
- [ ] 迁移 Chat Mode，验证 Markdown、流式滚动、记忆、反馈和停止行为。
- [ ] 迁移 Deep Window，验证最小化、恢复、图表控制克隆和页面切换清理。
- [ ] 迁移 Agent，验证 planning/tool/synthesis 时间线、工具批次、partial 和 Trace 元数据。
- [ ] 迁移 onboarding/help guide，保持中英文 copy、缓存版本和 active 状态。
- [ ] 运行全部 Chatbot/Agent Node/Python/Vitest 回归以及浏览器端到端验收。

退出门槛：Chatbot 与 Agent 均为 `modern`，`public/app.js` 不再执行问答、工具、分析或流式渲染逻辑，权威文档与实际文件索引一致。

---

### 任务 8：M7——CSS 收敛、legacy bridge 删除与静态入口简化

**文件：**

- 修改：`frontend/src/shared/styles/tokens.css`
- 修改：各 feature scoped CSS
- 修改：`public/index.html`
- 删除：确认无引用的 `public/app.js`
- 删除或缩减：确认无引用的 `public/styles.css`
- 删除或迁移：确认无引用的旧辅助 JS
- 删除：`frontend/src/legacy/bridge.ts`
- 删除：`frontend/src/legacy/contracts.ts`
- 修改：`public/auth.js`
- 修改：所有依赖旧源码字符串的测试
- 修改：`docs/frontend-migration-inventory.md`

**删除前证据：**

- `rg` 确认没有 HTML、JS、测试或文档仍加载/引用待删除文件。
- 所有页面清单状态为 `modern`，且没有 `dual` 或 `legacy`。
- modern bundle 加载失败时显示明确应用错误状态，不再静默回退已删除的旧应用。
- 认证失败仍能独立显示登录界面，不依赖 modern app 已成功启动。

**执行步骤：**

- [ ] 建立失败测试，断言入口不再加载 legacy bundle、bridge 全局不存在、页面 Shell 只保留根节点。
- [ ] 删除每个已证明无引用的旧文件或旧代码块；一次只删除一个逻辑域并运行回归。
- [ ] 把仍需保留的认证样式移入独立 `public/auth.css` 或 modern 认证入口，禁止留下整份 legacy CSS。
- [ ] 删除源码字符串测试，前提是对应行为已有 Vitest 或浏览器验收覆盖。
- [ ] 运行 `rg` 引用检查、全量 CI、Vite 构建和浏览器全流程。
- [ ] 更新清单状态为 `removed`，记录删除证据和替代测试。

退出门槛：应用运行时不存在 `OI_LEGACY_BRIDGE`、`OFFER_INTELLIGENCE_TEST_HOOKS` 和旧页面渲染器；构建、认证和全部业务页面只使用 modern entry。

---

### 任务 9：M8——部署切换、回滚演练与指标观察

**文件：**

- 新增：`docs/frontend-migration-runbook.md`
- 修改：`AGENTS.md`
- 修改：`README.md`（存在相关本地运行说明时）
- 修改：`vercel.json`
- 修改：`.github/workflows/ci.yml`
- 修改：本 Roadmap 的实施状态表

**运行手册必须包含：**

- 首次安装、开发、测试、构建、本地 Python 服务和关闭服务器的准确命令。
- Vercel install/build/output 配置和构建产物检查。
- modern bundle 404、JS 启动异常、API 401/403/5xx、SSE 中止和缓存版本错误的排查路径。
- 回滚到上一构建的步骤；不得把“重新打开 legacy app”作为最终阶段回滚方案。
- 不记录凭据、Cookie、Bearer token、完整 Agent 请求或答案正文的日志约束。

**执行步骤：**

- [ ] 在本地从全新 `npm ci` 开始完成 build 和 `python server.py` 验收。
- [ ] 验证 Vercel 预览构建使用 lockfile，输出目录只包含预期静态文件。
- [ ] 检查缓存头和入口版本，确认 HTML 不引用已删除 hash 或旧 query version。
- [ ] 执行一次构建级回滚演练，确认无需数据库变更即可恢复上一版本。
- [ ] 观察页面启动错误、API 非 2xx、SSE 失败、modern bundle 大小和关键页面交互耗时。
- [ ] 达到下方指标后，才将 Roadmap 状态标记为完成。

---

## 4. 验证矩阵

| 层级 | 必须验证 | 工具/命令 |
| --- | --- | --- |
| 语法与类型 | 旧 JS 语法、TS 严格类型 | `node --check`、`npm --prefix frontend run typecheck` |
| 单元 | model、composable、API、i18n、SSE | Vitest |
| 契约 | 启动、构建、页面清单、API 字段 | Node/Python 脚本 |
| 旧行为 | 尚未迁移页面与关键业务口径 | 现有 `scripts/test_*.mjs` 和 Python 回归 |
| 构建 | 输出目录、bundle、无 CDN 依赖 | `npm --prefix frontend run build` |
| 浏览器 | DOM、交互、焦点、响应式、真实请求 | `browser-act` |
| 双运行 | 本地 Python 与 Vercel 预览 | 本地服务 + 预览环境 |
| 视觉对齐 | 旧 CSS/HTML 基线、计算样式、几何、状态、截图和移动端布局 | 只读旧项目 + 浏览器探针 + 同视口截图对比 |
| 差异 | 只包含当前任务文件、无缓存误改 | `git diff --check`、`git status --short` |

每个阶段至少执行与该阶段相关的目标测试和 2.5 节视觉对齐流程；M7/M8 必须执行 CI 中的完整命令集合。静态测试通过不能替代浏览器和新旧视觉验证，登录门禁导致页面不可见时必须明确标记浏览器验收未完成。

---

## 5. 性能、质量与完成指标

### 5.1 架构指标

- M2 之后，所有新增业务页面只能进入 `frontend/src/features/`，不得继续扩展 `public/app.js`。
- 每个 feature 的 model、API、组件和样式边界清晰；单个新文件超过约 500 行时必须在评审中说明无法继续拆分的理由。
- modern 代码不得新增未声明的全局对象；临时 bridge 只能存在于 `frontend/src/legacy/`。
- 共享模块至少被两个 feature 使用；只服务一个页面的代码留在该 feature 内。

### 5.2 测试指标

- 所有已迁移页面至少有 model 测试和组件交互测试。
- 所有新增 API client 分支覆盖成功、非 2xx、无效 JSON、超时和中止。
- CI 运行仓库内所有仍被声明为有效的前端测试；被排除的脚本必须从仓库删除或在文档记录原因。
- 每个 legacy 源码字符串断言删除时，都能指向替代的行为测试。

### 5.3 用户体验指标

- 登录、首屏骨架、默认 Agent 页面和主导航不出现白屏或双重挂载。
- 中英文切换不会混合语言，也不会丢失当前页面核心状态。
- 键盘焦点、Escape、抽屉/弹窗焦点恢复和 `prefers-reduced-motion` 行为保持可用。
- 加载、空数据、错误和权限不足使用不同状态，不把数据库或认证错误伪装成“暂无数据”。

### 5.4 构建与运行指标

- modern 首屏 bundle 必须记录原始和 gzip 大小；超过 250 KB gzip 时必须拆分入口或给出评审理由。
- 构建只能修改 `public/assets/modern/`，不得删除缓存 JSON、旧静态文件或 Python Functions 需要的资源。
- 本地和 Vercel 使用同一 lockfile、同一 build script、同一输出路径。
- 完成阶段不依赖开发服务器；`python server.py` 必须能够直接服务已经构建的生产资产。

---

## 6. 风险与回滚策略

| 风险 | 早期信号 | 控制措施 | 回滚单位 |
| --- | --- | --- | --- |
| 新旧页面同时绑定事件 | 一次点击触发两次请求或下载 | mount 前卸载、页面唯一 root、组件测试计数 | 单页面切回 legacy |
| 启动顺序改变 | 数据为空、Agent 功能开关错误 | 保留 auth 数据预载，bootstrap 幂等 | modern bundle 禁用 |
| API 字段漂移 | 页面显示 0 或空字符串 | TypeScript 契约 + runtime guard + fixture | 单 feature 版本 |
| CSS 污染 | 旧页面样式改变 | `.oi-modern-page` 根作用域、scoped CSS | 单 feature CSS |
| 测试虚假安全 | 字符串测试绿但浏览器失败 | 每阶段 browser-act 验收 | 不推进状态门槛 |
| bundle 过大 | 首屏加载变慢 | 构建大小记录、后期按页面拆包 | 上一构建产物 |
| Chatbot/Agent 语义漂移 | 数值或工具链与旧版不同 | 最后迁移、权威文档、同 fixture 对比 | Chatbot/Agent 单独回滚 |
| Vercel 打包异常 | 静态资源 404 或函数超预算 | 预览构建、function budget 测试 | 上一部署构建 |

M1–M6 的回滚单位必须是单页面或单逻辑域，不能要求回滚数据库。M7 删除 legacy 前必须证明所有页面已越过回滚窗口；M8 的回滚依赖上一份可部署构建，而不是恢复已经删除的旧源码。

---

## 7. 实施状态表

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| M0 ADR 与盘点 | 已验证 | ADR、12 页面迁移清单和 `test_frontend_migration_inventory.mjs` 已落地并进入 CI；目标检查通过 |
| M1 双运行骨架 | 已验证 | Vue/TS/Vite、只读 Legacy Bridge、认证启动链、Vercel/CI 构建均已接入；目标测试和真实浏览器双运行验收通过 |
| M2 Offer Tracker 试点 | 已验证 | 核心筛选/排序/选择/分页、列设置、优先级规则和导出入口已由 Vue 接管；legacy fallback、构建契约、旧回归和应用内浏览器验收通过；旧导出设置对话框仍保留在 legacy |
| M3 共享模块 | 已验证 | shared API/error、Tier/Payment 契约、i18n store 已接入 Offer Tracker；bridge 已收窄为导航与下载；Vitest、类型检查、构建和旧回归通过；页面仍保持 dual |
| M4 Shell 与低风险页面 | 进行中 | Payments、Publishers 与 Brand Media 已由 Vue modern root 接管并完成已验证范围内的旧项目 CSS/HTML 视觉基线对齐；Brand Media 的 390px BrowserAct 真实视口仍待补验；Monthly New Merchants、Revenue Flow、Google Ads 与 Shell 尚未完成 |
| M5 Targets/Category/Tier | 未开始 | 当前仍由 legacy 路径渲染 |
| M6 Chatbot/Agent | 未开始 | 当前仍由原生 JS 执行 |
| M7 legacy 清理 | 未开始 | `public/app.js`、`styles.css`、bridge 尚未处理 |
| M8 部署切换 | 未开始 | Vercel 仍无前端 build command |

状态只允许使用 `未开始`、`进行中`、`已验证`、`受阻`。只有完成该阶段全部测试、差异检查和浏览器门槛后才能标记 `已验证`；本地补丁、静态测试或文档计划不能等同于已完成迁移。

---

## 8. Roadmap 自检

- 需求覆盖：包含框架选型、构建、本地/Vercel 双运行、页面迁移、测试、浏览器验收、CSS、Chatbot/Agent、回滚和运维文档。
- 视觉覆盖：已明确以 `D:\Code\offer-intelligence-main-worktrees\offer-intelligence-main` 为只读视觉基线，规定 CSS/HTML/渲染结构盘点、同数据同视口截图、计算样式对比、交互状态检查和放行条件；Offer Tracker、Payments 与 Brand Media 已按该流程完成已验证范围内的对齐并记录差异，Brand Media 的 390px BrowserAct 真实视口仍待补验，后续页面必须复用同一流程。
- 范围边界：Roadmap 初始创建阶段只产出计划；当前 M0–M3 已按各自执行计划完成实现和测试，M4 Payments、Publishers 已完成本批次验收，Brand Media 已完成桌面与关键交互验收但仍保留 `dual`，M4 其余页面仍需分批执行，后续阶段仍需单独授权。
- 迁移顺序：先护栏和试点，再共享模块和普通页面，最后 Tier 与 Chatbot/Agent，避免先触碰最高风险区域。
- 类型一致：`ModernPageName`、`LegacyBootstrapData`、`ModernAppApi`、`LegacyBridgeApi` 是后续阶段唯一允许的临时跨边界名称。
- 占位符检查：本文没有依赖未定义函数或未指定文件的执行步骤；框架和首个试点已明确，依赖版本由 `--save-exact` 和 lockfile 在实施当日固定。
- 删除安全：每次删除都要求引用扫描、替代测试和一个后续阶段的回滚窗口。

Roadmap 获确认后，从 M0 开始执行；当前 M0–M3 已完成，M4 Payments 与 Publishers 已完成，Brand Media 已进入 dual 并完成桌面视觉/交互对齐，M4 仍需继续完成 Monthly New Merchants、Revenue Flow、Google Ads 与 Shell，并补齐 Brand Media 及其他页面的移动端门槛。每进入一个新阶段，先根据当时仓库状态生成该阶段的细化实施计划，再按 TDD 小步完成；不得跳过阶段退出门槛。
