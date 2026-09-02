import { ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import { buildChatbotReport } from "./chatbotReportModel";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

type OfferRow = Readonly<Record<string, unknown>>;

export interface ChatbotReportController {
  readonly prompt: Ref<string>;
  readonly result: Ref<ChatbotReportViewResult | null>;
  readonly loading: Ref<boolean>;
  readonly hasError: Ref<boolean>;
  submit(): Promise<ChatbotReportViewResult | null>;
  reset(): void;
}

export function useChatbotReport(
  offers: MaybeRefOrGetter<readonly OfferRow[]>,
  language: MaybeRefOrGetter<UiLanguage>
): ChatbotReportController {
  const prompt = ref("");
  const result = ref<ChatbotReportViewResult | null>(null);
  const loading = ref(false);
  const hasError = ref(false);

  async function submit(): Promise<ChatbotReportViewResult | null> {
    const query = prompt.value.trim();
    if (!query || loading.value) return result.value;
    loading.value = true;
    hasError.value = false;
    try {
      const next = buildChatbotReport(query, { offers: toValue(offers) }, toValue(language));
      result.value = next;
      return next;
    } catch {
      hasError.value = true;
      return null;
    } finally {
      loading.value = false;
    }
  }

  function reset(): void {
    prompt.value = "";
    result.value = null;
    loading.value = false;
    hasError.value = false;
  }

  return { prompt, result, loading, hasError, submit, reset };
}
