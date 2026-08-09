// Tests de los dos fallos de presentación de docs/timeout-scan-universo-2026-08-09.md:
//
//  1. userFacingScanError: el error crudo de Postgres/PostgREST (p.ej.
//     "canceling statement due to statement timeout") NUNCA debe llegar tal
//     cual al banner `err` que pinta ScreenerShell.jsx. El mensaje original
//     se conserva por separado (consola, ver app/page.jsx) — esta función
//     solo decide qué ve el usuario.
//  2. analyzedCountForDisplay: el contador "N analizadas" del panel de
//     resultados (ScreenerShell.jsx) debe reflejar SIEMPRE analyzedRows.length
//     real, incluido el caso 0 (scan que falló antes de procesar nada, o
//     antes de correr ningún scan) — nunca un fallback al tamaño del universo
//     cargado en el navegador.

import { describe, expect, it } from "vitest";
import { analyzedCountForDisplay, scanFailureExplanation, scanPreparationStatus, userFacingScanError } from "@/lib/screenerFormat";

describe("userFacingScanError · el error de Postgres no llega crudo a pantalla", () => {
  it("mapea el statement timeout de Postgres al mensaje de producto", () => {
    const raw = "canceling statement due to statement timeout";
    const mapped = userFacingScanError(raw);
    expect(mapped).not.toBe(raw);
    expect(mapped).not.toMatch(/statement timeout/i);
    expect(mapped).toMatch(/universo/i);
  });

  it("es insensible a mayúsculas/minúsculas y a texto adicional alrededor", () => {
    const raw = "Supabase HTTP 500: canceling statement due to statement TIMEOUT after 8000ms";
    expect(userFacingScanError(raw)).toMatch(/universo/i);
  });

  it("mapea timeouts de red genéricos (ETIMEDOUT) a un mensaje distinto sin jerga", () => {
    const mapped = userFacingScanError("fetch failed: ETIMEDOUT 10.0.0.1:443");
    expect(mapped).not.toMatch(/ETIMEDOUT/);
    expect(mapped).toMatch(/servidor/i);
  });

  it("mapea errores 5xx de Supabase a un mensaje de producto", () => {
    const mapped = userFacingScanError("Supabase HTTP 503: Service Unavailable");
    expect(mapped).not.toMatch(/HTTP 503/);
  });

  it("un mensaje técnico no reconocido cae en el fallback genérico, nunca crudo", () => {
    const raw = "PGRST301: JWSError CompactDecodeError InvalidNumberOfSegments";
    const mapped = userFacingScanError(raw);
    expect(mapped).not.toBe(raw);
    expect(mapped).not.toMatch(/PGRST301|JWSError/);
  });

  // docs/upstream-timeout-2026-08-09.md: el INSERT que crea el scan no tenía
  // tope de tiempo. Al ponérselo, el error crudo que puede llegar ahora al
  // cliente ya no es de Postgres sino el aborto de undici/Node
  // (AbortSignal.timeout), que también debe traducirse.
  it("mapea el aborto por tope de tiempo (AbortSignal.timeout) a un mensaje accionable", () => {
    const mapped = userFacingScanError("The operation was aborted due to timeout");
    expect(mapped).not.toMatch(/aborted/i);
    expect(mapped).toMatch(/universo/i);
  });

  it("mapea también las otras variantes de aborto de Node/undici", () => {
    const expected = userFacingScanError("The operation was aborted due to timeout");
    expect(userFacingScanError("TimeoutError: signal is aborted without reason")).toBe(expected);
    expect(userFacingScanError("AbortError: This operation was aborted")).toBe(expected);
    expect(userFacingScanError("The user aborted a request.")).toBe(expected);
  });

  it("el aborto gana al patrón genérico de timeout: da el mensaje específico, no 'tardó demasiado en responder'", () => {
    const abortMessage = userFacingScanError("The operation was aborted due to timeout");
    const genericMessage = userFacingScanError("fetch failed: ETIMEDOUT 10.0.0.1:443");
    expect(abortMessage).not.toBe(genericMessage);
  });

  it("string vacío o null pasa a vacío (sin banner)", () => {
    expect(userFacingScanError("")).toBe("");
    expect(userFacingScanError(null)).toBe("");
    expect(userFacingScanError(undefined)).toBe("");
  });
});

describe("analyzedCountForDisplay · el contador refleja lo procesado, no el universo pedido", () => {
  it("con un scan que completó, devuelve el número real de filas analizadas", () => {
    const analyzedRows = Array.from({ length: 47 }, (_, i) => ({ symbol: `SYM${i}` }));
    expect(analyzedCountForDisplay(analyzedRows)).toBe(47);
  });

  it("REGRESIÓN: con 0 filas analizadas (fallo temprano), devuelve 0 — NUNCA un tamaño de universo ajeno", () => {
    // Antes de este fix, el caller usaba `analyzedRows.length || resultsUniverse.length || 0`:
    // con analyzedRows=[] (0, falsy), el `||` caía a resultsUniverse.length (el
    // universo completo cargado, p.ej. 10234), mostrando "10234 analizadas"
    // cuando el scan real solo procesó 47 símbolos antes de fallar.
    expect(analyzedCountForDisplay([])).toBe(0);
  });

  it("con analyzedRows no-array (undefined/null, estado inicial), devuelve 0 sin lanzar", () => {
    expect(analyzedCountForDisplay(undefined)).toBe(0);
    expect(analyzedCountForDisplay(null)).toBe(0);
  });
});

// scanPreparationStatus: el cartel que app/page.jsx muestra en modo "todo el
// universo" ANTES de enviar el POST que crea el scan. Antes era
// "Escaneando todo el universo: 10234/10234 acciones" — texto fijo, no un
// contador, que se leía como un análisis ya terminado y se quedaba congelado
// ahí si la creación fallaba (docs/upstream-timeout-2026-08-09.md, Parte B).
describe("scanPreparationStatus · el cartel previo dice 'preparando', no un recuento de análisis", () => {
  it("REGRESIÓN: no contiene un recuento con forma hechos/total", () => {
    const message = scanPreparationStatus({ symbolsCount: 10234, hadVisibleRows: false });
    expect(message).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(message).not.toMatch(/10234\s*\/\s*10234/);
  });

  it("dice explícitamente que está preparando y que el análisis no ha empezado", () => {
    const message = scanPreparationStatus({ symbolsCount: 10234, hadVisibleRows: false });
    expect(message).toMatch(/prepar/i);
    expect(message).toMatch(/no ha empezado/i);
    expect(message).not.toMatch(/^Escaneando/);
  });

  it("puede nombrar el tamaño del universo pedido, pero como alcance, nunca como progreso", () => {
    const message = scanPreparationStatus({ symbolsCount: 10234, hadVisibleRows: false });
    expect(message).toMatch(/10234 acciones/);
    expect(message).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it("conserva las dos variantes de la UI: tabla congelada vs. aviso de que se puede detener", () => {
    expect(scanPreparationStatus({ symbolsCount: 10234, hadVisibleRows: true })).toMatch(/congelada/i);
    expect(scanPreparationStatus({ symbolsCount: 10234, hadVisibleRows: false })).toMatch(/detenerlo/i);
  });

  it("con un recuento inválido o ausente no pinta números raros", () => {
    for (const value of [undefined, null, NaN, -5, "no-es-un-numero"]) {
      const message = scanPreparationStatus({ symbolsCount: value });
      expect(message).toMatch(/prepar/i);
      expect(message).not.toMatch(/NaN|-\d|undefined|null/);
      expect(message).not.toMatch(/\d+\s*\/\s*\d+/);
    }
    expect(scanPreparationStatus()).toMatch(/prepar/i);
  });
});

// scanFailureExplanation: el mensaje que app/page.jsx pone en el banner `err`
// cuando classifyScanOutcome (lib/scanStatus.js) da "failed" — el caso motivador
// de docs/limite-600-scan-2026-08-09.md. Reutiliza userFacingScanError cuando
// hay un mensaje crudo; si no lo hay (progress.status:"failed" sin texto de
// error propio), da una explicación en lenguaje llano en vez de dejar el
// banner vacío.
describe("scanFailureExplanation · mensaje del banner cuando el outcome es 'failed'", () => {
  it("con un error crudo del servidor, delega en userFacingScanError (mismo mecanismo, no uno nuevo)", () => {
    const raw = "canceling statement due to statement timeout";
    expect(scanFailureExplanation(raw)).toBe(userFacingScanError(raw));
  });

  it("sin error crudo (progress.status:'failed', veredicto de calidad sin texto propio), da una explicación en lenguaje llano — nunca deja el banner vacío", () => {
    const message = scanFailureExplanation("");
    expect(message).not.toBe("");
    expect(message).toMatch(/no se pudieron procesar/i);
  });

  it("null/undefined se tratan igual que string vacío", () => {
    expect(scanFailureExplanation(null)).toBe(scanFailureExplanation(""));
    expect(scanFailureExplanation(undefined)).toBe(scanFailureExplanation(""));
  });

  it("REPRODUCCIÓN con el error real del incidente: nunca se ve la jerga de Postgres", () => {
    const message = scanFailureExplanation("canceling statement due to statement timeout");
    expect(message).not.toMatch(/statement timeout/i);
  });
});
