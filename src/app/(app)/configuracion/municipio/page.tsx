import type { Metadata } from "next";
import Link from "next/link";
import { OnboardingChecklist } from "@/components/settings/onboarding-checklist";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireSection } from "@/lib/auth/session";
import { getLastChanges, getOnboarding } from "@/lib/settings/data";
import { readiness } from "@/lib/settings/onboarding";
import { canEdit, CONFIG_ELEMENTS } from "@/lib/settings/registry";

export const metadata: Metadata = { title: "Configuración del municipio" };

const dateTime = (iso: string) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" });

export default async function MunicipalityPage() {
  const member = await requireSection("/configuracion/municipio");
  const isAdmin = member.role === "admin";
  const [changes, checklist] = await Promise.all([getLastChanges(member), isAdmin ? getOnboarding(member) : null]);
  const progress = checklist ? readiness(checklist) : null;

  return (
    <div className="flex flex-col gap-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Configuración del municipio
          </CardTitle>
          <CardDescription>
            Cada elemento, quién puede cambiarlo y el último cambio. Todo cambio queda en la Bitácora con el valor anterior, el nuevo, la persona y la
            fecha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Elementos de configuración, desplazable">
            <Table aria-label="Elementos de configuración">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Elemento</TableHead>
                  <TableHead scope="col">Quién lo cambia</TableHead>
                  {changes && <TableHead scope="col">Último cambio</TableHead>}
                  <TableHead scope="col">
                    <span className="sr-only">Abrir</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CONFIG_ELEMENTS.map((e) => {
                  const last = changes?.[e.key];
                  return (
                    <TableRow key={e.key}>
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{e.label}</span>
                        {e.sensitive && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">Sensible</span>}
                        <span className="block text-xs text-muted-foreground">{e.description}</span>
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs">{e.editors.map((r) => ROLE_LABELS[r]).join(", ")}</TableCell>
                      {changes && (
                        <TableCell className="text-xs">
                          {last ? (
                            <>
                              {dateTime(last.at)}
                              <span className="block text-muted-foreground">{last.actor}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">Sin cambios registrados</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Link href={e.href} className="text-sm text-primary underline">
                          {canEdit(e, member.role) ? "Configurar" : "Ver"}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {checklist && progress && (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Puesta en operación ({progress.done} de {progress.total})
            </CardTitle>
            <CardDescription>
              Lo automático se revisa con los datos del municipio; las pruebas por rol se registran a mano con su resultado. Usa datos ficticios y buzones
              de prueba: el procedimiento está en docs/onboarding.md.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingChecklist items={checklist} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
