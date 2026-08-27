export const TIER_NAMES = [
  "Tier 1",
  "Tier 2",
  "Tier 3",
  "Tier 4",
  "BLACK TIER"
] as const;

export type TierName = (typeof TIER_NAMES)[number];

export function isTierName(value: unknown): value is TierName {
  return typeof value === "string" && (TIER_NAMES as readonly string[]).includes(value);
}
