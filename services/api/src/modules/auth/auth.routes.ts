/**
 * Módulo de auth — dueño: Felipe Espitia.
 *   POST /auth/register -> 201 AuthResponse
 *   POST /auth/login    -> 200 AuthResponse
 *   GET  /me            -> 200 MeResponse (requireAuth)
 */
import { Router } from "express";
import type { AuthResponse, MeResponse } from "@duelo/contracts";
import type { AppDeps } from "../../app-deps.js";
import { parseOrThrow } from "../../lib/validate.js";
import { getAuth, requireAuth } from "../../middleware/require-auth.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import { AuthService } from "./auth.service.js";

export function createAuthRouter({ env, prisma }: AppDeps): Router {
  const router = Router();
  const service = new AuthService(prisma, env.JWT_SECRET);

  router.post("/auth/register", async (req, res) => {
    const input = parseOrThrow(registerSchema, req.body);
    const body: AuthResponse = await service.register(input);
    res.status(201).json(body);
  });

  router.post("/auth/login", async (req, res) => {
    const input = parseOrThrow(loginSchema, req.body);
    const body: AuthResponse = await service.login(input);
    res.json(body);
  });

  router.get("/me", requireAuth(env.JWT_SECRET), async (req, res) => {
    const body: MeResponse = await service.getProfile(getAuth(req).userId);
    res.json(body);
  });

  return router;
}
