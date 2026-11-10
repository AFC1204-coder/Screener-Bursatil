-- A3. Picos de una sola barra (sube >40 % y al día siguiente vuelve >30 %) = dato erróneo probable
with u as (select r.symbol, r.metrics m from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613'),
b as (select d.symbol, d.trade_date, d.close, d.volume,
        lag(d.close) over w pc, lead(d.close) over w nc
      from daily_bars d join u using(symbol) where d.trade_date>='2025-06-01' window w as (partition by d.symbol order by d.trade_date))
select b.symbol, b.trade_date, round(pc,3) prev, round(close,3) close, round(nc,3) next, b.volume,
  u.m->>'weeklyStageState' etapa, u.m->>'distanceFrom52wHighPct' dist52
from b join u using(symbol)
where pc>0 and nc>0 and ((close/pc>1.4 and nc/close<0.7) or (close/pc<0.6 and nc/close>1.6))
order by trade_date desc limit 40;
