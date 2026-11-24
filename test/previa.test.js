/**
 * Prévia ao vivo e acabamento do documento (rubricas, quadro-resumo).
 *
 * A prévia só tem valor se for o MESMO texto do download — e, como vira HTML
 * dentro do app, não pode deixar passar nada que o usuário digitou como
 * marcação.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { gerarContrato, extrairTextoDocx } = require("../lib/generator");
const { docxParaHtml } = require("../lib/previa");
const { BASE, BRANDING, dados } = require("./fixtures");

const novo = (tipo, extra) => dados(tipo, { generoConfirmado: true, ...extra });
const semTags = (html) => html.replace(/<br>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("prévia", () => {
  test("tem o mesmo texto do documento baixado", async () => {
    const buf = await gerarContrato(novo("locacao_fiador", {
      garantiaTipo: "fiador",
      locatarios: [{ ...BASE.locatarios[0], genero: "f" }],
    }), BRANDING);
    const { html } = await docxParaHtml(buf);
    const doc = (await extrairTextoDocx(buf)).replace(/\s+/g, " ");
    const prev = semTags(html);
    for (const trecho of ["dá em locação à LOCATÁRIA", "CLÁUSULA PRIMEIRA", "Maria Clara Lima", "QUADRO-RESUMO"]) {
      assert.ok(doc.includes(trecho), `o documento deveria ter "${trecho}"`);
      assert.ok(prev.includes(trecho), `a prévia não mostra "${trecho}"`);
    }
  });

  test("marca e conta cada '(a confirmar)'", async () => {
    const buf = await gerarContrato(novo("compra_venda", { imovel: { endereco: "" }, valor: { total: 0 } }), BRANDING);
    const { html, pendencias } = await docxParaHtml(buf);
    const noDoc = ((await extrairTextoDocx(buf)).match(/\(a confirmar\)/g) || []).length;
    assert.ok(pendencias > 0, "deveria haver pendências com o endereço vazio");
    assert.equal(pendencias, noDoc, "a contagem da prévia diverge do documento");
    assert.equal((html.match(/<mark class="pendente"/g) || []).length, pendencias);
  });

  test("o que o usuário digita não vira HTML", async () => {
    const buf = await gerarContrato(novo("locacao_caucao", {
      locatarios: [{ ...BASE.locatarios[0], nome: '<img src=x onerror="alert(1)">Maria', genero: "f" }],
    }), BRANDING);
    const { html } = await docxParaHtml(buf);
    assert.ok(!/<img src=x/i.test(html), "nome com marcação passou como HTML para a prévia");
    assert.ok(html.includes("&lt;img"), "o nome deveria aparecer escapado");
  });

  test("mostra o rodapé com as rubricas uma vez, no fim", async () => {
    const { html } = await docxParaHtml(await gerarContrato(novo("locacao_caucao"), BRANDING));
    const rod = html.slice(html.indexOf('<footer class="rod">'));
    assert.match(semTags(rod), /RUBRICAS JBS MCL .*Página X de Y/);
  });
});

async function rodape(tipo, extra) {
  const zip = await JSZip.loadAsync(await gerarContrato(novo(tipo, extra), BRANDING));
  const nome = Object.keys(zip.files).find((n) => /^word\/footer\d*\.xml$/.test(n));
  return semTags((await zip.file(nome).async("string")).replace(/<w:instrText[^>]*>[^<]*<\/w:instrText>/g, ""));
}

describe("rubricas no rodapé", () => {
  test("locação com fiador: locador, locatário, fiador, cônjuge e administradora", async () => {
    const t = await rodape("locacao_fiador", {
      garantiaTipo: "fiador",
      fiadores: [{ ...BASE.fiadores[0], conjugeNome: "Rita de Cássia Costa" }],
      administracao: { ativa: true, taxaPercentual: 10 },
    });
    assert.match(t, /RUBRICAS/);
    for (const ini of ["JBS", "MCL", "PAC", "RCC", "IG"]) assert.ok(t.split(" ").includes(ini), `faltou a rubrica ${ini}: ${t}`);
  });

  test("compra e venda inclui o anuente", async () => {
    const t = await rodape("compra_venda", { anuentes: [{ nome: "Ana Paula Rocha", genero: "f", tipoAnuencia: "conjuge" }] });
    for (const ini of ["JBS", "MCL", "APR"]) assert.ok(t.split(" ").includes(ini), `faltou a rubrica ${ini}`);
  });

  test("ficha e checklist não levam rubrica", async () => {
    assert.ok(!/RUBRICAS/.test(await rodape("ficha_visita")));
    assert.ok(!/RUBRICAS/.test(await rodape("checklist_documentos", { negocio: "locacao" })));
  });
});
