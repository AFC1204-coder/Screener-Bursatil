"use client";

// GlobalCoveragePanel — panel informativo de SOLO LECTURA sobre la cobertura
// internacional por mercado. Reutiliza exclusivamente GET /api/coverage.
//
// Objetivo UX: que el usuario entienda que un lote de 50 es trabajo interno del
// escáner, no el universo completo. Por mercado muestra:
//   - universo disponible (inventory.candidates);
//   - resultados frescos/materializados (scan.uniqueSymbols);
//   - acciones elegibles para ranking (scan.rankingEligible);
//   - grado de cobertura (grade + coveragePct);
//   - estado de cobertura (readiness: operativo / parcial / ausente / no disponible).
//
// Restricciones de diseño (Pizarra y Tiza):
//   - Solo --traza / --traza-dim para cobertura/fiabilidad. Nunca --senal.
//   - No hay botones ni enlaces que ejecuten scan/backfill: el backfillPlan, si
//     llega, se muestra como TEXTO informativo (paths), no como acción.
//   - No bloquea la primera pintura: arranca en estado "loading" y hace el fetch
//     asíncrono en el mount del cliente.
//
// Arquitectura: el componente cliente posee el estado y el fetch; la función
// pura `renderGlobalCoverageView({ report, loading, error })` produce el HTML y
// es testeable con renderToStaticMarkup sin timers/efectos (sigue el patrón del
// ScreenerShell presentacional).

import { useEffect, useState } from "react";
import { getJson } from "@/lib/clientApi";

const COVERAGE_FETCH_TIMEOUT_MS = 9000;

const GRADE_LABEL = {
  alta: "Alta",
  util: "Útil",
  parcial: "Parcial",
  baja: "Baja",
};

// Estado de cobertura legible para el usuario, derivado de readiness.state.
// Nunca presenta cobertura parcial/gap/deferred como cobertura completa.
function coverageStateText(readiness = {}) {
  const state = String(readiness?.state || "").toLowerCase();
  const label = readiness?.label || "";
  if (state === "operational") return { text: label || "Cobertura operativa", tone: "operational" };
  if (state === "coverage_gap") return { text: label || "Cobertura baja (brecha)", tone: "gap" };
  if (state === "official_source_missing") return { text: label || "Fuente oficial ausente", tone: "gap" };
  if (state === "inventory_not_materialized") return { text: label || "Inventario sin materializar", tone: "partial" };
  if (state === "partial_provider") return { text: label || "Proveedor parcial", tone: "partial" };
  if (state === "curated_core") return { text: label || "Core curado", tone: "partial" };
  if (state === "deferred_curated") return { text: label || "Mercado diferido", tone: "deferred" };
  if (state === "operational-timeout") return { text: label || "Informe parcial", tone: "partial" };
  return { text: label || "Cobertura no disponible", tone: "gap" };
}

function fmtNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("es-ES");
}

// Métricas que pueden no estar presentes en la respuesta: degradamos honestamente
// a "—" en vez de sustituir silenciosamente por otra métrica (p.ej. uniqueSymbols
// cuando falta fresh). La confusión entre métricas es justo lo que evitamos.
function fmtNumOrDash(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-ES");
}

export function renderGlobalCoverageView({ report = null, loading = false, error = "" } = {}) {
  if (loading) {
    return (
      <div className="globalCoveragePanel globalCoverageLoading" role="status" aria-live="polite">
        <span className="globalCoverageSpinner" aria-hidden="true">·</span>
        <span>Cargando cobertura internacional...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="globalCoveragePanel globalCoverageError" role="alert">
        <b>Cobertura no disponible</b>
        <p>No se pudo cargar la cobertura internacional. Reintenta recargando la página.</p>
      </div>
    );
  }

  const markets = Array.isArray(report?.markets) ? report.markets : [];
  // Ausencia de datos: sin filas, o todas con inventario cero y nada materializado.
  const hasAnyData = markets.some((row) => Number(row?.inventory?.candidates) > 0 || Number(row?.scan?.uniqueSymbols) > 0);

  if (!markets.length || !hasAnyData) {
    return (
      <div className="globalCoveragePanel globalCoverageEmpty" role="status">
        <b>Sin cobertura accesible todavía</b>
        <p>La cobertura por mercado aparece cuando hay universos inventariables y resultados materializados.</p>
      </div>
    );
  }

  const backfillJobs = Array.isArray(report?.backfillPlan?.recommendedJobs) ? report.backfillPlan.recommendedJobs : [];

  return (
    <div className="globalCoveragePanel">
      <ul className="globalCoverageMarketList" role="list">
        {markets.map((row) => {
          const readiness = row?.readiness || {};
          const state = coverageStateText(readiness);
          const grade = GRADE_LABEL[row?.grade] || row?.grade || "—";
          const universe = fmtNum(row?.inventory?.candidates);
          // "Frescos" = scan.fresh (resultados con precio reciente). NO se sustituye
          // silenciosamente por uniqueSymbols: si falta, se muestra "—".
          const fresh = fmtNumOrDash(row?.scan?.fresh);
          // "Materializados" = uniqueSymbols, concepto distinto de "Frescos": filas
          // escritas en la ventana reciente, independientemente de su frescura.
          const materialized = fmtNumOrDash(row?.scan?.uniqueSymbols);
          // "Elegibles por calidad" = rankingEligible: cumplen los controles técnicos
          // (frescura, cobertura mínima, score). NO afirma publicación ni ranking
          // global comparable: esa fase es posterior.
          const eligible = fmtNumOrDash(row?.scan?.rankingEligible);
          const coveragePct = Number.isFinite(Number(row?.coveragePct)) ? `${Math.round(Number(row.coveragePct))}%` : "—";
          return (
            <li key={row?.market || "unknown"} className={`globalCoverageMarket globalCoverageState${state.tone.charAt(0).toUpperCase()}${state.tone.slice(1)}`}>
              <div className="globalCoverageMarketHead">
                <span className="globalCoverageMarketCode">{row?.market || "—"}</span>
                <span className="globalCoverageMarketRegion">{row?.region || ""}</span>
                <span className="globalCoverageMarketGrade">{grade} · {coveragePct}</span>
                <span className={`globalCoverageState globalCoverageState--${state.tone}`}>{state.text}</span>
              </div>
              <div className="globalCoverageMetrics">
                <div className="globalCoverageMetric">
                  <span className="globalCoverageMetricLabel">Universo</span>
                  <b className="globalCoverageMetricValue" data-metric="universe">{universe}</b>
                  <span className="globalCoverageMetricHint">inventario disponible</span>
                </div>
                <div className="globalCoverageMetric">
                  <span className="globalCoverageMetricLabel">Frescos</span>
                  <b className="globalCoverageMetricValue" data-metric="fresh">{fresh}</b>
                  <span className="globalCoverageMetricHint">con precio reciente</span>
                </div>
                <div className="globalCoverageMetric">
                  <span className="globalCoverageMetricLabel">Materializados</span>
                  <b className="globalCoverageMetricValue" data-metric="materialized">{materialized}</b>
                  <span className="globalCoverageMetricHint">filas recientes</span>
                </div>
                <div className="globalCoverageMetric">
                  <span className="globalCoverageMetricLabel">Elegibles por calidad</span>
                  <b className="globalCoverageMetricValue" data-metric="eligible">{eligible}</b>
                  <span className="globalCoverageMetricHint">cumplen los controles técnicos</span>
                </div>
              </div>
              {readiness.detail ? <p className="globalCoverageMarketDetail">{readiness.detail}</p> : null}
            </li>
          );
        })}
      </ul>

      <ul className="globalCoverageLegend" role="list">
        <li>Universo disponible ≠ ranking comparable.</li>
        <li>“Elegibles por calidad” cumplen los controles técnicos; su publicación y comparabilidad global dependen de una fase posterior.</li>
        <li>Los lotes son pasadas internas, no el mercado completo.</li>
      </ul>

      {backfillJobs.length ? (
        <div className="globalCoverageBackfill" role="note">
          <b>Trabajo de cobertura pendiente (informativo, no ejecutable desde aquí).</b>
          <ul className="globalCoverageBackfillList" role="list">
            {backfillJobs.map((job, index) => (
              <li key={`${job?.label || ""}-${index}`}>{job?.label || "Lote pendiente"}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function GlobalCoveragePanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Carga asíncrona sin bloquear la primera pintura: el panel arranca en
    // estado "loading" y solo se actualiza cuando /api/coverage responde.
    getJson("/api/coverage", { timeoutMs: COVERAGE_FETCH_TIMEOUT_MS })
      .then((data) => {
        if (cancelled) return;
        setReport(data || null);
        setError("");
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        // El mensaje crudo (puede incluir detalle de red o del proveedor de
        // datos) queda en consola para depurar; la pantalla solo muestra el
        // mensaje genérico ya pintado por el estado "error" de este render.
        console.error("[GlobalCoveragePanel] /api/coverage falló:", e);
        setError("No se pudo cargar la cobertura internacional.");
        setReport(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return renderGlobalCoverageView({ report, loading, error });
}
