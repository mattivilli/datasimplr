import { useEffect, useState, type ReactNode } from "react";
import { Code2, X } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { PythonLab } from "./python-lab";

const EVENT = "ds-python-open";

export function openPythonLab(code?: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { code } }));
}

export function WithPythonSplit({
  children,
  csv,
  fileName,
  columns,
}: {
  children: ReactNode;
  csv?: string;
  fileName?: string | null;
  columns?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | undefined>();
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const code = (e as CustomEvent<{ code?: string }>).detail?.code;
      setSeed(code);
      setOpen(true);
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
        >
          {open ? <X className="size-3.5" /> : <Code2 className="size-3.5 text-primary" />}
          {open ? "Hide Python lab" : "Python lab"}
        </button>
      </div>

      {!open && children}

      {open && wide && (
        <ResizablePanelGroup orientation="horizontal" className="min-h-[78vh] rounded-2xl border border-border">
          <ResizablePanel defaultSize={58} minSize={32} className="min-w-0 overflow-auto p-3 sm:p-4">
            {children}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={42} minSize={28} className="min-w-0 overflow-hidden">
            <PythonLab csv={csv} fileName={fileName} columns={columns} seedCode={seed} />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {open && !wide && (
        <div className="flex min-w-0 flex-col gap-4">
          {children}
          <div className="min-h-[420px]">
            <PythonLab csv={csv} fileName={fileName} columns={columns} seedCode={seed} />
          </div>
        </div>
      )}
    </div>
  );
}
