import "server-only";
import type { Member } from "@/lib/auth/session";
import type { Period } from "@/lib/dashboard/period";
import { createClient } from "@/lib/supabase/server";
import { parseOfficials, type OfficialStats } from "./model";

export type OfficialMention = {
  id: string;
  publishedAt: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  topic: string | null;
  emotion: string | null;
  source: string | null;
  /** Only media and public figures; citizens are never named. */
  author: string | null;
  url: string | null;
  interactions: number;
};

/** Stats per official for the period (the database logs the consultation). */
export async function getOfficialsStats(member: Member, period: Period): Promise<OfficialStats[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("officials_stats", {
    p_org_id: member.orgId,
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_prev_from: period.prevFrom.toISOString(),
  });
  if (error) throw new Error(`No se pudo cargar la percepción de funcionarios: ${error.message}`);
  return parseOfficials(data);
}

export async function getOfficialMentions(
  member: Member,
  officialId: string,
  period: Period,
  sentiment: OfficialMention["sentiment"],
): Promise<OfficialMention[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("official_mentions_list", {
    p_org_id: member.orgId,
    p_official_id: officialId,
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_sentiment: sentiment ?? undefined,
    p_limit: 30,
  });
  if (error) throw new Error(`No se pudieron cargar las menciones: ${error.message}`);
  return (data ?? []).map((m) => ({
    id: m.mention_id,
    publishedAt: m.published_at,
    text: m.text,
    sentiment: m.sentiment,
    topic: m.topic,
    emotion: m.emotion,
    source: m.source,
    author: m.author,
    url: m.url,
    interactions: Number(m.interactions ?? 0),
  }));
}
