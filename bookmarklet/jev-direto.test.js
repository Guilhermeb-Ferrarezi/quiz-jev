// Testes do modo Jev (o favorito fala com o Jev pelo proxy, sem o api-go):
//   bun test bookmarklet/jev-direto.test.js
import { test, expect } from "bun:test";

const { quizJevSepararQuestao, quizJevMontarPedidoJev, quizJevInterpretarRespostaJev, quizJevMensagemHttpJev, quizJevDetectarJulgamento } = require("./jev-direto.js");

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

// ---- Afirmativas para julgar (Certo / Errado em cada alternativa) ----

// O texto selecionado de uma prova assim vem com "Certo" e "Errado" depois de cada afirmativa.
const PROVA_CERTO_ERRADO = [
  "Questão 01 de 06",
  "* 10 PONTOS",
  "Diversos elementos estruturais fazem parte da construção da narrativa. Ao analisar o trecho, avalie as afirmativas abaixo e marque se estão certas ou erradas.",
  "A) A narrativa se organiza em torno de um tempo presente.",
  "Certo",
  "Errado",
  "B) O ambiente escolar do internato no Alabama é o cenário principal.",
  "Certo",
  "Errado",
  "C) O foco narrativo é construído em primeira pessoa.",
  "Certo",
  "Errado",
  "D) O texto combina a descrição dos preparativos com a percepção do narrador.",
  "Certo",
  "Errado",
].join("\n");

test("o cabeçalho 'Questão 01 de 06' e '10 PONTOS' não entram no enunciado", () => {
  const q = quizJevSepararQuestao(PROVA_CERTO_ERRADO);
  expect(q.pergunta.startsWith("Diversos elementos")).toBe(true);
  expect(q.pergunta).not.toContain("PONTOS");
});

test("o cabeçalho também sai quando vem tudo na mesma linha (ordem e tamanho variam por plataforma)", () => {
  // "0610 PONTOS": os dois elementos viram texto colado na seleção, sem espaço.
  for (const cab of ["Questão 01 de 06 10 PONTOS", "Questão 01 de 0610 PONTOS", "10 PONTOS Questão 2 de 10", "QUESTÃO 3 DE 6", "1 ponto"]) {
    const q = quizJevSepararQuestao(`${cab}\nQual a capital?\nA) Sydney\nB) Canberra`);
    expect(q.pergunta).toBe("Qual a capital?");
  }
});

test("texto que só parece cabeçalho no meio do enunciado não é cortado", () => {
  const q = quizJevSepararQuestao("Na questão 2 de 6 vale 10 pontos, certo?\nA) Sim\nB) Não");
  expect(q.pergunta).toContain("Na questão 2 de 6");
});

test("detecta afirmativas a julgar e tira o 'Certo Errado' do texto de cada uma", () => {
  const q = quizJevDetectarJulgamento(quizJevSepararQuestao(PROVA_CERTO_ERRADO));
  expect(q.julgamento).toBe(true);
  expect(q.ordem).toEqual(["A", "B", "C", "D"]);
  expect(q.opcoes.A).toBe("A narrativa se organiza em torno de um tempo presente.");
  expect(q.opcoes.D).toBe("O texto combina a descrição dos preparativos com a percepção do narrador.");
});

test("também reconhece Verdadeiro/Falso, V/F, Sim/Não e Correto/Incorreto", () => {
  for (const [a, b] of [["Verdadeiro", "Falso"], ["V", "F"], ["Sim", "Não"], ["Correto", "Incorreto"], ["Certo", "Errado"]]) {
    const q = quizJevSepararQuestao(`Julgue os itens abaixo.\nA) Primeiro item.\n${a} ${b}\nB) Segundo item.\n${a} ${b}`);
    const j = quizJevDetectarJulgamento(q);
    expect(j.julgamento).toBe(true);
    expect(j.opcoes.A).toBe("Primeiro item.");
  }
});

test("questão comum de escolha única NÃO vira julgamento", () => {
  const q = quizJevDetectarJulgamento(quizJevSepararQuestao("Qual a capital?\nA) Sydney\nB) Canberra\nC) Perth"));
  expect(q.julgamento).toBeUndefined();
  expect(q.opcoes.B).toBe("Canberra");
});

test("alternativa que apenas termina com 'sim' ou 'certo' no meio da frase não é julgamento", () => {
  const q = quizJevDetectarJulgamento(quizJevSepararQuestao("Qual afirmação?\nA) Ele disse que sim\nB) Ela estava certa\nC) Nada disso"));
  expect(q.julgamento).toBeUndefined();
  expect(q.opcoes.A).toBe("Ele disse que sim");
});

test("só uma alternativa com Certo/Errado entre várias: não é julgamento", () => {
  const q = quizJevDetectarJulgamento(quizJevSepararQuestao("Pergunta?\nA) Um\nB) Dois Certo Errado\nC) Três\nD) Quatro"));
  expect(q.julgamento).toBeUndefined();
});

test("pedido de julgamento: uma pergunta sim/não por afirmativa, sem escolha única", () => {
  const q = quizJevDetectarJulgamento(quizJevSepararQuestao(PROVA_CERTO_ERRADO));
  const p = quizJevMontarPedidoJev({ pergunta: q.pergunta, opcoes: q.opcoes, ordem: q.ordem, julgamento: true, imagem: null });
  expect(p.julgamento).toBe(true);
  expect(p.corpo.questions.resposta).toBeUndefined();
  expect(Object.keys(p.corpo.questions)).toEqual(["alt_A", "alt_B", "alt_C", "alt_D"]);
  expect(p.corpo.questions.alt_C.type).toBe("noul");
  expect(p.corpo.questions.alt_C.instructions).toContain("C");
  expect(Object.keys(p.corpo.questions.alt_C.criteria)).toEqual(["true", "false"]);
  expect(p.corpo.questions.alt_C.criteria.true).toContain("foco narrativo");
  expect(p.corpo.state).toBe(q.pergunta);
});

test("interpreta o julgamento: certo quando a probabilidade de 'true' passa de 50%", () => {
  const opcoes = { A: "Primeira", B: "Segunda", C: "Terceira", D: "Quarta" };
  const bruto = { answers: { alt_A: { type: "noul", noul: 0.1 }, alt_B: { type: "noul", noul: 0.05 }, alt_C: { type: "noul", noul: 0.92 }, alt_D: { type: "noul", noul: 0.8 } } };
  const d = quizJevInterpretarRespostaJev(bruto, opcoes, false, true);
  expect(d.kind).toBe("julgamento");
  expect(d.itens.map((i) => [i.label, i.certo])).toEqual([["A", false], ["B", false], ["C", true], ["D", true]]);
  expect(d.itens[2].prob).toBeCloseTo(0.92);
  expect(d.itens[0].texto).toBe("Primeira");
  expect(d.source).toBe("jev");
});

test("julgamento com afirmativa sem resposta do Jev é erro (não chuta)", () => {
  const opcoes = { A: "x", B: "y" };
  expect(() => quizJevInterpretarRespostaJev({ answers: { alt_A: { noul: 0.9 } } }, opcoes, false, true)).toThrow();
  expect(() => quizJevInterpretarRespostaJev({}, opcoes, false, true)).toThrow();
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
