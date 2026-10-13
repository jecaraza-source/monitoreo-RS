"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, CheckCheck, FolderKanban, FolderPlus, Keyboard, ListChecks, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { CaseDialog, type CaseRequest } from "@/components/cases/case-dialog";
import { CaseStatusBadge } from "@/components/cases/case-status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui-kit";
import { setTriage, type InboxActionResult } from "@/lib/inbox/actions";
import type { InboxCatalogs } from "@/lib/inbox/data";
import {
  appendUnique,
  filtersToSearch,
  PRIORITY_LABELS,
  VIEW_LABELS,
  type InboxFilters,
  type InboxScope,
  type InboxView,
  type QueueCursor,
  type ViewCounts,
} from "@/lib/inbox/model";
import { fetchCounts, fetchQueue, type QueueEntry } from "@/lib/inbox/query";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CaseCard } from "./case-card";
import { DetailPanel } from "./detail-panel";
import { FilterBar } from "./filter-bar";
import { formatDateTime } from "./format";
import { buildLookups } from "./lookups";
import { CARD_HEIGHT, MentionCard } from "./mention-card";
import { caseRequestFor, routeRequestFor } from "./requests";
import { RouteDialog, type RouteRequest } from "./route-dialog";
import { useHotkeys } from "./use-hotkeys";
import { ViewTabs } from "./view-tabs";
import { VirtualList } from "./virtual-list";

const ROW_HEIGHT = CARD_HEIGHT + 10;

const SHORTCUTS: [string, string, InboxScope | null][] = [
  ["j / k", "Siguiente / anterior", null],
  ["Enter", "Abrir detalle", null],
  ["x", "Seleccionar", "editor"],
  ["t", "Turnar menciones seleccionadas", "editor"],
  ["c", "Crear caso o agregar a uno", "editor"],
  ["r", "Marcar revisadas", "editor"],
  ["d", "Descartar", "editor"],
  ["u", "Actualizar la vista", null],
  ["/", "Buscar", null],
  ["?", "Ver atajos", null],
];

const EMPTY: Record<InboxView, { title: string; editor: string; department: string }> = {
  new: { title: "No hay nada nuevo", editor: "Las menciones y casos nuevos aparecerán aquí.", department: "" },
  urgent: {
    title: "Nada urgente pendiente",
    editor: "Aquí aparece lo de prioridad alta o gravedad alta que aún no se resuelve.",
    department: "Cuando te asignen algo urgente aparecerá aquí primero.",
  },
  unassigned: { title: "Todo tiene responsable", editor: "Lo que requiere atención y nadie tiene aparecerá aquí.", department: "" },
  acceptance: {
    title: "Nada por aceptar",
    editor: "Los turnos y casos asignados que la dependencia aún no acepta aparecerán aquí.",
    department: "Lo que te asignen aparecerá aquí para aceptarlo.",
  },
  overdue: { title: "Nada vencido", editor: "Ningún turno ni caso abierto pasó su plazo.", department: "Vas al día: nada pasó su plazo." },
  validation: {
    title: "Nada por validar",
    editor: "Lo que las dependencias marquen como atendido aparecerá aquí para validar y cerrar.",
    department: "Lo que marques como atendido queda aquí hasta que Comunicación lo valide.",
  },
};

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

/**
 * One operational view of the inbox (Nuevas, Urgentes…): mentions and cases
 * ordered by urgency, due date and age. The server renders the first page and
 * the counters; more pages load by cursor; any change refreshes from the server
 * so lists and counters stay in agreement.
 */
export function QueueView({
  orgId,
  scope,
  departmentName,
  catalogs,
  view,
  filters,
  initialEntries,
  initialNext,
  counts: initialCounts,
}: {
  orgId: string;
  scope: InboxScope;
  departmentName: string | null;
  catalogs: InboxCatalogs;
  view: InboxView;
  filters: InboxFilters;
  initialEntries: QueueEntry[];
  initialNext: QueueCursor | null;
  counts: ViewCounts | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const lookups = useMemo(() => buildLookups(catalogs), [catalogs]);
  const editor = scope === "editor";
  const desktop = useIsDesktop();
  const [refreshing, startRefresh] = useTransition();

  const [entries, setEntries] = useState(initialEntries);
  const [next, setNext] = useState(initialNext);
  const [counts, setCounts] = useState(initialCounts);
  const [activeKey, setActiveKey] = useState<string | null>(initialEntries[0]?.key ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [route, setRoute] = useState<RouteRequest | null>(null);
  const [caseRequest, setCaseRequest] = useState<CaseRequest | null>(null);
  const [changed, setChanged] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadingMore = useRef(false);

  // A new server render (filters, refresh) replaces the list; the reader keeps their place if it is still there.
  const [rendered, setRendered] = useState(initialEntries);
  if (rendered !== initialEntries) {
    setRendered(initialEntries);
    setEntries(initialEntries);
    setNext(initialNext);
    setCounts(initialCounts);
    setChecked(new Set());
    setChanged(false);
    setActiveKey((k) => (initialEntries.some((e) => e.key === k) ? k : (initialEntries[0]?.key ?? null)));
  }

  const active = entries.find((e) => e.key === activeKey) ?? null;
  const activeIndex = active ? entries.indexOf(active) : -1;
  const selected = entries.filter((e) => checked.has(e.key));
  const selectedMentions = selected.flatMap((e) => (e.kind === "mention" ? [e.mention] : []));
  const selectedCases = selected.length - selectedMentions.length;

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  const loadMore = useCallback(async () => {
    if (!next || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await fetchQueue(supabase, orgId, scope, view, filters, next);
      setEntries((current) => appendUnique(current, page.entries));
      setNext(page.next);
    } catch {
      toast.error("No se pudieron cargar más elementos.");
    } finally {
      loadingMore.current = false;
    }
  }, [next, supabase, orgId, scope, view, filters]);

  // Realtime: a change somewhere may move items between views. Counters update
  // at once; the list waits for the reader ("Actualizar"), so it never jumps.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const recount = () => {
      setChanged(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fetchCounts(supabase, orgId, filters).then((c) => c && setCounts(c)), 400);
    };
    const filter = `org_id=eq.${orgId}`;
    const channel = supabase
      .channel(`queue:${orgId}:${view}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter }, recount)
      .on("postgres_changes", { event: "*", schema: "public", table: "classifications", filter }, recount)
      .on("postgres_changes", { event: "*", schema: "public", table: "mentions", filter }, recount);
    supabase.auth.getSession().then(({ data }) => {
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel.subscribe();
    });
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, orgId, view, filters]);

  function navigate(nextFilters: InboxFilters) {
    router.push(`/bandeja${filtersToSearch({ ...nextFilters, view, status: undefined })}`);
  }

  function focusEntry(key: string) {
    setActiveKey(key);
    const index = entries.findIndex((e) => e.key === key);
    const el = scrollRef.current;
    if (el && index >= 0) {
      const top = index * ROW_HEIGHT;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
    if (!window.matchMedia("(min-width: 1024px)").matches) setSheetOpen(true);
  }

  function move(delta: number) {
    if (!entries.length) return;
    const index = Math.min(entries.length - 1, Math.max(0, (activeIndex < 0 ? -1 : activeIndex) + delta));
    focusEntry(entries[index].key);
  }

  function toggle(key: string) {
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  /** Selected mentions, or the active one when nothing is selected. */
  function targetMentions() {
    if (checked.size) return selectedMentions;
    return active?.kind === "mention" ? [active.mention] : [];
  }

  function report(result: InboxActionResult) {
    if (!result.ok) {
      toast.error(result.message);
    } else if (result.failed?.length) {
      toast.warning(result.message);
    } else {
      toast.success(result.message);
    }
  }

  async function triage(value: "reviewed" | "discarded") {
    const list = targetMentions();
    if (!editor || !list.length) return;
    const result = await setTriage({ ids: list.map((m) => m.id), triage: value });
    report(result);
    if (result.ok) refresh();
  }

  function openRoute() {
    const list = targetMentions();
    if (!editor || !list.length) return;
    setRoute(routeRequestFor(list));
  }

  function openCase() {
    const list = targetMentions();
    if (!editor || !list.length) return;
    setCaseRequest(caseRequestFor(list, lookups));
  }

  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      Enter: () => active && !desktop && setSheetOpen(true),
      x: () => editor && active && toggle(active.key),
      t: () => openRoute(),
      c: () => openCase(),
      r: () => void triage("reviewed"),
      d: () => void triage("discarded"),
      u: () => refresh(),
      "/": () => searchRef.current?.focus(),
      "?": () => setHelp(true),
      Escape: () => (checked.size ? setChecked(new Set()) : setSheetOpen(false)),
    },
    route === null && caseRequest === null && !help,
  );

  const total = counts?.[view];
  const allChecked = entries.length > 0 && checked.size === entries.length;
  const barFilters: InboxFilters = { ...filters, view: undefined };

  const detail = active ? (
    active.kind === "mention" ? (
      <DetailPanel
        key={active.key}
        item={active.mention}
        scope={scope}
        catalogs={catalogs}
        lookups={lookups}
        notesVersion={0}
        onRoute={() => setRoute(routeRequestFor([active.mention]))}
        onCase={() => setCaseRequest(caseRequestFor([active.mention], lookups))}
        onChanged={() => refresh()}
      />
    ) : (
      <div className="flex flex-col gap-3 text-sm">
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          <FolderKanban className="size-3.5" aria-hidden /> Caso {active.case.folio}
        </p>
        <h2 className="text-base font-semibold">{active.case.title}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Estado</dt>
          <dd>
            <CaseStatusBadge status={active.case.status} />
          </dd>
          <dt className="text-muted-foreground">Prioridad</dt>
          <dd>{PRIORITY_LABELS[active.case.priority]}</dd>
          <dt className="text-muted-foreground">Dependencia</dt>
          <dd>{active.case.department_id ? lookups.departments.get(active.case.department_id) : "Sin responsable"}</dd>
          <dt className="text-muted-foreground">Menciones</dt>
          <dd>{active.case.mentions}</dd>
          <dt className="text-muted-foreground">Plazo</dt>
          <dd>{active.case.due_at ? formatDateTime(active.case.due_at) : "Sin plazo"}</dd>
        </dl>
        <Link href={`/casos/${active.case.id}`} className={buttonVariants({ size: "sm", className: "w-fit" })}>
          Abrir el caso
        </Link>
      </div>
    )
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Bandeja · {VIEW_LABELS[view].label}</h1>
        <p className="text-sm text-muted-foreground">
          {VIEW_LABELS[view].hint} {scope === "department" ? `Sólo ${departmentName ?? "tu dependencia"}.` : ""} Ordenado por urgencia, plazo y
          antigüedad.
        </p>
      </div>

      <ViewTabs scope={scope} filters={filters} counts={counts} />
      <FilterBar scope={scope} catalogs={catalogs} filters={barFilters} onChange={navigate} searchRef={searchRef} hideStatus />

      <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
        {editor && (
          <Checkbox
            checked={allChecked}
            indeterminate={checked.size > 0 && !allChecked}
            onCheckedChange={() => setChecked(allChecked ? new Set() : new Set(entries.map((e) => e.key)))}
            aria-label="Seleccionar todo lo cargado"
          />
        )}
        {checked.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Acciones sobre la selección">
            <span className="font-medium">
              {checked.size} {checked.size === 1 ? "seleccionada" : "seleccionadas"}
              {selectedCases > 0 && <span className="font-normal text-muted-foreground"> ({selectedCases} {selectedCases === 1 ? "caso" : "casos"}: se gestionan en Casos)</span>}
            </span>
            <Button size="sm" onClick={openRoute} disabled={!selectedMentions.length} aria-keyshortcuts="t">
              <Send aria-hidden /> Turnar
            </Button>
            <Button size="sm" variant="outline" onClick={openCase} disabled={!selectedMentions.length} aria-keyshortcuts="c">
              <FolderPlus aria-hidden /> Caso
            </Button>
            <Button size="sm" variant="outline" onClick={() => triage("reviewed")} disabled={!selectedMentions.length} aria-keyshortcuts="r">
              <CheckCheck aria-hidden /> Revisadas
            </Button>
            <Button size="sm" variant="outline" onClick={() => triage("discarded")} disabled={!selectedMentions.length} aria-keyshortcuts="d">
              <Archive aria-hidden /> Descartar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
              <X aria-hidden /> Quitar selección
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground" aria-live="polite">
            {total === undefined ? "" : `${total.toLocaleString("es-MX")} en esta vista`}
            {entries.length < (total ?? 0) ? ` · ${entries.length} cargadas` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {changed && (
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} aria-keyshortcuts="u">
              <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden /> Hay cambios: actualizar
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setHelp(true)} aria-label="Atajos de teclado" aria-keyshortcuts="?">
            <Keyboard aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div
          ref={scrollRef}
          className={cn("h-[calc(100svh-19rem)] min-h-96 overflow-y-auto overscroll-contain pr-1", refreshing && "opacity-60")}
        >
          {entries.length === 0 ? (
            <EmptyState
              icon={<ListChecks />}
              title={Object.values(barFilters).some(Boolean) ? "Nada coincide con los filtros en esta vista" : EMPTY[view].title}
              description={(scope === "editor" ? EMPTY[view].editor : EMPTY[view].department) || undefined}
            />
          ) : (
            <VirtualList
              items={entries}
              rowHeight={ROW_HEIGHT}
              scrollRef={scrollRef}
              getKey={(e) => e.key}
              onEndReached={loadMore}
              label={VIEW_LABELS[view].label}
              renderRow={(entry) =>
                entry.kind === "mention" ? (
                  <MentionCard
                    item={entry.mention}
                    scope={scope}
                    lookups={lookups}
                    active={entry.key === activeKey}
                    checked={checked.has(entry.key)}
                    fresh={false}
                    onSelect={() => focusEntry(entry.key)}
                    onToggle={() => toggle(entry.key)}
                  />
                ) : (
                  <CaseCard
                    item={entry.case}
                    lookups={lookups}
                    active={entry.key === activeKey}
                    checked={checked.has(entry.key)}
                    selectable={editor}
                    onSelect={() => focusEntry(entry.key)}
                    onToggle={() => toggle(entry.key)}
                  />
                )
              }
            />
          )}
        </div>

        {desktop ? (
          <aside aria-label="Detalle" className="hidden h-[calc(100svh-19rem)] min-h-96 overflow-y-auto rounded-xl border bg-card p-4 lg:block">
            {detail ?? <p className="text-sm text-muted-foreground">Elige un elemento para ver su detalle.</p>}
          </aside>
        ) : (
          <Sheet open={sheetOpen && active !== null} onOpenChange={setSheetOpen}>
            <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-md">
              <SheetTitle className="sr-only">Detalle</SheetTitle>
              {detail}
            </SheetContent>
          </Sheet>
        )}
      </div>

      <RouteDialog
        request={route}
        departments={catalogs.departments}
        sla={catalogs.sla}
        policies={catalogs.policies}
        onClose={() => setRoute(null)}
        onRouted={() => refresh()}
      />
      <CaseDialog
        request={caseRequest}
        orgId={orgId}
        neighborhoods={catalogs.neighborhoods}
        onClose={() => setCaseRequest(null)}
        onDone={() => refresh()}
      />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atajos de teclado</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            {SHORTCUTS.filter(([, , only]) => !only || only === scope).map(([key, label]) => (
              <div key={key} className="contents">
                <dt>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
