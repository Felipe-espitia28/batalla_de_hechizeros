/**
 * Configuración del balanceador desde variables de entorno. Ninguna URL va en el código:
 * las copias del api salen de LB_BACKENDS.
 */

export interface BackendConfig {
  /** Nombre corto para la cabecera x-duelo-backend y los logs: api-1, api-2… */
  name: string;
  url: URL;
}

export interface LbConfig {
  port: number;
  backends: BackendConfig[];
  healthIntervalMs: number;
}

export class ConfigError extends Error {}

function read(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LbConfig {
  const rawBackends = read(env, "LB_BACKENDS");
  if (!rawBackends) {
    throw new ConfigError("Falta LB_BACKENDS: las URLs de las copias del api separadas por coma (ver .env.example).");
  }

  const backends = rawBackends
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map((value, index): BackendConfig => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new ConfigError(`LB_BACKENDS tiene una URL inválida: "${value}".`);
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ConfigError(`LB_BACKENDS: "${value}" debe empezar por http:// o https://.`);
      }
      return { name: `api-${index + 1}`, url };
    });
  // Con una sola copia no hay nada que repartir: es casi seguro un error de configuración.
  if (backends.length < 2) {
    throw new ConfigError("LB_BACKENDS necesita al menos dos copias del api para balancear.");
  }

  // Render inyecta PORT; en local se usa 4100 para no chocar con el api (4000) ni el game-server (3001).
  const port = Number(read(env, "PORT") ?? 4100);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`PORT inválido: ${env.PORT}`);

  const healthIntervalMs = Number(read(env, "LB_HEALTH_INTERVAL_MS") ?? 10_000);
  if (!Number.isInteger(healthIntervalMs) || healthIntervalMs < 1000) {
    throw new ConfigError("LB_HEALTH_INTERVAL_MS debe ser un número entero de al menos 1000.");
  }

  return { port, backends, healthIntervalMs };
}
