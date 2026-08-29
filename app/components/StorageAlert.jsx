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
import {
  STORAGE_KEYS,
  freeUpLocalScans,
  lastStorageWriteFailure,
  subscribeStorageWriteFailures,
} from "@/lib/localState";

export const STORAGE_ALERT_DISMISS_PREFIX = "statsedge.storageAlert.dismiss";

const MESSAGES = {
  [STORAGE_KEYS.review]: "La cola de revisión no se guardó; en la ficha puede faltar Anterior/Siguiente.",
  [STORAGE_KEYS.screenerSession]: "La sesión no se guardó entera; al volver puede no restaurarse.",
  [STORAGE_KEYS.scans]: "No cabe el snapshot local; la copia en nube sigue disponible.",
  [STORAGE_KEYS.favorites]: "Los favoritos no se guardaron en este dispositivo.",
  [STORAGE_KEYS.alerts]: "Las alertas no se guardaron en este dispositivo.",
};

function sameFailureSignature(a, b) {
  return a.key === b.key
    && a.quota === b.quota
    && Boolean(a.failed) === Boolean(b.failed)
    && Boolean(a.degraded) === Boolean(b.degraded);
}

export function storageAlertDismissKey(failure) {
  if (!failure?.key) return "";
  const quota = failure.quota ? 1 : 0;
  const degraded = failure.degraded ? 1 : 0;
  const failed = failure.failed ? 1 : 0;
  return `${STORAGE_ALERT_DISMISS_PREFIX}:${failure.key}:${quota}:${degraded}:${failed}`;
}

export function isStorageAlertDismissed(failure, storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  if (!failure || !storage) return false;
  const key = storageAlertDismissKey(failure);
  if (!key) return false;
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function dismissStorageAlert(failure, storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  if (!failure || !storage) return;
  const key = storageAlertDismissKey(failure);
  if (!key) return;
  try {
    storage.setItem(key, "1");
  } catch {
    // sessionStorage lleno o bloqueado: el aviso puede volver al recargar.
  }
}

export function buildStorageAlertMessage(failure) {
  const reduced = failure.degraded && !failure.failed;
  let text;
  if (reduced) {
    text = failure.key === STORAGE_KEYS.review
      ? "Cola guardada sin miniaturas para que quepa; el espacio local está casi lleno."
      : "Versión reducida guardada; el espacio local está casi lleno.";
  } else {
    text = MESSAGES[failure.key] || "Parte del trabajo no se guardó en este dispositivo.";
    text += failure.quota
      ? " Lo que ves no se pierde, pero puede no guardarse para la próxima visita."
      : " El navegador no permite guardar ahora (modo privado o restricción).";
  }
  const showFreeSpace = Boolean(failure.quota || failure.key === STORAGE_KEYS.scans);
  return { text, reduced, showFreeSpace };
}

export default function StorageAlert() {
  const [failure, setFailure] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const last = lastStorageWriteFailure();
    if (last) {
      setFailure(last);
      setHidden(isStorageAlertDismissed(last));
    }
    return subscribeStorageWriteFailures((next) => {
      setFailure((current) => {
        if (current && sameFailureSignature(current, next)) return current;
        setHidden(isStorageAlertDismissed(next));
        return next;
      });
    });
  }, []);

  if (!failure || hidden) return null;

  const { text, reduced, showFreeSpace } = buildStorageAlertMessage(failure);

  function handleDismiss() {
    dismissStorageAlert(failure);
    setHidden(true);
  }

  function handleFreeSpace() {
    freeUpLocalScans(1);
    dismissStorageAlert(failure);
    setHidden(true);
  }

  return (
    <div className={`snapshotFreshnessNotice compact ${reduced ? "info" : "warn"}`} role="note" aria-live="polite">
      <span>Guardado local</span>
      <b>{text}</b>
      <div className="storageAlertActions">
        {showFreeSpace ? (
          <button type="button" className="storageAlertFree" onClick={handleFreeSpace}>
            Liberar espacio
          </button>
        ) : null}
        <button type="button" onClick={handleDismiss}>
          Entendido
        </button>
      </div>
    </div>
  );
}
