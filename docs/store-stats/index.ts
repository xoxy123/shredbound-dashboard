// Shredbound store stats: downloads, page views, purchases and earnings per game
// from itch.io's server-side API, for the Shredbound dashboard's Försäljning tab.
// Deployed as the "store-stats" edge function (verify_jwt on, like "lobby" and
// "ranked"). The itch.io API key never reaches a browser: it lives in the
// ITCH_API_KEY secret or in public.store_config (RLS on, no policies, service
// role only), and only this function reads it.
//
// Actions (POST JSON {action, ...}):
//   public.stats     downloads, views and purchases per game, no earnings
//   admin.stats      the same plus earnings (x-admin-secret header)
//   admin.setKey     {key}: checks the key against itch.io, then stores it
//   admin.clearKey   removes the stored key and the cached numbers
// The admin secret is checked by the "access" function, which owns it: this
// function forwards the x-admin-secret header to access's admin.stats and only
// trusts a 2xx answer. It never stores or logs the secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// The public dashboard (GitHub Pages) and its local dev server.
const ORIGINS = new Set([
  "https://xoxy123.github.io",
  "http://127.0.0.1:4318",
  "http://localhost:4318",
]);
// itch.io is asked at most once per this many seconds; the dashboard polls.
const CACHE_SECONDS = 600;
const KEY_ROW = "itch_api_key";
const CACHE_ROW = "itch_cache";

type Earning = { currency: string; amount: number };
type Game = {
  id: string;
  title: string;
  url: string;
  published: boolean;
  downloads: number | null;
  views: number | null;
  purchases: number | null;
  earnings: Earning[];
};
type Cache = { at: string; games: Game[] };

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

const count = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};

async function readRow(key: string): Promise<string | null> {
  const { data, error } = await supabase.from("store_config").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? null;
}

async function writeRow(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from("store_config")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

async function deleteRows(keys: string[]): Promise<void> {
  const { error } = await supabase.from("store_config").delete().in("key", keys);
  if (error) throw new Error(error.message);
}

async function itchKey(): Promise<string | null> {
  return Deno.env.get("ITCH_API_KEY") || (await readRow(KEY_ROW));
}

// GET https://itch.io/api/1/<KEY>/my-games. Earnings arrive in cents.
async function fetchGames(key: string): Promise<Game[]> {
  const res = await fetch(`https://itch.io/api/1/${encodeURIComponent(key)}/my-games`);
  let body: { games?: unknown[]; errors?: string[] } = {};
  try {
    body = await res.json();
  } catch {
    throw new Error("itch.io svarade inte med data.");
  }
  if (!res.ok || body.errors?.length) {
    throw new Error(res.status === 401 || res.status === 403 || body.errors?.length
      ? "itch.io godkände inte API-nyckeln."
      : "itch.io svarade inte. Försök igen senare.");
  }
  return (body.games ?? []).map((raw) => {
    const g = raw as Record<string, unknown>;
    const earnings = Array.isArray(g.earnings) ? g.earnings as Record<string, unknown>[] : [];
    return {
      id: String(g.id ?? ""),
      title: String(g.title ?? "Spel"),
      url: typeof g.url === "string" && g.url.startsWith("https://") ? g.url : "",
      published: !!g.published,
      downloads: count(g.downloads_count),
      views: count(g.views_count),
      purchases: count(g.purchases_count),
      earnings: earnings
        .map((e) => ({ currency: String(e.currency ?? "").toUpperCase(), amount: count(e.amount) ?? NaN }))
        .filter((e) => /^[A-Z]{3}$/.test(e.currency) && Number.isFinite(e.amount)),
    };
  });
}

async function games(force = false): Promise<Cache | null> {
  const key = await itchKey();
  if (!key) return null;
  if (!force) {
    const cached = await readRow(CACHE_ROW);
    if (cached) {
      const c = JSON.parse(cached) as Cache;
      if (Date.now() - Date.parse(c.at) < CACHE_SECONDS * 1000) return c;
    }
  }
  const fresh: Cache = { at: new Date().toISOString(), games: await fetchGames(key) };
  await writeRow(CACHE_ROW, JSON.stringify(fresh));
  return fresh;
}

function view(cache: Cache | null, admin: boolean) {
  if (!cache) return { connected: false, games: [] };
  return {
    connected: true,
    updatedAt: cache.at,
    games: cache.games.map((g) => ({
      id: g.id,
      title: g.title,
      url: g.url,
      published: g.published,
      downloads: g.downloads,
      views: g.views,
      purchases: g.purchases,
      ...(admin ? { earnings: g.earnings } : {}),
    })),
  };
}

// 200 from access's admin.stats means the secret is William's. 404 means access
// is not deployed yet; anything else is a wrong or missing secret.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Använd POST." }, 405);
  let body: { action?: string; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Ogiltigt innehåll." }, 400);
  }
  const action = String(body.action ?? "");
  try {
    if (action === "public.stats") {
      try {
        return json(req, view(await games(), false));
      } catch (e) {
        return json(req, { connected: true, games: [], error: (e as Error).message }, 200);
      }
    }
    if (!action.startsWith("admin.")) return json(req, { error: "Okänd åtgärd." }, 400);
    const admin = await checkAdmin(req);
    if (admin === "unavailable") return json(req, { error: "Access-funktionen svarar inte ännu." }, 503);
    if (admin === "denied") return json(req, { error: "Fel admin-nyckel." }, 401);

    if (action === "admin.stats") {
      try {
        return json(req, view(await games(), true));
      } catch (e) {
        return json(req, { connected: true, games: [], error: (e as Error).message }, 200);
      }
    }
    if (action === "admin.setKey") {
      const key = String(body.key ?? "").trim();
      if (!/^[A-Za-z0-9_\-]{10,200}$/.test(key)) return json(req, { error: "Det ser inte ut som en itch.io API-nyckel." }, 400);
      let list: Game[];
      try {
        list = await fetchGames(key);
      } catch (e) {
        return json(req, { error: (e as Error).message }, 400);
      }
      const cache: Cache = { at: new Date().toISOString(), games: list };
      await writeRow(KEY_ROW, key);
      await writeRow(CACHE_ROW, JSON.stringify(cache));
      return json(req, view(cache, true));
    }
    if (action === "admin.clearKey") {
      await deleteRows([KEY_ROW, CACHE_ROW]);
      return json(req, view(Deno.env.get("ITCH_API_KEY") ? await games(true) : null, true));
    }
    return json(req, { error: "Okänd åtgärd." }, 400);
  } catch (e) {
    console.error("store-stats:", (e as Error).message);
    return json(req, { error: "Kunde inte hämta försäljningen. Försök igen." }, 500);
  }
});
