-- Migration version aligned with the production history: 20260807140000.
-- Extiende scan_finalize_inputs para proyectar objectiveSetupScore en el
-- thin-raw (docs/rpc-objective-setup-2026-08-07.md).
--
-- Contexto: lib/screenerPipeline.js:335-336 calcula DOS composites con
-- setup scores distintos — objectiveScore recibe objectiveSetupScore (setup
-- SIN bonus de patrón VCP/contracciones), compositeScore recibe
-- setupQualityScore (setup CON ese bonus). objectiveSetupScore ya se
-- persiste en scan_results.raw (lib/screenerPipeline.js:319,354 y
-- lib/materializedScanner.js:337) con cobertura 100% verificada en
-- producción (86/86 filas con percentileScope:'final', ver
-- docs/rpc-objective-setup-2026-08-07.md Parte A.2), pero scan_finalize_inputs
-- nunca lo proyectaba en el thin-raw. Efecto: lib/scanPercentileFinalization.js:139-142
-- degradaba objectiveSetupScore a setupQualityScore en cada finalización,
-- así que objectiveScore colapsaba con compositeScore/totalScore incluso
-- después del fix de b51d1b4 (que solo arregló el cálculo, no la
-- proyección SQL que lo alimenta).
--
-- Cambio: una clave nueva en el jsonb_build_object, mismo patrón exacto que
-- las 21 claves ya existentes (statsedge_coverage_finite_number aplicado a
-- cada candidato, coalesce raw-primero/metrics-después, null si ninguno
-- existe). lib/scanPercentileFinalization.js:139-142 ya sabe leer
-- row.objectiveSetupScore (fallback Number.isFinite puesto desde b51d1b4) —
-- este cambio no requiere ningún ajuste en el código JS.
--
-- Firma sin cambios (text, uuid, integer): create or replace function sobre
-- la misma firma no requiere drop function ni tocar revoke/grant — mismo
-- patrón que ya siguió 20260710184308 sobre 20260710104230 en producción
-- sin incidente (docs/rpc-objective-setup-2026-08-07.md Parte D.12).

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
      -- objectiveSetupScore: setup score SIN bonus de patrón (VCP/contracciones),
      -- distinto de setupQualityScore (que sí lo lleva). Mismo patrón exacto que
      -- el resto de esta proyección. Sin esta clave, lib/scanPercentileFinalization.js
      -- degrada a setupQualityScore y objectiveScore colapsa con compositeScore/
      -- totalScore (ver comentario de cabecera de esta migración).
      'objectiveSetupScore', coalesce(
        public.statsedge_coverage_finite_number(l.raw -> 'objectiveSetupScore'),
        public.statsedge_coverage_finite_number(l.metrics -> 'objectiveSetupScore')
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
