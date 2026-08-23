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

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getJson } from "@/lib/clientApi";
import { num } from "@/lib/formatters";
import { userFacingServiceError } from "@/lib/serviceErrors";
import { stockUrl } from "@/lib/symbols";
import { formatDayLabel, stageWord } from "@/lib/weeklyChanges";

const FETCH_TIMEOUT_MS = 20000;
const ROWS_COLLAPSED = 10;
const URL_PARAM = "cambios";
const URL_VALUE = "semana";

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

// El motivo de una ausencia, en lenguaje de producto. Nunca un cero mudo.
function notComparableText(payload = {}) {
  const reason = String(payload.reason || "");
  if (reason === "only-pre-cutover-anchors" || reason === "stage-criteria-changed") {
    return "sin dos escaneos comparables todavía: el criterio de etapa se actualizó el 17 de agosto. El resumen vuelve con los próximos escaneos.";
  }
  if (reason === "no-sessions-between-scans") {
    return "sin sesión de mercado entre los escaneos comparables · sin cambios que contar.";
  }
  return "aún no hay dos escaneos comparables · el resumen vuelve con el próximo escaneo nocturno.";
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
} = {}) {
  if (loading) {
    return <p className="weeklyChangesLine weeklyChangesQuiet" role="status">Cambios de la semana · comprobando…</p>;
  }
  if (error) {
    return <p className="weeklyChangesLine weeklyChangesQuiet">Cambios de la semana · {error}</p>;
  }
  if (!payload) return null;
  if (payload.state === "cloud-off") {
    return <p className="weeklyChangesLine weeklyChangesQuiet">Cambios de la semana · {payload.message || "la copia en la nube no está activada."}</p>;
  }
  if (payload.state === "no-scan") {
    return <p className="weeklyChangesLine weeklyChangesQuiet">Cambios de la semana · aún no hay escaneo nocturno del que partir.</p>;
  }
  if (payload.state === "not-comparable") {
    return <p className="weeklyChangesLine weeklyChangesQuiet">Cambios de la semana · {notComparableText(payload)}</p>;
  }
  if (payload.state !== "ok") return null;

  const { window: win = {}, population = {}, stage2 = {}, highs = {} } = payload;
  const fromLabel = formatDayLabel(win.from);
  const toLabel = formatDayLabel(win.to);
  const entriesCount = stage2.entries?.count ?? 0;
  const exitsCount = stage2.exits?.count ?? 0;
  const newCount = highs.newThisWindow?.count ?? 0;
  const nearCount = highs.alreadyNear?.count ?? 0;
  const noAnchorCount = highs.noAnchor?.count ?? 0;
  const cutoverNote = win.partialWeek && win.partialReason === "stage-criteria-cutover";

  return (
    <>
      <p className="weeklyChangesLine">
        <span className="weeklyChangesSince">Desde el {fromLabel}</span>
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

      {open ? (
        <section className="weeklyChangesPanel" role="region" aria-label="Cambios de la semana">
          <header className="weeklyChangesPanelHead">
            <h2>Cambios del {fromLabel} al {toLabel}</h2>
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

export default function WeeklyChangesLine({ onOpenStock }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [sortKey, setSortKey] = useState("rs");
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [focusSection, setFocusSection] = useState("");
  const pushedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getJson(`/api/weekly-changes`, { timeoutMs: FETCH_TIMEOUT_MS })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(userFacingServiceError(err?.message, "no disponibles ahora mismo."));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // El panel vive en la URL (?cambios=semana): un enlace directo lo abre y el
  // gesto atrás lo cierra. popstate es la única fuente de verdad al navegar.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const readParam = () => new URLSearchParams(window.location.search).get(URL_PARAM) === URL_VALUE;
    if (readParam()) setOpen(true);
    const onPop = () => {
      pushedRef.current = false;
      setOpen(readParam());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!open || !focusSection) return;
    const id = WEEKLY_SECTION_IDS[focusSection];
    setFocusSection("");
    // Salto directo, no animado: un scroll suave de miles de píxeles no
    // recalcula el destino si el layout cambia durante la animación, y en
    // pestañas ocultas los rAF no corren — el salto no depende de ninguno.
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [open, focusSection]);

  const openPanel = useCallback((section = "") => {
    setOpen(true);
    if (section) setFocusSection(section);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(URL_PARAM) !== URL_VALUE) {
      url.searchParams.set(URL_PARAM, URL_VALUE);
      window.history.pushState({ weeklyChanges: true }, "", url);
      pushedRef.current = true;
    }
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    if (typeof window === "undefined") return;
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has(URL_PARAM)) {
      url.searchParams.delete(URL_PARAM);
      window.history.replaceState(null, "", url);
    }
  }, []);

  const handleExpand = useCallback((listKey) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.add(listKey);
      return next;
    });
  }, []);

  return renderWeeklyChangesView({
    payload,
    loading,
    error,
    open,
    sortKey,
    expandedKeys,
    onToggleOpen: () => (open ? closePanel() : openPanel()),
    onOpenSection: openPanel,
    onClose: closePanel,
    onSortKey: setSortKey,
    onExpand: handleExpand,
    onOpenStock,
  });
}
