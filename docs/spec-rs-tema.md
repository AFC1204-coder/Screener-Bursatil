# Spec — RS tema (calidad intra-ocupación / theme, MET-3)

- **Fecha:** 2026-08-31
- **Rama:** `codex/statsedge-ui-polish`
- **Estado:** **aceptado** (dueño 2026-08-31 · review Grok 4.6 + parche orquestador) — autoriza **MET-3b** cuando el dueño lo active.
- **Addendum aceptación:** denominador = solo 12 `THEME_RULES`; residual/`General`/sector Yahoo → no ranking; perfil vacío → `theme-profile-missing`; ejemplos sin TW; overlay `--rs-theme` (nunca `--soft`).
- **Contratos reconciliados:** `docs/spec-rs-global-multi-mercado-fx.md` (aceptado) · `docs/spec-rs-pais.md` (aceptado) · `docs/tickets/MET-1-rs-global-fx.md` · `docs/tickets/MET-2-rs-pais.md` · `docs/adr-discovery-global-curated.md` invariante 10 · decisión dueño 2026-08-27 (`docs/backlog-activo.md`) · código vivo (`lib/rsCanonical.js`, `lib/rsEngines.js`, `lib/countryRs.js`, `lib/businessTheme.js`, `lib/relativeStrength.js`) · CHART-RS v2 (`docs/tickets/CHART-RS-overlay-sin-pane.md`, `docs/tickets/CHART-RS-2-overlay-pais.md`)

---

## Veredicto

El producto privado expone **tres rankings semanales independientes** sobre el mismo símbolo:

1. **`RS`** (canónico global, MET-1) — «¿dónde cazo en el universo privado multi-mercado, en USD?» Motor pinneado `statsedge-private-global-rs-usd-v1`. **No se toca.**

2. **`RS país`** (MET-2) — «¿qué tan fuerte es **dentro de su mercado**, en moneda local?» Segunda columna analítica. **No se toca.**

3. **`RS tema`** (nuevo eje, MET-3) — «¿qué tan fuerte es **dentro de su ocupación de negocio** (theme), frente a pares del mismo tema en todo el universo privado curado?» Tercera columna analítica, etiqueta corta **`RS tema`**, con tooltip que declara el theme y denominador («RS tema · Semis / fotonica · universo privado curado · N símbolos · semana W»).

El ranking tema cruza mercados (US + intl del universo MET-1) bajo las **12 claves curadas** de `THEME_RULES` en `lib/businessTheme.js` (misma inferencia que ficha/screener, **sin** el fallback a `sector` Yahoo como denominador de ranking), calculado con la **misma fórmula 40/20/20/20** que global y país pero sobre **precios en USD vía FX** (como MET-1), porque un NVDA y un 0981.HK en «Semis / fotonica» deben compararse en una moneda común.

El percentil de lote `rsSectorPct` que hoy escribe `lib/relativeStrength.js:244` sobre `theme || sector` del batch **deja de mostrarse como RS tema** en tabla, vista rápida, ficha y chart. Sigue existiendo en `scan_results` para compatibilidad de filtros legacy y scoring batch (`minRsSectorPct`, `weaknessScore`); no se reinterpreta como métrica de producto (misma lección que `rsGlobalPct` / `rsCountryPct` vs rankings semanales).

Nada de esto entra en `objectiveScore`, `compositeScore`, `totalScore` ni en los scores persistidos. El pin global de `lib/rsEngines.js` no cambia.

---

## Resolución vs MET-1 / MET-2 / ADR / dueño

| Cláusula | Origen | Resolución |
|---|---|---|
| Tres ejes de RS: global · país · tema | Dueño 2026-08-27 (`docs/backlog-activo.md`) | **Gana.** MET-3 cierra el eje tema. Global (MET-1) y país (MET-2) no se reabren. |
| `RS` canónico = ranking global FX privado | MET-1 aceptado | **Se conserva.** `lib/rsCanonical.js` sigue leyendo solo el motor global pinneado. RS tema usa lector paralelo (`themeRs()` — nombre de implementación MET-3b). |
| RS país = segunda columna, precios locales intra-mercado | MET-2 aceptado | **Se conserva.** RS tema es tercera columna; no sustituye global ni país. |
| Invariante 10: ranking solo sobre universo canónico versionado; nunca lote de cron ni merge N≥2 | `docs/adr-discovery-global-curated.md` §1.6, capa 3 | **Se conserva sin relajación.** Población tema = símbolos del universo privado curado MET-1 agrupados por `businessTheme.key`; nunca el lote de la sesión ni `rsSectorPct` batch. |
| Aislamiento del scoring | Addendum §4, MET-1/2 pregunta 7 | **Se conserva.** RS tema semanal no alimenta scores. |
| `rs_weekly_*` fuera de `scan_results` | ADR US, MET-1 | **Se conserva.** El motor tema escribe en las mismas tablas con `engine_version` distinto al global y al país. |
| Taxonomía de producto = `businessTheme`, no sector GICS crudo | `lib/businessTheme.js`, ficha (`StockClient.jsx` campo Tema), `lib/researchRow.js:38` · review Grok 2026-08-31 | **Se adopta con cierre:** denominador RS tema = **solo** las 12 keys de `THEME_RULES`. El fallback UI `sector` Yahoo / `General` de `inferBusinessTheme` **no** crea `engine_version` ni percentil. |
| CHART-RS v2: RS sector aparcado hasta spec tema | `docs/tickets/CHART-RS-overlay-sin-pane.md` §v2, CHART-RS-2 | **Se resuelve:** overlay «RS tema» con token dedicado **`--rs-theme`** (cuarto tono; **nunca** `--soft`, reservado a país en CHART-RS-2). |

---

## Universo por tema + engine_version

### Pregunta 1 — Identidad de producto

**Propuesta:** RS tema es **columna tercera** junto a `RS` global y `RS país`. No sustituye ninguno de los dos. Etiqueta corta en tabla: **`RS tema`**. Tooltip/cabecera: **`RS tema · {theme} · universo privado curado`** + N símbolos + semana. En ficha: número + serie histórica tema (un solo `engine_version` por serie, misma regla que `readGlobalRsSeriesForSymbol` / serie país).

Los tres lectores (`canonicalRs`, `countryRs`, `themeRs`) son **módulos distintos** con reglas de ausencia propias. Una fila puede tener RS global 83, RS país 41 y RS tema 92 sin contradicción: miden ejes distintos (un líder global puede ser mediano en su país y líder en su theme).

**Alternativa rechazada:** reutilizar la columna retirada «Grp» mostrando `rsSectorPct` del batch como RS tema. Rechazada porque ese percentil cambia con cada escaneo, usa `rsCompositeRaw` del lote (no la fórmula semanal 40/20/20/20), y agrupa por `theme || sector` sin universo versionado — el anti-patrón documentado en MET-1/2 y en `lib/rsCanonical.js`.

**Alternativa rechazada:** fusionar RS tema con RS país bajo una sola columna «RS local». Rechazada porque país y tema responden preguntas distintas del dueño (geografía vs ocupación) y mezclarlos reintroduce la incoherencia multi-pantalla que los lectores canónicos eliminaron.

### Pregunta 2 — Qué es «tema»

**Propuesta:**

| Aspecto | Decisión |
|---|---|
| **Taxonomía (ranking)** | **Solo** las 12 keys de `THEME_RULES` en `lib/businessTheme.js`. Ejemplos: `Semis / fotonica`, `Software / IA`, `Medtech / biotech`. **Prohibido** usar como denominador: `sector` Yahoo crudo, `industry`, o el fallback UI `General` / sector string que emite hoy `inferBusinessTheme` (L129–131). |
| **Asignación** | Misma inferencia que ficha/screener (`SECTOR_INDUSTRY_RULES` → `THEME_RULES` + summary). Para el **motor RS tema**, si el key resultante **no** está en las 12 `THEME_RULES` → residual: **no rankear** (`theme-residual`). La columna «Tema» de UI puede seguir mostrando el fallback de `businessThemeKey`; RS tema no. |
| **Estabilidad semana a semana** | El theme rankeable es **determinista** dado `(sector, industry, summary)` y la versión de `businessTheme.js`, restringido a las 12 keys. Cambia solo si cambian esos inputs o las reglas (→ `engine_version` nuevo o minor en `stats.themeRulesSha`). No depende del lote del escaneo. |
| **Quién asigna si falta perfil** | Una sola regla: sin `sector`/`industry`/`businessSummary` mínimos → `null` + motivo **`theme-profile-missing`**. **No** inventar `General` ni mapear a sector Yahoo. |
| **Residual / `General`** | Símbolos cuyo key UI cae fuera de las 12 (incl. `General` y p. ej. «Basic Materials») → siempre «–» + **`theme-residual`** (tooltip orientativo: «residual, no ocupación»). **No** hay `engine_version` ni snapshot para `general` ni para sectores Yahoo. |
| **Versionado** | Cada snapshot tema registra en `stats`: `scopeTheme` (= una de las 12 keys), git SHA de `lib/businessTheme.js`, conteo definido/computable del theme, hash de la lista. Recalcular desde esa lista reproduce percentiles idénticos (invariante 10). |

**Alternativa rechazada:** ranking por `sector` Yahoo (11 sectores estándar) o por el fallback `sector \|\| General` de `inferBusinessTheme`. Rechazada porque (a) el dueño pidió ocupación curada; (b) sector crudo mezcla negocios heterogéneos; (c) reabriría GICS por la puerta de atrás del fallback UI (hallazgo review Grok 2026-08-31).

**Alternativa rechazada:** rankear el cajón `General` / residual con `min_sample=20`. Rechazada: un «RS tema 80» en un mixto no responde «dentro de su ocupación» (mismo criterio que rechazó Technology crudo).

**Alternativa rechazada:** taxonomía GICS-like de 4 niveles (sector/industry/sub-industry). Rechazada porque no existe hoy en el repo con cobertura homogénea US+intl, exigiría proveedor/licencia nueva, y contradice la decisión de reutilizar las 12 `THEME_RULES`.

### Pregunta 3 — Población del ranking

**Propuesta:** para cada una de las **12** keys de `THEME_RULES`, la población es **todos los símbolos de ese theme en el universo privado curado MET-1** (US investable + listas curadas intl de `lib/universes.js` — mismos ~5,7k definidos que MET-1; **TW fuera de v1** según MET-1), **sin segmentar por mercado**. Un símbolo HK en «Semis / fotonica» (p. ej. 0981.HK) compite contra todos los semis del universo (US + HK + CA + EU + AU + JP), no solo contra HK ni solo contra US.

Criterios de pertenencia al denominador de un theme (misma semana W):

1. Símbolo en universo MET-1 (mismas reglas de inclusión/exclusión que `scripts/rs-global-private.mjs`).
2. Theme asignado a **una de las 12** `THEME_RULES` (reglas §pregunta 2); residual / perfil missing fuera del denominador.
3. Serie computable: ≥261 barras, sin discontinuidad ≥3× en serie local, FX apto (mismas reglas MET-1b).
4. `min_sample=20` computables en ese theme para esa semana (ver §Fórmula).

**Prohibido (heredado, no relajado):** rankear el lote de la sesión, el materializado del cron, el merge N≥2 de presets, `rsSectorPct` de `enrichRelativePercentiles`, official-broad, ni buckets residuales/`General`/sector Yahoo.

**Alternativa rechazada:** ranking tema **solo US** (población `statsedge-us-equity-rs-v1`). Rechazada porque el dueño caza intl en themes concretos (semis HK, defensa EU) y un RS tema US-only dejaría esos valores en «–» tema perpetuo — el mismo dolor que MET-1 resolvió para el eje global.

**Alternativa rechazada:** ranking tema **por mercado dentro del theme** (p. ej. «Semis US», «Semis HK»). Rechazada porque fragmenta la ocupación en silos geográficos que el eje país ya cubre; un líder en semis globales puede no ser líder en semis US, y eso es información distinta que el usuario quiere en columnas separadas (global / país / tema), no anidada.

**Alternativa rechazada:** población = intersección del lote del escaneo filtrado por theme. Rechazada: violación directa de invariante 10 y de `lib/rsCanonical.js` (lote ≠ RS).

### Pregunta 5 — `engine_version`(s) y convivencia con pin global y motores país

**Propuesta:**

| Rol | `engine_version` | Pin en lectura |
|---|---|---|
| RS global (MET-1) | `statsedge-private-global-rs-usd-v1` | `canonicalRsEngineVersion()` — **sin cambio** |
| RS país US / intl (MET-2) | `statsedge-us-equity-rs-v1` / `statsedge-private-country-rs-local-{market}-v1` | Constantes en lector país — **sin cambio** |
| RS tema | `statsedge-private-theme-rs-usd-{slug}-v1` | Constante prefijo `THEME_RS_ENGINE_PREFIX` + slug normalizado del `theme.key` + sufijo `-v1`; lector `themeRs()` resuelve por theme del símbolo |

**Slug del theme** (normalización para `engine_version`): minúsculas, ASCII, espacios y `/` → guión, sin acentos. **Solo** sobre las 12 keys. Ej.: `Semis / fotonica` → `semis-fotonica`; `Software / IA` → `software-ia`. **No** existen slugs `general`, `basic-materials`, ni ningún sector Yahoo.

**Convivencia:** hasta **tres familias** de filas en `rs_weekly_items` para el mismo símbolo US en la misma semana es esperado (global USD, país US local, tema p. ej. Software/IA) **si** el símbolo cae en una de las 12; residuales solo tienen global/país. El pin global no cambia; los lectores país y tema filtran sus `engine_version` + scope propio.

**Extensión de esquema:** el patrón MET-2 (sufijo en `engine_version` por scope) **se replica** para evitar migración DDL del UNIQUE `(owner_id, snapshot_date, engine_version, base_currency)`. Un snapshot por theme curado por semana (≤12). `stats.scopeTheme` registra el `theme.key` legible además del slug en `engine_version`.

**Alternativa rechazada:** un solo `engine_version` `statsedge-private-theme-rs-usd-v1` con todos los themes en un snapshot y percentiles calculados en lectura. Rechazada porque (a) el denominador por theme debe ser auditable y versionado por separado (invariante 10); (b) mezclar ~12 poblaciones en un snapshot dificulta reproducibilidad y motivos de exclusión por theme; (c) el patrón país ya demostró que un bucle por scope con snapshots separados escala mejor operativamente.

**Alternativa rechazada:** `engine_version` derivado del fallback `sector` Yahoo. Rechazada (review Grok): reabre taxonomía abierta y colisiones de slug.

**Alternativa rechazada:** extraer sub-percentiles tema del snapshot global MET-1. Rechazada por la misma razón que MET-2 rechazó extraer país del global: población y exclusiones distintas (tema agrupa cross-market; global rankea todos); no deja denominador tema auditable.

---

## Fórmula

### Pregunta 4 — Fórmula, moneda, mínimos

**Propuesta:** **misma metodología** que MET-1 global, aplicada sobre **precios en USD** (`priceInBase = localPrice × FX[C→USD]`, convención addendum §7, `fxMaxAge=5`, GBX→GBP):

| Parámetro | Valor |
|---|---|
| Ventanas | 13 / 26 / 39 / 52 semanas |
| Pesos | 40 / 20 / 20 / 20 |
| Mínimo barras | 261 (`52×5+1`) |
| Percentil | `percentileFromSorted`, escala 1–99 |
| `min_sample` por theme | **20** (igual que global MET-1 y país MET-2; **no** el `min_sample=5` de `rsSectorPct` batch en `lib/relativeStrength.js:5`) |
| Exclusiones, en orden | (1) fuera de universo MET-1; (2) perfil insuficiente (`theme-profile-missing`); (3) fuera de las 12 keys (`theme-residual`); (4) barras insuficientes; (5) discontinuidad ≥3× serie local; (6) FX no apto; (7) theme curado con `<20` computables esa semana → **todo ese theme** sin percentiles (`theme-sample-insufficient`) |

Themes con N pequeño (p. ej. `Inmobiliario / REIT` con pocos intl curados): si N≥20 computables, ranking válido; si N<20, «–» + motivo honesto — **no** bajar `min_sample` a 5 para «rellenar». El batch legacy usa 5 precisamente porque el lote es pequeño y variable; el ranking semanal tema hereda la disciplina del universo versionado.

**Alternativa rechazada:** precios **locales** sin FX (como país). Rechazada porque el denominador tema es cross-market: comparar rendimiento de un semi HK en HKD contra uno US en USD sin conversión no responde «¿quién lidera la ocupación?» en términos comparables para caza global.

**Alternativa rechazada:** fórmula `rsCompositeRaw` / `rsRawComposite` del batch (`lib/relativeStrength.js`). Rechazada: ventanas y pesos distintos, dependencia del lote, y tercera definición de «fuerza» en producto.

**Alternativa rechazada:** `min_sample=5` heredado de `RS_SCOPED_MIN_SAMPLE`. Rechazada porque un percentil «líder» sobre 6 símbolos del lote de ayer no es señal de producto; con universo versionado, themes como `Software / IA` o `Finanzas` tendrán N>>20, y los themes pequeños deben declararse honestamente ausentes hasta crecer cobertura curada.

---

## Superficies

### Pregunta 6 — Tabla, ficha, chart

| Superficie | Qué número | Qué ausencia |
|---|---|---|
| **Tabla** — columna nueva `RS tema` (sort/filtro propios, p. ej. `minThemeRsRating`) | `weeklyThemeRsRating` del motor tema del `theme.key` del símbolo | «–» + motivo persistido (ver tabla motivos abajo). Sort: ausentes al final (`THEME_RS_SORT_ABSENT`, misma disciplina que `RS_SORT_ABSENT`) |
| **Vista rápida / `/review`** | Mismo lector tema que tabla | Mismo «–» + motivo; nunca `rsSectorPct` del batch |
| **Ficha** — badge / franja descriptiva | Número + serie histórica tema; muestra `theme.key` junto al valor | Serie de un solo engine tema; no mezclar con global ni país |
| **Chart overlay** (post CHART-RS-2) | **Cuarto tono** con token dedicado **`--rs-theme`** (nunca `--soft` = país); leyenda «RS tema» | Toggle independiente; sin panel extra. Sustituye la línea «RS sector» aparcada en CHART-RS v2 |
| **Cabecera/tooltip columna** | «RS tema · {theme} · universo privado curado», N, semana | — |
| **`rsSectorPct` / `minRsSectorPct` legacy** | **No se muestran como RS tema** en superficies de producto | El filtro `minRsSectorPct` se **migra** en MET-3b a leer ranking semanal tema (o se depreca con aviso) — no en este spec |
| **Scoring, leaderboards, `market-health`** | Sin cambio | Siguen con percentiles de lote donde ya lo hacen |

**Motivos de exclusión persistidos** (MET-3b, patrón MET-1b/2b):

| Código | Texto UX (orientativo) |
|---|---|
| `not-in-universe` | Sin RS tema: el símbolo no está en el universo privado curado. |
| `theme-profile-missing` | Sin RS tema: no hay sector/industria/summary suficientes para asignar ocupación. |
| `theme-residual` | Sin RS tema: clasificación residual (no es una de las 12 ocupaciones curadas). |
| `insufficient-bars` | Sin RS tema: histórico insuficiente (52 semanas). |
| `discontinuous` / `discontinuous-series` | Sin RS tema: salto sin ajustar en precios. |
| `fx-unavailable` / `fx-stale` / `fx-discontinuous` | Sin RS tema: conversión USD no apta (mismos códigos MET-1). |
| `theme-sample-insufficient` | Sin RS tema: la ocupación «{theme}» tiene menos de 20 valores computables esta semana (N={n}). |
| `theme-not-supported` | Reservado si en el futuro un theme se retira de la taxonomía. |

**Relación con columna «Tema» del screener:** la columna de clasificación puede mostrar el key UI (incl. fallback sector/`General`); la columna `RS tema` solo tiene número si el key está en las **12** `THEME_RULES`. Complementarias, no equivalentes.

---

## Cadencia / jobs

### Pregunta 8 — Cadencia

**Propuesta:** pipeline semanal **aparte pero acoplado**, **después** de global y país:

| Job | Script (orientativo MET-3b) | Cuándo | Notas |
|---|---|---|---|
| RS global (MET-1c) | `rs-fx-ingest.mjs` + `rs-global-private.mjs` | Dom **06:00 UTC** | Sin cambio |
| RS país (MET-2c) | `rs-universe.mjs` + `rs-country-private.mjs` | Dom **07:00 / 07:15 UTC** | Sin cambio |
| **RS tema** | `rs-theme-private.mjs --write` | Dom **07:30 UTC**, workflow «RS tema privado» | Tras país; usa mismas barras/FX que global |

**Orden:** FX + global → país → **tema**. El tema **depende de FX** (precios USD) y de perfiles sector/industria actualizados; no depende del snapshot global para calcular, pero compartir infra tras cierre semanal evita carreras con `refresh-bars` (02:00 UTC).

**Idempotencia:** un snapshot por `(theme.slug, semana W)`; recorrido de las **12** keys curadas en un solo job (bucle interno; residuales no generan snapshot).

**Alternativa rechazada:** fundir tema dentro del workflow global (`rs-global-private.mjs`). Rechazada: acopla fallos, mezcla motores con poblaciones y scopes distintos, y viola la separación acordada en MET-1b/2b.

**Alternativa rechazada:** solo bajo demanda manual (sin cron). Rechazada porque deja el tercer eje del dueño perpetuamente vacío en tabla/chart — mismo argumento que MET-2c contra país intl manual.

**Alternativa rechazada:** mismo job que país (`rs-country-private.mjs`). Rechazada: moneda distinta (local vs USD), dependencia FX, y taxonomía cross-market no alinea con bucle por `scopeMarket`.

**Post-MIGRATE Mini:** mismo script vía launchd (patrón MET-1c/2c); GHA como respaldo — decisión ops, no MET-3.

---

## Scoring

### Pregunta 7 — Scoring

**Propuesta: confirmar prohibición (default MET-1/2).** Ningún campo derivado del RS tema semanal entra en `objectiveScore`, `compositeScore`, `totalScore`, ni sustituye `rsSectorPct` persistido en `scan_results`. Los filtros de UI pueden leer RS tema semanal (lectura, no scoring).

`rsSectorPct` del batch (`enrichRelativePercentiles`, `lib/relativeStrength.js:244`) **no se elimina** en MET-3: sigue alimentando pipelines que ya lo referencian (`scoringEngine.js`, `weaknessScore`, `minRsSectorPct` legacy). MET-3b solo deja de **mostrarlo** como RS tema y redirige filtros de producto al ranking semanal cuando exista.

**Alternativa rechazada:** usar RS tema semanal como input de `objectiveScore` o `sectorScore`. Rechazada porque condiciona scores a cobertura de themes (N variable, perfiles sectoriales) y reabre auditoría de coherencia (Camino A) sin validación del dueño.

---

## Fuera / bloqueos

### Pregunta 9 — Qué NO es MET-3

MET-3 (y su eventual MET-3b) **no** incluye:

- **VCP** ni indicadores nuevos.
- **MET-4…6** (muletas tendencia, índice salud etapa, RS stress).
- **Scoring nuevo** ni cambios en `lib/relativeStrength.js` salvo deprecación de display de `rsSectorPct` como RS tema.
- **Cutover línea pública US-only** — RS tema es track **privado** (multi-mercado + themes cross-market).
- **Migrate Mini**, yield intl ops (INT-3), R-06 perf.
- **Reabrir MET-1** (FX, universo global, pin global) ni **MET-2** (país, cron país).
- **UI / chart / columnas** (solo se especifican; implementación MET-3b / CHART-RS-3).
- **Cron / `--write`** (MET-3c, tras MET-3b verificado).
- **Cambiar taxonomía `businessTheme`** más allá de documentar versionado — una revisión de reglas es `engine_version` nuevo, no alcance MET-3b salvo bugfix acordado.
- **Reclasificar sector GICS** ni contratar proveedor de clasificación.

**Bloqueos técnicos para MET-3b** (no reabren metodología):

1. Lector tema (`themeRs`, hidratación `weeklyThemeRs*`) paralelo a `countryRs` / `rsCanonical`.
2. Script `rs-theme-private.mjs` — bucle por `theme.key`, precios USD, persistencia motivos.
3. Resolución `engine_version` por slug de theme (patrón MET-2).
4. Fuente de perfiles sector/industria para asignación theme en ranking (reutilizar campos de universo o tabla de perfiles; no el lote del scan).
5. Cron domingo 07:30 UTC.
6. Migración filtro `minRsSectorPct` → `minThemeRsRating` y columna tabla.
7. CHART-RS-3 overlay línea RS tema con token **`--rs-theme`** (puede ser ticket UI separado tras hidratación serie).

---

## Tickets siguientes

| Ticket | Contenido | Condición |
|---|---|---|
| **MET-3b** (implementación) | Lector tema + `rs-theme-private.mjs` + motivos persistidos + columna tabla + migración filtro + tests (pin global y país intactos, scoring untouched; residual sin ranking) | Spec **aceptado**; activar cuando el dueño lo pida |
| **MET-3c** (cron ops) | Workflow GHA «RS tema privado» dom 07:30 UTC + documentación launchd post-MIGRATE | Tras MET-3b verificado en corrida manual |
| **CHART-RS-3** (opcional) | Overlay cuarto tono RS tema en lienzo precio | Tras serie tema en ficha; puede paralelizarse |
| **MET-4…** | Muletas tendencia, índice etapa, etc. | No empiezan aquí |

---

## LO QUE NO VERIFIQUÉ

- **Nada contra Supabase en esta sesión:** poblaciones reales por theme, últimos snapshots MET-1/2, cobertura intl por theme — tomado de specs MET-1/2 y conteos aproximados del universo, no recontado.
- **Distribución N por `theme.key`** sobre el universo MET-1 (~5,7k): cuántos themes quedan bajo `min_sample=20` es estimación cualitativa (themes amplios OK; `Inmobiliario / REIT`, `Autos / movilidad` intl pueden quedar cortos), no ejecutada.
- **Disponibilidad sector/industria/summary** para todos los símbolos intl curados: asumido que la misma fuente que alimenta `theme` en scan/ficha cubre la mayoría; huecos → `theme-profile-missing` o `theme-residual` (nunca inventar ranking).
- **Coste/duración** de `rs-theme-private.mjs` (~12 bucles × lectura USD): extrapolación desde MET-1b/2b, no medido.
- **Slug collision** entre theme keys al normalizar: revisado a ojo sobre las 12 claves de `THEME_RULES`; no hay test automatizado.
- **Comportamiento de filtros** `minRsSectorPct` con presets guardados — diseño objetivo de migración, no probado.
- **Ninguna superficie UI** — spec only.
- **`docs/addendum-rs-global-basecurrency-v3.2.md`** — citado vía MET-1, no releído entero en esta sesión.
