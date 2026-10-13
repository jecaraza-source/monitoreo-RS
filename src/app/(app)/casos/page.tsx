import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { AlarmClock, ChevronLeft, ChevronRight, FolderKanban, MapPin, MessagesSquare } from "lucide-react";
import { BackfillPanel } from "@/components/cases/backfill-panel";
import { CaseFilters } from "@/components/cases/case-filters";
import { CaseStatusBadge } from "@/components/cases/case-status-badge";
import { fromNow } from "@/components/inbox/format";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";
import { CASES_PAGE, listCases, parseCaseFilters, type CaseFilters as Filters } from "@/lib/cases/data";
import { caseOverdue, OPEN_CASE_STATUSES } from "@/lib/cases/model";
import { getInboxCatalogs } from "@/lib/inbox/data";
import { PRIORITY_LABELS } from "@/lib/inbox/model";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Casos" };

export default function CasosPage({ searchParams }: PageProps<"/casos">) {
  return (
    <Suspense fallback={<CasesSkeleton />}>
      <Cases searchParams={searchParams} />
    </Suspense>
  );
}

const nf = new Intl.NumberFormat("es-MX");

async function Cases({ searchParams }: { searchParams: PageProps<"/casos">["searchParams"] }) {
  const member = await requireSection("/casos");
  const filters = parseCaseFilters(await searchParams);
  const [catalogs, { rows, total }] = await Promise.all([getInboxCatalogs(member), listCases(member, filters)]);
  const departments = new Map(catalogs.departments.map((d) => [d.id, d.name]));
  const neighborhoods = new Map(catalogs.neighborhoods.map((n) => [n.id, n.name]));
  const page = filters.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / CASES_PAGE));

  const description =
    member.role === "dependencia"
      ? `Casos asignados a ${member.departmentName ?? "tu dependencia"}. Cada caso agrupa las publicaciones sobre un mismo problema.`
      : "Cada caso agrupa las publicaciones sobre un mismo problema y sigue su atención de principio a fin.";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Casos" description={description} />
      {member.role === "admin" && <BackfillPanel />}
      <CaseFilters departments={catalogs.departments} neighborhoods={catalogs.neighborhoods} showDepartment={member.role !== "dependencia"} />
      <p className="text-sm text-muted-foreground">
        {nf.format(total)} {total === 1 ? "caso" : "casos"}
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title={isFiltered(filters) ? "Ningún caso coincide con los filtros" : "Todavía no hay casos abiertos"}
          description={
            member.role === "admin" || member.role === "comunicacion"
              ? "Crea un caso desde la Bandeja: selecciona las menciones sobre el mismo problema y elige «Caso»."
              : member.role === "dependencia"
                ? "Cuando Comunicación te asigne un caso aparecerá aquí."
                : "Aquí verás los casos que Comunicación abra y su avance."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => {
            const overdue = caseOverdue(c.status, c.due_at);
            return (
              <li key={c.id}>
                <Link
                  href={`/casos/${c.id}`}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4",
                    overdue && "border-negative/40",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{c.folio}</span>
                      <CaseStatusBadge status={c.status} />
                      <span className="text-xs text-muted-foreground">Prioridad {PRIORITY_LABELS[c.priority].toLowerCase()}</span>
                    </span>
                    <span className="truncate font-medium">{c.title}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MessagesSquare className="size-3.5" aria-hidden /> {nf.format(c.mentions)} {c.mentions === 1 ? "mención" : "menciones"}
                    </span>
                    {c.neighborhood_id && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden /> {neighborhoods.get(c.neighborhood_id)}
                      </span>
                    )}
                    <span>{c.department_id ? departments.get(c.department_id) : "Sin asignar"}</span>
                    {c.due_at && OPEN_CASE_STATUSES.includes(c.status) && (
                      <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-negative")} suppressHydrationWarning>
                        {overdue && <AlarmClock className="size-3.5" aria-hidden />}
                        {overdue ? "venció" : "vence"} {fromNow(c.due_at)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Páginas" className="flex items-center justify-center gap-2 text-sm">
          <PageLink filters={filters} page={page - 1} disabled={page <= 1}>
            <ChevronLeft aria-hidden /> Anterior
          </PageLink>
          <span className="text-muted-foreground">
            Página {page} de {pages}
          </span>
          <PageLink filters={filters} page={page + 1} disabled={page >= pages}>
            Siguiente <ChevronRight aria-hidden />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function isFiltered(f: Filters) {
  return Boolean(f.q || f.department || f.neighborhood || f.priority || (f.status && f.status !== "open"));
}

function PageLink({ filters, page, disabled, children }: { filters: Filters; page: number; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>{children}</span>;
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "open") params.set("estado", filters.status);
  if (filters.department) params.set("dependencia", filters.department);
  if (filters.neighborhood) params.set("colonia", filters.neighborhood);
  if (filters.priority) params.set("prioridad", filters.priority);
  if (filters.q) params.set("q", filters.q);
  if (page > 1) params.set("pagina", String(page));
  return (
    <Link href={`/casos?${params}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {children}
    </Link>
  );
}

function CasesSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando casos">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-8 w-full max-w-2xl" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
