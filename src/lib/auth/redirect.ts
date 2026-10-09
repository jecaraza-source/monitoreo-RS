// Sanitizes the post-login destination taken from ?next= so it can only point
// inside this app (no open redirects to other hosts).
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
