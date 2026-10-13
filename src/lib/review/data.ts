import "server-only";
import type { Member } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { reviewOrder } from "./model";

export type AiOutput = {
  sentiment: string;
  confidence: number | null;
  emotion: string | null;
  topic: string | null;
  intent: string | null;
  priority: string;
  severity: string | null;
  incident_type: string | null;
  needs_attention: boolean | null;
  department_id: string | null;
  neighborhood_id: string | null;
  model: string;
};

export type ReviewItem = {
  id: string;
  mention_id: string;
  reasons: string[];
  created_at: string;
  ai: AiOutput;
  mention: {
    text: string;
    url: string | null;
    published_at: string;
    source_id: string;
    author: string | null;
  } | null;
};

export type DecidedReview = {
  id: string;
  status: string;
  decided_at: string;
  decision_reason: string | null;
  changes: Record<string, [unknown, unknown]>;
  reasons: string[];
  text: string;
};

type RawMention = {
  text: string;
  url: string | null;
  published_at: string;
  source_id: string;
  authors: { display_name: string | null; handle: string; kind: string } | null;
};

/** Pending reviews (RLS: editors and lectura of the org), most serious first, plus recent decisions. */
export async function getReviewQueue(member: Member): Promise<{ pending: ReviewItem[]; total: number; decided: DecidedReview[] }> {
  const supabase = await createClient();
  const [pending, decided] = await Promise.all([
    supabase
      .from("classification_reviews")
      .select("id, mention_id, reasons, created_at, ai_output, mentions(text, url, published_at, source_id, authors(display_name, handle, kind))", {
        count: "exact",
      })
      .eq("org_id", member.orgId)
      .eq("status", "pending")
      .order("created_at")
      .limit(100),
    supabase
      .from("classification_reviews")
      .select("id, status, decided_at, decision_reason, changes, reasons, mentions(text)")
      .eq("org_id", member.orgId)
      .neq("status", "pending")
      .order("decided_at", { ascending: false })
      .limit(20),
  ]);
  if (pending.error) throw new Error(`No se pudo cargar la cola de revisión: ${pending.error.message}`);

  const items = (pending.data ?? []).map((r) => {
    const m = r.mentions as unknown as RawMention | null;
    // Authors only when they are media or public figures (no citizen profiles).
    const author = m?.authors && (m.authors.kind === "media" || m.authors.kind === "public_figure") ? (m.authors.display_name ?? `@${m.authors.handle}`) : null;
    return {
      id: r.id,
      mention_id: r.mention_id,
      reasons: r.reasons,
      created_at: r.created_at,
      ai: r.ai_output as unknown as AiOutput,
      mention: m ? { text: m.text, url: m.url, published_at: m.published_at, source_id: m.source_id, author } : null,
    };
  });
  return {
    pending: items.sort(reviewOrder),
    total: pending.count ?? items.length,
    decided: (decided.data ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      decided_at: r.decided_at ?? "",
      decision_reason: r.decision_reason,
      changes: (r.changes ?? {}) as unknown as Record<string, [unknown, unknown]>,
      reasons: r.reasons,
      text: (r.mentions as unknown as { text: string } | null)?.text ?? "",
    })),
  };
}
