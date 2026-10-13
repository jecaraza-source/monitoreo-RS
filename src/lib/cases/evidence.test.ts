import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectEvidenceFormat,
  EVIDENCE_MAX_BYTES,
  evidenceProblem,
  minimizeEvidence,
  selectionProblem,
  stripJpegMetadata,
  stripPngMetadata,
} from "./evidence.ts";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));
const segment = (marker: number, payload: string) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...Buffer.from(payload, "latin1")];
const has = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle, "latin1"));

// A JPEG with JFIF, EXIF (with a fictitious GPS position), a comment, then the image data.
const jpeg = bytes(
  [0xff, 0xd8],
  segment(0xe0, "JFIF\0\x01\x01\0\0\x01\0\x01\0\0"),
  segment(0xe1, "Exif\0\0GPS 19.4326N 99.1332W"),
  segment(0xfe, "Foto de Juan Perez"),
  segment(0xdb, "quantization"),
  [0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xaa, 0xbb, 0xff, 0xd9],
);

const chunk = (type: string, data: string) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return [...len, ...Buffer.from(type + data, "latin1"), 0, 0, 0, 0];
};
const png = bytes(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  chunk("IHDR", "\0\0\0\x10\0\0\0\x10\x08\x02\0\0\0"),
  chunk("tEXt", "Author\0Juan Perez"),
  chunk("eXIf", "GPS 19.4326N"),
  chunk("IDAT", "pixels"),
  chunk("IEND", ""),
);

describe("evidence files", () => {
  it("detects the real format from the bytes, not the name", () => {
    assert.equal(detectEvidenceFormat(jpeg), "jpg");
    assert.equal(detectEvidenceFormat(png), "png");
    assert.equal(detectEvidenceFormat(bytes("%PDF-1.7\n%âãÏÓ")), "pdf");
    assert.equal(detectEvidenceFormat(bytes("<html><script>alert(1)</script></html>")), null);
    assert.equal(detectEvidenceFormat(bytes("GIF89a......")), null);
  });

  it("rejects empty, too big or other files", () => {
    assert.equal(evidenceProblem(new Uint8Array()), "El archivo está vacío.");
    assert.equal(evidenceProblem(bytes("MZ\x90\0 executable")), "Sólo se aceptan fotos JPG o PNG y documentos PDF.");
    const big = new Uint8Array(EVIDENCE_MAX_BYTES + 1);
    big.set(jpeg.subarray(0, 4));
    assert.equal(evidenceProblem(big), "Cada archivo puede pesar hasta 3 MB.");
    assert.equal(evidenceProblem(jpeg), null);
  });

  it("limits the selection per update", () => {
    assert.equal(selectionProblem([1, 1, 1, 1, 1]), "Máximo 4 archivos por avance.");
    assert.equal(selectionProblem([2_000_000, 2_000_000]), "Los archivos juntos pueden pesar hasta 3.5 MB por avance.");
    assert.equal(selectionProblem([1_000_000, 1_000_000]), null);
  });

  it("removes EXIF, GPS and comments from photos, keeping the image", () => {
    const clean = stripJpegMetadata(jpeg)!;
    assert.ok(clean);
    assert.equal(has(clean, "GPS"), false);
    assert.equal(has(clean, "Juan Perez"), false);
    assert.equal(has(clean, "JFIF"), true, "keeps what is needed to display it");
    assert.equal(has(clean, "quantization"), true);
    assert.deepEqual([...clean.subarray(-8)], [3, 4, 5, 6, 0xaa, 0xbb, 0xff, 0xd9], "the image data is intact");
    assert.equal(detectEvidenceFormat(clean), "jpg");
  });

  it("removes text and EXIF chunks from PNG", () => {
    const clean = stripPngMetadata(png)!;
    assert.equal(has(clean, "Juan Perez"), false);
    assert.equal(has(clean, "GPS"), false);
    assert.equal(has(clean, "IDATpixels"), true);
    assert.equal(has(clean, "IEND"), true);
  });

  it("refuses files whose structure cannot be read", () => {
    assert.equal(stripJpegMetadata(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2])), null);
    assert.equal(stripPngMetadata(png.subarray(0, 40)), null);
    const pdf = bytes("%PDF-1.7 contenido");
    assert.equal(minimizeEvidence(pdf, "pdf"), pdf, "PDFs are stored as they are");
  });
});
