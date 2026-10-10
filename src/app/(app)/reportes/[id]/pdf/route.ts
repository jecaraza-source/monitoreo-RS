import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessPath } from "@/lib/auth/roles";
import { signedPdfUrl } from "@/lib/reports/deliver";
import { getReport } from "@/lib/reports/list";

/** Redirects readers of the report to a short-lived link to its PDF (private bucket). */
export async function GET(request: NextRequest, { params }: RouteContext<"/reportes/[id]/pdf">) {
  const session = await getSession();
  const member = session?.member;
  if (!member || !canAccessPath(member.role, "/reportes")) return NextResponse.redirect(new URL("/login", request.url));
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  // RLS decides whether this member can read the report.
  const report = await getReport(member, id);
  if (!report?.pdfPath) return new NextResponse("El reporte no tiene PDF todavía.", { status: 404 });
  const url = await signedPdfUrl(report.pdfPath);
  if (!url) return new NextResponse("No se pudo preparar la descarga.", { status: 500 });
  return NextResponse.redirect(url);
}
