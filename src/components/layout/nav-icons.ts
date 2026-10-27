import { Activity, Bell, Bot, CircleHelp, FileText, FolderKanban, Inbox, Landmark, LayoutDashboard, Map, Settings, ShieldAlert, type LucideIcon } from "lucide-react";
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
  counterintel: ShieldAlert,
  health: Activity,
  settings: Settings,
  help: CircleHelp,
};
