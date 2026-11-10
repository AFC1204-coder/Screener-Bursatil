-- Limpieza puntual D5 (auditoría de producto 2026-11) — daily_bars
--
-- NO SE HA EJECUTADO. Revisar y lanzar a mano. Por defecto termina en
-- ROLLBACK: no borra nada hasta que se cambie la última línea a COMMIT.
--
--   psql -h 127.0.0.1 -p 55432 -U postgres -d statsedge_local -X -f limpieza.sql
--
-- Qué borra (medido en solo lectura sobre la copia local el 2026-11-07):
--
--   A. 107 filas de acciones US (símbolos sin «.», «^» ni «=») fechadas en
--      días SIN sesión NYSE: festivos calculados con lib/marketCalendar.js
--      (2021-2026, incluye el 2025-05-26 y el 2025-06-19 que la lista a mano
--      de scripts/a4 no tenía) y fines de semana.
--        · 101 en festivos: 20 símbolos × 5 festivos (2025-05-26, 2025-09-01,
--          2026-01-19, 2026-02-16, 2026-05-25) + JPM 2025-09-01.
--        · 6 en fin de semana (AAPL, JPM, WELL 2026-03-01; MSFT, TXN, WELL
--          2025-06-01): barras mensuales sueltas del día 1, el agujero ya
--          documentado en lib/dailyBarsCache.js (guard de volumen).
--      Las «294» del informe incluían 213 filas de índices extranjeros
--      (^N225, ^FTSE…) y divisas (EURUSD=X…) cuyos mercados SÍ abrieron esos
--      días: no son basura y NO se tocan aquí.
--   B. 18 filas «pico de una barra» de scripts/a3 (nocturno US del 18-oct),
--      lista explícita. SNOW 2026-05-25 está también en A.
--
--   Total: 124 filas distintas (107 + 18 − 1).
--
-- Por qué es seguro borrar también los picos que podrían ser reales (MGRT,
-- DMRA, TJGC…): el delta de writeDailyBarsCache escribe cualquier fecha del
-- payload que falte en la caché, así que una barra real borrada vuelve en el
-- siguiente refresco del símbolo (refresh-bars, --stale-days=1). Las de
-- festivo no vuelven porque el proveedor ya no las devuelve (por eso
-- seguían ahí: el upsert nunca borraba). Las de VEEA/KITT que vuelvan sin
-- ajustar las descarta ya el guard de escala (×5 / ×10).
--
-- Después de lanzarlo con COMMIT: node scripts/ops/data-health-check.mjs
-- debería dar a4 = 0 y a3 = 0 (salvo picos nuevos).

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE d4d5_limpieza ON COMMIT DROP AS
WITH nyse_festivos(d) AS (VALUES
  (DATE '2021-01-01'), (DATE '2021-01-18'), (DATE '2021-02-15'), (DATE '2021-04-02'), (DATE '2021-05-31'),
  (DATE '2021-07-05'), (DATE '2021-09-06'), (DATE '2021-11-25'), (DATE '2021-12-24'),
  (DATE '2022-01-17'), (DATE '2022-02-21'), (DATE '2022-04-15'), (DATE '2022-05-30'), (DATE '2022-06-20'),
  (DATE '2022-07-04'), (DATE '2022-09-05'), (DATE '2022-11-24'), (DATE '2022-12-26'),
  (DATE '2023-01-02'), (DATE '2023-01-16'), (DATE '2023-02-20'), (DATE '2023-04-07'), (DATE '2023-05-29'),
  (DATE '2023-06-19'), (DATE '2023-07-04'), (DATE '2023-09-04'), (DATE '2023-11-23'), (DATE '2023-12-25'),
  (DATE '2024-01-01'), (DATE '2024-01-15'), (DATE '2024-02-19'), (DATE '2024-03-29'), (DATE '2024-05-27'),
  (DATE '2024-06-19'), (DATE '2024-07-04'), (DATE '2024-09-02'), (DATE '2024-11-28'), (DATE '2024-12-25'),
  (DATE '2025-01-01'), (DATE '2025-01-09'), (DATE '2025-01-20'), (DATE '2025-02-17'), (DATE '2025-04-18'),
  (DATE '2025-05-26'), (DATE '2025-06-19'), (DATE '2025-07-04'), (DATE '2025-09-01'), (DATE '2025-11-27'),
  (DATE '2025-12-25'),
  (DATE '2026-01-01'), (DATE '2026-01-19'), (DATE '2026-02-16'), (DATE '2026-04-03'), (DATE '2026-05-25'),
  (DATE '2026-06-19'), (DATE '2026-07-03'), (DATE '2026-09-07'), (DATE '2026-11-26'), (DATE '2026-12-25')
),
picos(symbol, trade_date) AS (VALUES
  ('VEEA', DATE '2026-08-26'), ('VEEA', DATE '2026-08-11'), ('VEEA', DATE '2026-06-29'), ('BXBL', DATE '2026-06-22'),
  ('SNOW', DATE '2026-05-25'), ('KITT', DATE '2026-03-10'), ('VEEA', DATE '2026-02-27'), ('MGRT', DATE '2026-02-12'),
  ('DXST', DATE '2026-02-11'), ('MGRT', DATE '2025-12-17'), ('PRLD', DATE '2025-11-03'), ('KITT', DATE '2025-10-27'),
  ('DMRA', DATE '2025-10-07'), ('NUAI', DATE '2025-09-11'), ('YDES', DATE '2025-08-28'), ('VEEA', DATE '2025-08-14'),
  ('MAAS', DATE '2025-06-23'), ('TJGC', DATE '2025-06-03')
),
candidatas AS (
  SELECT 'A_sin_sesion_nyse'::text AS motivo, d.owner_id, d.symbol, d.trade_date, d.provider
  FROM daily_bars d
  WHERE d.symbol !~ '[.^=]'
    AND (d.trade_date IN (SELECT f.d FROM nyse_festivos f) OR extract(isodow FROM d.trade_date) IN (6, 7))
  UNION ALL
  SELECT 'B_pico_una_barra', d.owner_id, d.symbol, d.trade_date, d.provider
  FROM daily_bars d JOIN picos p USING (symbol, trade_date)
)
SELECT string_agg(DISTINCT motivo, '+' ORDER BY motivo) AS motivo, owner_id, symbol, trade_date, provider
FROM candidatas
GROUP BY owner_id, symbol, trade_date, provider;

-- ── SELECT previo: exactamente lo que se borraría ───────────────────────
SELECT l.motivo, d.symbol, d.trade_date, d.open, d.high, d.low, d.close, d.volume, d.provider, d.updated_at
FROM d4d5_limpieza l
JOIN daily_bars d USING (owner_id, symbol, trade_date, provider)
ORDER BY l.motivo, d.trade_date, d.symbol;

SELECT motivo, count(*) AS filas FROM d4d5_limpieza GROUP BY ROLLUP (motivo) ORDER BY motivo;
-- Esperado (copia local, 2026-11-07): A 106 · A+B 1 · B 17 · total 124.

-- ── Borrado ─────────────────────────────────────────────────────────────
DELETE FROM daily_bars d
USING d4d5_limpieza l
WHERE d.owner_id = l.owner_id
  AND d.symbol = l.symbol
  AND d.trade_date = l.trade_date
  AND d.provider = l.provider;
-- psql imprime «DELETE n»: debe coincidir con el total de arriba.

-- Cambiar a COMMIT solo tras revisar el SELECT previo.
ROLLBACK;
