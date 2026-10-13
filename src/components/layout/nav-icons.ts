import { Activity, Bell, Bot, FileText, FolderKanban, Inbox, Landmark, LayoutDashboard, Map, Settings, type LucideIcon } from "lucide-react";
import type { SectionKey } from "@/lib/auth/roles";

export const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  inbox: Inbox,
  cases: FolderKanban,
  map: Map,
  alerts: Bell,
  reports: FileText,
  assistant: Bot,
  officials: Landmark,
  health: Activity,
  settings: Settings,
};
