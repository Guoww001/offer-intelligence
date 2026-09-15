import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AgentAttachment from "./AgentAttachment.vue";
import { createAgentAttachmentStore } from "./agentAttachment";

describe("AgentAttachment", () => {
  it("accepts one dropped merchant file and shows the parsed merchant count", async () => {
    const store = createAgentAttachmentStore();
    const wrapper = mount(AgentAttachment, {
      props: {
        language: "zh",
        store,
        readFile: vi.fn(async () => [[["Merchant ID", "Merchant Name"], ["not-an-id", "Skipped"], ["101", "First"]]])
      }
    });
    const file = new File(["Merchant ID,Merchant Name\n101,First"], "campaign.csv");
    const dataTransfer = { types: ["Files"], files: [file], items: [{ kind: "file" }] };
    await wrapper.get('[data-agent-attachment-dropzone]').trigger("drop", { dataTransfer });

    expect(wrapper.find('[data-agent-attachment-chip]').exists()).toBe(true);
    expect(wrapper.find('[data-agent-attachment-chip]').text()).toContain("1");
    expect(wrapper.find('[data-agent-attachment-chip]').text()).toContain("1 行已跳过");
    expect(store.get()?.manifest.fileName).toBe("campaign.csv");
  });

  it("sets the confirmed launch window and removes the attachment", async () => {
    const store = createAgentAttachmentStore();
    const wrapper = mount(AgentAttachment, {
      props: {
        language: "en",
        store,
        readFile: vi.fn(async () => [[["Merchant ID", "Merchant Name"], ["101", "First"]]])
      }
    });
    const file = new File(["Merchant ID,Merchant Name\n101,First"], "campaign.csv");
    await wrapper.get('[data-agent-attachment-dropzone]').trigger("drop", { dataTransfer: { types: ["Files"], files: [file], items: [{ kind: "file" }] } });
    const date = wrapper.get('[data-agent-attachment-date]');
    await date.setValue("2026-09-07");
    expect(store.get()?.manifest.window).toMatchObject({ launchDate: "2026-09-07", startDate: "2026-09-07", endDate: "2026-09-13" });

    await wrapper.get('[data-agent-attachment-start]').setValue("2026-09-10");
    await wrapper.get('[data-agent-attachment-end]').setValue("2026-09-16");
    expect(store.get()?.manifest.window).toMatchObject({ startDate: "2026-09-10", endDate: "2026-09-16", beforeStart: "2026-08-31", beforeEnd: "2026-09-06", days: 7 });

    await wrapper.get('[data-agent-attachment-remove]').trigger("click");
    expect(store.get()).toBeNull();
  });

  it("does not hijack a plain text drop", () => {
    const store = createAgentAttachmentStore();
    const readFile = vi.fn(async () => [[['Merchant ID', 'Merchant Name'], ['101', 'First']]]);
    const wrapper = mount(AgentAttachment, { props: { language: "zh", store, readFile } });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["text/plain"], files: [], items: [] },
    });

    wrapper.get('[data-agent-attachment-dropzone]').element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
    expect(store.get()).toBeNull();
  });
});
