require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { nanoid } = require("nanoid");
const { gerarContrato } = require("./lib/generator");
const { convertDocxToPdf } = require("./lib/pdf");
const store = require("./lib/store");
const { PLANOS, limitesDoPlano, precoDoPlano, mesAtual, contratosUsadosNoMes, LIMITE_IA_MENSAL, iaUsadaNoMes } = require("./lib/planos");
const stripe = require("./lib/stripe");
const ai = require("./lib/ai");

const app = express();
const PORT = process.env.PORT || 4173;
const IS_PROD = process.env.NODE_ENV === "production";

// Plataformas como Railway/Render ficam atrás de um proxy HTTPS — sem isso,
// o cookie "secure" nunca seria enviado de volta pelo navegador.
if (IS_PROD) app.set("trust proxy", 1);

// Cabeçalhos de segurança (proteção contra clickjacking, sniffing de MIME,
// vazamento de referrer e HSTS em produção). O Content-Security-Policy fica
// desligado por ora porque as páginas usam scripts/estilos inline e recursos
// externos (Google Fonts e gtag); um CSP restritivo exigiria refatorar isso.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Limita tentativas de login/cadastro por IP — barra ataques de força bruta
// contra senhas e criação de contas em massa por robôs.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
// Por padrão, uploads fica dentro de DATA_DIR — assim um único volume
// persistente montado em DATA_DIR cobre tudo (sessões e logos; contas e
// imobiliárias vão para o Postgres quando DATABASE_URL está definido).
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const SECRET_FILE = path.join(DATA_DIR, "session-secret.txt");
[DATA_DIR, UPLOAD_DIR, SESSIONS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex"));
const SESSION_SECRET = process.env.SESSION_SECRET || fs.readFileSync(SECRET_FILE, "utf8").trim();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${nanoid()}${path.extname(file.originalname) || ".png"}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g)$/.test(file.mimetype)) return cb(new Error("Envie um arquivo PNG ou JPG"));
    cb(null, true);
  },
});

// Documentos de identificação (CNH/RG) são processados só em memória, nunca gravados em
// disco — é dado pessoal sensível e não deve ser persistido além do necessário pra extração.
const uploadDocumento = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^(application\/pdf|image\/(png|jpe?g))$/.test(file.mimetype)) return cb(new Error("Envie um arquivo PDF, PNG ou JPG"));
    cb(null, true);
  },
});

// Precisa vir antes do express.json() — o Stripe exige o corpo bruto (não
// parseado) da requisição para validar a assinatura do webhook.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(503).send("Stripe não configurado");
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook Stripe: assinatura inválida:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const tenantId = session.metadata && session.metadata.tenantId;
        const planoId = session.metadata && session.metadata.plano;
        if (tenantId && planoId) {
          const tenant = await store.getTenant(tenantId);
          if (tenant) {
            await store.setTenant(tenantId, {
              ...tenant,
              plano: planoId,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
            });
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const tenants = await store.getAllTenants();
        const tenant = tenants.find(t => t.stripeSubscriptionId === sub.id);
        if (tenant) {
          await store.setTenant(tenant.id, { ...tenant, plano: "gratis", stripeSubscriptionId: null });
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Erro processando webhook Stripe:", err);
    res.status(500).json({ error: "Erro ao processar webhook" });
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, logFn: () => {} }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: "lax", secure: IS_PROD },
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

async function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
  const user = await store.getUser(req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.status(401).json({ error: "Sessão inválida" }); }
  req.user = user;
  next();
}

function publicUser(user) {
  return { id: user.id, email: user.email, nome: user.nome, tenantId: user.tenantId, role: user.role };
}

// ================= AUTH =================
app.post("/api/auth/signup", authLimiter, async (req, res) => {
  try {
    const { email, password, nome, imobiliariaNome } = req.body || {};
    if (!email || !password || !imobiliariaNome) {
      return res.status(400).json({ error: "E-mail, senha e nome da imobiliária são obrigatórios" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres" });
    }
    const emailNorm = String(email).trim().toLowerCase();
    if (await store.getUserByEmail(emailNorm)) {
      return res.status(409).json({ error: "Já existe uma conta com esse e-mail" });
    }

    const tenantId = nanoid(8);
    await store.setTenant(tenantId, {
      nome: imobiliariaNome,
      creci: "", cnpj: "", email: emailNorm, endereco: "",
      cidade: "Natal", foroPadrao: "Natal/RN", corPrimaria: "0D1B2A", logoPath: null,
      plano: "gratis", usoMensal: {}, usoIaMensal: {},
    });

    const userId = nanoid(10);
    const passwordHash = await bcrypt.hash(password, 10);
    const user = { id: userId, email: emailNorm, passwordHash, nome: nome || "", tenantId, role: "owner" };
    await store.setUser(userId, user);

    req.session.userId = userId;
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar conta" });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();
    const user = await store.getUserByEmail(emailNorm);
    if (!user) return res.status(401).json({ error: "E-mail ou senha inválidos" });
    const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
    if (!ok) return res.status(401).json({ error: "E-mail ou senha inválidos" });
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao entrar" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.delete("/api/auth/me", requireAuth, async (req, res) => {
  const { password } = req.body || {};
  const ok = await bcrypt.compare(String(password || ""), req.user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Senha incorreta" });

  const allUsers = await store.getAllUsers();
  const teammates = allUsers.filter(u => u.tenantId === req.user.tenantId && u.id !== req.user.id);

  if (req.user.role === "owner" && teammates.length > 0) {
    return res.status(400).json({ error: "Remova ou promova os demais membros da equipe antes de excluir a conta do dono." });
  }

  await store.deleteUser(req.user.id);

  // Dono era o último usuário do tenant: apaga a imobiliária e os uploads junto.
  if (req.user.role === "owner") {
    const tenant = await store.getTenant(req.user.tenantId);
    if (tenant && tenant.logoPath) {
      const logoFile = path.join(UPLOAD_DIR, path.basename(tenant.logoPath));
      fs.rm(logoFile, { force: true }, () => {});
    }
    await store.deleteTenant(req.user.tenantId);
  }

  req.session.destroy(() => res.json({ ok: true }));
});

// ================= EQUIPE (usuários do mesmo tenant) =================
app.get("/api/team", requireAuth, async (req, res) => {
  const allUsers = await store.getAllUsers();
  const team = allUsers.filter(u => u.tenantId === req.user.tenantId).map(publicUser);
  res.json(team);
});

app.post("/api/team/invite", requireAuth, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Só o dono da conta pode convidar corretores" });
  const { email, password, nome } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
  if (String(password).length < 8) return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres" });

  const tenant = await store.getTenant(req.user.tenantId);
  const limites = limitesDoPlano(tenant && tenant.plano);
  const allUsers = await store.getAllUsers();
  const tamanhoEquipe = allUsers.filter(u => u.tenantId === req.user.tenantId).length;
  if (tamanhoEquipe >= limites.maxUsuarios) {
    return res.status(402).json({ error: `Seu plano (${limites.nome}) permite até ${limites.maxUsuarios} usuário(s). Faça upgrade para convidar mais gente.` });
  }

  const emailNorm = String(email).trim().toLowerCase();
  if (await store.getUserByEmail(emailNorm)) {
    return res.status(409).json({ error: "Já existe uma conta com esse e-mail" });
  }
  const userId = nanoid(10);
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: userId, email: emailNorm, passwordHash, nome: nome || "", tenantId: req.user.tenantId, role: "corretor" };
  await store.setUser(userId, user);
  res.json(publicUser(user));
});

app.delete("/api/team/:id", requireAuth, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Só o dono da conta pode remover corretores" });
  const target = await store.getUser(req.params.id);
  if (!target || target.tenantId !== req.user.tenantId) return res.status(404).json({ error: "Usuário não encontrado" });
  if (target.role === "owner") return res.status(400).json({ error: "Não é possível remover o dono da conta" });
  await store.deleteUser(req.params.id);
  res.json({ ok: true });
});

// ================= TENANT (marca da própria imobiliária) =================
app.get("/api/tenant", requireAuth, async (req, res) => {
  const tenant = await store.getTenant(req.user.tenantId);
  if (!tenant) return res.json(null);
  const limites = limitesDoPlano(tenant.plano);
  res.json({
    ...tenant,
    plano: tenant.plano || "gratis",
    usoContratosNoMes: contratosUsadosNoMes(tenant),
    limiteContratosPorMes: limites.contratosPorMes === Infinity ? null : limites.contratosPorMes,
    usoIaNoMes: iaUsadaNoMes(tenant),
    limiteIaPorMes: LIMITE_IA_MENSAL,
    limiteUsuarios: limites.maxUsuarios === Infinity ? null : limites.maxUsuarios,
    temAssinaturaAtiva: !!tenant.stripeCustomerId,
  });
});

app.post("/api/tenant", requireAuth, upload.single("logo"), async (req, res) => {
  const existing = (await store.getTenant(req.user.tenantId)) || {};
  const branding = {
    nome: req.body.nome || existing.nome || "",
    creci: req.body.creci || existing.creci || "",
    cnpj: req.body.cnpj || existing.cnpj || "",
    email: req.body.email || existing.email || "",
    endereco: req.body.endereco || existing.endereco || "",
    cidade: req.body.cidade || existing.cidade || "Natal",
    foroPadrao: req.body.foroPadrao || existing.foroPadrao || "Natal/RN",
    corPrimaria: req.body.corPrimaria || existing.corPrimaria || "0D1B2A",
    logoPath: req.file ? `/uploads/${req.file.filename}` : existing.logoPath || null,
    tipoConta: req.body.tipoConta || existing.tipoConta || "imobiliaria",
    plano: existing.plano || "gratis",
    usoMensal: existing.usoMensal || {},
    usoIaMensal: existing.usoIaMensal || {},
    stripeCustomerId: existing.stripeCustomerId || null,
    stripeSubscriptionId: existing.stripeSubscriptionId || null,
  };
  await store.setTenant(req.user.tenantId, branding);
  res.json(branding);
});

// ================= BILLING (Stripe) =================
app.post("/api/billing/checkout", requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Pagamento indisponível no momento" });
  if (req.user.role !== "owner") return res.status(403).json({ error: "Só o dono da conta pode alterar o plano" });

  const { plano: planoId, ciclo } = req.body || {};
  const cicloNorm = ciclo === "anual" ? "anual" : "mensal";
  const priceId = precoDoPlano(planoId, cicloNorm);
  if (!priceId) {
    return res.status(400).json({ error: "Plano inválido para checkout" });
  }

  const tenant = await store.getTenant(req.user.tenantId);
  if (!tenant) return res.status(404).json({ error: "Imobiliária não encontrada" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: tenant.stripeCustomerId || undefined,
      customer_email: tenant.stripeCustomerId ? undefined : req.user.email,
      client_reference_id: req.user.tenantId,
      metadata: { tenantId: req.user.tenantId, plano: planoId, ciclo: cicloNorm },
      subscription_data: { metadata: { tenantId: req.user.tenantId, plano: planoId, ciclo: cicloNorm } },
      success_url: `${req.protocol}://${req.get("host")}/app.html?upgrade=sucesso`,
      cancel_url: `${req.protocol}://${req.get("host")}/app.html?upgrade=cancelado`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro ao criar checkout do Stripe:", err);
    res.status(500).json({ error: "Não foi possível iniciar o pagamento agora" });
  }
});

app.post("/api/billing/portal", requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Pagamento indisponível no momento" });
  if (req.user.role !== "owner") return res.status(403).json({ error: "Só o dono da conta pode gerenciar a assinatura" });

  const tenant = await store.getTenant(req.user.tenantId);
  if (!tenant || !tenant.stripeCustomerId) {
    return res.status(400).json({ error: "Nenhuma assinatura ativa encontrada para essa conta" });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${req.protocol}://${req.get("host")}/app.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro ao abrir portal do Stripe:", err);
    res.status(500).json({ error: "Não foi possível abrir o portal de assinatura agora" });
  }
});

// Extrai um resumo do contrato (pro histórico/dashboard) a partir do JSON
// que já foi usado pra montar o documento — não depende do arquivo gerado.
// Nome legível de cada documento — usado na página pública de revisão, onde
// quem lê é o cliente e não conhece os identificadores internos.
const TITULOS_DOC = {
  compra_venda: "Contrato de Compra e Venda",
  locacao_caucao: "Contrato de Locação",
  locacao_fiador: "Contrato de Locação",
  ficha_locacao: "Ficha de Locação",
  proposta_compra: "Proposta de Compra",
  proposta_aluguel: "Proposta de Locação",
  ficha_visita: "Ficha de Visita",
  autorizacao_venda: "Autorização de Venda",
  contrato_exclusividade: "Contrato de Exclusividade",
  termo_entrega_chaves: "Termo de Entrega de Chaves",
};

// Validade do link de revisão. Passado esse prazo o link para de funcionar e o
// PDF é apagado — o documento definitivo é o que as partes assinam, não o link.
const SHARE_VALIDADE_DIAS = 60;

// Endereço canônico usado nos links que saem do sistema (revisão do cliente).
// Não dá pra confiar só no host da requisição: hoje o domínio sem "www"
// redireciona apenas a raiz, então um link montado sobre "minutei.app.br"
// chegaria no cliente como 404. Com PUBLIC_BASE_URL definido, todo link
// compartilhado nasce no domínio que funciona.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
function baseUrl(req) {
  return PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function resumoContrato(dados) {
  const isLocacao = dados.tipo === "locacao_caucao" || dados.tipo === "locacao_fiador";
  let valor = 0;
  let comissaoValor = 0;
  if (isLocacao) {
    valor = Number((dados.aluguel && dados.aluguel.valor) || 0);
  } else {
    const parcelas = (dados.pagamento && dados.pagamento.parcelas) || [];
    valor = Number((dados.valor && dados.valor.total) || parcelas.reduce((a, p) => a + Number(p.valor || 0), 0));
    const percentual = Number((dados.corretagem && dados.corretagem.percentual) || 5);
    comissaoValor = (dados.corretagem && dados.corretagem.valor !== undefined)
      ? Number(dados.corretagem.valor)
      : valor * (percentual / 100);
  }
  return {
    tipo: dados.tipo || "compra_venda",
    data: dados.data || null,
    endereco: (dados.imovel && dados.imovel.endereco) || "",
    bairro: (dados.imovel && dados.imovel.bairro) || "",
    tipoUso: (dados.imovel && dados.imovel.tipoUso) || dados.uso || "residencial",
    valor,
    comissaoValor,
  };
}

// ================= GERAÇÃO DE CONTRATO =================
app.post("/api/gerar", requireAuth, async (req, res) => {
  try {
    const { dados, formato, destinatario } = req.body;
    if (!dados) return res.status(400).json({ error: "dados são obrigatórios" });
    // "link" gera o mesmo documento, mas em vez de devolver o arquivo guarda o
    // PDF e devolve uma URL pública de revisão. Consome a cota igual às outras
    // saídas — é o mesmo contrato, só entregue de outro jeito.
    const querLink = formato === "link";
    const querPdf = formato === "pdf" || querLink;
    const tenant = await store.getTenant(req.user.tenantId);
    if (!tenant) return res.status(404).json({ error: "Imobiliária não encontrada" });

    // Documentos auxiliares (fichas, propostas, autorizações) são mais leves,
    // liberados em todos os planos: não consomem a cota mensal de contratos
    // nem entram no dashboard de contratos.
    const DOCS_AUXILIARES = {
      ficha_locacao: "Ficha-de-Locacao",
      proposta_compra: "Proposta-de-Compra",
      proposta_aluguel: "Proposta-de-Locacao",
      ficha_visita: "Ficha-de-Visita",
      autorizacao_venda: "Autorizacao-de-Venda",
      contrato_exclusividade: "Contrato-de-Exclusividade",
      termo_entrega_chaves: "Termo-de-Entrega-de-Chaves",
    };
    const ehAuxiliar = !!DOCS_AUXILIARES[dados.tipo];

    const limites = limitesDoPlano(tenant.plano);
    if (!ehAuxiliar) {
      const usados = contratosUsadosNoMes(tenant);
      if (usados >= limites.contratosPorMes) {
        return res.status(402).json({
          error: `Seu plano (${limites.nome}) permite ${limites.contratosPorMes} contrato(s) por mês e você já usou todos. Faça upgrade para continuar gerando.`,
        });
      }
    }

    const LAYOUTS_PAGOS = new Set(["profissional", "elegante"]);
    if ((tenant.plano || "gratis") === "gratis" && LAYOUTS_PAGOS.has(dados.layout)) {
      return res.status(402).json({
        error: `O layout "${dados.layout === "profissional" ? "Profissional" : "Elegante"}" é exclusivo dos planos pagos. Faça upgrade para usar esse visual.`,
      });
    }

    const branding = { ...tenant };
    if (tenant.logoPath) {
      const logoFile = path.join(UPLOAD_DIR, path.basename(tenant.logoPath));
      if (fs.existsSync(logoFile)) branding.logoBuffer = fs.readFileSync(logoFile);
    }

    let buffer = await gerarContrato(dados, branding);
    const prefixo = DOCS_AUXILIARES[dados.tipo] || `Contrato_${(dados.tipo || "contrato").replace(/_/g, "-")}`;
    const nomeBase = `${prefixo}_${(dados.imovel && dados.imovel.endereco || "").slice(0, 20).replace(/[^a-zA-Z0-9]+/g, "")}` || "documento";

    if (querPdf) {
      try {
        buffer = await convertDocxToPdf(buffer);
      } catch (err) {
        console.error("Falha ao converter para PDF:", err);
        return res.status(502).json({
          error: querLink
            ? "Não foi possível preparar o link de revisão agora. Tente novamente ou baixe em .docx."
            : "Não foi possível gerar o PDF agora. Tente novamente ou baixe em .docx.",
        });
      }
      if (!querLink) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.pdf"`);
      }
    } else {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.docx"`);
    }

    // Só conta a cota e salva o histórico depois que o documento final está
    // pronto pra entrega. Documentos auxiliares não contam cota nem histórico.
    const contratoId = nanoid(12);
    if (!ehAuxiliar) {
      const mes = mesAtual();
      const usoMensal = { ...(tenant.usoMensal || {}) };
      usoMensal[mes] = (usoMensal[mes] || 0) + 1;
      store.setTenant(req.user.tenantId, { ...tenant, usoMensal }).catch(err => console.error("Falha ao registrar uso do contrato:", err));
      store.addContract(contratoId, req.user.tenantId, resumoContrato(dados)).catch(err => console.error("Falha ao salvar histórico do contrato:", err));
    }

    if (querLink) {
      const token = nanoid(24);
      const expiraEm = new Date(Date.now() + SHARE_VALIDADE_DIAS * 24 * 60 * 60 * 1000);
      await store.addShare(token, req.user.tenantId, {
        titulo: TITULOS_DOC[dados.tipo] || "Documento",
        endereco: (dados.imovel && dados.imovel.endereco) || "",
        imobiliaria: tenant.nome || "",
        destinatario: String(destinatario || "").trim().slice(0, 120),
        contratoId: ehAuxiliar ? null : contratoId,
        status: "pendente",
        comentario: "",
        respondidoEm: null,
      }, buffer, expiraEm);
      return res.json({
        token,
        url: `${baseUrl(req)}/r/${token}`,
        expiraEm: expiraEm.toISOString(),
      });
    }

    res.send(buffer);
  } catch (err) {
    console.error(err);
    // Não expõe detalhes internos do erro ao cliente em produção.
    res.status(500).json({ error: IS_PROD ? "Não foi possível gerar o contrato agora. Tente novamente." : err.message });
  }
});

// ================= AJUDANTE IA DE CLÁUSULAS =================
// Mensagem única quando a conta atinge o teto mensal de IA.
const ERRO_LIMITE_IA = `Você atingiu o limite de ${LIMITE_IA_MENSAL} usos de IA neste mês (extração de CNH/RG + Ajudante de cláusulas, somados). O contador zera no início do próximo mês.`;

// Registra +1 no contador mensal de IA da conta. Só é chamado DEPOIS que a
// chamada à IA teve sucesso, para não descontar cota em falhas de rede/parsing.
async function registrarUsoIa(tenantId, tenant) {
  const mes = mesAtual();
  const usoIaMensal = { ...(tenant.usoIaMensal || {}) };
  usoIaMensal[mes] = (usoIaMensal[mes] || 0) + 1;
  await store.setTenant(tenantId, { ...tenant, usoIaMensal });
}

app.post("/api/ia/clausula", requireAuth, async (req, res) => {
  try {
    const tenant = await store.getTenant(req.user.tenantId);
    if (!tenant || (tenant.plano || "gratis") === "gratis") {
      return res.status(402).json({ error: "O Assistente de IA de cláusulas é exclusivo dos planos pagos. Faça upgrade para usar essa ferramenta." });
    }
    if (iaUsadaNoMes(tenant) >= LIMITE_IA_MENSAL) {
      return res.status(429).json({ error: ERRO_LIMITE_IA });
    }
    const { tipoContrato, clausulaAtual, pedido } = req.body || {};
    const resultado = await ai.avaliarClausula({ tipoContrato, clausulaAtual, pedido });
    await registrarUsoIa(req.user.tenantId, tenant);
    res.json(resultado);
  } catch (err) {
    const indisponivel = /indispon[íi]vel/i.test(err.message || "");
    res.status(indisponivel ? 503 : 400).json({ error: err.message });
  }
});

app.post("/api/ia/extrair-documento", requireAuth, uploadDocumento.single("documento"), async (req, res) => {
  try {
    const tenant = await store.getTenant(req.user.tenantId);
    if (!tenant || (tenant.plano || "gratis") === "gratis") {
      return res.status(402).json({ error: "O preenchimento automático por CNH/RG é exclusivo dos planos pagos. Faça upgrade para usar essa ferramenta." });
    }
    if (iaUsadaNoMes(tenant) >= LIMITE_IA_MENSAL) {
      return res.status(429).json({ error: ERRO_LIMITE_IA });
    }
    if (!req.file) return res.status(400).json({ error: "Envie um arquivo (PDF, JPG ou PNG)." });
    // "cnpj" lê o Cartão CNPJ (empresa); qualquer outro valor lê CNH/RG (pessoa física).
    const resultado = String(req.body.tipoDocumento || "") === "cnpj"
      ? await ai.extrairDadosCnpj(req.file.buffer, req.file.mimetype)
      : await ai.extrairDadosDocumento(req.file.buffer, req.file.mimetype);
    await registrarUsoIa(req.user.tenantId, tenant);
    res.json(resultado);
  } catch (err) {
    const indisponivel = /indispon[íi]vel/i.test(err.message || "");
    res.status(indisponivel ? 503 : 400).json({ error: err.message });
  }
});

// ================= DASHBOARD =================
app.get("/api/dashboard", requireAuth, async (req, res) => {
  const contratos = await store.getContractsByTenant(req.user.tenantId);

  const vendas = contratos.filter(c => c.tipo === "compra_venda" && c.valor > 0);
  const locacoes = contratos.filter(c => c.tipo !== "compra_venda" && c.valor > 0);
  const comercial = contratos.filter(c => c.tipoUso === "comercial").length;
  const residencial = contratos.filter(c => c.tipoUso !== "comercial").length;

  const media = (arr, campo) => arr.length ? arr.reduce((a, c) => a + Number(c[campo] || 0), 0) / arr.length : 0;
  const soma = (arr, campo) => arr.reduce((a, c) => a + Number(c[campo] || 0), 0);

  const bairros = {};
  contratos.forEach(c => {
    const b = (c.bairro || "").trim();
    if (!b) return;
    bairros[b] = (bairros[b] || 0) + 1;
  });
  const bairroRanking = Object.entries(bairros)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([bairro, total]) => ({ bairro, total }));

  const hoje = new Date();
  const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const mesPassadoStr = `${mesPassado.getFullYear()}-${String(mesPassado.getMonth() + 1).padStart(2, "0")}`;
  const contarNoMes = (mesStr) => contratos.filter(c => c.criadoEm && String(c.criadoEm).slice(0, 7) === mesStr).length;

  res.json({
    totalContratos: contratos.length,
    porTipo: {
      compra_venda: contratos.filter(c => c.tipo === "compra_venda").length,
      locacao_caucao: contratos.filter(c => c.tipo === "locacao_caucao").length,
      locacao_fiador: contratos.filter(c => c.tipo === "locacao_fiador").length,
    },
    valorMedioVenda: media(vendas, "valor"),
    ticketMedioLocacao: media(locacoes, "valor"),
    comissaoTotalRecebida: soma(vendas, "comissaoValor"),
    comercialVsResidencial: { comercial, residencial },
    bairroRanking,
    contratosEsteMes: contarNoMes(mesAtualStr),
    contratosMesPassado: contarNoMes(mesPassadoStr),
    ultimosContratos: contratos.slice(0, 10).map(c => ({
      id: c.id, tipo: c.tipo, endereco: c.endereco, bairro: c.bairro, valor: c.valor, data: c.data, criadoEm: c.criadoEm,
    })),
  });
});

app.delete("/api/dashboard/contratos/:id", requireAuth, async (req, res) => {
  const contrato = await store.getContract(req.params.id, req.user.tenantId);
  if (!contrato) return res.status(404).json({ error: "Contrato não encontrado" });

  await store.deleteContract(req.params.id, req.user.tenantId);

  // Devolve a cota do mês em que o contrato foi gerado, já que ele deixou de existir.
  const tenant = await store.getTenant(req.user.tenantId);
  if (tenant && contrato.criadoEm) {
    const mes = String(contrato.criadoEm).slice(0, 7);
    const usoMensal = { ...(tenant.usoMensal || {}) };
    if (usoMensal[mes]) {
      usoMensal[mes] = Math.max(0, usoMensal[mes] - 1);
      await store.setTenant(req.user.tenantId, { ...tenant, usoMensal });
    }
  }

  res.json({ ok: true });
});

// ================= REVISÃO POR LINK PÚBLICO =================
// O corretor gera o documento com formato "link" e manda a URL pro cliente
// (normalmente por WhatsApp). O cliente abre no navegador, lê o PDF e responde
// aprovando ou pedindo ajuste. Não há login do lado do cliente: o segredo é o
// próprio token, por isso ele é longo e o link expira.

// Quem responde é o cliente, sem conta e sem sessão — limita por IP pra que o
// endereço do link não vire alvo de força bruta ou de flood de respostas.
const revisaoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Aguarde alguns minutos e tente novamente." },
});

app.get("/r/:token", revisaoLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "revisao.html"));
});

// Dados que a página de revisão mostra. Devolve só o que o cliente precisa ver
// — nada da conta do corretor além do nome que assina o documento.
app.get("/api/revisao/:token", revisaoLimiter, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share) return res.status(404).json({ error: "Este link não existe mais ou expirou." });
  res.json({
    titulo: share.titulo,
    endereco: share.endereco,
    imobiliaria: share.imobiliaria,
    destinatario: share.destinatario,
    status: share.status,
    comentario: share.comentario,
    respondidoEm: share.respondidoEm,
    criadoEm: share.criadoEm,
    expiraEm: share.expiraEm,
  });
});

app.get("/api/revisao/:token/documento.pdf", revisaoLimiter, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share) return res.status(404).send("Este link não existe mais ou expirou.");
  const pdf = await store.getSharePdf(req.params.token);
  if (!pdf) return res.status(404).send("Documento indisponível.");
  res.setHeader("Content-Type", "application/pdf");
  // inline: o cliente lê na própria aba; o navegador ainda oferece baixar.
  res.setHeader("Content-Disposition", `inline; filename="${share.titulo.replace(/[^\w]+/g, "-")}.pdf"`);
  res.send(pdf);
});

app.post("/api/revisao/:token/resposta", revisaoLimiter, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share) return res.status(404).json({ error: "Este link não existe mais ou expirou." });
  if (share.status !== "pendente") {
    return res.status(409).json({ error: "Este documento já foi respondido." });
  }
  const acao = String(req.body.acao || "");
  if (acao !== "aprovar" && acao !== "ajuste") {
    return res.status(400).json({ error: "Ação inválida." });
  }
  const comentario = String(req.body.comentario || "").trim().slice(0, 2000);
  if (acao === "ajuste" && !comentario) {
    return res.status(400).json({ error: "Descreva o que precisa ser ajustado." });
  }
  const patch = {
    status: acao === "aprovar" ? "aprovado" : "ajuste",
    comentario,
    respondidoEm: new Date().toISOString(),
  };
  await store.updateShareMeta(req.params.token, patch);
  res.json({ ok: true, ...patch });
});

// ---- lado do corretor: acompanhar o que foi enviado ----
app.get("/api/compartilhamentos", requireAuth, async (req, res) => {
  const shares = await store.getSharesByTenant(req.user.tenantId);
  const base = baseUrl(req);
  res.json(shares.map(s => ({
    token: s.id,
    url: `${base}/r/${s.id}`,
    titulo: s.titulo,
    endereco: s.endereco,
    destinatario: s.destinatario,
    status: s.status,
    comentario: s.comentario,
    respondidoEm: s.respondidoEm,
    criadoEm: s.criadoEm,
    expiraEm: s.expiraEm,
  })));
});

app.delete("/api/compartilhamentos/:token", requireAuth, async (req, res) => {
  await store.deleteShare(req.params.token, req.user.tenantId);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || "Erro na requisição" });
  next();
});

// Links de revisão vencidos carregam o PDF inteiro; limpa na subida e uma vez
// por dia pra que o banco não cresça com documento que ninguém mais acessa.
function limparSharesVencidos() {
  store.purgeExpiredShares()
    .then(n => { if (n) console.log(`Links de revisão expirados removidos: ${n}`); })
    .catch(err => console.error("Falha ao limpar links de revisão:", err));
}

store.init(DATA_DIR).then(() => {
  limparSharesVencidos();
  setInterval(limparSharesVencidos, 24 * 60 * 60 * 1000).unref();
  app.listen(PORT, () => {
    console.log(`Minutei rodando em http://localhost:${PORT} (armazenamento: ${store.usingPostgres ? "Postgres" : "arquivos JSON locais"})`);
  });
}).catch(err => {
  console.error("Falha ao inicializar o armazenamento:", err);
  process.exit(1);
});
