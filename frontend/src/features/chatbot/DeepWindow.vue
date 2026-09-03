<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import type {
  LegacyAnswerFeedbackState,
  LegacyDeepWindowInteraction,
  LegacyDeepWindowSkeletonStep,
  LegacyFeedbackBridge
} from "../../legacy/contracts";
import type { UiLanguage } from "../../shared/i18n";
import ChatAnswerActions from "./ChatAnswerActions.vue";
import ChatbotResultView from "./ChatbotResultView.vue";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

type DeepWindowStatus = "loading" | "ready" | "content" | "cancelled" | "error";

const props = withDefaults(defineProps<{
  readonly id?: string;
  readonly mode?: "report" | "chat";
  readonly language: UiLanguage;
  readonly result: ChatbotReportViewResult;
  readonly title?: string;
  readonly summary?: string;
  readonly contentHtml?: string;
  readonly errorMessage?: string;
  readonly skeletonSteps?: readonly LegacyDeepWindowSkeletonStep[];
  readonly zIndex?: number;
  readonly minimized: boolean;
  readonly pinned?: boolean;
  readonly overlay?: boolean;
  readonly status?: DeepWindowStatus;
  readonly position?: { readonly x: number; readonly y: number };
  readonly absolutePosition?: boolean;
  readonly canCancel?: boolean;
  readonly canAddMemory?: boolean;
  readonly addedToMemory?: boolean;
  readonly canExport?: boolean;
  readonly canMinimize?: boolean;
  readonly canClose?: boolean;
  readonly feedbackState?: LegacyAnswerFeedbackState;
  readonly feedback?: LegacyFeedbackBridge | null;
}>(), {
  id: "deep-window",
  mode: "report",
  title: "",
  summary: "",
  contentHtml: "",
  errorMessage: "",
  skeletonSteps: () => [],
  zIndex: 1200,
  pinned: false,
  overlay: false,
  status: "ready",
  position: () => ({ x: 24, y: 24 }),
  absolutePosition: false,
  canCancel: true,
  canAddMemory: true,
  addedToMemory: false,
  canExport: true,
  canMinimize: true,
  canClose: true,
  feedbackState: "unavailable",
  feedback: null
});

const emit = defineEmits<{
  (event: "activate"): void;
  (event: "minimize"): void;
  (event: "restore"): void;
  (event: "close"): void;
  (event: "add-memory"): void;
  (event: "pin"): void;
  (event: "export"): void;
  (event: "clone"): void;
  (event: "overlay"): void;
  (event: "cancel"): void;
  (event: "download", downloadId: string): void;
  (event: "trend-interact", action: LegacyDeepWindowInteraction, value?: string): void;
  (event: "trend-columns", columns: readonly string[]): void;
  (event: "drop-memory"): void;
  (event: "drop-highlight", active: boolean): void;
  (event: "move", x: number, y: number): void;
}>();

const dragging = ref(false);
const dropTarget = ref(false);
const panelRoot = ref<HTMLElement | null>(null);
let dragOrigin: { x: number; y: number; left: number; top: number } | null = null;

const status = computed(() => props.status === "ready" ? "content" : props.status);
const isLoading = computed(() => status.value === "loading");
const isContent = computed(() => status.value === "content");
const windowTitle = computed(() => props.title || props.result.title || props.result.category || props.result.tier || props.result.intent || "Deep Analysis");
const windowSummary = computed(() => props.summary || props.result.message || "");
const reportHtml = computed(() => props.contentHtml?.trim() || props.result.legacyHtml?.trim() || "");
const steps = computed<readonly LegacyDeepWindowSkeletonStep[]>(() => props.skeletonSteps?.length ? props.skeletonSteps : [
  { id: "understand", label: props.language === "zh" ? "理解问题" : "Understanding your question", state: "active" },
  { id: "query", label: props.language === "zh" ? "查询数据" : "Querying data", state: "pending" },
  { id: "report", label: props.language === "zh" ? "生成报告" : "Generating report", state: "pending" }
]);

const memoryActionLabel = computed(() => props.addedToMemory
  ? (props.language === "zh" ? "已加入对话" : "Added")
  : (props.language === "zh" ? "加入对话" : "Add to chat"));
const stopLabel = computed(() => props.language === "zh" ? "停止" : "Stop");
const closeLabel = computed(() => props.language === "zh" ? "关闭" : "Close");
const restoreLabel = computed(() => props.language === "zh" ? "恢复" : "Restore");
const errorText = computed(() => props.errorMessage || (status.value === "cancelled"
  ? (props.language === "zh" ? "分析已停止。" : "The analysis was stopped.")
  : (props.language === "zh" ? "分析失败，请稍后重试。" : "The analysis failed. Please try again.")));

const windowStyle = computed(() => ({
  ...(props.absolutePosition
    ? { left: `${props.position.x}px`, top: `${props.position.y}px`, right: "auto", transform: "none" }
    : { transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)` }),
  zIndex: String(props.zIndex)
}));

function setDropTarget(active: boolean): void {
  if (dropTarget.value === active) return;
  dropTarget.value = active;
  emit("drop-highlight", active);
}

function memoryDropTarget(event?: Event): Element | null {
  if (!dragOrigin || !props.minimized) return null;
  const pointer = event as PointerEvent | undefined;
  const memoryBar = document.querySelector<HTMLElement>("[data-chatbot-memory-bar]");
  const panel = panelRoot.value;
  if (memoryBar && panel) {
    const panelRect = panel.getBoundingClientRect();
    const memoryRect = memoryBar.getBoundingClientRect();
    const dx = Number(pointer?.clientX || dragOrigin.x) - dragOrigin.x;
    const dy = Number(pointer?.clientY || dragOrigin.y) - dragOrigin.y;
    const left = panelRect.left + dx;
    const top = panelRect.top + dy;
    const hasOverlap = left < memoryRect.right && left + panelRect.width > memoryRect.left
      && top < memoryRect.bottom && top + panelRect.height > memoryRect.top;
    if (panelRect.width > 0 && panelRect.height > 0 && memoryRect.width > 0 && memoryRect.height > 0) {
      return hasOverlap ? memoryBar : null;
    }
  }
  if (typeof document.elementFromPoint !== "function") return null;
  const x = Number(pointer?.clientX || 0);
  const y = Number(pointer?.clientY || 0);
  return document.elementFromPoint(x, y)?.closest("[data-chatbot-memory-bar]") || null;
}

function pointerMove(event: PointerEvent): void {
  if (!dragOrigin) return;
  const nextLeft = dragOrigin.left + event.clientX - dragOrigin.x;
  const nextTop = dragOrigin.top + event.clientY - dragOrigin.y;
  const panelWidth = panelRoot.value?.getBoundingClientRect().width || 0;
  const panelHeight = panelRoot.value?.getBoundingClientRect().height || 0;
  const maxLeft = Math.max(0, window.innerWidth - panelWidth);
  const maxTop = Math.max(0, window.innerHeight - panelHeight);
  emit("move", Math.min(maxLeft, Math.max(0, nextLeft)), Math.min(maxTop, Math.max(0, nextTop)));
  setDropTarget(Boolean(memoryDropTarget(event)));
}

function pointerUp(event?: Event): void {
  const wasDragging = Boolean(dragOrigin);
  const wasMinimized = props.minimized;
  const droppedOnMemoryBar = wasDragging && Boolean(memoryDropTarget(event));
  const moved = wasDragging && dragging.value;
  dragging.value = false;
  dragOrigin = null;
  window.removeEventListener("pointermove", pointerMove);
  window.removeEventListener("pointerup", pointerUp);
  setDropTarget(false);
  if (droppedOnMemoryBar) emit("drop-memory");
  else if (wasMinimized && !moved) emit("restore");
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, input, select, textarea, .deep-window-actions")) return;
  emit("activate");
  dragging.value = true;
  dragOrigin = { x: event.clientX, y: event.clientY, left: props.position.x, top: props.position.y };
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
}

function chartTarget(event: Event): HTMLElement | null {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!target || !root) return null;
  const candidate = target.closest<HTMLElement>("[data-trend-metric], [data-trend-category-select], [data-trend-column-toggle], [data-trend-column-core], [data-trend-column-all], [data-trend-column-check], [data-download-id]");
  return candidate && root.contains(candidate) ? candidate : null;
}

function handleChartClick(event: MouseEvent): void {
  const target = chartTarget(event);
  if (!target) return;
  const downloadId = target.getAttribute("data-download-id");
  if (downloadId) {
    emit("download", downloadId.slice(0, 120));
    return;
  }
  if (target.matches("button[data-trend-metric]")) {
    const metric = target.getAttribute("data-trend-metric");
    if (metric) emit("trend-interact", "trend-metric", metric);
  } else if (target.matches("[data-trend-column-toggle]")) {
    emit("trend-interact", "trend-column-toggle");
  } else if (target.matches("[data-trend-column-core]")) {
    emit("trend-interact", "trend-column-core");
  } else if (target.matches("[data-trend-column-all]")) {
    emit("trend-interact", "trend-column-all");
  }
}

function handleChartChange(event: Event): void {
  const target = chartTarget(event);
  if (!target) return;
  if (target.matches("[data-trend-category-select]")) {
    emit("trend-interact", "trend-category", (target as HTMLSelectElement).value);
    return;
  }
  if (target.matches("[data-trend-column-check]")) {
    const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const columns = root
      ? Array.from(root.querySelectorAll<HTMLInputElement>("[data-trend-column-check]:checked"), (checkbox) => checkbox.value)
      : [];
    emit("trend-columns", columns);
  }
}

watch(() => props.minimized, (minimized) => {
  if (!minimized) setDropTarget(false);
});

onBeforeUnmount(() => pointerUp());

</script>

<template>
  <aside
    ref="panelRoot"
    class="deep-window"
    :class="{ minimized, 'source-chat': mode === 'chat', 'source-report': mode === 'report', 'is-minimized': minimized, 'is-pinned': pinned, 'is-overlay': overlay, dragging, 'is-dragging': dragging, 'drop-target': dropTarget, generating: isLoading }"
    :style="windowStyle"
    data-deep-window
    :data-deep-window-id="id"
    :data-status="status"
    :aria-label="language === 'zh' ? '深度报告' : 'Deep report'"
    @pointerdown="emit('activate')"
  >
    <header class="deep-window-header" data-deep-window-header data-draggable="true" @pointerdown="startDrag">
      <div class="deep-window-heading">
        <span class="deep-window-eyebrow">DEEP WINDOW</span>
        <h2 class="deep-window-title">{{ windowTitle }}</h2>
        <span v-if="minimized" class="deep-window-pill-state">{{ isLoading ? stopLabel : windowSummary }}</span>
      </div>
      <div class="deep-window-actions">
        <button v-if="minimized" class="deep-window-minimize" type="button" :aria-label="restoreLabel" data-deep-window-action="restore" @click="emit('restore')">▢</button>
        <template v-else-if="!isLoading">
          <button v-if="isContent" class="deep-window-chat-add" type="button" data-deep-window-action="add-memory" :disabled="!canAddMemory || addedToMemory" @click="emit('add-memory')">{{ memoryActionLabel }}</button>
          <button v-if="isContent && canExport" type="button" data-deep-window-action="export" @click="emit('export')">⇩</button>
        </template>
        <button v-if="isLoading && canCancel" class="deep-window-stop" type="button" data-deep-window-action="stop" @click="emit('cancel')">{{ stopLabel }}</button>
        <button v-if="!minimized && canMinimize && !isLoading" class="deep-window-minimize" type="button" data-deep-window-action="minimize" aria-label="Minimize" @click="emit('minimize')">—</button>
        <button v-if="canClose && !isLoading" class="deep-window-close" type="button" data-deep-window-action="close" :aria-label="closeLabel" @click="emit('close')">×</button>
      </div>
    </header>

    <div v-if="!minimized" class="deep-window-body" data-deep-window-content @click="handleChartClick" @change="handleChartChange">
      <section v-if="isLoading" class="deep-window-skeleton" aria-live="polite" data-deep-window-skeleton>
        <div v-for="step in steps" :key="step.id" class="deep-skeleton-step" :class="step.state" data-deep-window-step>
          <span class="deep-skeleton-spinner" aria-hidden="true"></span>
          <span>{{ step.label }}</span>
        </div>
      </section>

      <section v-else-if="isContent" class="deep-window-content" data-deep-window-report>
        <h2 class="deep-report-title">{{ windowTitle }}</h2>
        <p v-if="windowSummary" class="deep-report-summary">{{ windowSummary }}</p>
        <div v-if="reportHtml" class="deep-report-sections" data-deep-window-sections v-html="reportHtml"></div>
        <div v-else class="deep-report-sections" data-deep-window-sections>
          <ChatbotResultView :language="language" :result="result" @download="emit('download', $event)" />
        </div>
        <div class="deep-window-feedback" data-deep-window-feedback>
          <ChatAnswerActions
            :language="language"
            :answer-id="id"
            :can-open-deep="false"
            :feedback-state="feedbackState"
            :feedback="feedback"
          />
        </div>
      </section>

      <section v-else class="deep-window-error" role="alert" data-deep-window-error>
        <strong>{{ language === 'zh' ? '深度分析失败' : 'Deep analysis failed' }}</strong>
        <p>{{ errorText }}</p>
      </section>
    </div>
  </aside>
</template>
