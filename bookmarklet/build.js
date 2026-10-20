#!/usr/bin/env node
// Gera docs/bookmarklet.min.js e docs/quiz-render.js a partir das fontes
// legíveis em bookmarklet/. Sem dependências (só `fs`/`path` do Node) — roda
// com `node bookmarklet/build.js`.
//
// O que faz:
//   1. Concatena render-shared.js (visual do card) + captura.js (contas da
//      captura de imagem, testadas por captura.test.js) + quiz-jev.js (lógica
//      do bookmarklet) dentro de um único IIFE.
//   2. Minifica de um jeito simples e seguro: remove comentários de linha
//      inteira (linhas que começam com `//` depois do trim) e comentários de
//      bloco `/* */`, remove linhas em branco e o espaço nas pontas de cada
//      linha — nunca mexe no MEIO de uma linha de código, então nenhuma
//      string (a maior parte do arquivo é CSS e mensagens de erro dentro de
//      strings) corre risco de ser cortada ao meio.
//   3. Escreve docs/bookmarklet.min.js como
//      `window.QUIZ_JEV_BOOKMARKLET_TEMPLATE = "...";` (JSON.stringify cuida
//      do escaping — é sintaxe de string válida em JS) com o placeholder
//      __QUIZ_KEY__ ainda dentro, pra docs/index.html substituir pela chave
//      digitada pelo usuário, 100% no navegador dele.
//   4. Copia render-shared.js pra docs/quiz-render.js, sem alteração — é o
//      mesmo arquivo, carregado como <script src> comum por docs/relay.html
//      (nossa própria página, sem CSP restritiva, então não precisa do
//      tratamento especial do bookmarklet).

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const DOCS = path.join(DIR, "..", "docs");

function removerComentarios(codigo) {
  // Bloco /* ... */ primeiro (pode espalhar por várias linhas) — nenhuma das
  // nossas strings contém "/*", então é seguro remover greedy-mínimo aqui.
  const semBloco = codigo.replace(/\/\*[\s\S]*?\*\//g, "");
  const linhas = semBloco.split("\n");
  const mantidas = [];
  for (const linhaOriginal of linhas) {
    const linha = linhaOriginal.trim();
    if (linha === "") continue; // linha em branco
    if (linha.indexOf("//") === 0) continue; // comentário de linha inteira
    mantidas.push(linha);
  }
  return mantidas.join("\n");
}

// Com o Bun, minifica de verdade (espaços e nomes de variáveis): o favorito vira
// um link `javascript:` e alguns navegadores só aceitam uns 64 KB nele. SEM
// minifySyntax de propósito: ele poderia "resolver" na hora do build comparações
// como `"__QUIZ_MODO__" === "jev"`, destruindo os marcadores que a página de
// instalação (docs/index.html) troca depois. Sem Bun, cai no corte simples de
// comentários (o código fica maior, mas funciona igual).
function minificar(codigo) {
  if (typeof Bun !== "undefined") {
    const t = new Bun.Transpiler({ loader: "js", minifyWhitespace: true, minifyIdentifiers: true, minifySyntax: false });
    return t.transformSync(codigo).trim();
  }
  return removerComentarios(codigo);
}

function ler(nome) {
  return fs.readFileSync(path.join(DIR, nome), "utf8");
}

function main() {
  const shared = ler("render-shared.js");
  const captura = ler("captura.js");
  const jevDireto = ler("jev-direto.js");
  const driver = ler("quiz-jev.js");

  const fonteCompleta = shared + "\n" + captura + "\n" + jevDireto + "\n" + driver;
  for (const placeholder of ["__QUIZ_KEY__", "__QUIZ_MODO__", "__QUIZ_PROXY__"]) {
    if (fonteCompleta.indexOf(placeholder) === -1) {
      throw new Error("placeholder " + placeholder + " não encontrado nas fontes — build cancelado");
    }
  }

  const embrulhado = minificar("(function(){\n" + removerComentarios(fonteCompleta) + "\n})();");
  for (const placeholder of ["__QUIZ_KEY__", "__QUIZ_MODO__", "__QUIZ_PROXY__"]) {
    // Se o minificador sumisse com um marcador, o favorito nasceria sem chave/modo.
    if (embrulhado.indexOf('"' + placeholder + '"') === -1) {
      throw new Error("a minificação perdeu o marcador " + placeholder + " — build cancelado");
    }
  }

  if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });

  const templateJs =
    "// Gerado por bookmarklet/build.js a partir de render-shared.js + quiz-jev.js — não edite à mão.\n" +
    "window.QUIZ_JEV_BOOKMARKLET_TEMPLATE = " +
    JSON.stringify(embrulhado) +
    ";\n";
  fs.writeFileSync(path.join(DOCS, "bookmarklet.min.js"), templateJs, "utf8");

  fs.writeFileSync(path.join(DOCS, "quiz-render.js"), shared, "utf8");
  // A janela de ponte (docs/relay.html) interpreta a resposta do Jev com o mesmo código.
  fs.writeFileSync(path.join(DOCS, "quiz-jev-direto.js"), jevDireto, "utf8");

  const bytesBookmarklet = Buffer.byteLength(embrulhado, "utf8");
  // Mesmo encoding de docs/index.html; chave de exemplo do tamanho de uma chave do Jev (~108).
  const exemplo = embrulhado.replace("__QUIZ_KEY__", "apikey_" + "x".repeat(101));
  const bytesUrl = Buffer.byteLength(encodeURI(exemplo).replace(/#/g, "%23"), "utf8") + "javascript:".length;
  console.log("docs/bookmarklet.min.js gerado (" + bytesBookmarklet + " bytes de código; ~" + bytesUrl + " bytes como URL javascript:)");
  console.log("docs/quiz-render.js gerado (" + Buffer.byteLength(shared, "utf8") + " bytes)");
}

main();
