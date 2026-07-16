"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/clientApi";

const CURATED_DISCOVERY_TIMEOUT_MS = 9000;

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function itemsFrom(leaderboard = {}) {
  // Defensa de presentación: la API curada ya excluye final, pero la tarjeta
  // nunca debe enseñar una fila final bajo el aviso de muestra parcial.
  return Array.isArray(leaderboard?.items)
    ? leaderboard.items.filter((item) => (item?.percentileScope || "batch") === "batch")
    : [];
}

// HTTP 200 no equivale a lectura disponible: la ruta puede degradar de forma
// recuperable sin poder leer scan_results. Solo un leaderboard con items-array
// y sin señales de degradación autoriza el estado vacío de candidatas.
export function curatedDiscoveryReadState(payload = {}) {
  if (!payload || payload.degraded === true || payload.source === "scan_results_unavailable" || payload.configured === false) return "unavailable";
  if (!payload.leaderboard || !Array.isArray(payload.leaderboard.items)) return "unavailable";
  return "available";
}

// Los mercados se declaran solo a partir de country que ya viaja en los items
// publicables. Si no viene ese campo, no se infiere desde símbolo, moneda ni
// otra fuente. La frescura toma la fecha mínima real de las filas; sin fecha,
// usa únicamente la antigüedad declarada por priceFreshnessDays.
export function curatedDiscoveryContext(leaderboard = {}) {
  const items = itemsFrom(leaderboard);
  const markets = [...new Set(items.map((item) => cleanText(item.country)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const dates = items
    .map((item) => cleanText(item.lastDate))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  const freshnessDays = items
    .map((item) => Number(item.priceFreshnessDays))
    .filter(Number.isFinite);
  const batchCount = items.filter((item) => (item.percentileScope || "batch") === "batch").length;
  return {
    markets,
    oldestLastDate: dates[0] || "",
    maxFreshnessDays: freshnessDays.length ? Math.max(...freshnessDays) : null,
    batchCount,
  };
}

function discoveryBody({ leaderboard = null, loading = false, error = "", unavailable = false } = {}) {
  if (loading) return <p className="curatedDiscoveryStatus" role="status">Cargando candidatas curadas...</p>;
  if (error) {
    return <p className="curatedDiscoveryStatus" role="status">No se pudo leer la disponibilidad de candidatas curadas. La cobertura por mercado se mantiene como contexto independiente.</p>;
  }
  if (unavailable) {
    return <p className="curatedDiscoveryStatus" role="status">No se puede confirmar la disponibilidad de candidatas curadas ahora; no se concluye que no existan candidatas. La cobertura por mercado se mantiene como contexto independiente.</p>;
  }

  const items = itemsFrom(leaderboard);
  const context = curatedDiscoveryContext(leaderboard);
  const strategy = cleanText(leaderboard?.strategyLabel || leaderboard?.strategy);

  if (!items.length) {
    return (
      <div className="curatedDiscoveryEmpty" role="status">
        <b>Sin candidatas curadas publicables todavía.</b>
        <p>Puede deberse a los gates vigentes o a que aún no hay filas materializadas publicables; no implica un fallo del sistema.</p>
        <dl className="curatedDiscoveryFacts">
          <div><dt>Estrategia</dt><dd>{strategy || "No disponible"}</dd></div>
          <div><dt>Mercados incluidos</dt><dd>Sin datos publicables todavía</dd></div>
          <div><dt>Frescura</dt><dd>Sin datos publicables todavía</dd></div>
        </dl>
      </div>
    );
  }

  const freshness = context.oldestLastDate
    ? `Dato más antiguo: ${context.oldestLastDate}`
    : Number.isFinite(context.maxFreshnessDays)
      ? `Antigüedad máxima declarada: ${context.maxFreshnessDays} días`
      : "No disponible en estas filas";

  return (
    <>
      <dl className="curatedDiscoveryFacts">
        <div><dt>Estrategia activa</dt><dd>{strategy || "No disponible"}</dd></div>
        <div><dt>Mercados incluidos</dt><dd>{context.markets.length ? context.markets.join(" · ") : "No disponible en estas filas"}</dd></div>
        <div><dt>Frescura</dt><dd>{freshness}</dd></div>
      </dl>
      {context.batchCount ? (
        <p className="curatedDiscoveryScope" role="note">
          <b>Muestra parcial · percentil por lote.</b> Es contexto de las filas; no es RS global ni una prueba de superioridad global.
        </p>
      ) : null}
      <ol className="curatedDiscoveryList">
        {items.map((item) => (
          <li key={`${item.symbol}-${item.rank || ""}`} className="curatedDiscoveryItem">
            <span className="curatedDiscoveryRank">{item.rank || "—"}</span>
            <span className="curatedDiscoveryIdentity"><b>{item.symbol || "—"}</b><small>{item.companyName || "Sin nombre"}{item.country ? ` · ${item.country}` : ""}</small></span>
            <span className="curatedDiscoveryItemScope">{(item.percentileScope || "batch") === "batch" ? "percentil por lote" : "percentil final"}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

// Presentacional y exportada para tests: mantiene el aviso principal visible
// incluso mientras el endpoint está cargando, vacío o degradado.
export function renderCuratedDiscoveryView({ leaderboard = null, loading = false, error = "", unavailable = false } = {}) {
  const count = itemsFrom(leaderboard).length;
  return (
    <section className="curatedDiscoveryPanel" aria-labelledby="curated-discovery-title">
      <div className="curatedDiscoveryHeading">
        <div>
          <span className="curatedDiscoveryEyebrow">Muestra parcial{!loading && !error && !unavailable ? ` · ${count} candidatas` : ""}</span>
          <h2 id="curated-discovery-title">Descubrimiento global curado</h2>
        </div>
      </div>
      <p className="curatedDiscoveryDisclosure"><b>No es un ranking global comparable.</b> Reúne filas publicables con percentil por lote y las ordena con señales absolutas por símbolo.</p>
      {discoveryBody({ leaderboard, loading, error, unavailable })}
    </section>
  );
}

export default function CuratedDiscoveryPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leaderboard, setLeaderboard] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/leaderboards?curatedDiscovery=1&strategy=momentum&limit=12&cache=0", { timeoutMs: CURATED_DISCOVERY_TIMEOUT_MS })
      .then((data) => {
        if (cancelled) return;
        const readState = curatedDiscoveryReadState(data);
        setLeaderboard(readState === "available" ? data.leaderboard : null);
        setUnavailable(readState !== "available");
        setError("");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLeaderboard(null);
        setUnavailable(false);
        setError("unavailable");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return renderCuratedDiscoveryView({ leaderboard, loading, error, unavailable });
}
