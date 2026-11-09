/**
 * Orquestación de partidas: cola, emparejamiento, ciclo de vida de cada partida, reconexión,
 * abandono y cierre con el api. Las reglas de combate están en combat/engine.ts; este módulo
 * decide *cuándo* aplicarlas y *a quién* avisar.
 *
 * No conoce Socket.IO: recibe un `Emitter` y devuelve el ack como valor. Así los tests lo
 * ejercitan con un reloj falso y un emisor que solo graba eventos.
 */
import { randomUUID } from "node:crypto";
import type {
  AckResponse,
  CastSpellPayload,
  CastUltimatePayload,
  MatchId,
  MatchReward,
  PlayerSummary,
  RecordMatchRequest,
  ServerToClientEventName,
  ServerToClientEvents,
  SpellId,
  UltimateId,
  UserId,
} from "@duelo/contracts";
import { SPELL_IDS, ULTIMATE_IDS } from "@duelo/contracts";
import { GRIMOIRE_RULES, MATCH_RULES, getRankForRating, getRatingRange, type MatchRules } from "@duelo/game-rules";
import {
  abandonResult,
  advance,
  castSpell,
  castUltimate,
  checkEnd,
  createCombatState,
  finish,
  getOpponentId,
  startCountdown,
  toMatchState,
  type CombatState,
  type MatchResult,
  type PlayerLoadout,
} from "./combat/engine.js";
import { UnknownUserError, computeRewardsLocally, type InternalApi } from "./internal-api.js";
import type { Logger } from "./logger.js";
import { findPairs, type QueueEntry } from "./matchmaking/pairing.js";
import type { LiveStore } from "./store/live-store.js";

export interface Emitter {
  emit<E extends ServerToClientEventName>(
    userIds: readonly UserId[],
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
}

/** Tiempos propios del servidor (no son balance del juego, por eso no están en game-rules). */
export interface GameTiming {
  /** Tick de la partida en memoria (sección 4). */
  tickMs: number;
  /** `match:state` 5 veces por segundo (sección 7). */
  broadcastMs: number;
  /** Ciclo de emparejamiento (sección 4). */
  matchmakingIntervalMs: number;
  /** Si tras `match:found` alguien no envía `match:ready` en este tiempo, pierde por abandono. */
  readyTimeoutMs: number;
  /** Cuánto se espera al api antes de enviar `match:end` con recompensas calculadas aquí. */
  resultDeadlineMs: number;
}

export const DEFAULT_TIMING: GameTiming = {
  tickMs: 100,
  broadcastMs: 200,
  matchmakingIntervalMs: 1_000,
  // Cubre la calibración de cámara de la Arena con margen.
  readyTimeoutMs: 30_000,
  resultDeadlineMs: 5_000,
};

export interface GameServiceDeps {
  store: LiveStore;
  api: InternalApi;
  emitter: Emitter;
  logger: Logger;
  rules?: MatchRules;
  timing?: Partial<GameTiming>;
  now?: () => number;
}

interface QueuedPlayer extends QueueEntry {
  summary: PlayerSummary;
  loadout: PlayerLoadout;
  /** Último margen enviado en `matchmaking:queued`, para avisar solo cuando cambia. */
  lastRangeSent: number | null;
}

interface LiveMatch {
  id: MatchId;
  combat: CombatState;
  summaries: Record<UserId, PlayerSummary>;
  /** Rating al empezar: base de las recompensas provisionales si el api no responde. */
  ratings: Record<UserId, number>;
  ready: Set<UserId>;
  createdAt: number;
  readyDeadline: number;
  /** Quién está desconectado y desde cuándo (espera de 10 s). */
  disconnectedAt: Map<UserId, number>;
  lastBroadcastAt: number;
  /** Ya terminó y se está registrando el resultado: no admite más eventos. */
  ending: boolean;
}

const ok: AckResponse = { ok: true };
const fail = (code: Exclude<AckResponse, { ok: true }>["code"]): AckResponse => ({ ok: false, code });
const sleep = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

export class GameService {
  private readonly store: LiveStore;
  private readonly api: InternalApi;
  private readonly emitter: Emitter;
  private readonly logger: Logger;
  private readonly rules: MatchRules;
  private readonly timing: GameTiming;
  private readonly now: () => number;

  private readonly queue = new Map<UserId, QueuedPlayer>();
  /** Jugadores esperando su loadout del api; salir de la cola o desconectarse los quita. */
  private readonly joining = new Set<UserId>();
  private readonly matches = new Map<MatchId, LiveMatch>();
  private readonly userMatch = new Map<UserId, MatchId>();
  /** Sockets abiertos por usuario: con dos pestañas, cerrar una no es abandonar. */
  private readonly connections = new Map<UserId, number>();
  /** Cierres de partida en curso (llamada al api), para esperarlos en tests y al apagar. */
  private readonly pending = new Set<Promise<unknown>>();
  private timers: NodeJS.Timeout[] = [];

  constructor(deps: GameServiceDeps) {
    this.store = deps.store;
    this.api = deps.api;
    this.emitter = deps.emitter;
    this.logger = deps.logger;
    this.rules = deps.rules ?? MATCH_RULES;
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    this.timers = [
      setInterval(() => this.safely("tick", () => this.tick()), this.timing.tickMs),
      setInterval(() => this.safely("matchmaking", () => this.runMatchmaking()), this.timing.matchmakingIntervalMs),
    ];
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.whenIdle();
  }

  /** Espera a que terminen los registros de resultado pendientes. */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  // -------------------------------------------------------------------------
  // Conexión
  // -------------------------------------------------------------------------

  onConnected(userId: UserId): void {
    this.connections.set(userId, (this.connections.get(userId) ?? 0) + 1);
  }

  onDisconnected(userId: UserId): void {
    const remaining = (this.connections.get(userId) ?? 1) - 1;
    if (remaining > 0) {
      this.connections.set(userId, remaining);
      return;
    }
    this.connections.delete(userId);
    this.joining.delete(userId);
    if (this.queue.delete(userId)) this.mirror("dequeue", this.store.dequeue([userId]));

    const match = this.findMatchOf(userId);
    if (!match || match.ending) return;
    match.disconnectedAt.set(userId, this.now());
    this.emitter.emit([getOpponentId(match.combat, userId)], "match:opponent-disconnected", {
      graceMs: this.rules.reconnectGraceMs,
    });
    this.logger.info("jugador desconectado, esperando reconexión", { matchId: match.id, userId });
  }

  // -------------------------------------------------------------------------
  // Matchmaking
  // -------------------------------------------------------------------------

  async joinQueue(userId: UserId, username: string): Promise<AckResponse> {
    if (this.userMatch.has(userId)) return fail("ALREADY_IN_MATCH");
    if (this.queue.has(userId) || this.joining.has(userId)) return fail("ALREADY_QUEUED");

    this.joining.add(userId);
    let loadout: PlayerLoadout;
    let summary: PlayerSummary;
    try {
      const response = await this.api.getLoadout(userId, username);
      loadout = sanitizeLoadout(userId, response.spells, response.ultimateId);
      summary = {
        id: userId,
        username: response.username,
        rating: response.rating,
        rank: getRankForRating(response.rating),
      };
    } catch (error) {
      this.joining.delete(userId);
      if (error instanceof UnknownUserError) return fail("UNAUTHORIZED");
      // Sin grimorio validado no se juega: nunca se usa uno enviado por el cliente.
      this.logger.error("no se pudo obtener el loadout", { userId, error: (error as Error).message });
      return fail("INTERNAL_ERROR");
    }
    // Si mientras esperaba al api salió de la cola o se desconectó, no se le encola.
    if (!this.joining.delete(userId)) return ok;

    const now = this.now();
    const range = getRatingRange(0);
    const entry: QueuedPlayer = { userId, rating: summary.rating, joinedAt: now, summary, loadout, lastRangeSent: range };
    this.queue.set(userId, entry);
    this.mirror(
      "enqueue",
      this.store.enqueue(entry, { joinedAt: now, grimoire: JSON.stringify({ spells: loadout.spells, ultimateId: loadout.ultimateId }) }),
    );
    this.emitter.emit([userId], "matchmaking:queued", { ratingRange: range });
    return ok;
  }

  leaveQueue(userId: UserId): AckResponse {
    this.joining.delete(userId);
    if (this.queue.delete(userId)) this.mirror("dequeue", this.store.dequeue([userId]));
    // Idempotente: salir sin estar en cola no es un error.
    return ok;
  }

  runMatchmaking(now = this.now()): void {
    for (const [a, b] of findPairs([...this.queue.values()], now)) this.createMatch(a, b, now);

    for (const entry of this.queue.values()) {
      const range = getRatingRange(now - entry.joinedAt);
      if (range !== entry.lastRangeSent) {
        entry.lastRangeSent = range;
        this.emitter.emit([entry.userId], "matchmaking:queued", { ratingRange: range });
      }
    }
  }

  private createMatch(a: QueuedPlayer, b: QueuedPlayer, now: number): void {
    const id: MatchId = `m_${randomUUID()}`;
    const match: LiveMatch = {
      id,
      combat: createCombatState(id, [a.loadout, b.loadout], this.rules),
      summaries: { [a.userId]: a.summary, [b.userId]: b.summary },
      ratings: { [a.userId]: a.rating, [b.userId]: b.rating },
      ready: new Set(),
      createdAt: now,
      readyDeadline: now + this.timing.readyTimeoutMs,
      disconnectedAt: new Map(),
      lastBroadcastAt: 0,
      ending: false,
    };
    const ids = [a.userId, b.userId];
    this.matches.set(id, match);
    for (const userId of ids) {
      this.queue.delete(userId);
      this.userMatch.set(userId, id);
    }
    this.mirror("dequeue", this.store.dequeue(ids));
    this.mirror("setActiveMatch", this.store.setActiveMatch(ids, id));

    this.emitter.emit([a.userId], "match:found", { matchId: id, you: a.summary, rival: b.summary });
    this.emitter.emit([b.userId], "match:found", { matchId: id, you: b.summary, rival: a.summary });
    this.logger.info("partida creada", { matchId: id, players: [a.summary.username, b.summary.username] });
  }

  // -------------------------------------------------------------------------
  // Ciclo de la partida
  // -------------------------------------------------------------------------

  ready(userId: UserId, matchId: MatchId): AckResponse {
    const match = this.findMemberMatch(userId, matchId);
    if (!match) return fail("MATCH_NOT_FOUND");
    // Idempotente: un segundo ready (p. ej. tras reconectar) no reinicia la cuenta regresiva.
    if (match.combat.status !== "waiting") return ok;

    match.ready.add(userId);
    if (match.ready.size === match.combat.playerIds.length) {
      const now = this.now();
      startCountdown(match.combat, now, this.rules);
      this.emitter.emit(match.combat.playerIds, "match:start", {
        matchId,
        startsAt: match.combat.startsAt!,
        endsAt: match.combat.endsAt!,
        serverNow: now,
      });
      this.broadcastState(match, now);
      this.snapshot(match, now);
    }
    return ok;
  }

  rejoin(userId: UserId, matchId: MatchId): AckResponse {
    const match = this.findMemberMatch(userId, matchId);
    if (!match || match.ending) return fail("MATCH_NOT_FOUND");

    const now = this.now();
    const wasDisconnected = match.disconnectedAt.delete(userId);
    const rivalId = getOpponentId(match.combat, userId);
    // Se reenvía todo lo necesario para que la Arena reconstruya la pantalla desde cero.
    this.emitter.emit([userId], "match:found", {
      matchId,
      you: match.summaries[userId]!,
      rival: match.summaries[rivalId]!,
    });
    if (match.combat.startsAt !== null && match.combat.endsAt !== null) {
      this.emitter.emit([userId], "match:start", {
        matchId,
        startsAt: match.combat.startsAt,
        endsAt: match.combat.endsAt,
        serverNow: now,
      });
    }
    this.emitter.emit([userId], "match:state", toMatchState(match.combat, now));
    if (wasDisconnected) {
      this.emitter.emit([rivalId], "match:opponent-reconnected", {});
      this.logger.info("jugador reconectado", { matchId, userId });
    }
    return ok;
  }

  castSpell(userId: UserId, payload: CastSpellPayload): AckResponse {
    const now = this.now();
    const match = this.findMemberMatch(userId, payload.matchId);
    const result =
      match && !match.ending
        ? castSpell(match.combat, userId, payload.spellId, payload.confidence, now, this.rules)
        : ({ ok: false, code: "MATCH_NOT_ACTIVE" } as const);

    if (!result.ok) {
      this.emitter.emit([userId], "combat:spell-rejected", { castId: payload.castId, code: result.code });
      return fail(result.code);
    }
    this.afterResolvedCast(match!, userId, payload.castId, payload.spellId, result.outcome, result.damage, now);
    return ok;
  }

  castUltimate(userId: UserId, payload: CastUltimatePayload): AckResponse {
    const now = this.now();
    const match = this.findMemberMatch(userId, payload.matchId);
    const result =
      match && !match.ending
        ? castUltimate(match.combat, userId, payload.ultimateId, now, this.rules)
        : ({ ok: false, code: "MATCH_NOT_ACTIVE" } as const);

    if (!result.ok) {
      this.emitter.emit([userId], "combat:spell-rejected", { castId: payload.castId, code: result.code });
      return fail(result.code);
    }
    this.afterResolvedCast(match!, userId, payload.castId, payload.ultimateId, result.outcome, result.damage, now);
    return ok;
  }

  /** Sello de silencio (P2): mientras no esté implementado, no está en ningún grimorio. */
  sealEvent(userId: UserId, matchId: MatchId): AckResponse {
    const match = this.findMemberMatch(userId, matchId);
    if (!match || match.ending || match.combat.status !== "active") return fail("MATCH_NOT_ACTIVE");
    // IMPLEMENTED_SPELLS aún no incluye "silence-seal", así que ningún grimorio lo tiene.
    return fail("NOT_IN_GRIMOIRE");
  }

  private afterResolvedCast(
    match: LiveMatch,
    casterId: UserId,
    castId: string,
    spellId: SpellId | UltimateId,
    outcome: Parameters<ServerToClientEvents["combat:spell-resolved"]>[0]["outcome"],
    damage: number,
    now: number,
  ): void {
    this.emitter.emit(match.combat.playerIds, "combat:spell-resolved", { castId, casterId, spellId, outcome, damage });
    // Tras cada hechizo se envía el estado sin esperar al siguiente envío periódico (sección 7).
    this.broadcastState(match, now);
    this.snapshot(match, now);
    const end = checkEnd(match.combat, now);
    if (end) this.endMatch(match, end, now);
  }

  /** Un paso del reloj del servidor para todas las partidas. Público para los tests. */
  tick(now = this.now()): void {
    for (const match of this.matches.values()) {
      if (match.ending) continue;

      if (match.combat.status === "waiting" && now >= match.readyDeadline) {
        this.handleReadyTimeout(match, now);
        continue;
      }

      const abandoner = [...match.disconnectedAt].find(([, since]) => now - since >= this.rules.reconnectGraceMs);
      if (abandoner) {
        this.endMatch(match, abandonResult(match.combat, abandoner[0]), now, abandoner[0]);
        continue;
      }

      advance(match.combat, now, this.rules);
      const end = checkEnd(match.combat, now);
      if (end) {
        this.endMatch(match, end, now);
        continue;
      }

      const live = match.combat.status === "countdown" || match.combat.status === "active";
      if (live && now - match.lastBroadcastAt >= this.timing.broadcastMs) this.broadcastState(match, now);
    }
  }

  private handleReadyTimeout(match: LiveMatch, now: number): void {
    const notReady = match.combat.playerIds.filter((id) => !match.ready.has(id));
    if (notReady.length === 1) {
      // Quien sí estaba listo gana: el otro dejó la partida colgada.
      this.endMatch(match, abandonResult(match.combat, notReady[0]!), now, notReady[0]);
      return;
    }
    // Ninguno confirmó: se cancela sin registrar resultado ni recompensas.
    match.ending = true;
    finish(match.combat);
    this.emitter.emit(match.combat.playerIds, "match:end", {
      matchId: match.id,
      winnerId: null,
      reason: "ABANDON",
      rewards: {},
    });
    this.cleanup(match);
    this.logger.warn("partida cancelada: ningún jugador confirmó", { matchId: match.id });
  }

  private endMatch(match: LiveMatch, result: MatchResult, now: number, abandonerId?: UserId): void {
    if (match.ending) return;
    match.ending = true;
    finish(match.combat);
    this.broadcastState(match, now);
    this.snapshot(match, now);

    const startedAt = Math.min(match.combat.startsAt ?? match.createdAt, now);
    const [a, b] = match.combat.playerIds;
    const playerResult = (userId: UserId) => ({
      userId,
      finalHp: match.combat.players[userId]!.hp,
      abandoned: userId === abandonerId,
    });
    const request: RecordMatchRequest = {
      matchId: match.id,
      endReason: result.reason,
      winnerId: result.winnerId,
      durationMs: now - startedAt,
      startedAt,
      endedAt: now,
      players: [playerResult(a), playerResult(b)],
    };
    this.logger.info("partida terminada", { matchId: match.id, reason: result.reason, winnerId: result.winnerId });
    this.track(this.publishResult(match, request));
  }

  /**
   * Registra el resultado y envía `match:end`. Si el api tarda más que `resultDeadlineMs`
   * (p. ej. Render despertando), los jugadores reciben recompensas calculadas aquí con la misma
   * economía y el registro sigue reintentando en segundo plano: el api es idempotente por matchId.
   */
  private async publishResult(match: LiveMatch, request: RecordMatchRequest): Promise<void> {
    const recording = this.api.recordMatch(request).then((res) => res.rewards);
    this.track(
      recording.catch((error: unknown) =>
        this.logger.error("no se pudo registrar la partida en el api", {
          matchId: match.id,
          error: (error as Error).message,
        }),
      ),
    );

    let rewards: Record<UserId, MatchReward> | null = await Promise.race([
      recording,
      sleep(this.timing.resultDeadlineMs),
    ]).catch(() => null);
    if (!rewards) {
      this.logger.warn("api sin respuesta a tiempo: recompensas provisionales", { matchId: match.id });
      rewards = computeRewardsLocally(request, match.ratings);
    }

    this.emitter.emit(match.combat.playerIds, "match:end", {
      matchId: match.id,
      winnerId: request.winnerId,
      reason: request.endReason,
      rewards,
    });
    this.cleanup(match);
  }

  private cleanup(match: LiveMatch): void {
    this.matches.delete(match.id);
    const ids = match.combat.playerIds.filter((id) => this.userMatch.get(id) === match.id);
    for (const id of ids) this.userMatch.delete(id);
    this.mirror("clearActiveMatch", this.store.clearActiveMatch(ids));
  }

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  private findMatchOf(userId: UserId): LiveMatch | undefined {
    const matchId = this.userMatch.get(userId);
    return matchId ? this.matches.get(matchId) : undefined;
  }

  /** La partida solo si existe y el usuario juega en ella: nadie actúa sobre partidas ajenas. */
  private findMemberMatch(userId: UserId, matchId: MatchId): LiveMatch | undefined {
    const match = this.matches.get(matchId);
    return match && match.combat.players[userId] ? match : undefined;
  }

  private broadcastState(match: LiveMatch, now: number): void {
    match.lastBroadcastAt = now;
    this.emitter.emit(match.combat.playerIds, "match:state", toMatchState(match.combat, now));
  }

  private snapshot(match: LiveMatch, now: number): void {
    this.mirror("snapshot", this.store.saveSnapshot(toMatchState(match.combat, now)));
  }

  /** Escritura en Redis "best effort": se registra el fallo y la partida sigue (ver live-store.ts). */
  private mirror(label: string, operation: Promise<unknown>): void {
    operation.catch((error: unknown) => this.logger.warn(`redis ${label} falló`, (error as Error).message));
  }

  private track(promise: Promise<unknown>): void {
    const tracked = promise.finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  /** Un error en un tick no debe tumbar el proceso ni las demás partidas. */
  private safely(label: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.error(`error en ${label}`, error);
    }
  }

  // Consultas para tests y scripts.
  isQueued(userId: UserId): boolean {
    return this.queue.has(userId);
  }

  getMatchIdOf(userId: UserId): MatchId | undefined {
    return this.userMatch.get(userId);
  }

  getCombatState(matchId: MatchId): Readonly<CombatState> | undefined {
    return this.matches.get(matchId)?.combat;
  }
}

/**
 * El api es de confianza, pero un id desconocido (p. ej. un hechizo nuevo en la base antes que
 * en el código) no debe romper la partida: se descarta. Rayo y Escudo siempre están.
 */
function sanitizeLoadout(userId: UserId, spells: readonly string[], ultimateId: string): PlayerLoadout {
  const valid = spells.filter((id): id is SpellId => (SPELL_IDS as readonly string[]).includes(id));
  const withFixed = [...new Set<SpellId>([...GRIMOIRE_RULES.fixedSpellIds, ...valid])];
  const ultimate = (ULTIMATE_IDS as readonly string[]).includes(ultimateId)
    ? (ultimateId as UltimateId)
    : GRIMOIRE_RULES.defaultUltimateId;
  return { userId, spells: withFixed, ultimateId: ultimate };
}
