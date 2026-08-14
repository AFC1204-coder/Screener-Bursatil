// app/useChartViewport.js — adaptador React del viewport del chart.
//
// Contrato (docs/analisis-grafico-2026-08-14.md, Parte C.1): la ventana
// visible es función pura de (settings, datos) con la desviación manual como
// estado explícito del lifecycle. Este hook garantiza la mitad React del
// contrato:
//
//   - UNA instancia de `createViewportLifecycle` por montaje. Nunca se
//     recrea: los parámetros dinámicos (config, altura, rowTimes, estado de
//     interacción) entran como getters que leen refs actualizadas en cada
//     render. Botones, rueda y raíl hablan por construcción con la misma
//     instancia que gobierna el chart.
//   - El cambio de (símbolo | rango | intervalo) limpia la desviación manual
//     vía `clearManual()` — el único reset, declarativo y explícito. Este
//     efecto corre ANTES de la transacción del controller (los hooks se
//     declaran antes en `useChartController`), así que el attach siguiente
//     nace ya con el contrato puro.
//   - `unmount()` libera el attachment vigente y cancela la publicación
//     pendiente: nada queda colgando entre montajes (StrictMode incluido).

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createViewportLifecycle } from "@/lib/chartViewportLifecycle";
import { chartViewStateFromLogicalRange } from "@/lib/chartNavigation";

const INITIAL_SNAPSHOT = {
  lifecycle: "detached",
  view: chartViewStateFromLogicalRange(null, 0),
  manual: false,
  visibleLogicalRange: null,
  visibleTimeRange: null,
  visibleWindowLabel: "Sin ventana",
  profile: null,
};

/**
 * Hook adaptador del viewport.
 *
 * @param {object} args
 * @param {string} args.symbol              Identidad vigente (cambio ⇒ clearManual).
 * @param {object} args.config              `{ dataRange, interval, style, scale }` normalizado.
 * @param {number[]} args.rowTimes          Tiempos normalizados del data model.
 * @param {number} args.requestedHeight     Altura objetivo del caller.
 * @param {() => string} [args.getInteractionState]  'idle' | 'armed' | ... (inyectado por el controller).
 */
export function useChartViewport({
  symbol = "",
  config = null,
  rowTimes = [],
  requestedHeight = 460,
  getInteractionState = null,
} = {}) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const interval = safeConfig.interval || "D";
  const dataRange = safeConfig.dataRange || "1A";

  // Refs dinámicas: la instancia única lee SIEMPRE el valor vigente.
  const configRef = useRef({ interval, dataRange });
  configRef.current = { interval, dataRange };
  const heightRef = useRef(requestedHeight);
  heightRef.current = requestedHeight;
  const interactionRef = useRef(getInteractionState);
  interactionRef.current = getInteractionState;
  const rowTimesRef = useRef(Array.isArray(rowTimes) ? rowTimes : []);
  useEffect(() => {
    rowTimesRef.current = Array.isArray(rowTimes) ? rowTimes : [];
  }, [rowTimes]);

  const [state, setState] = useState(INITIAL_SNAPSHOT);

  // Instancia única por montaje.
  const lifecycleRef = useRef(null);
  if (lifecycleRef.current === null) {
    lifecycleRef.current = createViewportLifecycle({
      publish: (snapshot) => setState(snapshot),
      getInteractionState: () => {
        const fn = interactionRef.current;
        return typeof fn === "function" ? fn() : "idle";
      },
      getConfig: () => configRef.current,
      getRequestedHeight: () => heightRef.current,
      getRowTimes: () => rowTimesRef.current,
    });
  }
  const lifecycle = lifecycleRef.current;

  // Cambio de símbolo, rango o intervalo ⇒ la desviación manual muere.
  // (Estilo y escala re-adjuntan el chart pero conservan la ventana manual.)
  useEffect(() => {
    lifecycle.clearManual();
  }, [symbol, interval, dataRange, lifecycle]);

  // Unmount: libera attachment y cancela publicaciones pendientes.
  useEffect(() => () => {
    lifecycle.unmount();
  }, [lifecycle]);

  const prepare = useCallback((container) => lifecycle.prepare(container), [lifecycle]);
  const attach = useCallback((opts) => lifecycle.attach(opts), [lifecycle]);
  const detach = useCallback(() => lifecycle.detach(), [lifecycle]);
  const getSnapshot = useCallback(() => lifecycle.getSnapshot(), [lifecycle]);
  const actions = lifecycle.actions;

  return useMemo(() => ({
    state,
    prepare,
    attach,
    detach,
    actions,
    getSnapshot,
  }), [state, prepare, attach, detach, actions, getSnapshot]);
}

export default useChartViewport;
