import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Sparkles, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { confirmCheckout, createCheckout } from "@/lib/billing.functions";
import { startTrial, useEntitlements, useRefreshEntitlements } from "@/lib/entitlements";
import { CheckoutCancelled, openRazorpayCheckout } from "@/lib/razorpay-checkout";
import {
  PLAN_COPY,
  REPORT_PASS_PRICE,
  formatPrice,
  guessCurrency,
  monthlyEquivalent,
  PRICES,
  type BillingInterval,
  type Currency,
  type Product,
} from "@/lib/plans";

// ---------------------------------------------------------------------------
// Checkout hook: server creates the order (price decided server-side), the
// Razorpay modal collects payment, the server verifies + activates.
// ---------------------------------------------------------------------------

export function useCheckout() {
  const create = useServerFn(createCheckout);
  const confirm = useServerFn(confirmCheckout);
  const refresh = useRefreshEntitlements();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = useCallback(
    async (
      product: Product,
      currency: Currency,
      busyKey: string = product.kind,
    ): Promise<boolean> => {
      setBusy(busyKey);
      setError(null);
      try {
        const order = await create({ data: { product, currency } });
        if (!order.ok) throw new Error(order.error);
        const { data: auth } = await supabase.auth.getUser();
        await openRazorpayCheckout({
          keyId: order.keyId,
          orderId: order.orderId,
          amount: order.amount,
          currency: order.currency,
          description: order.description,
          email: auth.user?.email,
          confirm: (r) => confirm({ data: r }),
        });
        await refresh();
        return true;
      } catch (e) {
        if (!(e instanceof CheckoutCancelled))
          setError(e instanceof Error ? e.message : "Checkout failed.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [create, confirm, refresh],
  );

  return { buy, busy, error, setError };
}

// ---------------------------------------------------------------------------
// Upgrade dialog, opened from any paywall moment via useUpgrade().open(...)
// ---------------------------------------------------------------------------

export type UpgradeRequest = {
  title?: string;
  reason?: string;
  // Offer the one-time Report Pass (export / unlock moments).
  offerReportPass?: boolean;
  onPurchased?: () => void;
};

const UpgradeContext = createContext<{ open: (req?: UpgradeRequest) => void } | null>(null);

export function useUpgrade() {
  const ctx = useContext(UpgradeContext);
  if (!ctx) throw new Error("useUpgrade must be used inside <UpgradeProvider>");
  return ctx;
}

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<UpgradeRequest | null>(null);
  const value = useMemo(() => ({ open: (req: UpgradeRequest = {}) => setRequest(req) }), []);
  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <UpgradeDialog request={request} onClose={() => setRequest(null)} />
    </UpgradeContext.Provider>
  );
}

export function CurrencyToggle({
  currency,
  onChange,
}: {
  currency: Currency;
  onChange: (c: Currency) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-[11px] font-semibold">
      {(["INR", "USD"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`rounded-md px-2.5 py-1 ${currency === c ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
        >
          {c === "INR" ? "₹ INR" : "$ USD"}
        </button>
      ))}
    </div>
  );
}

export function IntervalToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (i: BillingInterval) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-muted p-1 text-xs font-semibold">
      {(
        [
          { key: "month", label: "Monthly" },
          { key: "year", label: "Yearly · 2 months free" },
        ] as const
      ).map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-lg px-3 py-1.5 ${interval === o.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function UpgradeDialog({
  request,
  onClose,
}: {
  request: UpgradeRequest | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: ent } = useEntitlements();
  const refresh = useRefreshEntitlements();
  const { buy, busy, error, setError } = useCheckout();
  const [currency, setCurrency] = useState<Currency>("USD");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [trialBusy, setTrialBusy] = useState(false);

  useEffect(() => setCurrency(guessCurrency()), []);
  useEffect(() => {
    if (request) setError(null);
  }, [request, setError]);

  const done = () => {
    request?.onPurchased?.();
    onClose();
  };

  const tryTrial = async () => {
    setTrialBusy(true);
    setError(null);
    try {
      await startTrial();
      await refresh();
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the trial.");
    } finally {
      setTrialBusy(false);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {request?.title ?? "Unlock the full analysis"}
          </DialogTitle>
          <DialogDescription>
            {request?.reason ?? "Pick a plan — it activates the moment payment completes."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <IntervalToggle interval={interval} onChange={setBillingInterval} />
          <CurrencyToggle currency={currency} onChange={setCurrency} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["plus", "pro"] as const).map((plan) => {
            const featured = plan === "pro";
            const perMonth = monthlyEquivalent(plan, currency, interval);
            const total = PRICES[plan][currency][interval];
            return (
              <div
                key={plan}
                className={`flex flex-col rounded-2xl border p-4 ${featured ? "border-primary bg-accent/40" : "border-border"}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-display text-base font-bold">{PLAN_COPY[plan].name}</p>
                  {featured && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="mt-2 font-display text-2xl font-bold">
                  {formatPrice(perMonth, currency)}
                  <span className="text-sm font-medium text-muted-foreground">/mo</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {interval === "year"
                    ? `${formatPrice(total, currency)} billed once for 12 months`
                    : "Billed once for 1 month"}
                </p>
                <ul className="mt-3 flex-1 space-y-1.5">
                  {PLAN_COPY[plan].features.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  variant={featured ? "default" : "outline"}
                  disabled={!!busy}
                  onClick={async () => {
                    if (await buy({ kind: "plan", plan, interval }, currency, plan)) done();
                  }}
                >
                  {busy === plan && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Get {PLAN_COPY[plan].name} — {formatPrice(total, currency)}
                </Button>
              </div>
            );
          })}
        </div>

        {request?.offerReportPass && (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Ticket className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Just need this one report?</p>
                <p className="text-xs text-muted-foreground">
                  Report Pass unlocks one saved analysis — every finding and a clean export. No
                  subscription.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={async () => {
                if (await buy({ kind: "report_pass" }, currency)) done();
              }}
            >
              {busy === "report_pass" && <Loader2 className="mr-2 size-4 animate-spin" />}
              Report Pass — {formatPrice(REPORT_PASS_PRICE[currency], currency)}
            </Button>
          </div>
        )}

        {ent?.trialAvailable && (
          <button
            type="button"
            onClick={tryTrial}
            disabled={trialBusy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold hover:border-primary"
          >
            {trialBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4 text-primary" />
            )}
            Or try Pro free for 7 days — no card needed
          </button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <p>One-time payment · no auto-renewal · UPI, cards &amp; netbanking via Razorpay</p>
          <button
            type="button"
            className="font-semibold text-foreground hover:text-primary"
            onClick={() => {
              onClose();
              navigate({ to: "/billing" });
            }}
          >
            Compare all plans →
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
