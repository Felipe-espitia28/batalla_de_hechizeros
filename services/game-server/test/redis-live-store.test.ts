/**
 * RedisLiveStore contra un Redis real: claves, tipos y TTL de la sección 8 de CLAUDE.md.
 *
 * Solo corre si REDIS_TEST_URL está definida (no en CI ni sin Docker):
 *   pnpm db:up
 *   REDIS_TEST_URL=redis://localhost:6379/15 pnpm --filter @duelo/game-server test
 * Usa la base 15 y la vacía antes de cada test: nunca apuntes esto a Upstash.
 */
import type { MatchState } from "@duelo/contracts";
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { REDIS_KEYS, REDIS_TTL, RedisLiveStore } from "../src/store/live-store.js";

const url = process.env.REDIS_TEST_URL;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.skipIf(!url)("RedisLiveStore (Redis real)", () => {
  const redis = new Redis(url!);
  const store = new RedisLiveStore(url!, (error) => {
    throw error;
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.flushdb();
    await store.close();
    await redis.quit();
  });

  it("encola en dh:mm:queue por rating y guarda el ticket con TTL 120 s", async () => {
    await store.enqueue({ userId: A, rating: 120, joinedAt: 5 }, { joinedAt: 5, grimoire: '{"spells":["lightning"]}' });
    expect(await redis.zscore(REDIS_KEYS.queue, A)).toBe("120");
    expect(await redis.ttl(REDIS_KEYS.queue)).toBe(-1);
    expect(await redis.hgetall(REDIS_KEYS.ticket(A))).toEqual({ joinedAt: "5", grimoire: '{"spells":["lightning"]}' });
    expect(await redis.ttl(REDIS_KEYS.ticket(A))).toBe(REDIS_TTL.ticket);

    await store.dequeue([A]);
    expect(await redis.zscore(REDIS_KEYS.queue, A)).toBeNull();
    expect(await redis.exists(REDIS_KEYS.ticket(A))).toBe(0);
  });

  it("marca la partida activa de cada jugador con TTL 300 s y la borra al terminar", async () => {
    await store.setActiveMatch([A, B], "m_1");
    expect(await redis.get(REDIS_KEYS.userMatch(A))).toBe("m_1");
    expect(await redis.ttl(REDIS_KEYS.userMatch(B))).toBe(REDIS_TTL.userMatch);
    await store.clearActiveMatch([A, B]);
    expect(await redis.exists(REDIS_KEYS.userMatch(A), REDIS_KEYS.userMatch(B))).toBe(0);
  });

  it("guarda la instantánea en dh:match:{id} con TTL 300 s", async () => {
    const state: MatchState = {
      matchId: "m_1",
      status: "active",
      serverNow: 1_000,
      endsAt: 91_000,
      players: {
        [A]: {
          hp: 90,
          mana: 20,
          shieldUntil: null,
          effects: [],
          cooldownsUntil: { lightning: 2_500 },
          silencedUntil: null,
          used: { "silence-seal": false, "purple-void": false },
        },
      },
    };
    await store.saveSnapshot(state);
    const hash = await redis.hgetall(REDIS_KEYS.match("m_1"));
    expect(hash).toMatchObject({ status: "active", serverNow: "1000", endsAt: "91000" });
    expect(JSON.parse(hash.players!)).toEqual(state.players);
    expect(await redis.ttl(REDIS_KEYS.match("m_1"))).toBe(REDIS_TTL.match);
  });

  it("init vacía la cola heredada de un arranque anterior", async () => {
    await redis.zadd(REDIS_KEYS.queue, 0, "fantasma");
    await store.init();
    expect(await redis.exists(REDIS_KEYS.queue)).toBe(0);
  });
});
