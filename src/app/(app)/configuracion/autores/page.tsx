import type { Metadata } from "next";
import { VerifiedAuthorsTable } from "@/components/authors/verified-authors-table";
import { VerifyAuthorForm } from "@/components/authors/verify-author-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { getVerifiedAuthors } from "@/lib/authors/data";

export const metadata: Metadata = { title: "Autores verificados" };

const integer = new Intl.NumberFormat("es-MX");

export default async function VerifiedAuthorsPage() {
  const member = await requireSection("/configuracion/autores");
  const { entries, unverified } = await getVerifiedAuthors(member);

  return (
    <div className="flex flex-col gap-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Autores verificados
          </CardTitle>
          <CardDescription>
            Sólo los medios y figuras públicas de este catálogo (y el medio, página o canal que lee cada fuente configurada) aparecen con nombre en rankings,
            reportes, exportaciones y en lo que se envía a la IA. Toda otra cuenta se guarda como «Cuenta no verificada», sin nombre ni seguidores, y sólo
            cuenta en análisis agregados.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <VerifyAuthorForm />
          <VerifiedAuthorsTable entries={entries} />
          <p className="text-xs text-muted-foreground">
            Cuentas no verificadas: {integer.format(unverified.accounts)}, con {integer.format(unverified.mentions)} menciones. No se listan ni se pueden
            buscar: para verificar una cuenta se necesita conocerla por una fuente pública y documentar la evidencia.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
