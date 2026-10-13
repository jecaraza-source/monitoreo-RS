import type { Metadata } from "next";
import { CheckCircle2, MessageCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui-kit";
import { EscalationForm } from "@/components/whatsapp/escalation-form";
import { ResponsiblesTable, type ContactStatus } from "@/components/whatsapp/responsibles-table";
import Link from "next/link";
import { requireSection } from "@/lib/auth/session";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { formatPhone, maskPhone } from "@/lib/whatsapp/phone";

export const metadata: Metadata = { title: "WhatsApp" };

const when = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });

const MESSAGE_STATUS: Record<string, string> = {
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
  received: "Recibido",
};

export default async function WhatsAppSettingsPage() {
  const member = await requireSection("/configuracion/whatsapp");
  const supabase = await createClient();
  const [departments, members, contacts, messages, settings, site] = await Promise.all([
    supabase.from("departments").select("id, name, responsible_user_id").eq("org_id", member.orgId).order("name"),
    supabase.rpc("org_members", { p_org_id: member.orgId }),
    supabase.from("whatsapp_contacts").select("id, user_id, phone, status").eq("org_id", member.orgId),
    supabase
      .from("whatsapp_messages")
      .select("id, direction, kind, body, status, error, created_at, contact_id")
      .eq("org_id", member.orgId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("whatsapp_settings").select("escalation_user_id").eq("org_id", member.orgId).maybeSingle(),
    getSiteUrl(),
  ]);

  const memberList = members.data ?? [];
  const contactByUser = new Map((contacts.data ?? []).map((c) => [c.user_id, c]));
  const contactById = new Map((contacts.data ?? []).map((c) => [c.id, c]));
  const emailByUser = new Map(memberList.map((m) => [m.user_id, m.email]));
  const rows = (departments.data ?? []).map((d) => {
    const contact = d.responsible_user_id ? contactByUser.get(d.responsible_user_id) : undefined;
    return {
      departmentId: d.id,
      departmentName: d.name,
      responsibleId: d.responsible_user_id,
      candidates: memberList
        .filter((m) => m.role === "admin" || m.role === "comunicacion" || (m.role === "dependencia" && m.department_id === d.id))
        .map((m) => ({ id: m.user_id, label: m.role === "dependencia" ? m.email : `${m.email} (${m.role === "admin" ? "Admin" : "Comunicación"})` })),
      contact: contact ? { phone: formatPhone(contact.phone), status: contact.status as ContactStatus } : null,
    };
  });

  const escalationId = settings.data?.escalation_user_id ?? null;
  const escalationContact = escalationId ? contactByUser.get(escalationId) : undefined;
  const escalationCandidates = memberList
    .filter((m) => m.role === "admin" || m.role === "comunicacion")
    .map((m) => ({ id: m.user_id, label: `${m.email} (${m.role === "admin" ? "Admin" : "Comunicación"})` }));

  const env = process.env;
  const checks = [
    { label: "Token de acceso (WHATSAPP_TOKEN)", ok: Boolean(env.WHATSAPP_TOKEN) },
    { label: "Identificador del número (WHATSAPP_PHONE_NUMBER_ID)", ok: Boolean(env.WHATSAPP_PHONE_NUMBER_ID) },
    { label: "Token de verificación del webhook (WHATSAPP_VERIFY_TOKEN)", ok: Boolean(env.WHATSAPP_VERIFY_TOKEN) },
    { label: "Secreto de la app de Meta (WHATSAPP_APP_SECRET)", ok: Boolean(env.WHATSAPP_APP_SECRET ?? env.META_APP_SECRET) },
  ];
  const number = env.WHATSAPP_DISPLAY_PHONE ?? "+52 56 2133 9211";

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Conexión con WhatsApp</CardTitle>
          <CardDescription>
            Número de SIGMA: <span className="font-medium text-foreground">{number}</span>. Los funcionarios reciben ahí los
            turnos de su dependencia.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1.5">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                {c.ok ? (
                  <CheckCircle2 className="size-4 text-positive" aria-label="Configurado" />
                ) : (
                  <XCircle className="size-4 text-muted-foreground" aria-label="Falta" />
                )}
                {c.label}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            URL del webhook para Meta: <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all">{site}/api/whatsapp/webhook</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">SLA y escalamiento</CardTitle>
          <CardDescription>
            Los plazos (horas corridas u hábiles, días inhábiles, por categoría y prioridad) y los niveles de escalamiento de los casos se configuran en
            su propia sección.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/configuracion/sla" className="text-sm font-medium underline">
            Ir a SLA y escalamiento
          </Link>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle as="h2">Responsables por dependencia</CardTitle>
          <CardDescription>
            Un responsable por dependencia recibe sus turnos por WhatsApp. Al invitarlo le llega un mensaje para aceptar;
            puede darse de baja escribiendo BAJA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <ResponsiblesTable rows={rows} />
          ) : (
            <EmptyState title="Sin dependencias" description="Agrégalas en Catálogos." />
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle as="h2">Seguimiento de turnos</CardTitle>
          <CardDescription>
            Al 75% del plazo, el responsable recibe un recordatorio; al vencer, un aviso de turno vencido y se escala a la
            persona que elijas aquí. No se envían entre 22:00 y 7:00. Por WhatsApp, cada responsable puede escribir
            PENDIENTES para ver sus turnos abiertos o el folio de uno para ver su detalle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EscalationForm
            key={escalationId ?? "none"}
            userId={escalationId}
            candidates={escalationCandidates}
            contact={escalationContact ? { phone: formatPhone(escalationContact.phone), status: escalationContact.status as ContactStatus } : null}
          />
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle as="h2">Mensajes recientes</CardTitle>
          <CardDescription>Últimos 25 mensajes con funcionarios y su estado de entrega.</CardDescription>
        </CardHeader>
        <CardContent>
          {messages.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Funcionario</TableHead>
                  <TableHead>Mensaje</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.data.map((msg) => {
                  const contact = msg.contact_id ? contactById.get(msg.contact_id) : undefined;
                  return (
                    <TableRow key={msg.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{when.format(new Date(msg.created_at))}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {msg.direction === "in" ? "← " : "→ "}
                        {contact ? (emailByUser.get(contact.user_id) ?? maskPhone(contact.phone)) : "—"}
                      </TableCell>
                      <TableCell className="max-w-md truncate" title={msg.body ?? undefined}>
                        {msg.body ?? "—"}
                      </TableCell>
                      <TableCell className={msg.status === "failed" ? "text-negative" : "text-muted-foreground"} title={msg.error ?? undefined}>
                        {MESSAGE_STATUS[msg.status] ?? msg.status}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={<MessageCircle />} title="Sin mensajes" description="Aquí aparecerán las invitaciones y respuestas." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
