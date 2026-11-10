"use client";

// Hoja inferior genérica del screener móvil (estudio móvil 2026-11, §2.3-2.5).
// Diálogo modal: foco dentro al abrir y de vuelta al cerrar, Tab atrapado,
// Escape, toque en el velo y arrastrar el asa hacia abajo cierran. Bloquea el
// scroll de la página mientras está abierta (la lista de debajo no se mueve).

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";
const DRAG_CLOSE_PX = 90;

export default function MobileSheet({
  open = false,
  onClose,
  label = "",
  head = null,
  footer = null,
  children = null,
  className = "",
  bodyRef = null,
}) {
  const sheetRef = useRef(null);
  const dragRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    const sheet = sheetRef.current;
    sheet?.focus({ preventScroll: true });

    function onKeyDown(event) {
      // Una familia abierta desde la hoja (FilterFamilyModal, <dialog open>)
      // va encima: sus teclas son suyas.
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const items = [...sheet.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      body.style.overflow = previousOverflow;
      if (previous && typeof previous.focus === "function" && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;

  function onDragStart(event) {
    if (event.target.closest("button, a, select, input, summary")) return;
    dragRef.current = { y: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onDragMove(event) {
    const drag = dragRef.current;
    if (!drag || !sheetRef.current) return;
    drag.dy = Math.max(0, event.clientY - drag.y);
    sheetRef.current.style.transform = drag.dy ? `translateY(${drag.dy}px)` : "";
  }
  function onDragEnd() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !sheetRef.current) return;
    sheetRef.current.style.transform = "";
    if (drag.dy > DRAG_CLOSE_PX) onCloseRef.current?.();
  }

  // Portal a <body>: fuera del contexto de apilamiento de la página, la hoja
  // queda por encima de la barra inferior (que se ve atenuada bajo el velo).
  const layer = (
    <div className="mobileSheetLayer">
      <div className="mobileSheetScrim" onClick={() => { if (!document.querySelector("dialog[open]")) onCloseRef.current?.(); }} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={`mobileSheet${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div
          className="mobileSheetDrag"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="mobileSheetGrab" aria-hidden="true" />
          <div className="mobileSheetHead">
            <div className="mobileSheetTitle">{head}</div>
            <button type="button" className="mobileIconBtn" onClick={() => onCloseRef.current?.()} aria-label="Cerrar">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>
        <div ref={bodyRef} className="mobileSheetBody">{children}</div>
        {footer ? <div className="mobileSheetFoot">{footer}</div> : null}
      </section>
    </div>
  );
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}
