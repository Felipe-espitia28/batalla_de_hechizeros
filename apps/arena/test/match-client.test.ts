import type { AckResponse, MatchState } from "@duelo/contracts";
import { describe, expect, it } from "vitest";
import { MatchClient, type GameSocket } from "../src/match/match-client";

/** Socket falso: guarda los listeners y lo emitido; el test decide qué responde el "servidor". */
function fakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const sent: { event: string; payload: unknown; ack?: (...args: unknown[]) => void }[] = [];
  const socket = {
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, fn);
      return socket;
    },
    emit(event: string, payload: unknown, ack?: (...args: unknown[]) => void) {
      sent.push({ event, payload, ack });
      return socket;
    },
    timeout() {
      return socket;
    },
    connect() {
      return socket;
    },
    disconnect() {
      return socket;
    },
    removeAllListeners() {
      return socket;
    },
  };
  const server = (event: string, ...args: unknown[]) => handlers.get(event)?.(...args);
  return { socket: socket as unknown as GameSocket, sent, server };
}

function setup() {
  const fake = fakeSocket();
  let expired = 0;
  const client = new MatchClient({
    url: "http://test",
    token: "t",
    userId: "u1",
    createSocket: () => fake.socket,
    onSessionExpired: () => expired++,
  });
  return { client, ...fake, expired: () => expired };
}

const state = (serverNow: number): MatchState => ({
  matchId: "m1",
  status: "active",
  serverNow,
  endsAt: serverNow + 90_000,
  players: {},
});

describe("MatchClient", () => {
  it("recorre cola → partida encontrada → activa", () => {
    const { client, sent, server } = setup();
    server("connect");
    client.joinQueue();
    (sent.at(-1)!.ack as (a: AckResponse) => void)({ ok: true });
    expect(client.getSnapshot().phase).toBe("queued");

    server("match:found", { matchId: "m1", you: { id: "u1" }, rival: { id: "u2", username: "rival" } });
    expect(client.getSnapshot()).toMatchObject({ phase: "found", matchId: "m1" });

    server("match:state", state(Date.now()));
    expect(client.getSnapshot().phase).toBe("active");
  });

  it("solo envía { matchId, castId, spellId, confidence } y solo con la partida activa", () => {
    const { client, sent, server } = setup();
    client.castSpell("lightning", 0.9);
    expect(sent.some((s) => s.event === "combat:cast-spell")).toBe(false);

    server("match:found", { matchId: "m1", you: { id: "u1" }, rival: { id: "u2" } });
    server("match:state", state(Date.now()));
    client.castSpell("lightning", 0.9);
    const cast = sent.find((s) => s.event === "combat:cast-spell")!;
    expect(Object.keys(cast.payload as object).sort()).toEqual(["castId", "confidence", "matchId", "spellId"]);
  });

  it("definitivo: solo { matchId, castId, ultimateId, transcript } y solo con la partida activa", () => {
    const { client, sent, server } = setup();
    client.castUltimate("meteor", "¡meteoro!");
    expect(sent.some((s) => s.event === "combat:cast-ultimate")).toBe(false);

    server("match:found", { matchId: "m1", you: { id: "u1" }, rival: { id: "u2" } });
    server("match:state", state(Date.now()));
    client.castUltimate("meteor", "¡meteoro!");
    const cast = sent.find((s) => s.event === "combat:cast-ultimate")!;
    expect(cast.payload).toMatchObject({ matchId: "m1", ultimateId: "meteor", transcript: "¡meteoro!" });
    expect(Object.keys(cast.payload as object).sort()).toEqual(["castId", "matchId", "transcript", "ultimateId"]);
  });

  it("Sello: seal-charging y seal-cancel solo con { matchId } y solo con la partida activa", () => {
    const { client, sent, server } = setup();
    client.sealCharging();
    expect(sent.some((s) => s.event.startsWith("combat:seal"))).toBe(false);

    server("match:found", { matchId: "m1", you: { id: "u1" }, rival: { id: "u2" } });
    server("match:state", state(Date.now()));
    client.sealCharging();
    client.sealCancel();
    const seal = sent.filter((s) => s.event.startsWith("combat:seal"));
    expect(seal.map((s) => [s.event, s.payload])).toEqual([
      ["combat:seal-charging", { matchId: "m1" }],
      ["combat:seal-cancel", { matchId: "m1" }],
    ]);
  });

  it("calcula el desfase de reloj con serverNow", () => {
    const { client, server } = setup();
    server("match:state", state(Date.now() + 5000));
    expect(client.serverNow() - Date.now()).toBeGreaterThan(4900);
  });

  it("muestra un rechazo una sola vez aunque llegue por el ack y por el evento", () => {
    const { client, sent, server } = setup();
    server("match:found", { matchId: "m1", you: { id: "u1" }, rival: { id: "u2" } });
    server("match:state", state(Date.now()));
    client.castSpell("lightning", 0.9);
    const cast = sent.find((s) => s.event === "combat:cast-spell")!;
    const castId = (cast.payload as { castId: string }).castId;
    cast.ack!(null, { ok: false, code: "NO_MANA" });
    server("combat:spell-rejected", { castId, code: "NO_MANA" });
    expect(client.getSnapshot().notices.map((n) => n.text)).toEqual(["No tienes maná suficiente"]);
  });

  it("pide match:rejoin al reconectar en mitad de una partida", () => {
    const { client, sent, server } = setup();
    server("connect");
    server("match:found", { matchId: "m1", you: { id: "u1" }, rival: { id: "u2" } });
    server("match:state", state(Date.now()));
    server("disconnect");
    expect(client.getSnapshot().connection).toBe("reconnecting");
    server("connect");
    expect(sent.at(-1)).toMatchObject({ event: "match:rejoin", payload: { matchId: "m1" } });
  });

  it("un ack UNAUTHORIZED con el socket conectado muestra el error sin cerrar la sesión", () => {
    const { client, sent, server, expired } = setup();
    server("connect");
    client.joinQueue();
    (sent.at(-1)!.ack as (a: AckResponse) => void)({ ok: false, code: "UNAUTHORIZED" });
    expect(client.getSnapshot()).toMatchObject({ phase: "idle", connection: "online" });
    expect(client.getSnapshot().error).toMatch(/no reconoce tu cuenta/);
    expect(expired()).toBe(0);
  });

  it("token rechazado → avisa al shell con session-expired", () => {
    const { client, server, expired } = setup();
    server("connect_error", new Error("UNAUTHORIZED"));
    expect(client.getSnapshot().connection).toBe("unauthorized");
    expect(expired()).toBe(1);
  });
});
