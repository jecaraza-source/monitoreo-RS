"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { setDepartmentContacts } from "@/lib/sla/actions";
import type { Person } from "@/lib/sla/data";

type Department = { id: string; name: string; responsible_user_id: string | null; head_user_id: string | null };

/** Link (enlace) and head (titular) of each department: the escalation recipients, from verified members. */
export function DepartmentContacts({ departments, people }: { departments: Department[]; people: Person[] }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Enlaces y titulares">
      {departments.map((d) => (
        <Row key={d.id} department={d} people={people.filter((p) => p.department_id === d.id || p.department_id === null)} />
      ))}
    </ul>
  );
}

function Row({ department, people }: { department: Department; people: Person[] }) {
  const router = useRouter();
  const [link, setLink] = useState(department.responsible_user_id);
  const [head, setHead] = useState(department.head_user_id);
  const [pending, startTransition] = useTransition();
  const options = people.map((p) => ({ value: p.user_id, label: p.department_id ? p.name : `${p.name} (coordinación)` }));
  const changed = link !== department.responsible_user_id || head !== department.head_user_id;

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
      <span className="min-w-40 flex-1 font-medium">{department.name}</span>
      <OptionSelect label={`Enlace de ${department.name}`} value={link} onChange={setLink} emptyLabel="Sin enlace" options={options} className="w-56" />
      <OptionSelect label={`Titular de ${department.name}`} value={head} onChange={setHead} emptyLabel="Sin titular" options={options} className="w-56" />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !changed}
        onClick={() =>
          startTransition(async () => {
            const result = await setDepartmentContacts({ departmentId: department.id, linkUserId: link, headUserId: head });
            if (!result.ok) return void toast.error(result.message);
            toast.success(result.message);
            router.refresh();
          })
        }
      >
        Guardar
      </Button>
    </li>
  );
}
