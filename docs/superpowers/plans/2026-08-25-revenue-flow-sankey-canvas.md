# Revenue Flow Sankey Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 将 Revenue flow 的单体长 SVG Sankey 改为 Canvas 连线层和可见节点交互层，降低纵向滚动时的 SVG 绘制、命中测试和 DOM 压力。

**Architecture:** 保留完整图高的滚动占位容器，使用 sticky viewport 承载 Canvas 和节点 overlay。Canvas 只绘制当前滚动窗口及上下缓冲区内的连线，节点 overlay 只挂载同一可见范围内的产品、媒体节点；现有 \`hoverIndex\` 继续提供关联关系，hover 后重绘 Canvas 而不是批量修改所有 SVG 元素。

**Tech Stack:** 现有 vanilla JavaScript、Canvas 2D、CSS、Node.js \`vm\` 前端回归脚本；不增加依赖，不修改 Revenue flow API。

## Global Constraints

- 保留 Revenue flow 的品牌、产品、媒体三列数据语义及现有 Revenue 数值。
- 保留产品和媒体节点的 hover、focus、键盘交互及 aria-label。
- 不再生成 Sankey \`<path>\`、SVG node group 或每条连线的 \`<title>\`。
- 滚动处理使用 passive listener 和 \`requestAnimationFrame\`，同一帧最多执行一次 viewport 绘制。
- 保留上一轮 \`hoverIndex\` 预计算优化，不恢复全量连线扫描。
- 不提交、不推送、不创建 PR；完成后只报告工作区变更和验证结果。

---

### Task 1: Add failing layout and Canvas regression assertions

**Files:**
- Modify: \`scripts/test_brand_media_trend_frontend.mjs:181-229,348-378\`

**Interfaces:**
- Consumes: \`hooks.brandMediaSankeyModel\`, the existing five-link Sankey fixture.
- Produces: required pure hooks \`brandMediaSankeyLayout(model, width)\` and \`brandMediaSankeyVisibleEntries(layout, scrollTop, viewportHeight, overscan)\`.

- [ ] **Step 1: Write the failing test**

Add layout assertions after the existing Sankey hover assertions:

~~~js
const sankeyLayout = hooks.brandMediaSankeyLayout(sankeyModel, 1160);
if (!sankeyLayout || sankeyLayout.width !== 1160 || sankeyLayout.links.length !== 5) {
  throw new Error("Sankey should expose a reusable Canvas layout with every flow link");
}
if (!sankeyLayout.nodes.length || !sankeyLayout.links.every(function (link) {
  return Number.isFinite(link.top) && Number.isFinite(link.bottom) && link.bottom >= link.top;
})) {
  throw new Error("Sankey Canvas layout should expose node entries and link paint bounds");
}
const visibleSankeyEntries = hooks.brandMediaSankeyVisibleEntries(sankeyLayout, 180, 100, 20);
if (!visibleSankeyEntries || visibleSankeyEntries.startY !== 160 || visibleSankeyEntries.endY !== 300 ||
    !visibleSankeyEntries.nodes.length || !visibleSankeyEntries.links.length) {
  throw new Error("Sankey should select only entries intersecting the scroll viewport and overscan");
}
~~~

Replace SVG-specific source checks with assertions for \`brand-media-sankey-canvas\`, \`brand-media-sankey-node-layer\`, \`getContext("2d")\`, \`requestAnimationFrame\`, a passive scroll listener, and no generated \`brand-media-sankey-link\` or \`brand-media-sankey-svg\` markup.

- [ ] **Step 2: Run the focused test to verify it fails**

~~~powershell
node scripts/test_brand_media_trend_frontend.mjs
~~~

Expected: FAIL because the new layout hooks and Canvas markup do not exist yet.

### Task 2: Extract a pure Sankey layout and visible-range index

**Files:**
- Modify: \`public/app.js:19591-19963\`
- Test: \`scripts/test_brand_media_trend_frontend.mjs\`

**Interfaces:**
- Consumes: the existing \`_brandMediaBuildSankeyModel\` output.
- Produces: \`_brandMediaBuildSankeyLayout(model, width)\` returning \`{ width, height, nodes, links, columnX }\` and \`_brandMediaSankeyVisibleEntries(layout, scrollTop, viewportHeight, overscan)\` returning \`{ startY, endY, nodes, links }\`.

- [ ] **Step 1: Implement the pure layout helpers**

Move the existing column layout and link offset calculations into \`_brandMediaBuildSankeyLayout\`. Each node entry includes \`node\`, \`x\`, \`y\`, \`width\`, \`height\`, \`position\`, and \`color\`. Each link entry includes \`index\`, \`sourceY\`, \`targetY\`, \`startX\`, \`endX\`, \`curve\`, \`strokeWidth\`, \`color\`, \`top\`, and \`bottom\`.

Use interval intersection for the visible-range helper:

~~~js
var startY = Math.max(0, Number(scrollTop || 0) - Math.max(0, Number(overscan || 0)));
var endY = Math.min(layout.height, Number(scrollTop || 0) + Number(viewportHeight || 0) + Math.max(0, Number(overscan || 0)));
return {
  startY: startY,
  endY: endY,
  nodes: layout.nodes.filter(function (entry) {
    return entry.y + entry.height >= startY && entry.y <= endY;
  }),
  links: layout.links.filter(function (entry) {
    return entry.bottom >= startY && entry.top <= endY;
  })
};
~~~

- [ ] **Step 2: Expose the pure helpers in test mode**

Add \`brandMediaSankeyLayout: _brandMediaBuildSankeyLayout\` and \`brandMediaSankeyVisibleEntries: _brandMediaSankeyVisibleEntries\` to \`window.OFFER_INTELLIGENCE_TEST_HOOKS\`.

- [ ] **Step 3: Run the focused test**

~~~powershell
node scripts/test_brand_media_trend_frontend.mjs
~~~

Expected: the new pure helper assertions pass; Canvas source assertions remain failing.

### Task 3: Replace SVG rendering with Canvas and a visible node overlay

**Files:**
- Modify: \`public/app.js:19712-19963\`

**Interfaces:**
- Consumes: the pure layout and visible-range index from Task 2.
- Produces: \`_brandMediaRenderSankeyChart\` output containing \`.brand-media-sankey-scroll\`, \`.brand-media-sankey-viewport\`, \`.brand-media-sankey-canvas\`, and \`.brand-media-sankey-node-layer\`.

- [ ] **Step 1: Add Canvas drawing helpers**

Implement \`_brandMediaSankeyDrawCanvas(chart, visible, scrollTop, viewportHeight)\` using a 2D context, a capped device-pixel-ratio backing store, and cubic Bézier strokes. Draw only visible links; use opacity 0.28 normally, 0.06 for non-focused links, and 0.82 for focused links. Draw column headings only when their world Y coordinate intersects the viewport.

- [ ] **Step 2: Add visible node markup and viewport synchronization**

Implement \`_brandMediaSankeyRenderVisibleNodes(chart, visible, scrollTop)\` and \`_brandMediaSankeyRenderFrame(chart)\`. The frame computes the chart scroll position and viewport height, calls the visible-range helper with 180px overscan, draws Canvas, and mounts only visible node controls. Schedule frames through one \`requestAnimationFrame\` slot. Bind one passive scroll listener and a resize observer when available.

- [ ] **Step 3: Move hover focus to model state and Canvas redraws**

Change hover methods to store \`chart._brandMediaSankeyFocus\` as \`{ nodeIds, linkIndexes }\` and schedule a frame. Do not query or mutate all graph elements. Visible node controls apply \`is-focused\` only while mounted.

- [ ] **Step 4: Preserve empty/error and keyboard behavior**

Keep loading, empty, unavailable, aria-label, pointerover, focusin, pointerleave, and focusout behavior. On a new payload, reset scroll position to zero and bind handlers only once per chart element.

- [ ] **Step 5: Run the focused test**

~~~powershell
node scripts/test_brand_media_trend_frontend.mjs
~~~

Expected: the focused frontend test passes.

### Task 4: Replace SVG CSS with Canvas viewport and overlay styles

**Files:**
- Modify: \`public/styles.css:22314-22460\`

**Interfaces:**
- Consumes: the four new Sankey class names emitted by Task 3.
- Produces: a clipped sticky viewport with a scroll spacer and lightweight positioned node controls.

- [ ] **Step 1: Replace SVG layout rules**

Set \`.brand-media-sankey-scroll\` to \`position: relative\`, preserve its calculated graph height and \`min-width: 1160px\`, and set \`.brand-media-sankey-viewport\` to \`position: sticky; top: 0; width: 1160px; overflow: hidden; background: #fff\`.

- [ ] **Step 2: Add Canvas and node overlay styles**

Use \`display:block\` for Canvas, \`position:absolute; inset:0\` for the node layer, \`pointer-events:none\` on the layer, and \`pointer-events:auto\` on visible node controls. Style node bars, labels, values, focus state, muted state, and the existing expanded/mobile layouts without SVG selectors or SVG opacity transitions.

- [ ] **Step 3: Run source and syntax checks**

~~~powershell
node --check public/app.js
node scripts/test_brand_media_trend_frontend.mjs
git diff --check
~~~

Expected: all commands exit with code 0.

### Task 5: Run repository regression verification and inspect the final diff

**Files:**
- Inspect: \`public/app.js\`, \`public/styles.css\`, \`scripts/test_brand_media_trend_frontend.mjs\`
- Inspect: \`git diff --check\` output and test outputs

- [ ] **Step 1: Run focused and related checks**

~~~powershell
node --check public/app.js
node scripts/test_brand_media_trend_frontend.mjs
python scripts/test_brand_media_trend.py
~~~

- [ ] **Step 2: Run the repository JavaScript and Python checks listed in AGENTS.md**

Run the existing \`node --check\`, frontend test, and Python compile commands from the project instructions, preserving the known payment integration skip if its fixture is absent.

- [ ] **Step 3: Inspect scope and report browser verification boundary**

~~~powershell
git diff --stat
git diff --check
git status --short
~~~

Report source/tests verification locally. Report actual browser scroll FPS only if a browser session is available; otherwise state that browser Performance-panel verification remains pending.

### Task 6: Render static Canvas tiles for native scrolling

**Files:**
- Modify: `public/app.js:19862-20121`
- Modify: `public/styles.css:22334-22362`
- Test: `scripts/test_brand_media_trend_frontend.mjs:235-420`

**Interfaces:**
- Consumes: the existing Sankey layout and link paint geometry.
- Produces: `_brandMediaBuildSankeyTileLayout(layout, tileHeight)` and a scroll path where `scroll` does not schedule Canvas drawing.

- [ ] **Step 1: Write the failing test**

Require a static tile helper, `data-brand-media-sankey-tile` markup, and a source assertion that the Sankey scroll listener only updates scrolling state and does not call `_brandMediaSankeyScheduleFrame`.

- [ ] **Step 2: Run the focused test and confirm RED**

~~~powershell
node scripts/test_brand_media_trend_frontend.mjs
~~~

Expected: FAIL because the current viewport implementation schedules a frame from its scroll listener.

- [ ] **Step 3: Implement static tile rendering**

Split the graph into 640px-high Canvas tiles. Draw each tile once at initial render and redraw only after a viewport resize or focus-state change. Keep the full graph height as the scroll content height so native scrolling moves already-rasterized tiles.

- [ ] **Step 4: Remove scroll-time drawing**

Keep the passive scroll listener only for the `is-scrolling` class and hover suppression. Do not call `requestAnimationFrame`, clear Canvas, filter links, rebuild node markup, or update a transform from the scroll callback.

- [ ] **Step 5: Run focused verification**

~~~powershell
node --check public/app.js
node scripts/test_brand_media_trend_frontend.mjs
git diff --check
~~~

Expected: all commands exit with code 0.
