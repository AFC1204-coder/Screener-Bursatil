// app/useChartViewport.js — adaptador React del viewport state del chart
// (ADR chart-controller-extraction §4, paso 6 de §9).
//
// Wrapper delgado sobre `lib/chartViewportLifecycle.js`. La lógica del
// ciclo de vida de viewport vive en la pieza pura; este hook conecta los
// refs de React a esa pieza y traduce publicaciones a `setState`.
//
// Esta capa es el ÚNICO consumidor de `lightweight-charts` para el estado
// de viewport. El `timeScale` nativo es la fuente de verdad operativa
// mientras hay un chart adjunto (§4.1): las actions leen el rango nativo,
// escriben una sola vez y dejan que la subscription confirme el resultado.
//
// Pieza delgada: encapsula el ciclo attach/detach, las subscriptions lógica
// y temporal, la restauración manual por ventana temporal (con fallback al
// rango lógico reescalado), el resize adaptativo y el gating del wheel
// por `getInteractionState() === "idle"` (§4.6). NO conoce la máquina de
// interacción, NO modifica `handleScroll`/`handleScale`, NO posee la vida
// del chart (`chart.remove()` es responsabilidad del controller, §4.7).
//
// API pública (estable, §4.4): ver `lib/chartViewportLifecycle.js`.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createViewportLifecycle } from "@/lib/chartViewportLifecycle";

/**
 * Hook adaptador del viewport state. Sigue el contrato §4.4.
 *
 * @param {object} args
 * @param {string} args.symbol              Identidad vigente (cambio ⇒ reset manual).
 * @param {object} args.config              `{ dataRange, interval, style, scale }` normalizado.
 * @param {number[]} args.rowTimes          Tiempos normalizados del data model.
 * @param {number} args.requestedHeight     Altura objetivo del caller.
 * @param {() => string} [args.getInteractionState]  Inyectado por el controller desde
 *                                            useChartInteraction; devuelve 'idle' | 'armed' | ...
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
  const style = safeConfig.style || "1";
  const scale = safeConfig.scale || "price";

  // Row times como ref para acceso síncrono desde la pieza pura.
  const rowTimesRef = useRef(Array.isArray(rowTimes) ? rowTimes : []);
  useEffect(() => {
    rowTimesRef.current = Array.isArray(rowTimes) ? rowTimes : [];
  }, [rowTimes]);

  // `state` React: publicación agrupada por RAF.
  const [state, setState] = useState({
    lifecycle: "detached",
    visibleLogicalRange: null,
    visibleTimeRange: null,
    visibleWindowLabel: "Sin ventana",
    profile: null,
  });

  // Mantener una referencia estable al lifecycle para que la pieza pura
  // lo lea de su propio closure sin rerender.
  const lifecycleRef = useRef(createViewportLifecycle({
    state: undefined, // pieza pura crea su propio state interno.
    publish: (snapshot) => setState(snapshot),
    getInteractionState,
    interval,
    dataRange,
    requestedHeight,
    getRowTimes: () => rowTimesRef.current,
  }));

  // Si cambian interval/dataRange/style/scale/getInteractionState,
  // recreamos la pieza. Es más simple que exponer mutadores individuales.
  const lifecycleDepsRef = useRef({ interval, dataRange, style, scale, getInteractionState });
  if (
    lifecycleDepsRef.current.interval !== interval
    || lifecycleDepsRef.current.dataRange !== dataRange
    || lifecycleDepsRef.current.style !== style
    || lifecycleDepsRef.current.scale !== scale
    || lifecycleDepsRef.current.getInteractionState !== getInteractionState
  ) {
    lifecycleDepsRef.current = { interval, dataRange, style, scale, getInteractionState };
    lifecycleRef.current = createViewportLifecycle({
      publish: (snapshot) => setState(snapshot),
      getInteractionState,
      interval,
      dataRange,
      requestedHeight,
      getRowTimes: () => rowTimesRef.current,
    });
  }

  const lifecycle = lifecycleRef.current;

  // Reset explícito cuando cambia el símbolo (§4.7 / §6 tabla "Cambio de
  // símbolo"). BUG 8: la pieza pura desuscribe listeners y cancela timers.
  //
  // NOTA SOBRE EL ORDEN DE EJECUCIÓN (paso 7, controller):
  // Este `useEffect` corre tras el commit, en el orden de declaración de
  // los effects del componente. Si el controller del paso 7 invoca un
  // nuevo `attach(...)` en el mismo render en que el padre cambió el
  // símbolo, hay dos órdenes posibles:
  //
  //   A) attach(nuevo) corre ANTES de este effect:
  //      state.attachmentId = N+1, state.currentAttachmentId = N+1,
  //      chart y container del nuevo attach instalados.
  //      Después este effect llama resetBySymbol(), que incrementa
  //      attachmentId a N+2, desuscribe los listeners del nuevo attach,
  //      pone lifecycle = "detached", chart = null, container = null.
  //      El nuevo attach queda invalidado; el chart del controller
  //      queda sin viewport.
  //
  //   B) Este effect corre ANTES de attach(nuevo):
  //      resetBySymbol() deja el state limpio. El attach(nuevo) posterior
  //      funciona normalmente, con state.attachmentId incrementando de
  //      nuevo a N+2 (o el siguiente).
  //
  // El controller del paso 7 debe evitar la carrera (A). La forma robusta
  // es que el reset por símbolo NO corra si el controller va a recrear
  // el chart en el mismo ciclo; p. ej. el controller llama al `release()`
  // del attach anterior antes del nuevo `attach()` y este effect de
  // reset se delega al `unmount` (que es el cleanup final del chart).
  // Esta nota es el recordatorio: si en el paso 7 vemos el caso (A) en
  // producción, la solución es reubicar este reset, no reescribir la
  // pieza pura.
  useEffect(() => {
    if (!symbol) return;
    lifecycle.resetBySymbol();
  }, [symbol, lifecycle]);

  // Cleanup idempotente en unmount. No captura para futuro uso (§4.8.8);
  // sólo garantiza que no quedan listeners/timers.
  useEffect(() => () => {
    lifecycle.unmount();
  }, [lifecycle]);

  const prepare = useCallback((container) => lifecycle.prepare(container), [lifecycle]);
  const attach = useCallback((opts) => lifecycle.attach(opts), [lifecycle]);
  const detach = useCallback((opts) => lifecycle.detach(opts), [lifecycle]);
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
