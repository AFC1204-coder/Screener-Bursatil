"use client";

// WeeklyChangesLine — la respuesta a «qué ha cambiado esta semana», como una
// línea discreta bajo el título del screener más un panel de detalle anclado.
//
// Diseño: docs/diseno-que-cambio-2026-08-16.md (Partes C y D). Reglas que este
// componente cumple por contrato:
//   - Una línea, misma jerarquía tipográfica que el subtítulo: ni caja, ni
//     icono de aviso. Declara desde cuándo compara, con día nombrado.
//   - Cifras con nombre, nunca un total agregado; los ceros se escriben.
//   - Si no hay comparación posible, la ausencia se dice con su motivo.
//   - El panel se refleja en la URL (?cambios=semana): enlazable y el gesto
//     atrás lo cierra, sin ser un destino del menú.
//
// Arquitectura, como GlobalCoveragePanel: el componente posee estado y fetch;
// la función pura `renderWeeklyChangesView` produce el árbol y es testeable
// con renderToStaticMarkup sin timers ni efectos.

import { useEffect } from "react";
import Link from "next/link";
import { num } from "@/lib/formatters";
import { isTimeoutFetchError } from "@/lib/marketHealthFetch";
import { stockUrl } from "@/lib/symbols";
import { formatDayLabel, stageWord, weeklyWindowLabel } from "@/lib/weeklyChanges";
import { useWeeklyChanges } from "@/app/components/screener/useWeeklyChanges";

// Paso 6: el fetch y el estado viven en useWeeklyChanges (compartidos con el
// raíl de vistas); se re-exportan aquí para no romper a quien los importa.
export {
  WEEKLY_CHANGES_FETCH_TIMEOUT_MS,
  WEEKLY_CHANGES_MAX_ATTEMPTS,
  WEEKLY_CHANGES_RETRY_DELAY_MS,
  isWeeklyChangesSoftFailure,
  loadWeeklyChangesPayload,
} from "@/app/components/screener/useWeeklyChanges";

const ROWS_COLLAPSED = 10;

export const WEEKLY_SECTION_IDS = {
  stage2: "weeklyChangesStage2",
  highs: "weeklyChangesHighs",
};

const SORT_OPTIONS = [
  ["rs", "RS"],
  ["symbol", "Ticker"],
  ["d52", "Distancia al máximo"],
];

function plural(count, singular, pluralWord) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function sortRows(rows = [], sortKey = "rs") {
  const sorted = [...rows];
  if (sortKey === "symbol") {
    sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
  } else if (sortKey === "d52") {
    // Más cerca del máximo primero; sin dato, al final.
    sorted.sort((a, b) => {
      const dA = Number.isFinite(a.d52Now) ? a.d52Now : -Infinity;
      const dB = Number.isFinite(b.d52Now) ? b.d52Now : -Infinity;
      if (dB !== dA) return dB - dA;
      return a.symbol.localeCompare(b.symbol);
    });
  } else {
    sorted.sort((a, b) => {
      const rsA = Number.isFinite(a.rs) ? a.rs : -1;
      const rsB = Number.isFinite(b.rs) ? b.rs : -1;
      if (rsB !== rsA) return rsB - rsA;
      return a.symbol.localeCompare(b.symbol);
    });
  }
  return sorted;
}

function distanceText(d52) {
  if (!Number.isFinite(d52)) return null;
  if (d52 === 0) return "en máximo";
  return `a ${num(Math.abs(d52), 1)}% del máx.`;
}

function rowShift(row, kind) {
  if (kind === "stage") return `${stageWord(row.stageFrom)} → ${stageWord(row.stageTo)}`;
  if (!Number.isFinite(row.d52Anchor)) return "sin dato previo";
  return `venía de un ${num(Math.abs(row.d52Anchor), 1)}%`;
}

function rowContext(row, kind) {
  const rs = Number.isFinite(row.rs) ? `RS ${num(row.rs, 0)}` : "RS –";
  const dist = distanceText(row.d52Now);
  if (kind === "stage") return dist ? `${rs} · ${dist}` : rs;
  return dist ? `${rs} · ${dist}` : rs;
}

function ChangeList({ title, rows, kind, listKey, sortKey, expanded, onExpand, onOpenStock }) {
  const sorted = sortRows(rows, sortKey);
  const visible = expanded ? sorted : sorted.slice(0, ROWS_COLLAPSED);
  return (
    <div className="weeklyChangesList">
      <h3>{title}</h3>
      {sorted.length === 0 ? (
        <p className="weeklyChangesEmpty">Ninguna en esta ventana.</p>
      ) : (
        <ul>
          {visible.map((row) => (
            <li key={row.symbol} className="weeklyChangesRow">
              <Link
                className="weeklyChangesTicker"
                prefetch={false}
                href={stockUrl(row.symbol)}
                onClick={() => onOpenStock?.(row)}
              >
                {row.symbol}
              </Link>
              <span className="weeklyChangesName" title={row.name || row.symbol}>
                {row.name || row.symbol}
                {row.theme ? <em> · {row.theme}</em> : null}
              </span>
              <span className="weeklyChangesShift">{rowShift(row, kind)}</span>
              <span className="weeklyChangesCtx">{rowContext(row, kind)}</span>
            </li>
          ))}
        </ul>
      )}
      {sorted.length > ROWS_COLLAPSED && !expanded ? (
        <button type="button" className="weeklyChangesMoreBtn" onClick={() => onExpand?.(listKey)}>
          Mostrar los {sorted.length}
        </button>
      ) : null}
    </div>
  );
}

export function renderWeeklyChangesView({
  payload = null,
  loading = false,
  error = "",
  open = false,
  sortKey = "rs",
  expandedKeys = new Set(),
  onToggleOpen,
  onOpenSection,
  onClose,
  onSortKey,
  onExpand,
  onOpenStock,
  compact = false,
  panelOnly = false,
} = {}) {
  if (loading) {
    // P10: silencio mientras no hay delta útil (no «comprobando…» en el H1).
    return null;
  }
  // Timeout / infra no deben dejar la cabecera en tono de fallo permanente.
  // El caller ya degrada a softFailure→error vacío; esto es cinturón si llega
  // un mensaje de timeout por otra vía.
  if (error && isTimeoutFetchError({ message: error })) {
    return null;
  }
  if (error) {
    // P10: sin delta útil no ocupamos el subtítulo (fallo quiet → silencio).
    return null;
  }
  if (!payload) return null;
  if (payload.state === "cloud-off") {
    return null;
  }
  if (payload.state === "no-scan") {
    return null;
  }
  if (payload.state === "not-comparable") {
    return null;
  }
  if (payload.state !== "ok") return null;

  const { window: win = {}, population = {}, stage2 = {}, highs = {} } = payload;
  const fromLabel = formatDayLabel(win.from);
  const toLabel = formatDayLabel(win.to);
  // D2 (auditoría 2026-11): la ventana es semanal, viernes a viernes, y se
  // nombra con sus fechas («Semana 9 → 16 oct»).
  const weekLabel = weeklyWindowLabel(win.fromWeekEnd || win.from, win.toWeekEnd || win.to) || `Desde el ${fromLabel}`;
  const entriesCount = stage2.entries?.count ?? 0;
  const exitsCount = stage2.exits?.count ?? 0;
  const newCount = highs.newThisWindow?.count ?? 0;
  const nearCount = highs.alreadyNear?.count ?? 0;
  const noAnchorCount = highs.noAnchor?.count ?? 0;
  const cutoverNote = win.partialWeek && win.partialReason === "stage-criteria-cutover";

  // Rediseño 2026-11 (paso 4): en el ticket la frase larga no se pinta; queda
  // un único enlace que abre el mismo panel. Las cifras siguen en el panel y en
  // el title del enlace (las vistas «Esta noche» del raíl las absorben, paso 6).
  const compactSummary = `${weekLabel} · Etapa 2: ${plural(entriesCount, "entrada", "entradas")}, ${plural(exitsCount, "salida", "salidas")} · Máximos de 52 semanas: ${plural(newCount, "nuevo", "nuevos")}, ${nearCount} ya cerca`;
  const line = panelOnly ? null : compact ? (
    <p className="weeklyChangesLine weeklyChangesLine--compact">
      <button
        type="button"
        className="weeklyChangesDetailBtn"
        aria-expanded={open}
        title={compactSummary}
        onClick={() => onToggleOpen?.()}
      >
        Cambios de la semana
      </button>
    </p>
  ) : (
      <p className="weeklyChangesLine">
        <span className="weeklyChangesSince">{weekLabel}</span>
        <span aria-hidden="true"> · </span>
        <button
          type="button"
          className="weeklyChangesFigure"
          aria-label="Abrir el detalle de entradas y salidas de etapa 2"
          onClick={() => onOpenSection?.("stage2")}
        >
          Etapa 2: <b>{plural(entriesCount, "entrada", "entradas")}</b>, <b>{plural(exitsCount, "salida", "salidas")}</b>
        </button>
        <span aria-hidden="true"> · </span>
        <button
          type="button"
          className="weeklyChangesFigure"
          aria-label="Abrir el detalle de máximos de 52 semanas"
          onClick={() => onOpenSection?.("highs")}
        >
          Máximos de 52 semanas: <b>{plural(newCount, "nuevo", "nuevos")}</b>, <b>{nearCount} ya cerca</b>
        </button>
        <span aria-hidden="true"> · </span>
        <button
          type="button"
          className="weeklyChangesDetailBtn"
          aria-expanded={open}
          onClick={() => onToggleOpen?.()}
        >
          {open ? "cerrar detalle" : "ver detalle"}
        </button>
      </p>
  );

  return (
    <>
      {line}

      {open ? (
        <section className="weeklyChangesPanel" role="region" aria-label="Cambios de la semana">
          <header className="weeklyChangesPanelHead">
            <h2>{weekLabel}</h2>
            <div className="weeklyChangesPanelTools">
              <label>
                Orden
                <select value={sortKey} onChange={(event) => onSortKey?.(event.target.value)}>
                  {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="button" className="weeklyChangesCloseBtn" onClick={() => onClose?.()} aria-label="Cerrar el detalle de cambios">✕</button>
            </div>
          </header>

          {cutoverNote ? (
            <p className="weeklyChangesNote">
              La ventana no llega al viernes anterior: el criterio de clasificación de etapa se
              actualizó el 17 de agosto y los escaneos previos no son comparables con el actual.
            </p>
          ) : null}

          <details className="weeklyChangesSection" open id={WEEKLY_SECTION_IDS.stage2}>
            <summary>Etapa 2 — {plural(entriesCount, "entrada", "entradas")} · {plural(exitsCount, "salida", "salidas")}</summary>
            <ChangeList
              title={`Entradas (${entriesCount})`}
              rows={stage2.entries?.rows || []}
              kind="stage"
              listKey="entries"
              sortKey={sortKey}
              expanded={expandedKeys.has("entries")}
              onExpand={onExpand}
              onOpenStock={onOpenStock}
            />
            <ChangeList
              title={`Salidas (${exitsCount})`}
              rows={stage2.exits?.rows || []}
              kind="stage"
              listKey="exits"
              sortKey={sortKey}
              expanded={expandedKeys.has("exits")}
              onExpand={onExpand}
              onOpenStock={onOpenStock}
            />
          </details>

          <details className="weeklyChangesSection" open id={WEEKLY_SECTION_IDS.highs}>
            <summary>Máximos de 52 semanas — {plural(newCount, "nuevo", "nuevos")} · {nearCount} ya estaban cerca</summary>
            <ChangeList
              title={`Nuevos en la ventana (${newCount})`}
              rows={highs.newThisWindow?.rows || []}
              kind="high"
              listKey="newHighs"
              sortKey={sortKey}
              expanded={expandedKeys.has("newHighs")}
              onExpand={onExpand}
              onOpenStock={onOpenStock}
            />
            <ChangeList
              title={`Ya estaban cerca (${nearCount})`}
              rows={highs.alreadyNear?.rows || []}
              kind="high"
              listKey="alreadyNear"
              sortKey={sortKey}
              expanded={expandedKeys.has("alreadyNear")}
              onExpand={onExpand}
              onOpenStock={onOpenStock}
            />
            {noAnchorCount > 0 ? (
              <p className="weeklyChangesEmpty">{plural(noAnchorCount, "valor en zona de máximo sin dato al inicio de la ventana", "valores en zona de máximo sin dato al inicio de la ventana")}: sin comparación posible, no aparecen en los grupos.</p>
            ) : null}
          </details>

          <footer className="weeklyChangesFoot">
            <p>
              Sobre {num(population.paired ?? 0, 0)} valores de EE. UU. presentes en ambos escaneos
              ({num(population.current ?? 0, 0)} en el actual)
              {population.enteredCoverage || population.leftCoverage
                ? ` · ${num(population.enteredCoverage ?? 0, 0)} entraron en cobertura y ${num(population.leftCoverage ?? 0, 0)} salieron: sin comparación previa, no cuentan en las cifras`
                : ""}.
            </p>
            <p>
              Comparación del cierre del {fromLabel} al cierre del {toLabel}. Zona de máximo: cierre a
              menos del 1% del máximo de 52 semanas; «ya estaban cerca»: a menos del 5% al inicio de la
              ventana.
            </p>
          </footer>
        </section>
      ) : null}
    </>
  );
}

/**
 * @param {object} props
 * @param {Function} [props.onOpenStock]
 * @param {boolean} [props.defer] — T9: no fetch ni «comprobando…» hasta que la
 *   mesa salga de cold restore (una historia de progreso = status del escaneo).
 * @param {object} [props.weekly] — estado de useWeeklyChanges ya creado por el
 *   screener (paso 6: una sola petición para raíl y panel). Sin él, el
 *   componente se sirve solo.
 * @param {boolean} [props.panelOnly] — no pinta la línea/enlace, solo el panel
 *   cuando está abierto (el raíl es quien lo abre).
 */
export default function WeeklyChangesLine({ onOpenStock, defer = false, compact = false, weekly = null, panelOnly = false }) {
  const own = useWeeklyChanges({ defer, passive: Boolean(weekly) });
  const state = weekly || own;
  const { open, focusSection, consumeFocusSection } = state;

  useEffect(() => {
    if (!open || !focusSection) return;
    const id = WEEKLY_SECTION_IDS[consumeFocusSection()];
    // Salto directo, no animado: un scroll suave de miles de píxeles no
    // recalcula el destino si el layout cambia durante la animación, y en
    // pestañas ocultas los rAF no corren — el salto no depende de ninguno.
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [open, focusSection, consumeFocusSection]);

  // T9: durante cold restore no pintamos «comprobando…» — el status del escaneo
  // es la única historia de progreso.
  if (defer) return null;

  return renderWeeklyChangesView({
    payload: state.payload,
    loading: state.loading,
    error: state.error,
    open,
    sortKey: state.sortKey,
    expandedKeys: state.expandedKeys,
    onToggleOpen: state.togglePanel,
    onOpenSection: state.openPanel,
    onClose: state.closePanel,
    onSortKey: state.setSortKey,
    onExpand: state.expand,
    onOpenStock,
    compact,
    panelOnly,
  });
}
