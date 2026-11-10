import type { RecordMatchRequest, RecordMatchResponse, ServerToClientEventName } from "@duelo/contracts";
import { MATCH_RULES } from "@duelo/game-rules";
import { beforeEach, describe, expect, it } from "vitest";
import { GameService, type Emitter } from "../src/game-service.js";
import { DevInternalApi, InternalApiError, type InternalApi } from "../src/internal-api.js";
import { silentLogger, type Logger } from "../src/logger.js";
import { MemoryLiveStore } from "../src/store/live-store.js";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface Sent {
  to: readonly string[];
  event: ServerToClientEventName;
  payload: unknown;
}

/** Emisor que solo graba: permite comprobar qué recibió cada jugador sin sockets. */
class RecordingEmitter implements Emitter {
  sent: Sent[] = [];
  emit(to: readonly string[], event: ServerToClientEventName, payload: unknown): void {
    this.sent.push({ to, event, payload });
  }
  of(userId: string, event: ServerToClientEventName): unknown[] {
    return this.sent.filter((s) => s.event === event && s.to.includes(userId)).map((s) => s.payload);
  }
  last(userId: string, event: ServerToClientEventName): any {
    return this.of(userId, event).at(-1);
  }
}

let clock: number;
let emitter: RecordingEmitter;
let store: MemoryLiveStore;
let api: InternalApi;
let service: GameService;

function build(customApi?: InternalApi, logger: Logger = silentLogger): void {
  clock = 1_000_000;
  emitter = new RecordingEmitter();
  store = new MemoryLiveStore();
  api = customApi ?? new DevInternalApi();
  service = new GameService({
    store,
    api,
    emitter,
    logger,
    now: () => clock,
    timing: { resultDeadlineMs: 50 },
  });
}

/** Lleva a dos jugadores hasta una partida activa y devuelve su matchId. */
async function startMatch(): Promise<string> {
  service.onConnected(A);
  service.onConnected(B);
  expect(await service.joinQueue(A, "ana")).toEqual({ ok: true });
  expect(await service.joinQueue(B, "beto")).toEqual({ ok: true });
  service.runMatchmaking();
  const matchId = service.getMatchIdOf(A)!;
  expect(matchId).toBeDefined();
  expect(service.ready(A, matchId)).toEqual({ ok: true });
  expect(service.ready(B, matchId)).toEqual({ ok: true });
  clock += MATCH_RULES.countdownMs;
  service.tick();
  expect(service.getCombatState(matchId)!.status).toBe("active");
  return matchId;
}

describe("GameService", () => {
  beforeEach(() => build());

  it("empareja, cuenta 3-2-1 y avisa a cada jugador de su rival", async () => {
    await service.joinQueue(A, "ana");
    await service.joinQueue(B, "beto");
    expect(emitter.last(A, "matchmaking:queued")).toEqual({ ratingRange: 150 });
    expect(store.queue.size).toBe(2);

    service.runMatchmaking();
    const found = emitter.last(A, "match:found");
    expect(found.you.username).toBe("ana");
    expect(found.rival.username).toBe("beto");
    expect(store.queue.size).toBe(0);
    expect(store.userMatches.get(A)).toBe(found.matchId);

    service.ready(A, found.matchId);
    expect(emitter.of(A, "match:start")).toHaveLength(0);
    service.ready(B, found.matchId);
    expect(emitter.last(B, "match:start")).toMatchObject({
      startsAt: clock + 3_000,
      endsAt: clock + 3_000 + 90_000,
      serverNow: clock,
    });
  });

  it("rechaza doble cola y cola estando en partida", async () => {
    await service.joinQueue(A, "ana");
    expect(await service.joinQueue(A, "ana")).toEqual({ ok: false, code: "ALREADY_QUEUED" });
    await service.joinQueue(B, "beto");
    service.runMatchmaking();
    expect(await service.joinQueue(A, "ana")).toEqual({ ok: false, code: "ALREADY_IN_MATCH" });
  });

  it("un Rayo baja la vida del rival y se avisa a ambos", async () => {
    const matchId = await startMatch();
    const ack = service.castSpell(A, { matchId, castId: "c1", spellId: "lightning", confidence: 0.9 });
    expect(ack).toEqual({ ok: true });
    const resolved = { castId: "c1", casterId: A, spellId: "lightning", outcome: "hit", damage: 10 };
    expect(emitter.last(A, "combat:spell-resolved")).toEqual(resolved);
    expect(emitter.last(B, "combat:spell-resolved")).toEqual(resolved);
    expect(emitter.last(B, "match:state").players[B].hp).toBe(90);
    expect(store.snapshots.get(matchId)!.players[B]!.hp).toBe(90);
  });

  it("un rechazo responde el ack y emite combat:spell-rejected solo al lanzador", async () => {
    const matchId = await startMatch();
    const ack = service.castSpell(A, { matchId, castId: "c1", spellId: "lightning", confidence: 0.5 });
    expect(ack).toEqual({ ok: false, code: "LOW_CONFIDENCE" });
    expect(emitter.last(A, "combat:spell-rejected")).toEqual({ castId: "c1", code: "LOW_CONFIDENCE" });
    expect(emitter.of(B, "combat:spell-rejected")).toHaveLength(0);
  });

  it("no deja actuar sobre una partida ajena", async () => {
    const matchId = await startMatch();
    const intruder = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(service.castSpell(intruder, { matchId, castId: "x", spellId: "lightning", confidence: 1 })).toEqual({
      ok: false,
      code: "MATCH_NOT_ACTIVE",
    });
    expect(service.ready(intruder, matchId)).toEqual({ ok: false, code: "MATCH_NOT_FOUND" });
    expect(service.rejoin(intruder, matchId)).toEqual({ ok: false, code: "MATCH_NOT_FOUND" });
  });

  it("emite match:state 5 veces por segundo", async () => {
    const matchId = await startMatch();
    const before = emitter.of(A, "match:state").length;
    for (let i = 0; i < 10; i++) {
      clock += 100;
      service.tick();
    }
    expect(emitter.of(A, "match:state").length - before).toBe(5);
    expect(service.getCombatState(matchId)!.players[A]!.mana).toBeCloseTo(34);
  });

  it("KO: termina, registra en el api y envía recompensas", async () => {
    const matchId = await startMatch();
    service.getCombatState(matchId)!.players[B]!.hp = 10;
    service.castSpell(A, { matchId, castId: "c1", spellId: "lightning", confidence: 0.9 });
    await service.whenIdle();

    const end = emitter.last(B, "match:end");
    expect(end).toMatchObject({ matchId, winnerId: A, reason: "KO" });
    expect(end.rewards[A]).toMatchObject({ ratingDelta: 25, goldDelta: 50, newRating: 25 });
    expect(end.rewards[B]).toMatchObject({ ratingDelta: 0, goldDelta: 20, newRating: 0 });
    expect(service.getMatchIdOf(A)).toBeUndefined();
    expect(store.userMatches.size).toBe(0);
    // Tras terminar se puede volver a la cola.
    expect(await service.joinQueue(A, "ana")).toEqual({ ok: true });
  });

  it("fin por tiempo: gana quien tenga más vida", async () => {
    const matchId = await startMatch();
    service.castSpell(B, { matchId, castId: "c1", spellId: "lightning", confidence: 0.9 });
    clock += 90_000;
    service.tick();
    await service.whenIdle();
    expect(emitter.last(A, "match:end")).toMatchObject({ winnerId: B, reason: "TIMEOUT" });
  });

  it("abandono: avisa al rival, espera 10 s y da la victoria a quien se queda", async () => {
    const matchId = await startMatch();
    service.onDisconnected(B);
    expect(emitter.last(A, "match:opponent-disconnected")).toEqual({ graceMs: 10_000 });

    clock += 9_999;
    service.tick();
    expect(emitter.of(A, "match:end")).toHaveLength(0);

    clock += 1;
    service.tick();
    await service.whenIdle();
    const end = emitter.last(A, "match:end");
    expect(end).toMatchObject({ matchId, winnerId: A, reason: "ABANDON" });
    expect(end.rewards[A]).toMatchObject({ ratingDelta: 25, goldDelta: 50 });
    expect(end.rewards[B]).toMatchObject({ ratingDelta: 0, goldDelta: 0 });
  });

  it("reconexión dentro de los 10 s: la partida sigue", async () => {
    const matchId = await startMatch();
    service.onDisconnected(B);
    clock += 5_000;
    service.tick();
    service.onConnected(B);
    expect(service.rejoin(B, matchId)).toEqual({ ok: true });
    expect(emitter.last(A, "match:opponent-reconnected")).toEqual({});
    expect(emitter.last(B, "match:found").matchId).toBe(matchId);
    expect(emitter.last(B, "match:start").matchId).toBe(matchId);

    clock += 10_000;
    service.tick();
    expect(service.getCombatState(matchId)!.status).toBe("active");
  });

  it("con dos pestañas, cerrar una no cuenta como desconexión", async () => {
    await startMatch();
    service.onConnected(B);
    service.onDisconnected(B);
    expect(emitter.of(A, "match:opponent-disconnected")).toHaveLength(0);
  });

  it("desconectarse en la cola lo saca de la cola", async () => {
    service.onConnected(A);
    await service.joinQueue(A, "ana");
    service.onDisconnected(A);
    expect(service.isQueued(A)).toBe(false);
    expect(store.queue.size).toBe(0);
  });

  it("si nadie confirma match:ready en 30 s, la partida se cancela", async () => {
    await service.joinQueue(A, "ana");
    await service.joinQueue(B, "beto");
    service.runMatchmaking();
    const matchId = service.getMatchIdOf(A)!;
    service.ready(A, matchId);
    clock += 30_000;
    service.tick();
    await service.whenIdle();
    // A sí estaba listo: B pierde por abandono.
    expect(emitter.last(A, "match:end")).toMatchObject({ winnerId: A, reason: "ABANDON" });
  });

  it("amplía y avisa el margen de rating mientras espera", async () => {
    await service.joinQueue(A, "ana");
    clock += 10_000;
    service.runMatchmaking();
    expect(emitter.last(A, "matchmaking:queued")).toEqual({ ratingRange: 250 });
    clock += 20_000;
    service.runMatchmaking();
    expect(emitter.last(A, "matchmaking:queued")).toEqual({ ratingRange: null });
  });
});

describe("GameService con el api caído", () => {
  // El 404 es el caso que vio Felipe: la ruta del loadout aún no existía y la Arena mostraba
  // "Tu sesión expiró". El JWT ya se validó en el handshake: nunca debe ser UNAUTHORIZED.
  it.each([
    ["404 (ruta o usuario no encontrado)", 404],
    ["500 del api", 500],
    ["timeout o api apagado", null],
  ] as const)("loadout con %s: responde INTERNAL_ERROR, no encola y lo registra", async (_case, status) => {
    const errors: unknown[] = [];
    const broken: InternalApi = {
      getLoadout: async () => {
        throw new InternalApiError("fallo simulado", status);
      },
      recordMatch: async () => {
        throw new InternalApiError("fallo simulado", status);
      },
    };
    build(broken, { ...silentLogger, error: (_message, extra) => errors.push(extra) });
    expect(await service.joinQueue(A, "ana")).toEqual({ ok: false, code: "INTERNAL_ERROR" });
    expect(service.isQueued(A)).toBe(false);
    expect(store.queue.size).toBe(0);
    expect(errors).toEqual([expect.objectContaining({ userId: A, status })]);
    // Tras el fallo puede volver a intentarlo (no queda marcado como "entrando").
    expect(await service.joinQueue(A, "ana")).toEqual({ ok: false, code: "INTERNAL_ERROR" });
  });

  it("si el registro falla, igual envía match:end con recompensas provisionales", async () => {
    const dev = new DevInternalApi();
    const calls: RecordMatchRequest[] = [];
    const failing: InternalApi = {
      getLoadout: (id, name) => dev.getLoadout(id, name),
      recordMatch: async (req): Promise<RecordMatchResponse> => {
        calls.push(req);
        throw new InternalApiError("500", 500);
      },
    };
    build(failing);
    const matchId = await startMatch();
    service.getCombatState(matchId)!.players[A]!.hp = 10;
    service.castSpell(B, { matchId, castId: "c1", spellId: "lightning", confidence: 0.9 });
    await service.whenIdle();

    expect(calls[0]).toMatchObject({ matchId, endReason: "KO", winnerId: B });
    expect(calls[0]!.players).toEqual([
      { userId: A, finalHp: 0, abandoned: false },
      { userId: B, finalHp: 100, abandoned: false },
    ]);
    expect(emitter.last(A, "match:end").rewards[B]).toMatchObject({ ratingDelta: 25 });
  });
});
