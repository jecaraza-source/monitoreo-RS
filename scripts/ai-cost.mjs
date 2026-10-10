// Monthly AI cost from ai_usage: what the last N days cost (by purpose and
// model) projected to 30 days, plus the cost per classified mention.
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ai:cost [-- --days 7]
// Prices come from src/lib/ai/pricing.ts when each request was recorded; the
// Anthropic invoice is the source of truth.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const daysArg = process.argv.indexOf("--days");
const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 7;
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "count=exact" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return { rows: await res.json(), count: Number(res.headers.get("content-range")?.split("/")[1] ?? 0) };
}

const { rows } = await get(`ai_usage?select=purpose,model,requests,cost_usd,day&day=gte.${since}`);
const { count: classified } = await get(`classifications?select=id&created_at=gte.${since}&model=not.in.(seed,demo-seed)&limit=1`).catch(() => ({ count: 0 }));

const usd = (n) => `$${n.toFixed(2)}`;
const byPurpose = new Map();
for (const r of rows) {
  const k = `${r.purpose} · ${r.model}`;
  const prev = byPurpose.get(k) ?? { requests: 0, cost: 0 };
  byPurpose.set(k, { requests: prev.requests + r.requests, cost: prev.cost + Number(r.cost_usd) });
}
const total = [...byPurpose.values()].reduce((s, v) => s + v.cost, 0);
const factor = 30 / days;

console.log(`Uso de IA de los últimos ${days} días (desde ${since}) y proyección a 30 días\n`);
console.log("Propósito · modelo".padEnd(40), "Solicitudes".padStart(12), "Costo".padStart(10), "30 días".padStart(10));
for (const [k, v] of [...byPurpose].sort((a, b) => b[1].cost - a[1].cost)) {
  console.log(k.padEnd(40), String(v.requests).padStart(12), usd(v.cost).padStart(10), usd(v.cost * factor).padStart(10));
}
console.log("Total".padEnd(40), "".padStart(12), usd(total).padStart(10), usd(total * factor).padStart(10));
const classifyCost = [...byPurpose].filter(([k]) => k.startsWith("classify")).reduce((s, [, v]) => s + v.cost, 0);
if (classified > 0) console.log(`\nClasificación: ${classified} menciones, ${usd(classifyCost)} → $${(classifyCost / classified).toFixed(5)} por mención.`);
