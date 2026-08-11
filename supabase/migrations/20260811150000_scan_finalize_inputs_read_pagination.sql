-- Migration version aligned with the production history: 20260811150000.
-- Añade paginación (p_offset) a scan_finalize_inputs para poder trocear la
-- LECTURA de la finalización de percentiles.
--
-- Contexto: un escaneo de "Todo el universo" (9.920 filas guardadas) muere en
-- el último paso, la finalización de percentiles, con
-- finalizationBatchesDone/finalizationBatchesTotal en NULL — es decir, muere
-- ANTES de contar las tandas de escritura, así que el que se agota es el paso
-- de LECTURA. scan_finalize_inputs lee `raw` (19.928 B de texto/fila) y
-- `metrics` (27.473 B de texto/fila) de las 9.920 filas ≈ 470 MB de JSON que
-- Postgres descomprime y parsea para extraer 24 valores por fila, contra un
-- statement_timeout de 8 s (docs/finalizacion-percentiles-2026-08-11.md Parte
-- C.1). El troceo de la ESCRITURA (fb1ce01, FINALIZE_PATCH_BATCH_SIZE) ya está
-- hecho y es correcto, pero atacaba la otra mitad.
--
-- Hasta ahora la firma solo aceptaba `p_max_rows`: un TOPE desde el principio
-- del scan, no un rango. Con solo un tope no se puede pedir "las filas 50 a
-- 99": cualquier llamada empieza siempre por la primera fila. Por eso trocear
-- la lectura exige este parámetro nuevo, y por tanto esta migración.
--
-- CAMBIOS, exactamente tres:
--
--   1. Parámetro nuevo `p_offset integer default 0`. Con el default, las
--      llamadas existentes de 3 argumentos (p_owner_id, p_scan_id, p_max_rows)
--      siguen resolviendo a esta función y devolviendo lo mismo que antes:
--      offset 0 = la primera página = el comportamiento actual.
--
--   2. `offset greatest(0, coalesce(p_offset, 0))` en la CTE `limited`, junto
--      al `limit` que ya estaba. LIMIT/OFFSET se aplican DESPUÉS del ORDER BY
--      del mismo nivel de consulta, así que la paginación recorre el mismo
--      orden que ya usaba la versión vigente.
--
--   3. Desempate en el ORDER BY: `order by sr.rank_index asc, sr.id asc`.
--      `rank_index` SOLO no es un orden estable — es un integer NULLABLE y sin
--      ninguna restricción de unicidad: la única unicidad declarada en
--      scan_results es la clave primaria `id` (supabase/schema.sql:24-43; el
--      índice scan_results_owner_scan_rank_idx sobre (owner_id, scan_id,
--      rank_index) NO es unique). Así que dos filas con el mismo rank_index
--      podrían repartirse entre páginas de forma no determinista y una fila
--      aparecería dos veces o ninguna. El
--      desempate por `id` (clave primaria) hace el orden TOTAL, condición
--      necesaria para paginar con offset. No es una elección arbitraria: es
--      exactamente el mismo orden que el jsonb_agg final ya usaba
--      (`order by p.rank_index, p.id`) desde 20260710104230 — el cambio hace
--      que la ventana de filas y el orden del array coincidan.
--
-- Lo que NO cambia: la proyección thin-raw (las 25 claves del
-- jsonb_build_object, incluida objectiveSetupScore de 20260807140000), el
-- clamp de p_max_rows, el shape de salida {inputs, rowsRead}, el
-- `language sql` / `stable` / `security invoker` / `set search_path = ''`, y
-- los grants (ver más abajo).
--
-- POR QUÉ HAY UN `drop function` Y NO SOLO `create or replace`: añadir un
-- parámetro cambia la ARIDAD, así que `create or replace` NO reemplazaría la
-- función de 3 argumentos — crearía una sobrecarga y dejaría las dos vivas. Con
-- ambas presentes, una llamada de 3 argumentos sería ambigua entre
-- (text, uuid, integer) y (text, uuid, integer, integer) con default, y
-- Postgres/PostgREST fallarían con "function is not unique". El drop de la
-- firma vieja es por tanto obligatorio, y va con `if exists` para ser
-- idempotente. No hay objetos dependientes que el drop pueda arrastrar: la RPC
-- solo se invoca desde JS vía PostgREST (lib/scanPercentileFinalization.js),
-- no desde vistas, triggers ni otras funciones (grep sobre supabase/ y lib/).
--
-- PERMISOS — copiados TAL CUAL de la versión vigente
-- (supabase/migrations/20260807140000_scan_finalize_inputs_objective_setup_score.sql
-- líneas 37-40 y 204-211), sin ninguna variación salvo la firma, que ahora
-- lleva el cuarto argumento:
--
--   · `language sql`            → idéntico
--   · `stable`                  → idéntico
--   · `security invoker`        → idéntico (NO definer)
--   · `set search_path = ''`    → idéntico
--   · `revoke all on function ... from public, anon, authenticated;`
--                               → idéntico, misma lista de roles
--   · `do $$ ... if to_regrole('service_role') is not null then grant execute
--     ... to service_role; end if; end $$;`
--                               → idéntico, mismo guard de existencia de rol
--
-- Esto importa: un desajuste de permisos tumbó las escrituras a `scans` el
-- 29-30 de julio. Aquí no se añade, quita ni cambia ningún rol; lo único que
-- cambia en las líneas de revoke/grant es `(text, uuid, integer)` →
-- `(text, uuid, integer, integer)`, obligatorio porque los permisos de una
-- función van por firma y la firma es nueva.
--
-- IDEMPOTENTE: `drop ... if exists` + `create or replace` + `revoke` (no falla
-- si ya no había nada que revocar) + `grant` dentro de un guard de existencia
-- de rol. Aplicarla dos veces seguidas deja el mismo estado.

drop function if exists public.scan_finalize_inputs(text, uuid, integer);

create or replace function public.scan_finalize_inputs(
  p_owner_id text,
  p_scan_id uuid,
  p_max_rows integer default 50000,
  p_offset integer default 0
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
  -- Orden TOTAL (rank_index no es unique): sin el desempate por id, dos filas
  -- con el mismo rank_index podrían caer en dos páginas distintas o en
  -- ninguna. Mismo orden que el jsonb_agg de abajo.
  order by sr.rank_index asc, sr.id asc
  limit greatest(1, least(coalesce(p_max_rows, 50000), 50000))
  -- Paginación: LIMIT/OFFSET se aplican DESPUÉS del ORDER BY de este nivel,
  -- así que la ventana recorre el mismo orden estable. p_offset null o
  -- negativo se trata como 0 (= comportamiento previo a esta migración).
  offset greatest(0, coalesce(p_offset, 0))
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
      -- totalScore (ver 20260807140000).
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
  -- rowsRead sigue siendo "cuántas filas trajo ESTA llamada" (ahora, esta
  -- página), no el total del scan. El caller acumula.
  'rowsRead',
  (select count(*)::integer from limited)
);
$$;

revoke all on function public.scan_finalize_inputs(text, uuid, integer, integer) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.scan_finalize_inputs(text, uuid, integer, integer) to service_role;
  end if;
end $$;
