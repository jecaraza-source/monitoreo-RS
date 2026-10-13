import type { Metadata } from "next";
import { IncidentPolicyForm } from "@/components/settings/incident-policy-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { INCIDENT_TYPES } from "@/lib/inbox/model";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Emergencias" };

export default async function EmergenciesPage() {
  const member = await requireSection("/configuracion/emergencias");
  const supabase = await createClient();
  const { data } = await supabase.from("incident_policies").select("incident_type, channel, instructions").eq("org_id", member.orgId);
  const byType = new Map((data ?? []).map((p) => [p.incident_type, p]));

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-base">
          Políticas para emergencias
        </CardTitle>
        <CardDescription>
          Antes de turnar una mención con gravedad de emergencia, la bandeja muestra el canal institucional que le corresponde y pide confirmar que se
          avisó. Turnar a una dependencia es seguimiento: no sustituye al 911 ni a Protección Civil.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {INCIDENT_TYPES.filter((t) => t !== "none").map((t) => (
          <IncidentPolicyForm key={t} incidentType={t} policy={byType.get(t) ?? null} />
        ))}
      </CardContent>
    </Card>
  );
}
