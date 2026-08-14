// Contrato del espacio de nombres de `scans.local_id`.
//
// El 14 de agosto de 2026 una corrida `--limit=300` de scripts/scan-universe.mjs
// se convirtió en la fuente de las Listas durante horas: su local_id era
// indistinguible del nocturno real, y readNightlyUsScan coge el más reciente
// que case con "materialized:US:*". Estos tests fijan las tres propiedades que
// impiden que vuelva a pasar.

import { describe, expect, it } from "vitest";

import {
  CRON_LOCAL_ID_PREFIX,
  NIGHTLY_US_LOCAL_ID_PREFIX,
  TEST_LOCAL_ID_PREFIX,
  isNightlyUsLocalId,
  isTestLocalId,
  nightlyUsLocalIdPattern,
} from "@/lib/scanLocalId";
import { classifyScan } from "@/scripts/purge-scans.mjs";
import { localIdPrefixFor, parseArgs } from "@/scripts/scan-universe.mjs";

const NOCTURNO = "materialized:US:2026-08-14:o0:l5607";
const PRUEBA = "test:materialized:US:2026-08-14:o0:l300";
const CRON_OTRO_MERCADO = "materialized:US-HK-AU:2026-08-14:o0:l12";
const INTERACTIVO = "server-scan-73a25c8c-d83b-4d67-a2ff-6f03fc6f6746";

// Réplica exacta del filtro que hace PostgREST con `local_id=like.<patrón>`:
// el `*` del patrón es el `%` de SQL LIKE.
function matchesLike(localId, pattern) {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(localId);
}

describe("una corrida de prueba no puede ser la fuente de las Listas", () => {
  it("el patrón `like` de readNightlyUsScan no casa con un local_id de prueba", () => {
    // Esta es LA propiedad. Si cae, las Listas vuelven a leer una corrida
    // acotada como si fuera el escaneo de la noche.
    expect(matchesLike(NOCTURNO, nightlyUsLocalIdPattern())).toBe(true);
    expect(matchesLike(PRUEBA, nightlyUsLocalIdPattern())).toBe(false);
  });

  it("el prefijo de prueba va DELANTE, no detrás", () => {
    // Un sufijo (materialized:US:...:test) seguiría casando con el `like`.
    expect(PRUEBA.startsWith(TEST_LOCAL_ID_PREFIX)).toBe(true);
    expect(isNightlyUsLocalId(PRUEBA)).toBe(false);
    expect(isNightlyUsLocalId(NOCTURNO)).toBe(true);
  });

  it("distingue prueba de nocturno, cron e interactivo", () => {
    expect([NOCTURNO, CRON_OTRO_MERCADO, INTERACTIVO].map(isTestLocalId)).toEqual([false, false, false]);
    expect(isTestLocalId(PRUEBA)).toBe(true);
    expect(NIGHTLY_US_LOCAL_ID_PREFIX.startsWith(CRON_LOCAL_ID_PREFIX)).toBe(true);
  });
});

describe("el espacio de nombres de prueba se activa solo con --limit", () => {
  it("una corrida acotada es prueba sin pedir nada", () => {
    expect(localIdPrefixFor(parseArgs(["--write", "--limit=300"]))).toBe(TEST_LOCAL_ID_PREFIX);
  });

  it("la corrida del nocturno real no lleva prefijo", () => {
    // Argumentos literales de .github/workflows/scan-universe.yml.
    expect(localIdPrefixFor(parseArgs(["--write", "--concurrency=4"]))).toBe("");
  });

  it("--nocturno-real permite escribir como nocturno pese a --limit", () => {
    expect(localIdPrefixFor(parseArgs(["--write", "--limit=300", "--nocturno-real"]))).toBe("");
  });

  it("el dry-run acotado también se anuncia como prueba, para que el reporte no mienta", () => {
    expect(localIdPrefixFor(parseArgs(["--dry-run", "--limit=50"]))).toBe(TEST_LOCAL_ID_PREFIX);
  });
});

describe("purge-scans reconoce las corridas de prueba por lo que son", () => {
  const cutoff = Date.parse("2026-08-07T00:00:00Z");
  const row = (localId, createdAt = "2026-08-14T12:00:00Z") => ({ local_id: localId, created_at: createdAt });

  it("las borra siempre, sin ventana de retención", () => {
    const veredicto = classifyScan(row(PRUEBA), cutoff);
    expect(veredicto.keep).toBe(false);
    expect(veredicto.reason).toMatch(/corrida de prueba/);
  });

  it("no las etiqueta como interactivas, que es lo que hacía por descarte", () => {
    // El informe de purge-scans es lo que el dueño lee antes de aprobar un
    // borrado: decir "interactivo (server-scan-*)" de una corrida nocturna de
    // prueba es una etiqueta falsa en el sitio donde más importa.
    expect(classifyScan(row(PRUEBA), cutoff).reason).not.toMatch(/interactivo/);
    expect(classifyScan(row(INTERACTIVO), cutoff).reason).toMatch(/interactivo/);
  });

  it("sigue sin tocar el nocturno real", () => {
    const veredicto = classifyScan(row(NOCTURNO), cutoff);
    expect(veredicto.keep).toBe(true);
    expect(veredicto.reason).toMatch(/nocturno/);
  });

  it("el prefijo de prueba gana sobre el del nocturno, aunque lo contenga", () => {
    // "test:materialized:US:..." contiene "materialized:US:" más adelante en
    // la cadena. Si la rama de prueba no fuera la primera, un startsWith mal
    // ordenado podría clasificarlo como nocturno y conservarlo para siempre.
    expect(PRUEBA.includes(NIGHTLY_US_LOCAL_ID_PREFIX)).toBe(true);
    expect(classifyScan(row(PRUEBA), cutoff).keep).toBe(false);
  });
});
