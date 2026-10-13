import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxView } from "@/components/inbox/inbox-view";
import { QueueView } from "@/components/inbox/queue-view";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSection } from "@/lib/auth/session";
import { getInboxCatalogs } from "@/lib/inbox/data";
import { parseFilters, VIEWS_BY_SCOPE, type InboxScope } from "@/lib/inbox/model";
import { countOverdue, fetchCounts, fetchInbox, fetchQueue } from "@/lib/inbox/query";
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
  // A view the role does not have falls back to the chronological inbox.
  const view = filters.view && VIEWS_BY_SCOPE[scope].includes(filters.view) ? filters.view : undefined;

  if (view) {
    const [catalogs, page, counts] = await Promise.all([
      getInboxCatalogs(member),
      fetchQueue(supabase, member.orgId, scope, view, filters),
      fetchCounts(supabase, member.orgId, filters),
    ]);
    return (
      <QueueView
        orgId={member.orgId}
        scope={scope}
        departmentName={member.departmentName}
        catalogs={catalogs}
        view={view}
        filters={{ ...filters, view }}
        initialEntries={page.entries}
        initialNext={page.next}
        counts={counts}
      />
    );
  }

  const listFilters = { ...filters, view: undefined };
  const [catalogs, page, overdue, counts] = await Promise.all([
    getInboxCatalogs(member),
    fetchInbox(supabase, member.orgId, scope, listFilters, { count: true }),
    countOverdue(supabase, member.orgId),
    fetchCounts(supabase, member.orgId, listFilters),
  ]);

  return (
    <InboxView
      orgId={member.orgId}
      scope={scope}
      departmentName={member.departmentName}
      catalogs={catalogs}
      initialFilters={listFilters}
      initialPage={page}
      initialOverdue={overdue}
      initialCounts={counts}
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
