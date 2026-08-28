# Spec — RS global multi-mercado con ajuste por divisa (MET-1)

- **Fecha:** 2026-08-28
- **Rama:** `codex/statsedge-ui-polish`
- **Estado:** **aceptado por dueño** 2026-08-28 (matiz: RS global FX = track **privado**; público v1 previsto **US-only** — ver § «Línea privada vs pública»). **No autoriza implementación** (addendum v3.2 §13: falta autorización explícita para MET-1b).
- **Contratos reconciliados:** `docs/addendum-rs-global-basecurrency-v3.2.md` · `docs/adr-rs-universo-us.md` + código vivo (`lib/rsCanonical.js`, `lib/globalRs.js`, `scripts/rs-universe.mjs`) · decisión dueño 2026-08-27 (`docs/backlog-activo.md`) · `docs/adr-discovery-global-curated.md` invariante 10 · `docs/tickets/INT-0-audit.md`.

---

## Veredicto

El RS que el producto enseña bajo la etiqueta `RS` (tabla, vista rápida, `/review`, ficha —
vía `lib/rsCanonical.js`) pasa a ser **un solo ranking semanal del universo privado
multi-mercado, con precios convertidos a USD**, calculado por un motor nuevo
(`statsedge-private-global-rs-usd-v1`) sobre un conjunto fijo y versionado de símbolos:
el universo US investable completo (como hoy) más las listas curadas del repo para
HK, CA, Europa (15 mercados), AU y JP. La fórmula es la del motor US vigente
(40/20/20/20 sobre 13/26/39/52 semanas), aplicada sobre `priceInBase = localPrice × FX[C→USD]`
según la convención cerrada del addendum §7. HK/CA/EU dejan de mostrar «–» cuando el
símbolo está en el universo y su serie (precio y FX) es computable; si no lo es,
la ausencia se muestra con motivo persistido, nunca con un 0 ni con el percentil del lote.
Se conservan intactas las invariantes duras del addendum: nada de esto entra en el scoring,
nada escribe en `scan_results`, `null` nunca se convierte en cero, y la cobertura real se
declara por mercado. Lo que queda obsoleto del addendum es únicamente su modelo de
superficie (columna analítica *segunda* junto al RS actual, y la preferencia USD/EUR):
en la versión privada hay **un** RS, en USD fijo. El motor US actual
(`statsedge-us-equity-rs-v1`) no se borra: queda congelado como base del futuro RS país US (MET-2) **y como RS canónico de la línea pública US-only** (ver abajo).

### Línea privada vs línea pública

Decisión dueño 2026-08-28: el ranking global con FX es **solo para el producto personal / privado** (multi-mercado: US · HK · CA · Europa…). El **lanzamiento público** previsto — salvo imprevisto — arranca **solo US**; no hereda el motor global ni obliga a mantener intl en el RS de producto público.

| | Privado (ahora) | Público (futuro, salvo imprevisto) |
|---|---|---|
| Universo RS | US investable + curadas intl (~830) | US investable only |
| Motor canónico | `statsedge-private-global-rs-usd-v1` (MET-1b) | `statsedge-us-equity-rs-v1` (pin US; sin FX) |
| Etiqueta UI | `RS` (= global FX, universo privado curado) | `RS` (= ranking US, sin divisa) |
| Objetivo | Cazar HK/CA/EU con el mismo número que US | Simplicidad, licencia, un solo mercado al arranque |

**Implicación de implementación:** dos `engine_version` conviven en `rs_weekly_items`; el **pin** del canónico (`lib/globalRs.js` / `lib/rsCanonical.js`) elige cuál alimenta superficies. En privado → motor global; en build/config pública → motor US-only. Así el track global **no distorsiona** la versión pública: no se fusionan motores, no se arrastra cobertura intl al producto US, y abrir intl en público más adelante sería feature explícita (nuevo motor o flag), no herencia silenciosa del privado.

---

## Resolución de contratos

Regla de lectura: el addendum v3.2 se escribió (2026-07-16) cuando «la RS actual» era
`rsGlobalPct` en `scan_results`. Desde el ADR US (2026-08-08) y `lib/rsCanonical.js`, el RS de
producto vive en `rs_weekly_items`, **fuera** de `scan_results` y **fuera** del scoring. Por eso
las invariantes duras del addendum (aislamiento de scoring, inmutabilidad del snapshot, FX,
anti-lookahead, cobertura) se pueden conservar todas mientras su modelo de superficie (columna
segunda) se declara obsoleto: la protección iba dirigida a `rsGlobalPct` y a los scores, y ninguno
de los dos se toca.

| Cláusula | Origen | Resolución |
|---|---|---|
| FX solo como **columna nueva** junto al RS vigente; no reinterpretar la RS actual | Addendum §1–§2 | **Se actualiza.** La métrica sigue siendo nueva (motor y `engine_version` propios, sin compatibilidad retro con `rsGlobalPct` ni con `statsedge-us-equity-rs-v1`), pero ocupa la etiqueta `RS` de producto en vez de convivir como segunda columna. `rsGlobalPct` no se reinterpreta ni se reescribe: sigue siendo percentil de lote, alimentando scores, invisible como RS (`lib/rsCanonical.js:14-18`). |
| `RS global · USD` / `· EUR` por preferencia de usuario; una columna visible | Addendum §1, §14.1–2 | **Se actualiza.** Versión privada: USD fijo, sin preferencia (ver «FX» y pregunta 8). Sigue habiendo una sola columna visible. |
| RS local separada, sin FX | Addendum §3 | **Se conserva.** `rsRating` vs benchmark local no se toca. |
| Aislamiento absoluto del scoring (`objectiveScore`/`compositeScore`/`totalScore`) | Addendum §4 | **Se conserva** sin relajación (pregunta 7). |
| Snapshot canónico `scan_results` inmutable; prohibido escribir `rsGlobalPct`, `percentileScope`, scores | Addendum §5 | **Se conserva.** El motor escribe solo en `rs_weekly_snapshots`/`rs_weekly_items`, como hoy el US. |
| Identidad `(canonicalScanId, baseCurrency, methodologyVersion)` | Addendum §6 | **Se actualiza.** El RS global no es una proyección de un scan: es el ranking semanal. Identidad = `(owner_id, snapshot_date, engine_version, base_currency)` — el UNIQUE ya existente de `rs_weekly_snapshots` (`supabase/schema.sql:1236`). `engine_version` asume el rol de `methodologyVersion`: cualquier cambio material (fórmula, ventanas, FX, universo, umbral) = `engine_version` nuevo. |
| Convención FX §7 (multiplicar; inverso normalizado; C=B ⇒ 1; cruces por piernas) | Addendum §7 | **Se conserva** íntegra. Sin cruces en v1 (todas las divisas del universo cotizan contra USD, ver «FX»). |
| Anti-lookahead §8 | Addendum §8 | **Se conserva con política declarada.** El cálculo semanal corre después del cierre de todos los mercados (≥ T+1): todo FX con `trade_date ≤` sesión del símbolo ya es público al computar. La regla estricta `fxPublishedAt ≤ asOf` no es demostrable con Yahoo; se declara la limitación (permitido por §8 último párrafo) y **queda prohibido el backfill histórico as-of** bajo este motor hasta que exista fuente con metadatos de publicación. |
| Forward-fill dentro de `fxMaxAge`; `null` con causa; nunca inventar valor | Addendum §9 | **Se conserva.** `fxMaxAge` se cierra aquí: 5 sesiones FX (ver «FX»). |
| Cobertura real declarada por mercado y por FX; `null` no entra al denominador | Addendum §10 | **Se conserva** (taxonomía reducida a los casos que existen en v1, ver «FX»). |
| Caché/materialización fuera de `scan_results`, reproducible | Addendum §11 | **Se conserva.** `rs_weekly_snapshots`/`rs_weekly_items` ya cumplen; `stats` del snapshot registra el denominador (ver «Universo»). |
| Puerta §13: cierre Camino A + autorización explícita | Addendum §13 | **Se conserva.** Camino A está cerrado (`docs/camino-a-closure-2026-07-16.md`); falta la autorización explícita de implementación, que este spec no otorga. |
| Decisiones humanas pendientes §15 | Addendum §15 | **Se cierran o se marcan como bloqueo** en este spec: `fxMaxAge`, proveedor, as-of, cruces, metodología, caché, cobertura → cerradas abajo. Retención/auditoría → bloqueo menor de MET-1b (persistir procedencia FX por fila, campos ya existen: `fx_rate`, `fx_date`). Autorización → dueño. |
| RS de producto = ranking semanal universo US; lote ≠ RS; intl «–» + motivo | ADR US + `lib/rsCanonical.js` | **Se conserva el principio, se actualiza la población.** «Lote ≠ RS» y «ausencia con motivo» siguen siendo ley. Cambia el universo del ranking canónico: de US-only a privado multi-mercado. `statsedge-us-equity-rs-v1` queda congelado como insumo de MET-2 (RS país US). |
| Invariante 10: RS global solo sobre universo canónico completo/versionado; nunca lote de cron | `docs/adr-discovery-global-curated.md` §1.6, §4 capa 3 | **Se conserva.** El universo de este spec es fijo, versionado y con denominador registrado; el motor lee `daily_bars`, jamás el materializado del cron ni el merge N≥2 de presets. |
| Dueño 2026-08-27: RS global = un ranking del universo privado con ajuste por divisa | `docs/backlog-activo.md` | **Gana** en el punto de identidad de producto. Es la cláusula que fuerza la actualización del modelo de superficie del addendum. |

---

## Universo y engine_version

### Pregunta 1 — Identidad de producto

**Propuesta:** el ranking FX **es** el `RS` de tabla, vista rápida, `/review` y ficha. No hay
segunda columna. `lib/rsCanonical.js` sigue siendo el lector único; lo que cambia (en MET-1b) es
qué `engine_version` hidrata los campos `weeklyRs*`. `statsedge-us-equity-rs-v1` deja de
alimentar superficies cuando el motor global esté verificado y pinneado, y pasa a ser la base
metodológica del RS país US (MET-2) — misma fórmula, población US, sin FX.

El cutover debe ser **explícito**: hoy `lib/globalRs.js:39-42,200-210` resuelve «engine de la
fila más reciente por símbolo», lo que significa que la primera escritura del motor global
cambiaría el RS visible de los símbolos US en silencio. MET-1b debe pinnear el
`engine_version` canónico en una constante que `rsCanonical`/`globalRs` filtren, de modo que
el cambio de RS visible sea un diff de una línea, revisable y reversible.

**Alternativa rechazada:** modelo literal del addendum — mantener `RS` (US) y añadir columna
`RS global · USD`. Rechazada porque dos percentiles casi idénticos bajo etiquetas hermanas
reintroducen exactamente la incoherencia multi-pantalla (caso MAR, 4 valores en 5 pantallas)
que `rsCanonical` se construyó para eliminar, y porque el dueño pidió **un** ranking de caza,
no un panel comparativo.

### Pregunta 2 — Universo de ranking (privado)

**Propuesta (candidato b, acotado):** conjunto fijo y versionado =

1. **US:** población `equity` del último `universe_snapshot_symbols` con `passed=true`,
   `instrument_type ∈ (equity, listed-vehicle)`, menos fondos cerrados por patrón
   (`scripts/rs-universe.mjs:96,201-207`) — idéntica a la del motor US actual (~4.9k definidos,
   ~4.868 rankeados en la última corrida según `lib/rsCanonical.js:9`).
2. **Internacional:** `marketSymbols(code)` de `lib/universes.js:108-110`
   (CURATED + EXTRA + EXPANDED_CORE) para: HK (~76), CA (~205), GB, DE, FR, NL, CH, SE, IT, ES,
   DK, NO, FI, BE, PT, AT, IE (~470 en conjunto), AU (~10), JP (~72). Total intl ≈ 830 símbolos
   definidos (conteos aproximados sobre las listas del repo a fecha de este spec).

Fuera de v1: KR, IN, IL, CN, BR, MX, SG, ZA, TW (no son prioridad del dueño —
«US · HK · CA · Europa» — y añaden divisas y festivos sin valor de caza inmediato; entrar
después = `engine_version` nuevo o minor documentado en `stats`).

**Versionado del denominador** (invariante 10 y criterio 10.8b del ADR discovery):
`rs_weekly_snapshots.stats` registra `universe_snapshot_id` US, el git SHA de
`lib/universes.js` usado, el conteo definido/computable por mercado y un hash de la lista
final de símbolos. Recalcular desde esa lista debe reproducir percentiles idénticos.

**Prohibido (se hereda, no se relaja):** rankear el lote de la sesión, el materializado del
cron, o el merge N≥2 de presets. El motor lee `universe_snapshot_symbols` + listas del repo +
`daily_bars`; nunca `scan_results`.

**Alternativas rechazadas:**
- *(a) mercados con scan materializado usable hoy:* el materializado es el lote rotativo del
  cron (HK 23, GB 3, IT-ES 7… — INT-0 §2); su composición cambia con el cursor de cada noche.
  Es exactamente lo que la invariante 10 prohíbe como denominador.
- *(c) todo `DEFAULT_MARKETS` (29 mercados):* 6 mercados no tienen pipeline ninguno (INT-0 §3),
  varias divisas exigirían cruces o pares ilíquidos, y el resultado se presentaría como más
  global de lo que es. Contradice la cobertura honesta del addendum §10.

### Pregunta 3 — Cobertura honesta

**Propuesta:** los símbolos entran al ranking **individualmente** si su serie es computable
(mismos requisitos que el motor US: ≥261 barras, sin discontinuidad ≥3x) y su FX es apto; no
hay umbral de exclusión por mercado. La honestidad se resuelve por **declaración**, no por
amputación: cada snapshot registra en `stats` la cobertura por mercado
(computables/definidos), y la UI etiqueta el ranking como **«RS global · USD (universo privado
curado)»** — nunca «global» a secas ni «universo exchange». HK 23 vs inventario 2770 deja de
ser un dilema: el universo de ranking de HK es su lista curada (~76), no las 23 filas del
cron (irrelevantes: el motor no lee scans) ni los 2770 del inventario HKEX (que nadie caza y
no tienen barras). El denominador será US-céntrico (~85% US); eso se declara en la ficha y en
el tooltip de columna con «N símbolos · M mercados», no se disfraza.

Muestra mínima global: se mantiene `min_sample=20` (`percentileFromSorted`); con ~5.7k
definidos es un no-problema salvo catástrofe de datos, y en ese caso `null` es la respuesta
correcta.

**Alternativa rechazada:** umbral mínimo por mercado (p. ej. «HK entra solo si ≥60% de su
lista computa»). Rechazada porque reintroduce el «–» para mercados que el dueño caza — el
problema que MET-1 existe para eliminar — y porque excluir 20 símbolos computables de HK no
hace el ranking más honesto, solo más pequeño. La declaración de cobertura da la misma
información sin esconder datos.

---

## FX

### Pregunta 4 — Fuente y política de fallo

**Propuesta:** Yahoo Finance, pares `{CCY}USD=X` (con inverso `USD{CCY}=X` normalizado por
§7.2), ingeridos como series diarias en `daily_bars` con el pipeline de barras existente. Es
la misma fuente y convención de pares que ya usa producción para el market cap USD de la ficha
(`app/api/company-brief/route.js:135-158`). Divisas necesarias en v1: HKD, CAD, GBP, EUR, CHF,
SEK, DKK, NOK, AUD, JPY — todas con par directo o inverso contra USD; **sin cruces** (§7.4 no
se ejercita; si un día hace falta una pierna intermedia, eso es `engine_version` nuevo).

Trampa obligatoria a especificar: **GBX/GBp.** LSE cotiza en peniques; antes de aplicar FX se
normaliza `GBX → GBP` dividiendo el precio entre 100 (precedente en
`app/api/company-brief/route.js:130-134`). Un símbolo cuya divisa no pueda normalizarse a un
código ISO conocido → `null` + motivo `fx-currency-unknown`.

Los campos `fx_rate`/`fx_date` por fila de `rs_weekly_items` (DDL ya existente) registran la
procedencia de la conversión aplicada; para US, `fx_rate=1` (caso contractual C=B, §7.3).

**Política de fallo (cierra addendum §15.1/§15.3):**
- `fxMaxAge = 5 sesiones FX` (una semana natural de mercado). Forward-fill permitido dentro de
  ese límite, registrando `fx_date` de la observación usada.
- Sin observación elegible, o más vieja que `fxMaxAge`, o serie FX con discontinuidad → el
  símbolo sale del ranking esa semana con motivo persistido (`fx-unavailable` /
  `fx-stale` / `fx-discontinuous`). **Nunca** 0, nunca paridad (salvo C=B), nunca media.
- Los `null` no entran al denominador del percentil (addendum §10).

**As-of / anti-lookahead (cierra §15.3):** el cálculo semanal corre después del cierre de la
semana en todos los mercados del universo (fin de semana, como hoy el US). Para cada símbolo se
usa el último FX con `trade_date ≤` la fecha de su barra de cierre. Como todo dato usado lleva
≥1 día público en el momento del cómputo, no hay lookahead operativo. Yahoo no expone
`fxPublishedAt`: la limitación se declara (permitido por §8) y en consecuencia **el backfill
histórico as-of queda prohibido** bajo este motor — un relleno retroactivo exigiría demostrar
disponibilidad temporal que esta fuente no demuestra.

**Alternativas rechazadas:**
- *Twelve Data (u otro proveedor con licencia):* aplazado por decisión del 2026-07-27
  (`docs/adr-universo-twelve-data.md`) — no se contrata pre-lanzamiento. Se reevalúa si hay
  versión pública; sería `engine_version` nuevo.
- *Reusar los `fx_rate` persistidos por el motor de mayo (`statsedge-global-rs-usd-v1`):*
  escritor desconocido (no hay código en el repo, ADR US A.1), datos congelados en 2026-05-25,
  cesta de 69 símbolos. Provenance no auditable = no apto.

### Pregunta 5 — Fórmula

**Propuesta:** reusar la metodología del motor US **sobre precios ya convertidos**:
rendimientos acumulados a 13/26/39/52 semanas con pesos 40/20/20/20
(`scripts/rs-universe.mjs:63-64`), offsets en días hábiles (52×5+1 = 261 barras mínimas),
percentil 1–99 con `percentileFromSorted` y `min_sample=20`. Exclusiones idénticas y en este
orden: (1) barras locales insuficientes; (2) discontinuidad ≥3x en la serie **local** (splits
no ajustados — se excluye, nunca se ajusta, `scripts/rs-universe.mjs:76-82`); (3) FX no apto
(pregunta 4). La detección de discontinuidad corre sobre la serie local *antes* de convertir,
para no confundir un salto de FX con un split; la serie FX tiene su propio control (motivo
`fx-discontinuous`).

Nota metodológica honesta: el rendimiento sobre `priceInBase` compone rendimiento local ×
rendimiento FX. Eso es deliberado — es la definición del ajuste por divisa que pidió el dueño:
una acción de HK que sube 30% con HKD débil no debe rankear como una de US que sube 30%.

**Alternativa rechazada:** fórmula «FX-hedged» (rendimiento local puro + columna FX separada,
o ponderaciones nuevas). Rechazada porque rompe la comparabilidad en una moneda única que
define la métrica, duplica columnas (contra la pregunta 1) y reabriría una metodología cuya
forma actual está validada contra datos reales (regresión exacta en el ADR US A.1 y semanas de
corridas del motor US en producción).

### Pregunta 6 — `engine_version`

**Propuesta:** `statsedge-private-global-rs-usd-v1`. Nombre nuevo, sin rellenar el motor US
(`statsedge-us-equity-rs-v1`, que queda congelado y luego pasa a MET-2) y sin tocar
`statsedge-global-rs-usd-v1` (mayo 2026, cesta EU n=69, metodología no auditable). El UNIQUE de
`rs_weekly_snapshots` ya soporta la convivencia sin cambio de esquema. `statsedge-us-etf-rs-v1`
(población ETF) no se toca.

**Convivencia de lecturas:** `lib/globalRs.js` resuelve hoy «engine más reciente por símbolo»
(líneas 39-42 y 200-210), lo que haría cutover implícito en cuanto exista el primer snapshot
global. MET-1b debe sustituir esa regla por un pin explícito del engine canónico (constante
exportada, testeada), manteniendo el fallback de serie histórica de un solo engine para la
ficha. `GLOBAL_RS_ENGINE_VERSION` (`lib/globalRs.js:3`), que aún apunta al motor de mayo, se
actualiza o retira en ese mismo diff.

**Alternativa rechazada:** reusar `statsedge-us-equity-rs-v1` ampliando su población.
Rechazada por el mismo principio que ya aplica `lib/globalRs.js`: mezclar dos poblaciones bajo
un `engine_version` afirma una continuidad de cálculo que no existe (un 85 US-only de julio y
un 85 global de septiembre no son la misma métrica), y rompería la reproducibilidad del
histórico US que MET-2 necesita.

### Pregunta 7 — Scoring

**Propuesta: conservar la prohibición del addendum §4 sin relajación.** Ninguna métrica
derivada de FX entra en `objectiveScore`, `compositeScore`, `totalScore` ni en el
`rsGlobalPct` persistido. El RS global es analítico y de lectura, igual que hoy lo es el
semanal US (los campos `weeklyRs*` viajan junto a `rsGlobalPct` sin tocarlo,
`lib/globalRs.js:220-232`). El filtro de UI `minRsRating` y los sorts pueden leer el RS
canónico (eso es lectura, no scoring); los scores persistidos, no.

**Alternativa rechazada:** dejar que el RS global sustituya a `rsGlobalPct` como input de
scoring. Rechazada porque haría los scores dependientes de cobertura FX y de la composición
del universo privado (contra el contrato de coherencia y el cierre de Camino A), y porque
mutar inputs de scoring exige reabrir auditorías (`docs/audit-score-coherence-contract.md`)
que este track no necesita tocar.

### Pregunta 8 — USD vs EUR

**Propuesta: USD fijo en la versión privada.** Una sola columna, etiqueta corta `RS` en tabla
(el lector canónico no cambia de etiqueta), con tooltip/cabecera y ficha declarando
«RS global · USD · universo privado curado (N símbolos · M mercados · semana W)». El esquema
(`base_currency` en ambas tablas) deja la puerta abierta a una proyección EUR futura como
snapshot paralelo sin migración; no se construye ahora.

**Alternativa rechazada:** preferencia de usuario USD/EUR del addendum §1. Rechazada en la
versión privada: duplica cómputo, QA y superficie de error (dos snapshots por semana, dos
cadenas FX) para un único usuario que caza en una moneda. Se reevalúa solo si hay versión
pública, y entraría como `engine_version`/snapshot paralelo, no como recálculo.

### Pregunta 9 — Qué NO es MET-1

MET-1 (y su eventual MET-1b) **no** incluye: RS país (MET-2) ni RS tema (MET-3); VCP ni
indicadores nuevos; `weekly-changes`/nocturno intl; cambios de scoring o de
`lib/relativeStrength.js`; licencia pública ni Twelve Data; backfill histórico as-of;
reabrir la oleada UI; el cron de implementación (la frecuencia/disparador del motor global es
decisión de MET-1b con las opciones de la Parte C del ADR US); y cualquier cambio en el
materializado del cron o en leaderboards.

---

## Superficies

| Superficie | Qué número enseña | Qué ausencia enseña |
|---|---|---|
| Tabla del screener (columna RS, sort, filtro `minRsRating` de UI) | `weeklyRsRating` del engine global pinneado, vía `canonicalRs()` — sin cambio de interfaz de lectura | «–» + motivo persistido (símbolo fuera del universo privado, barras insuficientes, serie discontinua, FX no apto). Sort: ausentes al final (`RS_SORT_ABSENT`), como hoy |
| Vista rápida / `/review` | Mismo lector, mismo número que la tabla (invariante multi-pantalla del ADR US) | Mismo «–» + motivo; `RS_QUALITY_OFF_CANON_REASON` sigue aplicando donde ya aplica |
| Ficha (`StockClient`) | Número + serie histórica del engine global (un solo engine por serie, regla ya vigente en `lib/globalRs.js`) | Serie del engine anterior no se mezcla; si el símbolo solo tiene historia US, la ficha la enseña etiquetada con su engine |
| Cabecera/tooltip de columna y ficha | Declaración obligatoria: «RS global · USD · universo privado curado», N símbolos, M mercados, semana, cobertura por mercado si parcial | — |
| Chart (badge RS) | Sin cambio en MET-1b (subsumido en B2-chart); si enseña RS, lee el canónico | — |
| `market-health`, `sectors`, leaderboards, scoring | **Sin cambio.** Siguen sobre `rsGlobalPct`/batch con sus etiquetas actuales; fuera de alcance | — |

Requisito de MET-1b para que la ausencia sea honesta: **persistir el motivo de exclusión** por
símbolo/semana (hoy `scripts/rs-universe.mjs` solo lo imprime por consola;
`lib/globalRs.js:76-83` documenta el hueco). Sin motivo persistido, HK volvería a un «–» mudo,
que es lo que este track elimina.

---

## Fuera / bloqueos de implementación

Un ticket MET-1b **no puede**, hasta OK explícito del dueño sobre este spec **y** autorización
de implementación separada (addendum §13, condición 2 — la condición 1, cierre de Camino A,
consta en `docs/camino-a-closure-2026-07-16.md`):

- Escribir en Supabase (ni `rs_weekly_*`, ni `daily_bars` de FX, ni `app_settings`), correr
  scans, backfills o `--write`.
- Tocar `scan_results`, scoring, `lib/relativeStrength.js`, finalización de percentiles.
- Cambiar el RS visible (el pin de `engine_version` es el interruptor y se acciona al final,
  con smoke visual real — Regla dura #2).
- Crear el cron. Primera corrida = manual y verificada, como la Fase 1 del ADR US.

Bloqueos técnicos a resolver dentro de MET-1b (no reabren metodología):

1. **Ingesta FX:** 10 pares `=X` como series en `daily_bars` (o tabla propia si se prefiere no
   mezclar; decisión de implementación, no de metodología).
2. **Barras intl:** las listas curadas (~830 símbolos) necesitan ≥261 barras en `daily_bars`;
   hoy solo hay garantía para lo que el cron materializó. Estimación por analogía con la
   medición del ADR US (410 ms/símbolo): del orden de 5–10 min de descarga única; **no
   verificado** para símbolos `.HK`/`.T`/`.L`.
3. **Persistir motivo de exclusión** por símbolo/semana.
4. **Pin explícito de `engine_version`** en `lib/globalRs.js`/`lib/rsCanonical.js` + test que
   falle si el canónico cambia sin tocar la constante.
5. **Normalización GBX→GBP** en el punto de conversión, con test.

---

## Tickets siguientes

| Ticket | Contenido | Condición |
|---|---|---|
| **MET-1b** (implementación) | Ingesta FX + barras intl, motor `statsedge-private-global-rs-usd-v1` (dry-run → corrida manual verificada → pin), motivo de exclusión persistido, disclosure UX de universo/cobertura, tests (incluidos los invariantes §14 del addendum que apliquen) | Solo tras aceptación de este spec **y** autorización explícita del dueño. Fases 0–3 del patrón del ADR US |
| **MET-1c** (cron) | Disparador semanal del motor global (opciones Parte C del ADR US) | Tras MET-1b verificado en corrida manual |
| **MET-2** (RS país) | Spec propio; hereda `statsedge-us-equity-rs-v1` como RS país US y define el intra-país intl | No empieza aquí |
| **MET-3** (RS tema) | Spec propio (ocupación/theme) | No empieza aquí |

---

## LO QUE NO VERIFIQUÉ

- **Nada contra Supabase en esta sesión** (el ticket prohíbe scans/escrituras y no hice
  lecturas): poblaciones reales (US 3319/4868, HK 23, inventarios), contenido actual de
  `rs_weekly_snapshots`, y si el motor US ha seguido corriendo desde el ADR — todo tomado de
  INT-0 y de los docs citados, no re-medido.
- **Disponibilidad y calidad de los pares Yahoo `=X` como series diarias completas** (¿261
  barras continuas para HKD/SEK/DKK/NOK?): el uso en producción (`company-brief`) es de un
  cierre puntual, no de una serie larga. Es la asunción más frágil del capítulo FX.
- **Coste real del backfill de barras intl** (~830 símbolos con sufijos `.HK`/`.T`/`.L`/…):
  extrapolado de la medición US de 410 ms/símbolo, no medido.
- **Conteos exactos de las listas curadas** (los ~76/205/470/72 son recuentos aproximados
  sobre `lib/universes.js` a ojo de estructura, no ejecutados).
- **`docs/camino-a-closure-2026-07-16.md` no lo leí entero**: tomo el cierre de Camino A como
  hecho porque el ADR de discovery (posterior y aceptado) lo referencia como cerrado.
- **Comportamiento de `percentileFromSorted` y `detectPriceDiscontinuities` no releído
  línea a línea** (`lib/relativeStrength.js`, `lib/indicators.js`): los cito por su uso en
  `scripts/rs-universe.mjs`, que sí leí entero.
- **Ninguna superficie UI probada en navegador** (n/a para un spec, pero las afirmaciones de
  la tabla de superficies describen el diseño objetivo, no un estado verificado hoy).
