/**
 * Rutas del ranking (sección 8):
 *   GET  /ranking?limit=N   top global (sin login: el Remote Ranking lo muestra a cualquiera)
 *   GET  /ranking/me        posición propia (JWT)
 *   GET  /me/matches        historial propio (JWT)
 *   POST /internal/matches  el game-server registra el resultado (x-internal-key)
 *
 * Los errores se lanzan como HttpError y los convierte el errorHandler global de app.ts,
 * igual que en auth y tienda.
 */
import {
  END_REASONS,
  type MatchHistoryResponse,
  type RankingMeResponse,
  type RankingResponse,
  type RecordMatchRequest,
  type RecordMatchResponse,
} from "@duelo/contracts";
import { Router } from "express";
import { z } from "zod";
import { parseOrThrow } from "../../lib/validate.js";
import { getAuth, requireAuth } from "../../middleware/require-auth.js";
import { requireInternalKey } from "../../middleware/require-internal-key.js";
import type { RankingService } from "./ranking-service.js";

export interface RankingRoutesDeps {
  service: RankingService;
  jwtSecret: string;
  internalApiKey: string;
}

const topQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const playerSchema = z.object({
  userId: z.uuid(),
  finalHp: z.number().int().min(0).max(100),
  abandoned: z.boolean(),
});

// Espejo en tiempo de ejecución de `RecordMatchRequest`: los tipos de contracts no validan nada en runtime.
const recordMatchSchema = z.object({
  matchId: z.string().min(1).max(64),
  endReason: z.enum(END_REASONS),
  winnerId: z.uuid().nullable(),
  // Máximo 90 s de partida más la espera de reconexión; 10 min deja margen sin aceptar basura.
  durationMs: z.number().int().min(0).max(600_000),
  startedAt: z.number().int().positive(),
  endedAt: z.number().int().positive(),
  players: z.tuple([playerSchema, playerSchema]),
}) satisfies z.ZodType<RecordMatchRequest>;

export function createRankingRoutes({ service, jwtSecret, internalApiKey }: RankingRoutesDeps): Router {
  const router = Router();
  const auth = requireAuth(jwtSecret);

  router.get("/ranking", async (req, res) => {
    const { limit } = parseOrThrow(topQuery, req.query);
    const body: RankingResponse = { entries: await service.getTop(limit) };
    res.json(body);
  });

  router.get("/ranking/me", auth, async (req, res) => {
    const body: RankingMeResponse = await service.getMe(getAuth(req).userId);
    res.json(body);
  });

  router.get("/me/matches", auth, async (req, res) => {
    const { limit } = parseOrThrow(historyQuery, req.query);
    const body: MatchHistoryResponse = { matches: await service.getHistory(getAuth(req).userId, limit) };
    res.json(body);
  });

  // Idempotente por matchId: 201 la primera vez, 200 con las mismas recompensas en cada reintento.
  router.post("/internal/matches", requireInternalKey(internalApiKey), async (req, res) => {
    const input = parseOrThrow(recordMatchSchema, req.body);
    const { rewards, replayed } = await service.recordMatch(input);
    const body: RecordMatchResponse = { rewards };
    res.status(replayed ? 200 : 201).json(body);
  });

  return router;
}
