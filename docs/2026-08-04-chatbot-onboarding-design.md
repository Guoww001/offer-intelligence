# Chatbot 新手引导（Onboarding Tour）设计

日期：2026-08-04
状态：已批准（用户确认方案 A + 6 步流程，E2E 反馈后由 5 步扩展、再增布局介绍步至 7 步）

## 1. 背景与目标

当前 chatbot 对一个新手来说不好上手：核心使用流程（Report Mode 提问 → 生成 Deep Window 浮窗 → 最小化后拖入记忆栏 → Chat Mode 对话）涉及多个隐藏细节（浮窗可最小化、**只有最小化的面板才能拖入记忆栏**、记忆栏只在 Chat Mode 显示），新手仅靠静态使用说明书难以完成首次操作。

目标：提供**交互式分步引导（Onboarding Tour）**，首次进入时自动弹出，通过遮罩 + 高亮圈 + 步骤气泡，手把手引导新手实际完成一次完整的核心操作流程。

## 2. 现状（已核实）

### 2.1 UI 结构（public/index.html）
- `#chatModeToggle`：模式切换按钮组 — Report Mode（`[data-mode="deep"]`，默认）/ Chat Mode（`[data-mode="fast"]`）/ Help（`#reportHelpBtn` 📖）
- `#chatLog`：Report Mode 聊天区；`#chatLogChat`：Chat Mode 聊天区
- `#chatMemoryBar`：记忆栏（`#chatMemoryChips` 芯片区 + `#chatMemoryDropzone` 投放区"将面板拖入此处作为上下文"），**仅在 Chat Mode 显示**（app.js:10201 `if (!state.deepMode)`）
- `#reportHelpPanel`：静态 Markdown 使用说明书面板（内含工具栏 `#reportHelpLangBtn` 语言切换 + `#reportHelpContent`）

### 2.2 核心交互（public/app.js 已核实）
- 拖拽：`_initPanelDrag`（9402）监听 Deep Window 头部 mousedown；`_onPanelDragMove`（9422）做碰撞检测——**仅 `panel.minimized` 时可落入记忆栏**（9434-9460）；`_onPanelDragEnd`（9463）命中时调 `_addMemoryFromPanel`（9469）
- 记忆：`_extractPanelMemory`（10229）提取面板标题 + 文本内容 + 完整数据行；`_addMemoryFromPanel`（10281）push 到 `state.reportMemory` 并 `_renderMemoryBar()`；`_renderMemoryBar`（10197）渲染芯片；Chat Mode 提交时（10382-10386）把 `state.reportMemory` 拼成 `memoryText` 随 POST `/api/chat/stream` 发送
- 状态：`state.deepMode`（初始 true = Report Mode，app.js:335）；`state.language`（zh/en，localStorage `offerLanguage`，`toggleLanguage()` 切换）；app.js 由 auth.js 动态加载（`APP_SCRIPT`）

## 3. 需求确认（用户已选择）

1. **形式**：交互式分步引导 Tour（遮罩 + 高亮 + 步骤气泡）
2. **触发**：首次进入自动弹出；localStorage 记住完成状态；保留手动重播入口
3. **操作深度**：提示 + 「帮我填入示例」按钮（自动填充输入框，高光随即转移到发送按钮，用户点击发送）；拖拽步骤由用户亲手完成
4. **范围**：先做新手引导；进行中的 Report Mode 月份选择功能（设计/计划已提交 git）搁置，完成后恢复

## 4. 架构

### 4.1 文件结构

| 文件 | 改动 |
|---|---|
| `public/onboarding_tour.js` | **新增**：引导引擎 + 步骤数据 + 状态管理（IIFE，`window.ONBOARDING_TOUR`，零依赖） |
| `public/index.html` | 静态引入 onboarding_tour.js（chatbot_i18n.js 之后、auth.js 之前）；页面顶栏（主题切换按钮左侧）加「🎓 新手引导」重播按钮（`data-i18n="tour.button"`） |
| `public/styles.css` | 追加 `.onboarding-*` 样式（深色主题适配） |
| `public/app.js` | 唯一侵入点：`_addMemoryFromPanel` 尾部加 `window.ONBOARDING_TOUR?.notify("memory-added")`（1 行） |
| `scripts/test_onboarding_tour.mjs` | **新增**：vm sandbox 测试（步骤数据、i18n、状态、推进逻辑） |
| `.github/workflows/ci.yml`、`CLAUDE.md` | 追加测试行 |

### 4.2 引擎 API（window.ONBOARDING_TOUR）

```
startTour()            // 启动引导（首次自动 + 重播共用）
stopTour()             // 停止并清理遮罩/高亮/气泡
notify(eventName)      // app.js 事件通知（如 "memory-added"）
shouldShowTour()       // localStorage 判断是否应自动弹出
markCompleted() / resetCompleted()
isActive()             // 引导进行中？
```

### 4.3 渲染组件（纯 DOM 创建，挂在 document.body）

- `.onboarding-mask`：全屏遮罩。**实现方式（关键）**：`mask:"block"` 时遮罩由**四个矩形 div**（上/下/左/右）围出目标元素周围的开窗——目标区域天然可点击（输入框、模式按钮都在窗口内可正常操作），其余区域被遮挡防误触；`mask:"pass"` 时遮罩单层全屏但 `pointer-events: none`（第 6 步拖拽穿透）。四块遮罩位置随目标移动更新
- `.onboarding-highlight`：高亮圈（定位覆盖目标元素，光环 + 圆角，`ResizeObserver` 跟随目标移动，`pointer-events: none` 不拦截操作）
- `.onboarding-popover`：步骤气泡（标题、正文、步骤条「第 N / 共 M 步」、上一步 / 下一步 / 跳过按钮；末步为「完成 🎉」）

### 4.4 步骤数据（TOUR_STEPS，纯数据）

| # | id | target | 说明 | mask |
|---|---|---|---|---|
| 1 | intro | `#chatModeToggle`（模式切换入口） | **整体布局 + chatbot 应用场景介绍**（顶部 Report/Chat Mode 分工、聊天区输入商户/品类、浮窗报告可最小化拖入记忆栏）；无 autoNext，保留「下一步」 | block |
| 2 | report-ask | `#chatInput` → 填示例后**高光转移到发送按钮**（`autoFillFocus: '#chatForm button[type="submit"]'`） | 「帮我填入示例」→ 填 `Shokz` → 高光引导点击「发送」发起查询；`autoNext: "sent"`（chatForm submit）自动推进 | block |
| 3 | deep-window | **最后一个** `.deep-window:not(.generating)`（动态函数返回元素；`appear: true`，等报告完成 ≤15s） | 报告生成期间最小化按钮被 CSS 隐藏（`.generating .deep-window-minimize` 为 none）且 `_minimizeDeepPanel` 拒绝 loading 态，必须等报告完成才能进下一步。**取最后一个（最新创建）面板**：重播/二次使用时旧面板仍在页面，否则高光会落在被置顶新面板盖住的旧面板上 | block |
| 4 | minimize-window | **最后一个面板的** `.deep-window-minimize`（动态函数返回元素） | 点击浮窗头部「─」，把浮窗最小化成药丸小框；`autoNext: "minimized"` + `autoNextFocus: ".deep-window.minimized"`（高光先转移到药丸框展示效果）+ `autoNextDelay: 2200`（展示后延迟推进）。**取最后一个面板的最小化按钮**：重播时旧面板可能已是最小化 pill（按钮被 CSS 隐藏 rect 为 0），querySelector 匹配第一个会高光不可见。高光转移三重保障：优先 `_pendingPillEl`（用户点击最小化的面板元素，click 委托记录）直接定位 + 150ms 轮询兜底（上限 20 次）+ MutationObserver 观察浮窗 `minimized` 类精确捕捉；命中后连续 2 次延迟重定位（等 pill width/height auto 收缩稳定）；**推进前最后一帧重定位**，确保高光位置正确后再切走 | block |
| 5 | switch-chat | `[data-mode="fast"]` | 点击切换到 Chat Mode，记忆栏出现；`autoNext: "switched"`（Chat Mode 按钮点击）自动推进 | block |
| 6 | drag-memory | 动态解析（见下） | 高亮最小化后的药丸框 + 记忆栏投放区脉冲动画（`.onboarding-dropzone-hint`）+ 投放区上方**独立浮动提示条**（`.onboarding-dropzone-tip`，贴近投放区防被气泡遮挡）；用户亲手拖入记忆栏；`autoNext: "memory-added"` 自动推进。**气泡固定视口底部中央**（`popover: "bottom-center"`），避免盖住聊天区顶部的投放区 | **pass** |
| 7 | chat-ask | `#chatInput` → 填示例后高光转移到发送按钮 | 「帮我填入示例」→ 填 `根据刚才的报告，给我分析建议`（英文模式 `autoFillEn: "Based on the report, give me some analysis suggestions"`）→ 点发送；`autoNext: "sent"` **自动结束**引导；`final: true` | block |

每步配置字段：`{ id, target, copyKey, appear?, autoFill?, autoFillEn?, autoFillFocus?, autoNext?, autoNextFocus?, autoNextDelay?, popover?, mask: "block"|"pass", final? }`，其中 `target` 可为**字符串选择器、返回选择器的函数或返回元素的函数**（每步渲染前解析，支持动态目标；元素返回值由 `resolveTarget` 直接使用）；`autoFillEn` 是英文模式下「帮我填入示例」的文案（如第 7 步英文提问示例，`autoFillFor(step)` 按语言取用）；`autoFillFocus` 表示用户点击「帮我填入示例」后高光转移到的元素选择器（步骤内重定位，advance/goBack 时清空）；`autoNext` 事件由引擎模块级委托监听后 notify 触发——`sent`（`#chatForm` submit，含点按钮与回车）、`minimized`（`.deep-window-minimize` 点击，委托同时把被点击面板记录为 `_pendingPillEl`）、`switched`（`[data-mode="fast"]` 点击）、`memory-added`（app.js `_addMemoryFromPanel` 尾部 notify）；`autoNextFocus` 事件触发后高光先转移到该选择器（最小化后 pill 有 250ms 动画，引擎 `_pendingPillEl` 直接定位 + 轮询 + MutationObserver 三重保障），`autoNextDelay` 展示效果停留 ms 数后再自动推进（推进前最后一帧重定位）；`popover: "bottom-center"` 把气泡固定到视口底部中央（第 6 步防遮挡投放区）。

**按钮规则**：autoNext 步骤不渲染可点击的主按钮（next/finish）——点击目标即自动推进或结束；主按钮位置渲染**置灰的「下一步」动作提示**（如「点击「发送」按钮继续」，`.onboarding-btn-hint` disabled），引导操作并防新用户误点「跳过」；仅保留 prev/skip 可点击。无 autoNext 的步骤（第 1 步布局介绍、第 3 步等报告）保留「下一步」。

**关键交互细节**：
- 第 6 步 `mask:"pass"`（遮罩 pointer-events 穿透），否则遮罩会拦截用户拖拽药丸框头部的 mousedown
- 第 6 步 target 动态解析：记忆栏只在 Chat Mode 显示。若推进到第 6 步时 `#chatMemoryBar` 仍 hidden（用户未在第 5 步点击切换），target 函数返回 `[data-mode="fast"]` 并展示对应提示文案（`step5NeedSwitchBody`），用户点击切换后由引擎重新解析 target 指向药丸框；记忆栏可见时返回 `.deep-window.minimized` 高亮药丸框本体
- 第 6 步高亮药丸框（右下角最小化 pill），正文提示拖入记忆栏（上下文区域）——投放区由文案 + 独立提示条（`.onboarding-dropzone-tip`）说明，不另做高亮（YAGNI，单高亮目标）
- 第 2/7 步「帮我填入示例」后高光从输入框转移到发送按钮，引导用户点击发送（`autoFillFocus` 机制）；其余步骤 `mask:"block"`，开窗内目标元素可正常点击/输入

## 5. 数据流

```
首次进入 → init 后延迟 ~800ms → shouldShowTour() 为真 → startTour()
步骤推进 → 气泡按钮手动（第 1/3 步有「下一步」）+ 自动事件推进：第 2 步点发送 → sent、第 4 步点最小化 → minimized（高光转药丸框展示后延迟推进）、第 5 步点 Chat Mode → switched、第 6 步拖入记忆栏 → memory-added、第 7 步点发送 → 自动结束
完成/跳过 → markCompleted() → 后续不再自动弹
重播     → 页面顶栏「🎓 新手引导」按钮 → startTour()（不检查已完成）
```

app.js 侵入点：`_addMemoryFromPanel` 尾部加 `if (window.ONBOARDING_TOUR) window.ONBOARDING_TOUR.notify("memory-added");`

## 6. 语言（i18n）

- `TOUR_COPY = { zh: {...}, en: {...} }`，zh/en 键一一对应
- 渲染时读取当前语言：优先 `localStorage.getItem("offerLanguage")`，兜底 `document.documentElement.lang`
- **语言跟随**：引擎模块级 MutationObserver 观察 `<html lang>` 属性（app.js `applyStaticLanguage` 更新它）——引导进行中切换页面语言，气泡标题/正文/按钮/步骤条立即重渲染跟随；`_renderStep` 开头清 `_locateTimer` 防旧 probe 链误 advance
- 文案覆盖：布局介绍步、7 步标题/正文、按钮（上一步/下一步/跳过/完成/帮我填入示例）、步骤条格式、完成语、autoNext 步骤动作提示（`stepNNextHint`）、第 6 步投放区提示条（`dropzoneTip`）、填入示例英文版（`autoFillEn`）
- **顶栏按钮**：「🎓 新手引导」按钮走 `data-i18n="tour.button"`（app.js translations.zh 表 + HTML 英文 fallback），随页面语言自动切换

## 7. 错误处理

- **目标未找到**：300ms 间隔重试，最多 10 次（3s）；仍失败 → 跳过该步继续
- **报告未完成**（第 2 步）：轮询 `.deep-window:not(.generating)`，最多 15s；超时 → 提示并跳过
- **引导中异常**：任一步可「跳过」温和退出；不强制中断用户操作
- **localStorage 不可用**：内存标记兜底，本次会话不重复自动弹
- **测试模式**：`window.__OFFER_INTELLIGENCE_TEST__` 为真时，`init` 不自动触发引导（不弹窗）

## 8. 测试（scripts/test_onboarding_tour.mjs，vm sandbox 范式同 test_commission_all_aff.mjs）

1. TOUR_STEPS 结构完整性：7 步、id 唯一、target/copyKey 非空、mask 值 ∈ {block, pass}、第 2/4/5/6/7 步各有 autoNext（sent/minimized/switched/memory-added/sent）、第 4 步含 autoNextFocus + autoNextDelay、第 3/6 步 target 为函数、第 2/7 步含 `autoFillFocus`、第 7 步含 `autoFillEn`
2. TOUR_COPY：zh/en 键集一致（含全部步骤文案键）
3. 状态逻辑：`shouldShowTour()`（localStorage 空 → true；已标记 → false）、`markCompleted()` 写入、`resetCompleted()` 清除
4. 推进逻辑：`next()/prev()` 边界（首步无 prev、末步走 complete）、`notify("memory-added")` 仅在步骤 4 触发推进、跳过后 `markCompleted`
5. 每步 copyKey 与 TOUR_COPY 实际存在键一一对应（防止文案键悬空）
6. autoNext 步骤渲染置灰动作提示按钮（用例 12）：`onboarding-btn-hint` + 文案 + `disabled`，且无 `data-tour-action="next"`；无 autoNext 步骤保留「下一步」
7. 第 6 步 popover 固定 bottom-center + 投放区提示条创建/清理（用例 13）：`dropzoneTipActive()` 在 drag-memory 渲染后为真、stopTour 后为假；`dropzoneTip` 键 zh/en 一致
8. 填入示例按语言切换（用例 14）：`autoFillEn` 存在；zh 模式 `autoFillFor` 返回中文示例、en 模式返回英文示例
9. 目标解析（用例 9）：deep-window 取**最后一个**已完成面板；minimize 步取**最后一个面板**的最小化按钮；drag-memory 记忆栏可见/隐藏三分支

CI（`.github/workflows/ci.yml` 追加）与 CLAUDE.md 命令节追加：
```
node scripts/test_onboarding_tour.mjs
```

## 9. 非目标（YAGNI）

- 不做全自动演示（自动执行全部操作）
- 不做多语言之外的语言支持
- 不做引导进度中途保存/恢复（离开即终止，下次进入重新开始）
- 不改造现有 Help 说明书内容（重播入口仅新增按钮）
- 不涉及月份选择功能（单独搁置任务）
