// app/useChartDataModel.js — adaptador React del data model puro del chart
// (ADR chart-controller-extraction §3.3 / §3.4 / §3.5 / §3.6 / §3.7, paso 4).
//
// Posee el ciclo de vida del fetch a /api/chart y proyecta el resultado
// vigente sobre `chartDataModel.resolve`, que es la pieza pura del módulo.
// Devuelve EXCLUSIVAMENTE la forma canónica de §3.4:
//
//   { rows, rowTimes, quality, availability, requestState, error, notice }
//
// No expone `remote`, `localRows`, `needsRemote`, `remote.meta`, `usedFallback`
// ni `sourceKind` en producción. El fetch es un detalle encapsulado: en tests
// se sustituye mockeando el cliente (`@/lib/clientApi`), no abriendo la
// política de fetch como callback pública.
//
// Concurrencia (ADR §3.7):
//   - Cada request lleva una `requestKey` (symbol|dataRange|interval|...) y
//     una `generation` monotónica local.
//   - Al cambiar la key, el resultado remoto anterior se descarta de inmediato
//     (sin esperar al aborto); el AbortController del fetch anterior se
//     cancela para liberar la red, pero la supresión de respuestas viejas se
//     hace por comparación de generation.
//   - Una respuesta solo se publica si su `generation` sigue vigente al
//     momento de la resolución. El AbortController por sí solo no basta: las
//     respuestas en vuelo pueden resolverse tras el cambio de key y deben
//     descartarse.
//   - `AbortError` no se publica como error ni como notice.
//
// Paso 9 del ADR: `localQuality` (ChartQuality canónico) es la ÚNICA forma
// de expresar la calidad local. La prop legacy `chartEstimated` ya no es
// parte del contrato público del hook: se ha eliminado y cualquier consumer
// debe pasar `quality` explícito (ver ADR §3.2).

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chartDataModel, shouldRequestRemoteBars } from "@/lib/chartDataModel";
import { barsAreCandleGrade } from "@/lib/chartDataQuality";
import { getJson } from "@/lib/clientApi";

const LINE_STYLES = new Set(["8", "3"]);

// Presupuesto cliente: evita «Cargando histórico…» infinito si la red cuelga.
const CHART_FETCH_TIMEOUT_MS = 15000;

// Clave estable del request: identifica la combinación (symbol, dataRange,
// interval) cuya respuesta debe invalidar a la anterior. Misma forma que la
// caracterización de `tests/chartUniversalPriceChartBehavior.test.js`.
function buildRequestKey({ symbol, dataRange, interval }) {
  return `${symbol || ""}|${dataRange || ""}|${interval || ""}`;
}

// Huella estable del `localSource`. ADR §3.3 + §9: la entrada es
// `{ bars, quality }` (ChartQuality canónico). El caller PUEDE construir
// un objeto nuevo cada render, por lo que la comparación por referencia
// no es válida. Esta huella es la pieza que mantiene estable el efecto
// de fetch entre renders equivalentes.
function buildLocalSourceKey(localSource = null) {
  if (!localSource || typeof localSource !== "object") return "none|";
  const bars = Array.isArray(localSource.bars) ? localSource.bars : [];
  const first = bars[0];
  const last = bars[bars.length - 1];
  const firstTime = first ? Number(first.time) || "" : "";
  const lastTime = last ? Number(last.time) || "" : "";
  const qualityStatus = localSource.quality?.status || "";
  return [
    bars.length,
    firstTime,
    lastTime,
    Number(last?.close) || "",
    qualityStatus,
  ].join("|");
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado interno del request, NO parte de la API pública.
//
// Mientras la generación del request NO coincida con la del hook vigente,
// ninguna respuesta se publica: se descarta de inmediato, sin mutar nada
// del estado React. Esto es la "supresión de respuestas viejas" del §3.7.
function idleRequest() {
  return { state: "idle", generation: 0, payload: null, error: null };
}

function loadingRequest(generation) {
  return { state: "loading", generation, payload: null, error: null };
}

function settledRequest(generation, payload) {
  return { state: "settled", generation, payload: payload || null, error: null };
}

function erroredRequest(generation, error) {
  return { state: "error", generation, payload: null, error: error || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher puro: dado el estado vigente (request, generación, decisiones
// sobre necesidad de fetch), construye la siguiente llamada a
// `chartDataModel.resolve`. Aislado del React para poder probarlo sin DOM.
//
//   plan = {
//     generation,        // número vigente del hook (monotónico)
//     needsRemote,       // true ⇒ hay que disparar/abortar fetch
//     requestState,      // 'idle' | 'loading' | 'settled' | 'error'
//     payload,           // respuesta del fetch (si settled)
//     error,             // { message } (si error)
//   }
//
// Devuelve SIEMPRE el shape canónico de ADR §3.4. La rama `needsRemote=false`
// usa `requestState=idle` y `payload=null`, que es lo que el resolver puro
// espera para evaluar sólo la fuente local (Paso 5 de §3.6).
function dispatchResolve({ symbol, localSource, config, plan }) {
  let request;
  if (!plan.needsRemote) {
    request = null;
  } else if (plan.requestState === "settled") {
    request = settledRequest(plan.generation, plan.payload);
  } else if (plan.requestState === "error") {
    request = erroredRequest(plan.generation, plan.error);
  } else {
    // 'idle' o 'loading' tras un needsRemote: mientras la generación esté en
    // vuelo publicamos `loading` para que la vista pueda mostrar el aviso de
    // "ampliando histórico".
    request = plan.requestState === "loading"
      ? loadingRequest(plan.generation)
      : null;
  }
  return chartDataModel.resolve({
    symbol,
    localSource: localSource || { bars: [], quality: null },
    config,
    request,
  });
}

// Decide si la combinación actual exige un fetch al endpoint remoto. NO es
// parte de la API pública: el resolver puro ya encapsula esta regla
// (`shouldRequestRemoteBars`). Aquí se duplica sólo para construir el plan
// antes de tener un `request` que alimentar al resolver.
function shouldFetch({ symbol, localSource, dataRange, interval, preferredStyle = null }) {
  if (!symbol) return false;
  const bars = Array.isArray(localSource?.bars) ? localSource.bars : [];
  const pendingStyle = String(preferredStyle || "");
  if (
    pendingStyle
    && !LINE_STYLES.has(pendingStyle)
    && bars.length >= 2
    && !barsAreCandleGrade(bars)
  ) {
    return true;
  }
  return shouldRequestRemoteBars(bars, dataRange, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook.

export function useChartDataModel(input = {}) {
  const { symbol = "", localSource = null, config = null, preferredStyle = null } = input || {};

  // Configuración canónica: el hook NO resuelve `resolveChartViewportConfig`
  // (esa pieza vive en el paso 5 del ADR). Acepta config ya normalizada
  // (`{ dataRange, interval, style }`) o un settings-like y la reduce.
  // Conservamos defaults seguros para que un caller "legacy" no rompa.
  const normalizedConfig = useMemo(() => {
    const raw = config && typeof config === "object" ? config : {};
    return {
      dataRange: raw.dataRange || raw.range || "1A",
      interval: raw.interval || "D",
      style: raw.style || "1",
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.dataRange, config?.range, config?.interval, config?.style]);

  // Normalización del localSource. Se memoiza por su huella estable, no por
  // referencia: el caller puede construir `localSource` como object literal
  // cada render. Mantener identidad por valor evita que el efecto de fetch
  // se re-dispare en cada render por una falsa invalidación. ADR §3.3 +
  // §9: la entrada canónica es `{ bars, quality }`; el campo legacy
  // `chartEstimated` ya no forma parte del contrato.
  const normalizedLocalSource = useMemo(() => {
    if (
      localSource
      && typeof localSource === "object"
      && (Array.isArray(localSource.bars) || localSource.quality != null)
    ) {
      return {
        bars: Array.isArray(localSource.bars) ? localSource.bars : [],
        quality: localSource.quality ?? null,
      };
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildLocalSourceKey(localSource)]);

  const dataRange = normalizedConfig.dataRange;
  const interval = normalizedConfig.interval;
  const style = normalizedConfig.style;

  // La key vigente determina cuándo se debe disparar (o abortar) un fetch.
  const requestKey = buildRequestKey({ symbol, dataRange, interval });

  // Estado React: solo el resultado del resolver puro, no las piezas
  // intermedias del fetch. §3.4: "rows, rowTimes, quality, availability,
  // requestState, error, notice".
  const [dataModel, setDataModel] = useState(() => dispatchResolve({
    symbol,
    localSource: normalizedLocalSource,
    config: { dataRange, interval, style },
    plan: { generation: 0, needsRemote: false, requestState: "idle" },
  }));

  // Estado interno del fetch: pieza clave para la concurrencia del §3.7.
  // `generationRef` es monotónico y se incrementa en cada cambio de
  // requestKey. `mountedRef` evita publicar después del unmount.
  const generationRef = useRef(0);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  // ───────────────────────────────────────────────────────────────────────
  // Único effect de ciclo de vida: al cambiar la requestKey (o
  // localSource/config), invalidamos la generación vigente, abortamos el
  // fetch anterior, decidimos si hay que disparar uno nuevo y publicamos
  // el resultado del resolver puro en cada paso.

  useEffect(() => {
    if (!mountedRef.current) return undefined;

    // Subir generación: cualquier respuesta en vuelo debe descartarse.
    generationRef.current += 1;
    // Cancelar el AbortController del fetch anterior (libera red; la
    // generación es la verdadera salvaguarda contra respuestas tardías).
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
      abortRef.current = null;
    }

    // Paso 1: descartar inmediatamente el resultado remoto previo
    // (§3.7.2) re-resolviendo con `request:null`. Para un fetch recién
    // disparado, esta es la rama "loading"; para cambios sin fetch, es la
    // rama local final.
    //
    // §3.7.4: símbolo vacío → no hay request.
    // §3.6 paso 2 + §3.7.5: si no hay que ampliar histórico (local cubre
    // el rango), tampoco hay request. `shouldRequestRemoteBars` es la
    // regla canónica del resolver puro y la decisión de fetch es detalle
    // operativo del adaptador: NO se expone como prop (`needsRemote` está
    // prohibido en producción, ADR §3.3).
    const needsRemote = shouldFetch({
      symbol,
      localSource: normalizedLocalSource,
      dataRange,
      interval,
      preferredStyle,
    });

    if (!needsRemote) {
      // Sin fetch. El outcome local se publica tal cual (§3.7.4).
      setDataModel(dispatchResolve({
        symbol,
        localSource: normalizedLocalSource,
        config: { dataRange, interval, style },
        plan: { generation: generationRef.current, needsRemote: false, requestState: "idle" },
      }));
      return undefined;
    }

    // Hay que disparar fetch. Asignar nueva generación + AbortController.
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    // Publicar `loading`: el resolver combinará con el local.
    setDataModel(dispatchResolve({
      symbol,
      localSource: normalizedLocalSource,
      config: { dataRange, interval, style },
      plan: { generation, needsRemote: true, requestState: "loading" },
    }));

    const params = new URLSearchParams({ symbol, range: dataRange, interval });
    const url = `/api/chart?${params.toString()}`;

    getJson(url, { signal: controller.signal, timeoutMs: CHART_FETCH_TIMEOUT_MS })
      .then((payload) => {
        // §3.7.1: respuesta vieja tras cambio de key/rango/intervalo. El
        // abort por sí solo no se considera suficiente; comparamos
        // generación. Cualquier respuesta con generation distinta a la
        // del hook vigente se descarta sin publicar.
        if (!mountedRef.current) return;
        if (generationRef.current !== generation) return;
        setDataModel(dispatchResolve({
          symbol,
          localSource: normalizedLocalSource,
          config: { dataRange, interval, style },
          plan: { generation, needsRemote: true, requestState: "settled", payload },
        }));
      })
      .catch((error) => {
        // §3.7.3: AbortError → no se publica como error ni notice.
        if (error && error.name === "AbortError") return;
        if (!mountedRef.current) return;
        if (generationRef.current !== generation) return;
        const message = error?.message || "Proveedor de gráfico no disponible";
        setDataModel(dispatchResolve({
          symbol,
          localSource: normalizedLocalSource,
          config: { dataRange, interval, style },
          plan: { generation, needsRemote: true, requestState: "error", error: { message } },
        }));
      });

    return () => {
      // Cleanup al cambiar de key o al unmount. Subir la generación para
      // que cualquier `then/catch` tardío no publique nada.
      generationRef.current += 1;
      if (abortRef.current === controller) {
        try { controller.abort(); } catch { /* noop */ }
        abortRef.current = null;
      }
    };
    // El effect sólo debe re-correr cuando cambia la identidad del QUÉ
    // solicita, no del objeto caller. La key estable + huella localSource
    // ya cubren esa invariante. eslint no puede inferirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, buildLocalSourceKey(normalizedLocalSource), dataRange, interval, style, preferredStyle]);

  // Unmount cleanup.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* noop */ }
        abortRef.current = null;
      }
    };
  }, []);

  return dataModel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos exportados sólo para tests del hook. NO son parte del
// contrato público; cualquier consumidor externo debe usar el resolver puro
// `@/lib/chartDataModel` o el hook.
export const __test__ = {
  buildRequestKey,
  buildLocalSourceKey,
  dispatchResolve,
  shouldFetch,
  idleRequest,
  loadingRequest,
  settledRequest,
  erroredRequest,
};
