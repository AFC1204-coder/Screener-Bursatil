// lib/scanErrors.js — clasificación tipada de errores que produce el scan runner.
//
// El runner puede capturar errores de dos orígenes:
//   1. Providers de mercado (Yahoo, Stooq, Alpha Vantage) — errores con shape
//      plano (Error) y código HTTP solo embebido en el message (regex "HTTP NNN").
//   2. Supabase (via lib/supabaseServer.js) — error extendido con .status numérico.
//
// Esta función clasifica según dos clases semánticas:
//
//   - "retryable": el siguiente reintento podría resolverse (timeouts, rate
//     limits 429, 5xx transitorios, fetch failed, ECONNRESET, EAI_AGAIN).
//   - "terminal":  reintentar no cambia el resultado (400, 401, 403, 404 de
//     símbolo inválido, errores de parseo, "sin resultado").
//   - "unknown":   no se pudo clasificar; se conserva como "terminal" de
//     cara al cómputo del ratio (conservador: cuenta como fila fallida).
//
// El shape del error es {"kind", "reason", "status"?, "message"?, "raw"?}.
//   kind:    "retryable" | "terminal" | "unknown"
//   reason:  primer substring útil del error (cap a 240 chars para no
//            contaminar progress.errors[])
//   status:  HTTP code si se pudo extraer (numérico), null si no.

const HTTP_STATUS_RE = /(?:Yahoo|Stooq|Alpha Vantage)\s+\w+\s+HTTP\s+(\d{3})/i;

// Errores con códigos que indican transitoriedad (no se reintentan hoy, pero
// se marcan como retryable para futura recuperación automática).
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523, 524]);

// Errores con códigos que indican condición permanente del símbolo/recurso.
const TERMINAL_HTTP = new Set([400, 401, 403, 404, 410]);

// Mensajes que indican transitoriedad incluso sin código HTTP claro.
const RETRYABLE_TEXT_PATTERNS = [
  /\btime-?out\b/i,
  /\btimed out\b/i,
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bEAI_AGAIN\b/,
  /\bENOTFOUND\b/,
  /\bfetch failed\b/i,
  /\bnetwork\b.*\berror\b/i,
  /\bcloudflare\s+5\d\d\b/i,
  /\bweb server is down\b/i,
];

// Mensajes que indican condición permanente del input o del parseo.
const TERMINAL_TEXT_PATTERNS = [
  /\bsin (?:resultado|resultados|historico|hist[oó]rico)\b/i,
  /\bpar?\s*no encontrado\b/i,
  /\bnot found\b/i,
  /\binvalid\s+(?:symbol|ticker)\b/i,
  /\bJSON\.parse\b/,
  /\bSyntaxError\b/,
  /\b401|403\b/,
];

const REASON_MAX_CHARS = 240;

function cleanReason(text = "") {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "Proveedor no disponible";
  return clean.length > REASON_MAX_CHARS ? `${clean.slice(0, REASON_MAX_CHARS)}…` : clean;
}

/**
 * Clasifica un error capturado durante el scan loop en una de las tres clases.
 * Acepta Error estándar o cualquier objeto con .message / .status.
 * Si recibe null/undefined, retorna { kind: "unknown", reason: "..." }.
 */
export function classifyProviderError(error) {
  if (!error) {
    return { kind: "unknown", status: null, reason: "Error sin cuerpo" };
  }
  const message = typeof error.message === "string" ? error.message : String(error?.message || error || "");
  let status = Number.isFinite(Number(error.status)) ? Number(error.status) : null;
  if (!status) {
    const match = HTTP_STATUS_RE.exec(message);
    if (match) status = Number(match[1]);
  }
  let kind;
  if (status && RETRYABLE_HTTP.has(status)) {
    kind = "retryable";
  } else if (status && TERMINAL_HTTP.has(status)) {
    kind = "terminal";
  } else if (RETRYABLE_TEXT_PATTERNS.some((re) => re.test(message))) {
    kind = "retryable";
  } else if (TERMINAL_TEXT_PATTERNS.some((re) => re.test(message))) {
    kind = "terminal";
  } else if (message) {
    // Sin clasificación: conservador — contabiliza como terminal en el ratio,
    // pero deja la puerta abierta a un clasificador más fino vía extensión.
    kind = "unknown";
  } else {
    kind = "unknown";
  }
  return { kind, status: Number.isFinite(status) ? status : null, reason: cleanReason(message) };
}
