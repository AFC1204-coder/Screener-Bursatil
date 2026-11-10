// Medición D1 (solo lectura, sobre CSV exportados con q.sh): cuánto cambiaría
// la etapa oficial (semanas cerradas) frente a la guardada en los nocturnos.
// Uso (desde la raíz del repo, todo de solo lectura):
//   D=$(mktemp -d); cp lib/weeklyStage.js $D/weeklyStage.mjs
//   research/auditoria-producto-2026-11/scripts/q.sh -At -F, -c "select substring(s.local_id from 17 for 10), r.symbol, coalesce(r.metrics->>'weeklyStageState',''), coalesce(r.metrics->>'weeklyStageWeek',''), coalesce(r.metrics->>'lastDate','') from scan_results r join scans s on s.id=r.scan_id where s.local_id ~ '^materialized:US:2026-10-1[0-8]:' and s.deleted_at is null" > $D/rows.csv
//   research/auditoria-producto-2026-11/scripts/q.sh -At -F, -c "select b.symbol, b.trade_date, b.high, b.low, b.close from daily_bars b where b.trade_date between '2024-06-01' and '2026-10-16' and b.symbol in (select distinct r.symbol from scan_results r join scans s on s.id=r.scan_id where s.local_id like 'materialized:US:2026-10-18%') order by 1,2" > $D/bars.csv
//   node research/auditoria-producto-2026-11/implementacion/d1-d2/medir_d1.mjs $D
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const dir = (process.argv[2] || ".").replace(/\/?$/, "/");
const { weeklyStageForBars } = await import(pathToFileURL(dir + "weeklyStage.mjs").href);
const bars = new Map();
for (const line of readFileSync(dir + "bars.csv", "utf8").split("\n")) {
  if (!line) continue;
  const [s, d, h, l, c] = line.split(",");
  if (!bars.has(s)) bars.set(s, []);
  bars.get(s).push({ date: d, high: +h, low: +l, close: +c });
}
const rows = readFileSync(dir + "rows.csv", "utf8").split("\n").filter(Boolean).map((l) => {
  const [scan, symbol, stage, week, lastDate] = l.split(",");
  return { scan, symbol, stage, week: week === "" ? null : +week, lastDate };
});
const byScan = new Map();
for (const r of rows) { if (!byScan.has(r.scan)) byScan.set(r.scan, []); byScan.get(r.scan).push(r); }
const FUTURE = "2099-01-01";
const result = {};
const official = new Map(); // scan -> Map(symbol -> state)
const openCalc = new Map();
for (const [scan, list] of [...byScan].sort()) {
  let n = 0, openMatch = 0, offDiff = 0, offDiffWhenOpenMatch = 0, weekDiff = 0, e2Off = 0, e2Stored = 0, provisionalDiff = 0;
  const off = new Map(); const op = new Map();
  for (const r of list) {
    const b = (bars.get(r.symbol) || []).filter((x) => x.date <= (r.lastDate || "9999"));
    if (b.length < 50) continue;
    n++;
    const openStage = weeklyStageForBars(b, { stageAsOfDate: FUTURE }); // semana en curso cuenta (comportamiento anterior)
    const offStage = weeklyStageForBars(b, { stageAsOfDate: scan });     // regla D1, referencia = fecha del nocturno
    off.set(r.symbol, offStage.state); op.set(r.symbol, openStage.state);
    const om = openStage.state === r.stage;
    if (om) openMatch++;
    if (offStage.state !== r.stage) { offDiff++; if (om) offDiffWhenOpenMatch++; }
    if (offStage.weekInStage !== r.week) weekDiff++;
    if (offStage.state === "stage2") e2Off++;
    if (r.stage === "stage2") e2Stored++;
    if (offStage.provisional && offStage.provisional.differsFromOfficial) provisionalDiff++;
  }
  official.set(scan, off); openCalc.set(scan, op);
  result[scan] = { filas: list.length, medidas: n, recalculoSemanaAbiertaCoincideConGuardado: openMatch, oficialDistintaDeGuardada: offDiff, deEllasConRecalculoFiel: offDiffWhenOpenMatch, weekInStageDistinto: weekDiff, e2Guardadas: e2Stored, e2Oficiales: e2Off, provisionalDistintaDeOficial: provisionalDiff };
}
console.table(result);
// Parpadeo: cambios entre nocturnos consecutivos (oficial vs semana abierta)
const scans = [...byScan.keys()].sort();
const flick = {};
for (let i = 1; i < scans.length; i++) {
  const a = scans[i - 1], b = scans[i];
  let offCh = 0, opCh = 0;
  for (const [s, st] of official.get(b)) { const p = official.get(a).get(s); if (p && p !== st) offCh++; }
  for (const [s, st] of openCalc.get(b)) { const p = openCalc.get(a).get(s); if (p && p !== st) opCh++; }
  flick[`${a}→${b}`] = { cambiosOficial: offCh, cambiosSemanaAbierta: opCh };
}
console.table(flick);
