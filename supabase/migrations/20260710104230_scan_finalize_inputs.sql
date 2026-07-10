-- Migration version aligned with the production history: 20260710104230.
-- Thin projection of scan_results.raw/metrics for the RS percentile finalization
-- step (lib/scanPercentileFinalization.js).
--
-- Contexto: finalizeScanResultsInDb cargaba SELECT id,metrics,raw por cada fila
-- del scan para alimentar el pure helper finalizeScanPercentiles. Pero `raw`
-- arrastra payloads anidados enormes irrelevantes para el recompute:
--   - chartPreview (array de hasta 96 barras OHLCV),
--   - growthMetrics (provider nested),
--   - decisionTrace, objectiveMetricAudit, etc.
-- Esta funcion proyecta SOLO los campos que el helper consume:
--   - rsRawComposite inputs (relativeStrength.js:180): perf3m, perf6m, perf12m,
--     rs3m, rs6m, rs12m, distance52w, maxDrawdown63d,
--   - grouping keys (enrichRelativePercentiles:238-239): symbol, country, theme,
--     sector,
--   - flat scores que evaluateContradictions lee via row[signalKey]
--     (signalContradictions.js:159): momentumScore, setupQualityScore,
--     adProxyScore, riskRewardScore, liquidityScore, weinsteinScore,
--     minerviniScore, weaknessScore,
--   - signalCoverage (nested {key:{coverage,partial}} — pasa entero, no proyecta).
--
-- El pure helper queda INTACTO: sigue leyendo row.raw. Solo cambia de dónde
-- viene ese raw (ahora thin, no completo). metrics ya no se transfiere en el
-- READ: la RPC finalize_scan_results ya mergea en Postgres (sr.metrics ||
-- src.metrics_patch, schema.sql:339), asi que el echo `...row.metrics` del patch
-- JS era redundante y desaparece.
--
-- Fidelidad al helper: el JS hace `...(row.raw || {})`, asi que TODOS los inputs
-- se leen de raw primero. Para los escalares numericos usamos el patron probado
-- de coverage_scan_summary: aplicar statsedge_coverage_finite_number a cada
-- candidato y coalesce los double precision (evita el bug JSON-null-vs-SQL-null
-- del coalesce JSONB crudo). metrics entra solo como fallback de defensa.
--
-- Reutiliza statsedge_coverage_finite_number (de 20260709225106) para el parsing.
--
-- Devuelve jsonb: {"inputs":[{"id":uuid,"raw":{...thin...}}, ...], "rowsRead":n}.
-- Un wrapper jsonb_build_object (no setof) para que el cliente reciba un solo
-- payload (igual que coverage_scan_summary). p_max_rows acota el universo (50k).

create or replace function public.scan_finalize_inputs(
  p_owner_id text,
  p_scan_id uuid,
  p_max_rows integer default 50000
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with limited as materialized (
  select
    sr.id,
    sr.symbol,
    sr.country,
    sr.sector,
    sr.theme,
    sr.metrics,
    sr.raw,
    sr.rank_index
  from public.scan_results as sr
  where sr.owner_id = p_owner_id
    and sr.scan_id = p_scan_id
  order by sr.rank_index asc
  limit greatest(1, least(coalesce(p_max_rows, 50000), 50000))
), projected as (
  select
    l.id,
    -- Mantenemos rank_index para preservar el orden del array de salida
    -- (el helper es orden-independiente para el recompute, pero el caller
    -- asume order=rank_index.asc igual que el select anterior).
    l.rank_index,
    jsonb_build_object(
      -- grouping keys: raw primero (fiel a ...(row.raw || {})), fallback a la
      -- columna real (siempre poblada por el upsert) como defensa. El helper
      -- agrupa por country (o countryCode(symbol)) y theme||sector.
      'symbol', l.symbol,
      'country', coalesce(nullif(l.raw ->> 'country', ''), nullif(l.country, '')),
      'sector', coalesce(nullif(l.raw ->> 'sector', ''), nullif(l.sector, '')),
      'theme', coalesce(nullif(l.raw ->> 'theme', ''), nullif(l.theme, '')),
      -- rsRawComposite inputs (relativeStrength.js:180-190). Patron: finite_number
      -- a cada candidato, coalesce double. raw primero (de donde lee el helper),
      -- metrics despues como defensa. null si ninguno existe -> el helper aplica
      -- sus defaults internos (p.ej. distance52w -> -50, maxDrawdown63d -> 25).
      'perf3m', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'perf3m'),
        public.statsedge_coverage_finite_number(l.metrics -> 'perf3m')
      ),
      'perf6m', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'perf6m'),
        public.statsedge_coverage_finite_number(l.metrics -> 'perf6m')
      ),
      'perf12m', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'perf12m'),
        public.statsedge_coverage_finite_number(l.metrics -> 'perf12m')
      ),
      'rs3m', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'rs3m'),
        public.statsedge_coverage_finite_number(l.metrics -> 'rs3m')
      ),
      'rs6m', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'rs6m'),
        public.statsedge_coverage_finite_number(l.metrics -> 'rs6m')
      ),
      'rs12m', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'rs12m'),
        public.statsedge_coverage_finite_number(l.metrics -> 'rs12m')
      ),
      'distance52w', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'distance52w'),
        public.statsedge_coverage_finite_number(l.metrics -> 'distance52w')
      ),
      'maxDrawdown63d', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'maxDrawdown63d'),
        public.statsedge_coverage_finite_number(l.metrics -> 'maxDrawdown63d')
      ),
      -- flat scores para evaluateContradictions (C1-C6). Leidos de raw (que es
      -- donde el spread los pone) con fallback a metrics (scanDecisionMetrics
      -- tambien los proyecta). null -> evaluateContradictions trata la senal
      -- como ausente (no dispara).
      'momentumScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'momentumScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'momentumScore')
      ),
      'setupQualityScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'setupQualityScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'setupQualityScore')
      ),
      'adProxyScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'adProxyScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'adProxyScore')
      ),
      'riskRewardScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'riskRewardScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'riskRewardScore')
      ),
      'liquidityScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'liquidityScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'liquidityScore')
      ),
      'weinsteinScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'weinsteinScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'weinsteinScore')
      ),
      'minerviniScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'minerviniScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'minerviniScore')
      ),
      'weaknessScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'weaknessScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'weaknessScore')
      ),
      -- signalCoverage: nested {key:{coverage,partial}}. Pasa entero (no
      -- proyectamos sus sub-claves); el helper lo lee tal cual via
      -- row.signalCoverage?.[signalKey]. Si no existe en raw, -> SQL null ->
      -- el helper trata las senales como no-parciales (su default).
      'signalCoverage', l.raw -> 'signalCoverage'
    ) as raw_thin
  from limited as l
)
select jsonb_build_object(
  'inputs',
  coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'raw', p.raw_thin) order by p.rank_index, p.id)
    from projected as p
  ), '[]'::jsonb),
  'rowsRead',
  (select count(*)::integer from limited)
);
$$;

revoke all on function public.scan_finalize_inputs(text, uuid, integer) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.scan_finalize_inputs(text, uuid, integer) to service_role;
  end if;
end $$;
