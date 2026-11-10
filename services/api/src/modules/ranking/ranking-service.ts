/**
 * Lógica del ranking: top, posición propia, historial y cierre de partidas.
 *
 * Regla de oro (sección 8): PostgreSQL es la fuente de verdad; `dh:ranking` en Redis es una copia
 * que se puede perder. Por eso:
 * - Las escrituras van primero a PostgreSQL (en transacción) y después, sin bloquear, a Redis.
 * - Las lecturas solo usan Redis si la copia está completa; si no, responden desde PostgreSQL
 *   y lanzan una reconstrucción en segundo plano.
 */
import type {
  MatchHistoryItem,
  MatchResult,
  MatchReward,
  RankingEntry,
  RankingMeResponse,
  RecordMatchRequest,
  UserId,
} from "@duelo/contracts";
// Rangos y economía salen de game-rules: el game-server usa las mismas funciones para sus
// recompensas provisionales, así ambos servicios nunca calculan distinto.
import { applyMatchReward, getPlayerOutcome, getRankForRating, type PlayerOutcome } from "@duelo/game-rules";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { badRequest, HttpError, notFound } from "../../lib/http-error.js";
import type { RankingCache, RankingCacheLogger } from "./ranking-cache.js";

export interface RecordMatchResult {
  rewards: Record<UserId, MatchReward>;
  /** true si el matchId ya estaba registrado y se devolvió lo guardado (reintento del game-server). */
  replayed: boolean;
}

export class RankingService {
  private dirty = false;
  private rebuilding: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: RankingCache,
    private readonly logger: RankingCacheLogger = console,
  ) {}

  // -------------------------------------------------------------------------
  // Sincronización con Redis
  // -------------------------------------------------------------------------

  /** Reconstruye `dh:ranking` desde `users`. El api la llama al arrancar (sección 8). */
  rebuildCache(): Promise<void> {
    // Una sola reconstrucción a la vez: varias peticiones pueden detectar la copia incompleta a la vez.
    if (this.rebuilding) return this.rebuilding;
    this.rebuilding = (async () => {
      try {
        const users = await this.prisma.user.findMany({ select: { id: true, rating: true } });
        const ok = await this.cache.rebuild(users.map((u) => ({ userId: u.id, rating: u.rating })));
        this.dirty = !ok;
      } catch (error) {
        // Falló PostgreSQL (p. ej. Neon despertando): se reintenta en la siguiente lectura.
        this.dirty = true;
        this.logger.warn(`[ranking] no se pudo reconstruir dh:ranking: ${(error as Error).message}`);
      } finally {
        this.rebuilding = null;
      }
    })();
    return this.rebuilding;
  }

  /**
   * ¿Se puede confiar en Redis? Solo si ninguna escritura falló y tiene tantos miembros como
   * usuarios hay en PostgreSQL (detecta, p. ej., usuarios registrados mientras Redis estaba caído).
   * Contar usuarios en PostgreSQL es barato y evita servir un ranking incompleto.
   */
  private async cacheIsUsable(): Promise<boolean> {
    if (this.dirty || this.rebuilding) {
      void this.rebuildCache();
      return false;
    }
    const [cached, real] = await Promise.all([this.cache.size(), this.prisma.user.count()]);
    if (cached === null) return false; // Redis caído: no tiene sentido reconstruir ahora
    if (cached !== real) {
      void this.rebuildCache();
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Lecturas
  // -------------------------------------------------------------------------

  async getTop(limit: number): Promise<RankingEntry[]> {
    if (await this.cacheIsUsable()) {
      const cached = await this.cache.top(limit);
      if (cached) {
        // Redis solo guarda id → rating; el nombre se lee de PostgreSQL en una sola consulta.
        const users = await this.prisma.user.findMany({
          where: { id: { in: cached.map((c) => c.userId) } },
          select: { id: true, username: true },
        });
        const names = new Map(users.map((u) => [u.id, u.username]));
        const rows = cached
          .filter((c) => names.has(c.userId))
          .map((c) => ({ id: c.userId, username: names.get(c.userId)!, rating: c.rating }));
        return withPositions(rows);
      }
    }
    // Mismo orden de desempate que Redis (ZREVRANGE ordena los empates por miembro descendente).
    const rows = await this.prisma.user.findMany({
      select: { id: true, username: true, rating: true },
      orderBy: [{ rating: "desc" }, { id: "desc" }],
      take: limit,
    });
    return withPositions(rows);
  }

  async getMe(userId: UserId): Promise<RankingMeResponse> {
    if (await this.cacheIsUsable()) {
      const cached = await this.cache.positionOf(userId);
      if (cached) {
        return {
          position: cached.position,
          totalPlayers: cached.total,
          rating: cached.rating,
          rank: getRankForRating(cached.rating),
        };
      }
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { rating: true } });
    if (!user) throw notFound("El jugador no existe.");
    const [higher, totalPlayers] = await Promise.all([
      this.prisma.user.count({ where: { rating: { gt: user.rating } } }),
      this.prisma.user.count(),
    ]);
    return { position: higher + 1, totalPlayers, rating: user.rating, rank: getRankForRating(user.rating) };
  }

  async getHistory(userId: UserId, limit: number): Promise<MatchHistoryItem[]> {
    const entries = await this.prisma.matchPlayer.findMany({
      where: { userId },
      orderBy: { match: { endedAt: "desc" } },
      take: limit,
      include: {
        match: { include: { players: { include: { user: { select: { id: true, username: true } } } } } },
      },
    });
    return entries.map((entry) => {
      const rival = entry.match.players.find((p) => p.userId !== userId);
      const result: MatchResult =
        entry.match.winnerId === null ? "draw" : entry.match.winnerId === userId ? "win" : "loss";
      return {
        matchId: entry.matchId,
        endReason: entry.match.endReason as MatchHistoryItem["endReason"],
        result,
        rival: rival ? { id: rival.user.id, username: rival.user.username } : { id: "", username: "?" },
        ratingDelta: entry.ratingDelta,
        goldDelta: entry.goldDelta,
        finalHp: entry.finalHp,
        durationMs: entry.match.durationMs,
        endedAt: entry.match.endedAt.toISOString(),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Cierre de partida (POST /internal/matches)
  // -------------------------------------------------------------------------

  async recordMatch(input: RecordMatchRequest): Promise<RecordMatchResult> {
    const outcomes = resolveOutcomes(input);
    const userIds = input.players.map((p) => p.userId);

    let result: RecordMatchResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // 1) Bloquear a los dos jugadores ANTES de insertar la partida, siempre en el mismo orden (por id).
        //    - Dos partidas distintas con un jugador en común se serializan en vez de pisarse el rating.
        //    - Si el mismo matchId llega dos veces a la vez, el segundo espera aquí y luego choca con la PK.
        //    Bloquear después del INSERT provocaría un deadlock: la FK toma un candado KEY SHARE en users.
        const locked = await tx.$queryRaw<Array<{ id: string; rating: number }>>`
          SELECT id::text AS id, rating FROM users
          WHERE id = ANY(${userIds}::uuid[])
          ORDER BY id
          FOR NO KEY UPDATE`;
        if (locked.length !== 2) {
          throw notFound("Alguno de los jugadores no existe.");
        }
        const ratingBefore = new Map(locked.map((u) => [u.id, u.rating]));

        // 2) La PK de matches es la clave de idempotencia: un duplicado lanza P2002 y aborta todo.
        await tx.match.create({
          data: {
            id: input.matchId,
            endReason: input.endReason,
            winnerId: input.winnerId,
            durationMs: input.durationMs,
            startedAt: new Date(input.startedAt),
            endedAt: new Date(input.endedAt),
          },
        });

        const rewards: Record<UserId, MatchReward> = {};
        for (const player of input.players) {
          const outcome = outcomes.get(player.userId)!;
          const before = ratingBefore.get(player.userId)!;
          // applyMatchReward ya recorta en 0: ratingDelta es el cambio real, que es lo que se guarda.
          const reward = applyMatchReward(before, outcome);

          await tx.user.update({
            where: { id: player.userId },
            data: {
              rating: reward.newRating,
              gold: { increment: reward.goldDelta },
              ...statIncrement(outcome),
            },
          });
          await tx.matchPlayer.create({
            data: {
              matchId: input.matchId,
              userId: player.userId,
              ratingBefore: before,
              ratingDelta: reward.ratingDelta,
              goldDelta: reward.goldDelta,
              finalHp: player.finalHp,
            },
          });
          rewards[player.userId] = reward;
        }
        return { rewards, replayed: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { rewards: await this.storedRewards(input), replayed: true };
      }
      throw error;
    }

    // 3) Redis después del COMMIT: si falla, PostgreSQL ya tiene el dato y la copia se marca para reconstruir.
    const synced = await this.cache.upsert(
      Object.entries(result.rewards).map(([userId, r]) => ({ userId, rating: r.newRating })),
    );
    if (!synced) this.dirty = true;
    return result;
  }

  /** Recompensas de una partida ya registrada, para responder igual a un reintento. */
  private async storedRewards(input: RecordMatchRequest): Promise<Record<UserId, MatchReward>> {
    const players = await this.prisma.matchPlayer.findMany({ where: { matchId: input.matchId } });
    const expected = new Set(input.players.map((p) => p.userId));
    if (players.length !== 2 || !players.every((p) => expected.has(p.userId))) {
      // Mismo id con otros jugadores: es un bug del game-server, no un reintento.
      throw new HttpError(409, "VALIDATION_ERROR", "Ese matchId ya está registrado con otros jugadores.");
    }
    const rewards: Record<UserId, MatchReward> = {};
    for (const p of players) {
      const newRating = p.ratingBefore + p.ratingDelta;
      rewards[p.userId] = {
        ratingDelta: p.ratingDelta,
        goldDelta: p.goldDelta,
        newRating,
        newRank: getRankForRating(newRating),
      };
    }
    return rewards;
  }
}

// ---------------------------------------------------------------------------
// Funciones puras (fáciles de probar)
// ---------------------------------------------------------------------------

/** Ranking de competición: empatados comparten posición y la siguiente salta ("1, 2, 2, 4"). */
export function withPositions(rows: ReadonlyArray<{ id: string; username: string; rating: number }>): RankingEntry[] {
  const entries: RankingEntry[] = [];
  rows.forEach((row, index) => {
    const previous = entries[index - 1];
    const position = previous && previous.rating === row.rating ? previous.position : index + 1;
    entries.push({ position, userId: row.id, username: row.username, rating: row.rating, rank: getRankForRating(row.rating) });
  });
  return entries;
}

/**
 * Rechaza combinaciones imposibles y luego traduce el fin de partida con getPlayerOutcome
 * (game-rules). El game-server es autoritativo, pero un payload incoherente repartiría puntos
 * mal para siempre; getPlayerOutcome confía en que winnerId y abandoned ya son coherentes.
 */
export function resolveOutcomes(input: RecordMatchRequest): Map<UserId, PlayerOutcome> {
  const [a, b] = input.players;

  if (a.userId === b.userId) throw badRequest("Los dos jugadores deben ser distintos.");
  if (input.endedAt < input.startedAt) throw badRequest("endedAt no puede ser anterior a startedAt.");
  const ids = new Set([a.userId, b.userId]);
  if (input.winnerId !== null && !ids.has(input.winnerId)) throw badRequest("winnerId no es ninguno de los jugadores.");
  if ((input.endReason === "DRAW") !== (input.winnerId === null)) {
    throw badRequest("winnerId debe ser null solo cuando endReason es DRAW.");
  }

  const abandoned = input.players.filter((p) => p.abandoned);
  if (input.endReason === "ABANDON") {
    const leaver = abandoned[0];
    if (abandoned.length !== 1 || !leaver) throw badRequest("En ABANDON exactamente un jugador debe tener abandoned=true.");
    if (input.winnerId === leaver.userId) throw badRequest("Quien abandona no puede ganar.");
  } else if (abandoned.length > 0) {
    throw badRequest("abandoned=true solo es válido con endReason ABANDON.");
  }

  return new Map(
    input.players.map((p) => [p.userId, getPlayerOutcome(input.endReason, input.winnerId, p.userId)] as const),
  );
}

function statIncrement(outcome: PlayerOutcome) {
  switch (outcome) {
    case "win":
    case "stayed":
      return { wins: { increment: 1 } };
    case "loss":
    case "abandoned":
      return { losses: { increment: 1 } };
    case "draw":
      return { draws: { increment: 1 } };
  }
}
