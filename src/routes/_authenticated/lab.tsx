import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceShell } from "@/components/workspace/shell";
import { PythonLab } from "@/components/workspace/python-lab";
import { DatasetContextBar } from "@/components/workspace/dataset-context-bar";
import { useDatasetContext } from "@/components/workspace/use-dataset-context";
import {
  PY_MAX_ROWS,
  pythonInputs,
  stashExplain,
  takeLabHandoff,
  type DatasetSelection,
  type ExplainPayload,
  type LabHandoff,
} from "@/lib/dataset-context";

export const Route = createFileRoute("/_authenticated/lab")({
  validateSearch: (search: Record<string, unknown>) => ({
    dataset: typeof search["dataset"] === "string" ? search["dataset"] : undefined,
    version: typeof search["version"] === "string" ? search["version"] : undefined,
    sheet: typeof search["sheet"] === "string" ? search["sheet"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "PythonLab — DataSimplr Workspace" },
      { name: "description", content: "Run pandas and matplotlib in your browser on a saved dataset." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LabPage,
});

function LabPage() {
  const { dataset, version, sheet } = Route.useSearch();
  const navigate = useNavigate({ from: "/lab" });
  const selection: DatasetSelection | null = dataset ? { datasetId: dataset, versionId: version, sheetName: sheet } : null;
  const { ctx, loading, error } = useDatasetContext(selection);
  const py = useMemo(() => (ctx ? pythonInputs(ctx) : null), [ctx]);
  const [handoff, setHandoff] = useState<LabHandoff | null>(null);

  // One-shot handoff: consume it exactly once (a ref survives React's dev-mode
  // effect replay, which would otherwise overwrite it with null).
  const handoffTaken = useRef(false);
  useEffect(() => {
    if (dataset && !handoffTaken.current) {
      handoffTaken.current = true;
      setHandoff(takeLabHandoff());
    }
  }, [dataset]);

  const select = (next: DatasetSelection | null) => {
    setHandoff(null);
    void navigate({
      search: { dataset: next?.datasetId, version: next?.versionId, sheet: next?.sheetName },
      replace: true,
    });
  };

  const explain = (result: ExplainPayload) => {
    if (!selection) return;
    stashExplain(result);
    void navigate({
      to: "/chat",
      search: { c: undefined, dataset: selection.datasetId, version: selection.versionId, sheet: selection.sheetName, explain: "1" },
    });
  };

  return (
    <WorkspaceShell title="PythonLab" subtitle="pandas + matplotlib in your browser — no upload, no server execution.">
      <div className="panel mb-3 overflow-hidden">
        <DatasetContextBar
          ctx={ctx}
          loading={loading}
          error={error}
          selection={selection}
          onSelect={select}
          truncatedRows={py?.truncated ? PY_MAX_ROWS : undefined}
        />
      </div>
      <div className="panel h-[calc(100dvh-16rem)] min-h-[480px] overflow-hidden">
        <PythonLab
          key={ctx ? `${ctx.version.id}|${ctx.sheetName ?? ""}` : "none"}
          csv={py?.csv}
          fileName={py?.fileName}
          columns={py?.columns}
          seedCode={handoff?.code}
          request={handoff?.request}
          onExplain={ctx ? explain : undefined}
        />
      </div>
    </WorkspaceShell>
  );
}
