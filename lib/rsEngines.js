// lib/rsEngines.js — qué motor de RS alimenta la etiqueta "RS" del producto.
//
// POR QUÉ ESTE ARCHIVO EXISTE
//
// rs_weekly_items admite filas de varios engine_version para el mismo símbolo.
// Hasta MET-1b, lib/globalRs.js resolvía "el engine de la fila más reciente por
// símbolo" (latest-wins). Con un solo motor escribiendo eso era inofensivo; con
// dos, la primera escritura del motor global habría cambiado el RS visible de
// todos los símbolos US en silencio, sin diff que revisar y sin forma de volver
// atrás salvo borrando filas.
//
// El spec (docs/spec-rs-global-multi-mercado-fx.md, pregunta 6, «Convivencia de
// lecturas») exige sustituir esa regla por un PIN explícito: una constante que
// los lectores filtren, de modo que el cutover del RS visible sea un diff de una
// línea, revisable y reversible.
//
// DOS LÍNEAS DE PRODUCTO, DOS MOTORES (spec § «Línea privada vs pública»)
//
//   Privada (esta rama, producto personal): ranking multi-mercado con precios
//   convertidos a USD — statsedge-private-global-rs-usd-v1. Es el default.
//
//   Pública (futura, salvo imprevisto): US-only, sin FX —
//   statsedge-us-equity-rs-v1. No hereda el motor global: abrir intl en público
//   sería una feature explícita, no herencia silenciosa del privado.
//
// La selección va por variable de entorno (STATSEDGE_RS_LINE) y NO por rama ni
// por build implícito, para que un despliegue público no arrastre cobertura
// intl solo por compartir código.

import { envValue } from "@/lib/env";
import { GLOBAL_RS_INTL_MARKETS } from "@/lib/rsIntlMarkets";

// Motor US congelado (scripts/rs-universe.mjs). Sigue escribiendo y sigue
// siendo la base metodológica de MET-2 (RS país US); deja de alimentar
// superficies en la línea privada cuando el pin de abajo apunta al global.
export const US_EQUITY_RS_ENGINE_VERSION = "statsedge-us-equity-rs-v1";

// RS país US = mismos snapshots que el motor US congelado. NO pasa por el pin
// global de canonicalRsEngineVersion() — es un eje analítico paralelo (MET-2).
export const US_COUNTRY_RS_ENGINE_VERSION = US_EQUITY_RS_ENGINE_VERSION;

// RS país intl: un engine_version por mercado para no tocar el UNIQUE de
// rs_weekly_snapshots (owner_id, snapshot_date, engine_version, base_currency).
// Varios mercados comparten base_currency (p. ej. DE y FR → EUR); el sufijo
// en engine_version evita migración DDL. Metodología idéntica en todos.
export const INTL_COUNTRY_RS_ENGINE_PREFIX = "statsedge-private-country-rs-local-";
export const INTL_COUNTRY_RS_ENGINE_SUFFIX = "-v1";

/** engine_version del ranking país para un mercado intl (hk → …-hk-v1). */
export function intlCountryRsEngineVersion(market = "") {
  const code = String(market || "").trim().toLowerCase();
  if (!code) return "";
  return `${INTL_COUNTRY_RS_ENGINE_PREFIX}${code}${INTL_COUNTRY_RS_ENGINE_SUFFIX}`;
}

/** engine_version del ranking país según mercado del símbolo; vacío si no soportado. */
export function countryRsEngineVersionForMarket(market = "") {
  const code = String(market || "").trim().toUpperCase();
  if (code === "US") return US_COUNTRY_RS_ENGINE_VERSION;
  if (GLOBAL_RS_INTL_MARKETS.includes(code)) return intlCountryRsEngineVersion(code);
  return "";
}

export function isCountryRsMarketSupported(market = "") {
  return Boolean(countryRsEngineVersionForMarket(market));
}

// Motor global privado (scripts/rs-global-private.mjs, MET-1b). Universo US
// investable + listas curadas intl, precios en USD vía FX.
export const PRIVATE_GLOBAL_RS_ENGINE_VERSION = "statsedge-private-global-rs-usd-v1";

// Motor europeo de mayo de 2026: escritor desconocido, datos congelados, cesta
// de 69 símbolos. No es candidato a canónico — se nombra aquí solo para que
// nadie lo confunda con los dos de arriba (spec pregunta 6).
export const LEGACY_EU_RS_ENGINE_VERSION = "statsedge-global-rs-usd-v1";

export const RS_LINE_PRIVATE = "private";
export const RS_LINE_PUBLIC = "public";

// Default = privado. Esta rama ES el producto personal; el spec fija que el
// track global no distorsione la versión pública, no al revés.
export const DEFAULT_RS_LINE = RS_LINE_PRIVATE;

const ENGINE_BY_LINE = {
  [RS_LINE_PRIVATE]: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
  [RS_LINE_PUBLIC]: US_EQUITY_RS_ENGINE_VERSION,
};

/** Línea de producto activa. Cualquier valor no reconocido cae al default. */
export function rsLine() {
  const raw = String(envValue("STATSEDGE_RS_LINE") || "").trim().toLowerCase();
  return ENGINE_BY_LINE[raw] ? raw : DEFAULT_RS_LINE;
}

/**
 * EL PIN. Único punto del código que decide qué engine_version alimenta la
 * etiqueta "RS". Cambiar el RS visible = cambiar DEFAULT_RS_LINE o la variable
 * de entorno; no ocurre solo porque un motor escriba una fila más nueva.
 */
export function canonicalRsEngineVersion() {
  return ENGINE_BY_LINE[rsLine()];
}

// Moneda base del canónico. USD fijo en la versión privada (spec pregunta 8);
// el esquema deja la puerta abierta a EUR como snapshot paralelo, no se
// construye ahora.
export const CANONICAL_RS_BASE_CURRENCY = "USD";

// Etiqueta de declaración obligatoria en cabecera/tooltip/ficha (spec
// § Superficies): el ranking privado NUNCA se presenta como "global" a secas.
export const PRIVATE_GLOBAL_RS_DISCLOSURE = "RS global · USD · universo privado curado";
export const US_ONLY_RS_DISCLOSURE = "RS · ranking del universo US";

export function canonicalRsDisclosure() {
  return rsLine() === RS_LINE_PUBLIC ? US_ONLY_RS_DISCLOSURE : PRIVATE_GLOBAL_RS_DISCLOSURE;
}
