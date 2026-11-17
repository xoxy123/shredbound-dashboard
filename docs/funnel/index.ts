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
