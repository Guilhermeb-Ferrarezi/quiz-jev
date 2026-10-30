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

// Cabeçalho que as plataformas de prova põem em volta da questão ("Questão 01 de
// 06", "10 PONTOS"): não faz parte do enunciado.
// A LINHA INTEIRA tem que ser só isso (um ou os dois, em qualquer ordem): uma frase
// do enunciado que cite "questão 2 de 6" não é cortada.
// Os trechos podem vir colados ("de 0610 PONTOS"): o espaço entre eles é opcional.
var QUIZ_JEV_RE_RUIDO = /^(?:quest[aã]o\s+\d+\s+de\s+\d+|\d+\s*pontos?)(?:\s*(?:quest[aã]o\s+\d+\s+de\s+\d+|\d+\s*pontos?))*$/i;

function quizJevLimparLinhas(raw) {
  var linhas = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  var saida = [];
  for (var i = 0; i < linhas.length; i++) {
    var l = linhas[i].replace(/^\s+|\s+$/g, "");
    l = l.replace(/^[•·–—*\s]+/, "").replace(/\s+$/, "");
    if (l && !QUIZ_JEV_RE_RUIDO.test(l)) saida.push(l);
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

// Letra num elemento à parte (círculo com "A" ao lado do texto): a seleção vem
// como "A" numa linha e o texto na seguinte, ou como "A Chapetones" /
// "AChapetones", sem parêntese nem ponto. Só vale se as ÚLTIMAS linhas começam
// com A, B, C… em sequência, contando de trás pra frente até o A — uma frase do
// enunciado que comece com "A" não basta.
var QUIZ_JEV_RE_LETRA_SOZINHA = /^\(?([A-E])\s*[\)\.\-:]?$/;

function quizJevSepararLetraSeparada(linhas) {
  var juntas = [];
  for (var i = 0; i < linhas.length; i++) {
    var m = QUIZ_JEV_RE_LETRA_SOZINHA.exec(linhas[i]);
    if (m && i + 1 < linhas.length && !QUIZ_JEV_RE_LETRA_SOZINHA.test(linhas[i + 1])) {
      juntas.push(m[1] + " " + linhas[i + 1]);
      i++;
    } else {
      juntas.push(linhas[i]);
    }
  }
  // A alternativa A é a última linha que começa com "A"; dali até o fim tem que
  // ser A, B, C… em ordem.
  var inicio = -1;
  for (var j = juntas.length - 1; j > 0 && inicio < 0; j--) {
    if (juntas[j].charAt(0) === "A") inicio = j;
  }
  if (inicio < 0) return null;
  var total = juntas.length - inicio;
  if (total < QUIZ_JEV_MIN_ALTERNATIVAS || total > QUIZ_JEV_ROTULOS_GENERICOS.length) return null;
  var opcoes = {};
  var ordem = [];
  for (var k = 0; k < total; k++) {
    var linha = juntas[inicio + k];
    var rotulo = String.fromCharCode(65 + k);
    if (linha.charAt(0) !== rotulo) return null;
    // Colada sem espaço ("AChapetones"), o texto tem que começar com maiúscula
    // ou número: senão "Azul"/"Branco" viraria "zul"/"ranco".
    var depois = linha.charAt(1);
    var maiuscula = depois !== depois.toLowerCase() && depois === depois.toUpperCase();
    if (!maiuscula && !/[\s\)\.\-:0-9]/.test(depois)) return null;
    var texto = linha.slice(1).replace(/^\s*[\)\.\-:]?\s*/, "");
    if (!texto) return null;
    opcoes[rotulo] = texto;
    ordem.push(rotulo);
  }
  return { pergunta: juntas.slice(0, inicio).join(" "), opcoes: opcoes, ordem: ordem };
}

// Sem rótulo, o enunciado acaba na última linha que termina em "?" ou ":"
// ("…podemos afirmar que:") e o resto são as alternativas, uma por linha. O
// enunciado pode ter mais de uma linha (texto de apoio + pergunta).
var QUIZ_JEV_RE_FIM_ENUNCIADO = /[?:]$/;

function quizJevSepararSemRotulo(linhas) {
  var fim = -1;
  for (var j = linhas.length - 1 - QUIZ_JEV_MIN_ALTERNATIVAS; j >= 0; j--) {
    if (QUIZ_JEV_RE_FIM_ENUNCIADO.test(linhas[j])) {
      fim = j;
      break;
    }
  }
  if (fim < 0) return null;
  var alternativas = linhas.slice(fim + 1);
  if (alternativas.length < QUIZ_JEV_MIN_ALTERNATIVAS || alternativas.length > QUIZ_JEV_MAX_ALTERNATIVAS) return null;
  var opcoes = {};
  var ordem = [];
  for (var i = 0; i < alternativas.length; i++) {
    var rotulo = String.fromCharCode(65 + i);
    opcoes[rotulo] = alternativas[i];
    ordem.push(rotulo);
  }
  return { pergunta: linhas.slice(0, fim + 1).join(" "), opcoes: opcoes, ordem: ordem };
}

// Separa o texto selecionado em enunciado + alternativas (mesma lógica de
// apps/api-go/quiz_parse.go). Devolve {pergunta, opcoes, ordem} ou null.
function quizJevSepararQuestao(raw) {
  var linhas = quizJevLimparLinhas(raw);
  if (linhas.length < QUIZ_JEV_MIN_ALTERNATIVAS + 1) return null;
  return quizJevSepararComRotulo(linhas) || quizJevSepararLetraSeparada(linhas) || quizJevSepararSemRotulo(linhas);
}

// ---- Afirmativas para julgar ----
// Algumas provas não pedem "escolha uma": cada alternativa é uma afirmativa e o
// aluno marca Certo/Errado (ou Verdadeiro/Falso…) em cada uma. No texto
// selecionado, isso aparece como "Certo Errado" depois de cada afirmativa.
// Exige o PAR no fim do texto ("sim" sozinho ou "certa" no meio da frase não conta).
var QUIZ_JEV_RE_PAR_JULGAMENTO = /\s+(certo|verdadeiro|v|sim|correto)\s*[\/|,\-]?\s*(errado|falso|f|n[ãa]o|incorreto)\s*$/i;
var QUIZ_JEV_RE_DICA_JULGAMENTO = /(certas?\s+ou\s+erradas?|verdadeir[oa]s?\s+ou\s+fals[oa]s?|certo\s+ou\s+errado|v\s+ou\s+f)\b/i;

// Recebe o resultado de quizJevSepararQuestao. Se for um conjunto de afirmativas
// a julgar, devolve a questão com `julgamento: true` e o texto de cada afirmativa
// já sem o "Certo Errado"; senão, devolve a mesma questão (ou null).
function quizJevDetectarJulgamento(questao) {
  if (!questao) return null;
  var total = questao.ordem.length;
  var comPar = 0;
  var limpas = {};
  for (var i = 0; i < total; i++) {
    var rotulo = questao.ordem[i];
    var texto = questao.opcoes[rotulo];
    var sem = texto.replace(QUIZ_JEV_RE_PAR_JULGAMENTO, "");
    if (sem !== texto) comPar++;
    limpas[rotulo] = sem;
  }
  var maioria = comPar >= Math.max(2, Math.ceil(total * 0.75));
  // Sem o "Certo Errado" no texto (a página pode não incluí-lo na seleção), vale o
  // que o enunciado diz.
  if (!maioria && !QUIZ_JEV_RE_DICA_JULGAMENTO.test(questao.pergunta)) return questao;
  return { pergunta: questao.pergunta, opcoes: maioria ? limpas : questao.opcoes, ordem: questao.ordem, julgamento: true };
}

function quizJevFormatoDaImagem(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  return null;
}

// O Jev recusa (HTTP 400 "Invalid image dimensions") imagem com o lado menor abaixo
// de ~280 px ou o maior acima de 1568 px (medido na API: 900x280 passa, 900x270 não;
// 1568x500 passa, 1569x500 não). Tabelas largas e baixas caem no primeiro caso.
// Devolve como desenhar: `dw`x`dh` é a imagem (reduzida se passar do teto) e `cw`x`ch`
// o quadro final (completado com branco até o mínimo, imagem centralizada).
var QUIZ_JEV_LADO_MIN_PX = 300;
var QUIZ_JEV_LADO_MAX_PX = 1560;
function quizJevAjustarTamanhoJev(w, h) {
  var escala = Math.min(1, QUIZ_JEV_LADO_MAX_PX / Math.max(w, h));
  var dw = Math.max(1, Math.round(w * escala));
  var dh = Math.max(1, Math.round(h * escala));
  var cw = Math.max(dw, QUIZ_JEV_LADO_MIN_PX);
  var ch = Math.max(dh, QUIZ_JEV_LADO_MIN_PX);
  return { dw: dw, dh: dh, cw: cw, ch: ch, mudou: escala !== 1 || cw !== dw || ch !== dh };
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
  if (entrada.lacunas) return quizJevMontarPedidoLacunas(entrada);
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

  if (entrada.julgamento) return quizJevMontarPedidoJulgamento(entrada, opcoes);

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

// ---- Lacunas com dropdown ----
// Texto com lacunas a completar escolhendo, em cada uma, uma opção de uma lista
// (dropdown). O texto chega com a posição de cada lacuna marcada ([1], [2]…) e a
// lista de opções de cada uma lida da página. Uma pergunta de escolha ("choice")
// por lacuna, na MESMA chamada.
//
// `entrada.lacunas`: lista (uma por lacuna) de listas de textos de opção.
function quizJevMontarPedidoLacunas(entrada) {
  var listas = entrada.lacunas;
  if (!listas.length) throw new Error("Não encontrei lacunas para preencher.");
  var perguntas = {};
  var mapas = [];
  for (var i = 0; i < listas.length; i++) {
    var n = i + 1;
    if (listas[i].length < QUIZ_JEV_MIN_ALTERNATIVAS) throw new Error("A lacuna " + n + " tem menos de duas opções.");
    var criterios = {};
    var mapa = {};
    for (var j = 0; j < listas[i].length; j++) {
      var rotulo = String.fromCharCode(65 + j);
      mapa[rotulo] = listas[i][j];
      criterios[rotulo] = "completa a lacuna [" + n + "] com «" + listas[i][j] + "»";
    }
    mapas.push(mapa);
    perguntas["lacuna_" + n] = { type: "choice", instructions: "Qual opção completa corretamente a lacuna [" + n + "] do texto?", criteria: criterios };
  }
  var corpo = { model: QUIZ_JEV_MODELO, state: entrada.pergunta || "", questions: perguntas };
  if (entrada.imagem) {
    var formato = quizJevFormatoDaImagem(entrada.imagem.mime);
    if (!formato) throw new Error("O Jev só aceita imagem PNG ou JPEG.");
    var marcador = quizJevMarcadorDeImagem();
    corpo.state = entrada.pergunta ? [entrada.pergunta, marcador] : [marcador];
    corpo.assets = {};
    corpo.assets[marcador] = { type: "image", format: formato, data_base64: entrada.imagem.base64 };
  }
  return { corpo: corpo, opcoes: {}, lacunas: mapas, generico: false, julgamento: false, precisaHeaderImagem: !!entrada.imagem };
}

function quizJevInterpretarLacunas(bruto, mapas) {
  var respostas = (bruto && bruto.answers) || {};
  var itens = [];
  for (var i = 0; i < mapas.length; i++) {
    var n = i + 1;
    var item = respostas["lacuna_" + n];
    if (!item) throw new Error("O Jev não respondeu a lacuna " + n + ".");
    var escolha = item.choice;
    if (!escolha || !Object.prototype.hasOwnProperty.call(mapas[i], escolha)) {
      throw new Error("O Jev devolveu uma opção desconhecida na lacuna " + n + ".");
    }
    var prob = item.probabilities && typeof item.probabilities[escolha] === "number" ? item.probabilities[escolha] : item.confidence || 0;
    itens.push({ n: n, label: escolha, texto: mapas[i][escolha], prob: prob });
  }
  return { kind: "lacunas", itens: itens, source: "jev", parsed: { options: {} } };
}

// Uma pergunta sim/não ("noul") por afirmativa, na MESMA chamada: o Jev devolve,
// pra cada uma, a probabilidade de "true" (a afirmativa estar certa).
function quizJevMontarPedidoJulgamento(entrada, opcoes) {
  var ordem = entrada.ordem || Object.keys(opcoes);
  var perguntas = {};
  for (var i = 0; i < ordem.length; i++) {
    var r = ordem[i];
    perguntas["alt_" + r] = {
      type: "noul",
      instructions: "A afirmativa " + r + " está correta?",
      criteria: {
        "true": "a afirmativa «" + opcoes[r] + "» está correta",
        "false": "a afirmativa «" + opcoes[r] + "» está incorreta",
      },
    };
  }
  var corpo = { model: QUIZ_JEV_MODELO, state: entrada.pergunta || "", questions: perguntas };
  if (entrada.imagem) {
    var formato = quizJevFormatoDaImagem(entrada.imagem.mime);
    if (!formato) throw new Error("O Jev só aceita imagem PNG ou JPEG.");
    var marcador = quizJevMarcadorDeImagem();
    corpo.state = entrada.pergunta ? [entrada.pergunta, marcador] : [marcador];
    corpo.assets = {};
    corpo.assets[marcador] = { type: "image", format: formato, data_base64: entrada.imagem.base64 };
  }
  return { corpo: corpo, opcoes: opcoes, ordem: ordem, generico: false, julgamento: true, precisaHeaderImagem: !!entrada.imagem };
}

function quizJevInterpretarJulgamento(bruto, opcoes) {
  var respostas = (bruto && bruto.answers) || {};
  var itens = [];
  for (var r in opcoes) {
    if (!Object.prototype.hasOwnProperty.call(opcoes, r)) continue;
    var item = respostas["alt_" + r];
    // Formato medido em produção: {"type":"noul","noul":0.86} — probabilidade de "true".
    if (!item || typeof item.noul !== "number") throw new Error("O Jev não respondeu a afirmativa " + r + ".");
    itens.push({ label: r, texto: opcoes[r], certo: item.noul >= 0.5, prob: item.noul });
  }
  if (!itens.length) throw new Error("O Jev respondeu num formato inesperado.");
  return { kind: "julgamento", itens: itens, source: "jev", parsed: { options: opcoes } };
}

// Converte a resposta do Jev no objeto que o card (quizJevMontarResposta)
// espera. Lança Error se a resposta não serve — melhor erro que uma letra que
// não existe na prova.
function quizJevInterpretarRespostaJev(bruto, opcoes, generico, julgamento, lacunas) {
  if (lacunas) return quizJevInterpretarLacunas(bruto, lacunas);
  if (julgamento) return quizJevInterpretarJulgamento(bruto, opcoes);
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

// ---- Preencher na página: qual botão (radio) clicar ----
// Só a decisão, sem DOM: o bookmarklet lê os rótulos dos botões da página e
// pergunta aqui qual deles corresponde à resposta. Na dúvida devolve -1 — melhor
// não marcar nada do que marcar o botão errado.

// Minúsculas, sem acento nem pontuação: "ERRADO." e "Não" viram "errado" e "nao".
function quizJevNormalizar(t) {
  return String(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^ | $/g, "");
}

var QUIZ_JEV_RE_ROTULO_CERTO = /^(certo|certa|verdadeiro|verdadeira|v|sim|correto|correta)$/;
var QUIZ_JEV_RE_ROTULO_ERRADO = /^(errado|errada|falso|falsa|f|nao|incorreto|incorreta)$/;

// `rotulos`: texto de cada botão de um grupo (Certo/Errado, V/F…). Devolve o
// índice do botão do veredito (certo: true/false), ou -1.
function quizJevIndiceDoVeredito(rotulos, certo) {
  var padrao = certo ? QUIZ_JEV_RE_ROTULO_CERTO : QUIZ_JEV_RE_ROTULO_ERRADO;
  for (var i = 0; i < rotulos.length; i++) if (padrao.test(quizJevNormalizar(rotulos[i]))) return i;
  return -1;
}

// `rotulos`: texto de cada botão de alternativa. Devolve o índice do botão da
// alternativa `letra`, ou -1. Procura, nesta ordem: o texto exato da opção (com
// ou sem o "A)" na frente), um rótulo que a contém, só a letra, e por fim a
// posição — esta só quando os botões não têm texto nenhum e são tantos quanto as
// opções.
function quizJevIndiceDaAlternativa(rotulos, opcoes, letra) {
  var alvo = quizJevNormalizar(opcoes[letra] || "");
  var limpos = [];
  for (var i = 0; i < rotulos.length; i++) {
    limpos.push(quizJevNormalizar(String(rotulos[i]).replace(/^\s*\(?([A-Ea-e]|[1-9])\s*[\)\.\-:]\s+/, "")));
  }
  var achados = [];
  var j;
  for (j = 0; j < limpos.length; j++) if (alvo && limpos[j] === alvo) achados.push(j);
  if (achados.length === 1) return achados[0];
  if (achados.length > 1) return -1;
  if (alvo.length >= 2) {
    for (j = 0; j < limpos.length; j++) if (limpos[j].indexOf(alvo) !== -1) achados.push(j);
    if (achados.length === 1) return achados[0];
    if (achados.length > 1) return -1;
  }
  var soLetra = quizJevNormalizar(letra);
  for (j = 0; j < rotulos.length; j++) if (quizJevNormalizar(rotulos[j]) === soLetra) achados.push(j);
  if (achados.length === 1) return achados[0];
  var chaves = Object.keys(opcoes);
  var todosVazios = rotulos.length > 0;
  for (j = 0; j < rotulos.length; j++) if (quizJevNormalizar(rotulos[j]) !== "") todosVazios = false;
  if (todosVazios && rotulos.length === chaves.length) return chaves.indexOf(letra);
  return -1;
}

// Texto curto da resposta, pra pastilha do card recolhido ("Quiz Jev · B"). Serve
// aos dois modos (api-go e Jev): conhece todos os tipos de resposta do card.
function quizJevResumoDaResposta(d) {
  if (!d) return "";
  if (d.kind === "julgamento") {
    var marcas = [];
    for (var i = 0; i < d.itens.length; i++) marcas.push(d.itens[i].certo ? "✓" : "✗");
    return marcas.join(" ");
  }
  if (d.kind === "lacunas") return d.itens.length + (d.itens.length === 1 ? " lacuna" : " lacunas");
  if (d.kind === "multipla") return d.answers && d.answers.length ? d.answers.join(" · ") : "—";
  return d.answer ? d.answer : "resposta";
}

function quizJevMensagemHttpJev(status, corpo) {
  if (status === 401 || status === 403) return "A chave do Jev foi recusada. Confira se ela está correta.";
  if (status === 402 || status === 429) return "A conta do Jev está sem saldo ou atingiu o limite de uso.";
  if (status === 413) return "A imagem é grande demais para o Jev.";
  // O Jev costuma explicar o 400 no corpo (campo de erro/mensagem): mostra o começo.
  var detalhe = "";
  if (corpo && typeof corpo === "object") {
    var bruto = (corpo.detail && corpo.detail.message) || corpo.error || corpo.message || corpo.detail || corpo.errors;
    if (bruto) detalhe = typeof bruto === "string" ? bruto : JSON.stringify(bruto);
  }
  detalhe = detalhe.replace(/\s+/g, " ");
  if (detalhe.length > 220) detalhe = detalhe.slice(0, 220) + "…";
  return "O Jev respondeu com erro (HTTP " + status + ")." + (detalhe ? " " + detalhe : "");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    quizJevSepararQuestao: quizJevSepararQuestao,
    quizJevDetectarJulgamento: quizJevDetectarJulgamento,
    quizJevResumoDaResposta: quizJevResumoDaResposta,
    quizJevIndiceDoVeredito: quizJevIndiceDoVeredito,
    quizJevIndiceDaAlternativa: quizJevIndiceDaAlternativa,
    quizJevMontarPedidoJev: quizJevMontarPedidoJev,
    quizJevAjustarTamanhoJev: quizJevAjustarTamanhoJev,
    quizJevInterpretarRespostaJev: quizJevInterpretarRespostaJev,
    quizJevMensagemHttpJev: quizJevMensagemHttpJev,
  };
}
