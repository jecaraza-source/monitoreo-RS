import { FadeIn } from "@/components/home/fade-in";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MODULES = [
  { title: "Menciones", description: "Recolección de contenido público por APIs oficiales y RSS." },
  { title: "Clasificación", description: "Sentimiento, tema, dependencia, colonia y prioridad con Claude." },
  { title: "Turnado", description: "Asignación de menciones a la dependencia responsable." },
  { title: "Alertas y reportes", description: "Dashboards ejecutivos y reportes con narrativa estratégica." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-10 px-6 py-24">
      <FadeIn>
        <p className="text-sm font-medium text-muted-foreground">Gobierno municipal</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Monitoreo Municipal</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Plataforma de escucha social para la atención ciudadana y la evaluación de la gestión.
        </p>
      </FadeIn>
      <div className="grid gap-4 sm:grid-cols-2">
        {MODULES.map((module, i) => (
          <FadeIn key={module.title} delay={0.1 + i * 0.08}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{module.title}</CardTitle>
                <CardDescription>{module.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-xs text-muted-foreground">Próximamente</span>
              </CardContent>
            </Card>
          </FadeIn>
        ))}
      </div>
    </main>
  );
}
