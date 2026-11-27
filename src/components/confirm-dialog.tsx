"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ConfirmOptions = {
  title?: string;
  /** Label of the button that accepts ("Aceptar" by default). */
  confirmLabel?: string;
  /** Red accept button, for deletions and other irreversible steps. */
  destructive?: boolean;
};

type Ask = (message: string, options?: ConfirmOptions) => Promise<boolean>;

// Without the provider (tests of isolated components) the browser's dialog still works.
const ConfirmContext = createContext<Ask>((message) => Promise.resolve(window.confirm(message)));

/**
 * In-app confirmation, instead of window.confirm(): the native dialog freezes
 * the page while it is open (the browser counts it as a slow interaction) and
 * cannot be styled. `await confirm("¿Borrar…?")` resolves true on accept.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<{ message: string; options: ConfirmOptions } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((message, options = {}) => {
    resolver.current?.(false);
    setRequest({ message, options });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function answer(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={request !== null} onOpenChange={(open) => !open && answer(false)}>
        <DialogContent showCloseButton={false} role="alertdialog">
          <DialogHeader>
            <DialogTitle>{request?.options.title ?? "Confirmar"}</DialogTitle>
            <DialogDescription>{request?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => answer(false)}>
              Cancelar
            </Button>
            <Button variant={request?.options.destructive ? "destructive" : "default"} onClick={() => answer(true)} autoFocus>
              {request?.options.confirmLabel ?? "Aceptar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
