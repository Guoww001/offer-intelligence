import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import AppShell from "./AppShell.vue";
import type { AppShellController } from "./appShellContracts";

function storageFixture(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  } as Storage;
}

describe("AppShell", () => {
  it("收起后保留分组名称，点击分组展开对应页面，选中状态不丢失", async () => {
    const navigate = vi.fn();
    const wrapper = mount(AppShell, { props: { initialPage: "agent", userLevel: 0, language: "zh", navigate, storage: storageFixture() } });
    await wrapper.get("[data-shell-dock]").trigger("click");
    expect(wrapper.get(".modern-shell").classes()).toContain("is-docked");
    expect(wrapper.get('[data-shell-group="workspace"] button').attributes("aria-label")).toBe("工作台");
    expect(wrapper.get('[data-shell-group="workspace"] button').attributes("aria-expanded")).toBe("false");
    expect(wrapper.get('[data-shell-nav-page="agent"]').attributes("aria-current")).toBe("page");
    await wrapper.get('[data-shell-group="merchants"] button').trigger("click");
    expect(wrapper.get(".modern-shell").classes()).not.toContain("is-docked");
    expect(wrapper.get('[data-shell-group="merchants"] button').attributes("aria-expanded")).toBe("true");
    await wrapper.get('[data-shell-nav-page="payments"]').trigger("click");
    expect(navigate).toHaveBeenCalledWith("payments");
    expect(wrapper.get('[data-shell-nav-page="payments"]').attributes("aria-current")).toBe("page");
    wrapper.unmount();
  });

  it("桌面收缩时显示电源图标，点击 YP Logo 可重新展开侧边栏", async () => {
    const wrapper = mount(AppShell, { props: { initialPage: "agent", userLevel: 0, language: "zh", navigate: vi.fn(), storage: storageFixture() } });

    await wrapper.get("[data-shell-dock]").trigger("click");

    expect(wrapper.find('[data-shell-logout-icon="power"]').exists()).toBe(true);
    expect(wrapper.find('[data-shell-logout-icon="sign-out"]').exists()).toBe(false);
    expect(wrapper.get("[data-shell-brand-expand]").attributes("aria-label")).toBe("展开导航面板");

    await wrapper.get("[data-shell-brand-expand]").trigger("click");

    expect(wrapper.get(".modern-shell").classes()).not.toContain("is-docked");
    expect(wrapper.find('[data-shell-logout-icon="sign-out"]').exists()).toBe(true);
    expect(wrapper.find('[data-shell-logout-icon="power"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("移动端导航在选择页面后解除工作区 inert，并将焦点还给菜单按钮", async () => {
    const query = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("matchMedia", query);
    const workspace = document.createElement("main");
    workspace.setAttribute("data-modern-workspace", "true");
    document.body.append(workspace);
    const wrapper = mount(AppShell, { attachTo: document.body, props: { initialPage: "agent", userLevel: 0, language: "en", navigate: vi.fn(), storage: storageFixture() } });
    try {
      await nextTick();
      expect(query).toHaveBeenCalledWith("(max-width: 960px)");
      await wrapper.get(".modern-shell-menu-trigger").trigger("click");
      await nextTick();
      expect(workspace.inert).toBe(true);
      expect(document.activeElement).toBe(wrapper.get(".modern-shell-close").element);
      await wrapper.get('[data-shell-nav-page="dashboard"]').trigger("click");
      await nextTick();
      expect(workspace.inert).toBe(false);
      expect(workspace.hasAttribute("aria-hidden")).toBe(false);
      expect(document.activeElement).toBe(wrapper.get(".modern-shell-menu-trigger").element);
      expect(wrapper.get(".modern-shell-sidebar").attributes("inert")).toBeDefined();
    } finally {
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("渲染统一导航、语言/主题/退出入口并委托页面切换", async () => {
    const navigate = vi.fn();
    const setLanguage = vi.fn();
    const ready = vi.fn();
    const wrapper = mount(AppShell, {
      props: {
        initialPage: "agent",
        userLevel: 0,
        language: "zh",
        navigate,
        setLanguage,
        onReady: ready,
        storage: storageFixture()
      }
    });

    expect(wrapper.find(".modern-shell-sidebar").exists()).toBe(true);
    expect(wrapper.find('[data-shell-nav-page="tier"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-shell-nav-page="tier"]')).toHaveLength(1);
    expect(wrapper.find("#modernLogoutButton").exists()).toBe(true);
    expect(document.title).toBe("Agent · YeahPromos");
    expect(document.documentElement.lang).toBe("zh-Hans");

    await wrapper.find('[data-shell-nav-page="payments"]').trigger("click");
    expect(navigate).toHaveBeenCalledWith("payments");
    await wrapper.find("[data-shell-language]").trigger("click");
    expect(setLanguage).toHaveBeenCalledWith("en");
  });

  it("通过 Shell controller 同步页面标题，并切换持久化主题", async () => {
    const ready = vi.fn();
    const wrapper = mount(AppShell, {
      props: {
        initialPage: "agent",
        userLevel: 0,
        language: "en",
        navigate: vi.fn(),
        onReady: ready,
        storage: storageFixture()
      }
    });
    const controller = ready.mock.calls[0]?.[0] as AppShellController;

    controller.setPage("category");
    await nextTick();
    expect(document.title).toBe("Category · YeahPromos");

    await wrapper.find("[data-shell-theme]").trigger("click");
    expect(document.body.dataset.oiTheme).toBe("dark");
    expect(wrapper.find(".modern-shell").attributes("data-theme")).toBe("dark");
  });

  it("按 level 2 只展示 Google Ads，并将非法初始页纠正到默认页", () => {
    const navigate = vi.fn();
    const wrapper = mount(AppShell, {
      props: {
        initialPage: "agent",
        userLevel: 2,
        language: "zh",
        navigate,
        storage: storageFixture()
      }
    });

    expect(wrapper.find('[data-shell-nav-page="google-ads"]').exists()).toBe(true);
    expect(wrapper.find('[data-shell-nav-page="agent"]').exists()).toBe(false);
    expect(wrapper.find('[data-shell-nav-page="payments"]').exists()).toBe(false);
    expect(wrapper.find(".modern-shell").attributes("data-page")).toBe("google-ads");
    expect(navigate).not.toHaveBeenCalled();
  });
});
