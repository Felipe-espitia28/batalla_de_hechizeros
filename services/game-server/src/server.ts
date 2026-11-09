/**
 * Arma el servidor: HTTP (con /health para Render), Socket.IO con JWT en el handshake
 * y el GameService. Separado de index.ts para que los tests levanten un servidor real
 * en un puerto libre con dependencias en memoria.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from "@duelo/contracts";
import { SOCKET_UNAUTHORIZED } from "@duelo/contracts";
import type { MatchRules } from "@duelo/game-rules";
import { Server } from "socket.io";
import { verifySocketToken } from "./auth.js";
import { GameService, type Emitter, type GameTiming } from "./game-service.js";
import type { InternalApi } from "./internal-api.js";
import type { Logger } from "./logger.js";
import { registerHandlers, userRoom } from "./socket-handlers.js";
import type { LiveStore } from "./store/live-store.js";

export interface GameServerOptions {
  jwtSecret: string;
  allowedOrigins: string[] | true;
  store: LiveStore;
  api: InternalApi;
  logger: Logger;
  rules?: MatchRules;
  timing?: Partial<GameTiming>;
}

export interface GameServer {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  service: GameService;
  close(): Promise<void>;
}

export function createGameServer(options: GameServerOptions): GameServer {
  const httpServer = createServer((req, res) => {
    // Socket.IO atiende /socket.io/ antes de llegar aquí; esto solo responde el resto.
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end();
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: { origin: options.allowedOrigins },
  });

  const emitter: Emitter = {
    emit(userIds, event, payload) {
      if (userIds.length === 0) return;
      // Los genéricos de Socket.IO no aceptan un nombre de evento variable; el tipo ya lo
      // garantiza la firma de Emitter.
      (io.to(userIds.map(userRoom)).emit as (event: string, payload: unknown) => boolean)(event, payload);
    },
  };

  const service = new GameService({
    store: options.store,
    api: options.api,
    emitter,
    logger: options.logger,
    ...(options.rules ? { rules: options.rules } : {}),
    ...(options.timing ? { timing: options.timing } : {}),
  });

  // Middleware del handshake: sin JWT válido no hay conexión (connect_error "UNAUTHORIZED").
  io.use((socket, next) => {
    const data = verifySocketToken((socket.handshake.auth as { token?: unknown } | undefined)?.token, options.jwtSecret);
    if (!data) {
      next(new Error(SOCKET_UNAUTHORIZED));
      return;
    }
    socket.data = data;
    next();
  });

  io.on("connection", (socket) => registerHandlers(socket, service, options.logger));
  service.start();

  return {
    httpServer,
    io,
    service,
    async close() {
      await service.stop();
      // io.close también cierra el servidor HTTP.
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
