-- A13. «Líderes Etapa 2»: filas en etapa 2 semanal lejos del máximo de 52 semanas o sin RS alto
with r as (select r.symbol, r.metrics m from scan_results r join scans s on s.id=r.scan_id where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613')
select count(*) filter (where m->>'weeklyStageState'='stage2') e2,
 count(*) filter (where m->>'weeklyStageState'='stage2' and (m->>'distance52w')::numeric < -25) e2_a_mas_25pct_max,
 count(*) filter (where m->>'weeklyStageState'='stage2' and (m->>'distance52w')::numeric < -40) e2_a_mas_40pct_max,
 count(*) filter (where m->>'weeklyStageState'='stage2' and (m->>'weeklyStageWeek')::int <= 2) e2_sem_1_2
from r;
