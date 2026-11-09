/**
 * Middleware JWT reutilizable por todos los módulos (auth, tienda, ranking).
 * Uso: router.get("/me/inventory", requireAuth(env.JWT_SECRET), handler) y luego getAuth(req).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { UserId } from "@duelo/contracts";
import { unauthorized } from "../lib/http-error.js";
import { verifyAccessToken } from "../lib/jwt.js";

export interface AuthContext {
  userId: UserId;
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(jwtSecret: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw unauthorized();
    }
    const claims = verifyAccessToken(header.slice("Bearer ".length).trim(), jwtSecret);
    req.auth = { userId: claims.sub, username: claims.username };
    next();
  };
}

/** Para handlers detrás de requireAuth: evita repetir el chequeo de `req.auth` en cada ruta. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw unauthorized();
  }
  return req.auth;
}
