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

/**
 * Cualquier fallo al hablar con el api: respuesta no 2xx, timeout o red caída.
 * `status` es el código HTTP, o `null` si no hubo respuesta.
 *
 * No hay un error de "usuario desconocido": el JWT ya se validó en el handshake, así que un 404
 * del loadout significa que el api no tiene la ruta o falló al buscar, no que la sesión expiró.
 * Responder UNAUTHORIZED en ese caso mandaba al jugador al login sin motivo.
 */
export class InternalApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

interface HttpInternalApiOptions {
  baseUrl: string;
  internalKey: string;
  /**
   * Espera del loadout. El jugador está mirando "buscando rival", así que se corta antes;
   * el shell ya despertó al api al hacer login.
   */
  loadoutTimeoutMs?: number;
  /** Espera de cada intento de registrar el resultado. */
  recordTimeoutMs?: number;
  recordAttempts?: number;
  /** Base del backoff: 2 s, 4 s, 8 s… entre intentos. */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpInternalApi implements InternalApi {
  private readonly loadoutTimeoutMs: number;
  private readonly recordTimeoutMs: number;
  private readonly recordAttempts: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: HttpInternalApiOptions) {
    this.loadoutTimeoutMs = options.loadoutTimeoutMs ?? 10_000;
    this.recordTimeoutMs = options.recordTimeoutMs ?? 15_000;
    // 4 intentos × 15 s + esperas de 2, 4 y 8 s ≈ 74 s: cubre el minuto que tarda Render free
    // en despertar el api. Ver services/game-server/README.md, "Si el api no responde".
    this.recordAttempts = options.recordAttempts ?? 4;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
  }

  private async request(path: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${this.options.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          [INTERNAL_KEY_HEADER]: this.options.internalKey,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // TimeoutError (AbortSignal.timeout) o fallo de red (api apagado, DNS).
      throw new InternalApiError(`api inalcanzable en ${path}: ${(error as Error).message}`, null);
    }
  }

  async getLoadout(userId: UserId): Promise<LoadoutResponse> {
    const path = `/internal/users/${encodeURIComponent(userId)}/loadout`;
    const res = await this.request(path, this.loadoutTimeoutMs);
    if (!res.ok) throw new InternalApiError(`GET ${path} respondió ${res.status}`, res.status);
    return (await res.json()) as LoadoutResponse;
  }

  async recordMatch(request: RecordMatchRequest): Promise<RecordMatchResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.recordAttempts; attempt++) {
      try {
        const res = await this.request("/internal/matches", this.recordTimeoutMs, {
          method: "POST",
          body: JSON.stringify(request),
        });
        if (res.ok) return (await res.json()) as RecordMatchResponse;
        lastError = new InternalApiError(`POST /internal/matches respondió ${res.status}`, res.status);
        // Un 4xx no mejora reintentando (payload inválido o clave mala); un 5xx sí puede.
        if (res.status < 500) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < this.recordAttempts) await sleep(this.retryDelayMs * 2 ** (attempt - 1));
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
