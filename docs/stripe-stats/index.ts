// Shredbound Stripe stats: sales from quantativestudios.com's Stripe account
// (pre-orders of Shredbound) for the Shredbound dashboard's Försäljning tab.
// Deployed as the "stripe-stats" edge function (verify_jwt on, like "store-stats").
// The Stripe key never reaches a browser: it lives in the STRIPE_API_KEY secret or
// in public.store_config (RLS on, no policies, service role only), and only this
// function reads it. Use a restricted, read-only key.
//
// Actions (POST JSON {action, ...}):
//   public.stats     number of paid sales only, no amounts and no customer data
//   admin.stats      everything: revenue, fees, net, refunds, balance, payouts,
//                    disputes, checkout conversion, per-day and per-country sales,
//                    and the payment list (x-admin-secret header)
//   admin.setKey     {key}: checks the key against Stripe, then stores it
//   admin.clearKey   removes the stored key and the cached numbers
//   admin.refresh    ignores the cache once
// The admin secret is checked by the "access" function, which owns it, exactly as
// in store-stats. This function never stores or logs the secret.
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
// Stripe is asked at most once per this many seconds; the dashboard polls.
const CACHE_SECONDS = 300;
const KEY_ROW = "stripe_api_key";
const CACHE_ROW = "stripe_cache";
// At most this many charges are read (100 per page).
const MAX_PAGES = 20;

type Money = Record<string, number>; // currency (upper case) -> minor units
type Payment = {
  id: string;
  created: string;
  amount: number;
  currency: string;
  refunded: number;
  status: "paid" | "refunded" | "partial_refund" | "failed" | "blocked" | "disputed" | "pending";
  fee: number | null;
  net: number | null;
  settleCurrency: string | null;
  method: string;
  country: string;
  name: string;
  email: string;
  reason: string;
  receiptUrl: string;
};
type Stats = {
  at: string;
  account: { name: string; url: string; currency: string };
  totals: {
    sales: number;
    refunds: number;
    failed: number;
    blocked: number;
    disputes: number;
    customers: number;
    gross: Money;
    refunded: Money;
    fees: Money;
    net: Money;
  };
  balance: { available: Money; pending: Money };
  checkout: { complete: number; expired: number; open: number } | null;
  daily: { day: string; sales: number; gross: Money }[];
  countries: { country: string; sales: number; gross: Money }[];
  payments: Payment[];
  payouts: { id: string; arrival: string; amount: number; currency: string; status: string }[];
  disputes: { id: string; created: string; amount: number; currency: string; status: string; reason: string }[];
  truncated: boolean;
};

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

async function stripeKey(): Promise<string | null> {
  return Deno.env.get("STRIPE_API_KEY") || (await readRow(KEY_ROW));
}

// GET https://api.stripe.com/v1/<path> with the key as a bearer token.
async function stripe(key: string, path: string, params: Record<string, string | string[]> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}${q.size ? "?" + q : ""}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" },
  });
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    throw new Error("Stripe svarade inte med data.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("Stripe godkände inte nyckeln.");
    if (res.status === 403) {
      throw new Error(`Nyckeln saknar läsrätt i Stripe (${path.split("/")[0]}). Ge den läsrätt och koppla igen.`);
    }
    throw new Error("Stripe svarade inte. Försök igen senare.");
  }
  return body;
}

// Optional reads: a restricted key without that permission just leaves the part empty.
async function optional<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    if (/läsrätt/.test((e as Error).message)) return null;
    throw e;
  }
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const add = (m: Money, currency: string, amount: number) => {
  const c = currency.toUpperCase();
  m[c] = (m[c] ?? 0) + amount;
};
const money = (list: unknown): Money => {
  const out: Money = {};
  for (const b of (list as { amount: number; currency: string }[] | undefined) ?? []) add(out, b.currency, b.amount);
  return out;
};

function statusOf(c: Record<string, any>): Payment["status"] {
  if (c.disputed) return "disputed";
  if (c.status === "failed") return c.outcome?.type === "blocked" ? "blocked" : "failed";
  if (c.status === "pending") return "pending";
  if (c.refunded) return "refunded";
  if (c.amount_refunded > 0) return "partial_refund";
  return "paid";
}

async function fetchStats(key: string): Promise<Stats> {
  const account = await optional(() => stripe(key, "account")) as Record<string, any> | null;

  const charges: Record<string, any>[] = [];
  let after = "";
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string | string[]> = { limit: "100", "expand[]": ["data.balance_transaction"] };
    if (after) params.starting_after = after;
    const body = await stripe(key, "charges", params) as { data: Record<string, any>[]; has_more: boolean };
    charges.push(...body.data);
    if (!body.has_more || !body.data.length) break;
    after = body.data[body.data.length - 1].id;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const [balance, payouts, disputes, sessions] = await Promise.all([
    optional(() => stripe(key, "balance")),
    optional(() => stripe(key, "payouts", { limit: "20" })),
    optional(() => stripe(key, "disputes", { limit: "20" })),
    optional(() => stripe(key, "checkout/sessions", { limit: "100" })),
  ]) as (Record<string, any> | null)[];

  const totals: Stats["totals"] = {
    sales: 0, refunds: 0, failed: 0, blocked: 0, disputes: 0, customers: 0,
    gross: {}, refunded: {}, fees: {}, net: {},
  };
  const daily = new Map<string, { day: string; sales: number; gross: Money }>();
  const countries = new Map<string, { country: string; sales: number; gross: Money }>();
  const buyers = new Set<string>();
  const payments: Payment[] = charges.map((c) => {
    const status = statusOf(c);
    const bt = typeof c.balance_transaction === "object" ? c.balance_transaction : null;
    const country = String(c.billing_details?.address?.country ?? c.payment_method_details?.card?.country ?? "").toUpperCase();
    const email = String(c.billing_details?.email ?? c.receipt_email ?? "");
    if (c.paid && c.status === "succeeded") {
      totals.sales++;
      add(totals.gross, c.currency, c.amount);
      if (c.amount_refunded > 0) {
        totals.refunds++;
        add(totals.refunded, c.currency, c.amount_refunded);
      }
      if (bt) {
        add(totals.fees, bt.currency, bt.fee);
        add(totals.net, bt.currency, bt.net);
      }
      if (email) buyers.add(email.toLowerCase());
      const day = iso(c.created).slice(0, 10);
      const d = daily.get(day) ?? { day, sales: 0, gross: {} };
      d.sales++;
      add(d.gross, c.currency, c.amount);
      daily.set(day, d);
      const k = country || "??";
      const ct = countries.get(k) ?? { country: k, sales: 0, gross: {} };
      ct.sales++;
      add(ct.gross, c.currency, c.amount);
      countries.set(k, ct);
    } else if (status === "blocked") totals.blocked++;
    else if (status === "failed") totals.failed++;
    if (c.disputed) totals.disputes++;
    return {
      id: String(c.id),
      created: iso(c.created),
      amount: c.amount,
      currency: String(c.currency).toUpperCase(),
      refunded: c.amount_refunded ?? 0,
      status,
      fee: bt ? bt.fee : null,
      net: bt ? bt.net : null,
      settleCurrency: bt ? String(bt.currency).toUpperCase() : null,
      method: String(c.payment_method_details?.card?.brand ?? c.payment_method_details?.type ?? ""),
      country,
      name: String(c.billing_details?.name ?? ""),
      email,
      reason: status === "paid" ? "" : String(c.outcome?.seller_message ?? c.failure_message ?? ""),
      receiptUrl: typeof c.receipt_url === "string" && c.receipt_url.startsWith("https://") ? c.receipt_url : "",
    };
  });
  // fees and net come from each charge's balance transaction, in the settlement
  // currency, before refunds (refunds are listed separately in charge currency).
  totals.customers = buyers.size;

  let checkout: Stats["checkout"] = null;
  if (sessions) {
    checkout = { complete: 0, expired: 0, open: 0 };
    for (const s of sessions.data as Record<string, any>[]) {
      if (s.status === "complete") checkout.complete++;
      else if (s.status === "expired") checkout.expired++;
      else if (s.status === "open") checkout.open++;
    }
  }

  return {
    at: new Date().toISOString(),
    account: {
      name: String(account?.business_profile?.name ?? account?.settings?.dashboard?.display_name ?? "Stripe"),
      url: String(account?.business_profile?.url ?? ""),
      currency: String(account?.default_currency ?? "").toUpperCase(),
    },
    totals,
    balance: { available: money(balance?.available), pending: money(balance?.pending) },
    checkout,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    countries: [...countries.values()].sort((a, b) => b.sales - a.sales),
    payments,
    payouts: ((payouts?.data ?? []) as Record<string, any>[]).map((p) => ({
      id: String(p.id),
      arrival: iso(p.arrival_date),
      amount: p.amount,
      currency: String(p.currency).toUpperCase(),
      status: String(p.status),
    })),
    disputes: ((disputes?.data ?? []) as Record<string, any>[]).map((d) => ({
      id: String(d.id),
      created: iso(d.created),
      amount: d.amount,
      currency: String(d.currency).toUpperCase(),
      status: String(d.status),
      reason: String(d.reason ?? ""),
    })),
    truncated,
  };
}

async function stats(force = false): Promise<Stats | null> {
  const key = await stripeKey();
  if (!key) return null;
  if (!force) {
    const cached = await readRow(CACHE_ROW);
    if (cached) {
      const c = JSON.parse(cached) as Stats;
      if (Date.now() - Date.parse(c.at) < CACHE_SECONDS * 1000) return c;
    }
  }
  const fresh = await fetchStats(key);
  await writeRow(CACHE_ROW, JSON.stringify(fresh));
  return fresh;
}

// The public dashboard sees only how many sales there are.
function view(s: Stats | null, admin: boolean) {
  if (!s) return { connected: false };
  if (!admin) {
    return { connected: true, updatedAt: s.at, account: { name: s.account.name, url: s.account.url }, totals: { sales: s.totals.sales } };
  }
  const { at, ...rest } = s;
  return { connected: true, updatedAt: at, ...rest };
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
        return json(req, view(await stats(), false));
      } catch (e) {
        return json(req, { connected: true, error: (e as Error).message }, 200);
      }
    }
    if (!action.startsWith("admin.")) return json(req, { error: "Okänd åtgärd." }, 400);
    const admin = await checkAdmin(req);
    if (admin === "unavailable") return json(req, { error: "Access-funktionen svarar inte ännu." }, 503);
    if (admin === "denied") return json(req, { error: "Fel admin-nyckel." }, 401);

    if (action === "admin.stats" || action === "admin.refresh") {
      try {
        return json(req, view(await stats(action === "admin.refresh"), true));
      } catch (e) {
        return json(req, { connected: true, error: (e as Error).message }, 200);
      }
    }
    if (action === "admin.setKey") {
      const key = String(body.key ?? "").trim();
      if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{10,250}$/.test(key)) {
        return json(req, { error: "Det ser inte ut som en Stripe-nyckel (rk_live_… eller sk_live_…)." }, 400);
      }
      let fresh: Stats;
      try {
        fresh = await fetchStats(key);
      } catch (e) {
        return json(req, { error: (e as Error).message }, 400);
      }
      await writeRow(KEY_ROW, key);
      await writeRow(CACHE_ROW, JSON.stringify(fresh));
      return json(req, view(fresh, true));
    }
    if (action === "admin.clearKey") {
      await deleteRows([KEY_ROW, CACHE_ROW]);
      return json(req, view(Deno.env.get("STRIPE_API_KEY") ? await stats(true) : null, true));
    }
    return json(req, { error: "Okänd åtgärd." }, 400);
  } catch (e) {
    console.error("stripe-stats:", (e as Error).message);
    return json(req, { error: "Kunde inte hämta Stripe-försäljningen. Försök igen." }, 500);
  }
});
