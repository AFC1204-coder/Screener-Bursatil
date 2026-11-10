-- A5. distance52w guardada frente a recalculada desde daily_bars (252 barras hasta el 16-oct, precio = metrics.price)
-- y efecto de las barras fantasma (festivos NYSE / fines de semana) sobre el máximo de 52 semanas
with r as (select r.symbol, (r.metrics->>'price')::numeric p, (r.metrics->>'distance52w')::numeric d52, r.metrics->>'weeklyStageState' st
           from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613' and r.symbol !~ '\.'),
fest(d) as (values ('2025-07-04'::date),('2025-09-01'),('2025-11-27'),('2025-12-25'),('2026-01-01'),('2026-01-19'),('2026-02-16'),('2026-04-03'),('2026-05-25'),('2026-06-19'),('2026-07-03'),('2026-09-07')),
b as (select d.symbol, d.trade_date, d.high,
        (d.trade_date in (select d from fest) or extract(isodow from d.trade_date) in (6,7)) fantasma,
        row_number() over (partition by d.symbol order by d.trade_date desc) rn
      from daily_bars d join r using(symbol) where d.trade_date<='2026-10-16' and d.trade_date>='2025-08-01'),
h as (select symbol, max(high) filter (where rn<=252) h_all,
             max(high) filter (where rn<=252 and not fantasma) h_limpio,
             bool_or(fantasma and rn<=252) tiene_fantasma from b group by 1)
select count(*) filas,
  count(*) filter (where abs(d52 - 100*(p/h_all-1))>3) dif_gt3_vs_bars,
  count(*) filter (where tiene_fantasma) con_fantasma_en_ventana,
  count(*) filter (where h_all>h_limpio*1.02) fantasma_eleva_max_gt2pct,
  count(*) filter (where h_all>h_limpio*1.02 and st='stage2') de_ellas_stage2
from r join h using(symbol);
\echo '== símbolos donde una barra fantasma fija el máximo de 52s'
with r as (select r.symbol, (r.metrics->>'price')::numeric p, (r.metrics->>'distance52w')::numeric d52, r.metrics->>'weeklyStageState' st
           from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613' and r.symbol !~ '\.'),
fest(d) as (values ('2025-07-04'::date),('2025-09-01'),('2025-11-27'),('2025-12-25'),('2026-01-01'),('2026-01-19'),('2026-02-16'),('2026-04-03'),('2026-05-25'),('2026-06-19'),('2026-07-03'),('2026-09-07')),
b as (select d.symbol, d.trade_date, d.high,
        (d.trade_date in (select d from fest) or extract(isodow from d.trade_date) in (6,7)) fantasma,
        row_number() over (partition by d.symbol order by d.trade_date desc) rn
      from daily_bars d join r using(symbol) where d.trade_date<='2026-10-16' and d.trade_date>='2025-08-01'),
h as (select symbol, max(high) filter (where rn<=252) h_all, max(high) filter (where rn<=252 and not fantasma) h_limpio from b group by 1)
select symbol, st, round(d52,1) d52_guardada, round(100*(p/h_all-1),1) d52_bars, round(100*(p/h_limpio-1),1) d52_sin_fantasma
from r join h using(symbol) where h_all>h_limpio*1.02 order by st, symbol limit 30;
