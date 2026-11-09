import { PrismaPg } from "@prisma/adapter-pg";
import express, { type RequestHandler } from "express";
import { Redis } from "ioredis";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createRankingModule } from "../src/ranking/index.js";
import { TEST_DATABASE_URL, TEST_REDIS_URL } from "./test-env.js";

export const INTERNAL_KEY = "clave-de-prueba";

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) });
}

/** Mismas opciones que se recomiendan en producción: fallar rápido si Redis no responde. */
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

/** Sustituto del middleware JWT de Felipe: el id llega en una cabecera de prueba. */
const fakeAuthenticate: RequestHandler = (req, res, next) => {
  const userId = req.header("x-test-user");
  if (!userId) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sin sesión" } });
    return;
  }
  res.locals["userId"] = userId;
  next();
};

export function createTestApp(prisma: PrismaClient, redis: Redis) {
  const ranking = createRankingModule({ prisma, redis, authenticate: fakeAuthenticate, internalApiKey: INTERNAL_KEY });
  const app = express();
  app.use(express.json());
  app.use(ranking.router);
  app.use(ranking.internalRouter);
  return { app, ranking };
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
