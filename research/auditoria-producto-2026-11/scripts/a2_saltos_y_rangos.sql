-- A2. Saltos >40 % en un día y cierres fuera del rango H-L, sobre los símbolos del nocturno US 18-oct
with u as (select r.symbol from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613'),
b as (select d.symbol, d.trade_date, d.close, d.adj_close, d.high, d.low, d.volume,
        lag(d.close) over (partition by d.symbol order by d.trade_date) pc,
        lag(d.adj_close) over (partition by d.symbol order by d.trade_date) pac,
        lag(d.trade_date) over (partition by d.symbol order by d.trade_date) pd
      from daily_bars d join u using(symbol) where d.trade_date>='2025-06-01')
select 'saltos_close_gt40' k, count(*), count(distinct symbol) from b where pc>0 and abs(close/pc-1)>0.40
union all select 'saltos_adj_gt40', count(*), count(distinct symbol) from b where pac>0 and abs(adj_close/pac-1)>0.40
union all select 'saltos_close_gt40_pero_adj_lt15 (split no ajustado en close)', count(*), count(distinct symbol) from b where pc>0 and abs(close/pc-1)>0.40 and pac>0 and abs(adj_close/pac-1)<0.15
union all select 'close_fuera_HL', count(*), count(distinct symbol) from b where close>high*1.0001 or close<low*0.9999
union all select 'vol0', count(*), count(distinct symbol) from b where volume=0;
\echo '== muestra de saltos >40% (close) con fecha'
with u as (select r.symbol from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613'),
b as (select d.symbol, d.trade_date, d.close, d.adj_close,
        lag(d.close) over (partition by d.symbol order by d.trade_date) pc,
        lag(d.adj_close) over (partition by d.symbol order by d.trade_date) pac
      from daily_bars d join u using(symbol) where d.trade_date>='2025-06-01')
select symbol, trade_date, round(pc,3) prev, round(close,3) close, round(100*(close/pc-1),1) pct_close, round(100*(adj_close/pac-1),1) pct_adj
from b where pc>0 and abs(close/pc-1)>0.40 order by abs(close/pc-1) desc limit 30;
\echo '== cierre fuera de H-L: muestra'
with u as (select r.symbol from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613')
select d.symbol, d.trade_date, d.open, d.high, d.low, d.close, d.adj_close, d.volume, d.provider, d.updated_at::date
from daily_bars d join u using(symbol) where d.trade_date>='2025-06-01' and (d.close>d.high*1.0001 or d.close<d.low*0.9999) order by d.trade_date desc limit 15;
