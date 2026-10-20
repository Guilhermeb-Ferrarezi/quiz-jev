// Testes do proxy do Jev:  bun test worker/index.test.js
import { test, expect, beforeEach, afterEach } from "bun:test";
import worker from "./index.js";

const ORIGINAL_FETCH = globalThis.fetch;
let chamadas;

// Resposta padrão do "Jev" falso; cada teste pode trocar `respostaUpstream`.
let respostaUpstream;
beforeEach(() => {
  chamadas = [];
  respostaUpstream = () => new Response(JSON.stringify({ answers: { resposta: { choice: "B" } } }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "__cf_bm=segredo; Path=/" } });
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url: String(url), init });
    return respostaUpstream();
  };
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const pedido = (extra = {}) =>
  new Request("https://proxy.exemplo/v1/systemone", {
    method: "POST",
    headers: { authorization: "Bearer apikey_teste", "content-type": "application/json", origin: "https://prova.exemplo", ...(extra.headers || {}) },
    body: extra.body ?? JSON.stringify({ model: "jev-latest", state: "x", questions: {} }),
  });

test("preflight responde 204 liberando a chave e o header de imagem", async () => {
  const r = await worker.fetch(new Request("https://proxy.exemplo/v1/systemone", { method: "OPTIONS", headers: { origin: "https://prova.exemplo" } }));
  expect(r.status).toBe(204);
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  const permitidos = r.headers.get("access-control-allow-headers").toLowerCase();
  expect(permitidos).toContain("authorization");
  expect(permitidos).toContain("typesafe-danger-zone-images");
  expect(chamadas.length).toBe(0);
});

test("repassa o corpo e a chave ao Jev, sem chave no Worker", async () => {
  const r = await worker.fetch(pedido({ headers: { "typesafe-danger-zone-images": "true" } }));
  expect(r.status).toBe(200);
  expect(chamadas.length).toBe(1);
  expect(chamadas[0].url).toBe("https://api.typesafe.ai/v1/systemone");
  const cab = new Headers(chamadas[0].init.headers);
  expect(cab.get("authorization")).toBe("Bearer apikey_teste");
  expect(cab.get("typesafe-danger-zone-images")).toBe("true");
  expect(JSON.parse(new TextDecoder().decode(chamadas[0].init.body)).model).toBe("jev-latest");
  expect((await r.json()).answers.resposta.choice).toBe("B");
});

test("não repassa cookie nem origin ao Jev, e não devolve set-cookie", async () => {
  const r = await worker.fetch(pedido({ headers: { cookie: "sessao=1" } }));
  const cab = new Headers(chamadas[0].init.headers);
  expect(cab.get("cookie")).toBeNull();
  expect(cab.get("origin")).toBeNull();
  expect(r.headers.get("set-cookie")).toBeNull();
});

test("sem chave: 401 com CORS, e nada vai ao Jev", async () => {
  const r = await worker.fetch(new Request("https://proxy.exemplo/v1/systemone", { method: "POST", body: "{}" }));
  expect(r.status).toBe(401);
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  expect(chamadas.length).toBe(0);
});

test("só existe /v1/systemone e só com POST", async () => {
  const outra = await worker.fetch(new Request("https://proxy.exemplo/v1/outra", { method: "POST", headers: { authorization: "Bearer k" }, body: "{}" }));
  expect(outra.status).toBe(404);
  const get = await worker.fetch(new Request("https://proxy.exemplo/v1/systemone", { method: "GET", headers: { authorization: "Bearer k" } }));
  expect(get.status).toBe(405);
  expect(chamadas.length).toBe(0);
});

test("a raiz responde que está de pé (para conferir o deploy)", async () => {
  const r = await worker.fetch(new Request("https://proxy.exemplo/"));
  expect(r.status).toBe(200);
  expect((await r.json()).ok).toBe(true);
});

test("o status do Jev chega igual (chave recusada = 401) e com CORS", async () => {
  respostaUpstream = () => new Response(JSON.stringify({ message: "invalid key" }), { status: 401, headers: { "content-type": "application/json" } });
  const r = await worker.fetch(pedido());
  expect(r.status).toBe(401);
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  expect((await r.json()).message).toBe("invalid key");
});

test("Retry-After do Jev passa e fica visível ao navegador", async () => {
  respostaUpstream = () => new Response("{}", { status: 429, headers: { "retry-after": "7" } });
  const r = await worker.fetch(pedido());
  expect(r.status).toBe(429);
  expect(r.headers.get("retry-after")).toBe("7");
  expect(r.headers.get("access-control-expose-headers").toLowerCase()).toContain("retry-after");
});

test("corpo grande demais: 413, sem chamar o Jev", async () => {
  const r = await worker.fetch(pedido({ headers: { "content-length": String(13 * 1024 * 1024) } }));
  expect(r.status).toBe(413);
  expect(chamadas.length).toBe(0);
});

test("Jev fora do ar: 502 com mensagem e CORS", async () => {
  globalThis.fetch = async () => {
    throw new Error("rede");
  };
  const r = await worker.fetch(pedido());
  expect(r.status).toBe(502);
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  expect((await r.json()).message).toContain("Jev");
});
