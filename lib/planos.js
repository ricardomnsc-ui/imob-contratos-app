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

// Status do Stripe em que a assinatura está de fato em dia.
const STATUS_COM_ACESSO = new Set(["active", "trialing"]);

// Tolerância enquanto o Stripe tenta cobrar de novo. Cartão falha por bobagem
// (limite, validade, banco fora do ar) e costuma passar na retentativa —
// cortar no primeiro dia derrubaria cliente bom. Passado o prazo, corta.
// Zerar a variável faz o corte ser imediato.
const DIAS_TOLERANCIA_ATRASO = Number(process.env.DIAS_TOLERANCIA_ATRASO || 3);

/**
 * Plano que vale AGORA, considerando o estado da assinatura — e não só o campo
 * `plano` gravado na conta.
 *
 * O campo sozinho é uma cópia local do que existe no Stripe, atualizada por
 * webhook. Se um webhook se perde ou o evento não é tratado, a cópia envelhece
 * — e envelhece a favor do cliente, liberando acesso sem pagamento. Por isso o
 * acesso passa a exigir plano E status.
 */
function planoDaAssinatura(tenant) {
  const plano = (tenant && tenant.plano) || "gratis";
  if (plano === "gratis") return "gratis";

  const status = tenant.assinaturaStatus;
  // Sem status registrado: assinatura anterior a esta verificação. Mantém o
  // acesso pra não cortar quem está pagando; a sincronização com o Stripe
  // preenche o status na primeira consulta.
  if (!status) return plano;
  if (STATUS_COM_ACESSO.has(status)) return plano;

  if (status === "past_due") {
    const desde = tenant.assinaturaAtrasadaDesde ? new Date(tenant.assinaturaAtrasadaDesde) : null;
    if (!desde || Number.isNaN(desde.getTime())) return plano;
    const dias = (Date.now() - desde.getTime()) / (24 * 60 * 60 * 1000);
    if (dias <= DIAS_TOLERANCIA_ATRASO) return plano;
  }

  // unpaid, canceled, incomplete, incomplete_expired, paused e past_due
  // vencido: volta pro plano grátis.
  return "gratis";
}

// ================= ACESSO COMPRADO À VISTA =================
// PIX não funciona em assinatura: o Stripe recusa `pix` em `mode: subscription`.
// Quem quer pagar no PIX compra um período fechado num pagamento só, e esse
// acesso não é assinatura nenhuma — não tem status, não fica past_due, não
// renova sozinho. Vale até a data e, nessa data, cai.
//
// Ele vive em `tenant.acessoAvulso` e NÃO no campo `plano`, de propósito: o
// campo `plano` é cópia local do que existe no Stripe, e escrever acesso avulso
// nele faria o acesso sobreviver ao vencimento — `planoDaAssinatura` libera o
// plano quando não há status registrado, e uma conta sem assinatura nunca tem
// status.
const MESES_PLANO_ANUAL = 12;

const FORCA_PLANO = { gratis: 0, autonomo: 1, imobiliaria: 2, rede: 3 };

function acessoAvulsoVigente(tenant) {
  const av = tenant && tenant.acessoAvulso;
  if (!av || !av.plano || !av.ate) return null;
  const ate = new Date(av.ate);
  if (Number.isNaN(ate.getTime()) || ate <= new Date()) return null;
  return av.plano;
}

// Comprar de novo antes de vencer estende, não reinicia: quem pagou adiantado
// não pode perder o tempo que já tinha comprado.
function estenderAcesso(ateAtual, meses) {
  const agora = new Date();
  const atual = ateAtual ? new Date(ateAtual) : null;
  const base = atual && !Number.isNaN(atual.getTime()) && atual > agora ? atual : agora;
  const fim = new Date(base);
  fim.setMonth(fim.getMonth() + meses);
  return fim.toISOString();
}

/**
 * Plano que vale AGORA, considerando as duas formas de pagar: assinatura
 * recorrente no cartão e período comprado à vista. Tendo as duas, vale a mais
 * forte — ninguém perde o que pagou porque pagou duas vezes.
 */
function planoEfetivo(tenant) {
  const daAssinatura = planoDaAssinatura(tenant);
  const doAvulso = acessoAvulsoVigente(tenant);
  if (!doAvulso) return daAssinatura;
  return (FORCA_PLANO[doAvulso] || 0) >= (FORCA_PLANO[daAssinatura] || 0) ? doAvulso : daAssinatura;
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

// Limite mensal de operações de IA (extração de CNH/RG + Ajudante de cláusulas)
// por conta, em qualquer plano pago. Protege contra abuso/custo descontrolado
// da API da Anthropic. O contador zera no início de cada mês.
const LIMITE_IA_MENSAL = 50;

function iaUsadaNoMes(tenant) {
  const uso = tenant.usoIaMensal || {};
  return uso[mesAtual()] || 0;
}

module.exports = {
  PLANOS, limitesDoPlano, precoDoPlano, mesAtual, contratosUsadosNoMes,
  LIMITE_IA_MENSAL, iaUsadaNoMes,
  planoEfetivo, planoDaAssinatura, STATUS_COM_ACESSO, DIAS_TOLERANCIA_ATRASO,
  acessoAvulsoVigente, estenderAcesso, MESES_PLANO_ANUAL,
};
