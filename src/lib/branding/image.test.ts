import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectLogoFormat, imageSize, LOGO_MAX_BYTES, logoProblem } from "./image.ts";

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment of 16 bytes, then SOF0 with height and width.
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const sof = 20;
  b.set([0xff, 0xc0, 0, 17, 8], sof);
  const v = new DataView(b.buffer);
  v.setUint16(sof + 5, height);
  v.setUint16(sof + 7, width);
  return b;
}

describe("logo checks", () => {
  it("detects the real format from the bytes", () => {
    assert.equal(detectLogoFormat(png(200, 80)), "png");
    assert.equal(detectLogoFormat(jpg(200, 80)), "jpg");
    assert.equal(detectLogoFormat(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  });

  it("reads PNG and JPEG dimensions", () => {
    assert.deepEqual(imageSize(png(640, 200), "png"), { width: 640, height: 200 });
    assert.deepEqual(imageSize(jpg(800, 300), "jpg"), { width: 800, height: 300 });
  });

  it("explains what is wrong", () => {
    assert.equal(logoProblem(png(640, 200)), null);
    assert.equal(logoProblem(new Uint8Array()), "Elige una imagen.");
    assert.match(logoProblem(new TextEncoder().encode("GIF89a................."))!, /PNG o JPG/);
    assert.match(logoProblem(png(20, 20))!, /pequeña/);
    assert.match(logoProblem(png(5000, 200))!, /grande/);
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png(640, 200));
    assert.match(logoProblem(big)!, /1 MB/);
  });
});
