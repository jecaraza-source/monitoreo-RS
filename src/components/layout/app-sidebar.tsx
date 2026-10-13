"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SigmaShield } from "@/components/brand/sigma-shield";
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
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { ROLE_LABELS, sectionsForRole, type Access, type Role, type Section } from "@/lib/auth/roles";
import { SECTION_ICONS } from "./nav-icons";

export function AppSidebar({
  role,
  access,
  orgName,
  departmentName,
}: {
  role: Role;
  access: Access;
  orgName: string;
  departmentName: string | null;
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  // Configuración and Ayuda sit apart, at the bottom, away from the day-to-day sections.
  const all = sectionsForRole(role, access);
  const bottom = new Set(["settings", "help"]);
  const sections = all.filter((s) => !bottom.has(s.key));
  const footer = all.filter((s) => bottom.has(s.key));
  // On mobile the menu is a sheet: close it once a section is chosen.
  const closeOnMobile = () => isMobile && setOpenMobile(false);

  const item = (section: Section) => {
    const Icon = SECTION_ICONS[section.key];
    const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
    return (
      <SidebarMenuItem key={section.key}>
        <SidebarMenuButton
          isActive={active}
          tooltip={section.label}
          // Larger than the kit default; the collapsed (icon-only) rail keeps 16 px icons.
          className="h-10 gap-3 text-base [&_svg]:size-5 group-data-[collapsible=icon]:[&_svg]:size-4"
          render={
            <Link href={section.href} aria-current={active ? "page" : undefined} onClick={closeOnMobile}>
              <Icon aria-hidden />
              <span>{section.label}</span>
            </Link>
          }
        />
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={orgName}
              className="h-16 gap-3"
              render={
                <Link href="/">
                  <span className="flex aspect-square size-11 shrink-0 items-center justify-center group-data-[collapsible=icon]:size-8">
                    {/* The menu button forces child svgs to size-4; the logo keeps its size. */}
                    <SigmaShield className="h-11! w-10! group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:w-7!" />
                  </span>
                  <span className="grid flex-1 gap-0.5 text-left leading-tight">
                    <span className="truncate text-lg font-semibold tracking-tight">
                      Sigma <span className="font-black italic">Pulso</span>
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{orgName}</span>
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
              <SidebarMenu>{sections.map(item)}</SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {footer.length > 0 && (
          <>
            <SidebarSeparator className="mx-0" />
            <nav aria-label="Administración y ayuda">
              <SidebarMenu>{footer.map(item)}</SidebarMenu>
            </nav>
          </>
        )}
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          {ROLE_LABELS[role]}
          {departmentName && <> · {departmentName}</>}
        </p>
      </SidebarFooter>
      <SidebarRail aria-label="Mostrar u ocultar menú" title="Mostrar u ocultar menú" />
    </Sidebar>
  );
}
