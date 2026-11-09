/**
 * Protege /internal/* (sección 8): solo el game-server conoce INTERNAL_API_KEY.
 * Uso: router.get("/internal/users/:id/loadout", requireInternalKey(env.INTERNAL_API_KEY), handler)
 */
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { INTERNAL_KEY_HEADER } from "@duelo/contracts";
import { forbidden } from "../lib/http-error.js";

export function requireInternalKey(expectedKey: string): RequestHandler {
  const expected = Buffer.from(expectedKey);
  return (req: Request, _res: Response, next: NextFunction) => {
    const received = Buffer.from(req.header(INTERNAL_KEY_HEADER) ?? "");
    // Comparación en tiempo constante: un "===" filtraría por cuánto tarda cuántos caracteres acertó.
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw forbidden("Clave interna inválida");
    }
    next();
  };
}
