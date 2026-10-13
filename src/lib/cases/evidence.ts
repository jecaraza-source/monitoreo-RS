// Evidence files of a case: pure checks shared by the server action and the
// form. The real format comes from the file's first bytes (never from its
// name or the browser's type), and photos lose their metadata (EXIF with GPS
// position, camera, author; text chunks) before they are stored.

/** Same limit as the "case-evidence" bucket and public.case_evidence. */
export const EVIDENCE_MAX_BYTES = 3 * 1024 * 1024;
/** Per update; Server Action bodies are capped at 4 MB (next.config.ts). */
export const EVIDENCE_MAX_FILES = 4;
export const EVIDENCE_MAX_TOTAL_BYTES = 3.5 * 1024 * 1024;

export type EvidenceFormat = "jpg" | "png" | "pdf";
export const EVIDENCE_MIME: Record<EvidenceFormat, string> = { jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" };
export const EVIDENCE_ACCEPT = "image/jpeg,image/png,application/pdf";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function detectEvidenceFormat(bytes: Uint8Array): EvidenceFormat | null {
  if (bytes.length >= 33 && PNG.every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && PDF.every((b, i) => bytes[i] === b)) return "pdf";
  return null;
}

/** Why a file is rejected, in Spanish, or null when it is fine. */
export function evidenceProblem(bytes: Uint8Array): string | null {
  if (!bytes.length) return "El archivo está vacío.";
  if (bytes.length > EVIDENCE_MAX_BYTES) return "Cada archivo puede pesar hasta 3 MB.";
  if (!detectEvidenceFormat(bytes)) return "Sólo se aceptan fotos JPG o PNG y documentos PDF.";
  return null;
}

/** Problems of a whole selection (count and total size), or null. */
export function selectionProblem(sizes: number[]): string | null {
  if (sizes.length > EVIDENCE_MAX_FILES) return `Máximo ${EVIDENCE_MAX_FILES} archivos por avance.`;
  if (sizes.some((s) => s > EVIDENCE_MAX_BYTES)) return "Cada archivo puede pesar hasta 3 MB.";
  if (sizes.reduce((a, b) => a + b, 0) > EVIDENCE_MAX_TOTAL_BYTES) return "Los archivos juntos pueden pesar hasta 3.5 MB por avance.";
  return null;
}

/**
 * JPEG without metadata segments: drops APP1 (EXIF, XMP: GPS position,
 * camera, dates), APP13 (IPTC: author, captions) and comments. Keeps the
 * image data and the segments needed to display it (JFIF, ICC, Adobe).
 * Returns null if the segment structure cannot be read.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // Start of scan: the rest is image data.
    if (marker === 0xda) {
      out.push(bytes.subarray(i));
      return concat(out);
    }
    // Standalone markers have no length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      out.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = view.getUint16(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) return null;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return null;
}

const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/** PNG without text, EXIF and time chunks. Null if the chunks cannot be read. */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    if (!PNG_DROP.has(type)) out.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(out);
  }
  return null;
}

/** The bytes to store: photos without metadata; PDFs as they are. */
export function minimizeEvidence(bytes: Uint8Array, format: EvidenceFormat): Uint8Array | null {
  if (format === "jpg") return stripJpegMetadata(bytes);
  if (format === "png") return stripPngMetadata(bytes);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
