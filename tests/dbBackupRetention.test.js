import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isoWeekStart, parseBackupName, selectBackups } from "../scripts/ops/db-backup-retention.mjs";

const name = (iso) => `statsedge-${iso.replace(/[-:T]/g, "").slice(0, 8)}-${iso.replace(/[-:T]/g, "").slice(8, 14)}.dump`;
// Un volcado cada día a las 03:30 desde el 1-ene hasta el 28-feb (59 días).
function daily(from, days) {
  const out = [];
  const start = Date.UTC(2027, 0, 1) + (from - 1) * 86400000;
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    out.push(name(`${d}T033000`));
  }
  return out;
}

describe("parseBackupName", () => {
  it("lee el patrón y rechaza lo que no lo cumple", () => {
    expect(parseBackupName("statsedge-20270105-033000.dump")).toMatchObject({ day: "2027-01-05", month: "2027-01" });
    expect(parseBackupName("statsedge-20270105-033000.dump.sha256")).toBeNull();
    expect(parseBackupName("statsedge-20271305-033000.dump")).toBeNull(); // mes 13
    expect(parseBackupName("otra-cosa.dump")).toBeNull();
    expect(parseBackupName(undefined)).toBeNull();
  });

  it("isoWeekStart devuelve el lunes de la semana", () => {
    expect(isoWeekStart(Date.UTC(2027, 0, 6))).toBe("2027-01-04"); // miércoles
    expect(isoWeekStart(Date.UTC(2027, 0, 10))).toBe("2027-01-04"); // domingo
    expect(isoWeekStart(Date.UTC(2027, 0, 4))).toBe("2027-01-04"); // lunes
  });
});

describe("selectBackups", () => {
  it("con pocos volcados no borra nada", () => {
    const names = daily(1, 5);
    const r = selectBackups(names);
    expect(r.remove).toEqual([]);
    expect(r.keep).toHaveLength(5);
  });

  it("conserva 7 diarios, 4 semanales y 3 mensuales sobre 59 días", () => {
    const names = daily(1, 59); // 1-ene … 28-feb
    const r = selectBackups(names);
    expect(r.keep.length).toBeLessThanOrEqual(7 + 4 + 3);
    expect(r.keep.length).toBeGreaterThanOrEqual(7 + 4); // hay al menos 4 semanas y 1 mes más
    // los 7 más recientes están todos
    for (const n of names.slice(-7)) expect(r.keep).toContain(n);
    // el último nunca se borra
    expect(r.keep).toContain(names.at(-1));
    // lo borrado y lo conservado suman todo y no se solapan
    expect(r.keep.length + r.remove.length).toBe(59);
    expect(r.remove.filter((n) => r.keep.includes(n))).toEqual([]);
  });

  it("varios volcados el mismo día: solo cuenta el más reciente de ese día", () => {
    const names = [name("2027-02-01T030000"), name("2027-02-01T150000"), name("2027-01-31T030000")];
    const r = selectBackups(names, { daily: 1, weekly: 0, monthly: 0 });
    expect(r.keep).toEqual([name("2027-02-01T150000")]);
    expect(r.remove).toContain(name("2027-02-01T030000"));
  });

  it("el volcado más reciente nunca se borra, ni con política a cero", () => {
    const names = daily(1, 10);
    const r = selectBackups(names, { daily: 0, weekly: 0, monthly: 0 });
    expect(r.keep).toEqual([names.at(-1)]);
  });

  it("los archivos con otro nombre no se tocan y se cuentan como ignorados", () => {
    const r = selectBackups([...daily(1, 3), "notas.txt", "statsedge-20270101-033000.dump.sha256"]);
    expect(r.ignored.sort()).toEqual(["notas.txt", "statsedge-20270101-033000.dump.sha256"]);
    expect(r.remove).toEqual([]);
  });

  it("lista vacía: no falla", () => {
    expect(selectBackups([])).toEqual({ keep: [], remove: [], ignored: [] });
  });
});

describe("db-backup-retention CLI", () => {
  it("dry-run no borra; --apply borra el volcado y su .sha256 y deja lo demás", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "retention-"));
    const names = daily(1, 20);
    for (const n of names) { writeFileSync(path.join(dir, n), "x"); writeFileSync(path.join(dir, `${n}.sha256`), "h"); }
    writeFileSync(path.join(dir, "LEEME.txt"), "no tocar");
    const script = path.resolve("scripts/ops/db-backup-retention.mjs");
    const dry = spawnSync("node", [script, "--dir", dir, "--daily", "3", "--weekly", "1", "--monthly", "0"], { encoding: "utf8" });
    expect(dry.status).toBe(0);
    const dryOut = JSON.parse(dry.stdout);
    expect(dryOut.apply).toBe(false);
    expect(readdirSync(dir)).toHaveLength(41); // nada borrado
    const real = spawnSync("node", [script, "--dir", dir, "--daily", "3", "--weekly", "1", "--monthly", "0", "--apply"], { encoding: "utf8" });
    const out = JSON.parse(real.stdout);
    expect(out.removed.length).toBe(out.remove.length);
    const left = readdirSync(dir);
    expect(left).toContain("LEEME.txt");
    for (const k of out.keep) { expect(left).toContain(k); expect(left).toContain(`${k}.sha256`); }
    for (const r of out.remove) { expect(left).not.toContain(r); expect(left).not.toContain(`${r}.sha256`); }
  });

  it("--stdin lee nombres, no borra nada y dice cuáles sobran (incluye ignorar nombres ajenos)", () => {
    const script = path.resolve("scripts/ops/db-backup-retention.mjs");
    const input = [...daily(1, 12), "notas.txt"].join("\n");
    const r = spawnSync("node", [script, "--stdin", "--daily", "3", "--weekly", "0", "--monthly", "0"], { input, encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.stdin).toBe(true);
    expect(out.keep).toHaveLength(3);
    expect(out.remove).toHaveLength(9);
    expect(out.ignored).toBe(1);
    expect(spawnSync("node", [script, "--stdin", "--apply"], { input: "", encoding: "utf8" }).status).toBe(2);
  });

  it("sin --dir o con opción desconocida sale con código 2", () => {
    const script = path.resolve("scripts/ops/db-backup-retention.mjs");
    expect(spawnSync("node", [script], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("node", [script, "--dir", ".", "--zzz"], { encoding: "utf8" }).status).toBe(2);
  });
});
