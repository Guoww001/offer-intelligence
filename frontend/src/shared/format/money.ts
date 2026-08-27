import { toFiniteNumber } from "./number";

export function formatMoney(value: unknown, currency = "$"): string {
  return `${currency}${toFiniteNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}
