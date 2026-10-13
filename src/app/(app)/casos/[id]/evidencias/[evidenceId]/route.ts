import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Opens one evidence file of a case. Authorization happens twice in the
// database, as the person: the evidence row must be visible to them (RLS by
// org, area and audience) and Storage must let them read the object (its
// policy re-checks the same row). The answer is a redirect to a URL that
// expires in 60 seconds: there are no permanent links to evidence.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_SECONDS = 60;

export async function GET(_request: NextRequest, { params }: RouteContext<"/casos/[id]/evidencias/[evidenceId]">) {
  const { id, evidenceId } = await params;
  const notFound = () => new NextResponse("No encontrado.", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!uuid.test(id) || !uuid.test(evidenceId)) return notFound();
  const session = await getSession();
  if (!session?.member) return new NextResponse("Inicia sesión.", { status: 401, headers: { "Cache-Control": "no-store" } });

  const supabase = await createClient();
  const { data: evidence } = await supabase
    .from("case_evidence")
    .select("path")
    .eq("id", evidenceId)
    .eq("case_id", id)
    .eq("org_id", session.member.orgId)
    .maybeSingle();
  if (!evidence) return notFound();
  const { data, error } = await supabase.storage.from("case-evidence").createSignedUrl(evidence.path, SIGNED_SECONDS);
  if (error || !data?.signedUrl) return notFound();
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
