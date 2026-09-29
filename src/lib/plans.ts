// Single source of truth for plan names, prices and limits on the app side.
// Limits are *enforced* in Postgres (public.plan_limits in
// supabase/migrations/20260927100000_add_plans_billing_teams.sql) — keep the
// two in sync. Prices here are what the server charges: the client only ever
// sends a product key, never an amount.

export type PlanKey = "free" | "plus" | "pro" | "team";
export type PaidPlanKey = Exclude<PlanKey, "free">;
export type Currency = "INR" | "USD";
export type BillingInterval = "month" | "year";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLAN_LIMITS: Record<
  PlanKey,
  {
    monthlyUploads: number | null;
    maxFileBytes: number;
    storageBytes: number;
    insightPreview: number | null;
  }
> = {
  free: { monthlyUploads: 3, maxFileBytes: 5 * MB, storageBytes: 100 * MB, insightPreview: 3 },
  plus: { monthlyUploads: 30, maxFileBytes: 20 * MB, storageBytes: 2 * GB, insightPreview: null },
  pro: { monthlyUploads: null, maxFileBytes: 50 * MB, storageBytes: 10 * GB, insightPreview: null },
  team: {
    monthlyUploads: null,
    maxFileBytes: 50 * MB,
    storageBytes: 10 * GB,
    insightPreview: null,
  },
};

export const TEAM_MIN_SEATS = 3;
export const TEAM_MAX_SEATS = 100;

// Amounts are in the smallest currency unit (paise / cents), as Razorpay expects.
export const PRICES: Record<PaidPlanKey, Record<Currency, Record<BillingInterval, number>>> = {
  plus: { INR: { month: 299_00, year: 2_990_00 }, USD: { month: 9_00, year: 90_00 } },
  pro: { INR: { month: 799_00, year: 7_990_00 }, USD: { month: 29_00, year: 290_00 } },
  // Per seat.
  team: { INR: { month: 699_00, year: 6_990_00 }, USD: { month: 25_00, year: 250_00 } },
};

export const REPORT_PASS_PRICE: Record<Currency, number> = { INR: 199_00, USD: 7_00 };

export const PLAN_COPY: Record<PlanKey, { name: string; tagline: string; features: string[] }> = {
  free: {
    name: "Free",
    tagline: "Try it on real data",
    features: [
      "3 saved datasets / month",
      "Files up to 5 MB",
      "Top 3 insights per analysis",
      "Reports carry a watermark",
    ],
  },
  plus: {
    name: "Plus",
    tagline: "For individuals",
    features: [
      "30 saved datasets / month",
      "Files up to 20 MB",
      "Every insight, no blur",
      "Clean exports, no watermark",
      "2 GB storage",
    ],
  },
  pro: {
    name: "Pro",
    tagline: "For power users",
    features: [
      "Unlimited datasets",
      "Files up to 50 MB",
      "Every insight + anomaly detail",
      "Clean exports, no watermark",
      "10 GB storage",
      "Priority AI models",
    ],
  },
  team: {
    name: "Team",
    tagline: "For small teams",
    features: [
      "Everything in Pro for every seat",
      "Shared team workspace",
      "Share datasets & reports with teammates",
      "Invite by email, admin roles",
      `Minimum ${TEAM_MIN_SEATS} seats`,
    ],
  },
};

export function planRank(plan: PlanKey): number {
  return { free: 0, plus: 1, pro: 2, team: 3 }[plan];
}

// India gets INR (UPI, cards); everyone else sees USD.
export function guessCurrency(): Currency {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "INR";
  } catch {
    /* fall through */
  }
  return "USD";
}

export function formatPrice(minor: number, currency: Currency): string {
  const major = minor / 100;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
}

// Monthly-equivalent price, for "₹666/mo billed yearly" style labels.
export function monthlyEquivalent(
  plan: PaidPlanKey,
  currency: Currency,
  interval: BillingInterval,
): number {
  const amount = PRICES[plan][currency][interval];
  return interval === "year" ? Math.round(amount / 12) : amount;
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type QuotaReason = "file_too_large" | "monthly_limit" | "storage_full" | "not_signed_in";

export const QUOTA_MESSAGES: Record<QuotaReason, string> = {
  file_too_large: "This file is bigger than your plan allows.",
  monthly_limit: "You've used all your saved datasets for this month.",
  storage_full: "Your storage is full.",
  not_signed_in: "Sign in to save datasets.",
};

// A purchasable thing, as sent from the client to the checkout server fn.
export type Product =
  | { kind: "plan"; plan: "plus" | "pro"; interval: BillingInterval }
  | { kind: "team"; teamId: string; seats: number; interval: BillingInterval }
  | { kind: "report_pass" };

export function productAmount(product: Product, currency: Currency): number {
  switch (product.kind) {
    case "plan":
      return PRICES[product.plan][currency][product.interval];
    case "team":
      return PRICES.team[currency][product.interval] * product.seats;
    case "report_pass":
      return REPORT_PASS_PRICE[currency];
  }
}

export function productLabel(product: Product): string {
  switch (product.kind) {
    case "plan":
      return `DataSimplr ${PLAN_COPY[product.plan].name} (${product.interval === "year" ? "1 year" : "1 month"})`;
    case "team":
      return `DataSimplr Team, ${product.seats} seats (${product.interval === "year" ? "1 year" : "1 month"})`;
    case "report_pass":
      return "DataSimplr Report Pass";
  }
}
