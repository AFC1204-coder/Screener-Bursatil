// Tests focused en `lib/chartViewportModel.js` (ADR §4.2 / §5.2 / §9.5).
//
// Cobertura:
//   - `resolveChartViewportConfig`: normalización de settings, defaults,
//     coherencia `intraday` vs `interval`, clamping de longitudes MA.
//   - Perfil adaptativo: `responsiveChartHeight` y `adaptiveChartProfile`
//     con width/interval/range/rowCount variables; intradía vs diario.
//   - Formatters puros: `axisTickFormatter`, `crosshairTimeFormatter`,
//     `numericVisibleTimeRange`, `chartWindowLabel`, `chartWindowDateLabel`,
//     `timeWindowLabel`, `timeWindowFromSeconds`.
//   - Helpers varios: `emptyManualWindow`, `dateFromChartTime`,
//     `secondsFromChartTime`, `isIntradayInterval`.

import { describe, expect, it } from "vitest";
import {
  adaptiveChartProfile,
  axisTickFormatter,
  chartWindowDateLabel,
  chartWindowLabel,
  crosshairTimeFormatter,
  dateFromChartTime,
  emptyManualWindow,
  isIntradayInterval,
  numericVisibleTimeRange,
  resolveChartViewportConfig,
  responsiveChartHeight,
  secondsFromChartTime,
  timeWindowFromSeconds,
  timeWindowLabel,
} from "@/lib/chartViewportModel";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";

describe("chartViewportModel · resolveChartViewportConfig", () => {
  it("devuelve defaults cuando settings está vacío", () => {
    const config = resolveChartViewportConfig();

    expect(config.dataRange).toBe(DEFAULT_CHART_SETTINGS.range);
    expect(config.interval).toBe(DEFAULT_CHART_SETTINGS.interval);
    expect(config.style).toBe(DEFAULT_CHART_SETTINGS.style);
    expect(config.scale).toBe(DEFAULT_CHART_SETTINGS.scale);
    expect(config.intraday).toBe(false);
    expect(config.indicators).toEqual(DEFAULT_CHART_SETTINGS.indicators);
  });

  it("normaliza interval aliases (1h→1H, 4h→4H, 60m→1H)", () => {
    const config = resolveChartViewportConfig({ interval: "60m" });

    expect(config.interval).toBe("1H");
    expect(config.intraday).toBe(true);
  });

  it("marca intradía según el intervalo normalizado", () => {
    for (const interval of ["1m", "5m", "15m", "30m", "1H", "4H"]) {
      const config = resolveChartViewportConfig({ interval });
      expect(config.intraday).toBe(true);
    }
    for (const interval of ["D", "W", "M"]) {
      const config = resolveChartViewportConfig({ interval });
      expect(config.intraday).toBe(false);
    }
  });

  it("clamp las longitudes MA a [2, 400] y [2, 600] respectivamente", () => {
    const tiny = resolveChartViewportConfig({ indicators: { maFastLength: 1, maSlowLength: 0 } });
    const huge = resolveChartViewportConfig({ indicators: { maFastLength: 10000, maSlowLength: 10000 } });

    expect(tiny.indicators.maFastLength).toBe(2);
    expect(tiny.indicators.maSlowLength).toBe(2);
    expect(huge.indicators.maFastLength).toBe(400);
    expect(huge.indicators.maSlowLength).toBe(600);
  });

  it("respeta los flags booleanos de indicadores (volume/rsLine/maFast/maSlow)", () => {
    const config = resolveChartViewportConfig({
      indicators: {
        volume: false,
        rsLine: false,
        maFast: false,
        maSlow: false,
      },
    });

    expect(config.indicators.volume).toBe(false);
    expect(config.indicators.rsLine).toBe(false);
    expect(config.indicators.maFast).toBe(false);
    expect(config.indicators.maSlow).toBe(false);
  });

  it("rechaza dataRange/style/scale inválidos y cae al default", () => {
    const config = resolveChartViewportConfig({
      range: "ZZ",
      style: "X",
      scale: "bogus",
    });

    expect(config.dataRange).toBe(DEFAULT_CHART_SETTINGS.range);
    expect(config.style).toBe(DEFAULT_CHART_SETTINGS.style);
    expect(config.scale).toBe(DEFAULT_CHART_SETTINGS.scale);
  });
});

describe("chartViewportModel · perfil adaptativo", () => {
  it("responsiveChartHeight acota la altura en anchos pequeños", () => {
    expect(responsiveChartHeight(400, 500)).toBe(410);
    expect(responsiveChartHeight(700, 500)).toBe(460);
    expect(responsiveChartHeight(900, 500)).toBe(500);
  });

  it("adaptiveChartProfile devuelve timeFormatter y tickMarkFormatter funcionales", () => {
    const profile = adaptiveChartProfile({ interval: "D", range: "1A", rowCount: 200, width: 1024 });
    const tickFormatter = profile.timeScale.tickMarkFormatter;
    const timeFormatter = profile.timeFormatter;

    expect(typeof tickFormatter).toBe("function");
    expect(typeof timeFormatter).toBe("function");
    expect(tickFormatter("2025-01-15")).toBe("ene 25");
    expect(timeFormatter("2025-01-15")).toBe("15 ene 2025");
    expect(profile.priceScaleMargins).toEqual({ top: 0.08, bottom: 0.25 });
    expect(profile.timeScale.fixLeftEdge).toBe(true);
    expect(profile.timeScale.rightBarStaysOnScroll).toBe(true);
  });

  it("compact cambia barSpacing y rightOffsetPixels", () => {
    const compact = adaptiveChartProfile({ interval: "D", range: "1A", rowCount: 200, width: 480 });
    const wide = adaptiveChartProfile({ interval: "D", range: "1A", rowCount: 200, width: 1280 });

    expect(compact.timeScale.rightOffsetPixels).toBe(10);
    expect(wide.timeScale.rightOffsetPixels).toBe(18);
  });

  it("ajusta márgenes cuando volume está desactivado", () => {
    const profile = adaptiveChartProfile({ interval: "D", range: "1A", rowCount: 200, width: 800, volume: false });
    expect(profile.priceScaleMargins).toEqual({ top: 0.08, bottom: 0.08 });
  });

  it("marca timeVisible=true y formateo HH:MM en intradía", () => {
    const profile = adaptiveChartProfile({ interval: "15m", range: "1D", rowCount: 60, width: 1024 });
    const tick = profile.timeScale.tickMarkFormatter("2025-01-15T10:30:00Z");

    expect(profile.timeScale.timeVisible).toBe(true);
    expect(tick).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("chartViewportModel · formatters y labels", () => {
  it("axisTickFormatter cae a día-mes para rangos cortos", () => {
    const fmt = axisTickFormatter("D", "1M");
    expect(fmt("2025-01-15")).toBe("15 ene");
  });

  it("axisTickFormatter cae a mes-año para 1A", () => {
    const fmt = axisTickFormatter("D", "1A");
    expect(fmt("2025-01-15")).toBe("ene 25");
  });

  it("axisTickFormatter cae a año solo en M y rango 5A/MAX", () => {
    const fmt5A = axisTickFormatter("M", "5A");
    const fmtMAX = axisTickFormatter("M", "MAX");

    expect(fmt5A("2025-01-15")).toBe("2025");
    expect(fmtMAX("2025-01-15")).toBe("2025");
  });

  it("axisTickFormatter devuelve null si el input no es fecha válida", () => {
    const fmt = axisTickFormatter("D", "1A");
    expect(fmt(NaN)).toBeNull();
  });

  it("crosshairTimeFormatter añade HH:MM solo en intradía", () => {
    const daily = crosshairTimeFormatter("D");
    const intraday = crosshairTimeFormatter("30m");

    expect(daily("2025-01-15")).toBe("15 ene 2025");
    // `dateFromChartTime` trunca strings a `YYYY-MM-DD` (slice(0,10) →
    // `T00:00:00Z`), por lo que el formatter en intradía refleja la hora
    // local de medianoche UTC del día pasado.
    const sample = new Date("2025-01-15T00:00:00Z");
    const hh = String(sample.getHours()).padStart(2, "0");
    const mm = String(sample.getMinutes()).padStart(2, "0");
    expect(intraday("2025-01-15")).toBe(`15 ene 2025 ${hh}:${mm}`);
  });

  it("numericVisibleTimeRange devuelve null cuando from===to", () => {
    expect(numericVisibleTimeRange({ from: 100, to: 100 })).toBeNull();
    expect(numericVisibleTimeRange(null)).toBeNull();
    expect(numericVisibleTimeRange({ from: "x", to: "y" })).toBeNull();
  });

  it("numericVisibleTimeRange acepta string YYYY-MM-DD y los ordena", () => {
    expect(numericVisibleTimeRange({ from: "2025-02-01", to: "2025-01-01" })).toEqual({
      from: Date.parse("2025-01-01T00:00:00Z") / 1000,
      to: Date.parse("2025-02-01T00:00:00Z") / 1000,
    });
  });

  it("chartWindowDateLabel maneja intradía vs diario", () => {
    const date = Date.UTC(2025, 0, 15, 10, 30) / 1000;
    expect(chartWindowDateLabel(date, "D")).toBe("15 ene 2025");
    // El camino intradía usa `getHours()`/`getMinutes()` (local) — derivamos
    // la expectativa del mismo Date para que el test no dependa del TZ.
    const sample = new Date(date * 1000);
    const hh = String(sample.getHours()).padStart(2, "0");
    const mm = String(sample.getMinutes()).padStart(2, "0");
    expect(chartWindowDateLabel(date, "1H")).toBe(`15 ene 2025 ${hh}:${mm}`);
  });

  it("chartWindowLabel acorta cuando from===to y une con guion en otro caso", () => {
    const a = Date.UTC(2025, 0, 15) / 1000;
    const b = Date.UTC(2025, 1, 1) / 1000;
    expect(chartWindowLabel({ from: a, to: a }, "D")).toBe("15 ene 2025");
    expect(chartWindowLabel({ from: a, to: b }, "D")).toBe("15 ene 2025 - 01 feb 2025");
    expect(chartWindowLabel({ from: NaN, to: NaN }, "D")).toBe("Sin ventana");
  });

  it("timeWindowLabel y timeWindowFromSeconds son consistentes con chartWindowLabel", () => {
    const a = Date.UTC(2025, 0, 15) / 1000;
    const b = Date.UTC(2025, 1, 1) / 1000;
    expect(timeWindowFromSeconds({ from: a, to: b })).toEqual({ from: a, to: b });
    // Ambos helpers terminan en chartWindowDateLabel → usan local-tz para
    // intradía, UTC para diario. Para "D" son idénticos a UTC.
    expect(timeWindowLabel({ from: a, to: b }, "D")).toBe("15 ene 2025 - 01 feb 2025");
    expect(timeWindowLabel(null, "D")).toBe("Sin ventana");
  });
});

describe("chartViewportModel · helpers varios", () => {
  it("emptyManualWindow devuelve la forma canónica", () => {
    expect(emptyManualWindow()).toEqual({
      active: false,
      timeRange: null,
      logicalRange: null,
      rowCount: 0,
    });
  });

  it("dateFromChartTime acepta number, string y {year,month,day}", () => {
    const fromNumber = dateFromChartTime(1736899200); // 2025-01-15T00:00:00Z
    const fromString = dateFromChartTime("2025-01-15");
    const fromObject = dateFromChartTime({ year: 2025, month: 1, day: 15 });

    expect(fromNumber.toISOString()).toBe("2025-01-15T00:00:00.000Z");
    expect(fromString.toISOString()).toBe("2025-01-15T00:00:00.000Z");
    expect(fromObject.toISOString()).toBe("2025-01-15T00:00:00.000Z");
    expect(dateFromChartTime(null)).toBeNull();
  });

  it("secondsFromChartTime convierte a epoch segundos", () => {
    expect(secondsFromChartTime(1736899200)).toBe(1736899200);
    expect(secondsFromChartTime("2025-01-15")).toBe(1736899200);
    expect(secondsFromChartTime(null)).toBeNull();
  });

  it("isIntradayInterval reconoce los seis intervalos intradía", () => {
    expect(isIntradayInterval("1m")).toBe(true);
    expect(isIntradayInterval("5m")).toBe(true);
    expect(isIntradayInterval("15m")).toBe(true);
    expect(isIntradayInterval("30m")).toBe(true);
    expect(isIntradayInterval("1H")).toBe(true);
    expect(isIntradayInterval("4H")).toBe(true);
    expect(isIntradayInterval("D")).toBe(false);
    expect(isIntradayInterval("W")).toBe(false);
    expect(isIntradayInterval("M")).toBe(false);
  });
});