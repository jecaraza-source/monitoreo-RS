"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small (i) next to a title that explains what the figure means. Opens on
 * hover and on tap (phones), and is reachable with the keyboard.
 */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={`Qué es ${label}`}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} className="isolate z-50">
          <Popover.Popup className="max-w-72 rounded-lg border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
            <Popover.Title className="mb-0.5 font-medium">{label}</Popover.Title>
            <Popover.Description render={<div />}>{children}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
