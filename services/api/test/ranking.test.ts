import type { RecordMatchRequest } from "@duelo/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { RANKING_KEY } from "../src/ranking/index.js";
import { rankForRating } from "../src/ranking/rank-rules.js";
import { resolveOutcomes, withPositions } from "../src/ranking/ranking-service.js";
import {
  createDeadRedis,
  createTestApp,
  createTestPrisma,
  createTestRedis,
  createUser,
  INTERNAL_KEY,
  resetData,
} from "./helpers.js";

let prisma: PrismaClient;
let redis: Redis;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = createTestRedis();
  await redis.connect();
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  await resetData(prisma, redis);
});

function matchPayload(overrides: Partial<RecordMatchRequest> & Pick<RecordMatchRequest, "players">): RecordMatchRequest {
  const startedAt = Date.UTC(2026, 10, 9, 15, 0, 0);
  return {
    matchId: "m_test01",
    endReason: "KO",
    winnerId: overrides.players[0].userId,
    durationMs: 60_000,
    startedAt,
    endedAt: startedAt + 60_000,
    ...overrides,
  };
}

function postMatch(app: Parameters<typeof request>[0], body: unknown, key: string | null = INTERNAL_KEY) {
  const req = request(app).post("/internal/matches");
  return (key === null ? req : req.set("x-internal-key", key)).send(body as object);
}

// ---------------------------------------------------------------------------
// Reglas puras
// ---------------------------------------------------------------------------

describe("reglas", () => {
  it("calcula los rangos en los bordes de la tabla", () => {
    expect([0, 99, 100, 249, 250, 499, 500, 899, 900, 5000].map(rankForRating)).toEqual([
      "Grado 4", "Grado 4", "Grado 3", "Grado 3", "Grado 2", "Grado 2", "Grado 1", "Grado 1",
      "Grado Especial", "Grado Especial",
    ]);
  });

  it("asigna posiciones de competición con empates", () => {
    const rows = [
      { id: "a", username: "a", rating: 300 },
      { id: "b", username: "b", rating: 200 },
      { id: "c", username: "c", rating: 200 },
      { id: "d", username: "d", rating: 100 },
    ];
    expect(withPositions(rows).map((e) => e.position)).toEqual([1, 2, 2, 4]);
  });

  it("rechaza payloads incoherentes", () => {
    const players = [
      { userId: "11111111-1111-4111-8111-111111111111", finalHp: 0, abandoned: false },
      { userId: "22222222-2222-4222-8222-222222222222", finalHp: 50, abandoned: false },
    ] as RecordMatchRequest["players"];
    expect(() => resolveOutcomes(matchPayload({ players, endReason: "DRAW" }))).toThrow(/DRAW/);
    expect(() => resolveOutcomes(matchPayload({ players, winnerId: null }))).toThrow(/DRAW/);
    expect(() => resolveOutcomes(matchPayload({ players, endReason: "ABANDON" }))).toThrow(/ABANDON/);
    expect(() =>
      resolveOutcomes(matchPayload({ players: [players[0], { ...players[1], abandoned: true }] })),
    ).toThrow(/abandoned/);
  });
});

// ---------------------------------------------------------------------------
// POST /internal/matches
// ---------------------------------------------------------------------------

describe("POST /internal/matches", () => {
  it("exige la clave interna", async () => {
    const { app } = createTestApp(prisma, redis);
    expect((await postMatch(app, {}, null)).status).toBe(401);
    expect((await postMatch(app, {}, "otra-clave")).status).toBe(403);
  });

  it("valida el cuerpo", async () => {
    const { app } = createTestApp(prisma, redis);
    const res = await postMatch(app, { matchId: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("registra una victoria por KO: historial, rating, oro, estadísticas y Redis", async () => {
    const { app } = createTestApp(prisma, redis);
    const felipe = await createUser(prisma, "felipe", 100, 10);
    const johan = await createUser(prisma, "johan", 100, 0);

    const res = await postMatch(
      app,
      matchPayload({
        winnerId: felipe.id,
        players: [
          { userId: felipe.id, finalHp: 40, abandoned: false },
          { userId: johan.id, finalHp: 0, abandoned: false },
        ],
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.rewards[felipe.id]).toEqual({ ratingDelta: 25, goldDelta: 50, newRating: 125, newRank: "Grado 3" });
    expect(res.body.rewards[johan.id]).toEqual({ ratingDelta: -15, goldDelta: 20, newRating: 85, newRank: "Grado 4" });

    const f = await prisma.user.findUniqueOrThrow({ where: { id: felipe.id } });
    const j = await prisma.user.findUniqueOrThrow({ where: { id: johan.id } });
    expect([f.rating, f.gold, f.wins, f.losses]).toEqual([125, 60, 1, 0]);
    expect([j.rating, j.gold, j.wins, j.losses]).toEqual([85, 20, 0, 1]);
    expect(await prisma.matchPlayer.count({ where: { matchId: "m_test01" } })).toBe(2);
    expect(await redis.zscore(RANKING_KEY, felipe.id)).toBe("125");
    expect(await redis.zscore(RANKING_KEY, johan.id)).toBe("85");
  });

  it("nunca deja el rating por debajo de 0 y guarda el delta aplicado", async () => {
    const { app } = createTestApp(prisma, redis);
    const a = await createUser(prisma, "ana", 0);
    const b = await createUser(prisma, "beto", 10);
    const res = await postMatch(
      app,
      matchPayload({
        winnerId: b.id,
        players: [
          { userId: a.id, finalHp: 0, abandoned: false },
          { userId: b.id, finalHp: 70, abandoned: false },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.rewards[a.id]).toMatchObject({ ratingDelta: 0, newRating: 0 });
    const stored = await prisma.matchPlayer.findUniqueOrThrow({
      where: { matchId_userId: { matchId: "m_test01", userId: a.id } },
    });
    expect(stored.ratingDelta).toBe(0);
  });

  it("aplica la economía de empate y de abandono", async () => {
    const { app } = createTestApp(prisma, redis);
    const a = await createUser(prisma, "ana", 50);
    const b = await createUser(prisma, "beto", 50);

    const draw = await postMatch(
      app,
      matchPayload({
        matchId: "m_draw",
        endReason: "DRAW",
        winnerId: null,
        players: [
          { userId: a.id, finalHp: 30, abandoned: false },
          { userId: b.id, finalHp: 30, abandoned: false },
        ],
      }),
    );
    expect(draw.body.rewards[a.id]).toMatchObject({ ratingDelta: 0, goldDelta: 30 });

    const abandon = await postMatch(
      app,
      matchPayload({
        matchId: "m_abandon",
        endReason: "ABANDON",
        winnerId: b.id,
        players: [
          { userId: a.id, finalHp: 80, abandoned: true },
          { userId: b.id, finalHp: 20, abandoned: false },
        ],
      }),
    );
    expect(abandon.body.rewards[a.id]).toEqual({ ratingDelta: -25, goldDelta: 0, newRating: 25, newRank: "Grado 4" });
    expect(abandon.body.rewards[b.id]).toEqual({ ratingDelta: 25, goldDelta: 50, newRating: 75, newRank: "Grado 4" });

    const ua = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect([ua.wins, ua.losses, ua.draws, ua.gold]).toEqual([0, 1, 1, 30]);
  });

  it("es idempotente: el mismo matchId no suma puntos dos veces (secuencial y simultáneo)", async () => {
    const { app } = createTestApp(prisma, redis);
    const a = await createUser(prisma, "ana", 100);
    const b = await createUser(prisma, "beto", 100);
    const body = matchPayload({
      winnerId: a.id,
      players: [
        { userId: a.id, finalHp: 10, abandoned: false },
        { userId: b.id, finalHp: 0, abandoned: false },
      ],
    });

    // Tres envíos a la vez, como haría un game-server que reintenta por timeout.
    const responses = await Promise.all([postMatch(app, body), postMatch(app, body), postMatch(app, body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    for (const r of responses) expect(r.body).toEqual(responses[0]!.body);

    const again = await postMatch(app, body);
    expect(again.status).toBe(200);
    expect(again.body.rewards[a.id]).toMatchObject({ ratingDelta: 25, newRating: 125 });

    const ua = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect([ua.rating, ua.gold, ua.wins]).toEqual([125, 50, 1]);
    expect(await prisma.match.count()).toBe(1);
  });

  it("rechaza un matchId repetido con otros jugadores", async () => {
    const { app } = createTestApp(prisma, redis);
    const [a, b, c] = await Promise.all([createUser(prisma, "ana"), createUser(prisma, "beto"), createUser(prisma, "caro")]);
    const players = (x: string, y: string) =>
      [
        { userId: x, finalHp: 10, abandoned: false },
        { userId: y, finalHp: 0, abandoned: false },
      ] as RecordMatchRequest["players"];
    expect((await postMatch(app, matchPayload({ winnerId: a.id, players: players(a.id, b.id) }))).status).toBe(201);
    expect((await postMatch(app, matchPayload({ winnerId: a.id, players: players(a.id, c.id) }))).status).toBe(409);
  });

  it("responde 404 si un jugador no existe y no deja la partida a medias", async () => {
    const { app } = createTestApp(prisma, redis);
    const a = await createUser(prisma, "ana");
    const ghost = "33333333-3333-4333-8333-333333333333";
    const res = await postMatch(
      app,
      matchPayload({
        winnerId: a.id,
        players: [
          { userId: a.id, finalHp: 10, abandoned: false },
          { userId: ghost, finalHp: 0, abandoned: false },
        ],
      }),
    );
    expect(res.status).toBe(404);
    expect(await prisma.match.count()).toBe(0);
  });

  it("con Redis caído registra igual en PostgreSQL", async () => {
    const dead = createDeadRedis();
    const { app } = createTestApp(prisma, dead);
    const a = await createUser(prisma, "ana", 100);
    const b = await createUser(prisma, "beto", 100);
    const res = await postMatch(
      app,
      matchPayload({
        winnerId: a.id,
        players: [
          { userId: a.id, finalHp: 10, abandoned: false },
          { userId: b.id, finalHp: 0, abandoned: false },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).rating).toBe(125);
    dead.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

describe("GET /ranking, /ranking/me y /me/matches", () => {
  async function seed() {
    const top = await createUser(prisma, "top", 950);
    const mid1 = await createUser(prisma, "mid1", 300);
    const mid2 = await createUser(prisma, "mid2", 300);
    const low = await createUser(prisma, "low", 20);
    return { top, mid1, mid2, low };
  }

  it("arma el top desde Redis tras reconstruir la copia", async () => {
    const { app, ranking } = createTestApp(prisma, redis);
    const { top, low } = await seed();
    await ranking.service.rebuildCache();
    expect(await redis.zcard(RANKING_KEY)).toBe(4);

    const res = await request(app).get("/ranking?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { position: number }) => e.position)).toEqual([1, 2, 2, 4]);
    expect(res.body.entries[0]).toMatchObject({ userId: top.id, username: "top", rating: 950, rank: "Grado Especial" });
    expect(res.body.entries[3]).toMatchObject({ userId: low.id, rank: "Grado 4" });
  });

  it("responde lo mismo desde PostgreSQL con Redis caído", async () => {
    const live = createTestApp(prisma, redis);
    const dead = createDeadRedis();
    const fallback = createTestApp(prisma, dead);
    const { mid2 } = await seed();
    await live.ranking.service.rebuildCache();

    const fromRedis = await request(live.app).get("/ranking");
    const fromPg = await request(fallback.app).get("/ranking");
    expect(fromPg.status).toBe(200);
    expect(fromPg.body).toEqual(fromRedis.body);

    const me = await request(fallback.app).get("/ranking/me").set("x-test-user", mid2.id);
    expect(me.body).toEqual({ position: 2, totalPlayers: 4, rating: 300, rank: "Grado 2" });
    dead.disconnect();
  });

  it("detecta una copia incompleta en Redis y la reconstruye", async () => {
    const { app, ranking } = createTestApp(prisma, redis);
    await seed();
    await ranking.service.rebuildCache();
    // Un usuario nuevo que nunca llegó a Redis (p. ej. registrado con Upstash caído).
    const late = await createUser(prisma, "late", 1000);

    const res = await request(app).get("/ranking");
    expect(res.body.entries[0]).toMatchObject({ userId: late.id, position: 1 });
    await ranking.service.rebuildCache();
    expect(await redis.zscore(RANKING_KEY, late.id)).toBe("1000");
  });

  it("valida limit", async () => {
    const { app } = createTestApp(prisma, redis);
    expect((await request(app).get("/ranking?limit=0")).status).toBe(400);
    expect((await request(app).get("/ranking?limit=abc")).status).toBe(400);
  });

  it("/ranking/me exige sesión, da la posición y 404 si el usuario no existe", async () => {
    const { app, ranking } = createTestApp(prisma, redis);
    const { top, mid1 } = await seed();
    await ranking.service.rebuildCache();
    expect((await request(app).get("/ranking/me")).status).toBe(401);
    expect((await request(app).get("/ranking/me").set("x-test-user", top.id)).body).toEqual({
      position: 1, totalPlayers: 4, rating: 950, rank: "Grado Especial",
    });
    expect((await request(app).get("/ranking/me").set("x-test-user", mid1.id)).body.position).toBe(2);
    const ghost = await request(app).get("/ranking/me").set("x-test-user", "33333333-3333-4333-8333-333333333333");
    expect(ghost.status).toBe(404);
  });

  it("/me/matches devuelve el historial propio, de la más reciente a la más antigua", async () => {
    const { app } = createTestApp(prisma, redis);
    const a = await createUser(prisma, "ana", 100);
    const b = await createUser(prisma, "beto", 100);
    const players = [
      { userId: a.id, finalHp: 40, abandoned: false },
      { userId: b.id, finalHp: 0, abandoned: false },
    ] as RecordMatchRequest["players"];
    const t0 = Date.UTC(2026, 10, 9, 15, 0, 0);
    await postMatch(app, matchPayload({ matchId: "m_1", winnerId: a.id, players, startedAt: t0, endedAt: t0 + 50_000, durationMs: 50_000 }));
    await postMatch(app, matchPayload({ matchId: "m_2", endReason: "DRAW", winnerId: null, players, startedAt: t0 + 60_000, endedAt: t0 + 150_000, durationMs: 90_000 }));

    expect((await request(app).get("/me/matches")).status).toBe(401);
    const res = await request(app).get("/me/matches").set("x-test-user", b.id);
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(2);
    expect(res.body.matches[0]).toMatchObject({ matchId: "m_2", result: "draw", endReason: "DRAW", rival: { id: a.id, username: "ana" } });
    expect(res.body.matches[1]).toEqual({
      matchId: "m_1",
      endReason: "KO",
      result: "loss",
      rival: { id: a.id, username: "ana" },
      ratingDelta: -15,
      goldDelta: 20,
      finalHp: 0,
      durationMs: 50_000,
      endedAt: new Date(t0 + 50_000).toISOString(),
    });
  });
});
