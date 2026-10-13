// Pure checks for the client logo: the real format comes from the file's
// first bytes (never from its name or the browser's type), and PNG/JPEG
// dimensions are read from their headers.

export const LOGO_MAX_BYTES = 1024 * 1024;
export type LogoFormat = "png" | "jpg";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectLogoFormat(bytes: Uint8Array): LogoFormat | null {
  if (bytes.length >= 24 && PNG.every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/** Width and height, or null if the header cannot be read. */
export function imageSize(bytes: Uint8Array, format: LogoFormat): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "png") {
    // IHDR is always the first chunk: width and height at bytes 16 and 20.
    if (bytes.length < 24) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the segments up to a start-of-frame marker.
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = view.getUint16(i + 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    i += 2 + length;
  }
  return null;
}

/** Why a logo is rejected, in Spanish, or null when it is fine. */
export function logoProblem(bytes: Uint8Array): string | null {
  if (!bytes.length) return "Elige una imagen.";
  if (bytes.length > LOGO_MAX_BYTES) return "La imagen pesa más de 1 MB.";
  const format = detectLogoFormat(bytes);
  if (!format) return "Usa una imagen PNG o JPG.";
  const size = imageSize(bytes, format);
  if (!size || size.width < 64 || size.height < 32) return "La imagen es muy pequeña (mínimo 64 × 32 px).";
  if (size.width > 4000 || size.height > 4000) return "La imagen es muy grande (máximo 4000 px por lado).";
  return null;
}
