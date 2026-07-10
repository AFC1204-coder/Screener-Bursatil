-- Migration version aligned with the production history: 20260710104227.
-- Aggregate the coverage breakdown for /api/scan-coverage inside Postgres so the
-- route never transfers the large scan_results.metrics/raw payloads to Next.js.
--
-- Hermana de coverage_scan_summary (migracion 20260710104226). Esta funcion cubre
-- las necesidades de /api/scan-coverage, que son sustancialmente distintas:
--   - agrupa por country Y sector (la otra solo por country como byMarket),
--   - emite averages (avgCoverageScore, avgTotalScore),
--   - opcionalmente topSymbols por grupo (includeTop) con muestras limitadas,
--   - replica el shape exacto de groupCoverage()/topSymbols()/avg() de la route.
--
-- Reutiliza statsedge_coverage_finite_number / statsedge_coverage_timestamp
-- (creadas por 20260710104226). Si esa migracion no se ha aplicado, esta falla
-- ruidosamente al resolver las dependencias — orden de apply: la otra primero.
--
-- Convencion de la casa: SECURITY INVOKER + set search_path + revoke/grant a
-- service_role (la API usa SUPABASE_SERVICE_ROLE_KEY que bypasea RLS).

create or replace function public.scan_coverage_breakdown(
  p_owner_id text,
  p_since timestamptz,
  p_max_rows integer default 10000,
  p_max_price_freshness_days integer default 5,
  p_min_coverage_score double precision default 40,
  p_include_top boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with limited as materialized (
  select
    sr.symbol,
    sr.country,
    sr.sector,
    sr.total_score,
    sr.metrics,
    sr.raw,
    sr.created_at
  from public.scan_results as sr
  where sr.owner_id = p_owner_id
    and sr.created_at >= p_since
  order by sr.created_at desc
  limit greatest(1, least(coalesce(p_max_rows, 10000), 50000))
), extracted as (
  select
    upper(btrim(coalesce(nullif(l.symbol, ''), nullif(l.raw ->> 'symbol', '')))) as symbol,
    -- country: columna primero, fallback a raw->>'country', default 'US'
    -- (replica cleanText(item.country || item.raw?.country || "US").toUpperCase()
    --  de rowShape — la route normaliza a upper via toUpperCase()).
    upper(btrim(coalesce(nullif(l.country, ''), nullif(l.raw ->> 'country', ''), 'US'))) as country,
    -- sector: cleanText(item.sector || item.raw?.sector || "Sin sector") — sin upper.
    coalesce(nullif(btrim(l.sector), ''), nullif(btrim(l.raw ->> 'sector'), ''), 'Sin sector') as sector,
    l.created_at,
    coalesce(
      public.statsedge_coverage_finite_number(l.metrics -> 'priceFreshnessDays'),
      public.statsedge_coverage_finite_number(l.raw -> 'priceFreshnessDays'),
      public.statsedge_coverage_finite_number(l.raw #> '{growthMetrics,priceFreshnessDays}')
    ) as price_freshness_days,
    public.statsedge_coverage_timestamp(coalesce(
      nullif(l.metrics ->> 'lastDate', ''),
      nullif(l.raw ->> 'lastDate', ''),
      ''
    )) as last_date,
    coalesce(
      public.statsedge_coverage_finite_number(l.metrics -> 'dataCoverageScore'),
      public.statsedge_coverage_finite_number(l.raw -> 'dataCoverageScore'),
      public.statsedge_coverage_finite_number(l.raw #> '{growthMetrics,dataCoverageScore}')
    ) as data_coverage_score,
    coalesce(
      public.statsedge_coverage_finite_number(l.raw -> 'totalScore'),
      public.statsedge_coverage_finite_number(l.metrics -> 'totalScore'),
      l.total_score::double precision
    ) as total_score,
    coalesce(
      public.statsedge_coverage_finite_number(l.raw -> 'objectiveScore'),
      public.statsedge_coverage_finite_number(l.metrics -> 'objectiveScore'),
      public.statsedge_coverage_finite_number(l.raw -> 'totalScore'),
      public.statsedge_coverage_finite_number(l.metrics -> 'totalScore'),
      l.total_score::double precision
    ) as objective_score
  from limited as l
), shaped as (
  select
    e.*,
    case
      when e.price_freshness_days is not null
        then e.price_freshness_days <= p_max_price_freshness_days
      when e.last_date is not null
        then greatest(0, floor(extract(epoch from (p_now - e.last_date)) / 86400)) <= p_max_price_freshness_days
      else false
    end as price_fresh
  from extracted as e
), latest as (
  select distinct on (s.symbol)
    s.*
  from shaped as s
  where s.symbol <> ''
  order by s.symbol, s.created_at desc
), classified as (
  select
    l.*,
    l.price_fresh
      and (l.data_coverage_score is null or l.data_coverage_score >= p_min_coverage_score) as quality_ok,
    l.price_fresh
      and (l.data_coverage_score is null or l.data_coverage_score >= p_min_coverage_score)
      and (l.objective_score is null or l.objective_score >= 45) as ranking_eligible
  from latest as l
), by_country as (
  select
    c.country as key,
    count(*)::integer as unique_symbols,
    count(*) filter (where c.price_fresh)::integer as fresh,
    count(*) filter (where c.quality_ok)::integer as quality_ok,
    count(*) filter (where c.ranking_eligible)::integer as ranking_eligible,
    avg(c.data_coverage_score) as avg_coverage_score,
    avg(c.total_score) as avg_total_score,
    -- top 5 por objectiveScore desc; se rellena solo si p_include_top.
    case when p_include_top then (
      select jsonb_agg(top order by ord)
      from (
        select
          row_number() over (order by coalesce(c2.objective_score, 0) desc, c2.symbol) as ord,
          jsonb_build_object(
            'symbol', c2.symbol,
            'score', case when c2.objective_score is null then null else round(c2.objective_score)::integer end,
            'fresh', c2.price_fresh,
            'coverage', case when c2.data_coverage_score is null then null else round(c2.data_coverage_score)::integer end
          ) as top
        from classified as c2
        where c2.country = c.country
        order by coalesce(c2.objective_score, 0) desc, c2.symbol
        limit 5
      ) as t
    ) else null end as top_symbols
  from classified as c
  group by c.country
), by_sector as (
  select
    c.sector as key,
    count(*)::integer as unique_symbols,
    count(*) filter (where c.price_fresh)::integer as fresh,
    count(*) filter (where c.quality_ok)::integer as quality_ok,
    count(*) filter (where c.ranking_eligible)::integer as ranking_eligible,
    avg(c.data_coverage_score) as avg_coverage_score,
    avg(c.total_score) as avg_total_score,
    case when p_include_top then (
      select jsonb_agg(top order by ord)
      from (
        select
          row_number() over (order by coalesce(c2.objective_score, 0) desc, c2.symbol) as ord,
          jsonb_build_object(
            'symbol', c2.symbol,
            'score', case when c2.objective_score is null then null else round(c2.objective_score)::integer end,
            'fresh', c2.price_fresh,
            'coverage', case when c2.data_coverage_score is null then null else round(c2.data_coverage_score)::integer end
          ) as top
        from classified as c2
        where c2.sector = c.sector
        order by coalesce(c2.objective_score, 0) desc, c2.symbol
        limit 5
      ) as t
    ) else null end as top_symbols
  from classified as c
  group by c.sector
), totals as (
  select
    (select count(*)::integer from limited) as rows_read,
    count(*)::integer as unique_symbols,
    count(*) filter (where c.price_fresh)::integer as fresh,
    count(*) filter (where c.quality_ok)::integer as quality_ok,
    count(*) filter (where c.ranking_eligible)::integer as ranking_eligible,
    avg(c.data_coverage_score) as avg_coverage_score,
    avg(c.total_score) as avg_total_score,
    max(c.created_at) as latest_scan_at
  from classified as c
)
select jsonb_build_object(
  'rowsRead', t.rows_read,
  'uniqueSymbols', t.unique_symbols,
  'fresh', t.fresh,
  'qualityOk', t.quality_ok,
  'rankingEligible', t.ranking_eligible,
  'actionable', t.ranking_eligible,
  'avgCoverageScore', t.avg_coverage_score,
  'avgTotalScore', t.avg_total_score,
  'latestScanAt', coalesce(to_char(t.latest_scan_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
  'byCountry', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', bc.key,
        'uniqueSymbols', bc.unique_symbols,
        'fresh', bc.fresh,
        'freshPct', case when bc.unique_symbols > 0 then round(bc.fresh::double precision / bc.unique_symbols * 100)::integer else 0 end,
        'qualityOk', bc.quality_ok,
        'rankingEligible', bc.ranking_eligible,
        'actionable', bc.ranking_eligible,
        'avgCoverageScore', bc.avg_coverage_score,
        'avgTotalScore', bc.avg_total_score,
        'topSymbols', bc.top_symbols
      )
      order by bc.unique_symbols desc, bc.ranking_eligible desc, bc.key
    )
    from by_country as bc
  ), '[]'::jsonb),
  'bySector', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'key', bs.key,
        'uniqueSymbols', bs.unique_symbols,
        'fresh', bs.fresh,
        'freshPct', case when bs.unique_symbols > 0 then round(bs.fresh::double precision / bs.unique_symbols * 100)::integer else 0 end,
        'qualityOk', bs.quality_ok,
        'rankingEligible', bs.ranking_eligible,
        'actionable', bs.ranking_eligible,
        'avgCoverageScore', bs.avg_coverage_score,
        'avgTotalScore', bs.avg_total_score,
        'topSymbols', bs.top_symbols
      )
      order by bs.unique_symbols desc, bs.ranking_eligible desc, bs.key
    )
    from by_sector as bs
  ), '[]'::jsonb)
)
from totals as t;
$$;

revoke all on function public.scan_coverage_breakdown(text, timestamptz, integer, integer, double precision, boolean, timestamptz) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.scan_coverage_breakdown(text, timestamptz, integer, integer, double precision, boolean, timestamptz) to service_role;
  end if;
end $$;
