require("dotenv").config();
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function upsertPlan(nome, valorCentavos, planoId) {
  const product = await stripe.products.create({
    name: `Minutei — ${nome}`,
    metadata: { plano: planoId },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: valorCentavos,
    currency: "brl",
    recurring: { interval: "month" },
  });
  console.log(`${nome}: product=${product.id} price=${price.id}`);
  return price.id;
}

(async () => {
  await upsertPlan("Autônomo", 4900, "autonomo");
  await upsertPlan("Imobiliária", 14900, "imobiliaria");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
