import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ChevronLeft, ChevronRight, FileText, HelpCircle, LogOut, Menu, MessageSquare, Settings, Upload, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/ds/theme-toggle";
import { ScrollTop } from "@/components/workspace/scroll-top";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { to: "/chat", label: "AI Chat", icon: MessageSquare },
  { to: "/analyze", label: "Upload & Analyze", icon: Upload },
  { to: "/analyses", label: "Past Analyses", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: HelpCircle },
] as const;

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", auth.user.id)
        .maybeSingle();
      return {
        id: auth.user.id,
        email: auth.user.email ?? "",
        displayName: data?.display_name ?? auth.user.email?.split("@")[0] ?? "You",
        avatarUrl: data?.avatar_url ?? null,
      };
    },
  });
}

export function WorkspaceShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: profile } = useProfile();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    setCollapsed(localStorage.getItem("ds_nav_collapsed") === "1");
  }, []);

  const toggleNav = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("ds_nav_collapsed", next ? "1" : "0");
      return next;
    });
  };

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const initials = (profile?.displayName ?? "Y").slice(0, 2).toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link to="/dashboard" className={`flex items-center gap-2 py-5 ${collapsed ? "justify-center px-2" : "px-5"}`}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Zap className="size-4 text-primary-foreground" />
        </span>
        {!collapsed && <span className="font-display text-base font-bold tracking-tight">DataSimplr</span>}
      </Link>

      <nav className="flex-1 space-y-1 px-2">
        {nav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              title={item.label}
              className={`flex items-center rounded-xl py-2.5 text-sm transition-colors ${
                collapsed ? "justify-center px-2" : "gap-3 px-3"
              } ${
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-full bg-accent font-mono text-[11px] text-primary">
              {initials}
            </span>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-semibold">{profile?.displayName ?? "…"}</p>
              <p className="truncate text-[11px] text-muted-foreground">{profile?.email}</p>
            </div>
          )}
          <button onClick={signOut} aria-label="Sign out" className="p-1 text-subtle hover:text-foreground">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-border bg-muted/40 transition-[width] duration-200 lg:block ${
          collapsed ? "w-[4.25rem]" : "w-64"
        }`}
      >
        {sidebar}
        <button
          type="button"
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          onClick={toggleNav}
          className="absolute -right-3 top-20 z-50 flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:border-primary hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </button>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-background/80" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-background">
            {sidebar}
          </aside>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[4.25rem]" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
          <button
            aria-label="Menu"
            onClick={() => setOpen(true)}
            className="p-1 text-muted-foreground lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex max-w-[58%] shrink-0 flex-wrap items-center justify-end gap-2 sm:max-w-none">
            {actions}
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 px-4 py-5 sm:px-5 sm:py-7 lg:px-8">
          {children}
          <ScrollTop />
        </main>
      </div>
    </div>
  );
}
