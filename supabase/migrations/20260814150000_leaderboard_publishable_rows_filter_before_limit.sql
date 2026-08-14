-- Migration: 20260814150000_leaderboard_publishable_rows_filter_before_limit.sql
--
-- Corrige el orden de operaciones de leaderboard_publishable_rows
-- (20260710180000): la CTE `scoped` cogia las p_max_rows filas mas
-- recientes de scan_results de CUALQUIER escaneo y SOLO DESPUES descartaba
-- las que pertenecieran a un escaneo no publicable. Si el escaneo mas
-- reciente de toda la tabla fallaba y aportaba mas filas que p_max_rows, el
-- LIMIT se agotaba entero en filas que luego se descartaban y la funcion
-- nunca llegaba a mirar escaneos publicables mas antiguos, aunque
-- existieran de sobra dentro de la misma ventana p_since_days.
--
-- Diagnosticado en vivo el 2026-08-14
-- (docs/scan-vivo-filas-incompletas-2026-08-14.md, Parte 6): un escaneo
-- interactivo fallido con 1.194 filas (status "error", las mas recientes de
-- toda scan_results) hacia que GET /api/leaderboards devolviera 0
-- resultados con los parametros exactos que usa la vista previa cacheada
-- del screener, aunque hubiera escaneos publicables anteriores de sobra.
--
-- Fix: se separa en dos CTEs sobre la MISMA base (mismo join, mismo filtro
-- owner_id/created_at):
--   - `scoped`: sin limite de filas (solo acotada por la ventana temporal
--     p_since_days), preserva la contabilidad completa para
--     rowsRead/rowsExcluded.
--   - `publishable`: filtra PRIMERO por parent_status en (complete,
--     partial, done) y SOLO DESPUES ordena por created_at desc y aplica el
--     LIMIT p_max_rows. rows/rowsPublished salen de aqui. Un escaneo
--     fallido, por muchas filas que aporte, ya no puede agotar el LIMIT:
--     sus filas ni siquiera entran en esta CTE.
--
-- rowsRead pasa de "hasta p_max_rows filas mas recientes, publicables o no"
-- a "todas las filas del owner en la ventana p_since_days" - cambio de
-- semantica deliberado: la cuenta previa dependia del mismo bug de orden
-- que se corrige aqui y nunca fue un diagnostico fiable. La nueva cuenta si
-- refleja cuantas filas se descartaron por escaneo no publicable dentro de
-- la ventana declarada, sin que un escaneo fallido pueda monopolizar el
-- LIMIT y esconder el resto.
--
-- Firma, lenguaje, estabilidad, modo de seguridad, search_path y permisos
-- IDENTICOS a la version vigente (20260710180000): create or replace sobre
-- la misma funcion, mismo revoke/grant, sin tocar ninguna otra migracion.

create or replace function public.leaderboard_publishable_rows(
  p_owner_id text,
  p_max_rows integer default 5000,
  p_since_days integer default 45
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with scoped as (
  select
    sr.id,
    sr.owner_id,
    sr.scan_id,
    sr.symbol,
    sr.company_name,
    sr.country,
    sr.sector,
    sr.industry,
    sr.theme,
    sr.rank_index,
    sr.total_score,
    sr.weinstein_score,
    sr.minervini_score,
    sr.risk_score,
    sr.rs_rating,
    sr.metrics,
    sr.raw,
    sr.created_at,
    s.settings -> 'progress' ->> 'status' as parent_status
  from public.scan_results as sr
  join public.scans as s on s.id = sr.scan_id
  where sr.owner_id = p_owner_id
    and sr.created_at >= (now() - make_interval(days => greatest(coalesce(p_since_days, 45), 1)))
),
publishable as (
  select *
  from scoped
  where parent_status in ('complete', 'partial', 'done')
  order by created_at desc
  limit greatest(1, least(coalesce(p_max_rows, 5000), 10000))
)
select jsonb_build_object(
  'rows',
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id,
      'owner_id', x.owner_id,
      'scan_id', x.scan_id,
      'symbol', x.symbol,
      'company_name', x.company_name,
      'country', x.country,
      'sector', x.sector,
      'industry', x.industry,
      'theme', x.theme,
      'rank_index', x.rank_index,
      'total_score', x.total_score,
      'weinstein_score', x.weinstein_score,
      'minervini_score', x.minervini_score,
      'risk_score', x.risk_score,
      'rs_rating', x.rs_rating,
      'metrics', x.metrics,
      'raw', x.raw,
      'created_at', x.created_at,
      'parent_status', x.parent_status
    ) order by x.created_at desc)
    from publishable as x
  ), '[]'::jsonb),
  'rowsRead',
  (select count(*)::integer from scoped),
  'rowsPublished',
  (select count(*)::integer from publishable),
  'rowsExcluded',
  (select count(*)::integer from scoped where parent_status not in ('complete', 'partial', 'done') or parent_status is null)
);
$$;

revoke all on function public.leaderboard_publishable_rows(text, integer, integer) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.leaderboard_publishable_rows(text, integer, integer) to service_role;
  end if;
end $$;
