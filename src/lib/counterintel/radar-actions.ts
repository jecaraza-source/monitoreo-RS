"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSection } from "@/lib/auth/session";
import { hitRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { parseIndicators } from "./model";
import {
  checkIndicator,
  indicatorTarget,
  providerEnv,
  searchCertificates,
  searchFactChecks,
  searchNews,
  type CheckResult,
} from "./providers";

export type RadarResult = { ok: boolean; message: string };

const PATH = "/radar-social";
const FORBIDDEN: RadarResult = { ok: false, message: "No tienes permiso para usar las herramientas de Radar Social." };
// Every check calls outside services: a few per minute per person is plenty.
const LIMIT = { name: "radar-checks", limit: 10, windowSeconds: 60, by: "user" as const };
const MAX_INDICATORS = 10;

async function editor() {
  const member = await requireSection(PATH);
  return member.role === "admin" || member.role === "comunicacion" ? member : null;
}

async function allowed(userId: string): Promise<boolean> {
  return (await hitRateLimit(LIMIT, userId)).allowed;
}

const BUSY: RadarResult = { ok: false, message: "Demasiadas consultas seguidas; espera un minuto." };

async function record(orgId: string, userId: string, results: CheckResult[], reportId: string | null): Promise<RadarResult | null> {
  if (results.length === 0) return null;
  const supabase = await createClient();
  const { error } = await supabase.from("ci_checks").insert(
    results.map((r) => ({
      org_id: orgId,
      report_id: reportId,
      provider: r.provider,
      subject: r.subject.slice(0, 300),
      status: r.status,
      summary: r.summary.slice(0, 500),
      details: r.details as never,
      checked_by: userId,
    })),
  );
  if (error) {
    if (error.code === "42501") return FORBIDDEN;
    console.error("[radar] guardar consulta:", error.code);
    return { ok: false, message: "No se pudo guardar el resultado." };
  }
  return null;
}

function outcome(results: CheckResult[], none: string): RadarResult {
  if (results.length === 0) return { ok: false, message: none };
  const flagged = results.filter((r) => r.status === "flagged").length;
  const found = results.filter((r) => r.status === "found").length;
  const failed = results.filter((r) => r.status === "error").length;
  const parts = [
    flagged ? `${flagged} alerta${flagged === 1 ? "" : "s"}` : null,
    found ? `${found} con resultados` : null,
    failed ? `${failed} servicio${failed === 1 ? "" : "s"} sin respuesta` : null,
  ].filter(Boolean);
  return { ok: true, message: parts.length ? `Consulta lista: ${parts.join(", ")}.` : "Consulta lista: sin alertas." };
}

// ---------------------------------------------------------------------------
// Settings: official domains and watch terms
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  officialDomains: z.array(z.string().max(253)).max(20, "Hasta 20 dominios oficiales."),
  watchTerms: z.array(z.string().max(40)).max(20, "Hasta 20 términos."),
});

export async function saveRadarSettings(input: { officialDomains: string; watchTerms: string }): Promise<RadarResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const parsed = settingsSchema.safeParse({
    officialDomains: parseIndicators(String(input?.officialDomains ?? "")).map((d) => d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")),
    watchTerms: parseIndicators(String(input?.watchTerms ?? "")),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ci_settings")
    .upsert({ org_id: member.orgId, official_domains: parsed.data.officialDomains, watch_terms: parsed.data.watchTerms }, { onConflict: "org_id" });
  if (error) {
    if (error.code === "22023") return { ok: false, message: error.message };
    if (error.code === "42501") return FORBIDDEN;
    console.error("[radar] ajustes:", error.code);
    return { ok: false, message: "No se pudieron guardar los ajustes." };
  }
  revalidatePath(PATH);
  return { ok: true, message: "Ajustes del radar guardados." };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Domain and URL reputation of a report's indicators (handles and hashtags are not checkable). */
export async function checkReportIndicators(reportId: unknown): Promise<RadarResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const id = z.guid("Reporte inválido.").safeParse(reportId);
  if (!id.success) return { ok: false, message: id.error.issues[0].message };
  const supabase = await createClient();
  const { data: report } = await supabase.from("ci_reports").select("id, indicators").eq("id", id.data).eq("org_id", member.orgId).maybeSingle();
  if (!report) return FORBIDDEN;
  const checkable = report.indicators.filter((i) => indicatorTarget(i)).slice(0, MAX_INDICATORS);
  if (checkable.length === 0) return { ok: false, message: "El reporte no tiene dominios ni URLs que revisar." };
  if (!(await allowed(member.userId))) return BUSY;
  const env = providerEnv();
  const results = (await Promise.all(checkable.map((i) => checkIndicator(i, env)))).flat();
  const failure = await record(member.orgId, member.userId, results, report.id);
  if (failure) return failure;
  revalidatePath(PATH);
  return outcome(results, "No hay nada que revisar.");
}

/** Certificates issued for domains with a watch term, outside the official ones. */
export async function findLookalikeDomains(): Promise<RadarResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("ci_settings").select("official_domains, watch_terms").eq("org_id", member.orgId).maybeSingle();
  const terms = settings?.watch_terms ?? [];
  if (terms.length === 0) return { ok: false, message: "Primero agrega en los ajustes un término a vigilar (por ejemplo, el nombre del municipio)." };
  if (!(await allowed(member.userId))) return BUSY;
  const env = providerEnv();
  const results = await Promise.all(terms.slice(0, 5).map((t) => searchCertificates(t, settings?.official_domains ?? [], env)));
  const failure = await record(member.orgId, member.userId, results, null);
  if (failure) return failure;
  revalidatePath(PATH);
  return outcome(results, "No hay términos que buscar.");
}

const searchSchema = z.object({
  provider: z.enum(["factcheck", "gdelt"], "Elige dónde buscar."),
  query: z.string().trim().min(3, "Escribe al menos 3 caracteres.").max(200, "La búsqueda es muy larga."),
});

/** Published fact checks or news coverage of a claim or topic. */
export async function searchRadar(input: unknown): Promise<RadarResult> {
  const member = await editor();
  if (!member) return FORBIDDEN;
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  if (!(await allowed(member.userId))) return BUSY;
  const env = providerEnv();
  const { provider, query } = parsed.data;
  const result = provider === "factcheck" ? await searchFactChecks(query, env) : await searchNews(query, env);
  const failure = await record(member.orgId, member.userId, [result], null);
  if (failure) return failure;
  revalidatePath(PATH);
  if (result.status === "skipped" || result.status === "error") return { ok: false, message: result.summary };
  return { ok: true, message: result.summary };
}
