"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { inviteUser, type InviteState } from "@/app/(app)/configuracion/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";

export function InviteUserForm({ departments }: { departments: { id: string; name: string }[] }) {
  const [role, setRole] = useState<Role>("lectura");
  // Controlled: form.reset() does not clear base-ui Select state, and a stale
  // department must never carry over to the next invitation.
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<InviteState, FormData>(async (prev, formData) => {
    const result = await inviteUser(prev, formData);
    if (result.status === "success") {
      setRole("lectura");
      setDepartmentId(null);
    }
    return result;
  }, { status: "idle" });

  // Toasts are a side effect of each new result.
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      formRef.current?.reset();
    } else if (state.status === "error") {
      toast.error(state.message);
    }
  }, [state]);

  const fieldError = (field: string) =>
    state.status === "error" && state.field === field ? state.message : undefined;

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-[1fr_12rem_14rem_auto] sm:items-end">
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">Correo</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          placeholder="nombre@municipio.gob.mx"
          required
          aria-invalid={Boolean(fieldError("email"))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label id="invite-role-label">Rol</Label>
        <Select
          name="role"
          value={role}
          onValueChange={(v) => {
            setRole(v as Role);
            if (v !== "dependencia") setDepartmentId(null);
          }}
        >
          <SelectTrigger aria-labelledby="invite-role-label" className="w-full">
            <SelectValue>{(value: Role) => ROLE_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label id="invite-department-label">Dependencia</Label>
        <Select
          name="departmentId"
          disabled={role !== "dependencia"}
          value={departmentId}
          onValueChange={(v) => setDepartmentId(typeof v === "string" ? v : null)}
        >
          <SelectTrigger
            aria-labelledby="invite-department-label"
            className="w-full"
            aria-invalid={Boolean(fieldError("departmentId"))}
          >
            <SelectValue>
              {(value: string | null) =>
                role !== "dependencia"
                  ? "No aplica"
                  : (departments.find((d) => d.id === value)?.name ?? "Elige una")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={pending}>
        <UserPlus aria-hidden />
        {pending ? "Enviando…" : "Invitar"}
      </Button>
    </form>
  );
}
