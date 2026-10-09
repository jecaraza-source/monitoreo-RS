"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REFRESH_MS = 60_000;

type FrameContext = { navigate: (href: string) => void; pending: boolean; presenting: boolean };
const Context = createContext<FrameContext>({ navigate: () => {}, pending: false, presenting: false });
export const useDashboardFrame = () => useContext(Context);

const clock = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });

/**
 * Wraps the dashboard: period changes run as transitions (the previous view
 * stays, dimmed, instead of flashing skeletons) and the boardroom mode puts
 * the whole dashboard in full screen and refreshes it every 60 s.
 */
export function DashboardFrame({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [presenting, setPresenting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const navigate = useCallback(
    (href: string) => startTransition(() => router.push(href, { scroll: false })),
    [router],
  );

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
    setUpdatedAt(new Date());
  }, [router]);

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === ref.current;
      setPresenting(on);
      if (on) setUpdatedAt(new Date());
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Boardroom mode: fresh data every minute while full screen.
  useEffect(() => {
    if (!presenting) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [presenting, refresh]);

  async function toggle() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ref.current?.requestFullscreen?.();
  }

  return (
    <Context.Provider value={{ navigate, pending, presenting }}>
      <div
        ref={ref}
        data-presenting={presenting || undefined}
        className="flex flex-col gap-6 bg-background data-presenting:overflow-y-auto data-presenting:p-6 data-presenting:lg:p-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {presenting && updatedAt
                ? `Se actualiza cada minuto · última actualización ${clock.format(updatedAt)}`
                : "Resumen ejecutivo comparado con el periodo anterior."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {toolbar}
            {presenting && (
              <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label="Actualizar ahora" disabled={pending}>
                <RefreshCw aria-hidden className={cn(pending && "animate-spin")} />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={toggle} aria-pressed={presenting}>
              {presenting ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
              {presenting ? "Salir" : "Sala de juntas"}
            </Button>
          </div>
        </div>
        <div
          aria-busy={pending || undefined}
          className={cn("flex flex-col gap-6 transition-opacity duration-300", pending && !presenting && "opacity-60")}
        >
          {children}
        </div>
      </div>
    </Context.Provider>
  );
}
