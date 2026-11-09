/**
 * Configuración desde variables de entorno (sección 10). Ninguna URL ni secreto va en el código.
 *
 * En desarrollo, REDIS_URL y API_INTERNAL_URL son opcionales: sin ellos se usan una cola en memoria
 * y un api simulado, para poder probar el servidor sin Docker ni el api. En producción (Render)
 * son obligatorios y el proceso no arranca si falta alguno: es mejor un deploy fallido
 * que un servidor que acepta partidas sin grimorio validado ni ranking.
 */

export interface Config {
  port: number;
  isProduction: boolean;
  jwtSecret: string;
  redisUrl: string | null;
  apiInternalUrl: string | null;
  internalApiKey: string | null;
  /** `true` = cualquier origen (solo desarrollo). */
  allowedOrigins: string[] | true;
}

export class ConfigError extends Error {}

function read(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Render define RENDER=true en todos sus servicios; NODE_ENV cubre cualquier otro despliegue.
  const isProduction = env.NODE_ENV === "production" || env.RENDER === "true";

  const jwtSecret = read(env, "JWT_SECRET");
  const redisUrl = read(env, "REDIS_URL");
  const apiInternalUrl = read(env, "API_INTERNAL_URL");
  const internalApiKey = read(env, "INTERNAL_API_KEY");
  const origins = read(env, "ALLOWED_ORIGINS");

  const missing: string[] = [];
  if (!jwtSecret) missing.push("JWT_SECRET");
  if (isProduction) {
    if (!redisUrl) missing.push("REDIS_URL");
    if (!apiInternalUrl) missing.push("API_INTERNAL_URL");
    if (!origins) missing.push("ALLOWED_ORIGINS");
  }
  // Con api real siempre hace falta la clave interna, también en local.
  if (apiInternalUrl && !internalApiKey) missing.push("INTERNAL_API_KEY");
  if (missing.length > 0) {
    throw new ConfigError(`Faltan variables de entorno: ${missing.join(", ")} (ver .env.example)`);
  }

  const port = Number(read(env, "PORT") ?? 3001);
  if (!Number.isInteger(port) || port <= 0) throw new ConfigError(`PORT inválido: ${env.PORT}`);

  return {
    port,
    isProduction,
    jwtSecret: jwtSecret!,
    redisUrl,
    apiInternalUrl: apiInternalUrl ? apiInternalUrl.replace(/\/+$/, "") : null,
    internalApiKey,
    allowedOrigins: origins
      ? origins
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : true,
  };
}
