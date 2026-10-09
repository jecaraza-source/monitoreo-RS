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
    // Rolling windows end at the next full hour so the rollup's last bucket is included.
    to = new Date(Math.ceil(now.getTime() / HOUR) * HOUR);
    const span = key === "24h" ? DAY : key === "30d" ? 30 * DAY : 7 * DAY;
    from = new Date(to.getTime() - span);
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
