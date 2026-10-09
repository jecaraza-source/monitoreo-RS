"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const WEEK_MS = 7 * 86_400_000;

/**
 * Unseen alerts of the last 7 days (RLS-scoped: a department only counts
 * its own). New alerts pop a toast anywhere in the app.
 */
export function AlertBell({ orgId, initialCount }: { orgId: string; initialCount: number }) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const supabase = createClient();
    const recount = async () => {
      const { count: n } = await supabase
        .from("alert_events")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .is("acknowledged_at", null)
        .gte("created_at", new Date(Date.now() - WEEK_MS).toISOString());
      setCount(n ?? 0);
    };
    const channel = supabase
      .channel(`bell:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_events", filter: `org_id=eq.${orgId}` }, (payload) => {
        void recount();
        if (payload.eventType !== "INSERT") return;
        const alert = payload.new as { id: string; title: string; summary: string };
        if (window.location.pathname.startsWith("/alertas")) return;
        toast.warning(alert.title || "Nueva alerta", {
          description: alert.summary?.slice(0, 120),
          action: { label: "Ver", onClick: () => router.push(`/alertas?alerta=${alert.id}`) },
          duration: 10_000,
        });
      });
    supabase.auth.getSession().then(({ data }) => {
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel.subscribe();
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  return (
    <Link
      href="/alertas"
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
      aria-label={count ? `Alertas: ${count} sin ver` : "Alertas"}
    >
      <Bell aria-hidden />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
