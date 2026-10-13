"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { verifyAuthor } from "@/lib/authors/actions";
import { HANDLE_HINTS } from "@/lib/authors/label";

const PLATFORMS = [
  { value: "rss", label: "Sitio / RSS" },
  { value: "meta", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "x", label: "X" },
] as const;

const EMPTY = { platform: "youtube" as (typeof PLATFORMS)[number]["value"], handle: "", kind: "media" as "media" | "public_figure", display_name: "", evidence: "", evidence_url: "" };

export function VerifyAuthorForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(EMPTY);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await verifyAuthor(v);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setV(EMPTY);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Verificar cuenta">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="va-platform">Plataforma</Label>
          <select
            id="va-platform"
            className="h-8 rounded-lg border bg-transparent px-2 text-sm"
            value={v.platform}
            onChange={(e) => setV({ ...v, platform: e.target.value as typeof v.platform })}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="va-handle">Cuenta</Label>
          <Input id="va-handle" required maxLength={200} value={v.handle} onChange={(e) => setV({ ...v, handle: e.target.value })} />
          <span className="text-xs text-muted-foreground">{HANDLE_HINTS[v.platform]}</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="va-kind">Tipo</Label>
          <select
            id="va-kind"
            className="h-8 rounded-lg border bg-transparent px-2 text-sm"
            value={v.kind}
            onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}
          >
            <option value="media">Medio de comunicación</option>
            <option value="public_figure">Figura pública</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="va-name">Nombre público</Label>
          <Input id="va-name" required maxLength={200} value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-1">
          <Label htmlFor="va-evidence">Evidencia de verificación</Label>
          <Textarea
            id="va-evidence"
            required
            minLength={10}
            maxLength={2000}
            rows={2}
            placeholder="Por qué es un medio o figura pública: sitio oficial, padrón de medios, cargo público…"
            value={v.evidence}
            onChange={(e) => setV({ ...v, evidence: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="va-url">Enlace de evidencia (opcional)</Label>
          <Input id="va-url" type="url" placeholder="https://" maxLength={500} value={v.evidence_url} onChange={(e) => setV({ ...v, evidence_url: e.target.value })} />
        </div>
      </div>
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? "Verificando…" : "Agregar al catálogo"}
      </Button>
    </form>
  );
}
