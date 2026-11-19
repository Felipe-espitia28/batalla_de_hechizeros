/**
 * Proxy HTTP del balanceador: recibe cada petición del navegador, elige una copia del api con
 * Balancer y le reenvía todo tal cual (método, ruta, cabeceras y cuerpo en flujo). El CORS lo
 * sigue resolviendo el api: aquí no se duplica.
 *
 * - Cada respuesta lleva x-duelo-backend con la copia que contestó (se ve en DevTools → Network).
 * - GET /lb/status muestra la salud y cuántas peticiones atendió cada copia.
 * - Si falla la conexión con una copia, un GET/HEAD se reintenta una vez en otra; un POST nunca
 *   (repetirlo podría comprar o registrar dos veces) y responde 502.
 */
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Backend, Balancer } from "./balancer.js";

/** Un api dormido en Render free tarda ~1 min en despertar: el proxy debe esperarlo. */
const UPSTREAM_TIMEOUT_MS = 90_000;
export const BACKEND_HEADER = "x-duelo-backend";

// Cabeceras de un solo salto (RFC 9110 §7.6.1): no se reenvían entre conexiones.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardableHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name.toLowerCase())) result[name] = value;
  }
  return result;
}

export interface LbServer {
  port: number;
  close(): Promise<void>;
}

export function startServer(balancer: Balancer, port: number, log: (line: string) => void = console.log): Promise<LbServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split(/[?#]/, 1)[0];
    if (path === "/lb/status") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, backends: balancer.status() }));
      return;
    }
    proxy(balancer, req, res, log, new Set());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}

function proxy(
  balancer: Balancer,
  req: IncomingMessage,
  res: ServerResponse,
  log: (line: string) => void,
  tried: Set<Backend>,
): void {
  const backend = balancer.next(tried);
  if (!backend) {
    sendError(res, 502, "Ninguna copia del api respondió. Intenta de nuevo en un momento.");
    log(`[lb] ${req.method} ${req.url} → sin copias disponibles (502)`);
    return;
  }
  tried.add(backend);

  const started = Date.now();
  const target = backend.url;
  const basePath = target.pathname.replace(/\/+$/, "");
  const clientIp = req.socket.remoteAddress ?? "";
  const previousForwarded = req.headers["x-forwarded-for"];

  const headers: IncomingHttpHeaders = {
    ...forwardableHeaders(req.headers),
    host: target.host,
    "x-forwarded-for": previousForwarded ? `${String(previousForwarded)}, ${clientIp}` : clientIp,
    "x-forwarded-host": req.headers.host ?? "",
    "x-forwarded-proto": (req.headers["x-forwarded-proto"] as string | undefined) ?? "http",
  };

  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = send(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: req.method,
      path: `${basePath}${req.url ?? "/"}`,
      headers,
      timeout: UPSTREAM_TIMEOUT_MS,
    },
    (upstreamRes) => {
      backend.served += 1;
      const responseHeaders = { ...forwardableHeaders(upstreamRes.headers), [BACKEND_HEADER]: backend.name };
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      upstreamRes.pipe(res);
      log(`[lb] ${req.method} ${req.url} → ${backend.name} ${upstreamRes.statusCode} ${Date.now() - started} ms`);
    },
  );

  const idempotent = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  let failed = false;
  let clientGone = false;
  const onFailure = (reason: string) => {
    // Si fue el navegador el que se fue, la copia del api no tiene la culpa: no se marca caída.
    if (failed || clientGone) return;
    failed = true;
    balancer.markDown(backend, reason);
    log(`[lb] ${backend.name} falló (${reason})`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // Sin cuerpo que reenviar, un GET/HEAD/OPTIONS se puede repetir en otra copia sin riesgo.
    if (idempotent && tried.size < balancer.backends.length) {
      proxy(balancer, req, res, log, tried);
      return;
    }
    sendError(res, 502, "El api no respondió. Intenta de nuevo en un momento.");
  };

  upstream.on("timeout", () => upstream.destroy(new Error("tiempo de espera agotado")));
  upstream.on("error", (error) => onFailure(error.message));
  // Si el navegador se va (cierra la pestaña), no tiene sentido seguir esperando al api.
  res.on("close", () => {
    if (!res.writableFinished && !failed) {
      clientGone = true;
      upstream.destroy();
    }
  });

  if (idempotent) upstream.end();
  else req.pipe(upstream);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: { code: "BAD_GATEWAY", message } }));
}
