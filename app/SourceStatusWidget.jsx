"use client";

import { useState, useEffect, useRef } from "react";
import { Activity, AlertTriangle, CheckCircle, ChevronDown, RefreshCw, XCircle, ShieldCheck } from "lucide-react";
import { getJson } from "@/lib/clientApi";

export default function SourceStatusWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState([]);
  const [summary, setSummary] = useState({ priority: "", implementedCount: 0 });
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson("/api/data-providers", { cache: "no-store" });
      setProviders(data.providers || []);
      setSummary({
        priority: data.priority || "free-first",
        implementedCount: data.implementedNow?.length || 0,
      });
    } catch (err) {
      console.error("Failed to fetch provider status:", err);
      setError("Error al cargar conexiones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Auto-refresh connection statuses every 2 minutes
    const interval = setInterval(fetchStatus, 120000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculate overall state
  let overallState = "green"; // green, yellow, red, loading
  if (loading && providers.length === 0) {
    overallState = "loading";
  } else if (error) {
    overallState = "red";
  } else if (providers.length > 0) {
    const activeMissing = providers.filter(p => !p.configured && p.status === "active" && !p.optionalKey);
    const fallbacksActive = providers.filter(p => p.configured && p.status === "fallback");
    if (activeMissing.length > 0) {
      overallState = "red";
    } else if (fallbacksActive.length > 0) {
      overallState = "yellow";
    }
  }

  const getStatusColor = (p) => {
    if (!p.configured) {
      return p.optionalKey ? "yellow" : "red";
    }
    if (p.status === "primary" || p.status === "active" || p.status === "active-when-enabled") {
      return "green";
    }
    if (p.status === "fallback") {
      return "yellow";
    }
    return "blue";
  };

  const getStatusLabel = (p) => {
    if (!p.configured) {
      return p.optionalKey ? "Opcional (Sin clave)" : "Sin Clave/Inactivo";
    }
    if (p.status === "primary") return "Activo (Principal)";
    if (p.status === "fallback") return "Activo (Fallback)";
    if (p.status === "active" || p.status === "active-when-enabled") return "Activo";
    return "Disponible";
  };

  return (
    <div className="sourceStatusContainer" ref={containerRef}>
      <button
        type="button"
        className={`sourceStatusToggleBtn ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Estado de las fuentes de información"
        aria-expanded={isOpen}
      >
        <span className={`sourcePulseDot ${overallState}`} />
        <span className="sourceStatusLabel">
          {overallState === "loading" ? "CONECTANDO..." : overallState === "red" ? "API ALERTA" : "TERMINAL ONLINE"}
        </span>
        <ChevronDown size={11} className={`sourceChevron ${isOpen ? "open" : ""}`} />
      </button>

      {isOpen && (
        <div className="sourceStatusDropdown">
          <div className="sourceDropdownHeader">
            <div className="sourceDropdownTitle">
              <Activity size={13} className="textAccent animatePulse" />
              <h4>Estado de Enlaces e Integraciones</h4>
            </div>
            <button
              type="button"
              className="sourceRefreshBtn"
              onClick={fetchStatus}
              disabled={loading}
              title="Refrescar estado de conexiones"
            >
              <RefreshCw size={11} className={loading ? "animateSpin" : ""} />
            </button>
          </div>

          {error ? (
            <div className="sourceDropdownError">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          ) : (
            <>
              <div className="sourceDropdownSummary">
                <div className="summaryItem">
                  <small>Estrategia de Carga:</small>
                  <strong>{summary.priority === "free-first" ? "Gratuito Primero (Optimizado)" : summary.priority}</strong>
                </div>
                <div className="summaryItem">
                  <small>Fuentes Integradas:</small>
                  <strong>{providers.filter(p => p.configured).length} / {providers.length} activas</strong>
                </div>
              </div>

              <div className="sourceStatusListWrap">
                <table className="sourceStatusTable">
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>Estado</th>
                      <th>Rol en Terminal</th>
                      <th>Regiones / Cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((p) => {
                      const color = getStatusColor(p);
                      return (
                        <tr key={p.id} className={!p.configured && !p.optionalKey ? "providerDisabled" : ""}>
                          <td>
                            <div className="providerNameCell">
                              <span className={`statusLED ${color}`} />
                              <span className="providerNameText">{p.name}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`providerBadge ${color}`}>
                              {getStatusLabel(p)}
                            </span>
                          </td>
                          <td className="providerRoleCell">
                            {p.role}
                            {p.capabilities && (
                              <div className="providerCapabilities">
                                {p.capabilities.slice(0, 3).map((cap) => (
                                  <span key={cap} className="capBadge">{cap}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="providerCoverageCell">
                            <span className="coverageText" title={p.coverage}>{p.coverage}</span>
                            <div className="providerRegions">
                              {p.regions?.slice(0, 4).map((r) => (
                                <span key={r} className="regionBadge">{r}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sourceDropdownFooter">
                <ShieldCheck size={11} />
                <span>Modo de contingencia activo. StatsEdge utiliza fallbacks automáticos si hay caídas en las fuentes primarias.</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
