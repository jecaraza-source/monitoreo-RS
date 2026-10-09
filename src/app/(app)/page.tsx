import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";

// "/" sends each role to its first section (dependencia → Bandeja).
export default async function HomePage() {
  const member = await requireMember();
  redirect(homeForRole(member.role));
}
