import { describe, expect, it } from "vitest";

import { applyTheme, normalizeTheme, readStoredTheme, writeStoredTheme } from "./theme";

describe("共享 Shell 主题", () => {
  it("默认浅色，并只接受 dark 存储值", () => {
    const storage = {
      getItem: (key: string) => key === "oi-dash-theme" ? "dark" : null
    } as Storage;

    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("other")).toBe("light");
    expect(readStoredTheme(storage)).toBe("dark");
    expect(readStoredTheme(null)).toBe("light");
  });

  it("持久化主题并同步 legacy 与 modern 的 body 标记", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }
    } as Storage;
    const documentRef = document.implementation.createHTMLDocument("shell");

    writeStoredTheme(storage, "dark");
    expect(values.get("oi-dash-theme")).toBe("dark");
    applyTheme(documentRef, "dark");
    expect(documentRef.body.dataset.oiTheme).toBe("dark");
    expect(documentRef.body.dataset.dashTheme).toBeUndefined();

    writeStoredTheme(storage, "light");
    applyTheme(documentRef, "light");
    expect(values.has("oi-dash-theme")).toBe(false);
    expect(documentRef.body.dataset.oiTheme).toBe("light");
    expect(documentRef.body.dataset.dashTheme).toBe("light");
  });
});
