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
    @keyframes quizJevIn { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: none; } }
    @keyframes quizJevOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-4px) scale(.97); } }
    @keyframes quizJevShake {
      10%, 90% { transform: translateX(-1px); }
      20%, 80% { transform: translateX(2px); }
      30%, 50%, 70% { transform: translateX(-4px); }
      40%, 60% { transform: translateX(4px); }
    }
    @keyframes quizJevPulse { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
    .card {
      position: fixed; z-index: 2147483647; max-width: 340px;
      max-height: min(60vh, 420px); overflow-y: auto;
      font: 14px/1.45 system-ui, sans-serif; color: #111;
      background: #fff; border: 1px solid #d4d4d8; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 12px 14px;
      animation: quizJevIn 160ms ease-out;
    }
    /* .fechando: aplicada no instante de fechar (ver fechar()) — o card só
       some da DOM depois que esta animação termina (animationend), pra não
       cortar o overlay seco no meio do Alt+Q/Escape. */
    .card.fechando { animation: quizJevOut 120ms ease-in forwards; }
    .card.erro-anim { animation: quizJevShake 320ms ease-in-out; }
    .card.aberta { max-width: 420px; }
    .linha { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .letra { font-size: 28px; font-weight: 700; line-height: 1; }
    .texto { flex: 1; }
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
    .carregando { display: flex; align-items: center; gap: 2px; color: #52525b; font-size: 13px; }
    .carregando .pontos { display: inline-flex; gap: 3px; margin-left: 3px; }
    .carregando .pontos i {
      width: 4px; height: 4px; border-radius: 50%; background: currentColor; display: block;
      animation: quizJevPulse 1.1s ease-in-out infinite;
    }
    .carregando .pontos i:nth-child(2) { animation-delay: .15s; }
    .carregando .pontos i:nth-child(3) { animation-delay: .3s; }
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
      .carregando { color: #a1a1aa; }
      .dica { border-color: #3f3f46; }
      .dica kbd { background: #27272a; border-color: #3f3f46; color: #d4d4d8; }
      .pergunta-label { color: #d4d4d8; }
      .pergunta-input { background: #27272a; border-color: #3f3f46; color: #fafafa; }
    }
    /* Quem pede menos movimento não devia ganhar um card saltitante. */
    @media (prefers-reduced-motion: reduce) {
      .card, .card.fechando, .card.erro-anim, .carregando .pontos i { animation: none !important; }
      .barra i { transition: none !important; }
    }
  `;

  // Tags que sempre valem como conteúdo visual, mesmo sem background-image.
  const TAGS_VISUAIS = new Set(["IMG", "CANVAS", "SVG", "TABLE", "MATH", "PICTURE", "VIDEO", "FIGURE"]);
  // Abaixo disso é ícone, spacer ou pixel de tracking — não vale a pena virar
  // chamada de visão por causa de uma estrelinha de "favoritar".
  const TAMANHO_MINIMO_PX = 40;
  const LIMITE_BYTES_IMAGEM = 7 * 1024 * 1024; // margem para o teto de 8MB do servidor
  const FOLGA_RECORTE_PX = 8;
  // Duração de @keyframes quizJevOut (content.js CSS) + folga — teto de
  // segurança caso o "animationend" não dispare (aba em background throttla
  // rAF/animação em alguns navegadores). Sem isso um fechar() nessas
  // condições deixaria o card fantasma na tela pra sempre.
  const DURACAO_SAIDA_MS = 200;

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
  function posicionar(card, rect) {
    const altura = card.offsetHeight || 40;
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

  function barras(probs, escolhida) {
    if (!probs) return null;
    const container = el("div", "barras");
    const itens = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    const paraAnimar = [];
    for (const [label, p] of itens) {
      const pct = Math.round(p * 100); // único valor calculado por nós — numérico, nunca concatenado em markup
      const linha = el("div", `barra${label === escolhida ? " escolhida" : ""}`);
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

  function mostrarResposta(card, d, rect, comImagem) {
    limpar(card);
    // Questão sem alternativas: `kind === "aberta"` é o sinal oficial, mas
    // também cobrimos `answer` vazio — cinturão e suspensório pro caso de
    // alguém recarregar a extensão antes do backend novo subir.
    const aberta = d.kind === "aberta" || !d.answer;
    card.classList.toggle("aberta", aberta);
    const badge = d.source === "claude" ? "claude" : "jev";
    const linha = el("div", "linha");
    if (aberta) {
      // Sem letra — não há alternativa nenhuma, e um traço no lugar só
      // confundiria. O texto da resposta é o conteúdo principal aqui.
      linha.append(el("span", "texto texto-aberta", d.answerText || ""));
      linha.append(el("span", `badge ${badge}`, badge));
    } else {
      linha.append(el("span", "letra", d.answer));
      linha.append(el("span", "texto", d.answerText || ""));
      linha.append(el("span", `badge ${badge}`, badge));
    }
    // Resposta com imagem não traz probabilities (não houve veredito do
    // modelo rápido) — badge extra deixa claro que a figura foi considerada,
    // já que o usuário não tem outro sinal disso no card.
    if (comImagem) linha.append(el("span", "badge imagem", "figura"));
    card.append(linha);
    if (d.degraded) {
      card.append(el("div", "aviso", "Confiança baixa — o segundo modelo não respondeu."));
    }
    // reasoning vem preenchido sempre que a resposta veio do estágio
    // escalado (source: "claude"), não só quando `explain` foi pedido —
    // por isso continua renderizado aqui.
    if (d.reasoning) {
      card.append(el("div", "motivo", d.reasoning));
    }
    const b = barras(d.probabilities, d.answer);
    if (b) card.append(b);
    card.append(dica());
    posicionar(card, rect);
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
    limpar(card);
    card.append(el("div", "erro", mensagem || "falhou"));
    // T continua funcionando aqui (ctxAtual sobrevive a um erro — só some no
    // fechar()) — a dica evita que isso fique escondido justo quando a
    // resposta automática falhou e perguntar na mão é a saída.
    card.append(dica());
    posicionar(card, rect);
    // Reflow forçado antes de reaplicar a classe: se um erro anterior já
    // tivesse deixado "erro-anim" no card, adicionar a MESMA classe de novo
    // não reinicia a animação (o navegador só reage a uma mudança real).
    card.classList.remove("erro-anim");
    void card.offsetWidth;
    card.classList.add("erro-anim");
  }

  // Estado intermediário (captura de tela, consulta ao servidor…) — os três
  // pontinhos pulsando (ver @keyframes quizJevPulse no CSS) são só um sinal
  // de "ainda trabalhando", não uma barra de progresso real.
  function mostrarCarregando(card, texto, rect) {
    limpar(card);
    const linha = el("div", "carregando");
    linha.append(document.createTextNode(texto));
    const pontos = el("span", "pontos");
    pontos.append(el("i"), el("i"), el("i"));
    linha.append(pontos);
    card.append(linha);
    posicionar(card, rect);
  }

  // Caixa da pergunta livre (Alt+Q, T) — troca o conteúdo do MESMO card já
  // aberto por um textarea, em vez de abrir um segundo overlay: mantém a
  // posição na tela e o contexto (raw/imagem) da seleção original.
  function abrirPerguntar() {
    if (!ctxAtual) return;
    ctxAtual.perguntando = true;
    const { card, rect } = ctxAtual;
    limpar(card);
    card.classList.add("aberta");
    card.append(el("div", "pergunta-label", "Pergunte sobre o assunto selecionado:"));
    const textarea = document.createElement("textarea");
    textarea.className = "pergunta-input";
    textarea.placeholder = "Escreva sua pergunta…";
    card.append(textarea);
    card.append(el("div", "pergunta-dica", "Enter envia · Shift+Enter quebra linha · Esc fecha"));
    posicionar(card, rect);
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

  // Este listener nunca chama sendResponse (o background só espera a entrega
  // da mensagem, não um resultado — ver background.js), então não precisa de
  // `return true`: funciona igual nos dois navegadores. O trabalho async fica
  // numa função separada (processarSelecao) em vez de tornar o próprio
  // listener `async`, pra não depender de como cada navegador trata o valor
  // de retorno (uma Promise) de uma função listener async.
  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "start") return false;
    processarSelecao();
    return false;
  });

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

    if (visuais.length) {
      const uniao = uniaoComFolga([rect, ...visuais.map((elemento) => elemento.getBoundingClientRect())], FOLGA_RECORTE_PX);
      if (!cabeNaViewport(uniao)) {
        // captureVisibleTab só fotografa o que está na viewport. Mandar um
        // recorte cortado seria pior que não responder — o modelo veria uma
        // figura incompleta. Melhor parar aqui e não gastar a chamada.
        mostrarErro(card, "A figura da questão não cabe inteira na tela. Role até ela ficar totalmente visível e tente de novo.", rect);
        return;
      }
      mostrarCarregando(card, "Capturando a tela…", rect);
      const printResp = await api.runtime.sendMessage({ type: "print" });
      if (!document.getElementById(ID)) return; // usuário fechou enquanto carregava
      if (!printResp?.ok) {
        mostrarErro(card, printResp?.error || "Não consegui capturar a tela.", rect);
        return;
      }
      mostrarCarregando(card, "Recortando a imagem…", rect);
      try {
        ctx.imageBase64 = await recortarImagem(printResp.dataUrl, uniao);
        ctx.imageMime = "image/png";
      } catch (e) {
        mostrarErro(card, "Não consegui recortar a imagem da questão.", rect);
        return;
      }
    }

    mostrarCarregando(card, ctx.imageBase64 ? "Analisando a imagem…" : "Consultando…", rect);
    const resp = await api.runtime.sendMessage({ type: "ask", raw, imageBase64: ctx.imageBase64, imageMime: ctx.imageMime });
    if (!document.getElementById(ID)) return; // usuário fechou enquanto carregava
    if (resp?.ok) mostrarResposta(card, resp.data, rect, !!ctx.imageBase64);
    else mostrarErro(card, resp?.error, rect);
  }
}
