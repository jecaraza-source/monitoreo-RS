import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Fails closed if unset. */
export function isAuthorizedCron(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Crons run only in production: Vercel schedules them only for production
 * deployments, and this guard keeps a manual call to a preview from touching
 * its (separate) database with background work.
 */
export function cronDisabledHere(): boolean {
  return Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== "production";
}
