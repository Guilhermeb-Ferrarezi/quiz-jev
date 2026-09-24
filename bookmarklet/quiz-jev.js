// Bookmarklet do Quiz Jev — reproduz o comportamento de src/content.js e
// src/background.js SEM as APIs de extensão (scripting, tabs.captureVisibleTab,
// storage). Roda direto na página da prova, então tudo aqui tem que sobreviver
// a uma CSP restritiva (`connect-src`/`style-src` bloqueando a origem da API e
// até <style> inline).
//
// Este arquivo não é a URL `javascript:` final — é a FONTE legível. Quem gera
// o bookmarklet é bookmarklet/build.js, que concatena render-shared.js (visual
// do card, ver esse arquivo) + este arquivo dentro de um único IIFE e
// minifica o resultado. Por isso aqui não há `import`/`export` nem uma função
// de topo própria: tudo assume que já está dentro do IIFE do bookmarklet, com
// as funções de render-shared.js (quizJevEl, quizJevMontarResposta, …) já no
// mesmo escopo.
//
// A CHAVE do usuário entra como literal de string substituído pela página de
// instalação (docs/index.html) — nunca lida de rede, nunca fica em arquivo
// nenhum do repositório.
var QUIZ_KEY = "__QUIZ_KEY__";
quizJevTemAtalhoT = true;

var QUIZ_JEV_API = "https://api.santos-tech.com/quiz/answer";
var QUIZ_JEV_RELAY = "https://guilhermeb-ferrarezi.github.io/quiz-jev/relay.html";
var QUIZ_JEV_ID = "__quiz-jev-bookmarklet";
var QUIZ_JEV_TAMANHO_MINIMO_PX = 40;
var QUIZ_JEV_MIMES_DIRETOS = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Contexto da seleção atual (raw, rect, imagem já resolvida e o próprio
// card) — igual ao ctxAtual da extensão: vive enquanto o card está aberto, e
// é o que a tecla T usa pra abrir a pergunta livre sem seleção nova.
var quizJevCtxAtual = null;

// Detecta violação de connect-src via CSP — um sinal a mais (além do fetch()
// rejeitado) de que o site está bloqueando a chamada à API. Registrado uma
// vez só, no primeiro carregamento do bookmarklet nesta página.
document.addEventListener("securitypolicyviolation", function (ev) {
  if (ev.violatedDirective && ev.violatedDirective.indexOf("connect-src") === 0) {
    quizJevCtxAtual && (quizJevCtxAtual.violacaoConnectSrc = true);
  }
});

function quizJevFecharImediato() {
  var host = document.getElementById(QUIZ_JEV_ID);
  if (host && host.parentNode) host.parentNode.removeChild(host);
  document.removeEventListener("keydown", quizJevAoTeclar, true);
  document.removeEventListener("mousedown", quizJevAoClicar, true);
  quizJevCtxAtual = null;
}

function quizJevFechar() {
  var host = document.getElementById(QUIZ_JEV_ID);
  quizJevCtxAtual = null;
  document.removeEventListener("keydown", quizJevAoTeclar, true);
  document.removeEventListener("mousedown", quizJevAoClicar, true);
  if (!host) return;
  if (host.getAttribute("data-fechando")) return;
  host.setAttribute("data-fechando", "1");
  var shadow = host.shadowRoot;
  var card = shadow ? shadow.querySelector(".card") : null;
  if (!card) {
    if (host.parentNode) host.parentNode.removeChild(host);
    return;
  }
  card.classList.add("fechando");
  var remover = function () {
    if (host.parentNode) host.parentNode.removeChild(host);
  };
  card.addEventListener("animationend", remover, { once: true });
  setTimeout(remover, 200);
}

function quizJevAoTeclar(e) {
  if (e.key === "Escape") {
    quizJevFechar();
    return;
  }
  if ((e.key === "t" || e.key === "T") && quizJevCtxAtual && !quizJevCtxAtual.perguntando) {
    e.preventDefault();
    quizJevAbrirPerguntar();
  }
}

function quizJevAoClicar(e) {
  var host = document.getElementById(QUIZ_JEV_ID);
  if (host && (!e.composedPath || e.composedPath().indexOf(host) === -1)) quizJevFechar();
}

function quizJevPosicionar(card, rect) {
  var altura = card.offsetHeight || 40;
  var largura = card.offsetWidth || 340;
  var topo = rect.bottom + 8;
  if (topo + altura > window.innerHeight - 8) {
    var acima = rect.top - 8 - altura;
    topo = acima >= 8 ? acima : Math.max(8, window.innerHeight - altura - 8);
  }
  var esq = Math.min(rect.left, window.innerWidth - largura - 8);
  card.style.top = Math.max(8, topo) + "px";
  card.style.left = Math.max(8, esq) + "px";
}

// Cria o overlay em Shadow DOM. Preferência de estilo: adoptedStyleSheets
// (CSSStyleSheet + replaceSync) — folha "construída" que, na prática, não é
// barrada por `style-src` (não é um recurso carregado, é aplicada via API).
// Sem suporte (ou se o construtor lançar por algum motivo), cai pra <style>
// normal dentro do shadow root. Se o attachShadow em si falhar (navegador
// muito antigo, ou a página tiver feito algo hostil com os prototypes),
// propaga a exceção — quem chama (quizJevRun) trata isso como "não deu pra
// desenhar o card" e vai direto pro plano B.
function quizJevCriarCard(rect) {
  quizJevFecharImediato();
  var host = document.createElement("div");
  host.id = QUIZ_JEV_ID;
  var shadow = host.attachShadow({ mode: "open" });
  var aplicouFolha = false;
  if (shadow.adoptedStyleSheets !== undefined && typeof CSSStyleSheet === "function") {
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(QUIZ_JEV_CSS);
      shadow.adoptedStyleSheets = [sheet];
      aplicouFolha = true;
    } catch (e) {
      aplicouFolha = false;
    }
  }
  if (!aplicouFolha) {
    var style = document.createElement("style");
    style.textContent = QUIZ_JEV_CSS;
    shadow.appendChild(style);
  }
  var card = document.createElement("div");
  card.className = "card";
  shadow.appendChild(card);
  document.body.appendChild(host);
  quizJevPosicionar(card, rect);
  document.addEventListener("keydown", quizJevAoTeclar, true);
  document.addEventListener("mousedown", quizJevAoClicar, true);
  return { host: host, shadow: shadow, card: card };
}

// ---- Detecção de conteúdo visual na seleção ----
// Mesma ideia de encontrarElementosVisuais (src/content.js): só olha dentro
// do ancestral comum da seleção e confirma com range.intersectsNode(). Mas o
// bookmarklet, sem tabs.captureVisibleTab, só tem DUAS formas de conseguir
// bytes de imagem: ler o arquivo (<img>/<picture>) ou ler um <canvas> que já
// existe na página. Sem API de print de tela, então TABLE/SVG/MATH/VIDEO/
// background-image (que a extensão cobre fotografando a tela) ficam de fora
// aqui — escopo reduzido deliberado, documentado no README.
function quizJevElementoVisualRelevante(elemento) {
  var r = elemento.getBoundingClientRect();
  return r.width >= QUIZ_JEV_TAMANHO_MINIMO_PX && r.height >= QUIZ_JEV_TAMANHO_MINIMO_PX;
}

function quizJevEncontrarElementosVisuais(range) {
  var raiz = range.commonAncestorContainer;
  if (raiz.nodeType !== Node.ELEMENT_NODE) raiz = raiz.parentElement;
  if (!raiz) return [];
  var candidatos = [];
  if (
    (raiz.tagName === "IMG" || raiz.tagName === "PICTURE" || raiz.tagName === "CANVAS") &&
    quizJevElementoVisualRelevante(raiz) &&
    range.intersectsNode(raiz)
  ) {
    candidatos.push(raiz);
  }
  var todos = raiz.querySelectorAll ? raiz.querySelectorAll("img, picture, canvas") : [];
  for (var i = 0; i < todos.length; i++) {
    var el2 = todos[i];
    if (quizJevElementoVisualRelevante(el2) && range.intersectsNode(el2)) candidatos.push(el2);
  }
  return candidatos;
}

function quizJevCanvasParaBase64(canvas) {
  try {
    var dataUrl = canvas.toDataURL("image/png");
    return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/png" };
  } catch (e) {
    // canvas "tainted" — cross-origin sem CORS, desiste dos bytes
    return null;
  }
}

function quizJevBlobParaBase64(blob) {
  return blob.arrayBuffer().then(function (buffer) {
    var bytes = new Uint8Array(buffer);
    var binario = "";
    var BLOCO = 0x8000;
    for (var i = 0; i < bytes.length; i += BLOCO) {
      binario += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCO));
    }
    return btoa(binario);
  });
}

function quizJevBlobParaCanvasBase64(blob) {
  var url = URL.createObjectURL(blob);
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(quizJevCanvasParaBase64(canvas));
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Tenta obter os bytes de UM elemento visual: fetch → base64 primeiro
// (arquivo original, igual à extensão); se falhar (rede, CORS, ou o site
// bloqueando `connect-src` pro domínio da imagem), tenta desenhar a <img> já
// carregada num canvas. Um <canvas> da própria página vai direto pro
// toDataURL. Retorna {base64,mime} ou null (nunca lança).
function quizJevObterBytes(elemento) {
  if (elemento.tagName === "CANVAS") {
    return Promise.resolve(quizJevCanvasParaBase64(elemento));
  }
  var img = elemento.tagName === "IMG" ? elemento : elemento.querySelector && elemento.querySelector("img");
  if (!img) return Promise.resolve(null);
  var pronto =
    img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode ? img.decode().catch(function () {}) : Promise.resolve();
  return pronto.then(function () {
    var src = img.currentSrc || img.src;
    if (!src) return null;
    return fetch(src)
      .then(function (res) {
        if (!res.ok) throw new Error("http " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        if (QUIZ_JEV_MIMES_DIRETOS.indexOf(blob.type) !== -1) {
          return quizJevBlobParaBase64(blob).then(function (base64) {
            return { base64: base64, mime: blob.type };
          });
        }
        return quizJevBlobParaCanvasBase64(blob);
      })
      .catch(function () {
        if (!img.naturalWidth || !img.naturalHeight) return null;
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return quizJevCanvasParaBase64(canvas);
      });
  });
}

// Resolve a imagem da seleção: usa só o PRIMEIRO elemento visual encontrado
// (a extensão empilha vários e costura print de tela — sem essa API aqui, o
// bookmarklet fica no caso comum de uma figura por questão). Se não
// conseguir os bytes, cai pro endereço absoluto (imageUrl) — o servidor
// baixa por conta própria.
function quizJevResolverImagem(visuais) {
  var alvo = visuais[0];
  return quizJevObterBytes(alvo).then(function (r) {
    if (r) return { base64: r.base64, mime: r.mime };
    var img = alvo.tagName === "IMG" ? alvo : alvo.querySelector && alvo.querySelector("img");
    var src = img ? img.currentSrc || img.src : null;
    return src ? { url: src } : null;
  });
}

// ---- Chamada à API ----
function quizJevChamarApi(payload) {
  return fetch(QUIZ_JEV_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Quiz-Key": QUIZ_KEY },
    body: JSON.stringify(payload),
  }).then(function (res) {
    return res
      .json()
      .catch(function () {
        return {};
      })
      .then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || "erro " + res.status);
          // chegou resposta do servidor — não é bloqueio de CSP/rede
          err.quizJevApiError = true;
          throw err;
        }
        return data;
      });
  });
}

// ---- Plano B: janela relay ----
// `janela`, se passada, é uma window já aberta NO MESMO TICK do gesto do
// usuário (caso "nem o card pôde ser desenhado" de quizJevRun). Senão, abre
// uma nova aqui — sempre a partir de um clique (botão "Abrir resposta em
// janela"), nunca depois de um `await`, então o bloqueador de pop-up não
// entra no caminho.
//
// `payloadOuPromise` pode ser o payload já pronto OU uma Promise dele (caso
// "sem card": a imagem ainda está sendo resolvida quando a janela abre). O
// listener de handshake é registrado JÁ, antes de esperar o payload — se
// fosse o contrário (esperar o payload pra só then registrar o listener), a
// janela relay poderia mandar "quizjev-pronto" antes de alguém estar
// escutando, e a mensagem se perderia pra sempre.
function quizJevAbrirRelay(payloadOuPromise, janela) {
  var w = janela || window.open(QUIZ_JEV_RELAY, "_blank", "width=380,height=560");
  if (!w) {
    quizJevAvisoSemCard("não consegui abrir a janela de resposta — permita pop-ups para este site e tente de novo.");
    return;
  }
  var enviado = false;
  var handler = function (ev) {
    if (ev.source !== w) return;
    if (!ev.data || ev.data.type !== "quizjev-pronto") return;
    if (enviado) return;
    enviado = true;
    window.removeEventListener("message", handler);
    Promise.resolve(payloadOuPromise).then(function (payload) {
      var msg = { raw: payload.raw, key: QUIZ_KEY };
      if (payload.ask) msg.ask = payload.ask;
      if (payload.imageBase64) {
        msg.imageBase64 = payload.imageBase64;
        msg.imageMime = payload.imageMime;
      } else if (payload.imageUrl) {
        msg.imageUrl = payload.imageUrl;
      }
      w.postMessage(msg, "*");
    });
  };
  window.addEventListener("message", handler);
}

// Aviso sem card (sem seleção, ou quando nem o Shadow DOM pôde ser criado) —
// tenta um elemento simples fora do shadow DOM; se até isso for bloqueado
// pela página, falha em silêncio (nada pior a fazer sem um `alert`, que o
// projeto evita por ser bloqueável/feio).
function quizJevAvisoSemCard(texto) {
  try {
    var div = document.createElement("div");
    div.textContent = "Quiz Jev: " + texto;
    div.setAttribute(
      "style",
      "position:fixed;z-index:2147483647;top:12px;right:12px;max-width:300px;" +
        "background:#18181b;color:#fff;padding:10px 14px;border-radius:8px;" +
        "font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);"
    );
    document.body.appendChild(div);
    setTimeout(function () {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 6000);
  } catch (e) {
    // nada mais a fazer
  }
}

function quizJevMostrarBotaoRelay(card, rect, payload) {
  quizJevLimpar(card);
  card.classList.remove("carregando-ativo");
  card.appendChild(
    quizJevEl("div", "erro", "Este site bloqueia a chamada direta (CSP). Abra a resposta numa janela separada:")
  );
  var botao = document.createElement("button");
  botao.type = "button";
  botao.className = "botao-relay";
  botao.textContent = "Abrir resposta em janela";
  botao.addEventListener("click", function () {
    quizJevAbrirRelay(payload);
    quizJevFechar();
  });
  card.appendChild(botao);
  quizJevPosicionar(card, rect);
}

// ---- Fluxo principal (equivalente a processarSelecao) ----
function quizJevProcessarComCard(raw, range, rect, ctxCard) {
  var card = ctxCard.card;
  quizJevMontarCarregando(card, "Consultando");
  quizJevPosicionar(card, rect);
  var contexto = { raw: raw, imageBase64: null, imageMime: null, imageUrl: null, perguntando: false, card: card, rect: rect };
  quizJevCtxAtual = contexto;

  var visuais = quizJevEncontrarElementosVisuais(range);
  var pImagem = visuais.length ? quizJevResolverImagem(visuais) : Promise.resolve(null);

  pImagem.then(function (img) {
    if (!document.getElementById(QUIZ_JEV_ID) || quizJevCtxAtual !== contexto) return;
    var payload = { raw: raw };
    var temImagem = false;
    var imagemFalhou = false;
    if (img && img.base64) {
      payload.imageBase64 = img.base64;
      payload.imageMime = img.mime;
      contexto.imageBase64 = img.base64;
      contexto.imageMime = img.mime;
      temImagem = true;
    } else if (img && img.url) {
      payload.imageUrl = img.url;
      contexto.imageUrl = img.url;
      temImagem = true;
    } else if (visuais.length) {
      imagemFalhou = true;
    }

    quizJevMontarCarregando(card, temImagem ? "Analisando a imagem" : "Consultando");
    quizJevPosicionar(card, rect);

    quizJevChamarApi(payload)
      .then(function (data) {
        if (!document.getElementById(QUIZ_JEV_ID) || quizJevCtxAtual !== contexto) return;
        quizJevLimpar(card);
        quizJevMontarResposta(card, data, temImagem, imagemFalhou);
        quizJevPosicionar(card, rect);
      })
      .catch(function (e) {
        if (!document.getElementById(QUIZ_JEV_ID) || quizJevCtxAtual !== contexto) return;
        if (e.quizJevApiError) {
          quizJevLimpar(card);
          quizJevMontarErro(card, e.message);
          quizJevPosicionar(card, rect);
        } else {
          // fetch rejeitou sem chegar a ter resposta HTTP: bloqueio de
          // connect-src ou rede fora do ar — plano B via botão (gesto novo).
          quizJevMostrarBotaoRelay(card, rect, payload);
        }
      });
  });
}

function quizJevProcessarSemCard(raw, range, janela) {
  var visuais = quizJevEncontrarElementosVisuais(range);
  var pImagem = visuais.length ? quizJevResolverImagem(visuais) : Promise.resolve(null);
  var payloadPromise = pImagem.then(function (img) {
    var payload = { raw: raw };
    if (img && img.base64) {
      payload.imageBase64 = img.base64;
      payload.imageMime = img.mime;
    } else if (img && img.url) {
      payload.imageUrl = img.url;
    }
    return payload;
  });
  // Passa a Promise, não o payload resolvido: quizJevAbrirRelay registra o
  // listener do handshake JÁ (síncrono), sem esperar a imagem terminar de
  // resolver — ver o comentário em quizJevAbrirRelay.
  quizJevAbrirRelay(payloadPromise, janela);
}

function quizJevRun() {
  var sel = window.getSelection();
  var raw = sel && sel.toString ? sel.toString().trim() : "";
  if (!raw) {
    quizJevAvisoSemCard("selecione o enunciado e as alternativas antes de usar o favorito.");
    return;
  }
  var range = sel.getRangeAt(0);
  var rect = range.getBoundingClientRect();

  var ctxCard;
  try {
    ctxCard = quizJevCriarCard(rect);
  } catch (e) {
    ctxCard = null;
  }

  if (!ctxCard) {
    // Último recurso: nem o overlay pôde ser desenhado — abre a janela relay
    // JÁ, ainda no mesmo tick do clique/tecla, antes de qualquer await.
    var w = window.open(QUIZ_JEV_RELAY, "_blank", "width=380,height=560");
    quizJevProcessarSemCard(raw, range, w);
    return;
  }

  quizJevProcessarComCard(raw, range, rect, ctxCard);
}

// Alt+Shift+Q: pergunta livre direta (equivalente a processarPerguntaDireta).
function quizJevProcessarPerguntaDireta() {
  var sel = window.getSelection();
  var raw = sel && sel.toString ? sel.toString().trim() : "";
  if (!raw) {
    quizJevAvisoSemCard("selecione um trecho antes de perguntar.");
    return;
  }
  var range = sel.getRangeAt(0);
  var rect = range.getBoundingClientRect();

  var ctxCard;
  try {
    ctxCard = quizJevCriarCard(rect);
  } catch (e) {
    ctxCard = null;
  }

  if (!ctxCard) {
    var w = window.open(QUIZ_JEV_RELAY, "_blank", "width=380,height=560");
    quizJevProcessarSemCard(raw, range, w);
    return;
  }

  quizJevCtxAtual = {
    raw: raw,
    card: ctxCard.card,
    rect: rect,
    perguntando: false,
    imageBase64: null,
    imageMime: null,
    imageUrl: null,
  };
  quizJevAbrirPerguntar();
}

function quizJevAbrirPerguntar() {
  if (!quizJevCtxAtual) return;
  var ctx = quizJevCtxAtual;
  ctx.perguntando = true;
  var card = ctx.card;
  quizJevLimpar(card);
  card.classList.remove("carregando-ativo");
  card.classList.add("aberta");
  card.appendChild(quizJevEl("div", "pergunta-label", "Pergunte sobre o assunto selecionado:"));
  var textarea = document.createElement("textarea");
  textarea.className = "pergunta-input";
  textarea.placeholder = "Escreva sua pergunta…";
  card.appendChild(textarea);
  card.appendChild(quizJevEl("div", "pergunta-dica", "Enter envia · Shift+Enter quebra linha · Esc fecha"));
  quizJevPosicionar(card, ctx.rect);
  textarea.focus();
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      var pergunta = textarea.value.trim();
      if (pergunta) quizJevEnviarPergunta(pergunta);
    }
  });
}

function quizJevEnviarPergunta(pergunta) {
  var ctx = quizJevCtxAtual;
  var card = ctx.card;
  quizJevLimpar(card);
  quizJevMontarCarregando(card, "Pensando");
  quizJevPosicionar(card, ctx.rect);
  var payload = { raw: ctx.raw, ask: pergunta };
  if (ctx.imageBase64) {
    payload.imageBase64 = ctx.imageBase64;
    payload.imageMime = ctx.imageMime;
  } else if (ctx.imageUrl) {
    payload.imageUrl = ctx.imageUrl;
  }
  quizJevChamarApi(payload)
    .then(function (data) {
      if (!document.getElementById(QUIZ_JEV_ID) || quizJevCtxAtual !== ctx) return;
      quizJevLimpar(card);
      quizJevMontarResposta(card, data, !!(ctx.imageBase64 || ctx.imageUrl), false);
      quizJevPosicionar(card, ctx.rect);
      ctx.perguntando = false;
    })
    .catch(function (e) {
      if (!document.getElementById(QUIZ_JEV_ID) || quizJevCtxAtual !== ctx) return;
      if (e.quizJevApiError) {
        quizJevLimpar(card);
        quizJevMontarErro(card, e.message);
        quizJevPosicionar(card, ctx.rect);
      } else {
        quizJevMostrarBotaoRelay(card, ctx.rect, payload);
      }
      ctx.perguntando = false;
    });
}

// Atalho Alt+Q / Alt+Shift+Q: registrado uma vez só por página (flag em
// `window`), pra refazer o fluxo sem precisar clicar no favorito de novo até
// a página recarregar.
if (!window.__quizJevBookmarklet) {
  window.__quizJevBookmarklet = true;
  document.addEventListener(
    "keydown",
    function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      var tecla = (e.key || "").toLowerCase();
      if (tecla !== "q") return;
      e.preventDefault();
      if (e.shiftKey) quizJevProcessarPerguntaDireta();
      else quizJevRun();
    },
    true
  );
}

quizJevRun();
