// lib/ipoDateSources.js — lado de I/O de la fecha de salida a bolsa.
//
// lib/ipoDate.js resuelve sin red, con lo que el pipeline ya tiene en mano.
// Este módulo cubre el hueco que dejaba a `ipoDate` vacío en el nocturno
// aunque la fuente existiera:
//
//   - Las barras se leen de `daily_bars` (withDailyBarsCache). En un acierto
//     de caché, `chartFromCache` (lib/dailyBarsCache.js) reconstruye el meta
//     desde la base y NO incluye `firstTradeDate` — el campo solo viaja en el
//     meta que devuelve Yahoo en vivo.
//   - El perfil se lee de `fundamental_snapshots` (withProfileCache). Las
//     filas cacheadas antes de este cambio llevan `ipoDate: ""`, porque el
//     perfil en vivo tampoco lo resolvía.
//
// Con las dos cachés acertando —el caso normal del cron— ninguna de las dos
// fuentes tiene la fecha, y la fila sale sin ella. Aquí se cierra: cuando ni
// el meta ni el perfil la traen, se pide una vez (Yahoo `meta.firstTradeDate`
// → FMP `/profile`) y se DEVUELVE A LA CACHÉ DE PERFIL. La corrida siguiente
// la encuentra ya guardada y no pide nada: el coste es una petición ligera por
// símbolo, una sola vez, no por noche.

import { fetchFmpIpoDate } from "@/lib/fmp";
import { patchProfileCacheIpoDate } from "@/lib/fundamentalsCache";
import { ipoDateFromEpochSeconds, ipoDateResult, IPO_DATE_SOURCES, resolveIpoDate } from "@/lib/ipoDate";
import { fetchYahooFirstTradeDate } from "@/lib/yahoo";

/**
 * Pide la fecha a los proveedores, en orden. Nunca lanza: un fallo de
 * proveedor devuelve ausencia, no rompe el análisis del símbolo.
 *
 * @param {string} symbol
 * @param {{fmpFallback?: boolean}} options
 */
export async function fetchIpoDateFromProviders(symbol, options = {}) {
  try {
    const seconds = await fetchYahooFirstTradeDate(symbol);
    const yahoo = ipoDateResult(ipoDateFromEpochSeconds(seconds), IPO_DATE_SOURCES.chartMeta);
    if (yahoo.ipoDate) return yahoo;
  } catch {
    // Se intenta FMP igualmente: un 404/429 de Yahoo no debe cerrar la puerta.
  }
  if (options.fmpFallback === false) return ipoDateResult("");
  try {
    const fmp = await fetchFmpIpoDate(symbol);
    if (fmp.configured && fmp.ipoDate) return ipoDateResult(fmp.ipoDate, IPO_DATE_SOURCES.fmp);
  } catch {
    // Sin clave o proveedor caído: ausencia declarada, no fecha inventada.
  }
  return ipoDateResult("");
}

/**
 * Devuelve el perfil con `ipoDate` / `ipoDateSource` resueltos, pidiéndolo al
 * proveedor solo si ni el meta del gráfico ni el perfil lo traen. Si lo pide y
 * lo consigue, lo escribe en la caché de perfil (best-effort) para que las
 * corridas siguientes lo encuentren sin red.
 *
 * `options.fetchIpoDate` permite sustituir la petición a los proveedores; sin
 * él se usa fetchIpoDateFromProviders. Es el único punto de la cadena que hace
 * red, y aislarlo es lo que hace testeable la decisión "¿pedir o no pedir?".
 *
 * @param {string} symbol
 * @param {object} profile perfil ya resuelto por withProfileCache
 * @param {{chartMeta?: object, cache?: boolean, hydrateIpoDate?: boolean, fmpFallback?: boolean, fetchIpoDate?: Function}} options
 */
export async function hydrateProfileIpoDate(symbol, profile = {}, options = {}) {
  const resolved = resolveIpoDate({ chartMeta: options.chartMeta, profile });
  const cachedIpoDate = String(profile?.ipoDate || "").trim();

  if (resolved.ipoDate) {
    // Ya había fecha. Solo hay que persistirla si venía del meta del gráfico
    // y el perfil cacheado no la tenía — así el acierto de caché de la próxima
    // corrida ya la trae y no depende de que el gráfico se pida en vivo.
    if (!cachedIpoDate) await persistIpoDate(symbol, resolved, options);
    return { ...profile, ...resolved };
  }

  if (options.hydrateIpoDate === false) return { ...profile, ...resolved };

  const fetchIpoDate = options.fetchIpoDate || fetchIpoDateFromProviders;
  const fetched = await fetchIpoDate(symbol, options);
  if (!fetched.ipoDate) return { ...profile, ...resolved };
  await persistIpoDate(symbol, fetched, options);
  return { ...profile, ...fetched };
}

// `options.cache === false` es la convención del escáner para "no toques las
// cachés" (lib/materializedScanner.js usa `options.cache !== false` para las
// de barras y perfil); se respeta igual aquí.
async function persistIpoDate(symbol, resolved = {}, options = {}) {
  if (options.cache === false) return;
  try {
    await patchProfileCacheIpoDate(symbol, resolved);
  } catch {
    // La escritura es oportunista: si falla, la fila de este escaneo ya lleva
    // la fecha y la próxima corrida volverá a pedirla. No se propaga.
  }
}
