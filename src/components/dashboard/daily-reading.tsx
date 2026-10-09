import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/ui-kit";

// Placeholder until the executive summary is generated with Claude.
const EXAMPLE = [
  "La conversación se concentra en el abasto de agua: las quejas crecieron en las colonias del norte tras dos días de tandeo.",
  "El tono general mejoró frente a la semana pasada gracias a la respuesta rápida en reparación de fugas y luminarias.",
  "Conviene atender hoy los reportes de seguridad en el Centro: son pocos, pero tienen el mayor alcance en medios.",
];

export function DailyReading({ index }: { index: number }) {
  return (
    <Reveal delay={index * 0.06} className="h-full">
      <Card className="h-full bg-linear-to-br from-primary/10 via-card to-card">
        <CardHeader>
          <CardTitle as="h3" className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden /> Lectura del día
          </CardTitle>
          <CardDescription>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">Texto de ejemplo</span> Pronto lo redactará Claude con
            los datos del periodo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {EXAMPLE.map((sentence, i) => (
              <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                {sentence}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </Reveal>
  );
}
