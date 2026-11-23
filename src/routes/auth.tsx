import { DEV_BYPASS_AVAILABLE, enableDevBypass, isDevBypass } from "@/lib/dev-bypass";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, MailCheck, Sparkles, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LogoMark } from "@/components/ds/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const title = "Sign in — DataSimplr Workspace";
const description =
  "Sign in to your DataSimplr workspace to keep your AI chats, saved analyses and uploaded datasets in one place.";

// Only same-site paths, so ?next= can't bounce users to another domain.
function safeNext(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : undefined;
}

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { next?: string | undefined; mode?: "signup" | undefined } => ({
    next: safeNext(search["next"]),
    mode: search["mode"] === "signup" ? "signup" : undefined,
  }),
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const next = search.next ?? "/dashboard";
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // If dev bypass active, navigate directly to workspace
    if (isDevBypass()) {
      navigate({ href: next, replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ href: next, replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        navigate({ href: next, replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, next]);

  const handleDevBypass = () => {
    enableDevBypass();
    navigate({ href: next, replace: true });
  };

  const handleResend = async () => {
    if (!email.trim()) {
      setError("Please enter your email address to resend verification.");
      return;
    }
    setResendBusy(true);
    setError(null);
    setResendSuccess(null);
    try {
      const { error: err } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}${next}`,
        },
      });
      if (err) throw err;
      setResendSuccess("Verification email resent! Please check your Inbox and Spam/Junk folder.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend confirmation email.");
    } finally {
      setResendBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResendSuccess(null);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${next}`,
            data: { display_name: name.trim() || email.split("@")[0] },
          },
        });
        if (err) throw err;
        if (!data.session) {
          setSent(true);
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div className="absolute inset-0 grid-bg opacity-50" aria-hidden />
      <div className="relative w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <LogoMark />
          <span className="font-display text-lg font-bold tracking-tight">DataSimplr</span>
        </Link>

        {/* Local Dev 1-Click Fast Bypass Banner — dev builds only */}
        {DEV_BYPASS_AVAILABLE && (<div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> Local Dev / Quick Test
            </span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Instant
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Bypass email verification to test AI Chat, Plan Traceability, Executive Brief, and Document Studio immediately.
          </p>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleDevBypass}
            className="mt-3 w-full gap-2 font-medium"
          >
            <Zap className="size-4" /> Continue as Dev User (1-Click)
          </Button>
        </div>)}

        <div className="panel p-7">
          {sent ? (
            <div className="text-center">
              <MailCheck className="mx-auto size-8 text-primary" />
              <h1 className="mt-4 font-display text-xl font-bold">Confirm your email</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>.
                Click it to land straight in your workspace.
              </p>

              {resendSuccess && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span>{resendSuccess}</span>
                </div>
              )}

              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

              <div className="mt-5 space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={resendBusy}
                  onClick={handleResend}
                  className="w-full gap-1.5"
                >
                  {resendBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                  Resend confirmation email
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDevBypass}
                  className="w-full text-xs text-primary hover:text-primary"
                >
                  Or enter workspace right now with Dev Bypass →
                </Button>
              </div>

              <button
                onClick={() => {
                  setSent(false);
                  setMode("signin");
                }}
                className="mt-6 block w-full text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
            <>
              <span className="eyebrow">Workspace</span>
              <h1 className="mt-3 font-display text-2xl font-bold">
                {mode === "signin" ? "Welcome back" : "Create your workspace"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === "signin"
                  ? "Your saved chats, analyses and datasets are waiting."
                  : "Save every chat and analysis in one private place."}
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                {mode === "signup" && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Display name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Mahesh A"
                      autoComplete="name"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  />
                </div>

                {resendSuccess && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span>{resendSuccess}</span>
                  </div>
                )}

                {error && (
                  <div className="space-y-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                    <p>{error}</p>
                    {error.toLowerCase().includes("confirm") || error.toLowerCase().includes("credentials") ? (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={handleResend}
                          disabled={resendBusy}
                          className="font-semibold underline hover:opacity-80"
                        >
                          {resendBusy ? "Resending…" : "Resend confirmation email"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}

                <Button type="submit" disabled={busy} className="w-full">
                  {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {mode === "signin" ? "Sign in" : "Create account"}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-muted-foreground">
                {mode === "signin" ? "New to DataSimplr?" : "Already have an account?"}{" "}
                <button
                  onClick={() => {
                    setMode(mode === "signin" ? "signup" : "signin");
                    setError(null);
                    setResendSuccess(null);
                  }}
                  className="text-primary hover:underline"
                >
                  {mode === "signin" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Back to the landing page
          </Link>
        </p>
      </div>
    </div>
  );
}
