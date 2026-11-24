/**
 * Prévia do contrato em HTML, a partir do .docx gerado.
 *
 * A prévia sai do MESMO documento que o corretor vai baixar — o gerador monta
 * o .docx e aqui ele vira HTML. Montar a prévia à parte, no navegador, daria
 * dois textos que divergem na primeira cláusula alterada; o corretor
 * aprovaria um e assinaria outro.
 *
 * Não é um conversor de Word genérico: lê o XML que a biblioteca `docx`
 * produz (parágrafos, runs, tabelas, quebras) e ignora o resto. O texto dos
 * <w:t> já vem escapado como XML, e as entidades do XML valem no HTML — por
 * isso passa direto, sem reescapar. Nenhum atributo do .docx vira atributo
 * HTML: só classes fixas daqui, o que mantém a prévia livre de injeção.
 */
const JSZip = require("jszip");

const PLACEHOLDER = "(a confirmar)";

const atributo = (xml, nome) => {
  const m = xml.match(new RegExp(`${nome}="([^"]*)"`));
  return m ? m[1] : null;
};

// Liga/desliga de formatação: <w:b/> liga; <w:b w:val="false"/> ou "0" desliga.
function ligado(rPr, tag) {
  const m = rPr.match(new RegExp(`<w:${tag}(\\s[^>]*)?/>`));
  if (!m) return false;
  const val = atributo(m[0], "w:val");
  return !(val === "false" || val === "0");
}

// Fatia um trecho de XML nos filhos de primeiro nível que interessam
// (<w:p> e <w:tbl>), respeitando tabelas aninhadas — o bloco de cada parte é
// uma tabela de uma célula com parágrafos dentro.
function blocos(xml) {
  const lista = [];
  let i = 0;
  while (i < xml.length) {
    const p = xml.indexOf("<w:p", i);
    const t = xml.indexOf("<w:tbl>", i);
    // "<w:p" também casa com <w:pPr>, <w:pBdr>...: só vale se o próximo
    // caractere fecha o nome da tag.
    let proxP = p;
    while (proxP !== -1 && !/[\s>/]/.test(xml[proxP + 4])) proxP = xml.indexOf("<w:p", proxP + 4);
    if (proxP === -1 && t === -1) break;
    if (t !== -1 && (proxP === -1 || t < proxP)) {
      let prof = 0, j = t;
      const re = /<w:tbl>|<\/w:tbl>/g;
      re.lastIndex = t;
      let m;
      while ((m = re.exec(xml))) {
        prof += m[0] === "<w:tbl>" ? 1 : -1;
        if (prof === 0) { j = m.index + m[0].length; break; }
      }
      lista.push({ tipo: "tbl", xml: xml.slice(t, j) });
      i = j;
    } else {
      if (xml[proxP + 4] === "/") { i = proxP + 6; continue; } // <w:p/> vazio
      const fim = xml.indexOf("</w:p>", proxP);
      if (fim === -1) break;
      lista.push({ tipo: "p", xml: xml.slice(proxP, fim + 6) });
      i = fim + 6;
    }
  }
  return lista;
}

function marcarPendencias(html, contagem) {
  return html.split(PLACEHOLDER).map((t, k, arr) => {
    if (k === arr.length - 1) return t;
    contagem.n++;
    return `${t}<mark class="pendente" data-pendencia="${contagem.n}">${PLACEHOLDER}</mark>`;
  }).join("");
}

function paragrafo(xml, ctx) {
  const pPr = (xml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || "";
  const jc = (pPr.match(/<w:jc [^>]*w:val="(\w+)"/) || [])[1] || "";
  const classes = [];
  if (jc === "center") classes.push("c");
  else if (jc === "right" || jc === "end") classes.push("d");
  else if (jc === "both") classes.push("j");
  if (/<w:pBdr>[\s\S]*<w:left /.test(pPr)) classes.push("recuo");
  if (/<w:pBdr>[\s\S]*<w:bottom /.test(pPr)) classes.push("sublinha");
  if (/<w:pBdr>[\s\S]*<w:top /.test(pPr)) classes.push("sobrelinha");

  let html = "";
  let tamanhoMax = 0;
  let soNegrito = true;
  let temTexto = false;
  let quebraPagina = false;
  for (const r of xml.match(/<w:r>[\s\S]*?<\/w:r>|<w:r\s[\s\S]*?<\/w:r>/g) || []) {
    const rPr = (r.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || "";
    const negrito = ligado(rPr, "b");
    const italico = ligado(rPr, "i");
    const sz = Number((rPr.match(/<w:sz w:val="(\d+)"/) || [])[1] || 20);
    if (/<w:br w:type="page"/.test(r)) quebraPagina = true;
    let texto = "";
    // Campo de número de página (rodapé): na prévia vira "X" e "Y".
    const campo = (r.match(/<w:instrText[^>]*>\s*(PAGE|NUMPAGES)\b/) || [])[1];
    if (campo) texto += campo === "PAGE" ? "X" : "Y";
    for (const pedaco of r.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || []) {
      if (pedaco === "<w:tab/>") texto += " ";
      else if (pedaco === "<w:br/>") texto += "<br>";
      else texto += pedaco.replace(/<[^>]+>/g, "");
    }
    if (!texto) continue;
    if (texto.trim()) {
      temTexto = true;
      tamanhoMax = Math.max(tamanhoMax, sz);
      if (!negrito) soNegrito = false;
    }
    let trecho = texto;
    // Texto em cinza no documento (rótulos do quadro, "— E de outro —")
    // continua discreto na prévia. Só tons neutros: cor de marca não vira classe.
    const cor = (rPr.match(/<w:color w:val="([0-9A-Fa-f]{6})"/) || [])[1];
    if (cor) {
      const [r, g, b] = [0, 2, 4].map((k) => parseInt(cor.slice(k, k + 2), 16));
      if (Math.max(r, g, b) - Math.min(r, g, b) < 30 && r + g + b > 300 && r + g + b < 690) trecho = `<span class="suave">${trecho}</span>`;
    }
    if (italico) trecho = `<em>${trecho}</em>`;
    if (negrito) trecho = `<strong>${trecho}</strong>`;
    html += trecho;
  }
  const quebra = quebraPagina ? `<div class="quebra" aria-hidden="true"></div>` : "";
  // Parágrafo sem texto com fio embaixo é linha para escrever (rubrica).
  if (!temTexto) return quebra + `<p class="vazio${classes.includes("sublinha") ? " linha" : ""}"></p>`;

  const puro = html.replace(/<[^>]+>/g, "");
  if (tamanhoMax >= 26) classes.push("titulo");
  else if (/^CL[ÁA]USULA\s/i.test(puro)) classes.push("clausula");
  else if (soNegrito && puro.length < 90 && /^Par[áa]grafo\s/i.test(puro)) classes.push("rotulo");
  else if (soNegrito && puro === puro.toUpperCase() && puro.length < 80) classes.push("caixa");
  return quebra + `<p${classes.length ? ` class="${classes.join(" ")}"` : ""}>${marcarPendencias(html, ctx.pendencias)}</p>`;
}

function tabela(xml, ctx) {
  // Só as linhas DESTA tabela: corta as tabelas aninhadas antes de procurar <w:tr>.
  const linhas = [];
  let corpo = xml.replace(/^<w:tbl>/, "").replace(/<\/w:tbl>$/, "");
  const re = /<w:tr>|<w:tr\s|<w:tbl>|<\/w:tbl>|<\/w:tr>/g;
  let prof = 0, ini = -1, m;
  while ((m = re.exec(corpo))) {
    if (m[0] === "<w:tbl>") prof++;
    else if (m[0] === "</w:tbl>") prof--;
    else if (prof === 0 && m[0].startsWith("<w:tr")) ini = m.index;
    else if (prof === 0 && m[0] === "</w:tr>" && ini !== -1) { linhas.push(corpo.slice(ini, m.index + 7)); ini = -1; }
  }
  const htmlLinhas = linhas.map((tr) => {
    const celulas = [];
    const rc = /<w:tc>|<w:tc\s|<\/w:tc>|<w:tbl>|<\/w:tbl>/g;
    let p2 = 0, ci = -1, mm;
    while ((mm = rc.exec(tr))) {
      if (mm[0] === "<w:tbl>") p2++;
      else if (mm[0] === "</w:tbl>") p2--;
      else if (p2 === 0 && mm[0].startsWith("<w:tc")) ci = mm.index;
      else if (p2 === 0 && mm[0] === "</w:tc>" && ci !== -1) { celulas.push(tr.slice(ci, mm.index + 7)); ci = -1; }
    }
    return `<tr>${celulas.map((tc) => {
      const tcPr = (tc.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/) || [])[1] || "";
      const fill = (tcPr.match(/<w:shd [^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1];
      const span = Number((tcPr.match(/<w:gridSpan w:val="(\d+)"/) || [])[1] || 1);
      const escura = fill && parseInt(fill.slice(0, 2), 16) * 0.3 + parseInt(fill.slice(2, 4), 16) * 0.59 + parseInt(fill.slice(4, 6), 16) * 0.11 < 140;
      const cls = fill && fill.toUpperCase() !== "FFFFFF" ? (escura ? "faixa" : "sombra") : "";
      return `<td${cls ? ` class="${cls}"` : ""}${span > 1 ? ` colspan="${span}"` : ""}>${converter(tc, ctx)}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<table>${htmlLinhas}</table>`;
}

function converter(xml, ctx) {
  return blocos(xml).map((b) => (b.tipo === "tbl" ? tabela(b.xml, ctx) : paragrafo(b.xml, ctx))).join("");
}

// Logo do cabeçalho: vira data URI para a prévia não depender de outra rota.
async function logoDoCabecalho(zip, nomeCab) {
  const rels = zip.file(`word/_rels/${nomeCab}.rels`);
  if (!rels) return "";
  const xmlRels = await rels.async("string");
  const alvo = (xmlRels.match(/Target="(media\/[^"]+)"/) || [])[1];
  if (!alvo || !zip.file(`word/${alvo}`)) return "";
  const ext = alvo.split(".").pop().toLowerCase();
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" }[ext];
  if (!mime) return "";
  const b64 = await zip.file(`word/${alvo}`).async("base64");
  return `<img class="logo" alt="" src="data:${mime};base64,${b64}">`;
}

/**
 * @param {Buffer} buffer .docx gerado por gerarContrato
 * @returns {Promise<{ html: string, pendencias: number }>}
 */
async function docxParaHtml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const ctx = { pendencias: { n: 0 } };
  const doc = await zip.file("word/document.xml").async("string");
  const corpo = (doc.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || "";

  let cabecalho = "";
  const nomeCab = Object.keys(zip.files).find((n) => /^word\/header\d*\.xml$/.test(n));
  if (nomeCab) {
    const xmlCab = await zip.file(nomeCab).async("string");
    const logo = await logoDoCabecalho(zip, nomeCab.replace("word/", ""));
    const textoCab = converter(xmlCab, { pendencias: { n: 0 } });
    cabecalho = `<header class="cab">${logo}<div class="cab-texto">${textoCab}</div></header>`;
  }

  // O rodapé se repete em toda folha; na prévia aparece uma vez, no fim,
  // identificado como tal.
  let rodape = "";
  const nomeRod = Object.keys(zip.files).find((n) => /^word\/footer\d*\.xml$/.test(n));
  if (nomeRod) {
    rodape = `<footer class="rod"><span class="rod-rotulo">Rodapé de cada página</span>${converter(await zip.file(nomeRod).async("string"), { pendencias: { n: 0 } })}</footer>`;
  }

  const html = cabecalho + `<div class="corpo">${converter(corpo, ctx)}</div>` + rodape;
  return { html, pendencias: ctx.pendencias.n };
}

module.exports = { docxParaHtml };
