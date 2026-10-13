// Authorized exports for reconciliation (pure): which kinds exist, who may
// download each one and how rows become CSV. No citizen identities: cases,
// AI calls and the audit log carry no publication authors.

import type { Role } from "../auth/roles.ts";

export const EXPORT_KINDS = {
  casos: { label: "Casos y compromisos", roles: ["admin", "comunicacion"] as Role[], entity: "cases" },
  "consumo-ia": { label: "Llamadas a la IA (consumo)", roles: ["admin"] as Role[], entity: "ai_calls" },
  bitacora: { label: "Bitácora de cambios", roles: ["admin"] as Role[], entity: "audit_log" },
} as const;
export type ExportKind = keyof typeof EXPORT_KINDS;

export const isExportKind = (v: string): v is ExportKind => Object.hasOwn(EXPORT_KINDS, v);
export const canExport = (kind: ExportKind, role: Role) => EXPORT_KINDS[kind].roles.includes(role);

/** Max days per export: keeps each file reviewable and the query bounded. */
export const MAX_EXPORT_DAYS = 366;

export function exportRange(from: string | null, to: string | null): { from: string; to: string } | { error: string } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !day.test(from) || !day.test(to)) return { error: "Indica las fechas desde y hasta (AAAA-MM-DD)." };
  if (from > to) return { error: "La fecha inicial es posterior a la final." };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_EXPORT_DAYS) return { error: `El periodo máximo es de ${MAX_EXPORT_DAYS} días.` };
  return { from, to };
}

/** Start/end instants of whole Mexico City days (UTC−6, no DST). */
export const mxDayStart = (day: string) => new Date(`${day}T06:00:00Z`).toISOString();
export const mxDayEnd = (day: string) => new Date(Date.parse(`${day}T06:00:00Z`) + 86_400_000).toISOString();

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Spreadsheet formula injection: a leading = + - @ is neutralized.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(columns: readonly { key: string; label: string }[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(","))];
  // BOM so spreadsheet apps read the accents as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}
