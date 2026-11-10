-- A12. Tamaño de los grupos por subsector (industria) en el nocturno US: muestras minúsculas que se presentan como «grupo»
with r as (select r.industry, r.metrics m from scan_results r join scans s on s.id=r.scan_id where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613')
select case when n<3 then '1-2' when n<5 then '3-4' when n<10 then '5-9' when n<20 then '10-19' else '20+' end tramo, count(*) industrias, sum(n) valores
from (select industry, count(*) n from r group by 1) x group by 1 order by min(n);
\echo '== RS tema: tamaño de muestra por tema (último snapshot -v1 de cada tema)'
select engine_version, snapshot_date, symbol_count from (select distinct on (engine_version) engine_version, snapshot_date, symbol_count from rs_weekly_snapshots where engine_version ilike '%theme%' order by engine_version, snapshot_date desc) x order by symbol_count;
\echo '== motores RS y última fecha'
select engine_version, count(*) snapshots, max(snapshot_date), max(symbol_count) from rs_weekly_snapshots group by 1 order by 3 desc limit 12;
\echo '== RS país: tamaño de muestra del último snapshot de cada país'
select regexp_replace(engine_version,'statsedge-private-country-rs-local-|-v1','','g') pais, max(snapshot_date) ult, (array_agg(symbol_count order by snapshot_date desc))[1] n, min_sample
from rs_weekly_snapshots where engine_version like 'statsedge-private-country%' group by engine_version, min_sample order by n;
