// lib/nightlyBoundary.js — la frontera del escaneo nocturno, en un solo sitio
// y para los dos lados de la aplicación.
//
// Nació en lib/discoveryCache.js el 13 de agosto de 2026, cuando la caché de
// discovery llevaba 54 días sirviendo un payload congelado
// (docs/migracion-listas-2026-08-13.md §12). El 25 de agosto la pantalla
// principal necesitó exactamente la misma regla —una sesión del 16 de agosto
// enseñaba "scan 16 ago" el día 23, para siempre— y discoveryCache.js importa
// supabaseServer, que un componente cliente no puede cargar. De ahí este
// módulo: sin dependencias, como lib/scanLocalId.js, para que lo vean tanto
// el servidor (discovery) como el navegador (la sesión del screener).
//
// EL PLAZO NO ES UN TTL EN HORAS, ES LA FRONTERA DEL ESCANEO NOCTURNO.
// Un TTL fijo no sirve aquí: los datos no envejecen poco a poco, cambian de
// golpe una vez al día. Un dato de las 02:00 con TTL de 12 h seguiría
// considerándose fresco a las 14:00, diez horas después de que el nocturno
// haya dejado datos nuevos. Lo que hay que garantizar es que ninguna copia
// sobreviva a la llegada de datos nuevos.
//
// .github/workflows/scan-universe.yml corre a las 03:00 UTC. Sobre esa hora
// hay que sumar dos holguras que el propio workflow documenta: GitHub puede
// retrasar los `schedule` entre 5 y 30 minutos, y la corrida tiene
// timeout-minutes: 30. Así que los datos de la noche N están completos como
// muy tarde a las 04:00 UTC.
//
// Regla: un dato vale si es POSTERIOR a la última frontera de las 04:00 UTC.
// Vida máxima 24 h, mínima unos minutos si llegó a las 03:59 — que es el
// lado correcto en el que fallar: como mucho cuesta una lectura viva,
// mientras que el error contrario costó 54 días de datos falsos en Listas y
// una semana en el screener.

function boundaryHour() {
  // La variable de entorno solo existe en el servidor; en el navegador el
  // acceso devuelve undefined y rige el 4. Se lee en cada llamada para que
  // los tests puedan fijarla.
  const raw = typeof process !== "undefined" ? process.env?.DISCOVERY_CACHE_BOUNDARY_UTC_HOUR : undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 4;
}

export function nightlyBoundaryBefore(now = new Date()) {
  const boundary = new Date(now);
  boundary.setUTCHours(boundaryHour(), 0, 0, 0);
  // Antes de la frontera de hoy, la última que se cruzó fue la de ayer.
  if (boundary.getTime() > now.getTime()) boundary.setUTCDate(boundary.getUTCDate() - 1);
  return boundary;
}

// Frescura de un dato fechado respecto a la última frontera nocturna.
// Separada y exportada para poder probarla sin base de datos ni navegador.
export function nightlyDataFreshness(dataAt, now = new Date()) {
  const dated = Date.parse(dataAt || "");
  // Sin fecha no se puede afirmar que esté fresco, y en la duda no se sirve.
  if (!Number.isFinite(dated)) return { fresh: false, status: "undated", ageHours: null, boundary: null };
  const boundary = nightlyBoundaryBefore(now);
  const ageHours = Math.max(0, (now.getTime() - dated) / 3600000);
  return {
    fresh: dated >= boundary.getTime(),
    status: dated >= boundary.getTime() ? "fresh" : "expired",
    ageHours: Math.round(ageHours * 10) / 10,
    boundary: boundary.toISOString(),
  };
}

// La ventana en la que corre el propio nocturno: el workflow lanza a las
// 03:00 UTC y, entre el retraso de GitHub (≤30 min) y su timeout (30 min),
// el escaneo queda fechado entre las 03:00 y las 04:00 (medido en agosto de
// 2026: created_at entre 03:55 y 04:02). Importa para distinguir dos
// preguntas distintas:
//   - "¿este snapshot DERIVADO es posterior al último nocturno?" (discovery):
//     se compara contra la frontera a secas, porque el snapshot se genera al
//     servir y su fecha siempre es posterior al escaneo del que sale.
//   - "¿este ESCANEO es el de esta noche?" (la sesión del screener): la fecha
//     comparada es la del propio nocturno, que cae unos minutos ANTES de la
//     frontera. Sin la ventana, el nocturno de hoy de las 03:58 se daría por
//     caducado a las 04:00 y la pantalla re-descargaría 27 MB en cada
//     recarga, para recibir exactamente el mismo escaneo (visto en la
//     verificación del 25-08).
const NIGHTLY_RUN_WINDOW_MS = 60 * 60 * 1000;

// ¿Es este escaneo el de la última noche (o más nuevo)? Fresco si es
// posterior al INICIO de la ventana del nocturno vigente.
export function nightlyScanFreshness(scanAt, now = new Date()) {
  const dated = Date.parse(scanAt || "");
  if (!Number.isFinite(dated)) return { fresh: false, status: "undated", ageHours: null, boundary: null };
  const boundary = nightlyBoundaryBefore(now);
  const windowStart = boundary.getTime() - NIGHTLY_RUN_WINDOW_MS;
  const ageHours = Math.max(0, (now.getTime() - dated) / 3600000);
  return {
    fresh: dated >= windowStart,
    status: dated >= windowStart ? "fresh" : "expired",
    ageHours: Math.round(ageHours * 10) / 10,
    boundary: boundary.toISOString(),
  };
}

// ¿Han caducado los DATOS de una sesión persistida del screener? Los
// criterios (preset, capas, orden, scroll) no caducan nunca; lo que caduca es
// el escaneo al que la sesión hace referencia, fechado en
// scanContext.scannedAt. Una sesión sin esa fecha se trata como caducada:
// en la duda, datos frescos.
export function screenerSessionDataExpired(session, now = new Date()) {
  return !nightlyScanFreshness(session?.scanContext?.scannedAt, now).fresh;
}
