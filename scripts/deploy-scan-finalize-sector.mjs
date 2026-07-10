// scripts/deploy-scan-finalize-sector.mjs
// Despliega la migración 20260710184308_scan_finalize_sector_composite_inputs.sql
// contra el Supabase del proyecto (ref: dzovggfbcoymjgikkbno, leída de
// supabase/.temp/config.json). Necesita SUPABASE_ACCESS_TOKEN en .env.local
// con permisos de database write.
//
// Uso: node --env-file=.env.local scripts/deploy-scan-finalize-sector.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const MIGRATION_PATH = resolve(ROOT, "supabase/migrations/20260710184308_scan_finalize_sector_composite_inputs.sql");
const LINKED_PROJECT_PATH = resolve(ROOT, "supabase/.temp/linked-project.json");
const PROJECT_REF = JSON.parse(readFileSync(LINKED_PROJECT_PATH, "utf8")).ref;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;

if (!ACCESS_TOKEN) {
  console.error("Falta SUPABASE_ACCESS_TOKEN en .env.local. Crea uno en Supabase Account > Access Tokens.");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("Falta SUPABASE_URL en .env.local.");
  process.exit(1);
}

const sql = readFileSync(MIGRATION_PATH, "utf8");
console.log(`[deploy] Proyecto=${PROJECT_REF}`);
console.log(`[deploy] Migración: ${MIGRATION_PATH.split("/").pop()} (${sql.length} bytes)`);

// Intentar /database/query primero (idempotente para create or replace).
let res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
  body: JSON.stringify({ query: sql }),
});

if (!res.ok && [403, 404, 405].includes(res.status)) {
  console.log(`[deploy] /database/query no disponible (HTTP ${res.status}), probando /database/migrations...`);
  res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/migrations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ name: "20260710184308_scan_finalize_sector_composite_inputs", query: sql }),
  });
}

if (!res.ok) {
  const errText = await res.text().catch(() => "");
  console.error(`[deploy] ERROR HTTP ${res.status}: ${errText.slice(0, 500)}`);
  process.exit(1);
}

console.log(`[deploy] OK HTTP ${res.status}`);
const body = await res.text().catch(() => "");
if (body) console.log(`[deploy] body: ${body.slice(0, 300)}`);

// Verificación post-deploy: invocar la RPC con el sentinel y mostrar
// que devuelve los 6 campos nuevos en uno de los inputs.
console.log("\n[verify] Probando RPC con un scan_id sentinel (debe devolver inputs=[]):");
const probe = await fetch(`${SUPABASE_URL}/rest/v1/rpc/scan_finalize_inputs`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
  body: JSON.stringify({
    p_owner_id: process.env.STATSEDGE_OWNER_ID || "personal",
    p_scan_id: "00000000-0000-0000-0000-000000000000",
    p_max_rows: 1,
  }),
});
if (!probe.ok) {
  console.error(`[verify] HTTP ${probe.status}: ${await probe.text().catch(() => "")}`);
  process.exit(1);
}
const data = await probe.json();
console.log(`[verify] RPC OK. inputs=${data?.inputs?.length ?? 0}, rowsRead=${data?.rowsRead ?? "?"}`);