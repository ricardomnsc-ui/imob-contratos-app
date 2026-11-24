/**
 * Concordância de gênero e número.
 *
 * O contrato saía "o(a) LOCATÁRIO(A)" para a Maria — juridicamente válido,
 * mas com cara de formulário genérico. Agora sai "a LOCATÁRIA". O risco novo
 * é o contrário: errar a concordância ("o LOCATÁRIO" para uma mulher, "os
 * LOCATÁRIOS pagará"), que é pior do que o parêntese. Estes testes cobrem os
 * dois lados.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { gerarContrato, extrairTextoDocx, checklistEmTexto } = require("../lib/generator");
const { concordarTexto, pluralVerbo } = require("../lib/concordancia");
const { BASE, BRANDING, TIPOS, dados } = require("./fixtures");

const comGenero = (p, genero) => ({ ...p, genero });

// Todas as partes com gênero, como o formulário manda hoje.
function partes(genero) {
  const g = (p) => comGenero(p, genero);
  return {
    vendedores: BASE.vendedores.map(g), compradores: BASE.compradores.map(g),
    locadores: BASE.locadores.map(g), locatarios: BASE.locatarios.map(g), fiadores: BASE.fiadores.map(g),
    locador: g(BASE.locador), locatario: g(BASE.locatario), fiador: g(BASE.fiador),
    proponente: g(BASE.proponente), cliente: g(BASE.cliente), proprietario: g(BASE.proprietario),
    entregador: { nome: "João", genero }, recebedor: { nome: "Maria", genero },
    parte1: g(BASE.parte1), parte2: g(BASE.parte2),
    proposta: { ...BASE.proposta, proprietarioGenero: genero },
    anuentes: [{ nome: "Ana Paula Rocha", cpf: "529.982.247-25", genero, tipoAnuencia: "herdeiro" }],
  };
}

// Como o formulário novo manda: gênero escolhido de propósito.
async function texto(tipo, extra) {
  return extrairTextoDocx(await gerarContrato(dados(tipo, { generoConfirmado: true, ...extra }), BRANDING));
}

// Parêntese de flexão que sobrou: "LOCATÁRIO(A)", "do(a)", "VENDEDOR(ES)".
const PARENTESE = /[A-Za-zÀ-ÿ]+\((?:a|as|o|os|s|es|eis|m|ão|à|A|AS|O|OS|S|ES)\)/g;

describe("motor de concordância", () => {
  const ctx = (g, n) => ({ locatario: { g, n }, locador: { g, n } });

  test("artigo e papel concordam com a parte", () => {
    assert.equal(concordarTexto("o(a) LOCATÁRIO(A) pagará", ctx("f", "s")), "a LOCATÁRIA pagará");
    assert.equal(concordarTexto("o(a) LOCATÁRIO(A) pagará", ctx("m", "s")), "o LOCATÁRIO pagará");
    assert.equal(concordarTexto("devida ao(à) LOCADOR(A)", ctx("f", "s")), "devida à LOCADORA");
    assert.equal(concordarTexto("O(A) LOCADOR(A) poderá", ctx("f", "s")), "A LOCADORA poderá");
    assert.equal(concordarTexto("DA ESCOLHA DO(A) LOCATÁRIO(A)", ctx("f", "s")), "DA ESCOLHA DA LOCATÁRIA");
  });

  test("no plural o verbo acompanha o sujeito", () => {
    assert.equal(concordarTexto("o(a) LOCATÁRIO(A) pagará a multa", ctx("f", "p")), "as LOCATÁRIAS pagarão a multa");
    assert.equal(concordarTexto("O(A) LOCADOR(A) não responderá", ctx("m", "p")), "Os LOCADORES não responderão");
    assert.equal(concordarTexto("O(A) LOCATÁRIO(A) responde integralmente", ctx("m", "p")), "Os LOCATÁRIOS respondem integralmente");
    assert.equal(concordarTexto("competem ao(à) LOCADOR(A), que declara haver", ctx("m", "p")), "competem aos LOCADORES, que declaram haver");
    // Só verbo conhecido é conjugado: "de" não vira "dem".
    assert.equal(concordarTexto("o(a) LOCATÁRIO(A) de que", ctx("m", "p")), "os LOCATÁRIOS de que");
  });

  test("adjetivo depois do papel concorda junto", () => {
    const c = { fiador: { g: "f", n: "s" } };
    assert.equal(concordarTexto("o(a) FIADOR(A) acima qualificado(a) se obriga", c), "a FIADORA acima qualificada se obriga");
    assert.equal(concordarTexto("o(a) FIADOR(A) acima qualificado(a) se obriga", { fiador: { g: "m", n: "p" } }),
      "os FIADORES acima qualificados se obrigam");
  });

  test("artigo do papel seguinte não vira adjetivo do anterior", () => {
    // Bug real durante o desenvolvimento: "ao(s)" lido como adjetivo do
    // comprador saía "aas PROMITENTES VENDEDORES".
    const c = { comprador: { g: "f", n: "p" }, vendedor: { g: "m", n: "p" } };
    assert.equal(concordarTexto("pelo(s) PROMISSÁRIO(S) COMPRADOR(ES) ao(s) PROMITENTE(S) VENDEDOR(ES)", c),
      "pelas PROMISSÁRIAS COMPRADORAS aos PROMITENTES VENDEDORES");
  });

  test("sem gênero informado, não arrisca", () => {
    // "o LOCATÁRIO" para uma mulher é erro; "o(a) LOCATÁRIO(A)" é só feio.
    assert.equal(concordarTexto("o(a) LOCATÁRIO(A) pagará", { locatario: { g: null, n: "s" } }), "o(a) LOCATÁRIO(A) pagará");
    assert.equal(concordarTexto("o(a) LOCATÁRIO(A) pagará", {}), "o(a) LOCATÁRIO(A) pagará");
  });

  test("conjugação no plural", () => {
    assert.equal(pluralVerbo("pagará"), "pagarão");
    assert.equal(pluralVerbo("obriga-se"), "obrigam-se");
    assert.equal(pluralVerbo("obrigar-se-á"), "obrigar-se-ão");
    assert.equal(pluralVerbo("dá"), "dão");
    assert.equal(pluralVerbo("tem"), "têm");
    assert.equal(pluralVerbo("de"), null);
  });
});

describe("documentos sem parênteses quando o gênero é conhecido", () => {
  for (const genero of ["m", "f"]) {
    for (const { tipo, nome, extra } of TIPOS) {
      test(`${nome} (${genero === "f" ? "mulheres" : "homens"})`, async () => {
        const t = await texto(tipo, { ...(extra || {}), ...partes(genero), administracao: { ativa: true, taxaPercentual: 10 } });
        const sobra = [...new Set(t.match(PARENTESE) || [])];
        assert.deepEqual(sobra, [], `${tipo}: ainda sai genérico — ${sobra.join(" ")}`);
      });
    }
  }
});

describe("concordância no contrato de locação", () => {
  test("locatária mulher, locador homem", async () => {
    const t = await texto("locacao_fiador", {
      garantiaTipo: "fiador",
      locadores: [comGenero(BASE.locadores[0], "m")],
      locatarios: [comGenero(BASE.locatarios[0], "f")],
      fiadores: [comGenero(BASE.fiadores[0], "m")],
    });
    assert.match(t, /O LOCADOR dá em locação à LOCATÁRIA/);
    assert.match(t, /o FIADOR acima qualificado se obriga solidariamente com a LOCATÁRIA/);
    assert.match(t, /inscrita no CPF/, "a qualificação da locatária deveria sair no feminino");
  });

  test("dois locadores e duas locatárias: plural com verbo no plural", async () => {
    const t = await texto("locacao_caucao", {
      garantiaTipo: "caucao",
      locadores: [comGenero(BASE.locadores[0], "m"), { ...BASE.locadores[0], nome: "Ana Souza", genero: "f" }],
      locatarios: [comGenero(BASE.locatarios[0], "f"), { ...BASE.locatarios[0], nome: "Bia Lima", genero: "f" }],
    });
    assert.match(t, /Os LOCADORES dão em locação às LOCATÁRIAS/);
    assert.match(t, /as LOCATÁRIAS pagarão a multa/);
    assert.match(t, /Os LOCADORES poderão/);
    assert.ok(!/LOCAT[ÁA]RIAS (pagará|deverá|poderá|terá)\b/.test(t), "verbo no singular com sujeito plural");
  });

  test("cada linha de assinatura concorda com quem assina, não com o grupo", async () => {
    const t = await texto("locacao_caucao", {
      garantiaTipo: "caucao",
      locadores: [comGenero(BASE.locadores[0], "m"), { ...BASE.locadores[0], nome: "Ana Souza", genero: "f" }],
    });
    const assinaturas = t.slice(t.lastIndexOf("FIM DAS CL"));
    assert.match(assinaturas, /João Batista de Souza\s+LOCADOR\b/i);
    assert.match(assinaturas, /Ana Souza\s+LOCADORA\b/i);
  });

  test("empresa concorda no feminino (pessoa jurídica)", async () => {
    const t = await texto("locacao_caucao", {
      garantiaTipo: "caucao",
      locadores: [{ nome: "Alfa Empreendimentos Ltda", tipoPessoa: "juridica", cnpj: "11.222.333/0001-81" }],
    });
    assert.match(t, /A LOCADORA dá em locação/);
  });

  test("sem gênero: continua genérico em vez de chutar", async () => {
    const t = await texto("locacao_caucao", { garantiaTipo: "caucao" });
    assert.match(t, /O\(a\) LOCADOR\(A\) dá em locação ao\(à\) LOCATÁRIO\(A\)/);
  });

  test("contrato salvo pelo formulário antigo regenera como foi assinado", async () => {
    // O formulário antigo vinha com "Masculino" marcado de fábrica: o "m"
    // salvo pode ser de uma mulher que ninguém corrigiu. Reabrir esse
    // contrato no painel não pode trocar o "o(a) LOCATÁRIO(A)" assinado por
    // "o LOCATÁRIO".
    const legado = dados("locacao_caucao", {
      garantiaTipo: "caucao",
      locadores: [comGenero(BASE.locadores[0], "m")], locatarios: [comGenero(BASE.locatarios[0], "m")],
    });
    const t = await extrairTextoDocx(await gerarContrato(legado, BRANDING));
    assert.match(t, /O\(a\) LOCADOR\(A\) dá em locação ao\(à\) LOCATÁRIO\(A\)/);
    // E o documento seguinte, do formulário novo, volta a concordar.
    const novo = await texto("locacao_caucao", { garantiaTipo: "caucao", locatarios: [comGenero(BASE.locatarios[0], "f")] });
    assert.match(novo, /à LOCATÁRIA/);
  });
});

describe("concordância na compra e venda", () => {
  test("vendedora e compradora", async () => {
    const t = await texto("compra_venda", {
      vendedores: [comGenero(BASE.vendedores[0], "f")], compradores: [comGenero(BASE.compradores[0], "f")],
    });
    assert.match(t, /A PROMITENTE VENDEDORA/);
    assert.match(t, /pela PROMISSÁRIA COMPRADORA à PROMITENTE VENDEDORA/);
    assert.match(t, /a PROMISSÁRIA COMPRADORA assumirá/);
  });

  test("duas vendedoras: legítimas proprietárias", async () => {
    // Pego pela prévia: o plural saía fixo no masculino ("As PROMITENTES
    // VENDEDORAS são legítimos proprietários").
    const t = await texto("compra_venda", {
      vendedores: [comGenero(BASE.vendedores[0], "f"), { ...BASE.vendedores[0], nome: "Paula Souza", genero: "f" }],
    });
    assert.match(t, /As PROMITENTES VENDEDORAS são legítimas proprietárias/);
  });

  test("duas compradoras: artigo e verbo no feminino plural", async () => {
    const t = await texto("compra_venda", {
      compradores: [comGenero(BASE.compradores[0], "f"), { ...BASE.compradores[0], nome: "Bia Lima", genero: "f" }],
    });
    assert.match(t, /As PROMISSÁRIAS COMPRADORAS declaram que visitaram/);
    assert.ok(!/\b(aas|aa|Os PROMISSÁRIAS)\b/.test(t), "artigo quebrado no plural feminino");
  });
});

describe("checklist", () => {
  test("a mensagem do WhatsApp concorda igual ao documento", async () => {
    const extra = { negocio: "locacao", garantia: "fiador", generoConfirmado: true,
      parte1: { nome: "Joana Dias", genero: "f" }, parte2: { nome: "Mário Lima", genero: "m" } };
    const msg = checklistEmTexto(dados("checklist_documentos", extra), {});
    const doc = await texto("checklist_documentos", extra);
    assert.match(msg, /Locadora: Joana Dias/);
    assert.ok(!PARENTESE.test(msg), "a mensagem ainda tem parênteses");
    assert.match(doc, /LOCADORA/);
  });
});
