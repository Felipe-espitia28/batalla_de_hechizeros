/**
 * Firma y verificación del JWT. Es el mismo token para REST y para el socket (sección 3),
 * así que el game-server debe verificarlo con el mismo JWT_SECRET, algoritmo y claims.
 */
import jwt from "jsonwebtoken";
import type { JwtClaims, SessionUser } from "@duelo/contracts";
import { HttpError } from "./http-error.js";

// Fijar el algoritmo evita el ataque de cambiar "alg" en la cabecera del token.
const ALGORITHM = "HS256" as const;
// Una semana: cubre los días de pruebas y la sustentación sin pedir login a cada rato.
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export function signAccessToken(user: SessionUser, secret: string): string {
  return jwt.sign({ username: user.username }, secret, {
    algorithm: ALGORITHM,
    subject: user.id,
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

/**
 * Devuelve los claims o lanza HttpError 401. Distingue TOKEN_EXPIRED de UNAUTHORIZED
 * para que el cliente pueda mostrar "tu sesión expiró" en vez de un error genérico.
 */
export function verifyAccessToken(token: string, secret: string): JwtClaims {
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      throw new HttpError(401, "UNAUTHORIZED", "Token inválido");
    }
    return { sub: payload.sub, username: payload.username, iat: payload.iat, exp: payload.exp };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, "TOKEN_EXPIRED", "Tu sesión expiró, vuelve a iniciar sesión");
    }
    throw new HttpError(401, "UNAUTHORIZED", "Token inválido");
  }
}
