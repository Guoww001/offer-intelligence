# M4 Payments 页面迁移实施计划

> 对执行代理：必须使用 `executing-plans` 或 `subagent-driven-development` 按任务执行；每个步骤使用复选框跟踪，并在 review checkpoint 停止。

**目标：** 将 Payments 页面迁移到 Vue 3，保持现有支付状态、筛选、排序、placeholder、零金额排除、双语文案和 XLSX 导出契约，同时保留 legacy fallback。

**架构：** 使用 `shared/contracts/payment.ts` 定义跨页面稳定的支付记录、筛选和摘要契约；使用纯函数 `paymentModel.ts` 处理规范化、状态派生、placeholder、筛选、排序和摘要；使用 `usePayments` 管理 API 加载、同步错误和页面状态。Vue 页面挂载到 `#paymentsModernRoot`，`public/app.js` 只负责页面切换、legacy fallback 和窄导出 bridge，不把旧 DOM helper 注入 modern 页面。

**技术栈：** Vue 3.5、TypeScript strict、Vite IIFE、Vitest、Vue Test Utils、现有 `/api/levanta/payments` 和现有 XLSX 生成器。

## 全局约束

- 不修改 `/api/levanta/payments` 的请求路径、认证方式或后端响应语义。
- `revenueMade === 0` 且 `commissionMade === 0` 的记录不能进入 Payments 可见表格或导出；placeholder 只用于生成和状态覆盖测试，最终必须被可见记录过滤掉。
- 支付状态保持 `Paid`、`Pending`、`Unpaid`、`Overdue`、`Partial`、`Unknown`；`Overdue` 必须由应付日期已过且仍有剩余金额派生。
- `Payment Made` 只有已付款记录显示日期，其余显示 `-`；区域和币种格式保持 US/UK/EUR 的现有符号规则。
- 中英文文案必须通过 shared i18n 读取；语言只能是 `zh` 或 `en`，legacy 的 `state.language` 仍是权威输入。
- 本批次只进入 `dual` 或 `modern` 状态，不删除 Payments legacy 渲染和事件代码；下一个页面完成并通过回滚窗口后才允许删除上一页面旧实现。
- modern 页面只从 `LegacyBootstrapData` 快照和 shared API client 取数据，不直接读取任意全局数据对象。
- 本轮不提交、不推送、不创建 PR；除非用户另行授权，保留本地变更供 review。

## 文件职责

- 修改 `frontend/src/shared/contracts/payment.ts`：补足 PaymentRecord、PaymentStatus、筛选、排序、摘要和导出 payload 的稳定字段。
- 新增 `frontend/src/features/payments/paymentModel.ts`：纯数据函数，不依赖 DOM、Vue 或 `public/app.js`。
- 新增 `frontend/src/features/payments/paymentModel.test.ts`：覆盖状态、placeholder、零金额排除、筛选、排序、币种和摘要。
- 新增 `frontend/src/features/payments/usePayments.ts`：管理 initial records、live sync、请求序列、错误保留旧数据、筛选和排序。
- 新增 `frontend/src/features/payments/usePayments.test.ts`：覆盖 live 成功、非 2xx/无效 payload、错误时保留缓存和筛选状态。
- 新增 `frontend/src/features/payments/PaymentsFilters.vue`、`PaymentsSummary.vue`、`PaymentsTable.vue`、`PaymentsPage.vue` 及对应 `payments.css`：只渲染 Payments modern root。
- 新增 `frontend/src/features/payments/PaymentsPage.test.ts`：覆盖中英文渲染、筛选、排序、同步错误、空状态、键盘焦点和下载 payload。
- 修改 `frontend/src/entry.ts`：注册 `payments` factory，读取快照中的 paymentRecords，调用 shared API client，并通过 bridge 请求导出。
- 修改 `public/index.html`：增加 `#paymentsModernRoot`，更新 modern CSS cache busting query。
- 修改 `public/styles.css`：增加 Payments modern/legacy root 显隐边界，不改变 legacy 页面原有样式。
- 修改 `public/app.js`：为 Payments 增加 mount/unmount dual 路径和 `payments` 下载 bridge；挂载前同步 `state.language`，modern 成功时不再调用 legacy Payments 内部渲染。
- 修改 `public/auth.js`：更新 modern bundle cache busting query。
- 新增 `scripts/test_payments_frontend.mjs`：验证 Payments root、bridge、切页和缓存版本契约。
- 修改 `scripts/test_frontend_build_contract.mjs`、`scripts/test_frontend_migration_inventory.mjs`：验证 Payments 已注册并进入清单状态。
- 修改 `docs/frontend-migration-inventory.md` 和本 RoadMap：记录 Payments 的 dual/modern 证据、fallback 边界和测试缺口。

---

### 任务 1：建立 Payment 契约和纯 model

**接口：**

- `normalizePaymentRecord(raw, options)` 返回规范化 `PaymentRecord | null`。
- `withPendingPaymentPlaceholders(records, activeMonths)` 返回包含生成 placeholder 的记录集合。
- `visiblePaymentRecords(records)` 只返回有 Revenue 或 Commission 的记录。
- `filterPaymentRecords(records, filters)` 返回稳定筛选结果。
- `sortPaymentRecords(records, sort)` 返回不修改输入数组的稳定排序结果。
- `buildPaymentSummary(records)` 返回页面 KPI 和状态数量。

- [x] **步骤 1：先写失败测试。** 在 `paymentModel.test.ts` 中加入确定性 fixture 和以下行为断言：

```ts
const baseRecord = {
  merchantId: "m-1",
  merchantName: "Acme",
  network: "Levanta",
  region: "US",
  tier: "Tier 2",
  reportMonth: "March",
  reportYear: 2026,
  reportMonthKey: "2026-03",
  revenueMade: 100,
  commissionMade: 20,
  expectedPaymentAmount: 20,
  paidAmount: 0,
  remainingAmount: 20,
  paymentCycle: 60,
  rawStatus: "pending"
};

it("将到期且仍有余额的记录派生为 Overdue", () => {
  const result = normalizePaymentRecord(baseRecord, { today: "2026-06-10" });
  expect(result?.paymentStatus).toBe("Overdue");
  expect(result?.expectedPaymentDate).toBe("2026-05-01");
});

it("生成 May/June placeholder 但从可见记录中排除零金额行", () => {
  const normalized = normalizePaymentRecord(baseRecord, { today: "2026-08-27" });
  const withPlaceholders = withPendingPaymentPlaceholders([normalized!], ["May", "June"]);
  expect(withPlaceholders.some((row) => row.isPlaceholder && row.reportMonth === "May")).toBe(true);
  expect(visiblePaymentRecords(withPlaceholders).every(
    (row) => row.revenueMade > 0 || row.commissionMade > 0
  )).toBe(true);
});

it("按月份、状态和商户搜索过滤，并按状态优先级稳定排序", () => {
  const rows = [
    normalizePaymentRecord(baseRecord, { today: "2026-06-10" })!,
    normalizePaymentRecord({ ...baseRecord, merchantId: "m-2", merchantName: "Beta", paymentStatus: "Paid", paidAmount: 20, remainingAmount: 0 }, { today: "2026-06-10" })!
  ];
  expect(filterPaymentRecords(rows, { month: "March", network: "all", region: "all", tier: "all", status: "Overdue", search: "acme" })).toHaveLength(1);
  expect(sortPaymentRecords(rows, { key: "", direction: "asc" })[0].paymentStatus).toBe("Overdue");
});
```

- [x] **步骤 2：运行目标测试确认 RED。**

运行：`npm --prefix frontend run test -- --run src/features/payments/paymentModel.test.ts`

预期：失败，原因是 `frontend/src/features/payments/paymentModel.ts` 尚不存在或导出函数尚未实现；不能接受测试文件语法错误作为 RED 证据。

- [x] **步骤 3：写最小 model 实现。** 在 `paymentModel.ts` 中只实现上述接口：用显式字段 alias 读取数字和日期；用 `reportMonthKey` 计算应付日期；用 `today` 参数替代系统时钟；以 `paymentStatus`、剩余金额和应付日期派生状态；按 `isPlaceholder` 保留生成信息，再由 `visiblePaymentRecords` 排除零金额记录。

```ts
export function visiblePaymentRecords(records: readonly PaymentRecord[]): readonly PaymentRecord[] {
  return records.filter((record) => record.revenueMade > 0 || record.commissionMade > 0);
}

export function sortPaymentRecords(
  records: readonly PaymentRecord[],
  sort: PaymentSort
): readonly PaymentRecord[] {
  const fallback = (a: PaymentRecord, b: PaymentRecord) =>
    statusRank(a.paymentStatus) - statusRank(b.paymentStatus)
    || b.remainingAmount - a.remainingAmount
    || b.reportMonthKey.localeCompare(a.reportMonthKey)
    || a.merchantName.localeCompare(b.merchantName);
  if (!sort.key) return [...records].sort(fallback);
  const direction = sort.direction === "desc" ? -1 : 1;
  return [...records].sort((a, b) => direction * comparePaymentField(a, b, sort.key) || fallback(a, b));
}
```

- [x] **步骤 4：运行目标测试确认 GREEN，并跑现有 payment Python 回归。**

运行：

```text
npm --prefix frontend run test -- --run src/features/payments/paymentModel.test.ts
python scripts/test_payment_placeholders.py
```

预期：新增 model 测试和既有 placeholder 回归均通过。

### 任务 2：建立 `usePayments` 状态边界

**接口：** `usePayments({ records, loadLive, offers, sheetRows, today })` 返回 `rows`、`filteredRows`、`filters`、`sort`、`summary`、`filterOptions`、`loading`、`error`、`source`、`checkedAt`、`setFilter`、`setSearch`、`setSort`、`sync`。

- [x] **步骤 1：先写失败测试。** 在 `usePayments.test.ts` 中用真实 `usePayments` 和确定性 loader 验证：live payload 成功替换 rows；loader 抛错时仍保留 saved rows、`loading` 归零并暴露错误；第二次筛选不会清空已有数据。

```ts
it("live sync 失败时保留 saved rows 并暴露受控错误", async () => {
  const payments = usePayments({
    records: [baseRecord],
    loadLive: async () => { throw new Error("503"); },
    today: "2026-08-27"
  });

  await payments.sync();

  expect(payments.rows.value).toHaveLength(1);
  expect(payments.source.value).toBe("saved");
  expect(payments.loading.value).toBe(false);
  expect(payments.error.value).toBe("payments.syncError");
});
```

- [x] **步骤 2：运行目标测试确认 RED。**

运行：`npm --prefix frontend run test -- --run src/features/payments/usePayments.test.ts`

预期：失败，原因是 composable 或 `sync` 状态边界尚未实现。

- [x] **步骤 3：写最小 composable 实现。** 用 request sequence 防止旧请求覆盖新状态；成功时规范化并过滤 live records、更新 `source=live` 和 `checkedAt`；失败时不替换 `rows`，只写入稳定错误 key；`setFilter` 和 `setSort` 只更新响应式状态。

- [x] **步骤 4：运行 composable 测试和全部 Vitest。**

运行：

```text
npm --prefix frontend run test -- --run src/features/payments/usePayments.test.ts
npm --prefix frontend run test -- --run
```

预期：新增测试通过，原有 32 项测试无回归。

### 任务 3：实现 Payments Vue 组件和双语交互

**组件契约：** `PaymentsPage` 接收 `records`、`language`、`loadLive?` 和 `download?`；筛选器更新 `PaymentFilters`，表格排序更新 `PaymentSort`，下载回调接收当前可见 `PaymentRecord[]`。

- [x] **步骤 1：先写页面失败测试。** 在 `PaymentsPage.test.ts` 中覆盖 `data-page="payments"`、中文/英文 label、筛选结果、状态 badge、无数据状态、同步错误 alert、同步按钮键盘焦点和导出 rows。

```ts
it("以中文渲染筛选器、状态和记录，并通过下载回调传出当前 rows", async () => {
  const downloads: PaymentRecord[][] = [];
  const wrapper = mountPayments({ download: (rows) => downloads.push([...rows]) });

  expect(wrapper.find('.oi-modern-page[data-page="payments"]').exists()).toBe(true);
  expect(wrapper.get('select[aria-label="月份"]').exists()).toBe(true);
  expect(wrapper.text()).toContain("已付款");
  await wrapper.get('button[aria-label="下载付款记录"]').trigger("click");
  expect(downloads[0]).toHaveLength(1);
});
```

- [x] **步骤 2：运行页面测试确认 RED。**

运行：`npm --prefix frontend run test -- --run src/features/payments/PaymentsPage.test.ts`

预期：失败，原因是 Payments 组件和 `payments` i18n key 尚未存在。

- [x] **步骤 3：实现最小组件树和 scoped 样式。** 将旧页面的标题、同步按钮、四个 KPI、四个状态计数、七个筛选/搜索控件、可排序表格、空状态和错误 alert 拆到四个 Vue 文件；表格 header 使用 `aria-sort` 和 button；金额按记录区域显示 `$`、`£` 或 `€`；所有按钮和输入保留可见 focus ring。

- [x] **步骤 4：运行页面测试确认 GREEN。**

运行：`npm --prefix frontend run test -- --run src/features/payments/PaymentsPage.test.ts`

预期：中文、英文、筛选、排序、错误、空状态、焦点和下载测试通过。

### 任务 4：接入 modern entry、legacy dual fallback 和导出 bridge

- [x] **步骤 1：先增加失败的静态契约测试。** 新建 `scripts/test_payments_frontend.mjs`，先断言 `public/index.html` 有 `paymentsModernRoot`、`public/app.js` 有 `hasPage("payments")` mount 分支、`OI_LEGACY_BRIDGE` 支持 `payments`、entry 注册 Payments，以及两个 cache query 均为 `20260827-vue-m4-payments`。

- [x] **步骤 2：运行静态测试确认 RED。**

运行：`node scripts/test_payments_frontend.mjs`

预期：失败，原因是 Payments root、factory、bridge 或 cache query 尚未接入。

- [x] **步骤 3：实现 entry 和 bridge。** 在 `entry.ts` 中从 snapshot 的 `chatbotData.paymentRecords` 读取初始数据，从 `sheetReportData.sheets[].rows` 读取 Payment Cycle fallback；`loadLive` 使用 `apiRequest` 请求 `/api/levanta/payments`，拒绝缺少 `records` 数组的 payload；`download` 只把有效 rows 交给 `OI_LEGACY_BRIDGE.download("payments", payload)`。

- [x] **步骤 4：实现 `switchPage()` 的 Payments dual 路由。** 离开 Payments 时先 `unmountPage("payments")` 并清空 modern root；进入时优先 `hasPage("payments")` + `mountPage("payments", root)`，成功后加 `.is-modern` 并跳过 `renderPaymentsPage()` 和 legacy 自动同步；mount 失败时隐藏 modern root，运行原有 `renderPaymentsPage()` + `refreshLevantaPayments({ silent: true })`。

- [x] **步骤 5：更新 index/auth cache query 和 root CSS。** 只新增 Payments root 的显隐规则，不删除旧 markup；现代 CSS 继续通过构建产物注入 `public/assets/modern/oi-modern.css`。

- [x] **步骤 6：运行静态测试、构建契约和旧回归。**

运行：

```text
node scripts/test_payments_frontend.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_frontend_migration_inventory.mjs
node scripts/test_zh_chatbot.mjs
```

预期：Payments 已注册、legacy bridge 只新增下载能力、不恢复 `requestRender`，旧 chatbot 和迁移清单契约通过。

### 任务 5：浏览器验收、清单记录和 review checkpoint

- [x] **步骤 1：运行目标完整验证。**

```text
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node scripts/test_payments_frontend.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_frontend_migration_inventory.mjs
python scripts/test_payment_placeholders.py
node --check public/auth.js
node --check public/app.js
git diff --check
```

- [x] **步骤 2：使用 `browser-act` 验收桌面、移动端和 API 边界。** browser-act 当前无已配置浏览器，实际使用应用内 Edge 完成同等浏览器验收：在端口 8766 启动 `OI_AUTH_ENABLED=0 python server.py`；确认 Payments modern root 可见、legacy 父级隐藏、英文/中文切换、月份/状态/搜索更新、错误 alert、下载按钮和 390px 移动端无页面级横向溢出；API 非 2xx 时保留 saved rows。导出 Blob 未触发标准 download 事件，已由组件和 bridge/build 契约覆盖；验收后停止服务器并确认 8766 无监听。

- [x] **步骤 3：更新清单和 RoadMap。** 已将 Payments 从 `legacy` 改为 `modern`，记录 modern mount、fallback、API 错误、应用内浏览器边界和验证命令；未把 Blob 下载事件监听结果误写成导出成功证据。

  现代页面视觉已与参考 Payments/Offer Tracker shell 对齐：页头使用“付款 + 数据检查日期”，摘要为独立的四列两行卡片，筛选器保持四列两行密度，下载按钮位于付款记录面板头部，商家单元显示品类副标题，结果区固定高度并由表格承担纵向/横向滚动。

- [x] **步骤 4：review checkpoint。** 已停止在 Payments 批次；报告变更文件、测试结果、浏览器边界、工作树状态和未授权的 commit/push 状态，等待用户确认后再开始 `publishers`。

## 本批次执行结果

- `frontend/src/features/payments/` 已完成 Payment model、composable、页面组件、筛选、摘要、表格和样式；`frontend/src/entry.ts` 与 legacy bridge 已接入。
- Payments 视觉收口已完成：中文页标题、摘要文案、独立 4×2 卡片、紧凑筛选区、品类副标题、面板内下载和固定高度表格滚动均已落地；语言切换后再进入 Payments 的挂载前同步也已补齐。
- 证据：Vitest 8 个文件/46 项通过；typecheck、build、Payments integration contract、build contract、inventory contract、JS syntax 和 `git diff --check` 通过。
- 浏览器边界：应用内 Edge 的 8766 隔离服务验证通过；`LEVANTA_API_KEY` 缺失导致 live API 503，页面保留 saved rows 并显示受控 alert；browser-act 无已配置浏览器，导出 Blob 未捕获标准 download event。
- 当前停点：Payments 已记录为 `modern`，M4 其他页面未开始；本地变更尚未 commit、push 或创建 PR。

## 自检

- 契约覆盖：状态、placeholder、零金额排除、筛选、排序、摘要、币种和导出均有 model 或页面测试。
- 行为覆盖：加载、成功、错误保留旧数据、空状态、同步 loading、语言和键盘焦点均有测试或浏览器证据。
- 回退覆盖：modern mount 失败时 legacy 仍可渲染；离开页面会 unmount，不能留下双重事件监听。
- 范围覆盖：本批次不改后端、不删除旧 Payments DOM、不迁移 Publishers 或 Shell 内部逻辑。
