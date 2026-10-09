"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Maximize2, Megaphone, Newspaper, Radio, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AnimatedNumber } from "@/components/ui-kit";
import { addCrisisEntry } from "@/lib/alerts/actions";
import type { AlertEvent } from "@/lib/alerts/data-shared";
import { alertHref, SEVERITY_LABELS } from "@/lib/alerts/rules";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { MinutePoint } from "./minute-chart";

const MinuteChart = dynamic(() => import("./minute-chart").then((m) => m.MinuteChart), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

type Snapshot = {
  per_minute: MinutePoint[];
  totals: { mentions: number; positive: number; neutral: number; negative: number; interactions: number };
  spreaders: { id: string; name: string; kind: string; mentions: number; interactions: number; negative: number }[];
  citizens: { accounts: number; mentions: number; negative: number };
};

export type LogEntry = { id: string; author_name: string; body: string; created_at: string };

const WINDOWS = [30, 60, 180] as const;
const POLL_MS = 15_000;
const clock = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
const nf = new Intl.NumberFormat("es-MX");
const INTEGER: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const SCORE: Intl.NumberFormatOptions = { maximumFractionDigits: 0, signDisplay: "exceptZero" };

export function CrisisRoom({
  orgId,
  canWrite,
  initialLog,
  alerts,
}: {
  orgId: string;
  canWrite: boolean;
  initialLog: LogEntry[];
  alerts: AlertEvent[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const frame = useRef<HTMLDivElement>(null);
  const [minutes, setMinutes] = useState<(typeof WINDOWS)[number]>(60);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [log, setLog] = useState(initialLog);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("crisis_snapshot", { p_org_id: orgId, p_minutes: minutes });
    if (error) return;
    setSnapshot(data as unknown as Snapshot);
    setUpdatedAt(new Date());
  }, [supabase, orgId, minutes]);

  // Poll, and refresh right away when a mention or classification arrives.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void loadRef.current(), 1500);
    };
    const filter = `org_id=eq.${orgId}`;
    const channel = supabase
      .channel(`crisis:${orgId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mentions", filter }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "classifications", filter }, bump)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crisis_log", filter }, (payload) => {
        const entry = payload.new as LogEntry;
        setLog((current) => (current.some((e) => e.id === entry.id) ? current : [entry, ...current]));
      });
    supabase.auth.getSession().then(({ data }) => {
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [supabase, orgId]);

  const t = snapshot?.totals;
  const classified = t ? t.positive + t.neutral + t.negative : 0;
  const nss = t && classified ? ((t.positive - t.negative) / classified) * 100 : 0;
  const lastMinutes = snapshot?.per_minute.slice(-5) ?? [];
  const perMinuteNow = lastMinutes.reduce((s, p) => s + p.positive + p.neutral + p.negative + p.pending, 0) / Math.max(lastMinutes.length, 1);

  return (
    <div ref={frame} className="flex flex-col gap-4 bg-background fullscreen:overflow-y-auto fullscreen:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/alertas" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" aria-hidden /> Alertas
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Sala de crisis</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className={cn("size-3.5", live ? "text-positive" : "")} aria-hidden />
            {live ? "En vivo" : "Conectando…"}
            {updatedAt && ` · actualizado ${clock.format(updatedAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Ventana" className="flex rounded-lg border bg-card p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                role="radio"
                aria-checked={minutes === w}
                onClick={() => setMinutes(w)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm",
                  minutes === w ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {w < 60 ? `${w} min` : `${w / 60} h`}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void frame.current?.requestFullscreen?.()}>
            <Maximize2 aria-hidden /> Pantalla completa
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Menciones (${minutes < 60 ? `${minutes} min` : `${minutes / 60} h`})`} value={t?.mentions ?? 0} format={INTEGER} />
        <Stat label="Por minuto (últimos 5)" value={perMinuteNow} format={{ maximumFractionDigits: 1 }} />
        <Stat label="NSS en vivo" value={nss} format={SCORE} tone={nss <= -20 ? "negative" : nss >= 20 ? "positive" : undefined} />
        <Stat label="Negativas" value={t?.negative ?? 0} format={INTEGER} tone={(t?.negative ?? 0) > 0 ? "negative" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader>
            <CardTitle as="h2">Volumen por minuto</CardTitle>
            <CardDescription>Menciones publicadas cada minuto, por sentimiento.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">{snapshot ? <MinuteChart data={snapshot.per_minute} /> : <Skeleton className="size-full" />}</div>
            <SentimentBar positive={t?.positive ?? 0} neutral={t?.neutral ?? 0} negative={t?.negative ?? 0} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle as="h2">Principales difusores</CardTitle>
            <CardDescription>Medios y figuras públicas. Los ciudadanos sólo se cuentan, no se perfilan.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {snapshot?.spreaders.length ? (
              <ol className="flex flex-col divide-y">
                {snapshot.spreaders.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-2 text-sm">
                    {s.kind === "media" ? (
                      <Newspaper className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <Megaphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.mentions} · {nf.format(s.interactions)} int.
                    </span>
                    {s.negative > 0 && <span className="rounded-full bg-negative/15 px-1.5 text-xs">{s.negative} neg.</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Ningún medio en esta ventana.</p>
            )}
            {snapshot && (
              <p className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <Users className="size-4 shrink-0" aria-hidden />
                Ciudadanos y sin autor identificado: {nf.format(snapshot.citizens.mentions)} menciones (
                {nf.format(snapshot.citizens.negative)} negativas)
                {snapshot.citizens.accounts > 0 && ` de ${nf.format(snapshot.citizens.accounts)} cuentas`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle as="h2">Alertas de las últimas 24 h</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin alertas.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {alerts.map((a) => (
                  <li key={a.id} className="flex flex-col gap-0.5 py-2">
                    <span className="text-xs text-muted-foreground">
                      {clock.format(new Date(a.createdAt))} · {SEVERITY_LABELS[a.severity]}
                    </span>
                    <Link href={alertHref(a)} className="text-sm font-medium hover:underline">
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <CrisisLog log={log} canWrite={canWrite} onAdded={(entry) => setLog((l) => [entry, ...l.filter((e) => e.id !== entry.id)])} />
      </div>
    </div>
  );
}

function Stat({ label, value, format, tone }: { label: string; value: number; format: Intl.NumberFormatOptions; tone?: "positive" | "negative" }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <AnimatedNumber
        value={value}
        formatOptions={format}
        className={cn("text-3xl font-semibold", tone === "negative" && "text-negative", tone === "positive" && "text-positive")}
      />
    </div>
  );
}

function SentimentBar({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total = positive + neutral + negative;
  const parts = [
    { key: "positive", label: "Positivo", value: positive, className: "bg-positive" },
    { key: "neutral", label: "Neutral", value: neutral, className: "bg-neutral" },
    { key: "negative", label: "Negativo", value: negative, className: "bg-negative" },
  ];
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Sentimiento: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {total > 0 &&
          parts.map((p) => p.value > 0 && <div key={p.key} className={cn("h-full transition-all duration-700", p.className)} style={{ width: `${(p.value / total) * 100}%` }} />)}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", p.className)} aria-hidden /> {p.label} {total ? Math.round((p.value / total) * 100) : 0} %
          </span>
        ))}
      </div>
    </div>
  );
}

function CrisisLog({ log, canWrite, onAdded }: { log: LogEntry[]; canWrite: boolean; onAdded: (entry: LogEntry) => void }) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <Card className="lg:col-span-7">
      <CardHeader>
        <CardTitle as="h2">Bitácora de acciones</CardTitle>
        <CardDescription>Qué se decidió y quién lo hizo, en orden.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canWrite && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = body.trim();
              if (!text) return;
              startTransition(async () => {
                const r = await addCrisisEntry({ body: text });
                if (!r.ok) return void toast.error(r.message);
                setBody("");
                if (r.entry) onAdded(r.entry);
              });
            }}
          >
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Ej. Se pidió a Agua Potable enviar pipas a San Miguel; comunicado a las 14:00."
              aria-label="Nueva acción"
              className="min-h-0"
            />
            <Button type="submit" disabled={pending || !body.trim()} className="self-end" aria-label="Registrar acción">
              <Send aria-hidden />
            </Button>
          </form>
        )}
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay acciones registradas.</p>
        ) : (
          <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {log.map((e) => (
              <li key={e.id} className="rounded-lg bg-muted/60 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {clock.format(new Date(e.created_at))} · {e.author_name || "Usuario"}
                </p>
                <p className="text-sm whitespace-pre-wrap">{e.body}</p>
              </li>
            ))}
          </ol>
        )}
        <Link href="/bandeja" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}>
          Ir a la bandeja
        </Link>
      </CardContent>
    </Card>
  );
}
