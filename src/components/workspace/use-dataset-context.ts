import { useEffect, useState } from "react";
import { getCleaningLogForDataset, type CleaningLogRow } from "@/lib/dataset-library";
import { resolveDatasetContext, type DatasetSelection, type ResolvedDatasetContext } from "@/lib/dataset-context";

type State = { ctx: ResolvedDatasetContext | null; log: CleaningLogRow[]; loading: boolean; error: string | null };

// Resolves a dataset/version/sheet pointer into real data. Repeated selections
// of the same version+sheet are served from the in-memory cache in
// dataset-context.ts, so switching back and forth doesn't re-download.
export function useDatasetContext(sel: DatasetSelection | null): State {
  const [state, setState] = useState<State>({ ctx: null, log: [], loading: false, error: null });
  const key = sel ? `${sel.datasetId}|${sel.versionId ?? ""}|${sel.sheetName ?? ""}` : "";

  useEffect(() => {
    if (!sel) {
      setState({ ctx: null, log: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const ctx = await resolveDatasetContext(sel);
        const log = await getCleaningLogForDataset(ctx.dataset.id).catch(() => []);
        if (!cancelled) setState({ ctx, log, loading: false, error: null });
      } catch (e) {
        if (!cancelled) {
          setState({ ctx: null, log: [], loading: false, error: e instanceof Error ? e.message : "Could not open that dataset." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
