import type { Metadata } from "next";
import { ExportForm, HoldsManager, RetentionPolicyForm } from "@/components/retention/retention-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { toMxDay } from "@/lib/dashboard/period";
import { getRetention } from "@/lib/retention/data";
import { canExport, EXPORT_KINDS, type ExportKind } from "@/lib/retention/model";

export const metadata: Metadata = { title: "Retención y conciliación" };

const integer = new Intl.NumberFormat("es-MX");

export default async function RetentionPage() {
  const member = await requireSection("/configuracion/retencion");
  const r = await getRetention(member);
  const today = toMxDay(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const kinds = (Object.keys(EXPORT_KINDS) as ExportKind[]).filter((k) => canExport(k, member.role));

  return (
    <div className="flex flex-col gap-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Política de retención
          </CardTitle>
          <CardDescription>
            El plazo lo fija un acuerdo del municipio; el sistema no asume ningún plazo legal. Nunca se eliminan las menciones que forman parte de un caso
            ni las que cubre una conservación. Cada depuración queda en la bitácora con su base.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm" role="status">
            {r.policy
              ? r.policy.paused
                ? "Depuración pausada."
                : r.policy.mention_months
                  ? `Vigente: ${r.policy.mention_months} meses (${r.policy.agreement_reference}, ${r.policy.agreement_date}).`
                  : "Vigente: sin eliminación automática."
              : `Sin política del municipio: se aplica el valor del despliegue (${r.fallbackMonths} meses), que no es un plazo legal. Registra el acuerdo.`}
          </p>
          {r.preview && (
            <dl className="grid gap-2 text-sm sm:grid-cols-4" aria-label="Vista previa de la depuración">
              <div>
                <dt className="text-muted-foreground">Anteriores al corte</dt>
                <dd className="text-lg">{integer.format(r.preview.older)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Se conservan por caso</dt>
                <dd className="text-lg">{integer.format(r.preview.kept_in_case)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Se conservan por obligación</dt>
                <dd className="text-lg">{integer.format(r.preview.kept_by_hold)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Se eliminarían</dt>
                <dd className="text-lg">{integer.format(r.preview.deletable)}</dd>
              </div>
            </dl>
          )}
          <RetentionPolicyForm policy={r.policy} />
          {r.purges.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Últimas depuraciones:{" "}
              {r.purges.map((p) => `${new Date(p.at).toLocaleDateString("es-MX")} (${p.deleted ?? 0}, ${p.basis ?? "política"})`).join(" · ")}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Conservaciones
          </CardTitle>
          <CardDescription>
            Obligaciones de conservar (solicitudes de información, procedimientos, auditorías). Mientras estén activas, la depuración no toca lo que cubren.
            No se borran: se liberan con motivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HoldsManager holds={r.holds} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Exportar para conciliación
          </CardTitle>
          <CardDescription>
            Casos con sus compromisos, llamadas a la IA (el costo desconocido sale vacío, nunca 0) y la bitácora. Máximo un año por archivo; cada descarga
            queda registrada con quién, qué y periodo. No incluye autores ni datos de ciudadanos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExportForm kinds={kinds} defaultFrom={monthStart} defaultTo={today} />
        </CardContent>
      </Card>
    </div>
  );
}
