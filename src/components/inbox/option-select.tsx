"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string };

const NONE = "__none";

/**
 * Select over string options. `emptyLabel` adds a first option that maps to
 * null ("Todas", "Sin colonia"…).
 */
export function OptionSelect({
  value,
  onChange,
  options,
  emptyLabel,
  label,
  size = "sm",
  className,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options: Option[];
  emptyLabel?: string;
  /** Accessible name. */
  label: string;
  size?: "sm" | "default";
  className?: string;
  disabled?: boolean;
}) {
  const all = emptyLabel ? [{ value: NONE, label: emptyLabel }, ...options] : options;
  const current = value ?? (emptyLabel ? NONE : null);
  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(typeof v === "string" && v !== NONE ? v : null)}
      disabled={disabled}
    >
      <SelectTrigger size={size} aria-label={label} className={cn("min-w-0", className)}>
        <SelectValue>
          {(v: string | null) => all.find((o) => o.value === v)?.label ?? <span className="text-muted-foreground">{label}</span>}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {all.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
