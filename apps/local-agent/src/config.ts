/**
 * Configuración del agente local desde variables de entorno (.env junto a este paquete).
 * Ninguna URL va en el código: los orígenes de la Arena salen de ALLOWED_ORIGINS y el puerto de
 * AGENT_PORT, que debe coincidir con VITE_LOCAL_AGENT_URL de la Arena.
 */

/**
 * Solo la interfaz de loopback: el agente no debe ser alcanzable desde la red local
 * (además, así Windows no pide permiso de firewall). No es una URL de servicio, es una decisión de seguridad.
 */
export const AGENT_HOST = "127.0.0.1";

export interface AgentConfig {
  port: number;
  /** Orígenes de la Arena que pueden abrir el WebSocket (sin barra final). */
  allowedOrigins: string[];
  /** Abrir la ventana del detector al arrancar. */
  openBrowser: boolean;
}

export class ConfigError extends Error {}

function read(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const rawPort = read(env, "AGENT_PORT");
  const rawOrigins = read(env, "ALLOWED_ORIGINS");

  const missing: string[] = [];
  if (!rawPort) missing.push("AGENT_PORT");
  if (!rawOrigins) missing.push("ALLOWED_ORIGINS");
  if (missing.length > 0) {
    throw new ConfigError(
      `Faltan variables de entorno: ${missing.join(", ")}. Copia apps/local-agent/.env.example a .env y rellénalo.`,
    );
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ConfigError(`AGENT_PORT inválido: "${rawPort}". Usa un número entre 1024 y 65535.`);
  }

  const allowedOrigins = rawOrigins!
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    // Un origen es esquema + host (+ puerto); con ruta o sin esquema nunca coincidiría con el header Origin.
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ConfigError(`ALLOWED_ORIGINS tiene un origen inválido: "${origin}".`);
    }
    if (parsed.origin !== origin) {
      throw new ConfigError(`ALLOWED_ORIGINS: "${origin}" debe ser solo esquema y dominio, por ejemplo ${parsed.origin}.`);
    }
  }

  return {
    port,
    allowedOrigins,
    openBrowser: read(env, "AGENT_OPEN_BROWSER")?.toLowerCase() !== "false",
  };
}

/**
 * Dirección del detector en este PC. 127.0.0.1 es contexto seguro para el navegador (la cámara
 * abre sin HTTPS) y, a diferencia de "localhost", no puede resolver a ::1, donde no escuchamos.
 */
export function detectorUrl(config: Pick<AgentConfig, "port">): string {
  return `http://${AGENT_HOST}:${config.port}`;
}
