import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { subsectionsForRole } from "@/lib/auth/roles";
import { requireSection } from "@/lib/auth/session";

export default async function SettingsLayout({ children }: LayoutProps<"/configuracion">) {
  const member = await requireSection("/configuracion");
  const tabs = subsectionsForRole(member.role).map(({ href, label }) => ({ href, label }));

  return (
    <>
      <PageHeader title="Configuración" description={member.orgName} />
      <SettingsTabs tabs={tabs} />
      {children}
    </>
  );
}
