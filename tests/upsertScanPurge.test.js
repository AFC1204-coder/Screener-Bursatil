// Tests de la purga oportunista en upsert_scan_newer_wins (supabase/schema.sql).
//
// CONTEXTO IMPORTANTE — límite de lo testeable sin DB real:
//
// La purga (retención N=3 por owner + tombstones >7 días) vive DENTRO de la
// función PL/pgSQL `upsert_scan_newer_wins`, en la misma transacción que el
// upsert. NO hay orchestrator JS separado para la purga (a diferencia de
// `finalizeScanResultsInDb`, que tiene un wrapper JS testeable). Por lo tanto,
// el comportamiento exacto de la purga SOLO puede verificarse contra Postgres
// real — lo cual no es posible en este entorno (proyecto Supabase bloqueado
// por cuota; ver historia de sesiones anteriores).
//
// Estos tests verifican lo verificable:
//   1. CONTRATO ESTÁTICO: el SQL contiene la purga con las constantes
//      correctas (N=3, 7 días), dentro de upsert_scan_newer_wins, gateada por
//      v_accepted, y NO toca favorites/favorite_snapshots. Si alguien borra o
//      modifica la purga, estos tests fallan y fuerzan una decisión consciente.
//   2. NO REGRESIÓN JS: resultPayload (el builder del payload que se envía a
//      upsert_scan_newer_wins) sigue produciendo el shape correcto. La purga
//      no cambió el payload — solo añade lógica server-side.
//   3. AISLAMIENTO DE FAVORITES: el SQL de la función nunca referencia las
//      tablas favorites/favorite_snapshots (están desacopladas por diseño
//      copy-on-favorite, sin FK hacia scans/scan_results).
//
// Lo que NO cubren (pendiente de validación en runtime contra Postgres real):
//   - Que row_number() efectivamente retenga los 3 más recientes por updated_at.
//   - Que el cascade ON DELETE CASCADE limpie scan_results al borrar scans.
//   - Que la transacción revierta si la purga falla.
//   - Que el interval `(v_tombstone_days || ' days')::interval` parsea bien.
//
// Estos 4 puntos quedan marcados como pendientes de verificación cuando se
// recupere el acceso a la DB (siguiendo el patrón de `finalize_scan_results`,
// que también fue inspeccionado estáticamente y validado en runtime solo
// parcialmente).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resultPayload } from "@/app/api/scans/route";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "supabase", "schema.sql");
const SCHEMA = readFileSync(SCHEMA_PATH, "utf8");

// Extrae el cuerpo de upsert_scan_newer_wins desde el CREATE OR REPLACE hasta
// el revoke/grant posterior. Esto acota las aserciones a ESTA función y evita
// falsos positivos por texto similar en otras funciones del archivo.
function extractFunctionBody(schema, fnName) {
  const startIdx = schema.indexOf(`create or replace function public.${fnName}(`);
  if (startIdx === -1) return null;
  // La función termina en `$$;` seguido de revoke. Buscamos el primer `$$;`
  // después del cuerpo PL/pgSQL.
  const endMarker = "$$;";
  const endIdx = schema.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;
  return schema.slice(startIdx, endIdx + endMarker.length);
}

const UPSERT_BODY = extractFunctionBody(SCHEMA, "upsert_scan_newer_wins");

// ===========================================================================
// 1. Contrato estático de la purga en upsert_scan_newer_wins
// ===========================================================================

describe("upsert_scan_newer_wins · purga oportunista (contrato estático)", () => {
  it("la función existe en schema.sql y se extrajo su cuerpo completo", () => {
    expect(UPSERT_BODY).not.toBeNull();
    expect(UPSERT_BODY.length).toBeGreaterThan(500);
  });

  it("contiene el bloque de purga con el comentario de política", () => {
    // El comentario documenta la política para que quede claro por qué existe
    // sin rastrear el historial de decisiones.
    expect(UPSERT_BODY).toMatch(/PURGA OPORTUNISTA/);
    expect(UPSERT_BODY).toMatch(/política de retención/);
    expect(UPSERT_BODY).toMatch(/últimos N scans por owner/i);
  });

  it("N=3 está hardcoded como constante (política decidida, no parámetro)", () => {
    // La constante debe estar declarada y usada en el row_number filter.
    expect(UPSERT_BODY).toMatch(/v_retention_count\s+int\s*:=\s*3/);
    expect(UPSERT_BODY).toMatch(/ranked\.rn\s*>\s*v_retention_count/);
  });

  it("tombstones de >7 días se eliminan (constante v_tombstone_days=7)", () => {
    expect(UPSERT_BODY).toMatch(/v_tombstone_days\s+int\s*:=\s*7/);
    // La condición usa deleted_at + intervalo calculado desde la constante.
    expect(UPSERT_BODY).toMatch(/deleted_at is not null/);
    expect(UPSERT_BODY).toMatch(/v_tombstone_days\s*\|\|\s*' days'/);
    expect(UPSERT_BODY).toMatch(/now\(\)\s*-\s*\(v_tombstone_days/);
  });

  it("la purga está gateada por v_accepted (solo en upsert exitoso)", () => {
    // La spec exige atomicidad con el upsert exitoso. Un upsert rechazado por
    // stale (v_accepted=false) NO debe disparar la purga.
    // Buscamos el bloque if v_accepted then ... declare ... begin ... end;
    expect(UPSERT_BODY).toMatch(/if\s+v_accepted\s+then\s*\n\s*declare/);
  });

  it("retención por row_number() partition by owner_id order by updated_at desc", () => {
    // La ventana debe particionar por owner (no global) y ordenar por recencia.
    expect(UPSERT_BODY).toMatch(/partition by s\.owner_id/);
    expect(UPSERT_BODY).toMatch(/order by s\.updated_at desc/);
    // Tiebreaker por created_at desc para determinismo cuando updated_at empata.
    expect(UPSERT_BODY).toMatch(/s\.created_at desc/);
  });

  it("la purga borra de scans (el cascade limpia scan_results — no hay delete explícito de scan_results en la purga)", () => {
    // Confirma la decisión de diseño: cascade ON DELETE CASCADE existe en
    // scan_results.scan_id (ver DDL), así la PURGA solo borra de scans.
    // Nota: la función TIENE un `delete from scan_results where scan_id = v_scan_id`
    // ANTES de la purga (línea original del upsert, para limpiar filas viejas
    // del propio scan antes del re-insert) — ese NO es parte de la purga y es
    // correcto que exista. Aquí verificamos que la PURGA (bloque nuevo) no
    // añade deletes explícitos a scan_results.
    //
    // Conteo total de deletes en la función:
    //   - 1 × delete from scan_results (pre-existing, limpia el scan propio)
    //   - 2 × delete from scans (nuevos: tombstones + retención top-N)
    const allDeletes = UPSERT_BODY.match(/delete from public\.\w+/g) || [];
    expect(allDeletes.filter((d) => d === "delete from public.scans")).toHaveLength(2);
    expect(allDeletes.filter((d) => d === "delete from public.scan_results")).toHaveLength(1);
    // La purga (bloque tras el `if v_accepted then declare`) no referencia
    // scan_results — extraemos solo ese bloque y verificamos.
    const purgeBlockStart = UPSERT_BODY.indexOf("if v_accepted then");
    const purgeBlockEnd = UPSERT_BODY.indexOf("return query", purgeBlockStart);
    const purgeBlock = UPSERT_BODY.slice(purgeBlockStart, purgeBlockEnd);
    expect(purgeBlock).not.toMatch(/delete from public\.scan_results/);
    expect(purgeBlock).toMatch(/delete from public\.scans/);
  });

  it("NO ejecuta DML (delete/insert/update) contra favorites ni favorite_snapshots", () => {
    // Las tablas de favoritos están desacopladas (copy-on-favorite, sin FK).
    // La función de upsert+purga no debe modificarlas bajo ninguna circunstancia.
    // Nota: el comentario documental SÍ menciona "favorites" (para explicar
    // que NO se toca) — por eso no buscamos la palabra suelta, sino DML
    // dirigido a esas tablas.
    expect(UPSERT_BODY).not.toMatch(/(delete from|insert into|update)\s+public\.(favorites|favorite_snapshots)\b/i);
  });

  it("la purga está DENTRO de la función (no en trigger ni función separada)", () => {
    // La spec exige misma transacción que el upsert. Confirmamos que el bloque
    // de purga vive entre el `end if;` del insert de scan_results y el
    // `return query` final, dentro del mismo `$$ ... $$;` body.
    const insertEndif = UPSERT_BODY.indexOf("where nullif(trim(item.symbol), '') is not null;");
    const purgeStart = UPSERT_BODY.indexOf("PURGA OPORTUNISTA");
    const returnQuery = UPSERT_BODY.indexOf("return query", purgeStart);
    expect(insertEndif).toBeGreaterThan(-1);
    expect(purgeStart).toBeGreaterThan(insertEndif);
    expect(returnQuery).toBeGreaterThan(purgeStart);
  });
});

// ===========================================================================
// 2. Confirmación del cascade ON DELETE CASCADE en el DDL
// ===========================================================================

describe("upsert_scan_newer_wins · tombstones recientes no compiten por retención", () => {
  // Fix de bug: la subquery ranked debe excluir tombstones (deleted_at is not
  // null) del ranking de retención, incluso los recientes (<7 días) que la
  // purga de tombstones todavía no toca. Sin el fix, un tombstone reciente con
  // updated_at alta podía desplazar a un scan activo real del top-3.
  //
  // Contrato: la subquery ranked (Paso 2) tiene `and s.deleted_at is null` en
  // su where. La query de tombstones (Paso 1) sigue operando sobre
  // `deleted_at is not null`. No se mezclan.

  it("la subquery ranked excluye tombstones con `and s.deleted_at is null`", () => {
    // Extraemos el bloque de la subquery ranked (entre row_number() y el cierre
    // del ranked CTE) y verificamos la condición.
    const rankedBlockMatch = UPSERT_BODY.match(
      /row_number\(\)\s+over\s*\([\s\S]*?\)\s+as\s+rn\s+from\s+public\.scans\s+s\s+where\s+s\.owner_id\s*=\s*v_owner([\s\S]*?)\)\s+ranked/,
    );
    expect(rankedBlockMatch).not.toBeNull();
    const rankedWhere = rankedBlockMatch[1];
    expect(rankedWhere).toMatch(/and\s+s\.deleted_at\s+is\s+null/);
  });

  it("la query de tombstones (Paso 1) sigue operando sobre deleted_at is not null", () => {
    // Confirma que el fix NO tocó la lógica de tombstones: siguen elegibles
    // solo los scans con deleted_at no nulo Y >7 días. Usamos una regex que
    // admita paréntesis anidados en el intervalo `(v_tombstone_days || ' days')::interval`.
    // Extraemos el primer delete statement del bloque if v_accepted.
    const purgeBlockStart = UPSERT_BODY.indexOf("if v_accepted then");
    const purgeBlockEnd = UPSERT_BODY.indexOf("return query", purgeBlockStart);
    const purgeBlock = UPSERT_BODY.slice(purgeBlockStart, purgeBlockEnd);
    // La query de tombstones: delete from scans where owner_id = v_owner
    // and deleted_at is not null and deleted_at < (...)
    expect(purgeBlock).toMatch(/delete from public\.scans\s+where owner_id = v_owner\s+and deleted_at is not null\s+and deleted_at < \(/);
  });

  it("la subquery ranked es la única SQL que filtra por deleted_at is null (no se filtra a la query de tombstones)", () => {
    // La SQL (no comentarios) debe tener exactamente 1 ocurrencia de
    // `deleted_at is null` — en el ranking. Excluyemos las líneas que empiezan
    // con `--` (comentarios SQL) para no contar menciones documentales.
    const sqlLinesOnly = UPSERT_BODY.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const matches = sqlLinesOnly.match(/deleted_at\s+is\s+null/g) || [];
    expect(matches).toHaveLength(1);
    // Y NO hay `deleted_at is not null` en la subquery ranked (solo en tombstones).
    const rankedBlockMatch = sqlLinesOnly.match(
      /row_number\(\)\s+over\s*\([\s\S]*?\)\s+as\s+rn\s+from\s+public\.scans\s+s\s+where\s+s\.owner_id\s*=\s*v_owner[\s\S]*?\)\s+ranked/,
    );
    expect(rankedBlockMatch).not.toBeNull();
    expect(rankedBlockMatch[0]).not.toMatch(/deleted_at\s+is\s+not\s+null/);
  });

  it("fixture semántico: tombstone reciente + 3 activos → los 3 activos sobreviven, tombstone ignorado en ranking", () => {
    // Este test valida el COMPORTAMIENTO esperado de la SQL, no su sintaxis.
    // Como no podemos ejecutar la SQL sin DB real, simulamos la lógica del
    // row_number() con y sin el fix, y comparamos qué sobrevive.
    //
    // Fixture: owner con 1 tombstone (deleted_at = hoy-1d) + 3 activos.
    // El tombstone tiene updated_at MÁS ALTA que los 3 activos (caso perverso:
    // sin el fix, el tombstone encabezaría el ranking y el más viejo de los
    // 3 activos sería purgado).
    const now = new Date("2026-07-05T12:00:00Z");
    const fixture = [
      { id: "T1", deleted_at: new Date(now - 1 * 86400_000).toISOString(), updated_at: new Date(now - 0 * 86400_000).toISOString(), created_at: new Date(now - 1 * 86400_000).toISOString() }, // tombstone 1d, updated_at = now
      { id: "A1", deleted_at: null, updated_at: new Date(now - 2 * 86400_000).toISOString(), created_at: new Date(now - 5 * 86400_000).toISOString() }, // activo
      { id: "A2", deleted_at: null, updated_at: new Date(now - 3 * 86400_000).toISOString(), created_at: new Date(now - 6 * 86400_000).toISOString() }, // activo
      { id: "A3", deleted_at: null, updated_at: new Date(now - 4 * 86400_000).toISOString(), created_at: new Date(now - 7 * 86400_000).toISOString() }, // activo
    ];
    const N = 3;

    // Simula la SQL CON fix (s.deleted_at is null en el ranking).
    const rankingWithFix = fixture
      .filter((s) => s.deleted_at === null) // <-- el fix
      .sort((a, b) => (b.updated_at < a.updated_at ? -1 : b.updated_at > a.updated_at ? 1 : b.created_at < a.created_at ? -1 : 1))
      .map((s, i) => ({ id: s.id, rn: i + 1 }));
    const survivorsWithFix = new Set(rankingWithFix.filter((r) => r.rn <= N).map((r) => r.id));
    // Los 3 activos sobreviven. El tombstone no está en el ranking (ignorado).
    expect(survivorsWithFix).toEqual(new Set(["A1", "A2", "A3"]));
    expect(survivorsWithFix.has("T1")).toBe(false); // tombstone ignorado en ranking

    // Simula la SQL SIN fix (bug original) para confirmar que SÍ desplazaría.
    const rankingWithoutFix = fixture
      .sort((a, b) => (b.updated_at < a.updated_at ? -1 : b.updated_at > a.updated_at ? 1 : b.created_at < a.created_at ? -1 : 1))
      .map((s, i) => ({ id: s.id, rn: i + 1 }));
    const survivorsWithoutFix = new Set(rankingWithoutFix.filter((r) => r.rn <= N).map((r) => r.id));
    // BUG: el tombstone T1 (updated_at más alta) ocupa plaza 1; A3 es purgada.
    expect(survivorsWithoutFix).toEqual(new Set(["T1", "A1", "A2"]));
    expect(survivorsWithoutFix.has("A3")).toBe(false); // A3 desplazada — el bug

    // El fix cambia el outcome: con fix sobreviven los 3 activos; sin fix
    // sobreviven T1+A1+A2. La diferencia es exactamente {T1} vs {A3}.
    expect(survivorsWithFix).not.toEqual(survivorsWithoutFix);
  });
});

describe("scan_results.scan_id · ON DELETE CASCADE hacia scans (DDL)", () => {
  it("la FK existe con cascade (justifica borrar solo de scans)", () => {
    // Esta aserción valida la premisa de la decisión de diseño "borrar solo de
    // scans, el cascade limpia scan_results". Si alguien cambia la FK a
    // RESTRICT o SET NULL, la purga dejaría huérfanos y este test fallaría.
    expect(SCHEMA).toMatch(/scan_id uuid not null references scans\(id\) on delete cascade/i);
  });
});

// ===========================================================================
// 3. No regresión JS — resultPayload sigue produciendo el shape correcto
// ===========================================================================
//
// La purga no cambia el payload JS que se envía a upsert_scan_newer_wins.
// Verificamos que resultPayload sigue funcionando y degrada gracefully con
// inputs mínimos (no vimos cambios en el código JS, pero confirmamos no
// regresión por si acaso).

describe("resultPayload (no regresión tras añadir purga server-side)", () => {
  it("produce un payload con raw, metrics, y campos escalares", () => {
    const row = {
      symbol: "TEST",
      companyName: "Test Co",
      country: "US",
      sector: "Tech",
      industry: "Software",
      theme: "AI",
      totalScore: 75,
      weinsteinScore: 80,
      minerviniScore: 70,
      riskScore: 40,
      rsGlobalPct: 65,
      chartPreview: [{ date: "2026-01-01", close: 100, sma50: 95, sma200: 90, volume: 1000 }],
      growthMetrics: { revenueGrowth: 0.25, eps: 1.5 },
    };
    const payload = resultPayload(row, "scan-1", "owner-1", 0, {});
    expect(payload.owner_id).toBe("owner-1");
    expect(payload.scan_id).toBe("scan-1");
    expect(payload.symbol).toBe("TEST");
    expect(payload.rank_index).toBe(1);
    expect(payload.total_score).toBe(75);
    expect(payload.weinstein_score).toBe(80);
    expect(payload.rs_rating).toBe(65);
    expect(payload.raw).toEqual(expect.objectContaining({ symbol: "TEST", totalScore: 75 }));
    expect(payload.raw.chartPreview).toEqual(row.chartPreview); // SIN compactar (decisión: solo purga)
    expect(payload.metrics).toEqual(expect.objectContaining({ rsGlobalPct: 65 }));
  });

  it("raw conserva chartPreview completo (decisión: solo purga, no compactar en escritura)", () => {
    // Este test documenta explícitamente la decisión del usuario de NO compactar
    // raw en escritura. Si en el futuro se aplica compactResearchRow en
    // resultPayload, este test falla y fuerza re-abrir la conversación sobre
    // el trade-off con /api/scans?full=1 y el chart de /review.
    const fullBars = Array.from({ length: 96 }, (_, i) => ({
      date: `2026-${String(Math.floor(i / 31) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000 + i * 10,
    }));
    const row = { symbol: "FULL", chartPreview: fullBars };
    const payload = resultPayload(row, "scan", "owner", 0, {});
    // El raw llega íntegro: 96 barras, con open/high/low preservados.
    expect(payload.raw.chartPreview).toHaveLength(96);
    expect(payload.raw.chartPreview[0]).toHaveProperty("open");
    expect(payload.raw.chartPreview[0]).toHaveProperty("high");
    expect(payload.raw.chartPreview[0]).toHaveProperty("low");
  });
});

// ===========================================================================
// 4. Pendiente de validación en runtime (documentación explícita)
// ===========================================================================
//
// Estos NO son tests — son un manifiesto de lo que falta verificar cuando la
// DB esté disponible. Se deja como comentario para que el próximo prompt de
// "validación contra DB real" sepa exactamente qué cubrir.

describe.skip("upsert_scan_newer_wins · validación pendiente en runtime (DB real)", () => {
  it("tras insertar un 4º scan para el mismo owner, quedan exactamente 3 scans", () => {
    // Requiere DB real. Pasos:
    //   1. Insertar 4 scans con updated_at crecientes para owner X.
    //   2. Llamar upsert_scan_newer_wins con un 5º scan (que dispare la purga).
    //   3. SELECT count(*) FROM scans WHERE owner_id = X → debe ser 3.
    //   4. SELECT count(*) FROM scan_results WHERE scan_id IN (los 3) → coherente.
    //   5. Los scan_results de los 2 scans purgados deben haber desaparecido
    //      (cascade).
  });

  it("tombstone >7 días se elimina, tombstone <7 días se conserva", () => {
    // Requiere DB real. Fixture:
    //   - scan A: deleted_at = now() - 8 days → debe eliminarse.
    //   - scan B: deleted_at = now() - 3 days → debe conservarse.
    //   - Llamar upsert_scan_newer_wins (cualquier upsert exitoso del owner).
    //   - SELECT confirma A borrado, B presente.
  });

  it("la purga es atómica con el upsert (transacción)", () => {
    // Requiere DB real + forzar un error en la purga (p.ej. constraint
    // violation artificial). El upsert completo debe revertirse: ni el scan
    // ni los scan_results quedan persistidos.
  });

  it("favorites/favorite_snapshots intactos tras purga de scans", () => {
    // Requiere DB real. Fixture:
    //   - Insertar un favorite apuntando a un símbolo.
    //   - Insertar un scan con scan_results para el mismo símbolo.
    //   - Llamar upsert_scan_newer_wins de forma que el scan quede fuera del
    //     top-3 y sea purgado.
    //   - SELECT confirma favorite sigue presente y su snapshot intacto.
  });
});
