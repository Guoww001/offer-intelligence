import { describe, expect, it } from "vitest";

import { useGoogleAds } from "./useGoogleAds";

const payload = {
  ok: true,
  summary: {
    campaignCount: 1,
    backendMerchantCount: 1,
    spend: 10,
    revenue: 20
  },
  daily: [{ date: "2026-08-01", spend: 10, revenue: 20 }],
  merchants: [],
  campaigns: [],
  unmatchedCampaigns: []
};

describe("useGoogleAds", () => {
  it("initializes the requested quick range and loads the API once", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const ads = useGoogleAds({
      userId: "19",
      today: () => new Date("2026-08-31T12:00:00"),
      loadData: async (request) => {
        requests.push(request);
        return payload;
      }
    });

    expect(ads.startDate.value).toBe("2026-07-02");
    expect(ads.endDate.value).toBe("2026-08-30");

    await expect(ads.load()).resolves.toBe(true);
    await expect(ads.load()).resolves.toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.forceRefresh).toBe(false);
    expect(ads.payload.value?.summary.spend).toBe(10);
    expect(ads.status.value).toBe("googleAds.loaded");
  });

  it("invalidates cached data when the range changes and supports forced refresh", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const ads = useGoogleAds({
      today: () => new Date("2026-08-31T12:00:00"),
      loadData: async (request) => {
        requests.push(request);
        return payload;
      }
    });

    await ads.load();
    ads.setQuickRange(30);
    await ads.load();
    await ads.load(true);

    expect(requests).toHaveLength(3);
    expect(requests[1]?.forceRefresh).toBe(false);
    expect(requests[2]?.forceRefresh).toBe(true);
    expect(ads.quickRange.value).toBe("30");
  });

  it("maps API failures to an explicit error state", async () => {
    const ads = useGoogleAds({
      loadData: async () => {
        throw new Error("service unavailable");
      }
    });

    await expect(ads.load()).resolves.toBe(false);
    expect(ads.error.value).toBe("googleAds.error");
    expect(ads.statusKind.value).toBe("error");
  });
});
