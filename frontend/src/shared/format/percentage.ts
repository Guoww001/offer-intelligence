import { toFiniteNumber } from "./number";

export function formatPercentage(value: unknown): string {
  return `${toFiniteNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}%`;
}
