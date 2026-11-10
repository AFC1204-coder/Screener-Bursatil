"use client";

// useWeeklyChanges — estado y fetch de «qué ha cambiado esta semana».
// Rediseño 2026-11 (paso 6): un único GET /api/weekly-changes por montaje del
// screener alimenta a la vez el raíl de vistas (grupo «Esta noche») y el panel
// de detalle (WeeklyChangesLine). Antes el fetch vivía dentro del componente de
// la línea; subirlo aquí evita una segunda petición para el raíl.

import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/clientApi";
import { isTimeoutFetchError } from "@/lib/marketHealthFetch";
import { userFacingServiceError } from "@/lib/serviceErrors";

export const WEEKLY_CHANGES_FETCH_TIMEOUT_MS = 20000;
export const WEEKLY_CHANGES_MAX_ATTEMPTS = 3;
export const WEEKLY_CHANGES_RETRY_DELAY_MS = 2500;
const URL_PARAM = "cambios";
const URL_VALUE = "semana";

/** Timeout / red / 5xx: no pintar fallo permanente en la cabecera de la mesa. */
export function isWeeklyChangesSoftFailure(error) {
  if (!error) return false;
  if (isTimeoutFetchError(error)) return true;
  const msg = String(error.message || error.name || "");
  return /\bHTTP 5\d\d\b|\bECONNRESET\b|\bECONNREFUSED\b|\bENOTFOUND\b|\bfetch failed\b|\bFailed to fetch\b/i.test(msg);
}

/**
 * D2 (auditoría 2026-11): la comparación se ancla al escaneo que el screener
 * MUESTRA. Solo los nocturnos US viajan como `?scan=`; con cualquier otro id
 * (escaneo local, acumulado multi-mercado) la ruta responde sin comparación
 * en vez de comparar otro escaneo distinto del mostrado.
 */
export function weeklyChangesUrl(scanLocalId = "") {
  const id = String(scanLocalId || "").trim();
  return id ? `/api/weekly-changes?scan=${encodeURIComponent(id)}` : "/api/weekly-changes";
}

/**
 * Carga /api/weekly-changes con reintentos silenciosos ante fallos blandos.
 * Devuelve `{ payload }` o `{ softFailure: true }` (ocultar línea) o lanza
 * errores duros (auth/4xx) para que el caller pinte un quiet corto.
 */
export async function loadWeeklyChangesPayload({
  getJsonImpl = getJson,
  timeoutMs = WEEKLY_CHANGES_FETCH_TIMEOUT_MS,
  maxAttempts = WEEKLY_CHANGES_MAX_ATTEMPTS,
  retryDelayMs = WEEKLY_CHANGES_RETRY_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  signal,
  scanLocalId = "",
} = {}) {
  const url = weeklyChangesUrl(scanLocalId);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      const aborted = new Error("aborted");
      aborted.name = "AbortError";
      throw aborted;
    }
    try {
      const payload = await getJsonImpl(url, { timeoutMs, signal });
      return { payload };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
      const soft = isWeeklyChangesSoftFailure(err);
      if (!soft || attempt >= maxAttempts) break;
      await sleep(retryDelayMs);
    }
  }
  if (isWeeklyChangesSoftFailure(lastError)) {
    return { softFailure: true, error: lastError };
  }
  throw lastError;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.defer] — T9: no fetch hasta que la mesa salga de
 *   cold restore (una historia de progreso = status del escaneo).
 * @param {boolean} [options.passive] — no fetch ni escucha de URL (el estado
 *   lo aporta otro dueño).
 * @param {string} [options.scanLocalId] — id del escaneo mostrado (D2).
 */
export function useWeeklyChanges({ defer = false, passive = false, scanLocalId = "" } = {}) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [sortKey, setSortKey] = useState("rs");
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [focusSection, setFocusSection] = useState("");
  const pushedRef = useRef(false);

  useEffect(() => {
    if (passive) return undefined;
    if (defer) {
      setPayload(null);
      setError("");
      setLoading(true);
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    loadWeeklyChangesPayload({ signal: controller.signal, scanLocalId })
      .then((result) => {
        if (cancelled) return;
        if (result.softFailure) {
          // Reintento agotado: ocultar la línea. La mesa ya está lista; un
          // «servidor tardó demasiado» permanente tumba esa sensación.
          setPayload(null);
          setError("");
          setLoading(false);
          return;
        }
        setPayload(result.payload);
        setError("");
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || err?.name === "AbortError") return;
        // Fallo duro (p. ej. 4xx): quiet corto, sin copy de timeout.
        setPayload(null);
        setError(userFacingServiceError(err?.message, "no disponibles ahora mismo."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [defer, passive, scanLocalId]);

  // El panel vive en la URL (?cambios=semana): un enlace directo lo abre y el
  // gesto atrás lo cierra. popstate es la única fuente de verdad al navegar.
  useEffect(() => {
    if (passive || typeof window === "undefined") return undefined;
    const readParam = () => new URLSearchParams(window.location.search).get(URL_PARAM) === URL_VALUE;
    if (readParam()) setOpen(true);
    const onPop = () => {
      pushedRef.current = false;
      setOpen(readParam());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [passive]);

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

  const expand = useCallback((listKey) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.add(listKey);
      return next;
    });
  }, []);

  const consumeFocusSection = useCallback(() => {
    const section = focusSection;
    if (section) setFocusSection("");
    return section;
  }, [focusSection]);

  return {
    payload,
    loading,
    error,
    open,
    sortKey,
    setSortKey,
    expandedKeys,
    expand,
    focusSection,
    consumeFocusSection,
    openPanel,
    closePanel,
    togglePanel: () => (open ? closePanel() : openPanel()),
  };
}
