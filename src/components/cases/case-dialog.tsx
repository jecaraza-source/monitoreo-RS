"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addMentionsToCase, createCase } from "@/lib/cases/actions";
import { CASE_STATUS_LABELS, OPEN_CASE_STATUSES } from "@/lib/cases/model";
import { PRIORITIES, PRIORITY_LABELS, type Priority } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/client";

export type CaseRequest = {
  ids: string[];
  /** Defaults taken from the mentions (topic, colonia, highest priority). */
  title: string;
  category: string | null;
  neighborhoodId: string | null;
  priority: Priority;
};

type OpenCase = { id: string; folio: string; title: string; status: keyof typeof CASE_STATUS_LABELS };

/** Create a case from the selected mentions, or add them to an open one. */
export function CaseDialog({
  request,
  orgId,
  neighborhoods,
  onClose,
  onDone,
}: {
  request: CaseRequest | null;
  orgId: string;
  neighborhoods: { id: string; name: string }[];
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {request && (
          <CaseForm key={request.ids.join()} request={request} orgId={orgId} neighborhoods={neighborhoods} onClose={onClose} onDone={onDone} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CaseForm({
  request,
  orgId,
  neighborhoods,
  onClose,
  onDone,
}: {
  request: CaseRequest;
  orgId: string;
  neighborhoods: { id: string; name: string }[];
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState(request.title);
  const [description, setDescription] = useState("");
  const [neighborhoodId, setNeighborhoodId] = useState<string | null>(request.neighborhoodId);
  const [priority, setPriority] = useState<Priority>(request.priority);
  const [cases, setCases] = useState<OpenCase[] | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const n = request.ids.length;

  useEffect(() => {
    if (mode !== "existing" || cases) return;
    supabase
      .from("cases")
      .select("id, folio, title, status")
      .eq("org_id", orgId)
      .in("status", [...OPEN_CASE_STATUSES])
      .order("opened_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) toast.error("No se pudieron cargar los casos abiertos.");
        setCases((data ?? []) as OpenCase[]);
      });
  }, [mode, cases, supabase, orgId]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      if (mode === "new") {
        const result = await createCase({
          mentionIds: request.ids,
          title,
          description,
          category: request.category,
          neighborhoodId,
          priority,
        });
        if (!result.ok) return void toast.error(result.message);
        toast.success(result.message, {
          action: result.data ? { label: "Abrir", onClick: () => router.push(`/casos/${result.data!.id}`) } : undefined,
        });
      } else {
        if (!caseId) return void toast.error("Elige el caso.");
        const result = await addMentionsToCase({ caseId, mentionIds: request.ids, reason });
        if (!result.ok) return void toast.error(result.message);
        toast.success(result.message);
      }
      onDone(request.ids);
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{n === 1 ? "Caso para 1 mención" : `Caso para ${n} menciones`}</DialogTitle>
        <DialogDescription>
          Un caso agrupa las publicaciones sobre el mismo problema. Cada mención se sigue contando por separado.
        </DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
        {(["new", "existing"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={mode === m ? "rounded-md bg-background px-3 py-1.5 font-medium shadow-sm" : "rounded-md px-3 py-1.5 text-muted-foreground"}
          >
            {m === "new" ? "Nuevo caso" : "Agregar a un caso"}
          </button>
        ))}
      </div>

      {mode === "new" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="case-title">Título</Label>
            <Input id="case-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="case-description">Descripción (opcional)</Label>
            <Textarea
              id="case-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              rows={3}
              placeholder="Qué pasa, dónde y desde cuándo."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Colonia</Label>
              <OptionSelect
                label="Colonia"
                size="default"
                value={neighborhoodId}
                onChange={setNeighborhoodId}
                emptyLabel="Sin colonia"
                options={neighborhoods.map((x) => ({ value: x.id, label: x.name }))}
                className="w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Prioridad operativa</Label>
              <OptionSelect
                label="Prioridad operativa"
                size="default"
                value={priority}
                onChange={(v) => v && setPriority(v as Priority)}
                options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
                className="w-full"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Caso abierto</Label>
            {cases === null ? (
              <p className="text-sm text-muted-foreground">Cargando casos…</p>
            ) : cases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay casos abiertos. <Link href="/casos" className="underline">Ver todos los casos</Link>
              </p>
            ) : (
              <OptionSelect
                label="Caso abierto"
                size="default"
                value={caseId}
                onChange={setCaseId}
                options={cases.map((c) => ({ value: c.id, label: `${c.folio} · ${c.title} (${CASE_STATUS_LABELS[c.status]})` }))}
                className="w-full"
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="case-reason">Motivo (opcional)</Label>
            <Input id="case-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Misma fuga, misma calle" />
          </div>
        </>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || (mode === "existing" && !caseId)}>
          <FolderPlus aria-hidden /> {pending ? "Guardando…" : mode === "new" ? "Crear caso" : "Agregar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
