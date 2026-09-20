import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell, useProfile } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — DataSimplr Workspace" },
      { name: "description", content: "Update your display name and profile picture." },
      { property: "og:title", content: "Settings — DataSimplr Workspace" },
      { property: "og:description", content: "Update your display name and profile picture." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.displayName);
      setAvatar(profile.avatarUrl ?? "");
    }
  }, [profile]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase
      .from("profiles")
      .upsert({ id: profile.id, display_name: name.trim(), avatar_url: avatar.trim() || null });
    if (err) setError(err.message);
    else {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
    setBusy(false);
  };

  return (
    <WorkspaceShell title="Settings" subtitle="Your account details.">
      <div className="max-w-xl">
        <form onSubmit={save} className="panel space-y-5 p-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={profile?.email ?? ""} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="avatar">Profile picture URL</Label>
            <Input
              id="avatar"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="https://…"
            />
          </div>

          {avatar && (
            <img src={avatar} alt="" className="size-16 rounded-full border border-border object-cover" />
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-primary">Saved.</p>}

          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save changes
          </Button>
        </form>
      </div>
    </WorkspaceShell>
  );
}
