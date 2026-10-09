import { Bell, Bot, FileText, Inbox, LayoutDashboard, Map, Settings, type LucideIcon } from "lucide-react";
import type { SectionKey } from "@/lib/auth/roles";

export const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  inbox: Inbox,
  map: Map,
  alerts: Bell,
  reports: FileText,
  assistant: Bot,
  settings: Settings,
};
