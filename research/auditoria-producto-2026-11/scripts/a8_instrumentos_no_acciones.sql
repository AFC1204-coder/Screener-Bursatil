-- A8. Instrumentos que no son acciones ordinarias dentro del nocturno US
with r as (select r.symbol, r.company_name, r.sector, r.industry from scan_results r join scans s on s.id=r.scan_id where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613')
select case
  when company_name ~* 'preferred|pfd|perpetual|depositary shares? each|% ' then 'preferente'
  when company_name ~* 'warrant' then 'warrant'
  when company_name ~* '\munits?\M' then 'unidades'
  when company_name ~* '\mnotes?\M|debenture|bond' then 'deuda'
  when company_name ~* '\metf\M|\mfund\M|trust$|ishares|spdr|proshares' then 'fondo/ETF'
  when company_name ~* 'acquisition corp' then 'SPAC'
  else null end tipo, count(*), string_agg(symbol, ', ' order by symbol)
from r group by 1 having case when true then true end order by 2 desc;
