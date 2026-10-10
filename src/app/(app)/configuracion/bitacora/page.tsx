import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bitácora" };

const when = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });

const ACTIONS: Record<string, string> = {
  insert: "Creó",
  update: "Modificó",
  delete: "Eliminó",
  export: "Exportó",
  send: "Envió",
  purge: "Depuró",
};
const ENTITIES: Record<string, string> = {
  memberships: "usuario",
  departments: "dependencia",
  neighborhoods: "colonia",
  risk_terms: "término de riesgo",
  projects: "proyecto",
  queries: "consulta",
  sources: "fuente",
  alert_rules: "regla de alerta",
  reports: "reporte",
  report_schedules: "programación de reporte",
  organizations: "municipio",
  tickets: "turno",
  classifications: "clasificación",
  mentions: "mención",
};

function summary(changes: Record<string, unknown>): string {
  const entries = Object.entries(changes).slice(0, 4);
  return entries
    .map(([k, v]) => (Array.isArray(v) && v.length === 2 ? `${k}: ${fmt(v[0])} → ${fmt(v[1])}` : `${k}: ${fmt(v)}`))
    .join(" · ");
}
const fmt = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 40 ? `${s.slice(0, 39)}…` : (s ?? "—");
};

export default async function AuditPage() {
  const member = await requireSection("/configuracion/bitacora");
  const supabase = await createClient();
  const [{ data: log }, { data: errors }, { data: members }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, actor_id, action, entity, entity_id, changes, created_at")
      .eq("org_id", member.orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("app_errors").select("id, source, message, path, digest, created_at").eq("org_id", member.orgId).order("created_at", { ascending: false }).limit(50),
    supabase.rpc("org_members", { p_org_id: member.orgId }),
  ]);
  const names = new Map((members ?? []).map((m) => [m.user_id, m.email]));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Bitácora de auditoría</CardTitle>
          <CardDescription>
            Quién creó, modificó, eliminó, exportó o envió qué. Los cambios hechos por el sistema (cron, ingesta) aparecen como «Sistema».
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!log?.length ? (
            <EmptyState icon={<ScrollText />} title="Sin movimientos todavía" description="Aquí aparecerán los cambios de configuración y las exportaciones." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Quién</TableHead>
                  <TableHead>Acción</TableHead>
                  <TableHead>Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when.format(new Date(e.created_at))}</TableCell>
                    <TableCell className="text-sm">{e.actor_id ? (names.get(e.actor_id) ?? "Usuario eliminado") : "Sistema"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {ACTIONS[e.action] ?? e.action} {ENTITIES[e.entity] ?? e.entity}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={JSON.stringify(e.changes)}>
                      {summary(e.changes as Record<string, unknown>)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Errores recientes</CardTitle>
          <CardDescription>Errores del servidor y del navegador registrados por el monitoreo (sin datos sensibles).</CardDescription>
        </CardHeader>
        <CardContent>
          {!errors?.length ? (
            <p className="text-sm text-muted-foreground">Sin errores registrados.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {errors.map((e) => (
                <li key={e.id} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {when.format(new Date(e.created_at))} · {e.source} · {e.path}
                    {e.digest ? ` · ${e.digest}` : ""}
                  </p>
                  <p className="break-words">{e.message}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
