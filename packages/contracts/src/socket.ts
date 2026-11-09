/**
 * Contrato del socket (sección 7 de CLAUDE.md).
 *
 * Los mapas `ClientToServerEvents` y `ServerToClientEvents` siguen la forma que espera Socket.IO,
 * así que se usan tal cual:
 *   servidor: new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>()
 *   cliente:  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, { auth })
 */
import type {
  AnySpellId,
  CastId,
  EpochMs,
  MatchId,
  PlayerSummary,
  RankName,
  SpellId,
  UltimateId,
  UserId,
} from "./common.js";

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

/** Lo que el cliente pasa en `io(url, { auth })`. */
export interface SocketAuth {
  token: string;
}

/** Mensaje del `connect_error` cuando el middleware rechaza el JWT. */
export const SOCKET_UNAUTHORIZED = "UNAUTHORIZED" as const;

/** Lo que el middleware de auth deja en `socket.data` tras validar el JWT. */
export interface SocketData {
  userId: UserId;
  username: string;
}

/** Una sola instancia del game-server: no hay eventos entre servidores. */
export type InterServerEvents = Record<string, never>;

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------

/** Rechazos de combate (sección 7). */
export const REJECTION_CODES = [
  "NO_MANA",
  "COOLDOWN",
  "SILENCED",
  "NOT_IN_GRIMOIRE",
  "RATE_LIMIT",
  "LOW_CONFIDENCE",
  "REQUIREMENT_NOT_MET",
  "ALREADY_USED",
  "MATCH_NOT_ACTIVE",
  "SEAL_NOT_CHARGED",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

/**
 * Errores de protocolo que no son de combate (matchmaking, rejoin, payload mal formado).
 * Ampliación de la sección 7: sin ellos el ack de `matchmaking:join` o `match:rejoin`
 * no tendría cómo decir por qué falló.
 */
export const PROTOCOL_ERROR_CODES = [
  "UNAUTHORIZED",
  "INVALID_PAYLOAD",
  "ALREADY_QUEUED",
  "ALREADY_IN_MATCH",
  "MATCH_NOT_FOUND",
  "INTERNAL_ERROR",
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export type AckErrorCode = RejectionCode | ProtocolErrorCode;

/** Todo evento cliente → servidor responde con este ack. */
export type AckResponse = { ok: true } | { ok: false; code: AckErrorCode };
export type Ack = (response: AckResponse) => void;

export const END_REASONS = ["KO", "TIMEOUT", "DRAW", "ABANDON"] as const;
export type EndReason = (typeof END_REASONS)[number];

// ---------------------------------------------------------------------------
// Payloads cliente → servidor
// ---------------------------------------------------------------------------

export type MatchmakingJoinPayload = Record<string, never>;
export type MatchmakingLeavePayload = Record<string, never>;

export interface MatchReadyPayload {
  matchId: MatchId;
}

export interface MatchRejoinPayload {
  matchId: MatchId;
}

/** Solo viaja el resultado del reconocedor local: nunca video ni audio (restricción de R2). */
export interface CastSpellPayload {
  matchId: MatchId;
  castId: CastId;
  spellId: SpellId;
  /** 0..1. El servidor rechaza con LOW_CONFIDENCE por debajo de 0,80. */
  confidence: number;
}

export interface CastUltimatePayload {
  matchId: MatchId;
  castId: CastId;
  ultimateId: UltimateId;
  /** Texto reconocido por Web Speech; el servidor lo normaliza (minúsculas, sin tildes) y lo valida. */
  transcript: string;
}

export interface SealChargingPayload {
  matchId: MatchId;
}

export interface SealCancelPayload {
  matchId: MatchId;
}

// ---------------------------------------------------------------------------
// Estado de la partida
// ---------------------------------------------------------------------------

export type MatchStatus = "waiting" | "countdown" | "active" | "ended";

/** Efectos que se aplican sobre un jugador con duración. El silencio va aparte en `silencedUntil`. */
export type EffectType = "burn" | "poison" | "freeze" | "storm";

export interface ActiveEffect {
  type: EffectType;
  until: EpochMs;
}

export interface PlayerState {
  hp: number;
  mana: number;
  shieldUntil: EpochMs | null;
  effects: ActiveEffect[];
  /** Solo aparecen los hechizos en cooldown. */
  cooldownsUntil: Partial<Record<AnySpellId, EpochMs>>;
  silencedUntil: EpochMs | null;
  /** Hechizos de un solo uso por partida. */
  used: {
    "silence-seal": boolean;
    "purple-void": boolean;
  };
}

/** `match:state`: estado completo, 5 veces por segundo y tras cada hechizo. */
export interface MatchState {
  matchId: MatchId;
  status: MatchStatus;
  serverNow: EpochMs;
  endsAt: EpochMs;
  players: Record<UserId, PlayerState>;
}

// ---------------------------------------------------------------------------
// Payloads servidor → cliente
// ---------------------------------------------------------------------------

export interface MatchmakingQueuedPayload {
  /** Margen actual de rating (±). `null` = tras 30 s se acepta cualquier rival. */
  ratingRange: number | null;
}

export interface MatchFoundPayload {
  matchId: MatchId;
  you: PlayerSummary;
  rival: PlayerSummary;
}

export interface MatchStartPayload {
  matchId: MatchId;
  startsAt: EpochMs;
  endsAt: EpochMs;
  serverNow: EpochMs;
}

/**
 * Qué pasó con un hechizo aceptado:
 * - `hit`: llegó al rival (daño y/o efecto).
 * - `blocked`: el escudo lo absorbió por completo.
 * - `reduced`: el escudo redujo el daño a la mitad (Meteoro, Vacío púrpura).
 * - `self`: efecto sobre el propio lanzador (Escudo, Curación, Renacer).
 */
export type SpellOutcome = "hit" | "blocked" | "reduced" | "self";

export interface SpellResolvedPayload {
  castId: CastId;
  casterId: UserId;
  spellId: AnySpellId;
  outcome: SpellOutcome;
  /** Daño inmediato aplicado (0 si no hubo). Los daños por segundo llegan por `match:state`. */
  damage: number;
}

export interface SpellRejectedPayload {
  castId: CastId;
  code: RejectionCode;
}

export interface SealWarningPayload {
  byPlayerId: UserId;
}

export interface OpponentDisconnectedPayload {
  /** Tiempo de gracia para reconectar (10 s). */
  graceMs: number;
}

export type OpponentReconnectedPayload = Record<string, never>;

export interface MatchReward {
  ratingDelta: number;
  goldDelta: number;
  newRating: number;
  newRank: RankName;
}

export interface MatchEndPayload {
  matchId: MatchId;
  /** `null` en empate. */
  winnerId: UserId | null;
  reason: EndReason;
  rewards: Record<UserId, MatchReward>;
}

// ---------------------------------------------------------------------------
// Mapas de eventos para Socket.IO
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  "matchmaking:join": (payload: MatchmakingJoinPayload, ack: Ack) => void;
  "matchmaking:leave": (payload: MatchmakingLeavePayload, ack: Ack) => void;
  "match:ready": (payload: MatchReadyPayload, ack: Ack) => void;
  "match:rejoin": (payload: MatchRejoinPayload, ack: Ack) => void;
  "combat:cast-spell": (payload: CastSpellPayload, ack: Ack) => void;
  "combat:cast-ultimate": (payload: CastUltimatePayload, ack: Ack) => void;
  "combat:seal-charging": (payload: SealChargingPayload, ack: Ack) => void;
  "combat:seal-cancel": (payload: SealCancelPayload, ack: Ack) => void;
}

export interface ServerToClientEvents {
  "matchmaking:queued": (payload: MatchmakingQueuedPayload) => void;
  "match:found": (payload: MatchFoundPayload) => void;
  "match:start": (payload: MatchStartPayload) => void;
  "match:state": (payload: MatchState) => void;
  "combat:spell-resolved": (payload: SpellResolvedPayload) => void;
  "combat:spell-rejected": (payload: SpellRejectedPayload) => void;
  "combat:seal-warning": (payload: SealWarningPayload) => void;
  "match:opponent-disconnected": (payload: OpponentDisconnectedPayload) => void;
  "match:opponent-reconnected": (payload: OpponentReconnectedPayload) => void;
  "match:end": (payload: MatchEndPayload) => void;
}

export type ClientToServerEventName = keyof ClientToServerEvents;
export type ServerToClientEventName = keyof ServerToClientEvents;
