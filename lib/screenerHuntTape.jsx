// lib/screenerHuntTape.jsx — cinta densa de caza (TAPE-1 variante A).
// Formato de fila: ticker · spark · etapa·sem.N · RS · footprint VCP · máx 52s.

import { pct } from "@/lib/formatters";
import { chartPath } from "@/lib/screenerFormat";
import { canonicalRs } from "@/lib/rsCanonical";
import { stageDisplayForRow } from "@/lib/stageDisplay";
import { isScreenerKeyboardTargetIgnored } from "@/lib/screenerResultKeyboard";
import { CompanyMark } from "@/lib/screenerAtoms";
import { stockUrl } from "@/lib/symbols";
import { ipoWatchRowKey } from "@/lib/mergeIpoDiscoveryRows";

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
 * Footprint Minervini `XW Y/Z NT` desde campos materializados del scan.
 * No recalcula el motor VCP.
 */
export function formatVcpFootprintFromRow(row = {}) {
  const depths = contractionDepthsFromRow(row);
  if (!depths.length) return null;
  const baseW = finite(row.baseWeeks);
  if (!Number.isFinite(baseW) || baseW <= 0) return null;
  const first = Math.round(depths[0]);
  const last = Math.round(depths[depths.length - 1]);
  const n = depths.length;
  return `${Math.round(baseW)}W ${first}/${last} ${n}T`;
}

export function formatVcpFootprintTitle(row = {}) {
  const depths = contractionDepthsFromRow(row);
  if (!depths.length) return "Sin VCP";
  const ts = depths.map((d, i) => `T${i + 1}=${Math.round(d)}%`).join(" · ");
  return `Footprint · ${ts}`;
}

export function huntTapeRsValue(row = {}) {
  const rs = canonicalRs(row);
  if (!rs.available) return { value: null, reason: rs.reason };
  return { value: Math.round(rs.value), reason: "" };
}

export function huntTapeDist52w(row = {}) {
  const value = finite(row.distance52w);
  if (!Number.isFinite(value)) return null;
  return { value, label: pct(value), hot: value <= -10 };
}

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

export function HuntTapeSparkline({ bars = [], className = "" }) {
  const paths = huntTapeSparkPaths(bars);
  if (!paths) {
    return <span className={`huntTapeSparkMissing ${className}`.trim()} aria-hidden="true">–</span>;
  }
  return (
    <svg
      className={`huntTapeSpark ${className}`.trim()}
      viewBox={`0 0 ${TAPE_SPARK_W} ${TAPE_SPARK_H}`}
      role="img"
      aria-label="Gráfico semanal compacto"
    >
      <path className="huntTapeSparkFill" d={paths.fill} />
      <path className="huntTapeSparkMa" d={paths.maPath} />
      <path className="huntTapeSparkPrice" d={paths.pricePath} />
    </svg>
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

export function huntTapeDrillUrl(symbol = "") {
  return stockUrl(symbol);
}

export function HuntTapeTickerCell({ row, onOpenStock }) {
  const placeholder = !row.symbol;
  const label = placeholder ? (row.companyName || "IPO vigilada") : row.symbol;
  return (
    <span className="huntTapeTicker">
      <CompanyMark row={row} size="sm" />
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
    </span>
  );
}
