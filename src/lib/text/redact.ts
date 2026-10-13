// Personal data in public posts shown on executive screens (the map's
// colonia panel): e-mails, phone numbers and house numbers are masked. The
// full text stays in the inbox, under its own permissions. Pure.

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// 8 or more digits, optionally separated by spaces, dots or dashes (phones, IDs).
const PHONE = /\+?\(?\d[\d\s().-]{6,}\d/g;
// "calle Hidalgo 123", "#45", "núm. 7", "no. 12 int 3": the number after a street word or sign.
const HOUSE = /((?:#|n[uú]m(?:ero)?\.?|no\.)\s*)\d+[a-z]?\b|(\b(?:calle|av(?:enida)?\.?|privada|cerrada|andador|callej[oó]n|boulevard|blvd\.?)\s+[\p{L}\s.]{2,40}?\s)\d+[a-z]?\b/giu;

export function redactPersonalData(text: string): string {
  return text
    .replace(EMAIL, "[correo]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[teléfono]" : m))
    .replace(HOUSE, (_m, sign: string | undefined, street: string | undefined) => `${sign ?? street ?? ""}[número]`);
}
