import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { recordError } from "@/lib/monitoring";

const reportSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  digest: z.string().max(200).optional(),
  path: z.string().max(500).optional(),
});

/** Client-side errors caught by the error boundaries (rate limited in the proxy). */
export async function POST(request: Request) {
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const session = await getSession().catch(() => null);
  await recordError({
    source: "client",
    message: parsed.data.message,
    digest: parsed.data.digest,
    path: parsed.data.path,
    orgId: session?.member?.orgId ?? null,
    userId: session?.userId ?? null,
    context: { userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null },
  });
  return Response.json({ ok: true });
}
