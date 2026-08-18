"use client";
// Amplitud del universo — la sección lee EXCLUSIVAMENTE /api/market-breadth
// (escaneo nocturno del servidor). Nada de esta tarjeta sale del localStorage
// del navegador: dos usuarios ven la misma cifra, y cambiar de filtro en el
// screener no la mueve. La fecha del dato se declara en la cabecera.
import { dateShort, dateTime, num, pct, pctShare } from "@/lib/formatters";
// Mismo componente de ausencia que el resto del producto: guion + icono con el
// motivo (principio 3: un dato con cobertura insuficiente se declara ausente).
import { MissingValue } from "@/lib/screenerColumns";

// Sparkline de UNA serie (sin doble eje: índice y participación van en dos
// filas separadas que comparten el rango temporal, cada una con sus valores
// en los extremos — la forma la da la línea, el dato lo dan los números).
function Sparkline({ values = [], ariaLabel = "" }) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const width = 220;
  const height = 34;
  const pad = 3;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((value, index) => Number.isFinite(value)
      ? `${(pad + index * step).toFixed(1)},${(height - pad - ((value - min) / span) * (height - pad * 2)).toFixed(1)}`
      : null)
    .filter(Boolean)
    .join(" ");
  return (
    <svg className="marketBreadthSpark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function BreadthKpi({ item }) {
  return (
    <div className="marketTapeKpi">
      {item.available
        ? <b>{pctShare(item.pct)}</b>
        : <b><MissingValue reason={item.reason} /></b>}
      <span>{item.label}</span>
      {item.available && <small>{num(item.count)} de {num(item.measured)}</small>}
    </div>
  );
}

// Cuatro KPIs de volumen agregados sobre los campos que ya publica el
// escaneo (upDownVolRatio, volumeDryUpRatio, volumeSurgePct). Mismo
// contrato que BreadthKpi pero declara además la ventana y el umbral
// del briefing en la línea bajo el porcentaje. Sin semáforo de color
// (principio 1: describe, no predice).
function VolumeIndicatorsPanel({ volume }) {
  if (!volume) return null;
  const indicators = volume.indicators || {};
  const order = [
    { key: "upDownVolumeRatio", label: "Reparto del volumen (50d)" },
    { key: "volumeDryUp", label: "Volumen seco (10d/50d)" },
    { key: "volumeSurge", label: "Impulso de volumen (5d/20d)" },
    { key: "participationUp", label: "Reparto de volumen alto (≥1.25×)" },
  ];
  const allMissing = order.every(({ key }) => !indicators[key]?.available);
  return (
    <div className="marketBreadthVolume">
      <h3>Volumen del universo</h3>
      {volume.dataAsOf && (
        <p className="fine">Precio del cierre del {dateShort(volume.dataAsOf)}.</p>
      )}
      {allMissing && (
        <p className="fine"><MissingValue reason={`Cobertura insuficiente en los cuatro indicadores del bloque de volumen.`} /> Los cuatro campos faltan en demasiadas filas del escaneo.</p>
      )}
      <div className="marketTapeKpis marketBreadthKpis">
        {order.map(({ key, label }) => {
          const item = indicators[key];
          if (!item) return null;
          return (
            <div className="marketTapeKpi" key={key}>
              {item.available
                ? <b>{pctShare(item.pct)}</b>
                : <b><MissingValue reason={item.reason} /></b>}
              <span>{item.label}</span>
              {item.available && (
                <small>
                  {num(item.count)} de {num(item.measured)} · {item.thresholdLabel}
                </small>
              )}
            </div>
          );
        })}
      </div>
      {Number.isFinite(volume.upDownMean) && (
        <p className="marketBreadthFact">
          En las últimas 50 sesiones, la media del cociente up/down del universo es {volume.upDownMean.toFixed(2)}× ({num(volume.upDownAbove)} valores por encima de 1×, {num(volume.upDownBelow)} por debajo).
        </p>
      )}
    </div>
  );
}

function StageDistribution({ stages }) {
  if (!stages) return null;
  if (!stages.available) {
    return (
      <div className="marketBreadthStages">
        <h3>Distribución por etapas</h3>
        <p className="fine"><MissingValue reason={stages.reason} /> La etapa semanal no tiene cobertura suficiente en este escaneo.</p>
      </div>
    );
  }
  // Mientras el escaneo venga del criterio anterior (quedan filas «base» /
  // «mixed»), las etapas que ese criterio NO emitía (1 y 3) no se muestran a
  // cero: un «Etapa 1 · 0%» junto a un 32% de «Base» se lee como "nadie
  // construye suelo", cuando lo cierto es que aquel clasificador no podía
  // medirlo. No medible ≠ cero (principio 3).
  const legacyCount = stages.buckets
    .filter((bucket) => bucket.key === "base" || bucket.key === "mixed")
    .reduce((sum, bucket) => sum + (bucket.count || 0), 0);
  const buckets = legacyCount > 0
    ? stages.buckets.filter((bucket) => (bucket.count || 0) > 0)
    : stages.buckets;
  return (
    <div className="marketBreadthStages">
      <h3>Distribución por etapas</h3>
      <div className="marketStageBar" role="img" aria-label="Distribución del universo por etapas semanales">
        {buckets.map((bucket) => (
          <i key={bucket.key} data-stage={bucket.key} style={{ width: `${Math.max(0, bucket.pct ?? 0)}%` }} />
        ))}
      </div>
      <div className="marketStageLegend">
        {buckets.map((bucket) => (
          <span key={bucket.key} data-stage={bucket.key}>
            <i aria-hidden="true" />
            {bucket.label} <b>{pctShare(bucket.pct)}</b> ({num(bucket.count)})
          </span>
        ))}
        {stages.unclassified > 0 && (
          <span data-stage="none">{num(stages.unclassified)} sin etapa clasificable</span>
        )}
      </div>
      {legacyCount > 0 && (
        <p className="fine">
          Escaneo clasificado con el criterio anterior: las etapas 1 y 3 no existían y no se
          muestran a cero. El reparto completo llegará con el próximo escaneo nocturno.
        </p>
      )}
    </div>
  );
}

// Parte «tiempo»: el índice y la participación, una fila cada uno, y el hecho
// en una frase. Describe — no predice (principio 1): variaciones medidas y,
// si el índice sube mientras la participación baja, ese enunciado tal cual.
function ParticipationPanel({ participation }) {
  if (!participation) return null;
  if (!participation.available) {
    return (
      <div className="marketBreadthDivergence">
        <h3>Índice y participación</h3>
        <p className="fine"><MissingValue reason={participation.reason} /> Serie semanal no disponible.</p>
      </div>
    );
  }
  const weeks = participation.weeks || [];
  const summary = participation.summary;
  const indexValues = weeks.map((week) => week.indexClose);
  const participationValues = weeks.map((week) => week.pct);
  const firstWeek = weeks[0];
  const lastWeek = weeks.at(-1);
  return (
    <div className="marketBreadthDivergence">
      <h3>Índice y participación · {num(weeks.length)} semanas</h3>
      {participation.index ? (
        <div className="marketBreadthSparkRow">
          <span className="marketBreadthSparkLabel">{participation.index.symbol}</span>
          <span className="marketBreadthSparkValue">{num(participation.index.fromClose)}</span>
          <Sparkline values={indexValues} ariaLabel={`Cierre semanal de ${participation.index.symbol}`} />
          <span className="marketBreadthSparkValue"><b>{num(participation.index.toClose)}</b></span>
        </div>
      ) : (
        <p className="fine"><MissingValue reason={participation.indexReason} /> Sin serie del índice.</p>
      )}
      <div className="marketBreadthSparkRow">
        <span className="marketBreadthSparkLabel">Participación</span>
        <span className="marketBreadthSparkValue">{pctShare(firstWeek?.pct)}</span>
        <Sparkline values={participationValues} ariaLabel="Porcentaje del universo RS con retorno ponderado positivo, por semana" />
        <span className="marketBreadthSparkValue"><b>{pctShare(lastWeek?.pct)}</b></span>
      </div>
      {summary && (
        <p className="marketBreadthFact">
          {participation.index
            ? <>En las últimas {num(summary.weeks)} semanas {participation.index.symbol} varió {pct(summary.indexChangePct)}; la participación — valores del universo RS con retorno ponderado positivo — pasó del {pctShare(summary.participationStartPct)} al {pctShare(summary.participationEndPct)}.</>
            : <>En las últimas {num(summary.weeks)} semanas la participación pasó del {pctShare(summary.participationStartPct)} al {pctShare(summary.participationEndPct)}.</>}
          {summary.threshold
            ? (() => {
                const windowShort = summary.weeks < summary.threshold.windowWeeks;
                const verdict = windowShort
                  ? "ventana insuficiente para evaluar el umbral"
                  : (summary.thresholdMet ? "SÍ hay divergencia con el umbral del briefing" : "NO hay divergencia con el umbral del briefing");
                return windowShort
                  ? <> En las últimas {num(summary.threshold.windowWeeks)} semanas, el índice varió {pct(summary.indexChangePct)} y la participación cambió {pct(summary.participationDeltaPp)}: la serie solo cubre {num(summary.weeks)} semanas, <b>ventana insuficiente</b> para el umbral del briefing (≥+{summary.threshold.indexUpPct}% / ≤{summary.threshold.participationDownPp} pp).</>
                  : <> En las últimas {num(summary.threshold.windowWeeks)} semanas, el índice {pct(summary.indexChangePct)} y la participación cambió {pct(summary.participationDeltaPp)}: <b>{summary.thresholdMet ? "SÍ" : "NO"}</b> hay divergencia con el umbral del briefing (≥+{summary.threshold.indexUpPct}% / ≤{summary.threshold.participationDownPp} pp).</>;
              })()
            : (summary.divergence && <b> El índice sube y cada vez menos valores lo acompañan.</b>)}
        </p>
      )}
      <details className="marketBreadthTable">
        <summary>Serie semanal completa</summary>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Semana</th><th>Fecha</th><th>Participación</th><th>Positivos / muestra</th><th>{participation.index?.symbol || "Índice"}</th></tr></thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.weekKey}>
                  <td>{week.weekKey}</td>
                  <td>{dateShort(week.date)}</td>
                  <td>{pctShare(week.pct)}</td>
                  <td>{num(week.positive)} / {num(week.sampleSize)}</td>
                  <td>{Number.isFinite(week.indexClose) ? num(week.indexClose) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default function UniverseBreadthCard({ breadth, loading }) {
  if (loading && !breadth) {
    return (
      <section className="card marketBreadthCard">
        <div className="sectionTitle"><h2>Amplitud del universo</h2><span className="fine">Cargando el escaneo nocturno…</span></div>
      </section>
    );
  }
  if (!breadth) return null;
  if (breadth.error) {
    return (
      <section className="card marketBreadthCard">
        <div className="sectionTitle"><h2>Amplitud del universo</h2><span className="fine">Escaneo nocturno del servidor</span></div>
        <div className="dataNote">{breadth.error}</div>
      </section>
    );
  }
  return (
    <section className="card marketBreadthCard" data-testid="universe-breadth">
      <div className="sectionTitle">
        <h2>Amplitud del universo</h2>
        <span className="fine">
          {num(breadth.population)} valores · escaneo del {dateTime(breadth.scan?.createdAt)} · precios al cierre del {dateShort(breadth.dataAsOf)}
        </span>
      </div>
      {breadth.staleRows > 0 && (
        <p className="fine">{num(breadth.staleRows)} valores con precio anterior al {dateShort(breadth.dataAsOf)}.</p>
      )}
      <div className="marketTapeKpis marketBreadthKpis">
        {breadth.indicators?.map((item) => <BreadthKpi key={item.key} item={item} />)}
      </div>
      <StageDistribution stages={breadth.stages} />
      <ParticipationPanel participation={breadth.participation} />
      <VolumeIndicatorsPanel volume={breadth.volume} />
    </section>
  );
}
