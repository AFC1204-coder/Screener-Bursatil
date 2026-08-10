// Tests del tope acumulado de filas escritas de scripts/refresh-bars.mjs.
//
// CONTEXTO — qué sustituye este tope y por qué se testea así:
// El guardián anterior contaba símbolos "caducados" antes de escribir y
// abortaba la corrida entera por encima de 1.000. Medía lo que no debe
// (caducados son TODOS los símbolos cada día laborable, porque el refresco
// existe para traer la sesión que falta), abortó la única ejecución real del
// workflow con 5.605 de 5.605, y costaba ~4 minutos de precálculo por corrida.
// Lo sustituye un tope sobre las FILAS REALMENTE ESCRITAS (`count` de
// writeDailyBarsCache, ya solo el delta desde d0a628b): el script trabaja
// hasta el tope y para ordenadamente en vez de negarse a empezar.
//
// Se testea runWriteLoop, que es el bucle puro: recibe los símbolos y una
// función `refresh` inyectada, así que no toca ni Supabase ni el proveedor.
// El archivo solo ejecuta main() cuando se invoca por CLI (guardia
// `invokedDirectly`), por eso importarlo aquí es seguro.
//
// Lo que NO cubren estos tests:
//   - Que `cache.write.count` de withDailyBarsCache refleje de verdad las
//     filas insertadas en Postgres (eso lo cubre tests/dailyBarsWriteCap.test.js
//     y, en última instancia, solo una corrida real).
//   - Los DELETE de la purga oportunista, que no cuentan para el tope.
//   - El código de salida del proceso (se testea el flag `stoppedByCap` que
//     lo determina, no el process.exitCode real).

import { describe, expect, it } from "vitest";

import { parseArgs, runWriteLoop } from "@/scripts/refresh-bars.mjs";

// Fábrica de símbolos con el mismo shape que usa el script (filas de
// universe_snapshot_symbols: lo único que consume el bucle es `symbol`).
function symbols(n, prefix = "SYM") {
  return Array.from({ length: n }, (_, i) => ({ symbol: `${prefix}${i}` }));
}

// Sustituto de refreshOne: devuelve el mismo shape ({ ok, skipped, barsWritten }),
// sin red ni base de datos. `barsWritten` es el `count` del delta.
function fakeRefresh(barsPerSymbol) {
  return async (row) => ({ symbol: row.symbol, ok: true, skipped: false, barsWritten: barsPerSymbol });
}

describe("runWriteLoop — tope de filas escritas", () => {
  it("para de tomar símbolos nuevos al alcanzar el tope", async () => {
    // 100 símbolos vírgenes × 400 barras = 40.000 filas si no hubiera tope.
    const result = await runWriteLoop(symbols(100), {
      concurrency: 1,
      maxRows: 2000,
      refresh: fakeRefresh(400),
    });

    expect(result.stoppedByCap).toBe(true);
    // Con concurrency=1 el corte es exacto: 5 símbolos × 400 = 2.000 filas,
    // y el sexto ya no se toma.
    expect(result.processed).toBe(5);
    expect(result.rowsWritten).toBe(2000);
    expect(result.results).toHaveLength(5);
  });

  it("reporta cuántos símbolos quedaron sin procesar y cuántas filas escribió", async () => {
    const result = await runWriteLoop(symbols(100), {
      concurrency: 1,
      maxRows: 2000,
      refresh: fakeRefresh(400),
    });

    expect(result.remaining).toBe(95);
    expect(result.processed + result.remaining).toBe(100);
    expect(result.rowsWritten).toBe(2000);
  });

  it("con concurrencia >1 el exceso sobre el tope está acotado por los símbolos en vuelo", async () => {
    // El tope se comprueba ENTRE símbolos, no dentro de uno: cuando un
    // trabajador cruza el umbral, hasta concurrency-1 trabajadores ya están
    // escribiendo. El exceso nunca supera (concurrency - 1) × filas por símbolo.
    const concurrency = 4;
    const barsPerSymbol = 400;
    const maxRows = 2000;
    const result = await runWriteLoop(symbols(100), {
      concurrency,
      maxRows,
      refresh: async (row) => {
        // Un await real fuerza el intercalado de los trabajadores.
        await Promise.resolve();
        return { symbol: row.symbol, ok: true, skipped: false, barsWritten: barsPerSymbol };
      },
    });

    expect(result.stoppedByCap).toBe(true);
    expect(result.rowsWritten).toBeGreaterThanOrEqual(maxRows);
    expect(result.rowsWritten).toBeLessThanOrEqual(maxRows + (concurrency - 1) * barsPerSymbol);
    // Y sigue muy lejos de las ~700.000 filas del incidente del 9 de agosto.
    expect(result.rowsWritten).toBeLessThan(700000);
  });

  it("un refresco diario normal ni se acerca al tope y procesa todo el universo", async () => {
    // Régimen normal tras el delta de d0a628b: ~5.600 símbolos, 1 barra nueva
    // cada uno (la sesión que falta). El universo real son 5.605 símbolos.
    const universeSize = 5605;
    const { maxRows } = parseArgs([]); // 200.000, el valor por defecto.
    const result = await runWriteLoop(symbols(universeSize), {
      concurrency: 4,
      maxRows,
      refresh: fakeRefresh(1),
    });

    expect(result.stoppedByCap).toBe(false);
    expect(result.processed).toBe(universeSize);
    expect(result.remaining).toBe(0);
    expect(result.rowsWritten).toBe(universeSize);
    // Margen real: el refresco diario usa menos del 5% del tope.
    expect(result.rowsWritten).toBeLessThan(maxRows * 0.05);
  });

  it("los símbolos al día (0 filas escritas) no consumen tope", async () => {
    // El delta hace que un símbolo ya fresco escriba 0 filas: una corrida
    // entera sobre un universo al día no debe activar el tope jamás.
    const result = await runWriteLoop(symbols(5605), {
      concurrency: 4,
      maxRows: 10,
      refresh: async (row) => ({ symbol: row.symbol, ok: true, skipped: true, barsWritten: 0 }),
    });

    expect(result.stoppedByCap).toBe(false);
    expect(result.rowsWritten).toBe(0);
    expect(result.processed).toBe(5605);
  });
});

describe("parseArgs — banderas del tope", () => {
  it("por defecto usa 200.000 filas", () => {
    expect(parseArgs([]).maxRows).toBe(200000);
  });

  it("--max-filas=N ajusta el tope", () => {
    expect(parseArgs(["--max-filas=5000"]).maxRows).toBe(5000);
  });

  it("un --max-filas inválido cae al valor por defecto en vez de dejar el tope en 0", () => {
    expect(parseArgs(["--max-filas=abc"]).maxRows).toBe(200000);
  });

  it("ya no existen las banderas del guardián anterior", () => {
    const args = parseArgs(["--max-carga-masiva=1", "--permitir-carga-masiva"]);
    expect(args).not.toHaveProperty("maxMassLoad");
    expect(args).not.toHaveProperty("permitMassLoad");
    // Y no contaminan el tope nuevo.
    expect(args.maxRows).toBe(200000);
  });
});
