import { readonly, ref, type Ref } from "vue";

import { messagesEn } from "./messages.en";
import { messagesZh, type MessageKey } from "./messages.zh";

export type UiLanguage = "zh" | "en";
export type I18nMessageKey = MessageKey;
export type I18nMessageValues = Readonly<Record<string, string | number>>;

export interface I18nStore {
  readonly language: Readonly<Ref<UiLanguage>>;
  setLanguage(language: UiLanguage): void;
  t(key: string, fallback?: string, values?: I18nMessageValues): string;
}

export function normalizeLanguage(value: unknown): UiLanguage {
  return value === "en" ? "en" : "zh";
}

function applyMessageValues(template: string, values: I18nMessageValues): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    return value === undefined ? "" : String(value);
  });
}

export function translateMessage(
  language: UiLanguage,
  key: string,
  fallback = key,
  values: I18nMessageValues = {}
): string {
  const catalogue: Readonly<Record<string, string>> = language === "zh" ? messagesZh : messagesEn;
  return applyMessageValues(catalogue[key] ?? fallback, values);
}

export function createI18nStore(initialLanguage: UiLanguage = "zh"): I18nStore {
  const language = ref<UiLanguage>(normalizeLanguage(initialLanguage));
  return {
    language: readonly(language),
    setLanguage(nextLanguage) {
      language.value = normalizeLanguage(nextLanguage);
    },
    t(key, fallback, values) {
      return translateMessage(language.value, key, fallback, values);
    }
  };
}
