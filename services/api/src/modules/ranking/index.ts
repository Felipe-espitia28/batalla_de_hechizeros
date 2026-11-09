/**
 * Módulo de ranking — dueño: Daniel Tapiero.
 *
 * Rutas que van aquí (sección 8 de CLAUDE.md; tipos en @duelo/contracts, rest.ts):
 *   GET  /ranking            -> RankingResponse        (público)
 *   GET  /ranking/me         -> RankingMeResponse      (requireAuth)
 *   GET  /me/matches         -> MatchHistoryResponse   (requireAuth)
 *   POST /internal/matches   -> RecordMatchResponse    (requireInternalKey; calcula recompensas)
 *
 * También le toca el sorted set `dh:ranking` en Redis (REDIS_URL) y reconstruirlo desde `users`
 * al arrancar si se pierde. El rango se calcula con getRankForRating de @duelo/game-rules.
 *
 * Herramientas disponibles:
 *   - requireAuth(deps.env.JWT_SECRET) y getAuth(req)  -> ../../middleware/require-auth.js
 *   - requireInternalKey(deps.env.INTERNAL_API_KEY)    -> ../../middleware/require-internal-key.js
 *   - parseOrThrow(schema, req.body)                   -> ../../lib/validate.js
 * Se pueden crear más archivos dentro de esta carpeta (ranking.routes.ts, ranking.service.ts…).
 */
import { Router } from "express";
import type { AppDeps } from "../../app-deps.js";

export function createRankingRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
