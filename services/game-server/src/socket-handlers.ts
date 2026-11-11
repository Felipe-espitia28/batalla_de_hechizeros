/**
 * Capa de sockets: valida cada payload, llama al GameService y responde el ack.
 * Nada de reglas de juego aquí. Todo evento cliente → servidor responde
 * `{ ok: true }` o `{ ok: false, code }` (sección 7), incluso si el payload es basura.
 */
import type {
  AckResponse,
  ClientToServerEventName,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@duelo/contracts";
import { SPELL_IDS, ULTIMATE_IDS } from "@duelo/contracts";
import type { Socket } from "socket.io";
import { z } from "zod";
import type { GameService } from "./game-service.js";
import type { Logger } from "./logger.js";

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Sala por usuario: el servidor emite a `user:{id}` y llega a todas sus pestañas. */
export const userRoom = (userId: string) => `user:${userId}`;

const id = z.string().min(1).max(64);
// Los eventos con payload `{}` aceptan cualquier cosa: no hay nada que leer de ellos.
const emptySchema = z.unknown().transform(() => ({}));
const matchRefSchema = z.object({ matchId: id });
const castSpellSchema = z.object({
  matchId: id,
  castId: id,
  spellId: z.enum(SPELL_IDS),
  confidence: z.number().min(0).max(1),
});
const castUltimateSchema = z.object({
  matchId: id,
  castId: id,
  ultimateId: z.enum(ULTIMATE_IDS),
  transcript: z.string().max(200),
});

type Listener = (raw: unknown, ack: unknown) => void;

export function registerHandlers(socket: GameSocket, service: GameService, logger: Logger): void {
  const { userId, username } = socket.data;
  void socket.join(userRoom(userId));
  service.onConnected(userId);

  /**
   * Envuelve un handler: valida con zod, captura excepciones y garantiza una sola respuesta.
   * Si el cliente no manda callback de ack (cliente mal hecho o malicioso) se ignora en silencio.
   */
  function on<S extends z.ZodType>(
    event: ClientToServerEventName,
    schema: S,
    handler: (payload: z.output<S>) => AckResponse | Promise<AckResponse>,
  ): void {
    const listener: Listener = async (raw, ack) => {
      const reply = typeof ack === "function" ? (ack as (r: AckResponse) => void) : () => {};
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        reply({ ok: false, code: "INVALID_PAYLOAD" });
        return;
      }
      try {
        reply(await handler(parsed.data));
      } catch (error) {
        logger.error(`fallo en ${event}`, { userId, error: (error as Error).message });
        reply({ ok: false, code: "INTERNAL_ERROR" });
      }
    };
    // Los tipos de Socket.IO exigen la firma exacta del contrato; aquí se recibe `unknown`
    // a propósito para validar en tiempo de ejecución.
    (socket.on as unknown as (event: string, listener: Listener) => void).call(socket, event, listener);
  }

  on("matchmaking:join", emptySchema, () => service.joinQueue(userId, username));
  on("matchmaking:leave", emptySchema, () => service.leaveQueue(userId));
  on("match:ready", matchRefSchema, (p) => service.ready(userId, p.matchId));
  on("match:rejoin", matchRefSchema, (p) => service.rejoin(userId, p.matchId));
  on("combat:cast-spell", castSpellSchema, (p) => service.castSpell(userId, p));
  on("combat:cast-ultimate", castUltimateSchema, (p) => service.castUltimate(userId, p));
  on("combat:seal-charging", matchRefSchema, (p) => service.sealCharging(userId, p.matchId));
  on("combat:seal-cancel", matchRefSchema, (p) => service.sealCancel(userId, p.matchId));

  socket.on("disconnect", () => service.onDisconnected(userId));
}
