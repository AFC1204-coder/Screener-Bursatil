/**
 * Agrega warmPhases de node-profile.json en tabla de fases.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const profile = JSON.parse(readFileSync(path.join(process.cwd(), "research/filter-cpu-1/node-profile.json"), "utf8"));

const PHASE_LABELS = {
  qualityGate: "Preparación / quality gate",
  rescoreCheck: "Preparación / rescore check",
  sectorize: "Sectorize + derived scores",
  fastPathDecision: "Fast-path decision",
  splitByFilterRules: "filterAnalyzedRows · evaluación reglas",
  splitPrecomputed: "filterAnalyzedRows · screenPassed fast-path",
  regimeFilter: "Régimen / market health",
  postFilter: "Post-filter (weakness/RS/score)",
  sort: "Sort pipeline (filterAnalyzedRows)",
  diagnostics: "Diagnósticos / explainability scan",
  "vm.annotateRows": "Anotación fila (explain/audit/health)",
  "vm.applyViewFilters": "Filter families vista (chips)",
  "vm.clientSort": "Sort cliente (tabla)",
  "vm.decisionAuditScan": "Score/data-health audit scan",
  "vm.dataHealthSummary": "Data-health summary",
  "vm.scoreAuditSummary": "Score audit summary",
  "vm.arrayCopy": "Copia arrays ([...rows])",
  cacheLookup: "Hunt cache lookup",
};

const representative = profile.workflows.filter((w) => [
  "hunt-stage2-cold",
  "hunt-cache-hit",
  "toggle-momentum-off",
  "sort-rs",
  "period-6m",
  "hunt-deterioro-cold",
].includes(w.id));

const phaseAgg = new Map();
for (const wf of representative) {
  for (const [key, ms] of Object.entries(wf.warmPhases || {})) {
    if (key.endsWith("__calls")) continue;
    const bucket = phaseAgg.get(key) || { cold: [], warm: [], workflows: [] };
    bucket.cold.push(wf.coldPhases?.[key] || 0);
    bucket.warm.push(ms);
    bucket.workflows.push(wf.id);
    phaseAgg.set(key, bucket);
  }
}

const rows = [...phaseAgg.entries()].map(([key, bucket]) => {
  const warmMed = median(bucket.warm);
  const coldMed = median(bucket.cold);
  return {
    phase: PHASE_LABELS[key] || key,
    key,
    coldMs: Math.round(coldMed * 10) / 10,
    warmMs: Math.round(warmMed * 10) / 10,
    workflows: bucket.workflows.length,
  };
}).sort((a, b) => b.warmMs - a.warmMs);

const totalWarm = rows.reduce((s, r) => s + r.warmMs, 0);
const table = rows.map((r) => ({
  ...r,
  pctTotal: Math.round((r.warmMs / totalWarm) * 1000) / 10,
}));

writeFileSync(
  path.join(process.cwd(), "research/filter-cpu-1/phase-aggregate.json"),
  JSON.stringify({ totalWarmMs: Math.round(totalWarm), phases: table }, null, 2),
);
console.log(JSON.stringify({ totalWarmMs: Math.round(totalWarm), top: table.slice(0, 8) }, null, 2));

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
