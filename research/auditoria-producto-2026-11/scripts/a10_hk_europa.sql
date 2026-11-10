-- A10. Hong Kong y Europa: divisa, fechas, volumen 0 y duplicados con ADR de EE. UU.
\echo '== último scan por mercado foco (HK y europeos): divisa, lastDate, volumen 0 en 20 sesiones'
with s as (select distinct on (split_part(local_id,':',2)) id, local_id from scans where local_id ~ '^materialized:(HK|GB|DE|FR|ES|IT|CH|NL|SE|DK|NO):' and row_count>0 order by split_part(local_id,':',2), created_at desc)
select split_part(s.local_id,':',2) mk, s.local_id, count(*) filas,
  string_agg(distinct coalesce(r.metrics->>'currency', r.raw->>'currency', '?'), ',') divisas,
  min(r.metrics->>'lastDate') ld_min, max(r.metrics->>'lastDate') ld_max,
  count(*) filter (where (r.metrics->>'avgVolume')::numeric < 1) vol_medio_cero,
  count(*) filter (where r.metrics->>'weeklyStageState'='stage2') stage2
from s join scan_results r on r.scan_id=s.id group by 1,2 order by 1;
\echo '== HK: % de barras con volumen 0 en los últimos 60 días por símbolo del scan (top)'
with s as (select id from scans where local_id ~ '^materialized:HK:' and row_count>0 order by created_at desc limit 1),
u as (select r.symbol from scan_results r join s on s.id=r.scan_id)
select d.symbol, count(*) barras, count(*) filter (where volume=0) vol0 from daily_bars d join u using(symbol)
where trade_date>='2026-08-01' group by 1 having count(*) filter (where volume=0)>0 order by 3 desc limit 10;
