// Minimal stand-ins for the Anthropic Messages API and Resend, for local runs
// and e2e tests without keys: ANTHROPIC_BASE_URL=http://127.0.0.1:4010 and
// RESEND_BASE_URL=http://127.0.0.1:4010. It answers the report, daily-reading
// and classifier tools with figures taken from the request itself, so the
// app's validators accept them. Sent emails are listed at GET /emails.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);
const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

function factsFrom(body) {
  const text = body.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join("\n"))).join("\n");
  const match = text.match(/<report_facts>\n([\s\S]*?)\n<\/report_facts>/);
  return match ? JSON.parse(match[1]) : null;
}

const kpi = (f, key) => f.kpis.find((k) => k.key === key) ?? { value: null, change: null };

function narrative(f) {
  const mentions = kpi(f, "mentions");
  const topic = f.top_topics[0];
  const worst = f.departments_by_nss[0];
  const hood = f.neighborhoods_most_complaints[0];
  return {
    headline: `${nf.format(mentions.value ?? 0)} menciones en el periodo; ${topic ? topic.topic : "sin tema dominante"} concentra la conversación`,
    executive_summary: `Se registraron ${nf.format(mentions.value ?? 0)} menciones con un sentimiento neto de ${nf.format(f.sentiment.nss)}. ${
      topic ? `El tema principal fue ${topic.topic} con ${topic.mentions} menciones.` : ""
    } ${worst ? `${worst.department} presenta el sentimiento neto más bajo (${nf.format(worst.nss)}).` : ""} Conviene priorizar la atención de quejas pendientes.`,
    findings: [
      { title: "Volumen del periodo", evidence: `${nf.format(mentions.value ?? 0)} menciones; negativas ${nf.format(f.sentiment.negative_pct)}%.`, impact: "Define la carga de atención de las dependencias." },
      ...(topic ? [{ title: `Tema principal: ${topic.topic}`, evidence: `${topic.mentions} menciones, ${nf.format(topic.negative_pct)}% negativas.`, impact: "Requiere seguimiento puntual." }] : []),
      ...(hood ? [{ title: `Quejas en ${hood.neighborhood}`, evidence: `${hood.complaints} quejas en la colonia.`, impact: "Focalizar cuadrillas en la zona." }] : []),
    ],
    risks: ["Acumulación de quejas sin respuesta.", "Cobertura negativa en medios locales."],
    opportunities: ["Comunicar las reparaciones concluidas.", "Responder con rapidez en redes."],
    recommendations: [
      { action: "Atender las quejas abiertas con mayor antigüedad.", owner: worst?.department ?? "Comunicación Social", deadline: "48 horas" },
      { action: "Publicar avances de obra y servicios.", owner: "Comunicación Social", deadline: "esta semana" },
    ],
    messaging: ["El Ayuntamiento atiende los reportes ciudadanos.", "Consulta los avances en los canales oficiales."],
  };
}

function reading(f) {
  const mentions = kpi(f, "mentions");
  const topic = f.top_topics[0];
  return {
    sentences: [
      `En las últimas 24 horas hubo ${nf.format(mentions.value ?? 0)} menciones, con sentimiento neto de ${nf.format(f.sentiment.nss)}.`,
      topic ? `El tema con más conversación fue ${topic.topic}.` : "No hay un tema dominante.",
    ],
  };
}

function classify(body) {
  const text = body.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
  const count = (text.match(/^\[\d+\]/gm) ?? []).length;
  const props = body.tools[0].input_schema.properties.clasificaciones.items.properties;
  const pick = (p) => (p.enum ? p.enum[0] : p.anyOf ? null : null);
  return {
    clasificaciones: Array.from({ length: count }, (_, i) => ({
      ref: i + 1,
      sentiment: "negativo",
      confidence: 0.9,
      emotion: "preocupación",
      topic: props.topic.enum[0],
      intent: "queja",
      priority: "media",
      department: props.department.anyOf ? props.department.anyOf[0].enum[0] : pick(props.department),
      neighborhood: props.neighborhood.anyOf ? props.neighborhood.anyOf[0].enum[0] : null,
    })),
  };
}

const emails = [];

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/emails" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(emails.map((e) => ({ ...e, attachments: (e.attachments ?? []).map((a) => ({ filename: a.filename, bytes: Buffer.from(a.content, "base64").length, pdf: Buffer.from(a.content, "base64").subarray(0, 5).toString() })) }))));
      return;
    }
    if (req.url === "/emails" && req.method === "POST") {
      emails.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `email_mock_${emails.length}` }));
      return;
    }
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(raw);
    const tool = body.tools?.[0]?.name;
    const facts = factsFrom(body);
    const input = tool === "redactar_reporte" ? narrative(facts) : tool === "redactar_lectura" ? reading(facts) : classify(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `msg_mock_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "tool_use", id: `toolu_mock_${Date.now()}`, name: tool, input }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    );
  });
}).listen(port, "127.0.0.1", () => console.log(`mock anthropic on http://127.0.0.1:${port}`));
