# Chatbot 欢迎屏（Welcome Guide）设计

日期：2026-08-04
状态：已批准（方案 B 双栏工作台 + Chat 态变体 2 进度追踪 + 示例清单确认）
修订：2026-08-04 实现完成——示例措辞与动态商户逻辑已按意图验证结果与最终实现同步（见 §4.5）；2026-08-04 二次迭代——① 按用户反馈改为「常驻 + 可折叠双态」（见 §4.2）；② Report 示例改为直接输入型（商户名/品类名/Tier 字面输入 + 趋势分析，见 §4.5）；2026-08-04 三次迭代——欢迎屏**独立为左栏卡片**，脱离聊天区、始终完整展开不折叠（用户选择"一直完整展开"，见 §4.2/§4.4）；2026-08-04 四次迭代——欢迎屏**同步双主题颜色**（深色控制室 / 浅色控制室）+ 外观优化（冰蓝信号线 / 信号徽章双环光晕 / 发丝渐变 / 统一 cubic-bezier 动效，见 §4.4）

## 1. 背景与目标

现有 7 步新手引导（`onboarding_tour.js`）解决**首次**核心操作流程的教学，但日常每次打开 chatbot，聊天区只有一条硬编码英文欢迎消息（app.js:19591 `Loaded N internal offers. Search merchant name...`），产品意义上等于空白。用户反馈三个卡点：

1. **不知道能问什么**（chatbot 能力边界不透明）
2. **知道查什么但不知怎么说**（措辞心理门槛）
3. **结果出来后不会继续用**（报告生成后不知道还能最小化、拖入记忆栏做深度分析）

目标：**欢迎屏（Empty State）取代英文日志消息**——把空聊天区变成"能力地图 + 流程示意 + 点击即问的示例"，让用户打开后 10 秒内能发起第一个有效问题，并让"获取数据 → 拖入记忆栏 → 深度分析"的核心玩法在每个产出点被再次唤起。

## 2. 现状（已核实）

### 2.1 相关 UI 结构（public/index.html）
- `#chatModeToggle`：模式切换按钮组 — Report Mode（`[data-mode="deep"]`，默认）/ Chat Mode（`[data-mode="fast"]`）
- `#chatLog`：Report Mode 聊天区；`#chatLogChat`：Chat Mode 聊天区（初始为空）——欢迎屏**不再挂载**到这里（三次迭代起挂 dashboard 主网格左列）
- `#chatMemoryBar`：记忆栏（`#chatMemoryChips` 芯片区 + `#chatMemoryDropzone` 投放区），仅在 Chat Mode 显示（app.js:10201 `if (!state.deepMode)`）
- `.main-grid.dashboard-page`：dashboard 主网格（两列：左洞察面板 / 右聊天面板）——欢迎屏独立卡片挂此，grid 第 1 行第 1 列
- `#reportHelpBtn`：📖 使用说明书（静态 Markdown，中英双语）

### 2.2 初始欢迎消息（public/app.js 已核实）
- 原 `addMessage("assistant", "Loaded N internal offers. ...")` 英文欢迎消息已被欢迎屏取代（当前 init 尾部 19637 直接调用 `maybeRender`，无英文日志消息）
- Chat Mode 聊天区英文消息已删除

### 2.3 可复用机制（已核实）
- **i18n**：`translations.zh` 表 + `data-i18n` 属性 + `applyStaticLanguage()` / `rerenderForLanguage()`；app.js:974 处理 `data-i18n-placeholder`
- **意图分类**：`detectQueryIntent()` 支持 merchant / category / ASIN / payment / tier / keyword / trend / recommendation（`docs/chatbot-feature-report.md` 权威参考）
- **新手引导**：`onboarding_tour.js`（IIFE，`window.ONBOARDING_TOUR`，7 步，首次自动弹出）——独立文件范式，欢迎屏沿用同样结构
- **引导的 `autoFillFocus` 机制**：填入输入框后高光转移到发送按钮——欢迎屏示例点击复用此交互思路（但欢迎屏自身实现，不依赖引导引擎）
- **动态商户名**：`offersByMerchantId`（app.js 顶层 state）持有已加载 offers；`keywordSearchRequest` 等函数有取商户名的先例

## 3. 需求确认（用户已选择）

1. **布局**：方案 B 双栏工作台（左「① 先获取数据」/ 中间箭头 / 右「③ 再深度分析」）
2. **Chat Mode 欢迎屏**：变体 2 进度追踪（流程横条保留，前两步打 ✓，第 3 步高亮）
3. **手把手提示**：点击欢迎屏示例后，聊天区自动出现「下一步」提示条（用户明确选择"前者"——填充后主动提示，而非只靠流程示意）
4. **提示只跟示例点击绑定**：从欢迎屏点示例 → 出现提示条；手动输入提问 → 零打扰（不需要"会话早期/前 N 次"状态）
5. **示例清单**（已确认措辞，实现时须用意图测试验证命中路径）：
   - ① 先获取数据（Report Mode，4 个）：`查一下 {商户名} 这个月表现`（动态）、`这个月有哪些商户逾期？`（逾期 Overdue 与未付款 Unpaid 是两个独立状态，示例只取单一状态，避免分类歧义）、`Tier 2表现`、`品类趋势`
   - ③ 再深度分析（Chat Mode，3 个）：`根据记忆栏的报告，给我分析建议`、`对比记忆栏里的两个商户，谁更值得重点投入`、`总结记忆栏的数据，分析下个月的运营方向`（Chat 示例不绑定商户名——记忆栏拖入的未必是欢迎屏示例商户）
6. **范围**：先做欢迎屏 + 提示条；不动 7 步引导、不动 Help 说明书

## 4. 架构

### 4.1 文件结构

| 文件 | 改动 |
|---|---|
| `public/chatbot_welcome.js` | **新增**：欢迎屏引擎（IIFE，`window.CHATBOT_WELCOME`，零依赖，范式同 onboarding_tour.js） |
| `public/index.html` | 静态引入 chatbot_welcome.js（onboarding_tour.js 之后） |
| `public/styles.css` | 追加 `.welcome-*` / `.welcome-tip-*` 样式（深色玻璃拟态，同引导风格） |
| `public/app.js` | 少量挂点（见 4.3） |
| `scripts/test_chatbot_welcome.mjs` | **新增**：vm sandbox 测试 |
| `.github/workflows/ci.yml`、`CLAUDE.md` | 追加测试行 |

### 4.2 引擎 API（window.CHATBOT_WELCOME）

```
maybeRender(mode)     // 渲染独立欢迎屏卡片（mode 参数保留兼容，渲染同一完整工作台）
notify(eventName, payload)
                      // app.js 事件：chat-sent / mode-switched / report-ready / memory-added
isRendered(mode)      // 欢迎屏卡片是否在显示
dismiss(mode)         // 移除欢迎屏卡片
```

**关键设计：独立左栏卡片 + 常驻完整展开**（三次迭代，用户反馈欢迎屏应脱离聊天区、独立成块）——欢迎屏从聊天区**完全独立**出来：
- 面板作为独立卡片挂在 dashboard 主网格（`.main-grid.dashboard-page`）**左列顶部**（grid 第 1 行第 1 列），与聊天区（`#chatLog` / `#chatLogChat`）完全解耦；洞察面板（`.insight-panel`）在左列第 2 行，聊天面板跨满右列两行。
- **始终完整展开、不折叠**：无紧凑条、无收起按钮。对话、模式切换都不影响它（用户选择"一直完整展开"）。
- `chat-sent` 只清提示条 / 发送按钮脉冲；`mode-switched` 只同步记忆栏状态（不重渲染、不切换欢迎屏变体）。
- 窄屏（≤1120px）主网格单列堆叠：welcome 卡片在洞察 / 聊天上方，按文档流排列（显式 grid 定位复位）。
- 无持久 localStorage 标记（刷新后重新渲染）。与 7 步引导的一次性状态互补。

### 4.3 app.js 挂点（最小侵入）

1. **init 尾部**（现 19637 欢迎屏渲染处）：`window.CHATBOT_WELCOME?.maybeRender("report", { offers })` → 渲染独立卡片到 dashboard 主网格左列顶部；Chat 区无欢迎屏
2. **chatForm submit**（发送处，19518）：`notify("chat-sent")` → **只清提示条 / 发送按钮脉冲，不折叠、不删除**（面板常驻完整展开）
3. **模式切换**（19543/19558）：`notify("mode-switched", { mode, hasMemory })` → **只同步记忆栏状态与最近模式**（面板常驻，不重渲染、不切换欢迎屏变体）
4. **报告面板生成完成**（`_renderPanelReport` 尾部，10061）：`notify("report-ready", panelEl)` → 面板顶部提示条（会话内首次显示一次，可关闭）——保留不变
5. **`_addMemoryFromPanel` 尾部**（10544）：`notify("memory-added")` → 同步 `_hasMemory`（Chat 示例空记忆拦截的依据）；无进度条标记
6. **示例 chips 点击**（欢迎屏内部事件委托，不需要 app.js 参与）：填充输入框 → 高亮发送按钮（脉冲类）→ 显示提示条——不变

### 4.4 渲染组件（纯 DOM 创建，独立卡片挂 dashboard 主网格左列顶部）

**统一欢迎屏卡片**（`.welcome-panel`，三次迭代起 Report/Chat 合并为同一完整工作台，挂 `.main-grid.dashboard-page` 第 1 行第 1 列）：
- 欢迎语（信号徽章头像 + "我是你的运营分析助手" + 能力简介）
- `.welcome-flow`：三步流程横条（① Report 提问获取数据 → ② 面板最小化拖入记忆栏 → ③ Chat 深度对话分析）
- `.welcome-cols`：双栏工作台（无中间箭头，适配左栏窄宽）
  - 左栏 `.welcome-col`：「① 先获取数据」+ 4 个示例 chips
  - 右栏 `.welcome-col.right`（紫色描边区）：「③ 再深度分析」+ 3 个示例 chips + 注记「必须先拖入记忆栏」
- 输入框上方 `.welcome-tipbar`（点击示例后浮出，玻璃风格，可关闭）：`📌 发送后，报告生成时可点 ─ 最小化，拖入记忆栏继续深度分析`

**双主题适配（四次迭代）**：欢迎屏随 dashboard 主题联动，选择器挂在 `body.dashboard-mode` 下：
- **深色控制室**（默认）：面板背景 `radial-gradient` 冰蓝光晕 + `#15213f → #0f1936` 深蓝渐变，与洞察/聊天面板同色调；文字 `#eef2f8` 系。
- **浅色控制室**（`[data-dash-theme="light"]`）：白底 `#ffffff → #f5f9ff` + 冰蓝光晕，深海军蓝文字 `#16294f` / `#55688f`，发丝边框 `rgba(23,55,112,0.10)`——与洞察/聊天面板的浅色词汇一致。tipbar 同步浅色。

**外观优化（四次迭代，Ethereal Glass 升级）**：
- **冰蓝信号线**：卡片顶部 `::before` 细发丝高光条（`transparent → rgba(110,168,255,0.55) → transparent`），替代原 2px 粗边框
- **信号徽章**：头像渐变核心 + 双环光晕（1px 实环 + 4px 扩散环 + 柔辉光）
- **发丝渐变**：flow 步骤 / 双栏 / chips 全部从平铺纯色改为极细线性渐变 + 内高光（`inset 0 1px 0`），模拟 Double-Bezel 玻璃层次
- **统一动效**：所有 hover/过渡走 `cubic-bezier(0.32, 0.72, 0, 1)`；chips 与 flow 步骤 hover 上浮 1px；卡片入场 `welcomeCardIn`（淡入 + 上浮，`prefers-reduced-motion` 下禁用）；只动画 `transform`/`opacity`

**Chat 示例点击行为**（二分，面板常驻所以始终可点）：
- 记忆栏为空（`_hasMemory` 为假，由 `mode-switched`/`memory-added` 同步）→ **不填充输入框**，仅显示提示条「请先拖入报告到记忆栏」（拦截保护，防止无上下文提问）
- 记忆栏非空 → 填入输入框 + 发送按钮脉冲（最后一步，不再显示提示条）

**报告面板提示条**：`notify("report-ready")` 时在面板头部下方插入 `.welcome-tipbar` 同风格提示条（`点 ─ 最小化，拖入记忆栏后可在 Chat Mode 深度分析`，可关闭，会话内首次报告生成显示一次）

**填充反馈**：示例点击后输入框已有文本样式 + 发送按钮 `.pulse` 呼吸高亮（纯 CSS 动画，复用引导高亮圈视觉语言）

### 4.5 示例数据（WELCOME_EXAMPLES，纯数据）

```js
{
  report: [
    { text: "{merchant}", dynamic: "merchant" },
    { text: "Beauty 品类" },
    { text: "Tier 2" },
    { text: "{merchant}趋势分析", dynamic: "merchant" }
  ],
  chat: [
    { text: "根据记忆栏的报告，给我分析建议" },
    { text: "对比记忆栏里的两个商户，谁更值得重点投入" },
    { text: "总结记忆栏的数据，分析下个月的运营方向" }
  ]
}
```

- **动态商户名**：`dynamic: "merchant"` 渲染时从 offers 数组取 **1 个佣金/收入最高且未命中已知关键词（`knownKeyword: true`）的商户**（排序取 top1，跳过命中关键词商户，优先有 `merchantName` 的 offer）替换 `{merchant}`；数据未就绪/取不到 → 降级为固定示例（`Shokz`）。实现注：offers 预处理（`mergeProductKeywordsIntoOffers`，app.js）会给命中关键词的 offer 置 `knownKeyword: true`，引擎 `merchantForExample` 据此排除。当前 offers 数据用 `commissionRate`/`salesAmount` 而非 `commission` 字段，排序退化为数组序取首个非关键词商户（不影响排除目标）
- **意图验证要求**（已实现，`scripts/test_chatbot_intent_flow.mjs`）：直接输入型 Report 示例——`Shokz`→merchant 路径 ✓、`Beauty 品类`→category 路径 ✓、`Tier 2`→tier 路径 ✓、`Shokz趋势分析`→analysis/trend 路径 ✓；Chat 示例——`对比记忆栏里的两个商户…`→analysis 路径 ✓。措辞修正记录：① Chat 首选「规划下个月的运营方向」实测命中 merchant（`规划`不在分析关键词内），落地为「分析下个月的运营方向」命中 analysis；② chat-1「根据记忆栏的报告，给我分析建议」修复了 app.js `categoryForPrompt↔wantsRecommendationList` 无限递归（此前点击即栈溢出）后正常走 analysis 路径；③ Report 示例按用户要求改为**直接输入**（商户名/品类名/Tier 字面输入 + `实体名趋势分析`），去掉「查一下…这个月表现」「逾期」「Tier 2表现」等修饰性提问——Report Mode 定位即数据获取 + 趋势分析

## 5. 数据流

```
加载完成（init 尾部）→ maybeRender("report") → 渲染独立欢迎屏卡片到 dashboard 主网格左列顶部
点示例 chip → 填入输入框 + 发送按钮脉冲 + 提示条「发送后…最小化…拖入记忆栏」
  ├─ 发送 → notify("chat-sent") → 面板保持完整展开，只清提示条/脉冲（不折叠、不删除）
  ├─ 手动输入 → 无任何提示条（零打扰）
  └─ 关闭提示条 × → 仅该提示条消失
报告生成 → notify("report-ready") → 面板顶部提示条（会话内首次，可关闭）
拖入记忆栏 → notify("memory-added") → _hasMemory 置真（Chat 示例空记忆拦截依据；无进度条标记）
切 Chat Mode → notify("mode-switched") → 面板不变（常驻），只同步记忆栏状态与最近模式
  ├─ 记忆栏空 + 点分析示例 → 提示条「请先拖入报告」，不填充输入框
  └─ 记忆栏非空 + 点分析示例 → 填入输入框 + 发送按钮脉冲 → 正常提问（无提示条，最后一步）
```

app.js 侵入点汇总：init 渲染（1 处）、chatForm submit（1 行，清提示条）、模式切换（2 行，同步状态）、报告就绪（1 行）、`_addMemoryFromPanel`（1 行）——**均为现有调用，仅引擎内部语义变化，app.js 代码零改动**。

**标准使用步骤（与 onboarding 6 步对齐，2026-08-04 用户确认）**：① Report Mode 提问（直接输入商户名 / 品类名 / Tier / 「xx趋势分析」）→ ② 报告在 Deep Window 浮窗打开 → ③ 点「─」最小化为药丸框 → ④ 切到 Chat Mode（记忆栏出现）→ ⑤ 拖入记忆栏 → ⑥ 基于记忆栏数据对话。**记忆栏是使用数据的必需环节**：Chat Mode 对话依赖记忆栏中的报告上下文，没有报告在记忆栏里 AI 无法正确回答数据问题——欢迎屏 Chat 区示例在记忆栏为空时拦截不填充（见 §4.4）。支付查询 / 推荐排行 / 对比分析非核心流程，不在标准步骤内。

## 6. 语言（i18n）

- `WELCOME_COPY = { zh: {...}, en: {...} }`，zh/en 键一一对应（引擎自渲染，不走 data-i18n，读取 `localStorage.offerLanguage` 兜底 `<html lang>`，同 onboarding 范式）
- 覆盖：欢迎语/描述、流程条三步文案、两栏标题与阶段标签、示例全文（en 版：`Check {merchant}'s performance this month` / `Unpaid offers this month?` / `Tier 2 performance` / `Category trends` / Chat 三个分析示例）、提示条文案（发送后提示 / 报告面板提示 / 空记忆栏提示）、注记「需先拖入记忆栏」、关闭按钮 aria
- 渲染后切换语言：欢迎屏在对话开始时即收起，理论上存活期短；为稳妥，引擎模块级 MutationObserver 观察 `<html lang>`（同 onboarding 的 `_renderStep` 重渲染范式），欢迎屏存活期间语言切换立即重渲染
- 英文示例 `Tier 2 performance`、`Category trends` 同样需意图验证

## 7. 错误处理

- **offers 数据未就绪**：动态商户名降级为固定示例（Shokz 兜底）
- **主网格容器缺失/非 dashboard 页**：`containerFor` 返回 null，`shouldRenderFor` false，不渲染、无副作用
- **已渲染过**：`maybeRender` 仅当主网格**已存在** welcome 卡片时跳过，保持当前态（面板一经创建即常驻）
- **模式反复切换**：面板常驻不随模式切换变化，无残留
- **提示条（tipbar）消失规则**（保证"手动输入零打扰"）：a) 用户发送消息（`chat-sent` 清 tipbar 与脉冲）；b) 用户点 × 关闭；c) **用户手动改动输入框文本**（`input` 事件且值 ≠ 示例最后填充值 → 引擎清除 tipbar 与 `_tipFromExample` 标记）；d) 语言切换重渲染。示例点击设置 `_tipFromExample`，仅此路径触发 tipbar
- **窄屏**：单列堆叠，欢迎屏卡片在洞察 / 聊天上方（显式 grid 定位复位为文档流）
- **测试模式**：`window.__OFFER_INTELLIGENCE_TEST__` 为真时 `maybeRender` 不渲染（同 onboarding 约定）

## 8. 测试（scripts/test_chatbot_welcome.mjs，vm sandbox 范式同 test_onboarding_tour.mjs）

1. WELCOME_EXAMPLES 结构：report 4 个 / chat 3 个、文本非空、dynamic 字段合法
2. WELCOME_COPY：zh/en 键集一致；无折叠条键（barTitle/collapse 已移除）
3. 动态商户名：有 offers → 替换 `{merchant}`；空 offers → 降级固定示例
4. 独立卡片渲染规则：`shouldRenderFor` 主网格无 welcome → true；已有 welcome → false（保持当前态）；`renderPanel` 后 `isRendered` 为真；mode 参数不区分（同一完整工作台卡片）
5. 提示条逻辑：点示例 → tipbar 出现；手动改动已填充文本 → tipbar 消失；点 × 关闭后消失
6. Chat 空记忆栏保护：记忆栏空 + 点分析示例 → 拦截（不填充输入框）+ tipbar「请先拖入报告」；记忆栏非空 + 点示例 → 正常填充 + 脉冲（无 tipbar）
7. `report-ready` 一次性：同一会话第二次 notify 不再插入面板提示条
8. `chat-sent` 常驻：发送消息后 tipbar 清空、面板仍完整展开（`isRendered` 保持真，不折叠不删除）
9. `mode-switched` 只同步状态：`lastMode` 更新、面板不重渲染不切换；语言切换重渲染保持 `_mode`
10. 测试模式：`__OFFER_INTELLIGENCE_TEST__` 下 maybeRender 无副作用
11. 监听器防累积：点击监听绑定在每次新建 panel 上，不累积在主网格容器

CI（`.github/workflows/ci.yml` 追加）与 CLAUDE.md 命令节追加：
```
node scripts/test_chatbot_welcome.mjs
```

## 9. 非目标（YAGNI）

- 不做欢迎屏"已看过"持久状态（刷新即再现，与聊天区空状态天然绑定）
- 不改造 7 步新手引导（首次流程教学仍由 onboarding_tour.js 负责，两者互补不重叠）
- 不改造 Help 说明书内容
- 不按角色（运营/管理层）动态分组示例——示例数量少，双栏已够；角色差异由示例措辞自然覆盖
- 不做示例 A/B 轮换、不做"猜你想问"等主动推荐
- 不改意图分类器本身（示例措辞如有不命中路径，改示例文案而非分类器）
