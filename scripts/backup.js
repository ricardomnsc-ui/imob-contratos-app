#!/usr/bin/env node
/**
 * Backup lógico do banco do Minutei.
 *
 * Existe porque o Railway, no plano atual, NÃO faz backup automático: o painel
 * diz "No backup schedule" e agendamento só no Pro. O único snapshot que havia
 * era avulso e de dois meses atrás — perder a base hoje significaria perder
 * dois meses de contratos.
 *
 * Em Node puro de propósito: usa o `pg` que o projeto já tem, sem depender de
 * `pg_dump` instalado na máquina. E grava fora do Railway, que é o ponto —
 * backup guardado dentro do mesmo provedor não protege contra perder a conta.
 *
 * Uso:
 *   railway run --service Postgres node scripts/backup.js
 *   railway run --service Postgres node scripts/backup.js --destino ~/Backups/minutei
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Pool } = require("pg");

// A `DATABASE_URL` do serviço aponta para o host interno do Railway, que só
// resolve lá dentro. Rodando de fora, quem serve é a pública.
const URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || "";

const TABELAS = [
  { nome: "tenants", colunas: ["id", "data"] },
  { nome: "users", colunas: ["id", "data"] },
  { nome: "contracts", colunas: ["id", "tenant_id", "data", "created_at"] },
  // `pdf` é bytea: vira base64 no JSON e volta a Buffer na restauração.
  { nome: "shares", colunas: ["id", "tenant_id", "meta", "pdf", "created_at", "expires_at"] },
  { nome: "compras", colunas: ["id", "session_id", "email", "data", "created_at"] },
];

function destino() {
  const i = process.argv.indexOf("--destino");
  const dir = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : path.join(process.cwd(), "backups");
  return dir.replace(/^~/, process.env.HOME || "~");
}

async function main() {
  if (!URL) {
    console.error("Sem DATABASE_PUBLIC_URL nem DATABASE_URL.");
    console.error("Rode com: railway run --service Postgres node scripts/backup.js");
    process.exit(1);
  }
  if (URL.includes(".railway.internal")) {
    console.error("A URL disponível é a interna do Railway, que não resolve daqui.");
    console.error("Use o serviço do banco, que é quem tem a pública:");
    console.error("  railway run --service Postgres node scripts/backup.js");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: URL, ssl: { rejectUnauthorized: false } });
  const dump = { gerado_em: new Date().toISOString(), formato: 1, tabelas: {} };
  const contagem = {};

  for (const { nome, colunas } of TABELAS) {
    try {
      const { rows } = await pool.query(`SELECT ${colunas.join(", ")} FROM ${nome}`);
      dump.tabelas[nome] = rows.map((r) => {
        const linha = { ...r };
        if (Buffer.isBuffer(linha.pdf)) linha.pdf = linha.pdf.toString("base64");
        return linha;
      });
      contagem[nome] = rows.length;
    } catch (err) {
      // Tabela que ainda não existe não é erro: o `compras` só nasce quando a
      // loja do e-book é usada. Mas registra, pra não passar despercebido.
      console.warn(`  aviso: não li a tabela ${nome} — ${err.message}`);
      dump.tabelas[nome] = [];
      contagem[nome] = null;
    }
  }
  await pool.end();

  dump.contagem = contagem;

  const dir = destino();
  fs.mkdirSync(dir, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const arquivo = path.join(dir, `minutei-${carimbo}.json.gz`);
  fs.writeFileSync(arquivo, zlib.gzipSync(Buffer.from(JSON.stringify(dump)), { level: 9 }));

  const mb = (fs.statSync(arquivo).size / 1024 / 1024).toFixed(2);
  console.log(`backup gravado: ${arquivo}  (${mb} MB)`);
  for (const [t, n] of Object.entries(contagem)) {
    console.log(`  ${t.padEnd(10)} ${n === null ? "(não lida)" : `${n} registro(s)`}`);
  }

  // Um backup que ninguém confere é esperança, não garantia: relê o arquivo
  // recém-escrito e confirma que ele abre e bate com o que saiu do banco.
  const relido = JSON.parse(zlib.gunzipSync(fs.readFileSync(arquivo)).toString());
  const divergiu = Object.entries(contagem)
    .filter(([t, n]) => n !== null && relido.tabelas[t].length !== n)
    .map(([t]) => t);
  if (divergiu.length) {
    console.error(`\nFALHA: o arquivo não bate com o banco em: ${divergiu.join(", ")}`);
    process.exit(1);
  }
  console.log("\narquivo relido e conferido — contagens batem com o banco.");
}

main().catch((err) => {
  console.error("Backup falhou:", err.message);
  process.exit(1);
});
