/**
 * POST /internal/matches — el game-server registra el resultado de una partida (sección 8).
 * Protegido con la cabecera `x-internal-key`. Idempotente por `matchId`:
 *   201 la primera vez, 200 con las mismas recompensas en cada reintento.
 */
import {
  END_REASONS,
  INTERNAL_KEY_HEADER,
  type RecordMatchRequest,
  type RecordMatchResponse,
} from "@duelo/contracts";
import { createHash, timingSafeEqual } from "node:crypto";
import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import { ApiError, rankingErrorHandler, sendApiError } from "./api-error.js";
import type { RankingService } from "./ranking-service.js";

export interface InternalMatchesRouterDeps {
  service: RankingService;
  internalApiKey: string;
}

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

/** Comparación en tiempo constante: un `===` filtraría por tiempos cuántos caracteres coinciden. */
function sameSecret(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function requireInternalKey(internalApiKey: string): RequestHandler {
  if (!internalApiKey) {
    // Fallar al arrancar es mejor que dejar /internal abierto por una variable sin configurar.
    throw new Error("INTERNAL_API_KEY no está configurada");
  }
  return (req, res, next) => {
    const received = req.header(INTERNAL_KEY_HEADER);
    if (!received) {
      sendApiError(res, 401, "UNAUTHORIZED", `Falta la cabecera ${INTERNAL_KEY_HEADER}.`);
      return;
    }
    if (!sameSecret(received, internalApiKey)) {
      sendApiError(res, 403, "FORBIDDEN", "Clave interna inválida.");
      return;
    }
    next();
  };
}

export function createInternalMatchesRouter({ service, internalApiKey }: InternalMatchesRouterDeps): Router {
  const router = Router();

  router.post("/internal/matches", requireInternalKey(internalApiKey), express.json(), async (req, res) => {
    const parsed = recordMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Resultado de partida inválido.", z.treeifyError(parsed.error));
    }
    const { rewards, replayed } = await service.recordMatch(parsed.data);
    const body: RecordMatchResponse = { rewards };
    res.status(replayed ? 200 : 201).json(body);
  });

  router.use(rankingErrorHandler);
  return router;
}
