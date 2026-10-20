// Modo Jev: o favorito fala com o Jev (TypeSafe) pelo proxy (worker/), sem o
// api-go. Só funções puras — separar a questão, montar o pedido, interpretar a
// resposta — pra serem testadas com `bun test bookmarklet/jev-direto.test.js` e
// usadas tanto pelo bookmarklet quanto pela janela de ponte (docs/relay.html, que
// carrega a cópia docs/quiz-jev-direto.js gerada pelo build).
//
// Diferença pro modo normal (api-go): aqui NÃO há o segundo estágio. O Jev só
// escolhe entre alternativas; não há escalonamento pra um LLM, explicação nem
// pergunta livre.

var QUIZ_JEV_MODELO = "jev-latest";
var QUIZ_JEV_MIN_ALTERNATIVAS = 2;
// Teto de 9, como no servidor: o rótulo tem um dígito, e aceitar mais abriria
// espaço pra tratar uma lista comum como questão.
var QUIZ_JEV_MAX_ALTERNATIVAS = 9;
var QUIZ_JEV_ROTULO_ILEGIVEL = "Ilegível";
var QUIZ_JEV_ROTULOS_GENERICOS = ["A", "B", "C", "D", "E"];

// Rótulo no começo da linha: "A)", "(a", "1.", "3 -", "b:".
var QUIZ_JEV_RE_ROTULO = /^\s*\(?([A-Ea-e]|[1-9])\s*[\)\.\-:]\s+(.*)$/;

function quizJevLimparLinhas(raw) {
  var linhas = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  var saida = [];
  for (var i = 0; i < linhas.length; i++) {
    var l = linhas[i].replace(/^\s+|\s+$/g, "");
    l = l.replace(/^[•·–—*\s]+/, "").replace(/\s+$/, "");
    if (l) saida.push(l);
  }
  return saida;
}

function quizJevSepararComRotulo(linhas) {
  var opcoes = {};
  var ordem = [];
  var enunciado = [];
  var atual = "";
  for (var i = 0; i < linhas.length; i++) {
    var m = QUIZ_JEV_RE_ROTULO.exec(linhas[i]);
    if (!m) {
      if (atual === "") enunciado.push(linhas[i]);
      else opcoes[atual] += " " + linhas[i];
      continue;
    }
    var rotulo = m[1];
    // Rótulo repetido = o bloco tem mais de uma questão (ou nenhuma): recusa.
    if (Object.prototype.hasOwnProperty.call(opcoes, rotulo)) return null;
    opcoes[rotulo] = m[2].replace(/^\s+|\s+$/g, "");
    ordem.push(rotulo);
    atual = rotulo;
  }
  if (ordem.length < QUIZ_JEV_MIN_ALTERNATIVAS || ordem.length > QUIZ_JEV_MAX_ALTERNATIVAS) return null;
  if (!enunciado.length) return null;
  return { pergunta: enunciado.join(" "), opcoes: opcoes, ordem: ordem };
}

function quizJevSepararSemRotulo(linhas) {
  if (linhas[0].charAt(linhas[0].length - 1) !== "?") return null;
  var alternativas = linhas.slice(1);
  if (alternativas.length < QUIZ_JEV_MIN_ALTERNATIVAS || alternativas.length > QUIZ_JEV_MAX_ALTERNATIVAS) return null;
  var opcoes = {};
  var ordem = [];
  for (var i = 0; i < alternativas.length; i++) {
    var rotulo = String.fromCharCode(65 + i);
    opcoes[rotulo] = alternativas[i];
    ordem.push(rotulo);
  }
  return { pergunta: linhas[0], opcoes: opcoes, ordem: ordem };
}

// Separa o texto selecionado em enunciado + alternativas (mesma lógica de
// apps/api-go/quiz_parse.go). Devolve {pergunta, opcoes, ordem} ou null.
function quizJevSepararQuestao(raw) {
  var linhas = quizJevLimparLinhas(raw);
  if (linhas.length < QUIZ_JEV_MIN_ALTERNATIVAS + 1) return null;
  return quizJevSepararComRotulo(linhas) || quizJevSepararSemRotulo(linhas);
}

function quizJevFormatoDaImagem(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  return null;
}

function quizJevMarcadorDeImagem() {
  var s = "";
  for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 0x100000000).toString(16);
  return "quizjev-img-" + s;
}

// Monta o corpo do pedido ao Jev. `entrada`: {pergunta, opcoes|null, imagem|null},
// com imagem = {base64, mime}. Sem alternativas no texto mas com imagem: a
// questão mora na imagem, então vale A–E mais "Ilegível" (modo `generico`).
// Lança Error se não há o que perguntar ao Jev. A imagem do Jev só aceita
// PNG/JPEG: quem chama converte webp/gif antes.
function quizJevMontarPedidoJev(entrada) {
  var opcoes = entrada.opcoes;
  var generico = false;
  if (!opcoes) {
    if (!entrada.imagem) {
      throw new Error("O modo Jev só escolhe entre alternativas: selecione também as alternativas (A, B, C…) da questão.");
    }
    generico = true;
    opcoes = {};
    for (var i = 0; i < QUIZ_JEV_ROTULOS_GENERICOS.length; i++) opcoes[QUIZ_JEV_ROTULOS_GENERICOS[i]] = QUIZ_JEV_ROTULOS_GENERICOS[i];
  }

  var criterios = {};
  if (generico) {
    for (var r in opcoes) {
      if (Object.prototype.hasOwnProperty.call(opcoes, r)) criterios[r] = "A alternativa " + r + " é a correta.";
    }
    criterios[QUIZ_JEV_ROTULO_ILEGIVEL] = "A imagem está ilegível ou não mostra uma questão de múltipla escolha.";
  } else {
    for (var k in opcoes) {
      if (Object.prototype.hasOwnProperty.call(opcoes, k)) criterios[k] = opcoes[k];
    }
  }

  var corpo = {
    model: QUIZ_JEV_MODELO,
    state: entrada.pergunta || "",
    questions: {
      resposta: {
        type: "choice",
        instructions: generico ? "Qual alternativa responde corretamente à questão da imagem?" : "Qual alternativa responde corretamente à questão?",
        criteria: criterios,
      },
    },
  };

  if (entrada.imagem) {
    var formato = quizJevFormatoDaImagem(entrada.imagem.mime);
    if (!formato) throw new Error("O Jev só aceita imagem PNG ou JPEG.");
    var marcador = quizJevMarcadorDeImagem();
    corpo.state = entrada.pergunta ? [entrada.pergunta, marcador] : [marcador];
    corpo.assets = {};
    corpo.assets[marcador] = { type: "image", format: formato, data_base64: entrada.imagem.base64 };
  }

  return { corpo: corpo, opcoes: opcoes, generico: generico, precisaHeaderImagem: !!entrada.imagem };
}

// Converte a resposta do Jev no objeto que o card (quizJevMontarResposta)
// espera. Lança Error se a resposta não serve — melhor erro que uma letra que
// não existe na prova.
function quizJevInterpretarRespostaJev(bruto, opcoes, generico) {
  var item = bruto && bruto.answers && bruto.answers.resposta;
  if (!item) throw new Error("O Jev respondeu num formato inesperado.");
  var probs = item.probabilities || {};
  var escolha = item.choice;
  if (!escolha) {
    // Sem escolha explícita, a maior probabilidade decide.
    var melhor = -1;
    for (var k in probs) {
      if (Object.prototype.hasOwnProperty.call(probs, k) && probs[k] > melhor) {
        melhor = probs[k];
        escolha = k;
      }
    }
  }
  if (!escolha) throw new Error("O Jev não devolveu alternativa.");

  if (generico && escolha === QUIZ_JEV_ROTULO_ILEGIVEL) {
    return {
      kind: "aberta",
      answer: "",
      answerText: "Não consegui ler a questão na imagem. Tente de novo, selecionando uma região maior ou mais nítida.",
      source: "jev",
      parsed: { options: opcoes },
    };
  }
  if (!Object.prototype.hasOwnProperty.call(opcoes, escolha)) {
    throw new Error("O Jev devolveu uma alternativa desconhecida (" + escolha + ").");
  }

  var limpas = {};
  for (var p in probs) {
    if (Object.prototype.hasOwnProperty.call(probs, p) && Object.prototype.hasOwnProperty.call(opcoes, p)) limpas[p] = probs[p];
  }
  var confianca = typeof item.confidence === "number" && item.confidence > 0 ? item.confidence : limpas[escolha] || 0;
  return {
    kind: "unica",
    answer: escolha,
    answerText: generico ? "" : opcoes[escolha],
    source: "jev",
    confidence: confianca,
    probabilities: limpas,
    parsed: { options: opcoes },
  };
}

function quizJevMensagemHttpJev(status) {
  if (status === 401 || status === 403) return "A chave do Jev foi recusada. Confira se ela está correta.";
  if (status === 402 || status === 429) return "A conta do Jev está sem saldo ou atingiu o limite de uso.";
  if (status === 413) return "A imagem é grande demais para o Jev.";
  return "O Jev respondeu com erro (HTTP " + status + ").";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    quizJevSepararQuestao: quizJevSepararQuestao,
    quizJevMontarPedidoJev: quizJevMontarPedidoJev,
    quizJevInterpretarRespostaJev: quizJevInterpretarRespostaJev,
    quizJevMensagemHttpJev: quizJevMensagemHttpJev,
  };
}
