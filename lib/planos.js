/**
 * Definição dos planos e seus limites. Sem processador de pagamento
 * integrado ainda — upgrades são manuais (o dono da conta pede por
 * e-mail, e o campo `plano` do tenant é atualizado diretamente).
 */
const PLANOS = {
  gratis: { nome: "Grátis", contratosPorMes: 1, maxUsuarios: 1 },
  autonomo: { nome: "Autônomo", contratosPorMes: Infinity, maxUsuarios: 1, stripePriceId: process.env.STRIPE_PRICE_AUTONOMO },
  imobiliaria: { nome: "Imobiliária", contratosPorMes: Infinity, maxUsuarios: 5, stripePriceId: process.env.STRIPE_PRICE_IMOBILIARIA },
  rede: { nome: "Rede", contratosPorMes: Infinity, maxUsuarios: Infinity },
};

function limitesDoPlano(planoId) {
  return PLANOS[planoId] || PLANOS.gratis;
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function contratosUsadosNoMes(tenant) {
  const uso = tenant.usoMensal || {};
  return uso[mesAtual()] || 0;
}

module.exports = { PLANOS, limitesDoPlano, mesAtual, contratosUsadosNoMes };
