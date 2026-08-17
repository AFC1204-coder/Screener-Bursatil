// lib/nightlyAbsence.js — cómo se enuncia que NO hay escaneo nocturno
// estadounidense. Módulo puro y sin dependencias: lo importa la pantalla
// principal (cliente) y se testea solo.
//
// La regla que codifica: cuando el nocturno no está, la pantalla lo dice con su
// motivo. No carga el escaneo de otro mercado para que "haya algo" — eso es lo
// que hacía hasta el 17 de agosto de 2026, y el usuario abría el screener y
// veía una acción italiana creyendo que era el universo estadounidense.

const NIGHTLY_LABEL = "Escaneo nocturno";

function dayOf(value = "") {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

/** Motivo en una frase, sin nombrar servicios ni volcar errores crudos. */
export function nightlyAbsenceReasonText(nightly = {}) {
  const reason = String(nightly.reason || "");
  if (reason === "nightly-not-publishable") {
    const day = dayOf(nightly.rejectedScan?.createdAt);
    return `El escaneo nocturno de Estados Unidos${day ? ` del ${day}` : ""} no terminó correctamente, así que no publica resultados.`;
  }
  if (reason === "supabase-disabled") {
    return "La copia en la nube no está activada, así que no hay ningún escaneo nocturno que cargar.";
  }
  if (reason === "nightly-read-failed" || reason === "cloud-unavailable") {
    return "No se ha podido leer el escaneo nocturno de Estados Unidos.";
  }
  return "Todavía no hay ningún escaneo nocturno de Estados Unidos guardado.";
}

/**
 * Aviso para el banner del screener (ScreenerShell → snapshotNotice). La
 * segunda frase es la parte que importa: dice explícitamente que no se ha
 * sustituido por otro mercado, para que la tabla vacía se lea como una ausencia
 * declarada y no como un fallo mudo.
 */
export function nightlyAbsenceNotice(nightly = {}, { localCopyMissing = true } = {}) {
  const detail = [
    nightlyAbsenceReasonText(nightly),
    "No se carga el escaneo de otro mercado en su lugar.",
    localCopyMissing ? "Tampoco hay copia local de un nocturno estadounidense en este dispositivo." : "",
  ].filter(Boolean).join(" ");
  return {
    tone: "warn",
    label: NIGHTLY_LABEL,
    detail,
    source: "nightly-us",
    nightlyMissing: true,
    reason: String(nightly.reason || "no-nightly-scan"),
  };
}

/** Texto de la línea de estado, más corto que el banner. */
export function nightlyAbsenceStatus(nightly = {}) {
  return `Sin datos que mostrar. ${nightlyAbsenceReasonText(nightly)}`;
}
