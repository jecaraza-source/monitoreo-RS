import type { Metadata } from "next";
import { DepartmentContacts } from "@/components/sla/department-contacts";
import { EscalationForm } from "@/components/sla/escalation-form";
import { SlaConfigForm } from "@/components/sla/sla-config-form";
import { SlaReapply } from "@/components/sla/sla-reapply";
import { SlaVersionCard } from "@/components/sla/sla-version-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { getInboxCatalogs } from "@/lib/inbox/data";
import { getSlaReapplyPreview, getSlaSettings } from "@/lib/sla/data";

export const metadata: Metadata = { title: "SLA y escalamiento" };

export default async function SlaPage() {
  const member = await requireSection("/configuracion/sla");
  const [s, catalogs, reapply] = await Promise.all([getSlaSettings(member), getInboxCatalogs(member), getSlaReapplyPreview(member)]);

  return (
    <div className="flex flex-col gap-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Acuerdo de nivel de servicio (SLA)
          </CardTitle>
          <CardDescription>
            Plazos de aceptación y de atención con que se asignan los casos. Cada caso guarda la versión con que se asignó.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <SlaVersionCard versions={s.versions} />
          <SlaConfigForm calendar={s.calendar} holidays={s.holidays} targets={s.targets} topics={catalogs.topics} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Reaplicar SLA a casos abiertos
          </CardTitle>
          <CardDescription>
            Cambiar el SLA no mueve los compromisos ya asignados. Si el municipio decide aplicar la versión vigente a casos abiertos, elígelos aquí y
            explica el motivo: cada cambio queda en el historial del caso y en la bitácora, con el plazo anterior y el nuevo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlaReapply rows={reapply} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Escalamiento y avisos
          </CardTitle>
          <CardDescription>
            Antes de vencer, un recordatorio al enlace; después, escalamiento al enlace, al titular y a la coordinación del caso. Cada paso se envía una sola
            vez y queda registrado con su motivo, plazo, destinatario y resultado.
          </CardDescription>
        </CardHeader>
        <CardContent>{s.settings ? <EscalationForm settings={s.settings} /> : <p className="text-sm text-muted-foreground">Sin configuración.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Enlaces y titulares
          </CardTitle>
          <CardDescription>
            Los destinatarios salen de esta configuración: personas de la dependencia (o de Administración y Comunicación). Sin persona configurada, el paso
            se registra como «sin destinatario» y no se envía a nadie más.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DepartmentContacts departments={s.departments} people={s.people} />
        </CardContent>
      </Card>
    </div>
  );
}
