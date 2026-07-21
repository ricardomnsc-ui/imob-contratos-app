/**
 * Gerador de contratos imobiliários white-label.
 * Baseado no gerador original da Imob Gest, generalizado para receber a
 * identidade visual (branding) de qualquer imobiliária como parâmetro.
 */
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  TabStopType, VerticalAlign,
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
function ordinalClausula(n) {
  return ORDINAIS_CLAUSULA[n - 1] || `${n}ª`;
}

function need(value, fallback = PLACEHOLDER) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value);
}

function fmtBRL(n) {
  if (n === undefined || n === null || isNaN(Number(n))) return PLACEHOLDER;
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

function fmtData(iso) {
  if (!iso) return PLACEHOLDER;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${parseInt(m[3])} de ${meses[parseInt(m[2]) - 1]} de ${m[1]}`;
}

function fmtDataCurta(iso) {
  if (!iso) return PLACEHOLDER;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function qualificacao(p) {
  const partes = [];
  partes.push(need(p.nacionalidade, "Brasileiro(a)"));
  if (p.estadoCivil) partes.push(p.estadoCivil);
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
  const GREEN = branding.corPrimaria || "00A859";
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

  function clausula(num, titulo) {
    const text = `CLÁUSULA ${num} – ${titulo}`;
    if (theme.clauseStyle === "double-rule") {
      return new Paragraph({
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
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 220, line: 320 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: SOFT, space: 8 } },
        children: [new TextRun({ text, bold: true, font: FONT_TITULO, size: theme.clauseSize, color: DARK })],
      });
    }
    const greenBottom = { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 4 };
    return new Paragraph({
      spacing: { before: 320, after: 160, line: 300 },
      border: { bottom: greenBottom },
      children: [new TextRun({ text, bold: true, font: FONT_TITULO, size: theme.clauseSize, color: DARK })],
    });
  }

  function paragrafo(label, texto) {
    return [
      new Paragraph({
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
        spacing: { after: 0, line: 280 },
        children: [new TextRun({ text: qualificacao(pe), font: FONT_CORPO, size: 20, color: DARK })],
      }));
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

  function blocoAssinaturas(pares) {
    const sigCell = (nome, papel) => new TableCell({
      borders: tBorders,
      margins: { top: 200, bottom: 200, left: 200, right: 200 },
      width: { size: 4535, type: WidthType.DXA },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "ASSINATURA DIGITAL", font: FONT_CORPO, size: 14, color: MUTED })] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: " ", size: 18 })] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: " ", size: 18 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "____________________________________", font: FONT_CORPO, size: 18, color: DARK })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: nome, bold: true, font: FONT_TITULO, size: 20, color: DARK })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: papel, font: FONT_CORPO, size: 16, color: MUTED })] }),
      ],
    });
    const rows = pares.map(par => new TableRow({ children: [sigCell(par[0].nome, par[0].papel), sigCell(par[1] ? par[1].nome : " ", par[1] ? par[1].papel : "")] }));
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
    const label = new Paragraph({ spacing: { before: 240, after: 100 }, children: [new TextRun({ text: "TESTEMUNHAS:", bold: true, font: FONT_TITULO, size: 18, color: DARK })] });
    const table = new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: [4535, 4535], rows: [new TableRow({ children: [witCell(), witCell()] })] });
    return [label, table];
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

  function sectionRule() {
    if (theme.headerRuleStyle === "double") {
      return new Paragraph({
        spacing: { before: 320, after: 80 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 3 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: DARK, space: 3 } },
        children: [new TextRun({ text: "" })],
      });
    }
    if (theme.headerRuleStyle === "hairline") {
      return new Paragraph({
        spacing: { before: 340, after: 100 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: SOFT, space: 6 } },
        children: [new TextRun({ text: "" })],
      });
    }
    return new Paragraph({
      spacing: { before: 320, after: 80 },
      border: { top: { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 4 } },
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
    return new Footer({ children: [footerRule(), footerLine] });
  }

  function buildCompraVenda(d) {
    const children = [];
    const ehSingularVend = (d.vendedores || []).length === 1;
    const ehSingularComp = (d.compradores || []).length === 1;
    const VND = ehSingularVend ? "PROMITENTE VENDEDOR" + (((d.vendedores[0]||{}).genero||"").toLowerCase().startsWith("f") ? "A" : "") : "PROMITENTES VENDEDORES";
    const CMP = ehSingularComp ? "PROMISSÁRIO COMPRADOR" + (((d.compradores[0]||{}).genero||"").toLowerCase().startsWith("f") ? "A" : "") : "PROMISSÁRIOS COMPRADORES";
    const verboVnd = ehSingularVend ? "é legítimo(a) proprietário(a)" : "são legítimos proprietários";
    const verboDecl = ehSingularVend ? "Declara o(a)" : "Declaram os";
    const seCompromete = ehSingularVend ? "se compromete" : "se comprometem";
    const declaramComp = ehSingularComp ? "declara" : "declaram";

    children.push(...tituloContrato("CONTRATO PARTICULAR DE PROMESSA", "DE COMPRA E VENDA DE IMÓVEL"));
    children.push(p("Pelo presente instrumento particular de promessa de compra e venda, de um lado:", { after: 160 }));
    children.push(blocoParte(VND, d.vendedores || []));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [new TextRun({ text: "— E de outro —", italics: true, font: FONT_CORPO, size: 20, color: MUTED })] }));
    children.push(blocoParte(CMP, d.compradores || []));

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
    const valorTotal = d.valor && d.valor.total !== undefined ? d.valor.total : (d.pagamento && d.pagamento.parcelas ? d.pagamento.parcelas.reduce((a, x) => a + Number(x.valor || 0), 0) : 0);
    const valorExtenso = d.valor && d.valor.extenso ? d.valor.extenso : "";
    const modalidade = (d.pagamento && d.pagamento.modalidade) || "a_vista";
    const modalidadeTxt = ({ a_vista: "à vista", parcelado: "de forma parcelada", financiado: "via financiamento bancário", misto: "de forma mista (entrada + parcelas/financiamento)" })[modalidade] || "conforme acordado";

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

    const ec = d.entregaChaves || {};
    const modoChaves = ec.modo || "na_assinatura";
    const dataChaves = ec.data ? fmtDataCurta(ec.data) : null;
    let textoChaves;
    if (modoChaves === "na_assinatura") textoChaves = `As chaves serão entregues na data de assinatura deste instrumento${dataChaves ? ` (${dataChaves})` : ""}, juntamente com a quitação do preço.`;
    else if (modoChaves === "ultima_parcela") textoChaves = `A entrega das chaves está condicionada ao pagamento integral do preço, ocorrendo na data de quitação da última parcela${dataChaves ? ` (${dataChaves})` : ""}.`;
    else if (modoChaves === "data_fixa") textoChaves = `A entrega das chaves ocorrerá em ${dataChaves || PLACEHOLDER}, independentemente da ordem das demais obrigações financeiras, salvo se as partes convencionarem antecipação.`;
    else textoChaves = `A entrega das chaves obedecerá ao seguinte: ${ec.descricao || PLACEHOLDER}.`;
    children.push(...paragrafo("Parágrafo Segundo", textoChaves));

    children.push(...paragrafo("Parágrafo Terceiro", "As partes poderão comparecer ao cartório competente para dar início ao processo de lavratura da escritura pública de compra e venda do imóvel a partir da quitação integral do preço descrito na Cláusula Segunda. A assinatura da escritura definitiva pelo(s) PROMITENTE(S) VENDEDOR(ES) somente ocorrerá após a confirmação do pagamento total."));
    children.push(...paragrafo("Parágrafo Quarto", "O atraso no pagamento de qualquer parcela implicará na incidência de multa moratória de 2% (dois por cento) sobre o valor da parcela em atraso, acrescida de juros de mora de 1% (um por cento) ao mês, calculados pro rata die, desde a data do vencimento até o efetivo pagamento."));
    children.push(...paragrafo("Parágrafo Quinto", "Caso o atraso no pagamento de qualquer parcela ultrapasse o prazo de 30 (trinta) dias corridos contados da data de seu respectivo vencimento, o presente contrato será considerado automaticamente rescindido, independentemente de notificação judicial ou extrajudicial, aplicando-se as penalidades previstas na Cláusula Sétima deste instrumento."));
    children.push(...paragrafo("Parágrafo Sexto", "Até a quitação total do valor do imóvel, o presente contrato terá caráter de promessa de compra e venda. A propriedade permanecerá com o(s) PROMITENTE(S) VENDEDOR(ES) até o cumprimento integral das obrigações financeiras, sendo a escritura definitiva assinada apenas após o recebimento do valor final do imóvel."));

    children.push(clausula("TERCEIRA", "DA POSSE"));
    children.push(pMix([
      { text: ehSingularVend ? "O(a) " : "Os " }, { text: VND, bold: true },
      { text: ` ${seCompromete} a entregar as chaves do imóvel ao(s) ` }, { text: CMP, bold: true },
      { text: `, conforme regra estabelecida no Parágrafo Segundo da Cláusula Segunda, transferindo-lhe(s) a posse direta do imóvel.` },
    ]));
    children.push(...paragrafo("Parágrafo Primeiro", "A partir da entrega das chaves, o(s) PROMISSÁRIO(S) COMPRADOR(ES) assumirão integralmente a responsabilidade pelo pagamento de todos os débitos relativos ao imóvel, incluindo, mas não se limitando a: IPTU, taxas condominiais, contas de água, energia elétrica, gás e demais encargos que incidam sobre o imóvel."));
    children.push(...paragrafo("Parágrafo Segundo", "O(s) PROMITENTE(S) VENDEDOR(ES) declara(m) que entregará(ão) o imóvel livre e desembaraçado de quaisquer débitos anteriores à data de transferência da posse, responsabilizando-se por eventuais cobranças retroativas."));

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

    const corret = d.corretagem || { percentual: 5 };
    const corretValor = corret.valor !== undefined ? corret.valor : valorTotal * (Number(corret.percentual || 5) / 100);
    children.push(clausula("SEXTA", "DA INTERMEDIAÇÃO/CORRETAGEM"));
    children.push(pMix([
      { text: "O presente negócio é feito sobre a intermediação da " },
      { text: `${(branding.nome || "IMOBILIÁRIA").toUpperCase()}${branding.creci ? `, CRECI: ${branding.creci}` : ""}`, bold: true },
      { text: `${branding.cnpj ? `, inscrita no CNPJ nº ${branding.cnpj}` : ""}${branding.endereco ? `, com endereço profissional à ${branding.endereco}` : ""}${branding.email ? `, e-mail ${branding.email}` : ""}, que receberá do(s) ` },
      { text: VND, bold: true },
      { text: ", a título de corretagem pelos serviços de intermediação ora prestados, o valor correspondente a " },
      { text: `${corret.percentual || 5}% (${corret.percentual || 5} por cento) do valor total da venda, equivalente a ${fmtBRL(corretValor)}`, bold: true },
      { text: ", a ser pago de forma proporcional a cada parcela recebida pelo(s) vendedor(es)." },
    ]));
    children.push(...paragrafo("Parágrafo Primeiro", `O pagamento da comissão deverá ser realizado via PIX${branding.cnpj ? ` para o CNPJ ${branding.cnpj}` : ""} da ${(branding.nome || "imobiliária").toUpperCase()}, de forma proporcional ao valor recebido pelo(s) PROMITENTE(S) VENDEDOR(ES).`));
    children.push(...paragrafo("Parágrafo Segundo", "A comissão de corretagem será devida integralmente, ainda que ocorra rescisão ou arrependimento por qualquer das partes, desde que a negociação tenha sido concluída por intermédio da corretora, com aceite da proposta e formalização deste instrumento, sendo certo que a corretora já terá cumprido sua função de aproximação e intermediação."));

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

    const temEspecialCV = d.clausulaEspecial && String(d.clausulaEspecial).trim();
    if (temEspecialCV) {
      children.push(clausula("DÉCIMA", "DAS CONDIÇÕES ESPECIAIS"));
      children.push(p(String(d.clausulaEspecial).trim()));
    }
    children.push(clausula(temEspecialCV ? "DÉCIMA PRIMEIRA" : "DÉCIMA", "DO FORO"));
    children.push(p(`As partes elegem o foro da Comarca de ${need(d.foro, branding.foroPadrao || "Natal/RN")} como o competente para dirimir qualquer lide decorrente deste contrato. E por estarem assim justos e contratados, assinam o presente em 3 (três) vias de igual teor e forma, juntamente com as testemunhas, para que surtam os seus jurídicos e legais efeitos.`));

    children.push(sectionRule());
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 60, after: 320 }, children: [new TextRun({ text: `${(branding.cidade || "Natal")}, ${fmtData(d.data)}`, bold: true, font: FONT_TITULO, size: 22, color: DARK })] }));

    const sigPairs = [];
    const vList = (d.vendedores || []).map(v => ({ nome: v.nome, papel: ehSingularVend ? VND : "PROMITENTE VENDEDOR(A)" }));
    const cList = (d.compradores || []).map(c => ({ nome: c.nome, papel: ehSingularComp ? CMP : "PROMISSÁRIO(A) COMPRADOR(A)" }));
    const linhas = Math.max(vList.length, cList.length);
    for (let i = 0; i < linhas; i++) sigPairs.push([vList[i] || { nome: " ", papel: " " }, cList[i] || { nome: " ", papel: " " }]);
    children.push(blocoAssinaturas(sigPairs));

    children.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "TESTEMUNHAS:", bold: true, font: FONT_TITULO, size: 20, color: DARK })] }));
    const testCell = () => new TableCell({
      borders: tBorders, margins: { top: 200, bottom: 200, left: 200, right: 200 }, width: { size: 4535, type: WidthType.DXA },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "ASSINATURA DIGITAL", font: FONT_CORPO, size: 14, color: MUTED })] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: " ", size: 18 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "____________________________________", font: FONT_CORPO, size: 18, color: DARK })] }),
        new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "Nome: ________________________________", font: FONT_CORPO, size: 18, color: MUTED })] }),
        new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: "CPF: __________________________________", font: FONT_CORPO, size: 18, color: MUTED })] }),
      ],
    });
    children.push(new Table({ width: { size: 9070, type: WidthType.DXA }, columnWidths: [4535, 4535], rows: [new TableRow({ children: [testCell(), testCell()] })] }));

    return children;
  }

  function buildLocacao(d) {
    const children = [];
    const ehFiador = d.tipo === "locacao_fiador";
    const garantiaTipo = ehFiador ? "fiador" : (d.garantiaTipo || "caucao");
    const GARANTIA_LABEL = { fiador: "FIADOR", caucao: "CAUÇÃO", seguro_fianca: "SEGURO FIANÇA", titulo_capitalizacao: "TÍTULO DE CAPITALIZAÇÃO", personalizada: "GARANTIA ESPECÍFICA" };
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

    children.push(...tituloContrato(`CONTRATO DE LOCAÇÃO ${usoLabel}`, `(GARANTIA: ${GARANTIA_LABEL[garantiaTipo] || "CAUÇÃO"})`, { linha2Color: MUTED, linha2Size: 22 }));
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
    children.push(cl("DA GARANTIA"));
    const g = d.garantia || {};
    if (garantiaTipo === "fiador") {
      children.push(p("Como garantia da presente locação, o(a) FIADOR(A) acima qualificado(a) se obriga solidariamente com o(a) LOCATÁRIO(A) por todas as obrigações contratuais, até a efetiva entrega das chaves do imóvel."));
    } else if (garantiaTipo === "seguro_fianca") {
      children.push(p(`Como garantia da presente locação, é contratado Seguro Fiança junto à seguradora ${need(g.seguradora)}, apólice nº ${need(g.apolice)}, que assegura o cumprimento das obrigações do(a) LOCATÁRIO(A) nos termos e limites da respectiva apólice, cuja cópia integra o presente instrumento como se nele estivesse transcrita.`));
    } else if (garantiaTipo === "titulo_capitalizacao") {
      children.push(p(`Como garantia da presente locação, o(a) LOCATÁRIO(A) apresenta Título de Capitalização nº ${need(g.numero)}, emitido por ${need(g.instituicao)}, no valor de ${fmtBRL(g.valor)}, o qual permanecerá caucionado em favor do(a) LOCADOR(A) durante toda a vigência do presente contrato, podendo ser resgatado em caso de inadimplemento das obrigações locatícias.`));
    } else if (garantiaTipo === "personalizada") {
      children.push(p(String(g.descricao || PLACEHOLDER)));
    } else {
      const depositarioTxt = temAdmin ? "na conta bancária indicada pela administradora" : "na conta bancária indicada pelo(a) LOCADOR(A)";
      children.push(pMix([
        { text: "Em garantia das obrigações assumidas neste instrumento, o(a) LOCATÁRIO(A) depositará, em até 1 (um) dia útil contado da assinatura deste contrato, a quantia de " },
        { text: fmtBRL(g.valor), bold: true },
        { text: `, a título de caução locatícia, ${depositarioTxt}.` },
      ]));
      children.push(...paragrafo("Parágrafo Primeiro — Destinação", "A caução servirá para garantir o pagamento de eventuais débitos de aluguel, encargos, danos ao imóvel ou quaisquer outras obrigações decorrentes deste contrato que não sejam cumpridas pelo(a) LOCATÁRIO(A) ao final da locação."));
      children.push(...paragrafo("Parágrafo Segundo — Devolução", "Findo o contrato e devolvido o imóvel nas condições contratualmente pactuadas, com apresentação dos comprovantes de quitação das contas de consumo e demais encargos, a caução será restituída integralmente ao(à) LOCATÁRIO(A) no prazo de até 30 (trinta) dias, deduzidos eventuais débitos e prejuízos apurados na vistoria de saída."));
      children.push(...paragrafo("Parágrafo Terceiro — Insuficiência", "Caso o valor da caução seja insuficiente para cobrir os débitos ou danos verificados, o(a) LOCATÁRIO(A) responderá pela diferença, podendo o(a) LOCADOR(A) exigi-la por todos os meios legais, inclusive cobrança extrajudicial e/ou ação judicial cabível."));
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
    children.push(...paragrafo("Parágrafo Primeiro — Seguro Incêndio", "O(A) LOCATÁRIO(A) obriga-se a segurar o imóvel locado contra os riscos de fogo em companhia de absoluta idoneidade, pelo valor mínimo equivalente a 100 (cem) vezes o valor do aluguel, mantendo-o segurado até o final do prazo contratual, nos termos do art. 22, VIII, da Lei nº 8.245/91."));
    children.push(...paragrafo("Parágrafo Segundo — Concessionárias", "Após a assinatura deste contrato, o(a) LOCATÁRIO(A) deverá providenciar a transferência da titularidade dos serviços de energia elétrica e água para o seu nome, no prazo máximo de 30 (trinta) dias após a entrega das chaves, eximindo-se o(a) LOCADOR(A) de qualquer responsabilidade sobre anormalidades nas contas após esse prazo."));
    children.push(...paragrafo("Parágrafo Terceiro — Reembolso", "Na hipótese de qualquer débito de consumo, condomínio ou tributo não pago pelo(a) LOCATÁRIO(A) no prazo devido vir a ser cobrado do(a) LOCADOR(A), será este reembolsado pelo(a) LOCATÁRIO(A), acrescido de multa de 10% (dez por cento), juros de 1% (um por cento) ao mês e correção monetária."));
    children.push(...paragrafo("Parágrafo Quarto — Honorários e Custas Processuais", "Caso seja necessária a cobrança judicial ou extrajudicial de qualquer valor devido em razão deste contrato, correrão por conta da parte inadimplente todas as despesas daí decorrentes, incluindo custas processuais, emolumentos cartorários e honorários advocatícios, estes fixados em 20% (vinte por cento) sobre o valor do débito, sem prejuízo dos honorários de sucumbência que vierem a ser arbitrados judicialmente."));

    // ===== DA DEVOLUÇÃO DO IMÓVEL =====
    children.push(cl("DA DEVOLUÇÃO DO IMÓVEL"));
    children.push(p("No ato da devolução do imóvel, o(a) LOCATÁRIO(A) deverá apresentar todos os comprovantes de pagamento das contas de sua responsabilidade até a data da entrega das chaves, bem como entregar o imóvel no mesmo estado de conservação em que foi recebido, ressalvado o desgaste natural pelo uso regular."));
    children.push(...paragrafo("Parágrafo Único", "No momento da devolução, as partes verificarão o estado do imóvel e o cumprimento das obrigações contratuais, podendo eventuais avarias, pendências ou débitos ser deduzidos da garantia prestada, conforme cláusula própria deste contrato."));

    // ===== DA DESTINAÇÃO E CESSÃO =====
    children.push(cl("DA DESTINAÇÃO E CESSÃO"));
    children.push(p(`O imóvel objeto do presente contrato destina-se exclusivamente para fim ${usoImovel}, sendo expressamente proibido ao(à) LOCATÁRIO(A) sublocar, ceder ou emprestar o imóvel a terceiros, no todo ou em parte, gratuita ou onerosamente, sem prévia anuência por escrito do(a) LOCADOR(A).`));
    children.push(...paragrafo("Parágrafo Único", "A ocupação do imóvel por pessoa não referida neste contrato caracteriza grave infração contratual, ensejando a rescisão da locação a qualquer tempo, sem prejuízo da aplicação da multa prevista na cláusula de Multa e Execução deste contrato."));

    // ===== DA ALIENAÇÃO =====
    children.push(cl("DA ALIENAÇÃO"));
    children.push(p("O(A) LOCADOR(A) poderá, a qualquer tempo, alienar o imóvel locado, ficando assegurado ao(à) LOCATÁRIO(A) o direito de preferência na aquisição, nas mesmas condições oferecidas a terceiros, devendo manifestar-se em até 30 (trinta) dias contados da notificação da venda, nos termos do art. 27 da Lei nº 8.245/91."));

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
    children.push(p(`As partes elegem o foro da Comarca de ${need(d.foro, branding.foroPadrao || "Natal/RN")} como o competente para dirimir qualquer lide decorrente deste contrato, com exclusão de qualquer outro, por mais privilegiado que seja.`));

    children.push(sectionRule());
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 60, after: 320 }, children: [new TextRun({ text: `${(branding.cidade || "Natal")}, ${fmtData(d.data)}`, bold: true, font: FONT_TITULO, size: 22, color: DARK })] }));

    const sigPairs = [];
    const lod = (d.locadores || d.vendedores || []).map(v => ({ nome: v.nome, papel: "LOCADOR(A)" }));
    const lat = (d.locatarios || d.compradores || []).map(v => ({ nome: v.nome, papel: "LOCATÁRIO(A)" }));
    const linhas = Math.max(lod.length, lat.length);
    for (let i = 0; i < linhas; i++) sigPairs.push([lod[i] || { nome: " ", papel: " " }, lat[i] || { nome: " ", papel: " " }]);
    if (ehFiador && d.fiadores) d.fiadores.forEach(f => sigPairs.push([{ nome: f.nome, papel: "FIADOR(A)" }, { nome: " ", papel: " " }]));
    if (temAdmin) sigPairs.push([{ nome: (branding.nome || "IMOBILIÁRIA").toUpperCase(), papel: "ADMINISTRADORA" }, { nome: " ", papel: " " }]);
    children.push(blocoAssinaturas(sigPairs));
    children.push(...blocoTestemunhas());

    return children;
  }

  return { buildCompraVenda, buildLocacao, buildHeader, buildFooter };
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
  if (tipo === "compra_venda") children = factory.buildCompraVenda(dados);
  else if (tipo === "locacao_caucao" || tipo === "locacao_fiador") children = factory.buildLocacao(dados);
  else throw new Error(`Tipo desconhecido: ${tipo}. Use compra_venda, locacao_caucao ou locacao_fiador.`);

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

module.exports = { gerarContrato, LAYOUTS };
