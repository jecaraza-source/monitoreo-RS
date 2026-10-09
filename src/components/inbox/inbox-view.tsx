"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClock, Archive, ArrowUp, CheckCheck, Inbox, Keyboard, Radio, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AnimatedNumber, EmptyState } from "@/components/ui-kit";
import { createClient } from "@/lib/supabase/client";
import { setTriage } from "@/lib/inbox/actions";
import type { InboxCatalogs } from "@/lib/inbox/data";
import { filtersToSearch, upsertSorted, type InboxFilters, type InboxScope, type Priority, type TriageStatus } from "@/lib/inbox/model";
import { countOverdue, fetchInbox, type InboxItem, type InboxPage } from "@/lib/inbox/query";
import { cn } from "@/lib/utils";
import { DetailPanel } from "./detail-panel";
import { FilterBar } from "./filter-bar";
import { buildLookups } from "./lookups";
import { CARD_HEIGHT, MentionCard } from "./mention-card";
import { RouteDialog, type RouteRequest } from "./route-dialog";
import { useHotkeys } from "./use-hotkeys";
import { VirtualList } from "./virtual-list";

const ROW_HEIGHT = CARD_HEIGHT + 10;
const FRESH_MS = 4000;
const PRIORITY_RANK: Record<Priority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

const SHORTCUTS: [string, string, InboxScope | null][] = [
  ["j / k", "Siguiente / anterior", null],
  ["Enter", "Abrir detalle", null],
  ["x", "Seleccionar", "editor"],
  ["t", "Turnar a dependencia", "editor"],
  ["d", "Descartar", "editor"],
  ["r", "Marcar revisada", "editor"],
  ["/", "Buscar", null],
  ["Esc", "Quitar selección / cerrar", null],
  ["?", "Ver atajos", null],
];

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

export function InboxView({
  orgId,
  scope,
  departmentName,
  catalogs,
  initialFilters,
  initialPage,
  initialOverdue,
}: {
  orgId: string;
  scope: InboxScope;
  departmentName: string | null;
  catalogs: InboxCatalogs;
  initialFilters: InboxFilters;
  initialPage: InboxPage;
  initialOverdue: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const lookups = useMemo(() => buildLookups(catalogs), [catalogs]);
  const editor = scope === "editor";
  const desktop = useIsDesktop();

  const [filters, setFilters] = useState(initialFilters);
  const [items, setItems] = useState(initialPage.items);
  const [next, setNext] = useState(initialPage.next);
  const [total, setTotal] = useState(initialPage.total ?? initialPage.items.length);
  const [loading, setLoading] = useState(false);
  const [overdue, setOverdue] = useState(initialOverdue);
  const [activeId, setActiveId] = useState<string | null>(initialPage.items[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [newAbove, setNewAbove] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [route, setRoute] = useState<RouteRequest | null>(null);
  const [notesBump, setNotesBump] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const [live, setLive] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef(filters);
  const itemsRef = useRef(items);
  const nextRef = useRef(next);
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  useEffect(() => {
    filtersRef.current = filters;
    itemsRef.current = items;
    nextRef.current = next;
  });

  const activeIndex = items.findIndex((i) => i.id === activeId);
  const active = activeIndex >= 0 ? items[activeIndex] : null;

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  const applyFilters = useCallback(
    async (nextFilters: InboxFilters) => {
      setFilters(nextFilters);
      window.history.replaceState(null, "", `/bandeja${filtersToSearch(nextFilters)}`);
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const page = await fetchInbox(supabase, orgId, scope, nextFilters, { count: true });
        if (request !== requestRef.current) return;
        setItems(page.items);
        setNext(page.next);
        setTotal(page.total ?? page.items.length);
        setActiveId(page.items[0]?.id ?? null);
        setChecked(new Set());
        setNewAbove(0);
        scrollRef.current?.scrollTo({ top: 0 });
      } catch (error) {
        if (request === requestRef.current) toast.error(error instanceof Error ? error.message : "No se pudo cargar la bandeja.");
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [supabase, orgId, scope],
  );

  const loadMore = useCallback(async () => {
    const cursor = nextRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const request = requestRef.current;
    try {
      const page = await fetchInbox(supabase, orgId, scope, filtersRef.current, { cursor });
      if (request !== requestRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id));
        return [...current, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setNext(page.next);
    } catch {
      toast.error("No se pudieron cargar más menciones.");
    } finally {
      loadingMoreRef.current = false;
    }
  }, [supabase, orgId, scope]);

  // -------------------------------------------------------------------------
  // Refresh specific mentions (after an action or a Realtime event)
  // -------------------------------------------------------------------------

  const queueRef = useRef<{ ids: Set<string>; announce: Set<string>; timer: ReturnType<typeof setTimeout> | null }>({
    ids: new Set(),
    announce: new Set(),
    timer: null,
  });

  const flush = useCallback(async () => {
    const queue = queueRef.current;
    const ids = [...queue.ids];
    const announce = new Set(queue.announce);
    queue.ids.clear();
    queue.announce.clear();
    queue.timer = null;
    if (!ids.length) return;

    const request = requestRef.current;
    let page: InboxPage;
    try {
      page = await fetchInbox(supabase, orgId, scope, filtersRef.current, { ids });
    } catch {
      return;
    }
    if (request !== requestRef.current) return;

    const found = new Map(page.items.map((i) => [i.id, i]));
    const current = itemsRef.current;
    const present = new Set(current.map((i) => i.id));
    let list = current;
    const arrived: InboxItem[] = [];

    for (const id of ids) {
      const item = found.get(id);
      if (item) {
        if (!present.has(id)) arrived.push(item);
        list = upsertSorted(list, item);
      } else if (present.has(id)) {
        list = list.filter((i) => i.id !== id);
      }
    }
    const removed = ids.filter((id) => present.has(id) && !found.has(id));

    // Keep the reader's place when something lands above what they are reading.
    const el = scrollRef.current;
    if (el && arrived.length) {
      const above = arrived.filter((i) => list.indexOf(i) * ROW_HEIGHT < el.scrollTop).length;
      if (above) {
        el.scrollTop += above * ROW_HEIGHT;
        setNewAbove((n) => n + above);
      }
    }
    // When the active mention leaves the view (discarded, resolved…), move on.
    if (removed.includes(activeId ?? "")) {
      const oldIndex = current.findIndex((i) => i.id === activeId);
      setActiveId(list[Math.min(oldIndex, list.length - 1)]?.id ?? null);
    }

    setItems(list);
    setTotal((t) => Math.max(0, t + arrived.length - removed.length));
    if (removed.length) setChecked((c) => new Set([...c].filter((id) => !removed.includes(id))));
    if (arrived.length) {
      setFresh((f) => new Set([...f, ...arrived.map((i) => i.id)]));
      setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !arrived.some((i) => i.id === id)))), FRESH_MS);
      for (const item of arrived.filter((i) => announce.has(i.id))) {
        toast(scope === "department" ? "Nuevo ticket turnado" : "Nueva mención", {
          description: item.text.length > 90 ? `${item.text.slice(0, 90)}…` : item.text,
          action: { label: "Ver", onClick: () => focusItem(item.id) },
        });
      }
    }
    // focusItem is stable enough here: it reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, orgId, scope, activeId]);

  const refresh = useCallback(
    (id: string, announce = false) => {
      const queue = queueRef.current;
      queue.ids.add(id);
      if (announce) queue.announce.add(id);
      // Routing fires several events (ticket, mention, note): batch them.
      if (!queue.timer) queue.timer = setTimeout(flush, 200);
    },
    [flush],
  );

  // -------------------------------------------------------------------------
  // Realtime: RLS decides which changes reach this user
  // -------------------------------------------------------------------------

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    let overdueTimer: ReturnType<typeof setTimeout> | null = null;
    const recountOverdue = () => {
      if (overdueTimer) clearTimeout(overdueTimer);
      overdueTimer = setTimeout(() => countOverdue(supabase, orgId).then(setOverdue), 300);
    };
    const filter = `org_id=eq.${orgId}`;
    type Row = { id?: string; mention_id?: string };
    const mentionOf = (row: Row | undefined, key: "id" | "mention_id") => row?.[key];

    const channel = supabase
      .channel(`inbox:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter }, (payload) => {
        const id = mentionOf(payload.new as Row, "mention_id");
        if (id) refreshRef.current(id, payload.eventType === "INSERT" && scope === "department");
        recountOverdue();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "classifications", filter }, (payload) => {
        const id = mentionOf(payload.new as Row, "mention_id");
        if (id) refreshRef.current(id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "mentions", filter }, (payload) => {
        const id = mentionOf(payload.new as Row, "id");
        if (id) refreshRef.current(id);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mention_notes", filter }, (payload) => {
        const id = mentionOf(payload.new as Row, "mention_id");
        if (id) setNotesBump((b) => ({ id, n: b.n + 1 }));
      });

    // Subscribe with the user's token so RLS applies to what is delivered.
    supabase.auth.getSession().then(({ data }) => {
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    });
    return () => {
      if (overdueTimer) clearTimeout(overdueTimer);
      supabase.removeChannel(channel);
    };
  }, [supabase, orgId, scope]);

  // -------------------------------------------------------------------------
  // Selection, navigation and actions
  // -------------------------------------------------------------------------

  function ensureVisible(index: number) {
    const el = scrollRef.current;
    if (!el || index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }

  function focusItem(id: string) {
    const index = itemsRef.current.findIndex((i) => i.id === id);
    if (index < 0) return;
    setActiveId(id);
    ensureVisible(index);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSheetOpen(true);
  }

  function move(delta: number) {
    if (!items.length) return;
    const index = Math.min(items.length - 1, Math.max(0, (activeIndex < 0 ? -1 : activeIndex) + delta));
    setActiveId(items[index].id);
    ensureVisible(index);
  }

  function toggle(id: string) {
    setChecked((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Checked mentions, or the active one when nothing is checked. */
  function targets(): InboxItem[] {
    if (checked.size) return items.filter((i) => checked.has(i.id));
    return active ? [active] : [];
  }

  function openRoute(list = targets()) {
    if (!editor || !list.length) return;
    const departments = new Set(list.map((i) => i.classifications?.department_id ?? null));
    const priority = list
      .map((i) => i.classifications?.priority)
      .filter((p): p is Priority => Boolean(p))
      .sort((a, b) => PRIORITY_RANK[b] - PRIORITY_RANK[a])[0];
    setRoute({
      ids: list.map((i) => i.id),
      departmentId: departments.size === 1 ? [...departments][0] : null,
      priority: priority ?? null,
    });
  }

  async function triage(value: "reviewed" | "discarded", list = targets()) {
    if (!editor || !list.length) return;
    const previous = new Map<TriageStatus, string[]>();
    for (const i of list) previous.set(i.triage, [...(previous.get(i.triage) ?? []), i.id]);
    const ids = list.map((i) => i.id);
    const result = await setTriage({ ids, triage: value });
    if (!result.ok) return void toast.error(result.message);
    setChecked(new Set());
    ids.forEach((id) => refresh(id));
    toast.success(result.message, {
      action:
        value === "discarded"
          ? {
              label: "Deshacer",
              onClick: async () => {
                for (const [status, group] of previous) await setTriage({ ids: group, triage: status });
                ids.forEach((id) => refresh(id));
              },
            }
          : undefined,
    });
  }

  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      Enter: () => active && !desktop && setSheetOpen(true),
      x: () => editor && active && toggle(active.id),
      t: () => openRoute(),
      d: () => void triage("discarded"),
      r: () => void triage("reviewed"),
      "/": () => searchRef.current?.focus(),
      "?": () => setHelp(true),
      Escape: () => {
        if (checked.size) setChecked(new Set());
        else setSheetOpen(false);
      },
    },
    route === null && !help,
  );

  const allChecked = items.length > 0 && checked.size === items.length;
  const statusLabel = loading ? "Cargando…" : `${total.toLocaleString("es-MX")} ${total === 1 ? "mención" : "menciones"}`;

  const detail = active && (
    <DetailPanel
      key={active.id}
      item={active}
      scope={scope}
      catalogs={catalogs}
      lookups={lookups}
      notesVersion={notesBump.id === active.id ? notesBump.n : 0}
      onRoute={() => openRoute([active])}
      onChanged={(id) => refresh(id)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bandeja</h1>
          <p className="text-sm text-muted-foreground">
            {editor
              ? "Menciones por atender: corrige, turna o descarta."
              : `Tickets turnados a ${departmentName ?? "tu dependencia"}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scope === "department" ? (
            <button
              type="button"
              onClick={() => applyFilters({ ...filters, status: filters.status === "overdue" ? undefined : "overdue" })}
              aria-pressed={filters.status === "overdue"}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors",
                overdue > 0 ? "border-negative/40 bg-negative/10 text-negative hover:bg-negative/15" : "text-muted-foreground",
              )}
              title={filters.status === "overdue" ? "Ver pendientes" : "Ver sólo vencidos"}
            >
              <OverdueCount value={overdue} />
            </button>
          ) : (
            <span
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm",
                overdue > 0 ? "border-negative/40 bg-negative/10 text-negative" : "text-muted-foreground",
              )}
              title="Tickets vencidos en todas las dependencias"
            >
              <OverdueCount value={overdue} />
            </span>
          )}
          <span
            className={cn("flex items-center gap-1.5 text-xs", live ? "text-positive" : "text-muted-foreground")}
            title={live ? "Actualización en tiempo real activa" : "Conectando tiempo real…"}
          >
            <Radio className="size-3.5" aria-hidden /> {live ? "En vivo" : "…"}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setHelp(true)} aria-label="Atajos de teclado">
            <Keyboard aria-hidden />
          </Button>
        </div>
      </div>

      <FilterBar scope={scope} catalogs={catalogs} filters={filters} onChange={applyFilters} searchRef={searchRef} />

      <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
        {editor && (
          <Checkbox
            checked={allChecked}
            indeterminate={checked.size > 0 && !allChecked}
            onCheckedChange={() => setChecked(allChecked ? new Set() : new Set(items.map((i) => i.id)))}
            aria-label="Seleccionar todas las cargadas"
          />
        )}
        <AnimatePresence mode="wait" initial={false}>
          {checked.size > 0 ? (
            <motion.div
              key="bulk"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="font-medium">{checked.size} seleccionadas</span>
              <Button size="sm" onClick={() => openRoute()}>
                <Send aria-hidden /> Turnar
              </Button>
              <Button size="sm" variant="outline" onClick={() => triage("reviewed")}>
                <CheckCheck aria-hidden /> Revisadas
              </Button>
              <Button size="sm" variant="outline" onClick={() => triage("discarded")}>
                <Archive aria-hidden /> Descartar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                <X aria-hidden /> Quitar selección
              </Button>
            </motion.div>
          ) : (
            <motion.span key="count" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-muted-foreground">
              {statusLabel}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="relative">
          <AnimatePresence>
            {newAbove > 0 && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                onClick={() => {
                  scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                  setNewAbove(0);
                }}
                className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md"
              >
                <ArrowUp className="size-3.5" aria-hidden /> {newAbove} {newAbove === 1 ? "nueva" : "nuevas"}
              </motion.button>
            )}
          </AnimatePresence>
          <div
            ref={scrollRef}
            onScroll={(e) => e.currentTarget.scrollTop < ROW_HEIGHT && newAbove > 0 && setNewAbove(0)}
            className={cn("h-[calc(100svh-19rem)] min-h-96 overflow-y-auto overscroll-contain pr-1", loading && "opacity-60")}
          >
            {items.length === 0 && !loading ? (
              <EmptyState
                icon={<Inbox />}
                title={Object.values(filters).some(Boolean) ? "Nada coincide con los filtros" : "Tu bandeja está al día"}
                description={
                  editor
                    ? "Las menciones nuevas aparecerán aquí en cuanto lleguen."
                    : "Cuando Comunicación te turne una mención aparecerá aquí al instante."
                }
              />
            ) : (
              <VirtualList
                items={items}
                rowHeight={ROW_HEIGHT}
                scrollRef={scrollRef}
                getKey={(i) => i.id}
                onEndReached={loadMore}
                label="Menciones"
                renderRow={(item) => (
                  <MentionCard
                    item={item}
                    scope={scope}
                    lookups={lookups}
                    active={item.id === activeId}
                    checked={checked.has(item.id)}
                    fresh={fresh.has(item.id)}
                    onSelect={() => focusItem(item.id)}
                    onToggle={() => toggle(item.id)}
                  />
                )}
              />
            )}
          </div>
        </div>

        {desktop ? (
          <aside
            aria-label="Detalle de la mención"
            className="hidden h-[calc(100svh-19rem)] min-h-96 overflow-y-auto rounded-xl border bg-card p-4 lg:block"
          >
            {detail ?? <p className="text-sm text-muted-foreground">Elige una mención para ver su detalle.</p>}
          </aside>
        ) : (
          <Sheet open={sheetOpen && active !== null} onOpenChange={setSheetOpen}>
            <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-md">
              <SheetTitle className="sr-only">Detalle de la mención</SheetTitle>
              {detail}
            </SheetContent>
          </Sheet>
        )}
      </div>

      <RouteDialog
        request={route}
        departments={catalogs.departments}
        onClose={() => setRoute(null)}
        onRouted={(ids) => {
          setChecked(new Set());
          ids.forEach((id) => refresh(id));
        }}
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

const INTEGER: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };

function OverdueCount({ value }: { value: number }) {
  return (
    <>
      <AlarmClock className="size-4" aria-hidden />
      <AnimatedNumber value={value} formatOptions={INTEGER} className="font-semibold tabular-nums" />
      <span>{value === 1 ? "vencido" : "vencidos"}</span>
    </>
  );
}
