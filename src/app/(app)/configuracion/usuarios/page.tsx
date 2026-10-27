import type { Metadata } from "next";
import { Users } from "lucide-react";
import { InviteUserForm } from "@/components/settings/invite-user-form";
import { MemberActions } from "@/components/settings/member-actions";
import { OfficialsAccessToggle } from "@/components/settings/officials-access-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui-kit";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireSection } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Usuarios" };

const dateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

export default async function SettingsPage() {
  const member = await requireSection("/configuracion/usuarios");
  const supabase = await createClient();
  const [{ data: members }, { data: departments }, { data: grants }] = await Promise.all([
    supabase.rpc("org_members", { p_org_id: member.orgId }),
    supabase.from("departments").select("id, name").eq("org_id", member.orgId).order("name"),
    supabase.from("memberships").select("user_id, can_view_officials, can_view_counterintel").eq("org_id", member.orgId),
  ]);
  const officialsAccess = new Map((grants ?? []).map((g) => [g.user_id, g.can_view_officials]));
  const counterintelAccess = new Map((grants ?? []).map((g) => [g.user_id, g.can_view_counterintel]));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Invitar usuario</CardTitle>
          <CardDescription>
            Recibirá un correo con un enlace para entrar. Los usuarios de una dependencia sólo ven lo
            que se turna a su área.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteUserForm departments={departments ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Usuarios</CardTitle>
        </CardHeader>
        <CardContent>
          {members && members.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Correo</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Dependencia</TableHead>
                  <TableHead>Último acceso</TableHead>
                  <TableHead title="Módulo restringido de percepción de funcionarios">Funcionarios</TableHead>
                  <TableHead title="Radar Social: sólo los funcionarios autorizados, también Administración">
                    Radar Social
                  </TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">{m.email}</TableCell>
                    <TableCell>{ROLE_LABELS[m.role]}</TableCell>
                    <TableCell className="text-muted-foreground">{m.department_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.last_sign_in_at ? dateFormat.format(new Date(m.last_sign_in_at)) : "Sin accesos"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.role === "admin" ? (
                        "Siempre"
                      ) : m.role === "dependencia" ? (
                        "—"
                      ) : (
                        <OfficialsAccessToggle userId={m.user_id} email={m.email} allowed={officialsAccess.get(m.user_id) ?? false} />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.role === "dependencia" ? (
                        "—"
                      ) : (
                        <OfficialsAccessToggle
                          module="counterintel"
                          userId={m.user_id}
                          email={m.email}
                          allowed={counterintelAccess.get(m.user_id) ?? false}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <MemberActions
                        member={{ userId: m.user_id, email: m.email, role: m.role, departmentId: m.department_id }}
                        departments={departments ?? []}
                        isSelf={m.user_id === member.userId}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={<Users />} title="Sin usuarios" description="Invita al primer usuario." />
          )}
        </CardContent>
      </Card>
    </>
  );
}
