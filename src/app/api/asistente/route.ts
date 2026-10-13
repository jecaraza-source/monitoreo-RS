import { z } from "zod";
import { runAssistant, type AssistantEvent } from "@/lib/ai/assistant";
import { meteredAnthropic } from "@/lib/ai/ledger";
import { AiLimitError } from "@/lib/ai/meter";
import { runTool } from "@/lib/ai/tools";
import { canAccessPath } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { toMxDay } from "@/lib/dashboard/period";
import { createClient } from "@/lib/supabase/server";

// Several tool rounds plus the streamed answer.
export const maxDuration = 120;
/** The whole turn stops (SDK stream included) before the platform kills the function. */
const TURN_TIMEOUT_MS = 100_000;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(40),
});

/**
 * Streams the assistant's answer as NDJSON (one AssistantEvent per line).
 * Tools run with the user's own Supabase session, so RLS scopes every query.
 */
export async function POST(request: Request) {
  const session = await getSession();
  const member = session?.member;
  if (!member || !canAccessPath(member.role, "/asistente")) {
    return Response.json({ error: "No tienes acceso al asistente." }, { status: 403 });
  }
  const model = process.env.CLAUDE_MODEL_SMART;
  if (!model || !process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "El asistente no está configurado (falta la API de Claude)." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Mensaje inválido." }, { status: 400 });

  const supabase = await createClient();
  const [departments, neighborhoods, projects] = await Promise.all([
    supabase.from("departments").select("id, name").eq("org_id", member.orgId).order("name"),
    supabase.from("neighborhoods").select("id, name").eq("org_id", member.orgId).order("name"),
    supabase.from("projects").select("topics").eq("org_id", member.orgId),
  ]);
  const today = toMxDay(new Date());
  const ctx = {
    client: supabase,
    orgId: member.orgId,
    today,
    departments: departments.data ?? [],
    neighborhoods: neighborhoods.data ?? [],
  };
  const topics = [...new Set((projects.data ?? []).flatMap((p) => p.topics ?? []))];

  const encoder = new TextEncoder();
  // The user closing the chat (request aborted) or the deadline cancels the provider call in flight.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
  // Each call reserves quota (user, concurrency, budget) and is reconciled as soon as it ends,
  // so a round that fails later never loses what the earlier ones consumed.
  const client = meteredAnthropic({ orgId: member.orgId, userId: member.userId, purpose: "assistant", ttlSeconds: maxDuration + 30 });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => {
        if (!request.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runAssistant({
          client,
          model,
          scope: {
            municipality: member.orgName,
            today,
            role: member.role,
            departmentName: member.departmentName,
            departments: ctx.departments.map((d) => d.name),
            neighborhoods: ctx.neighborhoods.map((n) => n.name),
            topics,
          },
          history: parsed.data.messages,
          runTool: (name, input) => runTool(name, input, ctx),
          emit,
          signal,
        });
      } catch (error) {
        if (error instanceof AiLimitError) {
          emit({ type: "error", message: error.message });
        } else if (signal.aborted) {
          // Closed by the user: nothing to show. A timeout does tell the user.
          if (!request.signal.aborted) emit({ type: "error", message: "La respuesta tardó demasiado y se canceló. Intenta con una pregunta más acotada." });
        } else {
          console.error("[assistant]", error instanceof Error ? error.message : error);
          emit({ type: "error", message: "No se pudo completar la respuesta. Intenta de nuevo." });
        }
        emit({ type: "done" });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
    cancel() {
      // The reader went away: nothing more to stream (the request signal aborts the work).
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
