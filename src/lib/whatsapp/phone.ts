// Phone numbers as WhatsApp Cloud API wants them: E.164 digits without "+".
// Pure, shared by the settings form, the Server Actions and the webhook.

/**
 * Normalizes what a person types ("+52 56 2133 9211", "(56) 2133-9211") or what
 * Meta sends ("5215621339211") to "525621339211". Ten digits are a Mexican
 * number; Mexican mobiles may arrive with the legacy "1" after 52, which is
 * dropped so both forms match one contact. Null when it cannot be a number.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[\s().-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 10 && !trimmed.startsWith("+")) digits = `52${digits}`;
  if (digits.length === 13 && digits.startsWith("521")) digits = `52${digits.slice(3)}`;
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : null;
}

/** "525621339211" → "+52 56 2133 9211"; other countries as "+<digits>". */
export function formatPhone(digits: string): string {
  const mx = digits.match(/^52(\d{2})(\d{4})(\d{4})$/);
  return mx ? `+52 ${mx[1]} ${mx[2]} ${mx[3]}` : `+${digits}`;
}

/** "+52 56 •••• 9211": enough to recognize a number without exposing it in logs or lists. */
export function maskPhone(digits: string): string {
  const mx = digits.match(/^52(\d{2})\d{4}(\d{4})$/);
  return mx ? `+52 ${mx[1]} •••• ${mx[2]}` : `+${digits.slice(0, 3)}•••${digits.slice(-4)}`;
}
