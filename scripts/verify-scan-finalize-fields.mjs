// scripts/verify-scan-finalize-fields.mjs
// Verifica que la RPC scan_finalize_inputs desplegada incluye los 6 campos
// nuevos en el thin-raw projection. Crea un scan mínimo + 1 fila, invoca
// la RPC, comprueba que los campos aparecen, y limpia.
//
// Uso: node --env-file=.env.local scripts/verify-scan-finalize-fields.mjs

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER = process.env.STATSEDGE_OWNER_ID || "personal";

const headers = {
  "Content-Type": "application/json",
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Prefer: "return=representation",
};

const REQUIRED_FIELDS = [
  "riskScore", "growthScore", "demandScore",
  "epsGrowthProxyScore", "ipoScore", "rsRating",
];
const PREEXISTING_FIELDS = [
  "symbol", "country", "theme", "sector",
  "perf3m", "perf6m", "perf12m",
  "weinsteinScore", "minerviniScore",
];

const TEST_SCAN_ID = crypto.randomUUID();
const TEST_SCAN_ROW_ID = crypto.randomUUID();

async function rpc(name, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`RPC ${name} HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

async function rest(method, path, body = null) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
  if (!r.ok) throw new Error(`REST ${method} ${path} HTTP ${r.status}: ${await r.text()}`);
  if (r.status === 204) return null;
  return r.json();
}

console.log(`[verify] OWNER=${OWNER}`);
console.log(`[verify] TEST_SCAN_ID=${TEST_SCAN_ID}`);

try {
  // 1. Insertar scan mínimo.
  await rest("POST", "/scans", {
    owner_id: OWNER, id: TEST_SCAN_ID,
    local_id: `verify-${TEST_SCAN_ID}`,
    name: "verify-scan-finalize-fields",
    preset: "verify",
    settings: { verify: "scan-finalize-sector-fields" },
    row_count: 1,
    market_regime: "verify",
    market_score: null,
  });
  console.log("[verify] scans row insertado.");

  // 2. Insertar scan_results con todos los campos relevantes.
  const sampleRaw = {
    symbol: "VERIFY-1",
    perf3m: 12, perf6m: 24, perf12m: 35,
    rs3m: 5, rs6m: 8, rs12m: 12,
    distance52w: -8, maxDrawdown63d: 18,
    theme: "Semis / fotonica", sector: "Technology", country: "US",
    weinsteinScore: 85, minerviniScore: 82,
    momentumScore: 60, setupQualityScore: 70,
    adProxyScore: 65, riskRewardScore: 60,
    liquidityScore: 70, weaknessScore: 18,
    riskScore: 72, growthScore: 65,
    demandScore: 60, epsGrowthProxyScore: 62,
    ipoScore: 25, rsRating: 78,
  };
  await rest("POST", "/scan_results", {
    id: TEST_SCAN_ROW_ID,
    owner_id: OWNER, scan_id: TEST_SCAN_ID,
    symbol: "VERIFY-1", country: "US",
    sector: "Technology", theme: "Semis / fotonica",
    rank_index: 1,
    total_score: 70, weinstein_score: 85, minervini_score: 82,
    risk_score: 72, rs_rating: 78,
    metrics: { rsGlobalPct: 60, sectorScore: 50 },
    raw: sampleRaw,
  });
  console.log("[verify] scan_results fila insertada.");

  // 3. Invocar scan_finalize_inputs.
  const result = await rpc("scan_finalize_inputs", {
    p_owner_id: OWNER, p_scan_id: TEST_SCAN_ID, p_max_rows: 100,
  });
  const inputs = Array.isArray(result) ? result[0]?.inputs : result?.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error(`RPC no devolvió inputs: ${JSON.stringify(result)}`);
  }
  const raw = inputs[0]?.raw || {};
  console.log(`[verify] inputs=${inputs.length}, sample raw keys: ${Object.keys(raw).length}`);

  // 4. Comprobar campos.
  let allOk = true;
  for (const f of REQUIRED_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(raw, f);
    const value = raw[f];
    const status = present ? `OK (${value})` : "MISSING";
    console.log(`  [new] ${f.padEnd(20)} = ${status}`);
    if (!present) allOk = false;
  }
  for (const f of PREEXISTING_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(raw, f);
    if (!present) {
      console.log(`  [pre-existing] ${f.padEnd(20)} = MISSING (regression!)`);
      allOk = false;
    }
  }

  if (allOk) {
    console.log("\n[verify] PASS — los 6 campos nuevos están en el thin-raw projection.");
  } else {
    console.log("\n[verify] FAIL — faltan campos en el thin-raw projection.");
    process.exitCode = 1;
  }
} finally {
  // 5. Limpieza: borrar el scan de prueba (cascade borra scan_results).
  await rest("DELETE", `/scans?id=eq.${TEST_SCAN_ID}`);
  console.log("[verify] cleanup: scan de prueba borrado.");
}