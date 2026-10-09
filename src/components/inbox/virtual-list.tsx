"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Windowed list with fixed row height: only the rows in view (plus overscan)
 * are mounted, so thousands of mentions scroll smoothly. The parent owns the
 * scroll container so it can scroll to a row or keep its place on inserts.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  scrollRef,
  getKey,
  renderRow,
  onEndReached,
  overscan = 6,
  label,
}: {
  items: readonly T[];
  rowHeight: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  getKey: (item: T) => string;
  renderRow: (item: T, index: number) => React.ReactNode;
  onEndReached?: () => void;
  overscan?: number;
  label: string;
}) {
  const [view, setView] = useState({ top: 0, height: 800 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef]);

  const first = Math.max(0, Math.floor(view.top / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((view.top + view.height) / rowHeight) + overscan);

  // Ask for the next page when the window gets close to the end.
  const nearEnd = items.length > 0 && last >= items.length - overscan;
  useEffect(() => {
    if (nearEnd) onEndReached?.();
  }, [nearEnd, items.length, onEndReached]);

  return (
    <div role="list" aria-label={label} className="relative" style={{ height: items.length * rowHeight }}>
      {items.slice(first, last).map((item, i) => (
        <div
          key={getKey(item)}
          role="listitem"
          className="absolute inset-x-0"
          style={{ top: (first + i) * rowHeight, height: rowHeight }}
        >
          {renderRow(item, first + i)}
        </div>
      ))}
    </div>
  );
}
