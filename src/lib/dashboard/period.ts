// Dashboard period from the URL (?periodo=24h|7d|30d|custom&desde&hasta) and
// the equally long period right before it. Pure; dates are Mexico City days.
import { dayEnd, dayStart } from "../inbox/model.ts";

export const PERIOD_KEYS = ["24h", "7d", "30d", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "24h": "24 h",
  "7d": "7 días",
  "30d": "30 días",
  custom: "Personalizado",
};

export const MAX_CUSTOM_DAYS = 92;

export type Period = {
  key: PeriodKey;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** Hourly points up to two days, daily beyond. */
  bucket: "hour" | "day";
  /** Calendar days (Mexico City) covered, for inbox links. */
  fromDay: string;
  toDay: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const mxDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });

/** YYYY-MM-DD of an instant in Mexico City. */
export function toMxDay(date: Date): string {
  return mxDay.format(date);
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parsePeriod(params: Record<string, string | string[] | undefined>, now = new Date()): Period {
  const raw = first(params.periodo);
  const key: PeriodKey = PERIOD_KEYS.includes(raw as PeriodKey) ? (raw as PeriodKey) : "7d";
  let from: Date;
  let to: Date;

  const desde = first(params.desde);
  const hasta = first(params.hasta);
  if (key === "custom" && isDay(desde) && isDay(hasta) && desde <= hasta) {
    from = new Date(dayStart(desde));
    to = new Date(dayEnd(hasta));
    if (to.getTime() - from.getTime() > MAX_CUSTOM_DAYS * DAY) from = new Date(to.getTime() - MAX_CUSTOM_DAYS * DAY);
  } else {
    // Windows end at the next full hour so the rollup's last bucket is included.
    to = new Date(Math.ceil(now.getTime() / HOUR) * HOUR);
    if (key === "24h") from = new Date(to.getTime() - DAY);
    else {
      // 7 and 30 days are whole Mexico City days (today included, up to now),
      // like the inbox; the previous period is the same days right before and
      // kpi_snapshot cuts it at the same point of its length.
      const days = key === "30d" ? 30 : 7;
      const today = toMxDay(now);
      from = new Date(new Date(dayStart(today)).getTime() - (days - 1) * DAY);
      // The previous period must be as long as this one counted in whole days.
      const length = days * DAY;
      return {
        key: key === "30d" ? "30d" : "7d",
        from,
        to,
        prevFrom: new Date(from.getTime() - length),
        prevTo: from,
        bucket: "day",
        fromDay: toMxDay(from),
        toDay: today,
      };
    }
  }

  const length = to.getTime() - from.getTime();
  return {
    key: key === "custom" && !(isDay(desde) && isDay(hasta) && desde <= hasta) ? "7d" : key,
    from,
    to,
    prevFrom: new Date(from.getTime() - length),
    prevTo: from,
    bucket: length <= 2 * DAY ? "hour" : "day",
    fromDay: toMxDay(from),
    toDay: toMxDay(new Date(to.getTime() - 1)),
  };
}

/** Query string for a period, keeping custom dates. */
export function periodSearch(key: PeriodKey, desde?: string, hasta?: string): string {
  const params = new URLSearchParams({ periodo: key });
  if (key === "custom" && desde && hasta) {
    params.set("desde", desde);
    params.set("hasta", hasta);
  }
  return `?${params}`;
}

const shortDay = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });

/** "el periodo anterior (26 sep – 2 oct)": what the arrows compare against. */
export function previousLabel(period: Pick<Period, "prevFrom" | "prevTo">): string {
  const last = new Date(period.prevTo.getTime() - 1);
  const a = shortDay.format(period.prevFrom);
  const b = shortDay.format(last);
  return `el periodo anterior (${a === b ? a : `${a} – ${b}`}, al mismo corte)`;
}
