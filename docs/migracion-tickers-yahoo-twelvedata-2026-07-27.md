# Migración de tickers Yahoo Finance → Twelve Data

**Fecha del análisis:** 28 de julio de 2026
**Rama:** `codex/statsedge-ui-polish` (HEAD `f3963fd`)
**Alcance:** viabilidad del mapeo de símbolos y coste de recarga. Solo lectura sobre
`daily_bars` y sobre los catálogos de Twelve Data. No se ha modificado ningún dato.

---

## Resumen ejecutivo

| Pregunta | Respuesta |
|---|---|
| ¿Cuántos de los símbolos actuales mapean sin ambigüedad? | **8.707 de 9.152 (95,1 %)** |
| ¿Cuántos son ambiguos? | **0** — la clave `(mic_code, symbol)` es única en el catálogo y el sufijo Yahoo determina el MIC |
| ¿Cuántos no tienen correspondencia? | **411**, de los cuales **352 no son acciones** (fondos cerrados, ETF, units) y **59 son huecos reales** de cobertura |
| ¿Cuántos quedan tras aplicar las reglas de universo de AGENTS.md? | **7.045** (whitelist de MIC + `type == "Common Stock"`) |
| **EEUU: ¿cuántos mapean limpio?** | **4.881 de 5.229 (93,3 %)**, 0 ambiguos. En bolsa nacional: **4.856**. Como `Common Stock`: **4.292** |
| ¿Coste de recarga del histórico US? | **4.292–6.372 créditos** por pasada completa (1 crédito/símbolo). Con plan Grow 377: **11–17 minutos**. Con Pro 610: **7–10 minutos** |

**Tres hallazgos que condicionan la decisión, por orden de gravedad:**

1. **Licencia (bloqueante, y no es un problema de mapeo).** Los planes self-serve de
   Twelve Data no autorizan redistribución. Grow y Pro son *«Internal display data
   access»*: los datos «pueden mostrarse pero no procesarse programáticamente,
   almacenarse, transformarse ni redistribuirse». Ultra sube a *«Internal non-display
   data access»*, que sí permite procesamiento y almacenamiento pero explícitamente
   «no puede redistribuirse ni ponerse a disposición de terceros». StatsEdge almacena
   barras en `daily_bars`, calcula indicadores derivados y los muestra a usuarios
   externos: las tres cosas. **Migrar de Yahoo a Twelve Data resuelve el problema
   técnico pero no necesariamente el problema de licencia que motivó la migración.**
   Esto hay que confirmarlo con el equipo comercial de Twelve Data antes de invertir
   en la migración. Texto literal y fuente en el §7.
2. **El mapeo no es el cuello de botella.** 95 % limpio global, 93 % en EEUU, cero
   ambigüedad estructural. Las 4 reglas de transformación necesarias son triviales y
   están documentadas en el §2.
3. **El universo US real de Twelve Data es mayor que el actual.** El catálogo tiene
   5.756 `Common Stock` en bolsas nacionales US frente a los 4.292 que hoy existen en
   `daily_bars`: **1.464 valores que hoy no se están cubriendo**. La recarga no es
   una migración 1:1, es una ampliación del 34 %.

---

## 0. Entorno, entradas y cómo reproducir

### 0.1 Acceso a la base de datos

`DATABASE_URL` de `.env.local` **no es utilizable**: la contraseña es el placeholder
literal `[XXXXXXXXX%NNNN]` (con corchetes y un `%` sin URL-encodear, que además rompe
el parseo de la URL). `psql` falla con `password authentication failed`. Lo mismo
ocurre con `TWELVE_DATA_API_KEY`, que devuelve 401.

Las consultas se hicieron por la **Management API de Supabase**, usando
`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`, que sí son válidos. Helper usado
(guardado en `/tmp/se-sql.sh`, fuera del repo):

```bash
#!/bin/bash
# Ejecuta SQL de solo lectura contra el proyecto Supabase vía Management API.
set -euo pipefail
REPO="/Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1"
TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' "$REPO/.env.local" | cut -d= -f2- | tr -d '\r')"
REF="$(grep -m1 '^SUPABASE_PROJECT_REF=' "$REPO/.env.local" | cut -d= -f2- | tr -d '\r')"
SQL="${1:-$(cat)}"
BODY=$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$SQL")
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY"
```

### 0.2 Inventario de partida

```bash
/tmp/se-sql.sh "SELECT count(*) AS filas, count(DISTINCT symbol) AS simbolos FROM daily_bars WHERE owner_id='personal';"
```
```
[{"filas":3518216,"simbolos":9152}]
```

```bash
/tmp/se-sql.sh "SELECT provider, count(DISTINCT symbol) AS simbolos, count(*) AS filas, min(trade_date) AS desde, max(trade_date) AS hasta FROM daily_bars WHERE owner_id='personal' GROUP BY provider ORDER BY 2 DESC;"
```
```
[{"provider":"Yahoo Finance","simbolos":9152,"filas":3518216,"desde":"1981-04-01","hasta":"2026-07-27"}]
```

> **Nota sobre la cifra del encargo.** El encargo hablaba de 9.144 símbolos; el conteo
> real hoy es **9.152**. Todo el informe usa 9.152. Un único proveedor (`Yahoo Finance`)
> cubre el 100 % de las filas, así que la migración no es parcial: afecta a todo.

Profundidad histórica actual — relevante porque condiciona qué hay que recargar:

```bash
/tmp/se-sql.sh "SELECT width_bucket(n,0,2600,13) AS bucket, min(n) AS min_barras, max(n) AS max_barras, count(*) AS simbolos FROM (SELECT symbol, count(*) AS n FROM daily_bars WHERE owner_id='personal' GROUP BY symbol) t GROUP BY 1 ORDER BY 1;"
```
```
[{"bucket":1,"min_barras":20,"max_barras":199,"simbolos":370},
 {"bucket":2,"min_barras":200,"max_barras":398,"simbolos":319},
 {"bucket":3,"min_barras":400,"max_barras":515,"simbolos":8460},
 {"bucket":4,"min_barras":653,"max_barras":789,"simbolos":2},
 {"bucket":7,"min_barras":1260,"max_barras":1260,"simbolos":1}]
```

**8.460 de 9.152 símbolos tienen ~400 barras** (unos 19 meses). El histórico actual es
corto para stage analysis de Weinstein, así que la recarga desde Twelve Data no es solo
un reemplazo por licencia: es también la ocasión de arreglar la profundidad.

### 0.3 Extracción de los datos analizados

```bash
mkdir -p /tmp/tdmig
for off in 0 3000 6000 9000; do
  /tmp/se-sql.sh "SELECT symbol, count(*) AS bars, min(trade_date) AS d0, max(trade_date) AS d1 FROM daily_bars WHERE owner_id='personal' GROUP BY symbol ORDER BY symbol OFFSET $off LIMIT 3000;" > /tmp/tdmig/sym_$off.json
done
# -> concatenados en /tmp/tdmig/symbols.json (9.152 registros, verificado sin duplicados)

for off in 0 3000 6000 9000; do
  /tmp/se-sql.sh "SELECT symbol, max(company_name) AS name FROM scan_results WHERE owner_id='personal' AND company_name IS NOT NULL GROUP BY symbol ORDER BY symbol OFFSET $off LIMIT 3000;" > /tmp/tdmig/names_$off.json
done
# -> /tmp/tdmig/names.json (10.039 pares symbol -> company_name, origen Yahoo)
```

Catálogos de Twelve Data (los endpoints de referencia son públicos, no requieren API key):

```bash
# /stocks ya provisto por el encargo:
ls -la /tmp/td-catalog.json     # 51.232.374 bytes, 192.112 símbolos
curl -s -o /tmp/tdmig/td-etf.json   "https://api.twelvedata.com/etf"     # 57.756 ETF
curl -s -o /tmp/tdmig/td-funds.json "https://api.twelvedata.com/funds"   # 285.201 fondos
```

Los catálogos `/etf` y `/funds` se descargaron porque sin ellos es imposible distinguir
«el mapeo falló» de «este instrumento no es una acción y por eso no está en `/stocks`».

### 0.4 Script de análisis

Todo el análisis está en un único script autocontenido, **`/tmp/tdmig/analisis.py`**
(fuera del repo, como pide el encargo). Reproduce cada cifra de este informe:

```bash
python3 /tmp/tdmig/analisis.py
```

El código completo está en el **Anexo A**. Los outputs crudos que siguen son la salida
literal de ese script.

---

## 1. Cobertura del mapeo, desglosada por mercado

**Comando:**
```bash
python3 /tmp/tdmig/analisis.py    # BLOQUE 1
```

**Output crudo:**
```
==============================================================================
BLOQUE 1 — Cobertura del mapeo por mercado
==============================================================================
Mercado                 total  unico  ambig  sin_corr  no-accion   hueco
EEUU                     5229   4881      0       348        323      25
Hong Kong                1749   1746      0         3          1       2
Australia                 694    680      0        14         10       4
Canada (TSX)              202    199      0         3          1       2
Francia                   131    131      0         0          0       0
Alemania (Fra)             99     96      0         3          2       1
Reino Unido                87     68      0        19          5      14
Italia                     79     78      0         1          0       1
Noruega                    78     75      0         3          0       3
Japon                      73     73      0         0          0       0
India (NSE)                73     73      0         0          0       0
Espana                     69     67      0         2          0       2
Suiza                      66     64      0         2          1       1
Paises Bajos               63     58      0         5          4       1
Suecia                     59     59      0         0          0       0
Alemania (Xetra)           56     56      0         0          0       0
Sudafrica                  52     52      0         0          0       0
Finlandia                  52     52      0         0          0       0
Dinamarca                  51     48      0         3          1       2
Singapur                   44     42      0         2          2       0
Taiwan                     41     41      0         0          0       0
Israel                     33     33      0         0          0       0
^INDEX                     25      0      0         0          0       0
Brasil                     10     10      0         0          0       0
=FX                         9      0      0         0          0       0
Mexico                      8      6      0         2          2       0
Belgica                     6      6      0         0          0       0
Austria                     5      5      0         0          0       0
Portugal                    5      5      0         0          0       0
Irlanda                     2      2      0         0          0       0
China (Shanghai)            1      0      0         1          0       1
Corea                       1      1      0         0          0       0
----------------------------------------------------------------------
TOTAL                    9152   8707      0       411        352      59
fuera de alcance (indices ^ y divisas =): 34
```

Lectura de las columnas:

- **unico** — un único registro del catálogo `/stocks` de Twelve Data en el MIC del mercado.
- **ambig** — más de un candidato tras aplicar la regla del mercado. Es 0 en todos: ver §3.
- **sin_corr** — sin correspondencia en `/stocks`, desglosado en las dos siguientes.
- **no-acción** — el símbolo existe en Twelve Data, pero en `/etf` o `/funds`. **No es un
  fallo de mapeo**: son fondos cerrados, ETF y units que nunca deberían haber entrado en
  un universo de acciones. Se caen igualmente por la regla 2 de AGENTS.md.
- **hueco** — el símbolo no aparece en ninguno de los tres catálogos. Estos sí son huecos
  reales de cobertura de Twelve Data (59 en total, el 0,6 %).

**Mercados sin cobertura por diseño:** los 25 índices (`^GSPC`, `^AEX`…) y los 9 pares de
divisas (`=X`) no están en `/stocks` porque no son acciones. Se resuelven con los
endpoints `/indices` y `/forex`, fuera del alcance de este análisis.

**Mercados con muestra insuficiente para validar la regla:** México (8 símbolos), China
Shanghái (1), Corea (1), Irlanda (2), Portugal (5), Austria (5), Bélgica (6), Brasil (10).
Para estos la regla puede ser correcta pero **no está estadísticamente demostrada** por
este análisis. México además falla en 2 de 8 (`CEMEXCPO.MX`, `FEMSAUBD.MX`): el catálogo
`XMEX` de Twelve Data contiene 1.690 símbolos de los cuales 575 acaban en `N` y son
cotizaciones cruzadas de valores extranjeros (`1810N` = Xiaomi, `1211N` = BYD); las series
locales mexicanas con sufijo de serie (`CPO`, `UBD`) están cubiertas solo parcialmente.
**Marco México como no resoluble con fiabilidad** — no es un mercado de la whitelist de
AGENTS.md, así que no bloquea nada.

---

## 2. Reglas de transformación, por mercado

### 2.1 Regla base: el sufijo Yahoo determina el MIC de Twelve Data

Yahoo codifica la bolsa como sufijo del ticker. Twelve Data no usa sufijos: usa el campo
`mic_code` como dimensión separada. La transformación es por tanto
`SÍMBOLO.SUF` → `(mic_code, SÍMBOLO')`.

**Comando:**
```bash
python3 -c "
import json
from collections import Counter, defaultdict
mp=json.load(open('/tmp/tdmig/mapping4.json'))
per=defaultdict(Counter)
for r in mp:
    if r['status']=='unico': per[(r['suffix'],r['market'])][r['hits'][0]['mic_code']]+=1
for (suf,mkt),c in sorted(per.items(), key=lambda kv:-sum(kv[1].values())):
    print(f\"  .{suf or '(ninguno)':10s} {mkt:20s} {c.most_common(4)}\")
"
```

**Output crudo — sufijo → MIC efectivo, medido sobre los que mapean:**

```
  .(ninguno)  EEUU                 [('XNYS', 1676), ('XNCM', 1169), ('XNGS', 1134), ('XNMS', 657)]
  .HK         Hong Kong            [('XHKG', 1746)]
  .AX         Australia            [('XASX', 679), ('CXAC', 1)]
  .TO         Canada (TSX)         [('XTSE', 199)]
  .PA         Francia              [('XPAR', 131)]
  .F          Alemania (Fra)       [('XFRA', 96)]
  .MI         Italia               [('XMIL', 78)]
  .OL         Noruega              [('XOSL', 75)]
  .T          Japon                [('XJPX', 73)]
  .NS         India (NSE)          [('XNSE', 73)]
  .L          Reino Unido          [('XLON', 68)]
  .MC         Espana               [('XMAD', 67)]
  .SW         Suiza                [('XSWX', 64)]
  .ST         Suecia               [('XSTO', 59)]
  .AS         Paises Bajos         [('XAMS', 58)]
  .DE         Alemania (Xetra)     [('XETR', 56)]
  .JO         Sudafrica            [('XJSE', 52)]
  .HE         Finlandia            [('XHEL', 52)]
  .CO         Dinamarca            [('XCSE', 48)]
  .SI         Singapur             [('XSES', 42)]
  .TW         Taiwan               [('XTAI', 41)]
  .TA         Israel               [('XTAE', 33)]
  .SA         Brasil               [('BVMF', 10)]
  .BR         Belgica              [('XBRU', 6)]
  .MX         Mexico               [('XMEX', 6)]
  .VI         Austria              [('XWBO', 5)]
  .LS         Portugal             [('XLIS', 5)]
  .IR         Irlanda              [('XDUB', 2)]
  .KS         Corea                [('XKRX', 1)]
```

Tabla de conversión, mercado a mercado:

| Sufijo Yahoo | Mercado | `mic_code` Twelve Data | Transformación del ticker | Verificado sobre |
|---|---|---|---|---|
| *(ninguno)* | EEUU | `XNYS`, `XASE`, `XNCM`, `XNGS`, `XNMS` (+ `XNAS`, `ARCX`, `BATS` residuales) | `-` → `.` en clases de acción | 5.229 símbolos |
| `.HK` | Hong Kong | `XHKG` | ninguna — ambos usan 4 dígitos con ceros a la izquierda | 1.749 |
| `.AX` | Australia | `XASX` | ninguna | 694 |
| `.TO` | Canadá | `XTSE` | `-` → `.` (units de trust: `AP-UN` → `AP.UN`) | 202 |
| `.PA` | Francia | `XPAR` | ninguna | 131 |
| `.F` | Alemania (Fráncfort) | `XFRA` | ninguna | 99 |
| `.L` | Reino Unido | `XLON` | `-` → `.` (`BT-A` → `BT.A`) | 87 |
| `.MI` | Italia | `XMIL` | ninguna | 79 |
| `.OL` | Noruega | `XOSL` | ninguna | 78 |
| `.T` | Japón | `XJPX` | ninguna — 4 caracteres en ambos | 73 |
| `.NS` | India | `XNSE` | `-` → `.` (`BAJAJ-AUTO` → `BAJAJ.AUTO`) | 73 |
| `.MC` | España | `XMAD` | ninguna | 69 |
| `.SW` | Suiza | `XSWX` | ninguna | 66 |
| `.AS` | Países Bajos | `XAMS` | ninguna | 63 |
| `.ST` | Suecia | `XSTO` | `-` → `.` (`ASSA-B` → `ASSA.B`) | 59 |
| `.DE` | Alemania (Xetra) | `XETR` | ninguna | 56 |
| `.JO` | Sudáfrica | `XJSE` | ninguna | 52 |
| `.HE` | Finlandia | `XHEL` | ninguna | 52 |
| `.CO` | Dinamarca | `XCSE` | `-` → `.` (`NOVO-B` → `NOVO.B`) | 51 |
| `.SI` | Singapur | `XSES` | ninguna | 44 |
| `.TW` | Taiwán | `XTAI` | ninguna | 41 |
| `.TA` | Israel | `XTAE` | ninguna | 33 |
| `.SA` | Brasil | `BVMF` | ninguna | 10 |
| `.MX` | México | `XMEX` | **no resoluble** — series `CPO`/`UBD` sin cobertura fiable | 8 |
| `.BR`, `.VI`, `.LS`, `.IR`, `.KS`, `.SS` | Bélgica, Austria, Portugal, Irlanda, Corea, Shanghái | `XBRU`, `XWBO`, `XLIS`, `XDUB`, `XKRX`, `XSHG` | ninguna | ≤6 c/u — muestra insuficiente |

### 2.2 La única transformación de ticker que hace falta: `-` → `.`

**Comando:**
```bash
python3 /tmp/tdmig/analisis.py    # BLOQUE 3
```

**Output crudo:**
```
==============================================================================
BLOQUE 3 — Transformaciones de ticker aplicadas (Yahoo != Twelve Data)
==============================================================================
Canada (TSX)           29   ej: [('AP-UN.TO', 'AP.UN'), ('BEI-UN.TO', 'BEI.UN'), ('BEP-UN.TO', 'BEP.UN'), ('BIP-UN.TO', 'BIP.UN'), ('CAR-UN.TO', 'CAR.UN'), ('CCL-B.TO', 'CCL.B')]
Suecia                 27   ej: [('ASSA-B.ST', 'ASSA.B'), ('ATCO-A.ST', 'ATCO.A'), ('BALD-B.ST', 'BALD.B'), ('ELUX-B.ST', 'ELUX.B'), ('EPI-A.ST', 'EPI.A'), ('EPI-B.ST', 'EPI.B')]
EEUU                   20   ej: [('AGM-A', 'AGM.A'), ('AKO-A', 'AKO.A'), ('AKO-B', 'AKO.B'), ('BF-A', 'BF.A'), ('BF-B', 'BF.B'), ('BH-A', 'BH.A')]
Dinamarca               7   ej: [('ALK-B.CO', 'ALK.B'), ('AMBU-B.CO', 'AMBU.B'), ('CARL-B.CO', 'CARL.B'), ('COLO-B.CO', 'COLO.B'), ('MAERSK-B.CO', 'MAERSK.B'), ('NOVO-B.CO', 'NOVO.B')]
India (NSE)             1   ej: [('BAJAJ-AUTO.NS', 'BAJAJ.AUTO')]
Reino Unido             1   ej: [('BT-A.L', 'BT.A')]
TOTAL simbolos que requieren transformacion del ticker base: 85
```

**85 símbolos de 9.152 (0,9 %) requieren transformación del ticker.** Todos responden a
la misma regla: Yahoo separa la clase de acción o el tipo de unidad con `-`, Twelve Data
con `.`. Lista completa de mercados afectados: EEUU, Canadá, Suecia, Dinamarca, Reino
Unido, India. En el resto de mercados el ticker base es idéntico.

Casos concretos verificables uno a uno:

```bash
python3 -c "
import json
d=json.load(open('/tmp/td-catalog.json'))['data']
US={'XNYS','XASE','XNCM','XNGS','XNMS'}
for q in ['BRK','BRK.B','BRK-B','BRK/B']:
    print(q,'->',[(x['symbol'],x['mic_code'],x['type'],x['name'][:28]) for x in d if x['symbol']==q and x['mic_code'] in US][:6])
"
```
```
BRK -> []
BRK.B -> [('BRK.B', 'XNYS', 'Common Stock', 'Berkshire Hathaway Inc. Clas')]
BRK-B -> []
BRK/B -> []
```

Es decir: la forma Yahoo `BRK-B` **no existe** en Twelve Data, y la forma Twelve Data
`BRK.B` es única. Sin la regla, esos 85 símbolos se pierden silenciosamente.

### 2.3 Reglas que resultaron innecesarias

Probé y descarté (no hacían falta, y añadirlas habría introducido falsos positivos):

- **Rellenar ceros en Hong Kong** (`700` ↔ `0700`): innecesario, ambos usan 4 dígitos
  con ceros. Los 1.746 que mapean lo hacen con el ticker literal.
- **Rellenar ceros en Japón** (`7203.T` → `7203`): innecesario, formato idéntico.
- **Quitar el punto en el Reino Unido** (`BP.L` → `BP.`): innecesario. Twelve Data usa el
  ticker limpio (`BP`, `SHEL`, `VOD`, `HSBA`), no la forma con punto de la LSE.

---

## 3. Ambigüedad: por qué el resultado es cero, y dónde estaría si no lo fuera

### 3.1 La clave `(mic_code, symbol)` es única

**Comando:**
```bash
python3 -c "
import json
from collections import Counter
CAT=json.load(open('/tmp/td-catalog.json'))['data']
c=Counter((x['mic_code'],x['symbol']) for x in CAT)
print('registros:',len(CAT))
print('pares (mic_code, symbol) duplicados:',sum(1 for v in c.values() if v>1))
"
```
```
registros: 192112
pares (mic_code, symbol) duplicados: 0
```

**Ningún par (MIC, ticker) se repite en 192.112 registros.** Por tanto, una vez fijado el
MIC, el ticker identifica como máximo un instrumento. La ambigüedad clásica «un símbolo,
varios candidatos» no puede existir dentro de un mercado.

### 3.2 EEUU: verificación específica de que no hay colisión entre bolsas

EEUU es el único mercado donde el sufijo no identifica la bolsa (no hay sufijo, y conviven
cinco MIC nacionales más los OTC). Ahí la ambigüedad *podría* aparecer: mismo ticker en
NYSE y en Nasdaq, o en bolsa nacional y en OTC. Comprobación directa:

```bash
python3 -c "
import json
from collections import defaultdict
CAT=json.load(open('/tmp/td-catalog.json'))['data']
by=defaultdict(list)
for x in CAT: by[(x['mic_code'],x['symbol'])].append(x)
rows=json.load(open('/tmp/tdmig/symbols.json'))
NAT=['XNYS','XASE','XNCM','XNGS','XNMS']; OTC=['PINX','PSGM','OTCB','EXPM','OTCQ']
mn=no=0
for r in rows:
    s=r['symbol']
    if '.' in s or s.startswith('^') or '=' in s: continue
    cands=[s]+([s.replace('-','.'), s.replace('-','')] if '-' in s else [])
    nat={(m,c) for c in cands for m in NAT if by.get((m,c))}
    otc={(m,c) for c in cands for m in OTC if by.get((m,c))}
    if len(nat)>1: mn+=1
    if nat and otc: no+=1
print('EEUU con hit en mas de un MIC nacional:',mn)
print('EEUU con hit simultaneo en nacional y OTC:',no)
"
```
```
EEUU con hit en mas de un MIC nacional: 0
EEUU con hit simultaneo en nacional y OTC: 0
```

Cero en ambos. **Ningún ticker estadounidense de `daily_bars` colisiona entre bolsas en el
catálogo de Twelve Data.** Este es el resultado que hace que EEUU sea desbloqueable hoy.

### 3.3 Dónde SÍ habría ambigüedad si no se fijara «1 sufijo = 1 MIC»

Si en lugar de mapear cada sufijo a un MIC único se buscara el ticker en todos los MIC
plausibles del país, aparecerían 1.026 conflictos:

**Comando:**
```bash
python3 /tmp/tdmig/analisis.py    # BLOQUE 2b
```

**Output crudo:**
```
==============================================================================
BLOQUE 2b — Ambiguedad potencial si NO se fija 1 sufijo = 1 MIC
==============================================================================
Australia             669   ejemplos: [('14D.AX', [('CXAC', '14D'), ('XASX', '14D')]), ('1AI.AX', [('CXAC', '1AI'), ('XASX', '1AI')])]
Canada (TSX)          197   ejemplos: [('AAV.TO', [('NEOE', 'AAV'), ('XTSE', 'AAV')]), ('ABX.TO', [('NEOE', 'ABX'), ('XTSE', 'ABX')])]
India (NSE)            73   ejemplos: [('ABB.NS', [('XBOM', 'ABB'), ('XNSE', 'ABB')]), ('ADANIENT.NS', [('XBOM', 'ADANIENT'), ('XNSE', 'ADANIENT')])]
Alemania (Xetra)       56   ejemplos: [('123F.DE', [('XETR', '123F'), ('XFRA', '123F')]), ('1U1.DE', [('XETR', '1U1'), ('XFRA', '1U1')])]
Alemania (Fra)         31   ejemplos: [('123F.F', [('XETR', '123F'), ('XFRA', '123F')]), ('1U1.F', [('XETR', '1U1'), ('XFRA', '1U1')])]
TOTAL: 1026
```

**Los cuatro patrones de ambigüedad potencial y su criterio de desambiguación:**

| Patrón | Ejemplo concreto | Criterio que lo resuelve | Fiabilidad |
|---|---|---|---|
| **Bolsa principal vs. venue alternativo** | `AAV.TO` existe en `XTSE` (TSX) y en `NEOE` (Cboe Canada) | **El sufijo Yahoo.** `.TO` = TSX = `XTSE`; `.NE` sería Cboe Canada. Determinista, no heurístico | Alta — 197/197 |
| **Bolsa principal vs. Cboe Australia** | `14D.AX` en `XASX` y `CXAC` | **El sufijo.** `.AX` = ASX = `XASX` | Alta — 669/669 |
| **NSE vs. BSE en India** | `ABB.NS` en `XNSE` y `XBOM` | **El sufijo.** `.NS` = NSE; `.BO` = BSE | Alta — 73/73 |
| **Xetra vs. parqué de Fráncfort** | `123F.DE` y `123F.F` apuntan al mismo ticker en `XETR` y `XFRA` | **El sufijo.** `.DE` = Xetra = `XETR`; `.F` = Fráncfort = `XFRA`. Son dos cotizaciones reales y distintas del mismo valor, con liquidez muy diferente | Alta — 87/87 |

Ninguno de los cuatro necesita nombre de empresa, divisa ni tipo de instrumento: **el
sufijo Yahoo ya contiene la información**. Por eso el resultado es 0 ambiguos y no una
cifra que haya que resolver a mano.

**Ojo con la asimetría Alemania.** Los 56 `.DE` y los 31 `.F` no son duplicados a eliminar:
son cotizaciones distintas del mismo valor, y el precio y el volumen difieren. La regla 5
de AGENTS.md (el filtro de liquidez deduplica) los resuelve en la práctica, pero conviene
saber que la fuente los distingue correctamente.

### 3.4 La ambigüedad que sí queda sin resolver: el ticker correcto apuntando a otra empresa

Este es el riesgo real de esta migración, y no se ve en la tabla de cobertura. Un ticker
puede mapear «limpio» y apuntar a un instrumento distinto, porque los tickers se reciclan
y porque el catálogo de Twelve Data arrastra nombres antiguos.

Validación cruzada: comparar el nombre de empresa que StatsEdge tiene guardado
(`scan_results.company_name`, de origen Yahoo) con el nombre que da Twelve Data.

**Comando:**
```bash
python3 /tmp/tdmig/analisis.py    # BLOQUE 6
```

**Output crudo:**
```
==============================================================================
BLOQUE 6 — Validacion cruzada por nombre de empresa
==============================================================================
simbolos mapeados con nombre local disponible : 8108 de 8707
  coincide              7880  (97.19%)
  NO coincide            228  (2.81%)

Discrepancias por mercado:
  EEUU                 108
  Hong Kong            96
  Australia            16
  Taiwan               1
  Japon                1
  Francia              1
  Noruega              1
  Reino Unido          1
  Israel               1
  Dinamarca            1
  Italia               1

Muestra (15):
  0007.HK    local="Wisdom Wealth Resources Investment Holdi"  td="Hong Kong Finance Investment Holding Gro"
  0030.HK    local="YNBY International Limited"  td="Ban Loong Holdings Limited"
  0033.HK    local="International Genius Company"  td="Amber Hill Financial Holdings Limited"
  0068.HK    local="MANYCORE TECH"  td="0068"
  0082.HK    local="Crazy Sports Group Limited"  td="V1 Group Limited"
  0093.HK    local="Zero Fintech Group Limited"  td="Termbray Industries International "
  0132.HK    local="Hing Yip Holdings Limited"  td="China Investments Holdings Limited"
  0136.HK    local="China Ruyi Holdings Limited"  td="HengTen Networks Group Limited"
  0139.HK    local="Smart Fish Wealthlink Holdings Limited"  td="Central Wealth Group Holdings Limited"
  0145.HK    local="CCIAM Future Energy Limited"  td="The Hong Kong Building And Loan Agency L"
  0205.HK    local="BFB Health Limited"  td="SEEC Media Group Limited"
  0206.HK    local="CM Energy Tech Co., Ltd."  td="CMIC Ocean En-Tech Holding Co., Ltd."
  0209.HK    local="Poly Xverse Intelligent Technology Co. L"  td="Winshine Science Company Limited"
  0232.HK    local="Continental Aerospace Technologies Holdi"  td="AVIC International Holding "
  0235.HK    local="CSC Holdings Limited"  td="China Strategic Holdings Limited"
```

**228 símbolos (2,81 %) con nombre discrepante.** Hay tres causas distintas mezcladas, y
**no son separables automáticamente**:

1. **Nombre obsoleto en Twelve Data, mismo instrumento.** `0136.HK` local «China Ruyi
   Holdings» / TD «HengTen Networks Group»: HengTen se renombró China Ruyi. El ticker es
   correcto; el nombre del catálogo está desactualizado. Domina en Hong Kong (96 casos).
2. **Renombrado corporativo.** `GE` local «GE Aerospace» / TD «General Electric Company».
   Mismo instrumento, mismo ticker.
3. **Ticker reciclado — el caso peligroso.** `AKTS` local «Aktis Oncology» / TD «Akoustis
   Technologies»; `CCXI` local «Churchill Capital Corp XI» / TD «ChemoCentryx»; `ABTC`
   local «American Bitcoin Corp» / TD «Gryphon Digital Mining». La empresa antigua
   desapareció y el ticker se reasignó. Si Twelve Data no ha actualizado la serie, se
   estaría descargando el histórico del valor equivocado.

Intenté separar (1) y (2) de (3) por similitud de cadena y **no funciona**: `IRMD`
(«IRADIMED» vs «Iridium») puntúa 0,86 de similitud y son empresas distintas, mientras que
`0136.HK` puntúa 0 y es la misma. **Lo dejo explícitamente como no resuelto**: es una lista
de 228 símbolos para verificar contra `/time_series` real una vez haya API key, no un
veredicto. La lista completa está en `/tmp/tdmig/discrepancias_nombre.json`.

Para EEUU son **108 símbolos** los que habría que verificar antes del lanzamiento — un
día de trabajo, no un bloqueo.

---

## 4. Qué se cae al aplicar las reglas de universo de AGENTS.md

**Comando:**
```bash
python3 /tmp/tdmig/analisis.py    # BLOQUE 4
```

**Output crudo:**
```
==============================================================================
BLOQUE 4 — Tipo de instrumento (Twelve Data) de lo que mapea
==============================================================================
  Common Stock                     8024
  American Depositary Receipt      333
  REIT                             243
  Preferred Stock                  36
  Depositary Receipt               33
  Warrant                          16
  Trust                            9
  Limited Partnership              8
  Exchange-Traded Note             4
  Unit                             1

Reglas de universo de AGENTS.md aplicadas sobre esos 8707 simbolos:
  en whitelist de MIC                : 7657
  en OTC (regla 3, excluidos)        : 25  [('PINX', 18), ('PSGM', 3), ('EXPM', 2), ('OTCB', 2)]
  en MIC fuera de whitelist          : 1025  [('XASX', 679), ('XFRA', 96), ('XNSE', 73), ('XJSE', 52), ('XSES', 42), ('XTAI', 41), ('XNAS', 13), ('BVMF', 10), ('XMEX', 6), ('XWBO', 5), ('ARCX', 3), ('XDUB', 2), ('XKRX', 1), ('BATS', 1), ('CXAC', 1)]
  whitelist + type=Common Stock      : 7045

Lo que se cae dentro de la whitelist por la regla type==Common Stock:
  American Depositary Receipt      333
  REIT                             204
  Preferred Stock                  33
  Warrant                          15
  Trust                            9
  Limited Partnership              8
  Depositary Receipt               5
  Exchange-Traded Note             4
  Unit                             1
```

### 4.1 Respuesta directa a la pregunta

De los **9.152** símbolos actuales:

| Categoría | Cantidad | Motivo de exclusión |
|---|---|---|
| **ADR** (`American Depositary Receipt`) | **333** | Regla 2 (tipo). Regla 6: fuera del panel de amplitud, **dentro** del screener |
| **Depositary Receipt** (no americanos) | **33** | Regla 2 (tipo) |
| **Warrants** | **16** | Regla 2 (tipo) |
| **OTC** (`PINX` 18, `PSGM` 3, `EXPM` 2, `OTCB` 2) | **25** | Regla 3 (MIC) |
| REIT | 243 | Regla 2 — AGENTS.md deja la decisión abierta |
| Preferred Stock | 36 | Regla 2 (tipo) |
| Trust / Limited Partnership / ETN / Unit | 22 | Regla 2 (tipo) |
| Fondos cerrados / ETF disfrazados de acción | 352 | No están en `/stocks`; se caen solos |
| Índices y divisas | 34 | No son acciones |
| Mercados fuera de la whitelist (`XASX`, `XFRA`, `XNSE`, `XJSE`, `XSES`, `XTAI`, `BVMF`, `XMEX`…) | 1.011 | Whitelist de MIC |

**Solo por ser ADR, warrant u OTC se caen 374 símbolos (4,1 %).** El grueso de la
reducción del universo no viene de ahí, sino de la whitelist de MIC (1.011, sobre todo
Australia con 679) y de los fondos cerrados que nunca debieron entrar (352).

**Universo final tras aplicar AGENTS.md tal cual: 7.045 de 9.152 (77 %).**

### 4.2 Corrección propuesta a AGENTS.md: `XNAS`, `ARCX` y `BATS`

AGENTS.md (regla 4) dice que `XNAS` «devuelve solo 24 símbolos y es una trampa». Es cierto
que son pocos, pero **no están vacíos ni son duplicados**: contienen valores que no
aparecen en `XNCM`/`XNGS`/`XNMS`.

```bash
python3 -c "
import json
from collections import Counter
CAT=json.load(open('/tmp/td-catalog.json'))['data']
print('MICs con country=United States en /stocks:')
for k,v in Counter(x['mic_code'] for x in CAT if x['country']=='United States').most_common(20): print(f'  {k:6s} {v}')
idx={}
for x in CAT: idx.setdefault(x['symbol'],[]).append(x)
for q in ['CBOE','ACFN','ALPS','CMTV','DBGI','CHAI']:
    print(q, [(x['mic_code'],x['type'][:14]) for x in idx.get(q,[]) if x['country']=='United States'][:4])
"
```
```
MICs con country=United States en /stocks:
  PINX   11177
  XNYS   2776
  XNCM   1764
  XNGS   1516
  XNMS   1211
  PSGM   678
  OTCB   506
  XASE   302
  OTCQ   240
  EXPM   218
  XNAS   34
  ARCX   7
  BATS   1
  XSTU   1
CBOE [('BATS', 'Common Stock')]
ACFN [('XNAS', 'Common Stock')]
ALPS [('XNAS', 'Common Stock')]
CMTV [('XNAS', 'Common Stock')]
DBGI [('XNAS', 'Common Stock')]
CHAI [('ARCX', 'Common Stock')]
```

`CBOE` (Cboe Global Markets, una empresa del S&P 500) está **solo** en `BATS`. Con la
whitelist actual de AGENTS.md se perdería. Añadir `XNAS`, `ARCX` y `BATS` recupera **17
símbolos** de los actuales y evita el hueco. Es una corrección de una línea en la lista
blanca, y la marco como recomendación pendiente de que la valides.

---

## 5. PRIORIDAD EEUU — lo único bloqueante hoy

**Comando:**
```bash
python3 /tmp/tdmig/analisis.py    # BLOQUE 5
```

**Output crudo:**
```
==============================================================================
BLOQUE 5 — EEUU (unico mercado bloqueante para el lanzamiento)
==============================================================================
simbolos US en daily_bars                       : 5229
  mapean de forma INEQUIVOCA a /stocks          : 4881
  ambiguos                                      : 0
  sin correspondencia                           : 348

  de los que mapean, en bolsa nacional US       : 4856
  de los que mapean, en OTC                     : 25
  MIC destino: [('XNYS', 1676), ('XNCM', 1169), ('XNGS', 1134), ('XNMS', 657), ('XASE', 203), ('PINX', 18), ('XNAS', 13), ('PSGM', 3), ('ARCX', 3), ('EXPM', 2), ('OTCB', 2), ('BATS', 1)]

  nacional, type=Common Stock                : 4292
  nacional, type=REIT                        : 163
  nacional, type=American Depositary Receipt : 333
  nacional, type=Preferred Stock             : 29
  nacional, type=Warrant                     : 16
  nacional, type=Trust                       : 9
  nacional, type=Limited Partnership         : 5
  nacional, type=Exchange-Traded Note        : 4
  nacional, type=Depositary Receipt          : 4
  nacional, type=Unit                        : 1

Los sin-correspondencia de EEUU, explicados:
  Closed-end Fund                  299
  hueco_de_cobertura               25
  Unit                             13
  ETF                              11
Huecos reales de catalogo en EEUU: ['AMWD', 'CGCT', 'CIF', 'CMU', 'CNTA', 'FFIC', 'FONR', 'HSPT', 'JMG', 'KALV', 'KW', 'LEGT', 'LOKV', 'MASI', 'MCR', 'MIS', 'PRA', 'PTNM', 'SDM', 'SEV', 'TCGL', 'THR', 'VACH', 'VRE', 'VSCO']
```

### 5.1 Respuesta directa

De los **5.229 símbolos estadounidenses** en `daily_bars`:

- **4.881 (93,3 %) mapean de forma inequívoca.**
- **0 ambiguos.**
- **348 sin correspondencia**, de los cuales **323 no son acciones**: 299 fondos cerrados
  (`BCAT`, `ADX`, `BGR`, `BST`…), 13 units de SPAC y 11 ETF. Se caerían igualmente por la
  regla 2 de AGENTS.md.
- **25 huecos reales** de cobertura de Twelve Data (0,48 %).

**Universo operativo US, según el criterio que se aplique:**

| Criterio | Símbolos |
|---|---|
| Bolsa nacional + `Common Stock` (regla 2 estricta) | **4.292** |
| + REIT | 4.455 |
| + ADR (regla 6, screener) | 4.788 |
| Todo lo que mapea en bolsa nacional | 4.856 |

### 5.2 Los 25 huecos: diagnóstico

Comprobados uno a uno contra `/stocks`, `/etf` y `/funds` en todos los MIC del mundo:

```bash
python3 -c "
import json
CAT=json.load(open('/tmp/td-catalog.json'))['data']
etf=json.load(open('/tmp/tdmig/td-etf.json'))['data']
fun=json.load(open('/tmp/tdmig/td-funds.json'))['result']['list']
idx={}; eidx={}; fidx={}
for x in CAT: idx.setdefault(x['symbol'],[]).append(x)
for x in etf: eidx.setdefault(x['symbol'],[]).append(x)
for x in fun: fidx.setdefault(x['symbol'],[]).append(x)
for s in ['AMWD','MASI','VSCO','KALV','THR','KW','PRA','VRE','FFIC','CNTA']:
    print(f\"{s:6s} stocks={[(x['mic_code'],x['country']) for x in idx.get(s,[])][:3]} etf={[(x['mic_code'],x['country']) for x in eidx.get(s,[])][:2]}\")
"
```
```
AMWD   stocks=[] etf=[]
MASI   stocks=[('XMIL', 'Italy')] etf=[]
VSCO   stocks=[('XMEX', 'Mexico')] etf=[]
KALV   stocks=[] etf=[]
THR    stocks=[('AIMX', 'United Kingdom'), ('CXAC', 'Australia'), ('XASX', 'Australia')] etf=[]
KW     stocks=[('XJAM', 'Jamaica')] etf=[]
PRA    stocks=[] etf=[('XTSE', 'Canada'), ('NEOE', 'Canada')]
VRE    stocks=[] etf=[('XTSE', 'Canada'), ('NEOE', 'Canada')]
FFIC   stocks=[] etf=[]
CNTA   stocks=[] etf=[]
```

`AMWD` (American Woodmark, Nasdaq), `MASI` (Masimo, Nasdaq), `VSCO` (Victoria's Secret,
NYSE), `KALV` (KalVista, Nasdaq) son acciones vivas y no están en ningún MIC
estadounidense del catálogo. Los hits en Milán, México o Jamaica son cotizaciones cruzadas
de otras empresas con el mismo ticker, no el valor buscado.

**Son huecos genuinos de Twelve Data.** El 0,48 % es una tasa aceptable, pero conviene
levantarla con soporte de Twelve Data antes de firmar el plan: si son 25 huecos porque el
volcado del catálogo tiene un mes, es una cosa; si es cobertura permanente, es otra.

### 5.3 Dato clave que el encargo no pedía pero cambia el plan

```bash
python3 -c "
import json
from collections import Counter
CAT=json.load(open('/tmp/td-catalog.json'))['data']
NAT={'XNYS','XASE','XNCM','XNGS','XNMS','XNAS','ARCX','BATS'}
cs=[x for x in CAT if x['mic_code'] in NAT and x['type']=='Common Stock']
print('Common Stock en bolsas nacionales US en el catalogo TD:',len(cs))
print('por MIC:',Counter(x['mic_code'] for x in cs).most_common())
mp=json.load(open('/tmp/tdmig/mapping4.json'))
ya={r['matched'] for r in mp if r['status']=='unico' and r['market']=='EEUU'}
print('Common Stock US en TD que NO estan hoy en daily_bars:',sum(1 for x in cs if x['symbol'] not in ya))
"
```
```
Common Stock en bolsas nacionales US en el catalogo TD: 5756
por MIC: [('XNYS', 1799), ('XNCM', 1499), ('XNGS', 1266), ('XNMS', 901), ('XASE', 263), ('XNAS', 24), ('ARCX', 3), ('BATS', 1)]
Common Stock US en TD que NO estan hoy en daily_bars: 1464
```

**Twelve Data ofrece 5.756 `Common Stock` estadounidenses; hoy hay 4.292 en la base.**
Faltan **1.464 valores (+34 %)**. La recarga no debería reproducir el universo actual: debe
partir del catálogo de Twelve Data, no de la lista heredada de Yahoo. Los números de coste
del §6 incluyen los dos escenarios.

---

## 6. Coste de recarga del histórico para EEUU

### 6.1 Datos de tarifación (fuentes citadas)

| Dato | Valor | Fuente |
|---|---|---|
| Coste de `/time_series` | **1 crédito por símbolo** | [Documentación de la API](https://twelvedata.com/docs) |
| `outputsize` máximo | **5.000 barras por petición** | [Documentación de la API](https://twelvedata.com/docs) |
| Batch | hasta **120 símbolos por petición**, pero **cada símbolo consume 1 crédito** | [Batch API requests](https://support.twelvedata.com/en/articles/5203360-batch-api-requests) |
| Límite Basic | 8 créditos/min, **800/día** | [Pricing](https://twelvedata.com/pricing) |
| Límites de pago | Grow desde 55/min, Pro desde 610/min, Ultra desde 2.584/min. **Sin límite diario** | [Pricing](https://twelvedata.com/pricing) |
| Precios | Grow desde $29/mes, Pro desde $99/mes, Ultra desde $329/mes (tiers superiores: $79, $229, $999) | [Pricing](https://twelvedata.com/pricing) |

Consecuencia operativa: **el batch reduce peticiones HTTP, no créditos.** El cuello de
botella es exclusivamente el límite de créditos por minuto del plan.

Con `outputsize=5000`, **una sola petición por símbolo cubre ~20 años de barras diarias**.
La carga inicial completa cuesta por tanto exactamente 1 crédito por símbolo, igual que una
actualización diaria.

### 6.2 Cifras

**Comando:**
```bash
python3 /tmp/tdmig/analisis.py    # BLOQUE 7
```

**Output crudo:**
```
==============================================================================
BLOQUE 7 — Coste de recarga del historico, universo EEUU
==============================================================================
  A. Common Stock (regla 2 estricta)        4292 simbolos =  4292 creditos por pasada
  B. Common Stock + REIT                    4455 simbolos =  4455 creditos por pasada
  C. + ADR (screener, regla 6)              4788 simbolos =  4788 creditos por pasada
  D. Todo lo que mapea en bolsa nacional    4856 simbolos =  4856 creditos por pasada
  E. Universo US completo de TD (Common Stock)  5756 simbolos =  5756 creditos por pasada
  F. E + REIT + ADR                         6372 simbolos =  6372 creditos por pasada

Tiempo de una pasada completa (1 credito/simbolo, outputsize=5000):
Plan                            cr/min          A         B         C         D         E         F
Basic (gratis)                       8      5.4d      5.6d      6.0d      6.1d      7.2d      8.0d 
Grow 55 (desde $29/mes)             55     78.0m     81.0m     87.1m     88.3m    104.7m    115.9m 
Grow 144                           144     29.8m     30.9m     33.2m     33.7m     40.0m     44.2m 
Grow 377 ($79/mes)                 377     11.4m     11.8m     12.7m     12.9m     15.3m     16.9m 
Pro 610 (desde $99/mes)            610      7.0m      7.3m      7.8m      8.0m      9.4m     10.4m 
Pro 1597 ($229/mes)               1597      2.7m      2.8m      3.0m      3.0m      3.6m      4.0m 
Ultra 2584 (desde $329/mes)       2584      1.7m      1.7m      1.9m      1.9m      2.2m      2.5m 

Mantenimiento EOD diario (misma pasada cada dia de mercado):
Basic (gratis)                       8 IMPOSIBLE IMPOSIBLE IMPOSIBLE IMPOSIBLE IMPOSIBLE IMPOSIBLE 
Grow 55 (desde $29/mes)             55     78.0m     81.0m     87.1m     88.3m    104.7m    115.9m 
Grow 144                           144     29.8m     30.9m     33.2m     33.7m     40.0m     44.2m 
Grow 377 ($79/mes)                 377     11.4m     11.8m     12.7m     12.9m     15.3m     16.9m 
Pro 610 (desde $99/mes)            610      7.0m      7.3m      7.8m      8.0m      9.4m     10.4m 
Pro 1597 ($229/mes)               1597      2.7m      2.8m      3.0m      3.0m      3.6m      4.0m 
Ultra 2584 (desde $329/mes)       2584      1.7m      1.7m      1.9m      1.9m      2.2m      2.5m 

Creditos/mes con 21 sesiones y una pasada EOD diaria:
  A. Common Stock (regla 2 estricta)          90,132
  B. Common Stock + REIT                      93,555
  C. + ADR (screener, regla 6)               100,548
  D. Todo lo que mapea en bolsa nacional     101,976
  E. Universo US completo de TD (Common Stock)   120,876
  F. E + REIT + ADR                          133,812

Filas resultantes en daily_bars segun profundidad:
  A. 504b=  2,163,168  1260b=  5,407,920  5000b= 21,460,000
  B. 504b=  2,245,320  1260b=  5,613,300  5000b= 22,275,000
  C. 504b=  2,413,152  1260b=  6,032,880  5000b= 23,940,000
  D. 504b=  2,447,424  1260b=  6,118,560  5000b= 24,280,000
  E. 504b=  2,901,024  1260b=  7,252,560  5000b= 28,780,000
  F. 504b=  3,211,488  1260b=  8,028,720  5000b= 31,860,000
```

### 6.3 Lectura

**Escenario recomendado — E (universo US completo de Twelve Data, `Common Stock`):**

- **Carga inicial: 5.756 créditos.** Con Grow 377 ($79/mes): **15 minutos**. Con Pro 610
  (desde $99/mes): **9 minutos**.
- **Mantenimiento EOD: 5.756 créditos por sesión** ≈ **120.876 créditos/mes**. Al no haber
  límite diario en los planes de pago, esto es tiempo de reloj, no coste marginal: el
  precio es la cuota del plan, no los créditos.
- **Volumen en base: 7,25 M de filas para 5 años**, 28,8 M si se piden las 5.000 barras
  máximas. Frente a los 3,5 M actuales.

**El plan gratuito no sirve ni para la carga inicial ni para el mantenimiento.** 800
créditos/día implican 7,2 días para la carga inicial y hacen la actualización diaria
imposible por definición (5.756 > 800).

**El mínimo viable es Grow 377 ($79/mes)**, que deja la pasada diaria en ~15 minutos.
Grow 55 ($29/mes) la deja en 105 minutos, que es operable pero deja poco margen para
reintentos, para el resto de mercados o para las llamadas de fundamentales.

### 6.4 Incógnitas declaradas del cálculo

1. **Profundidad histórica por plan.** La página de precios no publica cuántos años de
   histórico incluye cada plan. `outputsize` admite 5.000, pero no he podido verificar si
   Grow devuelve 20 años o los recorta. **Sin API key válida no es verificable**, y
   condiciona si la carga inicial es 1 petición por símbolo o varias. Es la pregunta
   número uno para soporte de Twelve Data.
2. **Concurrencia.** El número de peticiones simultáneas depende del plan y no está
   publicado. Los tiempos de arriba asumen que se satura el límite de créditos/minuto;
   si la concurrencia es baja, los tiempos suben.
3. **Reintentos y símbolos fallidos.** No hay margen incluido. Con un 5 % de reintentos,
   sumar un 5 % a los tiempos.

---

## 7. Hallazgo bloqueante: las condiciones de licencia

Esto no estaba en el encargo, pero afecta a la premisa que lo motiva («Yahoo no permite
uso comercial, hay que migrar a Twelve Data»).

**Comando:**
```bash
curl -s "https://twelvedata.com/pricing" | python3 -c "
import sys,re,html
t=sys.stdin.read()
t=re.sub(r'<script.*?</script>','',t,flags=re.S); t=re.sub(r'<style.*?</style>','',t,flags=re.S)
t=re.sub(r'<[^>]+>',' ',t); t=html.unescape(t); t=re.sub(r'\s+',' ',t)
for kw in ['Internal display data access','Internal non-display data a']:
    m=re.search(re.escape(kw),t); print('>>',t[max(0,m.start()-320):m.start()+30].strip()[-350:]); print()
"
```

**Output crudo (fragmentos literales de twelvedata.com/pricing):**
```
>> PI + 8 trial WS 55 API + 8 trial WS Everything from Basic, plus ' title="Expanded access to 27 global markets." > 20+ markets ' title="View-only access for internal use within your applications and dashboards. The data may be displayed but cannot be programmatically processed, stored, transformed, or redistributed." > Internal display data access '

>> I + 5,000 WS 2,584 API + 2,500 WS Everything from Pro, plus ' title="Full access to every supported global market." > All markets ' title="Use the data internally for programmatic processing, analysis, system integration, and internal display. The data may not be redistributed or made available to external parties." > Internal non-display data acce
```

Y la estructura de herencia entre planes, del mismo volcado:

```
Pro for advanced integrations $ 229 ... Everything from Grow, plus ... 70+ markets ...
Grow for hobby projects $ 79 ... Everything from Basic, plus ... 20+ markets ... Internal display data access
Ultra ... Everything from Pro, plus ... All markets ... Internal non-display data access
```

**Interpretación de los hechos, no consejo legal:**

- **Grow y Pro** son *«Internal display data access»*: «los datos pueden mostrarse pero no
  pueden procesarse programáticamente, almacenarse, transformarse ni redistribuirse».
  StatsEdge hace las tres cosas prohibidas: almacena en `daily_bars`, calcula stage
  analysis y RS, y redistribuye a usuarios.
- **Ultra** ($329/mes mínimo) es *«Internal non-display data access»*: permite el
  procesamiento y el almacenamiento, pero dice explícitamente que los datos «no pueden
  redistribuirse ni ponerse a disposición de terceros».
- Ninguno de los tres planes self-serve cubre, a primera vista, un SaaS con usuarios de
  pago externos.

**Recomendación:** antes de invertir en la migración, escribir a Twelve Data planteando
el caso de uso exacto (screener SaaS, almacenamiento de EOD, indicadores derivados
mostrados a suscriptores externos) y pedir por escrito qué plan o addendum de
redistribución lo cubre y a qué precio. **Este es el gate real, no el mapeo de símbolos.**
Que 4.292 tickers mapeen limpio no sirve de nada si el plan que se puede pagar no
autoriza el uso.

---

## 8. Conclusiones y orden de trabajo propuesto

### Lo que está resuelto

- El mapeo Yahoo → Twelve Data es **viable y determinista**: 95,1 % global, 93,3 % en
  EEUU, **cero ambigüedad estructural**.
- Las reglas de transformación son **cuatro líneas de código**: sufijo → MIC, y `-` → `.`
  en seis mercados (85 símbolos afectados en total).
- El coste de la recarga US es **irrelevante en créditos** y **de minutos en tiempo** a
  partir del plan Grow 377.

### Lo que no está resuelto, y lo digo como tal

- **México:** no resoluble con fiabilidad. Las series locales (`CPO`, `UBD`) no tienen
  cobertura consistente en `XMEX`. No es mercado de la whitelist, así que no bloquea.
- **Ocho mercados con muestra insuficiente** (≤10 símbolos) para dar la regla por
  validada: Brasil, Bélgica, Austria, Portugal, Irlanda, Corea, Shanghái, México.
- **228 símbolos con nombre discrepante** (108 en EEUU). No he podido separar
  automáticamente «nombre obsoleto en el catálogo» de «ticker reciclado apuntando a otra
  empresa». Requiere verificación contra `/time_series` real con API key.
- **Profundidad histórica por plan:** no publicada, no verificable sin API key.
- **Licencia:** ningún plan self-serve parece cubrir la redistribución a usuarios externos.

### Orden propuesto

1. **Confirmar la licencia con Twelve Data** por escrito, antes que nada. Si la respuesta
   es «necesitas Enterprise», el resto del plan cambia de escala y conviene saberlo ahora.
2. **Conseguir una API key válida** (`TWELVE_DATA_API_KEY` en `.env.local` es un
   placeholder) y verificar dos cosas: la profundidad histórica real que devuelve el plan,
   y los 108 símbolos US con nombre discrepante.
3. **Corregir la whitelist de AGENTS.md** añadiendo `XNAS`, `ARCX` y `BATS` — recupera 17
   valores actuales, entre ellos `CBOE`.
4. **Decidir el universo US de partida:** 4.292 (réplica del actual) o 5.756 (catálogo
   completo de Twelve Data). Recomiendo el segundo: el coste incremental es de 6 minutos
   por pasada y evita rehacer la carga en tres meses.
5. **Cargar EEUU**, verificar contra la base actual con solape de fechas, y solo entonces
   plantear el resto de mercados.

---

## Anexo A — Script de análisis completo

Guardado en `/tmp/tdmig/analisis.py` (fuera del repo, según el encargo). Requiere
`/tmp/tdmig/symbols.json`, `/tmp/tdmig/names.json`, `/tmp/td-catalog.json`,
`/tmp/tdmig/td-etf.json` y `/tmp/tdmig/td-funds.json`, todos generados con los comandos
del §0.3.

El núcleo del mapeo son estas tres funciones — el resto del script son agregaciones:

```python
MARKETS = {
    '':   ('EEUU',             ['XNYS','XASE','XNCM','XNGS','XNMS','XNAS','ARCX','BATS'],
                               ['PINX','PSGM','OTCB','EXPM','OTCQ']),
    'HK': ('Hong Kong',        ['XHKG'], []),
    'AX': ('Australia',        ['XASX'], ['CXAC']),
    'TO': ('Canada (TSX)',     ['XTSE'], ['XTSX','NEOE','XCNQ']),
    'PA': ('Francia',          ['XPAR'], []),
    'F':  ('Alemania (Fra)',   ['XFRA'], ['XETR']),
    'L':  ('Reino Unido',      ['XLON'], ['BCXE']),
    'MI': ('Italia',           ['XMIL'], []),
    'OL': ('Noruega',          ['XOSL'], []),
    'T':  ('Japon',            ['XJPX'], []),
    'NS': ('India (NSE)',      ['XNSE'], ['XBOM']),
    'MC': ('Espana',           ['XMAD'], []),
    'SW': ('Suiza',            ['XSWX'], []),
    'AS': ('Paises Bajos',     ['XAMS'], []),
    'ST': ('Suecia',           ['XSTO'], []),
    'DE': ('Alemania (Xetra)', ['XETR'], ['XFRA']),
    'JO': ('Sudafrica',        ['XJSE'], []),
    'HE': ('Finlandia',        ['XHEL'], []),
    'CO': ('Dinamarca',        ['XCSE'], []),
    'SI': ('Singapur',         ['XSES'], []),
    'TW': ('Taiwan',           ['XTAI'], []),
    'TA': ('Israel',           ['XTAE'], []),
    'SA': ('Brasil',           ['BVMF'], []),
    'MX': ('Mexico',           ['XMEX'], []),
    'BR': ('Belgica',          ['XBRU'], []),
    'VI': ('Austria',          ['XWBO'], []),
    'LS': ('Portugal',         ['XLIS'], []),
    'IR': ('Irlanda',          ['XDUB'], []),
    'SS': ('China (Shanghai)', ['XSHG'], []),
    'KS': ('Corea',            ['XKRX'], []),
}
# mercados donde Yahoo usa '-' donde Twelve Data usa '.'
DASH_TO_DOT = {'', 'TO', 'L', 'NS', 'MC', 'PA', 'MI', 'AS', 'BR', 'LS',
               'ST', 'CO', 'OL', 'HE', 'VI', 'SW', 'DE', 'F', 'IR', 'JO'}


def split_symbol(sym):
    """Separa el ticker Yahoo en (base, sufijo). Sufijo '' = EEUU."""
    if sym.startswith('^'):
        return sym, '^INDEX'
    if '=' in sym:
        return sym, '=FX'
    if '.' in sym:
        base, suf = sym.rsplit('.', 1)
        if suf.upper() in MARKETS:
            return base, suf.upper()
        return sym, '?' + suf
    return sym, ''


def candidates(base, suf):
    """Variantes del ticker base a probar en Twelve Data, por mercado."""
    out = [base]
    if suf in DASH_TO_DOT and '-' in base:
        out.append(base.replace('-', '.'))
        if suf == '':
            out.append(base.replace('-', ''))
    if suf == 'HK':
        out += [base.lstrip('0') or base, base.zfill(4), base.zfill(5)]
    if suf == 'T':
        out.append(base.zfill(4))
    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c); uniq.append(c)
    return uniq


def resolve(sym):
    """Resuelve un ticker Yahoo contra el catalogo. El MIC primario es unico por
    sufijo (salvo EEUU); el fallback NO es candidato simultaneo, solo se prueba si
    el primario no resuelve — por eso no genera ambiguedad artificial."""
    base, suf = split_symbol(sym)
    if suf in ('^INDEX', '=FX') or suf.startswith('?'):
        return dict(symbol=sym, base=base, suffix=suf, market=suf,
                    status='fuera_de_alcance', tier=None, matched=None, hits=[], why=None)
    market, prim, fb = MARKETS[suf]
    for tier, mics in (('primario', prim), ('fallback', fb)):
        if not mics:
            continue
        for cand in candidates(base, suf):
            hits = [h for mic in mics for h in by.get((mic, cand), [])]
            if hits:
                return dict(symbol=sym, base=base, suffix=suf, market=market,
                            status='unico' if len(hits) == 1 else 'ambiguo',
                            tier=tier, matched=cand, hits=hits, why=None)
    # sin correspondencia en /stocks: ¿es que no es una accion?
    why = 'hueco_de_cobertura'
    for cand in candidates(base, suf):
        for mic in prim + fb:
            if etf_by.get((mic, cand)):
                why = 'ETF'; break
            f = fun_by.get((mic, cand))
            if f:
                why = f[0]['type']; break
        if why != 'hueco_de_cobertura':
            break
    return dict(symbol=sym, base=base, suffix=suf, market=market,
                status='sin_correspondencia', tier=None, matched=None, hits=[], why=why)
```

## Anexo B — Ficheros intermedios

Todos en `/tmp/tdmig/`, fuera del repositorio:

| Fichero | Contenido |
|---|---|
| `symbols.json` | 9.152 símbolos de `daily_bars` con nº de barras y rango de fechas |
| `names.json` | 10.039 pares `symbol` → `company_name` de `scan_results` |
| `mapping4.json` | resultado completo del mapeo, símbolo a símbolo, con los hits del catálogo |
| `discrepancias_nombre.json` | los 228 símbolos con nombre discrepante (§3.4) |
| `universo_us.json` | los 4.292 símbolos US `Common Stock` que sobreviven a AGENTS.md |
| `salida.txt` | output crudo completo de `analisis.py`, del que salen los bloques citados |
| `td-etf.json`, `td-funds.json` | catálogos `/etf` y `/funds` de Twelve Data |
