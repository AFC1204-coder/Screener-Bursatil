import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/ops/backup-db.sh");

function exe(dir, name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function run({ dump = 'head -c 4000 /dev/zero > "$1"', verify = "exit 0", upload = null, env = {}, setup = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "backup-"));
  const dest = path.join(root, "dest");
  mkdirSync(dest);
  if (setup) setup(dest);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const full = {
    ...process.env,
    STATSEDGE_BACKUP_ROOT: root,
    STATSEDGE_BACKUP_DIR: dest,
    STATSEDGE_BACKUP_MIN_BYTES: "1000",
    STATSEDGE_BACKUP_MIN_FREE_GB: "0",
    STATSEDGE_BACKUP_DUMP_CMD: exe(bin, "dump.sh", dump),
    STATSEDGE_BACKUP_VERIFY_CMD: exe(bin, "verify.sh", verify),
    NOTIFY_LOG: path.join(root, "notify.log"),
    ...env,
  };
  delete full.NOTIFY_URL;
  if (upload) full.STATSEDGE_BACKUP_UPLOAD_CMD = exe(bin, "upload.sh", upload);
  const r = spawnSync("bash", [SCRIPT], { env: full, encoding: "utf8" });
  const statusFile = path.join(root, "logs", "db-backup-status.json");
  const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, "utf8")) : null;
  const notifyFile = path.join(root, "notify.log");
  return {
    code: r.status,
    status,
    dest,
    files: readdirSync(dest).sort(),
    notify: existsSync(notifyFile) ? readFileSync(notifyFile, "utf8") : "",
    log: existsSync(path.join(root, "logs", "db-backup.log")) ? readFileSync(path.join(root, "logs", "db-backup.log"), "utf8") : "",
  };
}

const dumps = (files) => files.filter((f) => /^statsedge-\d{8}-\d{6}\.dump$/.test(f));

describe("backup-db.sh", () => {
  it("camino feliz: volcado verificado, suma de control, estado ok y sin avisos", () => {
    const out = run();
    expect(out.code).toBe(0);
    expect(out.status.result).toBe("ok");
    expect(out.status.bytes).toBe(4000);
    expect(out.status.uploadExit).toBe("skipped");
    expect(dumps(out.files)).toHaveLength(1);
    expect(out.files.some((f) => f.endsWith(".sha256"))).toBe(true);
    expect(out.files.some((f) => f.endsWith(".partial"))).toBe(false);
    expect(out.notify).toBe("");
  });

  it("si pg_dump falla: fail, sin archivo definitivo ni parcial, con aviso de error", () => {
    const out = run({ dump: 'head -c 5000 /dev/zero > "$1"; exit 7' });
    expect(out.code).toBe(1);
    expect(out.status.result).toBe("fail");
    expect(out.status.reason).toMatch(/exit=7/);
    expect(dumps(out.files)).toHaveLength(0);
    expect(out.files.some((f) => f.endsWith(".partial"))).toBe(false);
    expect(out.notify).toMatch(/\[error\].*Backup de la base falló/);
  });

  it("un volcado demasiado pequeño se rechaza", () => {
    const out = run({ dump: 'head -c 10 /dev/zero > "$1"' });
    expect(out.code).toBe(1);
    expect(out.status.reason).toMatch(/pesa 10 bytes/);
    expect(dumps(out.files)).toHaveLength(0);
  });

  it("un volcado que no se puede leer no queda con nombre definitivo", () => {
    const out = run({ verify: "exit 1" });
    expect(out.code).toBe(1);
    expect(out.status.reason).toMatch(/no se puede leer/);
    expect(dumps(out.files)).toHaveLength(0);
    expect(out.files.some((f) => f.endsWith(".partial"))).toBe(false);
  });

  it("si la subida falla: degraded, la copia local se conserva y se avisa (warn)", () => {
    const out = run({ upload: "exit 5" });
    expect(out.code).toBe(0);
    expect(out.status.result).toBe("degraded");
    expect(out.status.uploadExit).toBe("5");
    expect(dumps(out.files)).toHaveLength(1);
    expect(out.notify).toMatch(/\[warn\].*aviso/);
  });

  it("subida correcta: recibe la ruta del volcado y queda uploadExit 0", () => {
    const out = run({ upload: 'echo "$1" >> "$(dirname "$1")/subidos.txt"; exit 0' });
    expect(out.status.result).toBe("ok");
    expect(out.status.uploadExit).toBe("0");
    const sent = readFileSync(path.join(out.dest, "subidos.txt"), "utf8");
    expect(sent).toMatch(/statsedge-\d{8}-\d{6}\.dump/);
  });

  it("si hay otra copia en marcha (bloqueo reciente) no hace nada y sale con 3", () => {
    const out = run({ setup: (dest) => mkdirSync(path.join(dest, ".lock")) });
    expect(out.code).toBe(3);
    expect(dumps(out.files)).toHaveLength(0);
  });

  it("con poco espacio libre falla antes de volcar", () => {
    const out = run({ env: { STATSEDGE_BACKUP_MIN_FREE_GB: "99999999" } });
    expect(out.code).toBe(1);
    expect(out.status.reason).toMatch(/poco espacio/);
    expect(dumps(out.files)).toHaveLength(0);
  });

  it("aplica la retención: borra los antiguos fuera de política y conserva el nuevo", () => {
    const out = run({
      env: { STATSEDGE_BACKUP_RETENTION_ARGS: "--daily 3 --weekly 0 --monthly 0" },
      setup: (dest) => {
        for (let d = 1; d <= 12; d += 1) {
          const day = String(d).padStart(2, "0");
          writeFileSync(path.join(dest, `statsedge-202601${day}-033000.dump`), "x");
          writeFileSync(path.join(dest, `statsedge-202601${day}-033000.dump.sha256`), "h");
        }
        writeFileSync(path.join(dest, "LEEME.txt"), "no tocar");
      },
    });
    expect(out.code).toBe(0);
    expect(out.files).toContain("LEEME.txt");
    expect(dumps(out.files)).toHaveLength(3); // el nuevo + los 2 diarios más recientes de enero
    expect(out.files).toContain("statsedge-20260112-033000.dump");
    expect(out.files).not.toContain("statsedge-20260101-033000.dump");
    expect(out.files).not.toContain("statsedge-20260101-033000.dump.sha256");
    expect(out.status.removed).toBeGreaterThan(0);
  });
});
