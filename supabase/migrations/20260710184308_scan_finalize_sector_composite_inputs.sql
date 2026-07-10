-- Migration version aligned with the production history: 20260710184308.
-- Extiende scan_finalize_inputs para soportar el recompute de sectorScore +
-- objectiveScore/compositeScore en finalización (audit 2026-07-10 hallazgo C2
-- + sub-caso C3; ADR docs/adr-scoring-pipeline-canon.md fase 1).
--
-- Hasta ahora el thin-raw projection que devolvía scan_finalize_inputs
-- incluía solo los inputs de rsRawComposite + grouping keys + scores planos
-- para contradicciones (momentumScore, setupQualityScore, adProxyScore,
-- riskRewardScore, liquidityScore, weinsteinScore, minerviniScore,
-- weaknessScore). Tras esta migración la RPC también proyecta los 5 campos
-- adicionales que necesita scoreCompositeValue para recalcular el composite
-- con sectorScore final: riskScore, growthScore, demandScore,
-- epsGrowthProxyScore, ipoScore.
--
-- Mismo patrón que el resto del thin projection: statsedge_coverage_finite_number
-- aplicado a cada candidato, coalesce entre raw y metrics (raw primero porque
-- así lo consume el helper JS via `...(row.raw || {})`). null si ninguno
-- existe -> el helper JS aplica defaults internos (riskRewardScore ?? 45,
-- el resto a 0).
--
-- Fidelidad: theme, perf3m, perf6m, weinsteinScore, minerviniScore ya estaban
-- en el projection anterior — usados por computeSectorScoresForRows. Los 5
-- nuevos campos NO cambian la cobertura ya verificada de scan_finalize_inputs;
-- solo añaden lo necesario para recomputar composite con sectorScore final.

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
      -- flat scores para evaluateContradictions (C1-C6) y para recomputar el
      -- composite con sectorScore final (audit C2 + sub-caso C3). Leidos de
      -- raw (que es donde el spread los pone) con fallback a metrics
      -- (scanDecisionMetrics tambien los proyecta). null -> evaluateContradictions
      -- trata la senal como ausente (no dispara); scoreCompositeValue con
      -- arg undefined se trata como 0 por el wrapper JS.
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
      -- Inputs adicionales para scoreCompositeValue durante el recompute final
      -- (mismo patrón que el bloque anterior: finite_number + coalesce raw/metrics).
      'riskScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'riskScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'riskScore')
      ),
      'growthScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'growthScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'growthScore')
      ),
      'demandScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'demandScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'demandScore')
      ),
      'epsGrowthProxyScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'epsGrowthProxyScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'epsGrowthProxyScore')
      ),
      'ipoScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'ipoScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'ipoScore')
      ),
      -- rsRating: el ranking por defecto del cliente usa rsUniverseValue que cae
      -- a rsBenchmarkValue (rsRating). El recompute del composite puede querer
      -- el fallback si rsGlobalPct quedó null por sample insuficiente, así que
      -- también proyectamos rsRating.
      'rsRating', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'rsRating'),
        public.statsedge_coverage_finite_number(l.metrics -> 'rsRating')
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