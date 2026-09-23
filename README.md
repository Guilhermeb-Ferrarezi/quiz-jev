# Quiz Jev

Selecione uma questão de múltipla escolha na tela, aperte `Alt+Q`, e a resposta
aparece num pequeno card logo abaixo da seleção. Com o card aberto, aperte `T`
pra trocar pra uma pergunta livre sobre o mesmo trecho — útil quando você não
quer a alternativa, quer entender o assunto ("por que a B está certa?", "explica
isso de outro jeito"). Se já sabe que quer perguntar em vez de responder,
`Alt+Shift+Q` abre a caixa de pergunta direto, sem consultar a resposta
automática primeiro.

Existem duas formas de usar, com o mesmo backend:

- **[Bookmarklet](#bookmarklet)** — um favorito de navegador, funciona em
  qualquer site (até com CSP restritiva), sem instalar nada.
- **[Extensão de navegador](#extensão-de-navegador)** — atalho global mesmo
  fora da aba ativa, Firefox/Zen e Chrome.

## Bookmarklet

Não requer instalação: um favorito que roda a mesma lógica de seleção +
resposta direto na página da prova, mesmo em sites com CSP restritiva
(`connect-src`/`style-src` bloqueando chamada externa) — nesse caso ele
oferece um botão para abrir a resposta numa janelinha separada em vez de
travar sem feedback.

**Instalação:** **https://guilhermeb-ferrarezi.github.io/quiz-jev/** — cole sua
chave `qz_...`, arraste o link gerado para a barra de favoritos (ou copie o
código pra criar o favorito à mão / no celular). A chave fica embutida só no
seu favorito, gerada localmente no navegador — nunca trafega em requisição
nenhuma nem fica em arquivo deste repositório.

Uso: selecione o enunciado + alternativas na página da prova e clique no
favorito. Enquanto a página não recarrega, `Alt+Q` repete o processo numa
seleção nova sem precisar clicar de novo, e `Alt+Shift+Q` abre direto a
pergunta livre.

Diferenças em relação à extensão (limitações inerentes a não ter APIs de
extensão disponíveis):

- Sem `tabs.captureVisibleTab`, não há como fotografar a tela — a captura de
  imagem funciona para `<img>`/`<picture>` (arquivo original ou, se
  bloqueado, o endereço da imagem) e para um `<canvas>` que já exista na
  página; tabela, SVG, vídeo ou `background-image` não são capturados.
  Também usa só a primeira imagem da seleção (a extensão empilha várias e
  faz rolagem-e-costura).
- A transição animada de altura entre estados do card (da extensão) foi
  simplificada para uma troca direta — as animações visuais (entrada, "pop"
  da letra, barras, "Consultando" com bolinhas) continuam as mesmas.

O código-fonte do bookmarklet vive em `bookmarklet/` (`render-shared.js` é o
visual do card, reaproveitado por `docs/relay.html`; `quiz-jev.js` é a lógica
de seleção/captura/chamada). `bookmarklet/build.js` (sem dependências) gera
`docs/bookmarklet.min.js` e `docs/quiz-render.js`, publicados pelo GitHub
Pages a partir de `docs/` — rode `node bookmarklet/build.js` depois de mexer
nas fontes.

## Extensão de navegador

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

### Pergunta livre (`Alt+Q`, depois `T`, ou direto com `Alt+Shift+Q`)

Com o card de resposta aberto (ou ainda carregando), aperte `T` pra trocar o
conteúdo do card por uma caixa de texto. Escreva a pergunta e aperte `Enter`
(`Shift+Enter` quebra linha) — a extensão manda o trecho selecionado como
contexto e a sua pergunta, e a resposta volta sem o limite de "1 a 3 frases"
do modo de questão: pode escrever o quanto for necessário pra explicar bem.
Depois de responder, `T` funciona de novo, pra encadear outra pergunta sobre
o mesmo trecho. `Esc` fecha tudo, como em qualquer outro estado do card.

Se você já sabe que quer perguntar (não quer a resposta da questão), selecione
o trecho e aperte `Alt+Shift+Q` — abre a caixa de pergunta direto, sem gastar
tempo consultando a resposta automática primeiro. Sem nada selecionado, o
atalho mostra um aviso em vez de fazer qualquer chamada.

### Atalhos de teclado

| atalho | ação |
|---|---|
| `Alt+Q` | responde a questão selecionada |
| `Alt+Shift+Q` | pergunta livre direta sobre a seleção |
| `T` (com o card aberto) | pergunta livre sobre a mesma seleção (follow-up) |

Os dois atalhos de navegador (`Alt+Q` e `Alt+Shift+Q`) podem ser trocados a
qualquer momento:

- **Chrome:** `chrome://extensions/shortcuts`
- **Firefox / Zen:** `about:addons` → engrenagem (⚙) → **Gerenciar atalhos de
  extensões**

> **Chrome:** um `suggested_key` novo (como o `Alt+Shift+Q` deste release) só é
> aplicado automaticamente numa instalação **nova** da extensão — numa que já
> estava instalada, o Chrome não atribui o atalho sozinho. Depois de
> atualizar, confira/atribua `Alt+Shift+Q` manualmente em
> `chrome://extensions/shortcuts`.

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
enunciado **não** é gravado em log. Quando a seleção inclui uma figura, a
imagem (o arquivo original ou um recorte/costura da tela, dependendo do caso)
também é enviada. A sessão fica no armazenamento local do seu navegador.

## Limitações conhecidas

- Quando a figura é um `<img>`/`<picture>`, a extensão lê o arquivo original
  (qualidade cheia, não depende de caber na tela). Pra canvas, SVG, tabela ou
  vídeo, ela fotografa a tela — um print só se a figura cabe na viewport, ou
  rolando e costurando várias capturas quando não cabe. Um cabeçalho fixo ou
  sticky pode aparecer repetido nas faixas da costura.
- Se, mesmo assim, não for possível obter a figura (falha de rede, captura
  bloqueada…), a questão é enviada só com o texto, e o card mostra um aviso
  discreto disso.
- Em questões de completar lacunas, a resposta pode usar um sinônimo do termo
  esperado.
- O modelo rápido erra, e é por isso que o card mostra a confiança dele. Trate
  a resposta como uma segunda opinião, não como gabarito.
