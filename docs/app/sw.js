// Service worker do app instalável do Quiz Jev (docs/app/). Duas
// responsabilidades, nesta ordem de importância:
//
//   1. Compartilhamento (share_target, ver manifest.webmanifest): o GitHub
//      Pages é estático e não aceita POST — SEM este service worker
//      interceptando a requisição, o POST feito pelo Android ao "action"
//      declarado no manifesto bateria numa URL que não existe e falharia com
//      404. É o service worker, rodando ANTES de qualquer coisa ir pra rede,
//      que lê o POST, guarda o conteúdo e redireciona (303) pra uma URL GET
//      normal — só então a "navegação" chega ao GitHub Pages de verdade.
//   2. Cache do app shell, pra abrir rápido e funcionar offline. Chamada à
//      API (api.santos-tech.com) NUNCA é cacheada — sempre rede.
//
// Ver docs/app/app.js (lerEApagarCompartilhamento) pro lado que LÊ e APAGA o
// que é guardado aqui — as duas pontas (SHARE_CACHE_NAME/SHARE_KEY_*)
// precisam ficar em sincronia manual entre os dois arquivos, não há import
// nenhum ligando eles.

const CACHE_VERSION = "v1";
const APP_SHELL_CACHE = "quizjev-app-shell-" + CACHE_VERSION;

// Cache separado e SEM versão no nome — não pode ser limpo no activate() de
// uma atualização do shell, senão um compartilhamento em trânsito (POST já
// tratado, mas a página ainda não abriu pra ler) se perderia numa
// atualização do service worker.
const SHARE_CACHE_NAME = "quizjev-share-store";
const SHARE_KEY_DATA = "/quiz-jev/app/__share__/data";
const SHARE_KEY_IMAGEM = "/quiz-jev/app/__share__/imagem";

const SHARE_ACTION_PATH = "/quiz-jev/app/share";
const APP_SHELL_URLS = [
  "/quiz-jev/app/",
  "/quiz-jev/app/index.html",
  "/quiz-jev/app/app.js",
  "/quiz-jev/app/manifest.webmanifest",
  "/quiz-jev/app/icon-192.png",
  "/quiz-jev/app/icon-512.png",
  "/quiz-jev/app/icon-maskable-512.png",
  "/quiz-jev/quiz-render.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      // Não espera todas as abas fecharem pra assumir a versão nova.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            .filter((nome) => nome !== APP_SHELL_CACHE && nome !== SHARE_CACHE_NAME)
            .map((nome) => caches.delete(nome))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Compartilhamento: SEMPRE tratado primeiro, antes de qualquer decisão
  // de cache — mesmo que a URL de ação um dia acabasse coincidindo com algo
  // do app shell, este bloco vem antes e retorna.
  if (req.method === "POST" && url.pathname === SHARE_ACTION_PATH) {
    event.respondWith(tratarCompartilhamento(event));
    return;
  }

  // Só GET a partir daqui — POST/PUT/etc. de outra origem (não deveria
  // acontecer nesta página estática) segue pra rede sem interceptar.
  if (req.method !== "GET") return;

  // 2) API: nunca cacheada, nunca interceptada — vai direto pra rede.
  if (url.hostname === "api.santos-tech.com") return;

  // 3) App shell: cache-first com atualização em segundo plano
  // (stale-while-revalidate), restrito às URLs conhecidas do shell — outras
  // origens/páginas (ex.: navegação solta fora do escopo) não são tocadas.
  if (url.origin === self.location.origin && APP_SHELL_URLS.indexOf(url.pathname) !== -1) {
    event.respondWith(
      // ignoreSearch: a navegação de volta do compartilhamento chega como
      // "/quiz-jev/app/?compartilhado=1" — mesmo pathname do shell
      // pré-cacheado, só com query string a mais; sem isso o cache erraria
      // e cairia pra rede à toa nessa navegação específica.
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        const rede = fetch(req)
          .then((res) => {
            // Só regrava o cache pra requisições SEM query string — a
            // navegação "?compartilhado=1" tem o mesmo pathname do shell,
            // mas gravá-la criaria uma segunda entrada (chave diferente)
            // pro mesmo conteúdo, sem necessidade.
            if (res && res.ok && !url.search) {
              const copia = res.clone();
              caches.open(APP_SHELL_CACHE).then((cache) => cache.put(req, copia));
            }
            return res;
          })
          .catch(() => cached);
        return cached || rede;
      })
    );
  }
});

async function tratarCompartilhamento(event) {
  try {
    const formData = await event.request.formData();
    const arquivo = formData.get("imagem");
    const texto = formData.get("text");
    const titulo = formData.get("title");
    const link = formData.get("url");

    const dados = {
      text: typeof texto === "string" ? texto : "",
      title: typeof titulo === "string" ? titulo : "",
      url: typeof link === "string" ? link : "",
      hasImage: false,
      imageType: "",
    };

    const cache = await caches.open(SHARE_CACHE_NAME);

    if (arquivo instanceof Blob && arquivo.size > 0) {
      dados.hasImage = true;
      dados.imageType = arquivo.type || "image/jpeg";
      await cache.put(SHARE_KEY_IMAGEM, new Response(arquivo, { headers: { "Content-Type": dados.imageType } }));
    } else {
      // Compartilhamento anterior pode ter deixado uma imagem presa (ex.:
      // usuário nunca abriu o app depois) — este é sempre o mais recente.
      await cache.delete(SHARE_KEY_IMAGEM);
    }

    await cache.put(
      SHARE_KEY_DATA,
      new Response(JSON.stringify(dados), { headers: { "Content-Type": "application/json" } })
    );
  } catch (e) {
    // Mesmo se algo falhar aqui (formData malformado, cache indisponível),
    // ainda respondemos com o redirect — a página abre normalmente e o
    // usuário cola/anexa de novo à mão.
  }

  // 303: transforma o POST numa navegação GET normal — é isso que faz o
  // navegador efetivamente "abrir o app" depois do compartilhamento.
  return Response.redirect("/quiz-jev/app/?compartilhado=1", 303);
}
