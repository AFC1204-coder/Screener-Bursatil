-- A9. SPAC y fondos cerrados: ¿qué dicen etapa, VCP y la cinta?
with r as (select r.symbol, r.company_name, r.industry, r.metrics m from scan_results r join scans s on s.id=r.scan_id where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613'),
t as (select *, case when company_name ~* 'acquisition corp' or industry ~* 'shell' then 'SPAC/shell'
                     when industry ~* 'asset management' and company_name ~* 'fund|trust|income|municipal|strategy|dividend|opportunit' then 'CEF'
                     else 'resto' end tipo from r)
select tipo, count(*),
  count(*) filter (where m->>'weeklyStageState'='stage2') stage2,
  count(*) filter (where (m->>'vcpCandidate')::boolean) vcp,
  count(*) filter (where (m->>'screenPassed')::boolean) pasan_nocturno,
  round(avg((m->>'maxDailyMove20dPct')::numeric),2) mov_diario_medio
from t group by 1;
\echo '== shell companies en stage2 con VCP'
with r as (select r.symbol, r.company_name, r.industry, r.metrics m from scan_results r join scans s on s.id=r.scan_id where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613')
select symbol, company_name, m->>'weeklyStageState' st, m->>'vcpCandidate' vcp, m->>'contraction1DepthPct' c1, m->>'lastContractionDepthPct' cl, m->>'price' p from r where industry ~* 'shell' and m->>'weeklyStageState'='stage2' limit 15;
