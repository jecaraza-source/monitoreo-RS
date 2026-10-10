// Fictitious RSS feeds for demos and end-to-end tests of ingestion, classification
// and alerts. Every outlet, columnist and story is invented; citizens are never
// named. Items are generated per hour slot from a seeded PRNG, so the same hour
// always yields the same items (stable guids) and each new hour adds fresh ones.

export const DEMO_TOWN = "Alvarado";

export const DEMO_NEIGHBORHOODS = [
  "Centro",
  "Benito Juárez",
  "Emiliano Zapata",
  "Miguel Hidalgo",
  "Las Flores",
  "La Playa",
  "Pescadores",
  "El Faro",
  "Lázaro Cárdenas",
  "Revolución",
] as const;

type Story = { title: string; body: string };

export type DemoFeed = {
  slug: string;
  title: string;
  /** Fictitious byline (an outlet's columnist, never a citizen). */
  author: string;
  stories: readonly Story[];
  /** Items per hour slot. */
  perHour: number;
};

// {c} = neighborhood, {t} = town.
const NEWS: readonly Story[] = [
  { title: "Vecinos de {c} reportan cuatro días sin agua", body: "Habitantes de la colonia {c}, en {t}, denunciaron que llevan cuatro días sin servicio de agua potable y que la pipa prometida no ha llegado." },
  { title: "Fuga de agua en {c} lleva una semana sin atenderse", body: "Una fuga en la calle principal de {c} desperdicia miles de litros desde hace una semana, según vecinos consultados por este medio en {t}." },
  { title: "Bloqueo en la carretera por falta de agua en {c}", body: "Vecinos de {c} realizaron un bloqueo en el acceso a {t} para exigir el restablecimiento del servicio de agua potable." },
  { title: "Ayuntamiento de {t} repara red de drenaje en {c}", body: "Cuadrillas municipales concluyeron la reparación del colector de drenaje en {c}; vecinos reconocieron la rapidez de la obra." },
  { title: "Baches en {c} dañan vehículos, acusan automovilistas", body: "Automovilistas de {t} señalaron que los baches en las calles de {c} se han multiplicado tras las lluvias y piden su reparación." },
  { title: "Concluye repavimentación de avenida en {c}", body: "El Ayuntamiento de {t} entregó la repavimentación de la avenida principal de {c}, con una inversión municipal de 4.8 millones de pesos." },
  { title: "Inundación en {c} tras lluvias de la madrugada", body: "Las lluvias provocaron una inundación en varias calles de {c}, en {t}; Protección Civil atendió a familias afectadas." },
  { title: "Calles a oscuras en {c}: luminarias fundidas desde hace un mes", body: "Vecinos de {c} pidieron al Ayuntamiento de {t} reponer las luminarias fundidas; señalan que caminar de noche es inseguro." },
  { title: "Camión recolector no pasa por {c} desde hace una semana", body: "La basura se acumula en esquinas de {c}, en {t}, porque el camión recolector no ha pasado en siete días." },
  { title: "Policía municipal de {t} refuerza rondines en {c}", body: "Tras reportes de robos a casa habitación, la policía municipal de {t} anunció más rondines nocturnos en {c}." },
  { title: "Jornada de salud gratuita atiende a familias de {c}", body: "El DIF municipal de {t} realizó una jornada de salud en {c} con consultas, vacunas y entrega de medicamentos." },
  { title: "Pescadores de {t} reciben apoyo municipal para equipo", body: "El programa municipal de apoyo a pescadores entregó motores y redes a cooperativas de {c}, en {t}." },
  { title: "Inscripciones a becas municipales saturadas en {t}", body: "Madres y padres de familia de {c} se quejaron de que las becas municipales de {t} se agotaron el primer día de registro." },
  { title: "Corte programado de agua en {c} este jueves", body: "La comisión de agua de {t} informó que el jueves habrá corte de 8 a 16 horas en {c} por mantenimiento al pozo." },
];

const OPINION: readonly Story[] = [
  { title: "Columna: el agua en {t} no puede esperar", body: "Los cortes en {c} muestran que la red de agua de {t} necesita inversión urgente, no sólo pipas de emergencia." },
  { title: "Columna: lo que sí funcionó en {c}", body: "La respuesta del Ayuntamiento de {t} al drenaje de {c} demuestra que la coordinación con vecinos da resultados." },
  { title: "Columna: seguridad en {t}, una deuda pendiente", body: "Los robos reportados en {c} obligan a revisar la estrategia de seguridad municipal de {t}." },
  { title: "Columna: el malecón de {t} merece mantenimiento", body: "Turistas y vecinos de {c} coinciden en que el malecón de {t} necesita alumbrado y limpieza constantes." },
];

const RADIO: readonly Story[] = [
  { title: "Reportan derrumbe de barda en {c}; no hay lesionados", body: "Radioescuchas de {t} reportaron el derrumbe de una barda en {c}; Protección Civil acordonó la zona." },
  { title: "Manifestación de transportistas frente al Ayuntamiento de {t}", body: "Transportistas de {c} se manifestaron frente al palacio municipal de {t} para pedir la reparación de calles." },
  { title: "Vecinos de {c} agradecen nueva cancha deportiva", body: "La nueva cancha de usos múltiples en {c}, construida por el Ayuntamiento de {t}, ya es usada por ligas infantiles." },
  { title: "Socavón en calle de {c} pone en riesgo a peatones", body: "Un socavón abierto en {c}, en {t}, preocupa a vecinos; piden señalizarlo y repararlo cuanto antes." },
  { title: "Feria del pescado atrae visitantes a {t}", body: "La feria del pescado y marisco en {c} reunió a cientos de visitantes y benefició a cooperativas locales de {t}." },
];

export const DEMO_FEEDS: readonly DemoFeed[] = [
  { slug: "diario-del-puerto", title: "Diario del Puerto (ficticio)", author: "Redacción Diario del Puerto", stories: NEWS, perHour: 2 },
  { slug: "voz-del-papaloapan", title: "La Voz del Papaloapan (blog ficticio)", author: "Columna de Ramiro Ficticio", stories: OPINION, perHour: 1 },
  { slug: "radio-laguna", title: "Radio Laguna 101.3 (ficticia)", author: "Noticiero Radio Laguna", stories: RADIO, perHour: 1 },
];

export function demoFeed(slug: string): DemoFeed | undefined {
  return DEMO_FEEDS.find((f) => f.slug === slug);
}

export type DemoItem = { guid: string; title: string; description: string; author: string; publishedAt: Date };

const HOUR_MS = 3_600_000;

/** mulberry32: small deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const fill = (text: string, c: string) => text.replaceAll("{c}", c).replaceAll("{t}", DEMO_TOWN);

/** Items of the last `hours` hour slots, newest first; none is dated in the future. */
export function demoItems(feed: DemoFeed, now: Date, hours = 24): DemoItem[] {
  const currentSlot = Math.floor(now.getTime() / HOUR_MS);
  const items: DemoItem[] = [];
  for (let slot = currentSlot; slot > currentSlot - hours; slot--) {
    const random = prng(hash(`${feed.slug}:${slot}`));
    for (let i = 0; i < feed.perHour; i++) {
      const story = feed.stories[Math.floor(random() * feed.stories.length)];
      const neighborhood = DEMO_NEIGHBORHOODS[Math.floor(random() * DEMO_NEIGHBORHOODS.length)];
      const publishedAt = new Date(slot * HOUR_MS + Math.floor(random() * HOUR_MS));
      if (publishedAt > now) continue;
      items.push({
        guid: `demo:${feed.slug}:${slot}:${i}`,
        title: fill(story.title, neighborhood),
        description: fill(story.body, neighborhood),
        author: feed.author,
        publishedAt,
      });
    }
  }
  return items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function demoRss(feed: DemoFeed, origin: string, now: Date): string {
  const link = `${origin}/api/demo/rss/${feed.slug}`;
  const items = demoItems(feed, now)
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${link}#${encodeURIComponent(item.guid)}</link>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <dc:creator>${escapeXml(item.author)}</dc:creator>
      <pubDate>${item.publishedAt.toUTCString()}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${link}</link>
    <description>Feed de demostración con noticias ficticias.</description>
    <language>es-mx</language>
${items}
  </channel>
</rss>
`;
}
