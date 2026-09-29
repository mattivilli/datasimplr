import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function useMyTeams() {
  return useQuery({
    queryKey: ["teams", "share"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, owner_id, created_at")
        .order("created_at");
      // Before the teams migration is applied the table doesn't exist — no teams.
      if (error) return [];
      return data ?? [];
    },
  });
}

// Owner-only control that moves a dataset/analysis between "private" and a team.
export function TeamShareSelect({
  table,
  rowId,
  teamId,
  onChanged,
  compact,
}: {
  table: "datasets" | "analyses";
  rowId: string;
  teamId: string | null;
  onChanged: () => void;
  compact?: boolean;
}) {
  const { data: teams } = useMyTeams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!teams) return null;
  if (!teams.length) {
    return compact ? null : (
      <Link
        to="/team"
        search={{ t: undefined }}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary"
      >
        <Users className="size-3.5" /> Create a team to share this
      </Link>
    );
  }

  const change = async (next: string) => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from(table)
      .update({ team_id: next || null })
      .eq("id", rowId);
    setBusy(false);
    if (err) setError(err.message);
    else onChanged();
  };

  return (
    <div>
      <label
        className={`flex items-center gap-2 ${compact ? "text-[11px]" : "text-xs"} font-semibold`}
      >
        <Users className="size-3.5 text-primary" />
        {!compact && "Share with"}
        <select
          value={teamId ?? ""}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-muted px-2 py-1 text-xs font-normal"
        >
          <option value="">Only me</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
