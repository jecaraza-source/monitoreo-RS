"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { ROLE_LABELS, sectionsForRole, type Role } from "@/lib/auth/roles";
import { SECTION_ICONS } from "./nav-icons";

export function AppSidebar({
  role,
  orgName,
  departmentName,
}: {
  role: Role;
  orgName: string;
  departmentName: string | null;
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const sections = sectionsForRole(role);
  // On mobile the menu is a sheet: close it once a section is chosen.
  const closeOnMobile = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={orgName}
              render={
                <Link href="/">
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Radar className="size-4" aria-hidden />
                  </span>
                  <span className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">Monitoreo Municipal</span>
                    <span className="truncate text-xs text-muted-foreground">{orgName}</span>
                  </span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Secciones">
              <SidebarMenu>
                {sections.map((section) => {
                  const Icon = SECTION_ICONS[section.key];
                  const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
                  return (
                    <SidebarMenuItem key={section.key}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={section.label}
                        render={
                          <Link href={section.href} aria-current={active ? "page" : undefined} onClick={closeOnMobile}>
                            <Icon aria-hidden />
                            <span>{section.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <p className="px-2 text-xs text-muted-foreground">
          {ROLE_LABELS[role]}
          {departmentName && <> · {departmentName}</>}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
