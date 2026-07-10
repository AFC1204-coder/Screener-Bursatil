-- Migration: 20260710180000_leaderboard_publishable_rows.sql
--
-- Filtra scan_results para que SOLO aparezcan en leaderboards/scoring las filas
-- cuyo scan padre terminó en un estado PUBLICABLE.
--
-- Contexto (audit 2026-07-10 §"Terminal done can mean zero successful scan rows"):
--   Hasta hoy, scan_results no distinguía el estado del scan padre. Si un scan
--   terminaba con saved=0 y errors=3, las filas que ya se hubieran podido
--   insertar en un chunk anterior se quedaban mezcladas con filas válidas y
--   aparecían en leaderboards. El nuevo contrato terminal del scan runner
--   (lib/scanStatus.js) emite "complete|partial|failed" tras la finalización
--   exitosa del RPC de percentiles. Solo "complete" y "partial" son publicables;
--   "failed", "error" y "cancelled" no deberían aparecer en leaderboards.
--
-- Esta RPC es el ÚNICO punto de filtrado: readScanRows en lib/leaderboards.js
-- la consume y reemplaza la consulta directa a scan_results para servir la
-- ruta de leaderboards (GET/POST /api/leaderboards, jobs de refresh, cron).
--
-- Comportamiento:
--   - Devuelve TODAS las columnas de scan_results (incluyendo raw/metrics) que
--     pertenezcan a scans con progress.status ∈ ("complete", "partial", "done").
--     "done" se incluye por retrocompatibilidad con snapshots legacy que el
--     runner antiguo pudo haber dejado (el inventario actual puede contenerlos
--     hasta que se reescaneen bajo el nuevo contrato).
--   - Filtra adicionalmente por owner_id y por ventana temporal
--     (created_at >= since). Ordena created_at desc para preservar el orden
--     semántico del leaderboard (último scan gana).
--   - Aplica p_max_rows igual que readScanRows lo hacia en JS.
--   - Devuelve jsonb {rows: [...], rowsRead: n} mismo patrón que
--     scan_finalize_inputs / coverage_scan_summary. Wrapper jsonb_build_object
--     (no setof) para que el cliente reciba un solo payload.
--
-- Performance:
--   - JOIN con la tabla padre usando scans(id) (PK) — EXPLAIN esperado: nested
--     loop usando scans_pkey para resolver el status y merge con
--     scan_results_scan_id_idx. Ambas son pequeñas.
--   - El índice principal (scan_results_owner_created_idx, ya en producción vía
--     20260710142340) sigue siendo el camino crítico; el join al padre se evalúa
--     solo sobre los ids presentes en la ventana rowsRead.

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
  order by sr.created_at desc
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
    from scoped as x
    where x.parent_status in ('complete', 'partial', 'done')
  ), '[]'::jsonb),
  'rowsRead',
  (select count(*)::integer from scoped),
  'rowsPublished',
  (select count(*)::integer from scoped where parent_status in ('complete', 'partial', 'done')),
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
