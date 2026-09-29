import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS, productLabel, type Product } from "@/lib/plans";

const productSchema: z.ZodType<Product> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"),
    plan: z.enum(["plus", "pro"]),
    interval: z.enum(["month", "year"]),
  }),
  z.object({
    kind: z.literal("team"),
    teamId: z.string().uuid(),
    seats: z.number().int().min(TEAM_MIN_SEATS).max(TEAM_MAX_SEATS),
    interval: z.enum(["month", "year"]),
  }),
  z.object({ kind: z.literal("report_pass") }),
]);

type Failure = { ok: false; error: string };

function failure(e: unknown, fallback: string): Failure {
  console.error(e);
  // Config problems (missing env vars) are safe, and useful, to show.
  if (e instanceof Error && e.name === "BillingConfigError") return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ product: productSchema, currency: z.enum(["INR", "USD"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    try {
      if (data.product.kind === "team") {
        const { data: isAdmin } = await context.supabase.rpc("is_team_admin", {
          _team: data.product.teamId,
        });
        if (!isAdmin)
          return { ok: false as const, error: "Only team owners and admins can buy seats." };
        const { count } = await context.supabase
          .from("team_members")
          .select("user_id", { count: "exact", head: true })
          .eq("team_id", data.product.teamId);
        if ((count ?? 0) > data.product.seats) {
          return {
            ok: false as const,
            error: `Your team already has ${count} members — choose at least that many seats.`,
          };
        }
      }
      const billing = await import("@/lib/billing.server");
      const order = await billing.createRazorpayOrder(context.userId, data.product, data.currency);
      return {
        ok: true as const,
        keyId: billing.razorpayKeyId(),
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        description: productLabel(data.product),
      };
    } catch (e) {
      return failure(e, "Could not start checkout. Please try again.");
    }
  });

export const confirmCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        orderId: z.string().min(1).max(64),
        paymentId: z.string().min(1).max(64),
        signature: z.string().min(1).max(256),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    try {
      const billing = await import("@/lib/billing.server");
      if (!(await billing.verifyCheckoutSignature(data.orderId, data.paymentId, data.signature))) {
        return {
          ok: false as const,
          error:
            "Payment signature didn't match. You have not been charged twice — contact support if money left your account.",
        };
      }
      const order = await billing.fetchRazorpayOrder(data.orderId);
      if (order.notes.user_id !== context.userId)
        return { ok: false as const, error: "That payment belongs to another account." };
      await billing.grantPaidOrder(order, data.paymentId);
      return { ok: true as const };
    } catch (e) {
      return failure(
        e,
        "Payment received but we couldn't activate it yet. It will activate automatically within a few minutes.",
      );
    }
  });

// Creates the invite with the caller's own RLS-scoped client (so the
// seat + admin checks in the team_invites policy apply), then emails it via
// Brevo when configured. The link is always returned so admins can copy it.
export const inviteTeammate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        teamId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email().max(254),
        role: z.enum(["admin", "member"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: seats } = await context.supabase.rpc("team_seats_available", {
      _team: data.teamId,
    });
    if ((seats ?? 0) <= 0) {
      return {
        ok: false as const,
        error: "No free seats. Add seats to your Team plan to invite more people.",
        needsSeats: true,
      };
    }
    const { data: invite, error } = await context.supabase
      .from("team_invites")
      .insert({
        team_id: data.teamId,
        email: data.email,
        role: data.role,
        invited_by: context.userId,
      })
      .select("token")
      .single();
    if (error) {
      if (error.code === "23505")
        return { ok: false as const, error: "That email already has a pending invite." };
      console.error(error);
      return {
        ok: false as const,
        error: "Could not create the invite. Only owners and admins can invite.",
      };
    }

    const origin = new URL(getRequest().url).origin;
    const link = `${origin}/invite/${invite.token}`;

    let emailed = false;
    let emailError: string | null = null;
    try {
      const billing = await import("@/lib/billing.server");
      if (billing.emailConfigured()) {
        const [{ data: team }, { data: profile }] = await Promise.all([
          context.supabase.from("teams").select("name").eq("id", data.teamId).single(),
          context.supabase
            .from("profiles")
            .select("display_name")
            .eq("id", context.userId)
            .maybeSingle(),
        ]);
        await billing.sendInviteEmail({
          to: data.email,
          teamName: team?.name ?? "your team",
          inviterName: profile?.display_name ?? "A teammate",
          link,
        });
        emailed = true;
      }
    } catch (e) {
      console.error(e);
      emailError = "The invite was created but the email didn't send — copy the link instead.";
    }
    return { ok: true as const, link, emailed, emailError };
  });
