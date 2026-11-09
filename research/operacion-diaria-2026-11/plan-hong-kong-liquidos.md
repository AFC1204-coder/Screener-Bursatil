# Plan: Hong Kong solo con valores líquidos (2026-11-08)

Decisión del usuario: cobertura HK = **solo líquidos**, no el universo completo.

## Estado verificado (solo lectura, Mini)
- Universo HK `passed=true`: 2.764 símbolos. 1.782 tienen como última barra el 10-ago (carga masiva de agosto, nada las refresca).
- Los scans HK salen del cron rotativo `scan-refresh` (22:20 CET, grupo por noche, ~84 símbolos por mercado con cursor `o84/o168/o252`): HK aparece cada 3-4 semanas con 73-76 filas. En 40 días solo 147 símbolos HK han entrado en algún scan.
- `rs-intl-bars.mjs` cubre solo los 76 HK curados del RS global (74/76 con ≥261 barras): no es la causa.
- `scripts/scan-universe.mjs` está fijado a `market=eq.US`; HK necesita otra vía. Archivos fuera de límite para el agente: `scan-universe.mjs`, `run-scan-universe-us.sh`.

## Liquidez medida (mediana diaria de cierre×volumen, desde 2026-06-01, ≥20 sesiones; 2.314 símbolos con datos)
| Corte (HKD/día) | Símbolos |
|---|---|
| ≥ 1 M | 980 |
| ≥ 3 M | 831 |
| **≥ 5 M** | **760** |
| ≥ 10 M | 655 |
| ≥ 20 M | 519 |
| ≥ 50 M | 340 |

Recomendación: **5 M HKD/día** (~760 valores, ≈ 640.000 USD/día; suficiente para swing semanal sin ruido). Para algo más estricto, 10 M (655). Los 76 curados del RS global entran siempre, aunque no lleguen al corte.
Aviso: la medición usa barras de junio a agosto en la mayoría de los símbolos; hay que rehacerla con barras frescas tras la carga.

## Diseño propuesto
1. **Lista líquida HK**: script de solo lectura que calcula la mediana de turnover (60 sesiones) y escribe `logs/hk-liquid-universe.json` (símbolos, corte, fecha). Se recalcula semanalmente, no cada noche.
2. **Barras HK**: cargar ~760 símbolos con la misma vía que `refresh-bars.mjs` (adaptada a `market=HK`), ~290.000 filas la primera vez. Backup previo de `daily_bars` como en la Fase B.
3. **Scan HK propio**: nuevo `scripts/scan-universe-hk.mjs` (sin tocar el de US) que escanea esa lista y escribe `materialized:HK:<fecha>`. Hay que mirar si el scan de ~760 cabe en el límite de 120 s del cron actual; si no, va fuera del cron, como el de US.
4. **Disparo**: HK cierra a las 09:00 CET (+30 min de asentamiento). Un job a las ~10:00 CET, con el mismo patrón de guardián (estado ok/degraded/fail + aviso).
5. Retirar a HK del grupo rotativo de `scan-refresh` para no duplicar y evitar que el lote de 84 pise la lista líquida.
6. Medir la frescura con `bars-freshness.mjs --market HK`: hoy la consulta usa el snapshot; habría que filtrar por la lista líquida y por el calendario de HK (`marketCalendar.js` ya trae sus horarios).

## Riesgos y decisiones abiertas
- El corte de liquidez cambia qué ve el usuario; conviene mostrar en la ficha «fuera del universo líquido» cuando se busque un HK excluido.
- `baseRejectReason` ya aplica filtros de turnover/market cap a HK/CA (INT-3c): comprobar que no se contradice con el corte nuevo.
- El RS global/país (scripts `rs-*`) no se toca; el domingo lo lanza el usuario.

## Estado (2026-11-08, noche) — construido, sin ejecutar escrituras en el Mini

Corte fijado por el usuario: **5 M HKD/día** → lista de **766** símbolos (760 líquidos + curados; `logs/hk-liquid-universe.json` en el Mini).

Piezas (todas con tests; suite 318 archivos / 3.652 tests en verde):
- `scripts/ops/hk-liquid-universe.mjs` — lista líquida (solo lectura sobre la base).
- `scripts/refresh-bars-hk.mjs` — barras de la lista (tope 600.000 filas; exit 2 = tope, 3 = demasiados fallos).
- `scripts/scan-universe-hk.mjs` — scan HK con Vitest como `scan-universe.mjs`, sin retención; con `--limit` escribe con prefijo `test:`.
- `scripts/ops/nightly-hk-guard.sh` — guardián (lista → barras → frescura → scan → estado ok/degraded/fail + aviso). 
- `scripts/ops/bars-freshness.mjs --market HK --list …` — frescura sobre la lista.
- `scripts/ops/launchd/com.statsedge.nightly-hk.plist` — plantilla a las 10:15, **no instalada**.

Verificado:
- Mini: los scripts copiados; `--dry-run` de barras y scan OK; frescura HK real **0 % de 766** al día (todo atrasado), US 95,1 %.
- Copia local (:55432): `scan-universe-hk.mjs --write --limit=10` → 10 filas, `local_id=test:materialized:HK:…:o0:l10`, 1,5 s de escaneo (⇒ ~2 min para 766).

NO verificado: carga real de barras HK (`--write`), scan HK completo contra la base del Mini, que el producto muestre el scan HK nuevo en lugar de los de 73 filas, y el comportamiento en festivos de HK (el calendario solo conoce fines de semana).

Pendiente de decisión del usuario: ejecutar la carga y el primer scan HK en el Mini (con copia previa de `daily_bars`), instalar el plist, retirar HK del grupo rotativo de `scan-refresh`.

## Ejecución en el Mini (2026-11-08, 01:08–01:20 CET)

1. Copia previa: `~/statsedge-backups/2026-11-08/daily_bars-2026-11-08-pre-HK.dump` (243 MB, verificada).
2. `refresh-bars-hk.mjs --write --limit=20`: 7.114 filas, barras diarias correctas. Luego completo: **765/766 refrescados**, 272.229 filas en 24,6 s; fallido `0011.HK` (Yahoo 404). Frescura HK: **0 % → 99,9 %** (765/766). Sin barras en fin de semana; 2 picos de una barra desde septiembre.
3. `scan-universe-hk.mjs --write`: `materialized:HK:2026-11-08:t001230:o0:l766`, **665 filas** (8 completas, 657 ligeras) en 39 s. Rechazados 101 (en su mayoría IPO recientes con <180 barras, precio bajo, importe medio 0). Antes eran 73-76 filas por escaneo.
4. La web de producción del Mini (código antiguo) ya sirve el HK acumulado con 729 filas (`anchor=markets&markets=HK`).

Hallazgo: solo **8** de 665 pasan el preset «balanced». Hipótesis (sin verificar): el RS global/país solo cubre los 76 HK curados, así que el resto no tiene RS y el preset los descarta. El RS lo lanza el usuario (`rs-*`).

Sin instalar: el job de las 10:15 (`com.statsedge.nightly-hk.plist`). Sin hacer: retirar HK del grupo rotativo de `scan-refresh`.
