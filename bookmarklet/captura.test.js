// Testes das funções puras de captura (bookmarklet/captura.js). Rodam com o
// Bun, sem dependência nenhuma:  bun test bookmarklet/captura.test.js
import { test, expect } from "bun:test";

const {
  quizJevUniaoComFolga,
  quizJevCabeNaViewport,
  quizJevRegiaoParaDocumento,
  quizJevEscalaDoQuadro,
  quizJevRecorteNoQuadro,
  quizJevPlanoDeCostura,
  quizJevEhQuadroDeAba,
  quizJevAreaVisivel,
} = require("./captura.js");

const r = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

test("a união cobre todos os retângulos, com a folga em volta", () => {
  const u = quizJevUniaoComFolga([r(10, 20, 110, 70), r(50, 60, 200, 300)], 8);
  expect(u).toEqual({ left: 2, top: 12, right: 208, bottom: 308, width: 206, height: 296 });
});

test("cabe na viewport só quando está inteira dentro dela", () => {
  expect(quizJevCabeNaViewport(r(0, 0, 800, 600), 1000, 700)).toBe(true);
  expect(quizJevCabeNaViewport(r(-1, 0, 800, 600), 1000, 700)).toBe(false);
  expect(quizJevCabeNaViewport(r(0, 0, 800, 701), 1000, 700)).toBe(false);
  expect(quizJevCabeNaViewport(r(0, 0, 1001, 600), 1000, 700)).toBe(false);
});

test("a região vira coordenada de documento somando a rolagem", () => {
  const d = quizJevRegiaoParaDocumento(r(10, -50, 110, 150), 30, 400);
  expect(d).toEqual({ left: 40, top: 350, right: 140, bottom: 550, width: 100, height: 200 });
});

test("a escala do quadro é pixels do quadro por pixel CSS da viewport", () => {
  expect(quizJevEscalaDoQuadro(2000, 1000)).toBe(2);
  expect(quizJevEscalaDoQuadro(1000, 1000)).toBe(1);
  expect(quizJevEscalaDoQuadro(0, 1000)).toBe(1); // sem dado: não quebra
  expect(quizJevEscalaDoQuadro(1500, 0)).toBe(1);
});

test("o recorte multiplica pela escala e respeita o tamanho do quadro", () => {
  expect(quizJevRecorteNoQuadro(r(10, 20, 110, 70), 2, 2000, 1400)).toEqual({ sx: 20, sy: 40, sw: 200, sh: 100 });
  // região que passa da borda do quadro é cortada na borda
  expect(quizJevRecorteNoQuadro(r(900, 600, 1100, 800), 2, 2000, 1400)).toEqual({ sx: 1800, sy: 1200, sw: 200, sh: 200 });
  // região parcialmente negativa começa em 0
  expect(quizJevRecorteNoQuadro(r(-10, -10, 90, 40), 1, 1000, 700)).toEqual({ sx: 0, sy: 0, sw: 90, sh: 40 });
});

test("recorte fora do quadro é inválido (null), nunca um canvas vazio", () => {
  expect(quizJevRecorteNoQuadro(r(2000, 0, 2100, 100), 1, 1000, 700)).toBeNull();
  expect(quizJevRecorteNoQuadro(r(10, 10, 10, 50), 1, 1000, 700)).toBeNull();
});

test("costura: posiciona cada faixa pela rolagem e usa a escala do quadro", () => {
  const regiao = { left: 100, top: 1000, right: 600, bottom: 2500, width: 500, height: 1500 };
  // viewport de 1000x700 CSS, quadros de 2000x1400 (escala 2); faixas roladas em y=1000 e y=1700
  const capturas = [
    { x: 0, y: 1000, largura: 2000, altura: 1400 },
    { x: 0, y: 1700, largura: 2000, altura: 1400 },
  ];
  const plano = quizJevPlanoDeCostura(capturas, regiao, 2, 3000);
  expect(plano.largura).toBe(1000);
  expect(plano.altura).toBe(3000);
  expect(plano.itens[0]).toEqual({ dx: -200, dy: 0, dw: 2000, dh: 1400 });
  expect(plano.itens[1]).toEqual({ dx: -200, dy: 1400, dw: 2000, dh: 1400 });
});

test("costura: quadros de alturas diferentes (o quadro encolhe no meio da captura)", () => {
  const regiao = { left: 0, top: 0, right: 800, bottom: 1500, width: 800, height: 1500 };
  // escala 0.5: o 1º quadro tem 600 px (1200 CSS), os seguintes 500 px (1000 CSS)
  const capturas = [
    { x: 0, y: 0, largura: 400, altura: 600 },
    { x: 0, y: 1200, largura: 400, altura: 500 },
  ];
  const plano = quizJevPlanoDeCostura(capturas, regiao, 0.5, 3000);
  expect(plano.itens[0]).toEqual({ dx: 0, dy: 0, dw: 400, dh: 600 });
  expect(plano.itens[1]).toEqual({ dx: 0, dy: 600, dw: 400, dh: 500 });
});

test("costura: região muito alta é reduzida para caber no limite do maior lado", () => {
  const regiao = { left: 0, top: 0, right: 500, bottom: 3000, width: 500, height: 3000 };
  const plano = quizJevPlanoDeCostura([{ x: 0, y: 0, largura: 2000, altura: 1400 }], regiao, 2, 3000);
  // 3000 CSS px a 2x seriam 6000 px: limita o maior lado a 3000 => fator 1 em vez de 2
  expect(plano.altura).toBe(3000);
  expect(plano.largura).toBe(500);
  expect(plano.itens[0].dw).toBe(1000);
  expect(plano.itens[0].dh).toBe(700);
});

test("a área visível é a do QUADRO quando ele é menor que a viewport (sem vão na costura)", () => {
  // Caso real do Chrome: quadro de 552 px de altura numa viewport de 594.
  expect(quizJevAreaVisivel(780, 552, 780, 594)).toEqual({ largura: 780, altura: 552 });
  // Quadro em 2x: a altura em pixels CSS é a do quadro dividida pela escala.
  expect(quizJevAreaVisivel(2000, 1400, 1000, 800)).toEqual({ largura: 1000, altura: 700 });
  // Quadro maior ou igual à viewport: vale a viewport.
  expect(quizJevAreaVisivel(1000, 900, 1000, 800)).toEqual({ largura: 1000, altura: 800 });
});

test("só vale como print de aba quando o navegador diz que a superfície é a aba", () => {
  expect(quizJevEhQuadroDeAba({ displaySurface: "browser" })).toBe(true);
  expect(quizJevEhQuadroDeAba({ displaySurface: "monitor" })).toBe(false);
  expect(quizJevEhQuadroDeAba({ displaySurface: "window" })).toBe(false);
  // navegador que não informa a superfície: aceita (a validação de tamanho cobre o resto)
  expect(quizJevEhQuadroDeAba({})).toBe(true);
});
