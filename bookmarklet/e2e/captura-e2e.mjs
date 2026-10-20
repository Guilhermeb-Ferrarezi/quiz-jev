// Teste ponta a ponta do bookmarklet num Chrome de verdade:
//   bun bookmarklet/e2e/captura-e2e.mjs
//
// Sobe uma página de prova local, abre o Chrome com a captura de aba
// autorizada (--auto-accept-this-tab-capture), roda o bookmarklet gerado
// (docs/bookmarklet.min.js — rode `bun bookmarklet/build.js` antes) e NÃO fala com
// servidor nenhum: no modo normal INTERCEPTA a chamada ao api-go; no modo Jev
// aponta o favorito para um proxy falso local. Em ambos o que se confere é o que o
// favorito MANDARIA (imagem, chave, cabeçalhos) e o que o card MOSTRA. As imagens
// saem em $QUIZJEV_E2E_SAIDA (padrão: a pasta temporária) pra olhar a olho.
//
// Variáveis: CHROME (caminho do executável), HEADFUL=1 (janela visível).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = path.join(import.meta.dir, "..", "..");
const SAIDA = process.env.QUIZJEV_E2E_SAIDA || path.join(os.tmpdir(), "quiz-jev-e2e");
fs.mkdirSync(SAIDA, { recursive: true });

const CHROME =
  process.env.CHROME ||
  ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("Chrome não encontrado — defina CHROME=caminho");

// ---- Páginas de prova ----
const estilo = "margin:0;padding:24px;font:16px/1.4 sans-serif;background:#fff;color:#111";
const PAGINAS = {
  "/tabela": `<body style="${estilo}"><div id="q">
    <p>Observe a tabela e responda: qual produto teve a maior venda?</p>
    <table border="1" style="border-collapse:collapse;width:420px"><tr><th>Produto</th><th>Vendas</th></tr>
      <tr><td>Caneta</td><td>120</td></tr><tr><td>Lápis</td><td>340</td></tr></table>
    A) Caneta<br>B) Lápis<br>C) Borracha<br>D) Régua</div>
    <div style="height:2000px"></div></body>`,
  // Tabela alta: não cabe na tela, obriga a rolar e costurar. Cada linha tem o número.
  "/alta": `<body style="${estilo}"><div style="height:300px">espaço antes</div><div id="q">
    <p>Leia a tabela longa e responda.</p>
    <table border="1" style="border-collapse:collapse;width:520px">${Array.from(
      { length: 24 },
      (_, i) => `<tr style="background:hsl(${i * 15},70%,85%)"><td style="height:64px;width:120px">linha ${i + 1}</td><td>valor ${(i + 1) * 7}</td></tr>`
    ).join("")}</table>
    <p>A) 7<br>B) 14<br>C) 21<br>D) 28</p></div>
    <div style="position:fixed;top:0;right:0;background:red;color:#fff;padding:4px">FIXO</div>
    <div style="height:2000px"></div></body>`,
  // Duas imagens: devem sair empilhadas numa só. Geradas na própria página (data URL).
  "/imagens": `<body style="${estilo}"><div id="q"><p>Compare as figuras e responda.</p>
    <img id="a" width="300" height="120"><br><img id="b" width="300" height="120">
    <p>A) a primeira<br>B) a segunda</p></div>
    <script>
      function cor(id, fundo, texto) {
        var c = document.createElement("canvas"); c.width = 300; c.height = 120;
        var x = c.getContext("2d"); x.fillStyle = fundo; x.fillRect(0, 0, 300, 120);
        x.fillStyle = "#000"; x.font = "32px sans-serif"; x.fillText(texto, 20, 70);
        document.getElementById(id).src = c.toDataURL("image/png");
      }
      cor("a", "#9fd3ff", "FIGURA 1"); cor("b", "#ffd39f", "FIGURA 2");
    </script></body>`,
  "/texto": `<body style="${estilo}"><div id="q"><p>Qual é a capital da Austrália?</p>
    <p>A) Sydney<br>B) Melbourne<br>C) Canberra<br>D) Perth</p></div></body>`,
  // Questão de julgar cada afirmativa (Certo/Errado), como a das provas do print.
  "/julgamento": `<body style="${estilo}"><div id="q">
    <div style="color:#666">Questão <b>01</b> de 06 <span style="float:right">10 PONTOS</span></div>
    <p>Diversos elementos estruturais fazem parte da narrativa. Ao analisar o trecho, avalie as afirmativas abaixo e marque se estão certas ou erradas.</p>
    ${[
      ["A", "A narrativa se organiza em torno de um tempo presente."],
      ["B", "O ambiente escolar do internato é o cenário principal."],
      ["C", "O foco narrativo é construído em primeira pessoa."],
      ["D", "O texto combina a descrição dos preparativos com a percepção do narrador."],
    ]
      .map(([l, t]) => `<div>${l}) ${t}<div><label><input type="radio" name="${l}">Certo</label> <label><input type="radio" name="${l}">Errado</label></div></div>`)
      .join("")}</div></body>`,
  // Lacunas com dropdown, imitando o Select do MUI (estrutura do HTML real da prova):
  // <div role="combobox" aria-controls> e a lista (role="listbox") num portal no <body>
  // só enquanto aberta. A primeira já nasce aberta, como no HTML colado. Abre no
  // mousedown; fecha com Esc dentro da lista ou clique no fundo.
  "/lacunas": `<body style="${estilo}"><div id="q">
    <h6><p>Questão <b>02</b> de 06</p></h6><div><p>*</p><p>10 PONTOS</p></div>
    <div class="ql-editor"><p>No texto, a palavra "por quê" aparece na última pergunta da mãe.</p><p><br></p><p>Analise o parágrafo explicativo abaixo e complete cada uma das lacunas com o "porquê" correto:</p></div>
    <div style="line-height:2.5">${[
      ["O ", ":r1h:", "1-", " é usado em perguntas diretas ou indiretas. Já "],
      ["", ":r1i:", "3-", " é usado em respostas. Quando aparece no final de frases, utiliza-se "],
      ["", ":r1j:", "5-", ". Por fim, "],
      ["", ":r1k:", "7-", " é usado como substantivo."],
    ]
      .map(
        ([antes, ctl, id, depois]) =>
          `<span style="white-space:pre-wrap">${antes}</span><span style="position:relative;display:inline-block"><div class="MuiInputBase-root"><div tabindex="0" role="combobox" aria-controls="${ctl}" aria-expanded="false" aria-haspopup="listbox" id="${id}" class="MuiSelect-select" style="display:inline-block;min-width:60px;border:1px solid green;padding:4px"><span class="notranslate"></span></div><input aria-hidden="true" tabindex="-1" value=""><svg width="12" height="12" viewBox="0 0 24 24"><path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"></path></svg></div></span><span style="white-space:pre-wrap">${depois}</span>`
      )
      .join("")}</div></div>
    <script>
      var OPCOES = ['"porquê"', '"por que"', '"porque"', '"por quê"'];
      function abrir(caixa) {
        var id = caixa.getAttribute("aria-controls");
        if (document.getElementById(id)) return;
        var raiz = document.createElement("div");
        raiz.setAttribute("role", "presentation");
        raiz.innerHTML = '<div class="MuiBackdrop-root" style="position:fixed;inset:0"></div>';
        var ul = document.createElement("ul");
        ul.setAttribute("role", "listbox"); ul.id = id; ul.tabIndex = -1;
        ul.style.cssText = "position:fixed;left:30px;top:60px;background:#fff;border:1px solid #999;margin:0;padding:4px;list-style:none";
        function fechar() { caixa.setAttribute("aria-expanded", "false"); setTimeout(function () { raiz.remove(); }, 120); }
        OPCOES.forEach(function (t) {
          var li = document.createElement("li"); li.setAttribute("role", "option"); li.textContent = t;
          li.addEventListener("click", function () { caixa.querySelector("span").textContent = t; window.__escolhas = (window.__escolhas || 0) + 1; fechar(); });
          ul.appendChild(li);
        });
        raiz.appendChild(ul);
        document.body.appendChild(raiz);
        caixa.setAttribute("aria-expanded", "true");
        raiz.addEventListener("keydown", function (e) { if (e.key === "Escape") fechar(); });
        raiz.querySelector(".MuiBackdrop-root").addEventListener("click", fechar);
      }
      document.querySelectorAll('[role="combobox"]').forEach(function (c) {
        c.addEventListener("mousedown", function (e) { if (e.button !== 0) return; e.preventDefault(); abrir(c); });
      });
      abrir(document.querySelector('[role="combobox"]'));
    </script></body>`,
  // Lacunas com <select> nativo: as opções já estão na página (não precisa abrir).
  "/lacunas-select": `<body style="${estilo}"><div id="q"><p>Complete as lacunas do texto escolhendo a opção correta:</p>
    <p>O gato <select><option value="">escolha</option><option value="1">mia</option><option value="2">late</option><option value="3">canta</option></select> e o cão
    <select><option value="">escolha</option><option value="1">mia</option><option value="2">late</option><option value="3">canta</option></select> alto.</p></div></body>`,
  // Escolha única com botões de rádio (um grupo só), alternativas no rótulo.
  "/radios-unica": `<body style="${estilo}"><div id="q"><p>Qual é a capital da Austrália?</p>
    ${["A) Sydney", "B) Melbourne", "C) Canberra", "D) Perth"].map((t) => `<div><label><input type="radio" name="q1"> ${t}</label></div>`).join("")}</div></body>`,
  "/sem-alternativas": `<body style="${estilo}"><div id="q"><p>Explique, com suas palavras, como funciona a fotossíntese.</p>
    <p>Responda em um parágrafo curto.</p><p>Valor: 2 pontos.</p></div></body>`,
};

const servidor = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const html = PAGINAS[new URL(req.url).pathname];
    return html ? new Response("<!doctype html><meta charset=utf-8>" + html, { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("404", { status: 404 });
  },
});
const BASE = `http://127.0.0.1:${servidor.port}`;

// A página de instalação (docs/) servida de verdade, pra gerar o favorito por ela.
const servidorDocs = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const caminho = new URL(req.url).pathname;
    const arquivo = path.join(RAIZ, "docs", caminho === "/" ? "index.html" : caminho.replace(/^\//, ""));
    if (!arquivo.startsWith(path.join(RAIZ, "docs")) || !fs.existsSync(arquivo)) return new Response("404", { status: 404 });
    return new Response(Bun.file(arquivo));
  },
});
const BASE_DOCS = `http://127.0.0.1:${servidorDocs.port}`;

// ---- Proxy do Jev falso (modo Jev) ----
// Grava cada pedido e responde no formato do Jev. A chave "apikey_e2e_ok" é a
// válida; qualquer outra leva 401.
const CHAVE_JEV_OK = "apikey_e2e_ok_" + "x".repeat(30);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,typesafe-danger-zone-images", "access-control-allow-methods": "POST,OPTIONS" };
// CORS do api-go interceptado (modo normal): o favorito manda X-Quiz-Key.
const CORS_API_GO = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-quiz-key", "access-control-allow-methods": "POST,OPTIONS,HEAD" };
const pedidosProxy = [];

// O "Jev" falso: devolve {status, corpo} no formato da API real.
function jevFalso(corpo, autorizacao) {
  if (autorizacao !== `Bearer ${CHAVE_JEV_OK}`) return { status: 401, corpo: { message: "invalid key" } };
  const perguntas = Object.keys(corpo.questions);
  // Lacunas com dropdown: uma escolha por lacuna. Lacuna 1 -> B (90%), 2 -> C (60%, incerta), demais -> A.
  if (perguntas.every((k) => k.startsWith("lacuna_"))) {
    const respostas = {};
    for (const k of perguntas) {
      const n = Number(k.split("_")[1]);
      const rotulos = Object.keys(corpo.questions[k].criteria);
      const escolha = n === 1 ? "B" : n === 2 ? "C" : "A";
      const pico = n === 2 ? 0.6 : 0.9;
      respostas[k] = { type: "choice", choice: escolha, confidence: pico, probabilities: Object.fromEntries(rotulos.map((r) => [r, r === escolha ? pico : (1 - pico) / (rotulos.length - 1)])) };
    }
    return { status: 200, corpo: { model: "jev-1.13.0", answers: respostas } };
  }
  // Afirmativas a julgar: uma pergunta sim/não (noul) por alternativa. C e D certas.
  if (!corpo.questions.resposta) {
    const prob = { alt_A: 0.1, alt_B: 0.05, alt_C: 0.92, alt_D: 0.8 };
    const respostas = Object.fromEntries(perguntas.map((k) => [k, { type: "noul", noul: prob[k] ?? 0.5 }]));
    return { status: 200, corpo: { model: "jev-1.13.0", answers: respostas } };
  }
  const opcoes = Object.keys(corpo.questions.resposta.criteria).filter((k) => k !== "Ilegível");
  const probs = Object.fromEntries(opcoes.map((o) => [o, o === "B" ? 0.9 : 0.1 / (opcoes.length - 1)]));
  return { status: 200, corpo: { model: "jev-1.13.0", answers: { resposta: { type: "choice", choice: "B", confidence: 0.85, probabilities: probs } } } };
}

const proxy = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return new Response("ok", { headers: CORS });
    const corpo = await req.json();
    pedidosProxy.push({ cabecalhos: Object.fromEntries(req.headers), corpo });
    const r = jevFalso(corpo, req.headers.get("authorization"));
    return Response.json(r.corpo, { status: r.status, headers: CORS });
  },
});
const URL_PROXY = `http://127.0.0.1:${proxy.port}`;

// ---- Chrome + CDP ----
const PORTA_CDP = 9333;
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-jev-chrome-"));
const chrome = Bun.spawn(
  [
    CHROME,
    `--remote-debugging-port=${PORTA_CDP}`,
    `--user-data-dir=${perfil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--auto-accept-this-tab-capture",
    "--window-size=1100,900",
    "--disable-features=Translate",
    ...(process.env.HEADFUL ? [] : ["--headless=new"]),
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" }
);

async function esperarCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`);
      if (r.ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("o Chrome não abriu a porta de depuração");
}

function conectar(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pendentes = new Map();
  const ouvintes = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { ok, erro } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      msg.error ? erro(new Error(`${msg.error.message}`)) : ok(msg.result);
    } else if (msg.method) {
      for (const o of ouvintes) o(msg);
    }
  };
  const pronto = new Promise((ok) => (ws.onopen = ok));
  return {
    pronto,
    enviar: (method, params = {}) =>
      new Promise((ok, erro) => {
        const meuId = ++id;
        pendentes.set(meuId, { ok, erro });
        ws.send(JSON.stringify({ id: meuId, method, params }));
      }),
    aoEvento: (fn) => ouvintes.push(fn),
    fechar: () => ws.close(),
  };
}

// Lê largura/altura do cabeçalho de um PNG (IHDR).
function dimensoesPng(base64) {
  const b = Buffer.from(base64, "base64");
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("não é PNG");
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20), bytes: b.length };
}

const template = (() => {
  const g = {};
  new Function("window", fs.readFileSync(path.join(RAIZ, "docs", "bookmarklet.min.js"), "utf8"))(g);
  return g.QUIZ_JEV_BOOKMARKLET_TEMPLATE;
})();
const montarCodigo = (modo, chave, endereco) => template.split("__QUIZ_KEY__").join(chave).split("__QUIZ_MODO__").join(modo).split("__QUIZ_PROXY__").join(endereco);

const RESPOSTA_FALSA = {
  kind: "unica",
  answer: "B",
  answerText: "resposta de teste",
  source: "jev",
  confidence: 0.9,
  probabilities: { A: 0.05, B: 0.9, C: 0.03, D: 0.02 },
};

// Conta linhas inteiramente brancas entre x0 e x1 (ignora as bordas de cima e de
// baixo): numa tabela de células coloridas, isso é vão na costura. Roda dentro
// do Chrome, desenhando a imagem enviada num canvas.
async function linhasBrancas(cdp, base64, x0, x1, margemTopo, margemBase) {
  const r = await cdp.enviar("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const img = new Image(); img.src = "data:image/png;base64,${base64}"; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const larg = ${x1 - x0}, d = x.getImageData(${x0}, 0, larg, c.height).data;
      let brancas = 0;
      for (let y = ${margemTopo}; y < c.height - ${margemBase}; y++) {
        let tudo = true;
        for (let i = 0; i < larg && tudo; i++) { const o = (y * larg + i) * 4; if (d[o] !== 255 || d[o + 1] !== 255 || d[o + 2] !== 255) tudo = false; }
        if (tudo) brancas++;
      }
      return brancas;
    })()`,
  });
  return r.result.value;
}

// O que o card mostra (ele vive num Shadow DOM aberto).
const LER_CARD = `(() => {
  const h = document.getElementById("__quiz-jev-bookmarklet"); if (!h) return null;
  const s = h.shadowRoot, q = (sel) => { const e = s.querySelector(sel); return e ? e.textContent : null; };
  return { letra: q(".letra"), erro: q(".erro"), texto: q(".card"), vereditos: [...s.querySelectorAll(".veredito")].map((e) => e.textContent), textos: [...s.querySelectorAll(".julga .opcao-texto")].map((e) => e.textContent), lacunas: [...s.querySelectorAll(".lacuna-escolha")].map((e) => ({ texto: e.textContent, incerta: e.classList.contains("incerto") })), numeros: [...s.querySelectorAll(".julga .opcao-letra")].map((e) => e.textContent) };
})()`;

// opcoes: { modo: "qz" | "jev", chave, analise(cdp, imagemBase64), aposRodar(cdp) }
async function cenario(nome, caminho, opcoes = {}) {
  const modo = opcoes.modo || "qz";
  const chave = opcoes.chave || (modo === "jev" ? CHAVE_JEV_OK : "qz_e2etestkey1234567890");
  const codigo = opcoes.href ? null : montarCodigo(modo, chave, modo === "jev" ? URL_PROXY : "");

  const aba = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?${BASE}${caminho}`, { method: "PUT" })).json();
  const cdp = conectar(aba.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.enviar("Page.enable");
  await cdp.enviar("Runtime.enable");
  await cdp.enviar("Network.enable");
  await cdp.enviar("Page.bringToFront");
  // api-go (modo normal) e o proxy "https://proxy.teste" (favorito gerado pela página, que só aceita https).
  await cdp.enviar("Fetch.enable", { patterns: [{ urlPattern: "https://api.santos-tech.com/*" }, { urlPattern: "https://proxy.teste/*" }] });

  const postsApiGo = [];
  const errosPagina = [];
  cdp.aoEvento(async (msg) => {
    if (msg.method === "Runtime.exceptionThrown") errosPagina.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method !== "Fetch.requestPaused") return;
    const { requestId, request, networkId } = msg.params;
    const responder = (status, corpo, cors = CORS_API_GO) =>
      cdp.enviar("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: Object.entries({ ...cors, "content-type": "application/json" }).map(([name, value]) => ({ name, value })),
        body: Buffer.from(corpo || "").toString("base64"),
      });
    if (request.url.startsWith("https://proxy.teste/")) {
      if (request.method !== "POST") return responder(204, "", CORS);
      let texto = request.postData;
      if (texto === undefined && request.hasPostData) texto = (await cdp.enviar("Network.getRequestPostData", { requestId: networkId })).postData;
      const cabecalhos = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const corpo = JSON.parse(texto);
      pedidosProxy.push({ cabecalhos, corpo });
      const r = jevFalso(corpo, cabecalhos.authorization);
      return responder(r.status, JSON.stringify(r.corpo), CORS);
    }
    if (request.method === "POST") {
      let corpo = request.postData;
      if (corpo === undefined && request.hasPostData) corpo = (await cdp.enviar("Network.getRequestPostData", { requestId: networkId })).postData;
      postsApiGo.push(JSON.parse(corpo));
      await responder(200, JSON.stringify(RESPOSTA_FALSA));
    } else {
      await responder(request.method === "OPTIONS" ? 204 : 200, "");
    }
  });

  for (let i = 0; i < 40; i++) {
    const estado = await cdp.enviar("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (estado.result.value === "complete") break;
    await Bun.sleep(100);
  }
  await Bun.sleep(300);
  const viewport = (await cdp.enviar("Runtime.evaluate", { expression: "[innerWidth, innerHeight]", returnByValue: true })).result.value;
  await cdp.enviar("Runtime.evaluate", { expression: `getSelection().selectAllChildren(document.getElementById("q")); 1` });

  const antesProxy = pedidosProxy.length;
  const t0 = Date.now();
  // userGesture: o getDisplayMedia só abre com ativação do usuário. Com `href`, roda o
  // link `javascript:` gerado pela página de instalação, do jeito que o favorito roda.
  if (opcoes.href) await cdp.enviar("Page.navigate", { url: opcoes.href });
  else await cdp.enviar("Runtime.evaluate", { expression: codigo, userGesture: true });
  if (opcoes.aposRodar) await opcoes.aposRodar(cdp);

  const enviado = () => (modo === "jev" ? pedidosProxy.length > antesProxy : postsApiGo.length > 0);
  // Cenários que nem chegam a consultar (erro antes) esperam o card mostrar algo.
  for (let i = 0; i < 300 && !enviado() && !(opcoes.semConsulta && i > 15); i++) await Bun.sleep(100);
  const ms = Date.now() - t0;
  await Bun.sleep(1200); // deixa o card mostrar a resposta
  const card = (await cdp.enviar("Runtime.evaluate", { expression: LER_CARD, returnByValue: true })).result.value;
  const shot = await cdp.enviar("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SAIDA, `${nome}-pagina.png`), Buffer.from(shot.data, "base64"));

  // Diagnóstico: viewport depois da captura e tamanho do quadro do vídeo.
  const medidas = (
    await cdp.enviar("Runtime.evaluate", {
      expression: "(window.__quizJevTela ? [innerWidth, innerHeight, __quizJevTela.video.videoWidth, __quizJevTela.video.videoHeight, devicePixelRatio] : null)",
      returnByValue: true,
    })
  ).result.value;

  const resultado = { nome, viewport, medidas, ms, enviou: enviado(), card, errosPagina };
  // Estado da página DEPOIS do favorito (ex.: ele deixou dropdown aberto?).
  if (opcoes.analisePagina) resultado.pagina = await opcoes.analisePagina(cdp);
  if (enviado()) {
    // No modo Jev, a imagem é o asset do pedido; no normal, imageBase64.
    let post, base64, mime;
    if (modo === "jev") {
      post = pedidosProxy[antesProxy];
      resultado.jev = { cabecalhos: post.cabecalhos, corpo: post.corpo };
      const asset = post.corpo.assets && Object.values(post.corpo.assets)[0];
      if (asset) {
        base64 = asset.data_base64;
        mime = "image/" + (asset.format === "jpeg" ? "jpeg" : "png");
      }
      resultado.temTexto = !!post.corpo.state;
    } else {
      post = postsApiGo[0];
      base64 = post.imageBase64;
      mime = post.imageMime;
      resultado.temTexto = !!post.raw;
      resultado.temUrl = !!post.imageUrl;
    }
    resultado.temImagem = !!base64;
    if (base64) {
      resultado.imagem = mime === "image/png" ? dimensoesPng(base64) : { mime };
      fs.writeFileSync(path.join(SAIDA, `${nome}-enviada.${mime === "image/png" ? "png" : "jpg"}`), Buffer.from(base64, "base64"));
      if (opcoes.analise) resultado.extra = await opcoes.analise(cdp, base64);
    }
  }
  cdp.fechar();
  await fetch(`http://127.0.0.1:${PORTA_CDP}/json/close/${aba.id}`);
  return resultado;
}

// Abre a página de instalação, preenche a chave do Jev e o proxy, clica em gerar e
// devolve o `href` do botão azul (o que o usuário arrastaria pra barra).
async function gerarFavoritoPelaPagina() {
  const aba = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?${BASE_DOCS}/`, { method: "PUT" })).json();
  const cdp = conectar(aba.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.enviar("Runtime.enable");
  for (let i = 0; i < 40; i++) {
    const r = await cdp.enviar("Runtime.evaluate", { expression: "document.readyState === 'complete' && !!window.QUIZ_JEV_BOOKMARKLET_TEMPLATE", returnByValue: true });
    if (r.result.value) break;
    await Bun.sleep(100);
  }
  const href = (
    await cdp.enviar("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        document.getElementById("campo-chave-jev").value = ${JSON.stringify(CHAVE_JEV_OK)};
        document.getElementById("campo-proxy").value = "https://proxy.teste";
        document.getElementById("botao-gerar-jev").click();
        return document.getElementById("link-bookmarklet").getAttribute("href");
      })()`,
    })
  ).result.value;
  cdp.fechar();
  await fetch(`http://127.0.0.1:${PORTA_CDP}/json/close/${aba.id}`);
  return href;
}

let falhas = 0;
function conferir(condicao, mensagem) {
  console.log(`  ${condicao ? "ok  " : "FALHOU"} ${mensagem}`);
  if (!condicao) falhas++;
}

try {
  await esperarCdp();

  console.log("== MODO NORMAL (api-go interceptado) ==");

  console.log("texto puro (controle: não deve haver imagem nem pedido de captura)");
  const texto = await cenario("texto", "/texto");
  conferir(texto.enviou && texto.temTexto && !texto.temImagem, "enviou só o texto");

  console.log("tabela que cabe na tela (print único recortado)");
  const tabela = await cenario("tabela", "/tabela");
  conferir(tabela.enviou && tabela.temImagem, `enviou imagem (${JSON.stringify(tabela.imagem)})`);
  if (tabela.imagem?.largura) conferir(tabela.imagem.altura < tabela.viewport[1] * 2 && tabela.imagem.largura < tabela.viewport[0] * 2, "o recorte é só da região, não da tela inteira");

  console.log("tabela alta (rola e costura)");
  // A tabela ocupa x ~10..380 da imagem; o parágrafo de cima e as alternativas
  // de baixo ficam fora da conta (margens).
  const alta = await cenario("alta", "/alta", { analise: (cdp, b64) => linhasBrancas(cdp, b64, 10, 380, 45, 120) });
  console.log(`  [innerW, innerH, quadroW, quadroH, dpr] = ${JSON.stringify(alta.medidas)}  antes: ${JSON.stringify(alta.viewport)}`);
  conferir(alta.enviou && alta.temImagem, `enviou imagem (${JSON.stringify(alta.imagem)})`);
  if (alta.imagem?.altura) conferir(alta.imagem.altura > alta.viewport[1], "a imagem costurada é mais alta que a tela");
  conferir(alta.extra === 0, `sem vão branco entre as faixas (linhas brancas na tabela: ${alta.extra})`);

  console.log("duas imagens (empilhadas)");
  const imagens = await cenario("imagens", "/imagens");
  conferir(imagens.enviou && imagens.temImagem, `enviou imagem (${JSON.stringify(imagens.imagem)})`);
  if (imagens.imagem?.altura) conferir(imagens.imagem.altura >= 230 && imagens.imagem.altura <= 250, "as duas figuras estão uma sobre a outra (~240 px de altura)");

  console.log("\n== MODO JEV (proxy falso local) ==");

  console.log("texto com alternativas: vai ao Jev como choice, sem imagem");
  const jTexto = await cenario("jev-texto", "/texto", { modo: "jev" });
  conferir(jTexto.enviou, "chegou ao proxy");
  if (jTexto.jev) {
    const c = jTexto.jev.corpo;
    conferir(jTexto.jev.cabecalhos.authorization === `Bearer ${CHAVE_JEV_OK}`, "mandou a chave do Jev em Authorization: Bearer");
    conferir(typeof c.state === "string" && c.state.includes("capital da Austrália"), "o estado é o enunciado");
    conferir(JSON.stringify(Object.keys(c.questions.resposta.criteria)) === JSON.stringify(["A", "B", "C", "D"]) && c.questions.resposta.criteria.C === "Canberra", "as alternativas viraram critérios (A–D, com o texto)");
    conferir(!c.assets && !jTexto.jev.cabecalhos["typesafe-danger-zone-images"], "sem imagem: nada de assets nem do header de imagem");
  }
  conferir(jTexto.card?.letra === "B" && !jTexto.card?.erro, `o card mostra a alternativa B (${JSON.stringify(jTexto.card?.letra)})`);

  console.log("tabela + alternativas: manda o print como asset PNG, com o header de imagem");
  const jTabela = await cenario("jev-tabela", "/tabela", { modo: "jev" });
  conferir(jTabela.enviou && jTabela.temImagem, `enviou imagem (${JSON.stringify(jTabela.imagem)})`);
  if (jTabela.jev) {
    const c = jTabela.jev.corpo;
    conferir(jTabela.jev.cabecalhos["typesafe-danger-zone-images"] === "true", "mandou TypeSafe-Danger-Zone-Images: true");
    conferir(Array.isArray(c.state) && Object.keys(c.assets).includes(c.state[1]), "o marcador do estado aponta pro asset");
    conferir(Object.values(c.assets)[0].format === "png", "o asset é PNG");
  }
  conferir(jTabela.card?.letra === "B", "o card mostra a alternativa");

  console.log("afirmativas Certo/Errado (como no print): uma pergunta sim/não por alternativa");
  const jJulga = await cenario("jev-julgamento", "/julgamento", { modo: "jev" });
  conferir(jJulga.enviou, "chegou ao proxy");
  if (jJulga.jev) {
    const c = jJulga.jev.corpo;
    conferir(!c.questions.resposta && JSON.stringify(Object.keys(c.questions)) === JSON.stringify(["alt_A", "alt_B", "alt_C", "alt_D"]), "uma pergunta sim/não (noul) por afirmativa, sem escolha única");
    conferir(c.questions.alt_C.criteria.true.includes("foco narrativo") && !/Certo|Errado/.test(c.questions.alt_C.criteria.true), "o texto da afirmativa vai sem o 'Certo Errado'");
    conferir(typeof c.state === "string" && c.state.startsWith("Diversos elementos") && !c.state.includes("PONTOS"), `o enunciado vai sem o cabeçalho da plataforma (começa com ${JSON.stringify(String(c.state).slice(0, 60))})`);
  }
  conferir(JSON.stringify(jJulga.card?.vereditos) === JSON.stringify(["Errado", "Errado", "Certo", "Certo"]), `o card mostra Errado, Errado, Certo, Certo (${JSON.stringify(jJulga.card?.vereditos)})`);
  conferir(jJulga.card?.textos?.length === 4 && !/Certo Errado/.test(jJulga.card.textos.join(" ")), "as quatro afirmativas aparecem no card");

  console.log("lacunas com dropdown (estrutura do MUI): abre cada lista, lê as opções e fecha sem escolher");
  const jLac = await cenario("jev-lacunas", "/lacunas", {
    modo: "jev",
    analisePagina: async (cdp) =>
      (await cdp.enviar("Runtime.evaluate", { returnByValue: true, expression: `({ listas: document.querySelectorAll('[role="listbox"]').length, expandidos: document.querySelectorAll('[aria-expanded="true"]').length, valores: [...document.querySelectorAll('[role="combobox"]')].map((e) => e.textContent) })` })).result.value,
  });
  conferir(jLac.enviou, "chegou ao proxy");
  if (jLac.jev) {
    const c = jLac.jev.corpo;
    conferir(JSON.stringify(Object.keys(c.questions)) === JSON.stringify(["lacuna_1", "lacuna_2", "lacuna_3", "lacuna_4"]), "uma pergunta de escolha por lacuna");
    const ops = Object.values(c.questions.lacuna_3.criteria);
    conferir(ops.length === 4 && ops[1].includes("por que") && ops[3].includes("por quê"), `as 4 opções da lacuna 3 foram lidas do dropdown (${JSON.stringify(ops)})`);
    conferir(typeof c.state === "string" && c.state.startsWith("No texto") && /\[1\].*\[2\].*\[3\].*\[4\]/s.test(c.state), "o texto vai com os marcadores [1] a [4] na ordem");
    conferir(!/PONTOS|Questão 02/.test(c.state), "e sem o cabeçalho da plataforma");
    conferir(c.state.includes("O [1] é usado em perguntas") && c.state.includes("utiliza-se [3] . Por fim, [4] é usado"), "cada marcador fica no lugar certo da frase");
  }
  conferir(JSON.stringify(jLac.card?.numeros) === JSON.stringify(["[1]", "[2]", "[3]", "[4]"]), `o card lista as 4 lacunas (${JSON.stringify(jLac.card?.numeros)})`);
  conferir(JSON.stringify(jLac.card?.lacunas?.map((l) => l.texto)) === JSON.stringify(['"por que"', '"porque"', '"porquê"', '"porquê"']), `com a opção escolhida em cada (${JSON.stringify(jLac.card?.lacunas?.map((l) => l.texto))})`);
  conferir(jLac.card?.lacunas?.[1]?.incerta === true && jLac.card?.lacunas?.[0]?.incerta === false, "só a lacuna de 60% de confiança fica marcada como incerta");
  conferir(jLac.pagina?.listas === 0 && jLac.pagina?.expandidos === 0, `a página fica como estava: nenhuma lista aberta (${JSON.stringify(jLac.pagina)})`);
  conferir(jLac.pagina?.valores?.every((v) => v === ""), "e nenhuma opção foi escolhida por ele");

  console.log("lacunas com <select> nativo: lê as opções sem abrir nada e ignora o 'escolha'");
  const jSel = await cenario("jev-lacunas-select", "/lacunas-select", { modo: "jev" });
  conferir(jSel.enviou, "chegou ao proxy");
  if (jSel.jev) {
    const c = jSel.jev.corpo;
    conferir(JSON.stringify(Object.values(c.questions.lacuna_1.criteria).map((t) => t.match(/«(.*)»/)[1])) === JSON.stringify(["mia", "late", "canta"]), "as opções são mia, late e canta (sem o 'escolha')");
    conferir(c.state.includes("O gato [1] e o cão [2] alto."), `o texto vai com os marcadores (${JSON.stringify(String(c.state).slice(-45))})`);
  }
  conferir(jSel.card?.numeros?.length === 2, "o card lista as 2 lacunas");

  // Clica em "Preencher na página" no card e devolve a mensagem dele + o estado da página.
  const preencherEAnalisar = (exprEstado) => async (cdp) =>
    (
      await cdp.enviar("Runtime.evaluate", {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async () => {
          const s = document.getElementById("__quiz-jev-bookmarklet").shadowRoot;
          const b = s.querySelector(".preencher-area button");
          if (!b) return { semBotao: true };
          b.click();
          const m = s.querySelector(".preencher-area .motivo");
          for (let i = 0; i < 100 && !m.textContent; i++) await new Promise((r) => setTimeout(r, 100));
          await new Promise((r) => setTimeout(r, 300));
          return { status: m.textContent, botao: b.textContent, estado: (${exprEstado}) };
        })()`,
      })
    ).result.value;

  console.log("preencher na página — Certo/Errado: marca os rádios, sem enviar nada");
  const pJul = await cenario("jev-preencher-julgamento", "/julgamento", {
    modo: "jev",
    analisePagina: preencherEAnalisar(`[...document.querySelectorAll('input[type=radio]')].map((r) => r.checked ? r.parentElement.textContent : "-")`),
  });
  conferir(JSON.stringify(pJul.pagina?.estado) === JSON.stringify(["-", "Errado", "-", "Errado", "Certo", "-", "Certo", "-"]), `marcou Errado, Errado, Certo, Certo (${JSON.stringify(pJul.pagina?.estado)}; ${pJul.pagina?.status})`);
  conferir(/Preenchi 4 de 4/.test(pJul.pagina?.status || ""), "o card diz que preencheu 4 de 4 e pede para conferir");

  console.log("preencher na página — lacunas com dropdown (MUI): escolhe cada opção");
  const pLac = await cenario("jev-preencher-lacunas", "/lacunas", {
    modo: "jev",
    analisePagina: preencherEAnalisar(`({ valores: [...document.querySelectorAll('[role="combobox"]')].map((e) => e.textContent), listas: document.querySelectorAll('[role="listbox"]').length, expandidos: document.querySelectorAll('[aria-expanded="true"]').length })`),
  });
  conferir(JSON.stringify(pLac.pagina?.estado?.valores) === JSON.stringify(['"por que"', '"porque"', '"porquê"', '"porquê"']), `escolheu as 4 opções (${JSON.stringify(pLac.pagina?.estado?.valores)}; ${pLac.pagina?.status})`);
  conferir(pLac.pagina?.estado?.listas === 0 && pLac.pagina?.estado?.expandidos === 0, "e não deixou nenhuma lista aberta");

  console.log("preencher na página — lacunas com <select> nativo");
  const pSel = await cenario("jev-preencher-select", "/lacunas-select", {
    modo: "jev",
    analisePagina: preencherEAnalisar(`[...document.querySelectorAll("select")].map((s) => s.selectedIndex)`),
  });
  conferir(pSel.pagina?.estado?.length === 2 && pSel.pagina.estado.every((i) => i > 0), `os dois <select> deixaram de estar em 'escolha' (${JSON.stringify(pSel.pagina?.estado)}; ${pSel.pagina?.status})`);

  console.log("preencher na página — escolha única com rádios");
  const pUni = await cenario("jev-preencher-unica", "/radios-unica", {
    modo: "jev",
    analisePagina: preencherEAnalisar(`[...document.querySelectorAll('input[type=radio]')].map((r) => r.checked)`),
  });
  conferir(JSON.stringify(pUni.pagina?.estado) === JSON.stringify([false, true, false, false]), `marcou a alternativa B (${JSON.stringify(pUni.pagina?.estado)}; ${pUni.pagina?.status})`);

  console.log("card recolhível: clicar na página recolhe (não fecha), pastilha reabre, Alt+W alterna, − esconde, × fecha");
  const etapas = {};
  const expr = (corpo) => `(() => { const h = document.getElementById("__quiz-jev-bookmarklet"); if (!h) return null; const c = h.shadowRoot.querySelector(".card"); return (${corpo})(c, h); })()`;
  const ler = async (cdp, corpo) => (await cdp.enviar("Runtime.evaluate", { expression: expr(corpo), returnByValue: true })).result.value;
  const clicarEm = async (cdp, x, y) => {
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await Bun.sleep(250);
  };
  const estado = (cdp) => ler(cdp, `(c) => ({ recolhido: c.classList.contains("minimizado"), altura: Math.round(c.getBoundingClientRect().height), mini: c.querySelector(".mini").textContent, letraVisivel: !!c.querySelector(".letra") && c.querySelector(".letra").offsetHeight > 0, botao: c.querySelector(".alternar").textContent })`);
  await cenario("jev-card-recolhivel", "/texto", {
    modo: "jev",
    aposRodar: async (cdp) => {
      for (let i = 0; i < 80 && !(await ler(cdp, `(c) => !!c.querySelector(".letra")`)); i++) await Bun.sleep(100);
      await Bun.sleep(700);
      etapas.inicio = await estado(cdp);
      fs.writeFileSync(path.join(SAIDA, "jev-card-expandido.png"), Buffer.from((await cdp.enviar("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 520, height: 330, scale: 1 } })).data, "base64"));
      await clicarEm(cdp, 800, 600); // clique na página, longe do card (como ao selecionar as alternativas)
      etapas.aposClique = await estado(cdp);
      fs.writeFileSync(path.join(SAIDA, "jev-card-recolhido.png"), Buffer.from((await cdp.enviar("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 520, height: 330, scale: 1 } })).data, "base64"));
      const r = await ler(cdp, `(c) => { const b = c.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; }`);
      await clicarEm(cdp, r[0], r[1]); // clique na pastilha
      etapas.aposPastilha = await estado(cdp);
      const alt = (tecla) => cdp.enviar("Runtime.evaluate", { expression: `document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(tecla)}, altKey: true, bubbles: true, cancelable: true })); 1` });
      await alt("w");
      etapas.aposAltW1 = await estado(cdp);
      await alt("w");
      etapas.aposAltW2 = await estado(cdp);
      await ler(cdp, `(c) => c.querySelector(".alternar").click()`);
      etapas.aposBotaoMenos = await estado(cdp);
      await ler(cdp, `(c) => c.querySelector(".alternar").click()`);
      etapas.aposBotaoMais = await estado(cdp);
      await ler(cdp, `(c) => c.querySelector(".fechar").click()`);
      await Bun.sleep(500);
      etapas.aposFechar = await ler(cdp, `(c) => 1`);
    },
  });
  conferir(etapas.inicio && !etapas.inicio.recolhido && etapas.inicio.letraVisivel, `a resposta aparece (${JSON.stringify(etapas.inicio)})`);
  conferir(etapas.aposClique?.recolhido === true && etapas.aposClique.altura < 60, `clicar na página recolhe o card em vez de fechar (altura ${etapas.aposClique?.altura}px)`);
  conferir(etapas.aposClique?.mini === "Quiz Jev · B", `a pastilha mostra a resposta (${JSON.stringify(etapas.aposClique?.mini)})`);
  conferir(etapas.aposPastilha?.recolhido === false && etapas.aposPastilha.letraVisivel, "clicar na pastilha mostra o card de novo");
  conferir(etapas.aposAltW1?.recolhido === true && etapas.aposAltW2?.recolhido === false, "Alt+W esconde e mostra");
  conferir(etapas.aposBotaoMenos?.recolhido === true && etapas.aposBotaoMenos.botao === "+" && etapas.aposBotaoMais?.recolhido === false && etapas.aposBotaoMais.botao === "−", "o botão alterna entre − e +");
  conferir(etapas.aposFechar === null, "o botão × fecha o card de vez");

  console.log("chave recusada (401): mensagem clara no card");
  const jRuim = await cenario("jev-chave-ruim", "/texto", { modo: "jev", chave: "apikey_errada_" + "y".repeat(30) });
  conferir(jRuim.enviou && /chave do Jev foi recusada/i.test(jRuim.card?.erro || ""), `card: ${JSON.stringify(jRuim.card?.erro)}`);

  console.log("texto sem alternativas e sem imagem: erro claro, sem gastar chamada");
  const jSem = await cenario("jev-sem-alternativas", "/sem-alternativas", { modo: "jev", semConsulta: true });
  conferir(!jSem.enviou && /só escolhe entre alternativas/i.test(jSem.card?.erro || ""), `card: ${JSON.stringify(jSem.card?.erro)}`);

  console.log("tecla T (pergunta livre): explica que não existe no modo Jev");
  console.log("favorito gerado pela PÁGINA DE INSTALAÇÃO (link javascript: de verdade)");
  const href = await gerarFavoritoPelaPagina();
  conferir(href.startsWith("javascript:") && href.length < 65000, `o link tem ${href.length} bytes (limite ~65536)`);
  conferir(!/%20|%22|%7B/.test(href) && !/[^\x20-\x7e]/.test(href), "codificação mínima: espaço, aspas e chaves ficam como estão; nada de não-ASCII cru");
  const jPagina = await cenario("jev-favorito-da-pagina", "/texto", { modo: "jev", href });
  conferir(jPagina.enviou && jPagina.card?.letra === "B" && !jPagina.card?.erro, `o link gerado roda e mostra a alternativa (${JSON.stringify(jPagina.card?.letra)} ${JSON.stringify(jPagina.card?.erro)})`);
  if (jPagina.jev) {
    conferir(jPagina.jev.cabecalhos.authorization === `Bearer ${CHAVE_JEV_OK}`, "a chave digitada na página chegou ao pedido");
    conferir(Object.keys(jPagina.jev.corpo.questions.resposta.criteria).length === 4, "e as alternativas também");
  }

  const jT = await cenario("jev-tecla-t", "/texto", {
    modo: "jev",
    aposRodar: async (cdp) => {
      await Bun.sleep(2500);
      // O listener de teclado do card olha e.key; dispara um T no documento.
      await cdp.enviar("Runtime.evaluate", { expression: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true })); 1` });
    },
  });
  conferir(/não há pergunta livre/i.test(jT.card?.erro || ""), `card: ${JSON.stringify(jT.card?.erro)}`);

  console.log(`\nimagens e capturas em: ${SAIDA}`);
} finally {
  chrome.kill();
  servidor.stop(true);
  servidorDocs.stop(true);
  proxy.stop(true);
  await Bun.sleep(500);
  try {
    fs.rmSync(perfil, { recursive: true, force: true });
  } catch {}
}
process.exit(falhas ? 1 : 0);
