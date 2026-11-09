/**
 * Prueba de punta a punta con Socket.IO real: servidor en un puerto libre, dos clientes,
 * api simulado y cola en memoria. Usa una partida de 1,5 s para que el test sea rápido.
 */
import type { AddressInfo } from "node:net";
import type {
  AckResponse,
  ClientToServerEvents,
  MatchEndPayload,
  MatchFoundPayload,
  MatchState,
  ServerToClientEvents,
} from "@duelo/contracts";
import { MATCH_RULES } from "@duelo/game-rules";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signDevToken } from "../src/auth.js";
import { DevInternalApi } from "../src/internal-api.js";
import { silentLogger } from "../src/logger.js";
import { createGameServer, type GameServer } from "../src/server.js";
import { MemoryLiveStore } from "../src/store/live-store.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const SECRET = "secreto-solo-para-tests";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let server: GameServer;
let url: string;
const clients: Client[] = [];

function client(token: string): Client {
  const socket: Client = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
  clients.push(socket);
  return socket;
}

function once<E extends keyof ServerToClientEvents>(socket: Client, event: E): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    (socket.once as (e: string, fn: (p: unknown) => void) => void)(event, (p) => resolve(p as never));
  });
}

function ack(socket: Client, event: keyof ClientToServerEvents, payload: unknown): Promise<AckResponse> {
  return (socket.emitWithAck as (e: string, p: unknown) => Promise<AckResponse>)(event, payload);
}

beforeEach(async () => {
  server = createGameServer({
    jwtSecret: SECRET,
    allowedOrigins: true,
    store: new MemoryLiveStore(),
    api: new DevInternalApi(),
    logger: silentLogger,
    rules: { ...MATCH_RULES, countdownMs: 100, durationMs: 1_500 },
    timing: { matchmakingIntervalMs: 50, resultDeadlineMs: 500 },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await server.close();
});

describe("socket", () => {
  it("rechaza el handshake sin token válido con UNAUTHORIZED", async () => {
    const bad = client("no-es-un-jwt");
    const error = await new Promise<Error>((resolve) => bad.on("connect_error", resolve));
    expect(error.message).toBe("UNAUTHORIZED");

    const forged = client(signDevToken(A, "ana", "otro-secreto"));
    const error2 = await new Promise<Error>((resolve) => forged.on("connect_error", resolve));
    expect(error2.message).toBe("UNAUTHORIZED");
  });

  it("responde INVALID_PAYLOAD a un payload mal formado", async () => {
    const ana = client(signDevToken(A, "ana", SECRET));
    await once(ana, "connect" as never);
    expect(await ack(ana, "combat:cast-spell", { matchId: "x", spellId: "rayo-laser" })).toEqual({
      ok: false,
      code: "INVALID_PAYLOAD",
    });
  });

  it("partida completa: un Rayo en un cliente baja la vida en el otro y termina por tiempo", async () => {
    const ana = client(signDevToken(A, "ana", SECRET));
    const beto = client(signDevToken(B, "beto", SECRET));

    const foundA = once(ana, "match:found");
    const foundB = once(beto, "match:found");
    expect(await ack(ana, "matchmaking:join", {})).toEqual({ ok: true });
    expect(await ack(beto, "matchmaking:join", {})).toEqual({ ok: true });
    const found: MatchFoundPayload = await foundA;
    await foundB;
    expect(found.rival.username).toBe("beto");

    const started = once(beto, "match:start");
    await ack(ana, "match:ready", { matchId: found.matchId });
    await ack(beto, "match:ready", { matchId: found.matchId });
    const start = await started;
    await new Promise((resolve) => setTimeout(resolve, start.startsAt - start.serverNow + 50));

    const hit = new Promise<MatchState>((resolve) => {
      beto.on("match:state", (state) => {
        if (state.players[B]!.hp === 90) resolve(state);
      });
    });
    const castAck = await ack(ana, "combat:cast-spell", {
      matchId: found.matchId,
      castId: "c_0001",
      spellId: "lightning",
      confidence: 0.91,
    });
    expect(castAck).toEqual({ ok: true });
    expect((await hit).players[A]!.hp).toBe(100);

    const end: MatchEndPayload = await once(beto, "match:end");
    expect(end).toMatchObject({ matchId: found.matchId, winnerId: A, reason: "TIMEOUT" });
    expect(end.rewards[A]!.ratingDelta).toBe(25);
  });
});
