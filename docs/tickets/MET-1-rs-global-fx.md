# MET-1 — Spec RS global multi-mercado + FX

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** solo spec / diseño — **sin código, sin schema, sin escrituras, sin scans**  
**Modelo:** Fable 5 (juicio metodológico). Fallback: Opus. **No** Composer/Gemini: hay tres contratos vigentes que se pisan.  
**Origen:** decisión dueño 2026-08-27 · backlog `MET-1`  
**Copia:** `docs/tickets/MET-1-rs-global-fx.md`

## Por qué ahora

Oleada UI cerrada (`5eca07f`). Uso privado multi-mercado (US · HK · CA · Europa). El RS que el producto enseña (`lib/rsCanonical.js`) es el ranking semanal **solo universo US** (`statsedge-us-equity-rs-v1` vía `scripts/rs-universe.mjs`). Intl muestra «–» + motivo — **correcto hoy**, inútil para cazar HK/CA/EU.

No implementar. Entregar un spec que el dueño pueda aceptar o rechazar. Implementación = ticket posterior **solo si** el dueño autoriza explícitamente (addendum §13 sigue vigente hasta esa autorización).

## Tres contratos a reconciliar (leer enteros, no resumir de memoria)

1. **Addendum** `docs/addendum-rs-global-basecurrency-v3.2.md` (2026-07-16, aprobado, **sin implementación autorizada**): métrica **nueva** `RS global(baseCurrency)` distinta de `rsGlobalPct`; FX en fórmula canónica `priceInBase = localPrice × FX[C→B]`; **prohibido** entrar en scoring; snapshot `scan_results` inmutable; puerta §13 (Camino A + autorización humana).
2. **ADR** `docs/adr-rs-universo-us.md` + código vivo: el RS de producto **ya no es** `scan_results.rsGlobalPct`. Es percentil semanal US (`rs_weekly_items`, motor `statsedge-us-equity-rs-v1`, pesos 40/20/20/20 sobre 13/26/39/52w). `rsGlobalPct` sigue alimentando scores; no se muestra como RS (`lib/rsCanonical.js`).
3. **Dueño 2026-08-27** (backlog): RS **global** = un solo ranking del universo **privado** con **ajuste por divisa**; RS **país** = calidad intra-país (MET-2); RS **tema** = ocupación (MET-3). Versión privada, no lanzamiento público.

El spec debe decir **qué gana, qué se depreca y qué se conserva**. No vale «cumplir los tres a la vez» si son incompatibles: hay que nombrar el conflicto y proponer una resolución.

Conflicto central a resolver (no dejarlo en TBD):

| Lectura | Implicación |
|---|---|
| Addendum | Columna analítica **nueva** (`RS global · USD` / `· EUR`); el RS actual no se reinterpreta |
| Dueño 27-ago | **Un** ranking global con FX = el RS de caza (HK no puede seguir en «–») |
| Código hoy | Una sola etiqueta `RS` = ranking US; intl ausente |

## Objetivo

Documento `docs/spec-rs-global-multi-mercado-fx.md` (nombre fijo) que un ticket de implementación posterior pueda ejecutar **sin reabrir metodología**.

## Entradas obligatorias (leer, no reescribir)

- Los tres contratos de arriba.
- `lib/rsCanonical.js`, `lib/globalRs.js`, `scripts/rs-universe.mjs` (qué escribe el motor US; `engine_version` por población equity/etf).
- `docs/adr-discovery-global-curated.md` invariante 10: RS global solo sobre universo canónico completo/versionado — **nunca** sobre lote de cron.
- Backlog INT: intl sin `rs_weekly_items`; percentil de lote **no** es RS.
- INT-0: población real persistida (US ~3319; HK/AU/CA/EU/JP = decenas, no universo exchange). Un ranking «global» sobre 23 filas HK + 3319 US **no es global**.
- Addendum §15 (decisiones humanas pendientes): FX provider, `fxMaxAge`, as-of, cruces, cobertura. El spec las **cierra o las marca como bloqueo de implementación**, no las copia como lista abierta.

## Preguntas que el spec debe responder (con propuesta + alternativa rechazada)

1. **Identidad de producto:** ¿el ranking FX **es** el `RS` de tabla/ficha/review, o es una columna segunda y el US-only permanece? Si es el RS, ¿qué pasa con `statsedge-us-equity-rs-v1` (¿pasa a MET-2 RS país US)?
2. **Universo de ranking (privado):** conjunto **fijo y versionado** de mercados/símbolos. Candidatos a evaluar: (a) mercados con scan materializado usable hoy; (b) curated-core + EXTRA de `lib/universes.js` para US/HK/CA/EU/AU/JP; (c) todo `DEFAULT_MARKETS`. **Prohibido** rankear el lote de la sesión o el merge N≥2 de presets.
3. **Cobertura honesta:** umbral mínimo de símbolos por mercado para entrar al ranking; qué hacer con HK 23 vs inventario 2770; etiqueta UX si el universo es «privado curado» y no «global exchange».
4. **FX:** fuente real disponible ahora (Yahoo/`daily_bars` + campos `fx_rate` del motor viejo `statsedge-global-rs-usd-v1`) vs proveedor con licencia (Twelve Data aplazado). Política si no hay FX apto: `null` + motivo, nunca 0. Convención = addendum §7 (multiplicar, no adivinar).
5. **Fórmula:** ¿reusar 40/20/20/20 y 13/26/39/52w del motor US sobre precios **ya convertidos**, o otra? Historia mínima / series discontinuas: misma exclusión que `scripts/rs-universe.mjs` (no ajustar splits).
6. **`engine_version`:** nombre nuevo (no rellenar el motor US ni mezclar con `statsedge-global-rs-usd-v1` de mayo, cesta EU n=69). Cómo conviven lecturas en `lib/globalRs.js` (filtro de un solo engine).
7. **Scoring:** confirmar o relajar addendum §4. Default del spec: **conservar prohibición** (FX no entra en `objectiveScore` / `compositeScore` / `totalScore` / `rsGlobalPct` persistido).
8. **USD vs EUR:** ¿preferencia de usuario (addendum) o USD fijo en versión privada? Una sola columna visible.
9. **Qué no es MET-1:** MET-2/3, VCP, weekly-changes intl, scoring nuevo, licencia pública, cron de implementación.

## Formato del documento de entrega

```
## Veredicto
(qué es el RS global en producto privado; 8–15 líneas)

## Resolución de contratos
(tabla: cláusula addendum / ADR / dueño → se conserva, se actualiza, o se declara obsoleta)

## Universo y engine_version
(conjunto, exclusiones, nombre de motor, muestra mínima)

## FX
(fuente, fórmula, as-of, fallos → null)

## Superficies
(tabla, ficha, review, chart: qué número, qué ausencia)

## Fuera / bloqueos de implementación
(lo que un ticket MET-1b NO puede hacer hasta autorización dueño)

## Tickets siguientes
(MET-1b impl. solo si dueño OK; MET-2/3 no empiezan aquí)

## LO QUE NO VERIFIQUÉ
```

## Alcance

### Dentro

- Un markdown de spec en `docs/`.
- Si hace falta citar código, citas con ruta+línea. Sin parches.

### Fuera

- Cualquier `.js` / `.jsx` / SQL / script / test.
- Escrituras Supabase, backfill, cron, `--write`.
- Reabrir oleada UI.
- Autorizar implementación (eso lo firma el dueño en el chat de orquestación).

## Verificación (orquestador, no programación)

1. El markdown existe y responde las 9 preguntas sin TBD fofos.
2. No hay diff de código.
3. No contradice `rsCanonical` (lote ≠ RS) salvo que el spec lo deprecie **por escrito**.
4. Dueño acepta o pide recorte **antes** de MET-1b.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
(n/a spec)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
