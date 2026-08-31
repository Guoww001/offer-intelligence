import { describe, expect, it } from "vitest";

import { buildMonthlyNewMerchantPayload } from "./monthlyNewMerchantsModel";
import { useMonthlyNewMerchants } from "./useMonthlyNewMerchants";

describe("useMonthlyNewMerchants", () => {
  it("keeps a newer month request authoritative when an older request resolves later", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const state = useMonthlyNewMerchants({
      initialMonth: "2026-08",
      loadData: ({ month }) => new Promise((resolve) => pending.set(month, resolve))
    });

    const august = state.loadMonth();
    state.setMonth("2026-09");
    const september = state.loadMonth();
    pending.get("2026-08")?.({ records: [{ recordId: 1, merchantName: "August" }] });
    pending.get("2026-09")?.({ records: [{ recordId: 2, merchantName: "September" }] });

    await Promise.all([august, september]);
    expect(state.records.value.map((record) => record.merchantName)).toEqual(["September"]);
    expect(state.loadedMonth.value).toBe("2026-09");
    expect(state.loading.value).toBe(false);
  });

  it("surfaces API errors and saves the complete payload through the injected boundary", async () => {
    const saved: unknown[] = [];
    const state = useMonthlyNewMerchants({
      initialMonth: "2026-08",
      loadData: async () => ({ records: [] }),
      saveData: async (payload) => {
        saved.push(payload);
        return { record: { ...payload, recordId: 7, updatedAt: "2026-08-31" } };
      }
    });

    const payload = buildMonthlyNewMerchantPayload({ reportMonth: "2026-08", merchantName: "Acme" });
    expect(await state.saveRecord(payload)).toBe(true);
    expect(saved[0]).toEqual(payload);
    expect(state.records.value[0]?.recordId).toBe(7);

    const failingState = useMonthlyNewMerchants({
      initialMonth: "2026-08",
      loadData: async () => { throw new Error("database unavailable"); }
    });
    expect(await failingState.loadMonth()).toBe(false);
    expect(failingState.error.value).toBe("database unavailable");
  });

  it("updates a priority toggle and deletes through the existing API actions", async () => {
    const calls: unknown[] = [];
    const state = useMonthlyNewMerchants({
      initialMonth: "2026-08",
      records: [{ recordId: 9, reportMonth: "2026-08", merchantName: "Acme", isPriority: false }],
      loadData: async () => ({ records: [{ recordId: 9, reportMonth: "2026-08", merchantName: "Acme", isPriority: true }] }),
      saveData: async (payload) => {
        calls.push(payload);
        return { record: { ...payload, recordId: 9, isPriority: true } };
      },
      deleteData: async (recordId) => {
        calls.push({ action: "delete", recordId });
      }
    });

    expect(await state.togglePriority(state.records.value[0]!)).toBe(true);
    expect(calls[0]).toMatchObject({ action: "upsert", recordId: 9, isPriority: true });
    expect(await state.deleteRecord(state.records.value[0]!)).toBe(true);
    expect(calls[1]).toEqual({ action: "delete", recordId: 9 });
  });
});
