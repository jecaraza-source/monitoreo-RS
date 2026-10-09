import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "invite", "signup", "recovery", "email_change"];

/**
 * Landing URL of magic-link and invitation emails. Supports both link styles:
 *  - token_hash + type: email templates in supabase/templates (works across devices)
 *  - code: Supabase's default PKCE redirect (same browser that asked for the link)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (ok) {
    const [pathname, query] = next.split("?");
    target.pathname = pathname;
    if (query) target.search = `?${query}`;
  } else {
    target.pathname = "/login";
    target.searchParams.set("error", "link");
  }
  return NextResponse.redirect(target);
}
