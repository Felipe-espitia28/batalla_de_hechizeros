/**
 * Datos en vivo en Redis (sección 8, Redis). Claves con prefijo `dh:`.
 *
 * Decisión de diseño: con una sola instancia del game-server, la fuente de verdad de la cola y de
 * las partidas es la memoria del proceso. Redis es un espejo que se escribe solo en momentos clave
 * (entrar o salir de la cola, crear partida, cada hechizo, fin) y nunca se lee en el ciclo de 1 s
 * ni en el tick de 100 ms. Leer la cola de Redis cada segundo serían ~86 400 comandos al día con el
 * servidor vacío, y Upstash free da 500 000 al mes.
 *
 * Por eso todas las escrituras son "best effort": si Redis falla se registra el error
 * y la partida sigue, porque el estado real está en memoria.
 */
import type { MatchId, MatchState, UserId } from "@duelo/contracts";
import { Redis } from "ioredis";
import type { QueueEntry } from "../matchmaking/pairing.js";

export const REDIS_KEYS = {
  queue: "dh:mm:queue",
  ticket: (userId: UserId) => `dh:mm:ticket:${userId}`,
  match: (matchId: MatchId) => `dh:match:${matchId}`,
  userMatch: (userId: UserId) => `dh:user:${userId}:match`,
} as const;

/** TTL en segundos (tabla de la sección 8). */
export const REDIS_TTL = {
  ticket: 120,
  match: 300,
  userMatch: 300,
} as const;

export interface QueueTicket {
  joinedAt: number;
  /** Grimorio ya validado por el api, en JSON. */
  grimoire: string;
}

export interface LiveStore {
  /** Al arrancar: la cola anterior ya no sirve porque esos sockets se cerraron con el proceso. */
  init(): Promise<void>;
  enqueue(entry: QueueEntry, ticket: QueueTicket): Promise<void>;
  dequeue(userIds: readonly UserId[]): Promise<void>;
  setActiveMatch(userIds: readonly UserId[], matchId: MatchId): Promise<void>;
  clearActiveMatch(userIds: readonly UserId[]): Promise<void>;
  saveSnapshot(state: MatchState): Promise<void>;
  close(): Promise<void>;
}

/** Para desarrollo sin Docker y para los tests: mismas operaciones, en mapas. */
export class MemoryLiveStore implements LiveStore {
  readonly queue = new Map<UserId, number>();
  readonly tickets = new Map<UserId, QueueTicket>();
  readonly userMatches = new Map<UserId, MatchId>();
  readonly snapshots = new Map<MatchId, MatchState>();

  async init(): Promise<void> {
    this.queue.clear();
    this.tickets.clear();
  }

  async enqueue(entry: QueueEntry, ticket: QueueTicket): Promise<void> {
    this.queue.set(entry.userId, entry.rating);
    this.tickets.set(entry.userId, ticket);
  }

  async dequeue(userIds: readonly UserId[]): Promise<void> {
    for (const id of userIds) {
      this.queue.delete(id);
      this.tickets.delete(id);
    }
  }

  async setActiveMatch(userIds: readonly UserId[], matchId: MatchId): Promise<void> {
    for (const id of userIds) this.userMatches.set(id, matchId);
  }

  async clearActiveMatch(userIds: readonly UserId[]): Promise<void> {
    for (const id of userIds) this.userMatches.delete(id);
  }

  async saveSnapshot(state: MatchState): Promise<void> {
    this.snapshots.set(state.matchId, structuredClone(state));
  }

  async close(): Promise<void> {}
}

export class RedisLiveStore implements LiveStore {
  private readonly redis: Redis;

  constructor(url: string, onError: (error: Error) => void) {
    // rediss:// (Upstash) activa TLS solo. Pocos reintentos por comando: si Redis cae,
    // es preferible perder un espejo que bloquear la partida esperando.
    this.redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    // Sin este listener ioredis imprime "Unhandled error event" en cada reintento de conexión.
    this.redis.on("error", onError);
  }

  async init(): Promise<void> {
    await this.redis.del(REDIS_KEYS.queue);
  }

  async enqueue(entry: QueueEntry, ticket: QueueTicket): Promise<void> {
    await this.redis
      .multi()
      .zadd(REDIS_KEYS.queue, entry.rating, entry.userId)
      .hset(REDIS_KEYS.ticket(entry.userId), { joinedAt: String(ticket.joinedAt), grimoire: ticket.grimoire })
      .expire(REDIS_KEYS.ticket(entry.userId), REDIS_TTL.ticket)
      .exec();
  }

  async dequeue(userIds: readonly UserId[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis
      .multi()
      .zrem(REDIS_KEYS.queue, ...userIds)
      .del(...userIds.map(REDIS_KEYS.ticket))
      .exec();
  }

  async setActiveMatch(userIds: readonly UserId[], matchId: MatchId): Promise<void> {
    const tx = this.redis.multi();
    for (const id of userIds) tx.set(REDIS_KEYS.userMatch(id), matchId, "EX", REDIS_TTL.userMatch);
    await tx.exec();
  }

  async clearActiveMatch(userIds: readonly UserId[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.del(...userIds.map(REDIS_KEYS.userMatch));
  }

  async saveSnapshot(state: MatchState): Promise<void> {
    const key = REDIS_KEYS.match(state.matchId);
    // Pipeline (no MULTI): 2 comandos por instantánea en vez de 4.
    await this.redis
      .pipeline()
      .hset(key, {
        status: state.status,
        serverNow: String(state.serverNow),
        endsAt: String(state.endsAt),
        players: JSON.stringify(state.players),
      })
      .expire(key, REDIS_TTL.match)
      .exec();
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
