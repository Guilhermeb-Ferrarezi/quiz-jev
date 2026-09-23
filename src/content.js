// Injetado sob demanda pelo background (nunca declarativo): lê a seleção,
// desenha o overlay e mostra a resposta. Não fala com a API — quem faz isso é
// o background, que é quem tem os tokens.

if (!window.__quizJevCarregado) {
  window.__quizJevCarregado = true;

  // Shim mínimo: Firefox expõe `browser.*`, Chrome expõe só `chrome.*` (ambos
  // aceitam promise quando o callback é omitido). Declarado DENTRO do guard:
  // o atalho injeta este arquivo de novo a cada Alt+Q (não há
  // content_scripts declarativo), e um `const` no topo do arquivo, fora do
  // guard, quebraria com "already declared" na segunda injeção.
  const api = globalThis.browser ?? globalThis.chrome;

  const ID = "__quiz-jev-overlay";
  // Shadow DOM + `all: initial`: sem isso o CSS da página deforma o card, e
  // site de prova costuma ter CSS agressivo.
  const CSS = `
    :host { all: initial; }
    /* Entrada com efeito de mola: passa um pouco do tamanho final (scale
       1.12 dentro do cubic-bezier) e assenta — bem mais marcante que um
       simples fade. A saída (quizJevOut) continua rápida, sem mola. */
    @keyframes quizJevIn {
      from { opacity: 0; transform: translateY(-10px) scale(.94); }
      to { opacity: 1; transform: none; }
    }
    @keyframes quizJevOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-4px) scale(.97); } }
    @keyframes quizJevShake {
      10%, 90% { transform: translateX(-1px); }
      20%, 80% { transform: translateX(2px); }
      30%, 50%, 70% { transform: translateX(-4px); }
      40%, 60% { transform: translateX(4px); }
    }
    /* "Pop" da letra da resposta: escala além do tamanho final e volta, com
       um brilho colorido que acende e apaga — usado tanto na letra única
       (.letra-pop) quanto em cada letra da múltipla resposta (.letra-item,
       uma por vez, em cascata via animation-delay definido em JS). */
    @keyframes quizJevPop {
      0% { opacity: 0; transform: scale(.6); text-shadow: 0 0 0 rgba(37,99,235,0); }
      55% { opacity: 1; transform: scale(1.12); text-shadow: 0 0 16px rgba(37,99,235,.6); }
      100% { opacity: 1; transform: scale(1); text-shadow: 0 0 0 rgba(37,99,235,0); }
    }
    /* Entrada em cascata do conteúdo novo (ver .item-cascata) — cada item
       recebe um animation-delay maior que o anterior, definido em JS. */
    @keyframes quizJevItemIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
    /* Brilho diagonal em loop, só durante o carregamento (ver .carregando-ativo). */
    @keyframes quizJevShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    /* Bolinhas do "Consultando": cada uma sobe e desce, em sequência (delays
       em .pontos i:nth-child). A borda azul pulsa enquanto o card espera. */
    @keyframes quizJevBolinha { 0%, 60%, 100% { transform: translateY(0); opacity: .35; } 30% { transform: translateY(-5px); opacity: 1; } }
    @keyframes quizJevBorda { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    .card {
      position: fixed; z-index: 2147483647; max-width: 340px;
      max-height: min(60vh, 420px); overflow-y: auto;
      font: 14px/1.45 system-ui, sans-serif; color: #111;
      background: #fff; border: 1px solid #d4d4d8; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 12px 14px;
      animation: quizJevIn 350ms cubic-bezier(.34,1.56,.64,1);
    }
    /* .fechando: aplicada no instante de fechar (ver fechar()) — o card só
       some da DOM depois que esta animação termina (animationend), pra não
       cortar o overlay seco no meio do Alt+Q/Escape. */
    .card.fechando { animation: quizJevOut 120ms ease-in forwards; }
    .card.erro-anim { animation: quizJevShake 320ms ease-in-out; }
    .card.aberta { max-width: 420px; }
    /* Durante o carregamento (mostrarCarregando) — o shimmer é um ::before
       por cima de todo o card; overflow:hidden mantém ele dentro do
       border-radius. position:fixed já vem de .card, então o ::before
       (absolute) já tem nele o ancestral posicionado certo. */
    .card.carregando-ativo { overflow: hidden; }
    .card.carregando-ativo::before {
      content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
      background: linear-gradient(115deg, transparent 35%, rgba(37,99,235,.16) 50%, transparent 65%);
      background-size: 200% 100%;
      animation: quizJevShimmer 1.4s linear infinite;
    }
    .linha { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .letra { font-size: 28px; font-weight: 700; line-height: 1; display: inline-flex; align-items: baseline; }
    /* .letra-pop: a letra única inteira "pop". .letra-item: cada letra da
       múltipla resposta, uma de cada vez (animation-delay em JS) — nesse
       caso .letra vira só um container flex, sem animação própria, pra não
       somar um segundo "pop" por cima dos das letras individuais. */
    .letra-pop, .letra-item { display: inline-block; animation: quizJevPop 450ms cubic-bezier(.34,1.56,.64,1) backwards; }
    .letra-separador { opacity: .55; }
    .texto { flex: 1; }
    /* Cascata do conteúdo que chega depois da letra (texto, badges, avisos,
       barras…) — cada item marcado com esta classe recebe um animation-delay
       maior que o anterior, definido em JS (ver emCascata em mostrarResposta). */
    .item-cascata { animation: quizJevItemIn 240ms ease-out backwards; }
    /* Resposta de questão sem alternativas: sem letra, então o texto vira o
       conteúdo principal — flex-basis 100% derruba badge(s) pra linha de
       baixo, e a entrelinha maior ajuda num parágrafo de até ~600 chars. */
    .texto-aberta { flex-basis: 100%; line-height: 1.55; }
    /* Cada badge define fundo E cor juntos. Definir só o fundo deixa a cor do
       texto herdada do .card, que muda com o tema — foi o que deixou o badge
       "claude" ilegível no escuro (lilás claro com letra branca). */
    .badge { font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
             padding: 2px 6px; border-radius: 999px;
             background: #e4e4e7; color: #3f3f46; }
    .badge.claude { background: #ede9fe; color: #5b21b6; }
    .badge.imagem { background: #dcfce7; color: #166534; }
    .aviso { margin-top: 8px; font-size: 12px; color: #92400e; }
    .motivo { margin-top: 8px; font-size: 13px; color: #3f3f46; }
    /* Questão "marque todas que se aplicam" (kind: multipla): lista as
       alternativas marcadas com seu texto, abaixo da(s) letra(s) grande(s). */
    .opcoes-multipla { margin-top: 8px; display: grid; gap: 5px; }
    .opcao-marcada { display: flex; gap: 8px; align-items: baseline; font-size: 13px; }
    .opcao-letra { font-weight: 700; flex: 0 0 auto; }
    .opcao-texto { flex: 1; color: #3f3f46; }
    .barras { margin-top: 10px; display: grid; gap: 3px; }
    .barra { display: grid; grid-template-columns: 18px 1fr 38px; gap: 6px;
             align-items: center; font-size: 12px; color: #52525b; }
    /* width começa em 0 e só recebe o valor real num rAF seguinte (ver
       barras()) — é essa transição que faz a barra "encher" em vez de já
       nascer no tamanho final. */
    .barra i { display: block; height: 6px; border-radius: 3px; background: #a1a1aa;
               width: 0; transition: width 420ms cubic-bezier(.16,1,.3,1); }
    .barra.escolhida i { background: #2563eb; }
    .erro { color: #b91c1c; }
    /* position/z-index: fica por cima do ::before do shimmer (ver .card.carregando-ativo). */
    .carregando { position: relative; z-index: 1; display: flex; align-items: center; color: #2563eb; font-size: 13px; font-weight: 500; }
    .pontos { display: inline-flex; align-items: flex-end; gap: 3px; margin-left: 5px; height: 1em; padding-bottom: 2px; }
    .pontos i { display: block; width: 5px; height: 5px; border-radius: 50%; background: currentColor;
                animation: quizJevBolinha 900ms ease-in-out infinite; }
    .pontos i:nth-child(2) { animation-delay: .15s; }
    .pontos i:nth-child(3) { animation-delay: .3s; }
    /* Borda azul pulsando enquanto consulta — é o sinal mais visível do card
       "trabalhando" e, ao contrário do shimmer, aparece bem no tema escuro. */
    .card.carregando-ativo::after {
      content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
      box-shadow: inset 0 0 0 1.5px rgba(37,99,235,.9), 0 0 14px rgba(37,99,235,.35);
      animation: quizJevBorda 1.4s ease-in-out infinite;
    }
    /* Barra fina de progresso "aproximado" — só aparece quando mostrarCarregando
       recebe um progresso (0..1), usada na captura de imagem (lendo arquivo,
       print, recortando/costurando, analisando). Não precisa ser exata. */
    .progresso { position: relative; z-index: 1; margin-top: 10px; height: 3px; border-radius: 999px; background: #e4e4e7; overflow: hidden; }
    .progresso i { display: block; height: 100%; width: 0; background: #2563eb; border-radius: 999px; transition: width 400ms ease-out; }
    .dica { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e4e4e7; font-size: 11px; color: #a1a1aa; }
    .dica kbd { font: inherit; padding: 1px 5px; border-radius: 4px; background: #f4f4f5;
                border: 1px solid #e4e4e7; color: #52525b; }
    .pergunta-label { font-size: 13px; color: #3f3f46; margin-bottom: 6px; }
    .pergunta-input {
      width: 100%; box-sizing: border-box; resize: vertical; min-height: 60px;
      font: inherit; padding: 8px; border: 1px solid #d4d4d8; border-radius: 8px;
      background: #fff; color: #111;
    }
    .pergunta-input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
    .pergunta-dica { margin-top: 6px; font-size: 11px; color: #a1a1aa; }
    @media (prefers-color-scheme: dark) {
      .card { background: #18181b; color: #fafafa; border-color: #3f3f46; }
      .motivo { color: #d4d4d8; }
      /* Um par fundo+cor por badge, na mesma especificidade das regras claras
         acima (.badge.x), senão a regra clara vence e o texto some. */
      .badge { background: #3f3f46; color: #e4e4e7; }
      .badge.claude { background: #4c1d95; color: #ddd6fe; }
      .badge.imagem { background: #14532d; color: #bbf7d0; }
      .carregando { color: #60a5fa; }
      .card.carregando-ativo::after { box-shadow: inset 0 0 0 1.5px rgba(96,165,250,.9), 0 0 16px rgba(96,165,250,.35); }
      .card.carregando-ativo::before { background: linear-gradient(115deg, transparent 35%, rgba(96,165,250,.18) 50%, transparent 65%); }
      .progresso { background: #3f3f46; }
      .dica { border-color: #3f3f46; }
      .dica kbd { background: #27272a; border-color: #3f3f46; color: #d4d4d8; }
      .pergunta-label { color: #d4d4d8; }
      .pergunta-input { background: #27272a; border-color: #3f3f46; color: #fafafa; }
    }
    /* Quem pede menos movimento não devia ganhar um card saltitante — desliga
       TODAS as animações novas também: pop da letra, cascata do conteúdo,
       shimmer do carregamento e (via a regra de .card abaixo, que também some
       com a transição inline de altura que trocarConteudo() define em JS) o
       ajuste suave de altura entre estados. */
    @media (prefers-reduced-motion: reduce) {
      .card, .card.fechando, .card.erro-anim, .letra-pop, .letra-item, .item-cascata { animation: none !important; }
      .card.carregando-ativo::before { animation: none !important; opacity: 0; }
      .pontos i, .card.carregando-ativo::after { animation: none !important; }
      .barra i, .progresso i, .card { transition: none !important; }
    }
  `;

  // Tags que sempre valem como conteúdo visual, mesmo sem background-image.
  const TAGS_VISUAIS = new Set(["IMG", "CANVAS", "SVG", "TABLE", "MATH", "PICTURE", "VIDEO", "FIGURE"]);
  // Abaixo disso é ícone, spacer ou pixel de tracking — não vale a pena virar
  // chamada de visão por causa de uma estrelinha de "favoritar".
  const TAMANHO_MINIMO_PX = 40;
  const LIMITE_BYTES_IMAGEM = 7 * 1024 * 1024; // margem para o teto de 8MB do servidor
  const FOLGA_RECORTE_PX = 8;
  // captureVisibleTab tolera ~2 chamadas/s antes de lançar erro de rate
  // limit — espaçar por esse tanto entre capturas evita bater nesse teto na
  // rolagem-e-costura (ver capturarRegiaoGrande).
  const ESPACO_MIN_CAPTURAS_MS = 550;
  // Acima disso (CSS px) no maior lado, reduz a escala do canvas final da
  // costura — sem isso uma figura muito alta geraria um canvas gigantesco
  // (lento pra desenhar e pesado antes mesmo do corte por bytes).
  const LIMITE_LADO_CSS_PX = 4000;
  // Varrer o documento inteiro em busca de position:fixed/sticky custa uma
  // getComputedStyle por elemento — em página muito grande isso pesa mais do
  // que vale (ver ocultarFixos). Acima deste tanto de elementos, desiste e
  // deixa os fixos/sticky se repetirem nas faixas.
  const LIMITE_ELEMENTOS_PARA_OCULTAR_FIXOS = 4000;
  // Duração de @keyframes quizJevOut (content.js CSS) + folga — teto de
  // segurança caso o "animationend" não dispare (aba em background throttla
  // rAF/animação em alguns navegadores). Sem isso um fechar() nessas
  // condições deixaria o card fantasma na tela pra sempre.
  const DURACAO_SAIDA_MS = 200;
  // Duração da transição de altura entre estados (ver trocarConteudo) — perto
  // do que o CSS já usa pras barras (420ms) mas mais curta, porque aqui é só
  // um redimensionamento do card, não o "preenchimento" de uma barra.
  const DURACAO_ALTURA_MS = 250;
  // Atraso entre um item e o próximo na cascata de entrada do conteúdo novo
  // (ver emCascata em mostrarResposta) e entre uma letra e a próxima na
  // múltipla resposta (ambos em JS, via animation-delay — CSS puro não dá
  // pra escalonar uma lista de tamanho dinâmico sem isso).
  const ATRASO_CASCATA_PASSO_MS = 60;
  const ATRASO_LETRA_ITEM_MS = 80;
  // Checada em JS onde uma animação é feita via `transition`/`style` inline
  // (não dá pra desligar só com o `@media (prefers-reduced-motion)` do CSS,
  // que só alcança `animation`/`transition` declaradas na folha de estilo).
  const REDUZIR_MOVIMENTO = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Contexto da seleção atual (raw, rect, imagem, e o próprio card) — vive
  // enquanto o overlay está aberto, e é o que a tecla T (ver aoTeclar) usa
  // pra abrir a caixa de pergunta sem precisar de uma seleção nova. null
  // quando não há overlay algum aberto.
  let ctxAtual = null;

  // fecharImediato: sem animação de saída — usada só por abrir() pra tirar
  // um card anterior do caminho antes de inserir o novo. Uma saída animada
  // aqui deixaria dois elementos com o mesmo ID (o antigo, fadeando, e o
  // novo, recém-criado) coexistindo na DOM por até DURACAO_SAIDA_MS, o que
  // confundiria document.getElementById(ID) bem no meio da troca.
  function fecharImediato() {
    document.getElementById(ID)?.remove();
    document.removeEventListener("keydown", aoTeclar, true);
    document.removeEventListener("mousedown", aoClicar, true);
    ctxAtual = null;
  }

  // fechar: fechamento "pedido pelo usuário" (Escape, clique fora) — anima a
  // saída (@keyframes quizJevOut) antes de tirar o card da DOM.
  function fechar() {
    const host = document.getElementById(ID);
    ctxAtual = null;
    document.removeEventListener("keydown", aoTeclar, true);
    document.removeEventListener("mousedown", aoClicar, true);
    if (!host) return;
    if (host.dataset.fechando) return; // já fechando — não duplica o timeout
    host.dataset.fechando = "1";
    const shadow = host.shadowRoot;
    const card = shadow?.querySelector(".card");
    if (!card) {
      host.remove();
      return;
    }
    card.classList.add("fechando");
    const remover = () => host.remove();
    card.addEventListener("animationend", remover, { once: true });
    setTimeout(remover, DURACAO_SAIDA_MS); // teto de segurança, ver a constante acima
  }

  function aoTeclar(e) {
    if (e.key === "Escape") {
      fechar();
      return;
    }
    // T abre a caixa de pergunta sobre a mesma seleção (Alt+Q, T). Só reage
    // fora do modo pergunta (senão digitar "t" na própria caixa reabriria
    // ela) e só quando já existe uma seleção capturada pra perguntar sobre.
    if ((e.key === "t" || e.key === "T") && ctxAtual && !ctxAtual.perguntando) {
      e.preventDefault();
      abrirPerguntar();
    }
  }

  function aoClicar(e) {
    const host = document.getElementById(ID);
    if (host && !e.composedPath().includes(host)) fechar();
  }

  // Reposiciona com a altura REAL do card (não uma estimativa): chamada de
  // novo depois que o conteúdo é populado, porque um card com aviso de
  // degradação + motivo + 4 barras passa fácil de qualquer altura estimada
  // e vazaria do viewport. Prefere abrir ABAIXO da seleção; só sobe quando
  // não couber embaixo. O max-height/overflow-y do CSS é o último recurso
  // pro caso extremo de nem cabendo entre topo e rodapé.
  function posicionar(card, rect, alturaForcada) {
    // `alturaForcada`: usada por trocarConteudo() pra reposicionar já com a
    // altura FINAL do conteúdo novo, nunca com a intermediária (offsetHeight
    // leria o valor animando no meio da transição de altura).
    const altura = alturaForcada || card.offsetHeight || 40;
    const largura = card.offsetWidth || 340;
    let topo = rect.bottom + 8;
    if (topo + altura > window.innerHeight - 8) {
      const acima = rect.top - 8 - altura;
      topo = acima >= 8 ? acima : Math.max(8, window.innerHeight - altura - 8);
    }
    const esq = Math.min(rect.left, window.innerWidth - largura - 8);
    card.style.top = `${Math.max(8, topo)}px`;
    card.style.left = `${Math.max(8, esq)}px`;
  }

  function abrir(rect) {
    fecharImediato();
    const host = document.createElement("div");
    host.id = ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const card = document.createElement("div");
    card.className = "card";
    shadow.append(style, card);
    document.body.appendChild(host);
    posicionar(card, rect);
    document.addEventListener("keydown", aoTeclar, true);
    document.addEventListener("mousedown", aoClicar, true);
    return card;
  }

  // Nó de DOM com texto via `textContent` — nunca innerHTML. `d.answerText`,
  // `d.reasoning` e a mensagem de erro vêm da rede (e, na origem, do texto da
  // própria página que o usuário selecionou); tratá-los como HTML permitiria
  // que um "enunciado" hostil injetasse markup com handler de evento
  // (ex. <img onerror=...>) que executaria no contexto do site aberto.
  function el(tag, className, texto) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function limpar(card) {
    card.replaceChildren();
  }

  // Troca o conteúdo do card com uma transição suave de altura: mede a
  // altura ATUAL, trava ela via inline style, deixa `montar()` limpar e
  // popular o conteúdo novo, mede a altura resultante (scrollHeight ignora o
  // `height` travado — é a altura "natural" do conteúdo novo) e anima entre
  // as duas. Volta pra `height: auto` (removendo o inline style) no fim, com
  // o mesmo padrão de transitionend + timeout de segurança que fechar() já
  // usa pra saída — sem isso um transitionend que não dispara (aba em
  // background, ou a duração calculada bater errado) deixaria o card preso
  // num height fixo pra sempre. Reposiciona com a altura FINAL (nunca com a
  // intermediária), pra não estragar o clamp de topo/esquerda de posicionar().
  function trocarConteudo(card, rect, montar) {
    const alturaAntes = card.offsetHeight;
    card.style.height = `${alturaAntes}px`;
    limpar(card);
    montar();
    const alturaDepois = card.scrollHeight;

    const finalizarAltura = () => {
      card.style.transition = "";
      card.style.height = "";
    };
    if (REDUZIR_MOVIMENTO.matches || alturaDepois === alturaAntes) {
      finalizarAltura();
    } else {
      void card.offsetHeight; // reflow forçado — mesmo truque do erro-anim em mostrarErro, garante que a transição realmente anime
      card.style.transition = `height ${DURACAO_ALTURA_MS}ms ease-out`;
      card.style.height = `${alturaDepois}px`;
      card.addEventListener("transitionend", finalizarAltura, { once: true });
      setTimeout(finalizarAltura, DURACAO_ALTURA_MS + 50);
    }

    posicionar(card, rect, alturaDepois);
  }

  // `escolhidas`: Set de rótulos em destaque — uma única alternativa (modo
  // "unica") ou várias (modo "multipla", onde o usuário decide se desmarca
  // alguma olhando a probabilidade individual de cada uma).
  function barras(probs, escolhidas) {
    if (!probs) return null;
    const container = el("div", "barras");
    const itens = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    const paraAnimar = [];
    for (const [label, p] of itens) {
      const pct = Math.round(p * 100); // único valor calculado por nós — numérico, nunca concatenado em markup
      const linha = el("div", `barra${escolhidas.has(label) ? " escolhida" : ""}`);
      linha.append(el("span", null, label));
      const barra = document.createElement("i");
      // Nasce em 0 (CSS) — só ganha a largura real no rAF abaixo, depois que
      // o container já está no DOM. Direto no width inicial não anima nada:
      // o navegador nunca chega a pintar o frame de largura 0.
      linha.append(barra);
      paraAnimar.push([barra, pct]);
      linha.append(el("span", null, `${pct}%`));
      container.append(linha);
    }
    requestAnimationFrame(() => {
      for (const [barra, pct] of paraAnimar) barra.style.width = `${pct}%`;
    });
    return container;
  }

  // Corta um texto de alternativa longo — a lista de marcadas da múltipla
  // resposta não pode virar um muro de texto dentro do card.
  function truncar(texto, max) {
    if (texto.length <= max) return texto;
    return `${texto.slice(0, max - 1).trimEnd()}…`;
  }

  // `opcoes` (d.parsed.options) traz o texto de cada alternativa por rótulo.
  // Defensivo quanto ao formato: objeto {label: texto} é o esperado, mas
  // aceita também uma lista de {label|letra, text|texto} sem quebrar o card.
  function textoDaOpcao(opcoes, label) {
    if (!opcoes) return "";
    if (Array.isArray(opcoes)) {
      const achado = opcoes.find((o) => o && (o.label === label || o.letra === label));
      return achado ? achado.text || achado.texto || "" : "";
    }
    return opcoes[label] || "";
  }

  function mostrarResposta(card, d, rect, comImagem, imagemFalhou) {
    trocarConteudo(card, rect, () => {
      card.classList.remove("carregando-ativo");
      const multipla = d.kind === "multipla";
      // Questão sem alternativas: `kind === "aberta"` é o sinal oficial, mas
      // também cobrimos `answer` vazio — cinturão e suspensório pro caso de
      // alguém recarregar a extensão antes do backend novo subir. `multipla`
      // vem primeiro: nela `answer`/`answerText` vêm vazios por design (a
      // resposta é `answers`), então cairiam aqui por engano se checados depois.
      const aberta = !multipla && (d.kind === "aberta" || !d.answer);
      card.classList.toggle("aberta", aberta || multipla);
      const badge = d.source === "claude" ? "claude" : "jev";
      const linha = el("div", "linha");
      const marcadas = multipla && Array.isArray(d.answers) ? d.answers : [];

      // Cascata: cada item depois da letra entra com um atraso maior que o
      // anterior (fade + leve subida, ver .item-cascata no CSS). A letra em
      // si não usa isso — ela tem o próprio "pop" (.letra-pop/.letra-item).
      let atrasoCascata = ATRASO_CASCATA_PASSO_MS;
      const emCascata = (elemento) => {
        elemento.classList.add("item-cascata");
        elemento.style.animationDelay = `${atrasoCascata}ms`;
        atrasoCascata += ATRASO_CASCATA_PASSO_MS;
        return elemento;
      };

      if (multipla) {
        // Cada letra marcada entra com o próprio "pop", em cascata entre
        // elas (ATRASO_LETRA_ITEM_MS) — não junta tudo num texto só, senão
        // não dá pra animar cada letra separadamente.
        const letraContainer = el("span", "letra");
        if (marcadas.length) {
          marcadas.forEach((label, i) => {
            if (i > 0) letraContainer.append(el("span", "letra-separador", " · "));
            const item = el("span", "letra-item", label);
            item.style.animationDelay = `${i * ATRASO_LETRA_ITEM_MS}ms`;
            letraContainer.append(item);
          });
        } else {
          letraContainer.append(document.createTextNode("—"));
        }
        linha.append(letraContainer);
        linha.append(emCascata(el("span", `badge ${badge}`, badge)));
        linha.append(emCascata(el("span", "badge", "várias corretas")));
      } else if (aberta) {
        // Sem letra — não há alternativa nenhuma, e um traço no lugar só
        // confundiria. O texto da resposta é o conteúdo principal aqui.
        linha.append(emCascata(el("span", "texto texto-aberta", d.answerText || "")));
        linha.append(emCascata(el("span", `badge ${badge}`, badge)));
      } else {
        linha.append(el("span", "letra letra-pop", d.answer));
        linha.append(emCascata(el("span", "texto", d.answerText || "")));
        linha.append(emCascata(el("span", `badge ${badge}`, badge)));
      }
      // Resposta com imagem não traz probabilities (não houve veredito do
      // modelo rápido) — badge extra deixa claro que a figura foi considerada,
      // já que o usuário não tem outro sinal disso no card.
      if (comImagem) linha.append(emCascata(el("span", "badge imagem", "figura")));
      card.append(linha);

      if (multipla) {
        const opcoes = d.parsed && d.parsed.options;
        if (marcadas.length) {
          const lista = emCascata(el("div", "opcoes-multipla"));
          for (const label of marcadas) {
            const item = el("div", "opcao-marcada");
            item.append(el("span", "opcao-letra", label));
            item.append(el("span", "opcao-texto", truncar(textoDaOpcao(opcoes, label), 120)));
            lista.append(item);
          }
          card.append(lista);
        } else {
          // Defensivo: não deveria acontecer (a API sempre marca pelo menos
          // uma), mas as barras de probabilidade continuam úteis mesmo assim.
          card.append(emCascata(el("div", "motivo", "Nenhuma alternativa passou do limiar.")));
        }
      }

      if (d.degraded) {
        card.append(emCascata(el("div", "aviso", "Confiança baixa — o segundo modelo não respondeu.")));
      }
      // A imagem só falha depois de já ter tentado arquivo original, print único
      // e (se preciso) rolagem-e-costura com nova tentativa — nesse ponto a
      // questão já foi mandada só com texto, e o card avisa isso em vez de
      // fingir que não tinha figura nenhuma.
      if (imagemFalhou) {
        card.append(emCascata(el("div", "aviso", "Não consegui enviar a figura desta questão — respondida só com o texto.")));
      }
      // reasoning vem preenchido sempre que a resposta veio do estágio
      // escalado (source: "claude"), não só quando `explain` foi pedido —
      // por isso continua renderizado aqui.
      if (d.reasoning) {
        card.append(emCascata(el("div", "motivo", d.reasoning)));
      }
      // multipla usa answerProbs (probabilidade de TODAS as alternativas,
      // marcadas ou não); unica/aberta usam probabilities, como já era.
      const probs = multipla ? d.answerProbs : d.probabilities;
      const escolhidas = multipla ? new Set(marcadas) : new Set([d.answer]);
      const b = barras(probs, escolhidas);
      if (b) {
        // Cada linha de barra entra em cascata, uma de cada vez.
        for (const linhaBarra of [...b.children]) emCascata(linhaBarra);
        card.append(b);
      }
      card.append(dica());
    });
  }

  // Rodapé discreto lembrando do atalho de pergunta livre (Alt+Q, T) — só
  // aparece numa resposta bem-sucedida (mostrarResposta), nunca num erro ou
  // num estado de carregamento, onde ainda não haveria o que perguntar mais.
  function dica() {
    const d = el("div", "dica");
    d.append(document.createTextNode("Pressione "));
    d.append(el("kbd", null, "T"));
    d.append(document.createTextNode(" para perguntar mais sobre este assunto"));
    return d;
  }

  function mostrarErro(card, mensagem, rect) {
    trocarConteudo(card, rect, () => {
      card.classList.remove("carregando-ativo");
      card.append(el("div", "erro", mensagem || "falhou"));
      // T continua funcionando aqui (ctxAtual sobrevive a um erro — só some no
      // fechar()) — a dica evita que isso fique escondido justo quando a
      // resposta automática falhou e perguntar na mão é a saída.
      card.append(dica());
    });
    // Reflow forçado antes de reaplicar a classe: se um erro anterior já
    // tivesse deixado "erro-anim" no card, adicionar a MESMA classe de novo
    // não reinicia a animação (o navegador só reage a uma mudança real).
    // Independente do reflow que trocarConteudo já fez pra altura — são
    // propriedades diferentes (transform vs. height), sem conflito.
    card.classList.remove("erro-anim");
    void card.offsetWidth;
    card.classList.add("erro-anim");
  }

  // Estado intermediário (captura de tela, consulta ao servidor…). O shimmer
  // diagonal (ver .card.carregando-ativo::before no CSS) é só um sinal de
  // "ainda trabalhando", não uma barra de progresso real — quando `progresso`
  // (0..1) é passado, a barra fina abaixo do texto é quem comunica avanço de
  // verdade (aproximado), usada nos passos da captura de imagem.
  function mostrarCarregando(card, texto, rect, progresso) {
    trocarConteudo(card, rect, () => {
      card.classList.add("carregando-ativo");
      // As reticências do texto ("Consultando…") viram três bolinhas que se
      // mexem — tira o "…"/"..." do fim pra não aparecer os dois juntos.
      const linha = el("div", "carregando", texto.replace(/(\u2026|\.{3})\s*$/, ""));
      const pontos = el("span", "pontos");
      for (let i = 0; i < 3; i++) pontos.append(document.createElement("i"));
      linha.append(pontos);
      card.append(linha);
      if (typeof progresso === "number") {
        const barraWrap = el("div", "progresso");
        const barra = document.createElement("i");
        barraWrap.append(barra);
        card.append(barraWrap);
        // Mesmo truque de barras(): nasce em 0 (CSS) e só ganha a largura
        // real num rAF seguinte, senão o navegador não chega a animar.
        requestAnimationFrame(() => {
          barra.style.width = `${Math.round(Math.min(1, Math.max(0, progresso)) * 100)}%`;
        });
      }
    });
  }

  // Caixa da pergunta livre (Alt+Q, T) — troca o conteúdo do MESMO card já
  // aberto por um textarea, em vez de abrir um segundo overlay: mantém a
  // posição na tela e o contexto (raw/imagem) da seleção original.
  function abrirPerguntar() {
    if (!ctxAtual) return;
    ctxAtual.perguntando = true;
    const { card, rect } = ctxAtual;
    let textarea;
    trocarConteudo(card, rect, () => {
      card.classList.remove("carregando-ativo");
      card.classList.add("aberta");
      card.append(el("div", "pergunta-label", "Pergunte sobre o assunto selecionado:"));
      textarea = document.createElement("textarea");
      textarea.className = "pergunta-input";
      textarea.placeholder = "Escreva sua pergunta…";
      card.append(textarea);
      card.append(el("div", "pergunta-dica", "Enter envia · Shift+Enter quebra linha · Esc fecha"));
    });
    textarea.focus();
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const pergunta = textarea.value.trim();
        if (pergunta) enviarPergunta(pergunta);
      }
      // Escape: não tratado aqui — o keydown de captura em `document`
      // (aoTeclar) já fecha o overlay inteiro antes deste handler rodar.
    });
  }

  async function enviarPergunta(pergunta) {
    const ctx = ctxAtual;
    const { card, rect, raw, imageBase64, imageMime } = ctx;
    mostrarCarregando(card, "Pensando…", rect);
    const resp = await api.runtime.sendMessage({ type: "ask", raw, ask: pergunta, imageBase64, imageMime });
    // Guarda dupla: `ID` sumiu (usuário fechou) OU `ctxAtual` já é outro
    // objeto (uma seleção nova, Alt+Q de novo, assumiu enquanto esperava) —
    // nos dois casos esta resposta chegou tarde demais pra valer a pena.
    if (!document.getElementById(ID) || ctxAtual !== ctx) return;
    if (resp?.ok) mostrarResposta(card, resp.data, rect, !!imageBase64);
    else mostrarErro(card, resp?.error, rect);
    ctx.perguntando = false; // T volta a funcionar, pra encadear outra pergunta
  }

  function elementoVisualRelevante(elemento) {
    const temTagVisual = TAGS_VISUAIS.has(elemento.tagName);
    if (!temTagVisual) {
      const bg = getComputedStyle(elemento).backgroundImage;
      if (!bg || bg === "none") return false;
    }
    const r = elemento.getBoundingClientRect();
    // Descarta candidato minúsculo (ícone, spacer, pixel de tracking) — sem
    // isso qualquer estrelinha de "favoritar" na página vira chamada de visão.
    return r.width >= TAMANHO_MINIMO_PX && r.height >= TAMANHO_MINIMO_PX;
  }

  // Procura só dentro do ancestral comum da seleção — nunca no documento
  // inteiro — e confirma com range.intersectsNode() que o candidato
  // realmente faz parte do que foi selecionado, não só está por perto.
  function encontrarElementosVisuais(range) {
    let raiz = range.commonAncestorContainer;
    if (raiz.nodeType !== Node.ELEMENT_NODE) raiz = raiz.parentElement;
    if (!raiz) return [];
    const candidatos = [];
    if (elementoVisualRelevante(raiz) && range.intersectsNode(raiz)) candidatos.push(raiz);
    for (const elemento of raiz.querySelectorAll("*")) {
      if (elementoVisualRelevante(elemento) && range.intersectsNode(elemento)) candidatos.push(elemento);
    }
    return candidatos;
  }

  // União dos retângulos (seleção + elementos visuais) com uma folga, em
  // coordenadas de viewport (mesmo espaço de getBoundingClientRect).
  function uniaoComFolga(rects, folga) {
    const left = Math.min(...rects.map((r) => r.left)) - folga;
    const top = Math.min(...rects.map((r) => r.top)) - folga;
    const right = Math.max(...rects.map((r) => r.right)) + folga;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + folga;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function cabeNaViewport(uniao) {
    return (
      uniao.left >= 0 &&
      uniao.top >= 0 &&
      uniao.right <= window.innerWidth &&
      uniao.bottom <= window.innerHeight
    );
  }

  // Recorta a região `uniao` (coordenadas CSS/viewport) do print de tela
  // inteira. O print vem em pixels FÍSICOS — multiplicar por devicePixelRatio
  // é obrigatório, senão em tela HiDPI o recorte sai deslocado. Se o PNG
  // resultante passar do limite, reduz a escala e recodifica até caber.
  async function recortarImagem(dataUrl, uniao) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("falha ao carregar o print da tela"));
      img.src = dataUrl;
    });
    const dpr = window.devicePixelRatio || 1;
    const sx = Math.max(0, Math.round(uniao.left * dpr));
    const sy = Math.max(0, Math.round(uniao.top * dpr));
    const sw = Math.min(img.width - sx, Math.round(uniao.width * dpr));
    const sh = Math.min(img.height - sy, Math.round(uniao.height * dpr));
    if (sw <= 0 || sh <= 0) throw new Error("região de recorte inválida");

    let escala = 1;
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sw * escala));
      canvas.height = Math.max(1, Math.round(sh * escala));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const dataUrlRecorte = canvas.toDataURL("image/png");
      const base64 = dataUrlRecorte.slice(dataUrlRecorte.indexOf(",") + 1);
      const bytes = Math.ceil((base64.length * 3) / 4);
      if (bytes <= LIMITE_BYTES_IMAGEM || escala <= 0.2) return base64;
      escala *= 0.7;
    }
    throw new Error("não consegui reduzir a imagem o suficiente");
  }

  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Dois rAF seguidos garantem que o navegador já pintou o frame pós-scroll
  // (um só rAF às vezes roda ANTES do reflow de scroll terminar); a pausa
  // curta é folga extra pra fontes/imagens lazy que pintam um frame depois.
  function esperarPintura() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
    });
  }

  // Uma nova tentativa depois de uma pausa — cobre tanto um erro de rede
  // pontual quanto o rate limit de ~2 capturas/s do captureVisibleTab.
  async function capturarComRetentativa() {
    let resp = await api.runtime.sendMessage({ type: "print" });
    if (!resp?.ok) {
      await esperar(ESPACO_MIN_CAPTURAS_MS);
      resp = await api.runtime.sendMessage({ type: "print" });
    }
    return resp;
  }

  function bytesDeBase64(base64) {
    return Math.ceil((base64.length * 3) / 4);
  }

  // Codifica um canvas já pronto respeitando o teto de bytes do servidor:
  // reduz a escala em PNG (mesma estratégia de recortarImagem) e, se ainda
  // assim não couber, cai pra JPEG (o backend aceita) — só esse formato tem
  // compressão de verdade pra foto/gráfico complexo.
  function canvasParaBase64ComLimite(canvasOriginal) {
    let atual = canvasOriginal;
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const dataUrl = atual.toDataURL("image/png");
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (bytesDeBase64(base64) <= LIMITE_BYTES_IMAGEM) return { base64, mime: "image/png" };
      const menor = document.createElement("canvas");
      menor.width = Math.max(1, Math.round(atual.width * 0.7));
      menor.height = Math.max(1, Math.round(atual.height * 0.7));
      menor.getContext("2d").drawImage(atual, 0, 0, menor.width, menor.height);
      atual = menor;
    }
    const dataUrlJpeg = atual.toDataURL("image/jpeg", 0.85);
    return { base64: dataUrlJpeg.slice(dataUrlJpeg.indexOf(",") + 1), mime: "image/jpeg" };
  }

  // ---- Caminho principal: arquivo original da(s) <img>/<picture> ----
  // Prioridade do dono do projeto: ler o arquivo da imagem em vez de
  // fotografar a tela, sempre que a seleção encostar só em <img>/<picture> —
  // sai em qualidade original e não depende de a figura caber na viewport.

  const MIMES_ACEITOS_DIRETO = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  function elementoImagemReal(elemento) {
    if (elemento.tagName === "IMG") return elemento;
    if (elemento.tagName === "PICTURE") return elemento.querySelector("img");
    return null;
  }

  async function aguardarImagemCarregada(img) {
    if (img.complete && img.naturalWidth > 0) return;
    try {
      await img.decode();
    } catch (e) {
      // segue mesmo assim — os passos seguintes falham e caem pro plano B
    }
  }

  async function blobParaBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binario = "";
    const TAMANHO_BLOCO = 0x8000; // evita estourar o limite de argumentos de fromCharCode num blob grande
    for (let i = 0; i < bytes.length; i += TAMANHO_BLOCO) {
      binario += String.fromCharCode(...bytes.subarray(i, i + TAMANHO_BLOCO));
    }
    return btoa(binario);
  }

  async function converterBlobParaPngBase64(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("falha ao decodificar imagem baixada"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      return dataUrl.slice(dataUrl.indexOf(",") + 1);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Tentativa 1: busca o arquivo original por HTTP. Funciona pra imagem da
  // mesma origem e pra a maioria das imagens com CORS liberado (CDN de
  // imagem de prova costuma liberar). Falha de rede/CORS vira null — quem
  // chama tenta o canvas em seguida.
  async function baixarImagemDeArquivo(img) {
    const src = img.currentSrc || img.src;
    if (!src) return null;
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (MIMES_ACEITOS_DIRETO.has(blob.type)) {
        return { base64: await blobParaBase64(blob), mime: blob.type };
      }
      return { base64: await converterBlobParaPngBase64(blob), mime: "image/png" };
    } catch (e) {
      return null;
    }
  }

  // Tentativa 2: desenha o <img> (já carregado na página) direto num canvas.
  // Se a imagem for cross-origin sem cabeçalho CORS, o canvas fica "tainted"
  // e toDataURL lança SecurityError — nesse caso não tem mais o que fazer
  // por essa imagem específica (plano B assume a partir daqui).
  async function desenharImgEmCanvas(img) {
    await aguardarImagemCarregada(img);
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    try {
      canvas.getContext("2d").drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/png" };
    } catch (e) {
      return null;
    }
  }

  async function obterImagemDeArquivo(img) {
    await aguardarImagemCarregada(img);
    const viaFetch = await baixarImagemDeArquivo(img);
    if (viaFetch) return viaFetch;
    return await desenharImgEmCanvas(img);
  }

  function aplicarTetoDeLado(canvas) {
    const maiorLado = Math.max(canvas.width, canvas.height);
    if (maiorLado <= LIMITE_LADO_CSS_PX) return canvas;
    const escala = LIMITE_LADO_CSS_PX / maiorLado;
    const menor = document.createElement("canvas");
    menor.width = Math.max(1, Math.round(canvas.width * escala));
    menor.height = Math.max(1, Math.round(canvas.height * escala));
    menor.getContext("2d").drawImage(canvas, 0, 0, menor.width, menor.height);
    return menor;
  }

  // Decodifica cada {base64, mime} baixado e junta tudo num único canvas —
  // empilhado verticalmente quando há mais de um, cada imagem escalada pra
  // largura comum (a maior entre elas) preservando proporção.
  async function montarImagemDeArquivos(itens) {
    const imgs = await Promise.all(
      itens.map(
        (it) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("falha ao decodificar imagem de arquivo"));
            img.src = `data:${it.mime};base64,${it.base64}`;
          })
      )
    );

    if (imgs.length === 1) {
      const unico = imgs[0];
      const canvas = document.createElement("canvas");
      canvas.width = unico.naturalWidth;
      canvas.height = unico.naturalHeight;
      canvas.getContext("2d").drawImage(unico, 0, 0);
      return aplicarTetoDeLado(canvas);
    }

    const largura = Math.max(...imgs.map((im) => im.naturalWidth));
    const alturas = imgs.map((im) => (im.naturalHeight * largura) / im.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = alturas.reduce((a, b) => a + b, 0);
    const ctx = canvas.getContext("2d");
    let y = 0;
    for (let i = 0; i < imgs.length; i++) {
      ctx.drawImage(imgs[i], 0, y, largura, alturas[i]);
      y += alturas[i];
    }
    return aplicarTetoDeLado(canvas);
  }

  // Se QUALQUER imagem do conjunto falhar nos dois métodos, desiste do
  // conjunto inteiro — não faz sentido mandar uma figura pela metade quando
  // a questão tinha duas imagens lado a lado, por exemplo. Quem chama cai
  // pro plano B (print da tela) pra seleção inteira.
  async function capturarImagemDeArquivo(imgsRelevantes) {
    const resultados = [];
    for (const img of imgsRelevantes) {
      const r = await obterImagemDeArquivo(img);
      if (!r) return null;
      resultados.push(r);
    }
    try {
      const canvas = await montarImagemDeArquivos(resultados);
      return canvasParaBase64ComLimite(canvas);
    } catch (e) {
      return null;
    }
  }

  // ---- Plano B: captura de tela, com rolagem-e-costura quando não cabe ----

  // position:fixed/sticky "flutua" e apareceria repetido em cada faixa da
  // costura — oculta pela duração da captura inteira (uma varredura só, não
  // por faixa). Em página com DOM enorme o custo de varrer tudo não compensa
  // (ver LIMITE_ELEMENTOS_PARA_OCULTAR_FIXOS): melhor deixar o fixo repetir
  // do que travar a captura por causa dele.
  function ocultarFixos() {
    if (!document.body) return [];
    const todos = document.body.querySelectorAll("*");
    if (todos.length > LIMITE_ELEMENTOS_PARA_OCULTAR_FIXOS) return [];
    const alterados = [];
    for (const elemento of todos) {
      const pos = getComputedStyle(elemento).position;
      if (pos === "fixed" || pos === "sticky") {
        alterados.push([elemento, elemento.style.visibility]);
        elemento.style.visibility = "hidden";
      }
    }
    return alterados;
  }

  function restaurarFixos(alterados) {
    for (const [elemento, valorOriginal] of alterados) {
      elemento.style.visibility = valorOriginal;
    }
  }

  // `uniao` está em coordenadas de viewport (getBoundingClientRect) — soma o
  // scroll atual pra virar coordenada de DOCUMENTO, estável mesmo rolando a
  // página pra tirar as várias faixas.
  function regiaoParaDocumento(uniao) {
    return {
      left: uniao.left + window.scrollX,
      top: uniao.top + window.scrollY,
      right: uniao.right + window.scrollX,
      bottom: uniao.bottom + window.scrollY,
      width: uniao.width,
      height: uniao.height,
    };
  }

  function calcularFaixas(regiaoDoc, vw, vh) {
    const faixas = [];
    for (let y = regiaoDoc.top; y < regiaoDoc.bottom; y += vh) {
      for (let x = regiaoDoc.left; x < regiaoDoc.right; x += vw) {
        faixas.push({ x, y });
      }
    }
    return faixas;
  }

  // Desenha cada print (viewport inteiro, em pixels FÍSICOS) na posição certa
  // do canvas final, sem recortar sub-retângulo: o que sobra fora da área da
  // faixa é cortado pelo próprio canvas. Onde faixas se sobrepõem, a última
  // desenhada (mais recente) fica por cima.
  async function montarImagemFinal(capturas, regiaoDoc) {
    const imgs = await Promise.all(
      capturas.map(
        (c) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("falha ao carregar print da costura"));
            img.src = c.dataUrl;
          })
      )
    );

    const dpr = window.devicePixelRatio || 1;
    let resFactor = dpr;
    const maiorLadoCss = Math.max(regiaoDoc.width, regiaoDoc.height);
    if (maiorLadoCss > LIMITE_LADO_CSS_PX) resFactor *= LIMITE_LADO_CSS_PX / maiorLadoCss;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(regiaoDoc.width * resFactor));
    canvas.height = Math.max(1, Math.round(regiaoDoc.height * resFactor));
    const ctx = canvas.getContext("2d");

    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const { x, y } = capturas[i];
      const dx = (x - regiaoDoc.left) * resFactor;
      const dy = (y - regiaoDoc.top) * resFactor;
      const dw = (img.width / dpr) * resFactor;
      const dh = (img.height / dpr) * resFactor;
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
    }

    return canvasParaBase64ComLimite(canvas);
  }

  // Rola a página em faixas do tamanho da viewport, tira um print por faixa
  // (espaçados pra não bater no rate limit) e costura tudo num canvas só.
  // Cobre também o caso "cabe numa viewport só, mas está fora da tela agora"
  // (calcularFaixas gera uma faixa única — rola até lá e tira um print).
  // Restaura rolagem, fixos e visibilidade do card em QUALQUER saída.
  async function capturarRegiaoGrande(uniaoViewport, card, rect, host) {
    const regiaoDoc = regiaoParaDocumento(uniaoViewport);
    const faixas = calcularFaixas(regiaoDoc, window.innerWidth, window.innerHeight);
    const scrollXOriginal = window.scrollX;
    const scrollYOriginal = window.scrollY;
    const alteradosFixos = ocultarFixos();
    const capturas = [];

    try {
      for (let i = 0; i < faixas.length; i++) {
        if (!document.getElementById(ID)) break; // usuário fechou o card no meio da costura

        mostrarCarregando(
          card,
          `Capturando a figura (${i + 1}/${faixas.length})…`,
          rect,
          0.15 + 0.55 * ((i + 1) / faixas.length)
        );
        await new Promise((resolve) => requestAnimationFrame(resolve)); // deixa o texto pintar antes de esconder

        if (host) host.style.visibility = "hidden";
        window.scrollTo(faixas[i].x, faixas[i].y);
        await esperarPintura();

        const printResp = await capturarComRetentativa();
        if (host) host.style.visibility = "visible";

        if (!printResp?.ok) return null; // falhou mesmo depois da nova tentativa — desiste da imagem
        capturas.push({ dataUrl: printResp.dataUrl, x: window.scrollX, y: window.scrollY });
      }
    } finally {
      restaurarFixos(alteradosFixos);
      window.scrollTo(scrollXOriginal, scrollYOriginal);
      if (host) host.style.visibility = "visible";
    }

    if (!capturas.length) return null;
    if (document.getElementById(ID)) mostrarCarregando(card, "Costurando a imagem…", rect, 0.85);
    try {
      return await montarImagemFinal(capturas, regiaoDoc);
    } catch (e) {
      return null;
    }
  }

  // Resolve a imagem de uma seleção com conteúdo visual, na ordem de
  // prioridade do dono do projeto: (1) arquivo original de cada <img>/
  // <picture> — só quando TODOS os elementos visuais da seleção forem
  // img/picture, senão a mistura (ex. canvas + img) cai direto pro plano B;
  // (2) print da tela, único se a união couber na viewport; (3) rolagem-e-
  // costura quando não couber. Nunca lança — retorna null se tudo falhar, e
  // quem chama manda a questão só com o texto.
  async function resolverImagemDaSelecao(visuais, rect, card) {
    const imgsRelevantes = visuais.map(elementoImagemReal).filter(Boolean);
    if (imgsRelevantes.length === visuais.length) {
      mostrarCarregando(card, "Lendo a imagem…", rect, 0.25);
      const resultado = await capturarImagemDeArquivo(imgsRelevantes);
      if (!document.getElementById(ID)) return null;
      if (resultado) return resultado;
    }

    const uniao = uniaoComFolga([rect, ...visuais.map((elemento) => elemento.getBoundingClientRect())], FOLGA_RECORTE_PX);

    if (cabeNaViewport(uniao)) {
      mostrarCarregando(card, "Capturando a tela…", rect, 0.35);
      const printResp = await capturarComRetentativa();
      if (!document.getElementById(ID)) return null;
      if (!printResp?.ok) return null;
      mostrarCarregando(card, "Recortando a imagem…", rect, 0.75);
      try {
        const base64 = await recortarImagem(printResp.dataUrl, uniao);
        return { base64, mime: "image/png" };
      } catch (e) {
        return null;
      }
    }

    return await capturarRegiaoGrande(uniao, card, rect, document.getElementById(ID));
  }

  // Este listener nunca chama sendResponse (o background só espera a entrega
  // da mensagem, não um resultado — ver background.js), então não precisa de
  // `return true`: funciona igual nos dois navegadores. O trabalho async fica
  // numa função separada (processarSelecao) em vez de tornar o próprio
  // listener `async`, pra não depender de como cada navegador trata o valor
  // de retorno (uma Promise) de uma função listener async.
  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "start") return false;
    // modo "perguntar" (Alt+Shift+Q, ver background.js): abre direto a caixa
    // de pergunta livre, sem consultar a resposta automática primeiro.
    if (msg.modo === "perguntar") processarPerguntaDireta();
    else processarSelecao();
    return false;
  });

  // Alt+Shift+Q: pergunta livre direta, sem passar pela consulta automática.
  // É um atalho de navegador de verdade (api.commands), não uma tecla dentro
  // do card — por isso não tem a corrida que "Alt+Q, depois T rápido" tinha
  // (o T dentro do card só existe DEPOIS que abrir() registra aoTeclar, e um
  // T digitado antes disso se perdia). Sem seleção não há contexto pra
  // perguntar: avisa e não chama a API.
  async function processarPerguntaDireta() {
    const sel = window.getSelection();
    const raw = sel ? sel.toString().trim() : "";
    if (!raw) {
      const rect = { top: 16, bottom: 16, left: 16, right: 16 };
      const card = abrir(rect);
      card.append(el("div", "erro", "Selecione um trecho antes de perguntar."));
      posicionar(card, rect);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const card = abrir(rect);
    const ctx = { raw, rect, card, imageBase64: null, imageMime: null, perguntando: false };
    ctxAtual = ctx;

    const visuais = encontrarElementosVisuais(range);
    if (visuais.length) {
      const resultado = await resolverImagemDaSelecao(visuais, rect, card);
      if (!document.getElementById(ID) || ctxAtual !== ctx) return; // fechou ou uma seleção nova assumiu
      if (resultado) {
        ctx.imageBase64 = resultado.base64;
        ctx.imageMime = resultado.mime;
      }
      // Falha de imagem aqui não tem aviso próprio: abrirPerguntar substitui
      // o conteúdo do card pela caixa de texto a seguir, e enviarPergunta já
      // manda só o texto quando imageBase64 continua null — comportamento
      // correto sem precisar de um aviso que sumiria no mesmo instante.
    }

    if (!document.getElementById(ID) || ctxAtual !== ctx) return;
    abrirPerguntar();
  }

  async function processarSelecao() {
    const sel = window.getSelection();
    const raw = sel ? sel.toString().trim() : "";
    if (!raw) return; // sem seleção não chama a API
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const card = abrir(rect);
    // Publicado já aqui (antes da imagem ser resolvida) — T funciona mesmo
    // durante "Capturando a tela…"/"Recortando a imagem…", não só depois da
    // primeira resposta. imageBase64/imageMime ficam null até serem
    // preenchidos abaixo; enviarPergunta lê o valor atual no momento do
    // envio, não uma cópia congelada daqui.
    const ctx = { raw, rect, card, imageBase64: null, imageMime: null, perguntando: false };
    ctxAtual = ctx;

    // Coração da feature: só manda print quando a seleção encosta em algo
    // visual. Sem esse filtro toda questão custaria 5-8s de visão em vez dos
    // 150ms de hoje, e a maioria das questões é puro texto.
    const visuais = encontrarElementosVisuais(range);

    // A imagem TEM que ser enviada de algum jeito — bloquear a questão
    // porque a figura não coube na tela não é aceitável. resolverImagemDaSelecao
    // só devolve null se arquivo original, print único E rolagem-e-costura
    // (com nova tentativa) falharem todos; nesse caso a questão segue só com
    // o texto, e o card avisa isso depois da resposta (ver mostrarResposta).
    let imagemFalhou = false;
    if (visuais.length) {
      const resultado = await resolverImagemDaSelecao(visuais, rect, card);
      if (!document.getElementById(ID)) return; // usuário fechou enquanto carregava
      if (resultado) {
        ctx.imageBase64 = resultado.base64;
        ctx.imageMime = resultado.mime;
      } else {
        imagemFalhou = true;
      }
    }

    mostrarCarregando(
      card,
      ctx.imageBase64 ? "Analisando a imagem…" : "Consultando…",
      rect,
      ctx.imageBase64 ? 0.95 : undefined
    );
    const resp = await api.runtime.sendMessage({ type: "ask", raw, imageBase64: ctx.imageBase64, imageMime: ctx.imageMime });
    if (!document.getElementById(ID)) return; // usuário fechou enquanto carregava
    if (resp?.ok) mostrarResposta(card, resp.data, rect, !!ctx.imageBase64, imagemFalhou);
    else mostrarErro(card, resp?.error, rect);
  }
}
