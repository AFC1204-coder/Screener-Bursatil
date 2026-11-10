// lib/screenerHuntTape.jsx — cinta densa de caza (TAPE-1 variante A).
// Formato de fila: ticker · tema · spark · etapa·sem.N · RS · footprint VCP · máx 52s.

import { pct } from "@/lib/formatters";
import { chartPath } from "@/lib/screenerFormat";
import { canonicalRs } from "@/lib/rsCanonical";
import { reviewRsCompactCell } from "@/lib/reviewRsDisplay";
import { stageDisplayForRow } from "@/lib/stageDisplay";
import { vcpMinerviniLabel } from "@/lib/vcpMinerviniLabel";
import { isScreenerKeyboardTargetIgnored } from "@/lib/screenerResultKeyboard";
import { countryCode, stockUrl } from "@/lib/symbols";
import { ipoWatchRowKey } from "@/lib/mergeIpoDiscoveryRows";
import { rowDataAgeMark } from "@/lib/dataAge";

/** Copy humano de spark en Caza — sin jerga chartPreview / transporte. */
export const HUNT_TAPE_SPARK_COPY = Object.freeze({
  pending: "Cargando gráfico semanal",
  ready: "Gráfico semanal ~12 meses",
  empty: "Sin serie semanal",
});

export function huntTapeSparkTitle(status = "empty") {
  const key = status === "pending" || status === "ready" ? status : "empty";
  return HUNT_TAPE_SPARK_COPY[key];
}

// Marca discreta de precio atrasado (auditoría de filtros 2026-11, P1): la
// UNICA marca por fila. Sin columna ni texto nuevos: la miniatura se atenúa y
// su title dice de qué día es el precio. Umbral y cálculo, los del aviso de la
// lista (lib/dataAge.js → rowDataAgeMark). Al día → props de siempre.
export const HUNT_TAPE_STALE_PRICE_OPACITY = 0.45;

export function huntTapeSparkWrapProps(row = {}, sparkTitle = "", now = new Date()) {
  const mark = rowDataAgeMark(row, now);
  if (!mark) return { className: "huntTapeSparkWrap", title: sparkTitle };
  return {
    className: "huntTapeSparkWrap",
    title: sparkTitle ? `${sparkTitle} · ${mark.title}` : mark.title,
    style: { opacity: HUNT_TAPE_STALE_PRICE_OPACITY },
    "data-stale-price": mark.lastDate,
  };
}

const TAPE_SPARK_W = 128;
const TAPE_SPARK_H = 40;
const TAPE_SPARK_POINTS = 52;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sortedChartBars(bars = []) {
  return bars
    .filter((bar) => Number.isFinite(bar?.close))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function huntTapeSparkBars(row = {}) {
  const bars = sortedChartBars(row.chartPreview || []);
  if (bars.length < 2) return [];
  return bars.slice(-TAPE_SPARK_POINTS);
}

function stageNumberFromRow(row = {}) {
  const state = String(row.weeklyStageState || row.stage?.weekly?.state || "");
  const match = state.match(/^stage(\d)$/);
  if (match) return match[1];
  const display = stageDisplayForRow(row);
  if (!display?.word) return null;
  const wordMatch = String(display.word).match(/(\d)/);
  return wordMatch ? wordMatch[1] : null;
}

/**
 * Etapa · sem. N — notación de la cinta (no «Base / Con fuga»).
 * @returns {{ line: string, title: string }|null}
 */
export function huntTapeStageLine(row = {}) {
  const stageNum = stageNumberFromRow(row);
  const weeks = finite(row.weeklyStageWeek);
  if (!stageNum && !Number.isFinite(weeks)) return null;
  const parts = [];
  if (stageNum) parts.push(stageNum);
  if (Number.isFinite(weeks)) parts.push(`sem. ${Math.round(weeks)}`);
  const line = parts.join(" · ");
  return {
    line,
    title: stageNum
      ? `Etapa semanal ${stageNum}${Number.isFinite(weeks) ? ` · ${Math.round(weeks)} semanas en esta etapa` : ""}`
      : `Semanas en etapa: ${Math.round(weeks)}`,
  };
}

function contractionDepthsFromRow(row = {}) {
  const depths = [
    row.contraction1DepthPct,
    row.contraction2DepthPct,
    row.contraction3DepthPct,
  ].map(finite).filter(Number.isFinite);
  return depths;
}

/**
 * Footprint Minervini `XW Y/Z NT` (docs/vcp-footprint-notacion.md) desde
 * campos materializados del scan. No recalcula el motor VCP.
 *
 * El segmento `XW` (semanas de base) se OMITE: hoy no hay dato real. El
 * `baseWeeks` del escáner es min(65, nº de barras) / 5 (ventana fija de 65
 * sesiones en lib/setupPatterns.js), y como el nocturno guarda 400 barras por
 * símbolo vale 13 en el 100 % de las filas (3.287/3.287 en el nocturno US del
 * 2026-10-18). Pintar «13W» era un dato falso. Las fechas de los swings
 * (`contractionSwings`) tampoco sirven: solo existen en 38 filas y se buscan
 * dentro de esa misma ventana de 65 sesiones, así que nunca miden la base
 * desde su máximo izquierdo. Se reactivará con el detector de bases real
 * (docs/diseno-contracciones-2026-08-17.md). Auditoría 2026-11, propuesta 5.
 */
export function formatVcpFootprintFromRow(row = {}) {
  // Una sola fuente con la columna VCP de la tabla (vcpMinerviniLabel): N sale de
  // contractionCount y Z de lastContractionDepthPct, y con menos de 2 contracciones no hay huella.
  // Antes la cinta contaba solo las 3 profundidades guardadas: pintaba «x/x 1T» donde la tabla
  // no mostraba nada y rotulaba mal las bases de 4 o más contracciones.
  return vcpMinerviniLabel(row).label || null;
}

export const VCP_FOOTPRINT_WEEKS_NOTE = "Semanas de base: sin medir (falta el detector de bases)";

export function formatVcpFootprintTitle(row = {}) {
  if (!formatVcpFootprintFromRow(row)) return "Sin VCP";
  const depths = contractionDepthsFromRow(row);
  const count = Number(row.contractionCount);
  const ts = depths.map((d, i) => `T${i + 1}=${Math.round(d)}%`).join(" · ");
  const extra = Number.isFinite(count) && count > depths.length ? ` · ${count} contracciones en total` : "";
  return `Footprint · ${ts}${extra} · ${VCP_FOOTPRINT_WEEKS_NOTE}`;
}

export function huntTapeRsValue(row = {}) {
  const rs = canonicalRs(row);
  if (!rs.available) return { value: null, reason: rs.reason };
  return { value: Math.round(rs.value), reason: "" };
}

/**
 * Valor ausente en la cinta (rediseño 2026-11, paso 3): «—» en --ghost.
 * Lo ausente pierde tinta en vez de escribirse en palabras; el motivo
 * completo vive siempre en el title de la celda.
 */
export const HUNT_TAPE_ABSENT = "—";

const THEME_PLACEHOLDERS = new Set(["", "general", "sin tema", "sin sector", "sin industria"]);

function cleanThemeValue(value) {
  const text = String(value ?? "").trim();
  return THEME_PLACEHOLDERS.has(text.toLowerCase()) ? "" : text;
}

/**
 * Celda Tema de la cinta (paso 6): tema del scan o, si falta, sector. El
 * desglose tema · sector · industria vive en el title. Sin dato → «—».
 */
export function huntTapeThemeCell(row = {}) {
  const theme = cleanThemeValue(row.theme);
  const sector = cleanThemeValue(row.sector);
  const industry = cleanThemeValue(row.industry);
  const label = theme || sector;
  const parts = [theme, sector, industry].filter((value, index, arr) => value && arr.indexOf(value) === index);
  return { label, title: parts.length ? parts.join(" · ") : "Sin tema ni sector en el escaneo" };
}

/**
 * Celda RS de cinta: número, «—» ghost si falta (motivo en el title) o «…»
 * mientras la fila no está hidratada (pendiente ≠ ausente).
 */
export function huntTapeRsDisplay(row = {}) {
  const rs = canonicalRs(row);
  if (rs.available && Number.isFinite(Number(rs.value))) {
    return {
      text: String(Math.round(Number(rs.value))),
      title: "RS canónico semanal",
      missing: false,
      ghost: false,
    };
  }
  const cell = reviewRsCompactCell(rs);
  const pending = cell.state === "loading";
  return {
    text: pending ? cell.text : HUNT_TAPE_ABSENT,
    title: cell.title || cell.text,
    missing: true,
    ghost: !pending,
  };
}

/** Glifos de la marca del usuario (★ favorito · ●/◐/○ tu clasificación). */
export const HUNT_TAPE_USER_MARKS = Object.freeze({
  candidate: { glyph: "●", label: "Tu clasificación: Candidata", tone: "res" },
  watch: { glyph: "◐", label: "Tu clasificación: Vigilar", tone: "res" },
  reject: { glyph: "○", label: "Tu clasificación: Descartar", tone: "dis" },
  favorite: { glyph: "★", label: "Favorito", tone: "fav" },
});

/**
 * Marca del usuario a la izquierda del ticker. Un solo hueco: la clasificación
 * manda sobre el favorito (el title nombra ambas cuando coinciden).
 * @returns {{ glyph: string, title: string, tone: string }|null}
 */
export function huntTapeUserMark({ favorite = false, resolutionKey = "" } = {}) {
  const resolution = HUNT_TAPE_USER_MARKS[resolutionKey] && resolutionKey !== "favorite"
    ? HUNT_TAPE_USER_MARKS[resolutionKey]
    : null;
  if (resolution) {
    return {
      glyph: resolution.glyph,
      title: favorite ? `${HUNT_TAPE_USER_MARKS.favorite.label} · ${resolution.label}` : resolution.label,
      tone: resolution.tone,
    };
  }
  if (favorite) {
    const fav = HUNT_TAPE_USER_MARKS.favorite;
    return { glyph: fav.glyph, title: fav.label, tone: fav.tone };
  }
  return null;
}

/** Sufijo de mercado (mono) para filas no-US; null en US o sin código. */
export function huntTapeMarketSuffix(row = {}) {
  const code = String(row?.country || countryCode(row?.symbol) || "").trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code) || code === "US") return null;
  return code;
}

export function huntTapeDist52w(row = {}) {
  const value = finite(row.distance52w);
  if (!Number.isFinite(value)) return null;
  return { value, label: pct(value), hot: value <= -10 };
}

/** Etiqueta visible cuando falta distancia al máx. 52 semanas. */
export const HUNT_TAPE_DIST_EMPTY = "Sin máx.";
export const HUNT_TAPE_STAGE_EMPTY = "Sin etapa";

export function huntTapeRowKey(row = {}) {
  return ipoWatchRowKey(row);
}

export function huntTapeMoveFocus(focus, delta, length) {
  if (!length) return 0;
  return (focus + delta + length) % length;
}

export function huntTapeEnterSymbol({
  key,
  target,
  rows = [],
  focusIndex = 0,
  activeModalRow = null,
}) {
  if (key !== "Enter") return null;
  if (isScreenerKeyboardTargetIgnored(target)) return null;
  if (!rows.length || activeModalRow) return null;
  const row = rows[focusIndex];
  return row?.symbol ? String(row.symbol) : null;
}

export function huntTapeSparkPaths(bars = []) {
  const points = sortedChartBars(bars).slice(-TAPE_SPARK_POINTS);
  if (points.length < 2) return null;
  const w = TAPE_SPARK_W;
  const h = TAPE_SPARK_H;
  const pad = 3;
  const closes = points.map((p) => p.close);
  const ma = closes.map((_, i) => {
    const start = Math.max(0, i - 9);
    const slice = closes.slice(start, i + 1);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
  const values = [...closes, ...ma];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, max * 0.02);
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => pad + (1 - ((v - min) / range)) * (h - pad * 2);
  const pricePath = chartPath(points, "close", x, y);
  const maPoints = points.map((p, i) => ({ ...p, close: ma[i] }));
  const maPath = chartPath(maPoints, "close", x, y);
  const fill = `${pricePath} L${w - pad},${h} L${pad},${h} Z`;
  return { pricePath, maPath, fill };
}

// ── Panel lateral de lectura (rediseño 2026-11, paso 7) ───────────────────
// Todo sale de la fila ya cargada: ninguna petición nueva.

const PEEK_CHART_W = 340;
const PEEK_CHART_H = 120;
const PEEK_MA_WEEKS = 30;

/**
 * Gráfico del panel: cierre semanal de las últimas 52 barras de la miniatura
 * y MM30 calculada sobre TODA la serie servida (sin media parcial: donde no
 * hay 30 semanas detrás, no hay línea). Misma fuente que la miniatura.
 */
export function huntPeekChartPaths(bars = [], { w = PEEK_CHART_W, h = PEEK_CHART_H } = {}) {
  const all = sortedChartBars(bars);
  if (all.length < 2) return null;
  const withMa = all.map((bar, i) => {
    if (i < PEEK_MA_WEEKS - 1) return { ...bar, ma: null };
    let sum = 0;
    for (let j = i - PEEK_MA_WEEKS + 1; j <= i; j += 1) sum += all[j].close;
    return { ...bar, ma: sum / PEEK_MA_WEEKS };
  });
  const points = withMa.slice(-TAPE_SPARK_POINTS);
  const values = points.flatMap((p) => [p.close, p.ma]).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, max * 0.02);
  const pad = 4;
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => pad + (1 - ((v - min) / range)) * (h - pad * 2);
  const pricePath = chartPath(points, "close", x, y);
  const maPath = chartPath(points, "ma", x, y);
  return {
    w,
    h,
    pricePath,
    maPath,
    hasMa: points.some((p) => Number.isFinite(p.ma)),
    fill: `${pricePath} L${w - pad},${h} L${pad},${h} Z`,
  };
}

/** Contracciones de la huella VCP en prosa corta: «T1 28 % · T2 8 %». */
export function huntPeekVcpContractions(row = {}) {
  return contractionDepthsFromRow(row)
    .map((depth, i) => `T${i + 1} ${Math.round(depth)} %`)
    .join(" · ");
}

/**
 * Punto del glifo de curva de etapa (geometría §5 de la dirección visual:
 * base plana · subida · techo · caída). Sin etapa conocida → null (sin punto).
 */
const PEEK_STAGE_DOTS = Object.freeze({ 1: [18, 34], 2: [44, 18], 3: [64, 10], 4: [94, 30] });
export const HUNT_PEEK_CURVE_PATH = "M4,34 L30,34 C40,34 42,10 54,10 L74,10 C84,10 86,34 96,34 L116,34";

export function huntPeekStageDot(row = {}) {
  const stage = stageNumberFromRow(row);
  return PEEK_STAGE_DOTS[stage] || null;
}

/** Número de etapa semanal («1».«4») o null — mismo lector que la cinta. */
export function huntTapeStageNumber(row = {}) {
  return stageNumberFromRow(row);
}

/**
 * Motivo de inclusión: por qué la fila está en esta cola. Sale de la vista
 * activa, no de un juicio del sistema (no hay veredicto por fila).
 */
export function huntPeekInclusion({ queue = null, presetName = "", sinceLabel = "" } = {}) {
  if (queue?.kind === "favorites") return "En tus favoritos";
  if (queue?.label) return sinceLabel ? `En «${queue.label}» desde el ${sinceLabel}` : `En «${queue.label}»`;
  return presetName ? `Pasa «${presetName}»` : "";
}

function isInteractiveKeyTarget(target) {
  if (!target || typeof target !== "object" || !target.tagName) return false;
  if (isScreenerKeyboardTargetIgnored(target)) return true;
  const tag = String(target.tagName).toUpperCase();
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  const role = typeof target.getAttribute === "function" ? target.getAttribute("role") : "";
  return role === "button" || role === "menuitem" || role === "tab";
}

/**
 * Teclas del panel lateral sobre la cinta. Space alterna, → abre, ← y Esc
 * cierran. Sobre un control (botón, enlace, summary, campo) no actúa: Space
 * debe seguir pulsando el botón enfocado.
 * @returns {"toggle"|"open"|"close"|null}
 */
export function huntTapePeekKeyAction({ key, target = null, peekOpen = false, rowCount = 0 } = {}) {
  if (!rowCount) return null;
  if (key === "Escape" || key === "ArrowLeft") return peekOpen ? "close" : null;
  if (key !== " " && key !== "Spacebar" && key !== "ArrowRight") return null;
  if (isInteractiveKeyTarget(target)) return null;
  if (key === "ArrowRight") return peekOpen ? null : "open";
  return "toggle";
}

export function HuntTapeSparkline({ bars = [], className = "", status = "empty" }) {
  const paths = huntTapeSparkPaths(bars);
  const title = huntTapeSparkTitle(status);
  if (paths) {
    return (
      <svg
        className={`huntTapeSpark ${className}`.trim()}
        viewBox={`0 0 ${TAPE_SPARK_W} ${TAPE_SPARK_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={HUNT_TAPE_SPARK_COPY.ready}
        title={HUNT_TAPE_SPARK_COPY.ready}
      >
        <path className="huntTapeSparkFill" d={paths.fill} />
        <path className="huntTapeSparkMa" d={paths.maPath} />
        <path className="huntTapeSparkPrice" d={paths.pricePath} />
      </svg>
    );
  }
  if (status === "pending") {
    return (
      <span
        className={`huntTapeSparkPending ${className}`.trim()}
        role="status"
        aria-label={title}
        title={title}
      >
        <span className="huntTapeSparkSkeleton" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={`huntTapeSparkMissing ${className}`.trim()}
      role="img"
      aria-label={title}
      title={title}
    >
      Sin serie
    </span>
  );
}

export function HuntTapeModeToggle({ mode, onChange }) {
  return (
    <div className="huntTapeModeToggle chartPrefGroup" role="group" aria-label="Modo de mesa">
      <div className="chartSegmented">
        <button
          type="button"
          aria-pressed={mode === "caza"}
          className={mode === "caza" ? "active" : ""}
          onClick={() => onChange?.("caza")}
        >
          Caza
        </button>
        <button
          type="button"
          aria-pressed={mode === "audit"}
          className={mode === "audit" ? "active" : ""}
          onClick={() => onChange?.("audit")}
        >
          Auditoría
        </button>
      </div>
    </div>
  );
}

export function HuntTapeDensityToggle({ density, onChange }) {
  return (
    <div className="huntTapeDensityToggle chartPrefGroup" role="group" aria-label="Densidad de cinta">
      <div className="chartSegmented">
        <button
          type="button"
          aria-pressed={density === "compact"}
          className={density === "compact" ? "active" : ""}
          onClick={() => onChange?.("compact")}
        >
          Compacto
        </button>
        <button
          type="button"
          aria-pressed={density === "comfort"}
          className={density === "comfort" ? "active" : ""}
          onClick={() => onChange?.("comfort")}
        >
          Cómodo
        </button>
      </div>
    </div>
  );
}

export function huntTapeDrillUrl(symbol = "") {
  return stockUrl(symbol);
}

export function HuntTapeTickerCell({ row, onOpenStock, userMark = null }) {
  const placeholder = !row.symbol;
  const label = placeholder ? (row.companyName || "IPO vigilada") : row.symbol;
  const market = placeholder ? null : huntTapeMarketSuffix(row);
  const name = placeholder ? "" : String(row.companyName || row.name || "").trim();
  return (
    <span className="huntTapeTicker">
      <span
        className={`huntTapeMark${userMark ? ` huntTapeMark--${userMark.tone}` : ""}`}
        title={userMark?.title}
        aria-label={userMark?.title}
        role={userMark ? "img" : undefined}
        aria-hidden={userMark ? undefined : true}
      >
        {userMark?.glyph || ""}
      </span>
      {placeholder ? (
        <span className="huntTapeTickerSymbol">{label}</span>
      ) : (
        <a
          className="huntTapeTickerSymbol"
          href={huntTapeDrillUrl(row.symbol)}
          onPointerDown={() => onOpenStock?.(row)}
          onClick={(event) => {
            event.stopPropagation();
            onOpenStock?.(row);
          }}
        >
          {row.symbol}
        </a>
      )}
      {market ? <span className="huntTapeMarket">{market}</span> : null}
      {name && name !== label ? <span className="huntTapeName" title={name}>{name}</span> : null}
    </span>
  );
}
