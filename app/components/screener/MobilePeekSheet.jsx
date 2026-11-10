"use client";

// Vista rápida móvil en hoja inferior (estudio móvil 2026-11, §2.4, paso 10).
// Cero peticiones: todo sale de la fila ya cargada y de la MISMA serie de la
// miniatura (`chartPreview`), como el panel de lectura de escritorio
// (HuntPeekPanel). Sin temporalidades intradía ni botonera de gráfico: la
// lectura fina con velas diarias es de la ficha. Abajo, al alcance del
// pulgar: tu clasificación, ‹ posición › y «Abrir ficha».

import MobileSheet from "@/app/components/screener/MobileSheet";
import { money, amount } from "@/lib/screenerFormat";
import { pct } from "@/lib/formatters";
import { canonicalRs } from "@/lib/rsCanonical";
import { rowDataAgeMark, rowLastDate } from "@/lib/dataAge";
import { STOCK_DECISION_ACTIONS } from "@/lib/stockDecisionResolution";
import { resolveHuntTapeSparkStatus } from "@/lib/scansChartPreviewHydrate";
import {
  HUNT_TAPE_ABSENT,
  formatVcpFootprintFromRow,
  formatVcpFootprintTitle,
  huntPeekChartPaths,
  huntPeekVcpContractions,
  huntTapeDrillUrl,
  huntTapeMarketSuffix,
  huntTapeRsDisplay,
  huntTapeSparkTitle,
  huntTapeThemeCell,
  HUNT_TAPE_USER_MARKS,
} from "@/lib/screenerHuntTape";
import { mobileDist52w, mobileShortDay, mobileStageCell } from "@/lib/screenerMobile";
import EntryBlock from "@/app/components/screener/EntryBlock";

const PEEK_W = 358;
const PEEK_H = 150;

function Ghost({ title }) {
  return <span className="huntTapeGhost" title={title}>{HUNT_TAPE_ABSENT}</span>;
}

function Fact({ label, children, sub = "", title = "" }) {
  return (
    <div className="mobilePeekFact">
      <dt>{label}</dt>
      <dd title={title || undefined}>{children}{sub ? <small>{sub}</small> : null}</dd>
    </div>
  );
}

export default function MobilePeekSheet({
  rows = [],
  index = -1,
  onClose,
  onStep,
  isFavorite = false,
  resolutionKey = "",
  chartPreviewDeferred = false,
  onFavorite,
  onResolveDecision,
  onOpenStock,
}) {
  const row = index >= 0 ? rows[index] : null;
  const open = Boolean(row?.symbol);
  if (!open) return <MobileSheet open={false} />;

  const market = huntTapeMarketSuffix(row);
  const name = String(row.companyName || row.name || "").trim();
  const closeDay = mobileShortDay(rowLastDate(row));
  const stale = rowDataAgeMark(row);
  const stage = mobileStageCell(row);
  const rs = huntTapeRsDisplay(row);
  const rsState = canonicalRs(row);
  const rsSub = rs.missing
    ? (rsState.hydrated ? "sin ranking" : "")
    : [rsState.weekKey ? rsState.weekKey.replace(/^\d{4}-/, "") : "", mobileShortDay(rsState.asOf)].filter(Boolean).join(" · ");
  const footprint = formatVcpFootprintFromRow(row);
  const dist = mobileDist52w(row);
  const perf3m = Number.isFinite(row.perf3m) ? pct(row.perf3m) : "";
  const capText = amount(row.marketCap, row.currency);
  const { label: theme, title: themeTitle } = huntTapeThemeCell(row);
  const chart = huntPeekChartPaths(row.chartPreview || [], { w: PEEK_W, h: PEEK_H });
  const chartStatus = resolveHuntTapeSparkStatus(row, { deferred: chartPreviewDeferred });
  const atStart = index <= 0;
  const atEnd = index >= rows.length - 1;

  const head = (
    <div className="mobilePeekId">
      <div className="mobilePeekIdLine">
        <b className="mobilePeekSymbol">{row.symbol}</b>
        {market ? <span className="huntTapeMarket">{market}</span> : null}
        <span className="mobilePeekName" title={name}>{name}</span>
      </div>
      <div className="mobilePeekPrice">
        {Number.isFinite(row.price) ? money(row.price, row.currency) : HUNT_TAPE_ABSENT}
        {closeDay ? <span> · cierre {closeDay}</span> : null}
        {stale ? <span className="mobileFresh" title={stale.title}> (atrasado)</span> : null}
      </div>
    </div>
  );

  const footer = (
    <>
      <div className="mobilePeekPager">
        <button type="button" className="mobileIconBtn" aria-label="Anterior" onClick={() => onStep?.(-1)} disabled={atStart}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <span className="mobilePeekPos" aria-live="polite">{index + 1} / {rows.length}</span>
        <button type="button" className="mobileIconBtn" aria-label="Siguiente" onClick={() => onStep?.(1)} disabled={atEnd}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      <a
        className="btn btnPrimary mobileSheetBtn mobileSheetBtnGrow"
        href={huntTapeDrillUrl(row.symbol)}
        onPointerDown={() => onOpenStock?.(row)}
        onClick={() => onOpenStock?.(row)}
      >
        Abrir ficha
      </a>
    </>
  );

  return (
    <MobileSheet open onClose={onClose} label={`Vista rápida de ${row.symbol}`} className="mobilePeekSheet" head={head} footer={footer}>
      {chart ? (
        <figure className="mobilePeekChart">
          <svg viewBox={`0 0 ${chart.w} ${chart.h}`} preserveAspectRatio="none" role="img" aria-label="Cierre semanal ~12 meses con media de 30 semanas">
            <path className="huntPeekChartFill" d={chart.fill} />
            {chart.hasMa ? <path className="huntPeekChartMa" d={chart.maPath} /> : null}
            <path className="huntPeekChartPrice" d={chart.pricePath} />
          </svg>
        </figure>
      ) : (
        <div className="mobilePeekChart mobilePeekChartEmpty" role="status">{huntTapeSparkTitle(chartStatus)}</div>
      )}
      <p className="mobilePeekCap">
        <span>Semanal · 12 meses{chart?.hasMa ? " · MM30" : ""}</span>
        <span title={themeTitle}>{theme}</span>
      </p>

      <dl className="mobilePeekFacts">
        <Fact label="Etapa" title={stage?.title} sub={stage?.qualifier}>
          {stage?.text ? stage.text.replace("·", " · sem. ") : <Ghost title="Sin etapa" />}
        </Fact>
        <Fact label="RS" title={rs.title} sub={rsSub}>
          {rs.missing ? <Ghost title={rs.title} /> : rs.text}
        </Fact>
        <Fact label="VCP" title={formatVcpFootprintTitle(row)} sub={footprint ? huntPeekVcpContractions(row).replace(/ %/g, "%") : ""}>
          {footprint || <Ghost title="Sin contracciones detectadas" />}
        </Fact>
        <Fact label="Máx 52s">
          {dist?.label || <Ghost title="Sin distancia al máximo de 52 semanas" />}
        </Fact>
        <Fact label="Rend. 3M">
          {perf3m || <Ghost title="Sin rendimiento a 3 meses" />}
        </Fact>
        <Fact label="Capitaliz.">
          {capText && capText !== "-" ? capText : <Ghost title="Sin capitalización" />}
        </Fact>
      </dl>

      <EntryBlock row={row} variant="mobile" idPrefix="sheet" />

      <p className="mobileSheetLabel">Tu clasificación</p>
      <div className="mobilePeekClassify" role="group" aria-label="Tu clasificación">
        {STOCK_DECISION_ACTIONS.map((item) => {
          const active = resolutionKey === item.key;
          const glyph = HUNT_TAPE_USER_MARKS[item.key]?.glyph || "";
          return (
            <button
              type="button"
              key={item.key}
              className={`mobilePeekClassBtn mobilePeekClassBtn--${item.key}${active ? " isOn" : ""}`}
              aria-pressed={active}
              title={active ? "Pulsa otra vez para volver a pendiente" : item.detail}
              onClick={() => onResolveDecision?.(row, active ? "" : item.key)}
            >
              <span aria-hidden="true">{glyph}</span> {item.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn mobileSheetBtn mobilePeekFav"
        onClick={() => onFavorite?.(row)}
        disabled={isFavorite || !onFavorite}
        aria-pressed={isFavorite}
      >
        {isFavorite ? "★ En favoritos" : "☆ Favorito"}
      </button>
    </MobileSheet>
  );
}
