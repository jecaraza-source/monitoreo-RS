import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireSection } from "@/lib/auth/session";
import { CASE_STATES, GUIDES, guidesFor, PROCEDURES, TOPIC_LABELS, type Guide, type HelpTopic } from "@/lib/help/content";
import { RACI, RACI_ROLES } from "@/lib/help/raci";

export const metadata: Metadata = { title: "Ayuda" };

function GuideBody({ guide }: { guide: Guide }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">{guide.who}</p>
      <section aria-label={`Pasos de ${guide.title}`}>
        <h3 className="mb-1 font-medium">Tu trabajo diario</h3>
        <ol className="list-decimal space-y-1 pl-5">
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>
      {(Object.keys(guide.topics) as HelpTopic[]).map((topic) => (
        <section key={topic} aria-label={TOPIC_LABELS[topic]}>
          <h3 className="mb-1 font-medium">{TOPIC_LABELS[topic]}</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {guide.topics[topic]!.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default async function HelpPage() {
  const member = await requireSection("/ayuda");
  const mine = guidesFor(member.role);
  const others = GUIDES.filter((g) => !mine.includes(g));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Ayuda" description={`Guía para ${ROLE_LABELS[member.role]}: qué recibes, cómo actuar y a quién avisar.`} />

      {mine.map((guide) => (
        <Card key={guide.profile}>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              {guide.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GuideBody guide={guide} />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Estados de un caso
          </CardTitle>
          <CardDescription>Qué significa cada estado y quién actúa después.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Diccionario de estados, desplazable">
            <Table aria-label="Diccionario de estados">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Estado</TableHead>
                  <TableHead scope="col">Significa</TableHead>
                  <TableHead scope="col">Sigue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CASE_STATES.map((s) => (
                  <TableRow key={s.status}>
                    <TableCell className="font-medium">{s.label}</TableCell>
                    <TableCell className="whitespace-normal">{s.meaning}</TableCell>
                    <TableCell className="whitespace-normal">{s.next}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Matriz de responsabilidades
          </CardTitle>
          <CardDescription>R = realiza · A = aprueba o responde · C = se le consulta · I = se le informa.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Matriz de responsabilidades, desplazable">
            <Table aria-label="Matriz de responsabilidades">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Actividad</TableHead>
                  {RACI_ROLES.map((r) => (
                    <TableHead key={r} scope="col" className="text-center">
                      {r}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {RACI.map((row) => (
                  <TableRow key={row.activity}>
                    <TableCell className="whitespace-normal">{row.activity}</TableCell>
                    {row.cells.map((c, i) => (
                      <TableCell key={RACI_ROLES[i]} className="text-center">
                        {c}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Procedimientos
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {PROCEDURES.map((p) => (
            <section key={p.key} aria-label={p.title}>
              <h3 className="mb-1 font-medium">{p.title}</h3>
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                {p.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </section>
          ))}
        </CardContent>
      </Card>

      {others.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Otros roles
            </CardTitle>
            <CardDescription>Para saber qué hace y qué recibe cada quien.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {others.map((g) => (
              <details key={g.profile} className="rounded-lg border p-3">
                <summary className="cursor-pointer font-medium">{g.title}</summary>
                <div className="pt-3">
                  <GuideBody guide={g} />
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
