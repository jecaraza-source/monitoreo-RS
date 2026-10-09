import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxView } from "@/components/inbox/inbox-view";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSection } from "@/lib/auth/session";
import { getInboxCatalogs } from "@/lib/inbox/data";
import { parseFilters, type InboxScope } from "@/lib/inbox/model";
import { countOverdue, fetchInbox } from "@/lib/inbox/query";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bandeja" };

export default function BandejaPage({ searchParams }: PageProps<"/bandeja">) {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <Inbox searchParams={searchParams} />
    </Suspense>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/bandeja">["searchParams"] }) {
  const member = await requireSection("/bandeja");
  const scope: InboxScope = member.role === "dependencia" ? "department" : "editor";
  const filters = parseFilters(await searchParams);
  const supabase = await createClient();
  const [catalogs, page, overdue] = await Promise.all([
    getInboxCatalogs(member),
    fetchInbox(supabase, member.orgId, scope, filters, { count: true }),
    countOverdue(supabase, member.orgId),
  ]);

  return (
    <InboxView
      orgId={member.orgId}
      scope={scope}
      departmentName={member.departmentName}
      catalogs={catalogs}
      initialFilters={filters}
      initialPage={page}
      initialOverdue={overdue}
    />
  );
}

function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando bandeja">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-36 w-full" />
      ))}
    </div>
  );
}
