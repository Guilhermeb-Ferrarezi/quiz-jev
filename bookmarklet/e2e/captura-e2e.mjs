// Teste ponta a ponta da captura de imagem do bookmarklet, num Chrome de
// verdade:  bun bookmarklet/e2e/captura-e2e.mjs
//
// Sobe uma página de prova local, abre o Chrome com a captura de aba
// autorizada (--auto-accept-this-tab-capture), roda o bookmarklet gerado
// (docs/bookmarklet.min.js — rode `bun bookmarklet/build.js` antes) e
// INTERCEPTA a chamada à API: nada chega ao servidor, a resposta é falsa. O que
// se confere é a imagem que o bookmarklet MANDARIA. As imagens saem em
// $QUIZJEV_E2E_SAIDA (padrão: a pasta temporária) pra olhar a olho.
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
    <p>A) Caneta<br>B) Lápis<br>C) Borracha<br>D) Régua</p></div>
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

const codigoBookmarklet = (() => {
  const g = {};
  new Function("window", fs.readFileSync(path.join(RAIZ, "docs", "bookmarklet.min.js"), "utf8"))(g);
  return g.QUIZ_JEV_BOOKMARKLET_TEMPLATE.split("__QUIZ_KEY__").join("qz_e2etestkey1234567890");
})();

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

async function cenario(nome, caminho, analise) {
  const aba = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?${BASE}${caminho}`, { method: "PUT" })).json();
  const cdp = conectar(aba.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.enviar("Page.enable");
  await cdp.enviar("Runtime.enable");
  await cdp.enviar("Network.enable");
  await cdp.enviar("Page.bringToFront");
  await cdp.enviar("Fetch.enable", { patterns: [{ urlPattern: "https://api.santos-tech.com/*" }] });

  const posts = [];
  cdp.aoEvento(async (msg) => {
    if (msg.method !== "Fetch.requestPaused") return;
    const { requestId, request, networkId } = msg.params;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-quiz-key", "access-control-allow-methods": "POST,HEAD,OPTIONS" };
    const responder = (status, corpo) =>
      cdp.enviar("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: Object.entries({ ...cors, "content-type": "application/json" }).map(([name, value]) => ({ name, value })),
        body: Buffer.from(corpo || "").toString("base64"),
      });
    if (request.method === "POST") {
      let corpo = request.postData;
      if (corpo === undefined && request.hasPostData) corpo = (await cdp.enviar("Network.getRequestPostData", { requestId: networkId })).postData;
      posts.push(JSON.parse(corpo));
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
  // userGesture: o getDisplayMedia só abre com ativação do usuário.
  const t0 = Date.now();
  await cdp.enviar("Runtime.evaluate", { expression: codigoBookmarklet, userGesture: true });

  for (let i = 0; i < 300 && !posts.length; i++) await Bun.sleep(100);
  const ms = Date.now() - t0;
  await Bun.sleep(1200); // deixa o card mostrar a resposta
  const shot = await cdp.enviar("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SAIDA, `${nome}-pagina.png`), Buffer.from(shot.data, "base64"));

  // Diagnóstico: viewport depois da captura e tamanho do quadro do vídeo.
  const medidas = (
    await cdp.enviar("Runtime.evaluate", {
      expression: "(window.__quizJevTela ? [innerWidth, innerHeight, __quizJevTela.video.videoWidth, __quizJevTela.video.videoHeight, devicePixelRatio] : null)",
      returnByValue: true,
    })
  ).result.value;
  const resultado = { nome, viewport, medidas, ms, enviou: posts.length > 0 };
  if (posts.length) {
    const p = posts[0];
    resultado.temTexto = !!p.raw;
    resultado.temImagem = !!p.imageBase64;
    resultado.temUrl = !!p.imageUrl;
    if (p.imageBase64) {
      resultado.imagem = p.imageMime === "image/png" ? dimensoesPng(p.imageBase64) : { mime: p.imageMime };
      fs.writeFileSync(path.join(SAIDA, `${nome}-enviada.${p.imageMime === "image/png" ? "png" : "jpg"}`), Buffer.from(p.imageBase64, "base64"));
    }
  }
  if (analise && posts.length && posts[0].imageBase64) resultado.extra = await analise(cdp, posts[0].imageBase64);
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
  const alta = await cenario("alta", "/alta", (cdp, b64) => linhasBrancas(cdp, b64, 10, 380, 45, 120));
  console.log(`  [innerW, innerH, quadroW, quadroH, dpr] = ${JSON.stringify(alta.medidas)}  antes: ${JSON.stringify(alta.viewport)}`);
  conferir(alta.enviou && alta.temImagem, `enviou imagem (${JSON.stringify(alta.imagem)})`);
  if (alta.imagem?.altura) conferir(alta.imagem.altura > alta.viewport[1], "a imagem costurada é mais alta que a tela");
  conferir(alta.extra === 0, `sem vão branco entre as faixas (linhas brancas na tabela: ${alta.extra})`);

  console.log("duas imagens (empilhadas)");
  const imagens = await cenario("imagens", "/imagens");
  conferir(imagens.enviou && imagens.temImagem, `enviou imagem (${JSON.stringify(imagens.imagem)})`);
  if (imagens.imagem?.altura) conferir(imagens.imagem.altura >= 230 && imagens.imagem.altura <= 250, "as duas figuras estão uma sobre a outra (~240 px de altura)");

  console.log(`\nimagens e capturas em: ${SAIDA}`);
} finally {
  chrome.kill();
  servidor.stop(true);
  await Bun.sleep(500);
  try {
    fs.rmSync(perfil, { recursive: true, force: true });
  } catch {}
}
process.exit(falhas ? 1 : 0);
