"use client";

// Panel lateral de lectura (rediseño 2026-11, paso 7). Lo mínimo para leer
// la fila enfocada sin salir de la cola: identidad, cierre, etapa con su
// glifo de curva, gráfico semanal ~12M con MM30, RS, VCP, distancia al
// máximo, cap./tema, por qué está en la cola y tus acciones (★, clasificar,
// abrir ficha). Cero peticiones: todo sale de la fila ya cargada (la serie
// es la misma `chartPreview` de la miniatura, hidratada por viewport).
// Sin veredictos del sistema (retirados 24-ago): clasifica el usuario.

import { money, amount } from "@/lib/screenerFormat";
import { rowLastDate } from "@/lib/dataAge";
import { formatDayLabel } from "@/lib/weeklyChanges";
import { stageDisplayForRow } from "@/lib/stageDisplay";
import { STOCK_DECISION_ACTIONS } from "@/lib/stockDecisionResolution";
import { resolveHuntTapeSparkStatus } from "@/lib/scansChartPreviewHydrate";
import EntryBlock from "@/app/components/screener/EntryBlock";
import {
  HUNT_PEEK_CURVE_PATH,
  HUNT_TAPE_ABSENT,
  formatVcpFootprintFromRow,
  formatVcpFootprintTitle,
  huntPeekChartPaths,
  huntPeekStageDot,
  huntPeekVcpContractions,
  huntTapeDist52w,
  huntTapeDrillUrl,
  huntTapeMarketSuffix,
  huntTapeRsDisplay,
  huntTapeSparkTitle,
  huntTapeStageLine,
  huntTapeStageNumber,
  huntTapeThemeCell,
} from "@/lib/screenerHuntTape";

function Ghost({ title }) {
  return <b className="huntTapeGhost" title={title}>{HUNT_TAPE_ABSENT}</b>;
}

export default function HuntPeekPanel({
  row,
  inclusion = "",
  isFavorite = false,
  resolutionKey = "",
  chartPreviewDeferred = false,
  onClose,
  onFavorite,
  onResolveDecision,
  onOpenStock,
}) {
  if (!row?.symbol) return null;
  const market = huntTapeMarketSuffix(row);
  const name = String(row.companyName || row.name || "").trim();
  const closeDay = formatDayLabel(rowLastDate(row));
  const stageNum = huntTapeStageNumber(row);
  const stageLine = huntTapeStageLine(row);
  const stageDisplay = stageDisplayForRow(row);
  const dot = huntPeekStageDot(row);
  const rs = huntTapeRsDisplay(row);
  const footprint = formatVcpFootprintFromRow(row);
  const contractions = huntPeekVcpContractions(row);
  const dist = huntTapeDist52w(row);
  const { label: theme, title: themeTitle } = huntTapeThemeCell(row);
  const capText = amount(row.marketCap, row.currency);
  const chart = huntPeekChartPaths(row.chartPreview || []);
  const chartStatus = resolveHuntTapeSparkStatus(row, { deferred: chartPreviewDeferred });
  const weeks = stageLine?.line?.match(/sem\. (\d+)/)?.[1];
  const stageSub = [
    weeks ? `semana ${weeks}` : "",
    stageDisplay?.qualifierDisplay || "",
    rs.missing ? "" : `RS ${rs.text}`,
  ].filter(Boolean).join(" · ");

  return (
    <aside className="huntPeekPanel" aria-label={`Lectura rápida de ${row.symbol}`}>
      <div className="huntPeekHead">
        <b className="huntPeekSymbol">{row.symbol}</b>
        {market ? <span className="huntTapeMarket">{market}</span> : null}
        <span className="huntPeekName" title={name}>{name}</span>
        <button type="button" className="huntPeekClose" onClick={onClose} aria-label="Cerrar panel" title="Cerrar (Esc o ←)">×</button>
      </div>
      {inclusion ? <p className="huntPeekWhy">{inclusion}</p> : null}

      <div className="huntPeekPrice">
        <b>{Number.isFinite(row.price) ? money(row.price, row.currency) : HUNT_TAPE_ABSENT}</b>
        {closeDay ? <span>cierre {closeDay}</span> : null}
      </div>

      <div className="huntPeekStage" title={stageDisplay?.title || stageLine?.title || "Sin etapa"}>
        <svg viewBox="0 0 120 44" aria-hidden="true">
          <path d={HUNT_PEEK_CURVE_PATH} />
          {dot ? <circle cx={dot[0]} cy={dot[1]} r="4" /> : null}
        </svg>
        <div>
          <div className="huntPeekStageWord">{stageNum ? `Etapa ${stageNum}` : "Sin etapa"}</div>
          {stageSub ? <small>{stageSub}</small> : null}
        </div>
      </div>

      {chart ? (
        <figure className="huntPeekChart">
          <svg viewBox={`0 0 ${chart.w} ${chart.h}`} preserveAspectRatio="none" role="img" aria-label="Cierre semanal ~12 meses con media de 30 semanas">
            <path className="huntPeekChartFill" d={chart.fill} />
            {chart.hasMa ? <path className="huntPeekChartMa" d={chart.maPath} /> : null}
            <path className="huntPeekChartPrice" d={chart.pricePath} />
          </svg>
          <figcaption><span><i />Cierre semanal ~12M</span>{chart.hasMa ? <span><i className="isMa" />MM30</span> : null}</figcaption>
        </figure>
      ) : (
        <div className={`huntPeekChart huntPeekChartEmpty${chartStatus === "pending" ? " isPending" : ""}`} role="status">
          {huntTapeSparkTitle(chartStatus)}
        </div>
      )}

      <dl className="huntPeekFacts">
        <div>
          <dt>RS</dt>
          <dd>{rs.missing ? <Ghost title={rs.title} /> : <b title={rs.title}>{rs.text}</b>}</dd>
        </div>
        <div>
          <dt>VCP</dt>
          <dd title={formatVcpFootprintTitle(row)}>
            {footprint ? <b>{footprint}</b> : <Ghost title="Sin contracciones detectadas" />}
            {contractions ? <small>{contractions}</small> : null}
          </dd>
        </div>
        <div>
          <dt>Máx 52s</dt>
          <dd>{dist?.label ? <b>{dist.label}</b> : <Ghost title="Sin distancia al máximo de 52 semanas" />}</dd>
        </div>
        <div>
          <dt>Cap.</dt>
          <dd>{capText && capText !== "-" ? <b>{capText}</b> : <Ghost title="Sin capitalización" />}</dd>
        </div>
        <div className="huntPeekFactWide">
          <dt>Tema</dt>
          <dd title={themeTitle}>{theme ? <span>{theme}</span> : <Ghost title={themeTitle} />}</dd>
        </div>
      </dl>

      <EntryBlock row={row} variant="desktop" idPrefix="peek" />

      <div className="huntPeekClassify" role="group" aria-label="Tu clasificación">
        <span className="huntPeekLabel">Tu clasificación</span>
        <div>
          {STOCK_DECISION_ACTIONS.map((item) => {
            const active = resolutionKey === item.key;
            return (
              <button
                type="button"
                key={item.key}
                className={`btn btnSmall${active ? " isActive" : ""}`}
                aria-pressed={active}
                title={active ? "Pulsa otra vez para volver a pendiente" : item.detail}
                onClick={() => onResolveDecision?.(row, active ? "" : item.key)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="huntPeekActions">
        <button
          type="button"
          className="btn btnSmall"
          onClick={() => onFavorite?.(row)}
          disabled={isFavorite || !onFavorite}
          aria-pressed={isFavorite}
        >
          {isFavorite ? "★ En favoritos" : "★ Favorito"}
        </button>
        <a
          className="btn btnSmall btnPrimary huntPeekOpen"
          href={huntTapeDrillUrl(row.symbol)}
          onPointerDown={() => onOpenStock?.(row)}
          onClick={() => onOpenStock?.(row)}
        >
          Abrir ficha <kbd>↵</kbd>
        </a>
      </div>
    </aside>
  );
}
