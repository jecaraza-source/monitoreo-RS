import type { Metadata } from "next";
import { ProjectForm } from "@/components/projects/project-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { getNeighborhoodOptions } from "@/lib/projects/data";

export const metadata: Metadata = { title: "Nuevo proyecto" };

export default async function NewProjectPage() {
  const member = await requireSection("/configuracion/proyectos");
  const neighborhoods = await getNeighborhoodOptions(member);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Nuevo proyecto</CardTitle>
        <CardDescription>Después de crearlo podrás armar sus consultas.</CardDescription>
      </CardHeader>
      <CardContent>
        <ProjectForm
          projectId={null}
          neighborhoods={neighborhoods}
          initial={{ name: "", goal: "", kpis: [], territory: { scope: "municipality", notes: "" } }}
        />
      </CardContent>
    </Card>
  );
}
