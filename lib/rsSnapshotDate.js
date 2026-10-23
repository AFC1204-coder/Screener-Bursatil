// lib/rsSnapshotDate.js — fecha del snapshot semanal de los motores de RS.
//
// POR QUÉ EXISTE
//
// rs_weekly_snapshots tiene UNIQUE (owner_id, snapshot_date, engine_version,
// base_currency) y el week_key se DERIVA de la fecha (semana ISO). Dos fechas
// de la misma semana ISO producen el mismo week_key, así que un snapshot
// fechado en domingo hace la corrida semanal idempotente: repetirla el martes
// actualiza la fila del domingo en vez de abrir una segunda fila de la misma
// semana.
//
// Las corridas programadas ya caen en domingo (GitHub Actions: 06:00, 07:00 y
// 07:30 UTC), así que este default reproduce EXACTAMENTE el comportamiento
// anterior (snapshot_date = día de la corrida = domingo). Lo único que cambia
// es la corrida manual en otro día: entonces se fecha en el domingo anterior.
//
// --snapshot-date=YYYY-MM-DD manda sobre todo esto cuando se necesita una
// fecha concreta (p. ej. fechar el snapshot en el domingo 2026-10-18).

/** ¿Es `value` una fecha YYYY-MM-DD real (rechaza 2026-02-31)? */
export function isValidSnapshotDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === text;
}

/**
 * Domingo anterior a `today` (o `today` mismo si `today` ya es domingo).
 * `today` es un 'YYYY-MM-DD'; el cálculo es en UTC para que el día de la
 * semana no dependa de la zona horaria del servidor.
 */
export function defaultSnapshotDate(today = "") {
  const text = String(today || "").trim();
  if (!isValidSnapshotDate(text)) return "";
  const date = new Date(`${text}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay(); // 0 = domingo
  date.setUTCDate(date.getUTCDate() - (dayOfWeek === 0 ? 0 : dayOfWeek));
  return date.toISOString().slice(0, 10);
}
