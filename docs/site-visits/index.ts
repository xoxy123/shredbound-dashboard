// Shredbound store traffic: page views and buy-button clicks on
// quantativestudios.com, per traffic source, for the dashboard's Försäljning tab.
// William, 2026-11-23: "how many people entered the site ... and also to see from
// where they came like 1000 visits from instagram".
//
// Deployed as the "site-visits" edge function with verify_jwt OFF: the store page
// has no Supabase key, so "track" checks its own input and rate-limits per IP
// (through access_hit, as the access function does). Table and stats function:
// docs/site-visits/schema.sql (public.site_visits, RLS on, no policies).
//
// The store page (repo xoxy123/quantative-game-garden, src/lib/traffic.ts) sends
// text/plain JSON so the browser needs no CORS preflight:
//   track        {kind:"view"|"buy", source, path, tier?}  -> 204
// The dashboard sends:
//   public.stats  -> {ok, days, since, totals, sources[], daily[], tiers[]}
// Stats are counts only (no visitor ids), so they are public like the sale count.
// The store's privacy policy promises no cookies, nothing stored on the device and
// no IP addresses kept, so the page sends no id at all. A unique visitor is
// counted as sha256(today's salt, IP, user agent): the salt is random per UTC day
// (public.site_visit_salts) and deleted after a day, so the id cannot be traced
// back to an IP and the same person counts once per day. Neither the IP nor the
// user agent is stored.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Only the live store records visits; the Lovable preview and local builds are
// William's own and would inflate the numbers.
const STORE_ORIGINS = new Set(["https://quantativestudios.com", "https://www.quantativestudios.com"]);
const DASHBOARD_ORIGINS = new Set(["https://xoxy123.github.io", "http://127.0.0.1:4318", "http://localhost:4318"]);

const STATS_DAYS = 60;
const MAX_BODY_BYTES = 2048;
// Per IP and 10 minutes. A reader clicking around the site stays far below this.
const LIMIT_WINDOW_SECONDS = 600;
const TRACK_PER_IP = 120;

const SLUG = /^[a-z0-9_-]{1,32}$/;
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|monitor/i;

// Short or misspelled sources William may put in a link (?utm_source=ig).
const ALIASES: Record<string, string> = {
  ig: "instagram", insta: "instagram", instagram_bio: "instagram",
  tt: "tiktok", tik_tok: "tiktok",
  yt: "youtube",
  fb: "facebook",
  twitter: "x", t_co: "x",
  dc: "discord",
};

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (STORE_ORIGINS.has(origin) || DASHBOARD_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const first = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

export function cleanSource(value: unknown): string {
  const raw = String(value ?? "").toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  const source = ALIASES[raw] ?? raw;
  return SLUG.test(source) ? source : "direct";
}

function cleanPath(value: unknown): string {
  const path = String(value ?? "/").split(/[?#]/)[0].replace(/[^A-Za-z0-9/_.-]/g, "").slice(0, 80);
  return path.startsWith("/") ? path : "/" + path;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { ok: false, error: "bad_request" }, 405);

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return reply(req, { ok: false, error: "bad_request" }, 413);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return reply(req, { ok: false, error: "bad_request" }, 400);
  }

  const action = String(body.action ?? "");
  try {
    if (action === "track") {
      // Silently ignore what should not count; the page never reads the answer.
      const origin = req.headers.get("Origin") ?? "";
      if (!STORE_ORIGINS.has(origin) || BOT.test(req.headers.get("user-agent") ?? "")) return reply(req, null, 204);
      const kind = body.kind === "buy" ? "buy" : body.kind === "view" ? "view" : null;
      if (!kind) return reply(req, { ok: false, error: "bad_request" }, 400);

      const ip = clientIp(req);
      const ipHash = (await sha256(ip)).slice(0, 24);
      const { data: hits, error: hitError } = await supabase.rpc("access_hit", {
        p_bucket: "visit-ip:" + ipHash,
        p_window_seconds: LIMIT_WINDOW_SECONDS,
      });
      if (hitError) throw new Error(hitError.message);
      if (Number(hits ?? 0) > TRACK_PER_IP) return reply(req, null, 204);

      const { data: salt, error: saltError } = await supabase.rpc("site_visit_salt");
      if (saltError || !salt) throw new Error(saltError?.message ?? "no salt");
      const visitor = (await sha256(`${salt}|${ip}|${req.headers.get("user-agent") ?? ""}`)).slice(0, 32);
      const tier = kind === "buy" ? String(body.tier ?? "").toLowerCase() : "";
      const { error } = await supabase.from("site_visits").insert({
        kind,
        source: cleanSource(body.source),
        path: cleanPath(body.path),
        visitor,
        tier: SLUG.test(tier) ? tier : null,
      });
      if (error) throw new Error(error.message);
      return reply(req, null, 204);
    }

    if (action === "public.stats") {
      const { data, error } = await supabase.rpc("site_visit_stats", { p_days: STATS_DAYS });
      if (error) throw new Error(error.message);
      return reply(req, { ok: true, ...(data as Record<string, unknown>) });
    }

    return reply(req, { ok: false, error: "bad_request" }, 400);
  } catch (e) {
    console.error("site-visits:", (e as Error).message);
    return reply(req, { ok: false, error: "server" }, 500);
  }
});
