// Secrets that could appear in an error message are masked before storing it.
const SECRET_PATTERNS = [/sk-ant-[\w-]+/g, /sb_secret_[\w-]+/g, /re_[A-Za-z0-9_]{16,}/g, /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, /(access_token|key|token)=[^&\s]+/gi];
export function scrub(text: string): string {
  return SECRET_PATTERNS.reduce((t, re) => t.replace(re, (m) => (m.includes("=") ? `${m.split("=")[0]}=***` : "***")), text).slice(0, 2000);
}
