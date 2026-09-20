import { useEffect, useState, type RefObject } from "react";
import { ArrowUp } from "lucide-react";

export function ScrollTop({
  target,
  local = false,
}: {
  target?: RefObject<HTMLElement | null>;
  local?: boolean;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = target?.current ?? null;
    const onScroll = () => {
      const top = el ? el.scrollTop : window.scrollY;
      setShow(top > 240);
    };
    onScroll();
    const node: HTMLElement | Window = el ?? window;
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [target]);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="Go to top"
      onClick={() => {
        const el = target?.current;
        if (el) el.scrollTo({ top: 0, behavior: "smooth" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      className={
        local
          ? "absolute bottom-4 right-4 z-20 flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:border-primary"
          : "fixed bottom-6 right-6 z-50 flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-[0_12px_40px_-18px_var(--glow)] hover:border-primary"
      }
    >
      <ArrowUp className="size-4" />
    </button>
  );
}
