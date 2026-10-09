import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertBell } from "@/components/alerts/alert-bell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ProjectSelector } from "@/components/layout/project-selector";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { requireMember } from "@/lib/auth/session";
import { getActiveProjectId, getProjects } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { DAY_MS, isoAgo } from "@/lib/time";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    // The shell depends on the session (role → menu), so it streams behind a
    // boundary; the skeleton is the prerendered part.
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

async function AppShell({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const supabase = await createClient();
  const [cookieStore, projects, unseen] = await Promise.all([
    cookies(),
    getProjects(member),
    // Unseen alerts of the last week for the bell (RLS scopes departments).
    supabase
      .from("alert_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", member.orgId)
      .is("acknowledged_at", null)
      .gte("created_at", isoAgo(7 * DAY_MS)),
  ]);
  const activeProjectId = await getActiveProjectId(projects);
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar role={member.role} orgName={member.orgName} departmentName={member.departmentName} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label="Mostrar u ocultar menú" />
          <div aria-hidden className="mx-1 h-5 w-px bg-border" />
          <ProjectSelector projects={projects} activeProjectId={activeProjectId} />
          <div className="ml-auto flex items-center gap-1">
            <AlertBell orgId={member.orgId} initialCount={unseen.count ?? 0} />
            <ThemeToggle />
            <UserMenu email={member.email} role={member.role} />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full" aria-busy="true" aria-label="Cargando">
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r p-3 md:flex">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    </div>
  );
}
