// Minimal stand-ins for the Anthropic Messages API and Resend, for local runs
// and e2e tests without keys: ANTHROPIC_BASE_URL=http://127.0.0.1:4010 and
// RESEND_BASE_URL=http://127.0.0.1:4010. It answers the report, daily-reading
// and classifier tools with figures taken from the request itself, so the
// app's validators accept them. Sent emails are listed at GET /emails.
// WhatsApp Cloud API: WHATSAPP_API_URL=http://127.0.0.1:4010/whatsapp; sent
// messages are listed at GET /whatsapp/sent.
//
// Fault injection (tests only), per target "anthropic" | "resend" | "whatsapp":
//   POST /__mock/faults {"anthropic":{"status":529,"times":2},"resend":{"delayMs":30000}}
//     makes the next `times` calls answer `status` (or wait `delayMs` first);
//   POST /__mock/faults {"model":"claude-desconocido"} answers with another model id
//     (to test cost for a model missing from the price table);
//   DELETE /__mock/faults clears everything; GET /__mock/calls counts calls per target.
//   GET /__mock/classified: how many times each mention text was sent to classify.
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
  const overdue = kpi(f, "overdue_at_cut");
  const topic = f.top_topics[0];
  const hood = f.neighborhoods_most_complaints[0];
  const refs = new Set((f.references ?? []).map((r) => r.id));
  const has = (id) => (refs.has(id) ? [id] : []);
  const pending = (f.pending_cases ?? [])[0];
  const owner = (f.allowed_owners ?? []).includes("Comunicación Social") ? "Comunicación Social" : (f.allowed_owners ?? ["Comunicación Social"])[0];
  return {
    headline: `${nf.format(mentions.value ?? 0)} menciones en el periodo; ${topic ? topic.topic : "sin tema dominante"} concentra la conversación`,
    executive_summary: `Se registraron ${nf.format(mentions.value ?? 0)} menciones con un sentimiento neto de ${nf.format(f.sentiment.nss)}. ${
      topic ? `El tema principal fue ${topic.topic} con ${topic.mentions} menciones.` : ""
    } Conviene priorizar los casos vencidos.`,
    what_changed: [
      { text: `${nf.format(mentions.value ?? 0)} menciones; negativas ${nf.format(f.sentiment.negative_pct)}%.`, refs: [...has("kpi:mentions"), ...has("kpi:negative_pct")] },
      ...(topic ? [{ text: `Tema principal: ${topic.topic}, ${topic.mentions} menciones.`, refs: has(`tema:${topic.topic}`).length ? has(`tema:${topic.topic}`) : has("kpi:mentions") }] : []),
    ],
    decisions: hood ? [{ text: `Priorizar cuadrillas en ${hood.neighborhood}.`, refs: has(`colonia:${hood.neighborhood}`) }] : [],
    actions: [
      { owner, action: "Publicar avances de obra y servicios.", deadline: "esta semana", refs: has("kpi:mentions") },
      ...(pending ? [{ owner: pending.department && (f.allowed_owners ?? []).includes(pending.department) ? pending.department : owner, action: `Atender el caso ${pending.folio}.`, deadline: "48 horas", refs: [pending.ref] }] : []),
    ],
    pending: [{ text: `Casos vencidos al corte: ${nf.format(overdue.value ?? 0)}.`, refs: has("kpi:overdue_at_cut") }],
    risks: ["Acumulación de quejas sin respuesta."],
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
  // Which mention texts were sent to the model, and how many times (concurrency checks).
  for (const [, mention] of text.matchAll(/<mencion>\n([\s\S]*?)\n<\/mencion>/g)) classified.set(mention, (classified.get(mention) ?? 0) + 1);
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
      severity: "media",
      incident_type: "servicio_publico",
      needs_attention: true,
      department: props.department.anyOf ? props.department.anyOf[0].enum[0] : pick(props.department),
      neighborhood: props.neighborhood.anyOf ? props.neighborhood.anyOf[0].enum[0] : null,
    })),
  };
}

const emails = [];
const sentByKey = new Map();
const whatsapp = [];
let faults = {};
const calls = { anthropic: 0, resend: 0, whatsapp: 0 };
const classified = new Map();

/** Applies an injected fault for `target`; true when the response was already sent. */
async function injected(target, res) {
  calls[target]++;
  const f = faults[target];
  if (!f) return false;
  if (f.delayMs) await new Promise((r) => setTimeout(r, f.delayMs));
  if (f.status && (f.times ?? 1) > 0) {
    f.times = (f.times ?? 1) - 1;
    res.writeHead(f.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "mock_fault", message: `falla simulada ${f.status}` } }));
    return true;
  }
  return false;
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => handle(req, res, raw).catch((error) => {
    // A malformed request must not take the mock (and the rest of the suite) down.
    console.error("[mock]", error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "mock_error", message: String(error) } }));
  }));
}).listen(port, "127.0.0.1", () => console.log(`mock anthropic on http://127.0.0.1:${port}`));

async function handle(req, res, raw) {
  {
    if (req.url === "/__mock/faults") {
      faults = req.method === "POST" ? JSON.parse(raw || "{}") : {};
      res.writeHead(204).end();
      return;
    }
    if (req.url === "/__mock/classified" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Object.fromEntries(classified)));
      return;
    }
    if (req.url === "/__mock/calls" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(calls));
      return;
    }
    if (req.url === "/emails" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(emails.map((e) => ({ ...e, attachments: (e.attachments ?? []).map((a) => ({ filename: a.filename, bytes: Buffer.from(a.content, "base64").length, pdf: Buffer.from(a.content, "base64").subarray(0, 5).toString() })) }))));
      return;
    }
    if (req.url === "/emails" && req.method === "POST") {
      if (await injected("resend", res)) return;
      // Like Resend: the same Idempotency-Key returns the first message, without sending again.
      const key = req.headers["idempotency-key"];
      if (key && sentByKey.has(key)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: sentByKey.get(key) }));
        return;
      }
      emails.push({ ...JSON.parse(raw), idempotencyKey: key ?? null });
      const id = `email_mock_${emails.length}`;
      if (key) sentByKey.set(key, id);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id }));
      return;
    }
    // Radar Social verification services (RADAR_*_URL point here in tests).
    // A domain or query containing "falso" is flagged / has results; anything else is clean.
    if (req.url.startsWith("/radar/")) {
      const url = new URL(req.url, "http://mock");
      const hit = (text) => /falso/i.test(text ?? "");
      const json = (body) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/radar/urlhaus/host/") {
        const host = new URLSearchParams(raw).get("host");
        return json(hit(host) ? { query_status: "ok", urls_count: 1, urls: [{ url: `http://${host}/pago`, url_status: "online", threat: "phishing", date_added: "2026-10-20 10:00:00 UTC" }] } : { query_status: "no_results" });
      }
      if (url.pathname === "/radar/phishstats/phishing") return json(hit(url.searchParams.get("_where")) ? [{ url: "https://pago-falso.mx/login", title: "Apoyos", date: "2026-10-21T00:00:00Z", score: 9 }] : []);
      if (url.pathname === "/radar/safebrowsing/threatMatches:find") return json(hit(raw) ? { matches: [{ threatType: "SOCIAL_ENGINEERING", threat: { url: "x" } }] } : {});
      if (url.pathname === "/radar/crtsh/") {
        const term = (url.searchParams.get("q") ?? "").replaceAll("%", "");
        return json([
          { name_value: `${term}.gob.mx\nwww.${term}.gob.mx`, not_before: "2026-01-01T00:00:00", issuer_name: "O=Let's Encrypt" },
          { name_value: `apoyos-${term}-falso.mx`, not_before: "2026-10-20T00:00:00", issuer_name: "O=Let's Encrypt" },
        ]);
      }
      if (url.pathname === "/radar/factcheck/claims:search") {
        return json(hit(url.searchParams.get("query")) ? { claims: [{ text: "Se cancela el apoyo para adultos mayores", claimant: "Redes sociales", claimReview: [{ publisher: { name: "Verificador de prueba" }, url: "https://verificador.test/1", textualRating: "Falso", reviewDate: "2026-10-22T00:00:00Z" }] }] } : {});
      }
      if (url.pathname === "/radar/gdelt/doc/doc") {
        return json({ articles: [{ url: "https://medio.test/nota-1", title: "Desmienten rumor sobre el agua", domain: "medio.test", seendate: "20261026T120000Z", sourcecountry: "Mexico" }] });
      }
      res.writeHead(404).end();
      return;
    }
    if (req.url === "/whatsapp/sent" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(whatsapp));
      return;
    }
    if (req.method === "POST" && /^\/whatsapp\/[^/]+\/messages$/.test(req.url)) {
      if (await injected("whatsapp", res)) return;
      const id = `wamid.mock-${Date.now()}-${whatsapp.length + 1}`;
      whatsapp.push({ id, ...JSON.parse(raw) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: JSON.parse(raw).to }], messages: [{ id }] }));
      return;
    }
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    if (await injected("anthropic", res)) return;
    const body = JSON.parse(raw);
    if (faults.model) body.model = faults.model;
    if (body.stream) return assistant(body, res);
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
  }
}

// ---------------------------------------------------------------------------
// Assistant (streaming): first turn calls a tool picked from the question,
// second turn answers from the tool result.
// ---------------------------------------------------------------------------
function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  res.end();
}

function pickTool(question) {
  const q = question.toLowerCase();
  if (q.includes("colonia")) return ["stats_by_neighborhood", q.includes("agua") ? { tema: "agua potable" } : {}];
  if (q.includes("dependencia")) return ["stats_by_department", {}];
  if (q.includes("ejemplo") || q.includes("menciones")) return ["search_mentions", { sentimiento: "negativo", limite: 3 }];
  if (q.includes("tema")) return ["top_topics", {}];
  return ["get_kpis", {}];
}

function answerFrom(name, result) {
  if (!result) return "No encontré datos para esa consulta.";
  if (name === "stats_by_neighborhood") {
    const top = result.colonias.slice(0, 3);
    return top.length
      ? `Del ${result.periodo.desde} al ${result.periodo.hasta}, las colonias con más quejas fueron:\n\n${top.map((c) => `- **${c.colonia}**: ${c.quejas} quejas de ${c.menciones} menciones`).join("\n")}`
      : "No hay quejas con colonia en ese periodo.";
  }
  if (name === "stats_by_department") return `Dependencias consultadas: ${result.dependencias.map((d) => `${d.dependencia} (NSS ${d.nss}, ${d.vencidos} vencidos)`).join("; ")}.`;
  if (name === "search_mentions") return `Encontré **${result.encontradas}** menciones. ${result.menciones.map((m) => `"${m.texto.slice(0, 80)}"`).join(" ")}`;
  if (name === "top_topics") return `Tema principal: **${result.temas[0]?.tema ?? "ninguno"}**.`;
  return `Hubo **${result.actual.menciones}** menciones con NSS de ${result.actual.nss}.`;
}

function assistant(body, res) {
  const last = body.messages[body.messages.length - 1];
  const usage = { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const start = ["message_start", { message: { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } }];
  const toolResult = Array.isArray(last.content) && last.content.find((c) => c.type === "tool_result");
  if (toolResult || !body.tools) {
    let text = "No tengo datos para responder.";
    if (toolResult) {
      const prev = body.messages[body.messages.length - 2].content.find((c) => c.type === "tool_use");
      text = toolResult.is_error ? `No pude consultar: ${toolResult.content}` : answerFrom(prev.name, JSON.parse(toolResult.content));
    }
    const chunks = text.match(/.{1,40}/gs) ?? [text];
    return sse(res, [
      start,
      ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
      ...chunks.map((t) => ["content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }]),
      ["content_block_stop", { index: 0 }],
      ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 120 } }],
      ["message_stop", {}],
    ]);
  }
  const question = typeof last.content === "string" ? last.content : "";
  const [name, input] = pickTool(question);
  return sse(res, [
    start,
    ["content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_mock_${Date.now()}`, name, input: {} } }],
    ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }],
    ["content_block_stop", { index: 0 }],
    ["message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 40 } }],
    ["message_stop", {}],
  ]);
}
