// scripts/inspect-caso2-values.mjs
// Reproduce los valores exactos del test 'toda la población en 1 grupo → mismo
// sectorScore' usando SOLO el helper screenerComposite (sin importar
// scanPercentileFinalization, que arrastra chains con imports que solo
// resuelve vitest). Los números tienen que coincidir con el patch del helper.
//
// Uso: node --loader ./scripts/loader.mjs scripts/inspect-caso2-values.mjs

import {
  applySectorScores,
  computeSectorScoresForRows,
  sectorScoreForGroup,
} from "@/lib/screenerComposite";

// Mismo fixture que buildUniverse() en tests/scanPercentileFinalization.test.js
function buildUniverse() {
  const rows = [];
  const batchProfiles = [
    ["A", 1], ["A", 2], ["A", 3], ["B", 1], ["B", 2], ["B", 3],
    ["C", 1], ["C", 2], ["C", 3], ["D", 1], ["D", 2], ["D", 3],
    ["E", 1], ["E", 2], ["E", 3], ["F", 1], ["F", 2], ["F", 3],
    ["G", 1], ["G", 2], ["G", 3], ["H", 1], ["H", 2], ["H", 3],
  ];
  for (const [letter, pos] of batchProfiles) {
    const batchRank = letter.charCodeAt(0) - "A".charCodeAt(0);
    const strength = batchRank * 8 + (3 - pos) * 3;
    const perf3m = Math.max(0, strength * 0.4);
    const perf6m = Math.max(0, strength * 0.7);
    const perf12m = Math.max(0, strength * 1.1);
    const distance52w = -Math.max(2, 25 - strength * 0.4);
    const maxDrawdown63d = Math.max(5, 25 - strength * 0.3);
    rows.push({
      symbol: `${letter}${letter}${letter}-${pos}`,
      perf3m, perf6m, perf12m, distance52w, maxDrawdown63d,
      country: "US", theme: "Technology", sector: "Technology",
    });
  }
  return rows;
}

console.log("================================================================");
console.log("CASO 2 — 'toda la población en 1 grupo → mismo sectorScore'");
console.log("Fixture: 24 filas, todas theme='Technology'");
console.log("================================================================\n");

const universe = buildUniverse();

// 1. computeSectorScoresForRows sobre la población completa.
const sectorScoresByKey = computeSectorScoresForRows(universe);
console.log(`computeSectorScoresForRows(universe) keys: ${[...sectorScoresByKey.keys()].join(", ")}`);
console.log(`computeSectorScoresForRows(universe).get("Technology") = ${sectorScoresByKey.get("Technology")}`);

// 2. applySectorScores inyecta sectorScore a cada fila.
const enriched = applySectorScores(universe, sectorScoresByKey);
const sectorScores = enriched.map((r) => r.sectorScore);
const distinct = [...new Set(sectorScores)];

console.log(`\nsectorScore por fila (${sectorScores.length}):`);
enriched.forEach((r) => {
  console.log(`  ${r.symbol.padEnd(8)} sectorScore=${r.sectorScore}  groupStrengthScore=${r.groupStrengthScore}`);
});
console.log(`\nValores distintos: ${distinct.length} → [${distinct.join(", ")}]`);
console.log(`Uniforme entre las 24 filas: ${distinct.length === 1 ? "SÍ ✓" : "NO ✗"}`);
console.log(`Rango: [${Math.min(...sectorScores)}, ${Math.max(...sectorScores)}]`);

// 3. Verificación independiente con sectorScoreForGroup.
const manualGroup = sectorScoreForGroup(universe);
console.log(`\nVerificación independiente: sectorScoreForGroup(universe) = ${manualGroup}`);
console.log(`Coincide con el valor del patch: ${manualGroup === distinct[0] ? "SÍ ✓" : "NO ✗"}`);

// 4. Desglose de la fórmula.
const groupSize = universe.length;
const avg3 = universe.reduce((a, r) => a + (r.perf3m || 0), 0) / groupSize;
const avg6 = universe.reduce((a, r) => a + (r.perf6m || 0), 0) / groupSize;
const leaders = universe.filter((r) => (r.weinsteinScore ?? 0) >= 80 || (r.minerviniScore ?? 0) >= 80).length;
console.log(`\nDesglose de la fórmula:`);
console.log(`  groupSize=${groupSize}, avg3=${avg3.toFixed(2)}, avg6=${avg6.toFixed(2)}, leaders=${leaders}`);
console.log(`  raw = clamp(${groupSize}*10, 0, 25) + clamp(${avg3.toFixed(2)}, 0, 20) + clamp(${avg6.toFixed(2)}/2, 0, 20) + clamp(${leaders}*7, 0, 15)`);
console.log(`  raw = ${Math.min(groupSize * 10, 25)} + ${Math.min(avg3, 20).toFixed(2)} + ${Math.min(avg6 / 2, 20).toFixed(2)} + ${Math.min(leaders * 7, 15)}`);
console.log(`  raw = ${(Math.min(groupSize * 10, 25) + Math.min(avg3, 20) + Math.min(avg6 / 2, 20) + Math.min(leaders * 7, 15)).toFixed(2)}`);
console.log(`  final = clamp(raw, 0, 100) = ${manualGroup}`);

// 5. Sanity: el CONTRASTE con el comportamiento "por lote de 1".
console.log(`\n================================================================`);
console.log("CONTRASTE — sectorScore si las 24 filas se procesaran en lotes de 1");
console.log("(el peor caso del audit C2(a) — comportamiento del contrato viejo)");
console.log("================================================================\n");
const oldPerRow = universe.map((r) => {
  const size = 1;
  const perf3 = r.perf3m || 0;
  const perf6 = r.perf6m || 0;
  return Math.min(Math.min(size * 10, 25) + Math.min(perf3, 20) + Math.min(perf6 / 2, 20) + 0, 100);
});
console.log(`sectorScore por fila en lote de 1: [${oldPerRow.map((n) => n.toFixed(1)).join(", ")}]`);
console.log(`Valores distintos: ${[...new Set(oldPerRow)].length} → rango [${Math.min(...oldPerRow)}, ${Math.max(...oldPerRow)}]`);
console.log(`Diferencia máxima entre filas del MISMO grupo: ${(Math.max(...oldPerRow) - Math.min(...oldPerRow)).toFixed(2)} puntos (RUIDO de composición de lote)`);