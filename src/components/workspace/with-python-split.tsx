import { useEffect, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
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
  csv?: string | undefined;
  fileName?: string | null | undefined;
  columns?: string[] | undefined;
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
      <div className="sticky top-16 z-30 mb-3 flex flex-wrap items-center justify-end gap-2 bg-background/90 py-1 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
        >
          {open ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5 text-primary" />}
          {open ? "Hide Python lab" : "Python lab"}
        </button>
      </div>

      {!open && children}

      {open && wide && (
        <div className="sticky top-[4.75rem] z-20 h-[calc(100dvh-5.25rem)]">
          <ResizablePanelGroup orientation="horizontal" className="h-full rounded-2xl border border-border">
            <ResizablePanel defaultSize={56} minSize={32} className="min-w-0 overflow-auto p-3 sm:p-4">
              {children}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={44} minSize={30} className="min-h-0 min-w-0 overflow-hidden">
              <PythonLab csv={csv} fileName={fileName} columns={columns} seedCode={seed} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      {open && !wide && (
        <div className="flex min-w-0 flex-col">
          <div className="min-w-0 pb-[46vh]">{children}</div>
          <div className="fixed inset-x-0 bottom-0 z-40 h-[44vh] border-t border-border bg-background p-2 shadow-[0_-12px_40px_-24px_var(--glow)]">
            <PythonLab csv={csv} fileName={fileName} columns={columns} seedCode={seed} />
          </div>
        </div>
      )}
    </div>
  );
}
