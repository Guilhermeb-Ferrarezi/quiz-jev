// Proxy do Jev para o bookmarklet (Cloudflare Worker).
//
// Por que existe: a API do Jev (TypeSafe) só libera CORS para a origem do painel
// dela — "Disallowed CORS origin" para qualquer outra — então nenhum navegador
// consegue chamá-la direto de um site de prova nem da página do GitHub Pages. Este
// Worker fica no meio: recebe a chamada do favorito, repassa ao Jev e devolve com
// CORS liberado.
//
// O que ele NÃO faz: guardar chave (a chave do Jev vem no Authorization de cada
// chamada, direto do favorito, e só passa), logar cabeçalhos ou corpo, ou falar
// com qualquer endereço que não seja o do Jev. Destino e caminho são fixos.

const JEV = "https://api.typesafe.ai/v1/systemone";
// Imagem em base64 ocupa bem mais que o arquivo; o servidor do Quiz Jev aceita até
// 8 MB de imagem, aqui sobra folga sem virar um proxy de upload qualquer.
const LIMITE_CORPO_BYTES = 12 * 1024 * 1024;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, typesafe-danger-zone-images",
  "access-control-expose-headers": "retry-after",
  "access-control-max-age": "86400",
};

function resposta(status, objeto) {
  return new Response(JSON.stringify(objeto), { status, headers: { ...CORS, "content-type": "application/json" } });
}

export default {
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Só pra conferir, no navegador, que o deploy está de pé.
    if (url.pathname === "/" && req.method === "GET") return resposta(200, { ok: true, servico: "quiz-jev-proxy" });

    if (url.pathname !== "/v1/systemone") return resposta(404, { message: "não encontrado" });
    if (req.method !== "POST") return resposta(405, { message: "use POST" });

    const autorizacao = req.headers.get("authorization");
    if (!autorizacao || !/^Bearer\s+\S+/.test(autorizacao)) {
      return resposta(401, { message: "informe a chave do Jev em Authorization: Bearer <chave>" });
    }

    if (Number(req.headers.get("content-length") || 0) > LIMITE_CORPO_BYTES) {
      return resposta(413, { message: "pedido grande demais" });
    }
    const corpo = await req.arrayBuffer();
    if (corpo.byteLength > LIMITE_CORPO_BYTES) return resposta(413, { message: "pedido grande demais" });

    // Só estes cabeçalhos seguem ao Jev: nada de cookie, origin ou IP do cliente.
    const cabecalhos = new Headers({ authorization: autorizacao, "content-type": "application/json" });
    const imagens = req.headers.get("typesafe-danger-zone-images");
    if (imagens) cabecalhos.set("typesafe-danger-zone-images", imagens);

    let jev;
    try {
      jev = await fetch(JEV, { method: "POST", headers: cabecalhos, body: corpo });
    } catch (e) {
      return resposta(502, { message: "não consegui falar com o Jev" });
    }

    // Resposta do Jev como veio (status e corpo), sem os cookies dele.
    const saida = new Headers(CORS);
    saida.set("content-type", jev.headers.get("content-type") || "application/json");
    const espera = jev.headers.get("retry-after");
    if (espera) saida.set("retry-after", espera);
    return new Response(jev.body, { status: jev.status, headers: saida });
  },
};
