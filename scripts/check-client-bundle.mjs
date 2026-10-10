// Fails if a server secret reaches what the browser can download: the client
// JS chunks (.next/static) and the prerendered HTML/RSC payloads. In CI the
// build runs with canary values for every secret, so a leaked env var shows up
// verbatim; known key formats are matched as a second net.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "WHATSAPP_TOKEN",
  "META_APP_SECRET",
  "YOUTUBE_API_KEY",
  "ERROR_WEBHOOK_URL",
];
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic key"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/"role"\s*:\s*"service_role"/, "service_role JWT payload"],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/, "Resend key"],
];

const roots = [".next/static", ".next/server/app"];
const files = (dir) => {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  } catch {
    return [];
  }
};
const targets = [
  ...files(roots[0]).filter((f) => /\.(js|css|json|map)$/.test(f)),
  // Only what is sent to the browser from the server output: prerendered pages and RSC payloads.
  ...files(roots[1]).filter((f) => /\.(html|rsc|body)$/.test(f)),
];
if (!targets.length) {
  console.error("No hay build en .next: corre `npm run build` primero.");
  process.exit(2);
}

const canaries = SECRET_ENV.map((name) => [name, process.env[name]]).filter(([, v]) => v && v.length >= 8);
const findings = [];
for (const file of targets) {
  const text = readFileSync(file, "utf8");
  for (const [name, value] of canaries) if (text.includes(value)) findings.push(`${file}: contiene el valor de ${name}`);
  for (const [re, label] of PATTERNS) if (re.test(text)) findings.push(`${file}: parece contener una ${label}`);
}

if (findings.length) {
  console.error(`Secretos en el bundle del cliente:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`OK: ${targets.length} archivos revisados, ${canaries.length} secretos canario sin fugas.`);
