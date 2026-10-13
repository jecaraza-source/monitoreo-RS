import type { Metadata } from "next";
import { CategoriesCatalog } from "@/components/catalogs/categories-catalog";
import { DepartmentsCatalog } from "@/components/catalogs/departments-catalog";
import { NeighborhoodsCatalog } from "@/components/catalogs/neighborhoods-catalog";
import { OfficialsCatalog } from "@/components/catalogs/officials-catalog";
import { RiskTermsCatalog } from "@/components/catalogs/risk-terms-catalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { municipalityFromOrgName } from "@/lib/geo/osm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Catálogos" };

export default async function CatalogsPage() {
  const member = await requireSection("/configuracion/catalogos");
  const supabase = await createClient();
  const [departments, neighborhoods, riskTerms, org, officials, categories, capabilities] = await Promise.all([
    supabase.from("departments").select("id, name, short_name").eq("org_id", member.orgId).order("name"),
    // Only the geometry type, not the polygons themselves.
    supabase.from("neighborhoods").select("id, name, shape_source, shape:geojson->>type").eq("org_id", member.orgId).order("name"),
    supabase.from("risk_terms").select("id, term, severity").eq("org_id", member.orgId).order("term"),
    supabase.from("organizations").select("name").eq("id", member.orgId).single(),
    supabase.from("officials").select("id, name, position, aliases, is_active").eq("org_id", member.orgId).order("name"),
    supabase.from("case_categories").select("id, name, description, default_department_id, active").eq("org_id", member.orgId).order("name"),
    supabase.from("department_capabilities").select("category_id, department_id").eq("org_id", member.orgId),
  ]);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Dependencias</CardTitle>
          <CardDescription>Áreas a las que se turnan las menciones.</CardDescription>
        </CardHeader>
        <CardContent>
          <DepartmentsCatalog
            departments={(departments.data ?? []).map((d) => ({ id: d.id, name: d.name, shortName: d.short_name }))}
          />
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle as="h2">Categorías de caso y capacidades</CardTitle>
          <CardDescription>
            Qué tipos de caso existen, qué dependencias pueden atender cada uno y cuál se sugiere al asignar. Los plazos por categoría se definen en SLA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoriesCatalog
            departments={(departments.data ?? []).map((d) => ({ id: d.id, name: d.name }))}
            categories={(categories.data ?? []).map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              defaultDepartmentId: c.default_department_id,
              active: c.active,
              departmentIds: (capabilities.data ?? []).filter((x) => x.category_id === c.id).map((x) => x.department_id),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Términos de riesgo</CardTitle>
          <CardDescription>Palabras que elevan la prioridad al clasificar.</CardDescription>
        </CardHeader>
        <CardContent>
          <RiskTermsCatalog terms={riskTerms.data ?? []} />
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle as="h2">Funcionarios</CardTitle>
          <CardDescription>Servidores públicos cuya gestión se evalúa en el módulo de percepción (acceso restringido).</CardDescription>
        </CardHeader>
        <CardContent>
          <OfficialsCatalog
            officials={(officials.data ?? []).map((o) => ({ id: o.id, name: o.name, position: o.position, aliases: o.aliases, isActive: o.is_active }))}
          />
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle as="h2">Colonias</CardTitle>
          <CardDescription>
            {neighborhoods.data?.length ?? 0} colonias. Los polígonos alimentan el mapa y la detección de colonia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NeighborhoodsCatalog
            neighborhoods={(neighborhoods.data ?? []).map((n) => ({
              id: n.id,
              name: n.name,
              hasShape: Boolean(n.shape),
              approx: n.shape_source === "osm_approx",
            }))}
            municipality={municipalityFromOrgName(org.data?.name ?? "")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
