// Shredbound sales funnel for the dashboard's Försäljning tab: Instagram/TikTok
// views, profile visits and link clicks per period (public.funnel_weeks) and the
// clippers' TikTok views (public.clipper_snapshots, written by the clipper
// dashboard's weekly scan). Stripe numbers come from "stripe-stats".
// Deployed as the "funnel" edge function (verify_jwt on).
//
// Actions (POST JSON {action, ...}):
//   public.stats     funnel weeks and clipper totals (counts only, no usernames)
//   admin.stats      the same plus views per clipper (x-admin-secret header)
//   admin.saveWeek   {platform, periodStart, periodEnd, views?, reach?,
//                    profileVisits?, linkClicks?, source?}: upsert one period
//   admin.deleteWeek {platform, periodStart, periodEnd}
//   public.social    Shredbound's Instagram followers now (read live, at most every
//                    5 minutes) and one reading per day, for the Mål tab's follower
//                    goal (public.social_readings; pg_cron also calls it daily)
// The admin secret is checked by the "access" function, as in store-stats.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const ORIGINS = new Set([
  "https://xoxy123.github.io",
  "http://127.0.0.1:4318",
  "http://localhost:4318",
]);
const PLATFORMS = new Set(["Instagram", "TikTok"]);

// Shredbound's own Instagram. Its profile embed page carries the follower count;
// Instagram answers it with data only to a phone browser's user agent.
const INSTAGRAM = "shredbound.game";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SOCIAL_FRESH_MS = 5 * 60_000;

async function readInstagram(handle: string): Promise<{ followers: number; posts: number | null } | { error: string }> {
  let html = "";
  try {
    const r = await fetch(`https://www.instagram.com/${handle}/embed/`, { headers: { "User-Agent": PHONE_UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
    html = await r.text();
  } catch {
    return { error: "Instagram svarade inte." };
  }
  const m = html.match(/"contextJSON":"((?:\\.|[^"\\])*)"/);
  if (!m) return { error: "Instagram svarade inte med siffrorna." };
  try {
    const ctx = JSON.parse(JSON.parse(`"${m[1]}"`))?.context;
    const followers = Number(ctx?.followers_count);
    if (String(ctx?.username).toLowerCase() !== handle || !Number.isFinite(followers)) return { error: "Instagram svarade inte med siffrorna." };
    const posts = Number(ctx?.posts_count);
    return { followers, posts: Number.isFinite(posts) ? posts : null };
  } catch {
    return { error: "Instagram svarade inte med siffrorna." };
  }
}

// The newest reading (taken now if the last one is older than 5 minutes) and the
// last reading of every day, oldest first.
async function social() {
  const { data: last } = await supabase.from("social_readings").select("followers, posts, taken_at")
    .eq("platform", "instagram").order("taken_at", { ascending: false }).limit(1).maybeSingle();
  let error: string | null = null;
  if (!last || Date.now() - Date.parse(last.taken_at) > SOCIAL_FRESH_MS) {
    const now = await readInstagram(INSTAGRAM);
    if ("error" in now) error = now.error;
    else {
      const { error: e } = await supabase.from("social_readings").insert({ platform: "instagram", handle: INSTAGRAM, followers: now.followers, posts: now.posts });
      if (e) throw new Error(e.message);
    }
  }
  const { data: rows, error: e2 } = await supabase.from("social_readings").select("followers, posts, taken_at")
    .eq("platform", "instagram").gte("taken_at", new Date(Date.now() - 120 * 86_400_000).toISOString())
    .order("taken_at", { ascending: true }).limit(5000);
  if (e2) throw new Error(e2.message);
  const byDay = new Map<string, { day: string; followers: number; takenAt: string }>();
  for (const r of rows ?? []) byDay.set(String(r.taken_at).slice(0, 10), { day: String(r.taken_at).slice(0, 10), followers: Number(r.followers), takenAt: r.taken_at });
  const latest = rows?.length ? rows[rows.length - 1] : null;
  const first = rows?.length ? rows[0] : null;
  return {
    instagram: {
      handle: INSTAGRAM,
      followers: latest ? Number(latest.followers) : null,
      posts: latest?.posts ?? null,
      takenAt: latest?.taken_at ?? null,
      first: first ? { followers: Number(first.followers), takenAt: first.taken_at } : null,
      daily: [...byDay.values()],
      error,
    },
  };
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function weeks() {
  const { data, error } = await supabase
    .from("funnel_weeks")
    .select("platform, period_start, period_end, views, reach, profile_visits, link_clicks, source, taken_at")
    .order("period_end", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    platform: r.platform,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    views: r.views,
    reach: r.reach,
    profileVisits: r.profile_visits,
    linkClicks: r.link_clicks,
    source: r.source ?? "",
    takenAt: r.taken_at,
  }));
}

// Latest successful scan per clipper, plus the views gained since the first one.
async function clippers(admin: boolean) {
  const { data: accounts, error: e1 } = await supabase.from("clipper_accounts").select("username");
  if (e1) throw new Error(e1.message);
  const { data: snaps, error: e2 } = await supabase
    .from("clipper_snapshots")
    .select("username, taken_at, views, followers, videos")
    .eq("ok", true)
    .order("taken_at", { ascending: true })
    .limit(10000);
  if (e2) throw new Error(e2.message);
  const by = new Map<string, { first: any; last: any }>();
  for (const s of snaps ?? []) {
    const cur = by.get(s.username);
    if (!cur) by.set(s.username, { first: s, last: s });
    else cur.last = s;
  }
  const list = [...by.entries()].map(([username, { first, last }]) => ({
    username,
    views: last.views ?? 0,
    gained: (last.views ?? 0) - (first.views ?? 0),
    followers: last.followers ?? 0,
    videos: last.videos ?? 0,
    scannedAt: last.taken_at,
  })).sort((a, b) => b.views - a.views);
  return {
    count: (accounts ?? []).length,
    scanned: list.length,
    views: list.reduce((n, c) => n + c.views, 0),
    gained: list.reduce((n, c) => n + c.gained, 0),
    lastScan: list.reduce((m: string | null, c) => (!m || c.scannedAt > m ? c.scannedAt : m), null),
    ...(admin ? { list } : {}),
  };
}

async function view(admin: boolean) {
  const [w, c] = await Promise.all([weeks(), clippers(admin)]);
  return { weeks: w, clippers: c };
}

async function checkAdmin(req: Request): Promise<"ok" | "denied" | "unavailable"> {
  const secret = req.headers.get("x-admin-secret") ?? "";
  if (!secret || secret.length > 512) return "denied";
  const res = await fetch(`${SUPABASE_URL}/functions/v1/access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
      "apikey": ANON_KEY,
      "x-admin-secret": secret,
    },
    body: JSON.stringify({ action: "admin.stats" }),
  });
  await res.body?.cancel();
  if (res.ok) return "ok";
  if (res.status === 404 || res.status >= 500) return "unavailable";
  return "denied";
}

const day = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;
const count = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new Error("Ogiltigt tal.");
  return Math.round(n);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Använd POST." }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Ogiltigt innehåll." }, 400);
  }
  const action = String(body.action ?? "");
  try {
    if (action === "public.stats") return json(req, await view(false));
    if (action === "public.social") return json(req, await social());
    if (!action.startsWith("admin.")) return json(req, { error: "Okänd åtgärd." }, 400);
    const admin = await checkAdmin(req);
    if (admin === "unavailable") return json(req, { error: "Access-funktionen svarar inte ännu." }, 503);
    if (admin === "denied") return json(req, { error: "Fel admin-nyckel." }, 401);

    if (action === "admin.stats") return json(req, await view(true));
    if (action === "admin.saveWeek" || action === "admin.deleteWeek") {
      const platform = String(body.platform ?? "");
      const start = day(body.periodStart), end = day(body.periodEnd);
      if (!PLATFORMS.has(platform) || !start || !end || end < start) {
        return json(req, { error: "Välj plattform och en giltig period." }, 400);
      }
      if (action === "admin.deleteWeek") {
        const { error } = await supabase.from("funnel_weeks").delete()
          .eq("platform", platform).eq("period_start", start).eq("period_end", end);
        if (error) throw new Error(error.message);
        return json(req, await view(true));
      }
      let row;
      try {
        row = {
          platform, period_start: start, period_end: end,
          views: count(body.views), reach: count(body.reach),
          profile_visits: count(body.profileVisits), link_clicks: count(body.linkClicks),
          source: String(body.source ?? "").slice(0, 200) || "Inmatat i dashboarden",
          taken_at: new Date().toISOString(),
        };
      } catch (e) {
        return json(req, { error: (e as Error).message }, 400);
      }
      const { error } = await supabase.from("funnel_weeks").upsert(row);
      if (error) throw new Error(error.message);
      return json(req, await view(true));
    }
    return json(req, { error: "Okänd åtgärd." }, 400);
  } catch (e) {
    console.error("funnel:", (e as Error).message);
    return json(req, { error: "Kunde inte hämta tratten. Försök igen." }, 500);
  }
});
