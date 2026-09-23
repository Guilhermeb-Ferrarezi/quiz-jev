# Quiz Jev — extensão de navegador

Selecione uma questão de múltipla escolha na tela, aperte `Alt+Q`, e a resposta
aparece num pequeno card logo abaixo da seleção. Com o card aberto, aperte `T`
pra trocar pra uma pergunta livre sobre o mesmo trecho — útil quando você não
quer a alternativa, quer entender o assunto ("por que a B está certa?", "explica
isso de outro jeito").

Funciona em **Firefox / Zen** e **Chrome**.

## Como funciona

A extensão não decide nada sozinha: ela manda o texto selecionado para uma API,
que responde em dois estágios.

1. Um modelo de classificação rápido (**Jev**, da TypeSafe AI) escolhe a
   alternativa e devolve a confiança dele. Leva ~200–400 ms.
2. Se essa confiança for baixa — ou se a questão tiver figura, ou não tiver
   alternativas — a pergunta escala para um LLM com mais capacidade de
   raciocínio, que leva alguns segundos.

A ideia é que o caso comum seja quase instantâneo e barato, e que só as
questões difíceis paguem o custo do modelo grande. O card mostra qual dos dois
respondeu e, quando aplicável, a distribuição de probabilidade entre as
alternativas — para você julgar se vale confiar.

### O que ela responde

| tipo de questão | como responde |
|---|---|
| múltipla escolha | a alternativa, com a probabilidade de cada uma |
| marque todas que se aplicam | a lista de alternativas, com a probabilidade de cada |
| com gráfico, tabela ou figura | recorta a imagem da seleção e usa um modelo com visão |
| sem alternativas (completar, aberta) | responde em texto |

No caso da figura, o recorte só é enviado quando a seleção realmente encosta em
algo visual — senão toda questão pagaria o custo do modelo com visão.

### Pergunta livre (`Alt+Q`, depois `T`)

Com o card de resposta aberto (ou ainda carregando), aperte `T` pra trocar o
conteúdo do card por uma caixa de texto. Escreva a pergunta e aperte `Enter`
(`Shift+Enter` quebra linha) — a extensão manda o trecho selecionado como
contexto e a sua pergunta, e a resposta volta sem o limite de "1 a 3 frases"
do modo de questão: pode escrever o quanto for necessário pra explicar bem.
Depois de responder, `T` funciona de novo, pra encadear outra pergunta sobre
o mesmo trecho. `Esc` fecha tudo, como em qualquer outro estado do card.

## Instalação

### Firefox / Zen

1. Abra `about:debugging#/runtime/this-firefox`
2. **Carregar extensão temporária…**
3. Escolha o `manifest.json` desta pasta

Se o seu Firefox/Zen for instalado por **Flatpak**, selecione um `.xpi` em vez
do `manifest.json` — o sandbox do Flatpak entrega ao navegador apenas o arquivo
escolhido, e a pasta `src/` fica de fora, o que carrega uma extensão quebrada
(ela aparece na lista como se estivesse tudo certo). Para empacotar:

```bash
zip -r quiz-jev.xpi manifest.json src/
```

Extensão temporária some quando o navegador fecha; para voltar, repita os
passos.

### Chrome

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. **Carregar sem compactação** e escolha esta pasta

## Acesso

A extensão exige uma sessão para funcionar. Abra as **Opções** da extensão e
entre com as suas credenciais — não é preciso mexer em console nem em arquivo.

Sem acesso válido a extensão não responde nada: o servidor recusa a requisição.

## Permissões, e por que cada uma

| permissão | para quê |
|---|---|
| `activeTab` | ler a seleção **apenas** na aba onde você apertou o atalho |
| `scripting` | injetar o script de captura sob demanda, nunca antes |
| `storage` | guardar a sessão localmente |
| host da API | falar com o servidor que responde |

Não há content script declarativo e não há permissão de "todos os sites": até
você apertar `Alt+Q`, a extensão não lê página nenhuma.

## Privacidade

O texto que você seleciona é enviado ao servidor para ser respondido, e o
enunciado **não** é gravado em log. Quando a seleção inclui uma figura, o
recorte da tela também é enviado. A sessão fica no armazenamento local do seu
navegador.

## Limitações conhecidas

- A captura de imagem fotografa apenas o que está **visível** na tela. Se parte
  da questão estiver rolada para fora, a extensão avisa em vez de mandar um
  recorte cortado.
- Em questões de completar lacunas, a resposta pode usar um sinônimo do termo
  esperado.
- O modelo rápido erra, e é por isso que o card mostra a confiança dele. Trate
  a resposta como uma segunda opinião, não como gabarito.
