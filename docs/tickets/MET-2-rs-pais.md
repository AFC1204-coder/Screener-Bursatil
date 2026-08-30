# MET-2 — Spec RS país (calidad intra-país)

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** solo spec / diseño — **sin código, sin schema, sin escrituras, sin UI, sin pin de rsEngines, sin scoring**  
**Modelo:** Fable 5 (juicio metodológico). Fallback: Opus. **No** Composer: hay contratos vivos que se pisan.  
**Origen:** decisión dueño 2026-08-27 · backlog `MET-2` · relleno post-MET-1c (2026-08-30)  
**Entrega:** `docs/spec-rs-pais.md`  
**Copia activa:** `docs/tickets/activo.md`

## Por qué ahora

MET-1c cerrado (cron global dom 06:00 UTC, smoke lectura OK). El RS de caza es global USD; falta el eje **intra-país** acordado el 27-ago. El motor US `statsedge-us-equity-rs-v1` quedó congelado como base MET-2; intl sin definición de ranking país.

No implementar. Entregar spec que el dueño acepte o rechace. Implementación = **MET-2b** solo con autorización explícita.

## Contratos a heredar (leer enteros)

1. **MET-1** `docs/spec-rs-global-multi-mercado-fx.md` — global = `RS` canónico; US engine congelado → MET-2; scoring FX prohibido; universo curado intl.
2. **MET-1b/c** — fork `rs-global-private.mjs`, pin `lib/rsEngines.js`, cron GHA, motivos persistidos.
3. **ADR US** + `lib/rsCanonical.js` — lote ≠ RS; `weeklyRs*` vs `rsGlobalPct`.
4. **Invariante 10** — nunca denominador = lote cron / merge N≥2.
5. **Dueño 27-ago** — tres ejes: global · país · tema.

## Preguntas que el spec debe responder

1. Identidad: ¿columna segunda o sustitución? Etiqueta UX.
2. Población: US = `statsedge-us-equity-rs-v1`; intl = curado vs official-broad.
3. Fórmula: 40/20/20/20 local sin FX; ventanas / min barras.
4. `engine_version`(s) y convivencia con pin global.
5. Superficies: tabla / ficha / chart (CHART-RS v2 tono país).
6. Scoring: default NO (como MET-1).
7. Cadencia: cron domingo post-global vs job aparte vs solo US.
8. Qué NO es MET-2.

## Criterios de aceptación

- [x] `docs/spec-rs-pais.md` existe con las 9 secciones del formato acordado.
- [x] Las 8 preguntas tienen **propuesta + alternativa rechazada**.
- [x] No contradice MET-1 aceptado ni mueve el pin global.
- [x] Sin diff de código.
- [x] Dueño acepta o pide recorte **antes** de MET-2b. (2026-08-30 · 4 cláusulas OK)

## Fuera de alcance

Código, schema, UI, scoring, pin, MET-3, VCP, cutover público, MIGRATE, yield intl ops, commit/push.

## Plantilla de retorno (programación)

```
## Resumen
## Archivos
## Tests
(n/a spec)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
