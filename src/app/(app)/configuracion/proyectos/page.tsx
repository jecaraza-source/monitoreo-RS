import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, MapPin, Plus, Search, Target } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Reveal } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";
import { getProjectList } from "@/lib/projects/data";

export const metadata: Metadata = { title: "Proyectos" };

export default async function ProjectsPage() {
  const member = await requireSection("/configuracion/proyectos");
  const projects = await getProjectList(member);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Cada proyecto define qué se escucha (consultas), dónde (territorio) y cómo se mide (KPIs).
        </p>
        <Link href="/configuracion/proyectos/nuevo" className={buttonVariants()}>
          <Plus aria-hidden /> Nuevo proyecto
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="Aún no hay proyectos"
          description="Crea el primero para empezar a recolectar menciones."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, index) => (
            <Reveal key={project.id} delay={index * 0.05}>
              <Link href={`/configuracion/proyectos/${project.id}`} className="block h-full rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <Card className="h-full transition-colors hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle as="h2">{project.name}</CardTitle>
                    {project.goal && <CardDescription className="line-clamp-2">{project.goal}</CardDescription>}
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Search className="size-3.5" aria-hidden /> {project.activeQueries}{" "}
                      {project.activeQueries === 1 ? "consulta" : "consultas"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Target className="size-3.5" aria-hidden /> {project.kpis.length} KPIs
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden />
                      {project.territory.scope === "municipality"
                        ? "Todo el municipio"
                        : `${project.territory.neighborhoodIds.length} colonias`}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
