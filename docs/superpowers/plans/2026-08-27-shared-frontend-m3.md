# M3 共享前端模块实施计划

> 日期：2026-08-27
> 分支：`codex/frontend-vue-migration`
> 目标：在不改变 Offer Tracker 现有交互和后端响应语义的前提下，抽取可复用的 API 请求、错误、双语和最小跨页面契约，并收窄旧桥接接口。

## 背景与边界

M2 已让 Offer Tracker 的核心筛选、排序、选择、分页和导出入口由 Vue 接管，但页面仍处于 dual 状态。M3 只处理共享基础能力和现代页面的依赖边界，不迁移 Payments、Tier Sheet 或其他业务页面，不复制完整数据库响应，也不改动后端接口。

本阶段的约束如下：

- API client 默认保留 `same-origin` 凭据和 `no-store` 缓存策略；非 2xx、业务 `ok: false`、无效 JSON、网络错误和超时都通过受控 `ApiError` 暴露，保留 HTTP 状态码和后端 `errorCode`。
- i18n 以 `zh` 为默认语言，现代页面通过响应式 store 接收语言更新；旧应用仍以 `state.language` 为权威，并通过 `OI_MODERN_APP.setLanguage()` 同步现代页面。
- 共享契约只放跨页面可复用的稳定身份、状态和摘要字段；页面专属完整响应仍留在各自 feature 或 legacy 边界。
- `OI_LEGACY_BRIDGE` 在 M3 结束后只保留 `navigate` 和 `download`；现代页面不再通过它调用重渲染、筛选、格式化或语言 helper。
- M3 不提交、不推送、不创建 PR；完成验证后保留本地未提交变更，等待明确的 Git 交付授权。

## 目标文件与接口

新增：

- `frontend/src/shared/api/errors.ts`
- `frontend/src/shared/api/client.ts`
- `frontend/src/shared/api/client.test.ts`
- `frontend/src/shared/contracts/payment.ts`
- `frontend/src/shared/contracts/tier.ts`
- `frontend/src/shared/i18n/index.ts`
- `frontend/src/shared/i18n/messages.zh.ts`
- `frontend/src/shared/i18n/messages.en.ts`
- `frontend/src/shared/i18n/index.test.ts`

修改：

- `frontend/src/shared/contracts/offer.ts`
- `frontend/src/features/offer-tracker/offerTrackerModel.ts`
- `frontend/src/features/offer-tracker/OfferTrackerPage.vue`
- `frontend/src/features/offer-tracker/OfferTrackerFilters.vue`
- `frontend/src/features/offer-tracker/OfferTrackerTable.vue`
- `frontend/src/legacy/contracts.ts`
- `frontend/src/entry.ts`
- `public/app.js`
- `public/chatbot_i18n.js`
- `scripts/test_zh_chatbot.mjs`
- `scripts/test_offer_list_tracker_frontend.mjs`
- `docs/frontend-migration-inventory.md`
- `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md`

核心接口设计：

```ts
export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiRequest<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;
}

export type UiLanguage = "zh" | "en";

export function normalizeLanguage(value: unknown): UiLanguage;
export function translateMessage(
  language: UiLanguage,
  key: string,
  fallback?: string,
  values?: Readonly<Record<string, string | number>>,
): string;

export interface I18nStore {
  readonly language: Readonly<Ref<UiLanguage>>;
  setLanguage(language: UiLanguage): void;
  t(key: string, fallback?: string, values?: Readonly<Record<string, string | number>>): string;
}

export function createI18nStore(initialLanguage?: UiLanguage): I18nStore;
```

## 执行任务

### 1. 建立 API 与语言同步的 RED 测试

- 新建 `frontend/src/shared/api/client.test.ts`，覆盖 JSON 成功响应、非 2xx 状态保留、`ok: false` 的受控 `errorCode`、无效 JSON、超时和请求默认选项。
- 新建 `frontend/src/shared/i18n/index.test.ts`，覆盖默认中文、语言切换后的响应式值、占位符替换、未知 key 的 fallback 和非法语言归一化。
- 在测试中使用 Vitest stub/fake timer，不启动本地服务器，不触碰真实 API 或认证数据。
- 先运行：

  ```powershell
  npm --prefix frontend run test -- --run src/shared/api/client.test.ts src/shared/i18n/index.test.ts
  ```

  预期结果是因共享模块尚不存在而失败，记录 RED 输出后再写生产代码。

### 2. 实现 API 错误和请求客户端

- 在 `errors.ts` 中实现 `ApiError` 及错误 payload 的状态、受控代码和用户可读消息提取。
- 在 `client.ts` 中实现 JSON 解析、默认 `Accept`、`credentials`、`cache`、超时 AbortController、调用方 signal 传递和清理逻辑。
- 非 2xx 和业务 `ok: false` 都抛出 `ApiError`；不得把后端状态转换成成功响应，也不得吞掉 `errorCode`。
- 只在共享 client 层处理传输错误；Offer Tracker 对缺少 `offers` 的响应仍执行页面专属结构校验。
- 重跑 API 目标测试并确认 GREEN。

### 3. 实现共享契约与 i18n store

- 在 `tier.ts` 中定义稳定的 Tier 名称联合、运行时守卫和只读顺序常量。
- 在 `payment.ts` 中定义付款状态联合、付款记录跨页面身份和摘要字段，并引用共享 `TierName`；不定义完整付款数据库行。
- 在 `shared/contracts/offer.ts` 中从共享 i18n 重新导出 `UiLanguage`，保持现有 feature import 兼容。
- 在 `messages.zh.ts` 与 `messages.en.ts` 中成对定义 `common`、Offer Tracker 筛选、表格、指标和状态文案；英文缺失 key 由类型检查阻止。
- 在 `i18n/index.ts` 中实现语言归一化、纯翻译函数和基于 Vue `ref` 的 store；store 只暴露 `language`、`setLanguage`、`t`。
- 重跑 i18n 目标测试和 TypeScript 检查。

### 4. 让 Offer Tracker 使用共享模块

- `frontend/src/entry.ts` 使用 `apiRequest<...>()` 加载日期范围数据，保留 `offers` 数组校验和现有过滤逻辑；移除入口内的直接 `fetch` 错误处理。
- entry 为每次 modern mount 创建 i18n store，并在 controller 的 `setLanguage()` 中调用 store；Vue 页面继续接收稳定的 `UiLanguage` 语义。
- Offer Tracker 页面、筛选器、表格和 model 的双语文案统一从 `shared/i18n` 读取，保留 M2 已验证的中文/英文可见文案和 aria 文案。
- Offer Tracker 继续通过 `bridge.download("offer-tracker", payload)` 复用旧 XLSX 生成器；不新增对 legacy 筛选、排序、格式化或 DOM helper 的依赖。
- 使用现有页面测试作为行为回归，确认筛选、排序、选择、分页、日期加载、导出入口和空状态没有变化。

### 5. 收窄 legacy 边界并补回归断言

- 从 `LegacyBridgeApi` 和 `public/app.js` 删除 `requestRender`，只保留导航和 XLSX 下载；同步更新受影响的静态契约测试和 M2 计划中的历史描述。
- 在 `public/chatbot_i18n.js` 暴露语言归一化 helper；`public/app.js` 的 chatbot 语言决策调用该 helper，同时继续由 `state.language` 和 `rerenderForLanguage()` 管理页面状态。
- 扩展 `scripts/test_zh_chatbot.mjs`，断言非法语言回退中文且中文输入仍强制中文响应。
- 扩展 `scripts/test_offer_list_tracker_frontend.mjs`，断言 bridge 不再暴露 `requestRender`，仍保留 navigation/download 合同。
- 更新 `docs/frontend-migration-inventory.md` 的共享依赖、Offer Tracker 说明和测试列表，明确 API/i18n 已抽取但页面仍为 dual。

### 6. 完整验证与文档收口

按以下顺序执行并记录真实输出：

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node scripts/test_zh_chatbot.mjs
node scripts/test_offer_list_tracker_frontend.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_frontend_migration_inventory.mjs
node --check public/app.js
node --check public/chatbot_i18n.js
git diff --check
```

如共享 client 的 runtime 行为需要确认，使用隔离端口运行本地服务并在完成后关闭，记录现代 Offer Tracker 页面加载、日期应用和语言切换结果；浏览器证据与源码测试分开描述。

最后在 RoadMap 中：

- 将任务 4 的六个步骤标记为完成。
- 将阶段状态表中的 M3 标记为“已验证”。
- 添加 M3 执行记录、测试结果、bridge 收口和未迁移页面边界。
- 不把“已验证”写成已提交、已推送或已部署。

## 执行记录（2026-08-27）

- [x] RED：共享 API 测试因 `./client`、`./errors` 不存在失败；共享 i18n 测试因 `./index` 不存在失败。
- [x] GREEN：完成 `ApiError`、`apiRequest<T>()`、Tier/Payment 最小契约、双语消息目录和响应式 i18n store；Offer Tracker 已切换到 shared API/i18n，bridge 已删除 `requestRender`。
- [x] 单测：`npm --prefix frontend run test -- --run` 通过，5 个测试文件、32 项测试；其中 shared API/i18n 目标测试为 2 个文件、8 项。
- [x] 构建与静态回归：TypeScript、Vite build、构建契约、迁移清单、中文 chatbot、Offer Tracker、日期范围、Vercel function budget、两个 JavaScript 语法检查和 `git diff --check` 全部通过；产物为 `oi-modern.js` 100.61 kB（gzip 35.73 kB）与 `oi-modern.css` 7.54 kB（gzip 1.84 kB）。
- [x] 浏览器：隔离服务 `OI_AUTH_ENABLED=0`、8766 端口验证 modern root、Offer Tracker 加载、日期提交后的受控 503 错误和中英文同步；服务结束后确认 8766 无监听。
- [x] 交付状态：工作树保留 M3 未提交变更；未推送、未创建 PR、未部署。后续 M4 仍需单独执行计划和授权。

## 完成判定

- API/i18n RED 测试先失败，生产实现后目标测试和完整验证全部通过。
- Offer Tracker 不再直接使用 legacy 格式化、语言或筛选 helper；现代页面只通过 shared modules 和下载 bridge 工作。
- `OI_LEGACY_BRIDGE` 源码只含 `navigate`、`download` 两项能力。
- M2 已验证的 Offer Tracker 行为没有回归；旧 chatbot 中文回归和现有构建契约通过。
- 文档准确区分 dual、source-tested、browser-verified、committed、pushed 和 deployed 状态。
