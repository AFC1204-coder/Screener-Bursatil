-- A6. Barras US guardadas ANTES del cierre de su sesión (16:00 America/New_York) = vela intradía parcial persistida
select count(*) filas, count(distinct symbol) simbolos, min(trade_date), max(trade_date)
from daily_bars where symbol !~ '[.^=]' and trade_date>='2025-06-01'
  and updated_at < ((trade_date::timestamp + time '16:00') at time zone 'America/New_York');
\echo '== por fecha (últimas)'
select trade_date, count(*), min(updated_at at time zone 'America/New_York') primera_escritura_ny, max(updated_at at time zone 'America/New_York')
from daily_bars where symbol !~ '[.^=]' and trade_date>='2025-06-01'
  and updated_at < ((trade_date::timestamp + time '16:00') at time zone 'America/New_York')
group by 1 order by 1 desc limit 15;
\echo '== KRT'
select trade_date, open, high, low, close, volume, updated_at at time zone 'America/New_York' ny from daily_bars where symbol='KRT' and trade_date>='2026-11-02' order by 1;
\echo '== volumen de la barra parcial frente a la mediana de sus 10 vecinas (si <0,6 → volumen truncado)'
with p as (select symbol, trade_date, volume from daily_bars where symbol !~ '[.^=]' and trade_date>='2025-06-01'
  and updated_at < ((trade_date::timestamp + time '16:00') at time zone 'America/New_York')),
n as (select p.symbol, p.trade_date, p.volume, percentile_cont(0.5) within group (order by d.volume) med
      from p join daily_bars d on d.symbol=p.symbol and d.trade_date between p.trade_date-10 and p.trade_date+10 and d.trade_date<>p.trade_date group by 1,2,3)
select trade_date, count(*), round(percentile_cont(0.5) within group (order by volume/nullif(med,0))::numeric,2) mediana_ratio_vol,
 count(*) filter (where volume/nullif(med,0)<0.6) truncadas from n group by 1 order by 1;
