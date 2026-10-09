"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  BellOff,
  CalendarClock,
  Megaphone,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit";
import { acknowledgeAlerts, rateAlert } from "@/lib/alerts/actions";
import { EVENT_SELECT, toAlertEvent, type AlertEvent } from "@/lib/alerts/data-shared";
import { alertHref, SEVERITY_LABELS, type RuleKind } from "@/lib/alerts/rules";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<RuleKind, typeof TrendingUp> = {
  spike: TrendingUp,
  sentiment_drop: TrendingDown,
  risk_term: ShieldAlert,
  media_negative: Megaphone,
  daily_digest: CalendarClock,
};

const SEVERITY_TONE = {
  critical: "bg-negative text-white",
  high: "bg-negative/15 text-foreground",
  medium: "bg-amber-500/15 text-foreground",
  low: "bg-muted text-muted-foreground",
} as const;

const CHANNEL_LABELS: Record<string, string> = { email: "Correo", whatsapp: "WhatsApp" };
const STATUS_LABELS: Record<string, string> = {
  sent: "enviado",
  not_configured: "sin configurar",
  failed: "falló",
  skipped: "sin destinatarios",
};

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "pending", label: "Sin calificar" },
  { key: "useful", label: "Útiles" },
  { key: "false_alarm", label: "Falsas alarmas" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const time = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });

export function AlertsFeed({
  orgId,
  initialEvents,
  canRate,
  highlightId,
}: {
  orgId: string;
  initialEvents: AlertEvent[];
  canRate: boolean;
  highlightId: string | null;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [filter, setFilter] = useState<Filter>("all");
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Opening the page marks what is on it as seen (clears the bell).
  useEffect(() => {
    const unseen = initialEvents.filter((e) => !e.acknowledgedAt).map((e) => e.id);
    if (unseen.length) void acknowledgeAlerts(unseen);
  }, [initialEvents]);

  // New and updated alerts arrive through Realtime (filtered by RLS).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`alerts:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_events", filter: `org_id=eq.${orgId}` }, async (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (!id) return;
        const { data } = await supabase.from("alert_events").select(EVENT_SELECT).eq("id", id).maybeSingle();
        if (!data) return;
        const event = toAlertEvent(data as never);
        setEvents((current) => {
          const exists = current.some((e) => e.id === id);
          return exists ? current.map((e) => (e.id === id ? event : e)) : [event, ...current];
        });
        if (payload.eventType === "INSERT") {
          setFresh((f) => new Set(f).add(id));
          void acknowledgeAlerts([id]);
        }
      });
    supabase.auth.getSession().then(({ data }) => {
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel.subscribe();
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  useEffect(() => {
    if (highlightId) document.getElementById(`alerta-${highlightId}`)?.scrollIntoView({ block: "center" });
  }, [highlightId]);

  const visible = useMemo(
    () =>
      events.filter((e) =>
        filter === "all" ? true : filter === "pending" ? e.feedback === null && e.kind !== "daily_digest" : e.feedback === filter,
      ),
    [events, filter],
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Filtrar alertas" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<BellOff />}
          title={filter === "all" ? "Sin alertas en los últimos 30 días" : "Nada en este filtro"}
          description="Las reglas se revisan después de cada clasificación (cada 5 minutos)."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {visible.map((event) => (
              <motion.li
                key={event.id}
                layout
                initial={fresh.has(event.id) ? { opacity: 0, y: -12 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <AlertCard
                  event={event}
                  canRate={canRate}
                  highlighted={event.id === highlightId || fresh.has(event.id)}
                  onRated={(feedback) => setEvents((list) => list.map((e) => (e.id === event.id ? { ...e, feedback } : e)))}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </div>
  );
}

function AlertCard({
  event,
  canRate,
  highlighted,
  onRated,
}: {
  event: AlertEvent;
  canRate: boolean;
  highlighted: boolean;
  onRated: (feedback: AlertEvent["feedback"]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const Icon = event.kind ? KIND_ICON[event.kind] : ShieldAlert;
  const deliveries = Object.entries(event.notifications).filter(([channel]) => channel in CHANNEL_LABELS);

  function rate(value: "useful" | "false_alarm") {
    const next = event.feedback === value ? null : value;
    startTransition(async () => {
      const result = await rateAlert({ eventId: event.id, feedback: next });
      if (!result.ok) return void toast.error(result.message);
      onRated(next);
      toast.success(result.message);
    });
  }

  return (
    <article
      id={`alerta-${event.id}`}
      className={cn(
        "flex gap-3 rounded-xl border bg-card p-4 transition-shadow",
        highlighted && "ring-2 ring-primary/40",
        event.feedback === "false_alarm" && "opacity-70",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          event.severity === "critical" || event.severity === "high" ? "bg-negative/15 text-negative" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("rounded-full px-2 py-0.5 font-medium", SEVERITY_TONE[event.severity])}>
            {SEVERITY_LABELS[event.severity]}
          </span>
          <span>{event.ruleName}</span>
          <span aria-hidden>·</span>
          <time dateTime={event.createdAt}>{time.format(new Date(event.createdAt))}</time>
        </div>
        <h3 className="font-medium leading-snug">{event.title}</h3>
        {event.summary && <p className="text-sm text-muted-foreground">{event.summary}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Link href={alertHref(event)} className={buttonVariants({ size: "xs", variant: "outline" })}>
            {event.kind === "daily_digest" ? "Ver dashboard" : "Ver menciones"} <ArrowUpRight aria-hidden />
          </Link>
          {canRate && event.kind !== "daily_digest" && (
            <>
              <Button
                size="xs"
                variant={event.feedback === "useful" ? "default" : "ghost"}
                aria-pressed={event.feedback === "useful"}
                disabled={pending}
                onClick={() => rate("useful")}
              >
                <ThumbsUp aria-hidden /> Útil
              </Button>
              <Button
                size="xs"
                variant={event.feedback === "false_alarm" ? "secondary" : "ghost"}
                aria-pressed={event.feedback === "false_alarm"}
                disabled={pending}
                onClick={() => rate("false_alarm")}
              >
                <ThumbsDown aria-hidden /> Falsa alarma
              </Button>
            </>
          )}
          {!canRate && event.feedback && (
            <span className="text-xs text-muted-foreground">{event.feedback === "useful" ? "Marcada como útil" : "Falsa alarma"}</span>
          )}
          {deliveries.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {deliveries.map(([channel, r]) => `${CHANNEL_LABELS[channel]} ${STATUS_LABELS[r.status] ?? r.status}`).join(" · ")}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
