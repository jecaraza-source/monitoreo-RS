import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { ProjectForm } from "@/components/projects/project-form";
import { QueryBuilder } from "@/components/projects/query-builder";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { getNeighborhoodOptions, getProjectDetail } from "@/lib/projects/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Proyecto" };

const NEW = "nueva";

export default async function ProjectPage({ params, searchParams }: PageProps<"/configuracion/proyectos/[id]">) {
  const member = await requireSection("/configuracion/proyectos");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [project, neighborhoods] = await Promise.all([
    getProjectDetail(member, id),
    getNeighborhoodOptions(member),
  ]);
  if (!project) notFound();

  const requested = typeof query.consulta === "string" ? query.consulta : undefined;
  const selected =
    requested === NEW
      ? null
      : (project.lineages.find((l) => l.lineageId === requested) ?? project.lineages[0] ?? null);
  const tabHref = (value: string) => `/configuracion/proyectos/${project.id}?consulta=${value}`;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/configuracion/proyectos" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}>
        <ArrowLeft aria-hidden /> Proyectos
      </Link>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Ficha del proyecto</CardTitle>
          <CardDescription>Objetivo, indicadores y territorio que cubre.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm
            key={project.updatedAt}
            projectId={project.id}
            neighborhoods={neighborhoods}
            initial={{ name: project.name, goal: project.goal, kpis: project.kpis, territory: project.territory }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Consultas</CardTitle>
          <CardDescription>
            Qué menciones pertenecen a este proyecto. Cada cambio se guarda como una versión nueva; las
            menciones conservan la versión que las capturó.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <nav aria-label="Consultas del proyecto" className="flex flex-wrap gap-2">
            {project.lineages.map((lineage) => (
              <Link
                key={lineage.lineageId}
                href={tabHref(lineage.lineageId)}
                aria-current={selected?.lineageId === lineage.lineageId ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: selected?.lineageId === lineage.lineageId ? "secondary" : "ghost", size: "sm" }),
                )}
              >
                {lineage.name}
                {lineage.active && <span className="text-xs text-muted-foreground">v{lineage.active.version}</span>}
              </Link>
            ))}
            <Link
              href={tabHref(NEW)}
              aria-current={selected === null ? "page" : undefined}
              className={buttonVariants({ variant: selected === null ? "secondary" : "outline", size: "sm" })}
            >
              <Plus aria-hidden /> Nueva consulta
            </Link>
          </nav>

          <QueryBuilder
            key={selected ? `${selected.lineageId}-${selected.versions[0]?.version}` : NEW}
            projectId={project.id}
            lineageId={selected?.lineageId ?? null}
            initialName={selected?.name ?? "Nueva consulta"}
            versions={selected?.versions ?? []}
          />
        </CardContent>
      </Card>
    </div>
  );
}
