<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import { readMerchantWorkbook, type MerchantWorkbookError } from "../../shared/import/merchantWorkbook";
import { parseAgentAttachment, type AgentAttachmentStore, type AgentPromotionAttachment, type AgentPromotionWindow } from "./agentAttachment";
import { windowDates } from "../offer-performance/performanceModel";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly store: AgentAttachmentStore;
  readonly readFile?: typeof readMerchantWorkbook;
  readonly busy?: boolean;
}>(), {
  readFile: undefined,
  busy: false,
});

const attachment = ref<AgentPromotionAttachment | null>(props.store.get());
const launchDate = ref(attachment.value?.manifest.window?.launchDate || "");
const startDate = ref(attachment.value?.manifest.window?.startDate || "");
const endDate = ref(attachment.value?.manifest.window?.endDate || "");
const fileInput = ref<HTMLInputElement | null>(null);
const error = ref("");
const reading = ref(false);
const dragging = ref(false);
let dragDepth = 0;
let stopSubscription: (() => void) | null = null;

const t = (zh: string, en: string) => props.language === "zh" ? zh : en;
const supported = /\.(xlsx|xls|csv|tsv)$/i;
const reader = props.readFile || readMerchantWorkbook;

function errorText(value: unknown): string {
  const code = (value as MerchantWorkbookError | { code?: string })?.code;
  if (code === "MERCHANT_FILE_TOO_LARGE") return t("文件不能超过 5 MiB。", "The file must be 5 MiB or smaller.");
  if (code === "MERCHANT_FILE_FORMAT") return t("请选择 XLSX、XLS、CSV 或 TSV 文件。", "Choose an XLSX, XLS, CSV, or TSV file.");
  if (code === "IMPORT_NAMES") return t("文件中的每个有效 Merchant ID 都必须有 Merchant Name。", "Every valid Merchant ID needs a Merchant Name.");
  if (code === "IMPORT_IDS") return t("没有有效商家，或商家数量超过 200 个。", "No valid merchants were found, or the list has more than 200 merchants.");
  return t("无法读取文件，请检查 Merchant ID 和 Merchant Name 列。", "The file could not be read. Check the Merchant ID and Merchant Name columns.");
}

function hasDirectory(items: readonly DataTransferItem[] | undefined): boolean {
  return Boolean(items?.some((item) => {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.();
    return entry?.isDirectory === true;
  }));
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

async function acceptFile(file: File | undefined): Promise<void> {
  if (!file || props.busy || reading.value) return;
  error.value = "";
  if (!supported.test(file.name)) {
    error.value = errorText({ code: "MERCHANT_FILE_FORMAT" });
    return;
  }
  reading.value = true;
  try {
    const tables = await reader(file);
    props.store.replace(parseAgentAttachment(tables, file.name));
  } catch (caught) {
    error.value = errorText(caught);
  } finally {
    reading.value = false;
  }
}

function choose(event: Event): void {
  void acceptFile((event.target as HTMLInputElement).files?.[0]);
  (event.target as HTMLInputElement).value = "";
}

function dragEnter(event: DragEvent): void {
  if (props.busy || !hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  dragging.value = true;
}

function dragOver(event: DragEvent): void {
  if (props.busy || !hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  dragging.value = true;
}

function dragLeave(event: DragEvent): void {
  if (props.busy || !dragging.value) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragging.value = false;
}

function drop(event: DragEvent): void {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dragging.value = false;
  if (props.busy || reading.value) return;
  const items = Array.from(event.dataTransfer?.items || []);
  const files = Array.from(event.dataTransfer?.files || []);
  if (hasDirectory(items) || files.length !== 1) {
    error.value = t("请拖入一个 XLSX、XLS、CSV 或 TSV 文件，不要拖入文件夹或多个文件。", "Drop one XLSX, XLS, CSV, or TSV file, not a folder or multiple files.");
    return;
  }
  void acceptFile(files[0]);
}

function setLaunchDate(value: string): void {
  launchDate.value = value;
  const dates = windowDates(value);
  startDate.value = dates?.startDate || "";
  endDate.value = dates?.endDate || "";
  const next: AgentPromotionWindow | null = dates ? { launchDate: value, ...dates } : null;
  props.store.setWindow(next);
}

function setCustomWindow(): void {
  const dates = windowDates(launchDate.value, startDate.value || undefined, endDate.value || undefined);
  if (!dates && startDate.value && endDate.value) {
    error.value = t("观察期必须从推送日（含）或之后开始，长度为 1–92 天，并填写起止日期。", "Observation must start on or after launch, cover 1–92 days, and include both dates.");
  } else {
    error.value = "";
  }
  props.store.setWindow(dates && launchDate.value ? { launchDate: launchDate.value, ...dates } : null);
}

function remove(): void {
  if (props.busy || reading.value) return;
  props.store.clear();
  launchDate.value = "";
  startDate.value = "";
  endDate.value = "";
  error.value = "";
}

stopSubscription = props.store.subscribe((next) => {
  attachment.value = next;
  launchDate.value = next?.manifest.window?.launchDate || "";
  startDate.value = next?.manifest.window?.startDate || "";
  endDate.value = next?.manifest.window?.endDate || "";
});

onBeforeUnmount(() => {
  stopSubscription?.();
  stopSubscription = null;
});
</script>

<template>
  <section class="agent-attachment" data-agent-attachment>
    <div
      class="agent-attachment-dropzone"
      :class="{ 'is-dragging': dragging, 'is-disabled': busy || reading }"
      data-agent-attachment-dropzone
      role="group"
      :aria-label="t('上传商家清单', 'Upload merchant list')"
      @dragenter="dragEnter"
      @dragover="dragOver"
      @dragleave="dragLeave"
      @drop="drop"
    >
      <input ref="fileInput" hidden type="file" accept=".xlsx,.xls,.csv,.tsv" :disabled="busy || reading" data-agent-attachment-input @change="choose" />
      <span class="agent-attachment-icon" aria-hidden="true">↥</span>
      <div class="agent-attachment-copy">
        <strong>{{ attachment?.manifest.fileName || t("上传推广清单", "Upload promotion list") }}</strong>
        <small>{{ reading ? t("正在读取…", "Reading…") : t("XLSX · XLS · CSV · TSV，可从文件夹拖入", "XLSX · XLS · CSV · TSV · Drop from a folder") }}</small>
      </div>
      <button type="button" class="aw-button" :disabled="busy || reading" data-agent-attachment-choose @click="fileInput?.click()">
        {{ attachment ? t("更换", "Replace") : t("选择文件", "Choose file") }}
      </button>
    </div>
    <div v-if="attachment" class="agent-attachment-chip" data-agent-attachment-chip>
      <div>
        <strong>{{ attachment.manifest.merchantCount }} {{ t("个商家", "merchants") }}</strong>
        <span> · {{ attachment.manifest.fileName }}</span>
        <small v-if="attachment.diagnostics.duplicateRows"> · {{ attachment.diagnostics.duplicateRows }} {{ t("行已合并", "duplicate rows merged") }}</small>
        <small v-if="attachment.diagnostics.invalidIdRows"> · {{ attachment.diagnostics.invalidIdRows }} {{ t("行已跳过", "rows skipped") }}</small>
      </div>
      <div class="agent-attachment-dates">
        <label class="agent-attachment-date-label">
          <span>{{ t("推送日期", "Launch date") }}</span>
          <input v-model="launchDate" type="date" data-agent-attachment-date :disabled="busy || reading" @change="setLaunchDate(launchDate)" />
        </label>
        <label class="agent-attachment-date-label">
          <span>{{ t("观察开始", "Window start") }}</span>
          <input v-model="startDate" type="date" data-agent-attachment-start :disabled="busy || reading || !launchDate" @change="setCustomWindow" />
        </label>
        <label class="agent-attachment-date-label">
          <span>{{ t("观察结束", "Window end") }}</span>
          <input v-model="endDate" type="date" data-agent-attachment-end :disabled="busy || reading || !launchDate" @change="setCustomWindow" />
        </label>
      </div>
      <button type="button" class="agent-attachment-remove" data-agent-attachment-remove :disabled="busy || reading" @click="remove">{{ t("移除", "Remove") }}</button>
    </div>
    <p v-if="attachment" class="agent-attachment-note">
      {{ attachment.manifest.window ? `${t("观察期", "Window")} ${attachment.manifest.window.startDate} — ${attachment.manifest.window.endDate}` : t("仅询问文件内容无需日期；查询推广表现前请确认日期。", "A date is optional for file facts; confirm it before querying promotion performance.") }}
    </p>
    <p v-if="error" class="agent-attachment-error" role="alert">{{ error }}</p>
  </section>
</template>
