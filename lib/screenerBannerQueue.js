// lib/screenerBannerQueue.js — disciplina de banners del screener (P2).
//
// Regla de producto: como máximo 1 aviso “duro” (rojo/warn/error) + 1 “suave”
// (gris/info/loading) visibles a la vez. El resto va a «Estado de datos».
// No oculta honestidad de cobertura Global: solo prioriza qué grita en el
// viewport de caza; el overflow sigue legible en el drawer.

/** @typedef {'hard'|'soft'} BannerSeverity */

/**
 * Prioridad relativa dentro de cada severidad (más alto = más protagonista).
 * Los ids deben coincidir con los que ScreenerShell registra.
 */
export const BANNER_PRIORITY = Object.freeze({
  err: 100,
  "auth-reauth": 95,
  "markets-error": 90,
  "markets-misalignment": 85,
  "scan-stale-coverage": 80,
  "snapshot-warn": 75,
  // Soft: progreso de mesa > guardrails / copia local / status genérico
  "markets-loading": 60,
  "lideres-intl": 55,
  "curated-population": 52,
  "snapshot-info": 50,
  "scan-status": 40,
});

/**
 * Clasifica tone/source de un candidato en hard vs soft.
 * @param {{ id?: string, tone?: string, requiresReauth?: boolean, severity?: BannerSeverity }} candidate
 * @returns {BannerSeverity}
 */
export function classifyBannerSeverity(candidate = {}) {
  if (candidate.severity === "hard" || candidate.severity === "soft") {
    return candidate.severity;
  }
  if (candidate.requiresReauth) return "hard";
  const id = String(candidate.id || "");
  if (id === "err" || id === "auth-reauth" || id === "markets-error") {
    return "hard";
  }
  if (id === "scan-stale-coverage" || id === "markets-misalignment" || id === "snapshot-warn") {
    return "hard";
  }
  const tone = String(candidate.tone || "").toLowerCase();
  if (tone === "error" || tone === "warn" || tone === "bad") return "hard";
  return "soft";
}

function priorityOf(candidate = {}) {
  if (Number.isFinite(Number(candidate.priority))) return Number(candidate.priority);
  const id = String(candidate.id || "");
  return BANNER_PRIORITY[id] ?? 0;
}

function compareCandidates(a, b) {
  return priorityOf(b) - priorityOf(a) || String(a.id || "").localeCompare(String(b.id || ""));
}

/**
 * Selecciona slots visibles: ≤1 hard + ≤1 soft; el resto a overflow.
 *
 * @param {Array<object>} candidates
 * @returns {{
 *   hard: object|null,
 *   soft: object|null,
 *   overflow: object[],
 *   visibleIds: Set<string>,
 *   overflowIds: Set<string>,
 * }}
 */
export function selectBannerSlots(candidates = []) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((item) => item && item.id);
  const hard = [];
  const soft = [];
  for (const item of list) {
    const severity = classifyBannerSeverity(item);
    (severity === "hard" ? hard : soft).push({ ...item, severity });
  }
  hard.sort(compareCandidates);
  soft.sort(compareCandidates);

  const primaryHard = hard[0] || null;
  const primarySoft = soft[0] || null;
  const overflow = [...hard.slice(1), ...soft.slice(1)].sort(compareCandidates);

  const visibleIds = new Set();
  if (primaryHard) visibleIds.add(primaryHard.id);
  if (primarySoft) visibleIds.add(primarySoft.id);
  const overflowIds = new Set(overflow.map((item) => item.id));

  return {
    hard: primaryHard,
    soft: primarySoft,
    overflow,
    visibleIds,
    overflowIds,
  };
}

/**
 * ¿Este id debe pintarse en el slot primario (no en overflow)?
 * @param {Set<string>|null|undefined} visibleIds
 * @param {string} id
 */
export function isBannerSlotVisible(visibleIds, id) {
  if (!visibleIds) return true;
  return visibleIds.has(String(id || ""));
}

/**
 * Construye candidatos a partir del estado de chrome del screener.
 * Pure: no renderiza; ScreenerShell decide el JSX por id.
 *
 * @param {{
 *   err?: string|null,
 *   showSnapshotNotice?: boolean,
 *   snapshotNotice?: object|null,
 *   scanStatusVisible?: boolean,
 *   marketsMisalignment?: object|null,
 *   scanStale?: boolean,
 *   lideresIntlGuardrail?: object|null,
 *   curatedPopulationNotice?: object|null,
 * }} state
 * @returns {object[]}
 */
export function buildScreenerBannerCandidates({
  err = null,
  showSnapshotNotice = false,
  snapshotNotice = null,
  scanStatusVisible = false,
  marketsMisalignment = null,
  scanStale = false,
  lideresIntlGuardrail = null,
  curatedPopulationNotice = null,
} = {}) {
  const candidates = [];

  if (err && String(err).trim()) {
    candidates.push({
      id: "err",
      severity: "hard",
      tone: "error",
      label: "Incidencia",
      detail: String(err).trim(),
    });
  }

  if (showSnapshotNotice && snapshotNotice?.requiresReauth) {
    candidates.push({
      id: "auth-reauth",
      severity: "hard",
      tone: snapshotNotice.tone || "warn",
      label: snapshotNotice.label || "Sesión",
      detail: snapshotNotice.detail || "",
      requiresReauth: true,
      source: snapshotNotice.source,
    });
  } else if (showSnapshotNotice && snapshotNotice) {
    const tone = String(snapshotNotice.tone || "info").toLowerCase();
    const hard = tone === "warn" || tone === "error" || tone === "bad" || Boolean(snapshotNotice.stale);
    candidates.push({
      id: hard ? "snapshot-warn" : "snapshot-info",
      severity: hard ? "hard" : "soft",
      tone,
      label: snapshotNotice.label || "Datos",
      detail: snapshotNotice.detail || "",
      source: snapshotNotice.source,
      stale: Boolean(snapshotNotice.stale),
    });
  }

  if (marketsMisalignment) {
    const tone = String(marketsMisalignment.tone || "warn").toLowerCase();
    if (tone === "error") {
      candidates.push({
        id: "markets-error",
        severity: "hard",
        tone: "error",
        label: marketsMisalignment.label || "Mercados",
        detail: marketsMisalignment.detail || "",
        source: marketsMisalignment.source,
        ctaLabel: marketsMisalignment.ctaLabel,
      });
    } else if (tone === "loading") {
      candidates.push({
        id: "markets-loading",
        severity: "soft",
        tone: "loading",
        label: marketsMisalignment.label || "Actualizando mesa",
        detail: marketsMisalignment.detail || "",
        source: marketsMisalignment.source,
      });
    } else {
      candidates.push({
        id: "markets-misalignment",
        severity: "hard",
        tone: tone || "warn",
        label: marketsMisalignment.label || "Mercados",
        detail: marketsMisalignment.detail || "",
        source: marketsMisalignment.source,
        ctaLabel: marketsMisalignment.ctaLabel,
      });
    }
  }

  // Cobertura stale solo si no hay desalineación de mercados (misma regla UI).
  if (!marketsMisalignment && scanStale) {
    candidates.push({
      id: "scan-stale-coverage",
      severity: "hard",
      tone: "warn",
      label: "Cobertura",
      detail: "Los criterios de cobertura cambiaron; los datos cargados son de la selección anterior.",
    });
  }

  if (scanStatusVisible) {
    const statusErr = Boolean(err && String(err).trim());
    // Con `err` el hard ya es el div de incidencia; no duplicar status-error
    // como segundo hard (iría a overflow y el test/producto pierden el bar).
    if (!statusErr) {
      candidates.push({
        id: "scan-status",
        severity: "soft",
        tone: "info",
        label: "Estado",
        detail: "",
      });
    }
  }

  if (lideresIntlGuardrail) {
    candidates.push({
      id: "lideres-intl",
      severity: "soft",
      tone: "warn",
      label: lideresIntlGuardrail.label || "Líderes intl",
      detail: lideresIntlGuardrail.detail || "",
      source: lideresIntlGuardrail.source,
    });
  }

  if (curatedPopulationNotice) {
    candidates.push({
      id: "curated-population",
      severity: "soft",
      tone: "warn",
      label: curatedPopulationNotice.label || "Población parcial",
      detail: curatedPopulationNotice.detail || "",
      peekDetail: curatedPopulationNotice.peekDetail,
      bodyDetail: curatedPopulationNotice.bodyDetail,
      source: curatedPopulationNotice.source,
    });
  }

  return candidates;
}
