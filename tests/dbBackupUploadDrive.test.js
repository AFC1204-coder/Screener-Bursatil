import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/ops/backup-upload-drive.sh");

// rclone de mentira: «Drive» es una carpeta local (STUB_DIR).
const STUB = `#!/bin/bash
D="$STUB_DIR"
cmd="$1"; shift
case "$cmd" in
  listremotes) printf '%s\\n' $STUB_REMOTES ;;
  copyto) [ -n "\${STUB_FAIL_COPY:-}" ] && exit 1; cp "$1" "$D/\${2#*:}" ;;
  lsl) f="$D/\${1#*:}"; [ -f "$f" ] || exit 1; sz=$(stat -f %z "$f"); [ -n "\${STUB_SIZE_LIE:-}" ] && sz=1; echo "$sz 2026-01-01 00:00:00.000000000 \${1#*:}" ;;
  lsf) [ -n "\${STUB_FAIL_LSF:-}" ] && exit 1; ls "$D" ;;
  deletefile) rm -f "$D/\${1#*:}" ;;
  *) exit 9 ;;
esac
`;

function setup({ remotes = "gdrive-crypt:", existing = [], env = {}, size = 4000 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "upload-"));
  const drive = path.join(root, "drive");
  mkdirSync(drive);
  for (const n of existing) writeFileSync(path.join(drive, n), "x");
  const stub = path.join(root, "rclone");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const file = path.join(root, "statsedge-20270301-033000.dump");
  writeFileSync(file, Buffer.alloc(size, 1));
  const r = spawnSync("bash", [SCRIPT, file], {
    env: { ...process.env, STATSEDGE_RCLONE: stub, STUB_DIR: drive, STUB_REMOTES: remotes, ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr, drive: readdirSync(drive).sort(), root };
}

const old = (from, to) => {
  const names = [];
  for (let d = from; d <= to; d += 1) names.push(`statsedge-202602${String(d).padStart(2, "0")}-033000.dump`);
  return names;
};

describe("backup-upload-drive.sh", () => {
  it("sube, verifica el tamaño y deja el archivo en Drive", () => {
    const o = setup();
    expect(o.code).toBe(0);
    expect(o.drive).toContain("statsedge-20270301-033000.dump");
    expect(o.out).toMatch(/subida verificada \(4000 bytes\)/);
  });

  it("si no existe el remoto cifrado NO sube nada y sale con 2", () => {
    const o = setup({ remotes: "gdrive-statsedge:" });
    expect(o.code).toBe(2);
    expect(o.drive).toEqual([]);
    expect(o.err).toMatch(/no subo nada en claro/);
  });

  it("si la subida falla sale con 3 y no poda", () => {
    const o = setup({ existing: old(1, 20), env: { STUB_FAIL_COPY: "1" } });
    expect(o.code).toBe(3);
    expect(o.drive).toHaveLength(20);
  });

  it("si el tamaño en Drive no coincide sale con 4 y NO borra nada", () => {
    const o = setup({ existing: old(1, 20), env: { STUB_SIZE_LIE: "1" } });
    expect(o.code).toBe(4);
    expect(o.drive).toHaveLength(21);
  });

  it("poda las copias antiguas de Drive con la política y conserva la nueva", () => {
    const o = setup({ existing: old(1, 20), env: { STATSEDGE_DRIVE_RETENTION_ARGS: "--daily 3 --weekly 0 --monthly 0" } });
    expect(o.code).toBe(0);
    expect(o.drive).toHaveLength(3);
    expect(o.drive).toContain("statsedge-20270301-033000.dump");
    expect(o.drive).toContain("statsedge-20260220-033000.dump");
    expect(o.drive).not.toContain("statsedge-20260201-033000.dump");
    expect(o.out).toMatch(/poda de Drive: 18 borrados/);
  });

  it("si no puede listar Drive no poda y sale con 0 (la subida ya estaba bien)", () => {
    const o = setup({ existing: old(1, 20), env: { STUB_FAIL_LSF: "1" } });
    expect(o.code).toBe(0);
    expect(o.drive).toHaveLength(21);
    expect(o.err).toMatch(/no pude listar Drive: no podo/);
  });

  it("sin argumento o con un archivo inexistente sale con 2", () => {
    const r1 = spawnSync("bash", [SCRIPT], { encoding: "utf8" });
    const r2 = spawnSync("bash", [SCRIPT, "/no/existe.dump"], { encoding: "utf8" });
    expect(r1.status).toBe(2);
    expect(r2.status).toBe(2);
  });
});

describe("helpers de la prueba", () => {
  it("el rclone falso copia de verdad", () => {
    const o = setup();
    const p = path.join(o.root, "drive", "statsedge-20270301-033000.dump");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBe(4000);
    copyFileSync(p, path.join(o.root, "copia"));
  });
});
