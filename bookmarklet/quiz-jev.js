// Bookmarklet do Quiz Jev — reproduz o comportamento de src/content.js e
// src/background.js SEM as APIs de extensão (scripting, tabs.captureVisibleTab,
// storage). Roda direto na página da prova, então tudo aqui tem que sobreviver
// a uma CSP restritiva (`connect-src`/`style-src` bloqueando a origem da API e
// até <style> inline).
//
// Como cada diretiva é contornada:
//   - style-src: o CSS vai por adoptedStyleSheets e o resto por CSSOM
//     (el.style.x = …), que a CSP não governa — nunca atributo style="".
//   - connect-src: nenhum código DENTRO da página consegue falar com uma
//     origem barrada — é o navegador que recusa. Mas window.open e
//     postMessage não passam pela CSP, então a consulta sai por uma
//     janelinha NOSSA (docs/relay.html, no GitHub Pages) que faz o fetch e
//     devolve a resposta por postMessage; o card continua aqui, na página, e
//     a janelinha se fecha sozinha. Ver "Ponte" abaixo.
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
// Destino fixo de todo postMessage que leva a chave: se a janela for
// redirecionada pra outra origem, o navegador descarta a mensagem em vez de
// entregá-la a quem estiver lá.
var QUIZ_JEV_RELAY_ORIGIN = "https://guilhermeb-ferrarezi.github.io";
var QUIZ_JEV_ID = "__quiz-jev-bookmarklet";
var QUIZ_JEV_TAMANHO_MINIMO_PX = 40;
var QUIZ_JEV_MIMES_DIRETOS = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Contexto da seleção atual (raw, rect, imagem já resolvida e o próprio
// card) — igual ao ctxAtual da extensão: vive enquanto o card está aberto, e
// é o que a tecla T usa pra abrir a pergunta livre sem seleção nova.
var quizJevCtxAtual = null;

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
// do ancestral comum da seleção e confirma com range.intersectsNode().
//
// Bytes de imagem, o bookmarklet consegue de duas formas: lendo a fonte do
// elemento (<img>/<picture>/<canvas> — sem pedir nada ao usuário) ou, pro resto
// (tabela, SVG, fórmula, vídeo, fundo com arquivo), fotografando a ABA pela
// captura de tela do navegador (getDisplayMedia, que a CSP da página não
// governa). Ver quizJevResolverImagem.
var QUIZ_JEV_TAGS_VISUAIS = ["IMG", "CANVAS", "SVG", "TABLE", "MATH", "PICTURE", "VIDEO", "FIGURE"];
var QUIZ_JEV_TAGS_COM_BYTES = ["IMG", "PICTURE", "CANVAS"];
var QUIZ_JEV_FOLGA_PX = 8;
// Margem pro teto de 8 MB do servidor.
var QUIZ_JEV_LIMITE_BYTES = 7 * 1024 * 1024;
// Acima disso no maior lado a figura só pesa, sem ganho de leitura.
var QUIZ_JEV_LIMITE_LADO_PX = 3000;
// Varrer a página atrás de position:fixed custa uma getComputedStyle por
// elemento; em DOM enorme não compensa (ver quizJevOcultarFixos).
var QUIZ_JEV_LIMITE_ELEMENTOS_FIXOS = 4000;
// A aba fica "compartilhada" enquanto o fluxo de captura está aberto; sem uso
// por este tempo, o bookmarklet solta a captura (some o aviso do navegador).
var QUIZ_JEV_OCIOSIDADE_TELA_MS = 5 * 60 * 1000;

function quizJevTag(elemento) {
  return (elemento.tagName || "").toUpperCase();
}

function quizJevElementoVisualRelevante(elemento) {
  var tag = quizJevTag(elemento);
  if (QUIZ_JEV_TAGS_VISUAIS.indexOf(tag) === -1) {
    // Só fundo com ARQUIVO conta: degradê ou cor de contêiner não é figura, e
    // aqui um falso positivo custaria um pedido de compartilhar a aba.
    if (tag === "BODY" || tag === "HTML") return false;
    var fundo = getComputedStyle(elemento).backgroundImage;
    if (!fundo || fundo.indexOf("url(") === -1) return false;
  }
  var r = elemento.getBoundingClientRect();
  return r.width >= QUIZ_JEV_TAMANHO_MINIMO_PX && r.height >= QUIZ_JEV_TAMANHO_MINIMO_PX;
}

function quizJevEncontrarElementosVisuais(range) {
  var raiz = range.commonAncestorContainer;
  if (raiz.nodeType !== Node.ELEMENT_NODE) raiz = raiz.parentElement;
  if (!raiz) return [];
  var candidatos = [];
  // intersectsNode primeiro: é barato; getComputedStyle só pros que importam.
  if (range.intersectsNode(raiz) && quizJevElementoVisualRelevante(raiz)) candidatos.push(raiz);
  var todos = raiz.querySelectorAll ? raiz.querySelectorAll("*") : [];
  for (var i = 0; i < todos.length; i++) {
    var el2 = todos[i];
    if (range.intersectsNode(el2) && quizJevElementoVisualRelevante(el2)) candidatos.push(el2);
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

// ---- Imagem a partir das fontes (<img>/<picture>/<canvas>) ----

function quizJevLargura(imagem) {
  return imagem.naturalWidth || imagem.width;
}

function quizJevAltura(imagem) {
  return imagem.naturalHeight || imagem.height;
}

function quizJevBase64ParaBlob(base64, mime) {
  var binario = atob(base64);
  var bytes = new Uint8Array(binario.length);
  for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// createImageBitmap em vez de new Image(): não passa por `img-src` da CSP.
function quizJevDecodificar(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error("falha ao decodificar imagem"));
    };
    img.src = url;
  });
}

function quizJevAplicarTetoDeLado(canvas) {
  var maior = Math.max(canvas.width, canvas.height);
  if (maior <= QUIZ_JEV_LIMITE_LADO_PX) return canvas;
  var escala = QUIZ_JEV_LIMITE_LADO_PX / maior;
  var menor = document.createElement("canvas");
  menor.width = Math.max(1, Math.round(canvas.width * escala));
  menor.height = Math.max(1, Math.round(canvas.height * escala));
  menor.getContext("2d").drawImage(canvas, 0, 0, menor.width, menor.height);
  return menor;
}

// Codifica respeitando o teto de bytes do servidor: PNG reduzindo a escala e,
// se ainda assim não couber, JPEG (o servidor aceita; só ele comprime foto).
function quizJevCanvasParaBase64ComLimite(original) {
  var atual = original;
  for (var tentativa = 0; tentativa < 6; tentativa++) {
    var dataUrl = atual.toDataURL("image/png");
    var base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (Math.ceil((base64.length * 3) / 4) <= QUIZ_JEV_LIMITE_BYTES) return { base64: base64, mime: "image/png" };
    var menor = document.createElement("canvas");
    menor.width = Math.max(1, Math.round(atual.width * 0.7));
    menor.height = Math.max(1, Math.round(atual.height * 0.7));
    menor.getContext("2d").drawImage(atual, 0, 0, menor.width, menor.height);
    atual = menor;
  }
  var dataUrlJpeg = atual.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrlJpeg.slice(dataUrlJpeg.indexOf(",") + 1), mime: "image/jpeg" };
}

// Junta as imagens num canvas só, empilhadas na vertical, cada uma escalada
// pra largura comum (a maior) sem perder a proporção.
function quizJevEmpilhar(itens) {
  return Promise.all(
    itens.map(function (it) {
      return quizJevDecodificar(quizJevBase64ParaBlob(it.base64, it.mime));
    })
  ).then(function (imgs) {
    var largura = 0;
    for (var i = 0; i < imgs.length; i++) largura = Math.max(largura, quizJevLargura(imgs[i]));
    var alturas = imgs.map(function (im) {
      return (quizJevAltura(im) * largura) / quizJevLargura(im);
    });
    var canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = Math.max(
      1,
      Math.round(
        alturas.reduce(function (a, b) {
          return a + b;
        }, 0)
      )
    );
    var ctx = canvas.getContext("2d");
    var y = 0;
    for (var j = 0; j < imgs.length; j++) {
      ctx.drawImage(imgs[j], 0, y, largura, alturas[j]);
      y += alturas[j];
    }
    return quizJevCanvasParaBase64ComLimite(quizJevAplicarTetoDeLado(canvas));
  });
}

// Se QUALQUER imagem do conjunto falhar, desiste do conjunto: meia figura
// (uma de duas lado a lado) induz a erro. Quem chama tenta o print da aba.
function quizJevImagemDeFontes(elementos) {
  var resultados = [];
  return elementos
    .reduce(function (cadeia, el) {
      return cadeia.then(function (ok) {
        if (!ok) return false;
        return quizJevObterBytes(el).then(function (r) {
          if (!r) return false;
          resultados.push(r);
          return true;
        });
      });
    }, Promise.resolve(true))
    .then(function (ok) {
      if (!ok) return null;
      // Uma imagem só e dentro do limite: manda o arquivo original, sem recodificar.
      if (resultados.length === 1 && Math.ceil((resultados[0].base64.length * 3) / 4) <= QUIZ_JEV_LIMITE_BYTES) {
        return resultados[0];
      }
      return quizJevEmpilhar(resultados);
    })
    .catch(function () {
      return null;
    });
}

// ---- Print da aba (getDisplayMedia) ----
//
// O que a extensão faz com tabs.captureVisibleTab, o bookmarklet faz com a
// captura de tela do navegador: não é governada por CSP e dá o mesmo resultado
// (pixels da aba). O custo é o navegador pedir, uma vez, pra compartilhar a
// aba. A captura fica aberta enquanto o card é usado (Alt+Q repetido não
// pergunta de novo) e é solta sozinha depois de QUIZ_JEV_OCIOSIDADE_TELA_MS.
// Só funciona em Chrome/Edge: Firefox não captura "esta aba", e aí o
// bookmarklet segue só com as imagens que consegue ler da página.

function quizJevFecharTela() {
  clearTimeout(window.__quizJevTelaTimer);
  var tela = window.__quizJevTela;
  window.__quizJevTela = null;
  if (!tela) return;
  var faixas = tela.stream.getTracks();
  for (var i = 0; i < faixas.length; i++) faixas[i].stop();
  tela.video.srcObject = null;
}

function quizJevRenovarOciosidade() {
  clearTimeout(window.__quizJevTelaTimer);
  window.__quizJevTelaTimer = setTimeout(quizJevFecharTela, QUIZ_JEV_OCIOSIDADE_TELA_MS);
}

// Espera o próximo quadro do vídeo (ou `ms`, se a página estiver parada e o
// navegador não gerar quadro novo).
function quizJevEsperarQuadro(video, ms) {
  return new Promise(function (resolve) {
    var fim = false;
    var limite = null;
    function ok() {
      if (fim) return;
      fim = true;
      clearTimeout(limite);
      resolve();
    }
    limite = setTimeout(ok, ms);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(ok);
  });
}

// Dois rAF seguidos garantem que o navegador já pintou depois de uma rolagem;
// a pausa curta cobre fonte/imagem lazy que pinta um quadro depois.
function quizJevEsperarPintura() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(resolve, 60);
      });
    });
  });
}

// Tem que ser chamada dentro do gesto do usuário (ou logo depois dele): o
// navegador só abre o pedido de compartilhamento com ativação recente.
// Resolve pra { stream, track, video } ou null (sem suporte, negado, ou o
// usuário escolheu janela/tela em vez da aba). Nunca rejeita.
function quizJevAbrirTela() {
  var ativa = window.__quizJevTela;
  if (ativa && ativa.track.readyState === "live") {
    quizJevRenovarOciosidade();
    return Promise.resolve(ativa);
  }
  var midia = navigator.mediaDevices;
  if (!midia || !midia.getDisplayMedia) return Promise.resolve(null);
  return midia
    .getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
    })
    .then(
      function (stream) {
        var faixa = stream.getVideoTracks()[0];
        var configuracoes = faixa && faixa.getSettings ? faixa.getSettings() : {};
        if (!faixa || !quizJevEhQuadroDeAba(configuracoes)) {
          var todas = stream.getTracks();
          for (var i = 0; i < todas.length; i++) todas[i].stop();
          return null;
        }
        var video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        var tela = { stream: stream, track: faixa, video: video };
        faixa.addEventListener("ended", function () {
          if (window.__quizJevTela === tela) window.__quizJevTela = null;
        });
        window.__quizJevTela = tela;
        return video
          .play()
          .then(function () {
            return quizJevEsperarQuadro(video, 1500);
          })
          .then(function () {
            quizJevRenovarOciosidade();
            return tela;
          });
      },
      function () {
        return null;
      }
    )
    .catch(function () {
      return null;
    });
}

// Copia o quadro atual do vídeo pra um canvas (null se ainda não há quadro).
function quizJevTirarQuadro(tela) {
  var video = tela.video;
  if (!video.videoWidth || !video.videoHeight) return null;
  var canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return canvas;
}

// Quadro SEM o card do Quiz Jev na frente: esconde o card, espera a pintura e
// o próximo quadro, copia e mostra o card de novo.
function quizJevQuadroLimpo(tela) {
  var host = document.getElementById(QUIZ_JEV_ID);
  if (host) host.style.visibility = "hidden";
  function mostrar() {
    if (host) host.style.visibility = "visible";
  }
  return quizJevEsperarPintura()
    .then(function () {
      return quizJevEsperarQuadro(tela.video, 400);
    })
    .then(
      function () {
        var quadro = quizJevTirarQuadro(tela);
        mostrar();
        return quadro;
      },
      function (e) {
        mostrar();
        throw e;
      }
    );
}

// position:fixed/sticky "flutua" e apareceria repetido em cada faixa da costura.
function quizJevOcultarFixos() {
  if (!document.body) return [];
  var todos = document.body.querySelectorAll("*");
  if (todos.length > QUIZ_JEV_LIMITE_ELEMENTOS_FIXOS) return [];
  var alterados = [];
  for (var i = 0; i < todos.length; i++) {
    var pos = getComputedStyle(todos[i]).position;
    if (pos === "fixed" || pos === "sticky") {
      alterados.push([todos[i], todos[i].style.visibility]);
      todos[i].style.visibility = "hidden";
    }
  }
  return alterados;
}

function quizJevRestaurarFixos(alterados) {
  for (var i = 0; i < alterados.length; i++) alterados[i][0].style.visibility = alterados[i][1];
}

// Troca o texto do card durante as etapas da captura (card pode ser null: o
// caminho "sem card" não tem o que atualizar).
function quizJevEtapa(card, rect, texto) {
  if (!card) return;
  quizJevLimpar(card);
  quizJevMontarCarregando(card, texto);
  quizJevPosicionar(card, rect);
}

// Região (seleção + elementos visuais) em coordenadas de viewport, medida AGORA.
function quizJevMedirUniao(visuais, range) {
  var rects = [range.getBoundingClientRect()];
  for (var i = 0; i < visuais.length; i++) rects.push(visuais[i].getBoundingClientRect());
  return quizJevUniaoComFolga(rects, QUIZ_JEV_FOLGA_PX);
}

var QUIZ_JEV_COSTURAR = { costurar: true };

// Tenta o caso comum: a região cabe na tela, um quadro só, recortado. Medida e
// decisão acontecem DEPOIS do quadro limpo: o quadro de uma captura de aba muda
// de tamanho quando o navegador mostra o aviso de compartilhamento (no Chrome,
// a viewport encolhe uns 50 px), então qualquer medida anterior ao quadro pode
// estar velha. Devolve QUIZ_JEV_COSTURAR se a região não couber.
function quizJevPrintUnico(tela, visuais, range, rect, card) {
  quizJevEtapa(card, rect, "Capturando a tela…");
  return quizJevQuadroLimpo(tela).then(function (quadro) {
    if (!quadro) return null;
    var uniao = quizJevMedirUniao(visuais, range);
    var area = quizJevAreaVisivel(quadro.width, quadro.height, window.innerWidth, window.innerHeight);
    if (!quizJevCabeNaViewport(uniao, area.largura, area.altura)) return QUIZ_JEV_COSTURAR;
    var escala = quizJevEscalaDoQuadro(quadro.width, window.innerWidth);
    var rec = quizJevRecorteNoQuadro(uniao, escala, quadro.width, quadro.height);
    if (!rec) return null;
    var canvas = document.createElement("canvas");
    canvas.width = rec.sw;
    canvas.height = rec.sh;
    canvas.getContext("2d").drawImage(quadro, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, rec.sw, rec.sh);
    return quizJevCanvasParaBase64ComLimite(quizJevAplicarTetoDeLado(canvas));
  });
}

// A região não cabe (ou está fora da tela): rola de cima pra baixo, um quadro
// por vez, e costura. Cada faixa começa ONDE O QUADRO ANTERIOR TERMINOU (a
// altura é medida a cada quadro, porque ela pode mudar no meio do caminho —
// ver quizJevPrintUnico); assim não sobra vão entre as faixas. Só costura na
// vertical: o que passar da largura da tela fica de fora. Restaura rolagem e
// elementos fixos em QUALQUER saída.
function quizJevPrintCosturado(tela, visuais, range, rect, card, aindaAberto) {
  var regiaoDoc = quizJevRegiaoParaDocumento(quizJevMedirUniao(visuais, range), window.scrollX, window.scrollY);
  var scrollX0 = window.scrollX;
  var scrollY0 = window.scrollY;
  var fixos = quizJevOcultarFixos();
  var quadros = [];
  var posicoes = [];

  function restaurar() {
    quizJevRestaurarFixos(fixos);
    window.scrollTo(scrollX0, scrollY0);
  }

  // `y`: topo (em coordenadas de documento) da próxima faixa. Devolve true se
  // a região inteira foi coberta.
  function proxima(y) {
    if (y >= regiaoDoc.bottom) return Promise.resolve(true);
    // Teto de segurança: uma "região" de dezenas de telas não é uma questão.
    if (!aindaAberto() || quadros.length >= 30) return Promise.resolve(false);
    quizJevEtapa(card, rect, "Capturando a figura (" + (quadros.length + 1) + ")…");
    // Deixa o texto do card pintar antes de escondê-lo e rolar.
    return quizJevEsperarPintura()
      .then(function () {
        window.scrollTo(scrollX0, y);
        return quizJevQuadroLimpo(tela);
      })
      .then(function (quadro) {
        if (!quadro) return false;
        var area = quizJevAreaVisivel(quadro.width, quadro.height, window.innerWidth, window.innerHeight);
        var yReal = window.scrollY;
        quadros.push(quadro);
        posicoes.push({ x: window.scrollX, y: yReal, largura: quadro.width, altura: quadro.height });
        // Rolagem barrada no fim da página: este quadro já vai até o fim.
        if (yReal < y - 1) return true;
        return proxima(yReal + area.altura);
      });
  }

  return proxima(regiaoDoc.top).then(
    function (ok) {
      restaurar();
      if (!ok || !quadros.length) return null;
      quizJevEtapa(card, rect, "Costurando a imagem…");
      var escala = quizJevEscalaDoQuadro(quadros[0].width, window.innerWidth);
      var plano = quizJevPlanoDeCostura(posicoes, regiaoDoc, escala, QUIZ_JEV_LIMITE_LADO_PX);
      var canvas = document.createElement("canvas");
      canvas.width = plano.largura;
      canvas.height = plano.altura;
      var ctx = canvas.getContext("2d");
      for (var i = 0; i < quadros.length; i++) {
        var it = plano.itens[i];
        ctx.drawImage(quadros[i], 0, 0, quadros[i].width, quadros[i].height, it.dx, it.dy, it.dw, it.dh);
      }
      return quizJevCanvasParaBase64ComLimite(canvas);
    },
    function (e) {
      restaurar();
      throw e;
    }
  );
}

function quizJevCapturarDaTela(visuais, range, rect, card, aindaAberto) {
  quizJevEtapa(card, rect, "Permita compartilhar a aba…");
  return quizJevAbrirTela()
    .then(function (tela) {
      if (!tela || !aindaAberto()) return null;
      return quizJevPrintUnico(tela, visuais, range, rect, card).then(function (r) {
        if (r !== QUIZ_JEV_COSTURAR) return r;
        return aindaAberto() ? quizJevPrintCosturado(tela, visuais, range, rect, card, aindaAberto) : null;
      });
    })
    .catch(function () {
      return null;
    });
}

function quizJevTemBytesDiretos(elemento) {
  return QUIZ_JEV_TAGS_COM_BYTES.indexOf(quizJevTag(elemento)) !== -1;
}

// Resolve a imagem da seleção, na ordem: (1) bytes das fontes (<img>/
// <picture>/<canvas>) — todas empilhadas, só quando TODO elemento visual da
// seleção é desse tipo; (2) print da aba (tabela, SVG, fórmula, vídeo, fundo
// com arquivo, ou quando (1) falhou); (3) o endereço da primeira <img>, que o
// servidor baixa por conta própria. Devolve {base64,mime}, {url} ou null —
// nunca lança. `aindaAberto()` diz se o card ainda é o da seleção atual.
function quizJevResolverImagem(visuais, range, rect, card, aindaAberto) {
  var fontes = visuais.filter(quizJevTemBytesDiretos);
  var soFontes = fontes.length === visuais.length;
  var passoFontes = Promise.resolve(null);
  if (soFontes) {
    quizJevEtapa(card, rect, "Lendo a imagem…");
    passoFontes = quizJevImagemDeFontes(fontes);
  }
  return passoFontes
    .then(function (r) {
      if (r || !aindaAberto()) return r;
      return quizJevCapturarDaTela(visuais, range, rect, card, aindaAberto);
    })
    .then(function (r) {
      if (r || !aindaAberto()) return r;
      for (var i = 0; i < visuais.length; i++) {
        var el = visuais[i];
        var img = quizJevTag(el) === "IMG" ? el : el.querySelector && el.querySelector("img");
        var src = img ? img.currentSrc || img.src : null;
        if (src) return { url: src };
      }
      return null;
    })
    .catch(function () {
      return null;
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

// Mensagem que leva a consulta pra janela relay (chave inclusa).
function quizJevMensagemRelay(payload) {
  var msg = { raw: payload.raw, key: QUIZ_KEY };
  if (payload.ask) msg.ask = payload.ask;
  if (payload.imageBase64) {
    msg.imageBase64 = payload.imageBase64;
    msg.imageMime = payload.imageMime;
  } else if (payload.imageUrl) {
    msg.imageUrl = payload.imageUrl;
  }
  return msg;
}

// ---- Ponte: consulta por uma janelinha nossa quando a CSP barra o fetch ----
//
// Estado por página (em `window`, porque cada clique no favorito roda um IIFE
// novo e o atalho Alt+Q guarda o fechamento do primeiro):
//   window.__quizJevViaPonte  undefined = ainda não sabemos
//                             false     = fetch direto funciona aqui
//                             true      = CSP barra — usar a ponte
//
// O bloqueador de pop-up só deixa window.open passar logo depois de um gesto
// (clique/tecla). Por isso a janela é aberta de forma SÍNCRONA no gesto
// quando já sabemos que precisa dela, e só no primeiro uso da página ela
// depende da sondagem abaixo — que, barrada pela CSP, falha em poucos
// milissegundos, bem dentro da janela de tempo do gesto. Se mesmo assim o
// navegador barrar, o card mostra um botão (clique novo = gesto garantido).

// HEAD no-cors no próprio endpoint: a CSP decide antes de sair qualquer
// byte, então é rejeitado na hora se o site barra a API; se não barra,
// qualquer resposta (até 405) resolve. Roda uma vez por página.
function quizJevSondar() {
  if (window.__quizJevViaPonte === true || window.__quizJevViaPonte === false) {
    return Promise.resolve(window.__quizJevViaPonte);
  }
  if (!window.__quizJevSondagem) {
    window.__quizJevSondagem = fetch(QUIZ_JEV_API, { method: "HEAD", mode: "no-cors", cache: "no-store", credentials: "omit" }).then(
      function () {
        window.__quizJevViaPonte = false;
        return false;
      },
      function () {
        window.__quizJevViaPonte = true;
        return true;
      }
    );
  }
  return window.__quizJevSondagem;
}

// Janelinha pequena no canto superior direito da janela da prova.
function quizJevRecursosJanela(largura, altura) {
  var esq = Math.max(0, (window.screenX || 0) + (window.outerWidth || largura) - largura - 24);
  var topo = Math.max(0, (window.screenY || 0) + 80);
  return "popup,width=" + largura + ",height=" + altura + ",left=" + esq + ",top=" + topo;
}

// Abre a janela da ponte e já registra o listener do handshake — antes de
// qualquer outra coisa, senão o "quizjev-pronto" da janela poderia chegar
// antes de alguém estar escutando. Retorna null se o navegador barrar.
function quizJevAbrirPonte() {
  var w = null;
  try {
    w = window.open(QUIZ_JEV_RELAY, "_blank", quizJevRecursosJanela(340, 170));
  } catch (e) {
    w = null;
  }
  if (!w) return null;
  var ponte = { janela: w };
  ponte.pronta = new Promise(function (resolve) {
    var aoAvisar = function (ev) {
      if (ev.source !== w || ev.origin !== QUIZ_JEV_RELAY_ORIGIN) return;
      if (!ev.data || ev.data.type !== "quizjev-pronto") return;
      window.removeEventListener("message", aoAvisar);
      resolve();
    };
    window.addEventListener("message", aoAvisar);
    ponte.desistir = function () {
      window.removeEventListener("message", aoAvisar);
    };
  });
  return ponte;
}

// Manda a consulta pela ponte e espera a resposta voltar. A janela faz o
// fetch, devolve {type:"quizjev-resposta", id, ok, data|message} e se fecha.
function quizJevViaPonte(payload, ponte) {
  var w = ponte.janela;
  var id = "q" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  return new Promise(function (resolve, reject) {
    var conectada = false;
    var terminou = false;
    var vigia = null;
    var limite = null;
    function terminar(erro, dados) {
      if (terminou) return;
      terminou = true;
      window.removeEventListener("message", aoResponder);
      clearInterval(vigia);
      clearTimeout(limite);
      if (ponte.desistir) ponte.desistir();
      if (erro) {
        try {
          w.close();
        } catch (e) {
          // janela de outra origem já isolada — nada a fazer
        }
        reject(erro);
      } else {
        resolve(dados);
      }
    }
    function aoResponder(ev) {
      if (ev.source !== w || ev.origin !== QUIZ_JEV_RELAY_ORIGIN) return;
      var d = ev.data;
      if (!d || d.type !== "quizjev-resposta" || d.id !== id) return;
      if (d.ok) terminar(null, d.data);
      else terminar(new Error(d.message || "falhou"));
    }
    window.addEventListener("message", aoResponder);
    ponte.pronta.then(function () {
      if (terminou) return;
      conectada = true;
      var msg = quizJevMensagemRelay(payload);
      msg.ponte = true;
      msg.id = id;
      w.postMessage(msg, QUIZ_JEV_RELAY_ORIGIN);
    });
    // Janela fechada à mão, ou já nascida "fechada" pra nós: com
    // Cross-Origin-Opener-Policy: same-origin o site corta o vínculo com
    // qualquer janela que abra, e aí não existe canal nenhum de volta.
    vigia = setInterval(function () {
      if (!w.closed) return;
      terminar(
        new Error(
          conectada
            ? "A janela de consulta foi fechada antes da resposta."
            : "Este site isola as janelas que abre (COOP), então a consulta não tem como voltar pra cá. Use o app do celular ou a extensão neste site."
        )
      );
    }, 400);
    // Orçamento do servidor com imagem é de até ~50s; folga por cima disso.
    limite = setTimeout(function () {
      terminar(new Error(conectada ? "A consulta demorou demais — tente de novo." : "A janela de consulta não carregou — tente de novo."));
    }, 70000);
  });
}

function quizJevErroPrecisaClique() {
  var e = new Error("pop-up barrado");
  e.quizJevPrecisaClique = true;
  return e;
}

// Chamado SÍNCRONO, dentro do gesto (clique no favorito, Alt+Q, Enter na
// pergunta): decide o caminho e, se já sabemos que é a ponte, abre a janela
// agora, enquanto o gesto ainda vale. `modo` resolve pra "direto", "ponte"
// ou "clique" (ponte necessária mas o navegador barrou a janela).
function quizJevNovoTransporte() {
  var t = { ponte: null };
  if (window.__quizJevViaPonte === true) {
    t.ponte = quizJevAbrirPonte();
    t.modo = Promise.resolve(t.ponte ? "ponte" : "clique");
  } else if (window.__quizJevViaPonte === false) {
    t.modo = Promise.resolve("direto");
  } else {
    t.modo = quizJevSondar().then(function (viaPonte) {
      if (!viaPonte) return "direto";
      t.ponte = quizJevAbrirPonte();
      return t.ponte ? "ponte" : "clique";
    });
  }
  return t;
}

// Consulta pelo caminho que o transporte escolheu. Erro com
// quizJevPrecisaClique = mostrar o botão da ponte no card.
function quizJevConsultar(payload, t) {
  return t.modo.then(function (modo) {
    if (modo === "ponte") return quizJevViaPonte(payload, t.ponte);
    if (modo === "clique") throw quizJevErroPrecisaClique();
    return quizJevChamarApi(payload).catch(function (e) {
      if (e.quizJevApiError) throw e;
      // A sondagem passou mas a chamada de verdade não chegou a ter resposta
      // HTTP (rede instável, CSP mudou): tenta a ponte a partir daqui.
      window.__quizJevViaPonte = true;
      var ponte = quizJevAbrirPonte();
      if (ponte) return quizJevViaPonte(payload, ponte);
      throw quizJevErroPrecisaClique();
    });
  });
}

function quizJevAindaAberto(ctx) {
  return !!document.getElementById(QUIZ_JEV_ID) && quizJevCtxAtual === ctx;
}

// Liga uma consulta ao card de `ctx`: resposta, erro ou botão da ponte.
// `depois` roda quando a consulta termina (em qualquer desfecho).
function quizJevAcompanhar(consulta, ctx, payload, comImagem, imagemFalhou, depois) {
  var card = ctx.card;
  consulta.then(
    function (data) {
      if (depois) depois();
      if (!quizJevAindaAberto(ctx)) return;
      quizJevLimpar(card);
      quizJevMontarResposta(card, data, comImagem, imagemFalhou);
      quizJevPosicionar(card, ctx.rect);
    },
    function (e) {
      if (depois) depois();
      if (!quizJevAindaAberto(ctx)) return;
      if (e && e.quizJevPrecisaClique) {
        quizJevMostrarBotaoPonte(ctx, payload, comImagem, imagemFalhou, depois);
        return;
      }
      quizJevLimpar(card);
      quizJevMontarErro(card, e && e.message);
      quizJevPosicionar(card, ctx.rect);
    }
  );
}

// Último recurso quando o navegador barrou a janela automática: o clique no
// botão é um gesto novo, então a janela abre com certeza (salvo pop-ups
// bloqueados de vez pra este site). A resposta volta pro MESMO card.
function quizJevMostrarBotaoPonte(ctx, payload, comImagem, imagemFalhou, depois) {
  var card = ctx.card;
  quizJevLimpar(card);
  card.classList.remove("carregando-ativo");
  card.appendChild(
    quizJevEl(
      "div",
      "erro",
      "Este site bloqueia a conexão direta (CSP) e o navegador barrou a janelinha de consulta. Clique para consultar por ela — a resposta aparece aqui mesmo:"
    )
  );
  var botao = document.createElement("button");
  botao.type = "button";
  botao.className = "botao-relay";
  botao.textContent = "Consultar pela janela";
  botao.addEventListener("click", function () {
    var ponte = quizJevAbrirPonte();
    if (!ponte) {
      quizJevLimpar(card);
      quizJevMontarErro(card, "O navegador bloqueou a janela. Permita pop-ups para este site e tente de novo.");
      quizJevPosicionar(card, ctx.rect);
      return;
    }
    window.__quizJevViaPonte = true;
    quizJevLimpar(card);
    quizJevMontarCarregando(card, comImagem ? "Analisando a imagem" : "Consultando");
    quizJevPosicionar(card, ctx.rect);
    quizJevAcompanhar(quizJevViaPonte(payload, ponte), ctx, payload, comImagem, imagemFalhou, depois);
  });
  card.appendChild(botao);
  quizJevPosicionar(card, ctx.rect);
}

// ---- Janela relay exibindo a resposta ela mesma ----
// Só pro caso "nem o card pôde ser desenhado" de quizJevRun: sem card na
// página, a resposta aparece na própria janela. `janela` já foi aberta NO
// MESMO TICK do gesto.
//
// `payloadOuPromise` pode ser o payload já pronto OU uma Promise dele (a
// imagem ainda está sendo resolvida quando a janela abre). O listener de
// handshake é registrado JÁ, antes de esperar o payload — senão o
// "quizjev-pronto" da janela poderia chegar antes de alguém estar escutando.
function quizJevAbrirRelay(payloadOuPromise, janela) {
  var w = janela;
  if (!w) {
    quizJevAvisoSemCard("não consegui abrir a janela de resposta — permita pop-ups para este site e tente de novo.");
    return;
  }
  var enviado = false;
  var handler = function (ev) {
    if (ev.source !== w || ev.origin !== QUIZ_JEV_RELAY_ORIGIN) return;
    if (!ev.data || ev.data.type !== "quizjev-pronto") return;
    if (enviado) return;
    enviado = true;
    window.removeEventListener("message", handler);
    Promise.resolve(payloadOuPromise).then(function (payload) {
      w.postMessage(quizJevMensagemRelay(payload), QUIZ_JEV_RELAY_ORIGIN);
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
    // cssText (CSSOM), não setAttribute("style"): o atributo é barrado por
    // style-src sem 'unsafe-inline', o CSSOM não.
    div.style.cssText =
      "position:fixed;z-index:2147483647;top:12px;right:12px;max-width:300px;" +
      "background:#18181b;color:#fff;padding:10px 14px;border-radius:8px;" +
      "font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);";
    document.body.appendChild(div);
    setTimeout(function () {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 6000);
  } catch (e) {
    // nada mais a fazer
  }
}

// ---- Fluxo principal (equivalente a processarSelecao) ----
function quizJevProcessarComCard(raw, range, rect, ctxCard, transporte) {
  var card = ctxCard.card;
  quizJevMontarCarregando(card, "Consultando");
  quizJevPosicionar(card, rect);
  var contexto = { raw: raw, imageBase64: null, imageMime: null, imageUrl: null, perguntando: false, card: card, rect: rect };
  quizJevCtxAtual = contexto;

  var visuais = quizJevEncontrarElementosVisuais(range);
  var aindaAberto = function () {
    return quizJevAindaAberto(contexto);
  };
  var pImagem = visuais.length ? quizJevResolverImagem(visuais, range, rect, card, aindaAberto) : Promise.resolve(null);

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

    quizJevLimpar(card);
    quizJevMontarCarregando(card, temImagem ? "Analisando a imagem" : "Consultando");
    quizJevPosicionar(card, rect);

    quizJevAcompanhar(quizJevConsultar(payload, transporte), contexto, payload, temImagem, imagemFalhou);
  });
}

function quizJevProcessarSemCard(raw, range, janela) {
  var visuais = quizJevEncontrarElementosVisuais(range);
  // Sem card não há o que fechar no meio: o resolvedor roda até o fim.
  var pImagem = visuais.length
    ? quizJevResolverImagem(visuais, range, range.getBoundingClientRect(), null, function () {
        return true;
      })
    : Promise.resolve(null);
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

  // Ainda no mesmo tick do gesto — ver quizJevNovoTransporte.
  quizJevProcessarComCard(raw, range, rect, ctxCard, quizJevNovoTransporte());
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
  // Já descobre se a página barra a API enquanto a pessoa digita: no Enter a
  // decisão fica síncrona e a janela da ponte (se precisar) abre no gesto.
  quizJevSondar();
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

// Chamada de dentro do keydown do Enter — o transporte é criado primeiro,
// ainda dentro do gesto.
function quizJevEnviarPergunta(pergunta) {
  var transporte = quizJevNovoTransporte();
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
  quizJevAcompanhar(quizJevConsultar(payload, transporte), ctx, payload, !!(ctx.imageBase64 || ctx.imageUrl), false, function () {
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
