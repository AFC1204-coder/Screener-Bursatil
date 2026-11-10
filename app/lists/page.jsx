"use client";
import "../../styles/lists.css";
import { useEffect, useMemo, useState } from "react";
import { DecisionTraceBadge, DecisionTracePanel } from "@/app/DecisionTraceability";
import RowTrustSignature from "@/app/RowTrustSignature";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { TrustMetric } from "@/app/components/ui/MetricSource";
import { rowTrustSignatureForRow } from "@/app/components/ui/TrustSignals";
import { CountValue } from "@/app/components/ui/CountValue";
import { MissingValue } from "@/lib/screenerColumns";
import { getJson } from "@/lib/clientApi";
import { dateShort, num, pct, pctShare } from "@/lib/formatters";
import { auditIssueLabels, buildCoverageAudit } from "@/lib/discoveryAudit";
import { buildDataAgeNotice } from "@/lib/dataAge";
import { buildDecisionTraceabilitySummary, decisionResolutionForRow } from "@/lib/decisionTraceability";
import { buildSavedListView, listViewHref, listViewSignature, normalizeListScope, normalizeSavedListViews, savedListViewMetaLine } from "@/lib/listViews";
import { enforceListContractRows, listContractForKey, listInclusionSummary, rowPassesListContract, summarizeListReliability } from "@/lib/listRationale";
import { persistLocalScans } from "@/lib/localScanPersistence";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { compactDate, QualityStrip } from "@/app/components/ui/QualityStrip";
import { PageTicket } from "@/app/components/PageTicket";
import { canonicalRs, RS_CANONICAL_LABEL } from "@/lib/rsCanonical";
import { userFacingServiceError } from "@/lib/serviceErrors";
import { favoriteToRow, isLongOpportunityRow, metricValue, normalizeStockRows, shortBusiness, sortByMetric, uniqueRows, weaknessScore } from "@/lib/stockRows";
import { stockUrl } from "@/lib/symbols";

async function fetchJsonWithTimeout(path, timeoutMs = 16000) {
  try {
    return await getJson(path, { timeoutMs, cache: "no-store" });
  } catch (error) {
    // La ruta interna se queda en consola: el mensaje que sube hacia la UI no
    // debe decirle a nadie qué endpoints existen.
    if (error?.name === "AbortError") {
      console.error(`[listas] ${path} no respondió en ${Math.round(timeoutMs / 1000)}s`);
      throw new Error(`El servidor de datos tardó demasiado en responder (más de ${Math.round(timeoutMs / 1000)} s).`);
    }
    throw error;
  }
}

const AUDIT_COUNT_MISSING = "Este recuento no se ha podido calcular en esta carga.";
const COVERAGE_PCT_MISSING = "Sin universo cargado para este alcance: no hay sobre qué medir la cobertura.";
const HEALTH_COUNT_MISSING = "Este recuento no ha llegado en esta carga, así que no se sabe cuántas filas hay.";
const RANKING_UNAVAILABLE = "El ranking actualizado no está disponible ahora mismo.";
// Tiempo límite de la espera de rankings (D6, auditoría de producto 2026-11).
// Las listas se calculan sobre el nocturno completo: la primera carga del día
// tarda unos segundos (después el servidor la sirve de memoria). Con 8 s la
// primera petición en frío caducaba y la pantalla no decía por qué.
const DISCOVERY_TIMEOUT_MS = 20000;

/* ─── Listas retiradas de la vista (2026-08-13) ──────────────────────────
   NO están borradas: su contrato (lib/listRationale.js), su estrategia
   (lib/leaderboards.js) y su cálculo en esta misma página siguen intactos y
   se siguen ejecutando. Solo dejan de pintarse.

   Se retiran porque cada una afirma algo que hoy no puede sostener. Las tres
   se midieron contra datos reales el 13 de agosto de 2026, con la caché de
   discovery ya caducada y la lectura viva funcionando — es decir, en su
   mejor escenario posible, no con la caché rota que las vaciaba antes. El
   detalle está en docs/migracion-listas-2026-08-13.md §7 y §12.5.

   Para devolver una: quita su clave de aquí. Cada entrada dice qué tendría
   que ser cierto antes de hacerlo. No las devuelvas solo porque "ahora sí
   salen filas": las tres sacaban filas cuando se retiraron. */
const RETIRED_LIST_SECTIONS = {
  weakness: {
    title: "Deterioro técnico",
    // Medido: 8328.HK, 8329.HK y 8326.HK, cierre 10 ago, con el resto de la
    // pantalla a cierre del 12.
    motivo: "Enseñaba otro mercado y otra fecha sin decirlo: tres valores de Hong Kong con el cierre dos días más viejo que el resto de la pantalla.",
    causa: "El escaneo nocturno aplica el preset balanced y guarda 75 de 5.608 PORQUE son fuertes, así que no deja débiles. Los únicos que superan el contrato vienen del cron por mercados, que no es el mercado de lanzamiento.",
    paraVolver: "Que exista una fuente de deterioro del mismo mercado y la misma fecha que el resto de la pantalla — hoy pasaría por que el nocturno guarde también una cohorte de débiles, o por anclar la lectura al nocturno US y aceptar que la lista quede vacía.",
  },
  ipo: {
    title: "IPO / New Leaders",
    motivo: "Cero filas siempre, prometiendo en su propio título 'IPOs reales verificables <= 5 años'.",
    causa: "recentIpoOk exige una edad finita, y el nocturno no trae el dato: ipoDate llega vacío e ipoAgeMonths nulo en las 75 filas.",
    paraVolver: "Que las filas de scan_results traigan ipoDate o ipoAgeMonths hidratados. Antes de reconstruirla aquí, mirar /ipo-radar: puede que ya cubra esto y la lista sobre.",
  },
  nearPivot: {
    title: "Vigilancia pivot",
    // Medido: INSW tiene distanceToPivotPct == distance52w == -6,0; CRON los
    // tiene distintos (0,0 frente a -7,6). Mide una cosa u otra según la fila.
    motivo: "Su número es el pivote que docs/principios-producto.md ya decidió aplazar por no ser fiable, y las filas lo confirman: distanceToPivotPct coincide con distance52w hasta el último decimal en unas y no en otras.",
    causa: "El pivote real es el máximo de la contracción final de la base, no una línea sobre máximos. Un número falso con aspecto de preciso es peor que no tenerlo (principio 7, 'Aplazado hasta poder calcularlo bien').",
    paraVolver: "Que exista un pivote calculado con criterio explícito y verificable sobre la base — el mismo trabajo que desbloquea las columnas 'distancia al pivote' y 'semanas de base' de la tabla.",
  },
};

function hasOwn(obj = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function ListTrustMetric({ row, metricKey, label, value, className = "" }) {
  return <TrustMetric row={row} metricKey={metricKey} label={label} value={value} className={className} baseClass="listTrustMetric" />;
}

/* El RS sale del lector único (lib/rsCanonical.js), igual que en la tabla del
   screener, la vista rápida y la ficha. Nunca del percentil del lote que
   viaja en la fila: son poblaciones distintas y darían números distintos para
   el mismo símbolo en dos pantallas. */
function CanonicalRsCell({ row }) {
  const rs = canonicalRs(row);
  if (!rs.available) return <MissingValue reason={rs.reason} />;
  return <b className={`cellNumber ${rs.value >= 75 ? "strong" : rs.value < 45 ? "weak" : ""}`.trim()}>{rs.value.toFixed(0)}</b>;
}

/* La fecha que manda, en la misma franja que la ficha.
   El evaluador contó cinco fechas repartidas por el producto sin que ninguna
   dijera cuál manda. Ésta lo dice: primero el cierre de las barras sobre las
   que están calculadas TODAS las filas de debajo.
   El RS va aparte a propósito. Es semanal y su corte no coincide con el de
   las barras —hoy, 9 y 12 de agosto—: meterlos bajo una sola fecha sería
   mentir sobre uno de los dos. Y el universo contesta la pregunta que hay
   debajo de todas: si esto es el mercado entero o una selección. */
function listsQualityItems({ dataAsOf, rsAsOf, nightly, coverage }) {
  const items = [];
  if (dataAsOf?.date) {
    items.push({
      label: "Cierre",
      // mixed solo puede darse si alguien vuelve a mezclar orígenes: se
      // enseña en vez de esconderse tras la fecha más reciente.
      value: dataAsOf.mixed ? `${compactDate(dataAsOf.date)} — ${compactDate(dataAsOf.latest)}` : compactDate(dataAsOf.date),
    });
  } else {
    items.push({ label: "Cierre", value: "Sin fecha" });
  }
  items.push({
    label: RS_CANONICAL_LABEL,
    value: rsAsOf?.date ? `${compactDate(rsAsOf.date)}${rsAsOf.sampleSize ? ` · n=${Math.round(rsAsOf.sampleSize).toLocaleString("es-ES")}` : ""}` : "Sin ranking",
  });
  // El total analizado viaja en el propio local_id del escaneo
  // ("materialized:US:2026-08-13:o0:l5608"): es el dato que convierte "75
  // valores" en "75 de 5.608".
  const analizados = Number(String(nightly?.localId || "").match(/:l(\d+)$/)?.[1] || 0);
  // Si el servidor no leyó el nocturno entero, se dice sobre cuántas filas se
  // calcularon las listas (D6). Con la lectura completa no aparece.
  if (coverage && coverage.complete === false && coverage.label) {
    items.push({ label: "Cálculo", value: coverage.label });
  }
  if (Number.isFinite(nightly?.rows) && nightly.rows > 0) {
    items.push({
      label: "Universo",
      value: analizados > 0
        ? `${nightly.rows.toLocaleString("es-ES")} de ${analizados.toLocaleString("es-ES")}`
        : `${nightly.rows.toLocaleString("es-ES")} valores`,
    });
  }
  return items;
}

function scopedDiscoveryPath(filter = {}) {
  const params = new URLSearchParams({
    limit: "20",
    groupItemLimit: "8",
    groupsLimit: "12",
    minGroupSize: "1",
  });
  if (filter.groupType && filter.group) {
    params.set("groupType", filter.groupType);
    params.set("group", filter.group);
  }
  return `/api/discovery?${params.toString()}`;
}

function DiscoveryHealthPanel({ data, error, loading, usingDiscovery, localRows, filter }) {
  const health = data?.health || {};
  const status = loading ? "" : usingDiscovery ? (health.state === "pass" ? "pass" : "warn") : "warn";
  const scope = filter?.group ? `${filter.groupType}: ${filter.group}` : "Global";
  const source = loading ? "Actualizando" : usingDiscovery ? health.sourceLabel || "Ranking en vivo" : "Copia local";
  const note = loading
    ? "Vista provisional desde la copia local; los conteos y rankings se actualizarán al terminar la carga."
    : error ? `${error} Mientras tanto se usa la copia local.` : usingDiscovery ? health.note : "Usando copias locales y favoritos hasta tener escaneos guardados suficientes.";

  return <div className="marketReliabilityBlock">
    <div className="marketReliabilityBlockHead">
      <h3>Fiabilidad del ranking</h3>
      <span className={`discoveryStatus ${status}`}>{source}</span>
    </div>
    {/* Un recuento que no ha llegado se muestra ausente. Un 0 aquí afirma
        "ninguna fila con precio viejo", que es lo contrario de "no lo sé". */}
    <div className="discoveryHealthGrid">
      <span><b>{usingDiscovery ? <CountValue value={health.rows} reason={HEALTH_COUNT_MISSING} /> : localRows}</b><em>filas del ranking</em></span>
      <span><b>{usingDiscovery ? <CountValue value={health.staleRows} reason={HEALTH_COUNT_MISSING} /> : "-"}</b><em>precio viejo</em></span>
      <span><b>{usingDiscovery ? <CountValue value={health.lowCoverageRows} reason={HEALTH_COUNT_MISSING} /> : "-"}</b><em>cobertura baja</em></span>
      <span><b>{usingDiscovery ? <CountValue value={health.missingTaxonomyRows} reason={HEALTH_COUNT_MISSING} /> : "-"}</b><em>taxonomía incompleta</em></span>
      <span><b>{usingDiscovery ? <CountValue value={health.planClaims} reason={HEALTH_COUNT_MISSING} /> : "-"}</b><em>planes VCP</em></span>
      <span><b>{scope}</b><em>alcance</em></span>
    </div>
    <p className="fine">{note}</p>
  </div>;
}

/* «Guardar vista» vive en el ticket (paso 9); el panel solo se monta si hay
   vistas que listar. */
function SavedListViewsPanel({ views, currentSignature, onDelete }) {
  return <section className="card savedListViewsPanel">
    <div className="sectionTitle">
      <h2>Vistas guardadas</h2>
    </div>
    <div className="savedListViews">
      {views.map((view) => <div className={`savedListView ${view.signature === currentSignature ? "active" : ""}`} key={view.id}>
        <a href={listViewHref(view)}><b>{view.name}</b><span>{savedListViewMetaLine(view)}</span></a>
        <button className="btn btnSmall" type="button" onClick={() => onDelete(view.id)}>Borrar</button>
      </div>)}
    </div>
  </section>;
}

function CoverageAuditPanel({ audit }) {
  if (!audit) return null;
  const status = audit.state === "pass" ? "pass" : audit.state === "empty" ? "" : "warn";
  const issues = auditIssueLabels(audit, 5);
  const topMarkets = audit.topMarkets || [];
  const topSectors = audit.topSectors || [];
  const hasCoverageInput = (audit.universeRows ?? 0) > 0 || (audit.rankedRows ?? 0) > 0;

  return <div className="marketReliabilityBlock">
    <div className="marketReliabilityBlockHead">
      <h3>Auditoría de cobertura</h3>
      <span className={`discoveryStatus ${status}`}>{audit.label || "Sin auditoría"}</span>
    </div>
    <div className="coverageAuditGrid">
      <span><b><CountValue value={audit.universeRows} reason={AUDIT_COUNT_MISSING} /></b><em>universo del alcance</em></span>
      <span><b><CountValue value={audit.rankedRows} reason={AUDIT_COUNT_MISSING} /></b><em>filas con ranking</em></span>
      {/* Sin universo no hay porcentaje de cobertura: el 0% que salía aquí lo
          fabricaba la división por cero, no una medición. */}
      <span><b>{hasCoverageInput ? pctShare(audit.rankingCoveragePct ?? 0, 1) : <MissingValue reason={COVERAGE_PCT_MISSING} />}</b><em>cobertura del ranking</em></span>
      <span><b>{audit.rankedMarketCount ?? 0}/{audit.marketCount ?? 0}</b><em>mercados con ranking</em></span>
      <span><b>{hasCoverageInput ? audit.listHealth?.emptyLists?.length ?? 0 : "-"}</b><em>listas vacías</em></span>
    </div>
    <div className="coverageAuditColumns">
      <div>
        <b>Mercados en ranking</b>
        <span>{topMarkets.length ? topMarkets.map((item) => `${item.key} ${pctShare(item.sharePct, 1)}`).join(" · ") : "Sin dato"}</span>
      </div>
      <div>
        <b>Sectores en ranking</b>
        <span>{topSectors.length ? topSectors.map((item) => `${item.key} ${pctShare(item.sharePct, 1)}`).join(" · ") : "Sin dato"}</span>
      </div>
      <div>
        <b>Alertas accionables</b>
        <span>{hasCoverageInput ? (issues.length ? issues.join(" · ") : "Sin alertas de sesgo relevantes") : "Sin universo suficiente"}</span>
      </div>
    </div>
    <p className="fine">{audit.note}</p>
  </div>;
}

/* ─── Franja de infraestructura de Listas ───────────────────────────
   Misma receta estándar que market-health: una línea bajo la cabecera,
   tiza/humo sobre --surface, --line2, expandible con <details>. La
   fiabilidad y la auditoría NUNCA deben competir como card co-igual
   con el contenido de listas (DIRECCION-VISUAL.md regla 7). */
function ListsInfraStrip({ discovery, discoveryError, discoveryLoading, useDiscovery, localRows, filter, coverageAudit }) {
  const health = discovery?.health || {};
  const audit = coverageAudit || {};
  const source = discoveryLoading ? "Actualizando" : useDiscovery ? (health.sourceLabel || "Ranking en vivo") : "Copia local";
  const scope = filter?.group ? `${filter.groupType}: ${filter.group}` : "Global";
  const hasCoverageInput = (audit.universeRows ?? 0) > 0 || (audit.rankedRows ?? 0) > 0;
  const emptyLists = hasCoverageInput ? audit.listHealth?.emptyLists?.length ?? 0 : null;
  return (
    <details className="marketReliabilityStrip" data-testid="lists-infra-strip">
      <summary className="marketReliabilityStripLabel">Listas · cobertura</summary>
      <div className="marketReliabilityStripItem">
        <span>fuente</span>
        <b>{source}</b>
      </div>
      <div className="marketReliabilityStripItem">
        <span>filas del ranking</span>
        <b>{useDiscovery ? (health.rows ?? 0) : localRows}</b>
      </div>
      <div className="marketReliabilityStripItem">
        <span>cobertura del ranking</span>
        <b>{hasCoverageInput ? pctShare(audit.rankingCoveragePct ?? 0, 1) : <MissingValue reason={COVERAGE_PCT_MISSING} />}</b>
      </div>
      <div className="marketReliabilityStripItem">
        <span>mercados</span>
        <b>{audit.rankedMarketCount ?? "—"}/{audit.marketCount ?? "—"}</b>
      </div>
      <div className="marketReliabilityStripItem">
        <span>listas vacías</span>
        <b>{emptyLists ?? "—"}</b>
      </div>
      <div className="marketReliabilityStripItem">
        <span>alcance</span>
        <b>{scope}</b>
      </div>
      <summary className="marketReliabilityStripToggle" data-action="toggle">[+]</summary>
      <div className="marketReliabilityStripDetail">
        <DiscoveryHealthPanel
          data={discovery}
          error={discoveryError}
          loading={discoveryLoading}
          usingDiscovery={useDiscovery}
          localRows={localRows}
          filter={filter}
        />
        <CoverageAuditPanel audit={coverageAudit} />
      </div>
    </details>
  );
}

/* Paso 9 (rediseño 2026-11): lo que pintaba la tarjeta «Vista actual» (siete
   tiles) cabe en el ticket. Este helper conserva sus cifras y su nota: las
   cifras van en la verdad corta y la nota en su tooltip. */
function listScopeFacts({ filter, rowsCount, savedView }) {
  const scope = normalizeListScope(filter);
  const scopeRows = savedView?.counts?.scopeRows;
  const savedRows = savedView?.counts?.rows;
  const hasScopeRows = Number.isFinite(scopeRows) && scopeRows > 0;
  const hasLegacySavedRows = !hasScopeRows && Number.isFinite(savedRows) && savedRows > 0 && savedRows !== rowsCount;
  const note = hasScopeRows && scopeRows !== rowsCount
    ? "El grupo completo puede contener más acciones que los rankings visibles; Listas muestra candidatos únicos, sin duplicados entre estrategias."
    : hasLegacySavedRows
      ? "El conteo guardado pertenece al alcance original de la vista; Listas muestra candidatos únicos, sin duplicados, con los rankings actuales."
    : scope.group
      ? "Todos los rankings visibles aplican este mismo filtro de grupo."
      : "Vista global: los rankings se derivan del universo disponible sin filtro sectorial.";
  return { scope, scopeRows: hasScopeRows ? scopeRows : null, savedRows: hasLegacySavedRows ? savedRows : null, note };
}

function chartPath(points, key, x, y) {
  let open = false;
  return points.map((p, i) => {
    const value = p[key];
    if (!Number.isFinite(value)) {
      open = false;
      return "";
    }
    const cmd = open ? "L" : "M";
    open = true;
    return `${cmd}${x(i).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

function chartPreviewBars(b, limit = 96) {
  const asc = [...b].filter((x) => Number.isFinite(x.close)).reverse();
  const enriched = asc.map((bar, i) => {
    const windowAvg = (n) => i >= n - 1 ? avg(asc.slice(i - n + 1, i + 1).map((x) => x.close)) : null;
    return {
      date: bar.date,
      open: Number.isFinite(bar.open) ? bar.open : bar.close,
      high: Number.isFinite(bar.high) ? bar.high : bar.close,
      low: Number.isFinite(bar.low) ? bar.low : bar.close,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : 0,
      sma50: windowAvg(50),
      sma200: windowAvg(200),
    };
  });
  return enriched.slice(-limit);
}

function MiniSparkline({ bars = [], height = "24px" }) {
  // Tolerante al orden: ver lib/screenerAtoms.jsx MiniSparkline.
  const points = bars
    .filter((x) => Number.isFinite(x.close))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (points.length < 2) return <div className="previewEmpty" style={{ height, display: "grid", placeItems: "center" }}>Sin dato</div>;
  const w = 260, h = 118, pad = 10;
  const values = points.flatMap((p) => [p.close, p.sma50, p.sma200].filter(Number.isFinite));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, max * 0.02);
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => pad + (1 - ((v - min) / range)) * (h - pad * 2);
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const trendClass = last >= first ? "up" : "down";
  const volumeMax = Math.max(...points.map((p) => p.volume || 0), 1);
  const barW = Math.max(1.2, (w - pad * 2) / points.length - 1);
  return <svg className={`miniSparkline ${trendClass}`} style={{ width: "100%", height, display: "block" }} preserveAspectRatio="none" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Gráfico técnico compacto">
    <line x1={pad} x2={w - pad} y1={y(max)} y2={y(max)} className="sparkGuide" />
    <line x1={pad} x2={w - pad} y1={y(min)} y2={y(min)} className="sparkGuide" />
    {points.map((p, i) => {
      const vh = Math.max(1, ((p.volume || 0) / volumeMax) * 20);
      return <rect key={`${p.date}-${i}`} x={x(i) - barW / 2} y={h - pad - vh} width={barW} height={vh} className="sparkVolume" />;
    })}
    <path d={chartPath(points, "sma200", x, y)} className="sparkMa sparkMa200" />
    <path d={chartPath(points, "sma50", x, y)} className="sparkMa sparkMa50" />
    <path d={chartPath(points, "close", x, y)} className="sparkPrice" />
    <circle cx={x(points.length - 1)} cy={y(last)} r="3.4" className="sparkLast" />
  </svg>;
}

function ListSparkline({ row, chartsCache, height }) {
  if (Array.isArray(row.chartPreview) && row.chartPreview.length >= 2) {
    return <MiniSparkline bars={row.chartPreview} height={height} />;
  }
  const cachedBars = chartsCache[row.symbol];
  if (Array.isArray(cachedBars) && cachedBars.length >= 2) {
    return <MiniSparkline bars={cachedBars} height={height} />;
  }
  if (chartsCache[row.symbol] === null) {
    return <div className="previewEmpty" style={{ height: height || "24px", display: "grid", placeItems: "center" }}>Sin gráfico</div>;
  }
  return (
    <div className="sparklineSkeleton">
      <div className="skeletonPulse"></div>
    </div>
  );
}

function queryState() {
  if (typeof window === "undefined") return { groupType: "", group: "" };
  const p = new URLSearchParams(window.location.search);
  return { groupType: p.get("groupType") || "", group: p.get("group") || "" };
}
function applyGroupFilter(rows, groupType, group) {
  if (!groupType || !group) return rows;
  return rows.filter((r) => String(r[groupType] || "") === group);
}

function ListContractNote({ listKey }) {
  const contract = listContractForKey(listKey);
  return <p className={`listContractNote ${contract.tone}`}><b>{contract.label}</b>{contract.text}</p>;
}

function ListReliabilityStrip({ summary, contractRejected = 0 }) {
  const safe = summary || summarizeListReliability([]);
  const displayed = contractRejected > 0
    ? {
        ...safe,
        state: safe.state === "warn" ? "warn" : "watch",
        label: "Contrato aplicado",
        note: `${contractRejected} filas excluidas por no cumplir el contrato visible de la lista.`,
      }
    : safe;
  return <div className={`listReliabilityStrip ${displayed.state}`}>
    <span className="listReliabilityMain"><b>{displayed.label}</b><em>{displayed.note}</em></span>
    <span><b>{safe.rows}</b><em>filas</em></span>
    <span><b>{safe.staleRows}</b><em>precio viejo</em></span>
    <span><b>{safe.lowCoverageRows}</b><em>cobertura baja</em></span>
    <span><b>{safe.dataLimitedRows}</b><em>datos limitados</em></span>
    <span><b>{contractRejected}</b><em>excluidas por contrato</em></span>
  </div>;
}

function ListsEmptyState({ loading, hasSnapshot, discoveryError, absence, emptyReason = "", onRetry = null }) {
  // Cuatro casos y cada uno dice su causa (D6): esperando (con tiempo límite),
  // el servidor no respondió (con el motivo y «Reintentar»), falta el
  // nocturno, o hay nocturno pero ninguna lista tiene valores (y por qué).
  const title = loading
    ? "Calculando las listas"
    : absence
      ? "Sin listas: falta el escaneo del día"
      : discoveryError
        ? "Sin listas: el ranking no respondió"
        : emptyReason
          ? "Ninguna lista tiene valores"
          : "Sin listas disponibles";
  const detail = loading
    ? `Se calculan las listas sobre el escaneo nocturno completo. La primera carga del día puede tardar unos segundos; si pasa de ${Math.round(DISCOVERY_TIMEOUT_MS / 1000)} s se dirá por qué.`
    : absence
      ? absence
      : discoveryError
        ? discoveryError
        : emptyReason
          ? emptyReason
          : hasSnapshot
            ? "Hay una copia guardada en este dispositivo, pero ninguna acción cumple hoy los contratos de las listas."
            : "Las listas ordenan las acciones del escaneo nocturno o de los snapshots que guardas desde el screener. Todavía no hay ninguno disponible.";
  const status = loading ? "Rankings" : absence ? "Sin escaneo nocturno" : discoveryError ? "Sin respuesta" : emptyReason ? "Sin candidatos" : hasSnapshot ? "Sin candidatos" : "Sin copia guardada";
  const bodyNote = loading || absence || discoveryError || emptyReason ? detail : "";
  return <section className="card listsEmptyState">
    <div className="emptyStateHead">
      <h2>{title} {!bodyNote && <InfoHint text={detail} />}</h2>
      <span className="fine">{status}</span>
    </div>
    {/* El motivo va en el cuerpo, no escondido tras un icono: una lista que
        falta entera es exactamente el caso en que el usuario necesita leer
        por qué sin tener que buscarlo (principio 3). */}
    {bodyNote && <p className="dataNote">{bodyNote}</p>}
    {!loading && <p className="fine">{absence
      ? "Qué hacer: espera a que se complete el próximo escaneo nocturno o lanza un análisis desde el screener."
      : discoveryError
        ? "Qué hacer: vuelve a intentarlo en unos segundos; si se repite, el screener sigue funcionando con su propia carga."
        : "Qué hacer: ejecuta un análisis en el screener y guarda el snapshot; las listas se rellenarán solas. También puedes añadir favoritos desde Research."}</p>}
    <div className="controls">
      {!loading && discoveryError && onRetry ? <button className="btn btnPrimary" type="button" onClick={onRetry}>Reintentar</button> : null}
      <a className={`btn ${!loading && discoveryError && onRetry ? "" : "btnPrimary"}`.trim()} href="/">Ir al screener</a>
      <a className="btn" href="/research-desk">Abrir Research</a>
    </div>
  </section>;
}

function MiniTable({ title, desc, rows, chartsCache, reviewState = {}, listKey = "leaders", scoreKey = "objectiveScore", collapsible = true, emptyLabel = "Aún no hay acciones en esta lista.", contractRejected = 0 }) {
  const visibleRows = rows.slice(0, 18);
  const reliability = summarizeListReliability(rows);
  const table = <div className="tableWrap">
    <table className="table">
      <thead><tr>{["Ticker", "Empresa", "Gráfico", "Tema", RS_CANONICAL_LABEL, "3M", "52w", "SMA50", metricShortLabel("weinsteinScore"), metricShortLabel("minerviniScore"), metricShortLabel("rsQualityScore"), metricShortLabel("weaknessScore"), metricShortLabel("riskScore"), metricShortLabel(scoreKey)].map((h, index) => <th key={`${index}-${h}`}>{h}</th>)}</tr></thead>
      <tbody>{visibleRows.map((r) => {
        const trustSignature = rowTrustSignatureForRow(r);
        return <tr key={r.symbol}>
        <td><a className="ticker" href={stockUrl(r.symbol)}>{r.symbol}</a><DecisionTraceBadge resolution={decisionResolutionForRow(r, reviewState)} /></td>
        {/* Paso 9: fila de var(--row-h) como la cinta del screener. El nombre va
            en una línea; negocio y motivo de inclusión, en su tooltip. */}
        <td className="listNameCell"><span className="listNameText" title={[shortBusiness(r), listInclusionSummary(r, listKey)].filter(Boolean).join(" · ")}>{r.companyName || r.symbol}</span><RowTrustSignature signature={trustSignature} className="listRowTrustSignature" /></td>
        <td className="compactSparkCell" style={{ width: "112px", minWidth: "112px", verticalAlign: "middle" }}>
          <ListSparkline row={r} chartsCache={chartsCache} />
        </td>
        <td><span className="pill">{r.theme || r.snapshot?.theme || "-"}</span></td>
        <td><CanonicalRsCell row={r} /></td>
        <td><ListTrustMetric row={r} metricKey="perf3m" label="3M" value={pct(r.perf3m ?? r.snapshot?.perf3m)} /></td>
        <td><ListTrustMetric row={r} metricKey="distance52w" label="52w" value={pct(r.distance52w)} /></td>
        <td><ListTrustMetric row={r} metricKey="extSma50" label="SMA50" value={pct(r.extSma50)} /></td>
        <td><ListTrustMetric row={r} metricKey="weinsteinScore" label={metricShortLabel("weinsteinScore")} value={num(r.weinsteinScore ?? r.snapshot?.weinsteinScore)} /></td>
        <td><ListTrustMetric row={r} metricKey="minerviniScore" label={metricShortLabel("minerviniScore")} value={num(r.minerviniScore ?? r.snapshot?.minerviniScore)} /></td>
        <td><ListTrustMetric row={r} metricKey="rsQualityScore" label={metricShortLabel("rsQualityScore")} value={num(r.rsQualityScore ?? r.snapshot?.rsQualityScore)} /></td>
        <td><ListTrustMetric row={r} metricKey="weaknessScore" label={metricShortLabel("weaknessScore")} value={num(weaknessScore(r))} /></td>
        <td><ListTrustMetric row={r} metricKey="riskScore" label={metricShortLabel("riskScore")} value={num(r.riskScore ?? r.snapshot?.riskScore)} /></td>
        <td className="ticker"><ListTrustMetric row={r} metricKey={scoreKey} label={metricShortLabel(scoreKey)} value={num(Number.isFinite(metricValue(r, scoreKey)) ? metricValue(r, scoreKey) : (r.snapshot?.objectiveScore ?? r.snapshot?.totalScore))} /></td>
      </tr>;
      })}{!rows.length && <tr><td colSpan="14">{emptyLabel}</td></tr>}</tbody>
    </table>
  </div>;
  const mobileRows = <div className="listMobileRows">
    {visibleRows.map((r) => {
      const trustSignature = rowTrustSignatureForRow(r);
      return <a className="listMobileRow" key={`${title}-${r.symbol}`} href={stockUrl(r.symbol)}>
      <div className="listMobileRowTop">
        <span><b>{r.symbol}</b><em>{r.companyName || r.symbol}</em><DecisionTraceBadge resolution={decisionResolutionForRow(r, reviewState)} /></span>
        <strong><ListTrustMetric row={r} metricKey={scoreKey} label={metricShortLabel(scoreKey)} value={num(Number.isFinite(metricValue(r, scoreKey)) ? metricValue(r, scoreKey) : (r.snapshot?.objectiveScore ?? r.snapshot?.totalScore))} /></strong>
      </div>
      <RowTrustSignature signature={trustSignature} className="listMobileTrustSignature" />
      <div className="listMobileSpark"><ListSparkline row={r} chartsCache={chartsCache} height="96px" /></div>
      <div className="listMobileFacts">
        <span>{RS_CANONICAL_LABEL} <b><CanonicalRsCell row={r} /></b></span>
        <span>3M <b><ListTrustMetric row={r} metricKey="perf3m" label="3M" value={pct(r.perf3m ?? r.snapshot?.perf3m)} /></b></span>
        <span>52w <b><ListTrustMetric row={r} metricKey="distance52w" label="52w" value={pct(r.distance52w)} /></b></span>
        <span>RSQ <b><ListTrustMetric row={r} metricKey="rsQualityScore" label={metricShortLabel("rsQualityScore")} value={num(r.rsQualityScore ?? r.snapshot?.rsQualityScore)} /></b></span>
        <span>Riesgo <b><ListTrustMetric row={r} metricKey="riskScore" label={metricShortLabel("riskScore")} value={num(r.riskScore ?? r.snapshot?.riskScore)} /></b></span>
      </div>
      <p>{shortBusiness(r) || r.theme || r.snapshot?.theme || "Sin contexto"}</p>
      <span className="listMobileReason">{listInclusionSummary(r, listKey)}</span>
    </a>;
    })}
    {!rows.length && <div className="listMobileEmpty">{emptyLabel}</div>}
  </div>;

  if (collapsible) {
    return <details className="card listDisclosure" open={visibleRows.length > 0}>
      <summary className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></summary>
      <ListContractNote listKey={listKey} />
      <ListReliabilityStrip summary={reliability} contractRejected={contractRejected} />
      {table}
      {mobileRows}
    </details>;
  }

  return <section className="card">
    <div className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></div>
    <ListContractNote listKey={listKey} />
    <ListReliabilityStrip summary={reliability} contractRejected={contractRejected} />
    {table}
    {mobileRows}
  </section>;
}

export default function ListsPage() {
  const [scans, setScans] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [filter, setFilter] = useState({ groupType: "", group: "" });
  const [chartsCache, setChartsCache] = useState({});
  const [discovery, setDiscovery] = useState(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [savedListViews, setSavedListViews] = useState([]);
  const [reviewState, setReviewState] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);

  useEffect(() => {
    const storedScans = safeRead(STORAGE_KEYS.scans, []);
    const loadedScans = (Array.isArray(storedScans) ? storedScans : []).filter((scan) => scan?.id !== "seed-scan-01");
    const loadedFavorites = safeRead(STORAGE_KEYS.favorites, []);
    const loadedListViews = normalizeSavedListViews(safeRead(STORAGE_KEYS.listViews, []));
    const loadedReview = safeRead(STORAGE_KEYS.review, {});

    setScans(loadedScans);
    persistLocalScans(loadedScans);
    setFavorites(loadedFavorites);
    setSavedListViews(loadedListViews);
    setReviewState(loadedReview);
    setFilter(queryState());
    setLoaded(true);
  }, []);
  useEffect(() => {
    function refreshReviewState() {
      setReviewState(safeRead(STORAGE_KEYS.review, {}));
    }
    function handleStorage(event) {
      if (!event.key || event.key === STORAGE_KEYS.review) refreshReviewState();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") refreshReviewState();
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", refreshReviewState);
    window.addEventListener("pageshow", refreshReviewState);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", refreshReviewState);
      window.removeEventListener("pageshow", refreshReviewState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return undefined;
    let alive = true;
    setDiscoveryError("");
    setDiscoveryLoading(true);
    const timer = window.setTimeout(() => {
      if (!alive) return;
      fetchJsonWithTimeout(scopedDiscoveryPath(filter), DISCOVERY_TIMEOUT_MS)
        .then((payload) => {
          if (alive) setDiscovery(payload);
        })
        .catch((error) => {
          if (!alive) return;
          console.error("[listas] ranking en vivo no disponible:", error);
          setDiscovery(null);
          setDiscoveryError(userFacingServiceError(error?.message, RANKING_UNAVAILABLE));
        })
        .finally(() => {
          if (alive) setDiscoveryLoading(false);
        });
    }, 1400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [loaded, filter.groupType, filter.group, discoveryAttempt]);

  const latest = scans[0];
  // Discovery puede responder correctamente y aun así no tener listas: el
  // escaneo nocturno del que salen no existe, no terminó bien o no guardó
  // nada. Eso no es un error de red ni una lista vacía por contrato, y no
  // puede quedarse en un "sin datos" genérico.
  const discoveryAbsence = discovery?.source === "nightly_us_unavailable"
    ? (discovery.message || discovery.health?.note || "El escaneo nocturno del mercado estadounidense no está disponible.")
    : "";
  const localRows = useMemo(() => normalizeStockRows(uniqueRows(latest?.rows || [])), [latest]);
  const discoveryReady = discovery?.configured === true && !discoveryError;
  const discoveryRows = useMemo(() => normalizeStockRows(uniqueRows(discovery?.rows || [])), [discovery]);
  const useDiscovery = discoveryReady && discoveryRows.length > 0;
  const allRows = useMemo(() => useDiscovery ? discoveryRows : localRows, [useDiscovery, discoveryRows, localRows]);
  // «Datos actualizados» solo si los precios lo están: con 2+ sesiones de retraso se dice la fecha (lib/dataAge.js).
  const dataAgeNotice = useMemo(() => buildDataAgeNotice(allRows), [allRows]);
  const rows = useMemo(() => applyGroupFilter(allRows, filter.groupType, filter.group), [allRows, filter]);
  const favoritesAsRows = useMemo(() => favorites.map(favoriteToRow), [favorites]);
  const discoveryListContracts = useMemo(() => Object.fromEntries((discovery?.lists || []).map((list) => {
    const normalizedRows = normalizeStockRows(list.items || []);
    return [list.key, enforceListContractRows(normalizedRows, list.key)];
  })), [discovery]);
  const discoveryListRows = useMemo(() => Object.fromEntries(Object.entries(discoveryListContracts).map(([key, result]) => [key, result.rows || []])), [discoveryListContracts]);
  // Motivo de cada lista vacía (frescura, sin datos, criterio), calculado en el
  // servidor (lib/discovery.js → listEmptyReason).
  const discoveryEmptyReasonByKey = useMemo(() => Object.fromEntries((discovery?.lists || []).map((list) => [list.key, list.emptyReason?.text || ""])), [discovery]);
  const discoveryRejectedByKey = useMemo(() => Object.fromEntries(Object.entries(discoveryListContracts).map(([key, result]) => [key, result.rejectedCount || 0])), [discoveryListContracts]);
  const currentListViewSignature = listViewSignature(filter);
  const longRows = useMemo(() => rows.filter((row) => isLongOpportunityRow(row)), [rows]);
  const trendTemplateRows = useMemo(() => rows.filter((row) => isLongOpportunityRow(row, { requireTrendTemplate: true })), [rows]);

  const leaders = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "leaders") ? discoveryListRows.leaders : sortByMetric(longRows.filter((r) => rowPassesListContract(r, "leaders")), "objectiveScore"), [useDiscovery, discoveryListRows, longRows]);
  const rsQuality = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "rsQuality") ? discoveryListRows.rsQuality : sortByMetric(longRows.filter((r) => rowPassesListContract(r, "rsQuality")), "rsQualityScore"), [useDiscovery, discoveryListRows, longRows]);
  const weakness = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "weakness") ? discoveryListRows.weakness : sortByMetric(rows.filter((r) => rowPassesListContract(r, "weakness")), "weaknessScore"), [useDiscovery, discoveryListRows, rows]);
  const weinstein = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "weinstein") ? discoveryListRows.weinstein : sortByMetric(trendTemplateRows.filter((r) => rowPassesListContract(r, "weinstein")), "weinsteinScore"), [useDiscovery, discoveryListRows, trendTemplateRows]);
  const minervini = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "minervini") ? discoveryListRows.minervini : sortByMetric(trendTemplateRows.filter((r) => rowPassesListContract(r, "minervini")), "minerviniScore"), [useDiscovery, discoveryListRows, trendTemplateRows]);
  const nearPivot = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "nearPivot") ? discoveryListRows.nearPivot : longRows.filter((r) => rowPassesListContract(r, "nearPivot")).sort((a, b) => (b.objectiveScore ?? b.totalScore ?? 0) - (a.objectiveScore ?? a.totalScore ?? 0)), [useDiscovery, discoveryListRows, longRows]);
  const ipo = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "ipo") ? discoveryListRows.ipo : longRows.filter((r) => rowPassesListContract(r, "ipo")).sort((a, b) => (b.ipoScore || 0) - (a.ipoScore || 0)), [useDiscovery, discoveryListRows, longRows]);
  const extended = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "extended") ? discoveryListRows.extended : longRows.filter((r) => rowPassesListContract(r, "extended")).sort((a, b) => (b.objectiveScore ?? b.totalScore ?? 0) - (a.objectiveScore ?? a.totalScore ?? 0)), [useDiscovery, discoveryListRows, longRows]);
  const pullback = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "pullback") ? discoveryListRows.pullback : longRows.filter((r) => rowPassesListContract(r, "pullback")).sort((a, b) => (b.objectiveScore ?? b.totalScore ?? 0) - (a.objectiveScore ?? a.totalScore ?? 0)), [useDiscovery, discoveryListRows, longRows]);
  // Las nueve listas se siguen calculando enteras: RETIRED_LIST_SECTIONS solo
  // decide cuáles se pintan. Devolver una es quitar su clave de ahí, sin
  // tocar contratos ni cálculo.
  const allListSections = useMemo(() => [
    { key: "leaders", title: "Score compuesto", desc: "Ranking principal sin bonus VCP", rows: leaders, contractRejected: discoveryRejectedByKey.leaders || 0 },
    { key: "rsQuality", title: "Líderes por calidad de RS", desc: "RS alto con volatilidad y caída máxima controladas", rows: rsQuality, scoreKey: "rsQualityScore", contractRejected: discoveryRejectedByKey.rsQuality || 0 },
    { key: "weakness", title: "Deterioro técnico", desc: "Debilidad observable para evitar largos o estudiar cortos", rows: weakness, scoreKey: "weaknessScore", contractRejected: discoveryRejectedByKey.weakness || 0 },
    { key: "weinstein", title: "Tendencia establecida", desc: "Mejor estructura de etapa/tendencia", rows: weinstein, scoreKey: "weinsteinScore", contractRejected: discoveryRejectedByKey.weinstein || 0 },
    { key: "minervini", title: "Rupturas con contracción", desc: "Estructura de tendencia, momentum y máximos", rows: minervini, scoreKey: "minerviniScore", contractRejected: discoveryRejectedByKey.minervini || 0 },
    { key: "nearPivot", title: "Vigilancia pivot", desc: "Setup observable cerca de pivot; no equivale a plan automático", rows: nearPivot, contractRejected: discoveryRejectedByKey.nearPivot || 0 },
    { key: "ipo", title: "IPO / New Leaders", desc: "Solo IPOs reales verificables <= 5 años", rows: ipo, scoreKey: "ipoScore", contractRejected: discoveryRejectedByKey.ipo || 0 },
    { key: "extended", title: "Fuertes pero extendidos", desc: "Muy fuertes, pero conviene vigilar su extensión sobre la SMA50", rows: extended, contractRejected: discoveryRejectedByKey.extended || 0 },
    { key: "pullback", title: "Retroceso a la SMA50", desc: "Líderes que han vuelto cerca de la SMA50, para vigilar", rows: pullback, contractRejected: discoveryRejectedByKey.pullback || 0 },
  ], [leaders, rsQuality, weakness, weinstein, minervini, nearPivot, ipo, extended, pullback, discoveryRejectedByKey]);
  const listSections = useMemo(() => allListSections
    .filter((section) => !RETIRED_LIST_SECTIONS[section.key])
    .map((section) => ({ ...section, emptyReason: useDiscovery ? discoveryEmptyReasonByKey[section.key] || "" : "" })), [allListSections, useDiscovery, discoveryEmptyReasonByKey]);
  // Nocturno leído pero ninguna lista con valores: se dice por qué (D6).
  const discoveryEmptyReason = useMemo(() => {
    if (!discovery || discovery.configured !== true || discoveryError || discoveryAbsence) return "";
    if ((discovery.rows || []).length > 0) return "";
    const reasons = [...new Set((discovery.lists || []).map((list) => list.emptyReason?.text).filter(Boolean))];
    if (reasons.length === 1) return reasons[0];
    if (reasons.length) return `Las listas del escaneo nocturno están vacías: ${reasons.slice(0, 3).join(" ")}`;
    return discovery.health?.note || "";
  }, [discovery, discoveryError, discoveryAbsence]);
  const rankingAppearances = useMemo(() => listSections.reduce((sum, section) => sum + (section.rows || []).slice(0, 18).length, 0), [listSections]);
  const activeRankingCount = useMemo(() => listSections.filter((section) => (section.rows || []).length > 0).length, [listSections]);
  const activeSavedView = useMemo(() => savedListViews.find((view) => view.signature === currentListViewSignature) || null, [savedListViews, currentListViewSignature]);
  const hasAnyListRows = favoritesAsRows.length > 0 || listSections.some((section) => (section.rows || []).length > 0);
  const hasListSource = rows.length > 0 || favoritesAsRows.length > 0 || useDiscovery;
  const showListTables = hasListSource || hasAnyListRows;
  const showEmptyState = !showListTables;
  const coverageAudit = useMemo(() => {
    if (useDiscovery && discovery?.audit) return discovery.audit;
    return buildCoverageAudit({
      inputRows: rows,
      rankedRows: listSections.flatMap((section) => section.rows || []),
      lists: listSections,
      scopeType: filter.groupType || "global",
      scopeValue: filter.group || "",
    });
  }, [useDiscovery, discovery, rows, listSections, filter.groupType, filter.group]);
  const decisionTraceability = useMemo(() => buildDecisionTraceabilitySummary([...rows, ...favoritesAsRows], reviewState), [rows, favoritesAsRows, reviewState]);

  // Recolectar todos los tickers visibles únicos en pantalla (top 18 de cada lista)
  const visibleTickers = useMemo(() => {
    const set = new Set();
    const addRows = (list) => {
      if (!Array.isArray(list)) return;
      list.slice(0, 18).forEach((r) => {
        if (r && r.symbol) set.add(r.symbol);
      });
    };
    addRows(favoritesAsRows);
    listSections.forEach((section) => addRows(section.rows));
    return Array.from(set);
  }, [favoritesAsRows, listSections]);

  // useEffect para descargar secuencialmente en lotes los sparklines de la API real
  useEffect(() => {
    if (!visibleTickers.length) return;
    let active = true;

    const fetchRealCharts = async () => {
      const neededTickers = visibleTickers.filter((symbol) => {
        // Si ya tiene chartPreview real de base de datos/scan anterior
        const rowFromScans = allRows.find(r => r.symbol === symbol) || favoritesAsRows.find(r => r.symbol === symbol);
        if (rowFromScans && Array.isArray(rowFromScans.chartPreview) && rowFromScans.chartPreview.length >= 2) {
          return false;
        }
        // Si ya está en nuestra caché reactiva
        if (chartsCache[symbol]) {
          return false;
        }
        return true;
      });

      if (!neededTickers.length) return;

      // Un viaje por 30 símbolos (GET /api/chart/batch) en vez de uno por
      // símbolo: antes las miniaturas iban apareciendo a goteo durante ~5 s con
      // 50 valores. Si un lote falla se cae al método de siempre, símbolo a símbolo.
      const applyBars = (symbol, rawBars) => {
        if (!active) return;
        const preview = rawBars.length >= 2 ? chartPreviewBars(rawBars) : null;
        setChartsCache((prev) => ({ ...prev, [symbol]: preview }));
      };
      const fetchOne = async (symbol) => {
        try {
          const data = await getJson(`/api/chart?symbol=${encodeURIComponent(symbol)}`, { timeoutMs: 12000 });
          applyBars(symbol, data.bars || []);
        } catch (e) {
          console.error(`Error al cargar gráfico real para ${symbol}:`, e);
          if (active) setChartsCache((prev) => ({ ...prev, [symbol]: null }));
        }
      };

      const chunkSize = 30;
      for (let i = 0; i < neededTickers.length; i += chunkSize) {
        if (!active) break;
        const chunk = neededTickers.slice(i, i + chunkSize);
        try {
          const data = await getJson(`/api/chart/batch?symbols=${encodeURIComponent(chunk.join(","))}`, { timeoutMs: 15000 });
          const charts = data?.charts || {};
          chunk.forEach((symbol) => applyBars(symbol, Array.isArray(charts[symbol]) ? charts[symbol] : []));
        } catch (e) {
          console.error("Lote de gráficos no disponible; se pide símbolo a símbolo:", e);
          for (let j = 0; j < chunk.length && active; j += 4) {
            await Promise.all(chunk.slice(j, j + 4).map(fetchOne));
          }
        }
      }
    };

    fetchRealCharts();
    return () => {
      active = false;
    };
  }, [visibleTickers, allRows, favoritesAsRows]);

  function persistSavedListViews(nextViews = []) {
    const normalized = normalizeSavedListViews(nextViews);
    setSavedListViews(normalized);
    safeWrite(STORAGE_KEYS.listViews, normalized);
    return normalized;
  }

  function saveCurrentListView() {
    const now = new Date().toISOString();
    const draft = buildSavedListView({ filter, discovery, usingDiscovery: useDiscovery, localRows: localRows.length, now, id: currentListViewSignature });
    const updated = {
      ...draft,
      id: currentListViewSignature,
      updatedAt: now,
      savedAt: savedListViews.find((view) => view.signature === currentListViewSignature)?.savedAt || now,
    };
    persistSavedListViews([updated, ...savedListViews.filter((view) => view.signature !== currentListViewSignature)]);
  }

  function deleteSavedListView(id) {
    persistSavedListViews(savedListViews.filter((view) => view.id !== id));
  }

  const scopeFacts = listScopeFacts({ filter, rowsCount: rows.length, savedView: activeSavedView });
  const sourceLabel = discoveryLoading ? "..." : useDiscovery ? (dataAgeNotice ? dataAgeNotice.label : "Datos actualizados") : loaded ? "Datos guardados" : "-";
  const traceResolved = decisionTraceability?.resolvedCount || 0;

  /* Paso 9 (rediseño 2026-11): ticket de 44 px en lugar del hero, la botonera
     cruzada (la topbar ya navega) y las tarjetas de KPI. Las cifras de los
     tiles («acciones únicas», «favoritos», «fuente rankings», «última copia
     local», «Vista actual») viven en la verdad corta; la nota de alcance en su
     tooltip. «Vista rápida» pasa a «Revisar», como en el screener. */
  return <main className="page listsPage ptPage">
    <PageTicket
      title="Listas"
      chip={scopeFacts.scope.label}
      chipTitle="Alcance de los rankings"
      truth={<>
        <b>{loaded ? rows.length : "-"}</b> acciones únicas
        {scopeFacts.scopeRows !== null ? <> · <b>{scopeFacts.scopeRows}</b> en grupo</> : null}
        {scopeFacts.savedRows !== null ? <> · <b>{scopeFacts.savedRows}</b> en el conteo guardado</> : null}
        {" · "}<b>{activeRankingCount}</b> listas con datos · <b>{rankingAppearances}</b> apariciones
        {" · "}<b>{loaded ? favorites.length : "-"}</b> favoritos
        {traceResolved ? <> · <b>{traceResolved}</b> resueltas en Review</> : null}
        {" · "}<span className="listsTicketSource" data-kpi="fuente rankings" title={useDiscovery && dataAgeNotice ? dataAgeNotice.detail : undefined}>{sourceLabel}</span>
        {loaded && latest ? <> · copia local {dateShort(latest.createdAt)}</> : null}
      </>}
      truthTitle={scopeFacts.note}
    >
      {filter.group ? <a className="btn" href="/lists" title={`Filtro activo: ${filter.groupType} = ${filter.group}`}>Quitar filtro</a> : null}
      <button className="btn" type="button" onClick={saveCurrentListView} title={activeSavedView ? "Esta vista ya está guardada; vuelve a guardarla para actualizarla" : "Guarda el filtro actual para volver a él"}>
        {activeSavedView ? "Vista guardada" : "Guardar vista"}
      </button>
      <a className="btn btnPrimary" href="/review?source=latest">Revisar</a>
    </PageTicket>
    {useDiscovery && <QualityStrip items={listsQualityItems({ dataAsOf: discovery?.dataAsOf, rsAsOf: discovery?.rsAsOf, nightly: discovery?.nightly, coverage: discovery?.coverage })} />}
    <ListsInfraStrip
      discovery={discovery}
      discoveryError={discoveryError}
      discoveryLoading={discoveryLoading}
      useDiscovery={useDiscovery}
      localRows={localRows.length}
      filter={filter}
      coverageAudit={coverageAudit}
    />
    {/* La trazabilidad solo ocupa sitio cuando hay algo trazado: con cero
        resoluciones eran cuatro tiles a cero (el recuento va en el ticket). */}
    {traceResolved > 0 ? <DecisionTracePanel summary={decisionTraceability} detail="Resoluciones de Review/Ficha detectadas en las listas y favoritos visibles." /> : null}
    {savedListViews.length ? <SavedListViewsPanel views={savedListViews} currentSignature={currentListViewSignature} onDelete={deleteSavedListView} /> : null}
    {/* Con datos locales a la vista, el aviso va aparte: lo que se está
        enseñando es una copia guardada en este navegador, y decir de dónde
        sale importa más cuando la pantalla NO está vacía. */}
    {discoveryAbsence && !showEmptyState && <section className="card status">{discoveryAbsence} Mientras tanto se muestra la copia guardada en este dispositivo.</section>}
    {showEmptyState ? <ListsEmptyState loading={!loaded || discoveryLoading} hasSnapshot={localRows.length > 0 || scans.length > 0} discoveryError={discoveryError} absence={discoveryAbsence} emptyReason={discoveryEmptyReason} onRetry={() => setDiscoveryAttempt((value) => value + 1)} /> : <>
      {favoritesAsRows.length > 0 ? <MiniTable title="Favoritos" desc="Tu watchlist curada" rows={favoritesAsRows} chartsCache={chartsCache} reviewState={reviewState} listKey="favorites" collapsible={false} emptyLabel={loaded ? "Aún no tienes favoritos guardados." : "Cargando listas…"} /> : null}
      {listSections.map((section) => <MiniTable
        key={section.key}
        title={section.title}
        desc={section.desc}
        rows={section.rows}
        chartsCache={chartsCache}
        reviewState={reviewState}
        listKey={section.key}
        scoreKey={section.scoreKey || "objectiveScore"}
        contractRejected={section.contractRejected || 0}
        emptyLabel={loaded ? (section.emptyReason || "Ninguna acción cumple ahora el contrato de esta lista.") : "Cargando listas…"}
      />)}
    </>}
  </main>;
}
