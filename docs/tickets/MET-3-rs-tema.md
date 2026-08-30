# MET-3 — Spec RS tema (ocupación / theme)

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** solo spec / diseño — **sin código, sin schema, sin escrituras, sin UI, sin pin, sin scoring**  
**Modelo:** Fable 5 (juicio metodológico). Fallback: Opus. **No** Composer: contratos vivos.  
**Origen:** decisión dueño 2026-08-27 · backlog `MET-3` · post MET-2/CHART-RS-2/RS-SERIES-1 (2026-08-31)  
**Entrega:** `docs/spec-rs-tema.md`  
**Copia activa:** `docs/tickets/activo.md`

## Por qué ahora

MET-1/2 + CHART-RS-2 + RS-SERIES-1 cerrados. Falta el tercer eje del dueño (27-ago): **RS tema** = calidad intra-ocupación. Hoy `rsSectorPct` es percentil de lote sobre `theme || sector` — no es RS tema de producto.

No implementar. Entregar spec que el dueño acepte o rechace. Implementación = **MET-3b** solo con autorización explícita.

## Contratos a heredar (leer enteros)

1. **MET-1** `docs/spec-rs-global-multi-mercado-fx.md` — global = `RS` canónico; universo curado intl; FX USD; scoring prohibido.
2. **MET-2** `docs/spec-rs-pais.md` — segunda columna país; patrón lector paralelo + `engine_version` por scope; cron domingo post-global.
3. **ADR US** + `lib/rsCanonical.js` — lote ≠ RS; `weeklyRs*` vs `rsGlobalPct`.
4. **Invariante 10** — nunca denominador = lote cron / merge N≥2.
5. **Dueño 27-ago** — tres ejes: global · país · tema.
6. **`lib/businessTheme.js`** — taxonomía de ocupación ya en producto.
7. **`lib/relativeStrength.js:244`** — `rsSectorPct` batch = qué NO reutilizar.
8. **CHART-RS v2** — RS sector overlay aparcado → resuelto como RS tema (cuarto tono).

## Preguntas que el spec debe responder

1. Identidad: ¿columna tercera `RS tema` junto a global + país? Etiqueta UX.
2. Qué es «tema»: taxonomía, estabilidad, asignación si falta.
3. Población: universo MET-1 cross-market por theme; prohibido lote / `rsSectorPct`.
4. Fórmula: 40/20/20/20, USD vs local, `min_sample` por theme.
5. `engine_version`(s) y convivencia con pin global y motores país.
6. Superficies: tabla / ficha / chart (4º tono); ausencias con motivo.
7. Scoring: default NO (como MET-1/2).
8. Cadencia: domingo post país vs job aparte.
9. Qué NO es MET-3.

## Criterios de aceptación

- [x] `docs/spec-rs-tema.md` existe con las secciones del formato acordado.
- [x] Las 9 preguntas tienen **propuesta + alternativa rechazada**.
- [x] No contradice MET-1/2 aceptados ni mueve pin global ni país.
- [x] Sin diff de código.
- [ ] Dueño acepta o pide recorte **antes** de MET-3b.

**Nota orquestador (2026-08-31):** entrega verificada en filesystem; modelo de programación pudo ser Composer pese a pedido Fable — contenido coherente con MET-1/2; aceptación dueño sigue siendo el gate.

## Fuera de alcance

Código, schema, UI, scoring, pin, MET-3b/c, VCP, MET-4…6, cutover público, MIGRATE, yield intl, commit/push.

## Plantilla de retorno (programación)

```
## Resumen
## Archivos
## Tests
(n/a spec)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
