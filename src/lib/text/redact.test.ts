import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactPersonalData } from "./redact.ts";

describe("personal data on executive screens", () => {
  it("masks e-mails and phone numbers", () => {
    assert.equal(redactPersonalData("Escríbanme a juan.perez@correo.test o al 55 1234 5678"), "Escríbanme a [correo] o al [teléfono]");
    assert.equal(redactPersonalData("Tel. +52 (55) 1234-5678"), "Tel. [teléfono]");
  });

  it("masks house numbers, keeps the street", () => {
    assert.equal(redactPersonalData("Fuga en calle Hidalgo 123 desde ayer"), "Fuga en calle Hidalgo [número] desde ayer");
    assert.equal(redactPersonalData("Vivo en la casa #45"), "Vivo en la casa #[número]");
    assert.equal(redactPersonalData("Av. Juárez 12 esquina Morelos"), "Av. Juárez [número] esquina Morelos");
  });

  it("leaves ordinary numbers alone", () => {
    assert.equal(redactPersonalData("Llevamos 3 días sin agua y 200 familias afectadas"), "Llevamos 3 días sin agua y 200 familias afectadas");
  });
});
