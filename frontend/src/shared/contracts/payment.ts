export const PAYMENT_STATUS_NAMES = [
  "Paid",
  "Pending",
  "Unpaid",
  "Overdue",
  "Partial",
  "Unknown"
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS_NAMES)[number];

export const PAYMENT_SORT_KEYS = [
  "merchantId",
  "merchantName",
  "network",
  "region",
  "tier",
  "reportMonth",
  "paymentStatus",
  "revenueMade",
  "commissionMade",
  "paymentCycle",
  "expectedPaymentDate",
  "paymentMadeDate"
] as const;

export type PaymentSortKey = "" | (typeof PAYMENT_SORT_KEYS)[number];

export interface PaymentRecord {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly network: string;
  readonly region: string;
  readonly tier: string;
  readonly category: string;
  readonly mainCategory: string;
  readonly subCategory: string;
  readonly reportMonth: string;
  readonly reportYear: number;
  readonly reportMonthKey: string;
  readonly revenueMade: number;
  readonly commissionMade: number;
  readonly expectedPaymentAmount: number;
  readonly paidAmount: number;
  readonly remainingAmount: number;
  readonly paymentCycle: number;
  readonly paymentStatus: PaymentStatus;
  readonly rawStatus: string;
  readonly expectedPaymentDate: string;
  readonly paymentAvailabilityDate: string;
  readonly paymentMadeDate: string;
  readonly lastCheckedDate: string;
  readonly currency: string;
  readonly isPlaceholder: boolean;
  readonly notes: string;
}

export interface PaymentRecordIdentity {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly month: string;
  readonly status: PaymentStatus;
  readonly tier?: string;
}

export interface PaymentFilters {
  readonly month: string;
  readonly network: string;
  readonly region: string;
  readonly tier: string;
  readonly status: PaymentStatus | "all";
  readonly search: string;
}

export interface PaymentSort {
  readonly key: PaymentSortKey;
  readonly direction: "asc" | "desc";
}

export interface PaymentLivePayload {
  readonly records: readonly unknown[];
  readonly checkedAt?: string;
}

export interface PaymentExportPayload {
  readonly rows: readonly PaymentRecord[];
  readonly filters: PaymentFilters;
  readonly sort: PaymentSort;
}

export interface PaymentSummary {
  readonly recordCount: number;
  readonly merchantCount: number;
  readonly totalRevenueMade: number;
  readonly totalCommissionMade: number;
  readonly totalPaidAmount: number;
  readonly totalRemainingAmount: number;
  readonly paidMerchantCount: number;
  readonly pendingMerchantCount: number;
  readonly unpaidMerchantCount: number;
  readonly overdueMerchantCount: number;
  readonly overdueCount: number;
  readonly paymentRate: number;
  readonly paidCount: number;
  readonly outstandingCount: number;
}
