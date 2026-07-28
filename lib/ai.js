const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

if (!ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY não definida — o Ajudante IA de cláusulas ficará indisponível.");
}

const SYSTEM_PROMPT = `Você é o Ajudante IA do Minutei, um SaaS que gera contratos imobiliários no Brasil (compra e venda e locação residencial).

Um corretor vai te contar um pedido de alteração de cláusula que uma das partes (comprador, vendedor, locador ou locatário) fez sobre um contrato já elaborado. Sua tarefa:

1. Avaliar o RISCO jurídico/prático de aceitar esse pedido, classificando como "baixo", "medio" ou "alto".
   - "baixo": ajuste operacional que não muda o equilíbrio do negócio nem gera exposição jurídica relevante (ex.: prazo de entrega de chaves, detalhe de vistoria, forma de comunicação).
   - "medio": altera obrigações, prazos ou responsabilidades de forma que merece atenção, mas é comum no mercado (ex.: mudança de índice de reajuste, inclusão de multa específica, alteração de forma de pagamento).
   - "alto": pode comprometer garantias, criar ambiguidade jurídica, favorecer desproporcionalmente uma das partes, ou tocar em cláusulas de proteção padrão (rescisão, corretagem, garantia, foro) de um jeito que pode gerar disputa ou nulidade.
2. Escrever uma JUSTIFICATIVA curta (2 a 4 frases, em português, tom direto e prático) explicando o porquê do risco.
3. Redigir um TEXTO SUGERIDO pronto para uso: um parágrafo de cláusula contratual formal (mesmo registro usado em contratos imobiliários brasileiros: terceira pessoa, tom formal, usando os termos PROMITENTE(S) VENDEDOR(ES)/PROMISSÁRIO(S) COMPRADOR(ES) para compra e venda, ou LOCADOR(A)/LOCATÁRIO(A) para locação, conforme o tipo de contrato informado) que reflita o pedido da parte, pronto para o corretor colar no campo "cláusula especial" do contrato.
4. Se o pedido for perigoso, incoerente ou impossível de redigir com segurança, ainda assim classifique o risco como "alto", explique o motivo na justificativa, e em "textoSugerido" escreva uma frase recomendando consulta jurídica especializada em vez de inventar uma cláusula problemática.

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, no formato:
{"risco": "baixo|medio|alto", "justificativa": "...", "textoSugerido": "..."}`;

function extrairJson(texto) {
  const semFence = texto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const inicio = semFence.indexOf("{");
  const fim = semFence.lastIndexOf("}");
  if (inicio === -1 || fim === -1) throw new Error("Resposta da IA não veio em JSON.");
  return JSON.parse(semFence.slice(inicio, fim + 1));
}

async function avaliarClausula({ tipoContrato, clausulaAtual, pedido }) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Ajudante IA indisponível: ANTHROPIC_API_KEY não configurada no servidor.");
  }
  if (!pedido || !String(pedido).trim()) {
    throw new Error("Descreva o pedido de alteração da parte.");
  }

  const tipoLabel = tipoContrato === "locacao_caucao" || tipoContrato === "locacao_fiador" ? "locação residencial" : "compra e venda";
  const userContent = [
    `Tipo de contrato: ${tipoLabel}.`,
    clausulaAtual && String(clausulaAtual).trim() ? `Cláusula ou contexto atual relevante: ${String(clausulaAtual).trim()}` : null,
    `Pedido de alteração feito pela parte: ${String(pedido).trim()}`,
  ].filter(Boolean).join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Falha ao consultar a IA (HTTP ${resp.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await resp.json();
  const texto = (data.content || []).map(b => b.text || "").join("").trim();
  const parsed = extrairJson(texto);

  const risco = ["baixo", "medio", "alto"].includes(parsed.risco) ? parsed.risco : "alto";
  return {
    risco,
    justificativa: String(parsed.justificativa || "").trim(),
    textoSugerido: String(parsed.textoSugerido || "").trim(),
  };
}

const DOC_SYSTEM_PROMPT = `Você é um extrator de dados de documentos de identificação brasileiros (CNH ou RG), usado pelo Minutei, um SaaS de contratos imobiliários, para poupar o corretor de digitar os dados das partes manualmente.

Extraia apenas os dados que estão de fato impressos e legíveis no documento enviado. Nunca invente ou deduza informação que não esteja visível.

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, no formato:
{"nome": "...", "cpf": "...", "rg": "...", "dataNascimento": "...", "nacionalidade": "..."}

Regras:
- "nome": nome completo exatamente como impresso.
- "cpf": formate como 000.000.000-00 quando encontrado.
- "rg": número de Registro Geral; se não houver RG explícito mas houver número de registro da CNH, use esse número.
- "dataNascimento": formate como DD/MM/AAAA quando encontrada.
- "nacionalidade": ex. "Brasileiro" ou "Brasileira", só se estiver explícita ou clara pelo local de nascimento no documento.
- Se um campo não existir ou não estiver legível, retorne string vazia "" para ele — nunca invente.`;

const CNPJ_SYSTEM_PROMPT = `Você é um extrator de dados do Cartão CNPJ (Comprovante de Inscrição e de Situação Cadastral da Receita Federal), usado pelo Minutei, um SaaS de contratos imobiliários, para poupar o corretor de digitar os dados da empresa manualmente.

Extraia apenas os dados que estão de fato impressos e legíveis no documento enviado. Nunca invente ou deduza informação que não esteja visível.

Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, no formato:
{"razaoSocial": "...", "cnpj": "...", "nomeFantasia": "...", "endereco": "...", "situacao": "..."}

Regras:
- "razaoSocial": o campo "NOME EMPRESARIAL", exatamente como impresso.
- "cnpj": formate como 00.000.000/0000-00.
- "nomeFantasia": o campo "TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)"; se constar "********" ou estiver vazio, retorne "".
- "endereco": monte o endereço da sede em uma linha única, a partir dos campos de logradouro, número, complemento, bairro, município, UF e CEP. Ex.: "Rua Exemplo, 100, Sala 2, Centro, Natal/RN, CEP 59000-000".
- "situacao": o campo "SITUAÇÃO CADASTRAL" (ex.: "ATIVA"), se visível.
- Se um campo não existir ou não estiver legível, retorne string vazia "" para ele — nunca invente.`;

const TIPOS_DOCUMENTO_ACEITOS = { "application/pdf": "application/pdf", "image/jpeg": "image/jpeg", "image/png": "image/png" };

async function extrairDadosCnpj(buffer, mimeType) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Ajudante IA indisponível: ANTHROPIC_API_KEY não configurada no servidor.");
  }
  const mediaType = TIPOS_DOCUMENTO_ACEITOS[mimeType];
  if (!mediaType) {
    throw new Error("Formato de arquivo não suportado. Envie PDF, JPG ou PNG.");
  }

  const base64 = buffer.toString("base64");
  const documentoBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system: CNPJ_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [documentoBlock, { type: "text", text: "Extraia os dados deste Cartão CNPJ." }] }],
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Falha ao consultar a IA (HTTP ${resp.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await resp.json();
  const texto = (data.content || []).map(b => b.text || "").join("").trim();
  const parsed = extrairJson(texto);

  return {
    razaoSocial: String(parsed.razaoSocial || "").trim(),
    cnpj: String(parsed.cnpj || "").trim(),
    nomeFantasia: String(parsed.nomeFantasia || "").trim(),
    endereco: String(parsed.endereco || "").trim(),
    situacao: String(parsed.situacao || "").trim(),
  };
}

async function extrairDadosDocumento(buffer, mimeType) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Ajudante IA indisponível: ANTHROPIC_API_KEY não configurada no servidor.");
  }
  const mediaType = TIPOS_DOCUMENTO_ACEITOS[mimeType];
  if (!mediaType) {
    throw new Error("Formato de arquivo não suportado. Envie PDF, JPG ou PNG.");
  }

  const base64 = buffer.toString("base64");
  const documentoBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      system: DOC_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [documentoBlock, { type: "text", text: "Extraia os dados deste documento de identificação." }] }],
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Falha ao consultar a IA (HTTP ${resp.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await resp.json();
  const texto = (data.content || []).map(b => b.text || "").join("").trim();
  const parsed = extrairJson(texto);

  return {
    nome: String(parsed.nome || "").trim(),
    cpf: String(parsed.cpf || "").trim(),
    rg: String(parsed.rg || "").trim(),
    dataNascimento: String(parsed.dataNascimento || "").trim(),
    nacionalidade: String(parsed.nacionalidade || "").trim(),
  };
}

module.exports = { avaliarClausula, extrairDadosDocumento, extrairDadosCnpj, disponivel: !!ANTHROPIC_API_KEY };
