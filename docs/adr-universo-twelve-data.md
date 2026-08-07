# ADR — Universo de mercado con Twelve Data (planificado, NO implementado)

- **Estado:** aplazado
- **Fecha del análisis:** 27 de julio de 2026
- **Fecha de esta extracción:** 5 de agosto de 2026

## Por qué está aquí y no en AGENTS.md

Este análisis vivía en AGENTS.md, el archivo que Codex lee al arrancar
cada sesión, redactado como si describiera el sistema actual. No lo
describe: es un diseño planificado sobre un proveedor que no está
contratado.

Consecuencia real: cualquier modelo que trabajara en el repo partía de
la premisa de que el universo se define por `mic_code` sobre el catálogo
de Twelve Data. El código no hace eso.

## Qué hace el código hoy

El universo se construye a partir de NasdaqTrader, HKEX, TWSE,
J-Quants, ASIC y ESMA/FIRDS, más listas curadas fijas
(`lib/universes.js`). La orquestación está en `lib/universeEngine.js`.

## Decisión

No se contrata Twelve Data hasta que el producto esté próximo al
lanzamiento y las cuentas lo justifiquen. El análisis de abajo se
conserva íntegro porque las reglas están verificadas contra el catálogo
real y las decisiones de exclusión de mercados siguen siendo válidas
como especificación de destino.

---

## Definición del universo de mercado (Twelve Data)

Reglas derivadas del análisis del catálogo completo de Twelve Data
(`/stocks`, 192.112 símbolos) el 27 de julio de 2026. Todas verificadas
contra el catálogo real, no supuestas.

### Regla 1 — El universo se define por `mic_code`, NUNCA por `country`

El campo `country` es engañoso porque refleja la bolsa donde cotiza el
instrumento, no el origen de la empresa. Ejemplos reales del catálogo:

- `country: Germany` devuelve 64.331 símbolos. Alemania tiene ~700 empresas
  cotizadas. La diferencia son las bolsas regionales (Stuttgart 18.810,
  Fráncfort 14.499, Düsseldorf 13.553, Múnich 12.644), que listan valores
  extranjeros. **Xetra (`XETR`), la bolsa alemana real, tiene 1.687.**
- `country: Italy` devuelve 13.654. Milán (`XMIL`) muestra 10.262 marcados
  como "Common Stock", pero una muestra revela Covestro, Traton, Marvell,
  Agilent y Alcoa — todos en EUR. Son cotizaciones cruzadas, no valores
  italianos.
- `country: Austria` devuelve 8.614. Viena tiene ~60 empresas.

### Regla 2 — Filtrar por `type == "Common Stock"`

Distribución de tipos en el catálogo completo:

| Tipo | Símbolos |
|---|---|
| Common Stock | 154.381 |
| Warrant | 23.544 |
| American Depositary Receipt | 5.011 |
| Depositary Receipt | 4.361 |
| REIT | 2.764 |
| Preferred Stock | 1.871 |

Esto separa automáticamente warrants y ADR sin trabajo manual. Decidir
aparte si los REIT entran (son valores operables legítimos, pero su
comportamiento técnico difiere).

**Esta regla es solo para el universo de acciones.** Filtrar por
`type == "Common Stock"` excluye también los ETF (no aparecen como
"Common Stock" en el catálogo de Twelve Data). Eso es correcto para el
screener de acciones, pero la capa de ETF de país/sector (cobertura
internacional, ver Regla whitelist más abajo) es un universo aparte con
su propio criterio de tipo — no se resuelve extendiendo esta regla, y no
debe mezclarse con el filtro de acciones.

### Regla 3 — Excluir OTC explícitamente

En EEUU, `country: United States` + `type: Common Stock` incluye 9.217
valores OTC repartidos en `PINX`, `PSGM`, `OTCB`, `EXPM`, `OTCQ`. No
tienen la liquidez ni la limpieza de datos que requiere el análisis por
etapas. Se excluyen usando la lista blanca de MIC de abajo.

### Regla 4 — Nasdaq se parte en tres MIC codes

`XNAS` devuelve solo 24 símbolos y es una trampa. Los valores de Nasdaq
están en:

- `XNCM` — Capital Market (1.499)
- `XNGS` — Global Select (1.266)
- `XNMS` — Global Market (901)

`XNAS` en cambio SÍ entra en la whitelist (ver abajo) pese a sus 24
símbolos: verificado contra el catálogo que esos 24 `Common Stock` no se
solapan con XNCM/XNGS/XNMS (0 símbolos en común) — no son ruido del
mismo Nasdaq ya cubierto, son un listado distinto.

### Lista blanca de MIC codes

```
Norteamérica:  XNYS, XASE, XNAS, XNCM, XNGS, XNMS, ARCX, BATS, XTSE, XTSX
Asia:          XJPX, XHKG
Reino Unido:   XLON
Europa:        XETR, XPAR, XMAD, XMIL, XAMS, XBRU, XLIS, XSWX
Nórdicos:      XSTO, XCSE, XOSL, XHEL
Otros:         XWAR (Polonia), XTAE (Israel)
```

- **`ARCX` (NYSE Arca) es imprescindible, no opcional:** es la bolsa
  donde cotiza la mayoría de ETF estadounidenses, y la capa de cobertura
  internacional por ETF de país/sector depende de este MIC. Sin `ARCX`
  esa capa no existe. Ojo: el catálogo `/stocks` de Twelve Data (este
  documento se verificó contra él) NO incluye ETF — son un endpoint
  aparte (`/etf`) no descargado todavía, así que el recuento de ETF en
  `ARCX` queda pendiente de verificar cuando se traiga ese catálogo. Lo
  que si se confirmó en `/stocks`: 7 símbolos bajo `ARCX` (3 Common
  Stock, 3 Limited Partnership, 1 Exchange-Traded Note) — la razón real
  de incluirlo no es este recuento, es la capa de ETF pendiente.
- **`BATS` (Cboe BZX) no es redundante con NYSE/Nasdaq:** Cboe Global
  Markets Inc. (símbolo `CBOE`, del S&P 500) cotiza bajo `mic_code:
  BATS` — no aparece en ningún otro MIC de la whitelist. Verificado
  contra el catálogo: **1 símbolo** bajo `BATS` (`CBOE` mismo), no 17
  como se asumió inicialmente — la cifra de 17 no se sostuvo al
  verificarla y se descarta. La razón para incluir `BATS` sigue siendo
  válida (recupera un valor real que ningún otro MIC cubre), solo el
  número era supuesto, no verificado.

Total en bruto con esta lista y `type == "Common Stock"`: **36.771**
(36.743 + 3 de `ARCX` + 1 de `BATS` + 24 de `XNAS`). Descontando el
ruido de cotizaciones cruzadas de Milán, el universo real ronda los
**26.000–27.000**.

### Mercados excluidos y por qué

- **Taiwán, Corea, India, China continental** — inaccesibles o muy
  difíciles para el minorista europeo. Su exposición se cubre vía ADR
  cotizados en EEUU.
- **Australia (`XASX`)** — decisión del proveedor, no nuestra: Twelve Data
  restringe los datos de ASX a uso interno sea cual sea el plan. Mostrarlos
  públicamente exige licencia de redistribución obtenida directamente de ASX.
- **Singapur, Grecia** — mercados de dividendos/REIT o con liquidez
  irregular; poco material para VCP y análisis por etapas.

### Regla 5 — El filtro de liquidez también deduplica

No hay ISIN disponible en el plan base (`isin: request_access_via_add_ons`),
así que no se pueden detectar automáticamente las dobles cotizaciones de un
mismo valor. El filtro de liquidez lo resuelve en la práctica: una
cotización cruzada negocia una fracción del volumen del mercado principal,
así que un umbral de ~1M USD diarios elimina casi todas de forma natural.

Esto convierte el filtro de liquidez en algo más que control de costes:
es también el mecanismo de deduplicación.

### Regla 6 — La amplitud se calcula SOLO sobre cotizaciones primarias

Un ADR es una cotización secundaria de una empresa que ya cuenta en su
mercado de origen. Incluirlos en el agregado produce doble conteo y mala
atribución geográfica (un ADR taiwanés contando como "EEUU" distorsiona
ambas lecturas).

- **Panel de amplitud:** solo primarias. Excluir ADR y depositary receipts.
- **Screener:** todas. Si el usuario puede comprar TSM en Nasdaq pero no
  2330 en Taipéi, la serie que le sirve es la del ADR — en dólares, con
  horario de Nueva York, incluyendo el efecto divisa.

Esta distinción es canon: debe estar decidida **antes** de calcular la
primera cifra de amplitud. Si el panel nace con ADR mezclados, todas las
series históricas quedan inservibles.

### Pendiente de normalizar

- **Unidades:** Reino Unido cotiza en peniques, Israel en agorot. Sin
  corregir, los umbrales de liquidez salen inflados por 100 y esos mercados
  aparecerán artificialmente arriba en cualquier ranking.
- **Divisa:** el umbral de liquidez debe expresarse en divisa común (USD).
  Un corte por percentil dentro de cada mercado NO sirve: en Hong Kong el
  P25 son ~5.400 USD diarios mientras en Japón el P10 son ~70 millones. La
  composición de los universos no es comparable.

