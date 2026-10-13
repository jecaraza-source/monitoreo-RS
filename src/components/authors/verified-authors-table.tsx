"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { revokeAuthor } from "@/lib/authors/actions";
import type { VerifiedAuthor } from "@/lib/authors/data";
import { AUTHOR_KIND_LABEL } from "@/lib/authors/label";

const PLATFORM: Record<string, string> = { rss: "Sitio / RSS", meta: "Facebook", youtube: "YouTube", x: "X" };
const date = (iso: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date(iso));

function RevokeButton({ entry }: { entry: VerifiedAuthor }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`Revocar verificación de ${entry.display_name}`}
      onClick={() => {
        const reason = window.prompt(`Motivo para revocar «${entry.display_name}» (queda en el historial):`);
        if (!reason) return;
        startTransition(async () => {
          const result = await revokeAuthor({ id: entry.id, reason });
          if (!result.ok) return void toast.error(result.message);
          toast.success(result.message);
          router.refresh();
        });
      }}
    >
      Revocar
    </Button>
  );
}

export function VerifiedAuthorsTable({ entries }: { entries: VerifiedAuthor[] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Catálogo de autores verificados, desplazable">
      <Table aria-label="Catálogo de autores verificados">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Nombre</TableHead>
            <TableHead scope="col">Tipo</TableHead>
            <TableHead scope="col">Cuenta</TableHead>
            <TableHead scope="col">Evidencia</TableHead>
            <TableHead scope="col">Responsable</TableHead>
            <TableHead scope="col">Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length ? (
            entries.map((e) => (
              <TableRow key={e.id} className={e.revoked_at ? "opacity-60" : undefined}>
                <TableCell className="font-medium">{e.display_name}</TableCell>
                <TableCell>{AUTHOR_KIND_LABEL[e.kind]}</TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{PLATFORM[e.platform]}</span>
                  <span className="block font-mono text-xs">{e.handle}</span>
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal text-xs">
                  {e.evidence}
                  {e.evidence_url && (
                    <a href={e.evidence_url} target="_blank" rel="noreferrer noopener" className="block text-primary underline">
                      Ver evidencia
                    </a>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {e.verified_by_name || "—"}
                  <span className="block text-muted-foreground">{date(e.verified_at)}</span>
                </TableCell>
                <TableCell className="text-xs">
                  {e.revoked_at ? (
                    <>
                      Revocada el {date(e.revoked_at)} por {e.revoked_by_name || "—"}
                      <span className="block text-muted-foreground">{e.revoked_reason}</span>
                    </>
                  ) : (
                    <RevokeButton entry={e} />
                  )}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Aún no hay cuentas verificadas.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
