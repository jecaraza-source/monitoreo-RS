"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chips input: Enter or comma adds a term; pasting a list splits it. */
export function TermInput({
  terms,
  onChange,
  placeholder,
  label,
  tone = "include",
}: {
  terms: string[];
  onChange: (terms: string[]) => void;
  placeholder: string;
  label: string;
  tone?: "include" | "exclude";
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const next = raw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (next.length) onChange([...terms, ...next]);
    setDraft("");
  }

  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-3 focus-within:ring-ring/50",
      )}
    >
      {terms.map((term, index) => (
        <span
          key={`${term}-${index}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm",
            tone === "exclude" ? "bg-negative/12 text-negative" : "bg-accent text-accent-foreground",
          )}
        >
          {term}
          <button
            type="button"
            className="rounded-sm opacity-70 hover:opacity-100"
            aria-label={`Quitar ${term}`}
            onClick={() => onChange(terms.filter((_, i) => i !== index))}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={draft}
        placeholder={terms.length === 0 ? placeholder : "Agregar…"}
        className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        onChange={(e) => {
          const value = e.target.value;
          if (value.includes(",")) add(value);
          else setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && draft === "" && terms.length) {
            onChange(terms.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            add(draft + text);
          }
        }}
      />
    </div>
  );
}
