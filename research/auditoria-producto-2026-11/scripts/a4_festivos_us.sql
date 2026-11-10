-- A4. Barras de símbolos US (sin sufijo) en festivos NYSE y fines de semana
with fest(d) as (values ('2025-07-04'::date),('2025-09-01'),('2025-11-27'),('2025-12-25'),('2026-01-01'),('2026-01-19'),('2026-02-16'),('2026-04-03'),('2026-05-25'),('2026-06-19'),('2026-07-03'),('2026-09-07'))
select d.trade_date, count(*) filas, count(distinct d.symbol) simbolos, min(d.updated_at)::date, max(d.updated_at)::date
from daily_bars d join fest f on f.d=d.trade_date where d.symbol !~ '\.' group by 1 order by 1;
\echo '== fines de semana en US'
select extract(isodow from trade_date) dow, count(*), count(distinct symbol), min(trade_date), max(trade_date) from daily_bars where symbol !~ '\.' and extract(isodow from trade_date) in (6,7) and trade_date>='2025-06-01' group by 1;
\echo '== SNOW alrededor del 25-may'
select trade_date, open, high, low, close, volume, updated_at from daily_bars where symbol='SNOW' and trade_date between '2026-05-20' and '2026-05-28' order by 1;
