// Browser-only: loads Razorpay Checkout and resolves once the payment has been
// verified server-side and the plan activated.

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { email?: string | undefined; name?: string | undefined };
  theme?: { color?: string };
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load Razorpay. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export class CheckoutCancelled extends Error {
  override name = "CheckoutCancelled";
}

export async function openRazorpayCheckout(params: {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  email?: string | undefined;
  name?: string | undefined;
  confirm: (r: {
    orderId: string;
    paymentId: string;
    signature: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}): Promise<void> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("Razorpay failed to initialise.");

  return new Promise<void>((resolve, reject) => {
    const rzp = new Razorpay({
      key: params.keyId,
      order_id: params.orderId,
      amount: params.amount,
      currency: params.currency,
      name: "DataSimplr",
      description: params.description,
      prefill: { email: params.email, name: params.name },
      theme: { color: "#16a34a" },
      handler: (response) => {
        params
          .confirm({
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          })
          .then((r) =>
            r.ok ? resolve() : reject(new Error(r.error ?? "Could not activate your purchase.")),
          )
          .catch(reject);
      },
      modal: { ondismiss: () => reject(new CheckoutCancelled("Checkout closed.")) },
    });
    // A failed attempt keeps the modal open so the buyer can retry with
    // another method; only closing the modal ends the flow.
    rzp.open();
  });
}
