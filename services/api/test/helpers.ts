import { Redis } from "ioredis";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { RankingCache, RankingService } from "../src/modules/ranking/index.js";
import { TEST_DATABASE_URL, TEST_REDIS_URL } from "./test-env.js";

// Valores solo de prueba (no son secretos): cumplen los mínimos de longitud de env.ts.
export const INTERNAL_KEY = "clave-interna-de-prueba";
const JWT_SECRET = "secreto-de-prueba-con-al-menos-32-caracteres";

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL);
}

/** Mismas opciones que src/lib/redis.ts en producción: fallar rápido si Redis no responde. */
export function createTestRedis(url = TEST_REDIS_URL): Redis {
  const redis = new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });
  redis.on("error", () => {
    // Las pruebas de "Redis caído" provocan errores de conexión a propósito.
  });
  return redis;
}

/** Redis que nunca conecta (puerto cerrado), para probar el respaldo en PostgreSQL. */
export function createDeadRedis(): Redis {
  const redis = new Redis("redis://127.0.0.1:1", {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});
  return redis;
}

/**
 * La app real (app.ts), con requireAuth, requireInternalKey y el errorHandler global:
 * así las pruebas cubren también cómo Felipe monta el módulo.
 * `service` es una instancia aparte para que la prueba pueda forzar la reconstrucción de dh:ranking.
 */
export function createTestApp(prisma: PrismaClient, redis: Redis) {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET,
    INTERNAL_API_KEY: INTERNAL_KEY,
  });
  const app = createApp({ env, prisma, redis });
  const service = new RankingService(prisma, new RankingCache(redis, { warn: () => {} }));
  return { app, service };
}

/** Cabecera Authorization con un JWT real para ese usuario. */
export function authAs(userId: string, username = "jugador") {
  return { Authorization: `Bearer ${signAccessToken({ id: userId, username }, JWT_SECRET)}` };
}

export async function resetData(prisma: PrismaClient, redis: Redis | null): Promise<void> {
  await prisma.$executeRawUnsafe("TRUNCATE match_players, matches, users CASCADE");
  if (redis) await redis.flushdb();
}

export function createUser(prisma: PrismaClient, username: string, rating = 0, gold = 0) {
  return prisma.user.create({
    data: { username, email: `${username}@test.local`, passwordHash: "x", rating, gold },
  });
}
