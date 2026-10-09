"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mounts its children only once they are about to scroll into view, so
 * charts below the fold cost no JavaScript on the first load. Once mounted,
 * they stay (period changes and auto-refresh update them in place).
 */
export function WhenVisible({ children, margin = "200px" }: { children: React.ReactNode; margin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [margin, visible]);

  return (
    <div ref={ref} className="relative size-full">
      {visible ? children : <Skeleton className="size-full" />}
    </div>
  );
}
