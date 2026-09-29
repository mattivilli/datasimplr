import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LogoMark } from "@/components/ds/logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Team invite — DataSimplr" }, { name: "robots", content: "noindex" }],
  }),
  component: InvitePage,
});

const ERRORS: Record<string, string> = {
  invite_email_mismatch:
    "This invite was sent to a different email. Sign in with that address to accept it.",
  invite_expired: "This invite has expired. Ask your teammate to send a new one.",
  invite_used: "This invite has already been used.",
  invite_not_found: "This invite link isn't valid.",
};

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  const { data: invite, isLoading } = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc("get_invite", { _token: token });
      if (err) throw err;
      return data?.[0] ?? null;
    },
  });

  const next = `/invite/${token}`;

  const accept = async () => {
    setBusy(true);
    setError(null);
    const { data: teamId, error: err } = await supabase.rpc("accept_team_invite", {
      _token: token,
    });
    setBusy(false);
    if (err) {
      setError(ERRORS[err.message] ?? err.message);
      return;
    }
    navigate({ to: "/team", search: { t: teamId } });
  };

  const signOutAndSwitch = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next } });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-md p-7">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-display text-base font-bold">DataSimplr</span>
        </Link>

        {(isLoading || userEmail === undefined) && (
          <Loader2 className="mt-8 size-5 animate-spin text-primary" />
        )}

        {!isLoading && !invite && (
          <p className="mt-8 text-sm text-destructive">{ERRORS["invite_not_found"]}</p>
        )}

        {invite && userEmail !== undefined && (
          <>
            <Users className="mt-8 size-7 text-primary" />
            <h1 className="mt-3 font-display text-xl font-bold">Join {invite.team_name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {invite.inviter_name} invited{" "}
              <span className="font-semibold text-foreground">{invite.email}</span> to their
              DataSimplr team as {invite.role === "admin" ? "an admin" : "a member"}. You'll see the
              datasets and reports they share, and get Pro features while the team plan is active.
            </p>

            {invite.accepted && (
              <p className="mt-5 text-sm text-muted-foreground">{ERRORS["invite_used"]}</p>
            )}
            {!invite.accepted && invite.expired && (
              <p className="mt-5 text-sm text-destructive">{ERRORS["invite_expired"]}</p>
            )}

            {!invite.accepted && !invite.expired && (
              <div className="mt-6 space-y-3">
                {userEmail === null ? (
                  <>
                    <Button asChild className="w-full">
                      <Link to="/auth" search={{ next, mode: "signup" }}>
                        Create account with {invite.email}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full">
                      <Link to="/auth" search={{ next }}>
                        I already have an account
                      </Link>
                    </Button>
                  </>
                ) : userEmail.toLowerCase() === invite.email ? (
                  <Button className="w-full" onClick={accept} disabled={busy}>
                    {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Accept invite
                  </Button>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      You're signed in as{" "}
                      <span className="font-semibold text-foreground">{userEmail}</span>. This
                      invite is for {invite.email}.
                    </p>
                    <Button variant="outline" className="w-full" onClick={signOutAndSwitch}>
                      Switch account
                    </Button>
                  </>
                )}
              </div>
            )}
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
