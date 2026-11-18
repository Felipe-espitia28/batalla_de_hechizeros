import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectorUrl } from "../src/config.js";
import { resolveStaticFile, startServer, type AgentServer } from "../src/server.js";

let dir: string;
let server: AgentServer;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agente-"));
  await writeFile(join(dir, "index.html"), "<h1>detector</h1>");
  await writeFile(join(dir, "modelo.wasm"), Buffer.from([0, 97, 115, 109]));
  // Puerto 0: el sistema elige uno libre, así las pruebas no chocan con un agente abierto.
  server = await startServer({ port: 0, allowedOrigins: [] }, { staticDir: dir });
  base = detectorUrl({ port: server.port });
});

afterAll(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

describe("servidor del agente", () => {
  it("responde /health con quién está conectado", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, detector: false, arena: false });
  });

  it("sirve el detector en la raíz", async () => {
    const res = await fetch(`${base}/?x=1`);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toBe("<h1>detector</h1>");
  });

  it("sirve el wasm con application/wasm (MediaPipe lo exige)", async () => {
    const res = await fetch(`${base}/modelo.wasm`);
    expect(res.headers.get("content-type")).toBe("application/wasm");
  });

  it("devuelve 404 a lo que no existe y 405 a otros métodos", async () => {
    expect((await fetch(`${base}/nada.js`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(405);
  });

  it("no deja salir de la carpeta del detector", async () => {
    expect((await fetch(`${base}/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
    expect(resolveStaticFile(dir, "/../secreto.txt")).toBeNull();
    expect(resolveStaticFile(dir, "/%00.html")).toBeNull();
    expect(resolveStaticFile(dir, "/assets/a.js")).toBe(resolve(dir, "assets", "a.js"));
  });
});
