-- Align the production schema with the coverage query path already declared in
-- supabase/schema.sql. coverage_scan_summary filters by owner_id, orders by
-- created_at desc, and limits before touching the wide metrics/raw JSONB fields.
create index if not exists scan_results_owner_created_idx
  on public.scan_results (owner_id, created_at desc);
