import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, LogOut, Mail, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell, useProfile } from "@/components/workspace/shell";
import { CopyButton } from "@/components/workspace/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyToggle, IntervalToggle, useCheckout } from "@/components/billing/upgrade";
import { inviteTeammate } from "@/lib/billing.functions";
import { useEntitlements, useRefreshEntitlements } from "@/lib/entitlements";
import {
  PRICES,
  TEAM_MAX_SEATS,
  TEAM_MIN_SEATS,
  formatPrice,
  guessCurrency,
  type BillingInterval,
  type Currency,
} from "@/lib/plans";

export const Route = createFileRoute("/_authenticated/team")({
  validateSearch: (search: Record<string, unknown>): { t?: string | undefined } => ({
    t: typeof search["t"] === "string" ? search["t"] : undefined,
  }),
  head: () => ({
    meta: [{ title: "Team — DataSimplr Workspace" }, { name: "robots", content: "noindex" }],
  }),
  component: TeamPage,
});

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function TeamPage() {
  const { t } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();

  const {
    data: teams,
    isLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, owner_id, created_at")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const selected = teams?.find((x) => x.id === t) ?? teams?.[0] ?? null;

  return (
    <WorkspaceShell
      title="Team"
      subtitle="Share datasets and reports with the people you work with."
      actions={
        teams && teams.length > 1 ? (
          <select
            value={selected?.id ?? ""}
            onChange={(e) => navigate({ search: { t: e.target.value } })}
            className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold"
          >
            {teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {teamsError && (
        <p className="text-sm text-destructive">
          Teams aren't available yet — apply the billing &amp; teams migration in Supabase first.
        </p>
      )}

      {!isLoading && !teamsError && !selected && (
        <CreateTeam
          onCreated={async (id) => {
            await queryClient.invalidateQueries({ queryKey: ["teams"] });
            navigate({ search: { t: id } });
          }}
        />
      )}

      {selected && profile && <TeamDetail key={selected.id} team={selected} myId={profile.id} />}

      {selected && (
        <details className="mt-8 text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Create another team
          </summary>
          <div className="mt-3">
            <CreateTeam
              compact
              onCreated={async (id) => {
                await queryClient.invalidateQueries({ queryKey: ["teams"] });
                navigate({ search: { t: id } });
              }}
            />
          </div>
        </details>
      )}
    </WorkspaceShell>
  );
}

function CreateTeam({
  onCreated,
  compact,
}: {
  onCreated: (id: string) => void;
  compact?: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    const id = crypto.randomUUID();
    // No .select() here: the creator only becomes a member (and so can read
    // the row) once the AFTER INSERT trigger has run.
    const { error: err } = await supabase
      .from("teams")
      .insert({ id, name: name.trim(), owner_id: auth.user!.id });
    setBusy(false);
    if (err) setError(err.message);
    else onCreated(id);
  };

  return (
    <form onSubmit={create} className={compact ? "flex max-w-md gap-2" : "panel max-w-xl p-6"}>
      {!compact && (
        <>
          <Users className="size-6 text-primary" />
          <p className="mt-3 font-display text-lg font-semibold">Create your team</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite teammates, share datasets and reports, and give everyone Pro features. Try it
            free for 14 days with 3 seats.
          </p>
        </>
      )}
      <div className={compact ? "flex flex-1 gap-2" : "mt-5 flex gap-2"}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Team name, e.g. Finance Ops"
          maxLength={80}
          required
        />
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
          Create
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </form>
  );
}

type Team = { id: string; name: string; owner_id: string };

function TeamDetail({ team, myId }: { team: Team; myId: string }) {
  const queryClient = useQueryClient();
  const { data: ent } = useEntitlements();
  const refreshEnt = useRefreshEntitlements();
  const invite = useServerFn(inviteTeammate);
  const { buy, busy, error: buyError } = useCheckout();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    link: string;
    emailed: boolean;
    note: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState(TEAM_MIN_SEATS);
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [trialBusy, setTrialBusy] = useState(false);

  useEffect(() => setCurrency(guessCurrency()), []);

  const { data, isLoading } = useQuery({
    queryKey: ["team", team.id],
    queryFn: async () => {
      const [roster, sub, invites, seatsLeft] = await Promise.all([
        supabase.rpc("team_roster", { _team: team.id }),
        supabase
          .from("subscriptions")
          .select("plan, source, seats, period_end")
          .eq("team_id", team.id)
          .gt("period_end", new Date().toISOString())
          .order("seats", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("team_invites")
          .select("id, email, role, token, expires_at")
          .eq("team_id", team.id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false }),
        supabase.rpc("team_seats_available", { _team: team.id }),
      ]);
      if (roster.error) throw roster.error;
      return {
        members: roster.data ?? [],
        subscription: sub.data,
        invites: invites.data ?? [],
        seatsLeft: seatsLeft.data ?? 0,
      };
    },
  });

  const me = data?.members.find((m) => m.user_id === myId);
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  const reload = () => queryClient.invalidateQueries({ queryKey: ["team", team.id] });

  useEffect(() => {
    if (data)
      setSeats(Math.max(TEAM_MIN_SEATS, data.members.length, data.subscription?.seats ?? 0));
  }, [data]);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setInviteResult(null);
    try {
      const r = await invite({ data: { teamId: team.id, email, role } });
      if (!r.ok) throw new Error(r.error);
      setInviteResult({ link: r.link, emailed: r.emailed, note: r.emailError });
      setEmail("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invite.");
    } finally {
      setInviting(false);
    }
  };

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    const { error: err } = await fn();
    if (err) setError(err.message);
    reload();
    refreshEnt();
  };

  const sub = data?.subscription;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <div className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Team</p>
              <p className="mt-1 font-display text-xl font-bold">{team.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {sub
                  ? `${sub.source === "trial" ? "Team trial" : "Team plan"} · ${sub.seats} seats · until ${fmtDate(sub.period_end)}`
                  : "No active Team plan — members get their own plan's features."}
              </p>
            </div>
            {data && (
              <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold">
                {data.members.length} member{data.members.length === 1 ? "" : "s"} ·{" "}
                {Math.max(0, data.seatsLeft)} free seat
                {data.seatsLeft === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {isAdmin && (
          <form onSubmit={sendInvite} className="panel p-5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <UserPlus className="size-4 text-primary" /> Invite a teammate
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="flex-1"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "member" | "admin")}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit" disabled={inviting || !data || data.seatsLeft <= 0}>
                {inviting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 size-4" />
                )}
                Send invite
              </Button>
            </div>
            {data && data.seatsLeft <= 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {sub
                  ? "All seats are taken — add seats on the right to invite more people."
                  : "Start a trial or buy seats to invite people."}
              </p>
            )}
            {inviteResult && (
              <div className="mt-3 rounded-xl border border-border bg-accent/40 p-3 text-xs">
                <p className="font-semibold">
                  {inviteResult.emailed
                    ? "Invite emailed."
                    : "Invite created — send them this link:"}
                </p>
                {inviteResult.note && (
                  <p className="mt-1 text-muted-foreground">{inviteResult.note}</p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">
                    {inviteResult.link}
                  </code>
                  <CopyButton value={inviteResult.link} />
                </div>
              </div>
            )}
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="panel overflow-x-auto p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Members</p>
          {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
          <ul className="mt-3 divide-y divide-border">
            {data?.members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-accent font-mono text-[11px] text-primary">
                  {m.display_name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {m.display_name}{" "}
                    {m.user_id === myId && (
                      <span className="text-xs font-normal text-muted-foreground">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                {isAdmin && m.role !== "owner" && m.user_id !== myId ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) =>
                        act(() =>
                          supabase
                            .from("team_members")
                            .update({ role: e.target.value })
                            .eq("team_id", team.id)
                            .eq("user_id", m.user_id),
                        )
                      }
                      className="rounded-lg border border-border bg-muted px-2 py-1 text-xs"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove ${m.display_name}`}
                      onClick={() =>
                        act(() =>
                          supabase
                            .from("team_members")
                            .delete()
                            .eq("team_id", team.id)
                            .eq("user_id", m.user_id),
                        )
                      }
                      className="p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold capitalize">
                    {m.role}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {isAdmin && data && data.invites.length > 0 && (
            <>
              <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                Pending invites
              </p>
              <ul className="mt-2 divide-y divide-border">
                {data.invites.map((inv) => {
                  const expired = new Date(inv.expires_at) <= new Date();
                  return (
                    <li key={inv.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                      <span
                        className={`text-xs ${expired ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {expired ? "expired" : `expires ${fmtDate(inv.expires_at)}`}
                      </span>
                      {!expired && (
                        <CopyButton value={`${origin}/invite/${inv.token}`} label="Copy link" />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          act(() => supabase.from("team_invites").delete().eq("id", inv.id))
                        }
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Revoke
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {me && me.role !== "owner" && (
            <button
              type="button"
              onClick={() =>
                act(() =>
                  supabase.from("team_members").delete().eq("team_id", team.id).eq("user_id", myId),
                )
              }
              className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            >
              <LogOut className="size-3.5" /> Leave team
            </button>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="panel h-fit space-y-4 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
            Seats &amp; plan
          </p>

          {!sub && ent?.teamTrialAvailable && (
            <Button
              className="w-full"
              disabled={trialBusy}
              onClick={async () => {
                setTrialBusy(true);
                setError(null);
                const { error: err } = await supabase.rpc("start_team_trial", { _team: team.id });
                setTrialBusy(false);
                if (err)
                  setError(
                    err.message === "trial_unavailable"
                      ? "You've already used a team trial."
                      : err.message,
                  );
                reload();
                refreshEnt();
              }}
            >
              {trialBusy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              Start 14-day team trial · 3 seats
            </Button>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <IntervalToggle interval={interval} onChange={setBillingInterval} />
            <CurrencyToggle currency={currency} onChange={setCurrency} />
          </div>

          <label className="block text-xs font-semibold">
            Seats
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                min={Math.max(TEAM_MIN_SEATS, data?.members.length ?? 0)}
                max={TEAM_MAX_SEATS}
                value={seats}
                onChange={(e) =>
                  setSeats(
                    Math.min(TEAM_MAX_SEATS, Math.max(1, Number(e.target.value) || TEAM_MIN_SEATS)),
                  )
                }
                className="w-24"
              />
              <span className="text-xs font-normal text-muted-foreground">
                × {formatPrice(PRICES.team[currency][interval], currency)} / seat / {interval}
              </span>
            </div>
          </label>

          <Button
            className="w-full"
            disabled={!!busy || seats < Math.max(TEAM_MIN_SEATS, data?.members.length ?? 0)}
            onClick={async () => {
              if (await buy({ kind: "team", teamId: team.id, seats, interval }, currency, "team"))
                reload();
            }}
          >
            {busy === "team" && <Loader2 className="mr-2 size-4 animate-spin" />}
            {sub?.source === "razorpay" ? "Renew / change seats" : "Buy Team plan"} —{" "}
            {formatPrice(PRICES.team[currency][interval] * seats, currency)}
          </Button>
          {buyError && <p className="text-xs text-destructive">{buyError}</p>}
          <p className="text-[11px] text-muted-foreground">
            Everyone on the team gets Pro features. One-time payment, no auto-renewal.
          </p>
        </div>
      )}
    </div>
  );
}
