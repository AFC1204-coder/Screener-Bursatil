// tests/vocabularioProhibido.test.js — el principio 1 y la etapa única, sobre el fuente.
//
// El análisis de interfaz de 2026-08-14 encontró que el vocabulario retirado
// de la tabla ("Accion recomendada", el veredicto Vigilar/Auditar/Descartar,
// "Objetivo 2R/3R") seguía vivo en otras pantallas, y que la retirada
// anterior se había hecho DEJANDO DE RENDERIZAR componentes, no limpiando los
// strings — listos para volver con cualquier reconexión. Estos tests fijan la
// retirada sobre el código fuente, con el mismo patrón que
// tests/detallesInternosFuera.test.js.
//
// También fija el arreglo del RS en los textos de razón (frase "RS 87" junto
// a columna "91" en la misma fila) y el orden de la cola de revisión.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listInclusionReasons } from "@/lib/listRationale";
import { prepareReviewQueueRows } from "@/lib/decisionProfile";

const UI_ROOTS = ["app", "lib"];
const EXTENSIONS = [".js", ".jsx"];

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const UI_FILES = UI_ROOTS.flatMap((root) => sourceFiles(root));
const STRING_LITERAL = /(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`)/g;

function literalOffenders(pattern, { skipFiles = [] } = {}) {
  const offenders = [];
  for (const file of UI_FILES) {
    if (skipFiles.some((skip) => file.endsWith(skip) || file.includes(skip))) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      for (const literal of line.match(STRING_LITERAL) || []) {
        if (pattern.test(literal)) offenders.push(`${file}:${index + 1} ${literal.trim().slice(0, 90)}`);
      }
    });
  }
  return offenders;
}

describe("principio 1: la herramienta clasifica, no recomienda", () => {
  it("ninguna cadena de la interfaz dice qué hacer", () => {
    // Los casos literales del análisis: la cabecera de Sectores, los
    // objetivos de precio del plan retirado, y verbos de orden directa.
    const prohibited = [
      /Acci[oó]n recomendada/,
      /Objetivo\s*[23]R/,
      /Se[ñn]al de (compra|venta)/i,
      /"Comprar"|"Vender"/,
      // Nombre propio de metodología, retirado de la UI (los nombres se
      // tradujeron a descripciones: "Estructura de tendencia").
      /Trend [Tt]emplate/,
    ];
    const offenders = prohibited.flatMap((pattern) => literalOffenders(pattern));
    expect(offenders).toEqual([]);
  });

  it("la ficha no vuelve a montar el veredicto ni el plan de operación", () => {
    const client = readFileSync("app/stock/[symbol]/StockClient.jsx", "utf8");
    // El chip de cabecera es la ETAPA (clasificación descriptiva), no una
    // decisión del sistema.
    expect(client).not.toMatch(/DecisionCurveChip/);
    expect(client).not.toMatch(/label="Decisión"/);
    expect(client).not.toMatch(/stockVerdictBrake/);
    // El panel con pivot/stop/objetivos/calculadora de posición no se
    // renderiza. El cálculo (lib/tradePlan.js) puede seguir existiendo.
    expect(client).not.toMatch(/TradePlanPanel/);
    expect(client).not.toMatch(/Plan de operación<\/h2>/);
    expect(client).not.toMatch(/Dimensionamiento por riesgo/);
  });

  it("la cola de revisión no se reordena por el juicio del sistema", () => {
    // "Si se ordena por él y se destaca el primero, el producto está
    // señalando": la cola conserva el orden de llegada (el orden visible del
    // usuario). El módulo no debe recuperar el sort por prioridad.
    const source = readFileSync("lib/decisionProfile.js", "utf8");
    const body = source.slice(source.indexOf("export function prepareReviewQueueRows"));
    expect(body.slice(0, body.indexOf("}") + 1)).not.toMatch(/\.sort\(/);

    const rows = [{ symbol: "C" }, { symbol: "A" }, { symbol: "B" }];
    expect(prepareReviewQueueRows(rows).map((row) => row.symbol)).toEqual(["C", "A", "B"]);
  });
});

describe("la etapa se escribe con el diccionario único (lib/stageDisplay.js)", () => {
  it('ninguna superficie escribe "Stage" en un texto visible', () => {
    // La capa de DATOS conserva sus etiquetas históricas (se persisten en
    // filas y proyecciones públicas); stageDisplay las traduce al mostrar.
    // Lo que no puede pasar es que una superficie nueva escriba "Stage 2"
    // por su cuenta: era la cuarta ortografía de la misma clasificación
    // ("Etapa 2" / "Stage 2" / "E2" / "Base / transicion").
    const DATA_LAYER = [
      "lib/weeklyStage.js",        // generador del label persistido
      "lib/screenerPipeline.js",   // clasificador diario persistido
      "lib/stageDisplay.js",       // el propio diccionario (mapea el legado)
      "app/api/",                  // proyecciones de API: datos, no pantalla
    ];
    const offenders = literalOffenders(/\bStage\b/, { skipFiles: DATA_LAYER });
    expect(offenders).toEqual([]);
  });

  it('no queda la abreviatura "E2"/"E4" como texto de pantalla fuera del eje de la constelación', () => {
    // Excepciones: los ticks E1–E4 del eje SVG de RegimeConstellation (no
    // caben las palabras y su aria-label ya dice "Curva de Etapa"), y
    // lib/screenerDomains/decision.jsx, donde "E2" es el token del prop
    // `emphasis` (acaba en data-emphasis=, nunca como texto en pantalla).
    const offenders = literalOffenders(/^["'`]E[124]["'`]$|Sectores E[24]|Ofensivo E2|Defensivo E2/, {
      skipFiles: ["app/market-health/RegimeConstellation.jsx", "lib/screenerDomains/decision.jsx"],
    });
    expect(offenders).toEqual([]);
  });
});

describe("el RS de los textos es el canónico (lib/rsCanonical.js)", () => {
  // El caso reproducido del análisis: la frase de razón decía "RS 87"
  // (percentil del lote, rsGlobalPct) mientras la columna de la misma fila
  // decía "91" (ranking semanal canónico) — o "Sin dato" junto a "RS 82".
  const divergentRow = {
    symbol: "CON",
    objectiveScore: 86,
    rsGlobalPct: 87,
    weeklyRsAvailable: true,
    weeklyRsRating: 91,
    perf3m: 36.1,
  };

  it("la frase de razón escribe el RS semanal, no el percentil del lote", () => {
    const reasons = listInclusionReasons(divergentRow, "leaders", 6).join(" · ");
    expect(reasons).toContain("RS 91");
    expect(reasons).not.toContain("RS 87");
  });

  it("sin ranking semanal, la frase no menciona RS (la columna ya enseña la ausencia)", () => {
    const unranked = { ...divergentRow, weeklyRsAvailable: false, weeklyRsRating: null };
    const reasons = listInclusionReasons(unranked, "leaders", 6).join(" · ");
    expect(reasons).not.toMatch(/\bRS \d/);
  });

  it("el módulo de frases no vuelve a leer rsGlobalPct para el texto", () => {
    // rsGlobalPct sigue siendo legítimo como insumo del SCORING
    // (rowPassesListContract); lo que no puede es pintarse bajo la etiqueta
    // "RS" (lib/rsCanonical.js). Se fija la llamada concreta.
    const source = readFileSync("lib/listRationale.js", "utf8");
    expect(source).not.toMatch(/pushMetric\(reasons, "RS", metric\(row, "rsGlobalPct"\)\)/);
  });
});
