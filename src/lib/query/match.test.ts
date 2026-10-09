import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileQuery, matches, parseQuery, QuerySyntaxError, validateQuery } from "./match.ts";

const yes = (expr: string, text: string) => assert.equal(matches(expr, text), true, `${expr} ⟵ ${text}`);
const no = (expr: string, text: string) => assert.equal(matches(expr, text), false, `${expr} ⟵ ${text}`);

describe("terms and normalization", () => {
  it("ignores case and accents in both query and text", () => {
    yes("atencion", "Gracias por la ATENCIÓN tan rápida");
    yes("Atención", "atencion ciudadana");
    yes("PEÑA", "la peña del barrio");
    yes("pena", "La Peña del barrio");
  });

  it("matches whole words only", () => {
    no("agua", "Compré un aguacate");
    no("obra", "Las obras siguen paradas");
    yes("obra", "La obra sigue parada");
  });

  it("ignores punctuation and splits hashtags/mentions into plain words", () => {
    yes("bache", "¡¡Otro bache!!, en la calle 5.");
    yes("sanandres", "Vecinos de #SanAndrés protestan");
    yes("ayuntamiento", "@Ayuntamiento, ¿cuándo vienen?");
  });

  it("joins adjacent terms with an implicit AND", () => {
    yes("fuga agua", "Hay una fuga de agua en la esquina");
    no("fuga agua", "Hay una fuga de gas en la esquina");
  });
});

describe("phrases", () => {
  it("requires the words together and in order", () => {
    yes('"presidente municipal"', "El Presidente Municipal inauguró la obra");
    no('"presidente municipal"', "El municipal presidente del club");
    no('"presidente municipal"', "El presidente del comité municipal");
  });

  it("treats a hyphenated or punctuated term as a phrase", () => {
    yes("san-andrés", "Vivo en San Andrés desde niño");
    no("san-andrés", "San Miguel y Andrés");
  });
});

describe("wildcard *", () => {
  it("expands inside a single word", () => {
    yes("educa*", "Programa de educación para adultos");
    yes("educa*", "Hay que educar a los niños");
    no("educa*", "Reeducación vial");
    yes("*educa*", "Reeducación vial");
    yes("pav*ción", "Trabajos de pavimentación");
  });

  it("works inside phrases", () => {
    yes('"obra* public*"', "Secretaría de Obras Públicas");
    no('"obra* public*"', "Obras en la vía pública"); // not contiguous
  });
});

describe("operators", () => {
  it("supports OR and AND", () => {
    yes("bache OR socavon", "Se abrió un socavón");
    yes("agua AND fuga", "Fuga de agua potable");
    no("agua AND fuga", "Agua potable");
  });

  it("gives NOT > AND > OR precedence", () => {
    // a OR b AND c  ==  a OR (b AND c)
    yes("robo OR asalto AND noche", "Hubo un robo esta mañana");
    no("robo OR asalto AND noche", "Hubo un asalto esta mañana");
    // NOT a AND b == (NOT a) AND b
    yes("NOT pipa AND agua", "No hay agua");
    no("NOT pipa AND agua", "La pipa de agua no llegó");
  });

  it("respects parentheses", () => {
    yes("(robo OR asalto) AND noche", "Un asalto en la noche");
    no("(robo OR asalto) AND noche", "Un asalto en la mañana");
  });

  it("treats lowercase and/or/not as ordinary words", () => {
    yes("not", "This is not Spanish");
    no("agua or luz", "Sin agua"); // 3 terms with implicit AND
  });
});

describe("exclusions", () => {
  const water = 'agua AND (fuga OR "sin agua" OR desabasto) AND NOT (pipa* OR garrafon*)';

  it("keeps matches that avoid the excluded terms", () => {
    yes(water, "Hay una fuga de agua en San Miguel");
    yes(water, "Llevamos 3 días sin agua");
  });

  it("drops matches that mention an excluded term", () => {
    no(water, "Fuga de agua: la pipa no llegó");
    no(water, "Desabasto de agua, compramos garrafones");
  });

  it("excludes a phrase without excluding its words alone", () => {
    const q = 'transporte NOT "transporte escolar"';
    yes(q, "El transporte público está saturado");
    no(q, "Mejoras al transporte escolar");
  });
});

describe("homonyms", () => {
  // The municipality is San Andrés; other places share the name.
  const municipality =
    '("san andres" OR sanandres) AND NOT ("san andres tuxtla" OR "san andres cholula" OR "san andres larrainzar")';

  it("matches the municipality", () => {
    yes(municipality, "Bacheo en el centro de San Andrés");
    yes(municipality, "#SanAndrés amaneció sin agua");
  });

  it("does not match other places with the same name", () => {
    no(municipality, "Feria del tabaco en San Andrés Tuxtla, Veracruz");
    no(municipality, "Inauguran museo en San Andrés Cholula");
  });

  // A public official shares their name with a football player.
  const official =
    '"juan perez" AND (presidente OR alcalde OR ayuntamiento OR municipio) AND NOT (futbol OR gol* OR liga OR delantero)';

  it("disambiguates a person by context", () => {
    yes(official, "El presidente municipal Juan Pérez anunció el programa de becas");
    yes(official, "Juan Pérez, alcalde, visitó las obras");
    no(official, "Juan Pérez anotó dos goles y la liga lo premió");
    no(official, "Juan Pérez, delantero del equipo del municipio, fue convocado");
    no(official, "Juan Pérez compró pan"); // no institutional context
  });
});

describe("syntax errors", () => {
  const error = (expr: string) => {
    const result = validateQuery(expr);
    assert.equal(result.ok, false, expr);
    return result as { ok: false; message: string; position: number };
  };

  it("reports problems with a position", () => {
    assert.match(error("").message, /vacía/);
    assert.match(error('"san andres').message, /comillas/);
    assert.match(error("(agua OR luz").message, /paréntesis/);
    assert.match(error("agua)").message, /paréntesis/);
    assert.match(error("agua AND").message, /operador/);
    assert.match(error("OR agua").message, /término/);
    assert.match(error("()").message, /vacíos/);
    assert.match(error("*").message, /comodín/);
    const dangling = error("agua AND (luz OR)");
    assert.match(dangling.message, /después de OR/);
    assert.equal(dangling.position, 16); // the ")" right after OR
  });

  it("throws QuerySyntaxError from matches/compile", () => {
    assert.throws(() => matches("(agua", "agua"), QuerySyntaxError);
    assert.throws(() => compileQuery("agua OR"), QuerySyntaxError);
  });

  it("accepts valid expressions", () => {
    assert.deepEqual(validateQuery('("a b" OR c*) AND NOT d'), { ok: true });
    assert.equal(parseQuery("a b").type, "and");
  });
});

describe("compileQuery", () => {
  it("reuses one parsed query over many texts", () => {
    const test = compileQuery("bache* OR socavon");
    const texts = ["Baches en la avenida", "Un socavón enorme", "Fuga de agua"];
    assert.deepEqual(texts.map(test), [true, true, false]);
  });
});
