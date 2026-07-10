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

async function init(dataDir) {
  if (usingPostgres) {
    await pool.query(`CREATE TABLE IF NOT EXISTS tenants (id text PRIMARY KEY, data jsonb NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, data jsonb NOT NULL)`);
    return;
  }
  tenantsFile = path.join(dataDir, "tenants.json");
  usersFile = path.join(dataDir, "users.json");
  if (!fs.existsSync(tenantsFile)) fs.writeFileSync(tenantsFile, "{}");
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, "{}");
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

module.exports = {
  usingPostgres,
  init,
  getTenant, setTenant, deleteTenant,
  getAllUsers, getUser, getUserByEmail, setUser, deleteUser,
};
