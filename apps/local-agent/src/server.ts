/**
 * Servidor HTTP del agente local, solo en 127.0.0.1.
 *
 * Fase 1 (base, Felipe): sirve la ventana del detector y los archivos de MediaPipe desde
 * dist/detector (así la detección funciona sin internet) y responde GET /health.
 * Fase 2 (Johan): WebSocket en LOCAL_AGENT_EVENTS_PATH que reenvía los mensajes entre el detector
 * y la Arena, validando el Origin contra ALLOWED_ORIGINS y el origen del propio detector
 * (ver docs/plan-agente-local.md). Máximo un cliente por rol; el agente solo enruta eventos,
 * no los interpreta.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_AGENT_EVENTS_PATH,
  LOCAL_AGENT_PROTOCOL_VERSION,
  LOCAL_AGENT_SENDERS,
  parseLocalAgentMessage,
  type AgentPeerMessage,
  type LocalAgentMessage,
  type LocalAgentRole,
} from "@duelo/contracts";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { AGENT_HOST, detectorUrl, type AgentConfig } from "./config.js";

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
  /** Tiempo para que llegue agent:hello tras conectar. Las pruebas lo acortan. */
  helloTimeoutMs?: number;
  /** Cada cuánto se hace ping; un socket que no respondió el anterior se termina. */
  pingIntervalMs?: number;
}

/** Códigos de cierre propios (4000–4999 es el rango libre para aplicaciones). */
export const AGENT_CLOSE_CODES = {
  /** El primer mensaje no fue un agent:hello válido. */
  BAD_HELLO: 4000,
  /** Llegó otro cliente con el mismo rol y este quedó fuera. */
  REPLACED: 4001,
  /** No llegó agent:hello a tiempo. */
  HELLO_TIMEOUT: 4002,
  /** El cliente habla otra versión del protocolo. */
  PROTOCOL_VERSION: 4003,
} as const;

/** Solo viajan eventos pequeños: un mensaje grande es un error o un abuso. */
const MAX_PAYLOAD_BYTES = 4 * 1024;
const DEFAULT_HELLO_TIMEOUT_MS = 5_000;
const DEFAULT_PING_INTERVAL_MS = 10_000;

const ROLES: readonly LocalAgentRole[] = ["detector", "arena"];

interface ClientState {
  role: LocalAgentRole | null;
  origin: string;
  /** Respondió al último ping. */
  alive: boolean;
}

export function startServer(
  config: Pick<AgentConfig, "port" | "allowedOrigins">,
  options: StartServerOptions = {},
): Promise<AgentServer> {
  const root = resolve(options.staticDir ?? DEFAULT_STATIC_DIR);
  const helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const status: AgentServerStatus = { detector: false, arena: false };

  const server = createServer((req, res) => {
    handleRequest(req, res, root, status).catch((error: unknown) => {
      console.error("[agente] error al responder", req.url, error);
      if (!res.headersSent) send(res, 500, "Error interno del agente");
      else res.destroy();
    });
  });

  // noServer: el upgrade lo decidimos nosotros, así un origen no permitido nunca llega a
  // completarse como WebSocket (se responde 403 en el handshake).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const clients = new Map<WebSocket, ClientState>();
  const peers: Record<LocalAgentRole, WebSocket | null> = { detector: null, arena: null };
  // Se completa al escuchar: con el puerto 0 de las pruebas el origen del detector no se sabe antes.
  let allowedOrigins = new Set<string>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url ?? "/").split(/[?#]/, 1)[0];
    if (pathname !== LOCAL_AGENT_EVENTS_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    // Sin Origin no es un navegador: ni la Arena ni el detector, así que se rechaza.
    const origin = req.headers.origin ?? "";
    if (!allowedOrigins.has(origin)) {
      console.warn(`[agente] conexión rechazada desde ${origin || "(sin Origin)"}: no está en ALLOWED_ORIGINS`);
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, origin));
  });

  function onConnection(ws: WebSocket, origin: string): void {
    const state: ClientState = { role: null, origin, alive: true };
    clients.set(ws, state);

    const helloTimer = setTimeout(() => {
      ws.close(AGENT_CLOSE_CODES.HELLO_TIMEOUT, "No llegó agent:hello a tiempo");
    }, helloTimeoutMs);

    ws.on("pong", () => {
      state.alive = true;
    });

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        console.warn("[agente] mensaje binario ignorado: el protocolo es solo JSON");
        return;
      }
      const raw = rawToString(data);
      const message = parseLocalAgentMessage(raw);

      if (state.role === null) {
        clearTimeout(helloTimer);
        onHello(ws, state, message);
        return;
      }
      if (!message) {
        console.warn(`[agente] mensaje no reconocido de ${state.role}, ignorado`);
        return;
      }
      forward(state.role, message, raw);
    });

    ws.on("error", (error) => {
      // Por ejemplo, un mensaje mayor que maxPayload: ws cierra el socket con 1009 tras esto.
      console.warn(`[agente] error en el socket de ${state.role ?? "cliente sin hello"}: ${error.message}`);
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      clients.delete(ws);
      const role = state.role;
      // Si lo reemplazó una conexión nueva, el puesto ya es de la nueva: no se libera.
      if (role && peers[role] === ws) {
        peers[role] = null;
        console.log(`[agente] ${role} desconectad${role === "arena" ? "a" : "o"}`);
        updatePeers();
      }
    });
  }

  function onHello(ws: WebSocket, state: ClientState, message: LocalAgentMessage | null): void {
    if (message?.type !== "agent:hello" || !ROLES.includes(message.role)) {
      ws.close(AGENT_CLOSE_CODES.BAD_HELLO, "El primer mensaje debe ser agent:hello con role detector o arena");
      return;
    }
    if (message.protocolVersion !== LOCAL_AGENT_PROTOCOL_VERSION) {
      console.warn(
        `[agente] ${message.role} con protocolo ${String(message.protocolVersion)} rechazado (el agente usa ${LOCAL_AGENT_PROTOCOL_VERSION})`,
      );
      ws.close(
        AGENT_CLOSE_CODES.PROTOCOL_VERSION,
        `Versión de protocolo distinta: el agente usa ${LOCAL_AGENT_PROTOCOL_VERSION}. Actualiza el agente o la Arena`,
      );
      return;
    }

    const role = message.role;
    const previous = peers[role];
    state.role = role;
    peers[role] = ws;
    if (previous) {
      console.log(`[agente] ${role} reemplazad${role === "arena" ? "a" : "o"} por una conexión nueva`);
      previous.close(AGENT_CLOSE_CODES.REPLACED, "Reemplazado por una conexión nueva");
    }
    console.log(role === "arena" ? `[agente] arena conectada desde ${state.origin}` : "[agente] detector conectado");
    updatePeers();
  }

  function forward(from: LocalAgentRole, message: LocalAgentMessage, raw: string): void {
    // hello y peer no son de ningún rol ("any"/"server"), así que esta misma regla los descarta.
    if (LOCAL_AGENT_SENDERS[message.type] !== from) {
      console.warn(`[agente] ${message.type} enviado por ${from} ignorado: no le corresponde`);
      return;
    }
    const to: LocalAgentRole = from === "detector" ? "arena" : "detector";
    const target = peers[to];
    const delivered = target?.readyState === WebSocket.OPEN;
    // Se reenvía el texto tal cual: el agente no reinterpreta los eventos, solo los enruta.
    if (delivered) target.send(raw);
    console.log(`[agente] ${describe(message)} → ${to}${delivered ? "" : " (no conectado, descartado)"}`);
  }

  function updatePeers(): void {
    status.detector = peers.detector !== null;
    status.arena = peers.arena !== null;
    const peer: AgentPeerMessage = { type: "agent:peer", detector: status.detector, arena: status.arena };
    const text = JSON.stringify(peer);
    for (const ws of Object.values(peers)) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(text);
    }
  }

  // Un cliente que no contesta (pestaña congelada, PC suspendido) dejaría su rol ocupado.
  const pingTimer = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.alive) {
        console.warn(`[agente] ${state.role ?? "cliente"} no respondió al ping, se cierra`);
        ws.terminate();
        continue;
      }
      state.alive = false;
      ws.ping();
    }
  }, pingIntervalMs);
  // No mantiene vivo el proceso por sí solo (Ctrl+C y las pruebas terminan sin esperar).
  pingTimer.unref();

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(config.port, AGENT_HOST, () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : config.port;
      allowedOrigins = new Set([...config.allowedOrigins, detectorUrl({ port })]);
      resolvePromise({
        port,
        status,
        close: () =>
          new Promise<void>((done, fail) => {
            clearInterval(pingTimer);
            // Los sockets ya actualizados no los cierra closeAllConnections: hay que terminarlos.
            for (const ws of clients.keys()) ws.terminate();
            wss.close();
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}

/** Responde al handshake con un error HTTP y corta el socket, sin aceptar el WebSocket. */
function rejectUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  socket.end(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

/**
 * Texto corto para la consola de la demo. Los campos no están validados (el agente solo
 * enruta), así que se formatean sin suponer su tipo.
 */
function describe(message: LocalAgentMessage): string {
  switch (message.type) {
    case "agent:spell":
      return `${String(message.spellId)} ${formatConfidence(message.confidence)}`;
    case "agent:spell-failed":
      return `hechizo fallido (${String(message.bestGuess ?? "sin parecido")} ${formatConfidence(message.confidence)})`;
    case "agent:ultimate":
      return `definitivo ${String(message.ultimateId)}`;
    case "agent:error":
      return `error ${String(message.code)}${message.fatal ? " (fatal)" : ""}`;
    case "agent:status":
      return `estado cámara=${String(message.camera)} mano=${message.handVisible ? "sí" : "no"} mic=${message.micReady ? "sí" : "no"}`;
    default:
      // agent:config y los del sello: con el tipo basta.
      return message.type;
  }
}

function formatConfidence(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "?";
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
