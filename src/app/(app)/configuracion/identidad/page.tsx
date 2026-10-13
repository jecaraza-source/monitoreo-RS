import type { Metadata } from "next";
import { BrandForm } from "@/components/reports/report-settings";
import { LogoForm } from "@/components/settings/logo-form";
import { requireSection } from "@/lib/auth/session";
import { logoUrl } from "@/lib/branding/logo";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Identidad" };

export default async function IdentityPage() {
  const member = await requireSection("/configuracion/identidad");
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("brand_primary, brand_accent, logo_path").eq("id", member.orgId).single();
  const url = await logoUrl(supabase, org?.logo_path);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <LogoForm logoUrl={url} />
      <BrandForm brand={{ primary: org?.brand_primary ?? "#032a50", accent: org?.brand_accent ?? "#36c6c0" }} canEdit logoUrl={url} />
    </div>
  );
}
