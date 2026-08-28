<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import {
  buildRevenueFlowLayout,
  revenueFlowColor,
  revenueFlowFlowDetail,
  revenueFlowFlowHitTest,
  revenueFlowHoverState,
  revenueFlowNodeDisplayLabel,
  type RevenueFlowFlowDetail,
  type RevenueFlowLayout,
  type RevenueFlowLayoutNode,
  type RevenueFlowModel
} from "./revenueFlowModel";

const props = defineProps<{
  model: RevenueFlowModel | null;
  language: UiLanguage;
  emptyMessage: string;
  loading: boolean;
  lockedNodeId: string;
  zoom: number;
}>();

const emit = defineEmits<{
  toggleNode: [nodeId: string];
  setZoom: [zoom: number];
  resetZoom: [];
}>();

const chartRoot = ref<HTMLElement | null>(null);
const viewport = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const rootWidth = ref(1160);
const focusedNodeId = ref("");
const isPanning = ref(false);
const flowTooltip = ref<RevenueFlowFlowDetail | null>(null);
const flowTooltipStyle = ref<Record<string, string>>({});
let resizeObserver: ResizeObserver | null = null;
let panPointerId = -1;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

const layout = computed<RevenueFlowLayout | null>(() =>
  props.model ? buildRevenueFlowLayout(props.model, rootWidth.value) : null
);
const activeNodeId = computed(() => props.lockedNodeId || focusedNodeId.value);
const activeHover = computed(() => props.model && activeNodeId.value
  ? revenueFlowHoverState(props.model, activeNodeId.value)
  : null);
const activeNodeSet = computed(() => new Set(activeHover.value?.relatedNodeIds || []));
const activeLinkSet = computed(() => new Set(activeHover.value?.relatedLinkIndexes || []));
const activeNode = computed(() => props.model && activeNodeId.value
  ? props.model.nodeById[activeNodeId.value]
  : undefined);
const stageStyle = computed(() => {
  if (!layout.value) return {};
  return {
    width: layout.value.surfaceWidth * props.zoom + "px",
    height: layout.value.height * props.zoom + "px"
  };
});
const contentStyle = computed(() => {
  if (!layout.value) return {};
  return {
    width: layout.value.surfaceWidth + "px",
    height: layout.value.height + "px",
    transform: "scale(" + props.zoom + ")"
  };
});
const copy = computed(() => ({
  brandColumn: translateMessage(props.language, "revenueFlow.brandColumn", "Brands"),
  products: translateMessage(props.language, "revenueFlow.products", "Revenue-producing products"),
  media: translateMessage(props.language, "revenueFlow.media", "Corresponding media"),
  zoomOut: translateMessage(props.language, "revenueFlow.canvasZoomOut", "Zoom out"),
  zoomIn: translateMessage(props.language, "revenueFlow.canvasZoomIn", "Zoom in"),
  reset: translateMessage(props.language, "revenueFlow.canvasResetView", "Reset view"),
  canvasHint: translateMessage(props.language, "revenueFlow.canvasHint", "Hover a node to trace its revenue flow. Click a product or media node to lock it."),
  locked: translateMessage(props.language, "revenueFlow.canvasLocked", "Node locked"),
  pan: translateMessage(props.language, "revenueFlow.canvasPan", "Drag to pan"),
  panActive: translateMessage(props.language, "revenueFlow.canvasPanActive", "Panning"),
  flowTitle: translateMessage(props.language, "revenueFlow.flowTitle", "Flow details"),
  flowRevenue: translateMessage(props.language, "revenueFlow.flowRevenue", "Revenue"),
  flowSourceShare: translateMessage(props.language, "revenueFlow.flowSourceShare", "Source share"),
  flowTargetShare: translateMessage(props.language, "revenueFlow.flowTargetShare", "Destination share")
}));

function formatMoney(value: number): string {
  return "$" + value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function nodeIsMuted(node: RevenueFlowLayoutNode): boolean {
  return Boolean(activeNodeId.value) && !activeNodeSet.value.has(node.id);
}

function linkIsMuted(index: number): boolean {
  return Boolean(activeNodeId.value) && !activeLinkSet.value.has(index);
}

function drawCanvas(): void {
  const currentLayout = layout.value;
  const currentCanvas = canvas.value;
  if (!currentLayout || !currentCanvas) return;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = currentCanvas.getContext("2d");
  } catch {
    context = null;
  }
  if (!context) return;
  context.clearRect(0, 0, currentCanvas.width, currentCanvas.height);
  context.lineJoin = "round";
  for (const link of currentLayout.links) {
    const startX = link.source.x + link.source.width;
    const endX = link.target.x;
    const curve = Math.max(45, (endX - startX) * 0.42);
    context.beginPath();
    context.moveTo(startX, link.sourceTop);
    context.bezierCurveTo(
      startX + curve,
      link.sourceTop,
      endX - curve,
      link.targetTop,
      endX,
      link.targetTop
    );
    context.lineTo(endX, link.targetBottom);
    context.bezierCurveTo(
      endX - curve,
      link.targetBottom,
      startX + curve,
      link.sourceBottom,
      startX,
      link.sourceBottom
    );
    context.closePath();
    context.globalAlpha = linkIsMuted(link.index) ? 0.08 : 0.34;
    context.fillStyle = link.color;
    context.fill();
  }
  context.globalAlpha = 1;
  for (const node of currentLayout.nodes) {
    context.fillStyle = revenueFlowColor(node.type === "brand"
      ? 0
      : node.type === "product" ? 1 : 2);
    context.globalAlpha = nodeIsMuted(node) ? 0.22 : 0.95;
    context.fillRect(node.x, node.y, node.width, node.height);
  }
  context.globalAlpha = 1;
}

function updateRootWidth(): void {
  const width = chartRoot.value?.clientWidth || 0;
  rootWidth.value = Math.max(1160, width);
}

function focusNode(node: RevenueFlowLayoutNode): void {
  focusedNodeId.value = node.id;
}

function clearNodeFocus(): void {
  if (!props.lockedNodeId) focusedNodeId.value = "";
}

function toggleNode(node: RevenueFlowLayoutNode): void {
  if (node.type === "brand") return;
  emit("toggleNode", node.id);
}

function nodeLabel(node: RevenueFlowLayoutNode): string {
  return node.label + ", " + formatMoney(node.value);
}

function startPan(event: PointerEvent): void {
  if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
  const target = viewport.value;
  if (!target) return;
  clearFlowTooltip();
  isPanning.value = true;
  panPointerId = event.pointerId;
  panStartX = event.clientX;
  panStartY = event.clientY;
  panScrollLeft = target.scrollLeft;
  panScrollTop = target.scrollTop;
  target.setPointerCapture?.(event.pointerId);
}

function movePan(event: PointerEvent): void {
  if (!isPanning.value || event.pointerId !== panPointerId || !viewport.value) return;
  viewport.value.scrollLeft = panScrollLeft - (event.clientX - panStartX);
  viewport.value.scrollTop = panScrollTop - (event.clientY - panStartY);
}

function endPan(event: PointerEvent): void {
  if (event.pointerId !== panPointerId) return;
  isPanning.value = false;
  viewport.value?.releasePointerCapture?.(event.pointerId);
  panPointerId = -1;
}

function clearFlowTooltip(): void {
  flowTooltip.value = null;
  flowTooltipStyle.value = {};
}

function formatPercent(value: number): string {
  const numeric = Number.isFinite(value) ? Math.max(0, value) : 0;
  const percent = Math.round(numeric * 1000) / 10;
  return String(percent).replace(/\.0$/, "") + "%";
}

function pointerLayoutPoint(event: PointerEvent): { x: number; y: number } | null {
  const target = viewport.value;
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  const scale = Math.max(0.01, props.zoom || 1);
  return {
    x: (target.scrollLeft + event.clientX - rect.left) / scale,
    y: (target.scrollTop + event.clientY - rect.top) / scale
  };
}

function updateFlowTooltip(event: PointerEvent): void {
  if (!props.model || !layout.value || !props.lockedNodeId || isPanning.value) {
    clearFlowTooltip();
    return;
  }
  if (event.target instanceof Element && event.target.closest(".revenue-flow-sankey-node")) {
    clearFlowTooltip();
    return;
  }
  const point = pointerLayoutPoint(event);
  const hit = point
    ? revenueFlowFlowHitTest(layout.value, point.x, point.y, activeLinkSet.value)
    : null;
  const detail = hit ? revenueFlowFlowDetail(props.model, props.model.links[hit.index]) : null;
  if (!detail) {
    clearFlowTooltip();
    return;
  }
  const target = viewport.value;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  flowTooltip.value = detail;
  flowTooltipStyle.value = {
    left: target.scrollLeft + event.clientX - rect.left + "px",
    top: target.scrollTop + event.clientY - rect.top + 16 + "px"
  };
}

function handlePointerMove(event: PointerEvent): void {
  movePan(event);
  if (!isPanning.value) updateFlowTooltip(event);
}

function handleWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  emit("setZoom", props.zoom + (event.deltaY > 0 ? -0.1 : 0.1));
}

function zoomOut(): void {
  emit("setZoom", props.zoom - 0.1);
}

function zoomIn(): void {
  emit("setZoom", props.zoom + 0.1);
}

function refreshCanvas(): void {
  void nextTick(drawCanvas);
}

onMounted(() => {
  updateRootWidth();
  if (typeof ResizeObserver !== "undefined" && chartRoot.value) {
    resizeObserver = new ResizeObserver(updateRootWidth);
    resizeObserver.observe(chartRoot.value);
  }
  refreshCanvas();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  isPanning.value = false;
  clearFlowTooltip();
});

watch([layout, activeNodeId], refreshCanvas, { deep: true });
watch(() => props.zoom, refreshCanvas);
</script>

<template>
  <div
    ref="chartRoot"
    class="brand-media-sankey-chart-wrap revenue-flow-sankey-chart-wrap"
    :class="{ 'is-panning': isPanning }"
    role="group"
    :aria-busy="loading"
    :aria-label="model && layout ? copy.canvasHint : emptyMessage"
  >
    <div v-if="model && layout" class="brand-media-sankey-canvas-viewport revenue-flow-sankey-viewport" ref="viewport" tabindex="0" @pointerdown="startPan" @pointermove="handlePointerMove" @pointerup="endPan" @pointercancel="endPan" @pointerleave="clearFlowTooltip" @scroll="clearFlowTooltip" @wheel="handleWheel">
      <div class="brand-media-sankey-canvas-grid" aria-hidden="true" />
      <div class="brand-media-sankey-canvas-stage-shell" :style="stageStyle">
        <div class="brand-media-sankey-canvas-stage" :style="contentStyle">
          <div class="brand-media-sankey-column-labels revenue-flow-sankey-column-labels" aria-hidden="true">
            <span :style="{ left: layout.columnX.brand + 'px' }">{{ copy.brandColumn }}</span>
            <span :style="{ left: layout.columnX.product + 'px' }">{{ copy.products }}</span>
            <span :style="{ left: layout.columnX.media + 'px' }">{{ copy.media }}</span>
          </div>
          <canvas
            ref="canvas"
            class="brand-media-sankey-canvas"
            :width="Math.ceil(layout.surfaceWidth)"
            :height="Math.ceil(layout.height)"
            aria-hidden="true"
          />
          <div class="brand-media-sankey-node-layer">
            <div
              v-for="node in layout.nodes"
              :key="node.id"
              class="brand-media-sankey-node revenue-flow-sankey-node"
              :class="[
                'is-' + node.type,
                { 'is-muted': nodeIsMuted(node), 'is-active': activeNodeSet.has(node.id), 'is-locked': lockedNodeId === node.id }
              ]"
              :style="{ left: node.x + 'px', top: node.y + 'px', width: node.width + 'px', height: node.height + 'px', '--revenue-flow-node-color': node.type === 'brand' ? revenueFlowColor(0) : node.type === 'product' ? revenueFlowColor(1) : revenueFlowColor(2) }"
              @mouseenter="focusNode(node)"
              @mouseleave="clearNodeFocus"
            >
              <button
                v-if="node.type !== 'brand'"
                type="button"
                class="revenue-flow-sankey-node-button"
                :aria-pressed="lockedNodeId === node.id"
                :aria-label="nodeLabel(node)"
                :title="nodeLabel(node)"
                @focus="focusNode(node)"
                @blur="clearNodeFocus"
                @click="toggleNode(node)"
              >
                <span class="revenue-flow-sankey-node-label">{{ revenueFlowNodeDisplayLabel(node) }}</span>
                <small v-if="node.type === 'product' && node.label !== revenueFlowNodeDisplayLabel(node)">{{ node.label }}</small>
              </button>
              <span v-else class="revenue-flow-sankey-brand-label">{{ node.label }}</span>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="flowTooltip"
        class="brand-media-sankey-flow-tooltip revenue-flow-sankey-flow-tooltip"
        :style="flowTooltipStyle"
        role="status"
        aria-live="polite"
      >
        <div class="brand-media-sankey-flow-tooltip-title">{{ copy.flowTitle }}</div>
        <div class="brand-media-sankey-flow-tooltip-path">
          <span>{{ flowTooltip.sourceLabel }}</span>
          <span class="brand-media-sankey-flow-tooltip-arrow" aria-hidden="true">→</span>
          <span>{{ flowTooltip.targetLabel }}</span>
        </div>
        <div class="brand-media-sankey-flow-tooltip-row">
          <span>{{ copy.flowRevenue }}</span>
          <strong>{{ formatMoney(flowTooltip.value) }}</strong>
        </div>
        <div class="brand-media-sankey-flow-tooltip-row">
          <span>{{ copy.flowSourceShare }}</span>
          <strong>{{ formatPercent(flowTooltip.sourceShare) }}</strong>
        </div>
        <div class="brand-media-sankey-flow-tooltip-row">
          <span>{{ copy.flowTargetShare }}</span>
          <strong>{{ formatPercent(flowTooltip.targetShare) }}</strong>
        </div>
      </div>
    </div>
    <div v-else class="brand-media-sankey-empty revenue-flow-sankey-empty" role="status" aria-live="polite">{{ emptyMessage }}</div>

    <div v-if="activeNode" class="revenue-flow-sankey-focus-card" aria-live="polite">
      <span>{{ activeNode.label }}</span>
      <strong>{{ formatMoney(activeNode.value) }}</strong>
    </div>

    <div v-if="model && layout" class="brand-media-sankey-canvas-toolbar revenue-flow-sankey-toolbar" role="toolbar" :aria-label="copy.canvasHint">
      <button type="button" :aria-label="copy.zoomOut" :title="copy.zoomOut" @click="zoomOut">−</button>
      <span aria-live="polite">{{ Math.round(zoom * 100) }}%</span>
      <button type="button" :aria-label="copy.zoomIn" :title="copy.zoomIn" @click="zoomIn">+</button>
      <button type="button" class="is-reset" :aria-label="copy.reset" :title="copy.reset" @click="emit('resetZoom')">↺</button>
    </div>
    <p v-if="model && layout" class="brand-media-sankey-canvas-help revenue-flow-sankey-help">
      {{ isPanning ? copy.panActive : copy.pan }} · {{ copy.canvasHint }}
      <span v-if="lockedNodeId"> · {{ copy.locked }}</span>
    </p>
  </div>
</template>
