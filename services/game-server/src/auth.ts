/**
 * Validación del JWT en el handshake del socket (sección 7).
 * Es el mismo token que firma el api (services/api/src/lib/jwt.ts): HS256, `sub` = id del usuario
 * y `username`. Si cambia allí, debe cambiar aquí.
 */
import type { SocketData } from "@duelo/contracts";
import jwt from "jsonwebtoken";

// Fijar el algoritmo evita aceptar tokens con "alg": "none" u otro algoritmo elegido por el cliente.
const ALGORITHM = "HS256" as const;

/** Devuelve los datos del jugador o `null` si el token no sirve (inválido, expirado o mal formado). */
export function verifySocketToken(token: unknown, secret: string): SocketData | null {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
    if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.username !== "string") {
      return null;
    }
    return { userId: payload.sub, username: payload.username };
  } catch {
    // Expirado y firma inválida dan lo mismo al cliente: UNAUTHORIZED y volver al login.
    return null;
  }
}

/** Solo para scripts y tests locales: firma un token igual al del api. */
export function signDevToken(userId: string, username: string, secret: string, expiresInSeconds = 3_600): string {
  return jwt.sign({ username }, secret, { algorithm: ALGORITHM, subject: userId, expiresIn: expiresInSeconds });
}
