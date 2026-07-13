// app/useChartInteraction.js — Adaptador entre el DOM (eventos pointer) y la
// máquina de estados pura `lib/chartInteractionMachine.js`.
//
// Esta capa posee el ÚNICO juego de listeners pointer en captura sobre el
// contenedor del chart. Su responsabilidad es:
//
//   1. Capturar pointerdown/move/up/cancel en fase de captura sobre el
//      contenedor, ANTES que los listeners de la librería (H1/H3 del ADR).
//   2. Clasificar el evento: hit-test (handle/body/empty) usando la primitiva
//      y proyección pantalla→dominio usando `screenToDomain` (inyectado).
//   3. Llamar `machine.send(event)` y ejecutar la lista de efectos resultante.
//      - nativeOn / nativeOff → `chart.applyOptions(...)` con los presets
//        NATIVE_GESTURES_ON/OFF (la única fuente de verdad — ADR §4).
//      - capturePointer / releasePointer → `container.setPointerCapture(id)`.
//      - setTouchAction → inline style en el contenedor.
//      - preventDefault → sobre el evento nativo.
//      - El resto (select/deselect/beginOverlay/updateOverlay/clearOverlay/
//        commitDraw/beginHandleDrag/updateHandleDrag/revertHandleDrag) →
//        callbacks inyectados por `useChartDrawings` (capa de dominio).
//
// En dev expone `window.__chartInteractionState = machine` para inspección
// desde los scripts E2E (ADR §7.6).

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  NATIVE_GESTURES_ON,
  NATIVE_GESTURES_OFF,
  createChartInteractionMachine,
} from "@/lib/chartInteractionMachine";

// Tolerancia de hit-test por tipo de puntero (ADR §7.3).
// El adaptador la pasa a `pickAt` para que el dedo tenga diana generosa.
const HIT_TOLERANCE_TOUCH_PX = 16;
const HIT_TOLERANCE_DEFAULT_PX = 8;

function pickToleranceForPointerType(pointerType) {
  return pointerType === "touch" ? HIT_TOLERANCE_TOUCH_PX : HIT_TOLERANCE_DEFAULT_PX;
}

function inContainer(container, target) {
  if (!container || !target) return false;
  return container.contains(target);
}

function localPoint(container, clientX, clientY) {
  const rect = container.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * Hook adaptador: orquesta listeners pointer + ejecuta efectos de la máquina.
 *
 * @param {object} args
 * @param {{current:HTMLElement|null}} args.containerRef  Ref al contenedor del chart.
 * @param {{current:object|null}} args.chartRef          Ref al chart (para applyOptions).
 * @param {{current:object|null}} args.primitiveRef      Ref a la primitiva (para pickAt).
 * @param {{current:function|null}} args.screenToDomainRef  Ref a (x,y)→{time,price,...}.
 * @param {{current:function|null}} args.pixelFromTimePriceRef  Ref a (time,price)→{x,y}.
 * @param {{current:object}} args.callbacksRef           Ref al objeto de callbacks de dominio.
 * @param {string} [args.symbol]                         Símbolo (para window.__chartInteractionState).
 * @param {number} [args.attachKey=0]                    Cambia en cada attach real del chart.
 *
 * Por qué refs y no valores: el padre muta `containerRef.current` desde dentro
 * de `attach()`, fuera del ciclo de render. Pasar refs garantiza que el
 * adaptador SIEMPRE lee la versión actual del container/chart/primitive
 * cuando se ejecuta un listener, sin depender de un re-render.
 */
export function useChartInteraction({
  containerRef,
  chartRef: chartRefProp,
  primitiveRef: primitiveRefProp,
  screenToDomainRef,
  pixelFromTimePriceRef,
  callbacksRef,
  symbol = "",
  attachKey = 0,
} = {}) {
  // La máquina se crea una vez por mount y se reutiliza — la "vida" de la
  // máquina es la vida del componente (chart recreations se modelan con
  // DETACH → idle, no recreando la máquina).
  const machineRef = useRef(null);
  if (machineRef.current === null) {
    machineRef.current = createChartInteractionMachine();
  }
  const machine = machineRef.current;

  // Si el padre no nos pasa refs (compatibilidad hacia atrás / tests),
  // creamos unas locales inicializadas con los valores que nos pasaron.
  const localContainerRef = useRef(null);
  const localChartRef = useRef(null);
  const localPrimitiveRef = useRef(null);
  const localScreenToDomainRef = useRef(null);
  const localPixelFromTimePriceRef = useRef(null);
  const localCallbacksRef = useRef({});
  // Alias para los refs efectivos (los del padre si existen, si no los locales).
  // Cada alias se consume dentro de los callbacks `runEffects`,
  // `classifyPointerDown` y `classifyPointerMove`, y dentro del `useEffect`
  // que engancha listeners — siempre vía `.current` en el momento de la
  // invocación, no en render. Si tu linter se queja de "unused", marca estas
  // refs en su allowlist; el consumo real es a través del closure.
  const cRef = containerRef || localContainerRef;
  const chRef = chartRefProp || localChartRef;
  const pRef = primitiveRefProp || localPrimitiveRef;
  const s2dRef = screenToDomainRef || localScreenToDomainRef;
  const p2pRef = pixelFromTimePriceRef || localPixelFromTimePriceRef;
  const cbRef = callbacksRef || localCallbacksRef;

  // Expone la máquina en dev para inspección desde scripts E2E.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handle = machine;
    window.__chartInteractionState = handle;
    void symbol;
    return () => {
      if (window.__chartInteractionState === handle) {
        window.__chartInteractionState = undefined;
      }
    };
  }, [machine, symbol]);

  // ───────────────────────────────────────────────────────────────────────
  // Ejecutor de efectos: traduce cada efecto de la máquina en la operación
  // correspondiente sobre el chart / DOM / callbacks de dominio.
  // ───────────────────────────────────────────────────────────────────────

  const runEffects = useCallback((effects, event) => {
    if (!Array.isArray(effects) || effects.length === 0) return;
    const c = chRef.current;
    const containerEl = cRef.current;
    const cb = cbRef.current || {};
    for (const eff of effects) {
      if (!eff || typeof eff.type !== "string") continue;
      switch (eff.type) {
        case "nativeOff":
          if (c && typeof c.applyOptions === "function") {
            try {
              c.applyOptions({
                handleScroll: { ...NATIVE_GESTURES_OFF.handleScroll },
                handleScale: { ...NATIVE_GESTURES_OFF.handleScale },
              });
            } catch {
              /* swallow: applyOptions nunca debe romper la interacción */
            }
          }
          break;
        case "nativeOn":
          if (c && typeof c.applyOptions === "function") {
            try {
              c.applyOptions({
                handleScroll: { ...NATIVE_GESTURES_ON.handleScroll },
                handleScale: { ...NATIVE_GESTURES_ON.handleScale },
              });
            } catch {
              /* noop */
            }
          }
          break;
        case "capturePointer": {
          const pointerId = eff.payload && eff.payload.pointerId;
          if (containerEl && Number.isFinite(pointerId) && typeof containerEl.setPointerCapture === "function") {
            try {
              containerEl.setPointerCapture(pointerId);
            } catch {
              /* el pointer puede ya no ser capturable; ignoramos */
            }
          }
          break;
        }
        case "releasePointer": {
          const pointerId = eff.payload && eff.payload.pointerId;
          if (containerEl && Number.isFinite(pointerId) && typeof containerEl.releasePointerCapture === "function") {
            try {
              containerEl.releasePointerCapture(pointerId);
            } catch {
              /* noop */
            }
          }
          break;
        }
        case "setTouchAction": {
          if (containerEl && containerEl.style) {
            containerEl.style.touchAction = eff.payload == null ? "" : String(eff.payload);
          }
          break;
        }
        case "preventDefault":
          if (event && typeof event.preventDefault === "function") {
            try { event.preventDefault(); } catch { /* noop */ }
          }
          break;
        case "select":
          if (typeof cb.onSelect === "function") cb.onSelect(eff.payload && eff.payload.id);
          break;
        case "deselect":
          if (typeof cb.onDeselect === "function") cb.onDeselect();
          break;
        case "beginOverlay":
          if (typeof cb.onBeginOverlay === "function") cb.onBeginOverlay(eff.payload);
          break;
        case "updateOverlay":
          if (typeof cb.onUpdateOverlay === "function") cb.onUpdateOverlay(eff.payload);
          break;
        case "clearOverlay":
          if (typeof cb.onClearOverlay === "function") cb.onClearOverlay();
          break;
        case "commitDraw":
          if (typeof cb.onCommitDraw === "function") cb.onCommitDraw(eff.payload);
          break;
        case "beginHandleDrag":
          if (typeof cb.onBeginHandleDrag === "function") cb.onBeginHandleDrag(eff.payload);
          break;
        case "updateHandleDrag":
          if (typeof cb.onUpdateHandleDrag === "function") cb.onUpdateHandleDrag(eff.payload);
          break;
        case "revertHandleDrag":
          if (typeof cb.onRevertHandleDrag === "function") cb.onRevertHandleDrag(eff.payload);
          break;
        case "swallow":
          // Marcador semántico: el adaptador ya ha llamado preventDefault si
          // correspondía. Nada más que hacer — el nativo ya está OFF cuando
          // este efecto se emite en estados custom (H2).
          break;
        default:
          // Efectos desconocidos se ignoran — el adaptador no rompe la
          // máquina ante efectos nuevos no contemplados.
          break;
      }
    }
  }, []);

  // ───────────────────────────────────────────────────────────────────────
  // Clasificación: hit-test + proyección a dominio. Devuelve un evento
  // listo para `machine.send`.
  // ───────────────────────────────────────────────────────────────────────

  const classifyPointerDown = useCallback((native) => {
    const containerEl = cRef.current;
    const prim = pRef.current;
    const s2d = s2dRef.current;
    const point = localPoint(containerEl, native.clientX, native.clientY);
    const pointerType = native.pointerType || "mouse";
    const tol = pickToleranceForPointerType(pointerType);

    // Hit-test: handle > body > empty. La primitiva ya prioriza handle sobre
    // body, pero aquí lo hacemos explícito y tolerante al puntero.
    let hit = "empty";
    let drawingId = null;
    let handle = null;
    let originalPoint = null;
    if (prim && typeof prim.pickAt === "function") {
      // Si la primitiva admite tolerancia, la pasamos; si no, fallback a
      // comportamiento por defecto (sin cambio de contrato).
      let picked = null;
      try {
        picked = prim.pickAt(point.x, point.y, tol);
      } catch {
        picked = prim.pickAt(point.x, point.y);
      }
      if (picked) {
        hit = picked.kind || "body";
        drawingId = picked.drawingId || null;
        handle = picked.handle || null;
      }
    }

    // domain: sólo lo calculamos si hace falta (la máquina lo necesita para
    // armed→drawing y drawing→idle). En idle→editing basta con originalPoint.
    let domain = null;
    if (typeof s2d === "function") {
      domain = s2d(native.clientX, native.clientY);
    }

    // originalPoint para editing: el adaptador lo busca en el store vía el
    // callback onResolveHandlePoint (inyectado por useChartDrawings, que sí
    // tiene acceso al store). Si no se inyecta, fallback a null.
    if (hit === "handle" && drawingId && handle) {
      const cb = cbRef.current || {};
      if (typeof cb.onResolveHandlePoint === "function") {
        originalPoint = cb.onResolveHandlePoint(drawingId, handle);
      }
    }

    return {
      type: "pointerdown",
      pointerId: native.pointerId,
      pointerType,
      isPrimary: !!native.isPrimary,
      hit,
      domain,
      drawingId,
      handle,
      originalPoint,
    };
  }, []);

  const classifyPointerMove = useCallback((native) => {
    const containerEl = cRef.current;
    const s2d = s2dRef.current;
    const p2p = p2pRef.current;
    const point = localPoint(containerEl, native.clientX, native.clientY);
    let domain = null;
    if (typeof s2d === "function") {
      domain = s2d(native.clientX, native.clientY);
    }
    // p1Pixel para drawing→updateOverlay: la máquina guarda pendingP1 en
    // dominio; aquí lo proyectamos a píxeles usando el proveedor inverso.
    let p1Pixel = null;
    if (typeof p2p === "function") {
      // Sólo necesitamos time/price del domain; el proveedor inverso
      // normalmente viene dado por el chart (logicalToCoordinate +
      // priceToCoordinate). El caller inyecta esta función.
      const ctx = machine.getContext();
      if (ctx.pendingP1 && Number.isFinite(ctx.pendingP1.time) && Number.isFinite(ctx.pendingP1.price)) {
        const px = p2p(ctx.pendingP1.time, ctx.pendingP1.price);
        if (px) p1Pixel = px;
      }
    }
    return {
      type: "pointermove",
      pointerId: native.pointerId,
      pointerType: native.pointerType || "mouse",
      isPrimary: !!native.isPrimary,
      domain,
      p1Pixel,
    };
  }, [machine]);

  // ───────────────────────────────────────────────────────────────────────
  // Listeners pointer en fase de captura sobre el contenedor del chart.
  // Se re-enganchan cuando cambia `attachKey` (que ocurre en cada attach
  // real del padre — ver `useChartDrawings.attach`). Estrategia:
  //
  //   - pointerdown/move/cancel: filtrados por `container.contains(target)`
  //     para no reaccionar a eventos que pasen por encima del chart.
  //   - pointerup: aceptado siempre que tengamos un pointerId activo; el
  //     navegador puede dispararlo fuera del contenedor cuando el dedo
  //     sale del chart. El filtrado real lo hace la máquina vía su
  //     bookkeeping de activePointers.
  //
  // H1/H3 del ADR: en captura, nuestros listeners sobre el contenedor se
  // ejecutan ANTES que los listeners de la librería (que están en fase
  // bubble sobre el canvas descendiente). El `applyOptions` síncrono
  // dentro del handler llega a tiempo para la librería (H2).
  // ───────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const c = cRef.current;
    if (!c || typeof c.addEventListener !== "function") return undefined;

    const onDown = (e) => {
      if (!inContainer(c, e.target)) return;
      const ev = classifyPointerDown(e);
      const effects = machine.send(ev);
      runEffects(effects, e);
    };
    const onMove = (e) => {
      if (!inContainer(c, e.target)) return;
      const ev = classifyPointerMove(e);
      const effects = machine.send(ev);
      runEffects(effects, e);
    };
    const onUp = (e) => {
      const ev = {
        type: "pointerup",
        pointerId: e.pointerId,
        pointerType: e.pointerType || "mouse",
        isPrimary: !!e.isPrimary,
      };
      const effects = machine.send(ev);
      runEffects(effects, e);
    };
    const onCancel = (e) => {
      const ev = {
        type: "pointercancel",
        pointerId: e.pointerId,
        pointerType: e.pointerType || "mouse",
        isPrimary: !!e.isPrimary,
      };
      const effects = machine.send(ev);
      runEffects(effects, e);
    };
    const onLostPointerCapture = (e) => {
      // El navegador dispara lostpointercapture cuando el sistema o el
      // propio código llama a releasePointerCapture; lo tratamos como
      // cancel para que la máquina pueda revertir (ADR §3, "Desde editing").
      const ev = {
        type: "pointercancel",
        pointerId: e.pointerId,
        pointerType: e.pointerType || "mouse",
        isPrimary: !!e.isPrimary,
      };
      const effects = machine.send(ev);
      runEffects(effects, e);
    };

    c.addEventListener("pointerdown", onDown, true);
    c.addEventListener("pointermove", onMove, true);
    c.addEventListener("pointerup", onUp, true);
    c.addEventListener("pointercancel", onCancel, true);
    c.addEventListener("lostpointercapture", onLostPointerCapture, true);

    return () => {
      c.removeEventListener("pointerdown", onDown, true);
      c.removeEventListener("pointermove", onMove, true);
      c.removeEventListener("pointerup", onUp, true);
      c.removeEventListener("pointercancel", onCancel, true);
      c.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    };
  }, [attachKey, classifyPointerDown, classifyPointerMove, machine, runEffects]);

  // ───────────────────────────────────────────────────────────────────────
  // Conectores externos: ARM (botón lápiz), DISARM, ESCAPE, DETACH.
  // Cada uno envía un evento de máquina y aplica los efectos resultantes
  // (típicamente nativeOn/nativeOff + setTouchAction + clearOverlay).
  // ───────────────────────────────────────────────────────────────────────

  const arm = useCallback(() => {
    const effects = machine.send({ type: "ARM" });
    runEffects(effects, null);
  }, [machine, runEffects]);

  const disarm = useCallback(() => {
    const effects = machine.send({ type: "DISARM" });
    runEffects(effects, null);
  }, [machine, runEffects]);

  const escape = useCallback(() => {
    const effects = machine.send({ type: "ESCAPE" });
    runEffects(effects, null);
  }, [machine, runEffects]);

  const detach = useCallback(() => {
    const effects = machine.send({ type: "DETACH" });
    runEffects(effects, null);
  }, [machine, runEffects]);

  // Suscripción opcional al estado: el caller (useChartDrawings) puede
  // derivar `toolActive`/`inProgress` desde aquí.
  const subscribe = useCallback((fn) => machine.subscribe(fn), [machine]);

  return useMemo(
    () => ({
      machine,
      arm,
      disarm,
      escape,
      detach,
      getState: () => machine.getState(),
      subscribe,
    }),
    [machine, arm, disarm, escape, detach, subscribe],
  );
}

export default useChartInteraction;