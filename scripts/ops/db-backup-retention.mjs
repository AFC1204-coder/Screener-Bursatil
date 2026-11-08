#!/usr/bin/env node
/**
 * Retención de los volcados de la base (statsedge-YYYYMMDD-HHMMSS.dump).
 *
 * Política por defecto: se conservan los N últimos DÍAS distintos (el volcado
 * más reciente de cada día), más el último de cada una de las W semanas ISO
 * siguientes y el último de cada uno de los M meses siguientes. Lo demás se
 * borra. El volcado más reciente NUNCA se borra, y solo se tocan archivos con
 * ese patrón de nombre (nada más en la carpeta).
 *
 * Uso:
 *   node scripts/ops/db-backup-retention.mjs --dir RUTA [--daily 7] [--weekly 4] [--monthly 3] [--apply]
 *   ... | node scripts/ops/db-backup-retention.mjs --stdin [--daily ...]   (nombres por stdin)
 * Sin --apply solo muestra qué haría (dry-run). Con --stdin NUNCA borra nada: lee una lista
 * de nombres (p. ej. `rclone lsf remoto:`) y dice cuáles sobran. Salida JSON en una línea.
 * Salida: 0 bien · 2 error de uso.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BACKUP_NAME = /^statsedge-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;
export const RETENTION_DEFAULTS = { daily: 7, weekly: 4, monthly: 3 };

export function parseBackupName(name) {
  const m = BACKUP_NAME.exec(String(name || ""));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const at = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(at) || new Date(at).getUTCMonth() !== mo - 1) return null;
  return { name, at, day: `${m[1]}-${m[2]}-${m[3]}`, month: `${m[1]}-${m[2]}` };
}

/** Lunes ISO de la semana de una fecha UTC, como «YYYY-MM-DD». */
export function isoWeekStart(at) {
  const date = new Date(at);
  const dow = (date.getUTCDay() + 6) % 7; // lunes = 0
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dow);
  return new Date(monday).toISOString().slice(0, 10);
}

/**
 * names: nombres de archivo. Devuelve { keep, remove, ignored } (ignored = nombres
 * que no siguen el patrón: no se tocan nunca).
 */
export function selectBackups(names, options = {}) {
  const { daily, weekly, monthly } = { ...RETENTION_DEFAULTS, ...options };
  const parsed = [];
  const ignored = [];
  for (const name of names) {
    const info = parseBackupName(name);
    if (info) parsed.push(info);
    else ignored.push(name);
  }
  parsed.sort((a, b) => b.at - a.at); // más reciente primero
  const keep = new Set();
  if (parsed.length) keep.add(parsed[0].name); // el último nunca se borra

  // Diarios: el más reciente de cada uno de los N últimos días distintos.
  const dayLeader = new Map();
  for (const info of parsed) if (!dayLeader.has(info.day)) dayLeader.set(info.day, info);
  const days = [...dayLeader.values()];
  days.slice(0, Math.max(0, daily)).forEach((info) => keep.add(info.name));

  // Semanales: del resto de días, el más reciente de cada semana (W semanas).
  const afterDaily = days.slice(Math.max(0, daily));
  const weekLeader = new Map();
  for (const info of afterDaily) {
    const week = isoWeekStart(info.at);
    if (!weekLeader.has(week)) weekLeader.set(week, info);
  }
  [...weekLeader.values()].slice(0, Math.max(0, weekly)).forEach((info) => keep.add(info.name));

  // Mensuales: del resto, el más reciente de cada mes (M meses).
  const afterWeekly = afterDaily.filter((info) => ![...weekLeader.values()].slice(0, Math.max(0, weekly)).includes(info));
  const monthLeader = new Map();
  for (const info of afterWeekly) if (!monthLeader.has(info.month)) monthLeader.set(info.month, info);
  [...monthLeader.values()].slice(0, Math.max(0, monthly)).forEach((info) => keep.add(info.name));

  return {
    keep: parsed.filter((info) => keep.has(info.name)).map((info) => info.name),
    remove: parsed.filter((info) => !keep.has(info.name)).map((info) => info.name),
    ignored,
  };
}

function parseArgs(argv) {
  const args = { ...RETENTION_DEFAULTS, dir: "", apply: false, stdin: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") args.dir = String(argv[++i] || "");
    else if (a === "--apply") args.apply = true;
    else if (a === "--stdin") args.stdin = true;
    else if (a === "--daily") args.daily = Number(argv[++i]);
    else if (a === "--weekly") args.weekly = Number(argv[++i]);
    else if (a === "--monthly") args.monthly = Number(argv[++i]);
    else throw new Error(`Opción desconocida: ${a}`);
  }
  if (!args.dir && !args.stdin) throw new Error("Falta --dir (o --stdin)");
  if (args.stdin && args.apply) throw new Error("--stdin no se puede combinar con --apply");
  for (const key of ["daily", "weekly", "monthly"]) {
    if (!Number.isInteger(args[key]) || args[key] < 0) throw new Error(`--${key} inválido`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.stdin) {
    const names = fs.readFileSync(0, "utf8").split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
    const { keep, remove, ignored } = selectBackups(names, args);
    console.log(JSON.stringify({ stdin: true, keep, remove, ignored: ignored.length }));
    return 0;
  }
  const dir = path.resolve(args.dir);
  const names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile());
  const { keep, remove, ignored } = selectBackups(names, args);
  const removed = [];
  if (args.apply) {
    for (const name of remove) {
      // Archivo del volcado y su suma de control, nada más.
      for (const file of [name, `${name}.sha256`]) {
        const target = path.join(dir, file);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      removed.push(name);
    }
  }
  console.log(JSON.stringify({ dir, apply: args.apply, keep, remove, removed, ignored: ignored.length }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`db-backup-retention: ${error.message}`);
    process.exit(2);
  }
}
