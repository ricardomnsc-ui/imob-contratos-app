/**
 * Payload de referência, com todos os campos preenchidos, para gerar qualquer
 * um dos 14 documentos. Cada teste parte daqui e muda só o que importa pro
 * caso dele.
 *
 * Os CPFs são válidos no dígito verificador mas são números de teste
 * conhecidos, não pertencem a ninguém.
 */
const BASE = {
  layout: "padrao",
  data: "2026-10-22",

  imovel: {
    endereco: "Rua Seridó, 200, apto 1201, Petrópolis, Natal/RN",
    bairro: "Petrópolis", cidade: "Natal", uf: "RN",
    matricula: "12.345", tipo: "Apartamento", tipoUso: "residencial",
    area: "78", quartos: "3", vagas: "1", iptu: "1.200",
    concessionarias: "Energia e água individualizadas",
  },

  vendedores: [{ nome: "João Batista de Souza", cpf: "529.982.247-25", rg: "1.234.567",
    estadoCivil: "casado", profissao: "engenheiro", nacionalidade: "brasileiro",
    endereco: "Av. Rio Branco, 10, Natal/RN", email: "joao@example.test", telefone: "84 99999-0000" }],
  compradores: [{ nome: "Maria Clara Lima", cpf: "111.444.777-35", rg: "7.654.321",
    estadoCivil: "solteira", profissao: "médica", nacionalidade: "brasileira",
    endereco: "Rua da Paz, 55, Natal/RN", email: "maria@example.test", telefone: "84 98888-0000" }],
  locadores: [{ nome: "João Batista de Souza", cpf: "529.982.247-25",
    estadoCivil: "casado", profissao: "engenheiro", endereco: "Av. Rio Branco, 10, Natal/RN" }],
  locatarios: [{ nome: "Maria Clara Lima", cpf: "111.444.777-35",
    estadoCivil: "solteira", profissao: "médica", endereco: "Rua da Paz, 55, Natal/RN" }],
  fiadores: [{ nome: "Pedro Alves Costa", cpf: "390.533.447-05",
    estadoCivil: "casado", profissao: "comerciante", endereco: "Rua A, 1, Natal/RN" }],
  anuentes: [],

  // O distrato lê as partes no SINGULAR (`locador`, `locatario`, `fiador`),
  // enquanto os contratos leem no plural (`locadores`...). São convenções
  // diferentes para a mesma coisa dentro do mesmo gerador — a fixture cobre as
  // duas porque o app também manda as duas, cada uma no seu formulário.
  locador: { nome: "João Batista de Souza", cpf: "529.982.247-25",
    estadoCivil: "casado", profissao: "engenheiro", endereco: "Av. Rio Branco, 10, Natal/RN" },
  locatario: { nome: "Maria Clara Lima", cpf: "111.444.777-35",
    estadoCivil: "solteira", profissao: "médica", endereco: "Rua da Paz, 55, Natal/RN" },
  fiador: { nome: "Pedro Alves Costa", cpf: "390.533.447-05",
    estadoCivil: "casado", profissao: "comerciante", endereco: "Rua A, 1, Natal/RN" },
  locacao: { inicio: "2025-11-01", meses: 30, fim: "2028-04-30", aluguel: 2500,
    multaAlugueis: 3, garantia: "caucao", caucaoValor: 7500 },
  proponente: { nome: "Maria Clara Lima", cpf: "111.444.777-35", telefone: "84 98888-0000",
    email: "maria@example.test", endereco: "Rua da Paz, 55" },
  cliente: { nome: "Maria Clara Lima", cpf: "111.444.777-35", telefone: "84 98888-0000", email: "maria@example.test" },
  proprietario: { nome: "João Batista de Souza", cpf: "529.982.247-25", endereco: "Av. Rio Branco, 10",
    telefone: "84 99999-0000", email: "joao@example.test", estadoCivil: "casado", profissao: "engenheiro" },

  valor: { total: 650000, sinal: 50000 },
  pagamento: {
    entrada: 130000, formaEntrada: "PIX", sinal: 50000,
    parcelas: [
      { descricao: "Entrada", valor: 130000, vencimento: "2026-11-10", forma: "PIX" },
      { descricao: "Financiamento bancário", valor: 520000, vencimento: "2026-12-20", forma: "Crédito bancário" },
    ],
  },
  corretagem: { modo: "percentual", percentual: 6, marco: "pagamento_entrada",
    prazoComissao: 1, multaComissao: 2, jurosComissao: 1 },
  corretor: { nome: "Ricardo Nascimento", creci: "12345-F", cpf: "222.333.444-55" },
  chaves: { modo: "pagamento_entrada", prazoDias: 5 },

  aluguel: { valor: 2500, diaVencimento: 10, indice: "IGP-M",
    primeiroVencimento: "2026-11-10", condominio: 400, iptu: 80, encargos: "separado" },
  vigencia: { meses: 30, inicio: "2026-11-01", fim: "2029-04-30" },
  garantiaTipo: "caucao",
  garantia: { valorCaucao: 7500, seguradora: "Porto Seguro", numero: "AP-99", taxaMensal: 120 },

  proposta: { valor: 640000, valorExtenso: "seiscentos e quarenta mil reais",
    formaPagamento: "Entrada de R$ 140.000,00 e saldo via financiamento bancário",
    validadeDias: 5, proprietario: "João Batista de Souza", prazoResposta: 5,
    condicoes: "Proposta condicionada à aprovação do financiamento.",
    aluguel: 3200, prazoMeses: 30, inicio: "2026-11-01", garantia: "Fiador", benfeitorias: "Nenhuma." },

  autorizacao: { prazoDias: 90 },
  exclusividade: { prazoDias: 90 },
  visita: { data: "2026-10-20", hora: "15:00" },
  distrato: { observacoes: "" },
  motivo: "Mudança de cidade a trabalho.",
  dataRescisao: "2027-06-30",
  multaIntegral: 7500,
  dataEntrega: "2026-11-05", leituraAgua: "123", leituraEnergia: "456",

  negocio: "venda", financiado: "sim", condominio: "sim",
  parte1: { nome: "João Batista de Souza" }, parte1Tipo: "fisica",
  parte2: { nome: "Maria Clara Lima" }, parte2Tipo: "fisica",

  testemunhas: [{ nome: "Ana Souza", cpf: "111.222.333-96" }, { nome: "Carlos Dias", cpf: "123.456.789-09" }],
  observacoes: "Sem observações relevantes.",
  foro: "Natal/RN",
};

const BRANDING = {
  nome: "Imob Gest", creci: "CRECI-RN 1234-J", cnpj: "00.000.000/0001-00",
  endereco: "Av. Principal, 1000, Natal/RN", telefone: "84 3333-0000",
  email: "contato@example.test", tema: "laranja", foroPadrao: "Natal/RN",
};

// Os 14 tipos que o app gera, com o que cada um precisa de diferente da base.
const TIPOS = [
  { tipo: "compra_venda", nome: "Compra e venda" },
  { tipo: "locacao_caucao", nome: "Locação com caução", extra: { garantiaTipo: "caucao" } },
  { tipo: "locacao_fiador", nome: "Locação com fiador", extra: { garantiaTipo: "fiador" } },
  { tipo: "locacao_seguro_fianca", nome: "Locação com seguro fiança", extra: { garantiaTipo: "seguro_fianca" } },
  { tipo: "locacao_sem_garantia", nome: "Locação sem garantia", extra: { garantiaTipo: "sem_garantia" } },
  { tipo: "ficha_locacao", nome: "Ficha de locação" },
  { tipo: "proposta_compra", nome: "Proposta de compra" },
  { tipo: "proposta_aluguel", nome: "Proposta de locação" },
  { tipo: "ficha_visita", nome: "Ficha de visita" },
  { tipo: "autorizacao_venda", nome: "Autorização de venda" },
  { tipo: "contrato_exclusividade", nome: "Contrato de exclusividade" },
  { tipo: "termo_entrega_chaves", nome: "Termo de entrega de chaves" },
  { tipo: "distrato_locacao", nome: "Distrato de locação" },
  { tipo: "checklist_documentos", nome: "Checklist de documentos", extra: { negocio: "locacao", garantia: "fiador" } },
];

const dados = (tipo, extra = {}) => ({ ...BASE, tipo, ...extra });

module.exports = { BASE, BRANDING, TIPOS, dados };
