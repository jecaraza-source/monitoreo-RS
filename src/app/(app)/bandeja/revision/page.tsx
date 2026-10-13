import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ClipboardCheck } from "lucide-react";
import { formatDateTime } from "@/components/inbox/format";
import { PageHeader } from "@/components/layout/page-header";
import { ReviewCard } from "@/components/review/review-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";
import { getInboxCatalogs } from "@/lib/inbox/data";
import { getReviewQueue } from "@/lib/review/data";
import { DECISION_LABELS } from "@/lib/review/model";

export const metadata: Metadata = { title: "Revisión de clasificaciones" };

const FIELD: Record<string, string> = {
  sentiment: "sentimiento",
  severity: "gravedad",
  incident_type: "incidente",
  needs_attention: "atención",
  priority: "urgencia",
  intent: "intención",
  topic: "tema",
  department_id: "dependencia",
  neighborhood_id: "colonia",
};

export default function RevisionPage() {
  return (
    <>
      <Link href="/bandeja" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Bandeja
      </Link>
      <PageHeader
        title="Revisión de clasificaciones"
        description="Baja confianza, riesgo alto y señales contradictorias. Cada decisión guarda el cambio, el motivo y la versión anterior."
      />
      <Suspense fallback={<ReviewSkeleton />}>
        <Queue />
      </Suspense>
    </>
  );
}

async function Queue() {
  const member = await requireSection("/bandeja/revision");
  const [{ pending, total, decided }, catalogs] = await Promise.all([getReviewQueue(member), getInboxCatalogs(member)]);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="Pendientes" className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {total === 0 ? "" : `${total.toLocaleString("es-MX")} pendientes${total > pending.length ? `; se muestran las ${pending.length} más importantes` : ""}.`}
        </p>
        {pending.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title="No hay clasificaciones por revisar"
            description="Aparecerán aquí las de baja confianza, posible emergencia, riesgo alto o señales contradictorias."
          />
        ) : (
          pending.map((item) => <ReviewCard key={item.id} item={item} catalogs={catalogs} />)
        )}
      </section>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Decisiones recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {decided.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay decisiones.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {decided.map((d) => (
                <li key={d.id} className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {DECISION_LABELS[d.status] ?? d.status} · <span className="font-normal text-muted-foreground">{formatDateTime(d.decided_at)}</span>
                  </span>
                  <span className="line-clamp-2 text-muted-foreground">{d.text}</span>
                  {Object.keys(d.changes).length > 0 && (
                    <span className="text-xs">Cambió: {Object.keys(d.changes).map((k) => FIELD[k] ?? k).join(", ")}</span>
                  )}
                  {d.decision_reason && <span className="text-xs">Motivo: {d.decision_reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando revisión">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-56 w-full rounded-xl" />
      ))}
    </div>
  );
}
