# Publishers Page 优化计划

> 参考 Category 和 Tier 页面的设计模式，对 Publishers 页面进行 UI 和功能升级。

---

## 1. 按市场/网络聚合的摘要卡片

**参考：** Category 页面的分类饼图 + 分类汇总表

**目标：** 在 Publishers 页面的 KPI 卡片下方增加一个**市场聚合概览区**，展示每个站点的分布情况。

**具体内容：**
- 按市场（amazon.com / amazon.co.uk / amazon.ca 等）聚合 publisher 数量、总 clicks、总 commission
- 用**环形饼图（donut chart）**展示各市场 clicks 占比（复用 Category 页面的饼图模式）
- 饼图下方跟随**聚合表格**，列出每个市场的 publisher 数、clicks、orders、commission
- 饼图/表格支持点击筛选：点击某个市场 -> 表格只显示该市场的 publisher

**涉及文件：** `public/index.html`、`public/app.js`、`public/styles.css`

---

## 2. 列选择器（Display Columns）

**参考：** Tier 页面的「Display」按钮 + `tierColumnPanel`

**目标：** 允许用户选择 Publisher Records 表格中显示/隐藏的列。

**具体内容：**
- 在表格工具栏右侧增加 **「Display」按钮**，点击弹出列选择面板
- 面板中列出所有可用列（#、Publisher ID、Publisher Name、Manager、Clicks、CVR、DPV、ATC、Orders、Sales、All Commission、Aff Commission、Gross Profit）
- 每个列名带 checkbox，勾选则显示，取消勾选则隐藏
- 提供「Default」和「All」快捷按钮
- 选中状态持久化到 `localStorage`

**涉及文件：** `public/app.js`、`public/styles.css`

---

## 3. 分页（Pagination）

**参考：** Tier 4 页面的分页导航

**目标：** 当前 402 行 publisher 全部渲染在 DOM 中，对性能有影响且不便于浏览。增加分页控制。

**具体内容：**
- 每页显示 50 行（可配置）
- 表格底部/顶部出现分页导航：**「Previous | Page X of N | Next」**
- 切换页码时仅渲染当前页数据
- 筛选/排序后重置到第一页
- 分页状态随筛选条件变化自动重置

**涉及文件：** `public/app.js`、`public/styles.css`

---

## 4. 图表交互增强

**目标：** 提升柱状图的可用性和交互性。

**具体内容：**
- **展开/收起：** 柱状图默认显示 Top15，提供「Show more」按钮展开到 Top30 或全部
- **点击联动：** 点击某个 bar -> 表格自动筛选到该 publisher（即状态中加入 publisher 过滤）
- **hover 信息：** 鼠标悬停 bar 上时显示详细指标（当前已有值标签，可增强）

**涉及文件：** `public/app.js`、`public/styles.css`

---

## 5. 表格行展开详情

**参考：** 其他页面的折叠面板效果

**目标：** 点击某行 publisher 可展开行内详情，显示该 publisher 在各市场下的细分数据。

**具体内容：**
- 每行左侧加一个 **展开/折叠箭头**
- 展开后显示该 publisher 在每个市场的独立指标行（market、clicks、orders、sales、commission）
- 折叠时恢复紧凑视图
- 同一时间只能展开一行（手风琴效果）或允许多行同时展开

**涉及文件：** `public/app.js`、`public/styles.css`

---

## 6. 可视化增强

**目标：** 增加更多数据可视化元素，让数据更直观。

**具体内容：**
- **趋势迷你图（Sparkline）：** 在 KPI 卡片区域，对每个指标（clicks、orders、commission）增加过去 N 个月的 mini 折线趋势图
- **堆叠条形图：** 在表格的 commission 列，用微小的堆叠条展示 allCommission 与 affCommission 的构成比例
- **颜色编码：** 根据 commission 高低或环比增长率，对行背景或数字进行颜色编码（绿色增长/红色下降）

**涉及文件：** `public/app.js`、`public/styles.css`

---

## 7. 导出功能增强

**目标：** 让数据导出更灵活。

**具体内容：**
- **「导出当前页」**：配合分页功能，只导出当前页的数据
- **「导出全部」**：导出筛选后的全部数据（现有功能）
- 导出文件名称包含日期范围和筛选条件（如 `publishers_2026-07-10_2026-07-20.xlsx`）
- 导出的列与列选择器同步：只导出当前显示的列

**涉及文件：** `public/app.js`

---

## 实施顺序建议

| 优先级 | 项 | 预估工作量 | 说明 |
|:------:|:---|:----------:|------|
| P0 | #3 分页 | 小 | 提升列表性能，最基础 |
| P0 | #2 列选择器 | 小 | 提升灵活性，用户体验明显改善 |
| P1 | #4 图表交互增强 | 小 | 开发量小，交互提升明显 |
| P1 | #7 导出增强 | 小 | 与分页和列选择器配合 |
| P2 | #1 市场聚合摘要 | 中 | 复用 Category 饼图模式 |
| P2 | #5 行展开详情 | 中 | 需要设计展开折叠逻辑 |
| P3 | #6 可视化增强 | 大 | sparkline + 堆叠条，开发量较大 |
