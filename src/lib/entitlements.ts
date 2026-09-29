import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PLAN_LIMITS, type PlanKey, type QuotaReason } from "@/lib/plans";

export type Entitlements = {
  plan: PlanKey;
  source: "trial" | "razorpay" | "manual" | null;
  teamId: string | null;
  periodEnd: string | null;
  trialAvailable: boolean;
  teamTrialAvailable: boolean;
  limits: { monthlyUploads: number | null; maxFileBytes: number; storageBytes: number };
  usage: { uploadsThisMonth: number; storageBytes: number };
  reportCredits: number;
  // False until the billing migration has been applied — the app then
  // behaves exactly as it did before (no limits, no paywalls).
  enforced: boolean;
};

type RawEntitlements = {
  plan: PlanKey;
  source: Entitlements["source"];
  team_id: string | null;
  period_end: string | null;
  trial_available: boolean;
  team_trial_available: boolean;
  limits: { monthly_uploads: number | null; max_file_bytes: number; storage_bytes: number };
  usage: { uploads_this_month: number; storage_bytes: number };
  report_credits: number;
};

const UNENFORCED: Entitlements = {
  plan: "free",
  source: null,
  teamId: null,
  periodEnd: null,
  trialAvailable: false,
  teamTrialAvailable: false,
  limits: {
    monthlyUploads: null,
    maxFileBytes: PLAN_LIMITS.pro.maxFileBytes,
    storageBytes: PLAN_LIMITS.pro.storageBytes,
  },
  usage: { uploadsThisMonth: 0, storageBytes: 0 },
  reportCredits: 0,
  enforced: false,
};

function fromRaw(raw: RawEntitlements): Entitlements {
  return {
    plan: raw.plan,
    source: raw.source,
    teamId: raw.team_id,
    periodEnd: raw.period_end,
    trialAvailable: raw.trial_available,
    teamTrialAvailable: raw.team_trial_available,
    limits: {
      monthlyUploads: raw.limits.monthly_uploads,
      maxFileBytes: raw.limits.max_file_bytes,
      storageBytes: raw.limits.storage_bytes,
    },
    usage: {
      uploadsThisMonth: raw.usage.uploads_this_month,
      storageBytes: raw.usage.storage_bytes,
    },
    reportCredits: raw.report_credits,
    enforced: true,
  };
}

// PGRST202 = function not found (migration not applied yet).
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

export async function fetchEntitlements(): Promise<Entitlements | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.rpc("get_entitlements");
  if (error) {
    if (isMissingFunction(error)) return UNENFORCED;
    throw error;
  }
  return data ? fromRaw(data as unknown as RawEntitlements) : null;
}

export function useEntitlements() {
  return useQuery({ queryKey: ["entitlements"], queryFn: fetchEntitlements, staleTime: 30_000 });
}

export function useRefreshEntitlements() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["entitlements"] });
}

export function isPaid(e: Entitlements | null | undefined): boolean {
  return !e?.enforced || e.plan !== "free";
}

export function trialDaysLeft(e: Entitlements | null | undefined): number | null {
  if (!e?.periodEnd || e.source !== "trial") return null;
  return Math.max(0, Math.ceil((new Date(e.periodEnd).getTime() - Date.now()) / 86_400_000));
}

// Asks Postgres the same question the datasets insert policy will, so the UI
// can show an upgrade prompt instead of a raw RLS error.
export async function checkDatasetQuota(fileSize: number): Promise<QuotaReason | null> {
  const { data, error } = await supabase.rpc("check_dataset_quota", { _file_size: fileSize });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return (data as QuotaReason | null) ?? null;
}

export async function startTrial(): Promise<void> {
  const { error } = await supabase.rpc("start_trial");
  if (error)
    throw new Error(
      error.message === "trial_unavailable"
        ? "Your free trial has already been used."
        : error.message,
    );
}
