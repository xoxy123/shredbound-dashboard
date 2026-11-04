-- Shredbound store stats (Supabase project "shredbound", yptfcpxaihfboteltuhq).
-- Applied as migration "store_stats_config" (2026-11-03); this file is the
-- resulting state. Closed to clients (RLS on, no policies), like the other
-- Shredbound tables: the "store-stats" edge function is the only way in, with
-- the service role.
--
-- Rows: "itch_api_key" (William's itch.io server-side API key, set from the
-- dashboard's Försäljning tab with the admin secret) and "itch_cache" (the last
-- my-games answer as JSON, refreshed at most every 10 minutes).

create table if not exists public.store_config (
  key text primary key check (key in ('itch_api_key', 'itch_cache')),
  value text not null,
  updated_at timestamptz not null default now()
);

comment on table public.store_config is
  'Shredbound store-stats config and cache (itch.io API key). Reached only through the store-stats edge function (service role); RLS on with no policies.';

alter table public.store_config enable row level security;
revoke all on public.store_config from anon, authenticated;
