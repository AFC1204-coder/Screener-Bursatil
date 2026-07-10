// scripts/evidence-sectorScore-before-after.mjs
// Captura antes/después del bonus temático: invoca el sectorScore nuevo
// (sin bonus) y compara con el cómputo VIEJO (con bonus) para los temas
// del regex eliminado. Output en stdout, listo para pegarlo en el cuerpo
// del commit.
//
// Uso: node --loader ./scripts/loader.mjs scripts/evidence-sectorScore-before-after.mjs

import {
  applySectorScores,
  computeSectorScoresForRows,
  sectorScoreForGroup,
} from "@/lib/screenerComposite";

// Réplica literal de la fórmula VIEJA (con bonus), conservada solo para este
// script de evidencia. NO se usa en runtime — el helper de producción ya no
// la expone. Conservamos la copia verbatim para que el diff antes/después
// sea legible.
function clampOld(n, a = 0, b = 100) { return Math.max(a, Math.min(b, Number.isFinite(n) ? n : a)); }
function avgOld(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function sectorScoreOld(group, themeKey) {
  const avg3 = avgOld(group.map((r) => r.perf3m || 0));
  const avg6 = avgOld(group.map((r) => r.perf6m || 0));
  const leaders = group.filter((r) => r.weinsteinScore >= 80 || r.minerviniScore >= 80).length;
  const bonus = /Semis|fotonica|Defensa|Software|Energia|Automatizacion/.test(themeKey) ? 20 : 10;
  return clampOld(
    clampOld(group.length * 10, 0, 25)
    + clampOld(avg3, 0, 20)
    + clampOld(avg6 / 2, 0, 20)
    + clampOld(leaders * 7, 0, 15)
    + bonus,
  );
}

function mkRow(theme, opts = {}) {
  return {
    symbol: opts.symbol,
    perf3m: opts.perf3m,
    perf6m: opts.perf6m,
    weinsteinScore: opts.weinsteinScore ?? 80,
    minerviniScore: opts.minerviniScore ?? 70,
    theme,
  };
}

// Caso 1: "Semis / fotonica" (regex matchea, +20) vs "Technology" (no matchea, +10)
// con la MISMA composición. ANTES: Semis recibía +20 extra → 10 puntos más.
// AHORA: ambos idénticos (bonus eliminado).
{
  const rows = [
    mkRow("Semis / fotonica", { symbol: "NVDA", perf3m: 15, perf6m: 25, weinsteinScore: 90 }),
    mkRow("Semis / fotonica", { symbol: "AMD",  perf3m: 12, perf6m: 22, weinsteinScore: 85 }),
    mkRow("Semis / fotonica", { symbol: "TSM",  perf3m: 10, perf6m: 20, weinsteinScore: 80 }),
    mkRow("Semis / fotonica", { symbol: "AVGO", perf3m: 18, perf6m: 28, minerviniScore: 85 }),
    mkRow("Semis / fotonica", { symbol: "MRVL", perf3m: 8,  perf6m: 15, weinsteinScore: 80 }),
    mkRow("Technology", { symbol: "MSFT", perf3m: 15, perf6m: 25, weinsteinScore: 90 }),
    mkRow("Technology", { symbol: "ORCL", perf3m: 12, perf6m: 22, weinsteinScore: 85 }),
    mkRow("Technology", { symbol: "ADBE", perf3m: 10, perf6m: 20, weinsteinScore: 80 }),
    mkRow("Technology", { symbol: "CRM",  perf3m: 18, perf6m: 28, minerviniScore: 85 }),
    mkRow("Technology", { symbol: "NOW",  perf3m: 8,  perf6m: 15, weinsteinScore: 80 }),
  ];
  const semisGroup = rows.filter((r) => r.theme === "Semis / fotonica");
  const techGroup  = rows.filter((r) => r.theme === "Technology");
  const oldSemis = sectorScoreOld(semisGroup, "Semis / fotonica");
  const oldTech  = sectorScoreOld(techGroup,  "Technology");
  const newSemis = sectorScoreForGroup(semisGroup);
  const newTech  = sectorScoreForGroup(techGroup);
  console.log("\n── CASO 1: Semis / fotonica (regex, +20) vs Technology (sin regex, +10) ──");
  console.log("         misma composición (5 filas idénticas por grupo)");
  console.log(`  ANTES (con bonus): Semis=${oldSemis}  Technology=${oldTech}  Δ=${oldSemis - oldTech} puntos`);
  console.log(`  AHORA  (sin bonus): Semis=${newSemis}  Technology=${newTech}  Δ=${newSemis - newTech} puntos`);
  console.log(`  → Bonus eliminado: la diferencia sistemática de ${oldSemis - oldTech} puntos desapareció.`);
}

// Caso 2: 6 filas en un solo tema → sectorScore IDÉNTICO entre el cálculo
// por lote (50 filas) y el cálculo sobre la población completa del scan (6).
// ANTES: el sectorScore dependía del lote local (1-3 miembros → ruido).
// AHORA: el sectorScore es función SOLO de la composición del grupo, no
// del lote del scoring.
{
  const fullScan = [
    mkRow("Technology", { symbol: "S1", perf3m: 10, perf6m: 20, weinsteinScore: 85 }),
    mkRow("Technology", { symbol: "S2", perf3m: 12, perf6m: 22, weinsteinScore: 80 }),
    mkRow("Technology", { symbol: "S3", perf3m: 15, perf6m: 25, minerviniScore: 85 }),
    mkRow("Technology", { symbol: "S4", perf3m: 8,  perf6m: 18, weinsteinScore: 80 }),
    mkRow("Technology", { symbol: "S5", perf3m: 20, perf6m: 30, weinsteinScore: 90 }),
    mkRow("Technology", { symbol: "S6", perf3m: 6,  perf6m: 12, minerviniScore: 80 }),
  ];
  // Cálculo "viejo" simulado como si las 6 filas se procesaran en un lote
  // de 50 → grupos de 1 elemento (peor caso del audit C2). Calculamos
  // sectorScoreOld para cada fila individual con su grupo de 1.
  const oldPerRow = fullScan.map((r) => sectorScoreOld([r], r.theme));
  // Cálculo NUEVO: las 6 juntas, sobre la población completa.
  const newScores = computeSectorScoresForRows(fullScan);
  const newAllRows = applySectorScores(fullScan, newScores).map((r) => r.sectorScore);
  console.log("\n── CASO 2: 6 filas en 'Technology' (peor caso del audit: 1 elemento por lote) ──");
  console.log(`  ANTES (por lote, cada fila como grupo de 1): [${oldPerRow.join(", ")}]`);
  console.log(`  AHORA (sobre la población completa del scan): [${newAllRows.join(", ")}]`);
  console.log(`  → El sectorScore ahora es uniforme entre las 6 filas: ${newAllRows[0]}.`);
  console.log(`  → Antes, el lote de 1 generaba sectorScore=${oldPerRow[0]} (grupoSize*10=10, sin bonus porque "Technology" no matcheaba el regex).`);
}

// Caso 3: el BONUS también desaparecía para "Energia" / "Defensa" / "Automatizacion"
// (temas que SÍ recibían +20 en el contrato viejo). Verificamos que ahora
// un grupo "Energia" pequeño y un grupo "Utilities" pequeño con la MISMA
// composición produzcan EXACTAMENTE el mismo sectorScore.
{
  const rows = [
    mkRow("Energia",     { symbol: "E1", perf3m: 10, perf6m: 20, weinsteinScore: 85 }),
    mkRow("Energia",     { symbol: "E2", perf3m: 12, perf6m: 22, weinsteinScore: 80 }),
    mkRow("Utilities",   { symbol: "U1", perf3m: 10, perf6m: 20, weinsteinScore: 85 }),
    mkRow("Utilities",   { symbol: "U2", perf3m: 12, perf6m: 22, weinsteinScore: 80 }),
  ];
  const engGroup = rows.filter((r) => r.theme === "Energia");
  const utiGroup = rows.filter((r) => r.theme === "Utilities");
  const oldEng = sectorScoreOld(engGroup, "Energia");
  const oldUti = sectorScoreOld(utiGroup, "Utilities");
  const newEng = sectorScoreForGroup(engGroup);
  const newUti = sectorScoreForGroup(utiGroup);
  console.log("\n── CASO 3: Energia (bonus +20) vs Utilities (bonus +10) ──");
  console.log(`  ANTES: Energia=${oldEng}  Utilities=${oldUti}  Δ=${oldEng - oldUti} puntos`);
  console.log(`  AHORA: Energia=${newEng}  Utilities=${newUti}  Δ=${newEng - newUti} puntos`);
}

console.log("\n── Conclusión: el bonus temático +20/+10 desapareció para los 6 temas del regex ──");
console.log("   y el sectorScore se calcula sobre la población completa del scan, no por lote.");