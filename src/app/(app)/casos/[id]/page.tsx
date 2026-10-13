import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlarmClock, ChevronLeft, MessageCircle } from "lucide-react";
import { CaseActions } from "@/components/cases/case-actions";
import { CaseHistory } from "@/components/cases/case-history";
import { CaseLocation } from "@/components/cases/case-location";
import { CaseManage } from "@/components/cases/case-manage";
import { CaseMentions } from "@/components/cases/case-mentions";
import { CaseNotes } from "@/components/cases/case-notes";
import { CaseStatusBadge } from "@/components/cases/case-status-badge";
import { CaseTasks } from "@/components/cases/case-tasks";
import { CaseTimes } from "@/components/cases/case-times";
import { CaseUpdates } from "@/components/cases/case-updates";
import { HelpSheet } from "@/components/help/help-sheet";
import { formatDateTime, fromNow } from "@/components/inbox/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSection } from "@/lib/auth/session";
import { getCase, getDepartmentPeople, getMergeCandidates, getSlaTerms, getSlaVersion, getSuggestions } from "@/lib/cases/data";
import { caseDueAt, caseOverdue, OPEN_CASE_STATUSES, type CaseActor } from "@/lib/cases/model";
import { topicsFor } from "@/lib/help/content";
import { getInboxCatalogs } from "@/lib/inbox/data";
import { isOverdue, PRIORITY_LABELS, TICKET_LABELS } from "@/lib/inbox/model";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Caso" };

export default function CasoPage({ params }: PageProps<"/casos/[id]">) {
  return (
    <Suspense fallback={<CaseSkeleton />}>
      <CaseView params={params} />
    </Suspense>
  );
}

const nf = new Intl.NumberFormat("es-MX");

async function CaseView({ params }: { params: PageProps<"/casos/[id]">["params"] }) {
  const { id } = await params;
  const member = await requireSection("/casos");
  const [c, catalogs] = await Promise.all([getCase(member, id), getInboxCatalogs(member)]);
  // RLS: a case of another department (or municipality) simply does not exist here.
  if (!c) notFound();

  const editor = member.role === "admin" || member.role === "comunicacion";
  const actor: CaseActor = editor ? "editor" : member.role === "dependencia" ? "department" : "reader";
  const responsible = member.role === "dependencia" && member.departmentId === c.department_id;
  const isOpen = OPEN_CASE_STATUSES.includes(c.status);
  const [suggestions, mergeCandidates, people, slaTerms, slaVersion] = await Promise.all([
    editor && isOpen ? getSuggestions(c.id) : [],
    editor && isOpen ? getMergeCandidates(member, c.id) : [],
    editor || responsible ? getDepartmentPeople(member) : [],
    editor && isOpen ? getSlaTerms(member, c.category, c.priority) : null,
    c.sla_version_id ? getSlaVersion(c.sla_version_id) : null,
  ]);

  const departments = new Map(catalogs.departments.map((d) => [d.id, d.name]));
  const neighborhoods = Object.fromEntries(catalogs.neighborhoods.map((n) => [n.id, n.name]));
  const names: Record<string, string> = {
    ...Object.fromEntries(departments),
    ...neighborhoods,
    ...Object.fromEntries(people.map((p) => [p.user_id, p.name])),
    ...Object.fromEntries(c.people.map((p) => [p.user_id, p.name])),
  };
  const lead = c.tickets.find((t) => t.is_primary && t.department_id === c.department_id) ?? null;
  const support = c.tickets.filter((t) => t !== lead && t.status !== "closed");
  const person = c.people.find((p) => p.is_responsible);
  const openedBy = [...c.events].reverse().find((e) => e.operation === "created" || e.operation === "backfill");
  const overdue = caseOverdue(c);
  const due = caseDueAt(c);
  // Areas that may get a task: those with an active assignment in the case.
  const areas = c.areas.map((a) => ({ id: a.department_id, name: departments.get(a.department_id) ?? "Dependencia" }));
  const working = ["assigned", "accepted", "in_progress"].includes(c.status);
  const canReport =
    member.role !== "lectura" && (editor ? !["merged", "discarded", "closed"].includes(c.status) : ["assigned", "accepted", "in_progress", "resolved"].includes(c.status));
  const cycleUpdates = c.updates.filter((u) => u.cycle === c.cycle);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/casos" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Casos
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{c.folio}</span>
          <CaseStatusBadge status={c.status} />
          <span className="text-xs text-muted-foreground">Prioridad {PRIORITY_LABELS[c.priority].toLowerCase()}</span>
          <span className="ml-auto">
            <HelpSheet title="Cómo atender un caso" sections={topicsFor(member.role, ["recibe", "aceptar", "evidencia", "validar", "reabrir", "notas"])} />
          </span>
          {overdue && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-negative">
              <AlarmClock className="size-3.5" aria-hidden /> Plazo vencido
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
        {c.status === "merged" && c.mergedInto && (
          <p className="text-sm">
            Fusionado en{" "}
            <Link href={`/casos/${c.mergedInto.id}`} className="font-medium underline">
              {c.mergedInto.folio}
            </Link>
            {c.status_reason ? ` · ${c.status_reason}` : ""}
          </p>
        )}
        {c.status !== "merged" && c.status_reason && (c.status === "returned" || c.status === "discarded" || c.status === "in_review") && (
          <p className="text-sm text-muted-foreground">Motivo: {c.status_reason}</p>
        )}
        {c.status === "closed" && c.result && <p className="text-sm">Resultado: {c.result}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <CaseActions
            caseId={c.id}
            status={c.status}
            actor={actor}
            isResponsibleDepartment={responsible}
            departments={catalogs.departments}
            departmentId={c.department_id}
            supportIds={support.map((t) => t.department_id)}
            responsibleUserId={c.responsible_user_id}
            people={people}
            priority={c.priority}
            dueAt={c.due_at}
            acceptDueAt={c.accept_due_at}
            commitment={c.commitment}
            sla={catalogs.sla}
            slaTerms={slaTerms}
            validation={{
              cycle: c.cycle,
              updates: cycleUpdates.length,
              evidence: cycleUpdates.reduce((n, u) => n + u.evidence.length, 0),
              openTasks: c.tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
            }}
          />
          {editor && (
            <CaseManage
              current={{
                id: c.id,
                title: c.title,
                description: c.description,
                category: c.category,
                neighborhood_id: c.neighborhood_id,
                priority: c.priority,
                due_at: c.due_at,
                responsible_user_id: c.responsible_user_id,
              }}
              neighborhoods={catalogs.neighborhoods}
              people={c.people}
              mergeCandidates={mergeCandidates}
              open={isOpen}
            />
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          {c.description && (
            <Card>
              <CardContent className="pt-4 text-sm whitespace-pre-wrap">{c.description}</CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {nf.format(c.mentions.length)} {c.mentions.length === 1 ? "mención" : "menciones"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Cada publicación se sigue contando por separado en dashboard y reportes.</p>
            </CardHeader>
            <CardContent>
              <CaseMentions caseId={c.id} mentions={c.mentions} suggestions={suggestions} editor={editor && isOpen} neighborhoods={neighborhoods} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Avances y evidencia</CardTitle>
            </CardHeader>
            <CardContent>
              <CaseUpdates caseId={c.id} updates={c.updates} tasks={c.tasks} canWrite={canReport} coordinator={editor} departments={departments} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notas</CardTitle>
            </CardHeader>
            <CardContent>
              <CaseNotes caseId={c.id} notes={c.notes} canWrite={editor || member.role === "dependencia"} editor={editor} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos del caso</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <Row label="Dependencia">{c.department_id ? departments.get(c.department_id) : "Sin asignar"}</Row>
                {c.areas.some((a) => !a.is_primary) && (
                  <Row label="Apoyo">
                    {c.areas
                      .filter((a) => !a.is_primary)
                      .map((a) => departments.get(a.department_id))
                      .join(", ")}
                  </Row>
                )}
                <Row label="Responsable">{person?.name ?? "Sin persona asignada"}</Row>
                <Row label="Colonia">{c.neighborhood_id ? neighborhoods[c.neighborhood_id] : "Sin colonia"}</Row>
                {c.category && <Row label="Categoría">{c.category}</Row>}
                {c.accept_due_at && (
                  <Row label="Aceptar antes de">
                    <span className={cn(overdue && due === c.accept_due_at && "font-medium text-negative")} suppressHydrationWarning>
                      {formatDateTime(c.accept_due_at)}
                      {c.status === "assigned" && ` (${fromNow(c.accept_due_at)})`}
                    </span>
                  </Row>
                )}
                <Row label="Compromiso">
                  {c.due_at ? (
                    <span className={cn(overdue && due === c.due_at && "font-medium text-negative")} suppressHydrationWarning>
                      {formatDateTime(c.due_at)} ({fromNow(c.due_at)})
                    </span>
                  ) : (
                    "Sin plazo"
                  )}
                </Row>
                {c.commitment && <Row label="Qué hará">{c.commitment}</Row>}
                {slaVersion && (
                  <Row label="SLA">
                    Versión {slaVersion.version} · {slaVersion.approved ? "acuerdo aprobado" : "valores de referencia, sin acuerdo aprobado"}
                    {(c.sla_terms as { overridden?: boolean } | null)?.overridden ? " · plazos ajustados al asignar" : ""}
                  </Row>
                )}
                {/* The author of the case (who opened it), not of the publications. */}
                <Row label="Abrió">
                  {openedBy?.actor_name || "—"} · {formatDateTime(c.opened_at)}
                </Row>
                {c.cycle > 1 && <Row label="Ciclo">{c.cycle} (reabierto)</Row>}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ubicación</CardTitle>
            </CardHeader>
            <CardContent>
              <CaseLocation
                caseId={c.id}
                location={{
                  status: c.location_status as "confirmed" | "inferred" | "unavailable",
                  source: c.location_source ?? "sin_dato",
                  confidence: c.location_confidence === null ? null : Number(c.location_confidence),
                  neighborhoodId: c.neighborhood_id,
                  lat: c.location_lat === null ? null : Number(c.location_lat),
                  lng: c.location_lng === null ? null : Number(c.location_lng),
                }}
                history={c.locationHistory}
                neighborhoods={catalogs.neighborhoods}
                canEdit={editor && c.status !== "merged"}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tiempos</CardTitle>
              <p className="text-xs text-muted-foreground">Por ciclo; una reapertura no borra los anteriores.</p>
            </CardHeader>
            <CardContent>
              <CaseTimes cycles={c.cycles} validations={c.validations} />
            </CardContent>
          </Card>
          {(c.tasks.length > 0 || ((editor || responsible) && working)) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tareas</CardTitle>
                <p className="text-xs text-muted-foreground">Responsable principal: {c.department_id ? departments.get(c.department_id) : "sin asignar"}.</p>
              </CardHeader>
              <CardContent>
                <CaseTasks
                  caseId={c.id}
                  tasks={c.tasks}
                  areas={areas}
                  people={people}
                  names={names}
                  departments={departments}
                  manager={editor || responsible}
                  userDepartment={member.departmentId}
                  canAdd={(editor || responsible) && working}
                  active={working || c.status === "resolved"}
                />
              </CardContent>
            </Card>
          )}
          {c.tickets.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Turnos</CardTitle>
                <p className="text-xs text-muted-foreground">Siguen el estado del caso.</p>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {c.tickets.map((t) => (
                    <li key={t.id} className={cn("rounded-lg border p-2.5", isOverdue(t) && "border-negative/40")}>
                      <p className="flex items-center justify-between gap-2">
                        <span className="font-medium">{departments.get(t.department_id) ?? "Dependencia"}</span>
                        <span className="text-xs text-muted-foreground">{TICKET_LABELS[t.status]}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t === lead ? "Responsable" : "Apoyo"}
                        {t.whatsapp_notified_at && (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <MessageCircle className="size-3" aria-hidden /> Avisado {formatDateTime(t.whatsapp_notified_at)}
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historial</CardTitle>
            </CardHeader>
            <CardContent>
              <CaseHistory events={c.events} names={names} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function CaseSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando caso">
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-8 w-80" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
