// Simula el efecto de las reglas candidatas sobre los 21. NO ajusta el detector:
// aplica las condiciones a posteriori sobre lo que v4 ya detectó.
import fs from "node:fs";
const out = JSON.parse(fs.readFileSync(new URL("../resultados/medicion-v4-corpus.json", import.meta.url),"utf8"));
// Nº de estructuras distintas al mover la ventana, medido por
// `estabilidad-ventana.mjs` con el barrido [60,80,100,120,140,160,180,200]
// — el mismo que admite el histórico del universo (243 barras).
// AVISO: con el barrido ampliado hasta 250, BEKE pasa de 2 a 3 estructuras y
// C6 lo mataría. La regla depende de cuánta historia haya: por eso no es fiable.
const ESTR = { "NDAQ-2025-11": 3, "BEKE-2026-08": 2, "PNC-2026-02": 2 };

const REGLAS = {
  C1_no_salta_su_suelo:  (r) => r.geo && r.geo.minFueraPct > 2,
  C2_minimos_no_perforan:(r) => r.geo && r.geo.perforacionPct > 1,
  C3_proceso_no_evento:  (r) => r.geo && (r.geo.tramoInfo[0].concentracion ?? 0) > 0.35,
  C4_reduccion_real:     (r) => r.geo && r.geo.tramoInfo.length > 1
                                && (1 - r.geo.tramoInfo[1].profPct / r.geo.tramoInfo[0].profPct) < 0.30,
  C5_profundidad_tiempo: (r) => r.geo && !r.geo.cumpleTiempo,
  C6_lectura_multiple:   (r) => (ESTR[r.id] ?? 1) >= 3,
};
const pad=(s,n)=>String(s).padEnd(n);

console.log("### QUÉ MATA CADA REGLA (sobre las 13 secuencias que v4 acepta) ###");
console.log(pad("regla",26)+pad("mata",7)+"casos");
for (const [nom, f] of Object.entries(REGLAS)) {
  const m = out.filter(r => r.v4==="BASE" && f(r));
  console.log(pad(nom,26)+pad(m.length,7)+m.map(r=>`${r.id.split("-")[0]}[${r.etiqueta}]`).join(" "));
}

function evalua(activas) {
  let ok=0, fp=[], fn=[];
  for (const r of out) {
    let base = r.v4 === "BASE";
    if (base) for (const n of activas) if (REGLAS[n](r)) { base = false; break; }
    if (base && r.etiqueta==="BASE") ok++;
    else if (!base && r.etiqueta==="NO") ok++;
    else if (base) fp.push(r.id.split("-")[0]); else fn.push(r.id.split("-")[0]);
  }
  return { ok, fp, fn };
}
const COMBIS = [[], ["C3_proceso_no_evento"], ["C4_reduccion_real"], ["C2_minimos_no_perforan"],
  ["C1_no_salta_su_suelo"], ["C5_profundidad_tiempo"], ["C6_lectura_multiple"],
  ["C3_proceso_no_evento","C6_lectura_multiple"],
  ["C3_proceso_no_evento","C1_no_salta_su_suelo"],
  ["C3_proceso_no_evento","C4_reduccion_real","C6_lectura_multiple"],
  ["C3_proceso_no_evento","C4_reduccion_real","C6_lectura_multiple","C1_no_salta_su_suelo"],
  Object.keys(REGLAS)];
console.log("\n### VEREDICTO CON CADA COMBINACIÓN ###");
console.log(pad("reglas activas",62)+pad("aciertos",10)+pad("FP",22)+"FN");
for (const c of COMBIS) {
  const e = evalua(c);
  console.log(pad(c.length? c.map(x=>x.split("_")[0]).join("+") : "(v4 tal cual)",62)
    +pad(`${e.ok}/21`,10)+pad(e.fp.join(" ")||"—",22)+(e.fn.join(" ")||"—"));
}
