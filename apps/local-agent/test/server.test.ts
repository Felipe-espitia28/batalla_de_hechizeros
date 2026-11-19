import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  LOCAL_AGENT_EVENTS_PATH,
  LOCAL_AGENT_PROTOCOL_VERSION,
  type LocalAgentMessage,
  type LocalAgentRole,
} from "@duelo/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type ClientOptions } from "ws";
import { detectorUrl } from "../src/config.js";
import { AGENT_CLOSE_CODES, resolveStaticFile, startServer, type AgentServer } from "../src/server.js";

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

// --- WebSocket /events (fase 2) ---

const ARENA_ORIGIN = "http://localhost:5174";

/** Cliente de prueba que guarda todo lo que recibe para poder esperarlo después. */
interface TestClient {
  ws: WebSocket;
  received: LocalAgentMessage[];
  next(type: LocalAgentMessage["type"]): Promise<LocalAgentMessage>;
  closed: Promise<{ code: number; reason: string }>;
  send(message: object): void;
}

function connect(port: number, origin: string, options: ClientOptions = {}): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${LOCAL_AGENT_EVENTS_PATH}`, { origin, ...options });
  const received: LocalAgentMessage[] = [];
  const waiters: Array<{ type: string; resolve: (m: LocalAgentMessage) => void }> = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString()) as LocalAgentMessage;
    received.push(message);
    const index = waiters.findIndex((w) => w.type === message.type);
    if (index >= 0) waiters.splice(index, 1)[0]!.resolve(message);
  });
  const closed = new Promise<{ code: number; reason: string }>((done) => {
    ws.on("close", (code, reason) => done({ code, reason: reason.toString() }));
  });
  const client: TestClient = {
    ws,
    received,
    closed,
    next: (type) => new Promise((done) => waiters.push({ type, resolve: done })),
    send: (message) => ws.send(JSON.stringify(message)),
  };
  return new Promise((done, fail) => {
    ws.once("open", () => done(client));
    ws.once("error", fail);
  });
}

/** Conecta, manda hello y espera el agent:peer que confirma que el rol quedó registrado. */
async function joinAs(port: number, role: LocalAgentRole, origin: string): Promise<TestClient> {
  const client = await connect(port, origin);
  const peer = client.next("agent:peer");
  client.send({ type: "agent:hello", role, protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION });
  await peer;
  return client;
}

describe("WebSocket del agente", () => {
  let agent: AgentServer;
  let detectorOrigin: string;
  const open: TestClient[] = [];

  beforeEach(async () => {
    // Silencia los logs de la demo en la salida de las pruebas.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    agent = await startServer(
      { port: 0, allowedOrigins: [ARENA_ORIGIN] },
      { staticDir: dir, helloTimeoutMs: 200, pingIntervalMs: 100 },
    );
    detectorOrigin = detectorUrl({ port: agent.port });
  });

  afterEach(async () => {
    for (const client of open.splice(0)) client.ws.terminate();
    await agent.close();
    vi.restoreAllMocks();
  });

  async function joinTracked(role: LocalAgentRole, origin = role === "arena" ? ARENA_ORIGIN : detectorOrigin) {
    const client = await joinAs(agent.port, role, origin);
    open.push(client);
    return client;
  }

  it("rechaza un origen no permitido con 403, sin abrir el WebSocket", async () => {
    const attempt = new WebSocket(`ws://127.0.0.1:${agent.port}${LOCAL_AGENT_EVENTS_PATH}`, {
      origin: "https://malicioso.example",
    });
    attempt.on("error", () => {});
    const status = await new Promise<number>((done) => {
      attempt.on("unexpected-response", (_req, res) => done(res.statusCode ?? 0));
      attempt.on("open", () => done(101));
    });
    expect(status).toBe(403);
    attempt.terminate();
  });

  it("rechaza conexiones sin Origin y en otra ruta", async () => {
    const statusOf = (url: string, options: ClientOptions) =>
      new Promise<number>((done) => {
        const ws = new WebSocket(url, options);
        // Al terminar tras la respuesta, ws emite un error de "cerrado antes de conectar".
        ws.on("error", () => {});
        ws.on("unexpected-response", (_req, res) => {
          done(res.statusCode ?? 0);
          ws.terminate();
        });
        ws.on("open", () => done(101));
      });
    expect(await statusOf(`ws://127.0.0.1:${agent.port}${LOCAL_AGENT_EVENTS_PATH}`, {})).toBe(403);
    expect(await statusOf(`ws://127.0.0.1:${agent.port}/otra`, { origin: ARENA_ORIGIN })).toBe(404);
  });

  it("reenvía agent:spell del detector a la arena", async () => {
    const arena = await joinTracked("arena");
    const detector = await joinTracked("detector");
    const spell = arena.next("agent:spell");
    detector.send({ type: "agent:spell", spellId: "lightning", confidence: 0.91 });
    expect(await spell).toEqual({ type: "agent:spell", spellId: "lightning", confidence: 0.91 });
  });

  it("reenvía agent:config de la arena al detector", async () => {
    const arena = await joinTracked("arena");
    const detector = await joinTracked("detector");
    const config = detector.next("agent:config");
    const message = { type: "agent:config", grimoire: ["lightning", "shield"], ultimateId: "meteor", minConfidence: 0.8 };
    arena.send(message);
    expect(await config).toEqual(message);
  });

  it("no reenvía un mensaje enviado por el rol equivocado", async () => {
    const arena = await joinTracked("arena");
    const detector = await joinTracked("detector");
    const spell = arena.next("agent:spell");
    // El detector no puede mandar config, ni nadie puede hacerse pasar por el servidor con peer.
    detector.send({ type: "agent:config", grimoire: [], ultimateId: "meteor", minConfidence: 0 });
    detector.send({ type: "agent:peer", detector: false, arena: false });
    detector.send({ type: "agent:hello", role: "arena", protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION });
    // El spell llega después en el mismo socket: si los anteriores se hubieran reenviado, ya estarían.
    detector.send({ type: "agent:spell", spellId: "shield", confidence: 0.85 });
    await spell;
    expect(arena.received.map((m) => m.type)).toEqual(["agent:peer", "agent:peer", "agent:spell"]);
  });

  it("cierra a quien manda hello con otra versión del protocolo", async () => {
    const client = await connect(agent.port, ARENA_ORIGIN);
    open.push(client);
    client.send({ type: "agent:hello", role: "arena", protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION + 1 });
    const { code, reason } = await client.closed;
    expect(code).toBe(AGENT_CLOSE_CODES.PROTOCOL_VERSION);
    expect(reason).toMatch(/versión/i);
    expect(agent.status.arena).toBe(false);
  });

  it("cierra a quien no empieza con un hello válido", async () => {
    const client = await connect(agent.port, ARENA_ORIGIN);
    open.push(client);
    client.send({ type: "agent:spell", spellId: "lightning", confidence: 1 });
    expect((await client.closed).code).toBe(AGENT_CLOSE_CODES.BAD_HELLO);

    const other = await connect(agent.port, ARENA_ORIGIN);
    open.push(other);
    other.send({ type: "agent:hello", role: "admin", protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION });
    expect((await other.closed).code).toBe(AGENT_CLOSE_CODES.BAD_HELLO);
  });

  it("cierra a quien no manda hello a tiempo", async () => {
    const client = await connect(agent.port, ARENA_ORIGIN);
    open.push(client);
    expect((await client.closed).code).toBe(AGENT_CLOSE_CODES.HELLO_TIMEOUT);
  });

  it("una segunda arena reemplaza a la primera", async () => {
    const first = await joinTracked("arena");
    const detector = await joinTracked("detector");
    const second = await joinTracked("arena");
    const { code, reason } = await first.closed;
    expect(code).toBe(AGENT_CLOSE_CODES.REPLACED);
    expect(reason).toBe("Reemplazado por una conexión nueva");
    // Que se cierre la vieja no deja la arena como desconectada: el puesto es de la nueva.
    expect(agent.status).toEqual({ detector: true, arena: true });
    const spell = second.next("agent:spell");
    detector.send({ type: "agent:spell", spellId: "lightning", confidence: 0.9 });
    expect((await spell).type).toBe("agent:spell");
    expect(first.received.some((m) => m.type === "agent:spell")).toBe(false);
  });

  it("/health refleja quién está conectado", async () => {
    const health = async () => (await fetch(`${detectorOrigin}/health`)).json();
    expect(await health()).toEqual({ ok: true, detector: false, arena: false });
    const detector = await joinTracked("detector");
    expect(await health()).toEqual({ ok: true, detector: true, arena: false });
    const arena = await joinTracked("arena");
    expect(await health()).toEqual({ ok: true, detector: true, arena: true });
    const peer = arena.next("agent:peer");
    detector.ws.close();
    await peer;
    expect(await health()).toEqual({ ok: true, detector: false, arena: true });
  });

  it("agent:peer llega a ambos cuando alguien entra o sale", async () => {
    const detector = await joinTracked("detector");
    expect(detector.received.at(-1)).toEqual({ type: "agent:peer", detector: true, arena: false });

    const detectorSeesArena = detector.next("agent:peer");
    const arena = await joinTracked("arena");
    expect(arena.received.at(-1)).toEqual({ type: "agent:peer", detector: true, arena: true });
    expect(await detectorSeesArena).toEqual({ type: "agent:peer", detector: true, arena: true });

    const arenaSeesLeave = arena.next("agent:peer");
    detector.ws.close();
    expect(await arenaSeesLeave).toEqual({ type: "agent:peer", detector: false, arena: true });
  });

  it("termina el socket que no responde al ping", async () => {
    // autoPong false: el cliente se comporta como una pestaña congelada.
    const client = await connect(agent.port, ARENA_ORIGIN, { autoPong: false });
    open.push(client);
    const peer = client.next("agent:peer");
    client.send({ type: "agent:hello", role: "arena", protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION });
    await peer;
    // terminate() no manda frame de cierre: el cliente ve 1006 (cierre anormal).
    expect((await client.closed).code).toBe(1006);
    // El cliente puede enterarse antes que el servidor procese su propio cierre.
    await vi.waitFor(() => expect(agent.status.arena).toBe(false));
  });

  it("descarta mensajes mayores de 4 KB cerrando el socket", async () => {
    const client = await joinAs(agent.port, "arena", ARENA_ORIGIN);
    open.push(client);
    client.ws.send("x".repeat(5 * 1024));
    expect((await client.closed).code).toBe(1009);
  });

  it("acepta el origen del propio detector", async () => {
    const detector = await joinTracked("detector", detectorOrigin);
    expect(detector.ws.readyState).toBe(WebSocket.OPEN);
  });
});
