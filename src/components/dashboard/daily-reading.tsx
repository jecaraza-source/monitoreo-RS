import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Reveal } from "@/components/ui-kit";
import type { Member } from "@/lib/auth/session";
import { getDailyReading } from "@/lib/reports/daily-reading";

const time = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });

/** Card shell; the summary streams in (it may take a few seconds when the 1 h cache expires). */
export function DailyReading({ index, member }: { index: number; member: Member }) {
  return (
    <Reveal delay={index * 0.06} className="h-full">
      <Card className="h-full bg-linear-to-br from-primary/10 via-card to-card">
        <CardHeader>
          <CardTitle as="h3" className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden /> Lectura del día
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ReadingSkeleton />}>
            <ReadingBody member={member} />
          </Suspense>
        </CardContent>
      </Card>
    </Reveal>
  );
}

function ReadingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Redactando la lectura del día">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

async function ReadingBody({ member }: { member: Member }) {
  const reading = await getDailyReading(member);
  if (reading.status === "unavailable") {
    return <CardDescription>{reading.reason}</CardDescription>;
  }
  return (
    <>
      <ol className="flex flex-col gap-3">
        {reading.sentences.map((sentence, i) => (
          <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {i + 1}
            </span>
            {sentence}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        Últimas 24 horas · redactado con IA a las {time.format(new Date(reading.generatedAt))} con cifras del sistema.
      </p>
    </>
  );
}
