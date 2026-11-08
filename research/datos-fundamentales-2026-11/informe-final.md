# Datos fundamentales — informe final (2026-11-08)

Diagnóstico completo: `fase1-diagnostico.md`. Aquí, la fase 2.

## (a) Inventario campo → fuente
Ver §1 del diagnóstico. Fuente única Yahoo (`quoteSummary` + `fundamentals-timeseries`), SEC para EE. UU. en la ficha. Persistencia: `fundamental_snapshots` (ya existente).

## (b) Cobertura antes / después
| Medida | Antes (base del Mini) | Después |
|---|---|---|
| BPA trimestral en filas guardadas | 0 % (US, HK, EU) | **No medible hasta refrescar la base** (requiere escritura, pendiente de permiso) |
| BPA con el código nuevo, prueba en vivo (**[V]** 5 símbolos) | — | AAPL 4/5 trimestres, SHEL.L 4/5, SBUX 4/5, RDDT 5/5; anual 3-4/4; 0425.HK anual 4/4 |
| Franja de crecimiento utilizable con serie solo-Yahoo | trimestral 1,4 % US · 1,6 % HK · 2,8 % EU | con alternativa anual: **5/5 símbolos de prueba** (incl. 0425.HK, que no tiene trimestres) |
| `quote` v7 | 401 en el 100 % | **[V]** 200 con crumb (AAPL, 0425.HK); sin crumb sigue 401 |

El «después» sobre toda la base solo existirá tras el refresco (`scripts/refresh-fundamentals.mjs --write`), que NO he ejecutado.

## (c) Bloques mal expuestos y arreglo aplicado
| Id | Arreglo | Dónde |
|---|---|---|
| E1 dividendo 0 vs vacío | «No paga dividendo» / «Sin dato de Yahoo» | `lib/fundamentalsDisplay.js` → `FundamentalSnapshot` |
| E3 ROE/D-E con patrimonio negativo | «Patrimonio negativo» | id. |
| E4 margen 0 sin ingresos | «Sin ingresos informados» | id. |
| E7 unidad D/E | Yahoo da D/E en %; ahora se pinta como ×(valor/100) | `StockClient.jsx` |
| P/E fwd ausente por pérdidas | «No aplica: pérdidas» | id. |
| E2 crecimiento absurdo (>±500 %) | `growthDisplay` creado y probado, **aún no conectado** a la tabla de resultados | pendiente |
| E8 «Sin dato» sin motivo | resuelto solo en `FundamentalSnapshot` y en la tarjeta de identidad; el resto de la ficha sigue igual | parcial |
| E5/E6 fondos e instrumentos sin ficha | no abordado | pendiente |
| Franja trimestral vacía | alternativa anual + motivo («informa semestralmente…», «Yahoo solo entrega N trimestres…») | `lib/chartIdentityCard.js`, `ChartIdentityCard.jsx`, `styles/stock.css` |

## Cambios de interfaz (aún no desplegados)
1. Ficha → tabla de fundamentales: Div. yield, márgenes, ROE, Deuda/Equity y P/E fwd muestran texto con motivo en vez de «Sin dato»/0 %. Deuda/Equity pasa a pintarse como ratio ×.
2. Tarjeta de identidad del gráfico: si no hay 6 trimestres, muestra «Crecimiento anual · % interanual» con una nota con el motivo, en vez de la ausencia genérica.

## Cambios de código
- `lib/yahoo.js`: pide `quarterly/annual DilutedEPS, BasicEPS, DilutedAverageShares` y `trailingDilutedEPS`; vuelca BPA y acciones diluidas a las filas; `fetchYahooQuote` usa crumb+cookie (reintenta limpiando la sesión en 401/403).
- `lib/fundamentalsDisplay.js` (nuevo), `lib/chartIdentityCard.js`, `app/stock/[symbol]/{StockClient,ChartIdentityCard}.jsx`, `styles/stock.css`.
- `scripts/refresh-fundamentals.mjs` (nuevo; dry-run por defecto, `--write`, tope 500, códigos 0/1/2/3).
- `propuesta-indice-fundamentales.sql` (no ejecutado).
- Nota: `lib/yahoo.js` y `StockClient.jsx` ya tenían cambios sin commit de otros trabajos; los míos son aditivos y no se han comiteado.

## (d) Tests
`tests/fundamentalsDisplay.test.js` (13 con `refreshFundamentals.test.js`), más `descriptiveStrip`, `companyBrief*`: pasan. Suite completa: 3717 pasan; fallos ajenos a este cambio: `tests/longHistory.test.js` (trabajo de otra sesión) y un test de rendimiento de ruta fría de IPO que falló una vez y pasó otra (flaky).

## (e) Sin verificar
- Verificación visual en navegador de los dos cambios de interfaz (no la he hecho; AGENTS.md la exige antes de comitear).
- Cobertura «después» sobre la base completa (requiere `--write`).
- Que `withProfileCache` + `fetchYahooProfile` persistan realmente los nuevos campos de BPA en `fundamental_snapshots` (el flujo es el existente, pero no lo he probado contra la base).
- Si el cache de fichas (`BRIEF_CACHE_VERSION = 6`) debe subirse a 7 para que las fichas ya cacheadas recojan el BPA; no lo he tocado.
- Límite de tasa de Yahoo en un barrido masivo (429).
- Cadencia real de los lanzadores del Mini; E2, E5, E6 y el resto de «Sin dato» de la ficha.

---

## Piloto de 50 símbolos (autorizado por el usuario, 2026-11-08)

Ejecución real con `--write` desde una copia aislada en el Mini (`~/pilot-fundamentales`, código nuevo; `~/statsedge-staging` y la web no se tocaron; la copia de `.env.local` se borró al terminar). 17 US, 17 HK, 16 EU (capitalización >300 M, con resumen), elegidos por hash. 50/50 escritos, 0 fallos. Filas `profile` en `fundamental_snapshots`: 57.321 → 57.367 (+46; 4 se reemplazaron en la misma fecha). Nada más se escribió.

Último perfil de esos 50 símbolos, antes → después (**[V]**, consulta en el Mini):

| Mercado | n | Perfil con error de proveedor | BPA trimestral | BPA anual | ≥6 trimestres | ≥3 años |
|---|---|---|---|---|---|---|
| US | 17 | 17 → **0** | 0 → **17** | 0 → **17** | 0 → 0 | 16 → 16 |
| EU | 16 | 16 → **0** | 0 → **11** | 0 → **16** | 0 → 0 | 16 → 16 |
| HK | 17 | 17 → **0** | 0 → **1** | 0 → **17** | 0 → 0 | 17 → 17 |

Lectura: el error 401 de cotización desaparece del 100 % y el BPA llega a todos los US y al 69 % de EU; en HK el BPA trimestral sigue casi vacío (informa semestralmente, estructural) pero el anual llega al 100 %. Ningún símbolo llega a 6 trimestres porque Yahoo entrega ~5: la franja depende de la alternativa anual (3 años o más en 49/50).

Hallazgo corregido durante el piloto: `runLoop` marcaba «parada por tope» cuando el tope coincidía con el total; arreglado y con test.

Sigue sin verificar: la web del Mini aún corre código antiguo, así que la ficha no muestra todavía el BPA nuevo; `BRIEF_CACHE_VERSION` sin subir; no he medido un barrido mayor (429). Un barrido completo (~11.400 símbolos) son ~23.000 llamadas: propongo tandas de 500–1.000 por noche, y solo si lo autorizas.


---

## Verificación en navegador (instancia aislada :3300, 2026-11-08)

Copia del árbol en el scratchpad, `next dev --webpack`, datos reales; tras terminar se apagó por PID y se borró la copia (incluido su `.env.local`). El :3320 del usuario no se tocó (quedó con 500 por el disco lleno; pendiente de que lo reinicie).

- **0425.HK y 1712.HK (HK semestral):** tarjeta «Crecimiento anual · % interanual», 4 columnas alineadas y nota «Informa semestralmente…». **Bug encontrado y corregido:** la rejilla tenía 6 columnas fijas (`--growth-cols`).
- **SBUX:** «Patrimonio negativo» en ROE y Deuda/Equity. **Bug encontrado y corregido:** sin patrimonio en el balance el ROE salía −31,2 %; ahora se infiere de ROE<0 con margen neto >0 (con test).
- **1712.HK:** «No paga dividendo», «P/E fwd Sin dato de Yahoo», Short Float «Sin dato de Yahoo para este mercado», Deuda/Equity 0,00x.
- Consola: solo `ERR_NAME_NOT_RESOLVED` de recursos externos, ajenos al cambio. eslint limpio en los archivos tocados; 11 tests de `fundamentalsDisplay` pasan.
- No verificado: caso «P/E fwd: No aplica: pérdidas» ni la tarjeta trimestral de un valor US con 6 trimestres (SEC); ficha con el BPA nuevo desde la base (la web del Mini sigue con código antiguo).
