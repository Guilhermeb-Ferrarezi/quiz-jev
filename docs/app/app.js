// App instalável do Quiz Jev (docs/app/). Reaproveita o visual do card de
// ../quiz-render.js (mesmas funções globais usadas pelo bookmarklet e por
// docs/relay.html: quizJevEl, quizJevMontarResposta, quizJevMontarErro,
// quizJevMontarCarregando, QUIZ_JEV_CSS) — nenhuma duplicação do visual
// aqui, só a lógica de tela cheia + compartilhamento + redimensionar imagem.
//
// Regra de segurança do projeto: nunca innerHTML com dado vindo da rede ou
// do compartilhamento (texto compartilhado é dado externo também) —
// textContent/createElement em tudo. As funções de quiz-render.js já seguem
// essa regra; este arquivo segue a mesma disciplina pro que monta aqui.
(function () {
  "use strict";

  var API = "https://api.santos-tech.com/quiz/answer";
  var CHAVE_STORAGE = "quizjev.chave";
  // Nome de cache prefixado (o domínio guilhermeb-ferrarezi.github.io é
  // compartilhado entre vários repos do usuário) — precisa ficar IGUAL ao
  // que sw.js usa para escrever; não há import ligando os dois arquivos.
  var SHARE_CACHE_NAME = "quizjev-share-store";
  var SHARE_KEY_DATA = "/quiz-jev/app/__share__/data";
  var SHARE_KEY_IMAGEM = "/quiz-jev/app/__share__/imagem";

  var RE_CHAVE = /^qz_[A-Za-z0-9_-]{10,}$/;
  var LADO_MAXIMO = 2000;
  var QUALIDADE_JPEG = 0.85;

  // ---- Elementos ----
  var telaChave = document.getElementById("tela-chave");
  var telaApp = document.getElementById("tela-app");
  var campoChave = document.getElementById("campo-chave");
  var botaoSalvarChave = document.getElementById("botao-salvar-chave");
  var erroChave = document.getElementById("erro-chave");
  var botaoTrocarChave = document.getElementById("botao-trocar-chave");

  var form = document.getElementById("form-consulta");
  var campoTexto = document.getElementById("campo-texto");
  var campoArquivo = document.getElementById("campo-arquivo");
  var previewImagem = document.getElementById("preview-imagem");
  var previewImg = document.getElementById("preview-img");
  var botaoRemoverImagem = document.getElementById("botao-remover-imagem");
  var botaoEnviar = document.getElementById("botao-enviar");
  var avisoVazio = document.getElementById("aviso-vazio");

  var card = document.getElementById("card");

  var botaoInstalar = document.getElementById("botao-instalar");
  var instrucaoIos = document.getElementById("instrucao-ios");

  // Imagem atualmente anexada (do input de arquivo OU de um compartilhamento
  // recebido): { blob, mime, objectUrl } ou null.
  var imagemAtual = null;

  // ---- Service worker ----
  if ("serviceWorker" in navigator) {
    // Registrado a partir de docs/app/, então o escopo default já é
    // /quiz-jev/app/ — igual ao `scope` do manifest.
    navigator.serviceWorker.register("sw.js").catch(function () {
      // Sem service worker o app ainda funciona (só perde compartilhamento,
      // cache offline e instalação em alguns navegadores) — não bloqueia.
    });
  }

  // ---- Chave ----
  function obterChave() {
    try {
      return localStorage.getItem(CHAVE_STORAGE) || "";
    } catch (e) {
      return "";
    }
  }

  function salvarChave(valor) {
    try {
      localStorage.setItem(CHAVE_STORAGE, valor);
    } catch (e) {
      // localStorage indisponível (modo privado restrito, quota) — a chave
      // simplesmente não persiste entre sessões; segue mesmo assim.
    }
  }

  function apagarChave() {
    try {
      localStorage.removeItem(CHAVE_STORAGE);
    } catch (e) {
      // nada a fazer
    }
  }

  function mostrarTelaChave() {
    telaChave.hidden = false;
    telaApp.hidden = true;
    campoChave.value = "";
    erroChave.hidden = true;
    campoChave.focus();
  }

  function mostrarTelaApp() {
    telaChave.hidden = true;
    telaApp.hidden = false;
  }

  botaoSalvarChave.addEventListener("click", function () {
    var valor = campoChave.value.trim();
    if (!RE_CHAVE.test(valor)) {
      erroChave.hidden = false;
      return;
    }
    salvarChave(valor);
    mostrarTelaApp();
    processarCompartilhamentoSeHouver();
  });
  campoChave.addEventListener("keydown", function (e) {
    if (e.key === "Enter") botaoSalvarChave.click();
  });

  botaoTrocarChave.addEventListener("click", function () {
    apagarChave();
    limparImagem();
    campoTexto.value = "";
    esconderCard();
    mostrarTelaChave();
  });

  // ---- Preview de imagem ----
  function limparImagem() {
    if (imagemAtual && imagemAtual.objectUrl) URL.revokeObjectURL(imagemAtual.objectUrl);
    imagemAtual = null;
    previewImagem.hidden = true;
    previewImg.removeAttribute("src");
    campoArquivo.value = "";
  }

  function definirImagem(blob, mime) {
    if (imagemAtual && imagemAtual.objectUrl) URL.revokeObjectURL(imagemAtual.objectUrl);
    var objectUrl = URL.createObjectURL(blob);
    imagemAtual = { blob: blob, mime: mime || blob.type || "image/jpeg", objectUrl: objectUrl };
    previewImg.src = objectUrl;
    previewImagem.hidden = false;
  }

  campoArquivo.addEventListener("change", function () {
    var arquivo = campoArquivo.files && campoArquivo.files[0];
    if (!arquivo) return;
    definirImagem(arquivo, arquivo.type);
  });

  botaoRemoverImagem.addEventListener("click", function () {
    limparImagem();
  });

  // ---- Redimensionar (canvas) + JPEG ----
  // A maioria dos navegadores atuais já respeita a orientação EXIF ao
  // decodificar um JPEG numa <img> (e portanto ao desenhar essa <img> num
  // canvas via drawImage) — não há rotação manual aqui de propósito: seria
  // um parser EXIF a mais só pros poucos navegadores que ainda não fazem
  // isso sozinhos. Ver pedido original / README se algum dia precisar
  // revisitar.
  function redimensionarImagem(blob) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var largura = img.naturalWidth;
        var altura = img.naturalHeight;
        var maiorLado = Math.max(largura, altura);
        var escala = maiorLado > LADO_MAXIMO ? LADO_MAXIMO / maiorLado : 1;
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(largura * escala));
        canvas.height = Math.max(1, Math.round(altura * escala));
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        canvas.toBlob(
          function (jpegBlob) {
            if (!jpegBlob) {
              reject(new Error("não consegui converter a imagem para JPEG"));
              return;
            }
            resolve(jpegBlob);
          },
          "image/jpeg",
          QUALIDADE_JPEG
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("não consegui abrir a imagem selecionada"));
      };
      img.src = objectUrl;
    });
  }

  function blobParaBase64(blob) {
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

  // ---- Compartilhamento recebido (share_target via service worker) ----
  // O POST em si já foi interceptado e guardado pelo service worker (ver
  // sw.js/tratarCompartilhamento) — aqui só lemos o que foi guardado e
  // APAGAMOS logo em seguida, senão reaparece na próxima abertura do app.
  function lerEApagarCompartilhamento() {
    if (!("caches" in window)) return Promise.resolve(null);
    return caches
      .open(SHARE_CACHE_NAME)
      .then(function (cache) {
        return cache.match(SHARE_KEY_DATA).then(function (resData) {
          if (!resData) return null;
          return resData.json().then(function (dados) {
            var imagemPromise = dados.hasImage
              ? cache.match(SHARE_KEY_IMAGEM).then(function (resImg) {
                  return resImg ? resImg.blob() : null;
                })
              : Promise.resolve(null);
            return imagemPromise.then(function (blob) {
              // Apaga já — antes de devolver pro chamador — pra não
              // reaparecer se o app for reaberto sem um novo
              // compartilhamento.
              return Promise.all([cache.delete(SHARE_KEY_DATA), cache.delete(SHARE_KEY_IMAGEM)]).then(function () {
                return { texto: dados.text || "", titulo: dados.title || "", blob: blob, mime: dados.imageType || "" };
              });
            });
          });
        });
      })
      .catch(function () {
        return null;
      });
  }

  function processarCompartilhamentoSeHouver() {
    if (window.location.search.indexOf("compartilhado=1") === -1) return;
    // Limpa a URL já — se o usuário atualizar a página depois, não tenta
    // reprocessar (o conteúdo já foi apagado do cache de qualquer forma).
    history.replaceState(null, "", window.location.pathname);

    lerEApagarCompartilhamento().then(function (dados) {
      if (!dados) return;
      var texto = dados.texto || dados.titulo || "";
      if (texto) campoTexto.value = texto;
      if (dados.blob && dados.blob.size > 0) definirImagem(dados.blob, dados.mime);
      if (texto || (dados.blob && dados.blob.size > 0)) enviarConsulta();
    });
  }

  // ---- Consulta à API ----
  function chamarApi(payload, chave) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Quiz-Key": chave },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) {
            var erro = new Error((data && data.message) || "erro " + res.status);
            erro.status = res.status;
            throw erro;
          }
          return data;
        });
    });
  }

  function esconderCard() {
    card.hidden = true;
    quizJevLimpar(card);
    card.className = "card";
  }

  function exibirCarregando(comImagem) {
    card.hidden = false;
    quizJevLimpar(card);
    card.className = "card";
    quizJevMontarCarregando(card, comImagem ? "Analisando a imagem" : "Consultando");
  }

  function exibirResposta(data, comImagem) {
    quizJevLimpar(card);
    card.className = "card";
    quizJevMontarResposta(card, data, comImagem, false);
  }

  function exibirErro(erro) {
    quizJevLimpar(card);
    card.className = "card";
    var mensagem = (erro && erro.message) || "falhou";
    quizJevMontarErro(card, mensagem);
    if (erro && erro.status === 401) {
      var botao = document.createElement("button");
      botao.type = "button";
      botao.className = "botao-relay";
      botao.textContent = "Chave inválida — trocar chave";
      botao.addEventListener("click", function () {
        botaoTrocarChave.click();
      });
      card.appendChild(botao);
    }
  }

  function enviarConsulta() {
    var chave = obterChave();
    if (!chave) {
      mostrarTelaChave();
      return;
    }
    var raw = campoTexto.value.trim();
    var temImagem = !!imagemAtual;
    if (!raw && !temImagem) {
      avisoVazio.hidden = false;
      return;
    }
    avisoVazio.hidden = true;
    botaoEnviar.disabled = true;
    card.hidden = false;
    exibirCarregando(temImagem);

    var preparo = temImagem ? redimensionarImagem(imagemAtual.blob) : Promise.resolve(null);

    preparo
      .then(function (blobFinal) {
        var payload = {};
        if (raw) payload.raw = raw;
        var comImagem = false;
        var etapaImagem = Promise.resolve();
        if (blobFinal) {
          comImagem = true;
          etapaImagem = blobParaBase64(blobFinal).then(function (base64) {
            payload.imageBase64 = base64;
            payload.imageMime = "image/jpeg";
          });
        }
        return etapaImagem.then(function () {
          return chamarApi(payload, chave).then(function (data) {
            exibirResposta(data, comImagem);
          });
        });
      })
      .catch(function (erro) {
        exibirErro(erro);
      })
      .then(function () {
        botaoEnviar.disabled = false;
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    enviarConsulta();
  });

  // ---- Instalar na tela inicial ----
  var promptDeInstalacao = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    promptDeInstalacao = e;
    botaoInstalar.hidden = false;
  });

  botaoInstalar.addEventListener("click", function () {
    if (!promptDeInstalacao) return;
    botaoInstalar.disabled = true;
    promptDeInstalacao.prompt();
    promptDeInstalacao.userChoice.finally(function () {
      promptDeInstalacao = null;
      botaoInstalar.hidden = true;
      botaoInstalar.disabled = false;
    });
  });

  window.addEventListener("appinstalled", function () {
    botaoInstalar.hidden = true;
    instrucaoIos.hidden = true;
  });

  function rodandoInstalado() {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true
    );
  }

  function ehIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || navigator.platform || "");
  }

  if (!rodandoInstalado() && ehIos()) {
    instrucaoIos.hidden = false;
  }

  // ---- Início ----
  if (obterChave()) {
    mostrarTelaApp();
    processarCompartilhamentoSeHouver();
  } else {
    mostrarTelaChave();
  }
})();
