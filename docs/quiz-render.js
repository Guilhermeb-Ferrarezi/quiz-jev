// Visual do card (CSS + funções de montagem do DOM) do Quiz Jev, para o
// BOOKMARKLET e o RELAY. É uma cópia deliberada do visual de src/content.js
// (Shadow DOM, badges, barras, "Consultando" com bolinhas) — não um import
// dele: a extensão continua com o próprio código, intocado. Ver README.md,
// seção "Bookmarklet", para o porquê da duplicação em vez de extração.
//
// Este arquivo NÃO usa import/export, de propósito, para servir dois
// consumidores diferentes sem nenhuma etapa de build no meio:
//
//   1. Concatenado por bookmarklet/build.js dentro do IIFE do bookmarklet —
//      vira escopo de função, local àquele fechamento.
//   2. Carregado como <script src="quiz-render.js"> comum (sem type=module)
//      em docs/relay.html — vira escopo global (window), sem CSP restritiva
//      nenhuma porque é a NOSSA página, não o site da prova.
//
// Por isso: só `function` (hoisted) e `var` no nível superior, nunca
// `const`/`let` de topo (evita "already declared" se algum dia for incluído
// duas vezes na mesma página) e nenhuma referência a globais que só existem
// num dos dois contextos.

var QUIZ_JEV_CSS = [
  ":host { all: initial; }",
  "@keyframes quizJevIn { from { opacity: 0; transform: translateY(-10px) scale(.94); } to { opacity: 1; transform: none; } }",
  "@keyframes quizJevOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-4px) scale(.97); } }",
  "@keyframes quizJevShake { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(2px); } 30%, 50%, 70% { transform: translateX(-4px); } 40%, 60% { transform: translateX(4px); } }",
  "@keyframes quizJevPop { 0% { opacity: 0; transform: scale(.6); text-shadow: 0 0 0 rgba(37,99,235,0); } 55% { opacity: 1; transform: scale(1.12); text-shadow: 0 0 16px rgba(37,99,235,.6); } 100% { opacity: 1; transform: scale(1); text-shadow: 0 0 0 rgba(37,99,235,0); } }",
  "@keyframes quizJevItemIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }",
  "@keyframes quizJevShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }",
  "@keyframes quizJevBolinha { 0%, 60%, 100% { transform: translateY(0); opacity: .35; } 30% { transform: translateY(-5px); opacity: 1; } }",
  "@keyframes quizJevBorda { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }",
  ".card { position: fixed; z-index: 2147483647; max-width: 340px; max-height: min(60vh, 420px); overflow-y: auto; font: 14px/1.45 system-ui, sans-serif; color: #111; background: #fff; border: 1px solid #d4d4d8; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 12px 14px; animation: quizJevIn 350ms cubic-bezier(.34,1.56,.64,1); box-sizing: border-box; }",
  ".card.fechando { animation: quizJevOut 120ms ease-in forwards; }",
  ".card.erro-anim { animation: quizJevShake 320ms ease-in-out; }",
  ".card.aberta { max-width: 420px; }",
  ".card.carregando-ativo { overflow: hidden; }",
  ".card.carregando-ativo::before { content: \"\"; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: linear-gradient(115deg, transparent 35%, rgba(37,99,235,.16) 50%, transparent 65%); background-size: 200% 100%; animation: quizJevShimmer 1.4s linear infinite; }",
  ".linha { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }",
  ".letra { font-size: 28px; font-weight: 700; line-height: 1; display: inline-flex; align-items: baseline; }",
  ".letra-pop, .letra-item { display: inline-block; animation: quizJevPop 450ms cubic-bezier(.34,1.56,.64,1) backwards; }",
  ".letra-separador { opacity: .55; }",
  ".texto { flex: 1; }",
  ".item-cascata { animation: quizJevItemIn 240ms ease-out backwards; }",
  ".texto-aberta { flex-basis: 100%; line-height: 1.55; }",
  ".badge { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px; border-radius: 999px; background: #e4e4e7; color: #3f3f46; }",
  ".badge.claude { background: #ede9fe; color: #5b21b6; }",
  ".badge.imagem { background: #dcfce7; color: #166534; }",
  ".aviso { margin-top: 8px; font-size: 12px; color: #92400e; }",
  ".motivo { margin-top: 8px; font-size: 13px; color: #3f3f46; }",
  ".opcoes-multipla { margin-top: 8px; display: grid; gap: 5px; }",
  ".opcao-marcada { display: flex; gap: 8px; align-items: baseline; font-size: 13px; }",
  ".opcao-letra { font-weight: 700; flex: 0 0 auto; }",
  ".opcao-texto { flex: 1; color: #3f3f46; }",
  ".barras { margin-top: 10px; display: grid; gap: 3px; }",
  ".barra { display: grid; grid-template-columns: 18px 1fr 38px; gap: 6px; align-items: center; font-size: 12px; color: #52525b; }",
  ".barra i { display: block; height: 6px; border-radius: 3px; background: #a1a1aa; width: 0; transition: width 420ms cubic-bezier(.16,1,.3,1); }",
  ".barra.escolhida i { background: #2563eb; }",
  ".erro { color: #b91c1c; }",
  ".carregando { position: relative; z-index: 1; display: flex; align-items: center; color: #2563eb; font-size: 13px; font-weight: 500; }",
  ".pontos { display: inline-flex; align-items: flex-end; gap: 3px; margin-left: 5px; height: 1em; padding-bottom: 2px; }",
  ".pontos i { display: block; width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: quizJevBolinha 900ms ease-in-out infinite; }",
  ".pontos i:nth-child(2) { animation-delay: .15s; }",
  ".pontos i:nth-child(3) { animation-delay: .3s; }",
  ".card.carregando-ativo::after { content: \"\"; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 1.5px rgba(37,99,235,.9), 0 0 14px rgba(37,99,235,.35); animation: quizJevBorda 1.4s ease-in-out infinite; }",
  ".progresso { position: relative; z-index: 1; margin-top: 10px; height: 3px; border-radius: 999px; background: #e4e4e7; overflow: hidden; }",
  ".progresso i { display: block; height: 100%; width: 0; background: #2563eb; border-radius: 999px; transition: width 400ms ease-out; }",
  ".dica { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e4e4e7; font-size: 11px; color: #a1a1aa; }",
  ".dica kbd { font: inherit; padding: 1px 5px; border-radius: 4px; background: #f4f4f5; border: 1px solid #e4e4e7; color: #52525b; }",
  ".pergunta-label { font-size: 13px; color: #3f3f46; margin-bottom: 6px; }",
  ".pergunta-input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 60px; font: inherit; padding: 8px; border: 1px solid #d4d4d8; border-radius: 8px; background: #fff; color: #111; }",
  ".pergunta-input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }",
  ".pergunta-dica { margin-top: 6px; font-size: 11px; color: #a1a1aa; }",
  ".botao-relay { margin-top: 10px; display: inline-block; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 7px; border: 1px solid #2563eb; background: #eff6ff; color: #1d4ed8; cursor: pointer; }",
  ".botao-relay:hover { background: #dbeafe; }",
  "@media (prefers-color-scheme: dark) { .card { background: #18181b; color: #fafafa; border-color: #3f3f46; } .motivo { color: #d4d4d8; } .badge { background: #3f3f46; color: #e4e4e7; } .badge.claude { background: #4c1d95; color: #ddd6fe; } .badge.imagem { background: #14532d; color: #bbf7d0; } .carregando { color: #60a5fa; } .card.carregando-ativo::after { box-shadow: inset 0 0 0 1.5px rgba(96,165,250,.9), 0 0 16px rgba(96,165,250,.35); } .card.carregando-ativo::before { background: linear-gradient(115deg, transparent 35%, rgba(96,165,250,.18) 50%, transparent 65%); } .progresso { background: #3f3f46; } .dica { border-color: #3f3f46; } .dica kbd { background: #27272a; border-color: #3f3f46; color: #d4d4d8; } .pergunta-label { color: #d4d4d8; } .pergunta-input { background: #27272a; border-color: #3f3f46; color: #fafafa; } .botao-relay { background: #1e293b; border-color: #60a5fa; color: #93c5fd; } .botao-relay:hover { background: #1e3a5f; } }",
  "@media (prefers-reduced-motion: reduce) { .card, .card.fechando, .card.erro-anim, .letra-pop, .letra-item, .item-cascata { animation: none !important; } .card.carregando-ativo::before { animation: none !important; opacity: 0; } .pontos i, .card.carregando-ativo::after { animation: none !important; } .barra i, .progresso i { transition: none !important; } }"
].join("\n");

// Nó de DOM com texto via textContent — nunca innerHTML (ver README/regra de
// segurança: d.answerText/d.reasoning/mensagem de erro vêm da rede).
function quizJevEl(tag, className, texto) {
  var n = document.createElement(tag);
  if (className) n.className = className;
  if (texto !== null && texto !== undefined) n.textContent = texto;
  return n;
}

function quizJevLimpar(card) {
  while (card.firstChild) card.removeChild(card.firstChild);
}

function quizJevBarras(probs, escolhidas) {
  if (!probs) return null;
  var container = quizJevEl("div", "barras");
  var itens = [];
  for (var k in probs) if (Object.prototype.hasOwnProperty.call(probs, k)) itens.push([k, probs[k]]);
  itens.sort(function (a, b) { return b[1] - a[1]; });
  var paraAnimar = [];
  for (var i = 0; i < itens.length; i++) {
    var label = itens[i][0];
    var p = itens[i][1];
    var pct = Math.round(p * 100);
    var linha = quizJevEl("div", "barra" + (escolhidas.indexOf(label) !== -1 ? " escolhida" : ""));
    linha.appendChild(quizJevEl("span", null, label));
    var barra = document.createElement("i");
    linha.appendChild(barra);
    paraAnimar.push([barra, pct]);
    linha.appendChild(quizJevEl("span", null, pct + "%"));
    container.appendChild(linha);
  }
  requestAnimationFrame(function () {
    for (var j = 0; j < paraAnimar.length; j++) paraAnimar[j][0].style.width = paraAnimar[j][1] + "%";
  });
  return container;
}

function quizJevTruncar(texto, max) {
  if (texto.length <= max) return texto;
  return texto.slice(0, max - 1).replace(/\s+$/, "") + "…";
}

function quizJevTextoDaOpcao(opcoes, label) {
  if (!opcoes) return "";
  if (Object.prototype.toString.call(opcoes) === "[object Array]") {
    for (var i = 0; i < opcoes.length; i++) {
      var o = opcoes[i];
      if (o && (o.label === label || o.letra === label)) return o.text || o.texto || "";
    }
    return "";
  }
  return opcoes[label] || "";
}

function quizJevDica(texto) {
  var d = quizJevEl("div", "dica");
  if (texto) {
    d.appendChild(document.createTextNode(texto));
  } else {
    d.appendChild(document.createTextNode("Pressione "));
    d.appendChild(quizJevEl("kbd", null, "T"));
    d.appendChild(document.createTextNode(" para perguntar mais sobre este assunto"));
  }
  return d;
}

// Monta o conteúdo de resposta dentro de `card` (já limpo por quem chama).
// Mesma lógica de src/content.js:mostrarResposta, adaptada pra sem cascata de
// altura animada (o bookmarklet troca o conteúdo de uma vez, sem a
// transição de altura suave da extensão — simplificação deliberada).
function quizJevMontarResposta(card, d, comImagem, imagemFalhou) {
  card.classList.remove("carregando-ativo");
  var multipla = d.kind === "multipla";
  var aberta = !multipla && (d.kind === "aberta" || !d.answer);
  card.classList.toggle("aberta", aberta || multipla);
  var badge = d.source === "claude" ? "claude" : "jev";
  var linha = quizJevEl("div", "linha");
  var marcadas = multipla && Object.prototype.toString.call(d.answers) === "[object Array]" ? d.answers : [];

  var atrasoCascata = 60;
  function emCascata(elemento) {
    elemento.classList.add("item-cascata");
    elemento.style.animationDelay = atrasoCascata + "ms";
    atrasoCascata += 60;
    return elemento;
  }

  if (multipla) {
    var letraContainer = quizJevEl("span", "letra");
    if (marcadas.length) {
      for (var i = 0; i < marcadas.length; i++) {
        if (i > 0) letraContainer.appendChild(quizJevEl("span", "letra-separador", " · "));
        var item = quizJevEl("span", "letra-item", marcadas[i]);
        item.style.animationDelay = i * 80 + "ms";
        letraContainer.appendChild(item);
      }
    } else {
      letraContainer.appendChild(document.createTextNode("—"));
    }
    linha.appendChild(letraContainer);
    linha.appendChild(emCascata(quizJevEl("span", "badge " + badge, badge)));
    linha.appendChild(emCascata(quizJevEl("span", "badge", "várias corretas")));
  } else if (aberta) {
    linha.appendChild(emCascata(quizJevEl("span", "texto texto-aberta", d.answerText || "")));
    linha.appendChild(emCascata(quizJevEl("span", "badge " + badge, badge)));
  } else {
    linha.appendChild(quizJevEl("span", "letra letra-pop", d.answer));
    linha.appendChild(emCascata(quizJevEl("span", "texto", d.answerText || "")));
    linha.appendChild(emCascata(quizJevEl("span", "badge " + badge, badge)));
  }
  if (comImagem) linha.appendChild(emCascata(quizJevEl("span", "badge imagem", "figura")));
  card.appendChild(linha);

  if (multipla) {
    var opcoes = d.parsed && d.parsed.options;
    if (marcadas.length) {
      var lista = emCascata(quizJevEl("div", "opcoes-multipla"));
      for (var m = 0; m < marcadas.length; m++) {
        var label = marcadas[m];
        var op = quizJevEl("div", "opcao-marcada");
        op.appendChild(quizJevEl("span", "opcao-letra", label));
        op.appendChild(quizJevEl("span", "opcao-texto", quizJevTruncar(quizJevTextoDaOpcao(opcoes, label), 120)));
        lista.appendChild(op);
      }
      card.appendChild(lista);
    } else {
      card.appendChild(emCascata(quizJevEl("div", "motivo", "Nenhuma alternativa passou do limiar.")));
    }
  }

  if (d.degraded) {
    card.appendChild(emCascata(quizJevEl("div", "aviso", "Confiança baixa — o segundo modelo não respondeu.")));
  }
  if (imagemFalhou) {
    card.appendChild(emCascata(quizJevEl("div", "aviso", "Não consegui enviar a figura desta questão — respondida só com o texto.")));
  }
  if (d.reasoning) {
    card.appendChild(emCascata(quizJevEl("div", "motivo", d.reasoning)));
  }
  var probs = multipla ? d.answerProbs : d.probabilities;
  var escolhidas = multipla ? marcadas : [d.answer];
  var b = quizJevBarras(probs, escolhidas);
  if (b) {
    var filhos = [];
    for (var c = 0; c < b.children.length; c++) filhos.push(b.children[c]);
    for (var f = 0; f < filhos.length; f++) emCascata(filhos[f]);
    card.appendChild(b);
  }
  card.appendChild(quizJevDica());
}

function quizJevMontarErro(card, mensagem) {
  card.classList.remove("carregando-ativo");
  card.appendChild(quizJevEl("div", "erro", mensagem || "falhou"));
  card.appendChild(quizJevDica());
  card.classList.remove("erro-anim");
  void card.offsetWidth;
  card.classList.add("erro-anim");
}

function quizJevMontarCarregando(card, texto) {
  card.classList.add("carregando-ativo");
  var linha = quizJevEl("div", "carregando", texto.replace(/(…|\.{3})\s*$/, ""));
  var pontos = quizJevEl("span", "pontos");
  for (var i = 0; i < 3; i++) pontos.appendChild(document.createElement("i"));
  linha.appendChild(pontos);
  card.appendChild(linha);
}
