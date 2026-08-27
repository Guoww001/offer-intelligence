import type { TierName } from "./tier";

export const PAYMENT_STATUS_NAMES = [
  "Paid",
  "Pending",
  "Unpaid",
  "Overdue",
  "Partial"
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS_NAMES)[number];

export interface PaymentRecordIdentity {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly month: string;
  readonly status: PaymentStatus;
  readonly tier?: TierName;
}

export interface PaymentSummary {
  readonly recordCount: number;
  readonly merchantCount: number;
  readonly paidCount: number;
  readonly outstandingCount: number;
}
