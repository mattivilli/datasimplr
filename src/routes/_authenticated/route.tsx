import { isDevBypass } from "@/lib/dev-bypass";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { UpgradeProvider } from "@/components/billing/upgrade";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (isDevBypass()) {
      return {
        user: {
          id: "dev-user-local",
          email: "dev@datasimplr.local",
          app_metadata: {},
          user_metadata: { display_name: "Local Dev User" },
          aud: "authenticated",
          created_at: new Date().toISOString(),
        } as any,
      };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { next: location.href } });
    return { user: data.user };
  },
  component: () => (
    <UpgradeProvider>
      <Outlet />
    </UpgradeProvider>
  ),
});
