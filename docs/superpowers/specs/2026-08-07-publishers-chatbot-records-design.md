# Chatbot Publishers Records 查询设计

## 概述

让 Report Mode 的 Chatbot 能够查询 Publishers 数据：用户用自然语言（或第 8 个命令前缀 `publisher:`）指定站点、所属联盟、商家名称或 ID、经理名称等筛选条件，Chatbot 解析后在 Deep Window 浮窗中输出 publishers records 表格，支持按指标排序与限额。

数据源复用现有 Publishers 页面已加载的缓存（`_publishersCache`，经 `/api/ui/db/publishers` 浏览器安全路由提供，来自 `protected_data/db_publishers_cache.json`，407 个 publisher）。全部实现为前端逻辑，不新增后端端点，不修改数据管道。

## 目标

- 新增第 8 个 chatbot 意图：Publisher 媒体查询。
- 支持四维筛选（AND 组合）：站点（市场）、所属联盟（network）、商家名称或 ID（merchantIds）、经理名称（adminName）。
- 支持按指标排序（销售/佣金/订单/Clicks/DPV/ATC 等）与限额（Top N，默认 50）。
- 在 Deep Window 中输出 12 列 publishers records 表格（含合计行与总数）。
- 自然语言与 `publisher:` 前缀共用同一套筛选解析器。
- 更新应用内使用说明（中英文）与 `/` 意图选择器菜单。

## 非目标

- 不新增后端过滤端点（407 条数据前端过滤足够）。
- 不使用 LLM 抽取结构化筛选条件（依赖 API 可用性，与现有 7 意图本地规则解析风格不一致）。
- 不实现 publisher × merchant portfolio 详情（商家偏好、品类分布等按需 API 能力）。
- 不修改 Publishers 页面本身的行为。
- 不修改数据管道（`build_publishers_data.py`、缓存结构）。

## 用户流程

1. 用户在 Report Mode 输入自然语言，如「列一下 amazon.de 市场、Amazon 联盟、经理张三的媒体」，或「销售最高的 5 个媒体」。
2. 或输入 `/` 打开意图选择器菜单，选择第 8 项 Publisher，输入 `publisher: amazon.de Amazon 张三`。
3. Chatbot 识别 publisher 意图，懒加载 publishers 数据（若未加载）。
4. 解析筛选条件 → 过滤 → 排序 → 限额 → 渲染 12 列表格到 Deep Window。
5. 表格底部显示合计行与总数；Deep Window 支持拖动、最小化、导出（沿用现有弹窗机制）。

## 意图检测

在 `detectQueryIntent()` 的本地规则链中新增 publisher 分支（7 → 8 意图），规则：

- 触发词：`publisher` / `publishers` / `媒体`（Publishers 页面术语「选择要分析的媒体」）。
- 触发词单独出现（无筛选词）也触发，视为全量列表查询（如「列一下媒体」）。
- 触发词与筛选词（市场别名、联盟名、经理词、商家词、排序词）组合出现时优先命中 publisher 意图，避免误入 keyword 搜索或 merchant 意图。
- `publisher:` 前缀直接写入命令解析器（`parseChatIntentPrefix` 第 8 个前缀），其后的文本与自然语言走同一 `parsePublisherFilters()`。

## 筛选解析规则

| 维度 | 识别方式 | 示例 |
| --- | --- | --- |
| 站点/市场 | 别名映射：`amazon.de` / `德国站` / `德国市场` → `amazon.de`；`amazon.com` / `美国站` → `amazon.com`；`amazon.co.uk` / `英国站` → `amazon.co.uk`；其余 6 个市场同理 | 「amazon.de 市场」 |
| 联盟 | 与 `publishers[].networks` 值模糊匹配（忽略大小写、包含匹配） | 「Amazon 联盟」 |
| 商家 | 纯数字 token → `merchantId`；文本 → `merchantNameMap` 名称包含匹配；命中多个商家 ID → 该维度内部为 OR | 「商家 362135」「和 Shokz 合作」 |
| 经理 | 与 `publishers[].adminName` 精确或包含匹配 | 「经理张三」 |
| 排序 | 复用 `normalizeMetricName()` 思路：销售/佣金/订单/Clicks/DPV/ATC → 对应 key；带「最/最高/最大」+ 指标 → 降序 | 「按销售排序」「佣金最高的」 |
| 限额 | 数字词 +「前/Top/最多」→ 行数上限；无排序词时默认 Top 50 | 「前 5 个」 |

- 四维为 **AND**；某维度命中多个值（如多个商家）时该维度内为 **OR**。
- 匹配策略：先精确 → 再忽略大小写包含匹配；无匹配的维度被忽略并在回答中标注「未识别：XXX」，不整体失败。
- 默认排序：`clicks` 降序（与 Publishers 页面一致）。
- 排序与限额仅作用于渲染的行；合计行与总数始终按完整筛选结果计算。

## 渲染设计

- 新增 `renderPublisherRecordsTable()`：12 列（去 rank）—— Publisher ID / Name / Manager / Clicks / CVR / DPV / ATC / Orders / Sales / All Comm / Aff Comm / Gross Profit；复用 `PUBLISHER_TABLE_COLUMNS` 的列定义与 `escapeHtml`/`number`/`money`/`pct` 格式化。
- 合计行置顶（沿用页面 `total-row` 样式），下方显示 `Total: N`。
- 表格优先复用现有 Deep Window 内表格样式（`resultTable` / `miniTable` 类）；仅当样式不足时新增少量 CSS，并 bump 三处缓存版本号（`styles.css` / `auth.js` / `app.js`）。
- Deep Window 标题：「Publisher Records」/「媒体业绩记录」，跟随当前语言。

## i18n

- 表格头与提示文案中英文跟随当前语言（复用 `chatCopy` / `chatFormat` 模式）。
- 意图菜单第 8 项：Publisher（中英文标签）。
- 文案清单：无匹配提示、未识别维度标注、数据加载失败降级提示、合计行标签。

## 说明书更新

- `REPORT_MODE_HELP_MD`（中文）「提问类型命令」表格 7 行 → 8 行，新增 Publisher 行（含 `publisher: amazon.de Amazon 张三` 示例）；「支持的提问类型」概述同步提及媒体查询。
- `REPORT_MODE_HELP_MD_EN`（英文）同步更新（`## 1. Question Type Commands` 表格 + 概述）。
- 模板字符串约束不变：不得包含未转义的反引号或 `${}`。

## 异常处理

| 场景 | 行为 |
| --- | --- |
| publishers 数据加载失败 | Deep Window 显示「Publishers 数据暂时不可用」降级提示，与现有 `dbLookupSkipPrompt` 降级风格一致 |
| 筛选后 0 条记录 | 显示「未找到匹配的媒体」+ 已识别筛选条件回显 |
| 某维度词未识别 | 标注「未识别：XXX」，其余维度照常过滤渲染 |
| 无筛选条件 | 全量列表，默认排序 + Top 50 |
| 无排序词 | 默认按 clicks 降序 |

## 预期修改范围

主要集中在前端：

- `public/app.js`：`hasPublisherIntent()` / `parsePublisherFilters()` / `publisherRecordsAnswer()` / `renderPublisherRecordsTable()`；意图检测链与命令前缀注册；意图菜单第 8 项；`REPORT_MODE_HELP_MD` / `_EN` 说明书更新。
- `public/index.html`：意图菜单第 8 项 HTML（若菜单项由 HTML 静态定义）；缓存版本 bump。
- `public/auth.js`：`APP_SCRIPT` 缓存版本 bump。
- `public/styles.css`：仅在表格样式不足时新增少量样式；缓存版本 bump。
- `public/chatbot_i18n.js`：新增表格头/提示文案（若沿用该文件模式）。

不修改后端 API 与数据管道。

## 验证方案

### 自动化验证

- 新文件 `scripts/test_chatbot_publisher_records.mjs`（TDD 契约测试）：
  - 静态断言：`hasPublisherIntent` / `parsePublisherFilters` / `publisherRecordsAnswer` / `renderPublisherRecordsTable` 存在；意图菜单第 8 项；说明书 8 类型；`publisher` 前缀注册。
  - vm 行为断言：四维解析（市场别名、联盟、商家 ID/名称、经理）、AND 组合、商家多值 OR、排序、限额、无匹配提示、未识别维度标注。
- 同步 `scripts/test_chatbot_intent_picker.mjs`（若断言了菜单项数量或说明书类型数）。
- 回归：`node --check` × 4 + 现有 chatbot 相关 node 测试全绿。

### 浏览器验收

1. 本地启动服务器，登录后进入 Report Mode。
2. 输入「列一下 amazon.de 市场的媒体」，确认 Deep Window 弹出 publishers records 表格、站点列数值为 amazon.de 口径。
3. 输入「publisher: Amazon 张三」，确认前缀解析生效。
4. 输入「销售最高的 5 个媒体」，确认排序 + 限额。
5. 输入不存在的商家/经理，确认「未找到匹配的媒体」+ 条件回显。
6. 中英文各验证一遍表格头与提示文案。
7. `/` 菜单确认第 8 项 Publisher 可选中并写入 `publisher: ` 前缀。

## 验收标准

当用户完成「输入 publisher 自然语言或前缀 → Deep Window 输出 publishers records 表格」流程时：

- 四维筛选（站点/联盟/商家/经理）与页面筛选框行为一致。
- 表格 12 列、合计行、总数正确；排序与限额生效。
- 中英文界面文案正确。
- 说明书与 `/` 菜单含 Publisher 类型。
- 契约测试与回归测试全绿。
