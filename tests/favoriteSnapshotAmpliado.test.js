// Tests de la ampliación de FAVORITE_SNAPSHOT_FIELDS (Task B).
//
// Verifica que el snapshot de favorito captura:
//   - signalCoverage (objeto completo) verbatim del row
//   - signalContradictions (array completo) verbatim del row
//   - contradictionsSkipped (array completo) verbatim del row
//   - percentileScope (string) del row
//   - capturedAt (timestamp ISO generado al capturar)
//   - scanLocalId (id del scan vía options.scan, si disponible)
//
// Y que las 20 señales del SIGNAL_REGISTRY ya estaban presentes (no se añaden
// aquí — se confirman que siguen presentes tras la ampliación).
//
// universeSize NO se captura: no existe como campo del row hoy. El equivalente
// semántico más cercano (rsGlobalSample) ya está en la lista. Ver test
// "universeSize no se captura (campo no disponible en el row)".

import { describe, expect, it } from "vitest";
import { createFavoriteFromRow, favoriteSnapshotFromRow } from "@/lib/stockRows";

// Nota: FAVORITE_SNAPSHOT_FIELDS es privado (no exportado por diseño — es
// detalle de implementación). Los tests verifican el COMPORTAMIENTO via el
// snapshot producido, no via inspección directa de la lista.

// Row base con todos los campos que usa createFavoriteFromRow. Los tests
// mutan solo los relevantes.
function baseRow(overrides = {}) {
  return {
    symbol: "TEST",
    companyName: "Test Co",
    country: "US",
    sector: "Tech",
    industry: "Software",
    theme: "AI",
    price: 100,
    weinsteinScore: 80,
    minerviniScore: 70,
    weaknessScore: 30,
    rsGlobalPct: 65,
    ...overrides,
  };
}

// ===========================================================================
// 1. Las 20 señales del SIGNAL_REGISTRY ya están en FAVORITE_SNAPSHOT_FIELDS
// ===========================================================================
//
// FAVORITE_SNAPSHOT_FIELDS es privado, así que verificamos presencia via el
// snapshot producido: cada signalKey seteada en el row debe llegar al snapshot.

describe("favoriteSnapshotFromRow · 20 señales del SIGNAL_REGISTRY presentes", () => {
  // Lista canónica de las 20 keys del SIGNAL_REGISTRY (lib/scoringEngine.js).
  const SIGNAL_KEY = [
    "weinsteinScore", "minerviniScore", "momentumScore", "riskScore",
    "riskRewardScore", "volumeEffectScore", "volumeScore", "liquidityScore",
    "ipoScore", "objectiveSetupScore", "patternContributionScore", "patternScore",
    "setupQualityScore", "demandScore", "growthScore", "epsGrowthProxyScore",
    "adProxyScore", "weaknessScore", "sectorScore", "rsQualityScore",
  ];

  it("las 20 señales seteadas en el row llegan al snapshot (no se perdieron al añadir los nuevos campos)", () => {
    // Construimos un row con las 20 señales seteadas a un valor distinto de 0,
    // y verificamos que cada una llega al snapshot con ese valor exacto.
    const signalValues = Object.fromEntries(SIGNAL_KEY.map((k, i) => [k, 50 + i]));
    const snapshot = favoriteSnapshotFromRow(baseRow(signalValues));
    for (const key of SIGNAL_KEY) {
      expect(snapshot[key], `se esperaba ${key} en el snapshot`).toBe(signalValues[key]);
    }
  });
});

// ===========================================================================
// 2. signalCoverage / signalContradictions / contradictionsSkipped verbatim
// ===========================================================================

describe("favoriteSnapshotFromRow · signalCoverage y contradicciones verbatim", () => {
  it("captura signalCoverage verbatim del row (comparación exacta)", () => {
    const coverage = {
      weinsteinScore: { coverage: 1.0, partial: false },
      momentumScore: { coverage: 0.5, partial: true },
      weaknessScore: { coverage: 0.8, partial: false },
    };
    const row = baseRow({ signalCoverage: coverage });
    const snapshot = favoriteSnapshotFromRow(row);
    expect(snapshot.signalCoverage).toEqual(coverage); // exacto, no solo presencia
  });

  it("captura signalContradictions verbatim del row (array completo)", () => {
    const contradictions = [
      {
        key: "leader-stalling",
        tier: "thesis",
        signals: ["rsGlobalPct", "momentumScore"],
        values: { rsGlobalPct: 75, momentumScore: 25 },
        thresholds: { rsGlobalPct: ">=70", momentumScore: "<=30" },
        label: "Líder frenándose",
        detail: "RS de líder con momentum desacelerándose.",
        percentileScope: "final",
      },
    ];
    const row = baseRow({ signalContradictions: contradictions });
    const snapshot = favoriteSnapshotFromRow(row);
    expect(snapshot.signalContradictions).toEqual(contradictions);
  });

  it("captura contradictionsSkipped verbatim del row (array completo)", () => {
    const skipped = [
      { key: "base-under-distribution", reason: "partial:adProxyScore" },
    ];
    const row = baseRow({ contradictionsSkipped: skipped });
    const snapshot = favoriteSnapshotFromRow(row);
    expect(snapshot.contradictionsSkipped).toEqual(skipped);
  });

  it("un row SIN signalContradictions produce snapshot SIN el campo (cleanObject omite undefined)", () => {
    // El contrato: el snapshot NO debe tener signalContradictions: null ni
    // undefined. Como cleanObject filtra undefined, el campo simplemente no
    // aparece. favoriteToRow / consumidor debe usar `snapshot.signalContradictions ?? []`.
    const row = baseRow(); // sin signalContradictions
    const snapshot = favoriteSnapshotFromRow(row);
    expect(snapshot.signalContradictions).toBeUndefined();
    expect(snapshot.contradictionsSkipped).toBeUndefined();
    expect(snapshot.signalCoverage).toBeUndefined();
  });

  it("un row CON signalContradictions: [] (array vacío explícito) lo preserva como []", () => {
    // Array vacío es truthy como objeto → cleanObject NO lo filtra.
    // El snapshot lleva [] explícito, distinguible de "campo ausente".
    const row = baseRow({ signalContradictions: [], contradictionsSkipped: [] });
    const snapshot = favoriteSnapshotFromRow(row);
    expect(snapshot.signalContradictions).toEqual([]);
    expect(snapshot.contradictionsSkipped).toEqual([]);
  });
});

// ===========================================================================
// 3. Metadatos de procedencia
// ===========================================================================

describe("favoriteSnapshotFromRow · metadatos de procedencia", () => {
  it("captura percentileScope del row cuando está presente", () => {
    const row = baseRow({ percentileScope: "final" });
    const snapshot = favoriteSnapshotFromRow(row);
    expect(snapshot.percentileScope).toBe("final");
  });

  it("genera capturedAt como timestamp ISO al capturar (no del row)", () => {
    // capturedAt es metadata de captura, no del row. Se genera con now() salvo
    // que el caller pase options.capturedAt explícito (para replay en tests).
    const before = Date.now();
    const snapshot = favoriteSnapshotFromRow(baseRow());
    const after = Date.now();
    expect(typeof snapshot.capturedAt).toBe("string");
    const captured = Date.parse(snapshot.capturedAt);
    expect(captured).toBeGreaterThanOrEqual(before);
    expect(captured).toBeLessThanOrEqual(after);
  });

  it("respeta options.capturedAt explícito (replay determinista)", () => {
    const fixed = "2026-07-05T12:00:00.000Z";
    const snapshot = favoriteSnapshotFromRow(baseRow(), { capturedAt: fixed });
    expect(snapshot.capturedAt).toBe(fixed);
  });

  it("captura scanLocalId desde options.scan.id cuando está disponible", () => {
    const snapshot = favoriteSnapshotFromRow(baseRow(), { scan: { id: "scan-123", local_id: "local-456" } });
    // Preferimos scan.id sobre scan.local_id (orden en el código).
    expect(snapshot.scanLocalId).toBe("scan-123");
  });

  it("captura scanLocalId desde options.scan.local_id si id no está", () => {
    const snapshot = favoriteSnapshotFromRow(baseRow(), { scan: { local_id: "local-456" } });
    expect(snapshot.scanLocalId).toBe("local-456");
  });

  it("acepta options.scanLocalId directo (sin objeto scan)", () => {
    const snapshot = favoriteSnapshotFromRow(baseRow(), { scanLocalId: "explicit-id" });
    expect(snapshot.scanLocalId).toBe("explicit-id");
  });

  it("omite scanLocalId cuando no hay scan ni scanLocalId en options", () => {
    // cleanObject filtra null → el campo simplemente no aparece.
    const snapshot = favoriteSnapshotFromRow(baseRow());
    expect(snapshot.scanLocalId).toBeUndefined();
  });

  it("universeSize NO se captura (campo no disponible en el row hoy)", () => {
    // Documentación explícita del hallazgo: universeSize no existe como campo
    // del row. El equivalente semántico rsGlobalSample SÍ está capturado.
    const snapshot = favoriteSnapshotFromRow(baseRow({ rsGlobalSample: 25, universeSize: 999 }));
    expect(snapshot.universeSize).toBeUndefined();
    expect(snapshot.rsGlobalSample).toBe(25); // el sustituto disponible
  });
});

// ===========================================================================
// 4. Integración via createFavoriteFromRow (snapshot dentro del favorite)
// ===========================================================================

describe("createFavoriteFromRow · snapshot ampliado integrado", () => {
  it("el favorite incluye el snapshot con todos los campos ampliados", () => {
    const coverage = { weinsteinScore: { coverage: 1.0, partial: false } };
    const contradictions = [
      { key: "leader-stalling", tier: "thesis", signals: ["rsGlobalPct", "momentumScore"], values: { rsGlobalPct: 75, momentumScore: 25 }, thresholds: { rsGlobalPct: ">=70", momentumScore: "<=30" }, label: "Líder frenándose", detail: "x", percentileScope: "final" },
    ];
    const skipped = [{ key: "base-under-distribution", reason: "partial:adProxyScore" }];
    const row = baseRow({
      signalCoverage: coverage,
      signalContradictions: contradictions,
      contradictionsSkipped: skipped,
      percentileScope: "final",
      rsGlobalSample: 50,
    });
    const favorite = createFavoriteFromRow(row, {
      source: "scan",
      scan: { id: "scan-abc", local_id: "local-xyz" },
      capturedAt: "2026-07-05T10:00:00.000Z",
    });

    expect(favorite.source).toBe("scan");
    expect(favorite.snapshot.signalCoverage).toEqual(coverage);
    expect(favorite.snapshot.signalContradictions).toEqual(contradictions);
    expect(favorite.snapshot.contradictionsSkipped).toEqual(skipped);
    expect(favorite.snapshot.percentileScope).toBe("final");
    expect(favorite.snapshot.rsGlobalSample).toBe(50);
    expect(favorite.snapshot.capturedAt).toBe("2026-07-05T10:00:00.000Z");
    expect(favorite.snapshot.scanLocalId).toBe("scan-abc");
    // Las señales clásicas siguen presentes.
    expect(favorite.snapshot.weinsteinScore).toBe(80);
    expect(favorite.snapshot.weaknessScore).toBe(30);
  });

  it("createFavoriteFromRow sin scan ni signalCoverage no falla (campos omitidos graceful)", () => {
    const favorite = createFavoriteFromRow(baseRow(), { source: "screener" });
    expect(favorite.snapshot.signalCoverage).toBeUndefined();
    expect(favorite.snapshot.signalContradictions).toBeUndefined();
    expect(favorite.snapshot.scanLocalId).toBeUndefined();
    expect(favorite.snapshot.capturedAt).toBeTruthy(); // siempre presente
  });
});
