// lib/mesaEmptyState.js — empty de mesa por falta de escaneo / error de datos
// (P1). Distinto de «0 pasan el filtro» (eso sigue en resultsEmptyLabel).
//
// Pure helpers: copy humano + cuándo mostrar la tarjeta centrada en vez del
// banner ops dominante + celda «Sin datos…».

import { marketName } from "@/lib/screenerConfig";
import { nightlyAbsenceReasonText } from "@/lib/nightlyAbsence";

/** Razones de lectura / red (P11 C). */
const NETWORK_REASONS = new Set(["cloud-unavailable", "nightly-read-failed"]);

/** Razones de ausencia del nocturno (P11 A). */
const NIGHTLY_ABSENCE_REASONS = new Set([
  "no-nightly-scan",
  "nightly-not-publishable",
  "supabase-disabled",
]);

/**
 * ¿La home debe mostrar la tarjeta humana de mesa vacía?
 * No aplica en cold restore, desalineación de mercados, ni con filas cargadas.
 */
export function shouldShowMesaEmptyCard({
  analyzedCount = 0,
  restoringScan = false,
  resultsBlocked = false,
} = {}) {
  if (restoringScan) return false;
  if (resultsBlocked) return false;
  return Number(analyzedCount) === 0;
}

/**
 * Clasifica la causa: network | nightly | generic.
 * @param {{ snapshotNotice?: object|null, err?: string|null }} params
 */
export function resolveMesaEmptyKind({ snapshotNotice = null, err = null } = {}) {
  const reason = String(snapshotNotice?.reason || "").trim();
  if (NETWORK_REASONS.has(reason)) return "network";
  if (err && String(err).trim()) return "network";
  if (
    snapshotNotice?.nightlyMissing
    || NIGHTLY_ABSENCE_REASONS.has(reason)
    || snapshotNotice?.source === "nightly-us"
  ) {
    return "nightly";
  }
  return "generic";
}

function normalizeMarketCodes(markets = []) {
  const codes = [];
  for (const entry of Array.isArray(markets) ? markets : []) {
    if (Array.isArray(entry)) {
      const code = String(entry[0] || "").toUpperCase();
      if (code) codes.push(code);
      continue;
    }
    if (entry && typeof entry === "object" && entry.code) {
      const code = String(entry.code || "").toUpperCase();
      if (code) codes.push(code);
      continue;
    }
    const code = String(entry || "").toUpperCase();
    if (code) codes.push(code);
  }
  return codes;
}

function marketLabelForTitle(markets = []) {
  const codes = normalizeMarketCodes(markets);
  if (codes.length === 1 && codes[0] === "US") return "EE. UU.";
  if (codes.length === 1) return marketName(codes[0]);
  if (codes.length > 1) return "tu selección";
  return "EE. UU.";
}

/**
 * Copy de producto para la tarjeta centrada.
 * @returns {{
 *   kind: 'network'|'nightly'|'generic',
 *   title: string,
 *   cause: string,
 *   technicalDetail: string,
 *   primaryRetryLabel: string,
 * }}
 */
export function buildMesaEmptyCopy({
  markets = [],
  snapshotNotice = null,
  err = null,
} = {}) {
  const kind = resolveMesaEmptyKind({ snapshotNotice, err });
  const marketLabel = marketLabelForTitle(markets);
  const technicalDetail = [
    snapshotNotice?.detail,
    err && String(err).trim() ? String(err).trim() : "",
  ].filter(Boolean).join(" ")
    || nightlyAbsenceReasonText(
      snapshotNotice?.reason
        ? { reason: snapshotNotice.reason, rejectedScan: snapshotNotice.rejectedScan }
        : { reason: "no-nightly-scan" },
    );

  if (kind === "network") {
    return {
      kind,
      title: `No se pudo cargar el escaneo para ${marketLabel}`,
      cause: "Hay un problema de conexión o de lectura. Puedes reintentar o abrir la ficha de un ticker concreto.",
      technicalDetail,
      primaryRetryLabel: "Reintentar",
    };
  }

  if (kind === "nightly") {
    const reason = String(snapshotNotice?.reason || "");
    let cause = "Todavía no hay un escaneo publicable para esta mesa. Reintenta o busca un ticker para abrir su ficha.";
    if (reason === "nightly-not-publishable") {
      cause = "El escaneo de anoche no terminó bien y no publica resultados. Reintenta más tarde o busca un ticker.";
    } else if (reason === "supabase-disabled") {
      cause = "Este entorno no tiene sincronización activada. Busca un ticker o revisa la configuración.";
    }
    return {
      kind,
      title: `Sin escaneo de anoche para ${marketLabel}`,
      cause,
      technicalDetail,
      primaryRetryLabel: "Reintentar",
    };
  }

  return {
    kind: "generic",
    title: `Sin datos de mesa para ${marketLabel}`,
    cause: "Los datos de anoche se cargan al abrir. Si no aparecen, reintenta o busca un ticker.",
    technicalDetail: technicalDetail || "No hay datos cargados todavía.",
    primaryRetryLabel: "Reintentar",
  };
}

/** ¿El banner snapshot de nocturno/red debe ceder protagonismo a la tarjeta? */
export function shouldFoldSnapshotNoticeIntoMesaEmpty(snapshotNotice = null) {
  if (!snapshotNotice) return false;
  if (snapshotNotice.requiresReauth) return false;
  if (snapshotNotice.nightlyMissing) return true;
  if (snapshotNotice.source === "nightly-us") return true;
  const reason = String(snapshotNotice.reason || "");
  return NETWORK_REASONS.has(reason) || NIGHTLY_ABSENCE_REASONS.has(reason);
}
