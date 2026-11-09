/**
 * Contrato REST del `api` (sección 8 de CLAUDE.md).
 * Convenciones:
 * - Fechas en ISO 8601; los IDs igual que en el socket.
 * - Las listas van envueltas en un objeto ({ spells: [...] }) para poder añadir campos sin romper.
 * - Todo error responde con `ApiErrorBody`.
 */
import type {
  AnySpellId,
  EpochMs,
  IsoDateString,
  MatchId,
  RankName,
  SpellId,
  SpellKind,
  UltimateId,
  UserId,
} from "./common.js";
import type { EndReason, MatchReward } from "./socket.js";

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "INVALID_CREDENTIALS",
  "USERNAME_TAKEN",
  "EMAIL_TAKEN",
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SPELL_NOT_FOUND",
  "ALREADY_OWNED",
  "INSUFFICIENT_GOLD",
  "INVALID_GRIMOIRE",
  "INTERNAL_ERROR",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Mensaje en español apto para mostrar al jugador. */
    message: string;
    /** Detalle opcional (p. ej. qué campo falló la validación). */
    details?: unknown;
  };
}

/** Cabecera que exige `/internal/*`; el valor sale de `INTERNAL_API_KEY`. */
export const INTERNAL_KEY_HEADER = "x-internal-key" as const;

// ---------------------------------------------------------------------------
// Auth — Felipe
// ---------------------------------------------------------------------------

/** POST /auth/register */
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

/** POST /auth/login. `identifier` acepta username o email (ambos son únicos). */
export interface LoginRequest {
  identifier: string;
  password: string;
}

/** Lo mínimo del usuario que el shell guarda en la sesión y pasa a los remotes. */
export interface SessionUser {
  id: UserId;
  username: string;
}

/** Respuesta de register (201) y login (200). */
export interface AuthResponse {
  token: string;
  user: SessionUser;
}

/** GET /me */
export interface MeResponse {
  id: UserId;
  username: string;
  email: string;
  rating: number;
  /** Calculado desde `rating`; no está en la base. */
  rank: RankName;
  gold: number;
  wins: number;
  losses: number;
  draws: number;
  equippedUltimateId: UltimateId;
  createdAt: IsoDateString;
}

// ---------------------------------------------------------------------------
// Tienda y grimorio — Angel
// ---------------------------------------------------------------------------

export interface SpellCatalogItem {
  id: AnySpellId;
  name: string;
  kind: SpellKind;
  gestureDescription: string;
  price: number;
  isStarter: boolean;
  sortOrder: number;
}

/** GET /spells */
export interface SpellsResponse {
  spells: SpellCatalogItem[];
}

/**
 * Grimorio: 4 espacios + 1 definitivo.
 * Espacios 1 y 2 siempre Rayo y Escudo; 3 y 4 hechizos comprados o vacíos.
 */
export interface Grimoire {
  slots: ["lightning", "shield", SpellId | null, SpellId | null];
  ultimateId: UltimateId;
}

export interface InventoryItem {
  spellId: AnySpellId;
  pricePaid: number;
  acquiredAt: IsoDateString;
}

/** GET /me/inventory */
export interface InventoryResponse {
  items: InventoryItem[];
  grimoire: Grimoire;
}

/** POST /shop/purchase */
export interface PurchaseRequest {
  spellId: AnySpellId;
}

export interface PurchaseResponse {
  spellId: AnySpellId;
  /** Oro restante tras la compra; la Tienda lo emite en `duelo:gold-changed`. */
  gold: number;
}

/** PUT /me/grimoire (el cuerpo es el grimorio completo; responde el guardado). */
export type UpdateGrimoireRequest = Grimoire;
export type UpdateGrimoireResponse = Grimoire;

// ---------------------------------------------------------------------------
// Ranking e historial — Daniel
// ---------------------------------------------------------------------------

export interface RankingEntry {
  position: number;
  userId: UserId;
  username: string;
  rating: number;
  rank: RankName;
}

/** GET /ranking?limit=N */
export interface RankingResponse {
  entries: RankingEntry[];
}

/** GET /ranking/me */
export interface RankingMeResponse {
  position: number;
  totalPlayers: number;
  rating: number;
  rank: RankName;
}

export type MatchResult = "win" | "loss" | "draw";

export interface MatchHistoryItem {
  matchId: MatchId;
  endReason: EndReason;
  result: MatchResult;
  rival: { id: UserId; username: string };
  ratingDelta: number;
  goldDelta: number;
  finalHp: number;
  durationMs: number;
  endedAt: IsoDateString;
}

/** GET /me/matches */
export interface MatchHistoryResponse {
  matches: MatchHistoryItem[];
}

// ---------------------------------------------------------------------------
// Internos (game-server → api), protegidos con x-internal-key
// ---------------------------------------------------------------------------

/** GET /internal/users/:id/loadout — el grimorio nunca viaja desde el cliente. */
export interface LoadoutResponse {
  userId: UserId;
  username: string;
  rating: number;
  rank: RankName;
  /** Hechizos del grimorio (sin los espacios vacíos). */
  spells: SpellId[];
  ultimateId: UltimateId;
}

export interface MatchPlayerResult {
  userId: UserId;
  finalHp: number;
  /** true para quien abandonó (aplica −25 y 0 de oro). */
  abandoned: boolean;
}

/** POST /internal/matches */
export interface RecordMatchRequest {
  matchId: MatchId;
  endReason: EndReason;
  /** `null` en empate. */
  winnerId: UserId | null;
  durationMs: number;
  startedAt: EpochMs;
  endedAt: EpochMs;
  players: [MatchPlayerResult, MatchPlayerResult];
}

/**
 * El api calcula las recompensas (conoce el rating previo y aplica la economía de game-rules)
 * y se las devuelve al game-server para que las mande en `match:end`.
 */
export interface RecordMatchResponse {
  rewards: Record<UserId, MatchReward>;
}
