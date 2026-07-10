const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { nanoid } = require("nanoid");
const { gerarContrato } = require("./lib/generator");
const { convertDocxToPdf } = require("./lib/pdf");

const app = express();
const PORT = process.env.PORT || 4173;
const IS_PROD = process.env.NODE_ENV === "production";

// Plataformas como Railway/Render ficam atrás de um proxy HTTPS — sem isso,
// o cookie "secure" nunca seria enviado de volta pelo navegador.
if (IS_PROD) app.set("trust proxy", 1);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
// Por padrão, uploads fica dentro de DATA_DIR — assim um único volume
// persistente montado em DATA_DIR cobre tudo (contas, sessões e logos).
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const TENANTS_FILE = path.join(DATA_DIR, "tenants.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SECRET_FILE = path.join(DATA_DIR, "session-secret.txt");
[DATA_DIR, UPLOAD_DIR, SESSIONS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
if (!fs.existsSync(TENANTS_FILE)) fs.writeFileSync(TENANTS_FILE, "{}");
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex"));
const SESSION_SECRET = process.env.SESSION_SECRET || fs.readFileSync(SECRET_FILE, "utf8").trim();

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
const readTenants = () => readJson(TENANTS_FILE);
const writeTenants = (o) => writeJson(TENANTS_FILE, o);
const readUsers = () => readJson(USERS_FILE);
const writeUsers = (o) => writeJson(USERS_FILE, o);

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

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
  const users = readUsers();
  const user = users[req.session.userId];
  if (!user) { req.session.destroy(() => {}); return res.status(401).json({ error: "Sessão inválida" }); }
  req.user = user;
  next();
}

function publicUser(user) {
  return { id: user.id, email: user.email, nome: user.nome, tenantId: user.tenantId, role: user.role };
}

// ================= AUTH =================
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, nome, imobiliariaNome } = req.body || {};
    if (!email || !password || !imobiliariaNome) {
      return res.status(400).json({ error: "E-mail, senha e nome da imobiliária são obrigatórios" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres" });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const users = readUsers();
    if (Object.values(users).some(u => u.email === emailNorm)) {
      return res.status(409).json({ error: "Já existe uma conta com esse e-mail" });
    }

    const tenantId = nanoid(8);
    const tenants = readTenants();
    tenants[tenantId] = {
      nome: imobiliariaNome,
      creci: "", cnpj: "", email: emailNorm, endereco: "",
      cidade: "Natal", foroPadrao: "Natal/RN", corPrimaria: "00A859", logoPath: null,
    };
    writeTenants(tenants);

    const userId = nanoid(10);
    const passwordHash = await bcrypt.hash(password, 10);
    users[userId] = { id: userId, email: emailNorm, passwordHash, nome: nome || "", tenantId, role: "owner" };
    writeUsers(users);

    req.session.userId = userId;
    res.json({ user: publicUser(users[userId]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar conta" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();
    const users = readUsers();
    const user = Object.values(users).find(u => u.email === emailNorm);
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

  const users = readUsers();
  const teammates = Object.values(users).filter(u => u.tenantId === req.user.tenantId && u.id !== req.user.id);

  if (req.user.role === "owner" && teammates.length > 0) {
    return res.status(400).json({ error: "Remova ou promova os demais membros da equipe antes de excluir a conta do dono." });
  }

  delete users[req.user.id];
  writeUsers(users);

  // Dono era o último usuário do tenant: apaga a imobiliária e os uploads junto.
  if (req.user.role === "owner") {
    const tenants = readTenants();
    const tenant = tenants[req.user.tenantId];
    if (tenant && tenant.logoPath) {
      const logoFile = path.join(UPLOAD_DIR, path.basename(tenant.logoPath));
      fs.rm(logoFile, { force: true }, () => {});
    }
    delete tenants[req.user.tenantId];
    writeTenants(tenants);
  }

  req.session.destroy(() => res.json({ ok: true }));
});

// ================= EQUIPE (usuários do mesmo tenant) =================
app.get("/api/team", requireAuth, (req, res) => {
  const users = readUsers();
  const team = Object.values(users)
    .filter(u => u.tenantId === req.user.tenantId)
    .map(publicUser);
  res.json(team);
});

app.post("/api/team/invite", requireAuth, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Só o dono da conta pode convidar corretores" });
  const { email, password, nome } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
  if (String(password).length < 8) return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres" });
  const emailNorm = String(email).trim().toLowerCase();
  const users = readUsers();
  if (Object.values(users).some(u => u.email === emailNorm)) {
    return res.status(409).json({ error: "Já existe uma conta com esse e-mail" });
  }
  const userId = nanoid(10);
  const passwordHash = await bcrypt.hash(password, 10);
  users[userId] = { id: userId, email: emailNorm, passwordHash, nome: nome || "", tenantId: req.user.tenantId, role: "corretor" };
  writeUsers(users);
  res.json(publicUser(users[userId]));
});

app.delete("/api/team/:id", requireAuth, (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Só o dono da conta pode remover corretores" });
  const users = readUsers();
  const target = users[req.params.id];
  if (!target || target.tenantId !== req.user.tenantId) return res.status(404).json({ error: "Usuário não encontrado" });
  if (target.role === "owner") return res.status(400).json({ error: "Não é possível remover o dono da conta" });
  delete users[req.params.id];
  writeUsers(users);
  res.json({ ok: true });
});

// ================= TENANT (marca da própria imobiliária) =================
app.get("/api/tenant", requireAuth, (req, res) => {
  const tenants = readTenants();
  res.json(tenants[req.user.tenantId] || null);
});

app.post("/api/tenant", requireAuth, upload.single("logo"), (req, res) => {
  const tenants = readTenants();
  const existing = tenants[req.user.tenantId] || {};
  const branding = {
    nome: req.body.nome || existing.nome || "",
    creci: req.body.creci || existing.creci || "",
    cnpj: req.body.cnpj || existing.cnpj || "",
    email: req.body.email || existing.email || "",
    endereco: req.body.endereco || existing.endereco || "",
    cidade: req.body.cidade || existing.cidade || "Natal",
    foroPadrao: req.body.foroPadrao || existing.foroPadrao || "Natal/RN",
    corPrimaria: req.body.corPrimaria || existing.corPrimaria || "00A859",
    logoPath: req.file ? `/uploads/${req.file.filename}` : existing.logoPath || null,
  };
  tenants[req.user.tenantId] = branding;
  writeTenants(tenants);
  res.json(branding);
});

// ================= GERAÇÃO DE CONTRATO =================
app.post("/api/gerar", requireAuth, async (req, res) => {
  try {
    const { dados, formato } = req.body;
    if (!dados) return res.status(400).json({ error: "dados são obrigatórios" });
    const querPdf = formato === "pdf";
    const tenants = readTenants();
    const tenant = tenants[req.user.tenantId];
    if (!tenant) return res.status(404).json({ error: "Imobiliária não encontrada" });

    const branding = { ...tenant };
    if (tenant.logoPath) {
      const logoFile = path.join(UPLOAD_DIR, path.basename(tenant.logoPath));
      if (fs.existsSync(logoFile)) branding.logoBuffer = fs.readFileSync(logoFile);
    }

    let buffer = await gerarContrato(dados, branding);
    const nomeBase = `Contrato_${(dados.tipo || "contrato").replace(/_/g, "-")}_${(dados.imovel && dados.imovel.endereco || "").slice(0, 20).replace(/[^a-zA-Z0-9]+/g, "")}` || "contrato";

    if (querPdf) {
      try {
        buffer = await convertDocxToPdf(buffer);
      } catch (err) {
        console.error("Falha ao converter para PDF:", err);
        return res.status(502).json({ error: "Não foi possível gerar o PDF agora. Tente novamente ou baixe em .docx." });
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
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || "Erro na requisição" });
  next();
});

app.listen(PORT, () => console.log(`Imob Contratos rodando em http://localhost:${PORT}`));
