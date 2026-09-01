export type ShellTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "oi-dash-theme";

export function normalizeTheme(value: unknown): ShellTheme {
  return value === "dark" ? "dark" : "light";
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> | null | undefined): ShellTheme {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function writeStoredTheme(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  theme: ShellTheme
): void {
  try {
    if (theme === "dark") {
      storage?.setItem(THEME_STORAGE_KEY, theme);
    } else {
      storage?.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // 浏览器隐私模式下 localStorage 可能不可写，主题仍保留在当前运行时。
  }
}

export function applyTheme(documentRef: Document, theme: ShellTheme): void {
  const body = documentRef.body;
  if (!body) return;
  body.dataset.oiTheme = theme;
  if (theme === "light") {
    body.dataset.dashTheme = "light";
  } else {
    delete body.dataset.dashTheme;
  }
}
