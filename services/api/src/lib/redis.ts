/**
 * Cliente de Redis (Upstash en producción) para la caché del ranking (`dh:ranking`).
 * Opciones recomendadas por el módulo de ranking: con Redis caído, los comandos fallan al instante
 * y el ranking responde desde PostgreSQL, que es la fuente de verdad (sección 8).
 */
import { Redis } from "ioredis";

export function createRedisClient(url: string | undefined): Redis {
  // Sin REDIS_URL (desarrollo sin Upstash): cliente que nunca conecta, para que todo use PostgreSQL.
  const client = url
    ? new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true })
    : new Redis("redis://127.0.0.1:1", {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        lazyConnect: true,
        retryStrategy: () => null,
      });

  let warned = false;
  client.on("error", (error: Error) => {
    // Un solo aviso: ioredis reintenta y llenaría el log con el mismo error.
    if (!warned) {
      warned = true;
      console.warn("[api] Redis no disponible; el ranking usará PostgreSQL:", error.message);
    }
  });
  client.on("ready", () => {
    warned = false;
  });
  if (url) {
    void client.connect().catch(() => {
      // El listener de "error" ya lo registró; seguimos sin caché.
    });
  }
  return client;
}

export type { Redis };
