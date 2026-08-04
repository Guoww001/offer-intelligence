# Chatbot 欢迎屏（Welcome Guide）设计

日期：2026-08-04
状态：已批准（方案 B 双栏工作台 + Chat 态变体 2 进度追踪 + 示例清单确认）
修订：2026-08-04 实现完成——示例措辞与动态商户逻辑已按意图验证结果与最终实现同步（见 §4.5）；2026-08-04 二次迭代——① 按用户反馈改为「常驻 + 可折叠双态」（见 §4.2）；② Report 示例改为直接输入型（商户名/品类名/Tier 字面输入 + 趋势分析，见 §4.5）

## 1. 背景与目标

现有 7 步新手引导（`onboarding_tour.js`）解决**首次**核心操作流程的教学，但日常每次打开 chatbot，聊天区只有一条硬编码英文欢迎消息（app.js:19591 `Loaded N internal offers. Search merchant name...`），产品意义上等于空白。用户反馈三个卡点：

1. **不知道能问什么**（chatbot 能力边界不透明）
2. **知道查什么但不知怎么说**（措辞心理门槛）
3. **结果出来后不会继续用**（报告生成后不知道还能最小化、拖入记忆栏做深度分析）

目标：**欢迎屏（Empty State）取代英文日志消息**——把空聊天区变成"能力地图 + 流程示意 + 点击即问的示例"，让用户打开后 10 秒内能发起第一个有效问题，并让"获取数据 → 拖入记忆栏 → 深度分析"的核心玩法在每个产出点被再次唤起。

## 2. 现状（已核实）

### 2.1 相关 UI 结构（public/index.html）
- `#chatModeToggle`：模式切换按钮组 — Report Mode（`[data-mode="deep"]`，默认）/ Chat Mode（`[data-mode="fast"]`）
- `#chatLog`：Report Mode 聊天区；`#chatLogChat`：Chat Mode 聊天区（初始为空）
- `#chatMemoryBar`：记忆栏（`#chatMemoryChips` 芯片区 + `#chatMemoryDropzone` 投放区），仅在 Chat Mode 显示（app.js:10201 `if (!state.deepMode)`）
- `#reportHelpBtn`：📖 使用说明书（静态 Markdown，中英双语）

### 2.2 初始欢迎消息（public/app.js 已核实）
- `19591`：`addMessage("assistant", "Loaded N internal offers. Search merchant name, merchant ID, ASIN, category, payment status, or ask for recommendations.")` — **硬编码英文，不走 i18n**，样式与普通回复相同（日志式，无示例无入口）
- `19592-19597`：Chat Mode 聊天区同样追加 `Loaded N internal offers.` 英文消息
- 这两条将被欢迎屏取代

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
maybeRender(mode)     // 聊天区为空时渲染欢迎屏（mode: "report" | "chat"）；有对话则跳过
notify(eventName, payload)
                      // app.js 事件：chat-sent / mode-switched / report-ready / memory-added
isRendered(mode)      // 当前模式欢迎屏是否在显示
dismiss(mode)         // 收起欢迎屏（手动 × 或发送消息后）
```

**关键设计：欢迎屏常驻 + 可折叠双态**（二次迭代，用户反馈"一有对话面板就没了"效果差）——欢迎屏**不**随消息日志滚动消失、**不**被对话顶掉：
- 面板与折叠条以 `position: sticky; top: 0` 常驻在对应聊天区（`#chatLog` / `#chatLogChat`）顶部，消息在其下方滚动，面板始终固定可见。
- 双态互斥：**展开态** `.welcome-panel`（完整双栏工作台，头部带「收起 ▾」按钮）与**折叠态** `.welcome-bar`（紧凑条，点击展开）。
- 首条用户消息发出（`chat-sent`）→ **折叠为紧凑条而非删除**；点折叠条可随时重新展开。
- 无持久 localStorage 标记（刷新页面后若聊天区重新为空，首开仍展开面板；常驻条本身随会话存在）。与 7 步引导的一次性状态互补。

### 4.3 app.js 挂点（最小侵入）

1. **init 尾部**（现 19591 欢迎消息处）：`addMessage(...)` 替换为 `window.CHATBOT_WELCOME?.maybeRender("report")`；19592-19597 的 Chat 区英文消息**删除**（Chat 区欢迎屏由挂点 3 的模式切换驱动，init 时不渲染隐藏态聊天区）
2. **chatForm submit**（发送处）：`notify("chat-sent")` → 欢迎屏**折叠为紧凑条**（常驻，不删除）、提示条收起
3. **模式切换**（`[data-mode]` 按钮点击处理处）：`notify("mode-switched")` → 按目标模式确保常驻欢迎屏存在（首次切到该模式展开；已有内容保持当前态）
4. **报告面板生成完成**（deep window 报告就绪处，如 `_renderPanelReport` 尾部或面板出现轮询）：`notify("report-ready", panelEl)` → 面板顶部提示条（会话内首次显示一次，可关闭）
5. **`_addMemoryFromPanel` 尾部**（现已有 ONBOARDING_TOUR notify 处，同位置追加）：`notify("memory-added")` → Chat 欢迎屏流程条 ② 打 ✓、提示条收起
6. **示例 chips 点击**（欢迎屏内部事件委托，不需要 app.js 参与）：填充输入框 → 高亮发送按钮（脉冲类）→ 显示提示条

### 4.4 渲染组件（纯 DOM 创建，挂载到各自聊天区）

**Report Mode 欢迎屏**（挂 `#chatLog` 顶部，sticky 常驻）：
- `.welcome-panel`：欢迎语（头像 + "我是你的运营分析助手" + 能力简介）
- `.welcome-flow`：三步流程横条（① Report 提问获取数据 → ② 面板最小化拖入记忆栏 → ③ Chat 深度对话分析）
- `.welcome-cols`：双栏工作台
  - 左栏 `.welcome-col-left`：「① 先获取数据」+ 4 个示例 chips
  - 中间箭头 ➜
  - 右栏 `.welcome-col-right`（紫色描边区）：「③ 再深度分析」+ 3 个示例 chips + 注记「需先拖入记忆栏」
- 输入框上方 `.welcome-tipbar`（点击示例后浮出，玻璃风格，可关闭）：`📌 发送后，报告生成时可点 ─ 最小化，拖入记忆栏继续深度分析`

**Chat Mode 欢迎屏**（挂 `#chatLogChat` 顶部，sticky 常驻）：
- `.welcome-memory-hint`：记忆栏虚线占位提示（复用/呼应 `#chatMemoryDropzone` 视觉）
- `.welcome-flow.progress`：进度追踪流程条（① ✓ ② ✓ ③ 高亮）
- `.welcome-panel`：「记忆栏已就绪，开始分析吧」+ ③ 分析示例 chips
- **Chat 示例点击行为**（二分）：
  - 记忆栏为空（`state.reportMemory` 无数据）→ **不填充输入框**，仅显示提示条「请先拖入报告到记忆栏」（拦截保护，防止无上下文提问）
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
加载完成（init 尾部）→ maybeRender("report") → 渲染展开欢迎屏（sticky 常驻聊天区顶部，替代英文欢迎消息）
点示例 chip → 填入输入框 + 发送按钮脉冲 + 提示条「发送后…最小化…拖入记忆栏」
  ├─ 发送 → notify("chat-sent") → 欢迎屏折叠为紧凑条（常驻不消失，可点击再展开）
  ├─ 手动输入 → 无任何提示条（零打扰）
  └─ 关闭提示条 × → 仅该提示条消失
报告生成 → notify("report-ready") → 面板顶部提示条（会话内首次，可关闭）
拖入记忆栏 → notify("memory-added") → Chat 欢迎屏 ② 打 ✓（若在 Chat 态）
切 Chat Mode → notify("mode-switched") → chatLogChat 首次空 → 渲染 Chat 欢迎屏（进度追踪，sticky 常驻）
  ├─ 记忆栏空 + 点分析示例 → 提示条「请先拖入报告」，不填充输入框
  └─ 记忆栏非空 + 点分析示例 → 填入输入框 + 发送按钮脉冲 → 正常提问（无提示条，最后一步）
```

app.js 侵入点汇总：init 欢迎消息替换（1 处）、chatForm submit（1 行）、模式切换处理（1 行）、报告就绪（1 行）、`_addMemoryFromPanel`（1 行）。

## 6. 语言（i18n）

- `WELCOME_COPY = { zh: {...}, en: {...} }`，zh/en 键一一对应（引擎自渲染，不走 data-i18n，读取 `localStorage.offerLanguage` 兜底 `<html lang>`，同 onboarding 范式）
- 覆盖：欢迎语/描述、流程条三步文案、两栏标题与阶段标签、示例全文（en 版：`Check {merchant}'s performance this month` / `Unpaid offers this month?` / `Tier 2 performance` / `Category trends` / Chat 三个分析示例）、提示条文案（发送后提示 / 报告面板提示 / 空记忆栏提示）、注记「需先拖入记忆栏」、关闭按钮 aria
- 渲染后切换语言：欢迎屏在对话开始时即收起，理论上存活期短；为稳妥，引擎模块级 MutationObserver 观察 `<html lang>`（同 onboarding 的 `_renderStep` 重渲染范式），欢迎屏存活期间语言切换立即重渲染
- 英文示例 `Tier 2 performance`、`Category trends` 同样需意图验证

## 7. 错误处理

- **offers 数据未就绪**：动态商户名降级为固定示例（Shokz 兜底）
- **聊天区已有消息**：不再阻止渲染（常驻面板与消息共存，sticky 固定顶部）；`maybeRender` 仅当目标容器**已存在** welcome 内容（展开或折叠条）时跳过，保持当前态
- **模式反复切换**：按目标模式幂等确保常驻欢迎屏存在，无残留
- **提示条（tipbar）消失规则**（保证"手动输入零打扰"）：a) 用户发送消息（面板折叠为紧凑条，tipbar 随折叠清空）；b) 用户点 × 关闭；c) **用户手动改动输入框文本**（`input` 事件且值 ≠ 示例最后填充值 → 引擎清除 tipbar 与 `_tipFromExample` 标记）；d) 面板折叠/收起。示例点击设置 `_tipFromExample`，仅此路径触发 tipbar
- **测试模式**：`window.__OFFER_INTELLIGENCE_TEST__` 为真时 `maybeRender` 不渲染（同 onboarding 约定）

## 8. 测试（scripts/test_chatbot_welcome.mjs，vm sandbox 范式同 test_onboarding_tour.mjs）

1. WELCOME_EXAMPLES 结构：report 4 个 / chat 3 个、文本非空、dynamic 字段合法
2. WELCOME_COPY：zh/en 键集一致
3. 动态商户名：有 offers → 替换 `{merchant}`；空 offers → 降级固定示例
4. 渲染/常驻双态规则：`maybeRender` 目标容器无 welcome 内容 → 渲染展开面板；已有内容（展开或折叠条）→ 保持当前态跳过；聊天区已有消息但仍无 welcome 内容 → 仍渲染（常驻，对话不顶掉）；`chat-sent` → **折叠为紧凑条而非删除**（`collapsed` 状态置真）；折叠条可点击重新展开
5. 提示条逻辑：点示例 → tipbar 出现；手动输入（无示例点击）→ 无 tipbar；手动改动已填充文本 → tipbar 消失；点 × 关闭后消失；发送后消失（折叠清空）
6. Chat 空记忆栏保护：记忆栏空 + 点分析示例 → 拦截（不填充输入框）+ tipbar「请先拖入报告」；记忆栏非空 + 点示例 → 正常填充 + 脉冲（无 tipbar）
7. `report-ready` 一次性：同一会话第二次 notify 不再插入面板提示条
8. 测试模式：`__OFFER_INTELLIGENCE_TEST__` 下 maybeRender 无副作用

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
