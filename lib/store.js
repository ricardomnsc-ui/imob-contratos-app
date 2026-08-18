/**
 * Camada de armazenamento de tenants e users.
 *
 * Usa Postgres (via DATABASE_URL) quando disponível — cada registro é uma
 * linha própria (id + jsonb), gravada/lida/apagada individualmente, o que
 * evita o problema do armazenamento anterior em arquivo único (ler tudo,
 * mexer numa chave, sobrescrever o arquivo inteiro — inseguro com escritas
 * concorrentes). Sem DATABASE_URL, cai de volta para arquivos JSON locais,
 * suficiente para desenvolvimento.
 */
const fs = require("fs");
const path = require("path");

const usingPostgres = !!process.env.DATABASE_URL;

let pool = null;
if (usingPostgres) {
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });
}

let tenantsFile = null;
let usersFile = null;
let contractsFile = null;
let sharesFile = null;
let sharesDir = null;
let comprasFile = null;

async function init(dataDir) {
  if (usingPostgres) {
    await pool.query(`CREATE TABLE IF NOT EXISTS tenants (id text PRIMARY KEY, data jsonb NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, data jsonb NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS contracts (
      id text PRIMARY KEY, tenant_id text NOT NULL, data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS shares (
      id text PRIMARY KEY, tenant_id text NOT NULL, meta jsonb NOT NULL, pdf bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_shares_tenant ON shares(tenant_id)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS compras (
      id text PRIMARY KEY, session_id text NOT NULL UNIQUE, email text NOT NULL,
      data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    return;
  }
  tenantsFile = path.join(dataDir, "tenants.json");
  usersFile = path.join(dataDir, "users.json");
  contractsFile = path.join(dataDir, "contracts.json");
  sharesFile = path.join(dataDir, "shares.json");
  comprasFile = path.join(dataDir, "compras.json");
  sharesDir = path.join(dataDir, "shares");
  if (!fs.existsSync(tenantsFile)) fs.writeFileSync(tenantsFile, "{}");
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, "{}");
  if (!fs.existsSync(contractsFile)) fs.writeFileSync(contractsFile, "{}");
  if (!fs.existsSync(sharesFile)) fs.writeFileSync(sharesFile, "{}");
  if (!fs.existsSync(comprasFile)) fs.writeFileSync(comprasFile, "{}");
  fs.mkdirSync(sharesDir, { recursive: true });
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJsonFile(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// ================= Tenants =================
async function getTenant(id) {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT data FROM tenants WHERE id = $1", [id]);
    return rows[0] ? rows[0].data : null;
  }
  const all = readJsonFile(tenantsFile);
  return all[id] || null;
}

async function getAllTenants() {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT id, data FROM tenants");
    return rows.map(r => ({ id: r.id, ...r.data }));
  }
  const all = readJsonFile(tenantsFile);
  return Object.entries(all).map(([id, data]) => ({ id, ...data }));
}

async function setTenant(id, data) {
  if (usingPostgres) {
    await pool.query(
      "INSERT INTO tenants (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
      [id, data]
    );
    return;
  }
  const all = readJsonFile(tenantsFile);
  all[id] = data;
  writeJsonFile(tenantsFile, all);
}

async function deleteTenant(id) {
  if (usingPostgres) {
    await pool.query("DELETE FROM tenants WHERE id = $1", [id]);
    return;
  }
  const all = readJsonFile(tenantsFile);
  delete all[id];
  writeJsonFile(tenantsFile, all);
}

// ================= Users =================
async function getAllUsers() {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT data FROM users");
    return rows.map(r => r.data);
  }
  return Object.values(readJsonFile(usersFile));
}

async function getUser(id) {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT data FROM users WHERE id = $1", [id]);
    return rows[0] ? rows[0].data : null;
  }
  const all = readJsonFile(usersFile);
  return all[id] || null;
}

async function getUserByEmail(email) {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT data FROM users WHERE data->>'email' = $1", [email]);
    return rows[0] ? rows[0].data : null;
  }
  const all = Object.values(readJsonFile(usersFile));
  return all.find(u => u.email === email) || null;
}

async function setUser(id, data) {
  if (usingPostgres) {
    await pool.query(
      "INSERT INTO users (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
      [id, data]
    );
    return;
  }
  const all = readJsonFile(usersFile);
  all[id] = data;
  writeJsonFile(usersFile, all);
}

async function deleteUser(id) {
  if (usingPostgres) {
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    return;
  }
  const all = readJsonFile(usersFile);
  delete all[id];
  writeJsonFile(usersFile, all);
}

// ================= Contracts (histórico p/ dashboard) =================
async function addContract(id, tenantId, data) {
  if (usingPostgres) {
    await pool.query(
      "INSERT INTO contracts (id, tenant_id, data) VALUES ($1, $2, $3)",
      [id, tenantId, data]
    );
    return;
  }
  const all = readJsonFile(contractsFile);
  all[id] = { tenantId, data, createdAt: new Date().toISOString() };
  writeJsonFile(contractsFile, all);
}

async function getContractsByTenant(tenantId) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      "SELECT id, data, created_at FROM contracts WHERE tenant_id = $1 ORDER BY created_at DESC",
      [tenantId]
    );
    return rows.map(r => ({ ...r.data, id: r.id, criadoEm: r.created_at }));
  }
  const all = readJsonFile(contractsFile);
  return Object.entries(all)
    .filter(([, c]) => c.tenantId === tenantId)
    .sort((a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt))
    .map(([id, c]) => ({ ...c.data, id, criadoEm: c.createdAt }));
}

// Procura um contrato idêntico gerado há pouco pela mesma conta. Serve pra não
// cobrar cota duas vezes quando o corretor gera o mesmo documento em formatos
// diferentes (.docx, depois .pdf, depois link de revisão).
async function findRecentContractByHash(tenantId, hash, desde) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      "SELECT id FROM contracts WHERE tenant_id = $1 AND data->>'hash' = $2 AND created_at > $3 ORDER BY created_at DESC LIMIT 1",
      [tenantId, hash, desde]
    );
    return rows[0] ? rows[0].id : null;
  }
  const all = readJsonFile(contractsFile);
  const achado = Object.entries(all)
    .filter(([, c]) => c.tenantId === tenantId && c.data && c.data.hash === hash && new Date(c.createdAt) > desde)
    .sort((a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt))[0];
  return achado ? achado[0] : null;
}

async function getContract(id, tenantId) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      "SELECT id, data, created_at FROM contracts WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    return rows[0] ? { ...rows[0].data, id: rows[0].id, criadoEm: rows[0].created_at } : null;
  }
  const all = readJsonFile(contractsFile);
  const c = all[id];
  if (!c || c.tenantId !== tenantId) return null;
  return { ...c.data, id, criadoEm: c.createdAt };
}

async function deleteContract(id, tenantId) {
  if (usingPostgres) {
    await pool.query("DELETE FROM contracts WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
    return;
  }
  const all = readJsonFile(contractsFile);
  if (all[id] && all[id].tenantId === tenantId) {
    delete all[id];
    writeJsonFile(contractsFile, all);
  }
}

// ================= Shares (revisão do documento por link público) =================
// Guarda o PDF já renderizado e, desde o assistente de dúvidas, também o texto
// do documento.
//
// ATENÇÃO ao mexer aqui: tanto o PDF quanto o texto contêm os dados pessoais
// das partes (CPF, RG, endereço) — o texto em formato pesquisável. O que NÃO
// fica guardado é o documento das partes de forma isolada: para conferir quem
// se identificou, só o hash SHA-256 é gravado (ver partesDoContrato no
// server.js). Todo o registro é apagado quando o link expira.
//
// Por isso nenhum campo daqui pode entrar em listagem: as rotas montam a
// resposta com campos explícitos, nunca espalhando o meta inteiro.

async function addShare(token, tenantId, meta, pdfBuffer, expiresAt) {
  if (usingPostgres) {
    await pool.query(
      "INSERT INTO shares (id, tenant_id, meta, pdf, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [token, tenantId, meta, pdfBuffer, expiresAt]
    );
    return;
  }
  const all = readJsonFile(sharesFile);
  all[token] = { tenantId, meta, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString() };
  writeJsonFile(sharesFile, all);
  fs.writeFileSync(path.join(sharesDir, `${token}.pdf`), pdfBuffer);
}

// Devolve os metadados do share (sem o PDF). Um share expirado é tratado
// como inexistente, para o link deixar de funcionar sozinho na data.
async function getShare(token) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      "SELECT id, tenant_id, meta, created_at, expires_at FROM shares WHERE id = $1 AND expires_at > now()",
      [token]
    );
    if (!rows[0]) return null;
    return { id: rows[0].id, tenantId: rows[0].tenant_id, ...rows[0].meta, criadoEm: rows[0].created_at, expiraEm: rows[0].expires_at };
  }
  const all = readJsonFile(sharesFile);
  const s = all[token];
  if (!s || new Date(s.expiresAt) <= new Date()) return null;
  return { id: token, tenantId: s.tenantId, ...s.meta, criadoEm: s.createdAt, expiraEm: s.expiresAt };
}

async function getSharePdf(token) {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT pdf FROM shares WHERE id = $1 AND expires_at > now()", [token]);
    return rows[0] ? rows[0].pdf : null;
  }
  const file = path.join(sharesDir, `${token}.pdf`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

async function updateShareMeta(token, patch) {
  if (usingPostgres) {
    await pool.query("UPDATE shares SET meta = meta || $2 WHERE id = $1", [token, patch]);
    return;
  }
  const all = readJsonFile(sharesFile);
  if (!all[token]) return;
  all[token].meta = { ...all[token].meta, ...patch };
  writeJsonFile(sharesFile, all);
}

async function getSharesByTenant(tenantId) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      "SELECT id, meta, created_at, expires_at FROM shares WHERE tenant_id = $1 AND expires_at > now() ORDER BY created_at DESC",
      [tenantId]
    );
    return rows.map(r => ({ id: r.id, ...r.meta, criadoEm: r.created_at, expiraEm: r.expires_at }));
  }
  const all = readJsonFile(sharesFile);
  const agora = new Date();
  return Object.entries(all)
    .filter(([, s]) => s.tenantId === tenantId && new Date(s.expiresAt) > agora)
    .sort((a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt))
    .map(([id, s]) => ({ id, ...s.meta, criadoEm: s.createdAt, expiraEm: s.expiresAt }));
}

async function deleteShare(token, tenantId) {
  if (usingPostgres) {
    await pool.query("DELETE FROM shares WHERE id = $1 AND tenant_id = $2", [token, tenantId]);
    return;
  }
  const all = readJsonFile(sharesFile);
  if (all[token] && all[token].tenantId === tenantId) {
    delete all[token];
    writeJsonFile(sharesFile, all);
    fs.rmSync(path.join(sharesDir, `${token}.pdf`), { force: true });
  }
}

// Remove shares vencidos — o PDF é o registro mais pesado do banco e não há
// razão para guardá-lo depois que o link parou de funcionar.
async function purgeExpiredShares() {
  if (usingPostgres) {
    const { rowCount } = await pool.query("DELETE FROM shares WHERE expires_at <= now()");
    return rowCount;
  }
  const all = readJsonFile(sharesFile);
  const agora = new Date();
  let n = 0;
  for (const [id, s] of Object.entries(all)) {
    if (new Date(s.expiresAt) <= agora) {
      delete all[id];
      fs.rmSync(path.join(sharesDir, `${id}.pdf`), { force: true });
      n++;
    }
  }
  if (n) writeJsonFile(sharesFile, all);
  return n;
}

// ================= COMPRAS AVULSAS (E-BOOKS) =================
// Compra fora da assinatura: o comprador paga pelo Stripe Checkout e recebe um
// link de download que continua valendo. Guardamos o e-mail porque a compra É a
// captação — quem paga R$ 4,99 num guia de contrato é corretor de verdade, não
// curioso, e essa é a lista com que dá pra conversar depois.
//
// `session_id` é UNIQUE de propósito: a sessão do Stripe é a chave natural da
// compra, e a mesma sessão chega aqui por dois caminhos (o webhook e a página
// de obrigado, que consulta o Stripe direto quando o webhook ainda não chegou).
// O UNIQUE faz a segunda tentativa devolver o token já gravado em vez de criar
// uma compra duplicada com outro link.

async function addCompra(id, sessionId, email, data) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      `INSERT INTO compras (id, session_id, email, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE SET session_id = EXCLUDED.session_id
       RETURNING id`,
      [id, sessionId, email, data]
    );
    return rows[0].id;
  }
  const all = readJsonFile(comprasFile);
  const existente = Object.keys(all).find(k => all[k].sessionId === sessionId);
  if (existente) return existente;
  all[id] = { sessionId, email, data, createdAt: new Date().toISOString() };
  writeJsonFile(comprasFile, all);
  return id;
}

async function getCompra(id) {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT id, session_id, email, data, created_at FROM compras WHERE id = $1", [id]);
    if (!rows[0]) return null;
    return { id: rows[0].id, sessionId: rows[0].session_id, email: rows[0].email, ...rows[0].data, criadoEm: rows[0].created_at };
  }
  const c = readJsonFile(comprasFile)[id];
  if (!c) return null;
  return { id, sessionId: c.sessionId, email: c.email, ...c.data, criadoEm: c.createdAt };
}

async function getCompraPorSessao(sessionId) {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT id FROM compras WHERE session_id = $1", [sessionId]);
    return rows[0] ? rows[0].id : null;
  }
  const all = readJsonFile(comprasFile);
  return Object.keys(all).find(k => all[k].sessionId === sessionId) || null;
}

// Contador de downloads. Serve pra enxergar se quem pagou chegou a baixar —
// sem e-mail transacional, esse número é o único sinal de entrega que temos.
async function registrarDownloadCompra(id) {
  if (usingPostgres) {
    await pool.query(
      `UPDATE compras SET data = jsonb_set(
         jsonb_set(data, '{downloads}', to_jsonb(COALESCE((data->>'downloads')::int, 0) + 1)),
         '{ultimoDownload}', to_jsonb(now()::text)
       ) WHERE id = $1`,
      [id]
    );
    return;
  }
  const all = readJsonFile(comprasFile);
  if (!all[id]) return;
  all[id].data = { ...all[id].data, downloads: (all[id].data.downloads || 0) + 1, ultimoDownload: new Date().toISOString() };
  writeJsonFile(comprasFile, all);
}

async function getCompras() {
  if (usingPostgres) {
    const { rows } = await pool.query("SELECT id, session_id, email, data, created_at FROM compras ORDER BY created_at DESC");
    return rows.map(r => ({ id: r.id, sessionId: r.session_id, email: r.email, ...r.data, criadoEm: r.created_at }));
  }
  const all = readJsonFile(comprasFile);
  return Object.keys(all)
    .map(id => ({ id, sessionId: all[id].sessionId, email: all[id].email, ...all[id].data, criadoEm: all[id].createdAt }))
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

module.exports = {
  usingPostgres,
  init,
  getTenant, setTenant, deleteTenant, getAllTenants,
  getAllUsers, getUser, getUserByEmail, setUser, deleteUser,
  addContract, getContractsByTenant, getContract, deleteContract, findRecentContractByHash,
  addShare, getShare, getSharePdf, updateShareMeta, getSharesByTenant, deleteShare, purgeExpiredShares,
  addCompra, getCompra, getCompraPorSessao, registrarDownloadCompra, getCompras,
};
