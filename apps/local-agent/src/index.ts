/**
 * Punto de entrada del agente local: pnpm --filter @duelo/local-agent start
 * Lee la configuración, levanta el servidor en 127.0.0.1 y abre la ventana del detector.
 */
import { ConfigError, detectorUrl, loadConfig } from "./config.js";
import { launchDetector } from "./launcher.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  let server;
  try {
    server = await startServer(config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new ConfigError(
        `El puerto ${config.port} ya está en uso. ¿Hay otro agente abierto? Ciérralo o cambia AGENT_PORT (y VITE_LOCAL_AGENT_URL de la Arena).`,
      );
    }
    throw error;
  }

  const url = detectorUrl({ port: server.port });
  console.log(`[agente] Agente local escuchando en ${url} (solo este PC)`);
  console.log(`[agente] Orígenes permitidos (shell y Arena): ${config.allowedOrigins.join(", ")}`);
  console.log("[agente] Todo el reconocimiento ocurre aquí: a la Arena solo viajan eventos.");

  if (config.openBrowser) {
    const browser = await launchDetector(url);
    if (browser) console.log(`[agente] Detector abierto en ${browser}.`);
    else console.log(`[agente] No encontré Chrome ni Edge. Abre ${url} en Chrome para usar la cámara.`);
  }

  // Ctrl+C: cerrar el servidor para liberar el puerto antes de salir.
  const shutdown = () => {
    console.log("[agente] Cerrando…");
    server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(`[agente] ${error instanceof ConfigError ? error.message : "No pude arrancar."}`);
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
});
