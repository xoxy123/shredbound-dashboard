-- Shredbound Stripe stats (Supabase project "shredbound", yptfcpxaihfboteltuhq).
-- Applied as migration "stripe_stats_config" (2026-11-17). It widens the key check
-- of public.store_config (see ../store-stats/schema.sql) so the "stripe-stats"
-- edge function can keep its rows there. The table stays closed to clients
-- (RLS on, no policies); only the edge functions reach it with the service role.
--
-- New rows: "stripe_api_key" (the restricted, read-only Stripe key of
-- quantativestudios.com, set from the dashboard's Försäljning tab with the admin
-- secret) and "stripe_cache" (the last computed stats as JSON, refreshed at most
-- every 5 minutes).

alter table public.store_config drop constraint if exists store_config_key_check;
alter table public.store_config add constraint store_config_key_check
  check (key in ('itch_api_key', 'itch_cache', 'stripe_api_key', 'stripe_cache'));
