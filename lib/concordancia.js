/**
 * Concordância de gênero e número nos documentos gerados.
 *
 * As minutas foram escritas no modelo genérico — "o(a) LOCATÁRIO(A)",
 * "ao(s) PROMISSÁRIO(S) COMPRADOR(ES)" — e assim saíam para o cliente. Funciona
 * juridicamente, mas lê como formulário em branco: o contrato da Maria diz
 * "o(a) LOCATÁRIO(A)" quando todo mundo sabe que ela é a LOCATÁRIA.
 *
 * O formulário já sabe o gênero e quantas pessoas ocupam cada papel. Este
 * módulo usa isso para resolver os parênteses no documento PRONTO, depois que
 * o gerador montou o .docx — e não cláusula por cláusula dentro do gerador.
 * Assim as ~400 ocorrências espalhadas nas minutas passam a concordar sem
 * reescrever cada uma, e qualquer cláusula nova escrita no modelo genérico já
 * nasce concordando.
 *
 * Princípio de segurança: na dúvida, não mexe. Se o gênero de um papel não é
 * conhecido (dado antigo, campo vazio), o "(a)" fica como estava — o texto
 * genérico é feio, mas nunca está errado; "o LOCATÁRIO" para uma mulher está.
 */

const LETRA = "A-Za-zÀ-ÖØ-öø-ÿ";
// Palavra (com hífen: "obriga-se", "NU-PROPRIETÁRIO") seguida opcionalmente
// do parêntese de flexão: "(a)", "(à)", "(s)", "(es)", "(éis)", "(m)", "(ão)".
const TOKEN = new RegExp(`([${LETRA}]+(?:-[${LETRA}]+)*)(?:\\(([${LETRA}]{1,3})\\))?`, "g");

const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const ehMaiusculo = (s) => s === s.toUpperCase() && s !== s.toLowerCase();

// ---------------------------------------------------------------------------
// Quem é quem
// ---------------------------------------------------------------------------

// Papel → chave do contexto e como o substantivo flexiona:
//   "or": LOCADOR / LOCADORA / LOCADORES / LOCADORAS
//   "o":  LOCATÁRIO / LOCATÁRIA / LOCATÁRIOS / LOCATÁRIAS
//   "e":  PROMITENTE / PROMITENTES (invariável em gênero)
const PAPEIS = {
  LOCADOR: ["locador", "or"],
  LOCATARIO: ["locatario", "o"],
  FIADOR: ["fiador", "or"],
  VENDEDOR: ["vendedor", "or"],
  COMPRADOR: ["comprador", "or"],
  PROMITENTE: ["vendedor", "e"],
  PROMISSARIO: ["comprador", "o"],
  PROPRIETARIO: ["proprietario", "o"],
  ANUENTE: ["anuente", "e"],
  CLIENTE: ["cliente", "e"],
  PROPONENTE: ["proponente", "e"],
  CANDIDATO: ["locatario", "o"],
};

// Reconhece o papel em qualquer forma: "LOCATÁRIO(A)", "LOCATÁRIA",
// "VENDEDORES". Devolve também a flexão que a palavra JÁ traz, quando traz —
// "PROMISSÁRIA COMPRADORA" já veio resolvido do gerador e manda no artigo.
function papelDe(base) {
  const n = semAcento(base).toUpperCase();
  const achar = (raiz, g, num) => {
    const p = PAPEIS[raiz];
    return p ? { chave: p[0], tipo: p[1], g, n: num } : null;
  };
  if (PAPEIS[n]) {
    const tipo = PAPEIS[n][1];
    // Forma de dicionário: masculino singular, exceto no invariável, em que
    // o gênero não está na palavra.
    return achar(n, tipo === "e" ? null : "m", "s");
  }
  const tentativas = [
    [/ORAS$/, "OR", "f", "p"], [/ORES$/, "OR", "m", "p"], [/ORA$/, "OR", "f", "s"],
    [/AS$/, "O", "f", "p"], [/OS$/, "O", "m", "p"], [/A$/, "O", "f", "s"],
    [/ES$/, "E", null, "p"],
  ];
  for (const [rx, fim, g, num] of tentativas) {
    if (!rx.test(n)) continue;
    const raiz = n.replace(rx, fim);
    const r = achar(raiz, g, num);
    if (r && (r.tipo === "or") === (fim === "OR")) return r;
    if (r && r.tipo === "e" && fim === "E") return r;
  }
  return null;
}

function generoDe(p) {
  if (!p) return null;
  if (String(p.tipoPessoa || "").toLowerCase() === "juridica") return "f"; // concorda com "pessoa jurídica"
  const g = String(p.genero || "").trim().toLowerCase();
  if (g === "f" || g === "feminino") return "f";
  if (g === "m" || g === "masculino") return "m";
  if (g === "pj" || g === "empresa") return "f";
  return null;
}

/**
 * Perfil de concordância de um papel a partir das pessoas que o ocupam.
 * Plural com homem e mulher concorda no masculino (regra da língua); se
 * alguém está sem gênero, o gênero do grupo fica desconhecido — a não ser
 * que já haja um homem, que decide o masculino de qualquer jeito.
 */
function perfil(pessoas) {
  const lista = (Array.isArray(pessoas) ? pessoas : [pessoas])
    .filter((p) => p && typeof p === "object" && String(p.nome || p.razaoSocial || "").trim());
  if (!lista.length) return null;
  const gens = lista.map(generoDe);
  let g;
  if (gens.includes("m")) g = "m";
  else if (gens.every((x) => x === "f")) g = "f";
  else g = null;
  return { g, n: lista.length > 1 ? "p" : "s" };
}

/** Quem ocupa cada papel, conforme o tipo de documento. */
function contextoDoDocumento(d) {
  const tipo = d.tipo || "compra_venda";
  const ctx = {};
  const comGenero = (obj, genero) => (obj && typeof obj === "object" ? obj : { nome: obj || "", genero });

  if (tipo === "compra_venda") {
    ctx.vendedor = perfil(d.vendedores);
    ctx.comprador = perfil(d.compradores);
    ctx.proprietario = ctx.vendedor;
    ctx.anuente = perfil(d.anuentes);
  } else if (tipo.startsWith("locacao_")) {
    ctx.locador = perfil(d.locadores || d.vendedores);
    ctx.locatario = perfil(d.locatarios || d.compradores);
    ctx.fiador = perfil(d.fiadores);
    ctx.proprietario = ctx.locador;
  } else if (tipo === "distrato_locacao") {
    ctx.locador = perfil(d.locador);
    ctx.locatario = perfil(d.locatario);
    ctx.fiador = perfil(d.fiador);
    ctx.proprietario = ctx.locador;
  } else if (tipo === "autorizacao_venda" || tipo === "contrato_exclusividade") {
    ctx.proprietario = perfil(d.proprietario);
    ctx.vendedor = ctx.proprietario;
  } else if (tipo === "proposta_compra" || tipo === "proposta_aluguel") {
    const pr = d.proposta || {};
    ctx.proponente = perfil(d.proponente);
    const dono = perfil(comGenero(pr.proprietario, pr.proprietarioGenero));
    ctx.proprietario = dono;
    if (tipo === "proposta_compra") { ctx.comprador = ctx.proponente; ctx.vendedor = dono; }
    else { ctx.locatario = ctx.proponente; ctx.locador = dono; }
  } else if (tipo === "ficha_visita") {
    ctx.cliente = perfil(d.cliente);
  } else if (tipo === "termo_entrega_chaves") {
    const venda = d.negocio === "compra_venda";
    ctx[venda ? "vendedor" : "locador"] = perfil(d.entregador);
    ctx[venda ? "comprador" : "locatario"] = perfil(d.recebedor);
  } else if (tipo === "checklist_documentos") {
    const venda = (d.negocio || "venda") === "venda";
    const parte = (p, t) => ({ ...(p || {}), tipoPessoa: t === "juridica" ? "juridica" : (p || {}).tipoPessoa });
    ctx[venda ? "vendedor" : "locador"] = perfil(parte(d.parte1, d.parte1Tipo));
    ctx[venda ? "comprador" : "locatario"] = perfil(parte(d.parte2, d.parte2Tipo));
  }
  for (const k of Object.keys(ctx)) if (!ctx[k]) delete ctx[k];
  return ctx;
}

// ---------------------------------------------------------------------------
// Flexão
// ---------------------------------------------------------------------------

function comCaixa(modelo, palavra) {
  if (modelo.length > 1 && ehMaiusculo(modelo)) return palavra.toUpperCase();
  if (ehMaiusculo(modelo[0])) return palavra[0].toUpperCase() + palavra.slice(1);
  return palavra;
}

const ARTIGOS = {
  o: ["o", "a", "os", "as"],
  ao: ["ao", "à", "aos", "às"],
  do: ["do", "da", "dos", "das"],
  pelo: ["pelo", "pela", "pelos", "pelas"],
  no: ["no", "na", "nos", "nas"],
  este: ["este", "esta", "estes", "estas"],
  esse: ["esse", "essa", "esses", "essas"],
};

// Parêntese que só fala de número ("(s)", "(es)") pode ser resolvido mesmo sem
// saber o gênero: o redator já escolheu o gênero da palavra-base.
const soNumero = (suf) => /^(s|es|eis|m|ão)$/i.test(suf);

function idx(pf) {
  return (pf.g === "f" ? 1 : 0) + (pf.n === "p" ? 2 : 0);
}

// Se o gênero é desconhecido mas o parêntese é só de número, vale o masculino
// da palavra-base. Se nem o número se conhece, não há o que resolver.
function perfilUtil(pf, suf) {
  if (!pf || !pf.n) return null;
  if (pf.g) return pf;
  return soNumero(suf) ? { g: "m", n: pf.n } : null;
}

function flexArtigo(tok, pf) {
  const forma = ARTIGOS[tok.base.toLowerCase()];
  const p = perfilUtil(pf, tok.suf);
  if (!forma || !p) return null;
  return comCaixa(tok.base, forma[idx(p)]);
}

// Substantivo ou adjetivo com o parêntese: "LOCADOR(A)", "qualificado(a)",
// "PROMITENTE(S)", "responsável(eis)".
function flexPalavra(tok, pf, tipo) {
  const p = perfilUtil(pf, tok.suf);
  if (!p) return null;
  const base = tok.base;
  const sing = p.n === "s";
  const fem = p.g === "f";
  let palavra;
  const t = tipo || tipoPelaTerminacao(base, tok.suf);
  if (t === "or") palavra = base + (sing ? (fem ? "a" : "") : (fem ? "as" : "es"));
  else if (t === "o") palavra = base.slice(0, -1) + (fem ? "a" : "o") + (sing ? "" : "s");
  else if (t === "e") palavra = base + (sing ? "" : "s");
  else if (t === "eis") palavra = sing ? base : base.replace(/el$/i, "eis").replace(/EL$/, "EIS");
  else return null;
  // A caixa vem da palavra-base: "LOCADOR" → "LOCADORA"; "Fiador" → "Fiadora".
  if (base.length > 1 && ehMaiusculo(base)) return palavra.toUpperCase();
  return palavra.slice(0, base.length) + palavra.slice(base.length).toLowerCase();
}

function tipoPelaTerminacao(base, suf) {
  const b = semAcento(base).toLowerCase();
  const s = String(suf || "").toLowerCase();
  if (s === "eis" && /el$/.test(b)) return "eis";
  if (/or$/.test(b) && (s === "a" || s === "es")) return "or";
  if (/o$/.test(b) && (s === "a" || s === "s")) return "o";
  if (/e$/.test(b) && s === "s") return "e";
  return null;
}

// Verbo na 3ª pessoa do singular → plural, para quando o sujeito é
// "o(a) LOCATÁRIO(A)" e há dois locatários. Só conjuga o que reconhece com
// certeza: futuro em "-rá", a lista de irregulares e a lista de regulares que
// as minutas usam. Palavra fora disso fica como está (ex.: "de", "em").
const IRREGULARES = {
  "é": "são", "está": "estão", "tem": "têm", "vem": "vêm", "dá": "dão", "vai": "vão",
  "faz": "fazem", "pode": "podem", "deve": "devem", "mantém": "mantêm", "detém": "detêm",
  "obtém": "obtêm", "retém": "retêm", "possui": "possuem", "constitui": "constituem",
  "quer": "querem", "diz": "dizem", "traz": "trazem", "põe": "põem", "contribui": "contribuem",
  "anui": "anuem", "usufrui": "usufruem", "frui": "fruem", "atribui": "atribuem",
};
const REGULARES = new Set([
  "declara", "autoriza", "concede", "entrega", "responde", "obriga", "compromete",
  "assume", "reconhece", "renuncia", "aceita", "concorda", "recebe", "paga", "fica",
  "permanece", "manifesta", "garante", "outorga", "cede", "transfere", "vende",
  "promete", "adquire", "desiste", "exonera", "isenta", "indeniza", "arca", "dispensa",
  "continue", "deposita", "arque", "pague", "responda", "devolve", "restitui",
  "confessa", "elege", "abre", "abrem", "nomeia", "constitui", "ratifica", "requer",
  "solicita", "informa", "apresenta", "notifica", "comunica", "providencia", "zela",
  "conserva", "utiliza", "usa", "ocupa", "desocupa", "restitua", "entregue", "receba",
  "concorde", "aceite", "declare", "assine", "assina", "firma", "subscreve", "anuncia",
  "visitou", "visita", "procura", "procure", "atesta", "certifica", "confirma",
  "deixa", "deixe", "faculta", "libera", "quita", "venha", "sofra", "renove", "prorrogue",
]);

function pluralVerbo(palavra) {
  // Ênclise e mesóclise: "obriga-se" → "obrigam-se"; "obrigar-se-á" → "obrigar-se-ão".
  const meso = palavra.match(/^(.+-(?:se|lhe|lhes))-á$/i);
  if (meso) return `${meso[1]}-ão`;
  const enc = palavra.match(/^([^-]+)(-.+)$/);
  const nucleo = enc ? enc[1] : palavra;
  const resto = enc ? enc[2] : "";
  const low = nucleo.toLowerCase();
  let plural = null;
  if (IRREGULARES[low]) plural = IRREGULARES[low];
  else if (/rá$/.test(low)) plural = low.replace(/rá$/, "rão");
  else if (REGULARES.has(low) && /[ae]$/.test(low)) plural = low + "m";
  if (!plural) return null;
  return comCaixa(nucleo, plural) + resto;
}

// ---------------------------------------------------------------------------
// Resolução num trecho de texto
// ---------------------------------------------------------------------------

const ADVERBIOS = new Set(["não", "se", "também", "ainda", "já", "desde", "expressamente", "solidariamente", "lhe", "ora"]);

function tokens(texto) {
  const lista = [];
  for (const m of texto.matchAll(TOKEN)) {
    lista.push({ ini: m.index, fim: m.index + m[0].length, txt: m[0], base: m[1], suf: m[2] === undefined ? null : m[2], papel: papelDe(m[1]) });
  }
  return lista;
}

/**
 * Devolve as substituições a fazer no texto — [{ini, fim, novo}] — sem
 * aplicá-las. Quem chama decide onde aplicar (no .docx, o texto de um
 * parágrafo está repartido em vários pedaços de XML).
 */
function resolver(texto, ctx) {
  if (!texto.includes("(")) return [];
  const toks = tokens(texto);
  const edicoes = [];
  const usado = new Set();
  const editar = (tok, novo) => {
    if (novo == null || novo === tok.txt || usado.has(tok)) return;
    usado.add(tok);
    edicoes.push({ ini: tok.ini, fim: tok.fim, novo });
  };
  // Só espaço entre dois tokens: "o(a) LOCATÁRIO(A)" sim; "LOCADOR(A), que" não.
  const colados = (a, b) => /^\s+$/.test(texto.slice(a.fim, b.ini));

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.papel) continue;

    // Frase do papel: "PROMITENTE VENDEDOR", "PROMISSÁRIO(S) COMPRADOR(ES)".
    let j = i;
    while (j + 1 < toks.length && toks[j + 1].papel && toks[j + 1].papel.chave === t.papel.chave && colados(toks[j], toks[j + 1])) j++;
    const frase = toks.slice(i, j + 1);

    // O que a própria palavra já diz manda; o formulário completa o resto.
    let g = null, n = null;
    for (const f of frase) {
      if (f.suf !== null) continue;
      if (f.papel.g && !g) g = f.papel.g;
      if (f.papel.n && !n) n = f.papel.n;
    }
    const doForm = ctx[t.papel.chave];
    if (doForm) { g = g || doForm.g; n = n || doForm.n; }
    const pf = n ? { g, n } : null;
    if (!pf) { i = j; continue; }

    for (const f of frase) if (f.suf !== null) editar(f, flexPalavra(f, pf, f.papel.tipo));

    // Antes: [artigo] [adjetivo] papel — "o(a) legítimo(a) proprietário(a)".
    let k = i - 1;
    if (k >= 0 && toks[k].suf !== null && !toks[k].papel && !ARTIGOS[toks[k].base.toLowerCase()] && colados(toks[k], toks[k + 1])) {
      editar(toks[k], flexPalavra(toks[k], pf));
      k--;
    }
    let artigo = null;
    if (k >= 0 && toks[k].suf !== null && ARTIGOS[toks[k].base.toLowerCase()] && colados(toks[k], toks[k + 1])) {
      artigo = toks[k];
      editar(artigo, flexArtigo(artigo, pf));
    }

    // Depois: [acima|abaixo] adjetivo — "o(a) FIADOR(A) acima qualificado(a)".
    let q = j + 1;
    let ant = toks[j];
    if (q < toks.length && /^(acima|abaixo)$/i.test(toks[q].txt) && colados(ant, toks[q])) { ant = toks[q]; q++; }
    // (Artigo nunca é adjetivo do papel anterior: em "pelo(a) COMPRADOR ao(s)
    // VENDEDOR(ES)" o "ao(s)" é do vendedor — tratá-lo como adjetivo dava "aas".)
    if (q < toks.length && toks[q].suf !== null && !toks[q].papel && !ARTIGOS[toks[q].base.toLowerCase()] && tipoPelaTerminacao(toks[q].base, toks[q].suf) && colados(ant, toks[q])) {
      editar(toks[q], flexPalavra(toks[q], pf));
      ant = toks[q]; q++;
    }

    // Verbo do sujeito. Conjugar só faz sentido quando é sujeito — artigo
    // simples ("o(a) LOCATÁRIO(A) pagará"), não "ao(à) LOCATÁRIO(A)" — ou
    // numa relativa logo em seguida ("ao(à) LOCADOR(A), que declara").
    let alvoVerbo = null;
    const relativa = texto.slice(toks[j].fim).match(/^,\s*que\s/);
    if (relativa) {
      let r = j + 1;
      while (r < toks.length && toks[r].ini < toks[j].fim + relativa[0].length) r++;
      alvoVerbo = r;
    } else if (artigo && artigo.base.toLowerCase() === "o") {
      alvoVerbo = q;
    }
    if (alvoVerbo !== null) {
      let r = alvoVerbo;
      let anterior = relativa ? null : ant;
      while (r < toks.length && ADVERBIOS.has(toks[r].txt.toLowerCase()) && (!anterior || colados(anterior, toks[r]))) { anterior = toks[r]; r++; }
      const v = toks[r];
      if (v && (!anterior || colados(anterior, v))) {
        if (v.suf !== null && /^(m|ão)$/i.test(v.suf)) {
          // "declara(m)", "entregará(ão)" — o redator já previu o plural.
          editar(v, pf.n === "p" ? (v.suf.toLowerCase() === "m" ? v.base + "m" : v.base.replace(/á$/, "") + "ão") : v.base);
        } else if (v.suf === null && pf.n === "p") {
          editar(v, pluralVerbo(v.txt));
        }
      }
    }
    i = j;
  }
  return edicoes.sort((a, b) => a.ini - b.ini);
}

/** Aplica as substituições a uma string (para texto puro, como o WhatsApp). */
function concordarTexto(texto, ctx) {
  let out = texto;
  for (const e of resolver(texto, ctx).sort((a, b) => b.ini - a.ini)) {
    out = out.slice(0, e.ini) + e.novo + out.slice(e.fim);
  }
  return out;
}

/**
 * Concordância com UMA pessoa específica, para o que é dela e não do grupo:
 * a linha de assinatura ("LOCADORA" sob o nome da Ana, mesmo que haja dois
 * locadores), a qualificação ("inscrita", "casada") e o que só o anuente é
 * ("herdeira", "companheira"). Com `papeis: false`, deixa os papéis do
 * documento ("do(a) PROMITENTE VENDEDOR(A)") para a passada geral, porque
 * esses falam de outra pessoa.
 */
function concordarComPessoa(texto, pessoa, { papeis = false } = {}) {
  const g = generoDe(pessoa);
  if (!g || !String(texto).includes("(")) return texto;
  const pf = { g, n: "s" };
  let out = String(texto);
  if (papeis) {
    const ctx = {};
    for (const [chave] of Object.values(PAPEIS)) ctx[chave] = pf;
    out = concordarTexto(out, ctx);
  }
  const edicoes = [];
  const toks = tokens(out);
  toks.forEach((t, i) => {
    if (t.suf === null || t.papel || ARTIGOS[t.base.toLowerCase()]) return;
    const novo = flexPalavra(t, pf);
    if (novo) edicoes.push({ ini: t.ini, fim: t.fim, novo });
  });
  for (const e of edicoes.sort((a, b) => b.ini - a.ini)) out = out.slice(0, e.ini) + e.novo + out.slice(e.fim);
  return out;
}

/** Escolhe entre [masc. sing., fem. sing., masc. plural, fem. plural]. */
function forma(pf, formas) {
  const p = pf && pf.n ? pf : { g: "m", n: "s" };
  return formas[(p.g === "f" ? 1 : 0) + (p.n === "p" ? 2 : 0)];
}

// ---------------------------------------------------------------------------
// No .docx pronto
// ---------------------------------------------------------------------------

// No XML do Word o texto de um parágrafo vem picado em vários <w:t> — o
// negrito de "LOCATÁRIO(A)" é um pedaço, o "o(a) " antes dele é outro. A
// concordância precisa ler o parágrafo inteiro (o artigo depende da palavra
// seguinte), mas cada troca cai dentro de um pedaço só.
function concordarParagrafo(xml, ctx) {
  const nos = [];
  let texto = "";
  const rx = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
  let m;
  while ((m = rx.exec(xml))) {
    nos.push({ ini: texto.length, txt: m[2], pos: m.index, tam: m[0].length, abre: m[1], fecha: m[3] });
    texto += m[2];
  }
  if (!texto.includes("(")) return xml;
  const edicoes = resolver(texto, ctx);
  if (!edicoes.length) return xml;
  for (const e of edicoes.sort((a, b) => b.ini - a.ini)) {
    const no = nos.find((x) => e.ini >= x.ini && e.fim <= x.ini + x.txt.length);
    if (!no) continue; // atravessa dois pedaços: deixa como está
    const a = e.ini - no.ini;
    no.txt = no.txt.slice(0, a) + e.novo + no.txt.slice(a + (e.fim - e.ini));
  }
  let out = xml;
  for (let i = nos.length - 1; i >= 0; i--) {
    const no = nos[i];
    out = out.slice(0, no.pos) + no.abre + no.txt + no.fecha + out.slice(no.pos + no.tam);
  }
  return out;
}

async function concordarDocx(buffer, ctx) {
  if (!ctx || !Object.keys(ctx).length) return buffer;
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const partes = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  let mudou = false;
  for (const nome of partes) {
    const xml = await zip.file(nome).async("string");
    const novo = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (par) => concordarParagrafo(par, ctx));
    if (novo !== xml) { zip.file(nome, novo); mudou = true; }
  }
  if (!mudou) return buffer;
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { perfil, generoDe, contextoDoDocumento, resolver, concordarTexto, concordarComPessoa, forma, concordarDocx, pluralVerbo };
