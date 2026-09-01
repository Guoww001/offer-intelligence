import { ref, type Ref } from "vue";

import type { ModernPageName } from "../legacy/contracts";
import { navigationGroupForPage, type NavigationLocation } from "./navigation";

export interface PageState {
  readonly currentPage: Ref<ModernPageName>;
  readonly openGroup: Ref<NavigationLocation | null>;
  readonly isCompact: Ref<boolean>;
  readonly isMenuOpen: Ref<boolean>;
  setPage(page: ModernPageName): void;
  setCompact(compact: boolean): void;
  toggleGroup(group: NavigationLocation): void;
  openMenu(): void;
  closeMenu(): void;
  toggleMenu(): void;
  handleKeydown(
    event: KeyboardEvent,
    focusable: readonly HTMLElement[],
    restoreFocus: HTMLElement | null
  ): boolean;
}

function focusElement(element: HTMLElement | null | undefined): void {
  element?.focus({ preventScroll: true });
}

export function usePageState(initialPage: ModernPageName): PageState {
  const currentPage = ref<ModernPageName>(initialPage);
  const openGroup = ref<NavigationLocation | null>(navigationGroupForPage(initialPage));
  const isCompact = ref(false);
  const isMenuOpen = ref(false);

  function setPage(page: ModernPageName): void {
    currentPage.value = page;
    openGroup.value = navigationGroupForPage(page);
    isMenuOpen.value = false;
  }

  function setCompact(compact: boolean): void {
    isCompact.value = compact;
    if (!compact) isMenuOpen.value = false;
  }

  function toggleGroup(group: NavigationLocation): void {
    if (openGroup.value === group) {
      openGroup.value = navigationGroupForPage(currentPage.value) === group ? group : null;
      return;
    }
    openGroup.value = group;
  }

  function openMenu(): void {
    if (isCompact.value) isMenuOpen.value = true;
  }

  function closeMenu(): void {
    isMenuOpen.value = false;
  }

  function toggleMenu(): void {
    if (!isCompact.value) return;
    isMenuOpen.value = !isMenuOpen.value;
  }

  function handleKeydown(
    event: KeyboardEvent,
    focusable: readonly HTMLElement[],
    restoreFocus: HTMLElement | null
  ): boolean {
    if (!isCompact.value || !isMenuOpen.value) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      focusElement(restoreFocus);
      return true;
    }
    if (event.key !== "Tab") return false;
    if (!focusable.length) {
      event.preventDefault();
      return true;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      focusElement(last);
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      focusElement(first);
    }
    return true;
  }

  return {
    currentPage,
    openGroup,
    isCompact,
    isMenuOpen,
    setPage,
    setCompact,
    toggleGroup,
    openMenu,
    closeMenu,
    toggleMenu,
    handleKeydown
  };
}
