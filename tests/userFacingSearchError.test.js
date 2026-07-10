// Tests del mapeo user-facing de los guards de dataQuality y del placeholder
// del panel de chart de review.
//
// Contrato: los strings internos que lanzan los guards (assertDecisionGrade en
// lib/chartDataQuality.js → "Serie estimada excluida de <contexto>", y el
// guard de app/review/page.jsx:309 → "Historico estimado/no disponible") son
// deliberadamente técnicos (logs/debugging/tests), pero NO deben llegar crudos
// al usuario final del screener. userFacingSearchError los mapea a mensajes
// user-facing en español.
//
// Estos tests cubren:
//  - Punto 5 (screener): symbol inexistente → searchError user-facing.
//  - Punto 4 (review): chart estimado en review → el usuario ve el mensaje,
//    no un vacío silencioso (reviewChartPlaceholder prioriza error > vacío)
//    ni el string interno de debug sin mapear (mapper no filtra "estimado").

import { describe, expect, it } from "vitest";
import { reviewChartPlaceholder, userFacingSearchError } from "@/lib/screenerFormat";

describe("userFacingSearchError · mapeo del guard estimated (screener)", () => {
  it("mapea 'Serie estimada excluida de research row' a mensaje user-facing", () => {
    // El contexto que usa lib/researchRow.js vía assertDecisionGrade.
    expect(userFacingSearchError("Serie estimada excluida de research row")).toBe(
      "Datos no disponibles para este simbolo en este momento.",
    );
  });

  it("mapea cualquier otro contexto del guard al mismo mensaje user-facing", () => {
    // Otros callers usan contextos distintos (scoring, decisión, materialized...).
    expect(userFacingSearchError("Serie estimada excluida de scoring")).toBe(
      "Datos no disponibles para este simbolo en este momento.",
    );
    expect(userFacingSearchError("Serie estimada excluida de decisión")).toBe(
      "Datos no disponibles para este simbolo en este momento.",
    );
  });

  it("preserva el mensaje cuando NO es del guard estimated", () => {
    // Otros searchError reales de la app no deben tocarse.
    expect(userFacingSearchError("Proveedor no disponible")).toBe("Proveedor no disponible");
    expect(userFacingSearchError("Introduce un ticker o el nombre de una empresa.")).toBe(
      "Introduce un ticker o el nombre de una empresa.",
    );
    expect(userFacingSearchError("")).toBe("");
  });

  it("el mensaje user-facing NO filtra el string interno del guard", () => {
    // Garantiza que el debugging interno nunca se cuela en la UI.
    const mapped = userFacingSearchError("Serie estimada excluida de research row");
    expect(mapped).not.toMatch(/Serie estimada/);
    expect(mapped).not.toMatch(/excluida/);
  });
});

describe("userFacingSearchError · mapeo del guard de review", () => {
  it("mapea 'Historico estimado/no disponible' (guard de review:309) a mensaje user-facing", () => {
    // El string interno exacto que lanza app/review/page.jsx cuando el chart
    // de la ficha review no es decision-grade.
    expect(userFacingSearchError("Historico estimado/no disponible")).toBe(
      "Historico no disponible para este simbolo.",
    );
  });

  it("el mensaje user-facing NO filtra el marcador interno de review", () => {
    // El marcador interno inequívoco es "estimado" (barra sintética). La frase
    // user-facing "no disponible" SÍ aparece legítimamente en el copy final,
    // así que solo verificamos que "estimado" no se filtre a la UI.
    const mapped = userFacingSearchError("Historico estimado/no disponible");
    expect(mapped).not.toMatch(/estimado/);
    expect(mapped).not.toBe("Historico estimado/no disponible");
  });

  it("el fallback de red ('Proveedor no disponible') sigue pasando sin mapear", () => {
    // El catch de hidratación usa error.message || "Proveedor no disponible";
    // un fallo de red real (no del guard) conserva su mensaje original.
    expect(userFacingSearchError("Proveedor no disponible")).toBe("Proveedor no disponible");
  });
});

describe("reviewChartPlaceholder · prioridad error > carga > vacío", () => {
  it("con error muestra el mensaje de error (NO 'Sin grafico disponible' silencioso)", () => {
    // Caso central de la tarea: hidratación en status:"error" debe ser visible.
    expect(reviewChartPlaceholder({ error: "Historico no disponible para este simbolo." })).toBe(
      "Historico no disponible para este simbolo.",
    );
  });

  it("el error gana incluso cuando loading es true (error > carga)", () => {
    expect(reviewChartPlaceholder({ error: "Historico no disponible para este simbolo.", loading: true })).toBe(
      "Historico no disponible para este simbolo.",
    );
  });

  it("sin error pero cargando → 'Cargando datos...'", () => {
    expect(reviewChartPlaceholder({ loading: true })).toBe("Cargando datos...");
  });

  it("sin error y sin cargar → 'Sin grafico disponible' (comportamiento previo preservado)", () => {
    expect(reviewChartPlaceholder({})).toBe("Sin grafico disponible");
    expect(reviewChartPlaceholder({ loading: false })).toBe("Sin grafico disponible");
  });

  it("error vacío o solo espacios se trata como sin error (no muestra vacío engañoso)", () => {
    expect(reviewChartPlaceholder({ error: "" })).toBe("Sin grafico disponible");
    expect(reviewChartPlaceholder({ error: "   " })).toBe("Sin grafico disponible");
  });

  it("flujo integrado: guard interno → mapper → placeholder muestra el user-facing", () => {
    // Simula el camino real en review: hydration.error = string interno del
    // guard → pasa por userFacingSearchError → entra como placeholder.
    const internal = "Historico estimado/no disponible";
    const shown = reviewChartPlaceholder({ error: userFacingSearchError(internal) });
    expect(shown).toBe("Historico no disponible para este simbolo.");
    expect(shown).not.toMatch(/estimado/);
    expect(shown).not.toBe("Sin grafico disponible");
  });
});
