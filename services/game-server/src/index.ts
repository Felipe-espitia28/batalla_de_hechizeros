/**
 * Punto de entrada del game-server (Render: `node dist/index.js`).
 * En local: `pnpm dev:game` desde la raíz, con services/game-server/.env.
 */
import { ConfigError, loadConfig } from "./config.js";
import { DevInternalApi, HttpInternalApi, type InternalApi } from "./internal-api.js";
import { consoleLogger as logger } from "./logger.js";
import { createGameServer } from "./server.js";
import { MemoryLiveStore, RedisLiveStore, type LiveStore } from "./store/live-store.js";

async function main(): Promise<void> {
  const config = loadConfig();

  let store: LiveStore;
  if (config.redisUrl) {
    store = new RedisLiveStore(config.redisUrl, (error) => logger.error("redis", error.message));
  } else {
    logger.warn("REDIS_URL vacío: cola y partidas solo en memoria (modo desarrollo)");
    store = new MemoryLiveStore();
  }
  try {
    await store.init();
  } catch (error) {
    // Redis caído al arrancar no impide jugar: el estado vivo está en memoria.
    logger.error("no se pudo limpiar la cola de Redis al arrancar", (error as Error).message);
  }

  let api: InternalApi;
  if (config.apiInternalUrl) {
    api = new HttpInternalApi({ baseUrl: config.apiInternalUrl, internalKey: config.internalApiKey! });
  } else {
    logger.warn("API_INTERNAL_URL vacío: api simulado con grimorio inicial y rating en memoria (modo desarrollo)");
    api = new DevInternalApi();
  }

  const server = createGameServer({
    jwtSecret: config.jwtSecret,
    allowedOrigins: config.allowedOrigins,
    store,
    api,
    logger,
  });

  server.httpServer.listen(config.port, () => {
    logger.info(`escuchando en el puerto ${config.port}`);
  });

  // Render envía SIGTERM al redesplegar: se terminan de registrar los resultados pendientes.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal}: cerrando`);
    await server.close();
    await store.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    logger.error(error.message);
  } else {
    logger.error("error al arrancar", error);
  }
  process.exit(1);
});
