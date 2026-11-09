/**
 * Módulo de ranking (Daniel). Punto de integración para la base del servidor (Felipe):
 *
 *   const ranking = createRankingModule({ prisma, redis, authenticate, internalApiKey: env.INTERNAL_API_KEY });
 *   app.use(ranking.router);           // GET /ranking, /ranking/me, /me/matches
 *   app.use(ranking.internalRouter);   // POST /internal/matches
 *   await ranking.service.rebuildCache(); // al arrancar: reconstruye dh:ranking desde PostgreSQL
 *   // y tras registrar un usuario: ranking.cache.upsert([{ userId, rating: 0 }])
 *
 * Recomendado para el cliente ioredis: `{ enableOfflineQueue: false, maxRetriesPerRequest: 1 }`,
 * para que con Upstash caído los comandos fallen al instante y se responda desde PostgreSQL.
 */
import type { RequestHandler } from "express";
import type { Redis } from "ioredis";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createInternalMatchesRouter } from "./internal-matches-router.js";
import { RankingCache } from "./ranking-cache.js";
import { createRankingRouter } from "./ranking-router.js";
import { RankingService } from "./ranking-service.js";

export interface RankingModuleDeps {
  prisma: PrismaClient;
  redis: Redis;
  /** Middleware JWT: deja `res.locals.userId` o responde 401. */
  authenticate: RequestHandler;
  internalApiKey: string;
}

export function createRankingModule({ prisma, redis, authenticate, internalApiKey }: RankingModuleDeps) {
  const cache = new RankingCache(redis);
  const service = new RankingService(prisma, cache);
  return {
    cache,
    service,
    router: createRankingRouter({ service, authenticate }),
    internalRouter: createInternalMatchesRouter({ service, internalApiKey }),
  };
}

export type { AuthLocals } from "./ranking-router.js";
export { RankingCache, RANKING_KEY } from "./ranking-cache.js";
export { RankingService } from "./ranking-service.js";
export { rankForRating } from "./rank-rules.js";
