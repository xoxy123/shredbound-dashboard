-- Visits to quantativestudios.com (the Shredbound store page) and clicks on its
-- buy buttons, per traffic source (Supabase project "shredbound",
-- yptfcpxaihfboteltuhq). Applied as migration "site_visits" (2026-11-23).
--
-- William, 2026-11-23: "how many people entered the site ... and also to see from
-- where they came like 1000 visits from instagram".
--
-- Written only by the "site-visits" edge function (service role), which the store
-- page calls on every page view and buy click. Closed to clients: RLS on, no
-- policies. Nothing is stored on the visitor's device and no IP address or user
-- agent is kept: "visitor" is sha256(today's salt, IP, user agent), and each salt
-- (public.site_visit_salts) is deleted after a day. Migrations "site_visits" and
-- "site_visit_salts" (2026-11-23).

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'buy')),
  source text not null check (source ~ '^[a-z0-9_-]{1,32}$'),
  path text not null default '/' check (char_length(path) between 1 and 80),
  visitor text not null check (visitor ~ '^[A-Za-z0-9]{16,40}$'),
  tier text check (tier is null or tier ~ '^[a-z0-9_-]{1,32}$')
);

create index if not exists site_visits_at on public.site_visits (at);

comment on table public.site_visits is
  'Shredbound store page views and buy-button clicks per traffic source. Reached only through the site-visits edge function (service role); RLS on with no policies.';

alter table public.site_visits enable row level security;
revoke all on public.site_visits from anon, authenticated;

-- Totals per source and per day for the last p_days days (UTC days).
create or replace function public.site_visit_stats(p_days integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  with recent as (
    select * from public.site_visits
    where at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
  )
  select jsonb_build_object(
    'days', greatest(1, least(p_days, 365)),
    'since', (select min(at) from public.site_visits),
    'totals', (
      select jsonb_build_object(
        'views', count(*) filter (where kind = 'view'),
        'visitors', count(distinct visitor) filter (where kind = 'view'),
        'buyClicks', count(*) filter (where kind = 'buy'),
        'buyers', count(distinct visitor) filter (where kind = 'buy'))
      from recent),
    'sources', coalesce((
      select jsonb_agg(s order by s.views desc, s.source)
      from (
        select source,
               count(*) filter (where kind = 'view') as views,
               count(distinct visitor) filter (where kind = 'view') as visitors,
               count(*) filter (where kind = 'buy') as "buyClicks"
        from recent group by source) s), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(d order by d.day)
      from (
        select to_char(at at time zone 'UTC', 'YYYY-MM-DD') as day,
               count(*) filter (where kind = 'view') as views,
               count(distinct visitor) filter (where kind = 'view') as visitors,
               count(*) filter (where kind = 'buy') as "buyClicks"
        from recent group by 1) d), '[]'::jsonb),
    'tiers', coalesce((
      select jsonb_agg(t order by t.clicks desc)
      from (
        select tier, count(*) as clicks from recent
        where kind = 'buy' and tier is not null group by tier) t), '[]'::jsonb)
  );
$$;

revoke all on function public.site_visit_stats(integer) from public, anon, authenticated;

-- One random salt per UTC day; anything older than yesterday is deleted on use.
create table if not exists public.site_visit_salts (
  day date primary key,
  salt text not null
);
comment on table public.site_visit_salts is
  'One random salt per UTC day for counting unique store visitors without keeping IP addresses: visitor = sha256(salt, ip, user agent). Salts older than yesterday are deleted, so old visitor ids cannot be traced back. Service role only.';
alter table public.site_visit_salts enable row level security;
revoke all on public.site_visit_salts from anon, authenticated;

create or replace function public.site_visit_salt()
returns text
language sql
volatile
set search_path = public
as $$
  delete from public.site_visit_salts where day < (now() at time zone 'UTC')::date - 1;
  insert into public.site_visit_salts (day, salt)
  values ((now() at time zone 'UTC')::date, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (day) do nothing;
  select salt from public.site_visit_salts where day = (now() at time zone 'UTC')::date;
$$;
revoke all on function public.site_visit_salt() from public, anon, authenticated;
