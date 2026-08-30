# Spec — RS país (calidad intra-país, MET-2)

- **Fecha:** 2026-08-30
- **Rama:** `codex/statsedge-ui-polish`
- **Estado:** **propuesta para aceptación del dueño** — no autoriza implementación (MET-2b requiere OK explícito aparte).
- **Contratos reconciliados:** `docs/spec-rs-global-multi-mercado-fx.md` (aceptado) · `docs/tickets/MET-1-rs-global-fx.md` · `docs/tickets/MET-1b-rs-global-impl.md` · `docs/tickets/MET-1c-cron-rs-global.md` · `docs/adr-rs-universo-us.md` · `docs/adr-discovery-global-curated.md` invariante 10 · decisión dueño 2026-08-27 (`docs/backlog-activo.md`) · código vivo (`lib/rsCanonical.js`, `lib/rsEngines.js`, `lib/globalRs.js`, `scripts/rs-universe.mjs`, `scripts/rs-global-private.mjs`).

---

## Veredicto

El producto privado expone **dos rankings semanales independientes** sobre el mismo símbolo:

1. **`RS`** (canónico global, MET-1) — «¿dónde cazo en el universo privado multi-mercado, en USD?» Motor pinneado `statsedge-private-global-rs-usd-v1`, leído por `lib/rsCanonical.js`. **No se toca.**

2. **`RS país`** (nuevo eje, MET-2) — «¿qué tan fuerte es **dentro de su propio mercado**, en moneda local y sin FX?» Segunda columna analítica, etiqueta corta **`RS país`**, con tooltip que declara mercado y denominador («RS país · HK · universo privado curado · N símbolos · semana W»).

Para **US**, el RS país **no es un motor nuevo**: es la lectura directa de los snapshots ya producidos por `statsedge-us-equity-rs-v1` (`scripts/rs-universe.mjs`), congelado en MET-1 precisamente como base MET-2. Para **intl** (HK, CA, Europa-15, AU, JP — mismos mercados que MET-1), un motor nuevo calcula un ranking **por mercado**, sobre precios locales, misma fórmula 40/20/20/20, sin conversión FX.

El percentil de lote `rsCountryPct` que hoy escribe `lib/relativeStrength.js:243` sobre el batch del escaneo **deja de mostrarse como RS país** en tabla, vista rápida, ficha y chart. Sigue existiendo en `scan_results` para compatibilidad de filtros legacy y scoring batch; no se reinterpreta como métrica de producto (misma lección que `rsGlobalPct` vs `weeklyRs*`).

Nada de esto entra en `objectiveScore`, `compositeScore`, `totalScore` ni en los scores persistidos. El pin global de `lib/rsEngines.js` no cambia.

---

## Resolución vs MET-1 / ADR / dueño

| Cláusula | Origen | Resolución |
|---|---|---|
| Tres ejes de RS: global · país · tema | Dueño 2026-08-27 (`docs/backlog-activo.md`) | **Gana.** MET-2 cierra el eje país. Global (MET-1) y tema (MET-3) no se reabren. |
| `RS` canónico = ranking global FX privado | MET-1 aceptado | **Se conserva.** `lib/rsCanonical.js` sigue leyendo solo el motor global pinneado. RS país usa lector paralelo (`countryRs()` — nombre de implementación MET-2b). |
| `statsedge-us-equity-rs-v1` congelado → base RS país US | MET-1 spec §Universo, `lib/rsEngines.js:32-35` | **Se conserva literalmente.** US país = reusar snapshots US existentes; no renombrar ni rellenar ese `engine_version`. |
| RS local separada, sin FX | Addendum v3.2 §3 | **Se conserva en espíritu.** RS país intl = precios locales, sin `priceInBase`. No confundir con `rsRating` vs benchmark local (addendum §3): ese sigue siendo comparación punto a punto contra índice/ETF, no percentil semanal de universo. |
| Invariante 10: ranking solo sobre universo canónico versionado; nunca lote de cron ni merge N≥2 | `docs/adr-discovery-global-curated.md` §1.6 | **Se conserva sin relajación.** Población intl = listas curadas de `lib/universes.js` (misma que MET-1), no official-broad ni materializado nocturno. |
| Aislamiento del scoring | Addendum §4, MET-1 pregunta 7 | **Se conserva.** RS país semanal no alimenta scores. |
| `rs_weekly_*` fuera de `scan_results` | ADR US, MET-1 | **Se conserva.** El motor país escribe en las mismas tablas con `engine_version` distinto al global. |
| Decisión intl official-broad para **yield de scan** | Dueño 2026-08-28 (`docs/backlog-activo.md`) | **No se extiende al RS país.** El scan puede usar official-broad para descubrir; el ranking país sigue el universo curado versionado de caza (coherencia con MET-1 y reproducibilidad). |
| CHART-RS v2: tercer tono para RS país | `docs/tickets/CHART-RS-overlay-sin-pane.md` §v2 | **Se adopta como contrato de superficie** cuando exista serie semanal país (MET-2b). |

---

## Universo por país + engine_version

### Pregunta 1 — Identidad de producto

**Propuesta:** RS país es **columna segunda** junto al `RS` global. No sustituye nada del canónico MET-1. Etiqueta corta en tabla: **`RS país`**. Tooltip/cabecera: **`RS país · {mercado} · universo privado curado`** + N símbolos + semana. En ficha: número + serie histórica país (un solo `engine_version` por serie, misma regla que `readGlobalRsSeriesForSymbol`).

El lector global (`canonicalRs` / `weeklyRs*`) y el lector país (`countryRs` / `weeklyCountryRs*`) son **módulos distintos** con reglas de ausencia propias. Una fila puede tener RS global 83 y RS país 41 sin contradicción: miden ejes distintos.

**Alternativa rechazada:** sustituir el `RS` global por RS país en la columna canónica. Rechazada porque revierte MET-1 (el dueño pidió global para cazar HK/CA/EU en USD) y reintroduce la incoherencia multi-pantalla que `rsCanonical` eliminó — ahora entre global y país, no entre lote y universo.

**Alternativa rechazada:** reutilizar la columna retirada mostrando `rsCountryPct` del batch como RS país. Rechazada porque ese percentil cambia con cada escaneo y mezcla poblaciones distintas en presets multi-mercado (INT-2); es exactamente el anti-patrón del ADR US y de la invariante 10 aplicada al ámbito país.

### Pregunta 2 — Población por país

**Propuesta:**

| Mercado | Población del ranking país | `engine_version` |
|---|---|---|
| **US** | `equity` del último `universe_snapshot_symbols` con `passed=true`, `instrument_type ∈ (equity, listed-vehicle)`, menos fondos cerrados por patrón (`scripts/rs-universe.mjs:96,201-207`) — **idéntica** a la del motor US congelado | **`statsedge-us-equity-rs-v1`** (sin cambio; snapshots existentes = RS país US) |
| **HK, CA, GB…IE, AU, JP** (19 mercados = `GLOBAL_RS_INTL_MARKETS` de `lib/rsGlobalUniverse.js`) | `marketSymbols(code)` de `lib/universes.js` (CURATED + EXTRA + EXPANDED_CORE) **por mercado**, mismo conjunto que alimenta el denominador intl de MET-1 | **`statsedge-private-country-rs-local-v1`** con **`stats.scopeMarket`** en cada snapshot (ver pregunta 4) |

Cada mercado se rankea **solo contra sí mismo**. Un símbolo HK compite contra ~76 HK curados, no contra US ni contra el lote de 23/122 filas del cron.

**Versionado del denominador** (hereda MET-1 / invariante 10): cada snapshot país registra en `stats`: `scopeMarket`, git SHA de `lib/universes.js`, conteo definido/computable del mercado, hash de la lista de símbolos de ese mercado. Recalcular desde esa lista reproduce percentiles idénticos.

**Prohibido (heredado, no relajado):** rankear el lote de la sesión, el materializado del cron, el merge N≥2 de presets, ni official-broad HK/CA como denominador de percentil país.

**Alternativa rechazada:** official-broad (inventario HKEX ~2770, selección scan-refresh) como población país. Rechazada porque (a) la decisión de official-broad es para **yield de scan**, no para rankings versionados; (b) la mayoría no tiene 261 barras; (c) el denominador cambiaría con gates y caps nocturnos, violando reproducibilidad; (d) un RS país sobre 21 símbolos que pasaron el filtro de precio de una noche no es «calidad intra-HK», es ruido de lote.

**Alternativa rechazada:** un único ranking país multi-mercado bajo un denominador mezclado. Rechazada porque mezclar HK+DE+US en un percentil «país» no tiene interpretación de producto y contradice la decisión dueño («dentro del propio país»).

### Pregunta 4 — `engine_version`(s) y convivencia con pin global

**Propuesta:**

| Rol | `engine_version` | Pin en lectura |
|---|---|---|
| RS global (MET-1) | `statsedge-private-global-rs-usd-v1` | `canonicalRsEngineVersion()` en `lib/rsEngines.js` — **sin cambio** |
| RS país US | `statsedge-us-equity-rs-v1` | Constante dedicada `US_COUNTRY_RS_ENGINE_VERSION` (= mismo string) en lector país; **no** pasa por el pin global |
| RS país intl | `statsedge-private-country-rs-local-v1` | Constante `INTL_COUNTRY_RS_ENGINE_VERSION`; snapshots diferenciados por `stats.scopeMarket` |

**Convivencia:** tres familias de filas en `rs_weekly_items` para el mismo símbolo US en la misma semana es **esperado y correcto** (global USD, país US local, y eventualmente tema en MET-3). El lector global filtra solo el pin global; el lector país filtra `engine_version` país + `scopeMarket` del símbolo (`countryCode(symbol)`).

**Extensión de esquema en MET-2b (bloqueo técnico, no metodológico):** el UNIQUE actual de `rs_weekly_snapshots` es `(owner_id, snapshot_date, engine_version, base_currency)`. Varios mercados intl comparten `base_currency` (p. ej. DE y FR → EUR). MET-2b debe añadir `scope_market text` al snapshot y al UNIQUE, **o** usar `engine_version` sufijado por mercado (`statsedge-private-country-rs-local-hk-v1`, …). **Preferencia del spec:** sufijo en `engine_version` por mercado si se quiere evitar migración; `scope_market` en `stats` + UNIQUE ampliado si se prefiere un solo nombre de motor. La metodología es la misma en ambos casos.

**Alternativa rechazada:** ampliar `scripts/rs-global-private.mjs` para emitir también rankings país. Rechazada por el mismo argumento que separó el fork en MET-1b: mezclar dos métricas con poblaciones y exclusiones distintas en un script aumenta el riesgo de mover el histórico US/global al retocar país.

**Alternativa rechazada:** un solo `engine_version` país con percentil calculado en lectura cruzando filas del snapshot global. Rechazada porque el global rankea en USD sobre población conjunta (~5.7k); extraer sub-percentiles país de ahí no reproduce un ranking local sin FX y no deja denominador país auditable por mercado.

---

## Fórmula (sin FX)

### Pregunta 3 — Fórmula, ventanas, mínimos

**Propuesta:** **misma metodología** que `scripts/rs-universe.mjs` y MET-1, aplicada sobre **precios locales** (`daily_bars.close` en moneda de cotización), **sin FX**:

- Ventanas: 13 / 26 / 39 / 52 semanas.
- Pesos: 40 / 20 / 20 / 20 (`RETURN_WINDOWS_WEEKS` / `RETURN_WEIGHTS`).
- Mínimo de barras: 261 (`52×5+1`).
- Percentil: `percentileFromSorted`, escala 1–99, `min_sample=20` por mercado.
- Exclusiones, en orden: (1) barras insuficientes; (2) discontinuidad ≥3× en serie local (`detectPriceDiscontinuities`, sin ajustar splits); (3) para intl **no aplica** exclusión FX. GBX→GBP donde corresponda antes de calcular rendimientos (mismo precedente que MET-1b en conversión, aunque aquí no hay conversión a USD).

US: no recalcular si ya existe snapshot `statsedge-us-equity-rs-v1` de la semana; el cron solo asegura corrida semanal.

Intl: fork de `scripts/rs-universe.mjs` → `scripts/rs-country-private.mjs` (nombre orientativo MET-2b), un bucle por `scopeMarket`, dry-run → write manual → cron.

**Alternativa rechazada:** fórmula distinta (p. ej. pesos de `rsRawComposite` en `lib/relativeStrength.js`). Rechazada porque introduciría una tercera definición de «fuerza relativa» en producto (batch composite, global semanal, país semanal) y rompería comparabilidad con el histórico US ya validado en el ADR US A.1.

**Alternativa rechazada:** reusar rendimientos `perf3m/6m/12m` del escaneo. Rechazada: dependen del lote, no del universo país versionado, y arrastran contaminación de splits documentada en `docs/splits-daily-bars-2026-08-09.md`.

---

## Superficies

### Pregunta 5 — Tabla, ficha, chart

| Superficie | Qué número | Qué ausencia |
|---|---|---|
| **Tabla** — columna nueva `RS país` (sort/filtro propios, p. ej. `minCountryRsRating`) | `weeklyCountryRsRating` del motor país del mercado del símbolo | «–» + motivo persistido (`insufficient-bars`, `discontinuous`, `not-in-universe`, `market-not-supported`). Sort: ausentes al final (misma disciplina que `RS_SORT_ABSENT`) |
| **Vista rápida / `/review`** | Mismo lector país que tabla | Mismo «–» + motivo; nunca `rsCountryPct` del batch |
| **Ficha** — badge / franja descriptiva | Número + serie histórica país (sustituye el «ausente con motivo» de `DescriptiveStrip.jsx:14-16` cuando MET-2b esté activo) | Serie de un solo engine país; no mezclar con serie global |
| **Chart overlay** (CHART-RS v2) | Línea tercer tono (`--soft` o token claro) desde serie país semanal | Toggle independiente de línea RS global; sin panel extra |
| **Cabecera/tooltip columna** | «RS país · {mercado} · universo privado curado», N, semana | — |
| **`rsCountryPct` / `minRsCountryPct` legacy** | **No se muestran como RS país** en superficies de producto | El filtro `minRsCountryPct` en `lib/screenerFilterCatalog.js` se **migra** en MET-2b a leer el ranking semanal país (o se depreca con aviso) — no en este spec |
| **Scoring, leaderboards, `market-health`** | Sin cambio | Siguen con percentiles de lote donde ya lo hacen |

**Relación con `rsRating` (benchmark):** la comparación vs índice en el gráfico (`projectBenchmarkLineSeries`) permanece; no es RS país.

---

## Cadencia / jobs

### Pregunta 7 — Cadencia

**Propuesta:** pipeline semanal **aparte pero acoplado** al domingo post-global:

| Job | Script | Cuándo | Notas |
|---|---|---|---|
| RS global (existente, MET-1c) | `rs-fx-ingest.mjs` + `rs-global-private.mjs` | Dom **06:00 UTC** (`.github/workflows/rs-global-private.yml`) | Sin cambio |
| RS país US | `rs-universe.mjs --population=equity --write` | Dom **07:00 UTC**, workflow nuevo o paso añadido en workflow hermano | Hoy manual; MET-2b lo cronifica. Idempotente por UNIQUE semanal |
| RS país intl | `rs-country-private.mjs --write` (MET-2b) | Dom **07:15 UTC** mismo workflow «RS país privado» | Tras US o en paralelo si recursos lo permiten; **después** del cierre semanal (misma política anti-lookahead que MET-1) |

**Orden:** FX + global primero (MET-1c); país después. El país **no depende** del snapshot global para calcular (precios locales), pero compartir barras/infra tras el cierre semanal evita carreras con `refresh-bars` (02:00 UTC) y alinea semana W.

**Alternativa rechazada:** fundir país intl dentro del workflow global existente sin script separado. Rechazada: acopla fallos, alarga timeout del job global (~2,5 min hoy, intl añadiría N mercados), y viola la separación de motores acordada en MET-1b.

**Alternativa rechazada:** solo cron US (`rs-universe`) y país intl bajo demanda manual. Rechazada porque deja HK/CA/EU en «–» país perpetuo — el mismo dolor que MET-1 resolvió para el eje global.

**Post-MIGRATE Mini:** mismo par de scripts vía launchd (patrón MET-1c / MIGRATE-3); GHA puede quedar como respaldo o apagarse — decisión ops, no MET-2.

---

## Scoring

### Pregunta 6 — Scoring

**Propuesta: confirmar prohibición (default MET-1).** Ningún campo derivado del RS país semanal entra en `objectiveScore`, `compositeScore`, `totalScore`, ni sustituye `rsGlobalPct` / `rsCountryPct` persistidos en `scan_results`. Los filtros de UI pueden leer RS país semanal (lectura, no scoring).

`rsCountryPct` del batch (`enrichRelativePercentiles`) **no se elimina** en MET-2: sigue alimentando pipelines que ya lo referencian (`lib/screenerPipeline.js:484`, leaderboards). MET-2b solo deja de **mostrarlo** como RS país y redirige filtros de producto al ranking semanal cuando exista.

**Alternativa rechazada:** usar RS país semanal como input de `objectiveScore` para presets «Líderes intl». Rechazada porque condiciona scores a cobertura de barras intl y a composición del universo curado, reabre auditoría de coherencia (Camino A) y mezcla un eje analítico nuevo con señal de trading sin validación del dueño.

---

## Fuera / bloqueos

### Pregunta 8 — Qué NO es MET-2

MET-2 (y su eventual MET-2b) **no** incluye:

- **MET-3** (RS tema / ocupación).
- **VCP** ni indicadores nuevos.
- **Scoring nuevo** ni cambios en `lib/relativeStrength.js` salvo deprecación de display de `rsCountryPct`.
- **Cutover línea pública US-only** (`STATSEDGE_RS_LINE=public`) — sigue en `statsedge-us-equity-rs-v1` como RS canónico público; RS país es track privado.
- **Migrate Mini**, yield intl ops (INT-3), R-06 perf.
- **Reabrir MET-1** (FX, universo global, pin global).
- **Tocar `scripts/rs-global-private.mjs`** para país (fork separado).
- **UI / chart / columnas** (solo se especifican; implementación MET-2b).
- **Cron / `--write`** (MET-2c, tras MET-2b verificado).
- **Cambiar official-broad del scan** — ámbito INT-3, independiente.

**Bloqueos técnicos para MET-2b** (no reabren metodología):

1. Lector país (`countryRs`, hidratación `weeklyCountryRs*`) paralelo a `rsCanonical` / `globalRs`.
2. Script `rs-country-private.mjs` + persistencia de motivos de exclusión (patrón MET-1b).
3. Resolución UNIQUE multi-mercado (sufijo `engine_version` o migración `scope_market`).
4. Cron domingo US + intl.
5. Migración filtro `minRsCountryPct` y columna tabla.
6. CHART-RS v2 línea país (puede ser ticket UI separado si MET-2b backend primero).

---

## Tickets siguientes (MET-2b impl solo si dueño OK)

| Ticket | Contenido | Condición |
|---|---|---|
| **MET-2b** (implementación) | Lector país + script intl + cron US/intl + motivos persistidos + columna tabla + migración filtro + tests (pin global intacto, scoring untouched) | Aceptación de este spec **y** autorización explícita del dueño |
| **MET-2c** (cron ops) | Workflow GHA «RS país privado» + documentación launchd post-MIGRATE | Tras MET-2b verificado en corrida manual |
| **CHART-RS-2** (opcional) | Overlay línea RS país (tercer tono) | Puede paralelizarse tras hidratación serie en ficha |
| **MET-3** | Spec RS tema | No empieza aquí |

---

## LO QUE NO VERIFIQUÉ

- **Nada contra Supabase en esta sesión:** poblaciones reales, último snapshot `statsedge-us-equity-rs-v1`, ni si `rs-universe.mjs` ha corrido desde MET-1c — tomado de backlog y MET-1c notes (5567 rankeadas global W35).
- **Conteos exactos por mercado** de listas curadas — heredados del spec MET-1 (~76 HK, etc.), no recontados sobre `lib/universes.js` en esta sesión.
- **Coste/duración** de `rs-country-private.mjs` multi-mercado (19 bucles × ~N símbolos): extrapolación desde MET-1b global, no medido.
- **Migración DDL** `scope_market` vs sufijos `engine_version`: preferencia declarada, trade-off final es decisión de implementación MET-2b.
- **Comportamiento exacto de filtros** `minRsCountryPct` con usuarios que tengan presets guardados — diseño objetivo, no probado.
- **Ninguna superficie UI** — spec only.
- **`docs/addendum-rs-global-basecurrency-v3.2.md` §3** leído por grep, no entero línea a línea.
