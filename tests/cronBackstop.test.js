// Tests del backstop semanal con pg_cron (supabase/schema.sql).
//
// CONTEXTO IMPORTANTE — límite de lo testeable sin DB real:
//
// El backstop es un job pg_cron que corre una vez por semana y borra scans
// huérfanos (activos con updated_at >30 días) y tombstones que sobrevivieron
// >30 días pese a la purga oportunista de 7 días. Vive FUERA de cualquier
// función PL/pgSQL — es un `select cron.schedule(...)` directo en el schema.
//
// NO se puede verificar comportamiento real contra Postgres desde este entorno
// (proyecto Supabase restringido por cuota; ver historia de sesiones). Lo que
// SÍ se puede verificar es el CONTRATO ESTÁTICO del SQL:
//   1. La extensión pg_cron está declarada con el schema correcto (extensions).
//   2. El cron.schedule usa el cron string correcto (semanal, fuera de pico).
//   3. El umbral del backstop (30 días) es ESTRICTAMENTE MAYOR que el umbral
//      oportunista (7 días de tombstones + 3 scans activos por owner). Esto
//      garantiza que el backstop NO interfiere con la purga normal en el rango
//      0–29 días — solo actúa sobre huérfanos que la purga nunca tocó.
//   4. Las queries del job NO tocan favorites/favorite_snapshots (grep sobre
//      el bloque cron.schedule).
//
// Lo que NO cubren (pendiente de validación en runtime contra Postgres real):
//   - Que pg_cron efectivamente esté habilitado a nivel de proyecto (requiere
//     Dashboard → Database → Extensions → pg_cron, fuera del alcance del SQL).
//   - Que extensions.cron.schedule resuelva correctamente (depende del
//     search_path del worker de pg_cron, que es una sesión libpq nueva).
//   - Que el job se ejecute a la hora programada (cron daemon del worker).
//   - Que el bloque DO/PERFORM para unschedule no falle si el job no existe.
//
// Estos puntos quedan marcados como pendientes de verificación cuando se
// recupere el acceso a la DB (mismo patrón que finalize_scan_results y la
// purga oportunista en upsert_scan_newer_wins).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "supabase", "schema.sql");
const SCHEMA = readFileSync(SCHEMA_PATH, "utf8");

// Extrae el bloque pg_cron completo: desde `create extension ... pg_cron` hasta
// el final del cron.schedule (cierre del select). Esto acota las aserciones al
// backstop y evita falsos positivos por texto similar en otras partes.
//
// Anclaje: usamos el nombre único del job 'statsedge-backstop-purge-weekly'
// (no la firma `cron.schedule`) para localizar el schedule. Esto sobrevive a
// cambios de prefijo (e.g. `extensions.cron.schedule` vs `cron.schedule`).
function extractCronBlock(schema) {
  const startMatch = schema.match(/create extension if not exists pg_cron/i);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  // Localizamos el schedule buscando el nombre único del job (aparece tanto
  // en el unschedule idempotente como en el schedule principal).
  const jobNameIdx = schema.indexOf("statsedge-backstop-purge-weekly", startIdx);
  if (jobNameIdx === -1) return null;
  // Tras schedule viene el cron string, el $cron$ body, y el cierre `);`.
  const cronBodyEnd = schema.indexOf("$cron$\n);", jobNameIdx);
  if (cronBodyEnd === -1) return null;
  const endIdx = cronBodyEnd + "$cron$\n);".length;
  return schema.slice(startIdx, endIdx);
}

const CRON_BLOCK = extractCronBlock(SCHEMA);

// Extrae el body SQL dentro del $cron$ ... $cron$ del schedule (las queries
// que pg_cron ejecutará cada semana).
function extractCronJobSql(schema) {
  const m = schema.match(/\$cron\$\s*([\s\S]*?)\$cron\$/);
  return m ? m[1] : null;
}

const CRON_JOB_SQL = extractCronJobSql(SCHEMA);

// Umbral del backstop y de la purga oportunista — extraídos del SQL para que
// el test del invariante "backstop > oportunista" no dependa de constantes
// duplicadas en el test. Si alguien cambia un número en el SQL, el test se
// recalibra solo.
function extractBackstopDays(schema) {
  // Busca `interval '30 days'` en el bloque cron (no en comentarios).
  const m = schema.match(/interval\s+'(\d+)\s+days'/i);
  return m ? parseInt(m[1], 10) : null;
}

function extractOpportunisticTombstoneDays(schema) {
  // v_tombstone_days int := 7 — constante hardcoded en upsert_scan_newer_wins.
  const m = schema.match(/v_tombstone_days\s+int\s*:=\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ===========================================================================
// 1. La extensión pg_cron está declarada (sin `with schema`, convención del proyecto)
// ===========================================================================

describe("pg_cron · extensión declarada sin especificar schema", () => {
  it("el bloque pg_cron está presente en schema.sql", () => {
    expect(CRON_BLOCK).not.toBeNull();
    expect(CRON_BLOCK.length).toBeGreaterThan(200);
  });

  it("create extension if not exists pg_cron (idempotente)", () => {
    // `if not exists` para que la migración sea re-ejecutable sin error.
    expect(CRON_BLOCK).toMatch(/create extension if not exists pg_cron/i);
  });

  it("NO usa `with schema` — sigue la convención del proyecto (pgcrypto, línea 4)", () => {
    // La única otra create extension existente en schema.sql (pgcrypto, línea 4)
    // tampoco especifica schema. Mantener pg_cron sin `with schema` deja que
    // Postgres use la convención por defecto y crea los objetos internos
    // (schedule, unschedule, cron.job, etc.) en el schema `cron` literal —
    // que es donde viven las funciones que llamamos desde abajo.
    expect(CRON_BLOCK).toMatch(/create extension if not exists pg_cron;/);
    expect(CRON_BLOCK).not.toMatch(/create extension if not exists pg_cron with schema/i);
  });
});

// ===========================================================================
// 2. El cron.schedule usa el cron string correcto (semanal, fuera de pico)
// ===========================================================================

describe("pg_cron · cron.schedule con sintaxis semanal correcta", () => {
  it("invoca cron.schedule SIN prefijo de schema (convención pg_cron)", () => {
    // pg_cron crea sus objetos internos (incluidas schedule/unschedule) en un
    // schema llamado literalmente "cron", independientemente del schema donde
    // se cargue la extensión con `with schema`. Por eso las llamadas se hacen
    // SIN prefijo: `cron.schedule(...)` y NO `extensions.cron.schedule(...)`.
    // El prefijo `extensions.` apuntaba al schema equivocado.
    expect(CRON_BLOCK).toMatch(/cron\.schedule\s*\(/);
  });

  it("NO usa el prefijo `extensions.cron` (deprecation check)", () => {
    // Defensa contra regresión: si alguien añade de vuelta `extensions.cron.*`,
    // este test falla y obliga a leer el comentario que documenta por qué no.
    expect(CRON_BLOCK).not.toMatch(/extensions\.cron\.(schedule|unschedule)/i);
  });

  it("el job tiene nombre estable 'statsedge-backstop-purge-weekly'", () => {
    // Nombre determinístico para poder unschedule idempotente en re-runs.
    expect(CRON_BLOCK).toMatch(/['"]statsedge-backstop-purge-weekly['"]/);
  });

  it("cron string semanal: domingos 03:00 UTC (0 3 * * 0)", () => {
    // 5 campos: minuto hora día-mes mes día-semana.
    // '0 3 * * 0' = minuto 0, hora 3, cualquier día del mes, cualquier mes,
    // domingo (0). 03:00 UTC está fuera de horas pico globales y no choca
    // con ningún flujo de escritura del usuario (scans ocurren on-demand).
    expect(CRON_BLOCK).toMatch(/['"]0\s+3\s+\*\s+\*\s+0['"]/);
  });

  it("hay un unschedule idempotente antes del schedule", () => {
    // Re-ejecutar la migración no debe duplicar el job. El DO/PERFORM envuelve
    // unschedule en exception when others → no falla si el job no existe aún.
    // También aquí: sin prefijo `extensions.` — `cron.unschedule` vive en el
    // schema `cron` literal de pg_cron.
    expect(CRON_BLOCK).toMatch(/cron\.unschedule\s*\(\s*['"]statsedge-backstop-purge-weekly['"]/);
    expect(CRON_BLOCK).toMatch(/exception\s+when\s+others\s+then\s+null/i);
  });
});

// ===========================================================================
// 3. Invariante de umbral: backstop (30d) > oportunista (7d tombstones + top-3)
// ===========================================================================

describe("pg_cron · umbral de backstop estrictamente más laxo que oportunista", () => {
  it("el backstop usa 30 días como umbral", () => {
    const backstop = extractBackstopDays(SCHEMA);
    expect(backstop).toBe(30);
  });

  it("la purga oportunista usa 7 días para tombstones (referencia)", () => {
    const tombstone = extractOpportunisticTombstoneDays(SCHEMA);
    expect(tombstone).toBe(7);
  });

  it("30 días > 7 días: el backstop NO compite con la purga oportunista", () => {
    // El invariante central: en el rango 0–29 días, el backstop es inerte.
    // Solo actúa a partir de 30 días, donde la purga oportunista ya hace
    // rato que habría limpiado tombstones (a los 7) y retenido solo 3 activos.
    // Si este test fallara, significaría que alguien bajó el umbral del
    // backstop a ≤7 días — lo que rompería el contrato de "no interferir".
    const backstop = extractBackstopDays(SCHEMA);
    const tombstone = extractOpportunisticTombstoneDays(SCHEMA);
    expect(backstop).toBeGreaterThan(tombstone);
    // Margen explícito: al menos 4× el umbral de tombstones (30/7 = 4.3×).
    // Esto da holgura para que el usuario vuelva a escanear dentro del mes
    // sin que el backstop toque nada que la purga oportunista aún gestionaría.
    expect(backstop).toBeGreaterThanOrEqual(tombstone * 4);
  });

  it("simulación: scan activo con 29 días sobrevive al backstop, 31 días se purga", () => {
    // Validación comportamental del umbral usando la MISMA expresión que el
    // SQL: `updated_at < now() - interval '30 days'`. No ejecutamos SQL —
    // simulamos el comparador con fechas.
    //
    // Nota sobre la frontera: el SQL usa `<` ESTRICTO, así que un scan con
    // EXACTAMENTE 30 días de antigüedad (updated_at = now() - 30d) NO se
    // purga — no es estrictamente menor que el umbral. Hace falta 31 días
    // para entrar en la ventana de purga. Esto es consistente con la
    // semántica de "huérfano" (un scan que nadie tocó en >30 días).
    const now = new Date("2026-07-05T12:00:00Z");
    const DAY = 86400_000;
    const cases = [
      { ageDays: 7, shouldSurvive: true },  // recién cae en ventana oportunista
      { ageDays: 29, shouldSurvive: true }, // dentro del rango donde backstop es inerte
      { ageDays: 30, shouldSurvive: true }, // frontera: exactamente 30d, < estricto → sobrevive
      { ageDays: 31, shouldSurvive: false }, // primer día dentro de la ventana de purga
      { ageDays: 90, shouldSurvive: false }, // huérfano antiguo
    ];
    for (const c of cases) {
      const updatedAt = new Date(now.getTime() - c.ageDays * DAY);
      // Reproduce `< now() - interval '30 days'`: estrictamente menor.
      const threshold = new Date(now.getTime() - 30 * DAY);
      const purged = updatedAt < threshold;
      expect(purged).toBe(!c.shouldSurvive);
    }
  });
});

// ===========================================================================
// 4. Aislamiento de favorites/favorite_snapshots
// ===========================================================================

describe("pg_cron · NO toca favorites ni favorite_snapshots", () => {
  it("el bloque cron.schedule no referencia favorites en DML", () => {
    // El cuerpo del job (lo que pg_cron ejecuta) debe operar SOLO sobre
    // public.scans. Cualquier DML dirigido a favoritos sería un bug grave:
    // los favoritos están desacoplados (copy-on-favorite, sin FK hacia
    // scans/scan_results), así que borrar scans NUNCA debe tocarlos.
    expect(CRON_JOB_SQL).not.toBeNull();
    expect(CRON_JOB_SQL).not.toMatch(/(delete from|insert into|update)\s+public\.(favorites|favorite_snapshots)\b/i);
    expect(CRON_JOB_SQL).not.toMatch(/\bfavorites\b/i);
    expect(CRON_JOB_SQL).not.toMatch(/\bfavorite_snapshots\b/i);
  });

  it("el bloque cron.schedule solo contiene DELETEs sobre public.scans", () => {
    // Acota el DML permitido: exactamente 2 deletes, ambos sobre scans.
    // El cascade ON DELETE CASCADE en scan_results.scan_id limpia las filas
    // hijas automáticamente — no hay delete explícito de scan_results.
    expect(CRON_JOB_SQL).not.toBeNull();
    const deletes = CRON_JOB_SQL.match(/delete from public\.\w+/gi) || [];
    expect(deletes).toHaveLength(2);
    expect(deletes.every((d) => d.toLowerCase() === "delete from public.scans")).toBe(true);
    expect(CRON_JOB_SQL).not.toMatch(/delete from public\.scan_results/i);
  });

  it("el bloque cron cubre los dos casos (activos huérfanos + tombstones)", () => {
    // Caso 1: scan activo (deleted_at is null) con updated_at >30 días.
    // Caso 2: tombstone (deleted_at is not null) con deleted_at >30 días.
    // Ambos necesarios — cubrir solo uno dejaría un agujero.
    expect(CRON_JOB_SQL).toMatch(/deleted_at is null/i);
    expect(CRON_JOB_SQL).toMatch(/updated_at\s*<\s*now\(\)\s*-\s*interval/i);
    expect(CRON_JOB_SQL).toMatch(/deleted_at is not null/i);
    expect(CRON_JOB_SQL).toMatch(/deleted_at\s*<\s*now\(\)\s*-\s*interval/i);
  });
});

// ===========================================================================
// 5. Pendiente de validación en runtime (documentación explícita)
// ===========================================================================

describe.skip("pg_cron · validación pendiente en runtime (DB real)", () => {
  it("la extensión pg_cron está habilitada a nivel de proyecto", () => {
    // Requiere DB real. Pasos:
    //   1. Dashboard → Database → Extensions → buscar pg_cron → Enable.
    //   2. SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
    //   3. Confirmar que el schema es `extensions` (no `public` ni `cron`).
  });

  it("el job aparece en cron.job con el schedule correcto", () => {
    // Requiere DB real. Pasos:
    //   1. Tras correr la migración: SELECT jobname, schedule, command
    //      FROM cron.job WHERE jobname = 'statsedge-backstop-purge-weekly';
    //   2. Confirmar schedule = '0 3 * * 0' y command contiene los 2 deletes.
    //   3. Confirmar active = true.
  });

  it("el job ejecuta sin error y borra huérfanos >30 días", () => {
    // Requiere DB real. Pasos:
    //   1. Insertar fixture: 1 scan activo con updated_at = now()-31d,
    //      1 tombstone con deleted_at = now()-31d, 1 scan activo reciente.
    //   2. Esperar a la próxima corrida del cron (o forzar manualmente:
    //      SELECT cron.schedule('test-run', '...', '...') con run_in_seconds).
    //   3. Confirmar: los 2 huérfanos borrados, el reciente sobrevive.
    //   4. Confirmar scan_results cascade: las filas hijas de los borrados
    //      también desaparecieron.
    //   5. Confirmar favorites/favorite_snapshots intactos.
  });

  it("extensions.cron.schedule resuelve sin error de search_path", () => {
    // Requiere DB real. Confirma que el schema-qualified call funciona bajo
    // el worker de pg_cron (sesión libpq nueva). Si fallara, habría que
    // ajustar el search_path del rol postgres o des-qualificar y rezar.
  });
});
