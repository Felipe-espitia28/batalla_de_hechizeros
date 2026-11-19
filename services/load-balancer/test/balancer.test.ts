import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Balancer } from "../src/balancer.js";
import { ConfigError, loadConfig } from "../src/config.js";
import { BACKEND_HEADER, startServer, type LbServer } from "../src/server.js";

/** Copia falsa del api: responde su nombre, el método, la ruta, el cuerpo y algunas cabeceras. */
interface FakeApi {
  name: string;
  url: string;
  hits: number;
  healthy: boolean;
  close(): Promise<void>;
}

const open: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const item of open.splice(0).reverse()) await item.close().catch(() => undefined);
});

async function fakeApi(name: string): Promise<FakeApi> {
  const api: FakeApi = { name, url: "", hits: 0, healthy: true, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(api.healthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: api.healthy }));
      return;
    }
    api.hits += 1;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      // Simula la cabecera CORS que pone el api real: el balanceador debe dejarla pasar.
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": String(req.headers.origin ?? "") });
      res.end(
        JSON.stringify({
          served: name,
          method: req.method,
          path: req.url,
          body,
          authorization: req.headers.authorization ?? null,
          forwardedFor: req.headers["x-forwarded-for"] ?? null,
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  api.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  api.close = () =>
    new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  open.push(api);
  return api;
}

async function balancerFor(apis: FakeApi[]): Promise<{ lb: LbServer; balancer: Balancer; base: string }> {
  const config = loadConfig({ LB_BACKENDS: apis.map((a) => a.url).join(","), PORT: "0", LB_HEALTH_INTERVAL_MS: "1000" });
  const balancer = new Balancer(config.backends, { healthIntervalMs: config.healthIntervalMs, healthTimeoutMs: 500 });
  const lb = await startServer(balancer, 0, () => undefined);
  open.push({ close: async () => (balancer.stop(), lb.close()) });
  return { lb, balancer, base: `http://127.0.0.1:${lb.port}` };
}

describe("configuración", () => {
  it("nombra las copias api-1, api-2… y exige al menos dos", () => {
    const config = loadConfig({ LB_BACKENDS: "https://a.example.test/, https://b.example.test" });
    expect(config.backends.map((b) => b.name)).toEqual(["api-1", "api-2"]);
    expect(config.port).toBe(4100);
    expect(() => loadConfig({ LB_BACKENDS: "https://a.example.test" })).toThrow(/al menos dos/);
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ LB_BACKENDS: "ftp://a.example.test,https://b.example.test" })).toThrow(/http/);
  });
});

describe("balanceador", () => {
  it("reparte por turnos y marca qué copia contestó", async () => {
    const a = await fakeApi("A");
    const b = await fakeApi("B");
    const { base } = await balancerFor([a, b]);

    const served: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${base}/me`);
      served.push(res.headers.get(BACKEND_HEADER) ?? "");
    }
    expect(served).toEqual(["api-1", "api-2", "api-1", "api-2"]);
    expect([a.hits, b.hits]).toEqual([2, 2]);
  });

  it("reenvía cuerpo, cabeceras y ruta, y deja pasar el CORS del api", async () => {
    const a = await fakeApi("A");
    const b = await fakeApi("B");
    const { base } = await balancerFor([a, b]);

    const res = await fetch(`${base}/shop/purchase?x=1`, {
      method: "POST",
      headers: { authorization: "Bearer prueba", origin: "https://shell.example.test", "content-type": "application/json" },
      body: JSON.stringify({ spellId: "fireball" }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toMatchObject({
      method: "POST",
      path: "/shop/purchase?x=1",
      body: JSON.stringify({ spellId: "fireball" }),
      authorization: "Bearer prueba",
    });
    expect(data.forwardedFor).toBeTruthy();
    expect(res.headers.get("access-control-allow-origin")).toBe("https://shell.example.test");
  });

  it("si una copia se cae, todo va a la otra; al volver, regresa a la rotación", async () => {
    const a = await fakeApi("A");
    const b = await fakeApi("B");
    const { base, balancer } = await balancerFor([a, b]);

    a.healthy = false;
    await balancer.checkAll();
    for (let i = 0; i < 3; i++) expect((await fetch(`${base}/ranking`)).headers.get(BACKEND_HEADER)).toBe("api-2");

    a.healthy = true;
    await balancer.checkAll();
    const names = new Set<string>();
    for (let i = 0; i < 2; i++) names.add((await fetch(`${base}/ranking`)).headers.get(BACKEND_HEADER) ?? "");
    expect(names).toEqual(new Set(["api-1", "api-2"]));
  });

  it("un GET a una copia apagada se reintenta en la otra sin que el usuario lo note", async () => {
    const a = await fakeApi("A");
    const b = await fakeApi("B");
    const { base } = await balancerFor([a, b]);
    await a.close(); // apagada de golpe: la revisión de salud todavía no lo sabe

    const res = await fetch(`${base}/me`);
    expect(res.status).toBe(200);
    expect(res.headers.get(BACKEND_HEADER)).toBe("api-2");
  });

  it("un POST a una copia apagada no se repite (podría comprar dos veces): 502", async () => {
    const a = await fakeApi("A");
    const b = await fakeApi("B");
    const { base } = await balancerFor([a, b]);
    await a.close();

    const res = await fetch(`${base}/shop/purchase`, { method: "POST", body: "{}" });
    expect(res.status).toBe(502);
    expect(b.hits).toBe(0);
  });

  it("con las dos copias apagadas responde 502", async () => {
    const a = await fakeApi("A");
    const b = await fakeApi("B");
    const { base } = await balancerFor([a, b]);
    await a.close();
    await b.close();

    const res = await fetch(`${base}/me`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "BAD_GATEWAY" } });
  });

  it("/lb/status muestra la salud y cuántas peticiones atendió cada copia", async () => {
    const a = await fakeApi("A");
    const b = await fakeApi("B");
    const { base } = await balancerFor([a, b]);
    await fetch(`${base}/me`);

    const status = (await (await fetch(`${base}/lb/status`)).json()) as {
      backends: Array<{ name: string; healthy: boolean; served: number }>;
    };
    expect(status.backends.map(({ name, healthy, served }) => ({ name, healthy, served }))).toEqual([
      { name: "api-1", healthy: true, served: 1 },
      { name: "api-2", healthy: true, served: 0 },
    ]);
  });
});
