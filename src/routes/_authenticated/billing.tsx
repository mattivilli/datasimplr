import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";
import { CurrencyToggle, IntervalToggle, useCheckout } from "@/components/billing/upgrade";
import {
  startTrial,
  trialDaysLeft,
  useEntitlements,
  useRefreshEntitlements,
} from "@/lib/entitlements";
import {
  PLAN_COPY,
  PRICES,
  REPORT_PASS_PRICE,
  formatBytes,
  formatPrice,
  guessCurrency,
  monthlyEquivalent,
  planRank,
  type BillingInterval,
  type Currency,
} from "@/lib/plans";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Plan & Billing — DataSimplr Workspace" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BillingPage,
});

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function BillingPage() {
  const { data: ent, isLoading } = useEntitlements();
  const refresh = useRefreshEntitlements();
  const { buy, busy, error, setError } = useCheckout();
  const [currency, setCurrency] = useState<Currency>("USD");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [trialBusy, setTrialBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setCurrency(guessCurrency()), []);

  const { data: history } = useQuery({
    queryKey: ["billing-history", ent?.plan, ent?.reportCredits],
    enabled: !!ent?.enforced,
    queryFn: async () => {
      const [subs, credits] = await Promise.all([
        supabase
          .from("subscriptions")
          .select(
            "id, plan, source, billing_interval, seats, period_start, period_end, amount, currency, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("report_credits")
          .select("id, amount, currency, created_at, consumed_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      return { subs: subs.data ?? [], credits: credits.data ?? [] };
    },
  });

  const days = trialDaysLeft(ent);

  const purchase = async (plan: "plus" | "pro") => {
    setNotice(null);
    if (await buy({ kind: "plan", plan, interval }, currency, plan)) {
      setNotice(`You're on ${PLAN_COPY[plan].name}. Thank you!`);
    }
  };

  return (
    <WorkspaceShell title="Plan & Billing" subtitle="Your plan, usage and receipts.">
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {ent && !ent.enforced && (
        <div className="panel mb-5 p-5 text-sm text-muted-foreground">
          Billing isn't switched on yet — apply the{" "}
          <code>20260927100000_add_plans_billing_teams.sql</code> migration in Supabase. Until then
          everyone has unlimited access, as before.
        </div>
      )}

      {ent?.enforced && (
        <div className="panel mb-6 grid gap-5 p-5 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
              Current plan
            </p>
            <p className="mt-1.5 font-display text-2xl font-bold">
              {PLAN_COPY[ent.plan].name}
              {days !== null && (
                <span className="ml-2 align-middle text-sm font-semibold text-primary">
                  trial · {days}d left
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {ent.periodEnd
                ? `${days !== null ? "Trial ends" : "Paid through"} ${fmtDate(ent.periodEnd)} — no auto-renewal.`
                : "Free forever. Upgrade any time."}
            </p>
            {ent.trialAvailable && (
              <Button
                size="sm"
                className="mt-3"
                disabled={trialBusy}
                onClick={async () => {
                  setTrialBusy(true);
                  setError(null);
                  try {
                    await startTrial();
                    await refresh();
                    setNotice("Your 7-day Pro trial has started.");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not start the trial.");
                  } finally {
                    setTrialBusy(false);
                  }
                }}
              >
                {trialBusy ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 size-3.5" />
                )}
                Start 7-day Pro trial — free
              </Button>
            )}
          </div>
          <Usage
            label="Datasets this month"
            value={
              ent.limits.monthlyUploads === null
                ? `${ent.usage.uploadsThisMonth} · unlimited`
                : `${ent.usage.uploadsThisMonth} of ${ent.limits.monthlyUploads}`
            }
            pct={
              ent.limits.monthlyUploads === null
                ? 0
                : ent.usage.uploadsThisMonth / ent.limits.monthlyUploads
            }
            note={`Files up to ${formatBytes(ent.limits.maxFileBytes)}`}
          />
          <Usage
            label="Storage"
            value={`${formatBytes(ent.usage.storageBytes)} of ${formatBytes(ent.limits.storageBytes)}`}
            pct={ent.usage.storageBytes / ent.limits.storageBytes}
            note={`${ent.reportCredits} unused Report Pass${ent.reportCredits === 1 ? "" : "es"}`}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <IntervalToggle interval={interval} onChange={setBillingInterval} />
        <CurrencyToggle currency={currency} onChange={setCurrency} />
      </div>

      {notice && <p className="mb-3 text-sm font-semibold text-primary">{notice}</p>}
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PlanCard
          plan="free"
          price={formatPrice(0, currency)}
          sub="forever"
          current={ent?.plan === "free"}
        >
          <Button variant="outline" disabled className="w-full">
            {ent?.plan === "free" ? "Current plan" : "Included"}
          </Button>
        </PlanCard>

        {(["plus", "pro"] as const).map((plan) => {
          const current = ent?.plan === plan && ent.source !== "trial";
          const lower =
            !!ent && ent.enforced && planRank(ent.plan) > planRank(plan) && ent.source !== "trial";
          return (
            <PlanCard
              key={plan}
              plan={plan}
              featured={plan === "pro"}
              current={current}
              price={formatPrice(monthlyEquivalent(plan, currency, interval), currency)}
              sub={
                interval === "year"
                  ? `/mo · ${formatPrice(PRICES[plan][currency].year, currency)} per year`
                  : "/mo · billed monthly"
              }
            >
              <Button
                className="w-full"
                variant={plan === "pro" ? "default" : "outline"}
                disabled={!!busy || lower}
                onClick={() => purchase(plan)}
              >
                {busy === plan && <Loader2 className="mr-2 size-4 animate-spin" />}
                {current
                  ? "Extend"
                  : lower
                    ? "Included in your plan"
                    : `Get ${PLAN_COPY[plan].name}`}
              </Button>
            </PlanCard>
          );
        })}

        <PlanCard
          plan="team"
          current={ent?.plan === "team"}
          price={formatPrice(monthlyEquivalent("team", currency, interval), currency)}
          sub="/seat/mo · min 3 seats"
        >
          <Button asChild variant="outline" className="w-full">
            <Link to="/team">{ent?.plan === "team" ? "Manage team" : "Set up a team"}</Link>
          </Button>
        </PlanCard>
      </div>

      <div className="panel mt-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Ticket className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="text-sm font-semibold">
              Report Pass — {formatPrice(REPORT_PASS_PRICE[currency], currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              Need one clean report for tomorrow's meeting? Unlock one saved analysis — every
              finding, no watermark, no subscription.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={async () => {
            setNotice(null);
            if (await buy({ kind: "report_pass" }, currency)) {
              setNotice("Report Pass added — open any saved analysis and click Unlock.");
            }
          }}
        >
          {busy === "report_pass" && <Loader2 className="mr-2 size-4 animate-spin" />}
          Buy Report Pass
        </Button>
      </div>

      {history && (history.subs.length > 0 || history.credits.length > 0) && (
        <div className="panel mt-5 overflow-x-auto p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">History</p>
          <table className="mt-3 w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {history.subs.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-2">{fmtDate(s.created_at)}</td>
                  <td className="py-2">
                    {PLAN_COPY[s.plan as "plus" | "pro" | "team"].name}
                    {s.seats ? ` · ${s.seats} seats` : ""}
                    {s.source === "trial" ? " trial" : ""}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
                  </td>
                  <td className="py-2 text-right">
                    {s.amount && s.currency
                      ? formatPrice(s.amount, s.currency as Currency)
                      : "Free"}
                  </td>
                </tr>
              ))}
              {history.credits.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2">{fmtDate(c.created_at)}</td>
                  <td className="py-2">Report Pass {c.consumed_at ? "(used)" : "(unused)"}</td>
                  <td className="py-2 text-xs text-muted-foreground">—</td>
                  <td className="py-2 text-right">
                    {c.amount && c.currency ? formatPrice(c.amount, c.currency as Currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-5 text-xs text-muted-foreground">
        Payments are one-time via Razorpay (UPI, cards, netbanking) and never auto-renew. Buying
        again before your plan ends adds the new period on top, so you never lose days.
      </p>
    </WorkspaceShell>
  );
}

function Usage({
  label,
  value,
  pct,
  note,
}: {
  label: string;
  value: string;
  pct: number;
  note: string;
}) {
  const width = Math.min(100, Math.round(pct * 100));
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">{label}</p>
      <p className="mt-1.5 text-sm font-semibold">{value}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full ${width >= 90 ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

function PlanCard({
  plan,
  price,
  sub,
  featured,
  current,
  children,
}: {
  plan: keyof typeof PLAN_COPY;
  price: string;
  sub: string;
  featured?: boolean;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="panel flex flex-col p-5"
      style={
        featured
          ? { borderColor: "var(--primary)", boxShadow: "0 36px 80px -50px var(--glow)" }
          : undefined
      }
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">
          {PLAN_COPY[plan].name}
        </p>
        {featured && (
          <span className="rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-accent-foreground">
            Most popular
          </span>
        )}
        {current && !featured && (
          <span className="text-[10px] font-semibold text-primary">Current</span>
        )}
      </div>
      <p className="mt-4 font-display text-3xl font-bold">{price}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      <p className="mt-3 text-xs font-semibold">{PLAN_COPY[plan].tagline}</p>
      <ul className="mt-3 flex-1 space-y-2">
        {PLAN_COPY[plan].features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-5">{children}</div>
    </div>
  );
}
