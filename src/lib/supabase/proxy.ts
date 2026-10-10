import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, hitRateLimit, policyFor } from "@/lib/rate-limit";

// Reachable without a session. Everything else requires one.
// /api/cron/* authorizes itself with CRON_SECRET and must answer JSON, not redirect.
// /api/demo/* serves fictitious public RSS feeds for demos; /api/errors takes client error reports.
const PUBLIC_PATHS = ["/login", "/auth/", "/dev/", "/api/cron/", "/api/demo/", "/api/errors"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Refreshes the Supabase session cookies and does the optimistic auth check:
 * no session → /login. Role checks need the membership, so they happen in each
 * page (requireSection) and, for data, in RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Without Supabase configured (e.g. a fresh preview) there is no session to refresh.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it validates the
  // JWT and triggers the refresh that writes new cookies through setAll.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  // Rate limit every /api/* route (per user when signed in, else per IP).
  const policy = policyFor(pathname);
  if (policy) {
    const subject = policy.by === "user" && data?.claims?.sub ? `u:${data.claims.sub}` : `ip:${clientIp(request.headers)}`;
    const limit = await hitRateLimit(policy, subject);
    if (!limit.allowed) {
      const retry = limit.resetAt ? Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)) : 60;
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo." },
        { status: 429, headers: { "retry-after": String(retry), "x-ratelimit-limit": String(policy.limit), "x-ratelimit-remaining": "0" } },
      );
    }
    response.headers.set("x-ratelimit-limit", String(policy.limit));
    response.headers.set("x-ratelimit-remaining", String(limit.remaining));
  }

  if (!signedIn && !isPublic(pathname)) {
    return redirectKeepingCookies(request, response, "/login", pathname === "/" ? null : pathname + search);
  }
  if (signedIn && pathname === "/login") {
    return redirectKeepingCookies(request, response, "/", null);
  }

  return response;
}

// A redirect must carry any refreshed auth cookies, or the browser keeps the stale ones.
function redirectKeepingCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  next: string | null,
) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = next ? `?next=${encodeURIComponent(next)}` : "";
  const redirect = NextResponse.redirect(target);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
