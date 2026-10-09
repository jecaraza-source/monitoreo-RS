"use client";

import { useTransition } from "react";
import { FolderKanban } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectOption } from "@/lib/projects";
import { setActiveProject } from "@/lib/projects/actions";

export function ProjectSelector({
  projects,
  activeProjectId,
}: {
  projects: ProjectOption[];
  activeProjectId: string | null;
}) {
  const [pending, startTransition] = useTransition();

  if (projects.length === 0) return null;

  function onChange(value: unknown) {
    if (typeof value !== "string" || value === activeProjectId) return;
    startTransition(async () => {
      const { ok } = await setActiveProject(value);
      if (ok) toast.success(`Proyecto: ${projects.find((p) => p.id === value)?.name}`);
      else toast.error("No se pudo cambiar de proyecto.");
    });
  }

  return (
    <Select value={activeProjectId} onValueChange={onChange} disabled={pending}>
      <SelectTrigger size="sm" className="w-48 sm:w-64" aria-label="Proyecto activo">
        <FolderKanban className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue>{(value: string | null) => projects.find((p) => p.id === value)?.name ?? "Proyecto"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
