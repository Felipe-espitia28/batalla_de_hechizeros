/**
 * Rutas públicas del ranking (sección 8):
 *   GET /ranking?limit=N   top global (sin login: el Remote Ranking lo muestra a cualquiera)
 *   GET /ranking/me        posición propia (JWT)
 *   GET /me/matches        historial propio (JWT)
 */
import type {
  MatchHistoryResponse,
  RankingMeResponse,
  RankingResponse,
} from "@duelo/contracts";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { ApiError, rankingErrorHandler } from "./api-error.js";
import type { RankingService } from "./ranking-service.js";

/**
 * Contrato con el middleware de auth de Felipe: si el JWT es válido deja el id del usuario
 * (claim `sub`) en `res.locals.userId`; si no, responde 401 él mismo.
 */
export interface AuthLocals {
  userId: string;
}

export interface RankingRouterDeps {
  service: RankingService;
  authenticate: RequestHandler;
}

const topQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Parámetros de consulta inválidos.", z.treeifyError(parsed.error));
  }
  return parsed.data;
}

function currentUserId(res: Response): string {
  const userId = (res.locals as Partial<AuthLocals>).userId;
  // Si llega aquí sin userId, el middleware de auth está mal montado: es un error del servidor.
  if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Inicia sesión para ver esta información.");
  return userId;
}

export function createRankingRouter({ service, authenticate }: RankingRouterDeps): Router {
  const router = Router();

  router.get("/ranking", async (req, res) => {
    const { limit } = parseQuery(topQuery, req.query);
    const body: RankingResponse = { entries: await service.getTop(limit) };
    res.json(body);
  });

  router.get("/ranking/me", authenticate, async (_req, res) => {
    const body: RankingMeResponse = await service.getMe(currentUserId(res));
    res.json(body);
  });

  router.get("/me/matches", authenticate, async (req, res) => {
    const { limit } = parseQuery(historyQuery, req.query);
    const body: MatchHistoryResponse = { matches: await service.getHistory(currentUserId(res), limit) };
    res.json(body);
  });

  router.use(rankingErrorHandler);
  return router;
}
