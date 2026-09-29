import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useUpgrade } from "@/components/billing/upgrade";
import { trialDaysLeft, useEntitlements } from "@/lib/entitlements";
import { PLAN_COPY, formatBytes } from "@/lib/plans";

function Bar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
      <div
        className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// Sidebar card: current plan, trial countdown, usage vs limits, upgrade CTA.
export function PlanMeter({ collapsed }: { collapsed: boolean }) {
  const { data: ent } = useEntitlements();
  const upgrade = useUpgrade();
  if (!ent?.enforced) return null;

  const days = trialDaysLeft(ent);
  const onTrial = days !== null;

  if (collapsed) {
    return ent.plan === "free" || onTrial ? (
      <button
        type="button"
        title="Upgrade"
        onClick={() => upgrade.open()}
        className="mx-auto mb-2 flex size-9 items-center justify-center rounded-xl bg-accent text-primary"
      >
        <Sparkles className="size-4" />
      </button>
    ) : null;
  }

  return (
    <div className="mx-3 mb-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <Link to="/billing" className="text-xs font-semibold hover:text-primary">
          {PLAN_COPY[ent.plan].name}
          {onTrial ? " trial" : " plan"}
        </Link>
        {onTrial && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary">
            {days === 0 ? "ends today" : `${days}d left`}
          </span>
        )}
      </div>

      {ent.limits.monthlyUploads !== null && (
        <div className="mt-2.5">
          <p className="flex justify-between text-[11px] text-muted-foreground">
            <span>Datasets this month</span>
            <span>
              {ent.usage.uploadsThisMonth}/{ent.limits.monthlyUploads}
            </span>
          </p>
          <Bar used={ent.usage.uploadsThisMonth} total={ent.limits.monthlyUploads} />
        </div>
      )}
      <div className="mt-2">
        <p className="flex justify-between text-[11px] text-muted-foreground">
          <span>Storage</span>
          <span>
            {formatBytes(ent.usage.storageBytes)} / {formatBytes(ent.limits.storageBytes)}
          </span>
        </p>
        <Bar used={ent.usage.storageBytes} total={ent.limits.storageBytes} />
      </div>

      {(ent.plan === "free" || onTrial) && (
        <button
          type="button"
          onClick={() =>
            upgrade.open(
              onTrial
                ? {
                    title: "Keep Pro after your trial",
                    reason: "Lock in Pro now so nothing gets downgraded when the trial ends.",
                  }
                : {},
            )
          }
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
        >
          <Sparkles className="size-3.5" />
          {onTrial ? "Keep Pro" : "Upgrade"}
        </button>
      )}
    </div>
  );
}
