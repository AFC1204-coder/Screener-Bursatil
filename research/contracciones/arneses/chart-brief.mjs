// Lectura breve para etiquetado: código MM30s + subestado estructural (Pre-fuga /
// Con fuga), alineado con lib/stageDisplay.js y la ficha de producto.
// No marca el gráfico ni expone veredicto del detector v4.

import { weeklyStageForBars } from "@/lib/weeklyStage.js";
import { weeklyStageStructureForBars } from "@/lib/weeklyStageStructure.js";
import { stageDisplayForRow, STAGE_CODE_VS_OPERATIVE_HINT } from "@/lib/stageDisplay.js";

function pivots(bars, r = 3) {
  const highs = [], lows = [];
  for (let i = r; i < bars.length - r; i++) {
    let isH = true, isL = true;
    for (let k = 1; k <= r; k++) {
      if (bars[i].h <= bars[i - k].h || bars[i].h <= bars[i + k].h) isH = false;
      if (bars[i].l >= bars[i - k].l || bars[i].l >= bars[i + k].l) isL = false;
    }
    if (isH) highs.push({ i, d: bars[i].d, p: bars[i].h });
    if (isL) lows.push({ i, d: bars[i].d, p: bars[i].l });
  }
  return { highs, lows };
}

function pullbacks(bars, lookback = 140) {
  const slice = bars.slice(-lookback);
  const { highs, lows } = pivots(slice);
  const legs = [];
  for (const h of highs) {
    const nextLow = lows.find((l) => l.i > h.i);
    if (!nextLow) continue;
    const depth = ((h.p - nextLow.p) / h.p) * 100;
    if (depth < 2.5) continue;
    legs.push({ max: h.d, min: nextLow.d, depthPct: depth });
  }
  return legs.slice(-5);
}

function fmtPct(n, digits = 1) {
  return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%` : "—";
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stageHeadline(display) {
  if (!display) return "Etapa sin clasificar";
  const confirm = display.confirmation?.suffix
    ? ` ${display.confirmation.mark}${display.confirmation.suffix}`
    : "";
  const base = display.qualifier
    ? `${display.word} · ${display.qualifier}`
    : display.word;
  return `${base}${confirm}`;
}

/** @returns {{ html: string, stage: string, structure: string, distResistancePct: number|null, rng26Pct: number|null, legs: number }} */
export function briefForSymbol(symbol, bars) {
  const daily = bars.map((b) => ({
    date: b.d, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
  }));
  const stage = weeklyStageForBars(daily);
  const struct = weeklyStageStructureForBars(daily, { weeklyStageState: stage.state });
  const display = stageDisplayForRow({
    weeklyStageState: stage.state,
    weeklyStageLabel: stage.label,
    weeklyStageConfirmation: stage.confirmation,
    weeklyStageStructure: struct.structure,
  });

  const legs = pullbacks(bars);
  const decreasing = legs.length >= 2
    && legs.every((l, i) => i === 0 || l.depthPct <= legs[i - 1].depthPct * 1.05);

  const lines = [];
  const questions = [];
  const windowFrom = bars[0]?.d || "";
  const windowTo = bars.at(-1)?.d || "";

  lines.push(
    `<strong>${esc(stageHeadline(display))}</strong>`
    + (stage.weekInStage ? ` · ~${stage.weekInStage} sem en ciclo MM30s` : "")
    + `. Ventana del gráfico: ${esc(windowFrom)} → ${esc(windowTo)} (${bars.length} sesiones).`
    + ` ${esc(STAGE_CODE_VS_OPERATIVE_HINT)}`,
  );

  if (struct.structure === "E2_ma_only") {
    const techo = Number.isFinite(struct.resistance) ? struct.resistance.toFixed(2) : "—";
    const techoDate = struct.resistanceDate ? struct.resistanceDate.slice(0, 10) : "—";
    lines.push(
      "Operativo: <strong>Pre-fuga</strong> — cierre aún bajo el techo de la caja semanal."
      + ` Techo ~${esc(techo)} (${esc(techoDate)}); distancia ${fmtPct(struct.distResistancePct)};`
      + ` rango 26s ${fmtPct(struct.rng26Pct, 0)}.`
      + " Lectura tipo E1 potencial / base larga sin ruptura (ancla MSI), no avance cazable.",
    );
    questions.push("¿Ves base / pre-fuga (POTENCIAL) o ya avance operable (Con fuga)?");
  } else if (struct.structure === "E2_structural") {
    lines.push(
      "Operativo: <strong>Con fuga</strong> — ruptura del techo con HH/HL semanal."
      + (Number.isFinite(struct.distResistancePct)
        ? ` Distancia al techo ${fmtPct(struct.distResistancePct)}; rango 26s ${fmtPct(struct.rng26Pct, 0)}.`
        : ""),
    );
    questions.push("¿La base que etiquetas es la primera post-fuga o una reconfiguración del avance?");
  } else if (struct.structure === "n/a" && struct.detail) {
    lines.push(`Subestado estructural: ${esc(struct.detail)}.`);
    if (stage.state === "stage1" || stage.state === "stage3") {
      questions.push("¿Ves etapa lateral (E1) o transición tentativa?");
    }
  }

  if (stage.state === "stage1" || stage.state === "stage3") {
    lines.push(
      `Código MM30s = <strong>${esc(display?.word || stage.state)}</strong>.`
      + " Un patrón geométrico en etapa 1 o 3 no es el mismo setup que en etapa 2 (corpus: ORCL, ICE).",
    );
  }

  if (stage.slowMaSlopePct != null && stage.slowMaSlopePct < 0) {
    lines.push("Media de 30 semanas plana o girando abajo: filtro de contexto del corpus penaliza esto.");
  }

  if (legs.length === 0) {
    lines.push("Pullbacks medibles (&gt;2,5%): ninguno claro en la ventana reciente — o el gráfico va demasiado lineal/trending sin pausas.");
    questions.push("¿Ves alguna contracción que en lineal se «aplasta» y aquí en log sí se distingue?");
  } else {
    const tramos = legs.map((l) => `${l.max.slice(5)}→${l.min.slice(5)} (${l.depthPct.toFixed(1)}%)`).join(" · ");
    lines.push(
      `Pullbacks visibles (pivote diario, sin detector): ${esc(tramos)}.`
      + (decreasing
        ? " Profundidades decrecientes → <em>olor a VCP</em> (contracciones que se estrechan)."
        : " Profundidades no claramente decrecientes → más lateral/sierra que VCP clásico."),
    );
    if (legs.some((l) => l.depthPct < 8)) {
      questions.push("¿La última contracción es demasiado superficial para operar (cheat / ruido)?");
    }
  }

  questions.push("¿BASE, NO o POTENCIAL? ¿Operable o solo estructura?");
  const uniqQ = [...new Set(questions)].slice(0, 3);

  const html = `<aside class="brief">
  <h3>Lectura propuesta <span class="tag">borrador colaborativo</span></h3>
  ${lines.map((p) => `<p>${p}</p>`).join("\n  ")}
  <p class="q"><strong>Para contrastar contigo:</strong></p>
  <ul>${uniqQ.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
</aside>`;

  return {
    html,
    stage: display?.word || stage.label,
    structure: struct.label || struct.structure,
    distResistancePct: struct.distResistancePct ?? null,
    rng26Pct: struct.rng26Pct ?? null,
    legs: legs.length,
  };
}
