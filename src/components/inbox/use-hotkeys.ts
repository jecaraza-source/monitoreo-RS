"use client";

import { useEffect, useRef } from "react";

/** Keys typed into fields, menus or dialogs are not shortcuts. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return Boolean(target.closest('[role="listbox"], [role="menu"], [role="dialog"], [role="combobox"]'));
}

/** Single-key shortcuts (no modifiers), e.g. { j: next, k: prev }. */
export function useHotkeys(map: Record<string, (event: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      const handler = ref.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
