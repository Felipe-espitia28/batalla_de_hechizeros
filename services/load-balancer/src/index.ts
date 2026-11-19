/**
 * Punto de entrada del balanceador del api: pnpm --filter @duelo/load-balancer dev (local) o
 * start (Render). Lee LB_BACKENDS, empieza a revisar la salud de cada copia y abre el puerto.
 */
import { Balancer } from "./balancer.js";
import { ConfigError, loadConfig } from "./config.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const balancer = new Balancer(config.backends, {
    healthIntervalMs: config.healthIntervalMs,
    onHealthChange: (b) => console.log(`[lb] ${b.name} ${b.healthy ? "sana: vuelve a la rotación" : `caída: fuera de la rotación (${b.lastError ?? "sin detalle"})`}`),
  });
  balancer.start();

  const server = await startServer(balancer, config.port);
  console.log(`[lb] balanceador escuchando en el puerto ${server.port}`);
  for (const b of config.backends) console.log(`[lb] ${b.name} → ${b.url.origin}${b.url.pathname.replace(/\/+$/, "")}`);

  // Render manda SIGTERM al redesplegar.
  const shutdown = (signal: string) => {
    console.log(`[lb] ${signal} recibido, cerrando…`);
    balancer.stop();
    server.close().finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(`[lb] ${error instanceof ConfigError ? error.message : "No pude arrancar."}`);
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
});
