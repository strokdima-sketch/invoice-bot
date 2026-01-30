const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function toMinorUnits(amountNumber) {
  // amountNumber: 1500 или 1500.50
  return Math.round(Number(amountNumber) * 100);
}

async function createCheckoutSession({ amount, currency, client, service }) {
  const successUrl = process.env.STRIPE_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CANCEL_URL;

  if (!successUrl || !cancelUrl) {
    throw new Error("STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL is not set");
  }

  const cur = String(currency || "").toLowerCase(); // pln/eur/usd

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: cur,
          product_data: {
            name: service ? String(service) : "Service",
            description: client ? `Client: ${client}` : undefined,
          },
          unit_amount: toMinorUnits(amount),
        },
      },
    ],
    metadata: {
      client: client || "",
      service: service || "",
    },
  });

  return session;
}

module.exports = { createCheckoutSession };
