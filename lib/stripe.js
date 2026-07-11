const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("STRIPE_SECRET_KEY não definida — checkout de pagamento ficará indisponível.");
}

module.exports = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
