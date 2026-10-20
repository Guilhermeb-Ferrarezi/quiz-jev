// Testes do modo Jev (o favorito fala com o Jev pelo proxy, sem o api-go):
//   bun test bookmarklet/jev-direto.test.js
import { test, expect } from "bun:test";

const { quizJevSepararQuestao, quizJevMontarPedidoJev, quizJevInterpretarRespostaJev, quizJevMensagemHttpJev } = require("./jev-direto.js");

// ---- Separar enunciado e alternativas (porta de quiz_parse.go) ----

test("separa enunciado e alternativas com rótulo A) B) C) D)", () => {
  const q = quizJevSepararQuestao("Qual é a capital da Austrália?\nA) Sydney\nB) Melbourne\nC) Canberra\nD) Perth");
  expect(q.pergunta).toBe("Qual é a capital da Austrália?");
  expect(q.opcoes).toEqual({ A: "Sydney", B: "Melbourne", C: "Canberra", D: "Perth" });
  expect(q.ordem).toEqual(["A", "B", "C", "D"]);
});

test("aceita outros rótulos: (a), 1. e b:", () => {
  expect(quizJevSepararQuestao("Pergunta\n(a) Um\n(b) Dois").opcoes).toEqual({ a: "Um", b: "Dois" });
  expect(quizJevSepararQuestao("Pergunta\n1. Um\n2. Dois\n3. Três").ordem).toEqual(["1", "2", "3"]);
  expect(quizJevSepararQuestao("Pergunta\na: Um\nb: Dois").opcoes).toEqual({ a: "Um", b: "Dois" });
});

test("linha sem rótulo depois de uma alternativa continua essa alternativa", () => {
  const q = quizJevSepararQuestao("Enunciado\nA) Primeira parte\nque continua aqui\nB) Outra");
  expect(q.opcoes.A).toBe("Primeira parte que continua aqui");
});

test("tira bullets e quebra de linha do Windows", () => {
  const q = quizJevSepararQuestao("• Enunciado\r\n• A) Um\r\n• B) Dois\r\n");
  expect(q.pergunta).toBe("Enunciado");
  expect(q.opcoes).toEqual({ A: "Um", B: "Dois" });
});

test("rótulo repetido (mais de uma questão no bloco) é recusado", () => {
  expect(quizJevSepararQuestao("Enunciado\nA) Um\nB) Dois\nA) Outra questão")).toBeNull();
});

test("menos de 2 ou mais de 9 alternativas é recusado", () => {
  expect(quizJevSepararQuestao("Enunciado\nA) Só uma")).toBeNull();
  const dez = Array.from({ length: 10 }, (_, i) => `${(i % 5) + 1}) x`).join("\n");
  expect(quizJevSepararQuestao("Enunciado\n" + dez)).toBeNull();
});

test("sem enunciado (tudo é alternativa) é recusado", () => {
  expect(quizJevSepararQuestao("A) Um\nB) Dois\nC) Três")).toBeNull();
});

test("sem rótulo: só vale se a primeira linha é uma pergunta", () => {
  const q = quizJevSepararQuestao("Qual a cor do céu?\nAzul\nVerde");
  expect(q.opcoes).toEqual({ A: "Azul", B: "Verde" });
  expect(quizJevSepararQuestao("Uma lista qualquer\nmaçã\nbanana")).toBeNull();
});

// ---- Pedido ao Jev ----

const OPCOES = { A: "Sydney", B: "Melbourne", C: "Canberra", D: "Perth" };

test("pedido só de texto: estado é o enunciado, sem imagem e sem header especial", () => {
  const p = quizJevMontarPedidoJev({ pergunta: "Capital?", opcoes: OPCOES, imagem: null });
  expect(p.corpo.model).toBe("jev-latest");
  expect(p.corpo.state).toBe("Capital?");
  expect(p.corpo.questions.resposta.type).toBe("choice");
  expect(p.corpo.questions.resposta.criteria).toEqual(OPCOES);
  expect(p.corpo.assets).toBeUndefined();
  expect(p.precisaHeaderImagem).toBe(false);
  expect(p.generico).toBe(false);
});

test("pedido com imagem: marcador no estado e a imagem em assets", () => {
  const p = quizJevMontarPedidoJev({ pergunta: "Veja a figura", opcoes: OPCOES, imagem: { base64: "QUJD", mime: "image/png" } });
  expect(Array.isArray(p.corpo.state)).toBe(true);
  expect(p.corpo.state[0]).toBe("Veja a figura");
  const marcador = p.corpo.state[1];
  expect(p.corpo.assets[marcador]).toEqual({ type: "image", format: "png", data_base64: "QUJD" });
  expect(p.precisaHeaderImagem).toBe(true);
});

test("JPEG vira format jpeg; webp e gif não são aceitos pelo Jev", () => {
  const jpg = quizJevMontarPedidoJev({ pergunta: "x", opcoes: OPCOES, imagem: { base64: "QQ==", mime: "image/jpeg" } });
  expect(Object.values(jpg.corpo.assets)[0].format).toBe("jpeg");
  expect(() => quizJevMontarPedidoJev({ pergunta: "x", opcoes: OPCOES, imagem: { base64: "QQ==", mime: "image/webp" } })).toThrow();
  expect(() => quizJevMontarPedidoJev({ pergunta: "x", opcoes: OPCOES, imagem: { base64: "QQ==", mime: "image/gif" } })).toThrow();
});

test("só imagem (sem alternativas no texto): usa A–E mais 'Ilegível'", () => {
  const p = quizJevMontarPedidoJev({ pergunta: "", opcoes: null, imagem: { base64: "QQ==", mime: "image/png" } });
  expect(p.generico).toBe(true);
  expect(Object.keys(p.corpo.questions.resposta.criteria)).toEqual(["A", "B", "C", "D", "E", "Ilegível"]);
  expect(p.opcoes).toEqual({ A: "A", B: "B", C: "C", D: "D", E: "E" });
  expect(p.corpo.state).toHaveLength(1); // só o marcador da imagem
});

test("só imagem com um pouco de texto: o texto segue como contexto", () => {
  const p = quizJevMontarPedidoJev({ pergunta: "Questão 3", opcoes: null, imagem: { base64: "QQ==", mime: "image/png" } });
  expect(p.corpo.state[0]).toBe("Questão 3");
});

test("sem alternativas e sem imagem: não dá para perguntar ao Jev", () => {
  expect(() => quizJevMontarPedidoJev({ pergunta: "Explique a fotossíntese", opcoes: null, imagem: null })).toThrow();
});

// ---- Resposta do Jev ----

const bruto = (escolha, probs) => ({ model: "jev-1.13.0", answers: { resposta: { type: "choice", choice: escolha, confidence: 0.9, probabilities: probs } } });

test("interpreta a resposta no formato que o card espera", () => {
  const d = quizJevInterpretarRespostaJev(bruto("C", { A: 0.02, B: 0.03, C: 0.9, D: 0.05 }), OPCOES, false);
  expect(d.kind).toBe("unica");
  expect(d.answer).toBe("C");
  expect(d.answerText).toBe("Canberra");
  expect(d.source).toBe("jev");
  expect(d.confidence).toBe(0.9);
  expect(d.probabilities.C).toBe(0.9);
  expect(d.parsed.options).toEqual(OPCOES);
});

test("alternativa que não existe no pedido é erro (nunca mostra letra inventada)", () => {
  expect(() => quizJevInterpretarRespostaJev(bruto("Z", { Z: 1 }), OPCOES, false)).toThrow();
});

test("resposta sem 'resposta' ou sem escolha é erro", () => {
  expect(() => quizJevInterpretarRespostaJev({ answers: {} }, OPCOES, false)).toThrow();
  expect(() => quizJevInterpretarRespostaJev({}, OPCOES, false)).toThrow();
  expect(() => quizJevInterpretarRespostaJev(null, OPCOES, false)).toThrow();
});

test("sem confidence usa a probabilidade da escolhida", () => {
  const sem = { answers: { resposta: { choice: "B", probabilities: { A: 0.1, B: 0.8, C: 0.05, D: 0.05 } } } };
  expect(quizJevInterpretarRespostaJev(sem, OPCOES, false).confidence).toBe(0.8);
});

test("modo só imagem: 'Ilegível' vira aviso, e some das barras quando outra é escolhida", () => {
  const generico = { A: "A", B: "B", C: "C", D: "D", E: "E" };
  const ileg = quizJevInterpretarRespostaJev(bruto("Ilegível", { A: 0.1, B: 0.1, C: 0.1, D: 0.1, E: 0.1, Ilegível: 0.5 }), generico, true);
  expect(ileg.kind).toBe("aberta");
  expect(ileg.answerText).toContain("ler a questão");
  const ok = quizJevInterpretarRespostaJev(bruto("D", { A: 0.02, B: 0.02, C: 0.02, D: 0.9, E: 0.02, Ilegível: 0.02 }), generico, true);
  expect(ok.answer).toBe("D");
  expect(ok.probabilities.Ilegível).toBeUndefined();
});

// ---- Erros HTTP ----

test("mensagens de erro do Jev em português, por status", () => {
  expect(quizJevMensagemHttpJev(401)).toContain("chave");
  expect(quizJevMensagemHttpJev(403)).toContain("chave");
  expect(quizJevMensagemHttpJev(429)).toContain("limite");
  expect(quizJevMensagemHttpJev(402)).toContain("limite");
  expect(quizJevMensagemHttpJev(413)).toContain("grande");
  expect(quizJevMensagemHttpJev(500)).toContain("500");
});
