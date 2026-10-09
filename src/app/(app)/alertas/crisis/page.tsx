import type { Metadata } from "next";
import { Suspense } from "react";
import { CrisisRoom } from "@/components/alerts/crisis-room";
import { Skeleton } from "@/components/ui/skeleton";
import { EVENT_SELECT, toAlertEvent } from "@/lib/alerts/data-shared";
import { requireSection } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DAY_MS, isoAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Sala de crisis" };

export default function CrisisPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[70svh] w-full" />}>
      <Crisis />
    </Suspense>
  );
}

async function Crisis() {
  const member = await requireSection("/alertas/crisis");
  const supabase = await createClient();
  const since = isoAgo(DAY_MS);
  const [log, alerts] = await Promise.all([
    supabase.from("crisis_log").select("id, author_name, body, created_at").eq("org_id", member.orgId).order("created_at", { ascending: false }).limit(100),
    supabase.from("alert_events").select(EVENT_SELECT).eq("org_id", member.orgId).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
  ]);
  return (
    <CrisisRoom
      orgId={member.orgId}
      canWrite={member.role === "admin" || member.role === "comunicacion"}
      initialLog={log.data ?? []}
      alerts={(alerts.data ?? []).map((r) => toAlertEvent(r as never))}
    />
  );
}
