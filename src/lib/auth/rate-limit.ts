// Turns Supabase Auth rate-limit errors into a message that says how long to
// wait. Pure module so it can be unit-tested.

type AuthErrorLike = { status?: number; code?: string; message?: string } | null | undefined;

/**
 * Spanish message for an Auth 429, or null when the error is not a rate limit.
 *  - "…only request this after 42 seconds": per-address cooldown between links.
 *  - over_email_send_rate_limit: the project's emails-per-hour cap (very low with
 *    Supabase's built-in mailer; raise it with custom SMTP in Auth settings).
 *  - anything else: request rate limit by IP.
 */
export function rateLimitMessage(error: AuthErrorLike): string | null {
  if (!error || (error.status !== 429 && !error.code?.startsWith("over_"))) return null;

  const seconds = error.message?.match(/after (\d+) seconds?/i)?.[1];
  if (seconds) {
    const n = Number(seconds);
    return `Ya se envió un correo a esa dirección hace poco. Espera ${n} ${n === 1 ? "segundo" : "segundos"} antes de intentarlo otra vez.`;
  }
  if (error.code === "over_email_send_rate_limit") {
    return "Se alcanzó el límite de correos por hora del sistema. Revisa si ya llegó un correo o inténtalo de nuevo en una hora.";
  }
  return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
}
