/**
 * Punto de entrada: valida el entorno, conecta Prisma y abre el puerto.
 * En local `pnpm dev:api` carga services/api/.env; en Render las variables vienen del panel.
 */
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const app = createApp({ env, prisma });

const server = app.listen(env.PORT, () => {
  console.log(`[api] escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

// Render manda SIGTERM al redesplegar: se cierran conexiones para no dejar la base colgada.
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} recibido, cerrando…`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
