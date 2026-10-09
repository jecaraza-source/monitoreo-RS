import type { Metadata } from "next";
import { DepartmentsCatalog } from "@/components/catalogs/departments-catalog";
import { NeighborhoodsCatalog } from "@/components/catalogs/neighborhoods-catalog";
import { RiskTermsCatalog } from "@/components/catalogs/risk-terms-catalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Catálogos" };

export default async function CatalogsPage() {
  const member = await requireSection("/configuracion/catalogos");
  const supabase = await createClient();
  const [departments, neighborhoods, riskTerms] = await Promise.all([
    supabase.from("departments").select("id, name, short_name").eq("org_id", member.orgId).order("name"),
    // Only the geometry type, not the polygons themselves.
    supabase.from("neighborhoods").select("id, name, shape:geojson->>type").eq("org_id", member.orgId).order("name"),
    supabase.from("risk_terms").select("id, term, severity").eq("org_id", member.orgId).order("term"),
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
          <CardTitle as="h2">Colonias</CardTitle>
          <CardDescription>
            {neighborhoods.data?.length ?? 0} colonias. Los polígonos alimentan el mapa y la detección de colonia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NeighborhoodsCatalog
            neighborhoods={(neighborhoods.data ?? []).map((n) => ({ id: n.id, name: n.name, hasShape: Boolean(n.shape) }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
