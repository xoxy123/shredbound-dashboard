-- Shredbound sales funnel (Supabase project "shredbound", yptfcpxaihfboteltuhq).
-- Applied as migration "funnel_weeks" (2026-11-17). Closed to clients (RLS on,
-- no policies): the "funnel" edge function is the only way in, with the service
-- role. The weekly Instagram reading may also be written directly with
-- `supabase db query --linked` (see README, "Sales funnel").
--
-- One row per platform and reporting period: the numbers Instagram (or TikTok)
-- insights show for that period. Unknown values stay null.

create table if not exists public.funnel_weeks (
  platform text not null check (platform in ('Instagram', 'TikTok')),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  views bigint check (views >= 0),
  reach bigint check (reach >= 0),
  profile_visits bigint check (profile_visits >= 0),
  link_clicks bigint check (link_clicks >= 0),
  source text check (char_length(source) <= 200),
  taken_at timestamptz not null default now(),
  primary key (platform, period_start, period_end)
);

comment on table public.funnel_weeks is
  'Shredbound sales funnel: views, profile visits and link clicks per platform and period. Reached only through the funnel edge function (service role); RLS on with no policies.';

alter table public.funnel_weeks enable row level security;
revoke all on public.funnel_weeks from anon, authenticated;

-- Shredbound's own Instagram followers for the Mål tab (migration "social_readings",
-- 2026-11-23). Written by the funnel function's public.social (live reading at most
-- every 5 minutes) and once a day by pg_cron job "shredbound-social-daily" (17:05 UTC).
create table if not exists public.social_readings (
  id bigint generated always as identity primary key,
  platform text not null check (platform in ('instagram', 'tiktok')),
  handle text not null check (handle ~ '^[a-z0-9_.]{1,30}$'),
  taken_at timestamptz not null default now(),
  followers bigint check (followers >= 0),
  posts integer check (posts >= 0)
);
create index if not exists social_readings_platform_at on public.social_readings (platform, taken_at);
alter table public.social_readings enable row level security;
revoke all on public.social_readings from anon, authenticated;
