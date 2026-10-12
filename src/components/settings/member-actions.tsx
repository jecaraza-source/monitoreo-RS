"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeMember, updateMember } from "@/app/(app)/configuracion/usuarios/actions";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";

type Member = { userId: string; email: string; role: Role; departmentId: string | null };

/** Edit (role, department) and remove buttons of a row in the users table. */
export function MemberActions({ member, departments, isSelf }: { member: Member; departments: { id: string; name: string }[]; isSelf: boolean }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!confirm(`¿Quitar a ${member.email} del municipio? Perderá el acceso de inmediato.`)) return;
    startTransition(async () => {
      const result = await removeMember({ userId: member.userId });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <div className="flex justify-end gap-0.5">
      <Button size="icon-sm" variant="ghost" aria-label={`Editar ${member.email}`} onClick={() => setEditing(true)}>
        <Pencil aria-hidden />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Quitar ${member.email}`}
        title={isSelf ? "No puedes quitarte a ti mismo" : undefined}
        disabled={pending || isSelf}
        onClick={remove}
      >
        <Trash2 aria-hidden />
      </Button>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          {editing && <EditForm member={member} departments={departments} isSelf={isSelf} onClose={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditForm({
  member,
  departments,
  isSelf,
  onClose,
}: {
  member: Member;
  departments: { id: string; name: string }[];
  isSelf: boolean;
  onClose: () => void;
}) {
  const [role, setRole] = useState<Role>(member.role);
  const [departmentId, setDepartmentId] = useState<string | null>(member.departmentId);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateMember({ userId: member.userId, role, departmentId: role === "dependencia" ? departmentId : null });
          if (!result.ok) return void toast.error(result.message);
          toast.success(result.message);
          onClose();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Editar usuario</DialogTitle>
        <DialogDescription>{member.email}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label>Rol</Label>
        <OptionSelect
          label="Rol"
          size="default"
          value={role}
          onChange={(v) => v && setRole(v as Role)}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          className="w-full"
          disabled={isSelf}
        />
        {isSelf && <span className="text-xs text-muted-foreground">No puedes cambiar tu propio rol.</span>}
      </div>
      {role === "dependencia" && (
        <div className="flex flex-col gap-1.5">
          <Label>Dependencia</Label>
          <OptionSelect
            label="Dependencia del usuario"
            size="default"
            value={departmentId}
            onChange={setDepartmentId}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            className="w-full"
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Si deja de calificar como responsable de una dependencia o de escalamiento por WhatsApp, se le quita esa responsabilidad.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || (role === "dependencia" && !departmentId)}>
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}
