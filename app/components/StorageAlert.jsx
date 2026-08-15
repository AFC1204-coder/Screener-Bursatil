"use client";

// Aviso de guardado local. Se muestra solo cuando una escritura en el
// almacenamiento del dispositivo falla (antes safeWrite se tragaba el error y
// la función afectada desaparecía sin mensaje — la cola de revisión no se
// escribía y el raíl de la ficha no aparecía, sin rastro para el usuario).
//
// Principio 6: discreto y en lenguaje de producto — dice qué significa para lo
// que el usuario está haciendo, no el error técnico. Reusa la clase
// snapshotFreshnessNotice (el mismo tono visual que los avisos de snapshot).

import { useEffect, useState } from "react";
import { STORAGE_KEYS, subscribeStorageWriteFailures } from "@/lib/localState";

const MESSAGES = {
  [STORAGE_KEYS.review]: "La cola de revisión no se ha podido guardar: al abrir una ficha puede faltar la navegación Anterior/Siguiente.",
  [STORAGE_KEYS.screenerSession]: "La sesión del screener no se ha podido guardar entera: al volver puede no restaurarse como la dejaste.",
  [STORAGE_KEYS.scans]: "El snapshot no se ha podido guardar en este dispositivo. La copia de la nube sigue disponible.",
  [STORAGE_KEYS.favorites]: "Los favoritos no se han podido guardar en este dispositivo.",
  [STORAGE_KEYS.alerts]: "Las alertas no se han podido guardar en este dispositivo.",
};

export default function StorageAlert() {
  const [failure, setFailure] = useState(null);
  const [dismissedAt, setDismissedAt] = useState("");

  useEffect(() => subscribeStorageWriteFailures((next) => {
    setFailure((current) => {
      // El mismo problema repetido no reabre un aviso ya descartado; un cambio
      // de gravedad (reducido → imposible) sí.
      if (current && current.key === next.key && current.quota === next.quota
        && Boolean(current.failed) === Boolean(next.failed) && Boolean(current.degraded) === Boolean(next.degraded)) return current;
      setDismissedAt("");
      return next;
    });
  }), []);

  if (!failure || dismissedAt === failure.at + failure.key) return null;
  const reduced = failure.degraded && !failure.failed;
  const detail = reduced
    ? (failure.key === STORAGE_KEYS.review
      ? "La cola de revisión se ha guardado sin miniaturas para que quepa. La navegación y tus resoluciones se conservan."
      : "Para que quepa, se ha guardado una versión reducida.")
    : (MESSAGES[failure.key] || "Una parte del trabajo no se ha podido guardar en este dispositivo.");
  const meaning = reduced
    ? "El espacio de guardado de este dispositivo está casi lleno."
    : failure.quota
      ? "El espacio de guardado de este dispositivo está lleno; lo que ves en pantalla no se pierde, pero no todo quedará guardado para la próxima visita."
      : "El navegador no permite guardar datos ahora (modo privado o una restricción del navegador).";
  return (
    <div className={`snapshotFreshnessNotice ${reduced ? "info" : "warn"}`} role="note" aria-live="polite">
      <span>Guardado local</span>
      <b>{detail} {meaning}</b>
      <button
        type="button"
        onClick={() => setDismissedAt(failure.at + failure.key)}
        style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
      >
        Entendido
      </button>
    </div>
  );
}
