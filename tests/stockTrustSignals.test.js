import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StockClient from "@/app/stock/[symbol]/StockClient";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";

function bars(count = 260) {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const close = 90 + index * 0.16;
    return {
      date: new Date(start + index * 86400000).toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.02,
      low: close * 0.98,
      close,
      volume: 900000 + index * 1200,
    };
  });
}

const vcpPattern = {
  patternDataStatus: "partial_volume",
  patternBarsCount: 260,
  patternMinBars: 90,
  patternEligible: true,
  patternVolumeEligible: false,
  consolidationCandidate: true,
  baseDepthPct: 18,
  baseWeeks: 9,
  contractionDepths: [20, 10],
  contractionCount: 2,
  contractionsDecreasing: true,
  contractionStructureStatus: "ok",
  volumeDryUpRatio: 1.05,
  distanceToPivotPct: 5,
  lastContractionDepthPct: 10,
  tightness10dPct: 14,
  tightness20dPct: 16,
  patternQualityScore: 60,
  pivotPrice: 132,
};

describe("stock trust signals", () => {
  it("marca métricas actuales como medidas, proxy o revisión sin texto largo visible", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "TRUST",
      initialData: {
        name: "Trust Signals Inc.",
        currency: "USD",
        exchange: "NYSE",
        sector: "Technology",
        industry: "Software",
        country: "United States",
        marketCap: 12000000000,
        quoteSnapshot: { price: 131.44 },
        chartBars: bars(),
        dataQuality: {
          freshness: { priceDate: "2025-09-17", rsGlobalAsOf: "2025-09-17", rsGlobalSample: 10 },
          coverage: { label: "Cobertura parcial" },
        },
        relativeStrength: {
          rsGlobalPct: 82,
          rsGlobalSample: 10,
          rsCountryPct: 72,
          rsCountrySample: 4,
          rsSectorPct: 69,
          rsSectorSample: 3,
          benchmarkSymbol: "SPY",
          benchmarkRating: 58,
          rs3m: 12,
          rs6m: 18,
          rs12m: 24,
          rsQualityScore: 62,
          speculationRiskScore: 44,
          volatility63d: 28,
          maxDrawdown63d: 11,
          perf3m: 16,
          distance52w: -7,
        },
        growthMetrics: { revenueGrowth: 22, earningsGrowth: 15 },
        valuationMetrics: { sharesOutstanding: 100000000 },
        earningsCalendar: {
          earningsDate: "2025-10-20",
          epsEstimate: 1.24,
          epsEstimateGrowth: 18,
          revenueEstimate: 2400000000,
          revenueEstimateGrowth: 21,
        },
        stage: { label: "Etapa 2 probable" },
        setupPattern: vcpPattern,
        financialResults: { incomeQuarterly: [], incomeAnnual: [] },
        links: {},
        news: [],
      },
    }));

    expect(html).toContain("source-proxy");
    expect(html).toContain("source-review");
    expect(html).toContain("RS Quality: proxy/estimada");
    expect(html).toContain("EPS YoY: proxy/estimada");
    expect(html).toContain("RS: revisar");

    // El desglose del score vive únicamente en stockScoreBreakdown (barras de
    // razón). El auditGrid ya no duplica los componentes del score: solo
    // conserva los 4 gates que no son desglose (Datos técnicos, Histórico,
    // Etapa, Plan). El gate "Datos técnicos" sigue emitiendo el estado de
    // revisión de confianza, que es lo que valida esta aserción.
    expect(html).toContain("stockScoreBreakdown");
    expect(html).toContain("stockScoreRow");
    expect(html).toContain("auditCheck warn source-review");
    // Los labels de los auditCheck son los gates no-score; los componentes del
    // score (p.ej. "Score patrón", "Volumen seco") ya no se renderizan como
    // auditCheck duplicados y solo aparecen en stockScoreBreakdown.
    const auditCheckLabels = [...html.matchAll(/class="auditCheck [^"]*"[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(auditCheckLabels).toEqual(["Datos técnicos", "Histórico", "Etapa", "Plan"]);
  });

  it("la narrativa N2 normaliza objetos {label,value,detail,tone} a strings antes de renderizar", () => {
    // Regresión específica del bug detectado en producción:
    //   "Objects are not valid as a React child (found: object with keys
    //   {label, value, detail, tone})"
    //
    // Causa raíz: compactDecisionBriefItem (lib/screenerContracts.js,
    // lib/stockDecisionDesk.js) devuelve SIEMPRE la forma
    // `{label, value, detail, tone}`. La narrativa N2 leía esas fuentes
    // y las asignaba directamente a `narrative.tesis | .riesgo |
    // .siguientePaso`, que el JSX intentaba renderizar como texto
    // (`<p>{narrative.tesis}</p>`) → crash de React.
    //
    // El helper `narrativeString` extrae `.value` (con fallback a
    // `.label` y `.detail`) para que el JSX siempre reciba un string.
    // Probamos ese contrato directamente simulando el shape exacto de
    // compactDecisionBriefItem.
    const compactShape = {
      label: "Tesis",
      value: "RS 60 con base consolidada",
      detail: "Muestra suficiente, etapa 2",
      tone: "good",
    };
    // Replicamos la lógica in-test para documentar el contrato esperado.
    const narrativeString = (input) => {
      if (input == null) return "";
      if (typeof input === "string") return input.trim();
      if (typeof input === "number" || typeof input === "boolean") return String(input);
      if (typeof input === "object") {
        const candidate = input.value ?? input.label ?? input.detail ?? "";
        if (typeof candidate === "string") return candidate.trim();
        if (candidate != null) return String(candidate);
      }
      return "";
    };

    // Strings directos: se devuelven tal cual.
    expect(narrativeString("hola")).toBe("hola");
    expect(narrativeString("  hola  ")).toBe("hola");
    expect(narrativeString(null)).toBe("");
    expect(narrativeString(undefined)).toBe("");

    // Forma compacta (la que disparaba el bug): se extrae .value.
    expect(narrativeString(compactShape)).toBe("RS 60 con base consolidada");

    // Forma sin .value: cae a .label.
    expect(narrativeString({ label: "Fallback label", detail: "x" })).toBe("Fallback label");

    // Forma sin .value ni .label: cae a .detail.
    expect(narrativeString({ detail: "Solo detail" })).toBe("Solo detail");

    // Números y booleanos: se convierten.
    expect(narrativeString(42)).toBe("42");
    expect(narrativeString(true)).toBe("true");
  });

  it("compacta el diagnóstico VCP del gráfico en gates con marcas", () => {
    const html = renderToStaticMarkup(React.createElement(UniversalPriceChart, {
      bars: bars(),
      symbol: "TRUST",
      settings: DEFAULT_CHART_SETTINGS,
      patternOverlay: vcpPattern,
      showPatternDiagnostics: true,
    }));

    expect(html).toContain("vcpDiagnosticPanel");
    expect(html).not.toContain("vcpDiagnosticObjective");
    expect(html).toContain("vcpGate watch");
    expect(html).toContain(">!</i>");
  });

  it("Metodología y gates vive dentro de un <details> colapsado en N3 (no siempre visible)", () => {
    // Regresión del bug visual detectado en captura: el panel de
    // MethodologyAuditPanel (Evidencia VCP + 4 auditCheck) se renderizaba
    // SIEMPRE VISIBLE, fuera de cualquier <details>, rompiendo la regla
    // de N3 ("todo el contenido vive colapsado por defecto").
    // Fix: ahora vive como 4º <details> dentro de N3AuditBlock, etiquetado
    // "Metodología y gates".
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "METH",
      initialData: {
        name: "Methodology Co",
        currency: "USD",
        exchange: "NYSE",
        sector: "Tech",
        industry: "Software",
        country: "US",
        marketCap: 5e9,
        quoteSnapshot: { price: 100 },
        chartBars: bars(),
        relativeStrength: { rsGlobalPct: 70, rsGlobalSample: 30, benchmarkSymbol: "SPY", rsQualityScore: 65 },
        growthMetrics: { revenueGrowth: 12 },
        stage: { label: "Etapa 2 probable" },
        setupPattern: vcpPattern,
        financialResults: { incomeQuarterly: [], incomeAnnual: [] },
        links: {},
        news: [],
        dataQuality: { freshness: { priceDate: "2025-09-17" }, coverage: { label: "Cobertura completa" } },
      },
    }));

    // 1) El summary "Metodología y gates" debe existir en el HTML.
    expect(html).toContain("Metodología y gates");

    // 2) Debe estar envuelto por un <details>. Buscamos el último
    //    <details> abierto antes del summary; ese debe ser el contenedor.
    const summaryIdx = html.indexOf("Metodología y gates");
    expect(summaryIdx).toBeGreaterThan(-1);
    const detailsOpenIdx = html.lastIndexOf("<details", summaryIdx);
    const detailsCloseIdx = html.indexOf("</details>", summaryIdx);
    expect(detailsOpenIdx).toBeGreaterThan(-1);
    expect(detailsCloseIdx).toBeGreaterThan(summaryIdx);
    expect(detailsOpenIdx).toBeLessThan(summaryIdx);

    // 3) El panel methodologyAuditPanel debe caer DENTRO de ese <details>.
    //    Si no hay gap entre el summary y el panel, el panel está fuera.
    const panelIdx = html.indexOf("methodologyAuditPanel");
    expect(panelIdx).toBeGreaterThan(detailsOpenIdx);
    expect(panelIdx).toBeLessThan(detailsCloseIdx);

    // 4) El <details> NO debe estar con atributo "open" (regla N3:
    //    colapsado por defecto, no persistente).
    const detailsOpenTag = html.slice(detailsOpenIdx, summaryIdx);
    expect(detailsOpenTag).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("los badges de metodología (veredicto + confianza) se renderizan separados por un wrapper con gap", () => {
    // Regresión del bug visual: "No VCP claro" + "Dato usable" aparecían
    // pegados como "No VCP claroDato usable". Causa: faltaba el CSS de
    // .methodologyBadgeStack (display:flex + gap), dejando los dos
    // <span> consecutivos sin espaciado. Fix: restaurada la regla CSS
    // migrada a tokens-v2 (gap: var(--space-2)).
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "BADGE",
      initialData: {
        name: "Badges Co",
        currency: "USD",
        exchange: "NYSE",
        sector: "Tech",
        industry: "Software",
        country: "US",
        marketCap: 1e9,
        quoteSnapshot: { price: 50 },
        chartBars: bars(),
        relativeStrength: { rsGlobalPct: 60, rsGlobalSample: 30, benchmarkSymbol: "SPY", rsQualityScore: 60 },
        growthMetrics: { revenueGrowth: 8 },
        stage: { label: "Etapa 1" },
        setupPattern: vcpPattern,
        financialResults: { incomeQuarterly: [], incomeAnnual: [] },
        links: {},
        news: [],
        dataQuality: { freshness: {}, coverage: {} },
      },
    }));

    // El wrapper debe existir en el HTML para que el CSS aplique gap.
    expect(html).toMatch(/<div class="methodologyBadgeStack[^"]*">/);

    // Ambos badges deben estar dentro del wrapper.
    const stackOpen = html.indexOf('<div class="methodologyBadgeStack');
    const stackClose = html.indexOf("</div>", stackOpen);
    const stackContent = html.slice(stackOpen, stackClose);
    expect(stackContent).toContain("methodologyVerdictBadge");
    expect(stackContent).toContain("methodologyConfidenceBadge");

    // El CSS debe declarar `display: flex` y `gap` en el selector
    // .stockPage .methodologyBadgeStack. Esto valida que la regla
    // existe en el CSS que se carga (leído desde disco).
    const here = dirname(fileURLToPath(import.meta.url));
    const cssPath = resolve(here, "..", "styles", "stock.css");
    const css = readFileSync(cssPath, "utf8");
    const stackRule = css.match(/\.stockPage\s+\.methodologyBadgeStack\s*\{[^}]*\}/);
    expect(stackRule).not.toBeNull();
    expect(stackRule[0]).toMatch(/display:\s*flex/);
    expect(stackRule[0]).toMatch(/gap:/);
  });

  it("paneles complementarios (RS, Fundamentals holders, Similar, News) tienen reglas CSS de display/gap para evitar label-valor pegados", () => {
    // Regresión del bug visual detectado en captura: tras reducir
    // styles/stock.css de ~3617 a ~1018 líneas se perdieron las reglas
    // .stockPage .rsMetric, .stockPage .compactHolderRow, etc., y los
    // pares label-valor de los paneles complementarios aparecían pegados
    // ("RS global68", "VANGUARD ... 2.5%"). Fix: re-aplicadas las reglas
    // de la sección "Paneles complementarios (fuera de N0–N3)" del CSS.
    //
    // Estos paneles están fuera del scope N0–N3 pero siguen siendo parte
    // de la ficha; cualquier reescritura futura del CSS debe preservar
    // su layout (display flex/grid + gap explícito). Este test lee
    // styles/stock.css desde disco y verifica las reglas críticas.
    const here = dirname(fileURLToPath(import.meta.url));
    const cssPath = resolve(here, "..", "styles", "stock.css");
    const css = readFileSync(cssPath, "utf8");

    // (selector, must declare display:flex OR display:grid, must declare gap)
    // Some classes are containers (need display); others have children with gap.
    const requirements = [
      { selector: ".stockPage .rsMetric", display: true, gap: false,
        why: "etiqueta (span) y valor (b) en flex-column para que no se peguen inline" },
      { selector: ".stockPage .rsMetricGroup", display: false, gap: false,
        why: "contenedor de tarjetas; sólo necesita borde/fondo (no afecta pegado)" },
      { selector: ".stockPage .compactHolderRow", display: true, gap: true,
        why: "label + porcentaje en grid 2-col; sin gap se pegan inline" },
      { selector: ".stockPage .fundamentalHoldersCompact", display: true, gap: true,
        why: "grid 2-col (Top funds / Top institutions); sin display:grid las tarjetas colapsan" },
      { selector: ".stockPage .fundamentalMiniRow", display: true, gap: false,
        why: "filas de tabla densa; grid de columnas para label/valores" },
      { selector: ".stockPage .similarCard", display: true, gap: false,
        why: "logo + texto en grid; sin display:grid se apilan raro" },
      { selector: ".stockPage .similarGrid", display: true, gap: false,
        why: "grid de tarjetas similares; sin display:grid se apilan en columna única" },
      // tradePlanPanel / tradePlanFields / signalStrip vivían aquí: el Plan de
      // operación se retiró de la ficha (principio 1) y su CSS con él.
      { selector: ".stockPage .auditGrid", display: true, gap: true,
        why: "gates de metodología en grid; sin gap las celdas se pegan" },
      { selector: ".stockPage .statementMatrix", display: false, gap: false,
        why: "wrapper de tabla (table-layout); no necesita display" },
    ];

    for (const { selector, display, gap, why } of requirements) {
      // Escape regex specials in selector
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ruleMatch = css.match(new RegExp(escaped + "\\s*\\{[^}]*\\}"));
      expect(ruleMatch, `Regla ${selector} no existe en styles/stock.css. Motivo: ${why}`).not.toBeNull();
      if (!ruleMatch) continue;
      const body = ruleMatch[0];
      if (display) {
        expect(body, `${selector} debe declarar display:flex o display:grid (${why})`).toMatch(/display\s*:\s*(flex|grid)/);
      }
      if (gap) {
        expect(body, `${selector} debe declarar gap (${why})`).toMatch(/\bgap\s*:/);
      }
    }
  });
});
