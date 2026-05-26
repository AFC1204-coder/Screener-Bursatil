-- StatsEdge V1 cloud persistence.
-- Run this in the Supabase SQL editor before setting the env vars in Vercel/local.

create extension if not exists pgcrypto;

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  local_id text not null,
  name text not null,
  preset text,
  settings jsonb not null default '{}'::jsonb,
  market_score numeric,
  market_regime text,
  row_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, local_id)
);

create table if not exists scan_results (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  scan_id uuid not null references scans(id) on delete cascade,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  rank_index integer,
  total_score numeric,
  weinstein_score numeric,
  minervini_score numeric,
  risk_score numeric,
  rs_rating numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  local_id text not null,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  added_at timestamptz not null default now(),
  entry_price numeric,
  last_price numeric,
  last_date date,
  source text,
  notes text not null default '',
  market_score numeric,
  market_regime text,
  snapshot jsonb not null default '{}'::jsonb,
  benchmark_symbol text,
  performance jsonb not null default '{}'::jsonb,
  current_state text,
  error text,
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol)
);

create table if not exists favorite_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  favorite_id uuid references favorites(id) on delete cascade,
  symbol text not null,
  captured_at timestamptz not null default now(),
  price numeric,
  benchmark_symbol text,
  benchmark_price numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text,
  favorite_id uuid references favorites(id) on delete set null,
  title text,
  body text not null default '',
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  local_id text not null,
  symbol text not null,
  alert_type text not null,
  operator text,
  threshold numeric,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  triggered_at timestamptz,
  constraint alerts_owner_local_id_key unique (owner_id, local_id)
);

alter table alerts add column if not exists local_id text;
update alerts set local_id = payload->>'localId' where local_id is null and payload ? 'localId';
update alerts set local_id = id::text where local_id is null;
with ranked_alerts as (
  select id, local_id, row_number() over(partition by owner_id, local_id order by created_at desc, id desc) as duplicate_rank
  from alerts
  where local_id is not null
)
update alerts
set local_id = ranked_alerts.local_id || ':' || alerts.id::text
from ranked_alerts
where alerts.id = ranked_alerts.id and ranked_alerts.duplicate_rank > 1;
alter table alerts alter column local_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alerts_owner_local_id_key') then
    alter table alerts add constraint alerts_owner_local_id_key unique (owner_id, local_id);
  end if;
end $$;

create table if not exists company_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text not null,
  name text,
  sector text,
  industry text,
  country text,
  currency text,
  market_cap numeric,
  market_cap_usd numeric,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol)
);

create table if not exists universe_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  cache_key text not null,
  markets text[] not null default '{}'::text[],
  source text,
  total_count integer not null default 0,
  passed_count integer not null default 0,
  excluded_count integer not null default 0,
  quality_gate jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, cache_key)
);

create table if not exists universe_snapshot_symbols (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_id uuid not null references universe_snapshots(id) on delete cascade,
  symbol text not null,
  name text,
  country text,
  market text,
  source text,
  instrument_type text,
  passed boolean not null default true,
  quality_gate jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol)
);

create table if not exists daily_bars (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text not null,
  trade_date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  adj_close numeric,
  volume numeric,
  currency text,
  provider text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol, trade_date, provider)
);

create table if not exists fundamental_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text not null,
  period_end date,
  period_type text,
  provider text,
  currency text,
  market_cap numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol, period_end, period_type, provider)
);

create table if not exists shadow_instruments (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  provider text not null,
  market text not null,
  isin text not null,
  name text,
  short_name text,
  currency text,
  cfi_code text,
  issuer_lei text,
  trading_venue text,
  relevant_venue text,
  relevant_authority text,
  first_trade_date date,
  termination_date date,
  status text not null default 'reference',
  quality_gate jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider, market, isin)
);

create table if not exists symbol_resolutions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  provider text not null,
  market text not null,
  isin text not null,
  symbol text not null,
  name text,
  exchange text,
  exchange_code text,
  figi text,
  composite_figi text,
  share_class_figi text,
  confidence_score numeric,
  status text not null default 'resolved',
  data_freshness jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, provider, isin, symbol)
);

create table if not exists provider_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  provider text not null,
  run_type text not null,
  market text,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  setting_type text not null default 'general',
  setting_key text not null default 'default',
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, setting_type, setting_key)
);

create table if not exists leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  leaderboard_key text not null,
  scope_type text not null default 'global',
  scope_value text,
  strategy text not null default 'momentum',
  title text not null,
  criteria jsonb not null default '{}'::jsonb,
  item_count integer not null default 0,
  source text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, leaderboard_key)
);

create table if not exists leaderboard_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_id uuid not null references leaderboard_snapshots(id) on delete cascade,
  rank_index integer not null,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  score numeric,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol)
);

create table if not exists rs_weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_date date not null,
  week_key text not null,
  engine_version text not null,
  base_currency text not null default 'USD',
  lookback_weeks integer[] not null default '{13,26,39,52}'::integer[],
  weights jsonb not null default '{}'::jsonb,
  min_sample integer not null default 20,
  symbol_count integer not null default 0,
  source text,
  stats jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (owner_id, snapshot_date, engine_version, base_currency)
);

create table if not exists rs_weekly_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_id uuid not null references rs_weekly_snapshots(id) on delete cascade,
  snapshot_date date not null,
  week_key text not null,
  engine_version text not null,
  base_currency text not null default 'USD',
  rank_index integer not null,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  currency text,
  normalized_currency text,
  rs_rating numeric,
  rs_raw numeric,
  usd_close numeric,
  local_close numeric,
  fx_rate numeric,
  fx_date date,
  sample_size integer,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol)
);

create index if not exists scan_results_scan_id_idx on scan_results(scan_id);
create index if not exists scan_results_symbol_idx on scan_results(owner_id, symbol);
create index if not exists favorites_symbol_idx on favorites(owner_id, symbol);
create index if not exists notes_symbol_idx on notes(owner_id, symbol);
create index if not exists alerts_symbol_idx on alerts(owner_id, symbol);
create index if not exists alerts_local_id_idx on alerts(owner_id, local_id);
create index if not exists universe_snapshots_cache_idx on universe_snapshots(owner_id, cache_key, updated_at desc);
create index if not exists universe_snapshot_symbols_snapshot_idx on universe_snapshot_symbols(snapshot_id, passed);
create index if not exists universe_snapshot_symbols_symbol_idx on universe_snapshot_symbols(owner_id, symbol);
create index if not exists daily_bars_symbol_date_idx on daily_bars(owner_id, symbol, trade_date desc);
create index if not exists daily_bars_date_idx on daily_bars(owner_id, trade_date desc);
create index if not exists fundamental_snapshots_symbol_idx on fundamental_snapshots(owner_id, symbol, period_end desc);
create index if not exists shadow_instruments_market_idx on shadow_instruments(owner_id, provider, market, updated_at desc);
create index if not exists shadow_instruments_isin_idx on shadow_instruments(owner_id, isin);
create index if not exists symbol_resolutions_market_idx on symbol_resolutions(owner_id, provider, market, updated_at desc);
create index if not exists symbol_resolutions_symbol_idx on symbol_resolutions(owner_id, symbol);
create index if not exists symbol_resolutions_isin_idx on symbol_resolutions(owner_id, isin);
create index if not exists provider_runs_idx on provider_runs(owner_id, provider, run_type, started_at desc);
create index if not exists app_settings_key_idx on app_settings(owner_id, setting_type, setting_key, updated_at desc);
create index if not exists leaderboard_snapshots_key_idx on leaderboard_snapshots(owner_id, leaderboard_key, generated_at desc);
create index if not exists leaderboard_items_snapshot_idx on leaderboard_items(snapshot_id, rank_index);
create index if not exists leaderboard_items_symbol_idx on leaderboard_items(owner_id, symbol);
create index if not exists rs_weekly_snapshots_date_idx on rs_weekly_snapshots(owner_id, snapshot_date desc);
create index if not exists rs_weekly_items_snapshot_idx on rs_weekly_items(snapshot_id, rank_index);
create index if not exists rs_weekly_items_symbol_idx on rs_weekly_items(owner_id, symbol, snapshot_date desc);
alter table scans enable row level security;
alter table scan_results enable row level security;
alter table favorites enable row level security;
alter table favorite_snapshots enable row level security;
alter table notes enable row level security;
alter table alerts enable row level security;
alter table company_profiles enable row level security;
alter table universe_snapshots enable row level security;
alter table universe_snapshot_symbols enable row level security;
alter table daily_bars enable row level security;
alter table fundamental_snapshots enable row level security;
alter table shadow_instruments enable row level security;
alter table symbol_resolutions enable row level security;
alter table provider_runs enable row level security;
alter table app_settings enable row level security;
alter table leaderboard_snapshots enable row level security;
alter table leaderboard_items enable row level security;
alter table rs_weekly_snapshots enable row level security;
alter table rs_weekly_items enable row level security;
-- The Next.js API uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Do not expose the service role key in browser code.
