// tests/globalRsSeriesEngine.test.js — la línea RS del gráfico usa SIEMPRE el
// motor de la tarjeta y del screener.
//
// Auditoría del gráfico 2026-11 (research/auditoria-grafico-2026-11/informe.md,
// H1): con el motor fijado por debajo de RS_LINE_MIN_WEEKS semanas, el
// selector de respaldo elegía «el motor con más semanas» —el europeo
// congelado— y la línea de AAPL terminaba en mayo en 72 mientras la tarjeta y
// el screener decían 82. Estos tests recorren la cadena entera con datos
// sintéticos: lector → proyección del gráfico → historia mínima → número de la
// tarjeta.
//
// OJO: la copia local de la base solo tiene 5-6 semanas del motor fijado, así
// que en local la línea muestra ausencia. Aquí se prueba con ≥8 semanas que,
// cuando el motor fijado tenga historia suficiente, la línea se dibuja y su
// último punto coincide con la tarjeta.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: () => ({
    configured: true,
    ownerId: "personal",
    url: "https://example.supabase.co",
    key: "test-key",
    missing: [],
  }),
  supabaseRequest: vi.fn(),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  toDate: (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  },
}));

import { supabaseRequest } from "@/lib/supabaseServer";
import { readGlobalRsSeriesForSymbol } from "@/lib/globalRs";
import { projectRsRatingSeries, RS_LINE_MIN_WEEKS, rsLineHistory } from "@/lib/chartSeriesModel";
import { canonicalBriefRs } from "@/lib/rsCanonical";
import { chartRsPropsFromWeeklyResponse } from "@/lib/chartRsRowProps";
import {
  LEGACY_EU_RS_ENGINE_VERSION,
  PRIVATE_GLOBAL_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";

const DAY = 86400;
// Viernes 2026-01-02 00:00 UTC.
const FIRST_FRIDAY = Date.UTC(2026, 0, 2) / 1000;

function isoDate(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function isoWeekKey(seconds) {
  const date = new Date(seconds * 1000);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / DAY / 1000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Barras diarias de lunes a viernes durante `weeks` semanas desde FIRST_FRIDAY.
function dailyBars(weeks) {
  const bars = [];
  for (let t = FIRST_FRIDAY - 4 * DAY; t <= FIRST_FRIDAY + weeks * 7 * DAY; t += DAY) {
    const weekday = new Date(t * 1000).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    bars.push({ time: t, date: isoDate(t), open: 10, high: 11, low: 9, close: 10.5, volume: 1000 });
  }
  return bars;
}

// Filas de rs_weekly_items, más reciente primero (orden real de la consulta).
function weeklyRows(engineVersion, weeks, { startWeek = 0, base = 50 } = {}) {
  return Array.from({ length: weeks }, (_, index) => {
    const t = FIRST_FRIDAY + (startWeek + index) * 7 * DAY;
    return {
      symbol: "AAPL",
      snapshot_date: isoDate(t),
      week_key: isoWeekKey(t),
      base_currency: "USD",
      engine_version: engineVersion,
      rank_index: 100 - index,
      rs_rating: base + index,
      rs_raw: 100 + index,
      sample_size: 5600,
      metrics: {},
    };
  }).reverse();
}

const INDICATORS = { rsLine: true };

describe("línea RS = motor fijado, siempre (datos sintéticos)", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it(`con ≥${RS_LINE_MIN_WEEKS} semanas del motor fijado, la línea se dibuja con ese motor y su último punto es el número de la tarjeta`, async () => {
    const pinnedWeeks = RS_LINE_MIN_WEEKS + 2;
    // El europeo congelado tiene MÁS semanas y valores distintos: antes ganaba.
    const legacy = weeklyRows(LEGACY_EU_RS_ENGINE_VERSION, 30, { base: 20 });
    const pinned = weeklyRows(PRIVATE_GLOBAL_RS_ENGINE_VERSION, pinnedWeeks, { startWeek: 20, base: 70 });
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: pinned[0].snapshot_date }])
      .mockResolvedValueOnce([...pinned, ...legacy]);

    const weekly = await readGlobalRsSeriesForSymbol("AAPL");
    expect(weekly.series).toHaveLength(pinnedWeeks);
    expect(weekly.series.every((point) => point.engineVersion === PRIVATE_GLOBAL_RS_ENGINE_VERSION)).toBe(true);

    // Proyección que usan el adaptador y el controller del gráfico.
    const bars = dailyBars(40);
    const points = projectRsRatingSeries(bars, weekly.series, INDICATORS, "D");
    const history = rsLineHistory(points);
    expect(history.sufficient).toBe(true);
    expect(history.weeks).toBe(pinnedWeeks);

    // Número de la tarjeta (brief: rating = ratingLatest del mismo lector).
    const cardRating = canonicalBriefRs({ rating: weekly.ratingLatest.rsRating, globalRsSeries: weekly.series });
    expect(points.at(-1).value).toBe(cardRating);
    expect(cardRating).toBe(70 + pinnedWeeks - 1);
    // Ningún valor de la línea sale del motor europeo (base 20..49).
    expect(points.every((point) => point.value >= 70)).toBe(true);
  });

  it("con menos semanas del motor fijado, NO cae al europeo: la línea queda en ausencia con las semanas reales", async () => {
    const legacy = weeklyRows(LEGACY_EU_RS_ENGINE_VERSION, 54, { base: 20 });
    const pinned = weeklyRows(PRIVATE_GLOBAL_RS_ENGINE_VERSION, 5, { startWeek: 30, base: 61 });
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: pinned[0].snapshot_date }])
      .mockResolvedValueOnce([...pinned, ...legacy]);

    const weekly = await readGlobalRsSeriesForSymbol("AAPL");
    expect(weekly.series).toHaveLength(5);
    expect(weekly.latest.engineVersion).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);

    const bars = dailyBars(40);
    const points = projectRsRatingSeries(bars, weekly.series, INDICATORS, "D");
    const history = rsLineHistory(points);
    // Lo que el controller convierte en «Sin línea RS: 5 semanas de histórico (mínimo 8)».
    expect(history.sufficient).toBe(false);
    expect(history.weeks).toBe(5);
    expect(weekly.ratingLatest.rsRating).toBe(65);
  });

  it("el cliente de /api/rs-weekly (vista rápida) recibe la misma serie del motor fijado", async () => {
    const pinned = weeklyRows(PRIVATE_GLOBAL_RS_ENGINE_VERSION, RS_LINE_MIN_WEEKS, { base: 40 });
    const legacy = weeklyRows(LEGACY_EU_RS_ENGINE_VERSION, 30, { base: 10 });
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: pinned[0].snapshot_date }])
      .mockResolvedValueOnce([...pinned, ...legacy]);

    const weekly = await readGlobalRsSeriesForSymbol("AAPL");
    const props = chartRsPropsFromWeeklyResponse({
      ok: true,
      series: weekly.series,
      latest: weekly.latest,
      global: { series: weekly.series, latest: weekly.latest },
      country: { series: [], latest: null },
      theme: { series: [], latest: null, themeKey: "" },
    });
    const list = Array.isArray(props?.globalRsSeries) ? props.globalRsSeries : [];
    expect(list).toHaveLength(RS_LINE_MIN_WEEKS);
    expect(list.every((point) => point.engineVersion === PRIVATE_GLOBAL_RS_ENGINE_VERSION)).toBe(true);
  });
});
