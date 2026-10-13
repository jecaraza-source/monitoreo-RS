"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteProject } from "@/lib/projects/actions";

/** Delete a project (shown only to Administración); asks to type its name. */
export function DeleteProject({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteProject(projectId);
      if (!result.ok) return void toast.error(result.message);
      const kept = result.data.mentionsKept;
      toast.success(kept ? `Proyecto borrado. Se conservaron ${kept} ${kept === 1 ? "mención" : "menciones"}.` : "Proyecto borrado.");
      setOpen(false);
      router.push("/configuracion/proyectos");
    });
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Borrar proyecto
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
        <DialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Borrar «{name}»</DialogTitle>
              <DialogDescription>
                Se borran el proyecto y sus consultas. Las menciones que ya capturó se conservan en la bandeja, sin
                proyecto. Queda registrado en la bitácora y no se puede deshacer desde la app.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-project-name">Escribe el nombre del proyecto para confirmar</Label>
              <Input id="delete-project-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={pending || typed.trim() !== name.trim()}>
                {pending ? "Borrando…" : "Borrar proyecto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
