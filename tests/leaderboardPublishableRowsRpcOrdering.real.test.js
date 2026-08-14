// Test SQL real (no mockeado) de leaderboard_publishable_rows contra un
// Postgres local efímero, dedicado a este archivo (NO usa el inventario
// compartido de tests/integration/_ephemeralPostgresHarness.mjs — crea y
// destruye su propia base, con nombre único por proceso, para no requerir
// STATSEDGE_EPHEMERAL_POSTGRES ni tocar el inventario de 11 bases).
//
// Cubre la regresión de docs/scan-vivo-filas-incompletas-2026-08-14.md
// (Parte 6): la CTE `scoped` de la RPC cogía las p_max_rows filas más
// recientes de scan_results de CUALQUIER escaneo y SOLO DESPUÉS filtraba
// por si el escaneo padre era publicable. Un escaneo fallido con más filas
// que p_max_rows agotaba el LIMIT entero y la RPC devolvía 0 filas aunque
// hubiera escaneos publicables más antiguos dentro de la misma ventana.
//
// La migración 20260814150000_leaderboard_publishable_rows_filter_before_limit.sql
// corrige el orden: filtra primero por parent_status publicable, ordena y
// aplica el LIMIT después. Este test aplica esa migración (no la original)
// y reproduce exactamente el escenario que la rompía.
//
// Se salta automáticamente si no hay un Postgres local disponible
// (pg_isready) — mismo criterio best-effort que los demás *.real.test.*.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(process.cwd(), "supabase/migrations/20260814150000_leaderboard_publishable_rows_filter_before_limit.sql");
const DB_NAME = `statsedge_test_leaderboard_rpc_ordering_${process.pid}`;

function pgAvailable() {
  const result = spawnSync("pg_isready", [], { stdio: "ignore" });
  return result.status === 0;
}

function psql(args, input) {
  return execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", DB_NAME, "--quiet", "--tuples-only", "--no-align", ...args], {
    input,
    encoding: "utf8",
  });
}

const skip = !pgAvailable();
const describeIf = skip ? describe.skip : describe;

describeIf("RPC real (Postgres local efímero): leaderboard_publishable_rows filtra antes de ordenar", () => {
  beforeAll(() => {
    execFileSync("dropdb", ["--if-exists", DB_NAME]);
    execFileSync("createdb", [DB_NAME]);
    psql(["-c", `
      create extension if not exists pgcrypto;
      create table scans (
        id uuid primary key default gen_random_uuid(),
        owner_id text not null default 'personal',
        local_id text not null,
        name text not null,
        preset text,
        settings jsonb not null default '{}'::jsonb,
        market_score numeric,
        market_regime text,
        row_count integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
        unique (owner_id, local_id)
      );
      create table scan_results (
        id uuid primary key default gen_random_uuid(),
        owner_id text not null default 'personal',
        scan_id uuid not null references scans(id) on delete cascade,
        symbol text not null,
        company_name text,
        country text,
        sector text,
        industry text,
        theme text,
        rank_index integer,
        total_score numeric,
        weinstein_score numeric,
        minervini_score numeric,
        risk_score numeric,
        rs_rating numeric,
        metrics jsonb not null default '{}'::jsonb,
        raw jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
    `]);
    const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
    psql(["-f", "-"], migrationSql);
  }, 30_000);

  afterAll(() => {
    if (skip) return;
    execFileSync("dropdb", ["--if-exists", DB_NAME]);
  });

  it("un escaneo fallido con más filas que p_max_rows no impide leer escaneos publicables más antiguos", () => {
    psql(["-c", `
      insert into scans (id, owner_id, local_id, name, settings, created_at) values
        ('11111111-1111-1111-1111-111111111111', 'owner-ordering-test', 'scan-complete', 'Scan completo',
         '{"progress": {"status": "complete"}}'::jsonb, now() - interval '2 hours'),
        ('22222222-2222-2222-2222-222222222222', 'owner-ordering-test', 'scan-failed', 'Scan fallido',
         '{"progress": {"status": "error"}}'::jsonb, now() - interval '1 minute');

      insert into scan_results (owner_id, scan_id, symbol, rank_index, total_score, created_at)
      select 'owner-ordering-test', '11111111-1111-1111-1111-111111111111', 'PUB' || g, g, 90 - g, now() - interval '2 hours'
      from generate_series(1, 3) g;

      insert into scan_results (owner_id, scan_id, symbol, rank_index, total_score, created_at)
      select 'owner-ordering-test', '22222222-2222-2222-2222-222222222222', 'FAIL' || g, g, 50 - g,
             now() - interval '1 minute' + (g || ' seconds')::interval
      from generate_series(1, 10) g;
    `]);

    // p_max_rows=5 < las 10 filas del escaneo fallido (las más recientes):
    // con el orden de operaciones ANTIGUO, el LIMIT se agotaba entero en
    // filas descartadas y "rows" salía vacío.
    const raw = psql(["-t", "-A", "-c", "select public.leaderboard_publishable_rows('owner-ordering-test', 5, 45);"]);
    const payload = JSON.parse(raw.trim());

    expect(payload.rows).toHaveLength(3);
    expect(payload.rows.map((row) => row.symbol).sort()).toEqual(["PUB1", "PUB2", "PUB3"]);
    expect(payload.rows.every((row) => row.parent_status === "complete")).toBe(true);
    expect(payload.rowsPublished).toBe(3);
    expect(payload.rowsExcluded).toBe(10);
  });

  it("aplicar la migración dos veces es idempotente (misma salida, sin error)", () => {
    const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
    expect(() => psql(["-f", "-"], migrationSql)).not.toThrow();

    const raw = psql(["-t", "-A", "-c", "select public.leaderboard_publishable_rows('owner-ordering-test', 5, 45);"]);
    const payload = JSON.parse(raw.trim());
    expect(payload.rows).toHaveLength(3);
    expect(payload.rowsPublished).toBe(3);
    expect(payload.rowsExcluded).toBe(10);
  });
});
