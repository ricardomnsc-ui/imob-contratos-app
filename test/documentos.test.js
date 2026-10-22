/**
 * Regressão dos documentos gerados.
 *
 * Cada teste aqui existe por causa de um erro que chegou em contrato de
 * verdade. Não é suíte de enfeite: a Cláusula Sexta cobrou condomínio e IPTU
 * de quem já pagava tudo embutido no aluguel durante meses, e a comissão saiu
 * sem prazo nem multa num contrato em que o proprietário atrasou o pagamento.
 * Nenhum dos dois seria pego lendo o código — só gerando o documento e lendo
 * o que saiu.
 *
 * Roda com o test runner do próprio Node (sem dependência nova):
 *   npm test
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { gerarContrato, extrairTextoDocx, checklistEmTexto } = require("../lib/generator");
const { BRANDING, TIPOS, dados } = require("./fixtures");

// Acento vira coisa diferente dependendo de como foi escrito (á vs a+´). Pra
// comparar texto de documento sem teste frágil, normaliza e tira o acento.
const simples = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const ORDINAIS = [
  "PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SETIMA",
  "OITAVA", "NONA", "DECIMA", "DECIMA PRIMEIRA", "DECIMA SEGUNDA",
  "DECIMA TERCEIRA", "DECIMA QUARTA", "DECIMA QUINTA", "DECIMA SEXTA",
  "DECIMA SETIMA", "DECIMA OITAVA", "DECIMA NONA", "VIGESIMA",
];

async function gerar(tipo, extra) {
  const buffer = await gerarContrato(dados(tipo, extra), BRANDING);
  const texto = await extrairTextoDocx(buffer);
  return { buffer, texto };
}

// Títulos de cláusula na ordem em que aparecem.
function clausulas(texto) {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^CL[ÁA]USULA /i.test(simples(l)))
    .map((l) => simples(l).replace(/^CLAUSULA\s+/, "").split(/\s+[–-]\s+/)[0].trim());
}

describe("todos os documentos", () => {
  for (const { tipo, nome, extra } of TIPOS) {
    test(`${nome} gera sem erro e com conteúdo`, async () => {
      const { buffer, texto } = await gerar(tipo, extra);
      assert.ok(buffer.length > 8000, `${tipo}: arquivo pequeno demais (${buffer.length} bytes)`);
      assert.ok(texto.length > 400, `${tipo}: texto curto demais (${texto.length} chars)`);
    });

    test(`${nome} não vaza valor não preenchido no texto`, async () => {
      const { texto } = await gerar(tipo, extra);
      // "undefined", "NaN" e "[object Object]" num contrato assinado são o
      // tipo de erro que ninguém percebe até o cliente perceber.
      for (const lixo of ["undefined", "NaN", "[object Object]"]) {
        const achou = texto.includes(lixo);
        const trecho = achou ? texto.slice(Math.max(0, texto.indexOf(lixo) - 60), texto.indexOf(lixo) + 60) : "";
        assert.ok(!achou, `${tipo}: achei "${lixo}" no documento — ...${trecho}...`);
      }
    });
  }
});

describe("numeração das cláusulas", () => {
  // Inserir cláusula no meio (anuência, condições especiais, garantia) já
  // renumerou tudo mais de uma vez. Buraco ou repetição na sequência é defeito
  // visível no documento assinado.
  const comClausulas = TIPOS.filter((t) => !["checklist_documentos", "ficha_visita", "ficha_locacao"].includes(t.tipo));

  for (const { tipo, nome, extra } of comClausulas) {
    test(`${nome}: sequência sem buraco e sem repetição`, async () => {
      const { texto } = await gerar(tipo, extra);
      const lista = clausulas(texto);
      if (lista.length === 0) return; // documento sem cláusulas numeradas
      const esperado = ORDINAIS.slice(0, lista.length);
      assert.deepEqual(lista, esperado, `${tipo}: ordem das cláusulas fora do esperado`);
    });
  }
});

describe("encargos da locação — quem paga condomínio e IPTU", () => {
  // O erro real: a cláusula afirmava SEMPRE que o encargo era do locatário,
  // inclusive em acordo de valor fechado, cobrando duas vezes quem já tinha
  // pago tudo dentro do aluguel.
  test("separado: diz que o encargo é do locatário", async () => {
    const { texto } = await gerar("locacao_caucao", {
      aluguel: { ...dados("locacao_caucao").aluguel, encargos: "separado" },
    });
    assert.match(simples(texto), /TAXAS CONDOMINIAIS E IPTU/);
  });

  test("incluso: NÃO cobra condomínio e IPTU do locatário", async () => {
    const { texto } = await gerar("locacao_caucao", {
      aluguel: { ...dados("locacao_caucao").aluguel, encargos: "incluso" },
    });
    const t = simples(texto);
    assert.ok(!/ALEM DO ALUGUEL[^.]*TAXAS CONDOMINIAIS E IPTU/.test(t),
      "contrato com encargos inclusos ainda lista condomínio e IPTU como do locatário");
    assert.match(t, /COMPETE EXCLUSIVAMENTE AO\(A\) LOCADOR\(A\)/,
      "deveria dizer que o encargo é do locador");
  });
});

describe("comissão na compra e venda", () => {
  // O incidente: contrato assinado, entrada paga, comissão vencida e o
  // proprietário alegando que não havia prazo nem penalidade no contrato.
  test("traz prazo, multa e juros", async () => {
    const { texto } = await gerar("compra_venda");
    const t = simples(texto);
    assert.match(t, /DIA\(S\) UTIL\(EIS\)|DIAS UTEIS|DIA UTIL/, "comissão sem prazo definido");
    assert.match(t, /MULTA/, "comissão sem multa");
    assert.match(t, /JUROS/, "comissão sem juros");
  });

  test("valor fixo não sai como porcentagem", async () => {
    const { texto } = await gerar("compra_venda", {
      corretagem: { modo: "valor", valor: 25000, marco: "pagamento_entrada", prazoComissao: 1 },
    });
    assert.match(texto, /25\.000,00/, "o valor fixo da comissão não apareceu no documento");
  });
});

describe("folha de assinaturas", () => {
  const comAssinatura = ["compra_venda", "locacao_caucao", "locacao_fiador", "distrato_locacao"];

  for (const tipo of comAssinatura) {
    test(`${tipo}: encerra as cláusulas e assina todo mundo`, async () => {
      const { texto } = await gerar(tipo);
      const t = simples(texto);
      assert.match(t, /FIM DAS CLAUSULAS/, "falta o encerramento antes da folha de assinaturas");

      const esperados = tipo === "compra_venda"
        ? ["JOAO BATISTA DE SOUZA", "MARIA CLARA LIMA"]
        : ["JOAO BATISTA DE SOUZA", "MARIA CLARA LIMA"];
      for (const nome of esperados) {
        assert.ok(t.includes(nome), `${tipo}: ${nome} não aparece no documento`);
      }
    });
  }

  test("locação com fiador traz o fiador", async () => {
    const { texto } = await gerar("locacao_fiador", { garantiaTipo: "fiador" });
    assert.ok(simples(texto).includes("PEDRO ALVES COSTA"), "o fiador não aparece no contrato");
  });
});

describe("checklist de documentos", () => {
  // O texto do WhatsApp e o .docx saem da mesma função de propósito. Se um dia
  // divergirem, o corretor pede uma lista e entrega outra.
  test("o texto para enviar bate com o documento impresso", async () => {
    const d = dados("checklist_documentos", { negocio: "locacao", garantia: "fiador" });
    const { texto: doDocx } = await gerar("checklist_documentos", { negocio: "locacao", garantia: "fiador" });
    const itens = checklistEmTexto(d, {})
      .split("\n")
      .filter((l) => l.startsWith("• "))
      .map((l) => simples(l.slice(2).trim()).replace(/\s+/g, " "));

    const alvo = simples(doDocx).replace(/\s+/g, " ");
    const faltando = itens.filter((i) => !alvo.includes(i));
    assert.equal(faltando.length, 0, `itens no texto que não saíram no .docx: ${faltando.join(" | ")}`);
  });

  test("a mensagem para uma parte não expõe a outra", async () => {
    const d = dados("checklist_documentos", { negocio: "locacao", garantia: "fiador" });
    const paraLocatario = checklistEmTexto(d, { destinatario: "parte2" });
    assert.ok(!paraLocatario.includes("João Batista de Souza"),
      "a mensagem ao locatário traz o nome do locador");
    assert.ok(!simples(paraLocatario).includes("DADOS BANCARIOS PARA RECEBIMENTO"),
      "a mensagem ao locatário traz item que é do locador");
  });
});
