// Testes do modo Jev (o favorito fala com o Jev pelo proxy, sem o api-go):
//   bun test bookmarklet/jev-direto.test.js
import { test, expect } from "bun:test";

const { quizJevSepararQuestao, quizJevMontarPedidoJev, quizJevInterpretarRespostaJev, quizJevMensagemHttpJev, quizJevAjustarTamanhoJev, quizJevDetectarJulgamento, quizJevResumoDaResposta, quizJevIndiceDoVeredito, quizJevIndiceDaAlternativa } = require("./jev-direto.js");

// ---- Preencher na página: qual botão (radio) clicar ----

test("Certo/Errado: acha o botão do veredito pelo texto, em qualquer ordem e grafia", () => {
  expect(quizJevIndiceDoVeredito(["Certo", "Errado"], true)).toBe(0);
  expect(quizJevIndiceDoVeredito(["Certo", "Errado"], false)).toBe(1);
  expect(quizJevIndiceDoVeredito(["Errado", "Certo"], true)).toBe(1);
  for (const par of [["Verdadeiro", "Falso"], ["V", "F"], ["Sim", "Não"], ["Sim", "Nao"], ["Correto", "Incorreto"], ["certa", "errada"], ["  CERTO ", "ERRADO."]]) {
    expect(quizJevIndiceDoVeredito(par, true)).toBe(0);
    expect(quizJevIndiceDoVeredito(par, false)).toBe(1);
  }
});

test("'Incorreto' não é confundido com 'Correto' (nem 'Não' com 'Sim')", () => {
  expect(quizJevIndiceDoVeredito(["Incorreto", "Correto"], true)).toBe(1);
  expect(quizJevIndiceDoVeredito(["Incorreto", "Correto"], false)).toBe(0);
});

test("rótulos que não são de Certo/Errado: não chuta (-1)", () => {
  expect(quizJevIndiceDoVeredito(["A", "B"], true)).toBe(-1);
  expect(quizJevIndiceDoVeredito(["Talvez", "Quem sabe"], false)).toBe(-1);
  expect(quizJevIndiceDoVeredito([], true)).toBe(-1);
});

const OPCOES_AUSTRALIA = { A: "Sydney", B: "Melbourne", C: "Canberra", D: "Perth" };

test("alternativa: acha o botão pelo texto da opção ou pela letra no rótulo", () => {
  expect(quizJevIndiceDaAlternativa(["A) Sydney", "B) Melbourne", "C) Canberra", "D) Perth"], OPCOES_AUSTRALIA, "C")).toBe(2);
  expect(quizJevIndiceDaAlternativa(["Sydney", "Melbourne", "Canberra", "Perth"], OPCOES_AUSTRALIA, "C")).toBe(2);
  expect(quizJevIndiceDaAlternativa(["Perth", "Canberra", "Melbourne", "Sydney"], OPCOES_AUSTRALIA, "C")).toBe(1); // ordem diferente da prova
  expect(quizJevIndiceDaAlternativa(["a", "b", "c", "d"], OPCOES_AUSTRALIA, "C")).toBe(2); // só a letra
});

test("alternativa: botões sem texto, mas na mesma quantidade das opções, valem pela ordem", () => {
  expect(quizJevIndiceDaAlternativa(["", "", "", ""], OPCOES_AUSTRALIA, "D")).toBe(3);
});

test("alternativa: sem como saber qual botão é, não chuta (-1)", () => {
  expect(quizJevIndiceDaAlternativa(["", "", ""], OPCOES_AUSTRALIA, "C")).toBe(-1); // 3 botões para 4 opções
  expect(quizJevIndiceDaAlternativa(["x", "y"], OPCOES_AUSTRALIA, "C")).toBe(-1);
  expect(quizJevIndiceDaAlternativa(["Sydney", "Sydney do Sul"], { A: "Sydney", B: "Sydney do Sul" }, "A")).toBe(0); // texto exato vence o que só contém
});

// ---- Resumo da resposta (texto da pastilha com o card recolhido) ----

test("resumo da resposta: o que aparece na pastilha quando o card está recolhido", () => {
  expect(quizJevResumoDaResposta({ kind: "unica", answer: "B" })).toBe("B");
  expect(quizJevResumoDaResposta({ kind: "multipla", answers: ["A", "C"] })).toBe("A · C");
  expect(quizJevResumoDaResposta({ kind: "multipla", answers: [] })).toBe("—");
  expect(quizJevResumoDaResposta({ kind: "julgamento", itens: [{ certo: false }, { certo: false }, { certo: true }, { certo: true }] })).toBe("✗ ✗ ✓ ✓");
  expect(quizJevResumoDaResposta({ kind: "lacunas", itens: [{}, {}, {}, {}] })).toBe("4 lacunas");
  expect(quizJevResumoDaResposta({ kind: "lacunas", itens: [{}] })).toBe("1 lacuna");
  expect(quizJevResumoDaResposta({ kind: "aberta", answer: "", answerText: "texto" })).toBe("resposta");
  expect(quizJevResumoDaResposta(null)).toBe("");
});

// ---- Lacunas com dropdown ----

const TEXTO_LACUNAS = 'Analise o parágrafo e complete cada lacuna com o "porquê" correto:\nO [1] é usado em perguntas. Já [2] é usado em respostas.';
const OPCOES_PORQUE = ["porquê", "por que", "porque", "por quê"];

test("pedido de lacunas: uma pergunta de escolha por lacuna, com as opções de cada uma", () => {
  const p = quizJevMontarPedidoJev({ pergunta: TEXTO_LACUNAS, lacunas: [OPCOES_PORQUE, OPCOES_PORQUE], imagem: null });
  expect(p.lacunas).toHaveLength(2);
  expect(Object.keys(p.corpo.questions)).toEqual(["lacuna_1", "lacuna_2"]);
  const q = p.corpo.questions.lacuna_2;
  expect(q.type).toBe("choice");
  expect(q.instructions).toContain("[2]");
  expect(Object.keys(q.criteria)).toEqual(["A", "B", "C", "D"]);
  expect(q.criteria.B).toContain("por que");
  expect(p.corpo.state).toBe(TEXTO_LACUNAS);
  expect(p.precisaHeaderImagem).toBe(false);
});

test("pedido de lacunas aceita opções diferentes por lacuna", () => {
  const p = quizJevMontarPedidoJev({ pergunta: "x [1] y [2]", lacunas: [["a", "b"], ["c", "d", "e"]], imagem: null });
  expect(Object.keys(p.corpo.questions.lacuna_1.criteria)).toEqual(["A", "B"]);
  expect(Object.keys(p.corpo.questions.lacuna_2.criteria)).toEqual(["A", "B", "C"]);
});

test("lacuna com menos de 2 opções não dá para perguntar", () => {
  expect(() => quizJevMontarPedidoJev({ pergunta: "x [1]", lacunas: [["só uma"]], imagem: null })).toThrow();
  expect(() => quizJevMontarPedidoJev({ pergunta: "x [1]", lacunas: [], imagem: null })).toThrow();
});

test("interpreta as lacunas: o texto da opção escolhida em cada uma", () => {
  const p = quizJevMontarPedidoJev({ pergunta: TEXTO_LACUNAS, lacunas: [OPCOES_PORQUE, OPCOES_PORQUE], imagem: null });
  const bruto = {
    answers: {
      lacuna_1: { type: "choice", choice: "B", confidence: 0.9, probabilities: { A: 0.03, B: 0.9, C: 0.04, D: 0.03 } },
      lacuna_2: { type: "choice", choice: "C", confidence: 0.6, probabilities: { A: 0.1, B: 0.2, C: 0.6, D: 0.1 } },
    },
  };
  const d = quizJevInterpretarRespostaJev(bruto, {}, false, false, p.lacunas);
  expect(d.kind).toBe("lacunas");
  expect(d.itens.map((i) => [i.n, i.texto])).toEqual([[1, "por que"], [2, "porque"]]);
  expect(d.itens[0].prob).toBeCloseTo(0.9);
  expect(d.source).toBe("jev");
});

test("lacuna sem resposta ou com opção que não existe é erro", () => {
  const mapas = [{ A: "a", B: "b" }, { A: "c", B: "d" }];
  const so1 = { answers: { lacuna_1: { choice: "A", probabilities: { A: 1 } } } };
  expect(() => quizJevInterpretarRespostaJev(so1, {}, false, false, mapas)).toThrow();
  const invalida = { answers: { lacuna_1: { choice: "A" }, lacuna_2: { choice: "Z" } } };
  expect(() => quizJevInterpretarRespostaJev(invalida, {}, false, false, mapas)).toThrow();
});

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

test("sem rótulo: enunciado terminado em dois-pontos também vale", () => {
  const q = quizJevSepararQuestao(
    "(Cefet-RJ) Sobre a independência das colônias espanholas, podemos afirmar que:\n\n" +
      "nas colônias espanholas foi mais elitista.\n\n" +
      "a escravidão no Brasil foi abolida.\n\n" +
      "a República foi o sistema mais aceito.\n\n" +
      "no Brasil não houve esfacelamento do território."
  );
  expect(q.pergunta).toBe("(Cefet-RJ) Sobre a independência das colônias espanholas, podemos afirmar que:");
  expect(q.ordem).toEqual(["A", "B", "C", "D"]);
  expect(q.opcoes.D).toBe("no Brasil não houve esfacelamento do território.");
});

test("sem rótulo: enunciado com texto de apoio antes da pergunta", () => {
  const q = quizJevSepararQuestao("Leia o trecho.\nO céu estava limpo.\nQual a cor do céu?\nAzul\nVerde");
  expect(q.pergunta).toBe("Leia o trecho. O céu estava limpo. Qual a cor do céu?");
  expect(q.opcoes).toEqual({ A: "Azul", B: "Verde" });
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

test("o 400 do Jev mostra o motivo que ele devolve", () => {
  expect(quizJevMensagemHttpJev(400, { detail: { error_type: "api_usage_error", message: "Invalid image dimensions." } })).toBe("O Jev respondeu com erro (HTTP 400). Invalid image dimensions.");
  expect(quizJevMensagemHttpJev(400, {})).toBe("O Jev respondeu com erro (HTTP 400).");
});

// ---- Tamanho da imagem aceito pelo Jev ----

test("imagem baixa e larga (tabela) é completada com branco até o mínimo", () => {
  expect(quizJevAjustarTamanhoJev(640, 280)).toMatchObject({ dw: 640, dh: 280, cw: 640, ch: 300, mudou: true });
});

test("imagem dentro dos limites passa como está", () => {
  expect(quizJevAjustarTamanhoJev(900, 500).mudou).toBe(false);
  expect(quizJevAjustarTamanhoJev(1560, 300).mudou).toBe(false);
});

test("imagem grande é reduzida ao teto, e depois completada se ficar baixa", () => {
  expect(quizJevAjustarTamanhoJev(3000, 2000)).toMatchObject({ dw: 1560, dh: 1040, cw: 1560, ch: 1040 });
  const larga = quizJevAjustarTamanhoJev(3120, 400);
  expect([larga.dw, larga.dh, larga.ch]).toEqual([1560, 200, 300]);
});

// ---- Letra num elemento à parte (círculo "A" ao lado do texto) ----
const UFRGS_ENUNCIADO = "(UFRGS-RS) Leia o segmento abaixo.\nEstes líderes, geralmente de origem militar.\nAssinale a alternativa correta que apresenta essa categoria.";
const UFRGS_OPCOES = { A: "Chapetones", B: "Inconfidentes", C: "Criollos", D: "Alcaldes", E: "Caudilhos" };

test("letra separada: letra numa linha e o texto na seguinte", () => {
  const q = quizJevSepararQuestao(UFRGS_ENUNCIADO + "\nA\n\nChapetones\nB\nInconfidentes\nC\nCriollos\nD\nAlcaldes\nE\nCaudilhos");
  expect(q.opcoes).toEqual(UFRGS_OPCOES);
  expect(q.pergunta).toBe(UFRGS_ENUNCIADO.split("\n").join(" "));
});

test("letra separada: letra e texto na mesma linha, com ou sem espaço", () => {
  expect(quizJevSepararQuestao(UFRGS_ENUNCIADO + "\nA Chapetones\nB Inconfidentes\nC Criollos\nD Alcaldes\nE Caudilhos").opcoes).toEqual(UFRGS_OPCOES);
  expect(quizJevSepararQuestao(UFRGS_ENUNCIADO + "\nAChapetones\nBInconfidentes\nCCriollos\nDAlcaldes\nECaudilhos").opcoes).toEqual(UFRGS_OPCOES);
});

test("letra separada: fora de sequência não vale", () => {
  expect(quizJevSepararQuestao("Enunciado qualquer.\nAzul\nCéu\nBranco")).toBeNull();
  expect(quizJevSepararQuestao("Enunciado qualquer.\nA Um\nC Dois")).toBeNull();
});

test("letra separada: alternativa sem letra que começa com A, B… não perde a primeira letra", () => {
  expect(quizJevSepararQuestao("Qual a cor?\nAzul\nBranco").opcoes).toEqual({ A: "Azul", B: "Branco" });
});
