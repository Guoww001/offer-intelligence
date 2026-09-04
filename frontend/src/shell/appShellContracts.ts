import type { ModernPageName, UiLanguage } from "../runtime/contracts";
import type { ShellTheme } from "./theme";

export interface AppShellController {
  setPage(page: ModernPageName): void;
  setLanguage(language: UiLanguage): void;
}

export interface AppShellProps {
  initialPage: ModernPageName;
  language: UiLanguage;
  navigate(page: ModernPageName): void;
  setLanguage?(language: UiLanguage): void;
  storage?: Storage | null;
  onReady?(controller: AppShellController): void;
}

export type { ShellTheme };
