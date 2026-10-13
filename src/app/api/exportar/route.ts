import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canExport, EXPORT_KINDS, exportRange, isExportKind, mxDayEnd, mxDayStart, toCsv } from "@/lib/retention/model";
import { createClient } from "@/lib/supabase/server";

const MAX_ROWS = 50_000;

/**
 * Authorized CSV exports for reconciliation: casos, consumo-ia, bitacora.
 * Read with the member's session (RLS), never more than one year, and each
 * download is recorded in audit_log (who, what, period, rows).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  const member = session?.member;
  if (!member) return NextResponse.json({ error: "Inicia sesión." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const kind = params.get("tipo") ?? "";
  if (!isExportKind(kind)) return NextResponse.json({ error: "Exportación desconocida." }, { status: 400 });
  if (!canExport(kind, member.role)) return NextResponse.json({ error: "No tienes permiso para esta exportación." }, { status: 403 });
  const range = exportRange(params.get("desde"), params.get("hasta"));
  if ("error" in range) return NextResponse.json({ error: range.error }, { status: 400 });
  const from = mxDayStart(range.from);
  const to = mxDayEnd(range.to);

  const supabase = await createClient();
  let csv: string;
  let rows: number;
  if (kind === "casos") {
    const [cases, departments] = await Promise.all([
      supabase
        .from("cases")
        .select("folio, title, category, priority, status, department_id, opened_at, assigned_at, accepted_at, accept_due_at, due_at, resolved_at, closed_at, cycle, sla_terms")
        .eq("org_id", member.orgId)
        .gte("opened_at", from)
        .lt("opened_at", to)
        .order("opened_at")
        .limit(MAX_ROWS),
      supabase.from("departments").select("id, name").eq("org_id", member.orgId),
    ]);
    if (cases.error) return NextResponse.json({ error: "No se pudo leer los casos." }, { status: 500 });
    const names = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
    const data = (cases.data ?? []).map((c) => ({
      ...c,
      department: c.department_id ? (names.get(c.department_id) ?? "") : "",
      sla_version: (c.sla_terms as { version?: number } | null)?.version ?? "",
      overdue: c.due_at && !c.closed_at && Date.parse(c.due_at) < Date.now() ? "sí" : "no",
    }));
    rows = data.length;
    csv = toCsv(
      [
        { key: "folio", label: "Folio" },
        { key: "title", label: "Título" },
        { key: "category", label: "Categoría" },
        { key: "priority", label: "Prioridad" },
        { key: "status", label: "Estado" },
        { key: "department", label: "Dependencia" },
        { key: "opened_at", label: "Abierto" },
        { key: "assigned_at", label: "Asignado" },
        { key: "accepted_at", label: "Aceptado" },
        { key: "accept_due_at", label: "Plazo de aceptación" },
        { key: "due_at", label: "Compromiso de atención" },
        { key: "resolved_at", label: "Resuelto" },
        { key: "closed_at", label: "Cerrado" },
        { key: "cycle", label: "Ciclo" },
        { key: "sla_version", label: "Versión SLA" },
        { key: "overdue", label: "Vencido al exportar" },
      ],
      data,
    );
  } else if (kind === "consumo-ia") {
    const { data, error } = await supabase
      .from("ai_calls")
      .select("created_at, purpose, model, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_status, tariff_version, reserved_usd")
      .eq("org_id", member.orgId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at")
      .limit(MAX_ROWS);
    if (error) return NextResponse.json({ error: "No se pudo leer el consumo." }, { status: 500 });
    rows = data.length;
    csv = toCsv(
      [
        { key: "created_at", label: "Fecha" },
        { key: "purpose", label: "Uso" },
        { key: "model", label: "Modelo" },
        { key: "status", label: "Estado" },
        { key: "input_tokens", label: "Tokens de entrada" },
        { key: "output_tokens", label: "Tokens de salida" },
        { key: "cache_read_tokens", label: "Tokens leídos de caché" },
        { key: "cache_write_tokens", label: "Tokens escritos en caché" },
        // Empty with cost_status "unknown": never exported as 0.
        { key: "cost_usd", label: "Costo estimado (US$)" },
        { key: "cost_status", label: "Estado del costo" },
        { key: "tariff_version", label: "Tarifa" },
        { key: "reserved_usd", label: "Reservado (US$)" },
      ],
      data,
    );
  } else {
    const { data, error } = await supabase
      .from("audit_log")
      .select("created_at, action, entity, entity_id, actor_id, changes")
      .eq("org_id", member.orgId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at")
      .limit(MAX_ROWS);
    if (error) return NextResponse.json({ error: "No se pudo leer la bitácora." }, { status: 500 });
    rows = data.length;
    csv = toCsv(
      [
        { key: "created_at", label: "Fecha" },
        { key: "action", label: "Acción" },
        { key: "entity", label: "Elemento" },
        { key: "entity_id", label: "Registro" },
        { key: "actor_id", label: "Persona (id)" },
        { key: "changes", label: "Cambios (antes/después)" },
      ],
      data,
    );
  }

  const { error: logError } = await supabase.rpc("log_export", {
    p_org_id: member.orgId,
    p_kind: EXPORT_KINDS[kind].entity,
    p_filters: { tipo: kind, desde: range.from, hasta: range.to },
    p_rows: rows,
  });
  // An export that cannot be logged is not delivered.
  if (logError) return NextResponse.json({ error: "No se pudo registrar la exportación." }, { status: 500 });

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${range.from}-a-${range.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
