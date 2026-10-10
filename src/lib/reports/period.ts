// Report periods in Mexico City days. Pure: shared by actions, the cron and tests.
import { dayEnd, dayStart } from "../inbox/model.ts";
import { toMxDay } from "../dashboard/period.ts";

export const REPORT_KINDS = ["daily", "weekly", "monthly"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  daily: "Diario",
  weekly: "Semanal",
  monthly: "Mensual",
};

export type ReportPeriod = {
  kind: ReportKind;
  /** First and last Mexico City day covered (YYYY-MM-DD, inclusive). */
  startDay: string;
  endDay: string;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  prevStartDay: string;
  prevEndDay: string;
  bucket: "hour" | "day";
  /** "Semana del 3 al 9 de octubre de 2026" */
  label: string;
  prevLabel: string;
};

const DAY = 86_400_000;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const longDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

export function rangeLabel(kind: ReportKind, startDay: string, endDay: string): string {
  if (kind === "daily") return longDate.format(noon(startDay));
  if (kind === "monthly" && startDay.endsWith("-01")) {
    const full = addDays(addDays(startDay, 32).slice(0, 8) + "01", -1);
    const month = monthYear.format(noon(startDay));
    return endDay === full ? month : `${month} (al ${dayMonth.format(noon(endDay))})`;
  }
  const sameYear = startDay.slice(0, 4) === endDay.slice(0, 4);
  const start = sameYear ? dayMonth.format(noon(startDay)) : longDate.format(noon(startDay));
  return `Del ${start} al ${longDate.format(noon(endDay))}`;
}

/**
 * Period of a report that ends on `endDay` (default: yesterday in Mexico City).
 * daily = that day; weekly = the 7 days ending that day; monthly = its calendar
 * month up to that day. The previous period has the same length.
 */
export function reportPeriod(kind: ReportKind, endDay?: string, now = new Date()): ReportPeriod {
  const end = endDay ?? toMxDay(new Date(now.getTime() - DAY));
  const start = kind === "daily" ? end : kind === "weekly" ? addDays(end, -6) : `${end.slice(0, 8)}01`;
  const from = new Date(dayStart(start));
  const to = new Date(dayEnd(end));
  const days = Math.round((to.getTime() - from.getTime()) / DAY);

  let prevStartDay: string;
  let prevEndDay: string;
  if (kind === "monthly") {
    // Same span of the previous month (1–9 Oct vs 1–9 Sep), clipped to its length.
    prevEndDay = addDays(start, -1);
    prevStartDay = `${prevEndDay.slice(0, 8)}01`;
    const sameDay = `${prevEndDay.slice(0, 8)}${end.slice(8)}`;
    if (sameDay < prevEndDay) prevEndDay = sameDay;
  } else {
    prevEndDay = addDays(start, -1);
    prevStartDay = addDays(start, -days);
  }

  return {
    kind,
    startDay: start,
    endDay: end,
    from,
    to,
    prevFrom: new Date(dayStart(prevStartDay)),
    prevTo: new Date(dayEnd(prevEndDay)),
    prevStartDay,
    prevEndDay,
    bucket: kind === "daily" ? "hour" : "day",
    label: rangeLabel(kind, start, end),
    prevLabel: rangeLabel(kind, prevStartDay, prevEndDay),
  };
}

/** Is a scheduled report of this kind due on `today` (Mexico City)? Weekly on Mondays, monthly on the 1st. */
export function scheduleDue(kind: ReportKind, today: string): boolean {
  if (kind === "daily") return true;
  if (kind === "weekly") return noon(today).getUTCDay() === 1;
  return today.endsWith("-01");
}

/** For a schedule running on `today`: the period just closed (yesterday, last week, last month). */
export function scheduledPeriod(kind: ReportKind, today: string): ReportPeriod {
  return reportPeriod(kind, addDays(today, -1));
}
