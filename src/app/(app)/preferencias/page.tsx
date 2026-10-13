import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { PreferencesForm } from "@/components/sla/preferences-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import { getMyPreferences } from "@/lib/sla/data";

export const metadata: Metadata = { title: "Mis avisos" };

/** Every member: the channels and quiet hours of the notices addressed to them. */
export default async function PreferencesPage() {
  const member = await requireMember();
  const p = await getMyPreferences(member);
  return (
    <>
      <PageHeader title="Mis avisos" description="Cómo y cuándo te llegan recordatorios, escalamientos y alertas." />
      <Card className="max-w-2xl">
        <CardContent className="pt-4">
          <PreferencesForm initial={{ email: p.email, whatsapp: p.whatsapp, quiet: p.quiet }} orgQuiet={p.orgQuiet} whatsappActive={p.whatsappActive} />
        </CardContent>
      </Card>
    </>
  );
}
