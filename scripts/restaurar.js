#!/usr/bin/env node
/**
 * Restaura um backup gerado por scripts/backup.js.
 *
 * Backup que nunca foi restaurado é esperança, não garantia — este script
 * existe para transformar uma coisa na outra.
 *
 * A restauração é a operação mais perigosa do projeto: restaurar por engano
 * em cima da produção apaga o que estiver lá. Por isso o alvo NÃO vem de
 * `DATABASE_URL`, e sim de uma variável própria, `RESTORE_DATABASE_URL`, que
 * ninguém define sem querer. E ainda assim ele se recusa a escrever num banco
 * que já tem dados, a menos que você peça explicitamente.
 *
 * Uso (num banco DE TESTE, nunca na produção):
 *   RESTORE_DATABASE_URL="postgres://..." node scripts/restaurar.js backups/minutei-....json.gz
 *   ... --conferir       só lê o arquivo e mostra o conteúdo, não escreve nada
 *   ... --sobrescrever   aceita escrever num banco que já tem dados
 */
const fs = require("fs");
const zlib = require("zlib");
const { Pool } = require("pg");

const arquivo = process.argv.find((a) => a.endsWith(".json.gz"));
const soConferir = process.argv.includes("--conferir");
const sobrescrever = process.argv.includes("--sobrescrever");

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS tenants (id text PRIMARY KEY, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS contracts (id text PRIMARY KEY, tenant_id text NOT NULL, data jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS shares (id text PRIMARY KEY, tenant_id text NOT NULL, meta jsonb NOT NULL,
     pdf bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS compras (id text PRIMARY KEY, session_id text NOT NULL UNIQUE, email text NOT NULL,
     data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
];

const INSERTS = {
  tenants: { sql: `INSERT INTO tenants (id, data) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    campos: (r) => [r.id, r.data] },
  users: { sql: `INSERT INTO users (id, data) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    campos: (r) => [r.id, r.data] },
  contracts: { sql: `INSERT INTO contracts (id, tenant_id, data, created_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    campos: (r) => [r.id, r.tenant_id, r.data, r.created_at] },
  shares: { sql: `INSERT INTO shares (id, tenant_id, meta, pdf, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET meta = EXCLUDED.meta`,
    campos: (r) => [r.id, r.tenant_id, r.meta, Buffer.from(r.pdf || "", "base64"), r.created_at, r.expires_at] },
  compras: { sql: `INSERT INTO compras (id, session_id, email, data, created_at) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO NOTHING`,
    campos: (r) => [r.id, r.session_id, r.email, r.data, r.created_at] },
};

function lerDump() {
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error("Informe o arquivo de backup: node scripts/restaurar.js backups/minutei-....json.gz");
    process.exit(1);
  }
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(arquivo)).toString());
  console.log(`backup de ${dump.gerado_em}`);
  for (const [t, linhas] of Object.entries(dump.tabelas)) {
    console.log(`  ${t.padEnd(10)} ${linhas.length} registro(s)`);
  }
  return dump;
}

async function main() {
  const dump = lerDump();
  if (soConferir) {
    console.log("\n--conferir: nada foi escrito.");
    return;
  }

  const alvo = process.env.RESTORE_DATABASE_URL;
  if (!alvo) {
    console.error("\nFalta RESTORE_DATABASE_URL com o banco DE DESTINO.");
    console.error("É uma variável separada de propósito: assim não dá pra restaurar em cima da produção sem querer.");
    process.exit(1);
  }
  // Rede de proteção: se o destino for exatamente o banco de produção que
  // estiver no ambiente, para. Vale para o caso de alguém copiar a URL errada.
  const producao = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (producao && alvo === producao) {
    console.error("\nRECUSADO: o destino é o mesmo banco de produção que está no ambiente.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: alvo, ssl: { rejectUnauthorized: false } });
  for (const sql of ESQUEMA) await pool.query(sql);

  if (!sobrescrever) {
    for (const tabela of Object.keys(INSERTS)) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${tabela}`);
      if (rows[0].n > 0) {
        console.error(`\nRECUSADO: a tabela ${tabela} do destino já tem ${rows[0].n} registro(s).`);
        console.error("Use um banco vazio, ou passe --sobrescrever se tiver certeza.");
        await pool.end();
        process.exit(1);
      }
    }
  }

  const restaurado = {};
  for (const [tabela, { sql, campos }] of Object.entries(INSERTS)) {
    const linhas = dump.tabelas[tabela] || [];
    for (const linha of linhas) await pool.query(sql, campos(linha));
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${tabela}`);
    restaurado[tabela] = rows[0].n;
  }
  await pool.end();

  console.log("\nrestaurado no destino:");
  let divergiu = false;
  for (const [t, n] of Object.entries(restaurado)) {
    const esperado = (dump.tabelas[t] || []).length;
    const ok = n >= esperado;
    if (!ok) divergiu = true;
    console.log(`  ${ok ? "ok " : "FALHA"} ${t.padEnd(10)} ${n} de ${esperado}`);
  }
  if (divergiu) process.exit(1);
  console.log("\nrestauração conferida: o destino tem tudo que estava no arquivo.");
}

main().catch((err) => {
  console.error("Restauração falhou:", err.message);
  process.exit(1);
});
