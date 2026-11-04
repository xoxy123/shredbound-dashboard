# Shredbound Dashboard

Public dashboard with the layout and palette of Studywarts Dashboard. Swedish UI, compact tabs: feedback, players (Spelare), store sales (Försäljning), access codes (Koder), budget, content/scripts, goals, TikTok and Instagram analysis, videos, builds/playtests, overview.

Feedback is text plus an optional image or video. Either may be submitted alone. Files may also be dropped or images pasted. No title, category, priority, or build fields are required. Feedback can be edited, marked fixed, archived, and restored.

## Local development

```sh
npm ci
npx wrangler d1 migrations apply shredbound-dashboard --local
npm run dev
```

Open `http://127.0.0.1:4318/`. Local records/media are stored in ignored `.wrangler/state` and are never published.

```sh
npm test
npm run build
```

## Players, access codes and sales

These three tabs read Shredbound's Supabase project (`yptfcpxaihfboteltuhq`), not the Worker. `src/config.js` holds the project URL and its anon key, which is public by design (role `anon`; a test fails if a service-role key ever appears in `dist/pages`). `src/online.js` calls the edge functions with POST JSON.

- **Spelare** shows `access` `public.stats` (devices, play hours, active in 7 days) to everyone. With the admin secret it also shows `admin.stats`: active today, play time per day for 60 days (chart plus table view), and play time per code.
- **Koder** is admin only: list codes, create one (`admin.create {name, code?, days?, expiresAt?}`; the code is shown once with a copy button), revoke/restore a code and ban/unban a device, each behind a confirmation. Codes are listed by name only.
- **Försäljning** reads `store-stats` (source in `docs/store-stats/`, the copy of `Tools/online/store-stats/` in the Shredbound repo). It calls itch.io's server API `my-games` server-side and returns downloads, page views and purchases per game; earnings only with the admin secret. Until an itch.io API key is stored, the tab shows "Koppla itch.io". With the admin secret, the key is pasted in that tab and stored server-side in `public.store_config` (RLS on, no policies). The key never reaches the browser again.

**Admin secret.** The Koder tab has an ADMIN field. The secret is kept only in that browser's localStorage and is sent only as the `x-admin-secret` header to `access` and `store-stats` (which checks it by asking `access`). "Glöm admin-nyckeln" removes it. Never write the secret into source, reports or the repo.

## TikTok and order analysis

The Analys tab displays dated, period-specific snapshots and the assistant's written analysis, per platform (TikTok and Instagram chips) and per Monday-to-Sunday week, with a side-by-side week table. It does not ask the user to write an analysis. Reports include views, likes, comments, shares, total/new followers, orders/revenue, optional per-video results, sources, conclusions, and next steps. Unknown values remain null and display as a dash. Older reports remain selectable. Comparisons use distinct, equally long reporting periods.

Like Studywarts, the assistant reads authorized analytics sources and saves the report. This project does not yet have a confirmed TikTok account, authenticated TikTok Studio access, or an order source. No statistics or reports have been invented or seeded in production. Public profile totals cannot establish views/likes gained during a particular week.

The Sunday analysis is the scheduled task `shredbound-social-weekly-analysis` (Sundays about 19:00). It first reads `social-accounts.json`; while a handle is empty it reports "accounts not set" and stops for that platform. It only reads TikTok Studio and Instagram insights in William's logged-in Chrome and never posts or changes anything.

To save a verified report, pass its JSON to `scripts/record-analysis.mjs` on stdin, with `SHREDBOUND_SITE` and optional `SITE_AUTHORIZATION` supplied in the process environment. The script writes only the report. Credentials must never appear in source or report evidence. Required report fields are `periodStart` and `periodEnd` (`YYYY-MM-DD`). Optional numeric metrics are `views`, `likes`, `comments`, `shares`, `followers`, `newFollowers`, `orders`, and `revenue`. Include `platform` (`TikTok` or `Instagram`, default TikTok), `conclusion`, `next`, `evidence`, `dataSource`, `orderSource`, `account`, and `analyst` as appropriate. The script titles each report `<platform> · <start> – <end>`, so the platform survives a deployed Worker that predates the `platform` field. `topVideos` may contain title, URL, views, and likes. Week deltas must come from Studio, verified snapshots, or order-system period totals, not lifetime counts on recent posts.

## Storage and deployment

The Cloudflare Worker uses logical `DB` (D1) and `UPLOADS` (R2) bindings declared in `.openai/hosting.json`. Sites manages production storage. The public frontend is hosted on GitHub Pages; the public Worker API allows cross-origin requests only from `https://xoxy123.github.io`. No account or login is required. The build bundles the Worker/assets, configuration, and Drizzle migrations. Local and production migrations describe the same schema.

- Server validation and optimistic revisions protect edits. Archive/restore is reversible. JSON export includes archived records; media can be downloaded individually.
- Uploads accept MP4, WebM, MOV, JPG, PNG, WebP, GIF up to 50 MB. Video supports byte ranges. Codec support varies by browser.
- Video annotations support timestamps and 0.1-second seeking. Build/FPS measurements remain explicitly entered results; no Unity telemetry is connected.
- Only the display-name preference is stored in local storage. Product records/media persist online.

No original Studywarts records, passwords, project videos, or protected game assets are copied.

## GitHub Pages

`https://xoxy123.github.io/shredbound-dashboard/` serves the dashboard without authentication. On pushes to `main`, the Pages workflow builds and publishes only `dist/pages`. Worker code is published separately to the existing Sites project for shared storage and media uploads. The browser uses no API tokens, passwords, cookies, or private Sites authorization.

The dashboard and saved feedback/metrics are public. All visitors can add/edit records. Do not put credentials, private customer details, or other confidential data in it. Order reports should contain aggregate counts and totals only.

For Worker deployments, package with the Sites workflow or `node scripts/package-sites.mjs`. The archive must retain `dist/.openai/hosting.json` and `dist/.openai/drizzle/`; placing migrations at root `.openai/drizzle/` skips production schema creation. GitHub Pages deploys only `dist/pages/`.
