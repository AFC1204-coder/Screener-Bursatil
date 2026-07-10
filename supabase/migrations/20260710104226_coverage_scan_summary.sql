-- Migration version aligned with the production history: 20260710104226.
-- Aggregate the coverage projection inside Postgres so /api/coverage never
-- transfers the large scan_results.metrics/raw payloads to Next.js.

create or replace function public.statsedge_coverage_finite_number(p_value jsonb)
returns double precision
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_text text;
  v_number double precision;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'boolean' then
    return case when p_value = 'true'::jsonb then 1 else 0 end;
  end if;

  if jsonb_typeof(p_value) not in ('number', 'string') then
    return null;
  end if;

  v_text := p_value #>> '{}';
  if v_text is null or v_text = '' or lower(v_text) in (
    'nan', 'infinity', '+infinity', '-infinity', 'inf', '+inf', '-inf'
  ) then
    return null;
  end if;
  if btrim(v_text) = '' then
    return 0;
  end if;

  begin
    v_number := v_text::double precision;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return null;
  end;
  return v_number;
end;
$$;

create or replace function public.statsedge_coverage_timestamp(p_value text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(p_value), '') is null then
    return null;
  end if;
  begin
    return p_value::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return null;
  end;
end;
$$;

create or replace function public.coverage_scan_summary(
  p_owner_id text,
  p_since timestamptz,
  p_max_rows integer default 4000,
  p_max_price_freshness_days integer default 5,
  p_min_coverage_score double precision default 40,
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
    sr.total_score,
    sr.metrics,
    sr.raw,
    sr.created_at
  from public.scan_results as sr
  where sr.owner_id = p_owner_id
    and sr.created_at >= p_since
  order by sr.created_at desc
  limit greatest(1, least(coalesce(p_max_rows, 4000), 50000))
), extracted as (
  select
    upper(btrim(coalesce(nullif(l.symbol, ''), l.raw ->> 'symbol', ''))) as symbol,
    upper(btrim(coalesce(nullif(l.country, ''), nullif(l.raw ->> 'country', ''), 'US'))) as country,
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
), by_market as (
  select
    c.country,
    count(*)::integer as unique_symbols,
    count(*) filter (where c.price_fresh)::integer as fresh,
    count(*) filter (where c.quality_ok)::integer as quality_ok,
    count(*) filter (where c.ranking_eligible)::integer as ranking_eligible
  from classified as c
  group by c.country
), totals as (
  select
    (select count(*)::integer from limited) as rows_read,
    count(*)::integer as unique_symbols,
    count(*) filter (where c.price_fresh)::integer as fresh,
    count(*) filter (where c.quality_ok)::integer as quality_ok,
    count(*) filter (where c.ranking_eligible)::integer as ranking_eligible,
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
  'latestScanAt', coalesce(to_char(t.latest_scan_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
  'byMarket', coalesce((
    select jsonb_object_agg(
      bm.country,
      jsonb_build_object(
        'uniqueSymbols', bm.unique_symbols,
        'fresh', bm.fresh,
        'qualityOk', bm.quality_ok,
        'rankingEligible', bm.ranking_eligible,
        'actionable', bm.ranking_eligible
      )
    )
    from by_market as bm
  ), '{}'::jsonb)
)
from totals as t;
$$;

revoke all on function public.statsedge_coverage_finite_number(jsonb) from public, anon, authenticated;
revoke all on function public.statsedge_coverage_timestamp(text) from public, anon, authenticated;
revoke all on function public.coverage_scan_summary(text, timestamptz, integer, integer, double precision, timestamptz) from public, anon, authenticated;

grant execute on function public.statsedge_coverage_finite_number(jsonb) to service_role;
grant execute on function public.statsedge_coverage_timestamp(text) to service_role;
grant execute on function public.coverage_scan_summary(text, timestamptz, integer, integer, double precision, timestamptz) to service_role;
