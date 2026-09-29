import { createFileRoute } from "@tanstack/react-router";

// Razorpay → POST /api/razorpay-webhook (events: payment.captured, order.paid).
// Backup for the in-page confirmCheckout call: if the buyer closes the tab
// after paying, this still activates their plan. grantPaidOrder is idempotent.
export const Route = createFileRoute("/api/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const billing = await import("@/lib/billing.server");
        const raw = await request.text();
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        try {
          if (!signature || !(await billing.verifyWebhookSignature(raw, signature))) {
            return new Response("invalid signature", { status: 400 });
          }
        } catch (e) {
          console.error(e);
          return new Response("webhook not configured", { status: 500 });
        }

        const event = JSON.parse(raw) as {
          event: string;
          payload?: { payment?: { entity?: { id: string; order_id?: string } } };
        };
        if (event.event !== "payment.captured" && event.event !== "order.paid") {
          return new Response("ignored", { status: 200 });
        }
        const payment = event.payload?.payment?.entity;
        if (!payment?.order_id) return new Response("no order", { status: 200 });

        try {
          const order = await billing.fetchRazorpayOrder(payment.order_id);
          // Orders not created by DataSimplr checkout have no product note.
          if (!order.notes?.product) return new Response("ignored", { status: 200 });
          await billing.grantPaidOrder(order, payment.id);
          return new Response("ok", { status: 200 });
        } catch (e) {
          console.error(e);
          // Non-2xx makes Razorpay retry.
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});
