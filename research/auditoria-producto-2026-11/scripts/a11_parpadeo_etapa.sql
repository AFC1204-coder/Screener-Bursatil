-- A11. ¿Cuánto «parpadea» la etapa SEMANAL entre nocturnos consecutivos? (una etapa semanal debería cambiar como mucho una vez por semana)
with s as (select id, local_id, created_at::date d, row_number() over (order by created_at) n from scans where local_id ~ '^materialized:US:2026-10-1[2-8]:' ),
r as (select s.n, s.d, r.symbol, r.metrics->>'weeklyStageState' st, r.metrics->>'lastDate' ld from scan_results r join s on s.id=r.scan_id)
select a.d desde, b.d hasta, min(a.ld) ld_a, min(b.ld) ld_b, count(*) pares,
  count(*) filter (where a.st is distinct from b.st) cambian,
  count(*) filter (where a.st='stage2' and b.st<>'stage2') salen_e2,
  count(*) filter (where a.st<>'stage2' and b.st='stage2') entran_e2
from r a join r b on b.symbol=a.symbol and b.n=a.n+1 group by 1,2 order by 1;
\echo '== símbolos que cambian de etapa 2 o más veces en la semana 12-18 oct'
with s as (select id, created_at from scans where local_id ~ '^materialized:US:2026-10-1[2-8]:'),
r as (select r.symbol, s.created_at, r.metrics->>'weeklyStageState' st from scan_results r join s on s.id=r.scan_id),
c as (select symbol, st, lag(st) over (partition by symbol order by created_at) pst from r)
select count(*) filter (where n>=2) simbolos_2mas, count(*) filter (where n>=3) simbolos_3mas from (select symbol, count(*) filter (where st is distinct from pst and pst is not null) n from c group by 1) x;
