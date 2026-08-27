// lib/scanLocalId.js — el vocabulario de `scans.local_id`, en un solo sitio.
//
// Por qué existe: el prefijo que identifica al escaneo nocturno estadounidense
// estaba escrito a mano en TRES archivos —lib/leaderboards.js,
// scripts/scan-universe.mjs y scripts/purge-scans.mjs— y cada uno decidía por
// su cuenta qué era un nocturno. Mientras solo hubiera una clase de escaneo
// eso era duplicación inofensiva. Deja de serlo en cuanto aparece una segunda
// clase: si se añade un espacio de nombres nuevo y uno de los tres no se
// entera, ese archivo sigue tratando la corrida de prueba como si fuera la
// buena. Que es exactamente lo que pasó el 14 de agosto de 2026, cuando una
// corrida `--limit=300` se convirtió en la fuente de las Listas porque su
// local_id era indistinguible del nocturno real.
//
// Módulo sin dependencias a propósito: lo importan tanto código de `lib/`
// como los scripts de `scripts/`, que corren con el loader plano
// (scripts/loader.mjs) y no transforman JSX.

// El escaneo nocturno real: universo estadounidense completo, una corrida por
// noche, escrito por scripts/scan-universe.mjs (workflow scan-universe.yml).
// Es la fuente de las Listas — readNightlyUsScan (lib/leaderboards.js) coge
// el más reciente con este prefijo.
export const NIGHTLY_US_LOCAL_ID_PREFIX = "materialized:US:";

// Cualquier escaneo del cron materializado, de cualquier mercado
// (SCAN_CRON_GROUPS, lib/cronPlan.js).
export const CRON_LOCAL_ID_PREFIX = "materialized:";

// Corridas de PRUEBA. Van delante del prefijo del cron —quedan como
// "test:materialized:US:2026-08-14:o0:l300"— para que NO casen con ninguno de
// los dos de arriba. Consecuencias buscadas, las tres:
//   - readNightlyUsScan no las toma como fuente de las Listas;
//   - pruneNightlyScans no las cuenta contra la retención de 7 nocturnos, así
//     que una tanda de pruebas no desplaza escaneos buenos;
//   - purge-scans.mjs las reconoce y las borra por lo que son (classifyScan),
//     en vez de por descarte como si fueran escaneos interactivos.
export const TEST_LOCAL_ID_PREFIX = "test:";

// Valor de `?anchor=` con el que la pantalla principal pide ESE escaneo y no
// "el más reciente" (app/api/scans/route.js ← lib/cloudSyncClient.js). Vive
// aquí porque cruza la frontera cliente/servidor y este módulo es el único sin
// dependencias que ven los dos lados.
export const NIGHTLY_US_ANCHOR = "nightly-us";

// Valor de `?anchor=` para pedir el último materializado de un conjunto de
// mercados concreto (?markets=CA o CSV). Ver lib/materializedScanLookup.js.
export const MARKETS_ANCHOR = "markets";

const text = (value) => String(value || "");

/** ¿Es el escaneo nocturno estadounidense real? Excluye las pruebas. */
export function isNightlyUsLocalId(localId = "") {
  return text(localId).startsWith(NIGHTLY_US_LOCAL_ID_PREFIX);
}

/** ¿Es una corrida de prueba, del tipo que sea? */
export function isTestLocalId(localId = "") {
  return text(localId).startsWith(TEST_LOCAL_ID_PREFIX);
}

/** Patrón para el filtro `like` de PostgREST sobre los nocturnos reales. */
export function nightlyUsLocalIdPattern() {
  return `${NIGHTLY_US_LOCAL_ID_PREFIX}*`;
}
