/**
 * Envio de e-mail transacional via Resend (API HTTP, sem SDK — mesmo padrão do
 * lib/ai.js, que fala com a Anthropic por fetch).
 *
 * Sem RESEND_API_KEY o módulo não quebra: `disponivel` fica falso e cada envio
 * devolve { ok: false, motivo }. Isso é proposital — o app tem que continuar de
 * pé sem e-mail configurado, e cada chamador decide o que fazer quando não deu
 * (a recuperação de senha avisa o usuário; a entrega do e-book segue, porque o
 * link já está na tela).
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE || "Minutei <nao-responda@minutei.app.br>";
const EMAIL_RESPONDER_PARA = process.env.EMAIL_RESPONDER_PARA || "";
// Endereço humano citado no corpo das mensagens. O remetente é um
// "não-responda", então mandar a pessoa "responder este e-mail" jogaria a
// resposta no vazio — ainda mais no aviso de senha alterada, que é justamente
// quando alguém pode precisar de socorro urgente.
const EMAIL_SUPORTE = process.env.EMAIL_SUPORTE || "contato@minutei.app.br";

if (!RESEND_API_KEY) {
  console.warn("RESEND_API_KEY não definida — e-mails (recuperação de senha, entrega de e-book, aviso de cobrança) não serão enviados.");
}

const disponivel = !!RESEND_API_KEY;

function escapeHtml(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Casca visual dos e-mails. Tabela e estilo inline porque cliente de e-mail
 * (Outlook, Gmail) ignora boa parte de CSS moderno e não carrega folha externa.
 */
function layout({ titulo, corpoHtml, rodape }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e4e9f0;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:26px 30px 0;">
          <div style="font-size:19px;font-weight:800;color:#0d1b2a;letter-spacing:-.01em;">minutei</div>
        </td></tr>
        <tr><td style="padding:18px 30px 8px;">
          <h1 style="margin:0 0 14px;font-size:21px;line-height:1.25;font-weight:800;color:#0d1b2a;letter-spacing:-.015em;">${escapeHtml(titulo)}</h1>
          ${corpoHtml}
        </td></tr>
        <tr><td style="padding:22px 30px 26px;">
          <div style="border-top:1px solid #e4e9f0;padding-top:14px;font-size:12.5px;color:#5b6b7f;line-height:1.5;">
            ${rodape || "Minutei — contratos imobiliários em minutos."}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function botao(url, texto) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
    <td style="background:#ff6b00;border-radius:9px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(texto)}</a>
    </td></tr></table>`;
}

const paragrafo = (t) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#33475b;">${t}</p>`;

async function enviar({ para, assunto, html, texto }) {
  if (!disponivel) return { ok: false, motivo: "E-mail não configurado no servidor." };
  try {
    const corpo = {
      from: EMAIL_REMETENTE,
      to: [para],
      subject: assunto,
      html,
    };
    if (texto) corpo.text = texto;
    if (EMAIL_RESPONDER_PARA) corpo.reply_to = EMAIL_RESPONDER_PARA;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => "");
      // O corpo do erro do Resend não traz segredo, mas traz o endereço de
      // destino; fica no log do servidor, não na resposta ao navegador.
      console.error(`Falha ao enviar e-mail (${resp.status}):`, detalhe.slice(0, 300));
      return { ok: false, motivo: `Provedor recusou o envio (${resp.status}).` };
    }
    return { ok: true };
  } catch (err) {
    console.error("Erro de rede ao enviar e-mail:", err.message);
    return { ok: false, motivo: "Não foi possível falar com o provedor de e-mail." };
  }
}

// ================= MENSAGENS =================

function recuperacaoSenha({ para, nome, url, minutos }) {
  const ola = nome ? `Olá, ${escapeHtml(nome)}.` : "Olá.";
  const html = layout({
    titulo: "Redefinir sua senha",
    corpoHtml:
      paragrafo(ola)
      + paragrafo("Você pediu para redefinir a senha da sua conta no Minutei. Clique no botão abaixo para escolher uma nova.")
      + botao(url, "Criar nova senha")
      + paragrafo(`O link vale por ${minutos} minutos e só pode ser usado uma vez.`)
      + paragrafo("<strong>Se não foi você que pediu</strong>, pode ignorar este e-mail — sua senha atual continua valendo e ninguém teve acesso à conta."),
    rodape: "Você recebeu este e-mail porque alguém pediu a redefinição de senha para este endereço no minutei.app.br.",
  });
  const texto = `${nome ? `Olá, ${nome}.` : "Olá."}\n\n`
    + `Você pediu para redefinir a senha da sua conta no Minutei.\n\n${url}\n\n`
    + `O link vale por ${minutos} minutos e só pode ser usado uma vez.\n\n`
    + `Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo.`;
  return enviar({ para, assunto: "Redefinir sua senha no Minutei", html, texto });
}

function senhaAlterada({ para, nome }) {
  const html = layout({
    titulo: "Sua senha foi alterada",
    corpoHtml:
      paragrafo(nome ? `Olá, ${escapeHtml(nome)}.` : "Olá.")
      + paragrafo("A senha da sua conta no Minutei acabou de ser alterada.")
      + paragrafo(`<strong>Se não foi você</strong>, fale com a gente agora em <a href="mailto:${escapeHtml(EMAIL_SUPORTE)}" style="color:#a84300;">${escapeHtml(EMAIL_SUPORTE)}</a> — alguém com acesso ao seu e-mail pode ter redefinido a senha.`),
    rodape: "Aviso automático de segurança do Minutei.",
  });
  const texto = "A senha da sua conta no Minutei acabou de ser alterada.\n\n"
    + `Se não foi você, fale com a gente agora em ${EMAIL_SUPORTE}.`;
  return enviar({ para, assunto: "Sua senha do Minutei foi alterada", html, texto });
}

function entregaEbook({ para, titulo, url }) {
  const html = layout({
    titulo: "Seu guia está pronto",
    corpoHtml:
      paragrafo("Obrigado pela compra. Seu material está no link abaixo.")
      + paragrafo(`<strong>${escapeHtml(titulo)}</strong>`)
      + botao(url, "Baixar o PDF")
      + paragrafo("Este link não expira — guarde este e-mail e você consegue baixar de novo quando quiser, em qualquer aparelho.")
      + paragrafo("Se o botão não funcionar, copie e cole no navegador:<br /><span style=\"font-size:12.5px;color:#5b6b7f;word-break:break-all;\">" + escapeHtml(url) + "</span>"),
    rodape: "Recibo e dados do pagamento foram enviados separadamente pelo Stripe.",
  });
  const texto = `Obrigado pela compra.\n\n${titulo}\n\nBaixe aqui: ${url}\n\nO link não expira — guarde este e-mail.`;
  return enviar({ para, assunto: `Seu guia: ${titulo}`, html, texto });
}

function cobrancaFalhou({ para, nome, url, dias }) {
  const html = layout({
    titulo: "Não conseguimos processar seu pagamento",
    corpoHtml:
      paragrafo(nome ? `Olá, ${escapeHtml(nome)}.` : "Olá.")
      + paragrafo("A última cobrança da sua assinatura do Minutei não passou. Costuma ser algo simples: cartão vencido, limite ou uma recusa do banco.")
      + paragrafo(`Você tem <strong>${dias} dia(s)</strong> para atualizar a forma de pagamento. Passado esse prazo, a conta volta para o plano Grátis — <strong>seus contratos continuam guardados</strong>, mas os recursos dos planos pagos ficam indisponíveis até a regularização.`)
      + botao(url, "Atualizar forma de pagamento"),
    rodape: "Se você já regularizou, pode ignorar este aviso.",
  });
  const texto = `A última cobrança da sua assinatura do Minutei não passou.\n\n`
    + `Você tem ${dias} dia(s) para atualizar a forma de pagamento antes de a conta voltar ao plano Grátis. Seus contratos continuam guardados.\n\n${url}`;
  return enviar({ para, assunto: "Pagamento pendente — atualize sua forma de pagamento", html, texto });
}

function linkRevisao({ para, deQuem, titulo, url, validadeDias }) {
  const html = layout({
    titulo: "Um documento para você revisar",
    corpoHtml:
      paragrafo(`${escapeHtml(deQuem)} enviou um documento para a sua revisão:`)
      + paragrafo(`<strong>${escapeHtml(titulo)}</strong>`)
      + botao(url, "Abrir o documento")
      + paragrafo("Você poderá ler o documento, tirar dúvidas e aprovar ou pedir correções pela própria página.")
      + paragrafo(`Por segurança, o link pede seu nome e CPF antes de abrir, e vale por ${validadeDias} dias.`),
    rodape: `Enviado por ${escapeHtml(deQuem)} através do Minutei.`,
  });
  const texto = `${deQuem} enviou um documento para a sua revisão: ${titulo}\n\n${url}\n\n`
    + `O link pede seu nome e CPF antes de abrir e vale por ${validadeDias} dias.`;
  return enviar({ para, assunto: `${titulo} — para sua revisão`, html, texto });
}

module.exports = {
  disponivel, enviar,
  recuperacaoSenha, senhaAlterada, entregaEbook, cobrancaFalhou, linkRevisao,
};
