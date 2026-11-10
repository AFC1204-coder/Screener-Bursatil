// tests/weeklyStageClosedWeek.test.js — D1 de la auditoría de producto 2026-11.
//
// Decisión del usuario: la etapa OFICIAL se calcula solo sobre semanas
// cerradas; la semana en curso es «provisional» y nunca cambia el estado
// oficial. Antes `weeklyBarsFromDaily` metía en el cubo de la semana actual
// las sesiones que llevara y la etapa (y `weekInStage`) parpadeaban entre
// nocturnos: 288/127/389/67 cambios por par de noches en la semana 12-18 oct.

import { describe, expect, it } from "vitest";
import {
  closedWeeklyBarsFromDaily,
  isWeekClosed,
  splitClosedWeeks,
  weeklyStageFields,
  weeklyStageForBars,
} from "@/lib/weeklyStage";
import { weeklyStageStructureForBars } from "@/lib/weeklyStageStructure";

const DAY = 86400000;

// Serie diaria lun-vie desde el lunes 6-ene-2025. `closeFor(week, day)` da el
// cierre de la sesión (week = índice de semana, day = 0 lunes … 4 viernes).
// `until` es la última fecha incluida ("YYYY-MM-DD"); `skip` excluye días
// (festivos).
function dailySeries(closeFor, { until, skip = [] } = {}) {
  const start = Date.UTC(2025, 0, 6);
  const out = [];
  for (let i = 0; ; i += 1) {
    const ms = start + i * DAY;
    const date = new Date(ms).toISOString().slice(0, 10);
    if (date > until) break;
    const dow = new Date(ms).getUTCDay();
    if (dow === 0 || dow === 6 || skip.includes(date)) continue;
    const week = Math.floor(i / 7);
    const day = dow - 1;
    const close = closeFor(week, day);
    out.push({ date, open: close, high: close, low: close, close, volume: 1_000_000 });
  }
  return out;
}

// 60 semanas de subida limpia (etapa 2 confirmada) y, en la semana 60, un
// desplome a mitad de semana que, contado con la semana abierta, pone el
// precio bajo la media de 30 semanas (etapa 3 tentativa).
const RISE_WEEKS = 60;
function riseThenMidweekDrop(week, day) {
  if (week < RISE_WEEKS) return 100 + week * 2;
  // Semana 60: lunes y martes sostienen, miércoles y jueves se desploman.
  return day <= 1 ? 100 + RISE_WEEKS * 2 : 60;
}

// Fechas de la semana 60 (lunes 2-mar-2026 … viernes 6-mar-2026).
const WEEK60 = { mon: "2026-03-02", tue: "2026-03-03", wed: "2026-03-04", thu: "2026-03-05", fri: "2026-03-06", sat: "2026-03-07" };

describe("D1 · etapa oficial sobre semanas cerradas", () => {
  it("misma serie hasta el miércoles y hasta el jueves ⇒ etapa oficial y weekInStage idénticos", () => {
    const toWed = dailySeries(riseThenMidweekDrop, { until: WEEK60.wed });
    const toThu = dailySeries(riseThenMidweekDrop, { until: WEEK60.thu });
    const wed = weeklyStageForBars(toWed, { stageAsOfDate: WEEK60.wed });
    const thu = weeklyStageForBars(toThu, { stageAsOfDate: WEEK60.thu });

    expect(wed.state).toBe("stage2");
    expect(thu.state).toBe(wed.state);
    expect(thu.confirmation).toBe(wed.confirmation);
    expect(thu.weekInStage).toBe(wed.weekInStage);
    expect(thu.asOf).toBe(wed.asOf);
    expect(thu.officialWeekStart).toBe("2026-02-23"); // última semana cerrada
    expect(thu.weeklyBars).toBe(wed.weeklyBars);

    // La semana en curso queda como provisional, sin tocar el oficial.
    expect(thu.provisional).toMatchObject({ weekStart: WEEK60.mon, lastSessionDate: WEEK60.thu, sessions: 4 });
    expect(thu.provisionalState).toBe("stage3");
    expect(thu.provisional.differsFromOfficial).toBe(true);
  });

  it("el comportamiento anterior (semana abierta) sí habría cambiado la etapa: el test discrimina", () => {
    const toThu = dailySeries(riseThenMidweekDrop, { until: WEEK60.thu });
    // Con la semana dada por cerrada (referencia sábado) la caída cuenta.
    const asIfClosed = weeklyStageForBars(toThu, { stageAsOfDate: WEEK60.sat });
    expect(asIfClosed.state).toBe("stage3");
    expect(asIfClosed.provisional).toBeNull();
  });

  it("viernes festivo: la semana que acaba en jueves sigue provisional el viernes y se cierra el sábado", () => {
    const bars = dailySeries(riseThenMidweekDrop, { until: WEEK60.fri, skip: [WEEK60.fri] });
    expect(bars.at(-1).date).toBe(WEEK60.thu);
    const friday = weeklyStageForBars(bars, { stageAsOfDate: WEEK60.fri });
    expect(friday.officialWeekStart).toBe("2026-02-23");
    expect(friday.provisionalState).toBe("stage3");
    const saturday = weeklyStageForBars(bars, { stageAsOfDate: WEEK60.sat });
    // El festivo no deja la semana abierta: el sábado cierra con el jueves.
    expect(saturday.officialWeekStart).toBe(WEEK60.mon);
    expect(saturday.officialWeekLastSession).toBe(WEEK60.thu);
    expect(saturday.provisional).toBeNull();
    expect(saturday.state).toBe("stage3");
  });

  it("cambio de semana: una serie que acaba en viernes cierra el sábado, y una sesión nueva cierra la anterior", () => {
    const rise = (week) => 100 + week * 2;
    const toFri = dailySeries(rise, { until: WEEK60.fri });
    // El propio viernes (barra posiblemente parcial) aún no cierra.
    const fri = weeklyStageForBars(toFri, { stageAsOfDate: WEEK60.fri });
    expect(fri.officialWeekStart).toBe("2026-02-23");
    expect(fri.provisional?.weekStart).toBe(WEEK60.mon);
    const sat = weeklyStageForBars(toFri, { stageAsOfDate: WEEK60.sat });
    expect(sat.officialWeekStart).toBe(WEEK60.mon);
    expect(sat.weekInStage).toBe(fri.weekInStage + 1);
    // Lunes siguiente con su sesión: la semana 60 está cerrada por la sesión
    // posterior aunque la referencia sea ese mismo lunes.
    const toNextMon = dailySeries(rise, { until: "2026-03-09" });
    const mon = weeklyStageForBars(toNextMon, { stageAsOfDate: "2026-03-09" });
    expect(mon.officialWeekStart).toBe(WEEK60.mon);
    expect(mon.weekInStage).toBe(sat.weekInStage);
    expect(mon.provisional).toMatchObject({ weekStart: "2026-03-09", sessions: 1 });
  });

  it("isWeekClosed: regla de cierre", () => {
    expect(isWeekClosed(WEEK60.mon, { referenceDate: WEEK60.fri })).toBe(false);
    expect(isWeekClosed(WEEK60.mon, { referenceDate: WEEK60.sat })).toBe(true);
    expect(isWeekClosed(WEEK60.mon, { latestSessionDate: "2026-03-09", referenceDate: WEEK60.wed })).toBe(true);
    expect(isWeekClosed(WEEK60.mon, { latestSessionDate: WEEK60.fri, referenceDate: WEEK60.fri })).toBe(false);
  });

  it("splitClosedWeeks y weeklyBarsFromDaily: la vista de gráfico conserva la semana en curso", () => {
    const toWed = dailySeries(riseThenMidweekDrop, { until: WEEK60.wed });
    const split = splitClosedWeeks(toWed, { stageAsOfDate: WEEK60.wed });
    expect(split.weeks[0].date).toBe(WEEK60.mon);
    expect(split.openWeek.date).toBe(WEEK60.mon);
    expect(split.closedWeeks[0].date).toBe("2026-02-23");
    expect(closedWeeklyBarsFromDaily(toWed, { stageAsOfDate: WEEK60.wed })).toHaveLength(split.weeks.length - 1);
  });

  it("weeklyStageFields expone la semana oficial y el provisional sin alterar el oficial", () => {
    const toThu = dailySeries(riseThenMidweekDrop, { until: WEEK60.thu });
    const fields = weeklyStageFields(weeklyStageForBars(toThu, { stageAsOfDate: WEEK60.thu }));
    expect(fields.weeklyStageState).toBe("stage2");
    expect(fields.weeklyStageWeekStart).toBe("2026-02-23");
    expect(fields.weeklyStageProvisionalState).toBe("stage3");
  });

  it("el subestado estructural también se calcula sobre semanas cerradas", () => {
    const toWed = dailySeries(riseThenMidweekDrop, { until: WEEK60.wed });
    const toThu = dailySeries(riseThenMidweekDrop, { until: WEEK60.thu });
    const wed = weeklyStageStructureForBars(toWed, { stageAsOfDate: WEEK60.wed });
    const thu = weeklyStageStructureForBars(toThu, { stageAsOfDate: WEEK60.thu });
    expect(thu.structure).toBe(wed.structure);
  });
});
