/**
 * Definição dos planos e seus limites. Pagamento via Stripe Checkout
 * (ver lib/stripe.js e /api/billing/*). Cada plano pago tem um preço
 * mensal e, opcionalmente, um preço anual (com desconto) — ambos vêm
 * de variáveis de ambiente com os IDs de preço criados no painel do
 * Stripe. Se o preço anual não estiver configurado, o checkout anual
 * cai para o mensal.
 */
const PLANOS = {
  gratis: { nome: "Grátis", contratosPorMes: 1, maxUsuarios: 1 },
  autonomo: {
    nome: "Autônomo", contratosPorMes: Infinity, maxUsuarios: 1,
    stripePriceId: process.env.STRIPE_PRICE_AUTONOMO,
    stripePriceIdAnual: process.env.STRIPE_PRICE_AUTONOMO_ANUAL,
  },
  imobiliaria: {
    nome: "Imobiliária", contratosPorMes: Infinity, maxUsuarios: 5,
    stripePriceId: process.env.STRIPE_PRICE_IMOBILIARIA,
    stripePriceIdAnual: process.env.STRIPE_PRICE_IMOBILIARIA_ANUAL,
  },
  rede: { nome: "Rede", contratosPorMes: Infinity, maxUsuarios: Infinity },
};

function limitesDoPlano(planoId) {
  return PLANOS[planoId] || PLANOS.gratis;
}

// Resolve o ID de preço do Stripe para um plano e ciclo de cobrança.
// Ciclo "anual" cai para o preço mensal se o anual não estiver configurado.
function precoDoPlano(planoId, ciclo) {
  const plano = PLANOS[planoId];
  if (!plano) return null;
  if (ciclo === "anual" && plano.stripePriceIdAnual) return plano.stripePriceIdAnual;
  return plano.stripePriceId || null;
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function contratosUsadosNoMes(tenant) {
  const uso = tenant.usoMensal || {};
  return uso[mesAtual()] || 0;
}

module.exports = { PLANOS, limitesDoPlano, precoDoPlano, mesAtual, contratosUsadosNoMes };
