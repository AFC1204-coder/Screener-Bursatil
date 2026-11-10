-- A7. Misma empresa dos veces en el nocturno US (clases de acciones) y entre mercados (ADR frente a local)
with r as (select r.symbol, r.company_name, r.metrics->>'weeklyStageState' st from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613'),
k as (select symbol, company_name, st, regexp_replace(lower(company_name), '[^a-z0-9]+|class [a-z]|inc|corp|corporation|ltd|plc|holdings?|co$|the|sa$|nv$|ag$|adr|ads|company|limited|group','','g') key from r)
select key, count(*), string_agg(symbol||' ('||coalesce(st,'?')||')', ', ' order by symbol) from k group by key having count(*)>1 order by 2 desc, 1 limit 30;
\echo '== cuántas filas hay en pares/grupos duplicados'
with r as (select r.symbol, r.company_name from scan_results r join scans s on s.id=r.scan_id where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613'),
k as (select symbol, regexp_replace(lower(company_name), '[^a-z0-9]+|class [a-z]|inc|corp|corporation|ltd|plc|holdings?|co$|the|sa$|nv$|ag$|adr|ads|company|limited|group','','g') key from r)
select count(*) grupos, sum(n) filas from (select key, count(*) n from k group by key having count(*)>1) x;
