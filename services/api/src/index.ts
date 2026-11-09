/**
 * Punto de entrada: valida el entorno, conecta Prisma y Redis y abre el puerto.
 * En local `pnpm dev:api` carga services/api/.env; en Render las variables vienen del panel.
 */
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { createRedisClient } from "./lib/redis.js";
import { RankingCache, RankingService } from "./ranking/index.js";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const redis = createRedisClient(env.REDIS_URL);
const app = createApp({ env, prisma, redis });

const server = app.listen(env.PORT, () => {
  console.log(`[api] escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

// PostgreSQL es la fuente de verdad del ranking: si dh:ranking se perdió, se reconstruye al arrancar.
// No se espera: el api responde desde PostgreSQL mientras tanto.
new RankingService(prisma, new RankingCache(redis)).rebuildCache().catch((error: unknown) => {
  console.warn("[api] no se pudo reconstruir dh:ranking:", error);
});

// Render manda SIGTERM al redesplegar: se cierran conexiones para no dejar la base colgada.
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} recibido, cerrando…`);
  server.close();
  redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
