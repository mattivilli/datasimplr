import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for deletes and other things that cannot be undone. */
  destructive?: boolean;
  /** Hide the cancel button, for a plain notice that only needs "OK". */
  hideCancel?: boolean;
};

type Ask = (options: ConfirmOptions) => Promise<boolean>;

// Without a provider the hook still works, using the browser's own confirm box.
const fallback: Ask = async (options) =>
  typeof window === "undefined" ? false : window.confirm(`${options.title}${options.description ? `\n\n${String(options.description)}` : ""}`);

const ConfirmContext = createContext<Ask>(fallback);

/** One confirmation dialog for the whole app. `await confirm({...})` resolves true when confirmed. */
export function useConfirm(): Ask {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const ask = useCallback<Ask>((next) => {
    // A second request while one is open cancels the first rather than leaving it hanging.
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);

  const value = useMemo(() => ask, [ask]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog open={options != null} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            {options?.description != null && <AlertDialogDescription>{options.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            {!options?.hideCancel && <AlertDialogCancel onClick={() => settle(false)}>{options?.cancelLabel ?? "Cancel"}</AlertDialogCancel>}
            <AlertDialogAction
              onClick={() => settle(true)}
              className={options?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {options?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
