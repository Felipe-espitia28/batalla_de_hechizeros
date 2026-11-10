/**
 * Integración del módulo de ranking de Daniel (src/ranking/) con la base del api.
 *
 * Su módulo define su propio contrato de autenticación: un middleware que deja `res.locals.userId`
 * o responde el 401 él mismo. Aquí se adapta `requireAuth` a ese contrato sin tocar su código.
 *
 * TODO(Daniel): si mueves tu código a esta carpeta (src/modules/ranking/), este archivo sigue
 * siendo el punto de entrada que monta app.ts.
 */
import { Router, type RequestHandler } from "express";
import type { ApiErrorBody } from "@duelo/contracts";
import type { AppDeps } from "../../app-deps.js";
import { HttpError } from "../../lib/http-error.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { createRankingModule } from "../../ranking/index.js";

/** requireAuth con la forma que espera el ranking: 401 respondido aquí y userId en res.locals. */
function createRankingAuthenticate(jwtSecret: string): RequestHandler {
  const verify = requireAuth(jwtSecret);
  return (req, res, next) => {
    try {
      verify(req, res, () => {
        res.locals["userId"] = req.auth?.userId;
        next();
      });
    } catch (error) {
      if (error instanceof HttpError) {
        const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
        res.status(error.status).json(body);
        return;
      }
      next(error);
    }
  };
}

export function createRankingRouter({ env, prisma, redis }: AppDeps): Router {
  const ranking = createRankingModule({
    prisma,
    redis,
    authenticate: createRankingAuthenticate(env.JWT_SECRET),
    internalApiKey: env.INTERNAL_API_KEY,
  });
  const router = Router();
  router.use(ranking.router);
  router.use(ranking.internalRouter);
  return router;
}
