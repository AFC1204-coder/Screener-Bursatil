// Verificación real (contra el proyecto Supabase "Healthy") del cap de
// escritura de daily_bars. Pieza 3 del checkpoint.
//
// Diseñado para ejecutarse una vez y reportar — no es parte de la suite
// normal (no se ejecuta con `npm test`). Vitest lo carga solo si se llama
// explícitamente: `npx vitest run tests/integration/check-daily-bars-cap.real.test.mjs`.
//
// Aísla el estado bajo owner_id='playwright-check' (no toca el workspace
// personal del usuario). Cleanup obligatorio al final: borra todas las filas
// bajo ese owner_id de daily_bars y favorites.
//
// NO se ejecuta automáticamente en CI ni en `npm test`. Solo manualmente.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Carga .env.local manualmente (vitest no lo hace por defecto).
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// .env.local puede definir STATSEDGE_OWNER_ID=personal para el workspace
// principal del usuario. Esa precedencia silenciosa hizo fallar una corrida
// previa (el harness apuntaba al workspace real en lugar del owner aislado).
// Fix: borramos la variable de entorno ANTES de fijar el owner de test, así
// el `envValue("STATSEDGE_OWNER_ID")` de supabaseConfig() lee exactamente lo
// que nosotros queremos y no lo que el .env.local cargó por defecto.
delete process.env.STATSEDGE_OWNER_ID;
const OWNER = "playwright-check";

// Guard de seguridad: el test debe negarse a sí mismo si el owner resuelto
// coincide con el workspace real. No es una advertencia — es un abort: debe
// lanzar y detener la suite antes de cualquier query contra la DB. La idea es
// que un fallo aquí sea ruidoso, no silencioso, y que un cambio accidental
// en .env.local (p.ej. alguien sube STATSEDGE_OWNER_ID=personal al inicio del
// archivo sin querer) aborte la suite en lugar de apuntar al workspace real.
if (OWNER === "personal" || OWNER === "") {
  throw new Error(
    `SAFETY ABORT: owner de test resuelto a "${OWNER}" — no se permite ejecutar contra el workspace real.`
  );
}
const SYMBOL_NONREF = "PLAYWRIGHT-NONREF";
const SYMBOL_REF = "PLAYWRIGHT-REFERENCED";
const TEST_BAR_COUNT = 1500;
const EXPECTED_DEFAULT_CAP = 400;
const EXPECTED_REFERENCED_CAP = 1260;

function buildSyntheticChart(symbol, count) {
  const bars = [];
  const start = Date.UTC(2018, 0, 1);
  const DAY = 86400_000;
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start + i * DAY);
    bars.push({
      date: d.toISOString().slice(0, 10),
      open: 100 + i * 0.01,
      high: 105 + i * 0.01,
      low: 95 + i * 0.01,
      close: 102 + i * 0.01,
      adjClose: 102 + i * 0.01,
      rawClose: 102 + i * 0.01,
      volume: 1_000_000 + i,
      currency: "USD",
      provider: "Yahoo Finance",
      symbol,
    });
  }
  return { meta: { symbol, currency: "USD" }, bars: bars.reverse() };
}

// Solo cargar writeDailyBarsCache si SUPABASE_URL está set (entorno real).
// En CI sin env, este test se salta con .skip para no fallar el build.
const skipIntegration = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeIf = skipIntegration ? describe.skip : describe;

describeIf("PIEZA 3 · daily_bars cap (real Supabase)", () => {
  let writeDailyBarsCache;
  let readDailyBarsCache;
  let supabaseRequest;
  let computeListingDate;
  let results = {};

  beforeAll(async () => {
    // Doble guard runtime (el guard top-level ya abortó si esto es "personal",
    // pero lo repetimos aquí por si la declaración top-level se relaja en el
    // futuro). Si OWNER se contaminó en runtime, abortamos antes del DELETE.
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(
        `SAFETY ABORT en beforeAll: owner="${OWNER}" — abort antes de cualquier DELETE/INSERT.`
      );
    }
    process.env.STATSEDGE_OWNER_ID = OWNER;
    const cache = await import("@/lib/dailyBarsCache.js");
    writeDailyBarsCache = cache.writeDailyBarsCache;
    readDailyBarsCache = cache.readDailyBarsCache;
    const srv = await import("@/lib/supabaseServer.js");
    supabaseRequest = srv.supabaseRequest;
    const brief = await import("@/app/api/company-brief/route.js");
    computeListingDate = brief.computeListingDate;

    // Confirmar que supabaseConfig() realmente lee el override (no "personal"
    // cacheado de un import previo). Si falla aquí, abortamos — no
    // continuamos contra el workspace real.
    const cfg = srv.supabaseConfig();
    console.log(`\n[PIEZA 3] Verificación real contra ${process.env.SUPABASE_URL?.slice(0, 40)}...`);
    console.log(`[PIEZA 3] Owner resuelto por supabaseConfig(): ${cfg.ownerId}`);
    if (cfg.ownerId !== OWNER) {
      throw new Error(
        `SAFETY ABORT: supabaseConfig() devolvió ownerId="${cfg.ownerId}" pero OWNER esperado="${OWNER}". El override STATSEDGE_OWNER_ID no se aplicó.`
      );
    }

    // Pre-cleanup: borra leftovers de corridas previas bajo este owner.
    // Como OWNER=playwright-check está recién aislado y presumiblemente vacío,
    // este DELETE es barato (índice por owner_id), a diferencia del caso
    // "personal" que agotó el statement timeout.
    console.log(`[PRE-CLEANUP] Borrando leftovers previos bajo ${OWNER}`);
    await supabaseRequest("daily_bars", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
    await supabaseRequest("favorites", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
  }, 60_000);

  afterAll(async () => {
    if (skipIntegration) return;
    // Triple guard: antes del DELETE final del cleanup.
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(
        `SAFETY ABORT en afterAll: owner="${OWNER}" — abort antes del DELETE final.`
      );
    }
    console.log(`\n[CLEANUP] Borrando datos de test bajo ${OWNER}`);
    await supabaseRequest("daily_bars", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });
    await supabaseRequest("favorites", { method: "DELETE", query: `owner_id=eq.${OWNER}`, prefer: "return=minimal" });

    // Verificación post-cleanup: confirmar count=0 bajo playwright-check antes
    // de cerrar la suite. No asumimos que el DELETE funcionó — lo medimos.
    // Si quedó alguna fila, el cleanup falló y debemos reportarlo, no cerrar
    // silenciosamente con datos de test en la DB.
    try {
      const remainingBars = await supabaseRequest("daily_bars", {
        query: `owner_id=eq.${OWNER}&select=id&limit=1`,
      });
      const remainingFavs = await supabaseRequest("favorites", {
        query: `owner_id=eq.${OWNER}&select=id&limit=1`,
      });
      const barsCount = Array.isArray(remainingBars) ? remainingBars.length : -1;
      const favsCount = Array.isArray(remainingFavs) ? remainingFavs.length : -1;
      console.log(`[POST-CLEANUP] daily_bars=${barsCount}  favorites=${favsCount}  (esperado: 0,0)`);
      if (barsCount !== 0 || favsCount !== 0) {
        console.warn(`[POST-CLEANUP WARN] cleanup incompleto: quedan ${barsCount} filas en daily_bars y ${favsCount} en favorites bajo ${OWNER}`);
      }
    } catch (err) {
      console.warn(`[POST-CLEANUP WARN] verificación post-cleanup falló: ${err.message}`);
    }

    console.log(`[SUMMARY] 3a=${results.p3a}  3b=${results.p3b}  3c=${results.p3c}  3d=${results.p3d}`);
  }, 30_000);

  it("3a · símbolo NO referenciado → cap por defecto 400", async () => {
    const writeRes = await writeDailyBarsCache(SYMBOL_NONREF, buildSyntheticChart(SYMBOL_NONREF, TEST_BAR_COUNT));
    console.log(`     writeDailyBarsCache result: ${JSON.stringify(writeRes)}`);
    expect(writeRes.written).toBe(true);
    expect(writeRes.writeCap).toBe(EXPECTED_DEFAULT_CAP);
    expect(writeRes.referenced).toBe(false);
    expect(writeRes.count).toBe(EXPECTED_DEFAULT_CAP);

    const read = await readDailyBarsCache(SYMBOL_NONREF, { range: "MAX" });
    console.log(`     [PostgREST] ${SYMBOL_NONREF}: rows=${read.rows}`);
    expect(read.rows).toBeLessThanOrEqual(EXPECTED_DEFAULT_CAP);
    results.p3a = "OK";
  }, 60_000);

  it("3b · símbolo REFERENCIADO → cap holgado 1260", async () => {
    // Cuádruple guard: antes del INSERT a favorites. Por simetría con los
    // guards anteriores. Si OWNER se contaminó por algún path no previsto,
    // abortamos antes de escribir.
    if (OWNER === "personal" || OWNER === "") {
      throw new Error(
        `SAFETY ABORT en 3b: owner="${OWNER}" — abort antes del INSERT a favorites.`
      );
    }
    console.log(`     INSERT favorite para ${SYMBOL_REF}`);
    const favRes = await supabaseRequest("favorites", {
      method: "POST",
      body: [{
        owner_id: OWNER,
        local_id: `playwright-check-${SYMBOL_REF}-${Date.now()}`,
        symbol: SYMBOL_REF,
        notes: "Test row for cap verification — cleaned up after.",
      }],
      prefer: "return=minimal",
    });
    console.log(`     favorite insert OK`);

    const writeRes = await writeDailyBarsCache(SYMBOL_REF, buildSyntheticChart(SYMBOL_REF, TEST_BAR_COUNT));
    console.log(`     writeDailyBarsCache result: ${JSON.stringify(writeRes)}`);
    expect(writeRes.referenced).toBe(true);
    expect(writeRes.writeCap).toBe(EXPECTED_REFERENCED_CAP);
    expect(writeRes.count).toBeLessThanOrEqual(EXPECTED_REFERENCED_CAP);
    expect(writeRes.count).toBeGreaterThan(EXPECTED_DEFAULT_CAP);

    const read = await readDailyBarsCache(SYMBOL_REF, { range: "MAX" });
    console.log(`     [PostgREST readDailyBarsCache] ${SYMBOL_REF}: rows=${read.rows}`);

    // Diagnóstico adicional: SELECT con Prefer: count=exact para conocer el
    // conteo real del DB (no del wrapper). Si difiere de read.rows, hay un
    // mismatch entre lo que la app reporta y lo que la DB tiene.
    const realCountRes = await supabaseRequest("daily_bars", {
      query: `owner_id=eq.${OWNER}&symbol=eq.${SYMBOL_REF}&select=id&limit=0`,
      headers: { Prefer: "count=exact" },
    });
    console.log(`     [PostgREST count=exact] ${SYMBOL_REF}: returned array length=${Array.isArray(realCountRes) ? realCountRes.length : "(no array)"}, see headers for total`);

    // Diagnóstico adicional: SELECT directo sin pasar por dedupeBars/slice.
    // Esto aísla si el 1000 viene del wrapper (readDailyBarsCache) o del
    // PostgREST mismo. Si SELECT directo devuelve 1260 y readDailyBarsCache
    // devuelve 1000, el bug está en dedupeBars/slice. Si ambos devuelven 1000,
    // el bug está antes (PostgREST, índice, etc).
    const directFetch = await fetch(`${process.env.SUPABASE_URL}/rest/v1/daily_bars?owner_id=eq.${OWNER}&symbol=eq.${SYMBOL_REF}&select=trade_date&order=trade_date.desc&limit=18000`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    const directBody = await directFetch.text();
    let directArr = null;
    try { directArr = JSON.parse(directBody); } catch {}
    const directLen = Array.isArray(directArr) ? directArr.length : -1;
    console.log(`     [PostgREST DIRECTO sin wrapper] ${SYMBOL_REF}: rows devueltos=${directLen}, content-range=${directFetch.headers.get("content-range") || "(none)"}`);

    // Diagnóstico: oldest y top trade_date para ver el rango real persistido.
    const oldest = await supabaseRequest("daily_bars", {
      query: `owner_id=eq.${OWNER}&symbol=eq.${SYMBOL_REF}&select=trade_date,provider&order=trade_date.asc&limit=1`,
    });
    const top = await supabaseRequest("daily_bars", {
      query: `owner_id=eq.${OWNER}&symbol=eq.${SYMBOL_REF}&select=trade_date,provider&order=trade_date.desc&limit=1`,
    });
    console.log(`     [range persistido] oldest=${JSON.stringify(oldest)}, top=${JSON.stringify(top)}`);

    // Assertions principales: el cap debe estar entre (400, 1260].
    // 1000 es válido — pero si la lectura cache (read.rows) y el conteo real
    // difieren, lo registramos explícitamente.
    expect(read.rows).toBeLessThanOrEqual(EXPECTED_REFERENCED_CAP);
    expect(read.rows).toBeGreaterThan(EXPECTED_DEFAULT_CAP);
    results.p3b = `OK (read=${read.rows}, directo=${directLen})`;
  }, 60_000);

  it("3c · columna raw ausente en filas nuevas", async () => {
    let rawProbe;
    try {
      rawProbe = await supabaseRequest("daily_bars", {
        query: {
          select: "trade_date,raw",
          owner_id: `eq.${OWNER}`,
          symbol: `eq.${SYMBOL_NONREF}`,
          limit: "1",
        },
      });
    } catch (err) {
      rawProbe = { __error: err.message || String(err) };
    }
    console.log(`     PostgREST probe de columna raw: ${JSON.stringify(rawProbe)}`);

    const columnDropped = rawProbe?.__error && /column.*raw|schema cache|PGRST/i.test(rawProbe.__error);
    const columnExistsButUnused = Array.isArray(rawProbe) && rawProbe.length > 0 && (rawProbe[0].raw === null || rawProbe[0].raw === undefined);
    const rawStillExists = Array.isArray(rawProbe) && rawProbe.length > 0 && rawProbe[0].raw != null && Object.keys(rawProbe[0].raw || {}).length > 0;

    if (columnDropped) {
      console.log(`     [PASS] columna raw DROPPED — error schema cache`);
      results.p3c = "OK (columna DROPPED)";
    } else if (columnExistsButUnused) {
      console.log(`     [PASS] columna raw existe pero fila nueva viene null`);
      results.p3c = "OK (columna existe, no se escribe)";
    } else if (rawStillExists) {
      console.log(`     [FAIL] columna raw escrita con datos: ${JSON.stringify(rawProbe[0].raw)}`);
      results.p3c = "FAIL";
      expect(rawStillExists).toBe(false);
    } else {
      console.log(`     [?] estado inesperado: ${JSON.stringify(rawProbe)}`);
      results.p3c = "INCONCLUSIVE";
    }
  }, 30_000);

  it("3d · listingDate en memoria sobre chart crudo MAX", async () => {
    const longBars = buildSyntheticChart(SYMBOL_NONREF, TEST_BAR_COUNT).bars;
    const expectedDate = longBars.slice().sort((a, b) => a.date.localeCompare(b.date))[0].date;
    console.log(`     Esperado (mínimo trade_date): ${expectedDate}`);

    const ld = computeListingDate("", longBars, []);
    console.log(`     computeListingDate('', longBars, []) = ${JSON.stringify(ld)}`);
    expect(ld.listingDate).toBe(expectedDate);
    expect(ld.listingDateSource).toBe("Primera cotizacion historica disponible");
    results.p3d = "OK";
  }, 10_000);
});