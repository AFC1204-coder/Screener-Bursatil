// lib/screenerColumns.jsx — definición ÚNICA de las columnas de la tabla de
// resultados del screener (docs/principios-producto.md, principio 7).
//
// Escritorio (lib/screenerTable.jsx) y móvil (lib/screenerMobile.jsx) leen
// SCREENER_COLUMNS de aquí: añadir o quitar una columna es editar esta lista,
// no reescribir dos JSX. Antes las columnas vivían incrustadas en el JSX de
// cada superficie y por eso divergían.
//
// Reglas que este módulo hace cumplir:
//   - Principio 1: nada de veredictos ni vocabulario de acción. Las siete
//     columnas describen estado, no recomiendan.
//   - Principio 3 / 7: un dato que no existe se muestra como GUION con un
//     icono de información que explica por qué falta — nunca como cero, nunca
//     como etiqueta de estado en la fila.
//   - Principio 5: la metodología no se repite por fila. La leyenda de cada
//     columna vive en su cabecera (`legend`), una sola vez.
//
// Los datos retirados de la tabla (Minervini, Weinstein numérico, RS Quality,
// deterioro, SMA50, RS país/grupo, auditoría) SIGUEN calculándose y
// guardándose: solo dejan de mostrarse aquí. Viven en la ficha del valor.

import Link from "next/link";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { cap, pct } from "@/lib/formatters";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { canonicalRs } from "@/lib/rsCanonical";
import { countryRs } from "@/lib/countryRs";
import { themeRs } from "@/lib/themeRs";
import { canonicalRsDisclosure } from "@/lib/rsEngines";
import { UNRELIABLE_AUDIT_STATUS } from "@/lib/scanLightProjection";
import { STAGE_CODE_VS_OPERATIVE_HINT, STAGE_LEGACY_REASON, STAGE_MISSING_REASON, stageConfirmationMark, stageDisplayForRow, stageWordForState } from "@/lib/stageDisplay";
import { CompanyMark, MiniSparkline } from "@/lib/screenerAtoms";
import { PERFORMANCE_PERIODS, normalizePerformancePeriod, performancePeriod } from "@/lib/screenerPeriods";
import { isIpoWatchPlaceholderSymbol } from "@/lib/mergeIpoDiscoveryRows";
import { countryName, marketFlag, stockUrl } from "@/lib/symbols";
import { weaknessScore } from "@/lib/stockRows";

// ── Periodos de rendimiento ────────────────────────────────────────────────
// Sustituyen a las tres columnas fijas 3M/6M/12M por UNA columna con selector
// GLOBAL (principio 7.5): por fila se perdería la comparación entre valores,
// que es para lo que sirve un screener. La lista vive en lib/screenerPeriods.js
// (sin JSX, para que la ordenación pueda leerla) y se re-exporta aquí para que
// la UI tenga una única puerta de entrada a la definición de la tabla.
export {
  DEFAULT_PERFORMANCE_PERIOD,
  PERFORMANCE_PERIODS,
  normalizePerformancePeriod,
  performancePeriod,
} from "@/lib/screenerPeriods";

// ── Dato ausente ───────────────────────────────────────────────────────────
// Un guion + icono de información que explica POR QUÉ falta ese dato en ESE
// valor. Es la única excepción del principio 5 a "la metodología en un solo
// sitio": explicar el método es redundante, explicar una ausencia concreta no.
export function MissingValue({ reason = "" }) {
  return <span className="cellMissing">
    <span aria-hidden="true">–</span>
    <span className="srOnly">Sin dato</span>
    {reason ? <InfoHint text={reason} /> : null}
  </span>;
}

// Métricas cuyo valor existe pero NO es fiable: la auditoría objetiva las
// marca como divergentes o no verificables contra la serie de precios. Se
// muestran como ausentes con su motivo — es calidad de dato, no opinión
// (principio 7, "cómo se muestra un dato no fiable").
//
// El criterio vive en lib/scanLightProjection.js, no aquí: la fila ligera del
// escaneo nocturno guarda ese mismo veredicto resumido en `metricAuditFlags`
// en vez de la auditoría entera (16 KB/fila). Con dos copias del Set, cambiar
// el criterio en un sitio dejaría la celda y la fila diciendo cosas distintas.
function auditIssueCopy(status = "") {
  if (status === "mismatch") return "Dato no fiable: el valor guardado no coincide con el recalculado sobre la serie de precios de este valor.";
  if (status === "missing-source") return "Dato no fiable: falta la serie de precios sobre la que se comprueba este valor.";
  return "Dato no fiable: no se ha podido comprobar contra la serie de precios de este valor.";
}

function auditIssueReason(row, metricKey) {
  const audit = objectiveMetricAuditStatusForRow(row)?.audit;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  // Fila ligera del escaneo nocturno: no trae la auditoría entera, trae el
  // mismo veredicto ya resumido (lib/scanLightProjection.js, metricAuditFlags).
  if (!items.length) {
    const flagged = row?.metricAuditFlags?.[metricKey] || row?.metrics?.metricAuditFlags?.[metricKey];
    return flagged ? auditIssueCopy(flagged) : "";
  }
  const item = items.find((entry) => entry?.key === metricKey);
  if (!item || !UNRELIABLE_AUDIT_STATUS.has(item.status)) return "";
  return auditIssueCopy(item.status);
}

// ── Etapa de Weinstein en una palabra ──────────────────────────────────────
// Presentación pura: lee la clasificación que ya calcula lib/weeklyStage.js.
// No recalcula nada. El diccionario vive en lib/stageDisplay.js para que la
// ficha del valor escriba la MISMA palabra que esta celda: antes la tabla
// decía "Base" y la ficha "Base / transición" para la misma clasificación.
export function stageWord(row = {}) {
  return stageWordForState(row.weeklyStageState || "", row.weeklyStageLabel || "");
}

export function stageDisplay(row = {}) {
  return stageDisplayForRow(row);
}

// Una etapa 1 o 3 tentativa es la misma etapa con menos confirmación, no una
// etapa distinta: se marca con un punto medio, no con otra palabra ni con
// otro color. Ver docs/diseno-salud-y-cambio-2026-08-16.md (D.15).
export function stageConfirmation(row = {}) {
  return stageConfirmationMark(row.weeklyStageConfirmation || "");
}

function moveTone(value) {
  if (!Number.isFinite(value)) return "";
  return value >= 0 ? "up" : "down";
}

function CountryFlag({ country = "" }) {
  const code = String(country || "").toUpperCase();
  const safeCode = /^[A-Z]{2}$/.test(code) ? code : "XX";
  return <span className="rowCountryFlag" title={countryName(safeCode)} aria-label={countryName(safeCode)}>
    {marketFlag(safeCode)}
  </span>;
}

function IpoWatchBadge() {
  return <span className="ipoWatchBadge" title="Vigilada en IPO Radar sin fila de scan">Vigilada</span>;
}

// ── Las siete columnas ─────────────────────────────────────────────────────
// Cada entrada define: cabecera, leyenda (una sola vez, en el <th>), clave de
// ordenación, y cómo se pinta la celda. `ctx` lleva el periodo activo y los
// callbacks de fila. Añadir una columna = añadir una entrada aquí.
export const SCREENER_COLUMNS = [
  {
    key: "ticker",
    label: () => "Ticker",
    title: "Símbolo, país y forma del gráfico de las últimas sesiones.",
    align: "left",
    className: "colTicker",
    sortKey: null,
    cell: (row, ctx = {}) => {
      const placeholder = isIpoWatchPlaceholderSymbol(row.symbol);
      const tickerLabel = placeholder ? (row.companyName || "IPO vigilada") : row.symbol;
      return <div className="tickerCell">
      {placeholder ? <span className="starBtn starBtnDisabled" aria-hidden="true">★</span> : (
        <button
          type="button"
          className={`starBtn ${ctx.favoriteSymbols?.has(row.symbol) ? "on" : ""}`}
          onClick={(event) => { event.stopPropagation(); ctx.onFavorite?.(row); }}
          aria-label={`Guardar favorito ${row.symbol}`}
        >
          ★
        </button>
      )}
      <CompanyMark row={row} size="sm" />
      <span className="tickerIdentity">
        <span className="tickerLine">
          {placeholder
            ? <span className="ticker tickerPlaceholder">{tickerLabel}</span>
            : <Link className="ticker" href={stockUrl(row.symbol)} onPointerDown={() => ctx.onOpenStock?.(row)} onClick={() => ctx.onOpenStock?.(row)}>{row.symbol}</Link>}
          <CountryFlag country={row.country} />
          {row.ipoWatchOnly ? <IpoWatchBadge /> : null}
        </span>
        <span className="tickerName" title={row.companyName || row.symbol}>{row.companyName || row.symbol}</span>
      </span>
      {Array.isArray(row.chartPreview) && row.chartPreview.filter((bar) => Number.isFinite(bar?.close)).length > 1
        ? <MiniSparkline bars={row.chartPreview} className="rowSparkline" />
        : <span className="rowSparkline rowSparklineMissing">
          <MissingValue reason={row.ipoWatchOnly ? "Vigilada local en IPO Radar: sin serie de scan todavía." : "Sin miniatura: no hay serie de precios suficiente para dibujarla."} />
        </span>}
    </div>;
    },
  },
  {
    key: "theme",
    label: () => "Tema",
    // Lo que la interfaz llamaba "sector" es en realidad el grupo temático,
    // que agrupa varios sectores estándar (principio 7.2).
    legend: "Grupo temático operativo: agrupa varios sectores estándar del proveedor.",
    align: "left",
    className: "colTheme",
    sortKey: null,
    cell: (row) => {
      const theme = String(row.theme || "").trim();
      if (!theme || theme === "Sin sector") {
        return <MissingValue reason="El proveedor no publica sector ni industria para este valor, así que no se puede agrupar por tema." />;
      }
      return <span className="themeTag" title={theme}>{theme}</span>;
    },
  },
  {
    key: "rs",
    label: () => "RS",
    // Declaración obligatoria del universo (spec MET-1 § Superficies): el
    // ranking privado se etiqueta con su moneda y su universo curado, nunca
    // como "global" a secas. El denominador es US-céntrico y eso se dice.
    legend: `${canonicalRsDisclosure()}. Fuerza relativa semanal: posición del valor, de 0 a 99, dentro del universo del ranking.`,
    align: "right",
    className: "colRs",
    sortKey: () => "rsGlobalPct",
    cell: (row) => {
      // Lector único: lib/rsCanonical.js. La tabla, la vista rápida, la ficha y
      // salud de mercado leen exactamente esta función.
      const rs = canonicalRs(row);
      if (!rs.available) return <MissingValue reason={rs.reason} />;
      return <b className={`cellNumber ${rs.value >= 75 ? "strong" : rs.value < 45 ? "weak" : ""}`.trim()}>{rs.value.toFixed(0)}</b>;
    },
  },
  {
    key: "rsCountry",
    label: () => "RS país",
    legend: "RS país · mercado del valor · universo privado curado. Ranking semanal intra-mercado en moneda local, sin FX.",
    align: "right",
    className: "colRsCountry",
    sortKey: () => "weeklyCountryRsRating",
    cell: (row) => {
      const crs = countryRs(row);
      if (!crs.available) return <MissingValue reason={crs.reason} />;
      return <b className={`cellNumber ${crs.value >= 75 ? "strong" : crs.value < 45 ? "weak" : ""}`.trim()}>{crs.value.toFixed(0)}</b>;
    },
  },
  {
    key: "rsTheme",
    label: () => "RS tema",
    legend: "RS tema · ocupación curada · universo privado curado. Ranking semanal intra-ocupación en USD (FX), solo las 12 themes curadas.",
    align: "right",
    className: "colRsTheme",
    sortKey: () => "weeklyThemeRsRating",
    cell: (row) => {
      const trs = themeRs(row);
      if (!trs.available) return <MissingValue reason={trs.reason} />;
      return <b className={`cellNumber ${trs.value >= 75 ? "strong" : trs.value < 45 ? "weak" : ""}`.trim()}>{trs.value.toFixed(0)}</b>;
    },
  },
  {
    key: "stage",
    label: () => "Etapa",
    legend: `Fase del ciclo de precio sobre el gráfico semanal (código MM30s). ${STAGE_CODE_VS_OPERATIVE_HINT}`,
    align: "left",
    className: "colStage",
    sortKey: null,
    cell: (row) => {
      const stage = stageDisplay(row);
      if (!stage) {
        return <MissingValue reason={STAGE_MISSING_REASON} />;
      }
      const confirmation = stage.confirmation;
      const title = stage.title || (stage.legacy ? STAGE_LEGACY_REASON : confirmation?.title || "");
      return (
        <span className={`stageTag stage-${stage.tone}${confirmation?.suffix ? " stageTagTentative" : ""}`} title={title || undefined}>
          <span className="stageTagWord">
            {stage.word}
            {confirmation?.mark ? <i className="stageTagMark" aria-label={confirmation.suffix}>{confirmation.mark}</i> : null}
          </span>
          {stage.qualifier ? <small className="stageTagQualifier">{stage.qualifier}</small> : null}
        </span>
      );
    },
  },
  {
    key: "performance",
    label: (ctx = {}) => performancePeriod(ctx.perfPeriod).columnLabel,
    title: "Variación del precio en el periodo elegido arriba. El selector es global para poder comparar valores entre sí.",
    align: "right",
    className: "colPerformance",
    sortKey: (ctx = {}) => normalizePerformancePeriod(ctx.perfPeriod),
    cell: (row, ctx = {}) => {
      const period = performancePeriod(ctx.perfPeriod);
      const value = row[period.key];
      const unreliable = auditIssueReason(row, period.key);
      if (unreliable) return <MissingValue reason={unreliable} />;
      if (!Number.isFinite(value)) {
        return <MissingValue reason={`Sin histórico suficiente para calcular el rendimiento a ${period.months} meses de este valor.`} />;
      }
      return <b className={`cellNumber ${moveTone(value)}`}>{pct(value)}</b>;
    },
  },
  {
    key: "distance52w",
    label: () => "Dist. máx 52s",
    title: "Distancia al máximo de las últimas 52 semanas. 0% es estar en máximos.",
    align: "right",
    className: "colDistance",
    sortKey: () => "distance52w",
    cell: (row) => {
      const value = row.distance52w;
      const unreliable = auditIssueReason(row, "distance52w");
      if (unreliable) return <MissingValue reason={unreliable} />;
      if (!Number.isFinite(value)) {
        return <MissingValue reason="Sin máximo de 52 semanas: el histórico de este valor no cubre el periodo completo." />;
      }
      return <b className={`cellNumber ${value >= -10 ? "near" : ""}`.trim()}>{pct(value)}</b>;
    },
  },
  {
    key: "marketCap",
    label: () => "Capitaliz.",
    title: "Capitalización bursátil del proveedor.",
    align: "right",
    className: "colCap",
    sortKey: () => "marketCap",
    cell: (row) => {
      const value = row.marketCap;
      if (!Number.isFinite(value) || value <= 0) {
        return <MissingValue reason="El proveedor no publica capitalización para este valor." />;
      }
      return <b className="cellNumber">{cap(value)}</b>;
    },
  },
];

// Columna contextual: solo cuando el preset/modo weakness o el orden activo
// usan weaknessScore. Evita ordenar por un número invisible (P6e).
const WEAKNESS_SCORE_COLUMN = {
  key: "weakness",
  label: () => "Deterioro",
  legend: "Evidencia técnica de debilidad o distribución. De 0 a 100; más alto significa más deterioro.",
  align: "right",
  className: "colWeakness",
  sortKey: () => "weaknessScore",
  cell: (row) => {
    const value = weaknessScore(row);
    const label = String(row.weaknessLabel || "").trim();
    if (!Number.isFinite(value)) {
      return <MissingValue reason="Sin señales suficientes para estimar el deterioro técnico de este valor." />;
    }
    return <span className="weaknessCell">
      <b className={`cellNumber ${value >= 65 ? "weak" : ""}`.trim()} title={label || undefined}>{value.toFixed(0)}</b>
      {label ? <small className="weaknessLabel">{label}</small> : null}
    </span>;
  },
};

export function screenerShowsWeaknessColumn(ctx = {}) {
  if (ctx.setupMode === "weakness") return true;
  if (ctx.sort === "weaknessScore") return true;
  return false;
}

export function screenerVisibleColumns(ctx = {}) {
  if (!screenerShowsWeaknessColumn(ctx)) return SCREENER_COLUMNS;
  const stageIndex = SCREENER_COLUMNS.findIndex((column) => column.key === "stage");
  if (stageIndex < 0) return [...SCREENER_COLUMNS, WEAKNESS_SCORE_COLUMN];
  return [
    ...SCREENER_COLUMNS.slice(0, stageIndex + 1),
    WEAKNESS_SCORE_COLUMN,
    ...SCREENER_COLUMNS.slice(stageIndex + 1),
  ];
}

export function screenerColumnLabel(column, ctx = {}) {
  return typeof column.label === "function" ? column.label(ctx) : column.label;
}

export function screenerColumnSortKey(column, ctx = {}) {
  return typeof column.sortKey === "function" ? column.sortKey(ctx) : column.sortKey;
}

// Criterios de orden que la tabla PUEDE mostrar: los de sus propias columnas.
// Derivados de SCREENER_COLUMNS para que ordenar por algo invisible deje de ser
// posible desde estos controles (principio 1: la ordenación debe ser elegible y
// su criterio, explícito).
export function screenerSortOptions(ctx = {}) {
  return screenerVisibleColumns(ctx)
    .map((column) => ({ column, value: screenerColumnSortKey(column, ctx) }))
    .filter((item) => Boolean(item.value))
    .map(({ column, value }) => ({
      value,
      label: column.key === "performance"
        ? performancePeriod(ctx.perfPeriod).sortLabel
        : screenerColumnLabel(column, ctx),
    }));
}

// ── Selector global de periodo ─────────────────────────────────────────────
// Mismo patrón visual que el selector de rango de la ficha del valor
// (app/ChartPreferences.jsx → .chartPrefGroup + .chartSegmented) para que el
// usuario reconozca el control. Al cambiar de periodo el orden lo sigue
// (principio 7.5): mirar a tres meses es ordenar por tres meses.
export function PerformancePeriodPicker({ value, onChange, className = "" }) {
  const active = normalizePerformancePeriod(value);
  return <div className={`chartPrefGroup screenerPeriodPicker ${className}`.trim()} role="group" aria-label="Periodo de rendimiento">
    <span className="chartPrefGroupLabel">Rendimiento</span>
    <div className="chartSegmented">
      {PERFORMANCE_PERIODS.map((item) => (
        <button
          type="button"
          key={item.key}
          className={item.key === active ? "active" : ""}
          onClick={() => onChange?.(item.key)}
          aria-pressed={item.key === active}
          title={`Rendimiento a ${item.months} meses · también ordena la tabla`}
        >
          {item.label}
        </button>
      ))}
    </div>
  </div>;
}
