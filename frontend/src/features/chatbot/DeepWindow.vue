<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { LegacyDeepWindowInteraction } from "../../legacy/contracts";
import ChatbotResultView from "./ChatbotResultView.vue";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const props = withDefaults(defineProps<{
  readonly id?: string;
  readonly language: UiLanguage;
  readonly result: ChatbotReportViewResult;
  readonly minimized: boolean;
  readonly pinned?: boolean;
  readonly overlay?: boolean;
  readonly status?: "loading" | "ready" | "cancelled" | "error";
  readonly position?: { readonly x: number; readonly y: number };
  readonly absolutePosition?: boolean;
  readonly canAddMemory?: boolean;
  readonly addedToMemory?: boolean;
}>(), {
  id: "deep-window",
  pinned: false,
  overlay: false,
  status: "ready",
  position: () => ({ x: 24, y: 24 }),
  absolutePosition: false,
  canAddMemory: true,
  addedToMemory: false
});

const emit = defineEmits<{
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
  (event: "move", x: number, y: number): void;
}>();

const dragging = ref(false);
let dragOrigin: { x: number; y: number; left: number; top: number } | null = null;

const windowTitle = computed(() => props.result.title || props.result.category || props.result.tier || props.result.intent);

const memoryActionLabel = computed(() => props.addedToMemory
  ? (props.language === "zh" ? "已加入对话" : "Added")
  : (props.language === "zh" ? "加入对话" : "Add to chat"));

const windowStyle = computed(() => props.absolutePosition
  ? {
      left: `${props.position.x}px`,
      top: `${props.position.y}px`,
      right: "auto",
      transform: "none"
    }
  : { transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)` });

function pointerMove(event: PointerEvent): void {
  if (!dragOrigin) return;
  emit("move", dragOrigin.left + event.clientX - dragOrigin.x, dragOrigin.top + event.clientY - dragOrigin.y);
}

function pointerUp(event?: PointerEvent): void {
  const wasDragging = Boolean(dragOrigin);
  const droppedOnMemoryBar = wasDragging
    && event
    && typeof document.elementFromPoint === "function"
    && document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-chatbot-memory-bar]");
  dragging.value = false;
  dragOrigin = null;
  window.removeEventListener("pointermove", pointerMove);
  window.removeEventListener("pointerup", pointerUp);
  if (droppedOnMemoryBar) emit("drop-memory");
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button")) return;
  dragging.value = true;
  dragOrigin = {
    x: event.clientX,
    y: event.clientY,
    left: props.position.x,
    top: props.position.y
  };
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp, { once: true });
}

function chartTarget(event: Event): HTMLElement | null {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!target || !root) return null;
  const candidate = target.closest<HTMLElement>("[data-trend-metric], [data-trend-category-select], [data-trend-column-toggle], [data-trend-column-core], [data-trend-column-all], [data-trend-column-check]");
  return candidate && root.contains(candidate) ? candidate : null;
}

function handleChartClick(event: MouseEvent): void {
  const target = chartTarget(event);
  if (!target) return;
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

onBeforeUnmount(pointerUp);
</script>

<template>
  <aside
    class="chatbot-deep-window"
    :class="{ 'is-minimized': minimized, 'is-pinned': pinned, 'is-overlay': overlay, 'is-dragging': dragging }"
    :style="windowStyle"
    data-deep-window
    :data-deep-window-id="id"
    :data-status="status"
    :aria-label="language === 'zh' ? '深度报告' : 'Deep report'"
  >
    <header class="chatbot-deep-window-header" data-deep-window-header data-draggable="true" @pointerdown="startDrag">
      <div>
        <span class="chatbot-deep-window-eyebrow">DEEP WINDOW</span>
        <strong>{{ windowTitle }}</strong>
      </div>
      <div class="chatbot-deep-window-actions">
        <button v-if="minimized" type="button" data-deep-window-action="restore" @click="emit('restore')">↗</button>
        <template v-else>
          <button type="button" data-deep-window-action="add-memory" :disabled="status === 'cancelled' || !canAddMemory" @click="emit('add-memory')">{{ memoryActionLabel }}</button>
          <button type="button" data-deep-window-action="pin" :aria-pressed="pinned" @click="emit('pin')">{{ pinned ? '★' : '☆' }}</button>
          <button type="button" data-deep-window-action="export" @click="emit('export')">⇩</button>
          <button type="button" data-deep-window-action="clone" @click="emit('clone')">＋</button>
          <button type="button" data-deep-window-action="overlay" :aria-pressed="overlay" @click="emit('overlay')">◫</button>
          <button type="button" data-deep-window-action="cancel" :disabled="status !== 'loading'" @click="emit('cancel')">{{ language === 'zh' ? '取消' : 'Cancel' }}</button>
        </template>
        <button v-if="!minimized" type="button" data-deep-window-action="minimize" @click="emit('minimize')">—</button>
        <button type="button" data-deep-window-action="close" @click="emit('close')">×</button>
      </div>
    </header>
    <div v-if="!minimized" class="chatbot-deep-window-content" data-deep-window-content @click="handleChartClick" @change="handleChartChange">
      <ChatbotResultView :language="language" :result="result" @download="emit('download', $event)" />
    </div>
  </aside>
</template>
