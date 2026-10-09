import { cn } from "@/lib/utils";

/**
 * Entry animation for cards: fade + small rise, in CSS so it starts with the
 * first paint (no JS, no hydration wait). Static for reduced motion.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  /** Seconds; use index × 0.06 for a staggered row. */
  delay?: number;
  className?: string;
}) {
  return (
    <div className={cn("animate-reveal", className)} style={delay ? { animationDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}
