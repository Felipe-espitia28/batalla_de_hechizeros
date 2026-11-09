/**
 * Arma la app de Express sin abrir el puerto (eso lo hace index.ts), para poder probarla con supertest.
 *
 * Cada área monta su propio router desde src/modules/<área>/ y no toca los demás archivos:
 *   auth/    -> Felipe (registro, login, GET /me)
 *   shop/    -> Angel  (catálogo, inventario, compra, grimorio, loadout interno)
 *   ranking/ -> Daniel (ranking, historial, registro interno de partidas)
 */
import cors from "cors";
import express, { type Express } from "express";
import type { AppDeps } from "./app-deps.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createRankingRouter } from "./modules/ranking/index.js";
import { createShopRouter } from "./modules/shop/index.js";

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Render pone un proxy delante: sin esto req.ip y req.protocol serían los del proxy.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    cors({
      // Sin Origin (curl, game-server) se permite; desde el navegador solo los orígenes configurados.
      origin: (origin, callback) => {
        callback(null, !origin || deps.env.ALLOWED_ORIGINS.includes(origin));
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  // Para el health check de Render. No consulta la base: Neon se suspende y no debe tumbar el servicio.
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(createAuthRouter(deps));
  app.use(createShopRouter(deps));
  app.use(createRankingRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
