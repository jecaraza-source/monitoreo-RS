import { cn } from "@/lib/utils";

// Sigma Pulso brand colors (from the logo).
export const BRAND = { navy: "#032a50", teal: "#36c6c0", light: "#e4e8ef", rim: "#c8cdd6" } as const;

/** Shield with signal waves. Paths match public/brand/sigma-shield.svg and app/icon.svg. */
export function SigmaShield({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 112"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path
        d="M8 15 Q50 3 92 15 V58 Q92 92 50 108 Q8 92 8 58 Z"
        fill={BRAND.navy}
        stroke={BRAND.rim}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <g fill="none" strokeLinecap="round" strokeWidth="7">
        <path d="M33 34 A40 40 0 0 1 73 74" stroke={BRAND.light} />
        <path d="M33 48 A26 26 0 0 1 59 74" stroke={BRAND.teal} />
        <path d="M33 61 A13 13 0 0 1 46 74" stroke={BRAND.teal} />
      </g>
      <circle cx="33" cy="74" r="6.5" fill={BRAND.teal} />
    </svg>
  );
}

/**
 * Shield + wordmark. "full" adds the tagline. The wordmark is typeset (not the
 * chrome artwork) so it stays crisp and follows the theme.
 */
export function SigmaPulsoLogo({ variant = "compact", className }: { variant?: "compact" | "full"; className?: string }) {
  const full = variant === "full";
  return (
    <span className={cn("inline-flex items-center", full ? "gap-3" : "gap-2", className)}>
      <SigmaShield className={full ? "h-14 w-auto" : "h-8 w-auto"} />
      <span className="flex flex-col text-left leading-none">
        <span className={cn("font-semibold tracking-[0.3em] text-muted-foreground uppercase", full ? "text-xs" : "text-[9px]")}>
          Sigma
        </span>
        <span className={cn("font-black tracking-tight italic", full ? "text-3xl" : "text-base")}>PULSO</span>
        {full && <span className="mt-1 text-xs text-muted-foreground">Inteligencia social municipal</span>}
      </span>
    </span>
  );
}
