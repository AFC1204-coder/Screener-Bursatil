// Tests de lib/scanStatus.js: la decisión de estado terminal que comparten el
// polling del cliente, /api/scan y /api/scan/cancel. Cubre el contrato de
// completitud introducido tras el audit 2026-07-10 §"Terminal done can mean
// zero successful scan rows".
import { describe, expect, it } from "vitest";
import {
  classifyScanOutcome,
  COMPLETENESS_PARTIAL_MIN_RATIO,
  computeTerminalCompleteness,
  isPublicScanStatus,
  isTerminalScanStatus,
  PUBLIC_SCAN_STATUSES,
  scanOutcomeLabel,
  TERMINAL_SCAN_STATUSES,
} from "@/lib/scanStatus";

describe("isTerminalScanStatus", () => {
  it("complete, partial, failed, error y cancelled son terminales", () => {
    expect(isTerminalScanStatus("complete")).toBe(true);
    expect(isTerminalScanStatus("partial")).toBe(true);
    expect(isTerminalScanStatus("failed")).toBe(true);
    expect(isTerminalScanStatus("error")).toBe(true);
    expect(isTerminalScanStatus("cancelled")).toBe(true);
  });
  it("done se sigue aceptando por retrocompat de snapshots legacy", () => {
    // El runner nuevo NUNCA escribe "done", pero el inventario existente puede
    // contener filas históricas; las toleramos como terminal.
    expect(isTerminalScanStatus("done")).toBe(true);
  });
  it("es tolerante a mayúsculas y espacios", () => {
    expect(isTerminalScanStatus("COMPLETE")).toBe(true);
    expect(isTerminalScanStatus(" Cancelled ")).toBe(true);
  });
  it("running y estados desconocidos no son terminales", () => {
    expect(isTerminalScanStatus("running")).toBe(false);
    expect(isTerminalScanStatus("finalizing")).toBe(false);
    expect(isTerminalScanStatus("unknown")).toBe(false);
    expect(isTerminalScanStatus("")).toBe(false);
    expect(isTerminalScanStatus(null)).toBe(false);
    expect(isTerminalScanStatus(undefined)).toBe(false);
  });
  it("la lista exportada cubre exactamente los seis estados terminales esperados", () => {
    expect(TERMINAL_SCAN_STATUSES).toEqual([
      "complete",
      "partial",
      "failed",
      "error",
      "cancelled",
      "done",
    ]);
  });
});

describe("isPublicScanStatus", () => {
  it("complete, partial y done son publicables en leaderboards", () => {
    expect(isPublicScanStatus("complete")).toBe(true);
    expect(isPublicScanStatus("partial")).toBe(true);
    expect(isPublicScanStatus("done")).toBe(true);
  });
  it("failed, error y cancelled NO son publicables", () => {
    expect(isPublicScanStatus("failed")).toBe(false);
    expect(isPublicScanStatus("error")).toBe(false);
    expect(isPublicScanStatus("cancelled")).toBe(false);
  });
  it("running y desconocidos NO son publicables", () => {
    expect(isPublicScanStatus("running")).toBe(false);
    expect(isPublicScanStatus("")).toBe(false);
    expect(isPublicScanStatus(null)).toBe(false);
  });
  it("PUBLIC_SCAN_STATUSES exporta exactamente complete|partial|done", () => {
    expect(PUBLIC_SCAN_STATUSES).toEqual(["complete", "partial", "done"]);
  });
});

describe("computeTerminalCompleteness", () => {
  it("todos los símbolos OK → complete con ratio 1", () => {
    expect(computeTerminalCompleteness({ saved: 10, errors: 0 })).toEqual({
      status: "complete",
      ratio: 1,
      saved: 10,
      errors: 0,
      total: 10,
    });
  });

  it("todos los símbolos fallan → failed con ratio 0", () => {
    expect(computeTerminalCompleteness({ saved: 0, errors: 7 })).toEqual({
      status: "failed",
      ratio: 0,
      saved: 0,
      errors: 7,
      total: 7,
    });
  });

  it("caso mixto: 7 de 10 OK → partial con ratio 0.7 (>= umbral 0.5)", () => {
    const result = computeTerminalCompleteness({ saved: 7, errors: 3 });
    expect(result.status).toBe("partial");
    expect(result.ratio).toBeCloseTo(0.7, 5);
    expect(result.saved).toBe(7);
    expect(result.errors).toBe(3);
    expect(result.total).toBe(10);
  });

  it("caso degenerado: 0 guardados y 0 errores → failed (no complete)", () => {
    // saved+errors === 0 → no hay trabajo, no se publica como líder completo.
    expect(computeTerminalCompleteness({ saved: 0, errors: 0 })).toEqual({
      status: "failed",
      ratio: 0,
      saved: 0,
      errors: 0,
      total: 0,
    });
  });

  it("tolerante a inputs no numéricos (string, null, undefined, NaN)", () => {
    expect(computeTerminalCompleteness().status).toBe("failed");
    expect(computeTerminalCompleteness({ saved: "x", errors: null }).status).toBe("failed");
    expect(computeTerminalCompleteness({ saved: 3, errors: undefined }).status).toBe("complete");
    expect(computeTerminalCompleteness({ saved: NaN, errors: NaN }).status).toBe("failed");
  });

  it("negativos se tratan como 0", () => {
    expect(computeTerminalCompleteness({ saved: -2, errors: 3 })).toEqual({
      status: "failed",
      ratio: 0,
      saved: 0,
      errors: 3,
      total: 3,
    });
  });

  it("un único símbolo OK es complete con ratio 1", () => {
    expect(computeTerminalCompleteness({ saved: 1, errors: 0 }).status).toBe("complete");
  });

  it("un único símbolo que falla es failed con ratio 0", () => {
    expect(computeTerminalCompleteness({ saved: 0, errors: 1 }).status).toBe("failed");
  });

  // --- Umbral de mayoría simple (ratio >= 0.5) ------------------------------
  // Contrato corregido: antes era binario (0 < ratio < 1 → partial), lo que
  // dejaba pasar scans con mayoría de errores como "partial". Ahora el umbral
  // es 0.5: por debajo (errores mayoría) se bloquea como "failed".

  it("umbral exacto: saved=5/errors=5 (ratio 0.5) → partial (>= , no falla por usar >)", () => {
    // Caso frontera: el límite exacto debe quedar en "partial". Protege contra
    // un bug de >= vs > que dejaría el límite en el lado "failed".
    const result = computeTerminalCompleteness({ saved: 5, errors: 5 });
    expect(result.status).toBe("partial");
    expect(result.ratio).toBeCloseTo(0.5, 5);
    expect(result.saved).toBe(5);
    expect(result.errors).toBe(5);
    expect(result.total).toBe(10);
  });

  it("umbral justo por encima: saved=6/errors=4 (ratio 0.6) → partial", () => {
    expect(computeTerminalCompleteness({ saved: 6, errors: 4 }).status).toBe("partial");
  });

  it("umbral justo por debajo: saved=4/errors=6 (ratio 0.4) → failed", () => {
    // Errores son mayoría → no publicable.
    const result = computeTerminalCompleteness({ saved: 4, errors: 6 });
    expect(result.status).toBe("failed");
    expect(result.ratio).toBeCloseTo(0.4, 5);
  });

  it("ratio despreciable: saved=1/errors=999 (ratio ~0.001) → failed, NO partial", () => {
    // Escenario motivador de esta corrección: la implementación anterior
    // (binario 0 < ratio < 1) publicaba esto como "partial". Con el umbral 0.5
    // se bloquea como "failed" — un scan con 1 acierto y 999 fallos no es un
    // resultado degradado publicable.
    const result = computeTerminalCompleteness({ saved: 1, errors: 999 });
    expect(result.status).toBe("failed");
    expect(result.ratio).toBeCloseTo(1 / 1000, 5);
    expect(result.saved).toBe(1);
    expect(result.errors).toBe(999);
    expect(result.total).toBe(1000);
  });

  it("bug original (saved=0/errors=3) sigue dando failed — sin regresión", () => {
    // Caso que motivó el audit original: ratio 0 debe seguir siendo failed.
    expect(computeTerminalCompleteness({ saved: 0, errors: 3 }).status).toBe("failed");
  });

  it("exporta el umbral COMPLETENESS_PARTIAL_MIN_RATIO = 0.5", () => {
    expect(COMPLETENESS_PARTIAL_MIN_RATIO).toBe(0.5);
  });
});

// classifyScanOutcome: la etiqueta de 4 estados que ve el usuario al terminar
// un escaneo interactivo (app/page.jsx). Motivado por
// docs/limite-600-scan-2026-08-09.md: un escaneo con progress.status:"error"
// y filas ya guardadas se mostraba como "Completado" porque el cliente solo
// distinguía "cancelado" de "todo lo demás".
describe("classifyScanOutcome", () => {
  it("Completado: publicable, sin degradar, cubrió como mínimo lo pedido", () => {
    expect(classifyScanOutcome({
      cancelled: false,
      status: "complete",
      publishable: true,
      degraded: false,
      completed: 50,
      requestedTotal: 50,
    })).toBe("complete");
  });

  it("Completado: cubrió MÁS de lo pedido (no debería pasar, pero no debe dar 'partial' por un >=)", () => {
    expect(classifyScanOutcome({
      status: "complete",
      publishable: true,
      degraded: false,
      completed: 55,
      requestedTotal: 50,
    })).toBe("complete");
  });

  it("Parcial por cobertura: publicable, sin degradar, pero completed < requestedTotal", () => {
    // El caso real: 600 de 10.234 (aunque en la práctica ese caso concreto es
    // "failed" por publishable:false — ver el test de reproducción más abajo.
    // Este test cubre el caso HIPOTÉTICO de una cobertura parcial SIN error,
    // ej. el tope MAX_SYMBOLS del servidor recortando 10.234 a 10.000 en una
    // corrida que termina limpia.
    expect(classifyScanOutcome({
      status: "complete",
      publishable: true,
      degraded: false,
      completed: 10000,
      requestedTotal: 10234,
    })).toBe("partial");
  });

  it("Parcial por degradación: publicable, degraded:true, aunque cubriera el 100% de lo pedido", () => {
    // progress.status:"partial" (algunos símbolos del tramo final fallaron,
    // ratio 0.5-0.99) siempre implica cobertura completa del lado del
    // servidor — la señal de que hay que desconfiar es `degraded`, no la
    // cobertura.
    expect(classifyScanOutcome({
      status: "partial",
      publishable: true,
      degraded: true,
      completed: 50,
      requestedTotal: 50,
    })).toBe("partial");
  });

  it("Fallido: status 'error' (publishable:false), aunque haya cobertura completa y no esté degradado", () => {
    expect(classifyScanOutcome({
      status: "error",
      publishable: false,
      degraded: false,
      completed: 50,
      requestedTotal: 50,
    })).toBe("failed");
  });

  it("Fallido: status 'failed' (mayoría de errores, publishable:false)", () => {
    expect(classifyScanOutcome({
      status: "failed",
      publishable: false,
      degraded: false,
      completed: 10,
      requestedTotal: 10,
    })).toBe("failed");
  });

  it("Cancelado: prioridad sobre cualquier otra señal, incluso si publishable fuera true", () => {
    expect(classifyScanOutcome({
      cancelled: true,
      status: "running",
      publishable: true,
      degraded: false,
      completed: 5,
      requestedTotal: 50,
    })).toBe("cancelled");
    // También vía status:"cancelled" del servidor, sin el flag de cliente.
    expect(classifyScanOutcome({
      cancelled: false,
      status: "cancelled",
      publishable: false,
      completed: 5,
      requestedTotal: 50,
    })).toBe("cancelled");
  });

  it("sin requestedTotal (0, null, no finito): no fuerza 'partial' por cobertura, solo mira publishable/degraded", () => {
    expect(classifyScanOutcome({ status: "complete", publishable: true, degraded: false, completed: 5, requestedTotal: 0 })).toBe("complete");
    expect(classifyScanOutcome({ status: "complete", publishable: true, degraded: false, completed: 5, requestedTotal: null })).toBe("complete");
    expect(classifyScanOutcome({ status: "complete", publishable: true, degraded: false, completed: 5 })).toBe("complete");
  });

  it("REPRODUCCIÓN con datos reales (docs/limite-600-scan-2026-08-09.md): status 'error', saved 299, completed 600 de 10.234 pedidos → 'failed'", () => {
    // Fila real: scans.id=6fb4e02f-9aca-4825-b1c4-bac22b93d0ee.
    // settings.progress: {status:"error", cursor:600, completed:600, total:10000,
    // saved:299, error:"canceling statement due to statement timeout"}.
    // publishable = isPublicScanStatus("error") = false (PUBLIC_SCAN_STATUSES
    // no incluye "error"). El cliente pedía 10.234 (universo cargado, antes
    // del recorte MAX_SYMBOLS del servidor a 10.000).
    const outcome = classifyScanOutcome({
      cancelled: false,
      status: "error",
      publishable: isPublicScanStatus("error"),
      degraded: false,
      completed: 600,
      requestedTotal: 10234,
    });
    expect(outcome).toBe("failed");
    // Antes de este fix, app/page.jsx mostraba "Completado" para este mismo
    // caso — la prueba de que el bug queda cerrado es que ahora da "failed",
    // no "complete" ni "partial".
    expect(outcome).not.toBe("complete");
    expect(outcome).not.toBe("partial");
  });
});

// scanOutcomeLabel: el texto exacto que antepone app/page.jsx al resumen
// final ("${finishLabel}: N pasan ..."). Antes de este fix, TODO lo que no
// fuera "cancelled" caía en el string fijo "Completado" — estos tests fijan
// el texto correcto para cada uno de los 4 casos.
describe("scanOutcomeLabel", () => {
  it("complete → 'Completado'", () => {
    expect(scanOutcomeLabel("complete", { rawRowsCount: 10234 })).toBe("Completado");
  });

  it("partial → menciona 'muestra' y 'no el universo completo', sin depender de rawRowsCount", () => {
    const label = scanOutcomeLabel("partial", { rawRowsCount: 600 });
    expect(label).toMatch(/parcial/i);
    expect(label).toMatch(/muestra/i);
    expect(label).toMatch(/no el universo completo/i);
  });

  it("failed → dice 'Fallido' y cuántas filas quedaron conservadas", () => {
    expect(scanOutcomeLabel("failed", { rawRowsCount: 299 })).toBe("Fallido · 299 filas conservadas");
  });

  it("cancelled → dice 'Cancelado' y cuántas filas quedaron conservadas (comportamiento preexistente, sin regresión)", () => {
    expect(scanOutcomeLabel("cancelled", { rawRowsCount: 12 })).toBe("Cancelado · 12 filas conservadas");
  });

  it("failed y cancelled con 0 filas conservadas: el número se muestra igual, no se oculta", () => {
    expect(scanOutcomeLabel("failed", { rawRowsCount: 0 })).toBe("Fallido · 0 filas conservadas");
    expect(scanOutcomeLabel("cancelled", { rawRowsCount: 0 })).toBe("Cancelado · 0 filas conservadas");
  });

  it("valor desconocido o ausente: degrada a 'Completado' (mismo comportamiento que el default previo)", () => {
    expect(scanOutcomeLabel("algo-no-contemplado")).toBe("Completado");
    expect(scanOutcomeLabel(undefined)).toBe("Completado");
  });
});
