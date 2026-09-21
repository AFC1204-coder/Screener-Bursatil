import { describe, expect, it } from "vitest";
import {
  auditMiniDatabaseConfig,
  formatPreflightLine,
  formatPreflightReport,
  nextStartCommand,
  redactDatabaseUrl,
} from "../scripts/ops/mini-preflight.mjs";

describe("ops mini preflight helpers", () => {
  it("redactDatabaseUrl oculta credenciales", () => {
    const redacted = redactDatabaseUrl(
      "postgresql://statsedge:super_secret@127.0.0.1:15432/statsedge",
    );
    expect(redacted).toBe("127.0.0.1:15432/statsedge");
    expect(redacted).not.toContain("super_secret");
  });

  it("auditMiniDatabaseConfig OK para túnel Mini", () => {
    const audit = auditMiniDatabaseConfig({
      dbMode: "pg",
      databaseUrl: "postgresql://statsedge:secret@127.0.0.1:15432/statsedge",
      tunnelPort: 15432,
    });
    expect(audit.ok).toBe(true);
    expect(audit.issues).toEqual([]);
    expect(audit.redacted).toBe("127.0.0.1:15432/statsedge");
  });

  it("auditMiniDatabaseConfig avisa modo y puerto incorrectos", () => {
    const audit = auditMiniDatabaseConfig({
      dbMode: "supabase",
      databaseUrl: "postgresql://u:p@127.0.0.1:5432/statsedge",
      tunnelPort: 15432,
    });
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((item) => /STATSEDGE_DB_MODE/.test(item))).toBe(true);
    expect(audit.issues.some((item) => /puerto 5432/.test(item))).toBe(true);
    expect(audit.hints.length).toBeGreaterThan(0);
  });

  it("nextStartCommand documenta arranque aislado", () => {
    expect(nextStartCommand(3300)).toContain("next start -p 3300");
    expect(nextStartCommand(3300)).toContain("/tmp/statsedge-3300.log");
  });

  it("formatPreflightReport en castellano para fallo y éxito", () => {
    const fail = formatPreflightReport({
      ok: false,
      checks: {},
      failures: [{
        stage: "tunnel",
        message: "Túnel cerrado",
        hint: "Arranca SSH",
        command: "ssh -f -N …",
      }],
    });
    expect(fail).toContain("FALLÓ");
    expect(fail).toContain("Túnel cerrado");

    const pass = formatPreflightReport({
      ok: true,
      checks: {
        tunnel: { port: 15432, started: false },
        env: { redacted: "127.0.0.1:15432/statsedge" },
        app: { httpStatus: 200 },
      },
      failures: [],
    });
    expect(pass).toContain("Preflight Mini OK");
    expect(pass).toContain("15432");
  });

  it("formatPreflightLine incluye hint y comando", () => {
    const line = formatPreflightLine({
      stage: "app",
      message: "Next caído",
      hint: "Levanta :3300",
      command: "next start -p 3300",
    });
    expect(line).toContain("Next caído");
    expect(line).toContain("Levanta :3300");
    expect(line).toContain("next start -p 3300");
  });
});
