/**
 * Servidor HTTP del agente local, solo en 127.0.0.1.
 *
 * Fase 1 (base, Felipe): sirve la ventana del detector y los archivos de MediaPipe desde
 * dist/detector (así la detección funciona sin internet) y responde GET /health.
 * Fase 2 (Johan): WebSocket en LOCAL_AGENT_EVENTS_PATH que reenvía los mensajes entre el detector
 * y la Arena, validando el Origin contra ALLOWED_ORIGINS (ver docs/plan-agente-local.md).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_HOST, type AgentConfig } from "./config.js";

/** Build de Vite del detector (pnpm run build:detector). */
export const DEFAULT_STATIC_DIR = fileURLToPath(new URL("../dist/detector", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  // MediaPipe compila el .wasm en streaming y eso exige este tipo exacto.
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
};

export interface AgentServerStatus {
  detector: boolean;
  arena: boolean;
}

export interface AgentServer {
  /** Puerto real (útil en las pruebas, que piden el 0). */
  port: number;
  /** Quién está conectado. Johan lo alimenta desde el WebSocket. */
  status: AgentServerStatus;
  close(): Promise<void>;
}

export interface StartServerOptions {
  /** Carpeta con el build del detector; las pruebas usan una temporal. */
  staticDir?: string;
}

export function startServer(
  config: Pick<AgentConfig, "port" | "allowedOrigins">,
  options: StartServerOptions = {},
): Promise<AgentServer> {
  const root = resolve(options.staticDir ?? DEFAULT_STATIC_DIR);
  const status: AgentServerStatus = { detector: false, arena: false };

  const server = createServer((req, res) => {
    handleRequest(req, res, root, status).catch((error: unknown) => {
      console.error("[agente] error al responder", req.url, error);
      if (!res.headersSent) send(res, 500, "Error interno del agente");
      else res.destroy();
    });
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(config.port, AGENT_HOST, () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : config.port;
      resolvePromise({
        port,
        status,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  status: AgentServerStatus,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Método no permitido");
    return;
  }
  const pathname = (req.url ?? "/").split(/[?#]/, 1)[0] || "/";

  if (pathname === "/health") {
    res.writeHead(200, { "content-type": CONTENT_TYPES[".json"]!, "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, ...status }));
    return;
  }

  const file = resolveStaticFile(root, pathname === "/" ? "/index.html" : pathname);
  if (!file) {
    send(res, 404, "No encontrado");
    return;
  }
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    // Sin build no hay detector: mejor un mensaje claro que una página en blanco.
    send(res, 404, pathname === "/" ? "Falta el build del detector: ejecuta pnpm --filter @duelo/local-agent build" : "No encontrado");
    return;
  }

  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/** Ruta dentro de `root`, o null si intenta salirse (../, rutas absolutas codificadas). */
export function resolveStaticFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const file = resolve(join(root, decoded));
  return file === root || file.startsWith(root + sep) ? file : null;
}

function send(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}
