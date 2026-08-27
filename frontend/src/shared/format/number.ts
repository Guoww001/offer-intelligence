export function toNullableNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  return toNullableNumber(value) ?? fallback;
}

export function formatInteger(value: unknown): string {
  return toFiniteNumber(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
