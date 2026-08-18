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
const { gerarContrato, extrairTextoDocx } = require("./lib/generator");
const { convertDocxToPdf } = require("./lib/pdf");
const store = require("./lib/store");
const { PLANOS, limitesDoPlano, precoDoPlano, mesAtual, contratosUsadosNoMes, LIMITE_IA_MENSAL, iaUsadaNoMes, planoEfetivo, DIAS_TOLERANCIA_ATRASO } = require("./lib/planos");
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

// ================= ESTADO DA ASSINATURA =================
// O acesso aos planos pagos depende do que o Stripe diz, não só do campo
// `plano` gravado na conta. Ver planoEfetivo() em lib/planos.js.

async function tenantPorAssinatura(subId) {
  if (!subId) return null;
  const tenants = await store.getAllTenants();
  return tenants.find(t => t.stripeSubscriptionId === subId) || null;
}

// Grava na conta o estado atual da assinatura. `assinaturaAtrasadaDesde` marca
// quando o atraso começou, pra tolerância ser contada a partir dali e não se
// renovar a cada evento novo do Stripe.
async function gravarEstadoAssinatura(tenantId, tenant, sub) {
  const atrasada = sub.status === "past_due";
  await store.setTenant(tenantId, {
    ...tenant,
    assinaturaStatus: sub.status,
    assinaturaAtrasadaDesde: atrasada
      ? (tenant.assinaturaAtrasadaDesde || new Date().toISOString())
      : null,
    assinaturaVerificadaEm: new Date().toISOString(),
  });
}

// Rede de segurança: webhook que não chega é normal (endpoint fora do ar,
// evento não configurado no painel, falha de entrega). Sem isto, um único
// webhook perdido deixa acesso liberado pra sempre — foi assim que uma conta
// sem pagamento continuou funcionando. Aqui o estado é reconferido direto na
// fonte, no máximo uma vez a cada 6h por conta pra não pesar.
const INTERVALO_RECONFERIR_MS = 6 * 60 * 60 * 1000;

async function assinaturaAtualizada(tenantId, tenant) {
  if (!stripe || !tenant || !tenant.stripeSubscriptionId) return tenant;
  const ultima = tenant.assinaturaVerificadaEm ? new Date(tenant.assinaturaVerificadaEm).getTime() : 0;
  if (Date.now() - ultima < INTERVALO_RECONFERIR_MS) return tenant;

  try {
    const sub = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
    await gravarEstadoAssinatura(tenantId, tenant, sub);
    return (await store.getTenant(tenantId)) || tenant;
  } catch (err) {
    // Assinatura sumiu do Stripe: não existe mais, então não dá acesso.
    if (err && err.code === "resource_missing") {
      const zerado = {
        ...tenant, plano: "gratis", stripeSubscriptionId: null,
        assinaturaStatus: "canceled", assinaturaAtrasadaDesde: null,
        assinaturaVerificadaEm: new Date().toISOString(),
      };
      await store.setTenant(tenantId, zerado);
      return zerado;
    }
    // Stripe fora do ar: mantém o que está gravado em vez de cortar quem paga.
    console.error("Falha ao reconferir assinatura no Stripe:", err.message);
    return tenant;
  }
}

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
      // Mudança de status da assinatura — inclusive a ida pra past_due/unpaid
      // quando o pagamento falha. Sem tratar isto, uma assinatura que parou de
      // ser paga continuava dando acesso: o "deleted" abaixo só dispara se o
      // Stripe chegar a CANCELAR a assinatura, e na configuração que deixa em
      // "unpaid" no fim das retentativas ele nunca dispara.
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const tenant = await tenantPorAssinatura(sub.id);
        if (tenant) await gravarEstadoAssinatura(tenant.id, tenant, sub);
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object;
        const subId = inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription);
        const tenant = subId ? await tenantPorAssinatura(subId) : null;
        if (tenant && stripe) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            await gravarEstadoAssinatura(tenant.id, tenant, sub);
          } catch (err) {
            console.error("Falha ao ler assinatura após pagamento recusado:", err.message);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const tenant = await tenantPorAssinatura(sub.id);
        if (tenant) {
          await store.setTenant(tenant.id, {
            ...tenant,
            plano: "gratis",
            stripeSubscriptionId: null,
            assinaturaStatus: "canceled",
            assinaturaAtrasadaDesde: null,
            assinaturaVerificadaEm: new Date().toISOString(),
          });
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
// ================= CAMINHOS DOS PRODUTOS =================
// A home vende Contratos, e /contratos e o mesmo produto. Em vez de servir a
// mesma pagina em dois enderecos (conteudo duplicado, que divide o SEO entre
// os dois), /contratos redireciona pra raiz — o caminho funciona e existe uma
// URL canonica so.
app.get(["/contratos", "/contratos/"], (req, res) => res.redirect(301, "/"));

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
  const limites = limitesDoPlano(planoEfetivo(tenant));
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
  let tenant = await store.getTenant(req.user.tenantId);
  if (!tenant) return res.json(null);
  tenant = await assinaturaAtualizada(req.user.tenantId, tenant);
  const limites = limitesDoPlano(planoEfetivo(tenant));
  res.json({
    ...tenant,
    plano: tenant.plano || "gratis",
    usoContratosNoMes: contratosUsadosNoMes(tenant),
    limiteContratosPorMes: limites.contratosPorMes === Infinity ? null : limites.contratosPorMes,
    usoIaNoMes: iaUsadaNoMes(tenant),
    limiteIaPorMes: LIMITE_IA_MENSAL,
    limiteUsuarios: limites.maxUsuarios === Infinity ? null : limites.maxUsuarios,
    temAssinaturaAtiva: !!tenant.stripeCustomerId,
    // Estado do pagamento, pra tela avisar antes/depois do corte. Sem isso o
    // usuário perde acesso sem entender o motivo.
    assinaturaStatus: tenant.assinaturaStatus || null,
    planoContratado: tenant.plano || "gratis",
    pagamentoEmAtraso: !!tenant.assinaturaAtrasadaDesde,
    diasDeTolerancia: DIAS_TOLERANCIA_ATRASO,
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
// Preços vêm do Stripe, não de constante no código — é lá que eles mudam.
// Cache curto porque a tela de conta consulta a cada abertura e preço de plano
// quase nunca muda.
const cachePrecos = new Map();
async function precoStripe(priceId) {
  if (!priceId || !stripe) return null;
  const cacheado = cachePrecos.get(priceId);
  if (cacheado && Date.now() - cacheado.em < 10 * 60 * 1000) return cacheado.valor;
  try {
    const p = await stripe.prices.retrieve(priceId);
    const valor = { centavos: p.unit_amount, moeda: p.currency, intervalo: p.recurring ? p.recurring.interval : null };
    cachePrecos.set(priceId, { valor, em: Date.now() });
    return valor;
  } catch (err) {
    console.error("Falha ao buscar preço no Stripe:", err.message);
    return null;
  }
}

// A data de renovação mudou de lugar entre versões da API do Stripe: era campo
// da assinatura e passou a viver no item. Lê dos dois.
function fimDoPeriodo(sub) {
  if (sub.current_period_end) return sub.current_period_end;
  const item = sub.items && sub.items.data && sub.items.data[0];
  return item && item.current_period_end ? item.current_period_end : null;
}

app.get("/api/billing/assinatura", requireAuth, async (req, res) => {
  const tenant = await store.getTenant(req.user.tenantId);
  if (!tenant) return res.status(404).json({ error: "Imobiliária não encontrada" });

  const planoAtual = planoEfetivo(tenant);
  const limites = limitesDoPlano(planoAtual);

  const planos = [];
  for (const id of ["gratis", "autonomo", "imobiliaria"]) {
    const p = PLANOS[id];
    planos.push({
      id,
      nome: p.nome,
      atual: id === planoAtual,
      contratosPorMes: p.contratosPorMes === Infinity ? null : p.contratosPorMes,
      maxUsuarios: p.maxUsuarios === Infinity ? null : p.maxUsuarios,
      mensal: await precoStripe(p.stripePriceId),
      anual: await precoStripe(p.stripePriceIdAnual),
    });
  }

  let assinatura = null;
  if (stripe && tenant.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
      const item = sub.items && sub.items.data && sub.items.data[0];
      const fim = fimDoPeriodo(sub);
      assinatura = {
        status: sub.status,
        cancelaNoFim: !!sub.cancel_at_period_end,
        proximoVencimento: fim ? new Date(fim * 1000).toISOString() : null,
        ciclo: item && item.price && item.price.recurring ? item.price.recurring.interval : null,
        valor: item && item.price ? { centavos: item.price.unit_amount, moeda: item.price.currency } : null,
      };
    } catch (err) {
      // Assinatura pode ter sido apagada no Stripe; a tela segue mostrando o plano.
      console.error("Falha ao consultar assinatura no Stripe:", err.message);
    }
  }

  res.json({
    planoAtual,
    planoNome: limites.nome,
    usoContratosNoMes: contratosUsadosNoMes(tenant),
    limiteContratosPorMes: limites.contratosPorMes === Infinity ? null : limites.contratosPorMes,
    usoIaNoMes: iaUsadaNoMes(tenant),
    limiteIaPorMes: LIMITE_IA_MENSAL,
    ehDono: req.user.role === "owner",
    pagamentoDisponivel: !!stripe,
    assinatura,
    planos,
  });
});

// Troca de plano de quem JÁ assina. Não pode passar pelo checkout: ele criaria
// uma segunda assinatura e o cliente seria cobrado duas vezes. Aqui a
// assinatura existente é alterada, com o Stripe calculando o proporcional.
app.post("/api/billing/mudar-plano", requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Pagamento indisponível no momento" });
  if (req.user.role !== "owner") return res.status(403).json({ error: "Só o dono da conta pode alterar o plano" });

  const tenant = await store.getTenant(req.user.tenantId);
  if (!tenant) return res.status(404).json({ error: "Imobiliária não encontrada" });
  if (!tenant.stripeSubscriptionId) {
    return res.status(409).json({ error: "Você ainda não tem assinatura ativa. Use a opção de assinar." });
  }

  const cicloNorm = req.body.ciclo === "anual" ? "anual" : "mensal";
  const priceId = precoDoPlano(req.body.plano, cicloNorm);
  if (!priceId) return res.status(400).json({ error: "Plano inválido" });

  try {
    const sub = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
    const item = sub.items.data[0];
    if (item.price.id === priceId) {
      return res.status(409).json({ error: "Você já está nesse plano e ciclo." });
    }
    await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: { tenantId: req.user.tenantId, plano: req.body.plano, ciclo: cicloNorm },
    });
    // O webhook também atualiza, mas gravar aqui evita a tela mostrar o plano
    // antigo enquanto o evento não chega.
    await store.setTenant(req.user.tenantId, { ...tenant, plano: req.body.plano });
    res.json({ ok: true, plano: req.body.plano });
  } catch (err) {
    console.error("Erro ao mudar plano no Stripe:", err);
    res.status(500).json({ error: "Não foi possível mudar o plano agora. Tente pelo botão de gerenciar assinatura." });
  }
});

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

  // Quem já assina não pode passar por aqui: o checkout abriria uma segunda
  // assinatura e a cobrança viria dobrada. Troca de plano vai por /mudar-plano.
  if (tenant.stripeSubscriptionId) {
    try {
      const atual = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
      if (["active", "trialing", "past_due", "unpaid"].includes(atual.status)) {
        return res.status(409).json({
          error: "Você já tem uma assinatura ativa. Use 'Minha conta' para trocar de plano — assim não vira cobrança dupla.",
        });
      }
    } catch (err) {
      // Assinatura não existe mais no Stripe: seguir com o checkout é o certo.
      console.error("Assinatura anterior não encontrada, seguindo com checkout:", err.message);
    }
  }

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
// Monta o branding que o gerador usa (dados da imobiliária + logo em buffer).
function brandingDoTenant(tenant) {
  const branding = { ...tenant };
  if (tenant.logoPath) {
    const logoFile = path.join(UPLOAD_DIR, path.basename(tenant.logoPath));
    if (fs.existsSync(logoFile)) branding.logoBuffer = fs.readFileSync(logoFile);
  }
  return branding;
}

// Nome legível de cada documento — usado na página pública de revisão, onde
// quem lê é o cliente e não conhece os identificadores internos.
const TITULOS_DOC = {
  compra_venda: "Contrato de Compra e Venda",
  locacao_caucao: "Contrato de Locação",
  locacao_fiador: "Contrato de Locação",
  locacao_seguro_fianca: "Contrato de Locação",
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

// Um contrato é "o mesmo" quando os dados que o originaram são idênticos.
// Serve pra reconhecer regeração (mesmo documento, outro formato) e não cobrar
// cota de novo por isso.
const JANELA_REGERACAO_MS = 24 * 60 * 60 * 1000;
function hashDados(dados) {
  return crypto.createHash("sha256").update(JSON.stringify(dados)).digest("hex").slice(0, 32);
}

// ---- Identificação de quem abre o link de revisão ----
const soDigitos = (s) => String(s || "").replace(/\D/g, "");

// Valida os dígitos verificadores. Serve pra barrar erro de digitação e
// preenchimento aleatório — não prova identidade, só que o número é bem formado.
function cpfValido(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function cnpjValido(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base) => {
    let peso = base.length - 7, soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(cnpj.slice(0, 12)) === Number(cnpj[12]) && dv(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

const documentoValido = (d) => (d.length === 14 ? cnpjValido(d) : cpfValido(d));

// Guardamos só o hash do CPF/CNPJ das partes do contrato, nunca o número. Serve
// pra dizer ao corretor se quem abriu o link é mesmo uma das partes, sem
// persistir documento de ninguém.
const hashDocumento = (d) => crypto.createHash("sha256").update(soDigitos(d)).digest("hex");

// Monta a lista de partes (rótulo + hash do documento) a partir dos dados do
// contrato, pra permitir a conferência na hora que alguém se identifica.
function partesDoContrato(dados) {
  const grupos = [
    ["locadores", "Locador(a)"], ["locatarios", "Locatário(a)"], ["fiadores", "Fiador(a)"],
    ["vendedores", "Vendedor(a)"], ["compradores", "Comprador(a)"],
  ];
  const partes = [];
  for (const [chave, rotulo] of grupos) {
    for (const p of (dados[chave] || [])) {
      const doc = soDigitos(p.cpf || p.cnpj);
      if (doc) partes.push({ rotulo, nome: p.nome || "", hash: hashDocumento(doc) });
    }
  }
  return partes;
}

function resumoContrato(dados) {
  const isLocacao = dados.tipo === "locacao_caucao" || dados.tipo === "locacao_fiador" || dados.tipo === "locacao_seguro_fianca";
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
    hash: hashDados(dados),
    // Payload completo que originou o contrato. Guardar isso é o que permite
    // reabrir e reeditar o documento depois — inclui dados pessoais das partes
    // (CPF/RG), então nunca vai em listagem: só sai pelas rotas que pedem um
    // contrato específico, e some quando o contrato é excluído no painel.
    dados,
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
    let tenant = await store.getTenant(req.user.tenantId);
    if (!tenant) return res.status(404).json({ error: "Imobiliária não encontrada" });
    // Gerar contrato é a ação que o plano paga libera: reconfere a assinatura
    // aqui também, não só quando o app carrega.
    tenant = await assinaturaAtualizada(req.user.tenantId, tenant);

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

    // Regeração do MESMO documento (outro formato, ou link de revisão depois do
    // download) não é contrato novo: não passa pela cota nem duplica o
    // histórico. Sem isso, quem baixa o PDF e depois manda pro cliente revisar
    // pagaria dois contratos pelo mesmo negócio — e no plano Grátis, que
    // permite um por mês, o segundo clique simplesmente não funcionaria.
    const jaGerado = ehAuxiliar
      ? null
      : await store.findRecentContractByHash(
          req.user.tenantId,
          hashDados(dados),
          new Date(Date.now() - JANELA_REGERACAO_MS)
        ).catch(() => null);

    const limites = limitesDoPlano(planoEfetivo(tenant));
    if (!ehAuxiliar && !jaGerado) {
      const usados = contratosUsadosNoMes(tenant);
      if (usados >= limites.contratosPorMes) {
        return res.status(402).json({
          error: `Seu plano (${limites.nome}) permite ${limites.contratosPorMes} contrato(s) por mês e você já usou todos. Faça upgrade para continuar gerando.`,
        });
      }
    }

    const LAYOUTS_PAGOS = new Set(["profissional", "elegante"]);
    if (planoEfetivo(tenant) === "gratis" && LAYOUTS_PAGOS.has(dados.layout)) {
      return res.status(402).json({
        error: `O layout "${dados.layout === "profissional" ? "Profissional" : "Elegante"}" é exclusivo dos planos pagos. Faça upgrade para usar esse visual.`,
      });
    }

    const branding = brandingDoTenant(tenant);

    let buffer = await gerarContrato(dados, branding);

    // O texto sai do .docx, antes de ele virar PDF. É o que alimenta o robô de
    // perguntas na página de revisão: as dúvidas do cliente são sobre a
    // redação das cláusulas, que não está nos campos do formulário.
    let textoContrato = "";
    if (querLink) {
      try {
        textoContrato = await extrairTextoDocx(buffer);
      } catch (err) {
        console.error("Falha ao extrair texto do contrato:", err.message);
      }
    }
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
    const contratoId = jaGerado || nanoid(12);
    if (!ehAuxiliar && !jaGerado) {
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
        partes: partesDoContrato(dados),
        acessos: [],
        situacao: "em_revisao",
        situacaoManual: false,
        observacao: "",
        // Texto usado só pra responder perguntas do cliente sobre este
        // documento. Nunca sai em listagem e some junto com o link.
        texto: textoContrato,
        perguntas: [],
        status: "pendente",
        comentario: "",
        respondidoEm: null,
        respondidoPor: null,
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
    if (!tenant || planoEfetivo(tenant) === "gratis") {
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
    if (!tenant || planoEfetivo(tenant) === "gratis") {
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
      locacao_seguro_fianca: contratos.filter(c => c.tipo === "locacao_seguro_fianca").length,
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
      // Só os gerados depois da mudança guardam os dados e podem ser reabertos.
      // Nunca mandamos o payload em si aqui — ele tem CPF/RG das partes.
      temDados: !!c.dados,
    })),
  });
});

// Devolve o payload original pra reabrir o formulário preenchido e editar.
// Esta é a única rota que expõe dados pessoais das partes (CPF/RG), então é
// sempre pelo id do contrato e com o dono conferido pelo store.
app.get("/api/dashboard/contratos/:id/dados", requireAuth, async (req, res) => {
  const contrato = await store.getContract(req.params.id, req.user.tenantId);
  if (!contrato) return res.status(404).json({ error: "Contrato não encontrado" });
  if (!contrato.dados) {
    return res.status(409).json({
      error: "Este contrato foi gerado antes de o sistema passar a guardar os dados, então não dá para editar. Gere um novo.",
    });
  }
  res.json({ id: contrato.id, criadoEm: contrato.criadoEm, dados: contrato.dados });
});

// Reabre um contrato do histórico. Em vez de guardar o arquivo, guardamos os
// dados que o originaram e regeramos aqui: ocupa menos, sai sempre no template
// atual e é o mesmo dado que a edição usa. Não consome cota — o contrato já foi
// contado quando foi criado.
app.get("/api/dashboard/contratos/:id/documento", requireAuth, async (req, res) => {
  try {
    const contrato = await store.getContract(req.params.id, req.user.tenantId);
    if (!contrato) return res.status(404).json({ error: "Contrato não encontrado" });
    if (!contrato.dados) {
      return res.status(409).json({
        error: "Este contrato foi gerado antes de o sistema passar a guardar os dados, então não dá para reabrir. Contratos gerados de agora em diante ficam disponíveis aqui.",
      });
    }

    const tenant = await store.getTenant(req.user.tenantId);
    if (!tenant) return res.status(404).json({ error: "Imobiliária não encontrada" });

    let buffer = await gerarContrato(contrato.dados, brandingDoTenant(tenant));
    const querPdf = req.query.formato === "pdf";
    // Content-Disposition não aceita acento: "Contrato de Locação" viraria
    // "Contrato de Loca??o" no nome do arquivo baixado.
    const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
    const titulo = semAcento(TITULOS_DOC[contrato.tipo] || "Documento").replace(/[^a-zA-Z0-9]+/g, "-");
    const endereco = semAcento(contrato.endereco).slice(0, 20).replace(/[^a-zA-Z0-9]+/g, "");
    const nomeBase = endereco ? `${titulo}_${endereco}` : titulo;

    if (querPdf) {
      try {
        buffer = await convertDocxToPdf(buffer);
      } catch (err) {
        console.error("Falha ao converter para PDF:", err);
        return res.status(502).json({ error: "Não foi possível gerar o PDF agora. Tente baixar em .docx." });
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.pdf"`);
    } else {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.docx"`);
    }
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: IS_PROD ? "Não foi possível reabrir o contrato agora." : err.message });
  }
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

// Teto de perguntas por link. O endereço é público e quem paga a IA é a conta
// do corretor: sem isso, um cliente curioso esvaziaria a cota mensal dele.
const LIMITE_PERGUNTAS_POR_LINK = 10;

// Situação do negócio, controlada pelo corretor. É diferente do "status", que
// é a resposta do cliente (pendente/aprovado/ajuste) e vem da própria página de
// revisão. Separar os dois evita um sobrescrever o outro: o cliente aprovar não
// significa que já assinou, e o corretor marcar "assinado" não apaga o registro
// de que o cliente havia pedido ajuste.
const SITUACOES = ["em_revisao", "em_correcao", "aguardando_assinatura", "assinado", "perdido"];

// Quando o cliente responde, a situação anda sozinha — mas só enquanto o
// corretor não tiver mexido nela. Depois disso ela é dele, e o sistema não
// desfaz o que ele marcou.
function situacaoAposResposta(share, acao) {
  if (share.situacaoManual) return null;
  return acao === "ajuste" ? "em_correcao" : "aguardando_assinatura";
}

app.get("/r/:token", revisaoLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "revisao.html"));
});

// Dados que a página de revisão mostra. Devolve só o que o cliente precisa ver
// — nada da conta do corretor além do nome que assina o documento.
app.get("/api/revisao/:token", revisaoLimiter, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share) return res.status(404).json({ error: "Este link não existe mais ou expirou." });
  const acesso = acessoValido(share, req.query.acesso);
  res.json({
    titulo: share.titulo,
    imobiliaria: share.imobiliaria,
    status: share.status,
    criadoEm: share.criadoEm,
    expiraEm: share.expiraEm,
    identificado: !!acesso,
    identificadoComo: acesso ? { nome: acesso.nome, confere: acesso.confere, parte: acesso.parteRotulo } : null,
    // Endereço do imóvel, comentário e autoria da resposta só depois da
    // identificação — antes disso a página mostra apenas o necessário pra
    // pessoa entender o que está sendo pedido.
    endereco: acesso ? share.endereco : null,
    destinatario: acesso ? share.destinatario : null,
    comentario: acesso ? share.comentario : null,
    respondidoEm: acesso ? share.respondidoEm : null,
    respondidoPor: acesso ? share.respondidoPor : null,
    assistente: acesso && ai.disponivel && !!share.texto,
    perguntas: acesso ? (share.perguntas || []).map(p => ({ pergunta: p.pergunta, resposta: p.resposta, por: p.por, em: p.em })) : [],
    perguntasRestantes: acesso ? Math.max(0, LIMITE_PERGUNTAS_POR_LINK - (share.perguntas || []).length) : 0,
  });
});

// Quem abre o link se identifica antes de ver o documento. Isso não restringe
// o acesso — quem tem o endereço pode digitar qualquer nome —, mas registra
// quem leu e quem aprovou, e confere o documento informado contra as partes do
// contrato pra que o corretor saiba se foi mesmo o locatário que respondeu.
app.post("/api/revisao/:token/identificar", revisaoLimiter, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share) return res.status(404).json({ error: "Este link não existe mais ou expirou." });

  const nome = String(req.body.nome || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (nome.length < 3 || !nome.includes(" ")) {
    return res.status(400).json({ error: "Informe seu nome completo." });
  }
  const doc = soDigitos(req.body.documento);
  if (!documentoValido(doc)) {
    return res.status(400).json({ error: "CPF ou CNPJ inválido. Confira os números." });
  }

  const hash = hashDocumento(doc);
  const parte = (share.partes || []).find(p => p.hash === hash) || null;

  const acesso = {
    id: nanoid(10),
    nome,
    // Guarda só os últimos dígitos pra identificar sem manter o documento
    // inteiro; a conferência de verdade é pelo hash, acima.
    documentoFinal: doc.slice(-4),
    ehCpf: doc.length === 11,
    parteRotulo: parte ? parte.rotulo : null,
    parteNome: parte ? parte.nome : null,
    confere: !!parte,
    em: new Date().toISOString(),
  };
  const acessos = [...(share.acessos || []), acesso].slice(-30);
  await store.updateShareMeta(req.params.token, { acessos });

  res.json({ acesso: acesso.id, nome: acesso.nome, confere: acesso.confere, parte: acesso.parteRotulo });
});

// Confere se o portador do link já se identificou nesta sessão.
function acessoValido(share, id) {
  if (!id) return null;
  return (share.acessos || []).find(a => a.id === id) || null;
}

app.get("/api/revisao/:token/documento.pdf", revisaoLimiter, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share) return res.status(404).send("Este link não existe mais ou expirou.");
  if (!acessoValido(share, req.query.acesso)) {
    return res.status(403).send("Identifique-se para abrir o documento.");
  }
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
  const acesso = acessoValido(share, req.body.acesso);
  if (!acesso) return res.status(403).json({ error: "Identifique-se para responder." });
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
  const novaSituacao = situacaoAposResposta(share, acao);
  const patch = {
    status: acao === "aprovar" ? "aprovado" : "ajuste",
    ...(novaSituacao ? { situacao: novaSituacao } : {}),
    comentario,
    respondidoEm: new Date().toISOString(),
    respondidoPor: {
      nome: acesso.nome,
      documentoFinal: acesso.documentoFinal,
      ehCpf: acesso.ehCpf,
      confere: acesso.confere,
      parteRotulo: acesso.parteRotulo,
    },
  };
  await store.updateShareMeta(req.params.token, patch);
  res.json({ ok: true, ...patch });
});

app.post("/api/revisao/:token/perguntar", revisaoLimiter, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share) return res.status(404).json({ error: "Este link não existe mais ou expirou." });
  const acesso = acessoValido(share, req.body.acesso);
  if (!acesso) return res.status(403).json({ error: "Identifique-se para perguntar." });
  if (!ai.disponivel) return res.status(503).json({ error: "Assistente indisponível no momento." });
  if (!share.texto) {
    return res.status(409).json({ error: "Este documento não tem texto disponível para consulta. Fale com quem enviou." });
  }

  const perguntas = share.perguntas || [];
  if (perguntas.length >= LIMITE_PERGUNTAS_POR_LINK) {
    return res.status(429).json({
      error: `Este documento já recebeu ${LIMITE_PERGUNTAS_POR_LINK} perguntas. Para continuar, fale direto com quem enviou.`,
    });
  }

  // Quem paga a IA é a conta que gerou o contrato, então a cota é a dela.
  const tenant = await store.getTenant(share.tenantId);
  if (!tenant) return res.status(404).json({ error: "Assistente indisponível para este documento." });
  if (iaUsadaNoMes(tenant) >= LIMITE_IA_MENSAL) {
    return res.status(429).json({ error: "O assistente atingiu o limite deste mês. Fale direto com quem enviou o documento." });
  }

  try {
    const resposta = await ai.responderSobreContrato({
      textoContrato: share.texto,
      pergunta: req.body.pergunta,
    });
    await registrarUsoIa(share.tenantId, tenant);

    const registro = {
      pergunta: String(req.body.pergunta).trim().slice(0, 500),
      resposta,
      por: acesso.nome,
      em: new Date().toISOString(),
    };
    await store.updateShareMeta(req.params.token, { perguntas: [...perguntas, registro] });

    res.json({ ...registro, restantes: LIMITE_PERGUNTAS_POR_LINK - perguntas.length - 1 });
  } catch (err) {
    console.error("Erro ao responder pergunta do cliente:", err.message);
    res.status(502).json({ error: "Não consegui responder agora. Tente de novo ou fale com quem enviou o documento." });
  }
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
    // Envios antigos não têm situação: entram como "em revisão".
    situacao: s.situacao || "em_revisao",
    observacao: s.observacao || "",
    // Liga a revisão ao contrato de origem, pra dar pra editar direto do
    // pedido de ajuste. É só o id — os dados ficam atrás da rota própria.
    contratoId: s.contratoId || null,
    comentario: s.comentario,
    respondidoEm: s.respondidoEm,
    respondidoPor: s.respondidoPor || null,
    acessos: s.acessos || [],
    // O que o cliente perguntou ao assistente. É o retorno mais útil aqui:
    // mostra a dúvida que teria virado ligação pro corretor.
    perguntas: s.perguntas || [],
    criadoEm: s.criadoEm,
    expiraEm: s.expiraEm,
  })));
});

// Corretor marca onde o negócio está. A partir da primeira vez que ele mexe,
// o avanço automático para de agir — a situação passa a ser dele.
app.patch("/api/compartilhamentos/:token/situacao", requireAuth, async (req, res) => {
  const share = await store.getShare(req.params.token);
  if (!share || share.tenantId !== req.user.tenantId) {
    return res.status(404).json({ error: "Envio não encontrado" });
  }
  const situacao = String(req.body.situacao || "");
  if (!SITUACOES.includes(situacao)) return res.status(400).json({ error: "Situação inválida" });

  const patch = { situacao, situacaoManual: true };
  if (req.body.observacao !== undefined) {
    patch.observacao = String(req.body.observacao).trim().slice(0, 500);
  }
  await store.updateShareMeta(req.params.token, patch);
  res.json({ ok: true, ...patch });
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
