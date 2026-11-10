/**
 * Módulo de ranking — dueño: Daniel Tapiero. Punto de entrada que monta app.ts.
 *
 * - createRankingRouter(deps): GET /ranking, /ranking/me, /me/matches y POST /internal/matches.
 * - RankingService.rebuildCache(): index.ts la llama al arrancar para reconstruir dh:ranking
 *   desde PostgreSQL (sección 8).
 *
 * PostgreSQL es la fuente de verdad; Redis (dh:ranking) es una copia que se puede perder.
 */
import { Router } from "express";
import type { AppDeps } from "../../app-deps.js";
import { RankingCache } from "./ranking-cache.js";
import { createRankingRoutes } from "./ranking.routes.js";
import { RankingService } from "./ranking-service.js";

export function createRankingRouter({ env, prisma, redis }: AppDeps): Router {
  const service = new RankingService(prisma, new RankingCache(redis));
  return createRankingRoutes({
    service,
    jwtSecret: env.JWT_SECRET,
    internalApiKey: env.INTERNAL_API_KEY,
  });
}

export { RankingCache, RANKING_KEY } from "./ranking-cache.js";
export { RankingService } from "./ranking-service.js";
