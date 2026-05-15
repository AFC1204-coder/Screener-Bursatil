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
  symbol text not null,
  alert_type text not null,
  operator text,
  threshold numeric,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);

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

create index if not exists scan_results_scan_id_idx on scan_results(scan_id);
create index if not exists scan_results_symbol_idx on scan_results(owner_id, symbol);
create index if not exists favorites_symbol_idx on favorites(owner_id, symbol);
create index if not exists notes_symbol_idx on notes(owner_id, symbol);
create index if not exists alerts_symbol_idx on alerts(owner_id, symbol);

alter table scans enable row level security;
alter table scan_results enable row level security;
alter table favorites enable row level security;
alter table favorite_snapshots enable row level security;
alter table notes enable row level security;
alter table alerts enable row level security;
alter table company_profiles enable row level security;

-- The Next.js API uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Do not expose the service role key in browser code.
