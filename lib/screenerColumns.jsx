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
import { CompanyMark, MiniSparkline } from "@/lib/screenerAtoms";
import { PERFORMANCE_PERIODS, normalizePerformancePeriod, performancePeriod } from "@/lib/screenerPeriods";
import { countryName, marketFlag, stockUrl } from "@/lib/symbols";

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
const UNRELIABLE_AUDIT_STATUS = new Set(["mismatch", "unverified-value", "missing-source"]);

function auditIssueReason(row, metricKey) {
  const audit = objectiveMetricAuditStatusForRow(row)?.audit;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const item = items.find((entry) => entry?.key === metricKey);
  if (!item || !UNRELIABLE_AUDIT_STATUS.has(item.status)) return "";
  if (item.status === "mismatch") return "Dato no fiable: el valor guardado no coincide con el recalculado sobre la serie de precios de este valor.";
  if (item.status === "missing-source") return "Dato no fiable: falta la serie de precios sobre la que se comprueba este valor.";
  return "Dato no fiable: no se ha podido comprobar contra la serie de precios de este valor.";
}

// ── Etapa de Weinstein en una palabra ──────────────────────────────────────
// Presentación pura: lee la clasificación que ya calcula lib/weeklyStage.js.
// No recalcula nada.
const STAGE_WORDS = {
  stage2: { word: "Etapa 2", tone: "stage2" },
  stage4: { word: "Etapa 4", tone: "stage4" },
  base: { word: "Base", tone: "base" },
  mixed: { word: "Mixta", tone: "mixed" },
};

export function stageWord(row = {}) {
  const state = row.weeklyStageState || "";
  if (STAGE_WORDS[state]) return STAGE_WORDS[state];
  if (state === "insufficient_history") return null;
  // Filas de sesiones antiguas sin clasificación semanal: se derivan de la
  // etiqueta larga ya guardada, nunca de un cálculo nuevo.
  const label = String(row.weeklyStageLabel || "").toLowerCase();
  if (/stage 2|etapa 2/.test(label)) return STAGE_WORDS.stage2;
  if (/stage 4|etapa 4/.test(label)) return STAGE_WORDS.stage4;
  if (/base/.test(label)) return STAGE_WORDS.base;
  if (/mixta|debil/.test(label)) return STAGE_WORDS.mixed;
  return null;
}

function rsValue(row = {}) {
  // Solo el RS semanal sobre el universo. Si el símbolo no está en ese ranking
  // se muestra ausente en vez del percentil del lote: el sistema no afirma lo
  // que no sabe (docs/adr-rs-universo-us.md).
  return row.weeklyRsAvailable === true && Number.isFinite(row.weeklyRsRating) ? row.weeklyRsRating : null;
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

// ── Las siete columnas ─────────────────────────────────────────────────────
// Cada entrada define: cabecera, leyenda (una sola vez, en el <th>), clave de
// ordenación, y cómo se pinta la celda. `ctx` lleva el periodo activo y los
// callbacks de fila. Añadir una columna = añadir una entrada aquí.
export const SCREENER_COLUMNS = [
  {
    key: "ticker",
    label: () => "Ticker",
    legend: "Símbolo, país y forma del gráfico de las últimas sesiones.",
    align: "left",
    className: "colTicker",
    sortKey: null,
    cell: (row, ctx = {}) => <div className="tickerCell">
      <button
        type="button"
        className={`starBtn ${ctx.favoriteSymbols?.has(row.symbol) ? "on" : ""}`}
        onClick={(event) => { event.stopPropagation(); ctx.onFavorite?.(row); }}
        aria-label={`Guardar favorito ${row.symbol}`}
      >
        ★
      </button>
      <CompanyMark row={row} size="sm" />
      <span className="tickerIdentity">
        <span className="tickerLine">
          <Link className="ticker" href={stockUrl(row.symbol)} onPointerDown={() => ctx.onOpenStock?.(row)} onClick={() => ctx.onOpenStock?.(row)}>{row.symbol}</Link>
          <CountryFlag country={row.country} />
        </span>
        <span className="tickerName" title={row.companyName || row.symbol}>{row.companyName || row.symbol}</span>
      </span>
      {Array.isArray(row.chartPreview) && row.chartPreview.filter((bar) => Number.isFinite(bar?.close)).length > 1
        ? <MiniSparkline bars={row.chartPreview} className="rowSparkline" />
        : <span className="rowSparkline rowSparklineMissing">
          <MissingValue reason="Sin miniatura: no hay serie de precios suficiente para dibujarla." />
        </span>}
    </div>,
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
    legend: "Fuerza relativa semanal: posición del valor, de 0 a 99, frente a todo el universo escaneado.",
    align: "right",
    className: "colRs",
    sortKey: () => "rsGlobalPct",
    cell: (row) => {
      const value = rsValue(row);
      if (!Number.isFinite(value)) {
        return <MissingValue reason="Sin RS semanal: este símbolo no entra en el ranking del universo (histórico insuficiente o serie de precios discontinua)." />;
      }
      return <b className={`cellNumber ${value >= 75 ? "strong" : value < 45 ? "weak" : ""}`.trim()}>{value.toFixed(0)}</b>;
    },
  },
  {
    key: "stage",
    label: () => "Etapa",
    legend: "Fase del ciclo de precio sobre el gráfico semanal: describe dónde está el precio respecto a sus medias de largo plazo.",
    align: "left",
    className: "colStage",
    sortKey: null,
    cell: (row) => {
      const stage = stageWord(row);
      if (!stage) {
        return <MissingValue reason="Histórico semanal insuficiente para clasificar la etapa de este valor." />;
      }
      return <span className={`stageTag stage-${stage.tone}`}>{stage.word}</span>;
    },
  },
  {
    key: "performance",
    label: (ctx = {}) => performancePeriod(ctx.perfPeriod).columnLabel,
    legend: "Variación del precio en el periodo elegido arriba. El selector es global para poder comparar valores entre sí.",
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
    legend: "Distancia al máximo de las últimas 52 semanas. 0% es estar en máximos.",
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
    legend: "Capitalización bursátil del proveedor. Un valor de 200 millones y uno de 200.000 no se operan igual.",
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
  return SCREENER_COLUMNS
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
