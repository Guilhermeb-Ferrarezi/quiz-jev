// Contas da captura de imagem do bookmarklet — só geometria, nada de DOM, pra
// poder ser testada com `bun test bookmarklet/captura.test.js`. O build.js junta
// este arquivo ao do bookmarklet (mesmo IIFE); o bloco `module.exports` no fim
// só existe pros testes e não faz nada no navegador.
//
// Vocabulário: "viewport" e "região" estão em pixels CSS; "quadro" é um frame do
// print da aba, em pixels do próprio quadro. A escala do quadro (pixels do
// quadro por pixel CSS) vem da razão entre a largura do quadro e a da viewport —
// não de devicePixelRatio, porque o quadro de uma captura de aba nem sempre sai
// na resolução física da tela.

// União dos retângulos com uma folga em volta (coordenadas de viewport).
function quizJevUniaoComFolga(rects, folga) {
  var left = Infinity;
  var top = Infinity;
  var right = -Infinity;
  var bottom = -Infinity;
  for (var i = 0; i < rects.length; i++) {
    left = Math.min(left, rects[i].left);
    top = Math.min(top, rects[i].top);
    right = Math.max(right, rects[i].right);
    bottom = Math.max(bottom, rects[i].bottom);
  }
  left -= folga;
  top -= folga;
  right += folga;
  bottom += folga;
  return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
}

function quizJevCabeNaViewport(uniao, vw, vh) {
  return uniao.left >= 0 && uniao.top >= 0 && uniao.right <= vw && uniao.bottom <= vh;
}

// Viewport -> documento: estável mesmo rolando a página pra tirar várias faixas.
function quizJevRegiaoParaDocumento(uniao, scrollX, scrollY) {
  return {
    left: uniao.left + scrollX,
    top: uniao.top + scrollY,
    right: uniao.right + scrollX,
    bottom: uniao.bottom + scrollY,
    width: uniao.width,
    height: uniao.height,
  };
}

function quizJevEscalaDoQuadro(larguraDoQuadro, larguraDaViewport) {
  return larguraDoQuadro > 0 && larguraDaViewport > 0 ? larguraDoQuadro / larguraDaViewport : 1;
}

// Recorte (em pixels do quadro) da região dada em pixels CSS. null quando a
// região cai fora do quadro ou fica sem área — melhor não mandar imagem do que
// mandar um canvas vazio.
function quizJevRecorteNoQuadro(uniao, escala, larguraDoQuadro, alturaDoQuadro) {
  var sx = Math.max(0, Math.round(uniao.left * escala));
  var sy = Math.max(0, Math.round(uniao.top * escala));
  var sw = Math.min(larguraDoQuadro, Math.round(uniao.right * escala)) - sx;
  var sh = Math.min(alturaDoQuadro, Math.round(uniao.bottom * escala)) - sy;
  if (sw <= 0 || sh <= 0) return null;
  return { sx: sx, sy: sy, sw: sw, sh: sh };
}

// Onde desenhar cada faixa (um quadro inteiro) no canvas final. `capturas`
// traz, de cada quadro, a rolagem (x,y em coordenadas de documento) e o
// tamanho em pixels do quadro — que pode variar de um quadro pro outro (o
// quadro encolhe quando o navegador mostra o aviso de compartilhamento).
// O maior lado do resultado fica limitado a `limiteLado` pixels: acima disso a
// figura só pesaria sem ganhar nada de leitura.
function quizJevPlanoDeCostura(capturas, regiaoDoc, escala, limiteLado) {
  var maiorLadoCss = Math.max(regiaoDoc.width, regiaoDoc.height);
  var fator = escala;
  if (maiorLadoCss * escala > limiteLado) fator = limiteLado / maiorLadoCss;
  var itens = [];
  for (var i = 0; i < capturas.length; i++) {
    itens.push({
      dx: (capturas[i].x - regiaoDoc.left) * fator,
      dy: (capturas[i].y - regiaoDoc.top) * fator,
      dw: (capturas[i].largura / escala) * fator,
      dh: (capturas[i].altura / escala) * fator,
    });
  }
  return {
    largura: Math.max(1, Math.round(regiaoDoc.width * fator)),
    altura: Math.max(1, Math.round(regiaoDoc.height * fator)),
    itens: itens,
  };
}

// Quanto da página (em pixels CSS) o quadro realmente mostra. O quadro de uma
// captura de aba pode ser MENOR que a viewport (no Chrome, a barra de aviso do
// compartilhamento come uns 40 px): rolar uma viewport inteira por faixa deixaria
// um vão sem imagem entre as faixas. O passo da costura é a altura do quadro.
function quizJevAreaVisivel(larguraDoQuadro, alturaDoQuadro, vw, vh) {
  var escala = quizJevEscalaDoQuadro(larguraDoQuadro, vw);
  return { largura: vw, altura: Math.min(vh, alturaDoQuadro / escala) };
}

// O print só serve se for da ABA: numa janela ou tela inteira o quadro inclui a
// barra do navegador e a conta de escala/recorte sairia deslocada. Navegador
// que não informa a superfície é aceito (a escala vem da largura do quadro).
function quizJevEhQuadroDeAba(configuracoes) {
  return configuracoes.displaySurface === undefined || configuracoes.displaySurface === "browser";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    quizJevUniaoComFolga: quizJevUniaoComFolga,
    quizJevCabeNaViewport: quizJevCabeNaViewport,
    quizJevRegiaoParaDocumento: quizJevRegiaoParaDocumento,
    quizJevEscalaDoQuadro: quizJevEscalaDoQuadro,
    quizJevRecorteNoQuadro: quizJevRecorteNoQuadro,
    quizJevPlanoDeCostura: quizJevPlanoDeCostura,
    quizJevAreaVisivel: quizJevAreaVisivel,
    quizJevEhQuadroDeAba: quizJevEhQuadroDeAba,
  };
}
