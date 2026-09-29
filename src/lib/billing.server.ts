// Server-only billing helpers. Never import this from route files or
// *.functions.ts at the top level — load it inside handlers with
// `await import("@/lib/billing.server")` so secrets never reach the client bundle.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getServerEnv } from "@/lib/server-env";
import { productAmount, type Currency, type Product } from "@/lib/plans";

const RAZORPAY_API = "https://api.razorpay.com/v1";

export class BillingConfigError extends Error {
  override name = "BillingConfigError";
}

function requireEnv(name: string): string {
  const value = getServerEnv(name);
  if (!value)
    throw new BillingConfigError(
      `${name} is not set. Add it to .env.local (and to the Workers secrets for production).`,
    );
  return value;
}

// Admin client built from getServerEnv (the generated client.server.ts reads
// process.env only, which is unreliable on Workers — see server-env.ts).
export function adminClient() {
  return createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    },
  );
}

function razorpayAuthHeader(): string {
  return `Basic ${btoa(`${requireEnv("RAZORPAY_KEY_ID")}:${requireEnv("RAZORPAY_KEY_SECRET")}`)}`;
}

export function razorpayKeyId(): string {
  return requireEnv("RAZORPAY_KEY_ID");
}

type OrderNotes = {
  user_id: string;
  product: string; // JSON-encoded Product
  currency: Currency;
};

export type RazorpayOrder = {
  id: string;
  amount: number;
  amount_paid: number;
  currency: string;
  status: "created" | "attempted" | "paid";
  notes: OrderNotes;
};

export async function createRazorpayOrder(
  userId: string,
  product: Product,
  currency: Currency,
): Promise<RazorpayOrder> {
  const amount = productAmount(product, currency);
  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: { Authorization: razorpayAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount,
      currency,
      // Razorpay caps receipt at 40 chars.
      receipt: `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`,
      notes: { user_id: userId, product: JSON.stringify(product), currency } satisfies OrderNotes,
    }),
  });
  if (!res.ok) throw new Error(`Razorpay order failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as RazorpayOrder;
}

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrder> {
  const res = await fetch(`${RAZORPAY_API}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: razorpayAuthHeader() },
  });
  if (!res.ok) throw new Error(`Could not load Razorpay order (${res.status}).`);
  return (await res.json()) as RazorpayOrder;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret).
export async function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(
    requireEnv("RAZORPAY_KEY_SECRET"),
    `${orderId}|${paymentId}`,
  );
  return timingSafeEqual(expected, signature);
}

// Webhook signature: HMAC_SHA256(raw body, webhook secret).
export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  const expected = await hmacSha256Hex(requireEnv("RAZORPAY_WEBHOOK_SECRET"), rawBody);
  return timingSafeEqual(expected, signature);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addInterval(from: Date, interval: "month" | "year"): Date {
  const d = new Date(from);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

// Turns a paid Razorpay order into an entitlement row. Idempotent: the
// checkout callback and the webhook can both call it for the same payment —
// the unique razorpay_payment_id / razorpay_order_id columns make the second
// insert a no-op. The order's notes (set server-side at creation) are the only
// source of what was bought; nothing from the browser is trusted here.
export async function grantPaidOrder(order: RazorpayOrder, paymentId: string): Promise<void> {
  if (order.status !== "paid" && order.amount_paid < order.amount) {
    throw new Error("That payment hasn't completed yet.");
  }
  const product = JSON.parse(order.notes.product) as Product;
  const userId = order.notes.user_id;
  const currency = order.notes.currency;
  if (productAmount(product, currency) !== order.amount) throw new Error("Order amount mismatch.");

  const db = adminClient();

  const { data: existing } = await db
    .from("subscriptions")
    .select("id")
    .eq("razorpay_order_id", order.id)
    .maybeSingle();
  const { data: existingCredit } = await db
    .from("report_credits")
    .select("id")
    .eq("razorpay_order_id", order.id)
    .maybeSingle();
  if (existing || existingCredit) return;

  if (product.kind === "report_pass") {
    const { error } = await db.from("report_credits").insert({
      user_id: userId,
      razorpay_order_id: order.id,
      razorpay_payment_id: paymentId,
      amount: order.amount,
      currency,
    });
    if (error && error.code !== "23505") throw error;
    return;
  }

  const teamId = product.kind === "team" ? product.teamId : null;
  const plan = product.kind === "team" ? "team" : product.plan;

  // Buying again before the current paid period ends extends it rather than
  // overlapping. Trials are replaced immediately (paid starts now).
  let query = db
    .from("subscriptions")
    .select("period_end, seats")
    .eq("plan", plan)
    .neq("source", "trial")
    .gt("period_end", new Date().toISOString())
    .order("period_end", { ascending: false })
    .limit(1);
  query = teamId ? query.eq("team_id", teamId) : query.eq("user_id", userId).is("team_id", null);
  const { data: current } = await query.maybeSingle();

  // Adding seats to a team takes effect now (the larger seat count wins while
  // periods overlap); a straight renewal queues after the current period.
  const addsSeats = product.kind === "team" && !!current && (current.seats ?? 0) < product.seats;
  const start = current && !addsSeats ? new Date(current.period_end) : new Date();
  const end = addInterval(start, product.interval);
  // Guard against clock/format surprises producing a zero-length period.
  if (end.getTime() - start.getTime() < DAY_MS) throw new Error("Invalid billing period.");

  const { error } = await db.from("subscriptions").insert({
    user_id: userId,
    team_id: teamId,
    plan,
    source: "razorpay",
    billing_interval: product.interval,
    seats: product.kind === "team" ? product.seats : null,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    razorpay_order_id: order.id,
    razorpay_payment_id: paymentId,
    amount: order.amount,
    currency,
  });
  if (error && error.code !== "23505") throw error;
}

// ---------------------------------------------------------------------------
// Transactional email (team invites) via Brevo
// ---------------------------------------------------------------------------

export function emailConfigured(): boolean {
  return !!getServerEnv("BREVO_API_KEY") && !!getServerEnv("BREVO_SENDER_EMAIL");
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export async function sendInviteEmail(params: {
  to: string;
  teamName: string;
  inviterName: string;
  link: string;
}) {
  const teamName = escapeHtml(params.teamName);
  const inviterName = escapeHtml(params.inviterName);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": requireEnv("BREVO_API_KEY"),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: requireEnv("BREVO_SENDER_EMAIL"),
        name: getServerEnv("BREVO_SENDER_NAME") ?? "DataSimplr",
      },
      to: [{ email: params.to }],
      subject: `${params.inviterName} invited you to ${params.teamName} on DataSimplr`,
      htmlContent: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
<h2 style="margin:0 0 12px">Join ${teamName} on DataSimplr</h2>
<p>${inviterName} invited you to their team workspace, where you can open shared datasets and reports.</p>
<p style="margin:28px 0"><a href="${params.link}" style="background:#16a34a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Accept invite</a></p>
<p style="color:#666;font-size:13px">This link expires in 7 days. Sign in with ${escapeHtml(params.to)} to accept.</p>
</div>`,
    }),
  });
  if (!res.ok) throw new Error(`Brevo send failed (${res.status}): ${await res.text()}`);
}
