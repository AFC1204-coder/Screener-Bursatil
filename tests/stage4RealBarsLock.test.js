// Candado de regresión: etapa 4 con barras REALES congeladas hasta 2026-11-06.
// Los cuatro casos fueron confirmados a ojo por el dueño el 2026-11-12 (gráfico semanal con media de 30
// semanas). Fija lo que el motor dice hoy; no valida acierto más allá de esa lectura.
// ORCL también lo confirmó el dueño como etapa 4, pero con estas barras (desde abr-2025, ~74 semanas) el
// motor lo lee etapa 1 confirmada (media de 30 semanas con pendiente −1,8 %, bajo el umbral de «plana») y el
// nocturno dice etapa 4: desacuerdo abierto, fuera del candado.
// Etapa 3: sin candado a propósito. El dueño sostiene que una etapa 3 solo se confirma cuando acaba en
// etapa 4, y el motor hoy la llama «confirmada» con solo aplanarse la media tras una subida.

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { weeklyStageForBars } from "@/lib/weeklyStage";

const FIXTURE = JSON.parse(fs.readFileSync("tests/fixtures/stage4-real-bars-2026-11-06.json", "utf8"));
const OPTIONS = { stageReferenceDate: "2026-11-09" };

describe("candado de etapa 4 con barras reales (hasta 2026-11-06)", () => {
  it.each(["NFLX", "PDD", "BSX", "T"])("%s: etapa 4 confirmada", (symbol) => {
    const rows = FIXTURE.bars[symbol];
    expect(rows.at(-1)[0]).toBe("2026-11-06");
    const bars = rows.map(([date, high, low, close, volume]) => ({ date, high, low, close, volume })).reverse();
    const stage = weeklyStageForBars(bars, OPTIONS);
    expect(stage.state).toBe("stage4");
    expect(stage.confirmation).toBe("confirmed");
  });
});
