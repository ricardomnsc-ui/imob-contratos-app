/**
 * Gerador de contratos imobiliários white-label.
 * Baseado no gerador original da Imob Gest, generalizado para receber a
 * identidade visual (branding) de qualquer imobiliária como parâmetro.
 */
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  TabStopType, VerticalAlign, PageNumber,
} = require("docx");

const THEMES = {
  padrao: {
    label: "Padrão",
    descricao: "Visual atual: limpo, funcional, com o verde/cor da marca em destaque.",
    fontTitulo: "Calibri",
    fontCorpo: "Calibri",
    dark: "333333",
    muted: "777777",
    soft: "AAAAAA",
    row: "FAFAFA",
    box: "F5F5F5",
    headerFill: "333333",
    tableBorder: "CCCCCC",
    titleSize: 28,
    clauseSize: 22,
    titleStyle: "simple",
    clauseStyle: "accent-underline",
    partyStyle: "colorbox",
    headerRuleStyle: "accent",
  },
  profissional: {
    label: "Profissional",
    descricao: "Tom jurídico clássico: Times New Roman, tons de tinta, molduras retas.",
    fontTitulo: "Cambria",
    fontCorpo: "Times New Roman",
    dark: "1A1A1A",
    muted: "595959",
    soft: "8C8C8C",
    row: "F6F5F2",
    box: "FFFFFF",
    headerFill: "1A1A1A",
    tableBorder: "BFBAA8",
    titleSize: 26,
    clauseSize: 21,
    titleStyle: "framed",
    clauseStyle: "double-rule",
    partyStyle: "formal",
    headerRuleStyle: "double",
  },
  elegante: {
    label: "Elegante",
    descricao: "Serifado refinado, paleta neutra quente e mais espaçamento.",
    fontTitulo: "Garamond",
    fontCorpo: "Garamond",
    dark: "2B2A28",
    muted: "857D6E",
    soft: "CFC6B0",
    row: "FBF9F3",
    box: "FFFFFF",
    headerFill: "2B2A28",
    tableBorder: "E2D9C2",
    titleSize: 30,
    clauseSize: 23,
    titleStyle: "subtitled",
    clauseStyle: "hairline-center",
    partyStyle: "rule",
    headerRuleStyle: "hairline",
  },
};
const LAYOUTS = Object.keys(THEMES).map(id => ({ id, label: THEMES[id].label, descricao: THEMES[id].descricao }));

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const cellMargins = { top: 120, bottom: 120, left: 160, right: 160 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };

const PLACEHOLDER = "(a confirmar)";

const ORDINAIS_CLAUSULA = [
  "PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA", "DÉCIMA",
  "DÉCIMA PRIMEIRA", "DÉCIMA SEGUNDA", "DÉCIMA TERCEIRA", "DÉCIMA QUARTA", "DÉCIMA QUINTA", "DÉCIMA SEXTA",
  "DÉCIMA SÉTIMA", "DÉCIMA OITAVA", "DÉCIMA NONA", "VIGÉSIMA",
];
// Rótulo curto de cada tipo de anuência, para o quadro-resumo da primeira
// página — é onde alguém confere quem precisa assinar sem ler o contrato todo.
const ROTULOS_CURTOS_ANUENCIA = {
  conjuge: "cônjuge",
  companheiro: "companheiro(a)",
  usufrutuario: "usufrutuário(a)",
  nu_proprietario: "nu-proprietário(a)",
  coproprietario: "coproprietário(a)",
  herdeiro: "herdeiro(a)",
  descendente: "descendente",
  credor_fiduciario: "credor fiduciário",
};

// Fecha com ponto o texto que veio do usuário. O parágrafo é montado com a
// frase dele no fim, e sem isso a cláusula termina no ar quando a pessoa digita
// sem pontuação — que é o normal em campo de formulário.
// CPF tem 11 dígitos, CNPJ tem 14. Serve pra rotular o documento do parceiro
// sem obrigar o corretor a dizer qual dos dois está digitando.
// Numeral romano para enumerar os intermediários no rateio — "(i) ... (ii) ..."
// é como cláusula de contrato lista itens dentro de um parágrafo.
const ROMANOS = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
function romano(n) {
  return ROMANOS[n - 1] || String(n);
}

function soDigitosDoc(v) {
  return String(v || "").replace(/\D+/g, "");
}

// Versão sem ponto final: o trecho entra no meio de uma frase maior, que já
// fecha com ponto — acrescentar outro deixaria "..escritura.." no contrato.
function pontoFinalSem(t) {
  return String(t || "").trim().replace(/[.;]+$/, "");
}

function pontoFinal(t) {
  const txt = String(t || "").trim();
  return /[.!?]$/.test(txt) ? txt : txt + ".";
}

function ordinalClausula(n) {
  return ORDINAIS_CLAUSULA[n - 1] || `${n}ª`;
}

const ORDINAIS_PARAGRAFO = ["Primeiro", "Segundo", "Terceiro", "Quarto", "Quinto", "Sexto", "Sétimo", "Oitavo", "Nono", "Décimo"];
function ordinalParagrafo(n) {
  return ORDINAIS_PARAGRAFO[n - 1] || `${n}º`;
}

function need(value, fallback = PLACEHOLDER) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value);
}

function fmtBRL(n) {
  if (n === undefined || n === null || isNaN(Number(n))) return PLACEHOLDER;
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

// Número por extenso, até 999 — o suficiente para prazos em dias, que é onde
// contrato exige a forma dupla ("em até 30 (trinta) dias"). Escrever só o
// algarismo é o que permite a adulteração de um dígito passar despercebida.
const _UNI = ["zero","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez",
  "onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
const _DEZ = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
const _CEM = ["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];

function numeroPorExtenso(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n > 999) return String(n);
  if (n < 20) return _UNI[n];
  if (n < 100) {
    const d = Math.floor(n / 10), u = n % 10;
    return _DEZ[d] + (u ? ` e ${_UNI[u]}` : "");
  }
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), resto = n % 100;
  return _CEM[c] + (resto ? ` e ${numeroPorExtenso(resto)}` : "");
}

function fmtData(iso) {
  if (!iso) return PLACEHOLDER;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${parseInt(m[3])} de ${meses[parseInt(m[2]) - 1]} de ${m[1]}`;
}

// ================= DATAS =================
// O distrato precisa medir quanto do contrato foi cumprido, e isso vira
// dinheiro: a multa é proporcional ao período restante (art. 4º da Lei
// 8.245/91). Conta feita em dias, não em meses arredondados — "quase um mês"
// arredondado pra mais ou pra menos muda o valor devido.
function parseIsoData(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffDias(deIso, ateIso) {
  const a = parseIsoData(deIso), b = parseIsoData(ateIso);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

function somarMeses(iso, meses) {
  const d = parseIsoData(iso);
  const n = Number(meses);
  if (!d || !Number.isFinite(n)) return null;
  const alvo = new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  // Dia que não existe no mês de destino (31 -> mês de 30) rola pro mês
  // seguinte; trazer de volta pro último dia do mês pretendido.
  if (alvo.getDate() !== d.getDate()) alvo.setDate(0);
  const iso2 = `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-${String(alvo.getDate()).padStart(2, "0")}`;
  return iso2;
}

function mesesAproximados(dias) {
  return Math.max(0, Math.round((dias / 365.25) * 12));
}

function fmtDataCurta(iso) {
  if (!iso) return PLACEHOLDER;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Verdadeiro quando a parte é uma empresa (pessoa jurídica).
function ehPJ(p) {
  return String((p || {}).tipoPessoa || "").toLowerCase() === "juridica";
}

/**
 * Qualificação de pessoa jurídica. A concordância é sempre feminina porque
 * concorda com "pessoa jurídica" (inscrita, representada) — por isso a empresa
 * não precisa do campo de gênero, ao contrário da pessoa física.
 */
function qualificacaoPJ(p) {
  const partes = ["pessoa jurídica de direito privado"];
  partes.push(`inscrita no CNPJ sob o nº ${need(p.cnpj)}`);
  if (p.endereco) partes.push(`com sede em ${p.endereco}`);
  let txt = partes.join(", ");
  if (p.repNome) {
    let rep = `neste ato representada por ${p.repNome}`;
    if (p.repCargo) rep += `, na qualidade de ${p.repCargo}`;
    if (p.repCpf) rep += `, inscrito(a) no CPF nº ${p.repCpf}`;
    txt += `, ${rep}`;
  }
  return txt + ".";
}

// "Brasileira, casado(a)" saía em todo contrato com parte feminina: a flexão por
// gênero era feita no texto todo, mas o estado civil entra como valor do
// formulário ("casado(a)", "viúvo(a)") e nunca era alcançado. Aparece na
// qualificação de qualquer parte, não só do anuente.
function flexionarEstadoCivil(estadoCivil, genero) {
  const ec = String(estadoCivil || "").trim();
  const gen = (genero || "").toLowerCase();
  if (!ec) return ec;
  if (gen === "f" || gen === "feminino") return ec.replace(/o\(a\)/g, "a");
  if (gen === "m" || gen === "masculino") return ec.replace(/o\(a\)/g, "o");
  return ec;
}

function qualificacao(p) {
  if (ehPJ(p)) return qualificacaoPJ(p);
  const partes = [];
  partes.push(need(p.nacionalidade, "Brasileiro(a)"));
  if (p.estadoCivil) partes.push(flexionarEstadoCivil(p.estadoCivil, p.genero));
  if (p.profissao) partes.push(p.profissao);
  partes.push(`inscrito(a) no CPF nº ${need(p.cpf)}`);
  if (p.rg) partes.push(`portador(a) do RG nº ${p.rg}`);
  if (p.endereco) partes.push(`residente e domiciliado(a) em ${p.endereco}`);
  let txt = partes.join(", ") + ".";
  const gen = (p.genero || "").toLowerCase();
  if (gen === "f" || gen === "feminino") {
    txt = txt
      .replace(/Brasileiro\(a\)/g, "Brasileira")
      .replace(/inscrito\(a\)/g, "inscrita")
      .replace(/portador\(a\)/g, "portadora")
      .replace(/residente e domiciliado\(a\)/g, "residente e domiciliada");
  } else if (gen === "m" || gen === "masculino") {
    txt = txt
      .replace(/Brasileiro\(a\)/g, "Brasileiro")
      .replace(/inscrito\(a\)/g, "inscrito")
      .replace(/portador\(a\)/g, "portador")
      .replace(/residente e domiciliado\(a\)/g, "residente e domiciliado");
  }
  return txt;
}

function buildFactory(branding, themeKey) {
  const theme = THEMES[themeKey] || THEMES.padrao;
  const GREEN = branding.corPrimaria || "0D1B2A";
  const DARK = theme.dark;
  const MUTED = theme.muted;
  const SOFT = theme.soft;
  const ROW = theme.row;
  const BOX = theme.box;
  const HEADER_FILL = theme.headerFill;
  const TABLE_BORDER = theme.tableBorder;
  const FONT_TITULO = theme.fontTitulo;
  const FONT_CORPO = theme.fontCorpo;

  const tBorder = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER };
  const tBorders = { top: tBorder, bottom: tBorder, left: tBorder, right: tBorder, insideHorizontal: tBorder, insideVertical: tBorder };

  function p(text, opts = {}) {
    return new Paragraph({
      keepNext: !!opts.keepNext,
      keepLines: !!opts.keepLines,
      alignment: opts.align || AlignmentType.JUSTIFIED,
      spacing: { before: opts.before || 0, after: opts.after || 120, line: 300 },
      indent: opts.indent ? { left: opts.indent } : undefined,
      children: [new TextRun({ text, font: FONT_CORPO, size: opts.size || 20, bold: !!opts.bold, italics: !!opts.italics, color: opts.color || DARK })],
    });
  }

  function pMix(parts, opts = {}) {
    const runs = parts.map(part => new TextRun({
      text: part.text, font: FONT_CORPO, size: opts.size || 20,
      bold: !!part.bold, italics: !!part.italics, color: part.color || DARK,
    }));
    return new Paragraph({
      alignment: opts.align || AlignmentType.JUSTIFIED,
      spacing: { before: opts.before || 0, after: opts.after || 120, line: 300 },
      indent: opts.indent ? { left: opts.indent } : undefined,
      children: runs,
    });
  }

  // keepNext em todo título (de cláusula e de parágrafo): título que fica sozinho
  // no pé da página, com o texto dele na seguinte, era a quebra mais comum nos
  // contratos gerados — "CLÁUSULA TERCEIRA – DA POSSE" no fim de uma folha e a
  // cláusula inteira na outra.
  function clausula(num, titulo) {
    const text = `CLÁUSULA ${num} – ${titulo}`;
    if (theme.clauseStyle === "double-rule") {
      return new Paragraph({
        keepNext: true,
        alignment: AlignmentType.CENTER,
        spacing: { before: 360, after: 200, line: 300 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, color: DARK, space: 6 },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: DARK, space: 6 },
        },
        children: [new TextRun({ text, bold: true, font: FONT_TITULO, size: theme.clauseSize, color: DARK })],
      });
    }
    if (theme.clauseStyle === "hairline-center") {
      return new Paragraph({
        keepNext: true,
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 220, line: 320 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: SOFT, space: 8 } },
        children: [new TextRun({ text, bold: true, font: FONT_TITULO, size: theme.clauseSize, color: DARK })],
      });
    }
    const greenBottom = { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 4 };
    return new Paragraph({
      keepNext: true,
      spacing: { before: 320, after: 160, line: 300 },
      border: { bottom: greenBottom },
      children: [new TextRun({ text, bold: true, font: FONT_TITULO, size: theme.clauseSize, color: DARK })],
    });
  }

  function paragrafo(label, texto) {
    return [
      new Paragraph({
        keepNext: true,
        spacing: { before: 160, after: 60, line: 300 },
        indent: { left: 360 },
        children: [new TextRun({ text: label, bold: true, font: FONT_TITULO, size: 20, color: DARK })],
      }),
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 100, line: 300 },
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 8, color: SOFT, space: 8 } },
        children: [new TextRun({ text: texto, font: FONT_CORPO, size: 20, color: DARK })],
      }),
    ];
  }

  function wrapBox(filhos) {
    let borders, shadingFill;
    if (theme.partyStyle === "formal") {
      const b = { style: BorderStyle.SINGLE, size: 4, color: SOFT };
      borders = { top: b, bottom: b, left: b, right: b };
      shadingFill = "FFFFFF";
    } else if (theme.partyStyle === "rule") {
      borders = {
        top: { style: BorderStyle.SINGLE, size: 8, color: GREEN },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: SOFT },
        left: noBorder,
        right: noBorder,
      };
      shadingFill = "FFFFFF";
    } else {
      borders = {
        top: { style: BorderStyle.SINGLE, size: 4, color: SOFT },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: SOFT },
        right: { style: BorderStyle.SINGLE, size: 4, color: SOFT },
        left: { style: BorderStyle.SINGLE, size: 36, color: GREEN },
      };
      shadingFill = BOX;
    }
    const cell = new TableCell({
      borders,
      shading: { fill: shadingFill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 160, bottom: 160, left: 240, right: 200 },
      width: { size: 9070, type: WidthType.DXA },
      children: filhos,
    });
    return new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: [9070], rows: [new TableRow({ children: [cell] })] });
  }

  function blocoParte(rotulo, pessoas) {
    const filhos = [];
    filhos.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: rotulo, bold: true, font: FONT_TITULO, size: 18, color: GREEN })],
    }));
    pessoas.forEach((pe, i) => {
      if (i > 0) filhos.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: " ", size: 14 })] }));
      filhos.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: pe.nome, bold: true, font: FONT_TITULO, size: 22, color: DARK })],
      }));
      filhos.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: pe.conjugeNome ? 60 : 0, line: 280 },
        children: [new TextRun({ text: qualificacao(pe), font: FONT_CORPO, size: 20, color: DARK })],
      }));
      if (pe.conjugeNome) {
        filhos.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 0, line: 280 },
          children: [new TextRun({
            text: `Presente ainda o(a) cônjuge do(a) fiador(a), ${pe.conjugeNome}${pe.conjugeCpf ? `, inscrito(a) no CPF nº ${pe.conjugeCpf}` : ""}, que outorga sua anuência à presente fiança, nos termos do art. 1.647 do Código Civil.`,
            font: FONT_CORPO, size: 20, color: DARK, italics: true,
          })],
        }));
      }
    });
    return wrapBox(filhos);
  }

  function tabelaPagamentos(parcelas, totalLabel, totalValor) {
    const headerCell = (text) => new TableCell({
      borders: tBorders,
      shading: { fill: HEADER_FILL, type: ShadingType.CLEAR, color: "auto" },
      margins: cellMargins,
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, font: FONT_TITULO, size: 20, color: "FFFFFF" })] })],
    });
    const dataCell = (text, opts = {}) => new TableCell({
      borders: tBorders,
      shading: { fill: opts.row ? ROW : "FFFFFF", type: ShadingType.CLEAR, color: "auto" },
      margins: cellMargins,
      children: [new Paragraph({ alignment: opts.align || AlignmentType.CENTER, children: [new TextRun({ text, font: FONT_CORPO, size: 20, bold: !!opts.bold, color: DARK })] })],
    });

    const widths = [3023, 3023, 3024];
    const rows = [new TableRow({ tableHeader: true, children: [headerCell("PARCELA"), headerCell("VENCIMENTO"), headerCell("VALOR (R$)")] })];
    parcelas.forEach((parc, i) => {
      rows.push(new TableRow({
        children: [
          dataCell(need(parc.rotulo), { row: i % 2 === 1 }),
          dataCell(parc.vencimento ? fmtDataCurta(parc.vencimento) + (parc.observacao ? ` (${parc.observacao})` : "") : need(parc.observacao || ""), { row: i % 2 === 1 }),
          dataCell(fmtBRL(parc.valor), { row: i % 2 === 1, bold: true }),
        ],
      }));
    });
    rows.push(new TableRow({
      children: [
        new TableCell({
          borders: tBorders, shading: { fill: HEADER_FILL, type: ShadingType.CLEAR, color: "auto" }, margins: cellMargins, columnSpan: 2,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: totalLabel || "TOTAL", bold: true, font: FONT_TITULO, size: 20, color: "FFFFFF" })] })],
        }),
        new TableCell({
          borders: tBorders, shading: { fill: HEADER_FILL, type: ShadingType.CLEAR, color: "auto" }, margins: cellMargins,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: fmtBRL(totalValor), bold: true, font: FONT_TITULO, size: 20, color: "FFFFFF" })] })],
        }),
      ],
    }));
    return new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: widths, rows });
  }

  function blocoCaixa(linhas) {
    const filhos = linhas.map(l => new Paragraph({
      spacing: { after: 40, line: 280 },
      children: [
        new TextRun({ text: l[0], bold: true, font: FONT_TITULO, size: 20, color: DARK }),
        new TextRun({ text: l[1] || "", font: FONT_CORPO, size: 20, color: DARK }),
      ],
    }));
    return wrapBox(filhos);
  }

  /**
   * Quadro-resumo da primeira página: tabela de duas colunas (rótulo | valor)
   * com as condições principais, para leitura rápida antes das cláusulas.
   * Por padrão, linhas sem valor são omitidas. Com { manterVazios: true },
   * linhas vazias viram um campo em branco — útil para fichas preenchíveis.
   */
  function blocoResumo(linhas, opts = {}) {
    const rows = linhas
      .filter(l => l && (opts.manterVazios || (l[1] !== undefined && l[1] !== null && String(l[1]).trim() !== "")))
      .map(([rotulo, valor]) => new TableRow({
        children: [
          new TableCell({
            borders: tBorders,
            shading: { fill: BOX, type: ShadingType.CLEAR, color: "auto" },
            margins: cellMargins,
            width: { size: 3100, type: WidthType.DXA },
            children: [new Paragraph({
              spacing: { line: 260 },
              children: [new TextRun({ text: String(rotulo).toUpperCase(), bold: true, font: FONT_TITULO, size: 17, color: DARK })],
            })],
          }),
          new TableCell({
            borders: tBorders,
            margins: cellMargins,
            width: { size: 5970, type: WidthType.DXA },
            children: [new Paragraph({
              spacing: { line: 260 },
              children: [new TextRun({ text: (valor === undefined || valor === null || String(valor).trim() === "") ? " " : String(valor), font: FONT_CORPO, size: 19, color: DARK })],
            })],
          }),
        ],
      }));
    if (!rows.length) return null;
    return new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: [3100, 5970], rows });
  }

  function blocoAssinaturas(pares) {
    // Número ímpar de signatários deixa a última célula da direita sem ninguém.
    // Ela vinha com rótulo e linha para assinar mesmo vazia — linha em branco
    // num contrato é convite para assinatura de quem não é parte. Vazia é vazia.
    const celulaVazia = () => new TableCell({
      borders: tBorders,
      margins: { top: 200, bottom: 200, left: 200, right: 200 },
      width: { size: 4535, type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: "", size: 18 })] })],
    });
    const sigCell = (nome, papel) => new TableCell({
      borders: tBorders,
      margins: { top: 200, bottom: 200, left: 200, right: 200 },
      width: { size: 4535, type: WidthType.DXA },
      children: [
        new Paragraph({ keepLines: true, alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "ASSINATURA DIGITAL", font: FONT_CORPO, size: 14, color: MUTED })] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: " ", size: 18 })] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: " ", size: 18 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "____________________________________", font: FONT_CORPO, size: 18, color: DARK })] }),
        new Paragraph({ keepLines: true, alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: nome, bold: true, font: FONT_TITULO, size: 20, color: DARK })] }),
        new Paragraph({ keepLines: true, alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: papel, font: FONT_CORPO, size: 16, color: MUTED })] }),
      ],
    });
    // cantSplit: uma assinatura nunca fica com a linha numa página e o nome na
    // outra. Só isso — sem encadear as linhas entre si: prender todas com
    // keepNext faz o Word tratar a tabela como bloco indivisível e, quando há
    // partes demais pra uma página, ele empurra a tabela inteira e deixa o
    // cabeçalho da folha sozinho numa página anterior.
    const preenchida = (x) => x && String(x.nome || "").trim();
    const celula = (x) => (preenchida(x) ? sigCell(x.nome, x.papel) : celulaVazia());
    const rows = pares.map(par => new TableRow({
      cantSplit: true,
      children: [celula(par[0]), celula(par[1])],
    }));
    return new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: [4535, 4535], rows });
  }

  function blocoTestemunhas() {
    const witCell = () => new TableCell({
      borders: tBorders,
      margins: { top: 200, bottom: 200, left: 200, right: 200 },
      width: { size: 4535, type: WidthType.DXA },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "ASSINATURA", font: FONT_CORPO, size: 14, color: MUTED })] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: " ", size: 18 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "____________________________________", font: FONT_CORPO, size: 18, color: DARK })] }),
        new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: "Nome: ____________________________", font: FONT_CORPO, size: 18, color: DARK })] }),
        new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: "CPF: _____________________________", font: FONT_CORPO, size: 18, color: DARK })] }),
      ],
    });
    // O rótulo anda preso à tabela: "TESTEMUNHAS:" sozinho no pé de uma página,
    // com as linhas na seguinte, é exatamente a quebra que a folha evita.
    const label = new Paragraph({ keepNext: true, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: "TESTEMUNHAS:", bold: true, font: FONT_TITULO, size: 18, color: DARK })] });
    const table = new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: [4535, 4535], rows: [new TableRow({ cantSplit: true, children: [witCell(), witCell()] })] });
    return [label, table];
  }

  // ===================================================================
  // ENCERRAMENTO + FOLHA DE ASSINATURAS
  // ===================================================================
  // O texto contratual termina com uma declaração de encerramento e as
  // assinaturas vão para uma página só delas. Três motivos:
  //  - o espaço em branco entre a última cláusula e as assinaturas é onde se
  //    acrescenta texto depois de assinado; declarar ali que o contrato acabou
  //    (e que o resto da página é branco de propósito) fecha essa porta;
  //  - a tabela de assinaturas caía partida entre páginas, com local e data de
  //    um lado e as linhas do outro;
  //  - a folha nomeia o documento, o imóvel e as partes, então não serve
  //    grampeada em outro contrato.

  function listaNomes(pessoas) {
    const nomes = (pessoas || []).map(x => String((x && x.nome) || "").trim()).filter(Boolean);
    if (!nomes.length) return PLACEHOLDER;
    return nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
  }

  function encerramentoClausulas(nomeDoc) {
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: 300, after: 140 }, keepNext: true, keepLines: true,
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 6 } },
        children: [new TextRun({ text: "FIM DAS CLÁUSULAS", bold: true, font: FONT_TITULO, size: 18, color: DARK, characterSpacing: 40 })],
      }),
      new Paragraph({
        keepLines: true,
        alignment: AlignmentType.JUSTIFIED, spacing: { after: 0, line: 280 },
        children: [
          new TextRun({ text: `O presente ${nomeDoc} encerra-se nesta página, sem cláusulas ou disposições posteriores. As assinaturas das partes constam da página seguinte — a FOLHA DE ASSINATURAS —, que integra este instrumento, composto de `, font: FONT_CORPO, size: 18, color: MUTED, italics: true }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_CORPO, size: 18, color: MUTED, italics: true }),
          new TextRun({ text: " páginas. O espaço restante desta página foi intencionalmente deixado em branco.", font: FONT_CORPO, size: 18, color: MUTED, italics: true }),
        ],
      }),
    ];
  }

  function folhaAssinaturas({ referencia, data, pares, testemunhas }) {
    const out = [];
    out.push(new Paragraph({
      pageBreakBefore: true, keepNext: true, keepLines: true, alignment: AlignmentType.CENTER, spacing: { before: 0, after: 100 },
      children: [new TextRun({ text: "FOLHA DE ASSINATURAS", bold: true, font: FONT_TITULO, size: 28, color: DARK, characterSpacing: 30 })],
    }));
    out.push(new Paragraph({
      keepNext: true, spacing: { before: 0, after: 220 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 4 } },
      children: [new TextRun({ text: "" })],
    }));
    // keepLines: a referência lista todas as partes e fica longa quando há muita
    // gente. Sem isso ela se parte no fim da página e o cabeçalho da folha
    // acaba numa folha e as assinaturas em outra — o oposto do que a folha
    // existe pra resolver.
    out.push(new Paragraph({
      keepNext: true, keepLines: true, alignment: AlignmentType.JUSTIFIED, spacing: { after: 200, line: 280 },
      children: [new TextRun({ text: referencia, font: FONT_CORPO, size: 19, color: DARK })],
    }));
    out.push(new Paragraph({
      keepNext: true, alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 280 },
      children: [new TextRun({ text: `${branding.cidade || "Natal"}, ${fmtData(data)}`, bold: true, font: FONT_TITULO, size: 21, color: DARK })],
    }));
    out.push(blocoAssinaturas(pares));
    if (testemunhas) out.push(...blocoTestemunhas());
    return out;
  }

  function headerRule() {
    if (theme.headerRuleStyle === "double") {
      return new Paragraph({
        spacing: { before: 100, after: 0 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 2 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 2 } },
        children: [new TextRun({ text: "" })],
      });
    }
    if (theme.headerRuleStyle === "hairline") {
      return new Paragraph({
        spacing: { before: 140, after: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: SOFT, space: 4 } },
        children: [new TextRun({ text: "" })],
      });
    }
    return new Paragraph({
      spacing: { before: 80, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 1 } },
      children: [new TextRun({ text: "" })],
    });
  }

  function footerRule() {
    if (theme.headerRuleStyle === "double") {
      return new Paragraph({
        spacing: { before: 0, after: 80 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 2 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 2 } },
        children: [new TextRun({ text: "" })],
      });
    }
    if (theme.headerRuleStyle === "hairline") {
      return new Paragraph({
        spacing: { before: 0, after: 100 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: SOFT, space: 4 } },
        children: [new TextRun({ text: "" })],
      });
    }
    return new Paragraph({
      spacing: { before: 0, after: 80 },
      border: { top: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 1 } },
      children: [new TextRun({ text: "" })],
    });
  }


  function tituloContrato(linha1, linha2, opts = {}) {
    const linha2Color = opts.linha2Color || DARK;
    const linha2Size = opts.linha2Size || theme.titleSize;
    if (theme.titleStyle === "framed") {
      return [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 8 } }, children: [new TextRun({ text: "", size: 2 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 40, line: 300 }, children: [new TextRun({ text: linha1, bold: true, font: FONT_TITULO, size: theme.titleSize, color: DARK })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160, line: 300 }, children: [new TextRun({ text: linha2, bold: true, font: FONT_TITULO, size: linha2Size, color: linha2Color })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 8 } }, children: [new TextRun({ text: "", size: 2 })] }),
      ];
    }
    if (theme.titleStyle === "subtitled") {
      return [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 280, after: 60, line: 320 }, children: [new TextRun({ text: linha1, bold: true, font: FONT_TITULO, size: theme.titleSize, color: DARK })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80, line: 320 }, children: [new TextRun({ text: linha2, bold: true, font: FONT_TITULO, size: linha2Size, color: linha2Color })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 340 }, children: [new TextRun({ text: "Instrumento particular", italics: true, font: FONT_TITULO, size: 18, color: MUTED })] }),
      ];
    }
    return [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 80, line: 300 }, children: [new TextRun({ text: linha1, bold: true, font: FONT_TITULO, size: theme.titleSize, color: DARK })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320, line: 300 }, children: [new TextRun({ text: linha2, bold: true, font: FONT_TITULO, size: linha2Size, color: linha2Color })] }),
    ];
  }

  function buildHeader() {
    const infoLines = [
      branding.creci ? `CRECI: ${branding.creci}` : null,
      branding.cnpj ? `CNPJ: ${branding.cnpj}` : null,
      branding.email || null,
    ].filter(Boolean);

    const children = [];
    if (branding.logoBuffer) {
      const logoCell = new TableCell({
        borders: noBorders, margins: { top: 0, bottom: 0, left: 0, right: 0 },
        width: { size: 4535, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.LEFT, spacing: { after: 0 },
          children: [new ImageRun({ type: "png", data: branding.logoBuffer, transformation: { width: 70, height: 52 }, altText: { title: branding.nome || "Logo", description: "Logo", name: "logo" } })],
        })],
      });
      const infoCell = new TableCell({
        borders: noBorders, margins: { top: 0, bottom: 0, left: 0, right: 0 },
        width: { size: 4535, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
        children: infoLines.map(t => new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [new TextRun({ text: t, font: FONT_CORPO, size: 18, color: MUTED })] })),
      });
      children.push(new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: [4535, 4535], rows: [new TableRow({ children: [logoCell, infoCell] })] }));
    } else {
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { after: 0 },
        children: [
          new TextRun({ text: (branding.nome || "").toUpperCase(), bold: true, font: FONT_TITULO, size: 24, color: DARK }),
          new TextRun({ text: infoLines.length ? "   " + infoLines.join("  |  ") : "", font: FONT_CORPO, size: 16, color: MUTED }),
        ],
      }));
    }
    children.push(headerRule());
    return new Header({ children });
  }

  function buildFooter() {
    const footerLine = new Paragraph({
      alignment: AlignmentType.LEFT, spacing: { after: 0 },
      tabStops: [{ type: TabStopType.CENTER, position: 4535 }, { type: TabStopType.RIGHT, position: 9070 }],
      children: [
        new TextRun({ text: (branding.nome || "").toUpperCase(), bold: true, font: FONT_TITULO, size: 14, color: DARK }),
        new TextRun({ text: `\t${branding.endereco || ""}`, font: FONT_CORPO, size: 14, color: MUTED }),
        new TextRun({ text: `\t${[branding.email, branding.creci ? `CRECI: ${branding.creci}` : null].filter(Boolean).join("  |  ")}`, font: FONT_CORPO, size: 14, color: MUTED }),
      ],
    });
    // "Página X de Y" em toda folha. É o que permite conferir que nenhuma página
    // foi retirada ou trocada — e dá sentido à folha de assinaturas, que declara
    // de quantas páginas o instrumento é composto.
    const numeracao = new Paragraph({
      alignment: AlignmentType.RIGHT, spacing: { before: 40, after: 0 },
      children: [
        new TextRun({ text: "Página ", font: FONT_CORPO, size: 14, color: MUTED }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT_CORPO, size: 14, color: MUTED }),
        new TextRun({ text: " de ", font: FONT_CORPO, size: 14, color: MUTED }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_CORPO, size: 14, color: MUTED }),
      ],
    });
    return new Footer({ children: [footerRule(), footerLine, numeracao] });
  }

  function buildCompraVenda(d) {
    const children = [];
    const ehSingularVend = (d.vendedores || []).length === 1;
    const ehSingularComp = (d.compradores || []).length === 1;
    // Empresa concorda no feminino (concorda com "pessoa jurídica"), assim como
    // a pessoa física de gênero feminino — por isso a PJ dispensa o campo gênero.
    const ehFem = (p) => ehPJ(p) || String((p || {}).genero || "").toLowerCase().startsWith("f");
    const vnd0 = (d.vendedores || [])[0] || {};
    const cmp0 = (d.compradores || [])[0] || {};
    // "PROMITENTE" é invariável, mas "PROMISSÁRIO" flexiona: o feminino é
    // "PROMISSÁRIA COMPRADORA" (não "PROMISSÁRIO COMPRADORA").
    const VND = ehSingularVend ? (ehFem(vnd0) ? "PROMITENTE VENDEDORA" : "PROMITENTE VENDEDOR") : "PROMITENTES VENDEDORES";
    const CMP = ehSingularComp ? (ehFem(cmp0) ? "PROMISSÁRIA COMPRADORA" : "PROMISSÁRIO COMPRADOR") : "PROMISSÁRIOS COMPRADORES";
    const verboVnd = ehSingularVend
      ? (ehPJ(vnd0) ? "é legítima proprietária" : "é legítimo(a) proprietário(a)")
      : "são legítimos proprietários";
    const verboDecl = ehSingularVend ? "Declara o(a)" : "Declaram os";
    const seCompromete = ehSingularVend ? "se compromete" : "se comprometem";
    const declaramComp = ehSingularComp ? "declara" : "declaram";

    // Condições financeiras e de entrega — calculadas aqui porque alimentam
    // tanto o quadro-resumo da primeira página quanto as cláusulas adiante.
    const valorTotal = d.valor && d.valor.total !== undefined ? d.valor.total : (d.pagamento && d.pagamento.parcelas ? d.pagamento.parcelas.reduce((a, x) => a + Number(x.valor || 0), 0) : 0);
    const valorExtenso = d.valor && d.valor.extenso ? d.valor.extenso : "";
    const modalidade = (d.pagamento && d.pagamento.modalidade) || "a_vista";
    const modalidadeTxt = ({ a_vista: "à vista", parcelado: "de forma parcelada", financiado: "via financiamento bancário", misto: "de forma mista (entrada + parcelas/financiamento)" })[modalidade] || "conforme acordado";

    // ===== ENTREGA DE CHAVES =====
    // Cada modo nomeia um EVENTO verificável, não uma data solta. "As chaves
    // serão entregues em 30 dias" é a redação que mais gera briga: trinta dias
    // a partir de quê? Se a operação atrasa — e financiamento atrasa —, a data
    // chega antes do dinheiro e ninguém sabe mais qual regra vale. Amarrando a
    // entrega a um marco (assinatura, entrada, liberação do banco, quitação), o
    // contrato continua legível mesmo quando o cronograma escorrega.
    const ec = d.entregaChaves || {};
    const modoChaves = ec.modo || "na_assinatura";
    const dataChaves = ec.data ? fmtDataCurta(ec.data) : null;
    const prazoChaves = Math.floor(Number(ec.prazoDias) || 0);

    const MARCOS_CHAVES = {
      na_assinatura:     { marco: "a assinatura deste instrumento", curto: "Na assinatura deste contrato" },
      assinatura_banco:  { marco: "a assinatura do contrato de financiamento junto à instituição financeira", curto: "Na assinatura do contrato com o banco" },
      pagamento_entrada: { marco: "o pagamento da entrada", curto: "No pagamento da entrada" },
      quitacao_banco:    { marco: "a liberação do valor financiado pela instituição financeira ao(s) PROMITENTE(S) VENDEDOR(ES)", curto: "Na liberação do financiamento pelo banco" },
      quitacao_total:    { marco: "a quitação integral do preço ajustado", curto: "Na quitação integral do preço" },
      // Modo antigo: contratos gerados antes desta revisão gravaram
      // "ultima_parcela". Continua valendo pra não mudar o texto de documento
      // que já circulou.
      ultima_parcela:    { marco: "o pagamento da última parcela do preço", curto: "Na quitação da última parcela" },
    };

    let textoChaves, chavesResumoCV;
    if (modoChaves === "data_fixa") {
      textoChaves = `A entrega das chaves e a transmissão da posse direta do imóvel ocorrerão em ${dataChaves || PLACEHOLDER}, independentemente da ordem das demais obrigações financeiras, salvo se as partes convencionarem antecipação por escrito.`;
      chavesResumoCV = dataChaves || "";
    } else if (modoChaves === "outro" || !MARCOS_CHAVES[modoChaves]) {
      textoChaves = `A entrega das chaves e a transmissão da posse direta do imóvel obedecerão ao seguinte: ${ec.descricao || PLACEHOLDER}.`;
      chavesResumoCV = ec.descricao || "";
    } else {
      const { marco, curto } = MARCOS_CHAVES[modoChaves];
      const quando = prazoChaves > 0
        ? `em até ${prazoChaves} (${numeroPorExtenso(prazoChaves)}) dias corridos contados da data em que ocorrer ${marco}`
        : `na mesma data em que ocorrer ${marco}`;
      textoChaves = `A entrega das chaves e a transmissão da posse direta do imóvel ao(s) PROMISSÁRIO(S) COMPRADOR(ES) dar-se-ão ${quando}${dataChaves ? `, com previsão para ${dataChaves}` : ""}.`;
      chavesResumoCV = curto
        + (prazoChaves > 0 ? ` — em até ${prazoChaves} dia(s)` : "")
        + (dataChaves ? ` (previsão: ${dataChaves})` : "");
    }

    // ===== CORRETAGEM =====
    // Comissão nem sempre é percentual: em imóvel de valor alto, permuta ou
    // negócio fechado no detalhe, o combinado costuma ser um valor fechado. Com
    // só o campo de percentual, quem cobrava valor fixo precisava calcular a
    // porcentagem equivalente na mão — e um arredondamento errado aí é dinheiro
    // do corretor.
    const corret = d.corretagem || {};
    const corretPorValor = corret.modo === "valor";
    const corretPercentual = Number(corret.percentual || 5);
    const corretValor = corretPorValor
      ? Number(corret.valorFixo !== undefined ? corret.valorFixo : (corret.valor || 0))
      : (corret.valor !== undefined ? corret.valor : valorTotal * (corretPercentual / 100));
    // Vírgula decimal: "5.5%" num contrato brasileiro parece erro de digitação —
    // ou meio caminho pra alguém ler 55%. E o percentual sai também por extenso
    // quando é inteiro ("6% (seis por cento)"): só o algarismo deixa o
    // documento aberto à troca de um dígito.
    const percNumeral = String(corretPercentual).replace(".", ",");
    const percExtenso = Number.isInteger(corretPercentual) ? numeroPorExtenso(corretPercentual) : percNumeral;
    const corretBase = corretPorValor ? fmtBRL(corretValor) : `${percNumeral}% — ${fmtBRL(corretValor)}`;
    // O trecho carrega a própria regência: no valor fixo não cabe "o valor
    // correspondente a", que só existe quando há percentual a converter.
    const corretTexto = corretPorValor
      ? `o valor fixo e previamente ajustado de ${fmtBRL(corretValor)}`
      : `o valor correspondente a ${percNumeral}% (${percExtenso} por cento) do valor total da venda, equivalente a ${fmtBRL(corretValor)}`;

    // QUANDO a comissão é paga. Isto era texto fixo — o contrato dizia
    // "proporcional a cada parcela recebida" em toda venda, inclusive quando o
    // combinado era receber tudo na entrada. E era a mesma frase repetida no
    // caput e no Parágrafo Primeiro, então corrigir na mão significava lembrar
    // de dois lugares.
    //
    // É o ponto que mais dá briga depois: parcelamento longo com comissão
    // proporcional é o corretor financiando a própria comissão sem ter
    // combinado isso.
    // Cada momento guarda o MARCO (sintagma nominal) pra dar pra compor tanto
    // "na data em que ocorrer X" quanto "em até N dias contados de X".
    const MOMENTOS_COMISSAO = {
      proporcional:     { marco: "cada recebimento", base: "de forma proporcional a cada parcela recebida pelo(s) PROMITENTE(S) VENDEDOR(ES)", curto: "proporcional às parcelas" },
      entrada:          { marco: "o pagamento da entrada/sinal pelo(s) PROMISSÁRIO(S) COMPRADOR(ES)", curto: "na entrada" },
      primeira_parcela: { marco: "o pagamento da primeira parcela do preço", curto: "na 1ª parcela" },
      assinatura:       { marco: "a assinatura deste instrumento", curto: "na assinatura" },
      liberacao_banco:  { marco: "a liberação do valor financiado pela instituição financeira", curto: "na liberação do financiamento" },
      escritura:        { marco: "a lavratura da escritura pública de compra e venda", curto: "na escritura" },
      quitacao_total:   { marco: "a quitação integral do preço ajustado", curto: "na quitação integral" },
    };
    const momentoId = (corret.pagamento && MOMENTOS_COMISSAO[corret.pagamento]) ? corret.pagamento
      : (corret.pagamento === "outro" ? "outro" : "proporcional");

    // PRAZO para pagar, contado do marco. Dizer só QUANDO a comissão é devida
    // não resolve: sem data-limite não há vencimento, sem vencimento não há
    // mora — e "pago mês que vem" vira uma posição defensável. É o buraco que
    // deixou uma comissão devida na entrada sem nada a cobrar.
    const prazoComissao = Math.max(0, Math.floor(Number(corret.prazoDias === undefined ? 1 : corret.prazoDias) || 0));
    // Dias ÚTEIS, não corridos: a comissão é paga por transferência, e prazo
    // corrido que cai em sábado ou feriado dá ao devedor uma desculpa pronta
    // pelo atraso. E concordância no singular — "em até 1 (um) dias úteis
    // contados" num contrato é o tipo de erro que tira a seriedade do texto.
    const umDia = prazoComissao === 1;
    const emAte = `em até ${prazoComissao} (${numeroPorExtenso(prazoComissao)}) ${umDia ? "dia útil contado" : "dias úteis contados"}`;

    let textoMomento, curtoMomento;
    if (momentoId === "outro") {
      textoMomento = pontoFinalSem(corret.pagamentoDescricao || PLACEHOLDER);
      curtoMomento = corret.pagamentoDescricao || "";
    } else {
      const m = MOMENTOS_COMISSAO[momentoId];
      if (momentoId === "proporcional") {
        textoMomento = prazoComissao > 0 ? `${m.base}, ${emAte} de ${m.marco}` : m.base;
      } else {
        textoMomento = prazoComissao > 0
          ? `integralmente ${emAte} da data em que ocorrer ${m.marco}`
          : `integralmente na data em que ocorrer ${m.marco}`;
      }
      curtoMomento = m.curto + (prazoComissao > 0 ? ` (até ${prazoComissao} ${umDia ? "dia útil" : "dias úteis"})` : "");
    }
    const momentoComissao = { texto: textoMomento, curto: curtoMomento };
    const corretResumo = corretBase + (momentoComissao.curto ? ` · ${momentoComissao.curto}` : "");

    // Encargos do atraso. Sem multa e juros escritos, o inadimplemento da
    // comissão sai de graça: o devedor paga quando quiser e o corretor não tem
    // nem o que cobrar além do principal.
    const multaComissao = Number(corret.multaPercentual === undefined ? 2 : corret.multaPercentual) || 0;
    const jurosComissao = Number(corret.jurosMensal === undefined ? 1 : corret.jurosMensal) || 0;
    const pct = (v) => `${String(v).replace(".", ",")}% (${Number.isInteger(v) ? numeroPorExtenso(v) : String(v).replace(".", ",")} por cento)`;

    // ===== PARCERIA ENTRE CORRETORES =====
    // Boa parte das vendas sai em parceria, e o contrato só nomeava uma
    // imobiliária. O parceiro que não aparece no instrumento fica sem prova do
    // que foi combinado — e o vendedor que paga tudo a um só pode ser cobrado
    // depois pelo outro, porque quitou uma parcela que não era inteira dele.
    const parceiros = (corret.parceiros || []).filter(x => x && String(x.nome || "").trim());
    const temParceria = parceiros.length > 0;

    // A fatia da imobiliária que emite o contrato é o que sobra: assim o rateio
    // fecha 100% por construção, em vez de depender de o usuário somar certo.
    const somaParceiros = parceiros.reduce((a, x) => a + (Number(x.percentual) || 0), 0);
    const fatiaPropria = Math.max(0, 100 - somaParceiros);

    const rateio = temParceria ? [
      { nome: branding.nome || "IMOBILIÁRIA", creci: branding.creci || "", documento: branding.cnpj || "", pix: branding.pixChave || "", percentual: fatiaPropria },
      ...parceiros.map(x => ({
        nome: String(x.nome).trim(), creci: (x.creci || "").trim(),
        documento: (x.documento || "").trim(), pix: (x.pixChave || "").trim(),
        percentual: Number(x.percentual) || 0,
      })),
    ] : [];

    // Centavos, não reais: distribuir em float faz as partes não fecharem o
    // total. O resto da divisão vai para o primeiro participante, senão a soma
    // das fatias do contrato não bate com a comissão do caput.
    if (temParceria) {
      const totalCentavos = Math.round(corretValor * 100);
      let acumulado = 0;
      rateio.forEach((r, i) => {
        if (i === 0) { r.centavos = 0; return; }
        r.centavos = Math.round(totalCentavos * r.percentual / 100);
        acumulado += r.centavos;
      });
      rateio[0].centavos = totalCentavos - acumulado;
      rateio.forEach(r => { r.valor = r.centavos / 100; });
    }

    const qualificaIntermediario = (r) => `${r.nome.toUpperCase()}`
      + (r.creci ? `, CRECI ${r.creci}` : "")
      + (r.documento
        ? (soDigitosDoc(r.documento).length > 11
          ? `, inscrita no CNPJ nº ${r.documento}`
          : `, inscrito(a) no CPF nº ${r.documento}`)
        : "");

    const rateioResumo = temParceria
      ? rateio.map(r => `${r.nome} ${String(r.percentual).replace(".", ",")}%`).join(" · ")
      : "";

    // ===== ANUENTES =====
    // Quem não vende nem compra, mas cuja concordância a lei exige para a venda
    // valer: cônjuge do vendedor (art. 1.647), usufrutuário, coproprietário,
    // demais descendentes na venda a descendente (art. 496), credor fiduciário.
    // Sem a assinatura dessa pessoa o negócio é anulável — e o problema costuma
    // aparecer no cartório, depois de o comprador já ter pago.
    const anuentes = (d.anuentes || []).filter(a => a && String(a.nome || "").trim());
    const temAnuentes = anuentes.length > 0;

    children.push(...tituloContrato("CONTRATO PARTICULAR DE PROMESSA", "DE COMPRA E VENDA DE IMÓVEL"));

    // ===== QUADRO-RESUMO (primeira página) =====
    const parcelas = (d.pagamento && d.pagamento.parcelas) || [];
    const pagamentoResumo = `${modalidadeTxt.charAt(0).toUpperCase()}${modalidadeTxt.slice(1)}${parcelas.length > 1 ? ` — ${parcelas.length} parcelas` : ""}`;

    const resumoCV = blocoResumo([
      ["Endereço do imóvel", need(d.imovel && d.imovel.endereco)],
      ["Matrícula", (d.imovel && d.imovel.matricula) || ""],
      ["Valor total", valorTotal ? `${fmtBRL(valorTotal)}${valorExtenso ? ` (${valorExtenso})` : ""}` : ""],
      ["Forma de pagamento", pagamentoResumo],
      ["Entrega das chaves", chavesResumoCV],
      ["Comissão de corretagem", corretValor ? corretResumo : ""],
      ["Rateio da comissão", rateioResumo],
      ["Anuente(s)", anuentes.map(a => `${a.nome}${ROTULOS_CURTOS_ANUENCIA[a.tipoAnuencia] ? ` (${ROTULOS_CURTOS_ANUENCIA[a.tipoAnuencia]})` : ""}`).join("; ")],
      ["Intermediação", branding.nome ? `${branding.nome}${branding.creci ? ` — CRECI ${branding.creci}` : ""}` : ""],
    ]);
    if (resumoCV) {
      children.push(resumoCV);
      children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: " ", size: 12 })] }));
    }

    children.push(p("Pelo presente instrumento particular de promessa de compra e venda, de um lado:", { after: 160 }));
    children.push(blocoParte(VND, d.vendedores || []));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E de outro —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
    children.push(blocoParte(CMP, d.compradores || []));

    if (temAnuentes) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E, na qualidade de ANUENTE(S) —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
      children.push(blocoParte(anuentes.length > 1 ? "ANUENTES" : "ANUENTE", anuentes));
    }

    children.push(clausula("PRIMEIRA", "DO OBJETO"));
    const matricula = d.imovel && d.imovel.matricula ? `, matrícula nº ${d.imovel.matricula}` : "";
    const caracteristicas = d.imovel && d.imovel.caracteristicas ? ` ${d.imovel.caracteristicas}` : "";
    children.push(pMix([
      { text: ehSingularVend ? "O(a) " : "Os " }, { text: VND, bold: true },
      { text: ` ${verboVnd} do imóvel localizado na ` }, { text: need(d.imovel && d.imovel.endereco), bold: true },
      { text: matricula + caracteristicas + ", objeto do presente contrato, comprometendo-se, por meio deste instrumento, a transferir a sua propriedade ao(s) " },
      { text: CMP, bold: true }, { text: ", nas condições adiante estipuladas." },
    ]));
    if (d.imovel && d.imovel.descricaoRegistro && String(d.imovel.descricaoRegistro).trim()) {
      children.push(...paragrafo("Descrição do imóvel (conforme documento de inteiro teor)", String(d.imovel.descricaoRegistro).trim()));
    }
    children.push(...paragrafo("Parágrafo Primeiro", `${ehSingularComp ? "O(a) PROMISSÁRIO(A) COMPRADOR(A)" : "Os PROMISSÁRIOS COMPRADORES"} ${declaramComp} que visitou o imóvel objeto deste contrato, verificou suas condições físicas, estruturais e de conservação, e ${ehSingularComp ? "concorda" : "concordam"} integralmente com a situação atual do imóvel, aceitando-o no estado em que se encontra, nada tendo a reclamar quanto ao seu estado de conservação.`));

    children.push(clausula("SEGUNDA", "DO VALOR E CONDIÇÕES DE PAGAMENTO"));

    children.push(pMix([
      { text: "O preço total do imóvel descrito na Cláusula Primeira é de " },
      { text: `${fmtBRL(valorTotal)}${valorExtenso ? ` (${valorExtenso})` : ""}`, bold: true },
      { text: `, a ser pago ${modalidadeTxt} pelo(s) ` }, { text: CMP, bold: true },
      { text: " ao(s) " }, { text: VND, bold: true }, { text: " conforme cronograma abaixo:" },
    ], { after: 160 }));
    children.push(tabelaPagamentos(d.pagamento && d.pagamento.parcelas || [], "TOTAL", valorTotal));

    if (d.pagamento && d.pagamento.dadosBancarios) {
      children.push(...paragrafo("Parágrafo Primeiro", "O(s) pagamento(s) deverá(ão) ser realizado(s) exclusivamente na conta bancária indicada abaixo:"));
      const db = d.pagamento.dadosBancarios;
      const linhas = [];
      if (db.titular) linhas.push(["Titular: ", db.titular]);
      if (db.cpf) linhas.push(["CPF/CNPJ: ", db.cpf]);
      if (db.banco) linhas.push(["Banco: ", db.banco]);
      if (db.tipo) linhas.push(["Tipo: ", db.tipo]);
      if (db.agencia) linhas.push(["Agência: ", db.agencia]);
      if (db.conta) linhas.push(["Conta: ", db.conta]);
      if (db.pix) linhas.push(["PIX: ", db.pix]);
      children.push(blocoCaixa(linhas));
    }

    children.push(...paragrafo("Parágrafo Segundo", textoChaves));

    children.push(...paragrafo("Parágrafo Terceiro", "As partes poderão comparecer ao cartório competente para dar início ao processo de lavratura da escritura pública de compra e venda do imóvel a partir da quitação integral do preço descrito na Cláusula Segunda. A assinatura da escritura definitiva pelo(s) PROMITENTE(S) VENDEDOR(ES) somente ocorrerá após a confirmação do pagamento total."));
    children.push(...paragrafo("Parágrafo Quarto", "O atraso no pagamento de qualquer parcela implicará na incidência de multa moratória de 2% (dois por cento) sobre o valor da parcela em atraso, acrescida de juros de mora de 1% (um por cento) ao mês, calculados pro rata die, desde a data do vencimento até o efetivo pagamento."));
    children.push(...paragrafo("Parágrafo Quinto", `Caso o atraso no pagamento de qualquer parcela ultrapasse o prazo de 30 (trinta) dias corridos contados da data de seu respectivo vencimento, o(a) ${VND} poderá notificar o(a) ${CMP}, concedendo-lhe o prazo de 15 (quinze) dias para purgação da mora mediante o pagamento do débito em atraso, acrescido dos encargos moratórios previstos no Parágrafo Quarto desta cláusula. Não purgada a mora no prazo assinalado, o contrato será considerado rescindido, aplicando-se as penalidades previstas na Cláusula Sétima deste instrumento.`));
    children.push(...paragrafo("Parágrafo Sexto", "Até a quitação total do valor do imóvel, o presente contrato terá caráter de promessa de compra e venda. A propriedade permanecerá com o(s) PROMITENTE(S) VENDEDOR(ES) até o cumprimento integral das obrigações financeiras, sendo a escritura definitiva assinada apenas após o recebimento do valor final do imóvel."));

    children.push(clausula("TERCEIRA", "DA POSSE"));
    children.push(pMix([
      { text: ehSingularVend ? "O(a) " : "Os " }, { text: VND, bold: true },
      { text: ` ${seCompromete} a entregar as chaves do imóvel ao(s) ` }, { text: CMP, bold: true },
      { text: `, conforme regra estabelecida no Parágrafo Segundo da Cláusula Segunda, transferindo-lhe(s) a posse direta do imóvel.` },
    ]));
    children.push(...paragrafo("Parágrafo Primeiro", "A partir da entrega das chaves, o(s) PROMISSÁRIO(S) COMPRADOR(ES) assumirão integralmente a responsabilidade pelo pagamento de todos os débitos relativos ao imóvel, incluindo, mas não se limitando a: IPTU, taxas condominiais, contas de água, energia elétrica, gás e demais encargos que incidam sobre o imóvel."));
    children.push(...paragrafo("Parágrafo Segundo", "O(s) PROMITENTE(S) VENDEDOR(ES) declara(m) que entregará(ão) o imóvel livre e desembaraçado de quaisquer débitos anteriores à data de transferência da posse, responsabilizando-se por eventuais cobranças retroativas."));
    // Sem termo de entrega, a divisão de contas e o estado do imóvel viram
    // versão de cada lado depois que as chaves já mudaram de mão. As leituras
    // dos medidores são o que separa a conta de quem saiu da conta de quem
    // entrou — e é o documento que a concessionária pede na transferência.
    children.push(...paragrafo("Parágrafo Terceiro", "A entrega das chaves será formalizada mediante termo de entrega assinado pelas partes, do qual constarão a data da entrega, o estado de conservação do imóvel e as leituras dos medidores de água e de energia elétrica na referida data, servindo o termo como marco da divisão de responsabilidades entre as partes."));
    children.push(...paragrafo("Parágrafo Quarto", "As partes providenciarão a transferência de titularidade das contas de água, energia elétrica, gás e demais serviços para o nome do(s) PROMISSÁRIO(S) COMPRADOR(ES) no prazo de até 30 (trinta) dias contados da entrega das chaves, cabendo ao(s) PROMITENTE(S) VENDEDOR(ES) fornecer os documentos necessários para tanto."));

    children.push(clausula("QUARTA", "DA LEGALIZAÇÃO"));
    children.push(pMix([
      { text: "Ocorrerá por conta e responsabilidade do(s) " }, { text: CMP, bold: true },
      { text: " as despesas referentes à escrituração definitiva de compra e venda do imóvel, o pagamento do imposto de transmissão (ITBI), laudêmio, taxas, emolumentos, bem como todos os custos necessários à legalização da transferência do imóvel objeto do presente pacto." },
    ]));
    children.push(...paragrafo("Parágrafo Primeiro", "Uma vez quitado o valor descrito na Cláusula Segunda, em caso de falecimento, impedimento ou interdição do(s) PROMITENTE(S) VENDEDOR(ES), fica estabelecido que seus ascendentes, descendentes, herdeiros (em linha reta ou colateral), representantes, cônjuge ou companheiro(a), estarão obrigados a outorgar a respectiva escritura definitiva em favor do(s) PROMISSÁRIO(S) COMPRADOR(ES)."));

    children.push(clausula("QUINTA", "DA INEXISTÊNCIA DE ÔNUS REAL E PESSOAL"));
    children.push(pMix([
      { text: ehSingularVend ? "Declara o(a) " : "Declaram os " }, { text: VND, bold: true },
      { text: " que o descrito e caracterizado imóvel se encontra livre e desembaraçado de quaisquer outras dívidas, ônus, hipotecas legais ou convencionais, arresto ou sequestro, penhora e cauções de qualquer natureza, foro ou pensão, e que inexistem sobre ele feitos ajuizados ou ações pessoais ou reais reipersecutórias, e, quanto aos seus aspectos fiscais, quites com todos os impostos, taxas e contribuições, hipotecas judiciais, convencionais e/ou qualquer outro direito real, que obstaculize a transferência do mesmo. Como também " },
      { text: ehSingularVend ? "declara o(a) " : "declaram os " }, { text: VND, bold: true },
      { text: " que se acha(m) livre(s) de qualquer débito civil, trabalhista ou tributário que possa recair sobre a presente venda." },
    ]));

    children.push(clausula("SEXTA", "DA INTERMEDIAÇÃO/CORRETAGEM"));
    // Em parceria, o caput nomeia TODOS os intermediários. Citar só quem emitiu
    // o contrato deixaria o parceiro fora do instrumento — sem prova do que foi
    // combinado justamente no documento que as partes assinam.
    const proprio = { text: `${(branding.nome || "IMOBILIÁRIA").toUpperCase()}${branding.creci ? `, CRECI: ${branding.creci}` : ""}`, bold: true };
    const complementoProprio = `${branding.cnpj ? `, inscrita no CNPJ nº ${branding.cnpj}` : ""}${branding.endereco ? `, com endereço profissional à ${branding.endereco}` : ""}${branding.email ? `, e-mail ${branding.email}` : ""}`;

    const trechosCaput = temParceria
      ? [
          { text: "O presente negócio é feito sob a intermediação conjunta da " },
          proprio,
          { text: `${complementoProprio}, e de ` },
          { text: parceiros.map(x => qualificaIntermediario({ nome: String(x.nome).trim(), creci: (x.creci || "").trim(), documento: (x.documento || "").trim() })).join("; e de "), bold: true },
          { text: ", em regime de parceria, que receberão do(s) " },
        ]
      : [
          { text: "O presente negócio é feito sobre a intermediação da " },
          proprio,
          { text: `${complementoProprio}, que receberá do(s) ` },
        ];

    children.push(pMix([
      ...trechosCaput,
      { text: VND, bold: true },
      { text: ", a título de corretagem pelos serviços de intermediação ora prestados, " },
      { text: corretTexto, bold: true },
      { text: `, a ser pago ${momentoComissao.texto}${temParceria ? ", rateado na forma do Parágrafo Primeiro" : ""}.` },
    ]));

    // Rateio: quanto cabe a cada um, em percentual E em reais. Percentual
    // sozinho obriga o vendedor a fazer conta na hora de pagar, que é onde
    // aparece a divergência de centavos.
    if (temParceria) {
      const itens = rateio.map((r, i) => {
        const pct = String(r.percentual).replace(".", ",");
        return `(${romano(i + 1)}) ${qualificaIntermediario(r)}: ${pct}% (${Number.isInteger(r.percentual) ? numeroPorExtenso(r.percentual) : pct} por cento) da comissão, equivalente a ${fmtBRL(r.valor)}${r.pix ? `, com pagamento em PIX para a chave ${r.pix}` : ""}`;
      }).join("; ");
      children.push(...paragrafo("Parágrafo Primeiro", `A comissão prevista no caput será rateada entre os intermediários na seguinte proporção: ${itens}.`));
      // Sem isto, o vendedor que paga tudo à imobiliária líder acha que quitou —
      // e continua devendo a fatia do parceiro.
      children.push(...paragrafo("Parágrafo Segundo", "Cada intermediário receberá diretamente a sua parcela, e o pagamento realizado a qualquer deles, na respectiva proporção, exonera o(s) PROMITENTE(S) VENDEDOR(ES) apenas quanto àquela parcela, permanecendo devidas as demais."));
    }
    // Onde a comissão é paga. Antes o contrato só dizia "PIX para o CNPJ", o que
    // obriga o vendedor a pedir os dados por fora — e dado bancário passado por
    // WhatsApp na hora de pagar é exatamente o vetor do golpe do boleto/conta
    // trocada. Estando no contrato assinado, existe um dado conferível.
    const meiosPagamento = [];
    if (branding.pixChave) meiosPagamento.push(`PIX, chave ${branding.pixChave}`);
    else if (branding.cnpj) meiosPagamento.push(`PIX para o CNPJ ${branding.cnpj}`);
    if (branding.bancoNome && branding.bancoConta) {
      const tipoCt = branding.bancoTipoConta === "poupanca" ? "conta poupança" : "conta corrente";
      meiosPagamento.push(
        `transferência bancária para ${branding.bancoNome}`
        + (branding.bancoAgencia ? `, agência ${branding.bancoAgencia}` : "")
        + `, ${tipoCt} ${branding.bancoConta}`
        + `, de titularidade de ${branding.bancoTitular || branding.nome || "IMOBILIÁRIA"}`
      );
    }
    const ondePagar = meiosPagamento.length
      ? meiosPagamento.join(" ou ")
      : `PIX${branding.cnpj ? ` para o CNPJ ${branding.cnpj}` : ""}`;
    // Só ONDE pagar: o QUANDO ficou no caput. Antes os dois parágrafos
    // repetiam o prazo, e bastava um deles ficar desatualizado pro contrato se
    // contradizer sobre o próprio pagamento.
    // A parceria já consumiu Primeiro e Segundo; daqui pra frente o número é
    // contado, senão a cláusula teria dois "Parágrafo Primeiro".
    let nParCorret = temParceria ? 2 : 0;
    const proximoParCorret = (texto) => paragrafo(`Parágrafo ${ordinalParagrafo(++nParCorret)}`, texto);

    // Sem parceria, este parágrafo é quem diz onde pagar. Com parceria, o rateio
    // do Parágrafo Primeiro já traz a chave de cada um — repetir aqui só criaria
    // dois lugares para a mesma informação divergir.
    if (!temParceria) {
      children.push(...proximoParCorret(`O pagamento da comissão deverá ser realizado por meio de ${ondePagar}, em favor da ${(branding.nome || "imobiliária").toUpperCase()}.`));
    }
    children.push(...proximoParCorret("A comissão de corretagem será devida integralmente, ainda que ocorra rescisão ou arrependimento por qualquer das partes, desde que a negociação tenha sido concluída por intermédio da corretora, com aceite da proposta e formalização deste instrumento, sendo certo que a corretora já terá cumprido sua função de aproximação e intermediação."));

    if (multaComissao > 0 || jurosComissao > 0) {
      // Sem vírgula dentro de cada item: "juros ... , calculados pro rata die" +
      // " e correção monetária" faria a conjunção parecer ligada ao pro rata die.
      const encargos = [
        multaComissao > 0 ? `multa de ${pct(multaComissao)} sobre o valor devido` : null,
        jurosComissao > 0 ? `juros de mora de ${pct(jurosComissao)} ao mês calculados pro rata die` : null,
        "correção monetária do débito",
      ].filter(Boolean);
      const lista = encargos.length > 1 ? `${encargos.slice(0, -1).join(", ")} e ${encargos[encargos.length - 1]}` : encargos[0];
      children.push(...proximoParCorret(`O atraso no pagamento da comissão sujeitará o(s) devedor(es), independentemente de notificação ou interpelação, a ${lista}, contados do vencimento até o efetivo pagamento, sem prejuízo da cobrança extrajudicial ou judicial do débito, do protesto do título e da inscrição do(s) devedor(es) nos órgãos de proteção ao crédito, respondendo ainda pelas custas e honorários advocatícios.`));
    }

    // Sem isto, cobrar a comissão exige ação de conhecimento — anos até ter um
    // título. Com a obrigação declarada líquida, certa e exigível e o contrato
    // assinado por duas testemunhas, a cobrança vai direto para execução.
    children.push(...proximoParCorret("A obrigação de pagar a comissão ora ajustada é líquida, certa e exigível, valendo o presente instrumento, assinado pelas partes e por duas testemunhas, como título executivo extrajudicial, nos termos do art. 784, inciso III, do Código de Processo Civil."));

    children.push(clausula("SÉTIMA", "DA RESCISÃO"));
    children.push(pMix([
      { text: "O presente contrato de promessa de compra e venda é celebrado em caráter irrevogável e irretratável, sendo obrigatório e extensivo aos herdeiros e sucessores das partes, não sendo admitido arrependimento unilateral. Entretanto, em caso de rescisão por culpa do(s) " },
      { text: CMP, bold: true }, { text: ", este(s) perderá(ão), em favor do(s) " }, { text: VND, bold: true },
      { text: ", o equivalente a 20% (vinte por cento) do valor total do contrato, a título de cláusula penal compensatória, ficando ainda responsável(eis) pelo pagamento integral da comissão de corretagem devida à intermediadora, conforme previsto na Cláusula Sexta deste instrumento. Caso a rescisão ocorra por culpa do(s) " },
      { text: VND, bold: true }, { text: ", este(s) se obriga(m) a restituir ao(s) " }, { text: CMP, bold: true },
      { text: " todos os valores pagos, acrescidos de 20% (vinte por cento) sobre o valor total do imóvel, também a título de cláusula penal, ficando igualmente responsável(eis) pelo pagamento integral da comissão de corretagem devida à intermediadora, sem prejuízo de outras perdas e danos cabíveis." },
    ]));
    children.push(...paragrafo("Parágrafo Único", "A comissão de corretagem será devida integralmente pela parte que der causa à rescisão contratual, ainda que a negociação não se concretize, tendo em vista que a intermediadora já terá cumprido sua obrigação de aproximação e intermediação entre as partes."));

    children.push(clausula("OITAVA", "DAS DISPOSIÇÕES GERAIS"));
    children.push(p("O presente instrumento é pactuado em caráter irrevogável e irretratável, comprometendo-se as partes por si e seus sucessores, a qualquer tempo, a fazer valer as cláusulas ora avençadas, tomando-as sempre por boas, firmes e valiosas, em juízo ou fora dele."));

    children.push(clausula("NONA", "DA ASSINATURA DIGITAL"));
    children.push(p("As partes reconhecem e concordam que o presente contrato poderá ser assinado por meio de assinatura eletrônica ou digital, nos termos da Lei nº 14.063, de 23 de setembro de 2020, e da Medida Provisória nº 2.200-2, de 24 de agosto de 2001, que instituiu a Infraestrutura de Chaves Públicas Brasileira (ICP-Brasil), sendo considerada válida e eficaz para todos os fins de direito."));
    children.push(...paragrafo("Parágrafo Primeiro", "A assinatura eletrônica ou digital aposta neste instrumento tem a mesma validade jurídica de uma assinatura manuscrita, conforme legislação vigente, sendo apta a comprovar a autoria e a integridade do documento."));
    children.push(...paragrafo("Parágrafo Segundo", "As partes declaram que estão cientes de que a assinatura eletrônica ou digital vincula o signatário ao conteúdo integral deste contrato, produzindo todos os efeitos legais, inclusive para fins de constituição de título executivo extrajudicial."));
    children.push(...paragrafo("Parágrafo Terceiro", "Caso o presente contrato seja assinado digitalmente, as partes dispensam a assinatura física e a presença de testemunhas, sendo o registro eletrônico da assinatura suficiente para comprovar a manifestação de vontade das partes."));

    // Da NONA em diante o contrato tem cláusulas condicionais, então o número
    // passa a ser contado em vez de escrito à mão: com anuência E condições
    // especiais seriam três ordinais a acertar de cabeça a cada mudança.
    let nCV = 9;
    const proximaCV = (titulo) => clausula(ordinalClausula(++nCV), titulo);

    if (temAnuentes) {
      children.push(proximaCV("DA ANUÊNCIA"));
      children.push(pMix([
        { text: anuentes.length > 1 ? "Os " : "O(A) " },
        { text: anuentes.length > 1 ? "ANUENTES" : "ANUENTE", bold: true },
        { text: ` acima ${anuentes.length > 1 ? "qualificados declaram" : "qualificado(a) declara"} ter lido o presente instrumento e com ele ${anuentes.length > 1 ? "concordam" : "concorda"} integralmente, manifestando anuência expressa à promessa de compra e venda aqui ajustada, pelos fundamentos indicados a seguir.` },
      ]));

      // Um parágrafo por anuente, com o fundamento da anuência daquele caso.
      // Genérico serviria pra tudo e não provaria nada: o que dá segurança ao
      // comprador é o contrato dizer POR QUE a concordância daquela pessoa era
      // necessária e A QUE exatamente ela se refere.
      const FUNDAMENTOS = {
        conjuge: (nome, vinculo) => `${nome}, na qualidade de cônjuge${vinculo ? ` de ${vinculo}` : " do(a) PROMITENTE VENDEDOR(A)"}, outorga a vênia conjugal exigida pelo art. 1.647, inciso I, do Código Civil, sem a qual a alienação de bem imóvel é anulável, e concorda com a venda em todos os seus termos.`,
        companheiro: (nome, vinculo) => `${nome}, na qualidade de companheiro(a) em união estável${vinculo ? ` de ${vinculo}` : " do(a) PROMITENTE VENDEDOR(A)"}, anui expressamente com a alienação e declara nada ter a reclamar quanto a eventual direito de meação sobre o imóvel, decorrente da união estável, em relação ao presente negócio.`,
        usufrutuario: (nome, vinculo) => `${nome}, na qualidade de titular do direito real de usufruto incidente sobre o imóvel${vinculo ? ` (${vinculo})` : ""}, anui com a alienação e obriga-se a comparecer à lavratura da escritura pública para renunciar ao usufruto, viabilizando a extinção do gravame nos termos do art. 1.410, inciso I, do Código Civil.`,
        nu_proprietario: (nome, vinculo) => `${nome}, na qualidade de nu-proprietário(a) do imóvel${vinculo ? ` (${vinculo})` : ""}, anui com o negócio ora ajustado e obriga-se a comparecer ao ato de transmissão da propriedade.`,
        coproprietario: (nome, vinculo) => `${nome}, na qualidade de coproprietário(a) do imóvel${vinculo ? ` (${vinculo})` : ""}, anui com a venda e renuncia ao direito de preferência que lhe assegura o art. 504 do Código Civil quanto a esta alienação.`,
        herdeiro: (nome, vinculo) => `${nome}, na qualidade de herdeiro(a) e interessado(a) no acervo${vinculo ? ` (${vinculo})` : ""}, anui com a venda ora ajustada, ressalvada a necessidade de alvará judicial ou de conclusão da partilha para a lavratura da escritura definitiva, quando exigível.`,
        descendente: (nome, vinculo) => `${nome}, na qualidade de descendente${vinculo ? ` de ${vinculo}` : " do(a) PROMITENTE VENDEDOR(A)"}, consente expressamente com a venda ora ajustada, nos termos do art. 496 do Código Civil, que condiciona a validade da venda de ascendente a descendente ao consentimento dos demais descendentes e do cônjuge do alienante.`,
        credor_fiduciario: (nome, vinculo) => `${nome}, na qualidade de credor(a) fiduciário(a) titular da garantia que recai sobre o imóvel${vinculo ? ` (${vinculo})` : ""}, anui com a alienação e com a transferência ora ajustada, observadas as condições de quitação ou de assunção da dívida pactuadas com o(s) PROMISSÁRIO(S) COMPRADOR(ES).`,
      };

      anuentes.forEach((a, i) => {
        const nome = String(a.nome).trim();
        const vinculo = a.vinculo ? String(a.vinculo).trim() : "";
        const monta = FUNDAMENTOS[a.tipoAnuencia];
        const texto = monta
          ? monta(nome, vinculo)
          : `${nome}${vinculo ? `, ${vinculo}` : ""}, anui com o presente negócio nos seguintes termos: ${pontoFinal(a.descricao ? String(a.descricao).trim() : PLACEHOLDER)}`;
        children.push(...paragrafo(`Parágrafo ${ordinalParagrafo(i + 1)}`, texto));
      });

      // Limites da anuência. É o que o corretor precisa e quase nenhum modelo
      // traz: anuente não é vendedor. Sem dizer isso, a assinatura no mesmo
      // documento vira argumento pra cobrar dele as obrigações do preço.
      const nFinal = anuentes.length;
      children.push(...paragrafo(`Parágrafo ${ordinalParagrafo(nFinal + 1)}`, `A anuência ora prestada limita-se a manifestar concordância com a alienação do imóvel descrito na Cláusula Primeira e não implica assunção, pelo(s) ANUENTE(S), das obrigações patrimoniais atribuídas ao(s) PROMITENTE(S) VENDEDOR(ES) neste instrumento, notadamente as relativas ao recebimento e à devolução de valores.`));
      children.push(...paragrafo(`Parágrafo ${ordinalParagrafo(nFinal + 2)}`, `${nFinal > 1 ? "Os ANUENTES obrigam-se" : "O(A) ANUENTE obriga-se"} a comparecer à lavratura da escritura pública definitiva de compra e venda, ou a firmar os instrumentos necessários à transmissão da propriedade, para nela figurar na mesma qualidade em que ora ${nFinal > 1 ? "anuem" : "anui"}, sendo a presente anuência irretratável e irrevogável.`));
    }

    const temEspecialCV = d.clausulaEspecial && String(d.clausulaEspecial).trim();
    if (temEspecialCV) {
      children.push(proximaCV("DAS CONDIÇÕES ESPECIAIS"));
      children.push(p(String(d.clausulaEspecial).trim()));
    }
    children.push(proximaCV("DO FORO"));
    children.push(p(`As partes elegem o foro da Comarca de ${need(d.foro, branding.foroPadrao || "Natal/RN")} como o competente para dirimir qualquer lide decorrente deste contrato. E por estarem assim justos e contratados, assinam o presente em 3 (três) vias de igual teor e forma, juntamente com as testemunhas, para que surtam os seus jurídicos e legais efeitos.`, { keepNext: true }));

    children.push(...encerramentoClausulas("Contrato Particular de Promessa de Compra e Venda"));

    const sigPairs = [];
    const vList = (d.vendedores || []).map(v => ({ nome: v.nome, papel: ehSingularVend ? VND : "PROMITENTE VENDEDOR(A)" }));
    const cList = (d.compradores || []).map(c => ({ nome: c.nome, papel: ehSingularComp ? CMP : "PROMISSÁRIO(A) COMPRADOR(A)" }));
    const linhas = Math.max(vList.length, cList.length);
    for (let i = 0; i < linhas; i++) sigPairs.push([vList[i] || { nome: " ", papel: " " }, cList[i] || { nome: " ", papel: " " }]);

    // Anuente que não assina não anui. A cláusula pode estar impecável e o
    // negócio continua anulável se faltar a linha de assinatura dela.
    const ROTULO_ANUENTE = {
      conjuge: "ANUENTE — CÔNJUGE",
      companheiro: "ANUENTE — COMPANHEIRO(A)",
      usufrutuario: "ANUENTE — USUFRUTUÁRIO(A)",
      nu_proprietario: "ANUENTE — NU-PROPRIETÁRIO(A)",
      coproprietario: "ANUENTE — COPROPRIETÁRIO(A)",
      herdeiro: "ANUENTE — HERDEIRO(A)",
      descendente: "ANUENTE — DESCENDENTE",
      credor_fiduciario: "ANUENTE — CREDOR FIDUCIÁRIO",
    };
    for (let i = 0; i < anuentes.length; i += 2) {
      const par = [anuentes[i], anuentes[i + 1]].map(a => a
        ? { nome: a.nome, papel: ROTULO_ANUENTE[a.tipoAnuencia] || "ANUENTE" }
        : { nome: " ", papel: " " });
      sigPairs.push(par);
    }

    const matriculaRef = d.imovel && d.imovel.matricula ? `, matrícula nº ${d.imovel.matricula}` : "";
    children.push(...folhaAssinaturas({
      referencia: `Parte integrante do Contrato Particular de Promessa de Compra e Venda do imóvel situado em ${need(d.imovel && d.imovel.endereco)}${matriculaRef}, celebrado entre ${listaNomes(d.vendedores)}, na qualidade de ${VND}, e ${listaNomes(d.compradores)}, na qualidade de ${CMP}${anuentes.length ? `, com a anuência de ${listaNomes(anuentes)}` : ""}.`,
      data: d.data,
      pares: sigPairs,
      testemunhas: true,
    }));

    return children;
  }

  function buildLocacao(d) {
    const children = [];
    // Fiador e seguro fiança são tipos próprios de contrato, então a garantia
    // vem do tipo escolhido. Nos demais, vem do seletor de garantia do formulário.
    const ehFiador = d.tipo === "locacao_fiador";
    const ehSeguroFianca = d.tipo === "locacao_seguro_fianca";
    const ehSemGarantia = d.tipo === "locacao_sem_garantia";
    const garantiaTipo = ehFiador ? "fiador"
      : ehSeguroFianca ? "seguro_fianca"
      : ehSemGarantia ? "sem_garantia"
      // Contratos gerados antes de "sem garantia" virar tipo próprio gravaram
      // locacao_caucao + garantiaTipo "sem_garantia". Continuam saindo igual.
      : (d.garantiaTipo || "caucao");
    const GARANTIA_LABEL = { fiador: "FIADOR", caucao: "CAUÇÃO", seguro_fianca: "SEGURO FIANÇA", titulo_capitalizacao: "TÍTULO DE CAPITALIZAÇÃO", personalizada: "GARANTIA ESPECÍFICA", sem_garantia: "SEM GARANTIA" };
    const semGarantia = garantiaTipo === "sem_garantia";
    const admin = d.administracao || {};
    const temAdmin = !!admin.ativa;
    const usoImovel = d.uso === "comercial" ? "comercial" : "residencial";
    const usoLabel = usoImovel === "comercial" ? "COMERCIAL" : "RESIDENCIAL";

    let clausulaN = 0;
    const cl = (titulo) => clausula(ordinalClausula(++clausulaN), titulo);

    const ec = d.entregaChaves || {};
    let textoChaves;
    if (ec.modo === "na_assinatura") textoChaves = `A entrega das chaves e início da posse pelo(a) LOCATÁRIO(A) dar-se-á na data de assinatura deste instrumento${ec.data ? ` (${fmtDataCurta(ec.data)})` : ""}, mediante assinatura de termo descritivo do estado do imóvel no ato da entrega.`;
    else if (ec.modo === "data_fixa") textoChaves = `A entrega das chaves e início da posse pelo(a) LOCATÁRIO(A) dar-se-á em ${fmtDataCurta(ec.data) || PLACEHOLDER}, mediante assinatura de termo descritivo do estado do imóvel no ato da entrega.`;
    else textoChaves = `A entrega das chaves dar-se-á conforme: ${ec.descricao || PLACEHOLDER}.`;

    // "GARANTIA: SEM GARANTIA" no cabeçalho ficaria trôpego; sem garantia o
    // subtítulo diz só isso.
    children.push(...tituloContrato(`CONTRATO DE LOCAÇÃO ${usoLabel}`, semGarantia ? "(SEM GARANTIA)" : `(GARANTIA: ${GARANTIA_LABEL[garantiaTipo] || "CAUÇÃO"})`, { linha2Color: MUTED, linha2Size: 22 }));

    // ===== QUADRO-RESUMO (primeira página) =====
    const gar = d.garantia || {};
    const al = d.aluguel || {};
    const vig = d.vigencia || {};

    const vigenciaTxt = (vig.inicio || vig.fim)
      ? `${fmtDataCurta(vig.inicio)} a ${fmtDataCurta(vig.fim)}${vig.meses ? ` (${vig.meses} meses)` : ""}`
      : (vig.meses ? `${vig.meses} meses` : "");

    const garantiaResumo = {
      caucao: gar.valor ? `Caução de ${fmtBRL(gar.valor)}` : "Caução",
      fiador: (d.fiadores || []).length
        ? `Fiador(a): ${(d.fiadores || []).map(f => f.nome).filter(Boolean).join("; ")}`
        : "Fiador(a)",
      seguro_fianca: `Seguro Fiança${gar.seguradora ? ` — ${gar.seguradora}` : ""}${gar.apolice ? `, apólice nº ${gar.apolice}` : ""}`,
      titulo_capitalizacao: `Título de Capitalização${gar.instituicao ? ` — ${gar.instituicao}` : ""}${gar.numero ? `, nº ${gar.numero}` : ""}`,
      personalizada: "Conforme cláusula de garantia deste contrato",
      // Quem bate o olho no quadro-resumo precisa ver a ausência escrita, não
      // uma linha em branco que parece campo esquecido.
      sem_garantia: gar.aluguelAntecipado
        ? "Sem garantia — aluguel pago antecipadamente (art. 42)"
        : "Sem garantia (art. 37 da Lei 8.245/91)",
    }[garantiaTipo] || "Caução";

    // Encargos mensais cobrados junto com o aluguel, mas que NÃO o integram:
    // condomínio e IPTU têm reajuste próprio, por isso ficam discriminados.
    const condominio = Number(al.condominio || 0);
    const iptu = Number(al.iptu || 0);
    // Taxa mensal total = aluguel + condomínio + IPTU + taxa do seguro fiança.
    const taxaSeguro = garantiaTipo === "seguro_fianca" ? Number(gar.taxaMensal || 0) : 0;
    const totalMensal = Number(al.valor || 0) + condominio + iptu + taxaSeguro;

    const chavesResumo = ec.data
      ? fmtDataCurta(ec.data)
      : (ec.modo === "na_assinatura" ? "Na assinatura deste contrato" : "");

    const resumo = blocoResumo([
      ["Endereço do imóvel", need(d.imovel && d.imovel.endereco)],
      ["Vigência do contrato", vigenciaTxt],
      ["Aluguel mensal", al.valor ? fmtBRL(al.valor) : ""],
      ["Condomínio (mensal)", condominio ? fmtBRL(condominio) : ""],
      ["IPTU (mensal)", iptu ? fmtBRL(iptu) : ""],
      [`Taxa de seguro fiança${gar.seguradora ? ` (${gar.seguradora})` : ""}`, taxaSeguro ? fmtBRL(taxaSeguro) : ""],
      ["Taxa mensal (aluguel + taxas)", totalMensal ? fmtBRL(totalMensal) : ""],
      ["Vencimento", al.diaVencimento ? `Todo dia ${al.diaVencimento} de cada mês` : ""],
      ["1º aluguel (data)", al.primeiroVencimento ? fmtDataCurta(al.primeiroVencimento) : ""],
      ["Garantia locatícia", garantiaResumo],
      ["Cosern, Água e Gás", (d.imovel && d.imovel.concessionarias) || ""],
      ["Data de entrega das chaves", chavesResumo],
      ["Administradora", temAdmin ? (branding.nome || "") : ""],
    ]);
    if (resumo) {
      children.push(resumo);
      children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: " ", size: 12 })] }));
    }

    children.push(p("Pelo presente instrumento particular de locação, de um lado:", { after: 160 }));
    children.push(blocoParte("LOCADOR(A)", d.locadores || d.vendedores || []));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E de outro —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
    children.push(blocoParte("LOCATÁRIO(A)", d.locatarios || d.compradores || []));
    if (ehFiador && d.fiadores && d.fiadores.length > 0) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E ainda —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
      children.push(blocoParte("FIADOR(A)", d.fiadores));
    }
    if (temAdmin) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E ainda —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
      children.push(wrapBox([
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "ADMINISTRADORA", bold: true, font: FONT_TITULO, size: 18, color: GREEN })] }),
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: (branding.nome || "IMOBILIÁRIA").toUpperCase(), bold: true, font: FONT_TITULO, size: 22, color: DARK })] }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED, spacing: { after: 0, line: 280 },
          children: [new TextRun({
            text: `Pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${need(branding.cnpj)}, com sede em ${need(branding.endereco, branding.cidade || "Natal/RN")}${branding.creci ? `, CRECI ${branding.creci}` : ""}${branding.email ? `, e-mail ${branding.email}` : ""}, neste ato responsável pela administração do imóvel objeto da presente locação.`,
            font: FONT_CORPO, size: 20, color: DARK,
          })],
        }),
      ]));
    }

    children.push(p("As partes acima qualificadas têm entre si justo e contratado o presente instrumento, que se regerá pelas cláusulas e condições a seguir estipuladas, bem como pelas disposições da Lei nº 8.245/91 e alterações posteriores.", { before: 160 }));

    // ===== DO OBJETO E DO PRAZO =====
    children.push(cl("DO OBJETO E DO PRAZO"));
    children.push(pMix([
      { text: "O(a) " }, { text: "LOCADOR(A)", bold: true }, { text: " dá em locação ao(à) " }, { text: "LOCATÁRIO(A)", bold: true },
      { text: ` o imóvel localizado na ${need(d.imovel && d.imovel.endereco)}${d.imovel && d.imovel.caracteristicas ? `, ${d.imovel.caracteristicas}` : ""}, pelo prazo de ${need(d.vigencia && d.vigencia.meses, "30")} meses, com início em ${fmtDataCurta((d.vigencia||{}).inicio)} e término em ${fmtDataCurta((d.vigencia||{}).fim)}, destinando-se EXCLUSIVAMENTE à finalidade ${usoImovel}.` },
    ]));
    children.push(...paragrafo("Parágrafo Primeiro — Entrega das Chaves", textoChaves));
    children.push(...paragrafo("Parágrafo Segundo — Prorrogação", "Findo o prazo estipulado no caput desta cláusula, caso o(a) LOCATÁRIO(A) continue na posse do imóvel sem oposição do(a) LOCADOR(A), a locação será prorrogada por prazo indeterminado, mantidas as demais cláusulas e condições deste contrato, podendo qualquer das partes denunciá-la mediante notificação prévia de 30 (trinta) dias."));
    children.push(...paragrafo("Parágrafo Terceiro — Devolução Antecipada", "Na hipótese de devolução do imóvel antes do término do prazo pactuado, o(a) LOCATÁRIO(A) pagará a multa prevista na cláusula de Multa e Execução deste contrato, proporcional ao tempo que faltar para o vencimento do contrato."));

    // ===== DO ALUGUEL E FORMA DE PAGAMENTO =====
    children.push(cl("DO ALUGUEL E FORMA DE PAGAMENTO"));
    const aluguelExtenso = (d.aluguel || {}).extenso ? ` (${d.aluguel.extenso})` : "";
    if (temAdmin) {
      children.push(pMix([
        { text: "O valor mensal do aluguel é de " },
        { text: `${fmtBRL((d.aluguel||{}).valor)}${aluguelExtenso}`, bold: true },
        { text: `, com vencimento todo dia ${need((d.aluguel||{}).diaVencimento, "10")} de cada mês, devendo ser pago apenas e exclusivamente por boleto bancário emitido pela administradora ` },
        { text: `${(branding.nome || "IMOBILIÁRIA").toUpperCase()}`, bold: true },
        { text: ", não sendo aceita nenhuma outra forma de pagamento." },
      ]));
    } else {
      const db = (d.pagamento || {}).dadosBancarios || {};
      children.push(pMix([
        { text: "O valor mensal do aluguel é de " },
        { text: `${fmtBRL((d.aluguel||{}).valor)}${aluguelExtenso}`, bold: true },
        { text: `, com vencimento todo dia ${need((d.aluguel||{}).diaVencimento, "10")} de cada mês, a ser pago pelo(a) LOCATÁRIO(A) diretamente ao(à) LOCADOR(A), via PIX ou transferência bancária, conforme dados a seguir:` },
      ]));
      children.push(blocoCaixa([
        ["Titular: ", need(db.titular)],
        ["Banco: ", need(db.banco)],
        ["Agência: ", need(db.agencia)],
        ["Conta: ", need(db.conta)],
        ["Chave PIX: ", need(db.pix)],
      ]));
    }
    children.push(...paragrafo("Parágrafo Primeiro — Mora", "Em caso de atraso no pagamento do aluguel, o valor será acrescido de juros de mora de 1% (um por cento) ao mês e multa de 10% (dez por cento), calculados sobre o valor nominal do(s) aluguel(éis) em atraso, sem prejuízo das demais sanções previstas neste contrato."));
    children.push(...paragrafo("Parágrafo Segundo — Cobrança", "Decorrido o prazo de 30 (trinta) dias do vencimento sem pagamento, o débito poderá ser encaminhado para cobrança amigável e/ou judicial, ficando facultado à parte credora efetuar os respectivos registros junto aos órgãos de proteção ao crédito (SPC/Serasa), além de outras sanções previstas neste instrumento, inclusive ação de despejo por falta de pagamento."));

    // ===== DA GARANTIA =====
    // Locação sem garantia é válida: o art. 37 da Lei 8.245/91 faculta ao
    // locador exigir UMA das modalidades, não obriga. O que muda é o que a lei
    // dá em troca — e é justamente isso que precisa estar escrito, senão o
    // contrato só registra a ausência e não a compensação.
    children.push(cl(semGarantia ? "DA AUSÊNCIA DE GARANTIA" : "DA GARANTIA"));
    const g = d.garantia || {};
    if (semGarantia) {
      children.push(p("As partes ajustam expressamente que a presente locação NÃO conta com nenhuma das modalidades de garantia previstas no art. 37 da Lei nº 8.245/91, faculdade que a lei confere ao(à) LOCADOR(A) e da qual este(a) abre mão neste instrumento, ciente o(a) LOCATÁRIO(A) de que tal ausência não afasta nenhuma de suas obrigações contratuais."));

      // Art. 42: sem garantia, o locador PODE exigir o aluguel antecipado. É a
      // contrapartida que a lei dá, e a única forma de o locador reduzir o risco
      // que aceitou. Opcional porque nem todo negócio é fechado assim.
      if (g.aluguelAntecipado) {
        children.push(...paragrafo("Parágrafo Primeiro — Pagamento antecipado", `Em razão da ausência de garantia, e nos termos do art. 42 da Lei nº 8.245/91, o aluguel e os encargos serão pagos ANTECIPADAMENTE, até o 6º (sexto) dia útil do mês a vencer, prevalecendo esta regra sobre o dia de vencimento indicado na cláusula do aluguel.`));
      }

      // Sem garantia o locador não tem caução de onde descontar, mas ganha o
      // despejo liminar do art. 59, §1º, IX. Registrar isso no contrato deixa a
      // consequência do atraso clara para os dois lados antes de acontecer.
      children.push(...paragrafo(`Parágrafo ${g.aluguelAntecipado ? "Segundo" : "Primeiro"} — Consequência do inadimplemento`, "As partes declaram ciência de que, por estar a locação desprovida de qualquer das garantias do art. 37 da Lei nº 8.245/91, a falta de pagamento do aluguel e encargos no vencimento autoriza o(a) LOCADOR(A) a requerer a desocupação liminar do imóvel, nos termos do art. 59, § 1º, inciso IX, da mesma Lei, sem prejuízo da cobrança dos valores devidos."));
      children.push(...paragrafo(`Parágrafo ${g.aluguelAntecipado ? "Terceiro" : "Segundo"} — Responsabilidade`, "O(A) LOCATÁRIO(A) responde integralmente, com seu patrimônio, pelos aluguéis, encargos, multas e danos ao imóvel apurados na vistoria de saída, não havendo caução, fiador ou seguro de onde tais valores possam ser deduzidos."));
    } else if (garantiaTipo === "fiador") {
      children.push(p("Como garantia da presente locação, o(a) FIADOR(A) acima qualificado(a) se obriga solidariamente com o(a) LOCATÁRIO(A) por todas as obrigações contratuais, até a efetiva entrega das chaves do imóvel."));
    } else if (garantiaTipo === "seguro_fianca") {
      // Cada seguradora tem redação própria. Quando o corretor cola a cláusula
      // da apólice contratada, ela substitui o texto genérico — é a que vale.
      if (g.clausula && String(g.clausula).trim()) {
        children.push(p(String(g.clausula).trim()));
      } else {
        children.push(p(`Como garantia da presente locação, é contratado Seguro Fiança junto à seguradora ${need(g.seguradora)}, apólice nº ${need(g.apolice)}, que assegura o cumprimento das obrigações do(a) LOCATÁRIO(A) nos termos e limites da respectiva apólice, cuja cópia integra o presente instrumento como se nele estivesse transcrita.`));
      }
    } else if (garantiaTipo === "titulo_capitalizacao") {
      children.push(p(`Como garantia da presente locação, o(a) LOCATÁRIO(A) apresenta Título de Capitalização nº ${need(g.numero)}, emitido por ${need(g.instituicao)}, no valor de ${fmtBRL(g.valor)}, o qual permanecerá caucionado em favor do(a) LOCADOR(A) durante toda a vigência do presente contrato, podendo ser resgatado em caso de inadimplemento das obrigações locatícias.`));
    } else if (garantiaTipo === "personalizada") {
      children.push(p(String(g.descricao || PLACEHOLDER)));
    } else {
      const depositarioTxt = temAdmin ? "indicada pela administradora" : "indicada pelo(a) LOCADOR(A)";
      children.push(pMix([
        { text: "Em garantia das obrigações assumidas neste instrumento, o(a) LOCATÁRIO(A) depositará, em até 1 (um) dia útil contado da assinatura deste contrato, a quantia de " },
        { text: fmtBRL(g.valor), bold: true },
        { text: `, a título de caução locatícia, em caderneta de poupança ${depositarioTxt}, nos termos do art. 38, §2º, da Lei nº 8.245/91.` },
      ]));
      children.push(...paragrafo("Parágrafo Primeiro — Destinação", "A caução servirá para garantir o pagamento de eventuais débitos de aluguel, encargos, danos ao imóvel ou quaisquer outras obrigações decorrentes deste contrato que não sejam cumpridas pelo(a) LOCATÁRIO(A) ao final da locação."));
      children.push(...paragrafo("Parágrafo Segundo — Devolução", "Findo o contrato e devolvido o imóvel nas condições contratualmente pactuadas, com apresentação dos comprovantes de quitação das contas de consumo e demais encargos, a caução será restituída ao(à) LOCATÁRIO(A) no prazo de até 30 (trinta) dias, acrescida da correção monetária e dos rendimentos auferidos com o depósito em caderneta de poupança, deduzidos eventuais débitos e prejuízos apurados na vistoria de saída."));
      children.push(...paragrafo("Parágrafo Terceiro — Insuficiência", "Caso o valor da caução, mesmo corrigido, seja insuficiente para cobrir os débitos ou danos verificados, o(a) LOCATÁRIO(A) responderá pela diferença, podendo o(a) LOCADOR(A) exigi-la por todos os meios legais, inclusive cobrança extrajudicial e/ou ação judicial cabível."));
    }

    // ===== DO REAJUSTE =====
    children.push(cl("DO REAJUSTE"));
    children.push(p(`O aluguel será reajustado anualmente, na data de aniversário deste contrato, pelo índice ${need((d.aluguel||{}).indice, "IGP-M")}, ou, na falta deste, pelo índice que vier a substituí-lo oficialmente.`));

    // ===== DAS COMUNICAÇÕES =====
    children.push(cl("DAS COMUNICAÇÕES"));
    children.push(p("Todas as citações, intimações, notificações e avisos decorrentes deste contrato serão feitos por escrito, por meio de correspondência com aviso de recebimento (AR), ou por meio eletrônico (e-mail, WhatsApp ou aplicativo de mensagens) com confirmação de leitura, nos endereços e contatos indicados no preâmbulo deste instrumento."));
    children.push(...paragrafo("Parágrafo Único", "As partes obrigam-se a comunicar, por escrito, qualquer alteração de endereço ou contato, sob pena de serem consideradas válidas as comunicações enviadas ao último endereço informado."));

    // ===== DOS ENCARGOS E DESPESAS =====
    children.push(cl("DOS ENCARGOS E DESPESAS"));
    children.push(p("Além do aluguel, competem ao(à) LOCATÁRIO(A) os seguintes encargos mensais: consumos de energia elétrica, água, gás (se houver) e taxas de esgoto; taxas condominiais e IPTU porventura aplicáveis ao imóvel; e todas as multas pecuniárias provenientes do não pagamento ou do atraso no pagamento de quantias sob sua responsabilidade, bem como emolumentos devidos a órgãos administrativos."));

    const encargosParagrafos = [];

    // Valores de condomínio e IPTU, quando informados. Ficam discriminados
    // porque não integram o aluguel e têm reajuste próprio — o do aluguel
    // segue o índice contratual; o do condomínio, a assembleia; o do IPTU,
    // o município.
    if (condominio || iptu) {
      const itens = [];
      if (condominio) itens.push(`condomínio, no valor mensal de ${fmtBRL(condominio)}`);
      if (iptu) itens.push(`IPTU, no valor mensal de ${fmtBRL(iptu)}`);
      encargosParagrafos.push({
        titulo: "Condomínio e IPTU",
        texto: `Na data de assinatura deste instrumento, incidem sobre o imóvel os seguintes encargos de responsabilidade do(a) LOCATÁRIO(A): ${itens.join("; ")}. Tais valores não integram o aluguel e serão pagos juntamente com ele, totalizando ${fmtBRL(totalMensal)} por mês na presente data, sujeitos a alteração independentemente do reajuste do aluguel, conforme deliberação da assembleia condominial e lançamento do Município, respectivamente.`,
      });
      if (condominio) {
        encargosParagrafos.push({
          titulo: "Despesas Condominiais Extraordinárias",
          texto: "Cabem ao(à) LOCATÁRIO(A) apenas as despesas condominiais ordinárias, necessárias à administração e à manutenção do condomínio. As despesas extraordinárias — tais como obras de reforma que interessem à estrutura do prédio, pintura de fachadas, instalação de equipamentos de segurança, constituição de fundo de reserva e indenizações trabalhistas anteriores ao início da locação — permanecem a cargo do(a) LOCADOR(A), nos termos do art. 22, parágrafo único, da Lei nº 8.245/91.",
        });
      }
    }

    const seg = d.seguroIncendio || {};
    if (seg.incluir) {
      const textoSeguro = seg.responsavel === "locador"
        ? "O(A) LOCADOR(A) obriga-se a segurar o imóvel locado contra os riscos de fogo em companhia de absoluta idoneidade, pelo valor mínimo equivalente a 100 (cem) vezes o valor do aluguel, mantendo-o segurado até o final do prazo contratual, nos termos do art. 22, VIII, da Lei nº 8.245/91."
        : "As partes acordam expressamente, no exercício da faculdade prevista no art. 22, VIII, da Lei nº 8.245/91 (que admite disposição em contrário à regra supletiva ali estabelecida), que o custeio do seguro complementar contra incêndio que incidir sobre o imóvel caberá ao(à) LOCATÁRIO(A), que deverá mantê-lo vigente, em companhia de absoluta idoneidade, pelo valor mínimo equivalente a 100 (cem) vezes o valor do aluguel, até o final do prazo contratual.";
      encargosParagrafos.push({ titulo: "Seguro Incêndio", texto: textoSeguro });
    }
    encargosParagrafos.push({ titulo: "Concessionárias", texto: "Após a assinatura deste contrato, o(a) LOCATÁRIO(A) deverá providenciar a transferência da titularidade dos serviços de energia elétrica e água para o seu nome, no prazo máximo de 30 (trinta) dias após a entrega das chaves, eximindo-se o(a) LOCADOR(A) de qualquer responsabilidade sobre anormalidades nas contas após esse prazo." });
    encargosParagrafos.push({ titulo: "Reembolso", texto: "Na hipótese de qualquer débito de consumo, condomínio ou tributo não pago pelo(a) LOCATÁRIO(A) no prazo devido vir a ser cobrado do(a) LOCADOR(A), será este reembolsado pelo(a) LOCATÁRIO(A), acrescido de multa de 10% (dez por cento), juros de 1% (um por cento) ao mês e correção monetária." });
    encargosParagrafos.push({ titulo: "Honorários e Custas Processuais", texto: "Caso seja necessária a cobrança judicial ou extrajudicial de qualquer valor devido em razão deste contrato, correrão por conta da parte inadimplente todas as despesas daí decorrentes, incluindo custas processuais, emolumentos cartorários e honorários advocatícios, estes fixados em 20% (vinte por cento) sobre o valor do débito, sem prejuízo dos honorários de sucumbência que vierem a ser arbitrados judicialmente." });

    encargosParagrafos.forEach((item, i) => {
      children.push(...paragrafo(`Parágrafo ${ordinalParagrafo(i + 1)} — ${item.titulo}`, item.texto));
    });

    // ===== DA DEVOLUÇÃO DO IMÓVEL =====
    children.push(cl("DA DEVOLUÇÃO DO IMÓVEL"));
    children.push(p("No ato da devolução do imóvel, o(a) LOCATÁRIO(A) deverá apresentar todos os comprovantes de pagamento das contas de sua responsabilidade até a data da entrega das chaves, bem como entregar o imóvel no mesmo estado de conservação em que foi recebido, ressalvado o desgaste natural pelo uso regular."));
    children.push(...paragrafo("Parágrafo Único", "O cumprimento das obrigações contratuais na devolução será verificado na vistoria de saída, prevista na cláusula de Vistoria e Estado do Imóvel deste contrato, podendo eventuais avarias, pendências ou débitos apurados ser deduzidos da garantia prestada."));

    // ===== DA DESTINAÇÃO E CESSÃO =====
    children.push(cl("DA DESTINAÇÃO E CESSÃO"));
    children.push(p(`O imóvel objeto do presente contrato destina-se exclusivamente para fim ${usoImovel}, sendo expressamente proibido ao(à) LOCATÁRIO(A) sublocar, ceder ou emprestar o imóvel a terceiros, no todo ou em parte, gratuita ou onerosamente, sem prévia anuência por escrito do(a) LOCADOR(A).`));
    children.push(...paragrafo("Parágrafo Único", "A ocupação do imóvel por pessoa não referida neste contrato caracteriza grave infração contratual, ensejando a rescisão da locação a qualquer tempo, sem prejuízo da aplicação da multa prevista na cláusula de Multa e Execução deste contrato."));

    // ===== DA ALIENAÇÃO =====
    children.push(cl("DA ALIENAÇÃO"));
    children.push(p("O(A) LOCADOR(A) poderá, a qualquer tempo, alienar o imóvel locado, ficando assegurado ao(à) LOCATÁRIO(A) o direito de preferência na aquisição, nas mesmas condições oferecidas a terceiros, devendo manifestar-se em até 30 (trinta) dias contados da notificação da venda, nos termos do art. 27 da Lei nº 8.245/91."));
    children.push(...paragrafo("Parágrafo Único — Vigência em Caso de Alienação", "Em caso de alienação do imóvel na vigência deste contrato, fica assegurado ao(à) LOCATÁRIO(A) o direito de continuar na posse do imóvel pelo prazo remanescente da locação, desde que este contrato esteja devidamente registrado ou averbado junto à matrícula do imóvel, nos termos do art. 8º da Lei nº 8.245/91. Não havendo tal registro, o adquirente poderá denunciar a locação, concedido o prazo de 90 (noventa) dias para desocupação, contado do registro da venda ou do compromisso, salvo se as partes convencionarem prazo diverso."));

    // ===== DAS TOLERÂNCIAS =====
    children.push(cl("DAS TOLERÂNCIAS"));
    children.push(p("Quaisquer tolerâncias ou concessões entre as partes, quando não manifestadas por escrito, não constituirão precedentes invocáveis e não terão a virtude de alterar as obrigações contratuais."));

    // ===== DA EXCLUSÃO DE RESPONSABILIDADE =====
    children.push(cl("DA EXCLUSÃO DE RESPONSABILIDADE"));
    children.push(p("O(A) LOCADOR(A) não responderá, em nenhum caso, por quaisquer danos que venha a sofrer o(a) LOCATÁRIO(A) em razão de derramamento de líquido, água de rompimento de canos, de chuvas, de abertura de torneiras, defeitos de esgotos ou fossas, incêndios, arrombamentos, roubos, furtos, casos fortuitos ou de força maior."));

    // ===== DA RETENÇÃO =====
    children.push(cl("DA RETENÇÃO"));
    children.push(p("O(A) LOCATÁRIO(A) não terá direito de reter o pagamento do aluguel ou de qualquer outra quantia devida ao(à) LOCADOR(A), sob a alegação de não terem sido atendidas exigências porventura solicitadas."));

    // ===== DA VISTORIA E ESTADO DO IMÓVEL =====
    children.push(cl("DA VISTORIA E ESTADO DO IMÓVEL"));
    children.push(p("Antes da entrega das chaves, será realizada vistoria detalhada do imóvel, com elaboração de laudo descritivo do estado de conservação — podendo ser instruído com fotografias e/ou vídeo —, que será assinado pelas partes e passará a integrar este contrato como anexo. A partir da entrega, o(a) LOCATÁRIO(A) deverá zelar pelo imóvel e realizar, por sua conta, as reparações decorrentes do uso normal, restituindo-o ao final da locação sem direito a retenção ou indenização por benfeitorias realizadas com ou sem autorização."));
    children.push(...paragrafo("Parágrafo Primeiro — Vistoria de Saída", "Ao término da locação, será realizada nova vistoria no prazo máximo de 5 (cinco) dias úteis contados da devolução das chaves, comparando-se o estado do imóvel ao laudo de entrada. Eventuais avarias, danos ou faltas não decorrentes do desgaste natural pelo uso regular serão descritos em laudo de saída, apurando-se o respectivo custo de reparo para fins de dedução da garantia prestada, conforme cláusula própria deste contrato."));
    children.push(...paragrafo("Parágrafo Segundo — Ausência de uma das Partes", "Caso, após notificada com antecedência mínima de 48 (quarenta e oito) horas, uma das partes não compareça à vistoria de entrada ou de saída, esta poderá ser realizada unilateralmente pela parte presente, acompanhada de 2 (duas) testemunhas, produzindo o laudo resultante efeitos válidos também em relação à parte ausente."));
    children.push(...paragrafo("Parágrafo Terceiro", "É assegurado ao(à) LOCADOR(A) o direito de vistoriar o imóvel durante a vigência da locação, mediante aviso prévio ao(à) LOCATÁRIO(A) com antecedência mínima de 24 (vinte e quatro) horas, observado o disposto no art. 23, inciso IX, da Lei nº 8.245/91."));

    // ===== DA MULTA E EXECUÇÃO =====
    children.push(cl("DA MULTA E EXECUÇÃO"));
    children.push(p("Fica estipulada multa equivalente a 3 (três) aluguéis vigentes na data da infração, devida pela parte que infringir qualquer das cláusulas contratuais dando causa à rescisão, sempre proporcional ao período de cumprimento do contrato, nos termos do art. 4º da Lei nº 8.245/91, com as alterações da Lei nº 12.112/09, ressalvado à parte inocente o direito de considerar rescindida a locação independentemente de aviso ou notificação judicial ou extrajudicial."));
    children.push(...paragrafo("Parágrafo Único", "O pagamento da multa não eximirá a parte infratora de reparar os danos que porventura causar, nem da responsabilidade pelos valores devidos a título de aluguel e encargos. Tudo quanto for devido em razão deste contrato será cobrado por via executiva ou ação apropriada, respondendo a parte devedora, além do principal e multa, pelas despesas judiciais, extrajudiciais e honorários advocatícios."));

    // ===== DA ASSINATURA DIGITAL =====
    children.push(cl("DA ASSINATURA DIGITAL"));
    children.push(p("Na hipótese de este contrato ser assinado eletronicamente, as partes declaram e concordam com essa modalidade de assinatura, reconhecendo sua plena validade jurídica nos termos dos arts. 107, 219 e 220 do Código Civil, da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020, e confirmam que o instrumento representa a integralidade dos termos entre elas acordados."));

    // ===== CONDIÇÕES ESPECIAIS (opcional) =====
    const temEspecialLoc = d.clausulaEspecial && String(d.clausulaEspecial).trim();
    if (temEspecialLoc) {
      children.push(cl("DAS CONDIÇÕES ESPECIAIS"));
      children.push(p(String(d.clausulaEspecial).trim()));
    }

    // ===== DO FORO =====
    children.push(cl("DO FORO"));
    children.push(p(`As partes elegem o foro da Comarca de ${need(d.foro, branding.foroPadrao || "Natal/RN")} como o competente para dirimir qualquer lide decorrente deste contrato, com exclusão de qualquer outro, por mais privilegiado que seja.`, { keepNext: true }));

    children.push(...encerramentoClausulas(`Contrato de Locação ${usoImovel === "comercial" ? "Comercial" : "Residencial"}`));

    const sigPairs = [];
    const lod = (d.locadores || d.vendedores || []).map(v => ({ nome: v.nome, papel: "LOCADOR(A)" }));
    const lat = (d.locatarios || d.compradores || []).map(v => ({ nome: v.nome, papel: "LOCATÁRIO(A)" }));
    const linhas = Math.max(lod.length, lat.length);
    for (let i = 0; i < linhas; i++) sigPairs.push([lod[i] || { nome: " ", papel: " " }, lat[i] || { nome: " ", papel: " " }]);
    if (ehFiador && d.fiadores) d.fiadores.forEach(f => {
      sigPairs.push([{ nome: f.nome, papel: "FIADOR(A)" }, { nome: " ", papel: " " }]);
      if (f.conjugeNome) sigPairs.push([{ nome: f.conjugeNome, papel: "CÔNJUGE DO FIADOR (outorga)" }, { nome: " ", papel: " " }]);
    });
    if (temAdmin) sigPairs.push([{ nome: (branding.nome || "IMOBILIÁRIA").toUpperCase(), papel: "ADMINISTRADORA" }, { nome: " ", papel: " " }]);

    const fiadoresRef = ehFiador && (d.fiadores || []).length ? `, tendo como fiador(es) ${listaNomes(d.fiadores)}` : "";
    children.push(...folhaAssinaturas({
      referencia: `Parte integrante do Contrato de Locação ${usoImovel === "comercial" ? "Comercial" : "Residencial"} do imóvel situado em ${need(d.imovel && d.imovel.endereco)}, celebrado entre ${listaNomes(d.locadores || d.vendedores)}, na qualidade de LOCADOR(A), e ${listaNomes(d.locatarios || d.compradores)}, na qualidade de LOCATÁRIO(A)${fiadoresRef}.`,
      data: d.data,
      pares: sigPairs,
      testemunhas: true,
    }));

    return children;
  }

  // ===================================================================
  // DOCUMENTOS AUXILIARES DO DIA A DIA DO CORRETOR
  // (fichas, propostas e autorizações — mais curtos que os contratos)
  // ===================================================================

  function secaoTitulo(txt) {
    return new Paragraph({
      keepNext: true,
      spacing: { before: 300, after: 130, line: 300 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: GREEN, space: 4 } },
      children: [new TextRun({ text: txt, bold: true, font: FONT_TITULO, size: 19, color: DARK })],
    });
  }

  function localData(d) {
    return new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 300, after: 320 },
      children: [new TextRun({ text: `${branding.cidade || "Natal"}, ${fmtData(d.data)}`, font: FONT_CORPO, size: 20, color: DARK })],
    });
  }

  const IMOB = () => (branding.nome || "IMOBILIÁRIA").toUpperCase();
  const IMOB_QUALIF = () => `${IMOB()}${branding.creci ? `, CRECI ${branding.creci}` : ""}${branding.cnpj ? `, CNPJ ${branding.cnpj}` : ""}`;

  // ---- 1. FICHA DE LOCAÇÃO (cadastro do pretendente a locatário) ----
  function buildFichaLocacao(d) {
    const children = [];
    const pr = d.pretendente || {};
    const prof = d.profissional || {};
    const info = d.info || {};
    const im = d.imovel || {};

    children.push(...tituloContrato("FICHA DE LOCAÇÃO", "Cadastro do pretendente a locatário", { linha2Color: MUTED, linha2Size: 22 }));

    children.push(secaoTitulo("IMÓVEL PRETENDIDO"));
    children.push(blocoResumo([
      ["Endereço", im.endereco],
      ["Tipo do imóvel", im.tipo],
      ["Aluguel pretendido", im.valorAluguel ? fmtBRL(im.valorAluguel) : ""],
    ], { manterVazios: true }));

    children.push(secaoTitulo("DADOS DO PRETENDENTE"));
    children.push(blocoResumo([
      ["Nome completo", pr.nome],
      ["CPF", pr.cpf],
      ["RG / órgão emissor", pr.rg],
      ["Data de nascimento", pr.nascimento ? fmtDataCurta(pr.nascimento) : ""],
      ["Estado civil", pr.estadoCivil],
      ["Nacionalidade", pr.nacionalidade],
      ["Profissão", pr.profissao],
      ["Telefone", pr.telefone],
      ["E-mail", pr.email],
      ["Endereço atual", pr.endereco],
    ], { manterVazios: true }));

    children.push(secaoTitulo("DADOS PROFISSIONAIS / RENDA"));
    children.push(blocoResumo([
      ["Empresa / fonte de renda", prof.empresa],
      ["Cargo / ocupação", prof.cargo],
      ["Tempo de empresa", prof.tempoEmpresa],
      ["Renda mensal", prof.rendaMensal ? fmtBRL(prof.rendaMensal) : ""],
    ], { manterVazios: true }));

    children.push(secaoTitulo("OUTRAS INFORMAÇÕES"));
    children.push(blocoResumo([
      ["Nº de ocupantes", info.ocupantes],
      ["Garantia pretendida", info.garantiaPretendida],
      ["Referências (pessoais / comerciais)", d.referencias],
    ], { manterVazios: true }));

    children.push(new Paragraph({ spacing: { before: 240, after: 0, line: 300 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: `Declaro, para os devidos fins, que as informações acima prestadas são verdadeiras e autorizo a ${IMOB()} a realizar a análise cadastral necessária à locação pretendida.`, font: FONT_CORPO, size: 19, color: DARK })] }));

    children.push(localData(d));
    children.push(blocoAssinaturas([[{ nome: pr.nome || " ", papel: "PRETENDENTE" }, { nome: " ", papel: " " }]]));
    return children;
  }

  // ---- 2. PROPOSTA DE COMPRA ----
  function buildPropostaCompra(d) {
    const children = [];
    const pp = d.proponente || {};
    const im = d.imovel || {};
    const pr = d.proposta || {};

    children.push(...tituloContrato("PROPOSTA DE COMPRA DE IMÓVEL", "Instrumento particular de proposta", { linha2Color: MUTED, linha2Size: 20 }));
    children.push(p("O(A) proponente abaixo qualificado(a) apresenta, por meio deste instrumento, PROPOSTA DE COMPRA do imóvel adiante descrito, nas condições a seguir estipuladas:", { after: 160 }));

    children.push(blocoParte("PROPONENTE COMPRADOR(A)", [pp]));

    children.push(secaoTitulo("IMÓVEL"));
    children.push(blocoResumo([
      ["Endereço", im.endereco],
      ["Matrícula", im.matricula],
      ["Proprietário / vendedor", pr.proprietario],
    ]));

    children.push(secaoTitulo("CONDIÇÕES DA PROPOSTA"));
    children.push(blocoResumo([
      ["Valor oferecido", pr.valor ? `${fmtBRL(pr.valor)}${pr.valorExtenso ? ` (${pr.valorExtenso})` : ""}` : ""],
      ["Forma de pagamento", pr.formaPagamento],
      ["Validade da proposta", pr.validadeDias ? `${pr.validadeDias} dias a contar desta data` : ""],
    ]));

    if (pr.observacoes && String(pr.observacoes).trim()) {
      children.push(secaoTitulo("OBSERVAÇÕES"));
      children.push(p(String(pr.observacoes).trim()));
    }

    children.push(p(`A presente proposta é feita em caráter irretratável durante o seu prazo de validade e fica condicionada à aceitação do(a) proprietário(a). A aceitação será formalizada mediante assinatura ao final deste instrumento, não gerando esta proposta, por si só, obrigação de venda antes da referida aceitação. A intermediação é realizada pela ${IMOB_QUALIF()}.`, { before: 160 }));

    children.push(localData(d));
    children.push(blocoAssinaturas([[{ nome: pp.nome || " ", papel: "PROPONENTE COMPRADOR(A)" }, { nome: " ", papel: " " }]]));

    children.push(new Paragraph({ spacing: { before: 260, after: 120 }, children: [new TextRun({ text: "ACEITE DO(A) PROPRIETÁRIO(A):", bold: true, font: FONT_TITULO, size: 18, color: DARK })] }));
    children.push(blocoAssinaturas([[{ nome: pr.proprietario || " ", papel: "PROPRIETÁRIO(A) / VENDEDOR(A)" }, { nome: " ", papel: " " }]]));
    return children;
  }

  // ---- 3. PROPOSTA DE ALUGUEL ----
  function buildPropostaAluguel(d) {
    const children = [];
    const pp = d.proponente || {};
    const im = d.imovel || {};
    const pr = d.proposta || {};

    children.push(...tituloContrato("PROPOSTA DE LOCAÇÃO", "Instrumento particular de proposta de aluguel", { linha2Color: MUTED, linha2Size: 20 }));
    children.push(p("O(A) proponente abaixo qualificado(a) apresenta, por meio deste instrumento, PROPOSTA DE LOCAÇÃO do imóvel adiante descrito, nas condições a seguir estipuladas:", { after: 160 }));

    children.push(blocoParte("PROPONENTE LOCATÁRIO(A)", [pp]));

    children.push(secaoTitulo("IMÓVEL"));
    children.push(blocoResumo([
      ["Endereço", im.endereco],
      ["Proprietário / locador", pr.proprietario],
    ]));

    children.push(secaoTitulo("CONDIÇÕES DA PROPOSTA"));
    children.push(blocoResumo([
      ["Aluguel oferecido", pr.valorAluguel ? fmtBRL(pr.valorAluguel) : ""],
      ["Prazo pretendido", pr.prazoMeses ? `${pr.prazoMeses} meses` : ""],
      ["Garantia oferecida", pr.garantia],
      ["Início pretendido", pr.dataInicio ? fmtDataCurta(pr.dataInicio) : ""],
      ["Validade da proposta", pr.validadeDias ? `${pr.validadeDias} dias a contar desta data` : ""],
    ]));

    if (pr.observacoes && String(pr.observacoes).trim()) {
      children.push(secaoTitulo("OBSERVAÇÕES"));
      children.push(p(String(pr.observacoes).trim()));
    }

    children.push(p(`A presente proposta fica condicionada à aprovação cadastral do(a) proponente e à aceitação do(a) proprietário(a), a ser formalizada ao final deste instrumento. A intermediação é realizada pela ${IMOB_QUALIF()}.`, { before: 160 }));

    children.push(localData(d));
    children.push(blocoAssinaturas([[{ nome: pp.nome || " ", papel: "PROPONENTE LOCATÁRIO(A)" }, { nome: " ", papel: " " }]]));

    children.push(new Paragraph({ spacing: { before: 260, after: 120 }, children: [new TextRun({ text: "ACEITE DO(A) PROPRIETÁRIO(A):", bold: true, font: FONT_TITULO, size: 18, color: DARK })] }));
    children.push(blocoAssinaturas([[{ nome: pr.proprietario || " ", papel: "PROPRIETÁRIO(A) / LOCADOR(A)" }, { nome: " ", papel: " " }]]));
    return children;
  }

  // ---- 4. FICHA DE VISITA ----
  function buildFichaVisita(d) {
    const children = [];
    const cl2 = d.cliente || {};
    const im = d.imovel || {};
    const vi = d.visita || {};

    children.push(...tituloContrato("FICHA DE VISITA A IMÓVEL", "Registro de visita e intermediação", { linha2Color: MUTED, linha2Size: 20 }));

    children.push(secaoTitulo("DADOS DA VISITA"));
    children.push(blocoResumo([
      ["Imóvel visitado", im.endereco],
      ["Data da visita", vi.data ? fmtDataCurta(vi.data) : ""],
      ["Horário", vi.hora],
      ["Corretor(a) responsável", vi.corretorNome || branding.nome || ""],
      ["CRECI", branding.creci],
    ], { manterVazios: true }));

    children.push(secaoTitulo("DADOS DO(A) CLIENTE"));
    children.push(blocoResumo([
      ["Nome completo", cl2.nome],
      ["CPF", cl2.cpf],
      ["Telefone", cl2.telefone],
      ["E-mail", cl2.email],
    ], { manterVazios: true }));

    children.push(new Paragraph({ spacing: { before: 260, after: 0, line: 300 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: `O(A) cliente acima identificado(a) declara que visitou o imóvel descrito por intermédio da ${IMOB_QUALIF()}, reconhecendo a intermediação realizada e comprometendo-se a conduzir eventual negociação (compra ou locação) do referido imóvel exclusivamente por meio desta, a quem será devida a respectiva comissão de corretagem, nos termos dos arts. 722 a 729 do Código Civil.`, font: FONT_CORPO, size: 19, color: DARK })] }));

    if (vi.observacoes && String(vi.observacoes).trim()) {
      children.push(secaoTitulo("OBSERVAÇÕES"));
      children.push(p(String(vi.observacoes).trim()));
    }

    children.push(localData(d.data ? d : { ...d, data: vi.data }));
    children.push(blocoAssinaturas([[{ nome: cl2.nome || " ", papel: "CLIENTE" }, { nome: vi.corretorNome || branding.nome || " ", papel: "CORRETOR(A) / IMOBILIÁRIA" }]]));
    return children;
  }

  // ---- 5. AUTORIZAÇÃO DE VENDA (ficha + breve contrato) ----
  function buildAutorizacaoVenda(d) {
    const children = [];
    const prop = d.proprietario || {};
    const im = d.imovel || {};
    const au = d.autorizacao || {};
    let n = 0;
    const cl2 = (t) => clausula(ordinalClausula(++n), t);

    children.push(...tituloContrato("AUTORIZAÇÃO DE VENDA", "Instrumento particular de autorização de intermediação", { linha2Color: MUTED, linha2Size: 18 }));

    children.push(blocoResumo([
      ["Imóvel", im.endereco],
      ["Matrícula", im.matricula],
      ["Valor de venda pretendido", au.valorVenda ? fmtBRL(au.valorVenda) : ""],
      ["Comissão de corretagem", au.comissaoPercentual ? `${au.comissaoPercentual}% sobre o valor da venda` : ""],
      ["Prazo da autorização", au.prazoDias ? `${au.prazoDias} dias` : ""],
    ]));
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: " ", size: 12 })] }));

    children.push(blocoParte("PROPRIETÁRIO(A)", [prop]));
    children.push(p(`Autoriza a ${IMOB_QUALIF()}, doravante denominada IMOBILIÁRIA, a intermediar a venda do imóvel de sua propriedade, nas condições a seguir:`, { before: 160 }));

    children.push(cl2("DO OBJETO"));
    children.push(p(`O(A) PROPRIETÁRIO(A) autoriza a IMOBILIÁRIA a promover a venda do imóvel situado na ${need(im.endereco)}${im.matricula ? `, matrícula nº ${im.matricula}` : ""}${im.caracteristicas ? `, ${im.caracteristicas}` : ""}, praticando os atos necessários à sua divulgação e intermediação.`));

    children.push(cl2("DO PREÇO"));
    children.push(p(`O valor pretendido para a venda é de ${au.valorVenda ? fmtBRL(au.valorVenda) : PLACEHOLDER}, admitidas eventuais condições e negociações previamente aprovadas por escrito pelo(a) PROPRIETÁRIO(A).`));

    children.push(cl2("DA COMISSÃO"));
    children.push(p(`Concretizada a venda a comprador apresentado pela IMOBILIÁRIA, será devida comissão de corretagem de ${au.comissaoPercentual || 6}% (${au.comissaoPercentual || 6} por cento) sobre o valor efetivo da venda, nos termos dos arts. 722 a 729 do Código Civil.`));

    children.push(cl2("DO PRAZO"));
    children.push(p(`A presente autorização vigorará pelo prazo de ${au.prazoDias || 90} (${au.prazoDias || 90}) dias, contados da assinatura, renovando-se automaticamente por iguais períodos caso não haja manifestação em contrário de qualquer das partes.`));

    children.push(cl2("DAS OBRIGAÇÕES DO(A) PROPRIETÁRIO(A)"));
    children.push(p("O(A) PROPRIETÁRIO(A) obriga-se a fornecer a documentação necessária à venda, a permitir as visitas ao imóvel mediante agendamento e a informar à IMOBILIÁRIA qualquer proposta recebida diretamente durante a vigência desta autorização."));

    if (au.observacoes && String(au.observacoes).trim()) {
      children.push(cl2("DAS CONDIÇÕES ESPECIAIS"));
      children.push(p(String(au.observacoes).trim()));
    }

    children.push(cl2("DO FORO"));
    children.push(p(`Fica eleito o foro da Comarca de ${branding.foroPadrao || "Natal/RN"} para dirimir questões oriundas deste instrumento.`, { keepNext: true }));

    children.push(...encerramentoClausulas("instrumento de Autorização de Venda"));
    children.push(...folhaAssinaturas({
      referencia: `Parte integrante da Autorização de Venda do imóvel situado em ${need(im.endereco)}${im.matricula ? `, matrícula nº ${im.matricula}` : ""}, firmada entre ${need(prop.nome)}, na qualidade de PROPRIETÁRIO(A), e ${IMOB_QUALIF()}.`,
      data: d.data,
      pares: [[{ nome: prop.nome || " ", papel: "PROPRIETÁRIO(A)" }, { nome: IMOB(), papel: "IMOBILIÁRIA" }]],
      testemunhas: false,
    }));
    return children;
  }

  // ---- 6. CONTRATO DE EXCLUSIVIDADE (ficha + breve contrato) ----
  function buildContratoExclusividade(d) {
    const children = [];
    const prop = d.proprietario || {};
    const im = d.imovel || {};
    const ex = d.exclusividade || {};
    let n = 0;
    const cl2 = (t) => clausula(ordinalClausula(++n), t);

    children.push(...tituloContrato("CONTRATO DE EXCLUSIVIDADE DE VENDA", "Instrumento particular de intermediação exclusiva", { linha2Color: MUTED, linha2Size: 18 }));

    children.push(blocoResumo([
      ["Imóvel", im.endereco],
      ["Matrícula", im.matricula],
      ["Valor de venda pretendido", ex.valorVenda ? fmtBRL(ex.valorVenda) : ""],
      ["Comissão de corretagem", ex.comissaoPercentual ? `${ex.comissaoPercentual}% sobre o valor da venda` : ""],
      ["Prazo da exclusividade", ex.prazoDias ? `${ex.prazoDias} dias` : ""],
    ]));
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: " ", size: 12 })] }));

    children.push(blocoParte("PROPRIETÁRIO(A)", [prop]));
    children.push(p(`Contrata a ${IMOB_QUALIF()}, doravante denominada IMOBILIÁRIA, para intermediar, com EXCLUSIVIDADE, a venda do imóvel de sua propriedade, nas condições a seguir:`, { before: 160 }));

    children.push(cl2("DO OBJETO E DA EXCLUSIVIDADE"));
    children.push(p(`O(A) PROPRIETÁRIO(A) concede à IMOBILIÁRIA o direito exclusivo de intermediar a venda do imóvel situado na ${need(im.endereco)}${im.matricula ? `, matrícula nº ${im.matricula}` : ""}, durante o prazo estipulado neste instrumento, obrigando-se a não contratar outra imobiliária ou corretor para o mesmo fim durante a sua vigência.`));

    children.push(cl2("DO PREÇO"));
    children.push(p(`O valor pretendido para a venda é de ${ex.valorVenda ? fmtBRL(ex.valorVenda) : PLACEHOLDER}, admitidas negociações previamente aprovadas por escrito pelo(a) PROPRIETÁRIO(A).`));

    children.push(cl2("DA COMISSÃO"));
    children.push(p(`Concretizada a venda durante a vigência deste contrato, será devida à IMOBILIÁRIA comissão de corretagem de ${ex.comissaoPercentual || 6}% (${ex.comissaoPercentual || 6} por cento) sobre o valor efetivo da venda.`));
    children.push(...paragrafo("Parágrafo Único", `Em razão da exclusividade ora pactuada, a comissão será devida integralmente à IMOBILIÁRIA ainda que, durante a vigência deste contrato, a venda seja realizada diretamente pelo(a) PROPRIETÁRIO(A) ou por terceiro por ele indicado, nos termos do art. 726 do Código Civil.`));

    children.push(cl2("DO PRAZO"));
    children.push(p(`A exclusividade vigorará pelo prazo de ${ex.prazoDias || 90} (${ex.prazoDias || 90}) dias, contados da assinatura deste instrumento.`));

    children.push(cl2("DAS OBRIGAÇÕES DO(A) PROPRIETÁRIO(A)"));
    children.push(p("O(A) PROPRIETÁRIO(A) obriga-se a fornecer a documentação necessária à venda, a permitir as visitas ao imóvel mediante agendamento e a encaminhar à IMOBILIÁRIA qualquer interessado que o(a) procure diretamente durante a vigência desta exclusividade."));

    if (ex.observacoes && String(ex.observacoes).trim()) {
      children.push(cl2("DAS CONDIÇÕES ESPECIAIS"));
      children.push(p(String(ex.observacoes).trim()));
    }

    children.push(cl2("DO FORO"));
    children.push(p(`Fica eleito o foro da Comarca de ${branding.foroPadrao || "Natal/RN"} para dirimir questões oriundas deste instrumento.`, { keepNext: true }));

    children.push(...encerramentoClausulas("Contrato de Exclusividade de Venda"));
    children.push(...folhaAssinaturas({
      referencia: `Parte integrante do Contrato de Exclusividade de Venda do imóvel situado em ${need(im.endereco)}${im.matricula ? `, matrícula nº ${im.matricula}` : ""}, firmado entre ${need(prop.nome)}, na qualidade de PROPRIETÁRIO(A), e ${IMOB_QUALIF()}.`,
      data: d.data,
      pares: [[{ nome: prop.nome || " ", papel: "PROPRIETÁRIO(A)" }, { nome: IMOB(), papel: "IMOBILIÁRIA" }]],
      testemunhas: false,
    }));
    return children;
  }

  // ---- 7. TERMO DE ENTREGA DE CHAVES ----
  function buildTermoEntregaChaves(d) {
    const children = [];
    const im = d.imovel || {};
    const ent = d.entregador || {};
    const rec = d.recebedor || {};
    const ch = d.chaves || {};
    const ut = d.utilidades || {};
    const ehVenda = d.negocio === "compra_venda";
    const LABEL_ENT = ehVenda ? "VENDEDOR(A)" : "LOCADOR(A)";
    const LABEL_REC = ehVenda ? "COMPRADOR(A)" : "LOCATÁRIO(A)";
    const porImob = d.entreguePorImobiliaria === "sim";

    children.push(...tituloContrato("TERMO DE ENTREGA DE CHAVES", ehVenda ? "Compra e venda de imóvel" : "Locação de imóvel", { linha2Color: MUTED, linha2Size: 20 }));

    children.push(p("Pelo presente termo formaliza-se a entrega e o recebimento das chaves e acessos do imóvel adiante identificado, bem como a situação dos serviços de energia elétrica, água e gás na data da entrega.", { after: 160 }));

    children.push(secaoTitulo("IMÓVEL"));
    children.push(blocoResumo([
      ["Endereço", im.endereco],
      ["Tipo do imóvel", im.tipo],
      ["Complemento / unidade", im.complemento],
    ], { manterVazios: true }));

    children.push(secaoTitulo(`ENTREGA POR — ${LABEL_ENT}`));
    children.push(blocoResumo([
      ["Nome", ent.nome],
      ["CPF", ent.cpf],
      ["Telefone", ent.telefone],
    ], { manterVazios: true }));
    if (porImob) {
      children.push(p(`A entrega das chaves é realizada pela ${IMOB_QUALIF()}, doravante denominada IMOBILIÁRIA, por conta e ordem do(a) ${LABEL_ENT}.`, { before: 100 }));
    }

    children.push(secaoTitulo(`RECEBIMENTO POR — ${LABEL_REC}`));
    children.push(blocoResumo([
      ["Nome", rec.nome],
      ["CPF", rec.cpf],
      ["Telefone", rec.telefone],
    ], { manterVazios: true }));

    // ---- Chaves e acessos ----
    const itensChave = [
      ["Chave(s) da porta principal", ch.portaPrincipal],
      ["Chave(s) da porta de serviço", ch.portaServico],
      ["Chave(s) de portão / portaria", ch.portao],
      ["Controle(s) de portão / garagem", ch.controle],
      ["Chave(s) da caixa de correio", ch.correio],
    ];
    const linhasChave = itensChave
      .map(([rot, q]) => [rot, Number(q) || 0])
      .filter(([, q]) => q > 0)
      .map(([rot, q]) => [rot, String(q)]);
    const totalChaves = itensChave.reduce((s, [, q]) => s + (Number(q) || 0), 0);
    const temOutras = ch.outras && String(ch.outras).trim();

    children.push(secaoTitulo("CHAVES E ACESSOS ENTREGUES"));
    if (linhasChave.length) children.push(blocoResumo(linhasChave));
    if (temOutras) children.push(p(`Outras chaves / acessos: ${String(ch.outras).trim()}.`, { before: linhasChave.length ? 100 : 0 }));
    if (totalChaves > 0) children.push(p(`Total de chaves e controles entregues: ${totalChaves}.`, { before: 120, bold: true }));
    if (!linhasChave.length && !temOutras) children.push(p("Nenhum item de chave/acesso especificado no momento da entrega."));

    // ---- Serviços (energia, água, gás) ----
    const SIT = { ligada: "Ligada", desligada: "Desligada", na: "Não se aplica" };
    const TIT = { manter: "Permanece no nome atual", transferir: `Transferir para o(a) ${LABEL_REC}`, na: "Não se aplica" };
    function blocoUtil(titulo, u) {
      u = u || {};
      const linhas = [
        ["Situação", SIT[u.situacao] || ""],
        ["Titularidade", TIT[u.titularidade] || ""],
        ["Nº da instalação / medidor", u.instalacao],
        ["Leitura na entrega", u.leitura],
      ];
      if (!linhas.some(([, v]) => v && String(v).trim())) return; // sem dados: omite a seção
      children.push(secaoTitulo(titulo));
      children.push(blocoResumo(linhas, { manterVazios: true }));
    }
    blocoUtil("ENERGIA ELÉTRICA", ut.energia);
    blocoUtil("ÁGUA / SANEAMENTO", ut.agua);
    blocoUtil("GÁS", ut.gas);

    const nomeUtil = { energia: "energia elétrica", agua: "água", gas: "gás" };
    const transferir = ["energia", "agua", "gas"].filter(k => (ut[k] || {}).titularidade === "transferir");
    if (transferir.length) {
      const nomes = transferir.map(k => nomeUtil[k]);
      const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
      children.push(p(`O(A) ${LABEL_REC} responsabiliza-se por providenciar, junto à(s) concessionária(s), a transferência de titularidade ${transferir.length > 1 ? "dos serviços" : "do serviço"} de ${lista} para o seu nome a partir desta data, arcando com o respectivo consumo.`, { before: 160 }));
    }

    if (d.observacoes && String(d.observacoes).trim()) {
      children.push(secaoTitulo("OBSERVAÇÕES"));
      children.push(p(String(d.observacoes).trim()));
    }

    children.push(p(`O(A) ${LABEL_REC} declara ter recebido as chaves e acessos discriminados neste termo e conferido a situação dos serviços acima, nada tendo a reclamar quanto à sua quantidade e condições no momento da entrega.`, { before: 200 }));

    children.push(localData(d));

    const pares = [[{ nome: ent.nome || " ", papel: LABEL_ENT }, { nome: rec.nome || " ", papel: LABEL_REC }]];
    if (porImob) pares.push([{ nome: IMOB(), papel: "IMOBILIÁRIA" }, { nome: " ", papel: " " }]);
    children.push(blocoAssinaturas(pares));
    return children;
  }


  // ---- 8. DISTRATO DE LOCAÇÃO ----
  // Rescisão amigável antes do fim do prazo. O ponto sensível é a multa: o art.
  // 4º da Lei 8.245/91 só admite cobrá-la PROPORCIONALMENTE ao período que
  // falta cumprir. Multa cheia em contrato pela metade é cláusula que cai —
  // por isso o cálculo sai no documento, aberto, em vez de um número pronto
  // que ninguém confere.
  function buildDistratoLocacao(d) {
    const children = [];
    const im = d.imovel || {};
    const lor = d.locador || {};
    const lat = d.locatario || {};
    const fia = d.fiador || {};
    const temFiador = !!String(fia.nome || "").trim();
    const loc = d.locacao || {};
    const dis = d.distrato || {};
    let n = 0;
    const cl2 = (t) => clausula(ordinalClausula(++n), t);

    const dataDistrato = dis.data || d.data;
    const aluguel = Number(loc.aluguel) || 0;
    const multaAlugueis = Number(loc.multaAlugueis === undefined ? 3 : loc.multaAlugueis) || 0;

    // Término previsto: o informado ou, na falta, início + prazo. O contrato de
    // 30 meses iniciado em 10/01 termina em 09/07 — daí o dia anterior.
    let fimPrevisto = loc.fim || null;
    if (!fimPrevisto && loc.inicio && loc.meses) {
      const somado = somarMeses(loc.inicio, Number(loc.meses));
      const dt = parseIsoData(somado);
      if (dt) {
        dt.setDate(dt.getDate() - 1);
        fimPrevisto = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      }
    }

    const diasTotais = diffDias(loc.inicio, fimPrevisto);
    const diasCumpridos = diffDias(loc.inicio, dataDistrato);
    const temConta = diasTotais && diasTotais > 0 && diasCumpridos !== null && diasCumpridos >= 0;
    const diasRestantes = temConta ? Math.max(0, diasTotais - diasCumpridos) : null;

    const multaIntegral = multaAlugueis * aluguel;
    const multaProporcional = temConta ? Math.round(multaIntegral * (diasRestantes / diasTotais) * 100) / 100 : null;

    // Prazo integralmente cumprido: não existe "devolução antecipada", então não
    // existe multa do art. 4º. Sem tratar esse caso o documento afirmaria que a
    // devolução foi antes do termo final quando não foi — e a linha da multa
    // simplesmente sumia do quadro, parecendo campo esquecido.
    const prazoCumprido = temConta && diasRestantes === 0;
    const modoMulta = prazoCumprido ? "prazo_cumprido" : (dis.multaModo || "proporcional");
    const multaDevida = modoMulta === "valor_combinado"
      ? (Number(dis.multaValor) || 0)
      : (modoMulta === "proporcional" ? (multaProporcional || 0) : 0);
    const multaDispensada = modoMulta === "dispensada_acordo" || modoMulta === "dispensada_transferencia";

    children.push(...tituloContrato("DISTRATO DE CONTRATO DE LOCAÇÃO", "Instrumento particular de rescisão amigável", { linha2Color: MUTED, linha2Size: 18 }));

    children.push(blocoResumo([
      ["Imóvel", `${need(im.endereco)}${im.complemento ? `, ${im.complemento}` : ""}`],
      ["Locação iniciada em", loc.inicio ? fmtDataCurta(loc.inicio) : ""],
      ["Término previsto", fimPrevisto ? fmtDataCurta(fimPrevisto) : ""],
      ["Prazo contratado", diasTotais ? `${mesesAproximados(diasTotais)} meses` : (loc.meses ? `${loc.meses} meses` : "")],
      ["Rescisão / entrega das chaves", dataDistrato ? fmtDataCurta(dataDistrato) : ""],
      ["Período cumprido", temConta ? `${mesesAproximados(diasCumpridos)} meses` : ""],
      ["Período restante", temConta ? `${mesesAproximados(diasRestantes)} meses` : ""],
      ["Aluguel vigente", aluguel ? fmtBRL(aluguel) : ""],
      ["Multa rescisória", prazoCumprido ? "Não devida — prazo cumprido"
        : multaDispensada ? "Dispensada"
        : (multaDevida ? fmtBRL(multaDevida) : "Não devida")],
    ]));
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: " ", size: 12 })] }));

    children.push(p("Pelo presente instrumento particular, de um lado:", { after: 160 }));
    children.push(blocoParte("LOCADOR(A)", [lor]));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E de outro —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
    children.push(blocoParte("LOCATÁRIO(A)", [lat]));
    if (temFiador) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E, na qualidade de INTERVENIENTE —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
      children.push(blocoParte("FIADOR(A)", [fia]));
    }

    children.push(p(`As partes acima qualificadas, tendo celebrado entre si contrato de locação do imóvel adiante descrito, resolvem, de comum acordo e na melhor forma de direito, DISTRATAR a referida locação, nos termos e condições a seguir.`, { before: 200 }));

    // ===== OBJETO =====
    children.push(cl2("DO OBJETO"));
    children.push(p(`As partes rescindem, de comum acordo, o contrato de locação do imóvel situado na ${need(im.endereco)}${im.complemento ? `, ${im.complemento}` : ""}${loc.inicio ? `, celebrado com início em ${fmtDataCurta(loc.inicio)}` : ""}${fimPrevisto ? ` e término previsto para ${fmtDataCurta(fimPrevisto)}` : ""}, ficando a locação extinta a partir de ${dataDistrato ? fmtDataCurta(dataDistrato) : PLACEHOLDER}, independentemente do prazo remanescente.`));

    // ===== ENTREGA DAS CHAVES =====
    children.push(cl2("DA ENTREGA DAS CHAVES"));
    children.push(p(`O(A) LOCATÁRIO(A) entrega nesta data as chaves do imóvel ao(à) LOCADOR(A), que as recebe, cessando a partir de ${dataDistrato ? fmtDataCurta(dataDistrato) : PLACEHOLDER} a obrigação de pagar aluguel e encargos da locação.`));
    // Marco de corte: sem uma data expressa, locador cobra o mês inteiro e
    // locatário entende que parou de dever quando saiu.
    children.push(...paragrafo("Parágrafo Único", "A data da entrega das chaves é o marco de divisão de responsabilidades entre as partes: o que for anterior a ela cabe ao(à) LOCATÁRIO(A) e o que for posterior cabe ao(à) LOCADOR(A), ainda que a cobrança venha a ser apresentada depois."));

    // ===== MULTA =====
    children.push(cl2("DA MULTA RESCISÓRIA"));
    if (prazoCumprido) {
      children.push(p(`O prazo contratado foi integralmente cumprido, não havendo devolução antecipada do imóvel e, por consequência, não sendo devida multa rescisória, nada podendo ser exigido a esse título.`));
      children.push(...paragrafo("Parágrafo Único", "Caso a locação estivesse prorrogada por prazo indeterminado, as partes consideram suprido, pela celebração consensual deste distrato, o aviso prévio de que trata o art. 6º da Lei nº 8.245/91, nada sendo devido a título de sua falta."));
    } else if (multaDispensada) {
      const razao = modoMulta === "dispensada_transferencia"
        ? "em razão de transferência do(a) LOCATÁRIO(A), por seu empregador, para prestar serviços em localidade diversa, nos termos do parágrafo único do art. 4º da Lei nº 8.245/91"
        : "por liberalidade e acordo expresso entre as partes";
      children.push(p(`As partes ajustam que NÃO será devida multa rescisória pela devolução antecipada do imóvel, ${razao}, nada podendo ser exigido a esse título a qualquer tempo.`));
    } else {
      children.push(p(`A devolução do imóvel antes do termo final sujeita o(a) LOCATÁRIO(A) à multa prevista no contrato de locação, sempre proporcional ao período de cumprimento, nos termos do art. 4º da Lei nº 8.245/91.`));
      if (temConta && multaIntegral > 0) {
        children.push(...paragrafo("Parágrafo Primeiro — Memória de cálculo", `Multa contratual de ${multaAlugueis} (${numeroPorExtenso(multaAlugueis)}) aluguéis, equivalente a ${fmtBRL(multaIntegral)}, proporcionalizada pelo período restante: ${diasRestantes} dias remanescentes sobre ${diasTotais} dias contratados.`));
        const calc = blocoResumo([
          ["Prazo contratado", `${diasTotais} dias (${mesesAproximados(diasTotais)} meses)`],
          ["Período cumprido", `${diasCumpridos} dias (${mesesAproximados(diasCumpridos)} meses)`],
          ["Período restante", `${diasRestantes} dias (${mesesAproximados(diasRestantes)} meses)`],
          ["Multa contratual integral", `${multaAlugueis} × ${fmtBRL(aluguel)} = ${fmtBRL(multaIntegral)}`],
          ["Multa proporcional devida", fmtBRL(multaProporcional)],
        ]);
        if (calc) {
          children.push(calc);
          children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: " ", size: 12 })] }));
        }
      }
      if (modoMulta === "valor_combinado") {
        children.push(...paragrafo("Parágrafo Segundo — Valor ajustado", `Não obstante o cálculo acima, as partes ajustam livremente, em caráter definitivo e para encerrar a questão, o valor de ${fmtBRL(multaDevida)} a título de multa rescisória, dando-se por satisfeitas quanto a qualquer diferença.`));
      }
      children.push(...paragrafo(`Parágrafo ${modoMulta === "valor_combinado" ? "Terceiro" : "Segundo"} — Pagamento`, `A multa de ${fmtBRL(multaDevida)} será paga ${dis.formaPagamento && String(dis.formaPagamento).trim() ? String(dis.formaPagamento).trim() : "no ato da assinatura deste distrato"}, valendo o respectivo comprovante como recibo.`));
    }

    // ===== DÉBITOS =====
    children.push(cl2("DOS DÉBITOS ATÉ A ENTREGA"));
    children.push(p(`O(A) LOCATÁRIO(A) declara estar ciente de que responde pelos aluguéis, encargos, cotas condominiais, IPTU e contas de consumo de água, energia elétrica e gás apurados até a data da entrega das chaves, obrigando-se a apresentar ao(à) LOCADOR(A) os comprovantes de quitação.`));
    children.push(...paragrafo("Parágrafo Primeiro", "As contas de consumo cuja leitura ou vencimento ocorra após a entrega das chaves, mas cujo período de apuração seja anterior a ela, permanecem sob responsabilidade do(a) LOCATÁRIO(A), na proporção correspondente."));
    if (dis.debitos && String(dis.debitos).trim()) {
      children.push(...paragrafo("Parágrafo Segundo — Débitos identificados", String(dis.debitos).trim()));
    }

    // ===== VISTORIA =====
    children.push(cl2("DA VISTORIA DE SAÍDA"));
    children.push(p("O imóvel é devolvido mediante vistoria de saída, cujo termo, assinado pelas partes, integra este distrato e registra o estado de conservação do bem e as leituras dos medidores na data da entrega."));
    children.push(...paragrafo("Parágrafo Único", "Verificada a necessidade de reparos de responsabilidade do(a) LOCATÁRIO(A), as partes acordarão o respectivo valor ou o prazo para execução, cuja definição constará de termo aditivo a este instrumento, ressalvando-se desde já que a quitação prevista na cláusula própria não alcança danos ocultos que venham a ser identificados e comunicados no prazo de 30 (trinta) dias contados da entrega."));

    // ===== GARANTIA =====
    children.push(cl2("DA GARANTIA DA LOCAÇÃO"));
    const garantia = loc.garantia || (temFiador ? "fiador" : "caucao");
    if (garantia === "fiador") {
      children.push(p(`Com a extinção da locação e cumpridas as obrigações ora ajustadas, o(a) FIADOR(A) fica EXONERADO(A) de toda e qualquer responsabilidade decorrente do contrato de locação distratado, nada mais lhe podendo ser exigido a esse título.`));
    } else if (garantia === "seguro_fianca") {
      children.push(p("O(A) LOCADOR(A) obriga-se a comunicar a seguradora sobre a extinção da locação, para encerramento da apólice de seguro fiança, cessando a cobertura a partir da entrega das chaves."));
    } else if (garantia === "sem_garantia") {
      children.push(p("A locação ora distratada não contava com garantia, nada havendo a restituir ou liberar a esse título."));
    } else {
      const prazoGar = Number(dis.prazoGarantiaDias === undefined ? 30 : dis.prazoGarantiaDias) || 30;
      children.push(p(`A caução prestada${loc.caucaoValor ? `, no valor de ${fmtBRL(loc.caucaoValor)},` : ""} será restituída ao(à) LOCATÁRIO(A) no prazo de ${prazoGar} (${numeroPorExtenso(prazoGar)}) dias contados da entrega das chaves, acrescida dos rendimentos da poupança, deduzidos os valores expressamente discriminados neste instrumento ou em termo aditivo.`));
      children.push(...paragrafo("Parágrafo Único", "Qualquer desconto sobre a caução depende de discriminação por escrito do valor e da sua causa, não se admitindo retenção genérica."));
    }

    // ===== QUITAÇÃO =====
    children.push(cl2("DA QUITAÇÃO RECÍPROCA"));
    children.push(p("Cumpridas as obrigações estabelecidas neste instrumento, as partes dão-se mútua, plena, geral, rasa e irrevogável quitação quanto à locação ora extinta, nada mais tendo a reclamar uma da outra, a qualquer título, em juízo ou fora dele."));
    // A ressalva é o que torna a quitação aceitável para o locador: sem ela,
    // conta de consumo que chega depois vira prejuízo dele.
    children.push(...paragrafo("Parágrafo Único", "Ressalvam-se da quitação as obrigações expressamente assumidas neste distrato e ainda não cumpridas, os débitos de consumo relativos a período anterior à entrega das chaves e os danos ocultos comunicados no prazo previsto na cláusula da vistoria."));

    // ===== EFICÁCIA =====
    children.push(cl2("DA EFICÁCIA"));
    children.push(p(`Este distrato produz efeitos a partir da entrega das chaves${multaDispensada ? "" : " e do pagamento da multa ora ajustada"}, permanecendo íntegro o contrato de locação até que tais condições se verifiquem.`));

    // ===== DISPOSIÇÕES GERAIS =====
    children.push(cl2("DAS DISPOSIÇÕES GERAIS"));
    children.push(p("O presente distrato é celebrado em caráter irrevogável e irretratável, obrigando as partes, seus herdeiros e sucessores, a qualquer título."));
    children.push(...paragrafo("Parágrafo Único", "As partes reconhecem a validade da assinatura eletrônica ou digital deste instrumento, nos termos da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020."));
    if (dis.observacoes && String(dis.observacoes).trim()) {
      children.push(cl2("DAS CONDIÇÕES ESPECIAIS"));
      children.push(p(String(dis.observacoes).trim()));
    }

    children.push(cl2("DO FORO"));
    children.push(p(`Fica eleito o foro da Comarca de ${branding.foroPadrao || "Natal/RN"} para dirimir questões oriundas deste instrumento.`, { keepNext: true }));

    children.push(...encerramentoClausulas("Distrato de Contrato de Locação"));

    const pares = [[{ nome: lor.nome || " ", papel: "LOCADOR(A)" }, { nome: lat.nome || " ", papel: "LOCATÁRIO(A)" }]];
    if (temFiador) pares.push([{ nome: fia.nome, papel: "FIADOR(A) — INTERVENIENTE" }, { nome: " ", papel: " " }]);
    children.push(...folhaAssinaturas({
      referencia: `Parte integrante do Distrato de Contrato de Locação do imóvel situado em ${need(im.endereco)}${im.complemento ? `, ${im.complemento}` : ""}, firmado entre ${need(lor.nome)}, na qualidade de LOCADOR(A), e ${need(lat.nome)}, na qualidade de LOCATÁRIO(A)${temFiador ? `, com a intervenção de ${fia.nome}, FIADOR(A)` : ""}.`,
      data: dataDistrato,
      pares,
      testemunhas: true,
    }));
    return children;
  }

  return {
    buildCompraVenda, buildLocacao, buildHeader, buildFooter,
    buildFichaLocacao, buildPropostaCompra, buildPropostaAluguel,
    buildFichaVisita, buildAutorizacaoVenda, buildContratoExclusividade, buildDistratoLocacao,
    buildTermoEntregaChaves,
  };
}

/**
 * @param {object} dados - dados do contrato (schema em references/data-schema.md). dados.layout escolhe o tema visual: "padrao" | "profissional" | "elegante" (padrão: "padrao").
 * @param {object} branding - { nome, creci, cnpj, email, endereco, cidade, foroPadrao, corPrimaria, logoBuffer }
 * @returns {Promise<Buffer>} buffer do .docx gerado
 */
async function gerarContrato(dados, branding) {
  const themeKey = THEMES[dados.layout] ? dados.layout : "padrao";
  const factory = buildFactory(branding || {}, themeKey);
  const tipo = dados.tipo || "compra_venda";
  let children;
  const DOCS_AUX = {
    ficha_locacao: "buildFichaLocacao",
    proposta_compra: "buildPropostaCompra",
    proposta_aluguel: "buildPropostaAluguel",
    ficha_visita: "buildFichaVisita",
    autorizacao_venda: "buildAutorizacaoVenda",
    contrato_exclusividade: "buildContratoExclusividade",
    termo_entrega_chaves: "buildTermoEntregaChaves",
    distrato_locacao: "buildDistratoLocacao",
  };
  if (tipo === "compra_venda") children = factory.buildCompraVenda(dados);
  else if (tipo === "locacao_caucao" || tipo === "locacao_fiador" || tipo === "locacao_seguro_fianca" || tipo === "locacao_sem_garantia") children = factory.buildLocacao(dados);
  else if (DOCS_AUX[tipo]) children = factory[DOCS_AUX[tipo]](dados);
  else throw new Error(`Tipo desconhecido: ${tipo}.`);

  const theme = THEMES[themeKey];
  const doc = new Document({
    creator: branding.nome || "Contratos Imobiliários",
    title: dados.titulo || "Contrato",
    styles: { default: { document: { run: { font: theme.fontCorpo, size: 20, color: theme.dark } } } },
    sections: [{
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 2160, right: 1418, bottom: 1700, left: 1418, header: 720, footer: 720 } },
      },
      headers: { default: factory.buildHeader() },
      footers: { default: factory.buildFooter() },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

/**
 * Extrai o texto corrido de um .docx já gerado.
 *
 * Um .docx é um zip com o conteúdo em word/document.xml. Usa o JSZip que já
 * vem junto com a lib `docx`, sem dependência nova. Serve pra dar ao robô de
 * perguntas o texto real das cláusulas — responder só a partir dos dados
 * estruturados não cobriria o que o cliente pergunta ("posso ter animal?",
 * "quem paga o IPTU?"), que está na redação, não nos campos.
 */
async function extrairTextoDocx(buffer) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const arquivo = zip.file("word/document.xml");
  if (!arquivo) return "";
  const xml = await arquivo.async("string");
  return xml
    // Fim de parágrafo e quebra de linha viram quebra de verdade, senão o
    // texto todo sai grudado numa linha só.
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\s*\/?>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { gerarContrato, LAYOUTS, extrairTextoDocx };
