-- Histórico change-only de escaneos por símbolo.
--
-- Aditiva: no altera ni referencia con FK a scans, scan_results o daily_bars.
-- source_scan_id se conserva como procedencia lógica, pero deliberadamente no
-- tiene FK porque scans aplica una retención destructiva de los últimos N scans.

create table public.scan_symbol_history (
  id bigint generated always as identity primary key,

  owner_id text not null,
  symbol text not null,
  mic_code text not null,

  observed_at timestamptz not null,
  observed_week date not null,
  data_as_of date,

  source_scan_id uuid not null,
  source_pipeline text not null,

  stage text,
  stage_week integer,

  rs_global numeric,
  rs_benchmark numeric,
  rs_country numeric,
  rs_sector numeric,

  composite_score numeric,
  composite_coverage numeric not null,
  composite_partial boolean not null,

  scoring_engine_version text not null,
  data_provider text not null,

  passed_screen boolean not null,
  absence_reason text,
  absence_detail text,

  change_reasons text[] not null,
  created_at timestamptz not null default now(),

  constraint scan_symbol_history_owner_nonempty
    check (btrim(owner_id) <> ''),

  constraint scan_symbol_history_symbol_nonempty
    check (btrim(symbol) <> ''),

  constraint scan_symbol_history_mic_nonempty
    check (btrim(mic_code) <> ''),

  constraint scan_symbol_history_pipeline_nonempty
    check (btrim(source_pipeline) <> ''),

  constraint scan_symbol_history_engine_version_nonempty
    check (btrim(scoring_engine_version) <> ''),

  constraint scan_symbol_history_provider_nonempty
    check (btrim(data_provider) <> ''),

  constraint scan_symbol_history_week_matches_observation
    check (
      observed_week =
      date_trunc('week', observed_at at time zone 'UTC')::date
    ),

  constraint scan_symbol_history_stage_week_positive
    check (stage_week is null or stage_week >= 1),

  constraint scan_symbol_history_rs_global_range
    check (rs_global is null or rs_global between 0 and 100),

  constraint scan_symbol_history_rs_benchmark_range
    check (rs_benchmark is null or rs_benchmark between 0 and 100),

  constraint scan_symbol_history_rs_country_range
    check (rs_country is null or rs_country between 0 and 100),

  constraint scan_symbol_history_rs_sector_range
    check (rs_sector is null or rs_sector between 0 and 100),

  constraint scan_symbol_history_composite_range
    check (composite_score is null or composite_score between 0 and 100),

  constraint scan_symbol_history_coverage_range
    check (composite_coverage between 0 and 1),

  constraint scan_symbol_history_absence_reason
    check (
      absence_reason is null
      or absence_reason in (
        'not_in_universe',
        'insufficient_data',
        'filtered_out'
      )
    ),

  constraint scan_symbol_history_screening_shape
    check (
      (passed_screen = true and absence_reason is null)
      or
      (passed_screen = false and absence_reason is not null)
    ),

  -- No se arrastran métricas antiguas cuando el símbolo deja el universo.
  -- La fila representa ausencia, no un estado técnico actual.
  constraint scan_symbol_history_out_of_universe_shape
    check (
      absence_reason <> 'not_in_universe'
      or (
        data_as_of is null
        and stage is null
        and stage_week is null
        and rs_global is null
        and rs_benchmark is null
        and rs_country is null
        and rs_sector is null
        and composite_score is null
        and composite_coverage = 0
        and composite_partial = true
      )
    ),

  constraint scan_symbol_history_has_change_reason
    check (cardinality(change_reasons) > 0),

  -- Idempotencia ante el reintento del mismo escaneo.
  constraint scan_symbol_history_scan_symbol_unique
    unique (owner_id, source_scan_id, mic_code, symbol)
);

create index scan_symbol_history_latest_idx
  on public.scan_symbol_history (
    owner_id,
    mic_code,
    symbol,
    observed_at desc,
    id desc
  );

create index scan_symbol_history_week_idx
  on public.scan_symbol_history (
    owner_id,
    observed_week desc,
    mic_code,
    symbol
  );

create index scan_symbol_history_mic_latest_idx
  on public.scan_symbol_history (
    owner_id,
    mic_code,
    observed_at desc
  );

alter table public.scan_symbol_history enable row level security;

revoke all on table public.scan_symbol_history from public;

do $$
begin
  if to_regrole('anon') is not null then
    revoke all on table public.scan_symbol_history from anon;
  end if;

  if to_regrole('authenticated') is not null then
    revoke all on table public.scan_symbol_history from authenticated;
  end if;

  if to_regrole('service_role') is not null then
    grant select, insert on table public.scan_symbol_history to service_role;
    grant usage, select
      on sequence public.scan_symbol_history_id_seq
      to service_role;
  end if;
end
$$;

-- Lectura acotada al último estado por (owner, MIC, símbolo). El escritor usa
-- esta proyección para decidir cambios y para detectar salidas de un snapshot
-- autoritativo sin transferir todo el histórico semanal.
create or replace function public.scan_symbol_history_latest_v1(
  p_owner_id text,
  p_mic_codes text[] default null
)
returns setof public.scan_symbol_history
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (h.owner_id, h.mic_code, h.symbol)
    h.*
  from public.scan_symbol_history as h
  where h.owner_id = p_owner_id
    and (
      p_mic_codes is null
      or cardinality(p_mic_codes) = 0
      or h.mic_code = any(p_mic_codes)
    )
  order by
    h.owner_id,
    h.mic_code,
    h.symbol,
    h.observed_at desc,
    h.id desc;
$$;

revoke all
  on function public.scan_symbol_history_latest_v1(text, text[])
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute
      on function public.scan_symbol_history_latest_v1(text, text[])
      to service_role;
  end if;
end
$$;
