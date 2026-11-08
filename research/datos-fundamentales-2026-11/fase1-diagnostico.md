# Datos fundamentales — Fase 1: diagnóstico (2026-11-08)

Solo lectura. Todo lo marcado **[V]** está verificado contra la base del Mini o contra el endpoint real; **[S]** es supuesto.

## 0. Corrección de la premisa

**[V]** Los fundamentales SÍ se persisten. `fundamental_snapshots` (Mini, Postgres 17) tiene 57.295 filas `period_type='profile'`
(11.387 símbolos, desde 2026-05-18) con `businessSummary`, `fullTimeEmployees`, `growthMetrics`, `valuationMetrics`,
`fundamentalsFinancialResults` (income/balance/cashflow, anual y trimestral), `quoteSnapshot`, tenedores, etc.
`company_profiles` existe pero está vacía (0 filas). No hace falta una tabla nueva para el grueso; hacen falta arreglos de captura,
de lectura y de presentación.

## 1. Inventario campo → fuente → vacío

| Superficie | Campo | Fuente | Cuando falta |
|---|---|---|---|
| Tarjeta de identidad del gráfico (`lib/chartIdentityCard.js`) | resumen de negocio | `brief.summary` ← Yahoo `assetProfile.longBusinessSummary` | tarjeta sin resumen (ausencia «declarada» en la vista) |
| id. | capitalización | `brief.marketCap` | `null` (no se pinta) |
| id. | «Crecimiento trimestral» (ventas YoY, BPA YoY, 6 trimestres) | `financialResults.incomeQuarterly` vía `quarterlyGrowthCells` (`lib/descriptiveStrip.js`) | `usable=false` si hay menos de 2 celdas con dato → texto `DESCRIPTIVE_ABSENCE.quarters` |
| Ficha, «Bloque empresa» (`StockClient.jsx:479-503`) | sector, subsector, empleados, IPO | brief | `—` en gris |
| Ficha, «Descripción» (`StockClient.jsx:1806`) | `data.summary` | brief | «Sin descripción de negocio.» |
| Ficha, `FundamentalSnapshot` (`:1056-1085`) | cap, P/E fwd, P/S, EV/EBITDA, div. yield, márgenes, ROE, D/E, current ratio, caja, deuda, FCF, acciones, short % float | `valuationMetrics`, `growthMetrics`, `financialResults.latest/balance*/cashflow*` | «Sin dato» |
| Ficha, `ResultsSection` (`:911-1028`) | tabla de resultados anual/trimestral | `financialResults` | «Histórico insuficiente del proveedor…» |
| Ficha | próximos resultados, ex-dividend | `earningsCalendar` (Yahoo calendarEvents) | «Sin dato» |
| Filas del escaneo (`/api/scans`) | marketCap, sector, industry, country, `growthScore` y `epsGrowthProxyScore` (proxies), `shortPercentOfFloat`, `website` | materializado | los fundamentales reales NO viajan en la fila (el usuario ya lo sabía) |

Nota: `HuntCardRail`, `MesaEmptyCard` y `HuntTapeView` no pintan ningún fundamental (son raíles de vistas/estados vacíos). Las «tarjetas de descripción» son la tarjeta de identidad del gráfico y los bloques de la ficha.

## 2. Cobertura medida

### 2.1 Base (último perfil por símbolo; US = sin sufijo; EU = .L .PA .DE .MI .MC .AS .SW .ST .CO .OL .HE .BR .LS .VI .IR; OTRO = resto)

| Mercado | n | resumen | empleados | web | cap | PER | P/E fwd | BPA TTM | ventas YoY | margen neto | ROE | D/E | div. yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| US | 6.224 | 71,3 | 57,9 | 68,7 | 72,0 | 38,9 | 52,2 | 68,1 | 85,5 | 95,3 | 94,9 | 93,3 | 67,8 |
| HK | 2.768 | 99,6 | 98,3 | 98,2 | 99,2 | 50,9 | 36,4 | 99,2 | 99,1 | 99,8 | 99,7 | 99,4 | 49,2 |
| EU | 989 | 93,2 | 87,3 | 93,1 | 92,8 | 71,2 | 73,7 | 92,9 | 92,1 | 94,7 | 94,3 | 93,6 | 65,6 |
| OTRO | 1.406 | 95,0 | 47,6 | 95,0 | 95,4 | 57,5 | 78,5 | 92,5 | 86,6 | 95,3 | 94,7 | 91,9 | 59,5 |

(%; el PER vacío es en buena parte legítimo: pérdidas.) Los US con resumen/cap/empleados bajos (71/72/58 %) son sobre todo tickers sin ficha en Yahoo (warrants, unidades, derechos, fondos): **[S]** pendiente de confirmar con una muestra por tipo.

### 2.2 Serie de resultados (lo que alimenta la franja «Crecimiento trimestral»)

Perfiles persistidos (solo Yahoo):

| Mercado | 0 trimestres | 1-4 | ≥6 trimestres (franja computable) | con BPA trimestral |
|---|---|---|---|---|
| US | 15,2 % | 6,0 % | **1,4 %** | **0 %** |
| HK | 90,8 % | 2,4 % | **1,6 %** | **0 %** |
| EU | 49,0 % | 3,5 % | **2,8 %** | **0 %** |

Muestra viva de 30 fichas vía `company-brief` (10 por mercado, caché de ficha; la ficha de EE. UU. fusiona SEC): ≥6 trimestres US 7/10, EU 4/10, HK 0/10. Sin ningún trimestre: US 0, EU 5, HK 9. Solo 10 por mercado: orientativo.

### 2.3 Frescura

Último perfil por símbolo: ≤7 días 988 (8,7 %), 7-30 d 5.970, 30-90 d 3.922, >90 d 507. En EE. UU. solo el 1,1 % se tocó en la última semana.

## 3. Causas raíz de los vacíos

1. **El BPA trimestral nunca se pide.** `fetchYahooFundamentals` (`lib/yahoo.js:1067`) solicita 33 tipos de la serie temporal y ninguno es BPA. **[V]** El endpoint sin autenticación devuelve `quarterlyDilutedEPS`, `quarterlyBasicEPS`, `quarterlyDilutedAverageShares`, `trailingDilutedEPS` para AAPL y SHEL.L. Consecuencia: `eps:null` en todas las filas trimestrales de la base (0 %); la franja cae a `netIncome / sharesOutstanding actual`, que es un BPA derivado impreciso.
2. **Yahoo devuelve ~5 trimestres, y la franja necesita ≥6.** **[V]** AAPL: 5 puntos. `quarterlyGrowthCells` compara con el trimestre `index+4`, así que con 5 filas solo hay 1 celda con YoY y `usable` exige ≥2. Resultado: ≈1-3 % de la base. Con SEC (US) llega a 8 trimestres; en HK/UE no hay equivalente. Yahoo sí da 4 años anuales y puntos TTM (`trailing*`): sirven de plan B honesto.
3. **HK informa semestralmente.** **[V]** 0425.HK: trimestral vacío (`[]`), anual `2022…2025`, TTM con 7 puntos. El hueco trimestral en HK (90,8 %) es estructural, no un fallo; el texto «el proveedor no entrega historial» es correcto pero la UI no ofrece alternativa (semestral/anual).
4. **El endpoint v7 `finance/quote` devuelve HTTP 401 siempre.** **[V]** El último snapshot del 100 % de los símbolos lleva `profileProviderError: "Yahoo quote HTTP 401"`; 1.705 más añaden `profile HTTP 429` (límite de tasa) y 88 `404`. `fetchYahooQuote` (`lib/yahoo.js:328`) no usa crumb. Se pierde `quoteSnapshot` (precio, 52 semanas, volumen medio: llegan a `null` en AAPL) y parte de `trailingPE`/`forwardPE`/`priceToBook` que se recuperan solo por `summaryDetail`/`defaultKeyStatistics`.
5. **429 en el perfil.** 1.705 símbolos tienen su último intento fallido por límite de tasa → datos de hasta meses atrás.
6. **Cadencia.** Solo 8,7 % de la base tiene el perfil de la última semana; no hay refresco programado de fundamentales (**[S]**: no he mirado los launchd; lo confirmo en la fase 2).

## 4. Bloques «mal expuestos» (con ejemplos)

| # | Problema | Ejemplo verificado | Arreglo propuesto |
|---|---|---|---|
| E1 | Rentabilidad por dividendo `0` pintada como `0 %` cuando en realidad es «no paga» o «sin dato» (mezcla `0` y `null`) | EU 5/10 y HK 6/10 con `dividendYield === 0`; SOBI.ST, 8221.HK | `0` → «No paga» (si el proveedor lo confirma), `null` → «Sin dato de Yahoo» |
| E2 | Crecimiento de beneficios absurdo por base minúscula o negativa | ABT.MI −1.424 %, 3NOV25.CO +1.042 %, GERHSP.CO +810 %, 7656.HK −792 %, LSF +398 % | tope de visualización («>±500 %» → «n. s.») y no pintar si el signo cambia |
| E3 | ROE y D/E engañosos con patrimonio negativo | SBUX ROE −31 % con D/E −329; MH D/E 297 | patrimonio ≤0 → «Patrimonio negativo», no ratio |
| E4 | Márgenes con `0` en vez de vacío | RCE.AX `grossMargin:0`; 3NOV25.CO, KBON `profitMargin:0` | `0` por falta de ingresos → `null` |
| E5 | Margen neto >90 % en fondos/vehículos | FCSS.L 98 % | marcar tipo «fondo/inversora» o ocultar |
| E6 | Instrumentos que no son acciones en el universo | `3NOV25.CO`, `CGCBV.HE`, `2986.HK` sin sector/cap; cobertura 0-24 % | etiqueta «Instrumento sin ficha fundamental» en vez de grids vacíos |
| E7 | Unidades: Yahoo da `%` ya multiplicado en `growthMetrics` pero en ratio en otros campos | mezcla `percentValue`/`returnPercentValue` (`lib/yahoo.js:1122`); ROE 991 % en RCE.AX | normalizar y tests de unidades |
| E8 | «Sin dato» sin motivo | casi todo `StockClient.jsx` | motivo concreto: «Sin dato de Yahoo» / «No aplica (pérdidas)» / «Semestral: sin trimestres» |
| E9 | Franja trimestral usa BPA derivado sin avisarlo en HK/UE | `epsDerived` existe pero solo marca celdas con YoY | etiqueta «BPA estimado» siempre que derive |

## 5. Propuesta (a validar con el usuario)

**Fuente (Yahoo, uso personal):**
- Añadir a `fetchYahooFundamentals` los tipos `quarterlyDilutedEPS`, `quarterlyBasicEPS`, `quarterlyDilutedAverageShares`, `annualDilutedEPS`, `trailingDilutedEPS`, `trailingDilutedAverageShares` (sin crumb, mismo endpoint, 0 llamadas extra).
- Arreglar `fetchYahooQuote` con crumb o retirarlo (todo su contenido ya llega por `quoteSummary`).
- Plan B para semestrales: ofrecer YoY anual y TTM cuando no hay ≥6 trimestres; etiquetar «informa semestralmente».
- FMP/ESEF/J-Quants: no hacen falta en esta fase (**[S]**: FMP está configurado en el Mini pero no he medido su plan ni su cuota; US ya fusiona SEC).

**Almacenamiento:** reutilizar `fundamental_snapshots` (ya tiene `provider`, `period_type`, `period_end`, `updated_at`). Propongo `period_type` nuevos (`quarterly`, `annual`, `ttm`) con las series normalizadas en `metrics`, en vez de una tabla nueva; migración SQL solo si hace falta un índice por `(symbol, period_type, period_end)` (ya hay uno de unicidad parcial). El `raw` se conserva. Una tabla `company_fundamentals_latest` compacta (una fila por símbolo, columnas escalares) sería opcional para que las filas del escaneo/cards lean sin parsear jsonb.

**Cadencia y coste:** estados trimestrales — un barrido por trimestre y reintento al detectar `nextEarnings` pasado (~11.400 símbolos × 1 llamada de serie temporal + 1 quoteSummary ≈ 23.000 llamadas, repartidas en ~5 noches con 429 controlado); ratios/precio diarios solo para la cesta visible (favoritos + lista de escaneo ≈ 3.500 US + HK líquidos ≈ 760).

## 6. Pendiente de verificar

- Cuota y cadencia real de los lanzadores del Mini para fundamentales.
- Muestra amplia (más de 30) por tipo de instrumento para separar «no es acción» de «Yahoo no lo da».
- Confirmar con el usuario qué tarjeta exacta ve vacía en el escaneo (no he podido ver su pantalla).
