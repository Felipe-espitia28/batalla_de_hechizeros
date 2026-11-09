/**
 * Llamadas del game-server al api por /internal (sección 8), con la cabecera x-internal-key.
 *
 * - GET /internal/users/:id/loadout: el grimorio siempre sale del api, nunca del cliente.
 * - POST /internal/matches: registra el resultado; el api aplica la economía y devuelve las
 *   recompensas. El api es idempotente por matchId, así que reintentar es seguro.
 */
import type {
  LoadoutResponse,
  MatchReward,
  RecordMatchRequest,
  RecordMatchResponse,
  UserId,
} from "@duelo/contracts";
import { INTERNAL_KEY_HEADER } from "@duelo/contracts";
import { GRIMOIRE_RULES, applyMatchReward, getPlayerOutcome, getRankForRating } from "@duelo/game-rules";

export interface InternalApi {
  getLoadout(userId: UserId, username: string): Promise<LoadoutResponse>;
  recordMatch(request: RecordMatchRequest): Promise<RecordMatchResponse>;
}

/** El usuario del token ya no existe en la base (cuenta borrada o token de otra base). */
export class UnknownUserError extends Error {}

export class InternalApiError extends Error {}

interface HttpInternalApiOptions {
  baseUrl: string;
  internalKey: string;
  /** Render free tarda ~1 min en despertar; 15 s cubre un api lento pero despierto. */
  timeoutMs?: number;
  recordAttempts?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpInternalApi implements InternalApi {
  private readonly timeoutMs: number;
  private readonly recordAttempts: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: HttpInternalApiOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.recordAttempts = options.recordAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${this.options.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          [INTERNAL_KEY_HEADER]: this.options.internalKey,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new InternalApiError(`api interna inalcanzable (${path}): ${(error as Error).message}`);
    }
  }

  async getLoadout(userId: UserId): Promise<LoadoutResponse> {
    const res = await this.request(`/internal/users/${encodeURIComponent(userId)}/loadout`);
    if (res.status === 404) throw new UnknownUserError(`usuario ${userId} no existe`);
    if (!res.ok) throw new InternalApiError(`loadout respondió ${res.status}`);
    return (await res.json()) as LoadoutResponse;
  }

  async recordMatch(request: RecordMatchRequest): Promise<RecordMatchResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.recordAttempts; attempt++) {
      try {
        const res = await this.request("/internal/matches", { method: "POST", body: JSON.stringify(request) });
        if (res.ok) return (await res.json()) as RecordMatchResponse;
        // Un 4xx no mejora reintentando (payload inválido o clave mala); un 5xx sí puede.
        lastError = new InternalApiError(`registrar partida respondió ${res.status}`);
        if (res.status < 500) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < this.recordAttempts) await sleep(this.retryDelayMs * attempt);
    }
    throw lastError;
  }
}

/**
 * Recompensas calculadas en el game-server con la misma economía de game-rules.
 * Se usan si el api no responde, para que los jugadores igual vean su resultado;
 * el ranking real queda sin actualizar y se registra el error.
 */
export function computeRewardsLocally(
  request: RecordMatchRequest,
  ratings: Readonly<Record<UserId, number>>,
): Record<UserId, MatchReward> {
  const rewards: Record<UserId, MatchReward> = {};
  for (const player of request.players) {
    const outcome = getPlayerOutcome(request.endReason, request.winnerId, player.userId);
    rewards[player.userId] = applyMatchReward(ratings[player.userId] ?? 0, outcome);
  }
  return rewards;
}

/**
 * api simulado para desarrollo sin `API_INTERNAL_URL`: todos tienen el grimorio inicial
 * y el rating vive en memoria mientras el proceso esté arriba.
 */
export class DevInternalApi implements InternalApi {
  private readonly ratings = new Map<UserId, number>();

  async getLoadout(userId: UserId, username: string): Promise<LoadoutResponse> {
    const rating = this.ratings.get(userId) ?? 0;
    return {
      userId,
      username,
      rating,
      rank: getRankForRating(rating),
      spells: [...GRIMOIRE_RULES.fixedSpellIds],
      ultimateId: GRIMOIRE_RULES.defaultUltimateId,
    };
  }

  async recordMatch(request: RecordMatchRequest): Promise<RecordMatchResponse> {
    const ratings = Object.fromEntries(request.players.map((p) => [p.userId, this.ratings.get(p.userId) ?? 0]));
    const rewards = computeRewardsLocally(request, ratings);
    for (const [userId, reward] of Object.entries(rewards)) this.ratings.set(userId, reward.newRating);
    return { rewards };
  }
}
