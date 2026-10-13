"use client";

import { ShieldAlert, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { EVIDENCE_ACCEPT, EVIDENCE_MAX_FILES, selectionProblem } from "@/lib/cases/evidence";

const kb = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const size = (n: number) => (n >= 1024 * 1024 ? `${kb.format(n / 1024 / 1024)} MB` : `${kb.format(n / 1024)} KB`);

/** File picker for evidence, with the data-minimization rules in view. The server checks everything again. */
export function EvidenceInput({ id, files, onChange }: { id: string; files: File[]; onChange: (files: File[]) => void }) {
  const problem = selectionProblem(files.map((f) => f.size));
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Evidencia (opcional)</Label>
      <input
        id={id}
        type="file"
        multiple
        accept={EVIDENCE_ACCEPT}
        className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1 file:text-sm"
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, EVIDENCE_MAX_FILES + 1));
          e.target.value = "";
        }}
      />
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Fotos JPG o PNG y PDF, hasta 3 MB cada uno y {EVIDENCE_MAX_FILES} por avance. Muestra el lugar y el trabajo: evita rostros, placas, identificaciones,
          teléfonos o domicilios de vecinos. A las fotos se les quita la ubicación GPS y los datos de la cámara.
        </span>
      </p>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
              <span className="truncate">{f.name}</span>
              <span className="text-muted-foreground">{size(f.size)}</span>
              <button
                type="button"
                className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Quitar ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="text-xs text-negative">{problem}</p>}
    </div>
  );
}
