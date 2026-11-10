-- PROPUESTA — NO aplicada. Revisar y aplicar a mano en el Mini (base statsedge).
--
-- Capa de histórico LARGO por símbolo: máximo histórico verdadero, rendimientos
-- a 1/3/5/10 años y desde la salida a bolsa, caída máxima a 5 años, años
-- bajistas, posición/pendiente sobre la media de 200 semanas y regularidad
-- (R² de la tendencia log a 5 años). Calculado por scripts/long-history.mjs a
-- partir de barras semanales de Yahoo (period1=0&interval=1wk) con lib/longHistory.js.
--
-- Por qué tabla propia y no daily_bars: daily_bars guarda ~400 diarias y no debe
-- engordar con décadas de semanales (barras de otra cadencia contaminarían la
-- lectura diaria; ver lib/dailyBarsCache.js, nonDailyCadenceReason).
--
-- Tamaño esperado: ~7.000 símbolos × 1 fila por ejecución semanal ≈ 7.000
-- filas/semana (~364.000/año, < 100 MB). La retención se resuelve con el DELETE
-- comentado del final, a demanda.
--
-- Aditiva: no altera ni referencia con FK a ninguna tabla existente.

create table if not exists public.long_history_stats (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text not null,
  as_of date not null,                       -- fecha de la última barra semanal usada
  status text not null check (status in ('ok', 'short', 'stale', 'suspect', 'empty')),
  version text not null,                     -- LONG_HISTORY_VERSION
  provider text not null default 'Yahoo Finance',
  bar_interval text not null default '1wk',
  bar_count integer,
  first_bar_date date,
  last_bar_date date,
  history_years numeric,
  ath_value numeric,
  ath_date date,
  ath_distance_pct numeric,                  -- ≤ 0, respecto al máximo histórico verdadero
  ath_years_ago numeric,
  ret_1y numeric,
  ret_3y numeric,
  ret_5y numeric,
  ret_10y numeric,
  ret_since_ipo numeric,
  max_drawdown_5y numeric,                   -- ≤ 0
  down_years_10 smallint,                    -- nº de bloques de 52 sem. con retorno < 0 (de los cubiertos)
  covered_years_10 smallint,                 -- bloques realmente cubiertos por la serie (≤ 10)
  sma200w_pos_pct numeric,
  sma200w_slope_pct numeric,
  trend_slope_ann_pct_5y numeric,
  trend_r2_5y numeric,                       -- 0–1
  detail jsonb not null default '{}'::jsonb, -- motivo de stale/suspect
  computed_at timestamptz not null default now(),
  unique (owner_id, symbol, as_of)
);

create index if not exists long_history_stats_symbol_asof_idx
  on public.long_history_stats (owner_id, symbol, as_of desc);

-- Una fila por símbolo: la última estadística UTILIZABLE (ok/short). Las filas
-- stale/suspect quedan en la tabla como rastro, pero no pisan a una buena previa.
create or replace view public.long_history_latest as
  select distinct on (owner_id, symbol) *
  from public.long_history_stats
  where status in ('ok', 'short')
  order by owner_id, symbol, as_of desc;

alter table public.long_history_stats enable row level security;

-- Retención (a demanda, no automática): conservar 26 semanas.
-- delete from public.long_history_stats where as_of < (current_date - interval '182 days');
