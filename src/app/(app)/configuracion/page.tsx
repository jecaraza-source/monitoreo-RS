import { redirect } from "next/navigation";
import { subsectionsForRole } from "@/lib/auth/roles";
import { requireSection } from "@/lib/auth/session";

export default async function SettingsIndex() {
  const member = await requireSection("/configuracion");
  redirect(subsectionsForRole(member.role)[0]?.href ?? "/");
}
