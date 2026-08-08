# ADR — RS por percentil sobre el universo US completo

<!-- fecha interna: 2026-08-08 · BASE_SHA: 156fa0a · rama: codex/statsedge-ui-polish -->

Este documento es de **diseño**, no de implementación. No se modificó
ningún archivo de código ni se escribió en Supabase. La decisión de
producto (percentil semanal sobre ~5.600 símbolos US, ETFs separados,
fórmula 13/26/39/52 semanas, nombre "RS"/"fuerza relativa") ya está
tomada y no se cuestiona aquí; este documento diseña las opciones para
llegar a ella.

**Aviso importante que corrige el contexto de partida**: el contexto
de la tarea afirma "existe un job que pobló `rs_weekly_items` una sola
vez, el 2026-05-25, con `sample_size` 69, y lleva muerto desde
entonces". Es cierto que no ha vuelto a correr, pero los datos reales
en `rs_weekly_items` cuentan una historia más precisa y distinta en un
punto importante: **no fue un job que corrió una vez y se detuvo — fue
dos eventos distintos el mismo día**, y el run "en vivo" real
(`sample_size` 69) no calculó RS sobre acciones US en ningún momento,
sino sobre una cesta europea. El detalle está en A.1-A.2.

---

## PARTE A — Reutilizar lo que existe

### A.1 — El job que pobló `rs_weekly_items`: qué código existe y qué no

**No existe ningún código en este repositorio que escriba en
`rs_weekly_items` o `rs_weekly_snapshots`.** Verificado con:

```
grep -rln "rs_weekly_items\|rs_weekly_runs\|statsedge-global-rs-usd-v1" \
  --include="*.js" --include="*.mjs" --include="*.ts" --include="*.sql" .
→ supabase/schema.sql, scripts/supabase-admin.mjs,
  scripts/mcp/supabase-readonly.mjs, lib/supabaseDiagnostics.js, lib/globalRs.js
```

De esos cinco archivos, **ninguno escribe**. Solo leen o listan:
- [lib/globalRs.js](lib/globalRs.js) — `readGlobalRsSeriesForSymbol()`, un
  `SELECT` sobre `rs_weekly_items` (líneas 15-49, citado íntegro más
  abajo).
- [app/api/rs-weekly/route.js](app/api/rs-weekly/route.js) — endpoint
  `GET` que envuelve esa lectura.
- `scripts/supabase-admin.mjs:26-27` — solo registra los nombres de
  tabla en un inventario de "tablas requeridas", no escribe filas.
- `supabase/schema.sql` — el DDL (ver A.4).

Confirmado también por git history — el único commit que tocó estos
archivos los creó ya en su forma de solo-lectura:

```
git log --all --oneline -- lib/globalRs.js app/api/rs-weekly/route.js
→ 45a9a5b Polish screener filters and RS research UX (único commit)

git log --all --diff-filter=A --oneline -- lib/globalRs.js
→ 45a9a5b (mismo commit, sin escritor previo ni posterior)
```

Y no hay ningún script, tracked o untracked, para el escritor:

```
find . -iname "*rs-weekly*" -o -iname "*globalRs*" -o -iname "*weeklyRs*"
→ solo lib/globalRs.js, app/api/rs-weekly, y sus artefactos .next/ compilados

ls scripts/   # 44 archivos, ninguno con nombre relacionado a rs_weekly
git status --porcelain=v1 -uall   # sin untracked files
```

**Conclusión dura**: no puedo citar "cómo selecciona la población,
cómo calcula los rendimientos, cómo asigna el percentil" desde código
real, porque ese código no está en el repositorio — ni en el historial
de git ni en el filesystem actual, tracked o no. Solo puedo reconstruir
su comportamiento **a partir de los datos que dejó en la tabla**,
usando el DDL como contrato de lo que el escritor debía producir.

**Lo que sí puedo reconstruir de los datos (medición sobre filas
reales, no fuente):**

```
GET /rs_weekly_items?select=symbol,rank_index,rs_rating,rs_raw,usd_close,
    local_close,fx_rate,fx_date,currency,normalized_currency,metrics,
    sample_size,country
    &snapshot_id=eq.c4d4d2c6-eea8-443b-a0d2-f3d7c3f3b764
    &order=rank_index.asc&limit=5
```
Fila de ejemplo (NOKIA.HE, rank 1 del snapshot 2026-W22):
```json
{"symbol":"NOKIA.HE","rs_rating":99,"rs_raw":161.16,
 "usd_close":15.14,"local_close":13.005,"fx_rate":1.16455,
 "currency":"EUR","normalized_currency":"EUR",
 "metrics":{"returns":{"13w":98.78,"26w":151.58,"39w":257.97,"52w":198.69},
            "closeDate":"2026-05-25","fxReturn52w":2.35,"localReturn52w":191.84},
 "sample_size":69,"country":"FI"}
```

- **Normalización a USD**: `usd_close = local_close × fx_rate`
  (13.005 × 1.16455 ≈ 15.14, cuadra). `fx_rate`/`fx_date` se guardan
  por fila, así que la normalización es por símbolo/fecha, no un tipo
  de cambio único por snapshot.
- **Rendimientos**: `metrics.returns` trae exactamente las 4 ventanas
  de la especificación decidida (13/26/39/52 semanas), como % de
  cambio acumulado hasta `closeDate`.
- **Fórmula de `rs_raw` — reconstruida por regresión, no leída**:
  probé pesos iguales (25% cada ventana) y no cuadraba. Con pesos
  **40% / 20% / 20% / 20%** (13w/26w/39w/52w) sí:
  - NOKIA.HE: `0.4×98.78 + 0.2×151.58 + 0.2×257.97 + 0.2×198.69 = 161.16` ✓ (coincide con `rs_raw` a 2 decimales)
  - STMPA.PA: `0.4×97.85 + 0.2×157.67 + 0.2×141.45 + 0.2×128.98 = 124.76` ✓ (coincide exacto con `rs_raw=124.76136609732747`)

  Esto **no es una lectura del código fuente** (no existe): es
  ingeniería inversa sobre dos filas y coincide en ambas al segundo
  decimal, lo cual es fuerte pero no es prueba de la fórmula general
  para todas las filas ni de cómo se combinan pesos si faltan ventanas
  (símbolo con <52 semanas de historia).
- **Percentil**: `rank_index` es un ranking 1..N por `rs_raw`
  descendente dentro del `snapshot_id`; `rs_rating` es una escala 1-99
  (rank 1 → 99, cae monótonamente) — consistente con el mismo patrón
  1-99 que usa `percentileFromSorted()` en
  [lib/relativeStrength.js:192-201](lib/relativeStrength.js#L192-L201)
  para el RS del escaneo, pero no es necesariamente el mismo código:
  solo son compatibles en forma.
- **Dónde escribe**: `rs_weekly_snapshots` (una fila por corrida
  semanal, con `engine_version`, `lookback_weeks`, `weights`,
  `min_sample`, `symbol_count`) y `rs_weekly_items` (una fila por
  símbolo por corrida, FK a `rs_weekly_snapshots.id`). DDL completo en
  A.4.

### A.2 — Por qué solo corrió (parcialmente) una vez: evidencia real, más matizada que el resumen de contexto

**Hallazgo principal**: el 2026-05-25 no hubo "un job semanal que corrió
una vez". Hubo **dos eventos distintos, con cuatro minutos de
diferencia, con poblaciones completamente distintas**:

```
GET /rs_weekly_items?select=snapshot_id,sample_size,snapshot_date,week_key,created_at
    &rank_index=eq.1&snapshot_date=gte.2026-04-24&order=snapshot_date.asc
```

| snapshot_date | week_key | sample_size | created_at |
|---|---|---:|---|
| 2026-05-22 | 2026-W21 | 300 | **2026-05-25T16:04:04** |
| **2026-05-25** | **2026-W22** | **69** | **2026-05-25T16:00:01** |

El run de `2026-W22` (69 símbolos, el que el contexto identifica como
"el job") **corrió primero**, a las 16:00:01. El de `2026-W21` (300
símbolos) se insertó **después**, a las 16:04:04 — junto con otras
~52 semanas más, desde `2025-W20` (16 de mayo de 2025) hasta `2026-W21`,
todas con `created_at` entre `16:02:51` y `16:04:04` del mismo día:

```
GET /rs_weekly_items?select=snapshot_id,sample_size,snapshot_date,week_key,created_at
    &rank_index=eq.1&order=snapshot_date.asc&limit=50
→ 49 filas distintas de snapshot_date entre 2025-05-16 y 2026-05-22,
  TODAS con created_at en la ventana 16:02:51–16:04:04 del 2026-05-25
```

Eso es **un backfill retroactivo de ~53 semanas insertado en ~73
segundos**, no 53 corridas semanales reales durante un año. Un job que
corre de verdad cada semana no puede insertar un año de historia en
73 segundos; esto es, sin ambigüedad, un script de backfill ejecutado
una sola vez para poblar historia de demo/desarrollo — probablemente
reconstruida desde `scan_symbol_history` (la tabla de histórico
change-only por símbolo) dado que es la única fuente de series
temporales por símbolo que ya existía antes de esa fecha, aunque esto
no está verificado (no hay código que lo confirme, ver A.1).

**El run real distinto (2026-W22, 69 símbolos, 16:00:01) no calculó
RS sobre acciones US.** Es 100% europeo:

```
GET /rs_weekly_items?select=symbol,country
    &snapshot_id=eq.c4d4d2c6-eea8-443b-a0d2-f3d7c3f3b764
    &order=rank_index.asc&limit=69
```
Países presentes: NL, FR, IT, SE, FI, AT, BE, PT, IE — **cero
símbolos US**. Por contraste, el backfill de `2026-W21` (300 símbolos,
insertado 4 minutos más tarde) sí mezcla US, HK, CA, AU — por ejemplo
`FTNT` aparece con `rank_index=29, rs_rating=90` en ese snapshot, la
misma cifra que citas como divergente de la ficha (ver D.10).

**¿Por qué nunca se programó?** No hay ningún disparador:

```
find .github -type f          → (vacío, no existe carpeta .github)
cat vercel.json                → 6 crons definidos (universe-refresh,
   scan-refresh, shadow-europe-refresh, shadow-firds-refresh,
   favorite-snapshots, leaderboards-refresh); NINGUNO apunta a
   rs-weekly ni a nada que escriba en rs_weekly_items
```

No hay evidencia de que fallara — hay evidencia de que **nunca se
conectó a nada que lo disparara periódicamente**. El run real de 69
símbolos parece una ejecución manual de prueba/desarrollo (población
europea, pequeña, probablemente para validar el pipeline antes de
apuntarlo al universo real), seguida inmediatamente de un backfill
manual de historia para que la UI (`app/api/rs-weekly/route.js`, ya
en producción desde el mismo commit) tuviera algo que mostrar en el
gráfico de serie temporal de la ficha. Ninguna de las dos cosas volvió
a ejecutarse.

### A.3 — Qué cambiar para servir a la especificación decidida

Dado que no existe escritor, esto no es "modificar líneas existentes"
— es **construir el escritor desde cero**, usando el contrato que ya
deja claro el DDL + los datos observados como referencia de forma, y
ajustando explícitamente los puntos donde diverge de la decisión de
producto:

| Punto de la spec decidida | Qué implica frente a lo observado en A.1-A.2 |
|---|---|
| Población = ~5.600 símbolos US (5.881 menos ~260 fondos cerrados) | El run real observado (69 símbolos) era europeo; el backfill (300) era una mezcla multi-país sin relación aparente con "el universo US completo". Ninguno de los dos es la población deseada — hay que construirla desde `universe_snapshot_symbols` filtrando `market='US'`, `passed=true`, `instrument_type IN (equity, listed-vehicle)`, y restando el patrón de fondos cerrados (Parte B). |
| ETFs en ranking separado | La tabla `rs_weekly_items` no tiene ninguna columna que distinga ETFs de acciones (ver A.4) — hoy no podría separarlos aunque quisiera. Hace falta una columna o un `engine_version`/`asset_class` distinto por corrida. |
| Fórmula 13/26/39/52 ponderada | Ya existe en la forma reconstruida (`metrics.returns` + pesos 40/20/20/20 inferidos) — si esa reconstrucción es correcta, es reutilizable como referencia de diseño, pero no hay código que copiar, solo el patrón de datos a replicar. |
| Frecuencia semanal | No hay cron ni disparador — hay que crearlo desde cero (Parte C). |
| Nombre "RS"/"fuerza relativa", nunca "RS Rating" | Esto es una restricción de las superficies de UI (Parte D), no de la tabla — la columna se llama `rs_rating` en el DDL, lo cual es un nombre de columna interno y no un texto visible al usuario; no hace falta renombrarla, pero si algún componente renderiza literalmente el nombre del campo como etiqueta, revisarlo. No encontré ningún sitio que muestre el string "RS Rating" al usuario — todas las etiquetas usan `metricShortLabel("rsGlobalPct")` u otros helpers de texto (ver D.10), pero no verifiqué el contenido exacto de `metricShortLabel` para descartarlo del todo. |
| No cabe en Vercel Hobby (60s) | Confirma que el escritor no puede ser una API route de Next en el plan actual — necesita correr fuera de esa invocación (Parte C). |

### A.4 — DDL de `rs_weekly_items`: ¿sirve tal cual?

Cita literal (`supabase/schema.sql:1254-1298`):

```sql
create table if not exists rs_weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_date date not null,
  week_key text not null,
  engine_version text not null,
  base_currency text not null default 'USD',
  lookback_weeks integer[] not null default '{13,26,39,52}'::integer[],
  weights jsonb not null default '{}'::jsonb,
  min_sample integer not null default 20,
  symbol_count integer not null default 0,
  source text,
  stats jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (owner_id, snapshot_date, engine_version, base_currency)
);

create table if not exists rs_weekly_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_id uuid not null references rs_weekly_snapshots(id) on delete cascade,
  snapshot_date date not null,
  week_key text not null,
  engine_version text not null,
  base_currency text not null default 'USD',
  rank_index integer not null,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  currency text,
  normalized_currency text,
  rs_rating numeric,
  rs_raw numeric,
  usd_close numeric,
  local_close numeric,
  fx_rate numeric,
  fx_date date,
  sample_size integer,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol)
);
```

Índices (`supabase/schema.sql:1552-1554`):
```sql
create index if not exists rs_weekly_snapshots_date_idx on rs_weekly_snapshots(owner_id, snapshot_date desc);
create index if not exists rs_weekly_items_snapshot_idx on rs_weekly_items(snapshot_id, rank_index);
create index if not exists rs_weekly_items_symbol_idx on rs_weekly_items(owner_id, symbol, snapshot_date desc);
```

**¿Distingue ranking de acciones vs. ETFs? No.** No hay columna
`instrument_type`, `asset_class`, ni nada equivalente en ninguna de
las dos tablas. Lo más cercano es `engine_version` (texto libre, hoy
`"statsedge-global-rs-usd-v1"` para todo) y `source` en
`rs_weekly_snapshots` (columna existe en el DDL pero no pude leer su
contenido real — la tabla `rs_weekly_snapshots` no está en la lista de
tablas permitidas por la herramienta MCP de solo lectura que tengo
disponible; ver "LO QUE NO HE VERIFICADO").

**Para separar el ranking de ETFs sin tocar el DDL**, la única vía
compatible con el esquema actual es usar `engine_version` distinto por
población (ej. `statsedge-global-rs-usd-v1` para acciones,
`statsedge-global-rs-etf-usd-v1` para ETFs de país/sector) — el
`unique (owner_id, snapshot_date, engine_version, base_currency)` en
`rs_weekly_snapshots` ya soporta dos snapshots la misma semana si
difieren en `engine_version`, así que **el esquema alcanza sin
modificarlo**, siempre que el escritor use dos `engine_version`
distintos y las lecturas (`lib/globalRs.js`) filtren por el que
corresponda. La alternativa de añadir una columna `asset_class` sería
más explícita y consultable, pero es un cambio de esquema que la
opción de `engine_version` no necesita.

---

## PARTE B — Los fondos cerrados

### B.1 — Por qué "COMMON" en el nombre gana sobre "fund"

Cita literal (`lib/universeEngine.js:66-79`):

```js
function instrumentTypeFor(entry = {}) {
  const name = cleanText(entry.name || entry.companyName || "").toUpperCase();
  const symbol = cleanText(entry.symbol).toUpperCase();
  if (/\b(ETF|ETFS|ETC|ETN|INDEX FUND|VANGUARD|BETASHARES|ISHARES|GLOBALX|VANECK)\b/.test(name)) return "fund";
  if (/\b(BONDS?|TREASURY|NOTES?|LOAN|DEBENTURES?|BILLS?)\b/.test(name)) return "debt";
  if (/\b(WARRANTS?|OPTIONS?|RIGHTS?|UNLISTED)\b/.test(name)) return "derivative";
  if (/\bUNITS?\b/.test(name) && !/\b(STAPLED|REIT|PROPERTY|TRUST)\b/.test(name)) return "derivative";
  if (/\b(PREFERRED|PREFERENCE|PREF|CONVERTIBLE)\b/.test(name)) return "hybrid";
  if (/\bDEPOSITARY SHARES?\b/.test(name) && /\b(PREFERRED|PREFERENCE|PERPETUAL)\b/.test(name)) return "hybrid";
  if (/\b(REIT|STAPLED|UNITS STAPLED|PROPERTY TRUST)\b/.test(name)) return "listed-vehicle";
  if (/\b(CDI|ORDINARY|COMMON|PLC|LTD|LIMITED|CORP|CORPORATION|GROUP|HOLDINGS?|INC|SA|AG|NV)\b/.test(name)) return "equity";
  if (symbol.endsWith(".AX") && /^[A-Z0-9]{2,6}\.AX$/.test(symbol)) return "equity";
  if (/^[A-Z0-9.-]{1,12}(\.[A-Z]{1,3})?$/.test(symbol)) return "equity";
  return "unknown";
}
```

El regex de `fund` (línea 69) busca literalmente
`ETF|ETFS|ETC|ETN|INDEX FUND|VANGUARD|BETASHARES|ISHARES|GLOBALX|VANECK`
— es decir, patrones de ETF/ETN por marca o estructura, no la palabra
genérica "FUND". Un fondo cerrado (closed-end fund) legalmente se
llama "Common Stock" en su registro — es literalmente una acción común
listada, aunque su activo subyacente sea una cartera de bonos o
acciones de terceros. Ejemplo real, consultado:

```
GET /universe_snapshot_symbols?select=symbol,name,instrument_type,passed,source
    &market=eq.US&symbol=eq.DHY
→ {"symbol":"DHY","name":"Credit Suisse High Yield Credit Fund Common Stock",
   "instrument_type":"equity","passed":true,...}
```

"Credit Suisse High Yield Credit **Fund** Common Stock" no matchea la
línea 69 (no contiene ninguna de esas palabras clave de ETF), pero sí
matchea la línea 76 (`COMMON`) — y como las condiciones son un
`if`/`return` secuencial, la primera que matchea gana. Como la línea
69 nunca dispara para "Fund" genérico, la 76 lo captura como `equity`.

**No es un caso aislado.** Conteo exacto de símbolos `market='US'`,
`instrument_type='equity'`, `passed=true`, con "FUND" en el nombre:

```
GET /universe_snapshot_symbols?select=symbol
    &market=eq.US&instrument_type=eq.equity&name=ilike.*fund*
    &order=symbol.asc&limit=200[&symbol=gt.<último>]
→ 260 símbolos (200 + 60 en segunda página)
```

Ejemplos: `ADX`, `DHY`, `ARCC`, `BXSL`, `PSEC`, `GOF`, `PTY`, `EOI`,
`NUV`, `MMT`, `UTF` — en su mayoría fondos cerrados de bonos, BDCs
(business development companies) y fondos de país. Es una cota
**inferior aproximada por patrón de texto**: hay fondos cerrados sin
"FUND" en el nombre que este conteo no captura (falso negativo
seguro), y podría haber alguna empresa operativa con "fund" en el
nombre por casualidad (falso positivo no descartado caso por caso).

### B.2 — Cómo identificarlos de forma fiable (opciones, sin decidir)

| Opción | Qué se toca | Riesgo de falso positivo/negativo |
|---|---|---|
| **Ampliar el patrón de nombre** (añadir `\bFUND\b`, `\bBDC\b`, `\bCLOSED-END\b`, etc. a la línea 69 o a una nueva categoría) | `lib/universeEngine.js:69` (o una regla nueva) | Falso positivo: empresas operativas con "Fund" en el nombre por razones históricas (raro pero posible, ej. algún banco/gestora que cotiza como acción común). Falso negativo: fondos cerrados que no incluyen "Fund" en su nombre registrado (ej. algunos BDCs se llaman "... Corporation" o "... Capital Corp", indistinguibles de una empresa operativa por texto). Este último caso ya se ve en los datos: `ARCC` = "Ares Capital Corporation - Closed End Fund" sí lo dice explícito, pero no todos los BDCs lo hacen tan claro. |
| **Usar un campo del proveedor** (si NasdaqTrader o algún proveedor futuro expone un código de tipo de instrumento, ej. CEF/BDC flag) | Requeriría un campo que hoy `fetchUSUniverse()` ([lib/universes.js:274-335](lib/universes.js#L274-L335)) no extrae de `nasdaqtraded.txt`/`otherlisted.txt` — habría que revisar si esos ficheros traen alguna columna de tipo de instrumento que hoy se descarta. No lo verifiqué (ver "LO QUE NO HE VERIFICADO"). | Si el campo existe y es fiable, cero falsos positivos/negativos por patrón de texto — pero depende de que NasdaqTrader lo publique con esa granularidad, que no confirmé. |
| **Lista curada** (mantener a mano el conjunto de ~260+ símbolos conocidos como fondos cerrados, actualizada periódicamente) | Una tabla o archivo nuevo, sin tocar el regex existente | Riesgo de que quede desactualizada: nuevos IPOs de fondos cerrados no entrarían hasta actualizar la lista a mano; nula automatización. Cero falsos positivos sobre lo ya catalogado, pero cobertura decreciente con el tiempo si no se mantiene. |

No decido cuál — cada una tiene un trade-off distinto entre esfuerzo
de mantenimiento y precisión, y la respuesta correcta probablemente
combine dos (ej. patrón de nombre ampliado + lista curada para los
casos que el patrón no captura, tipo BDCs sin "Fund" en el nombre).

### B.3 — ¿Excluir del RS implica excluir del screener?

**Son decisiones independientes, y hoy están acopladas por el mismo
campo.** `instrumentTypeFor()` alimenta `qualityGate()`
([lib/universeEngine.js:82-98](lib/universeEngine.js#L82-L98)), que es
la puerta que decide `passed` para **todo el universo**, no solo para
el cálculo de RS. Si hoy se corrige la clasificación de estos ~260
símbolos a, por ejemplo, `fund`, la línea 90
(`if (["fund", "debt", "derivative", "hybrid"].includes(instrumentType)) reasons.push(...)`)
los sacaría de `passed=true` — es decir, **desaparecerían del universo
entero**, no solo del cálculo de RS. Eso los quitaría también del
screener, de la tabla, de todo lo que hoy filtra por `passed=true`.

Las dos opciones y qué haría falta para cada una:

1. **Excluir del universo entero (vía `instrumentTypeFor`/`qualityGate`)**:
   no hace falta tocar nada del diseño del RS — el job de RS
   simplemente heredaría la exclusión igual que hoy hereda cualquier
   otro `passed=false`. Efecto colateral: un usuario que hoy usa el
   screener para buscar BDCs o fondos cerrados de renta (uso legítimo,
   aunque no sea el caso de uso principal de Weinstein/Minervini) deja
   de poder encontrarlos ahí.
2. **Excluir solo del cálculo de RS, mantenerlos en el screener**:
   requiere que el job de RS aplique su propio filtro adicional
   (patrón de nombre u otra señal) **sobre** el conjunto
   `passed=true`, en vez de heredar `instrument_type` como única
   fuente de verdad. Esto significa que el job de RS necesitaría su
   propia lógica de clasificación (duplicando o reutilizando el
   patrón de B.2), separada de `instrumentTypeFor()`. Mantiene el
   screener intacto para quien busque fondos cerrados, a cambio de
   una segunda fuente de clasificación que puede divergir de la
   primera con el tiempo si no se sincronizan.

No decido cuál — el punto en juego es si "no apto para RS" y "no apto
para el screener" deben ser el mismo criterio o dos criterios
distintos que hoy comparten código por accidente de diseño, no por
intención.

---

## PARTE C — Dónde corre

Vercel Hobby: 60s por invocación — confirmado por el contexto de la
tarea, no reverificado por mí en esta sesión (no tengo acceso al
dashboard de Vercel). Asumo el dato como dado.

| Opción | Qué habría que construir | Riesgo | Costo |
|---|---|---|---|
| **GitHub Actions** (repo privado, 2.000 min/mes gratis, tope 6h/job) | Un workflow YAML (`.github/workflows/*.yml`, hoy no existe — confirmado, `find .github -type f` no devuelve nada) que dispare en cron semanal, haga checkout, instale deps, ejecute un script Node que lea `universe_snapshot_symbols`+`daily_bars` vía Supabase (con la service role key como GitHub Secret) y escriba en `rs_weekly_snapshots`/`rs_weekly_items`. | Depende de que GitHub Actions tenga salida a internet para llamar a Supabase (normalmente sí, es un runner alojado). Riesgo operativo bajo — es la opción más estándar para este tipo de job. Riesgo de gestión de secretos: la service role key vive en GitHub Secrets, fuera del control de Supabase RLS igual que hoy vive en Vercel. | Dentro del tope gratuito con margen amplio: si el job completo (descarga + cálculo, Parte C.9) tarda del orden de minutos, un run semanal consume una fracción mínima de los 2.000 min/mes. |
| **Mac Mini doméstico siempre encendido** | Un script + `cron`/`launchd` local que haga lo mismo que el workflow de GitHub Actions, pero corriendo en una máquina física bajo tu control directo. | Depende de que la máquina esté realmente encendida y con red cada semana — un corte de luz/red o un reinicio sin `launchd` configurado correctamente hace que el job silenciosamente no corra esa semana, sin ninguna alerta a menos que se construya una. Es el único de los tres sin ningún backstop de plataforma (GitHub Actions y Supabase Edge Functions al menos notifican fallos en su propio dashboard). | Cero costo de cómputo (ya es tuya), pero costo de mantenimiento operativo (parchear el SO, vigilar que el cron siga vivo, sin nadie más que tú monitoreándolo). |
| **Supabase Edge Functions** (Deno, 400s/invocación en plan Pro) | Una función en `supabase/functions/`, invocada por `pg_cron` (ya usado en este proyecto — ver el job de purga en `supabase/schema.sql:1577+`) o por un disparador externo (ej. GitHub Actions solo para invocar el endpoint HTTP de la función, delegando el cómputo a Supabase). | 400s es más ajustado que el tope de 6h de GitHub Actions o la ausencia de tope de un Mac Mini. Si el cálculo completo (Parte C.9) se acerca a ese límite, hay que trocear el trabajo en varias invocaciones encadenadas, lo cual añade complejidad de orquestación que no existe hoy en el proyecto (no hay precedente de Edge Functions troceadas en este repo, solo el uso de `pg_cron` para el job de purga). Runtime Deno, no Node — cualquier dependencia npm usada en el resto del proyecto (ej. para I/O de barras) necesitaría equivalente compatible con Deno o reescritura. | Incluido en el plan Pro ya contratado (según memoria de sesión, Supabase Pro es el plan actual) hasta el tope de invocaciones/cómputo del plan; no tengo cifras exactas de cuota Edge Functions del plan Pro para dar un costo numérico — no lo verifiqué. |

No decido cuál — el trade-off central es: GitHub Actions es lo más
estándar y con menos piezas nuevas que mantener (solo un YAML), el Mac
Mini es gratis en cómputo pero depende de que una máquina física siga
viva y conectada sin supervisión de plataforma, y Supabase Edge
Functions mantiene todo dentro del mismo proveedor de datos pero con
el límite de tiempo más estrecho de los tres y un runtime distinto
(Deno) al del resto del proyecto (Node/Next.js).

### C.9 — Tiempo total estimado del cálculo semanal

**Medido** (dado por el contexto de la tarea, no remedido en esta
sesión): 410 ms/símbolo para descargar 2 años de barras.

**Piezas del cálculo semanal y su naturaleza (medición vs. estimación)**:

1. **Descargar barras que falten**: la tarea previa (documentada en
   [docs/universo-us-rs-2026-08-08.md](docs/universo-us-rs-2026-08-08.md))
   estimó por extrapolación (muestra de 120 símbolos, no medición
   exacta) que **≈834 símbolos** del universo US investable no tienen
   ninguna barra hoy. A 410 ms/símbolo: `834 × 0.41s ≈ 342s ≈ 5.7 min`
   — esto combina una medición real (410ms) con una población
   estimada (834), así que el resultado final es una **estimación**,
   no una medición.
2. **Leer barras de ~5.600 símbolos desde `daily_bars` para calcular
   rendimientos de 13/26/39/52 semanas**: no medido. `daily_bars` es
   una de las dos tablas que el aviso de la tarea marca explícitamente
   como propensa a timeout sin filtro (`daily_bars` sin filtro por
   símbolo da timeout) — cualquier diseño del job tiene que leer
   símbolo por símbolo o en lotes pequeños, igual que se hizo en la
   tarea anterior para la muestra de 120 (lotes de 5, con fallback a
   paginación individual). Sin medir el tiempo real de ~5.600 lecturas
   de ese tipo, no puedo dar una cifra fiable — extrapolar
   linealmente desde la muestra de 120 sería especulativo porque el
   cuello de botella ahí no fue el I/O de Yahoo Finance sino el de
   Supabase/PostgREST, con un patrón de acceso distinto al de una
   descarga.
3. **Calcular rendimientos + ordenar + percentil sobre ~5.600
   valores**: no medido, pero es una operación de ordenamiento
   (`O(n log n)`) sobre unos pocos miles de números en memoria —
   trivial en cualquier runtime moderno (milisegundos a pocos
   segundos), razonado por la naturaleza de la operación, no medido
   contra este pipeline real.
4. **Persistir en `rs_weekly_snapshots`/`rs_weekly_items`**: ~5.600
   `INSERT` (o un `INSERT` por lote) — no medido, pero del mismo orden
   de magnitud que cualquier `INSERT` masivo ya hecho en este proyecto
   (ej. el backfill de 53 semanas insertado en 73 segundos observado
   en A.2, que fue un volumen bastante mayor — 53 semanas × 300-500
   símbolos ≈ 20.000+ filas en 73s, así que 5.600 filas de una sola
   semana debería ser sustancialmente más rápido, por analogía, no por
   medición directa de este pipeline).

**Total estimado (no medido de punta a punta)**: la pieza 1 (descarga)
es la única con una base de medición real, en el orden de minutos. Las
piezas 2-4 son inferencias razonadas, no medidas, pero cada una por
separado es plausiblemente del orden de segundos a pocos minutos. Sumado
con margen generoso, el cálculo semanal completo probablemente cae en
un rango de **varios minutos a un par de decenas de minutos**, muy por
debajo de cualquiera de los tres topes de la Parte C.8 (6h de GitHub
Actions, sin tope del Mac Mini, 400s×N invocaciones de Edge Functions
si se trocea). No tengo una medición end-to-end de este pipeline
concreto para dar una cifra más precisa que esa banda.

---

## PARTE D — Cómo lo leen las pantallas

### D.10 — Todas las superficies que muestran RS hoy, y de dónde lo sacan

Búsqueda exhaustiva de consumidores de `rsGlobalPct`/`rsRating`/
`globalRsSeries` en `app/`:

```
grep -rln "globalRsSeries\|relativeStrength\.rating\|rsGlobalPct" \
  --include="*.jsx" --include="*.js" app/ components/
→ app/ScreenerOriginPanel.jsx, app/page.jsx, app/market-health/page.jsx,
  app/sectors/page.jsx, app/components/screener/ResultFilterBar.jsx,
  app/components/screener/QuickReviewModal.jsx, app/review/page.jsx,
  app/api/company-brief/route.js, app/api/scans/route.js,
  app/stock/[symbol]/StockClient.jsx
```

| Superficie | Fuente del número mostrado | Cita |
|---|---|---|
| Tabla del screener (`app/page.jsx`) | `r.rsGlobalPct` directo del `scan_results` del último escaneo (percentil batch) | `app/page.jsx:1560` (export CSV, mismo campo que la columna de tabla) |
| Panel de origen del screener (`ScreenerOriginPanel.jsx`) | `firstMetricItem(byKey, ["rsGlobalPct", "rsRating"])` — batch primero | `app/ScreenerOriginPanel.jsx:188` |
| Salud de mercado (`market-health/page.jsx`) | `rsGlobalPct` del batch, con fallback a `rsRating` (benchmark) si no está disponible | `app/market-health/page.jsx:41,650,660,676` |
| Sectores (`sectors/page.jsx`) | `rsGlobalPct` del batch (promedio de grupo y por fila) | `app/sectors/page.jsx:287,565,599` |
| Ordenar resultados (`ResultFilterBar.jsx`) | Opciones de orden explícitas por `rsGlobalPct` o `rsRating` (batch, ninguna opción semanal) | `app/components/screener/ResultFilterBar.jsx:91-92` |
| Modal de revisión rápida (`QuickReviewModal.jsx`) | `activeModalRow.rsGlobalPct` (batch) | `app/components/screener/QuickReviewModal.jsx:272` |
| Página de revisión (`review/page.jsx`) | Hidrata desde `/api/company-brief`, toma `rs.rsGlobalPct` — y como se ve abajo, ese campo en el payload de `company-brief` **tampoco** prioriza semanal | `app/review/page.jsx:290`, ver `mergeUniverseRelativeStrength` |
| **Ficha de símbolo (`StockClient.jsx`)** | **Sí prioriza semanal**: `weeklyGlobalRs?.rsRating` primero, `rs.rsGlobalPct` (batch) como fallback | `app/stock/[symbol]/StockClient.jsx:496-497,519-521,1719-1721`: `const rsUniverse = finiteValue(weeklyGlobalRs?.rsRating, rs.rsGlobalPct);` |
| API `company-brief` (`app/api/company-brief/route.js`) | Construye `relativeStrength` con `mergeUniverseRelativeStrength(benchmarkStrength, universeSnapshot, weeklyGlobalRs)` — el campo `rating`/`rsGlobalPct` del payload usa `universe.rsGlobalPct` (batch), **no** el semanal; el semanal solo se expone aparte como `globalRsSeries` (serie completa) y en metadatos de frescura (`rsGlobalAsOf`, `rsGlobalEngineVersion`) | `app/api/company-brief/route.js:886-950` (`mergeUniverseRelativeStrength`, citado en A.1 arriba) |

**Esto confirma con precisión el mecanismo exacto de la divergencia
FTNT 97 vs 90 que menciona el contexto**: `company-brief` entrega
`rsGlobalPct=97` (el del último escaneo, batch) dentro de
`relativeStrength`, y por separado `globalRsSeries` con el histórico
semanal (donde FTNT tiene `rank_index=29, rs_rating=90` en el snapshot
`2026-W21`, verificado arriba en A.2). Todas las superficies excepto
`StockClient.jsx` leen `relativeStrength.rsGlobalPct` (97). Solo
`StockClient.jsx` recalcula localmente `rsUniverse` tomando primero el
último punto de `globalRsSeries` (90) y solo cae a 97 si no hay serie
semanal. Es decir: **la divergencia no es un bug de datos, es que dos
piezas de UI leen dos campos distintos del mismo payload**, con
prioridad invertida entre sí.

### D.11 — Símbolo sin ranking semanal (recién incorporado, sin barras suficientes): opciones sin decidir

1. **No mostrar RS**: el campo queda `null`/vacío en toda la UI para
   ese símbolo. Consistente y honesto, pero dejaría "huecos" en tablas
   ordenadas por RS y podría leerse como un fallo de datos si el
   usuario no entiende por qué falta.
2. **Mostrarlo marcado como "no disponible"** (un estado explícito,
   distinto de un valor bajo): requiere que cada superficie de D.10
   sepa distinguir "RS=null porque no hay dato" de "RS=null porque el
   valor real es bajo" — hoy `Number.isFinite(...)` ya se usa como
   guard en varios sitios (ej. `market-health/page.jsx:41`), así que
   la distinción técnica existe, pero faltaría decidir la copy/UX de
   "no disponible" en cada sitio que hoy simplemente omite el dato.
3. **Caer al RS del escaneo** (el patrón que ya usa `StockClient.jsx`
   para el caso inverso — cuando falta el semanal, cae al batch):
   aplicar la misma idea en reversa no tiene sentido literal aquí
   (el batch de escaneo también necesitaría datos suficientes), pero
   la variante real de esta opción es: si el símbolo tiene datos
   parciales (menos de 52 semanas pero más que el mínimo de muestra),
   calcular un RS parcial con las ventanas disponibles en vez de
   ninguna. Esto es coherente con cómo ya funciona
   `percentileFromSorted` con un `minSample` configurable
   ([lib/relativeStrength.js:192-201](lib/relativeStrength.js#L192-L201)),
   pero para el job semanal significa decidir un mínimo de ventanas
   disponibles (¿sirve un RS calculado solo con 13w y 26w si no hay
   39w/52w?) — no lo resuelvo aquí, solo señalo que la pieza técnica
   para soportarlo (percentil con muestra mínima configurable) ya
   existe en el código del RS del escaneo y podría reutilizarse en
   diseño, aunque no en el mismo archivo.

### D.12 — `minRsRating`: ¿debería filtrar por el semanal?

Cita literal de dónde filtra hoy (`lib/screenerFilters.js:737-741`):
```js
const minRsRating = finite(set.minRsRating);
if (Number.isFinite(minRsRating) && minRsRating > 0) {
  const rs = metric(row, "rsGlobalPct");
  if (!Number.isFinite(rs) || rs < minRsRating) return reject("minRsRating", `RS universo ${Number.isFinite(rs) ? rs.toFixed(0) : "sin dato"} < ${minRsRating}`);
}
```
Confirmado: filtra sobre `metric(row, "rsGlobalPct")`, es decir, el
percentil del **batch del escaneo**, no el semanal — porque hoy el
semanal ni siquiera llega a `row` en el pipeline del screener (D.10:
solo `StockClient.jsx`, fuera del pipeline de filtrado, lo consume).

**Qué cambia en cada caso:**

- **Si sigue filtrando por el batch** (statu quo, pero ahora el batch
  seguiría siendo por-escaneo, no por-universo-completo — la decisión
  de producto no toca esto directamente a menos que también se decida
  reemplazar el cálculo batch del escaneo por una lectura del
  percentil semanal ya calculado): el filtro sigue siendo tan variable
  como hoy si el lote del escaneo es pequeño (el propio contexto ya
  señala que con lotes pequeños `rsGlobalPct` sale `null` por el
  mínimo de muestra `RS_GLOBAL_MIN_SAMPLE=20` en
  [lib/relativeStrength.js:4](lib/relativeStrength.js#L4)). El nuevo
  job semanal no arregla nada de esto si el filtro sigue leyendo
  `rsGlobalPct` del escaneo en vez del semanal.
- **Si pasa a filtrar por el semanal**: el filtro se vuelve estable
  semana a semana (no depende del tamaño del lote de cada escaneo,
  que es justo el problema que motiva toda esta decisión de producto),
  pero introduce el caso de D.11 — símbolos sin fila en
  `rs_weekly_items` esa semana quedarían excluidos de cualquier filtro
  `minRsRating > 0`, sea porque son nuevos, sea porque no tienen
  barras suficientes, sea porque son de un tipo excluido (Parte B). Si
  la opción elegida en D.11 es "no mostrar RS" sin más, esos símbolos
  simplemente desaparecerían de cualquier búsqueda filtrada por RS
  mínimo — lo cual podría ser deseable (no calificarlos es honesto) o
  problemático (un símbolo legítimo recién correjido de clasificación,
  por ejemplo, quedaría invisible hasta la siguiente corrida semanal).

No decido cuál — el punto en juego es que cambiar la fuente del filtro
no es solo "apuntar a otra columna": cambia qué símbolos son
filtrables en absoluto, y eso depende de qué se decida en D.11.

---

## PARTE E — Plan por fases (de menor a mayor riesgo)

**Fase 0 — Verificable sin tocar producción ni lo que ve el usuario:**
reconstruir y validar el escritor del RS semanal **en un entorno
aislado** (ej. un script local que lea de Supabase de solo lectura —
usando `mcp__supabase-readonly__supabase_query` o credenciales de
lectura equivalentes — y escriba a un archivo/tabla temporal, no a
`rs_weekly_snapshots`/`rs_weekly_items` reales), calculando el RS
semanal para el universo US completo (~5.600 símbolos tras excluir
fondos, Parte B) y comparando manualmente una muestra de resultados
contra el RS actual del escaneo para verificar que la fórmula
reconstruida en A.1 (pesos 40/20/20/20) produce números razonables.
Esto no requiere cron, no requiere GitHub Actions, no requiere tocar
`rs_weekly_items` real, y es enteramente verificable por comparación
de números en un archivo de salida — es el análogo de este mismo
documento pero para el cálculo, no solo para el inventario de datos.

**Fase 1 — Escritor real, pero apuntando a datos que nadie lee todavía:**
implementar el job completo (descarga de barras faltantes + cálculo +
persistencia) escribiendo en `rs_weekly_snapshots`/`rs_weekly_items`
reales con un `engine_version` **nuevo** (ej.
`statsedge-global-rs-usd-v2` o similar, distinto del
`statsedge-global-rs-usd-v1` que ya usa `lib/globalRs.js`), corriendo
manualmente (sin cron todavía) una vez para producir un snapshot real
completo del universo US. Como ninguna superficie de UI lee ese
`engine_version` nuevo (D.10: `lib/globalRs.js` no filtra por
`engine_version` en su `select`, así que técnicamente sí lo leería —
esto habría que verificarlo con cuidado antes de esta fase, ya que
podría no ser tan inocuo como parece a primera vista si el número de
símbolos con `engine_version` nuevo pisa el más reciente por fecha).
Riesgo: bajo si se verifica primero que el filtro de lectura no
mezcla versiones; medio si no se verifica.

**Fase 2 — Disparador automático, sin exponer todavía a filtros ni al
screener:** conectar el job a un cron real (Parte C, opción a elegir)
para que corra semanalmente sin intervención manual, pero manteniendo
el `engine_version` separado de Fase 1 — de modo que si algo falla en
una corrida automática, no afecta a ninguna superficie visible
todavía. Riesgo: medio — ya hay una pieza de infraestructura nueva
corriendo sola en producción (el cron), aunque su salida sigue siendo
invisible para el usuario.

**Fase 3 — Exponer al ranking (ficha + tabla), con separación
ETF/acciones y decisión de `minRsRating`:** aquí es donde se resuelven
las preguntas abiertas de la Parte D (D.11, D.12) y se conecta el
nuevo `engine_version` a las superficies reales, sustituyendo o
complementando el `rsGlobalPct` del batch. Riesgo: alto — es el primer
punto donde un error de cálculo o de población es visible
directamente al usuario y puede afectar decisiones de trading. Debería
ser la última fase, con verificación manual explícita (Regla dura #2
de `CLAUDE.md`: verificación visual real antes de comitear cambios
estructurales) antes de cualquier despliegue.

---

## CONFIANZA

- **Alta (medición directa, consulta citada, reproducible)**: A.1
  (ausencia de código escritor en el repo, estructura de
  `metrics.returns`, normalización USD por fila), A.2 (los dos eventos
  del 2026-05-25 con sus `created_at` exactos, la composición 100%
  europea del run de 69 símbolos, la ausencia de cron/workflow), A.4
  (DDL literal), B.1 (código de `instrumentTypeFor`, el caso DHY, el
  conteo de 260), D.10 (todas las citas de línea de las superficies de
  UI y el mecanismo exacto de la divergencia).
- **Media (reconstrucción razonada a partir de datos, no lectura
  directa de código)**: la fórmula de pesos 40/20/20/20 de `rs_raw`
  (A.1) — cuadra exacto en 2 de 2 filas probadas, pero no en las 69+
  filas del snapshot ni en casos con datos faltantes.
- **Baja / inferencia sin medición**: C.9 (tiempo total del cálculo
  semanal más allá de la pieza de descarga), la hipótesis de que el
  backfill de 53 semanas se generó desde `scan_symbol_history` (nunca
  verificada contra código, es la explicación más plausible dado lo
  que existe en el proyecto, no una certeza).

## LO QUE NO HE VERIFICADO

- No pude leer `rs_weekly_snapshots` directamente — no está en la
  lista de tablas permitidas por la herramienta MCP de solo lectura
  (`mcp__supabase-readonly__supabase_query`), que sí permite
  `rs_weekly_items`. Todo lo dicho sobre `weights`, `lookback_weeks`,
  `source`, `stats` de esa tabla viene del DDL (A.4), no de filas
  reales — no confirmé qué valores tiene realmente esa tabla hoy.
- No verifiqué si `nasdaqtraded.txt`/`otherlisted.txt` (la fuente del
  universo US) exponen algún campo de clasificación de instrumento que
  `fetchUSUniverse()` hoy descarta al construir el objeto — relevante
  para la opción "campo del proveedor" de B.2, que dejé como
  hipótesis sin confirmar.
- No medí el tiempo real de lectura de `daily_bars` para ~5.600
  símbolos con el patrón de acceso que un job de producción usaría
  (lotes, keyset pagination) — la pieza 2 de C.9 es la más incierta de
  toda la estimación de tiempo total.
- No verifiqué la cuota exacta de invocación/cómputo de Supabase Edge
  Functions en el plan Pro actual del proyecto (memoria de sesión dice
  que el plan es Pro, pero no confirmé límites de Edge Functions
  específicamente) — el costo de esa opción en la Parte C.8 queda sin
  cifra.
- No confirmé si `metricShortLabel()` u otro helper de texto podría
  renderizar literalmente la cadena "RS Rating" en algún punto de la
  UI que no inspeccioné línea por línea — solo revisé los sitios que
  consumen los campos de datos (`rsGlobalPct`/`rsRating`), no el
  diccionario completo de etiquetas.
- No tengo forma de confirmar, sin acceso a los ficheros crudos de
  NasdaqTrader en el momento en que corrió el universo, si los ~260
  símbolos detectados por patrón "FUND" en B.1 son efectivamente todos
  fondos cerrados — es una inferencia por nombre, no una verificación
  instrumento por instrumento contra una fuente autoritativa (ej. la
  lista de CEFs de la SEC o de CEF Connect).
- No repetí ni verifiqué la medición de 410 ms/símbolo del contexto de
  la tarea en esta sesión — la tomo como dada porque el contexto la
  marca explícitamente como medición real de terminal.
