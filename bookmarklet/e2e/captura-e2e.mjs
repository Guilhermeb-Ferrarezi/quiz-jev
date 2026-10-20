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

// ---- Proxy do Jev falso (modo Jev) ----
// Grava cada pedido e responde no formato do Jev. A chave "apikey_e2e_ok" é a
// válida; qualquer outra leva 401.
const CHAVE_JEV_OK = "apikey_e2e_ok_" + "x".repeat(30);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,typesafe-danger-zone-images", "access-control-allow-methods": "POST,OPTIONS" };
// CORS do api-go interceptado (modo normal): o favorito manda X-Quiz-Key.
const CORS_API_GO = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-quiz-key", "access-control-allow-methods": "POST,OPTIONS,HEAD" };
const pedidosProxy = [];
const proxy = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return new Response("ok", { headers: CORS });
    const corpo = await req.json();
    pedidosProxy.push({ cabecalhos: Object.fromEntries(req.headers), corpo });
    if (req.headers.get("authorization") !== `Bearer ${CHAVE_JEV_OK}`) {
      return Response.json({ message: "invalid key" }, { status: 401, headers: CORS });
    }
    // Afirmativas a julgar: uma pergunta sim/não (noul) por alternativa. C e D certas.
    if (!corpo.questions.resposta) {
      const prob = { alt_A: 0.1, alt_B: 0.05, alt_C: 0.92, alt_D: 0.8 };
      const respostas = Object.fromEntries(Object.keys(corpo.questions).map((k) => [k, { type: "noul", noul: prob[k] ?? 0.5 }]));
      return Response.json({ model: "jev-1.13.0", answers: respostas }, { headers: CORS });
    }
    const opcoes = Object.keys(corpo.questions.resposta.criteria).filter((k) => k !== "Ilegível");
    const probs = Object.fromEntries(opcoes.map((o) => [o, o === "B" ? 0.9 : 0.1 / (opcoes.length - 1)]));
    return Response.json({ model: "jev-1.13.0", answers: { resposta: { type: "choice", choice: "B", confidence: 0.85, probabilities: probs } } }, { headers: CORS });
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
  return { letra: q(".letra"), erro: q(".erro"), texto: q(".card"), vereditos: [...s.querySelectorAll(".veredito")].map((e) => e.textContent), textos: [...s.querySelectorAll(".julga .opcao-texto")].map((e) => e.textContent) };
})()`;

// opcoes: { modo: "qz" | "jev", chave, analise(cdp, imagemBase64), aposRodar(cdp) }
async function cenario(nome, caminho, opcoes = {}) {
  const modo = opcoes.modo || "qz";
  const chave = opcoes.chave || (modo === "jev" ? CHAVE_JEV_OK : "qz_e2etestkey1234567890");
  const codigo = montarCodigo(modo, chave, modo === "jev" ? URL_PROXY : "");

  const aba = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?${BASE}${caminho}`, { method: "PUT" })).json();
  const cdp = conectar(aba.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.enviar("Page.enable");
  await cdp.enviar("Runtime.enable");
  await cdp.enviar("Network.enable");
  await cdp.enviar("Page.bringToFront");
  await cdp.enviar("Fetch.enable", { patterns: [{ urlPattern: "https://api.santos-tech.com/*" }] });

  const postsApiGo = [];
  const errosPagina = [];
  cdp.aoEvento(async (msg) => {
    if (msg.method === "Runtime.exceptionThrown") errosPagina.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method !== "Fetch.requestPaused") return;
    const { requestId, request, networkId } = msg.params;
    const responder = (status, corpo) =>
      cdp.enviar("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: Object.entries({ ...CORS_API_GO, "content-type": "application/json" }).map(([name, value]) => ({ name, value })),
        body: Buffer.from(corpo || "").toString("base64"),
      });
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
  // userGesture: o getDisplayMedia só abre com ativação do usuário.
  await cdp.enviar("Runtime.evaluate", { expression: codigo, userGesture: true });
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

  console.log("chave recusada (401): mensagem clara no card");
  const jRuim = await cenario("jev-chave-ruim", "/texto", { modo: "jev", chave: "apikey_errada_" + "y".repeat(30) });
  conferir(jRuim.enviou && /chave do Jev foi recusada/i.test(jRuim.card?.erro || ""), `card: ${JSON.stringify(jRuim.card?.erro)}`);

  console.log("texto sem alternativas e sem imagem: erro claro, sem gastar chamada");
  const jSem = await cenario("jev-sem-alternativas", "/sem-alternativas", { modo: "jev", semConsulta: true });
  conferir(!jSem.enviou && /só escolhe entre alternativas/i.test(jSem.card?.erro || ""), `card: ${JSON.stringify(jSem.card?.erro)}`);

  console.log("tecla T (pergunta livre): explica que não existe no modo Jev");
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
  proxy.stop(true);
  await Bun.sleep(500);
  try {
    fs.rmSync(perfil, { recursive: true, force: true });
  } catch {}
}
process.exit(falhas ? 1 : 0);
