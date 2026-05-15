export function clamp(n, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
}

export function pct(n, digits = 1) {
  return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%` : "-";
}

export function pctShare(n, digits = 0) {
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "-";
}

export function num(n, digits = 0) {
  return Number.isFinite(n) ? n.toFixed(digits) : "-";
}

export function ratio(n, digits = 2) {
  return Number.isFinite(n) ? `${n.toFixed(digits)}x` : "-";
}

export function cap(n) {
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n >= 1000000000000) return `${(n / 1000000000000).toFixed(2)}T`;
  if (n >= 1000000000) return `${(n / 1000000000).toFixed(1)}B`;
  if (n >= 1000000) return `${(n / 1000000).toFixed(0)}M`;
  return n.toFixed(0);
}

export function money(n, currency = "") {
  return Number.isFinite(n) && n > 0 ? `${cap(n)}${currency ? ` ${currency}` : ""}` : "-";
}
