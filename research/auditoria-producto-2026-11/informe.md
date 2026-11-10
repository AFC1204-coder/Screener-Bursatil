# Auditoría de producto y datos: StatsEdge, noviembre de 2026

Fecha: 2026-11-07. Rama: `codex/statsedge-ui-polish`, con cambios sin comitear de otros agentes; se audita lo que había en el disco ese día. Tipo: solo lectura.

Fuentes:
- **Base:** la copia local `statsedge_local` (:55432). Todas las consultas se lanzaron con `default_transaction_read_only=on` mediante `scripts/q.sh`.
- **Aplicación:** el servidor de desarrollo de `:3320`, con Playwright (`channel: "chrome"`) a 1440×900.
- **Fuera de alcance:** el Mini y Supabase.

Antigüedad de la copia: nocturno US del 18-oct (precios reales del 16-oct), RS semanal hasta el 27-sep. Esa antigüedad no se trata como hallazgo, salvo cuando la interfaz la oculta.

Leyenda:
- **V**: verificado con consulta SQL, lectura de código (archivo:línea) o captura.
- **S**: supuesto o inferencia no medida.

Esta auditoría no repite hallazgos de tres trabajos anteriores: `research/auditoria-filtros-2026-11/informe.md` (H1–H17), `research/auditoria-grafico-2026-11/informe.md` (H1–H30) y `research/movil-2026-11/propuesta.md` (M1–M22). Cuando uno de esos hallazgos sigue vivo y es relevante, se cita por su identificador.

Criterio de producto (indicación del usuario): ser un MarketSmith/Deepvue **centrado en etapas de Weinstein**, «simple a primera vista, profundo bajo demanda», con el **swing semanal** como escala principal y la posibilidad de cambiar de escala.

---

## 1. Resumen ejecutivo

1. **La etapa «semanal» se recalcula cada noche con la semana a medio hacer, así que parpadea.** Entre dos nocturnos consecutivos cambian de etapa entre 127 y 389 valores, y 99 cambiaron 3 o más veces en una sola semana (V, `lib/weeklyStage.js:70-88,231`). «sem. N» y las entradas y salidas de Etapa 2 miden ruido diario, no semanas.
2. **«Esta noche · Entradas en Etapa 2 (51)» no es de esta noche ni de esta lista.** Compara los nocturnos del 12 y el 14-oct (datos del 9 al 13-oct), mientras la lista es la del 18-oct. **27 de las 51 «entradas» están hoy en Etapa 3**, y la vista las enseña con un «3» en la columna Etapa (V, captura `p11`).
3. **El régimen de mercado («Riesgo favorable / mercado alcista · 90») sale de una caché de 44 días** (24-sep, índices al 22-sep), marcada como caducada y sin fecha visible en ninguna pantalla. «Estado sectorial» en Sectores sale de la misma caché, presentada bajo «Snapshot del 18 oct» (V).
4. **Velas intradía guardadas como cierre.** Hay 200 barras escritas a mitad de sesión que nunca se rehicieron, con el volumen al 45–57 % del normal. La ficha de AAPL dice «343,47 · cierre 6 nov», y es el precio de las 14:53 ET (V).
5. **Barras corruptas persistentes.** Hay escalas mezcladas tras contrasplits (VEEA, KITT) y barras fantasma en festivos. El nocturno las usa y la ficha no, así que discrepan: en VEEA el screener calcula una base del 98,8 % y la ficha, del 84,9 %. Además, **Listas sale vacía**: lee 80 filas y aplica una frescura fija sin la opción B (V).

---

## 2. Hallazgos de fiabilidad de datos

Consultas en `scripts/`. Cada una se reproduce con `scripts/q.sh -f scripts/<archivo>.sql`.

| ID | Grav. | Dónde | Evidencia (V/S) | Efecto sobre el usuario | Arreglo propuesto | Esf. | Comprobación automática |
|---|---|---|---|---|---|---|---|
| **D1** | **Alta** | Etapa semanal: screener, cinta (`sem. N`), «Esta noche», panel | V `a11_parpadeo_etapa.sql`. Cambios de etapa por par de nocturnos (12→13, 13→14, 16→17 y 17→18-oct): **288, 127, 389 y 67**. Entradas y salidas de E2 por noche: 69/72, 32/31, 143/77 y 18/12. **176 símbolos** cambiaron de etapa ≥2 veces en la semana del 12 al 18-oct, y **99** ≥3 veces. Causa: `weeklyBarsFromDaily` mete en el cubo de la semana actual las sesiones que lleve, y `weeklyStageForBars` clasifica con `offset 0` (`lib/weeklyStage.js:70-88, 231-234`). | Un «Etapa 2 · sem. 10» puede ser «Etapa 3» mañana y volver el jueves. El trader semanal no puede fiarse de la columna que define el producto. | Clasificar sobre la **última semana cerrada**. La semana en curso se muestra como provisional («E2 → E3?» en humo) sin cambiar el estado oficial hasta el cierre del viernes. `weekInStage` también, sobre semanas cerradas. | S–M | Test: con la misma serie hasta el miércoles y hasta el jueves, el estado oficial no cambia. Salud: cambios de etapa oficial entre nocturnos del mismo ISO-week = 0. |
| **D2** | **Alta** | Raíl «Esta noche» (Entradas/Salidas E2, Nuevos máximos, A <5 %) y `/api/weekly-changes` | V `/api/weekly-changes`: `window.from 2026-10-09 → to 2026-10-13`, `fromScan …10-12`, `toScan …10-14`, mientras la lista activa es `materialized:US:2026-10-18`. **Entradas: 27/51 en stage3 en el scan mostrado. Salidas: 12/49 siguen en stage2.** Captura `p11-esta-noche-entradas.png`: RRC, ULH, HCC, ITT, FCFS, GAM, C y PVLA con «3 · sem. 1» dentro de «Entradas en Etapa 2», y BGC con «2 · sem. 10» como «entrada». | Lo que el usuario pulsa como «nuevo hoy en E2» son valores que ya salieron, comparados sobre 2 sesiones de hace 3 semanas. El rótulo «Esta noche» aparece junto a datos semanales. | (a) El par de comparación es siempre **el scan mostrado frente al de hace una semana cerrada** (viernes a viernes). (b) Rótulo con fechas: «Semana 9 → 16 oct». (c) Con D1 resuelto, las entradas cuentan semanas cerradas. Si no hay par válido, «Sin comparación esta semana», sin cifras. | M | Test de contrato: `toScan.localId` = id del scan mostrado; ninguna fila de `entries` con etapa ≠ stage2 en ese scan. |
| **D3** | **Alta** | Cabecera de Mercado, «Estado sectorial» en Sectores y `marketScore` | V `/api/market-health`: `generatedAt 2026-09-24`, índices con fecha 21/22-sep, `freshness.cacheStale: true`, `cacheAgeHours: 1066,8`, `cacheMaxAgeHours: 4`, `nightlyScan.found: false (scan-read-failed)`. **Ningún componente lee `cacheStale` ni `cacheAgeHours`** (grep en `app/` y `lib/`: solo los usa la propia ruta). En `app/sectors/page.jsx:442-449`, «Estado sectorial» pinta `sectorTape` de esa caché: Tecnología RS 1M +5,3 %, igual que el payload del 24-sep, bajo el selector «Snapshot del 18 oct 2026» (captura `p06`). | El veredicto que encabeza Mercado y Sectores («Riesgo favorable / mercado alcista», «Líder fuerte») tiene 6 semanas y no lo dice. Es la primera pantalla del flujo diario. | Mostrar «Índices al 22 sep» junto al veredicto. Con más de 2 sesiones de antigüedad, apagar el color y el adjetivo del régimen («Régimen sin actualizar desde el 22 sep»). No usar una caché de más de N días como régimen. | S | Test: payload con `cacheStale` → el render contiene la fecha y no el texto del régimen. Salud: antigüedad de `market_health_cache` ≤1 sesión. |
| **D4** | **Alta** | `daily_bars` → ficha, cinta, volumen, contracciones | V `a6_barras_parciales.sql`: **200 barras US escritas antes de las 16:00 ET** de su sesión (06-05: 88, 07-20: 1, 08-10: 106, 11-06: 5) que nunca se reescribieron. Su volumen es una mediana de **0,45–0,57** del de sus vecinas (119 «truncadas» por debajo de 0,6). AAPL 11-06: 343,47 con **24,8 M** de volumen, escrito a las 14:53 ET. La ficha dice «cierre 6 nov 2026» (captura `p02`). Mecanismo: `readDailyBarsCache` considera fresca la caché por **fecha** (`lib/dailyBarsCache.js:510-512`), así que una vela de hoy escrita a mediodía cuenta como hit y no se vuelve a pedir. La escritura no distingue sesión abierta de sesión cerrada (`writeDailyBarsCache`, `:543`). | Un precio intradía rotulado como «cierre». El volumen de esos días queda recortado para siempre, lo que distorsiona el volumen seco y los máximos y mínimos de la base. | No persistir la barra de la sesión en curso (por calendario de mercado y hora de cierre + 30 min), o guardarla con `partial=true` y rehacerla. En la ficha, «último 14:53 ET» en lugar de «cierre». | M | Salud: `a6` = 0 filas. Test: escribir con un `now` dentro de la sesión no persiste la barra de hoy. |
| **D5** | **Alta** (por símbolo) | `daily_bars` → nocturno (base, drawdown, contracciones, miniatura) | V `a3_picos_una_barra.sql`: **18 picos de una barra** (sube o baja >40 % y vuelve al día siguiente) en símbolos del scan. VEEA (contrasplit 1:20): 4 barras sin ajustar (0,126 con 19,3 M de volumen entre barras de 2,5 con unos 80 k). Fila del nocturno de VEEA: `baseDepthPct 98,75`, `maxDrawdown63d 96,6`, `maxDailyMove20dPct 71,8`, y `chartPreview` con los valores de 0,12. La ficha (Yahoo en vivo) pinta 2,52 y «Base 84,9 %». V `a4_festivos_us.sql`: **294 barras US en festivos NYSE** (p. ej. SNOW 2026-05-25, Memorial Day: 255,55 con 89,6 M de volumen, entre 172 y 177). Causa: `writeDailyBarsCache` hace upsert de lo que trae el proveedor y **nunca borra las fechas que el proveedor ya no devuelve** dentro de la ventana refrescada. SNOW se volvió a pedir el 7-nov a las 12:30 y la barra del 25-may sigue ahí (`updated_at` 15-ago). Por qué no se reescribió la barra de VEEA: **S** (hipótesis: el delta `barUnchanged` comparaba contra la caché leída con el desfase de −1 día, corregido en `a34389a`). | La cinta y los filtros de base, volatilidad y drawdown de esos valores son falsos, y la ficha dice otra cosa. Un trader que filtra por «drawdown 3M ≤40» los pierde, o los ve con contracciones absurdas. | (1) En cada escritura, borrar en `[min(fecha del payload), max]` las fechas ausentes del payload. (2) Guard de escala: si una barra difiere ×5 o más de sus dos vecinas y su volumen es ×10 o más, descartarla y pedir de nuevo la serie completa. (3) Limpieza puntual de las 294 + 18 filas. | M | Salud: `a3` y `a4` = 0 (con un calendario NYSE de verdad, no la lista a mano). Test: un payload sin la fecha X borra la X cacheada dentro de su rango. |
| **D6** | **Alta** | Listas, Research Desk y `/api/discovery` | V `/api/discovery`: `effectiveRead.maxRows 80`, `nightly.status "partial", rows 80`, `criteria.maxPriceFreshnessDays 5`. Resultado: **las 9 listas a 0** (`health.state "empty"`). La página se queda en «Cargando rankings» (captura `p04`) porque la primera petición superó los 8 s (consola de `p05`: «no respondió en 8s»); en caliente tarda 312 ms. Research Desk: «Snapshot del 18 oct · 0 filas · 0 acciones» frente a 3.287 filas reales. | Con un nocturno atrasado, el screener enseña 937 filas con la banda de la opción B y Listas enseña «0 acciones únicas» sin decir por qué. Cuando hay datos, las listas se calculan sobre 80 de 3.287 filas. | Aplicar la misma regla de frescura que el screener (`lib/dataAge.js`, opción B). Leer el nocturno completo o, si no, decir «sobre 80 filas». Estado de espera con tiempo límite y mensaje de causa. | S–M | Test: con un conjunto atrasado al completo, `discovery` devuelve filas y `freshnessSuspended=true`. Salud: `inputRows` = `row_count` del nocturno. |
| **D7** | **Alta** (multimercado) | Selector de mercados (HK y Europa) | V `/api/scans?anchor=markets&markets=US,HK,DE,FR,GB`. HK es un **acumulado de 7 noches** con `lastDate` 27-ago (21), 4-sep (82), 15-sep (76) y 9-oct (74). **Solo 74/253 filas HK tienen RS semanal.** DE sale del scan del 20-sep (23 filas, precios del 16/18-sep), no del 17-oct (8 filas). GB sale del 16-oct con 19 filas (el tramo `o24`; el `o0` del 19-sep queda fuera). En una misma tabla conviven precios del 27-ago y del 16-oct. | Rend. 3M, distancia al máximo de 52 semanas y etapa de filas con 6 semanas de diferencia se ordenan juntas. Con el filtro RS activo, el 71 % de HK cae como «sin dato». Del total del mercado se ven 19-23 valores sin aviso. | Fecha por mercado en el chip de ámbito («HK · precios 27 ago–9 oct»). En una mezcla, columna «Fecha» visible. Para Europa, unir los tramos (o0+o24) del último ciclo completo, no el último scan suelto. | M | Salud: rango de `lastDate` por mercado en el scan servido ≤ 5 sesiones; recuento servido = tamaño del universo del mercado. |
| **D8** | Media | Escala semanal del gráfico (ficha y Review) | V código: las medias usan longitudes en **barras** fijas, 50 y 200, sea cual sea la temporalidad (`lib/chartSeriesModel.js:194-196`, `app/chartNativeAdapter.js:462-466`). En W se dibuja una MM de 50 semanas: AAPL termina en unos 293, y la MM30s que usa la etapa es 314,6 (brief `stage.weekly.slowMa`). Captura `p13`. Arranque en D con SMA50/200 diarias (`p02`). Temporalidades 1m–4H visibles (M12 ya lo señalaba en la vista rápida; también pasa en la ficha). | La etapa se decide con la MM30s y el gráfico semanal no la enseña. El usuario semanal ve una media que no es la del criterio. | Medias por temporalidad: W → 10s/30s; D → 50/150/200; M → 10m. Arranque en **W** (decisión del usuario). Ocultar las temporalidades intradía. | S | Test: `projectMovingAverages(weekly)` devuelve 30 y 10; el último valor de MM30 coincide con `stage.weekly.slowMa` (tolerancia 0,5 %). |
| **D9** | Media | Fechas entre pantallas | V: Screener «Precios del 15 oct» y panel «218,01 cierre jue 15 oct» (`p10`). Mercado: «precios al cierre del 16 oct» (`p07.txt:161`). El precio real es el del 16-oct (`daily_bars`; causa ya corregida en `a34389a`, pero los nocturnos guardados conservan la fecha corrida: auditoría de filtros, §9.1). | Dos pantallas dan dos fechas para el mismo cierre. | Renocturno, o corregir al leer (`lastDate` + 1 sesión en los scans anteriores al 23-oct, marcados por `created_at`). | S | Test: `lastDate` de la fila = fecha en `daily_bars` cuyo cierre coincide con `price`. |
| **D10** | Media | Universo: misma empresa dos veces | V `a7_duplicados_empresa.sql`: 28 grupos por nombre (unos 23 son clases reales): GOOG/GOOGL, BRK-A/BRK-B, LBTYA/B/K, FOX (stage1)/FOXA (stage2), CENT/CENTA (las dos E2), NWS/NWSA, HEI/HEI-A, LEN/LEN-B, UA/UAA, Z/ZG, BF-A/BF-B… además de WAFDP (preferente). | La cola duplica candidatos, y el percentil RS cuenta dos veces la misma empresa. | Clave de emisor: mostrar la clase principal, plegar la secundaria («+1 clase») y excluir preferentes. | S | Salud: grupos por emisor con más de una fila visible = 0. |
| **D11** | Media | Universo: instrumentos que no son acciones ordinarias | V/S `a8`, `a9` (clasificación por nombre e industria): unos 42 fondos cerrados (BDJ, BTZ, GUT, GAM…) y 55 SPAC/shell. **GAM (fondo cerrado) aparece en «Entradas en Etapa 2»** (`p11`). | Ruido en la cola y en la base del percentil RS. | Excluir `quoteType` ≠ EQUITY y las SPAC antes del de-SPAC, o etiquetarlas. | S | Salud: recuento de CEF/SPAC en el nocturno = 0. |
| **D12** | Media | Liquidez y precio fuera de US | V: la fila del screener **no lleva divisa** (ni una clave `currency`/`fx`). CRDA.L: `price 3623`, `avgTurnover 1,65e9` en **peniques**, es decir, unos 16,5 M£. Con ese dato, el umbral «importe ≥1 M» es 100 veces más laxo en Londres (H16 de filtros ya apuntaba lo de moneda local; lo de los peniques y la fila sin divisa es nuevo). `lib/rsFx.js:90-105` sí normaliza GBX, pero solo para el RS. | Un 3623 sin unidad, y un filtro de liquidez que no compara igual entre mercados. | Llevar `currency` a la fila; importe en USD con el FX del motor RS (dividiendo GBX entre 100). | S–M | Test: liquidez de CRDA.L en USD = turnover/100 × GBPUSD. |
| **D13** | Media | RS país (Europa) | V `a12_grupos_pequenos.sql`: RS país sobre muestras curadas de 20–43 valores (DE 31: rango 3–99; FR 32; ES 33; GB 43). Las muestras por debajo de 20 se anulan bien (IE 7 y AU 10, con `rs_rating` nulo). | «RS país 90» en Alemania es ser 3.º de 31 grandes empresas, y se pinta igual que un percentil sobre 5.600. | Mostrar «n=31» junto al RS país, o percentil en tramos (quintil). | S | Test de render: con `sampleSize < 100` aparece «n=». |
| **D14** | Media | Orden y nombre de la vista principal | V captura `p01`: «ordenado por Rendimiento 3M» **sin columna 3M visible**. V `a13`: «Líderes Etapa 2» incluye 97 E2 a más del 25 % del máximo de 52 semanas, y 22 a más del 40 % (SVIA −65,4 %, ASST −33,5 %). | El orden no se puede leer en la tabla y «Líderes» promete una plantilla de tendencia que no se aplica. | Orden por defecto: RS semanal (o «semanas en E2» + RS), con la columna del orden siempre visible. Renombrar a «Etapa 2», o exigir ≤25 % del máximo para «Líderes». | S | Test: la columna del criterio de orden activo siempre está montada. |
| **D15** | Baja | Fuera del foco / unidades | V: IPO radar ofrece «SG · Singapur» (SG fuera de foco); la ficha dice «Edad 551m» (meses, ambiguo) y «Cap. 5,00T USD» («T» inglesa por «billón»); texto de Mercado: «En las últimas 20 semanas… la serie solo cubre 4 semanas» (`p07.txt:208`). | Pequeñas fricciones de lectura. | «Edad 45 años», «5,00 bill. USD» o «5.000 mil M», y no rotular 20 semanas si hay 4. | XS | — |

**Comprobado y correcto** (no son hallazgos):
- Sin duplicados `(symbol, trade_date)`.
- Ningún cierre ≤0 en US.
- Un solo cierre fuera de H–L (KRT 11-05, barra intradía; entra en D4).
- `distance52w` guardada = recalculada desde las barras en las 3.287 filas (diferencia >3 pts: 0). Las barras fantasma no fijan el máximo de 52 semanas en ningún símbolo del scan (`a5`).
- Las lecturas de `localStorage` y `sessionStorage` están protegidas con `try/catch` (`lib/localState.js:137-145`, `lib/cloudSyncClient.js:48-55`, `lib/screenerMarket.jsx:167`).
- Los motores RS por debajo de `min_sample` publican `rs_rating` nulo.

---

## 3. Presentación (escritorio 1440×900)

Capturas en `capturas/` (`p01`–`p13`, cada una con `-completa.png` y `.txt` con el texto visible). Medidas automáticas en `capturas/log.json`.

### 3.1 Por pantalla

| Pantalla | Lo que funciona | Lo que engaña o falta para decidir una entrada | Captura |
|---|---|---|---|
| **Screener** | Primera fila a unos 178 px. Cinta con miniatura semanal de 12 meses, etapa y semana, RS y máximo de 52 semanas. Raíl de vistas. Atajos j/k/Space/Enter. Banda de frescura honesta. | **No hay precio, ni pivote, ni distancia al pivote, ni stop o riesgo**: lo que decide una entrada no está en la fila. El orden «Rend. 3M» no tiene columna (D14). RS sin semana ni n («RS 99» ¿de qué semana y sobre cuántos?; H12 de filtros, sigue vivo). La sección «Esta noche» es engañosa (D2). La sección «Del análisis nocturno» mezcla una vista de etapa (semanal) con «Deterioro 1.622» (veredicto del sistema). | `p01`, `p10`, `p11` |
| **Panel (Space)** | Muy bueno para el semanal: cierre semanal de 12 meses con MM30, etapa con curva, RS, VCP, máximo de 52 semanas y clasificación propia en 3 botones. | «cierre jue 15 oct» es la fecha corrida (D9). Faltan pivote, riesgo % hasta el stop y la semana del RS. | `p10` |
| **Ficha** | Etapa con semana. Tarjeta de identidad con RS, máximo de 52 semanas y crecimiento trimestral. | Arranca en **D** con SMA50/200 diarias; en W las medias son de 50 semanas (D8). Temporalidades intradía. «cierre 6 nov» es intradía (D4). Pivote y stop no se ven sin activar el diagnóstico. La línea RS es de otro motor (H1 del gráfico, sigue vivo). La tarjeta tapa el 40 % del lienzo. | `p02`, `p13` |
| **Review / vista rápida** | El estado vacío explica las 3 causas. | La cola vive solo en `localStorage`: en otro navegador está vacía (U12 de filtros). Sin cola no hay forma de revisar «la vista actual» desde aquí. | `p03` |
| **Listas** | — | «Cargando rankings» indefinido y después 0 (D6). Los títulos «Score compuesto», «RS Quality Leaders», «Extended but strong» y «Pullback to SMA50» mezclan inglés y español y recuperan scores compuestos que se retiraron del producto en agosto. | `p04` |
| **Research Desk** | — | 26 s de carga; «Snapshot 18 oct · 0 filas»; 10 controles sin nombre accesible. Es una pantalla de mantenimiento (exportar, eliminar o importar JSON) en la navegación principal. | `p05` |
| **Sectores** | Tabla densa con estado, etapa y rendimientos por ETF. | Datos de 6 semanas bajo «Snapshot del 18 oct» (D3). «Líder fuerte/Débil» con colores verde y rojo: juicio del sistema en tipografía de métrica (M18 lo decía para móvil y también pasa aquí). No hay ranking de **grupos de industria** (el «Group Rank» de MarketSmith o Deepvue), solo 11 ETF. | `p06` |
| **Mercado** | Pregunta clara («¿qué exposición tolera…?»), curva de etapas con índices y amplitud sobre MM30s. | El veredicto «90 · alcista» contradice su propia amplitud: 44 % sobre MM30s, 31 % del universo en E2, participación del 62 al 55 % (D3). 4.582 px de alto y 108 textos de menos de 11 px. Amplitud por región: «Sin dato» ×8. | `p07` |
| **IPO radar** | — | Pantalla de mantenimiento (importar/exportar JSON) con un formulario largo; ofrece SG. Fuera del flujo semanal de etapas. | `p08` |

### 3.2 Mezcla de escalas (criterio semanal)

| Elemento | Escala real | Problema |
|---|---|---|
| Etapa y «sem. N» | Semanal, pero con la semana en curso | Parpadea a diario (D1) |
| Miniatura de la cinta y panel | Semanal, 12 meses, MM30 | Correcto: es el modelo a seguir |
| Orden por defecto | Rend. 3M (diario) | El protagonista debería ser semanal (RS semanal o semanas en E2) |
| Huella VCP `Y/Z NT` | 65 sesiones diarias | No es una base semanal; sin semanas desde P5 (correcto que no invente) |
| Ficha | D por defecto, SMA50/200 | Debería arrancar en W con MM10s/30s (D8) |
| «Esta noche» | 2 sesiones | El nombre y el cálculo deberían ser semana a semana (D2) |
| Régimen | Índices sobre medias (diario) y una caché vieja | Falta un régimen semanal: índice frente a MM30s y su pendiente, % del universo en E2 |

### 3.3 Accesibilidad y rendimiento percibido

- **Contraste (V):**
  - Calculado sobre los tokens: `--humo` sobre `--pizarra-2` da 4,86 (AA justo), `--oxido` sobre `--pizarra-2` da **3,86** (por debajo de AA en texto normal) y `--ghost` (tiza al 35 %) da unos 2,8.
  - `--ghost` es aceptable para un «—» ausente, pero no para texto que se lee, como el «937 en cola» de la cabecera de la cinta (S: el token exacto de ese texto no se midió).
- **Tamaños (V):**
  - Textos de menos de 11 px: 42 en Screener y 108 en Mercado.
  - Controles sin nombre accesible: 18 en Screener (miniaturas y botones de icono), 12 en Mercado y 10 en Research Desk.
- **Foco (V):** visible (contorno de 2 px) y en un orden lógico: marca → navegación → mercados → buscador → Revisar → raíl.
- **Carga (V, entorno de desarrollo, no representativo):**
  - Screener usable a unos 2 s, pero pide `/api/weekly-changes` 3 veces y `/api/scans` 2 veces (M6 sigue vivo).
  - Mercado pide 7 endpoints dos veces cada uno.
  - Research Desk: 26 s. IPO radar: 22 s, con un `Failed to fetch` en la consola.
  - La ficha da 12 errores `ERR_NAME_NOT_RESOLVED` (logos o recursos externos; S: sin red externa en el entorno).

---

## 4. Funciones propuestas (priorizadas)

Comparadas con MarketSmith (MS), Deepvue (DV), TradingView (TV), Finviz (FV), Stockbee (SB) y TraderLion (TL). La regla de diseño es «simple a primera vista, profundo bajo demanda»: cada función se resume en una celda o un chip y amplía su detalle en el panel o en la ficha.

**Datos disponibles hoy:**
- `daily_bars`: 400 barras por símbolo, 1.260 si el símbolo está referenciado.
- `weeklyBarsFromDaily`: la agregación semanal ya existe.
- `rs_weekly_items`: RS semanal con historia, aunque el motor canónico solo tiene 6 semanas en la copia.
- `fundamental_snapshots`: trimestrales de Yahoo.
- Tablas `notes`, `alerts` y `favorites` (vacías).
- `scan_symbol_history`: sin US (auditoría de filtros §3.5).

| Prio | Función | Referencia | Valor para el trader semanal | Esfuerzo | Viabilidad con los datos actuales |
|---|---|---|---|---|---|
| 1 | **Etapa semanal estable y «qué cambió esta semana»**: entradas y salidas de E2, cambios de RS de ±10 y nuevos máximos, viernes contra viernes | DV «what changed», MS «Stage», TL | Muy alto: es el núcleo del producto | M | Sí: barras diarias → semanas cerradas. Para listar los cambios sin recalcular, conviene llenar `scan_symbol_history` US (con 2 nocturnos guardados basta) |
| 2 | **Columna «Pivote / riesgo»**: distancia al pivote y % hasta el stop (mínimo de la última contracción o MM10s), y **calculadora de posición** en el panel (capital × riesgo % / distancia al stop) | MS «buy point/5 % zone», DV, TL | Muy alto: hoy no hay nada para decidir la entrada | S–M | Sí: `pivotPrice`, `distanceToPivotPct` (100 %) y `lastContractionDepthPct`; la calculadora es aritmética, con la cuenta en `localStorage` o en ajustes |
| 3 | **Línea RS en máximos antes que el precio** y **RS en tendencia** (Δ 4 semanas): chip en la cinta | DV/MS «RS line new high», TL | Alto: señal semanal clásica de líder | M | Sí, cuando el motor canónico tenga más de 8 semanas (completar el backfill con `--snapshot-date`, b3b12c3). Ya era P7 en la auditoría de filtros |
| 4 | **Ranking de grupos de industria** (percentil del RS mediano por industria; las 152 industrias US) con un enlace a la cinta filtrada por grupo | MS «Industry Group Rank 197», DV «Group ranks» | Alto: «el líder del grupo líder» | M | Sí: `rs_weekly_items` + `industry`. Sustituye a «Fuerza grupo» (H1 de filtros). Mostrar `n` y ocultar los grupos de menos de 5 valores (20 industrias con 1–4 valores, `a12`) |
| 5 | **Salud de mercado semanal ligada al screener**: % del universo sobre MM30s, % en E2/E4, nuevos máximos y mínimos de 52 semanas, monitor tipo Stockbee (subidas y bajadas ≥4 % y su ratio 5/10 días) y días de distribución del SPY/QQQ, con **fecha visible**. El chip de régimen en el screener abre esto | MS «Market Pulse», SB «Market Monitor», DV «Market breadth» | Alto | M | Sí con `daily_bars` (unos 3.300 US) + índices; ya hay `market-breadth`. Requiere D3 resuelto |
| 6 | **Alertas** (cruce del pivote, entrada en la zona del 5 %, pérdida de la MM30s, RS por debajo de X), evaluadas en el nocturno y leídas en un panel «Avisos» | MS, DV, TV | Alto | M | Tabla `alerts` existente (0 activas). En v1 basta con evaluarlas en el nocturno, sin notificaciones push |
| 7 | **Notas y diario por símbolo**: nota con fecha, captura del estado (etapa, RS, pivote) al guardarla y resultado | DV notas, TL journal | Medio–alto | S–M | Tabla `notes`; el «estado al anotar» sale de la fila del scan |
| 8 | **Calendario de resultados** (días hasta resultados en la fila y el panel) y ex-dividendos | MS, DV, FV | Alto: el swing evita resultados | M | **Dato nuevo**: Yahoo `calendarEvents` (válido en uso personal). Hoy no hay ningún campo (auditoría de filtros §3.1) |
| 9 | **Escala configurable D/S/M** coherente en todo: etapa, medias, miniatura, cambios y gráfico | TV, DV | Medio: el usuario lo pidió | M–L | **Semanal: sí** (60 semanas = 300 barras < 400). **Mensual: no** para la mayoría: una etapa mensual con MM10m y pendiente necesita unas 840 barras, por encima del límite de 400 de los no referenciados. Habría que subir el límite o guardar mensual aparte. Diario: sí |
| 10 | **Comparar 2–4 símbolos** (RS y precio normalizados en semanal) | TV, DV | Medio | S–M | Sí (`/api/chart/batch`) |
| 11 | **Vistas guardadas sincronizadas** y **exportación CSV** de la cinta | FV, DV | Medio | S | Las plantillas ya existen en local; CSV desde las filas en memoria |
| 12 | **Atajos**: `a` añadir a lista, `n` nota, `w`/`d` escala, `/` buscar, `1-4` clasificar | DV/TV | Medio | S | Sí (j/k/Space/Enter ya existen) |
| 13 | Recuento de bases (1.ª, 2.ª, 3.ª base de la etapa 2) | MS «base count» | Medio–alto | L | Requiere el detector de bases real (pendiente desde agosto: `research/contracciones/`) |
| 14 | Calidad de beneficios (aceleración de EPS y ventas) | MS «EPS rating» | Medio | M | Ventas trimestrales sí; EPS por acción 0 % (auditoría de filtros §3.1) |

**Qué no hacer:**
- Puntuaciones compuestas opacas (ya retiradas).
- Señales de compra automáticas.
- Datos intradía.
- Pull-to-refresh, ya descartado en el estudio móvil.

---

## 5. Orden de ejecución sugerido

**Tanda 1: que lo que se ve diga la verdad (datos, sin interfaz nueva).**
- D4: no persistir la vela en curso.
- D5: purga de fechas ausentes, guard de escala y limpieza puntual.
- D3: fecha y caducidad del régimen.
- D6: Listas con la opción B y lectura completa.
- D9: renocturno o corrección de `lastDate`.
- Añadir las consultas `a3`, `a4`, `a6` y `a11` como chequeo de salud tras cada nocturno (un script `ops`, solo lectura).

**Tanda 2: la escala semanal como protagonista.**
- D1: etapa sobre semanas cerradas.
- D2: cambios viernes contra viernes, emparejados con el scan mostrado.
- D8: medias por temporalidad y ficha en W.
- D14: orden por RS semanal con la columna visible.

**Tanda 3: decidir la entrada.**
- Propuesta 2: columna pivote y riesgo, y calculadora en el panel.
- Propuesta 3: RS en máximos y RS en tendencia.
- Propuesta 4: ranking de grupos de industria.

**Tanda 4: universo y multimercado.**
- D10: clases de acciones.
- D11: CEF y SPAC.
- D7: fechas por mercado y tramos europeos completos.
- D12: divisa y USD.
- D13: n del RS país.

**Tanda 5: flujo.**
- Propuesta 5: salud de mercado semanal ligada al screener.
- Propuesta 6: alertas evaluadas en el nocturno.
- Propuesta 7: notas.
- Propuesta 8: calendario de resultados.
- Propuestas 10–12: comparar, exportar y atajos.

**Decisiones que necesita el usuario:**
1. **Semana en curso:** ¿la etapa oficial se congela hasta el cierre del viernes, con la semana en curso como «provisional»? (Recomendado: sí.)
2. **Escala por defecto de la ficha y la Review:** ¿W? ¿Y se retiran las temporalidades intradía?
3. **Orden por defecto del screener:** ¿RS semanal, semanas en E2 o distancia al pivote?
4. **«Líderes Etapa 2»:** ¿exige ≤25 % del máximo (plantilla) o se renombra a «Etapa 2»?
5. **Clases duplicadas, CEF y SPAC:** ¿excluir o plegar?
6. **Régimen caducado:** ¿se apaga el filtro «Régimen» (activo por defecto) cuando la salud de mercado tiene más de N sesiones?
7. **Mensual:** ¿se sube el límite de `daily_bars` (≈840 barras) o se renuncia a la etapa mensual?
8. **Resultados:** ¿se acepta Yahoo `calendarEvents` como fuente (uso personal)?

---

## 6. Límites de la auditoría

- **Efecto secundario observado:** pedir `/api/company-brief` para NVDA, SNOW y VEEA hizo que la aplicación **escribiera 760 filas en `daily_bars` y 3 en `fundamental_snapshots`** de la copia local (caché de lectura; `updated_at` del 2026-11-07 a las 12:30). No borré ni modifiqué nada a mano. Después no abrí más fichas, salvo la de AAPL, que ya estaba en caché. Las pruebas de D5 (VEEA 08-11 y SNOW 05-25) se comprobaron **después** de esa escritura y seguían ahí.
- No se midió el Mini ni producción. El parpadeo de etapa (D1) y el par de «Esta noche» (D2) pueden tener otros números allí; el mecanismo está en el código.
- No pude cerrar por qué la barra de VEEA del 08-11 no se reescribió (D5, mecanismo **S**).
- La clasificación de CEF y SPAC (D11) se hizo por nombre e industria, no por `quoteType`.
- No se probó: sesión caducada o token inválido; sin conexión; volver atrás con historial; `localStorage` corrupto en el navegador (sí se comprobó por código que está protegido); Safari; tiempos de producción. No hay `error.jsx` en `app/` (V por `find`): un error de render muestra la pantalla de error por defecto de Next. Su aspecto no se probó.
- Origen de `marketHealth` en el filtro «Régimen» del screener: viene de la sesión guardada (`app/page.jsx:1052,1130`). No verifiqué si en una sesión nueva sale de la caché caducada de D3 (**S**).
- El contraste de §3.3 se calculó sobre los tokens, no píxel a píxel.
- La interfaz móvil queda fuera: la estaban editando otros agentes.

## Anexo: reproducir

```
scripts/q.sh -f scripts/a1_daily_bars_salud.sql        # duplicados, OHLC, volumen 0
scripts/q.sh -f scripts/a2_saltos_y_rangos.sql         # saltos >40 %
scripts/q.sh -f scripts/a3_picos_una_barra.sql         # D5 picos
scripts/q.sh -f scripts/a4_festivos_us.sql             # D5 festivos
scripts/q.sh -f scripts/a5_dist52_recalculo.sql        # distance52w correcta
scripts/q.sh -f scripts/a6_barras_parciales.sql        # D4
scripts/q.sh -f scripts/a7_duplicados_empresa.sql      # D10
scripts/q.sh -f scripts/a8_instrumentos_no_acciones.sql; scripts/q.sh -f scripts/a9_spac_cef.sql  # D11
scripts/q.sh -f scripts/a10_hk_europa.sql              # D7
scripts/q.sh -f scripts/a11_parpadeo_etapa.sql         # D1
scripts/q.sh -f scripts/a12_grupos_pequenos.sql        # D13, grupos
scripts/q.sh -f scripts/a13_lideres_lejos_maximo.sql   # D14
node scripts/api_get.mjs <repo> <dir> "/api/weekly-changes" "/api/market-health" "/api/discovery?limit=20&maxRows=80&sinceDays=10"   # D2, D3, D6 (cuidado: company-brief escribe caché)
node scripts/capturas.mjs <repo> capturas ; node scripts/capturas2.mjs <repo> capturas
```
