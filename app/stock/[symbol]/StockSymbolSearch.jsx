"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/clientApi";
import { SearchCandidateList } from "@/lib/screenerSearch";
import { stockUrl } from "@/lib/symbols";
import { userFacingServiceError } from "@/lib/serviceErrors";

export default function StockSymbolSearch({ currentSymbol = "" }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function navigateToSymbol(symbol = "") {
    const clean = String(symbol || "").trim().toUpperCase();
    if (!clean || clean === String(currentSymbol || "").trim().toUpperCase()) return;
    if (typeof window !== "undefined") {
      window.location.assign(stockUrl(clean));
    }
  }

  async function runSearch(event) {
    event?.preventDefault?.();
    const trimmed = query.trim();
    if (!trimmed) {
      setCandidates([]);
      setError("");
      return;
    }
    const tickerish = /^[A-Z0-9.^=-]{1,18}$/i.test(trimmed) && !/\s/.test(trimmed);
    setLoading(true);
    setError("");
    try {
      const data = await getJson(`/api/search?q=${encodeURIComponent(trimmed)}`).catch(() => ({ results: [] }));
      const results = data.results || [];
      setCandidates(results);
      const upper = trimmed.toUpperCase();
      const exact = results.find((item) => item.symbol === upper);
      const picked = exact || results[0] || (tickerish ? { symbol: upper } : null);
      if (!picked) {
        setError("Sin coincidencias. Prueba con ticker o nombre.");
        return;
      }
      navigateToSymbol(picked.symbol);
    } catch (e) {
      setError(userFacingServiceError(e?.message, "No se pudo buscar."));
    } finally {
      setLoading(false);
    }
  }

  function handleQueryChange(value = "") {
    setQuery(value);
    setError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setCandidates([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await getJson(`/api/search?q=${encodeURIComponent(trimmed)}`).catch(() => ({ results: [] }));
        setCandidates(data.results || []);
      } catch {
        setCandidates([]);
      }
    }, 280);
  }

  function clearSearch() {
    setQuery("");
    setCandidates([]);
    setError("");
  }

  return (
    <div className="stockChartSearch" aria-label="Buscar otro valor">
      <form className="stockChartSearchForm" onSubmit={runSearch}>
        <input
          className="input stockChartSearchInput"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Buscar ticker o nombre…"
          aria-label="Buscar ticker o nombre"
          autoComplete="off"
        />
        {(query || candidates.length) ? (
          <button type="button" className="stockChartSearchGhost" onClick={clearSearch}>Limpiar</button>
        ) : null}
        <button type="submit" className="stockChartSearchSubmit" disabled={loading}>
          {loading ? "…" : "Ir"}
        </button>
      </form>
      {error ? <p className="stockChartSearchError" role="alert">{error}</p> : null}
      <SearchCandidateList
        candidates={candidates}
        activeSymbol={currentSymbol}
        onPick={(item) => navigateToSymbol(item.symbol)}
      />
    </div>
  );
}
