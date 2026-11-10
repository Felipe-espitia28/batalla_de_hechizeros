/**
 * Copia rápida del ranking en Redis: sorted set `dh:ranking` (userId → rating), sección 8.
 *
 * PostgreSQL es la fuente de verdad. Por eso toda operación aquí es "best effort":
 * si Redis falla o tarda, se devuelve `null` y el llamador responde desde PostgreSQL.
 * Así una caída de Upstash degrada la velocidad, nunca la disponibilidad del ranking.
 */
import type { Redis } from "ioredis";

export const RANKING_KEY = "dh:ranking";
const REBUILD_KEY = "dh:ranking:rebuild";

/**
 * Tope de espera por operación. Si el cliente tiene cola offline activada, un comando con Redis
 * caído esperaría a la reconexión indefinidamente; con este límite la petición HTTP no se cuelga.
 */
const REDIS_TIMEOUT_MS = 500;

export interface RankingCacheLogger {
  warn: (message: string) => void;
}

export class RankingCache {
  /**
   * Sin Redis, cada petición fallaría aquí: un aviso por operación (y con traza) inundaría el log
   * de Render. Se avisa una vez por caída y se vuelve a avisar solo si Redis se recupera y cae otra vez.
   */
  private unavailableWarned = false;

  constructor(
    private readonly redis: Redis,
    private readonly logger: RankingCacheLogger = console,
  ) {}

  private async safe<T>(run: () => Promise<T>, timeoutMs = REDIS_TIMEOUT_MS): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout de ${timeoutMs} ms`)), timeoutMs);
      });
      const result = await Promise.race([run(), timeout]);
      this.unavailableWarned = false;
      return result;
    } catch {
      if (!this.unavailableWarned) {
        this.unavailableWarned = true;
        this.logger.warn("[ranking] Redis no disponible; se responde desde PostgreSQL");
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Inserta o actualiza ratings. Lo usan el cierre de partida y el registro de usuarios. */
  async upsert(entries: ReadonlyArray<{ userId: string; rating: number }>): Promise<boolean> {
    if (entries.length === 0) return true;
    const args = entries.flatMap((e) => [e.rating, e.userId]);
    const result = await this.safe(() => this.redis.zadd(RANKING_KEY, ...args));
    return result !== null;
  }

  /** Cuántos jugadores tiene la copia; `null` si Redis no responde. */
  size(): Promise<number | null> {
    return this.safe(() => this.redis.zcard(RANKING_KEY));
  }

  /** Top N: ids con su rating, de mayor a menor. `null` si Redis falla o el set está vacío. */
  async top(limit: number): Promise<Array<{ userId: string; rating: number }> | null> {
    const raw = await this.safe(() => this.redis.zrevrange(RANKING_KEY, 0, limit - 1, "WITHSCORES"));
    // Un set vacío casi siempre significa "no se ha reconstruido": mejor preguntarle a PostgreSQL.
    if (!raw || raw.length === 0) return null;
    const entries: Array<{ userId: string; rating: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({ userId: raw[i]!, rating: Number(raw[i + 1]) });
    }
    return entries;
  }

  /**
   * Posición de un jugador con ranking de competición ("1224"): 1 + cuántos tienen rating
   * estrictamente mayor. Los empatados comparten posición, igual que en la consulta de PostgreSQL.
   */
  async positionOf(userId: string): Promise<{ rating: number; position: number; total: number } | null> {
    const result = await this.safe(async () => {
      const score = await this.redis.zscore(RANKING_KEY, userId);
      if (score === null) return null;
      const rating = Number(score);
      const [higher, total] = await Promise.all([
        this.redis.zcount(RANKING_KEY, `(${rating}`, "+inf"),
        this.redis.zcard(RANKING_KEY),
      ]);
      return { rating, position: higher + 1, total };
    });
    return result ?? null;
  }

  /**
   * Reemplaza el set completo. Se llena una clave temporal y se renombra al final para que,
   * mientras se reconstruye, los lectores nunca vean un ranking a medias.
   */
  async rebuild(entries: ReadonlyArray<{ userId: string; rating: number }>): Promise<boolean> {
    const result = await this.safe(async () => {
      if (entries.length === 0) {
        await this.redis.del(RANKING_KEY);
        return true;
      }
      await this.redis.del(REBUILD_KEY);
      // Por lotes: un ZADD con miles de miembros es un solo comando enorme.
      const BATCH = 500;
      for (let i = 0; i < entries.length; i += BATCH) {
        const args = entries.slice(i, i + BATCH).flatMap((e) => [e.rating, e.userId]);
        await this.redis.zadd(REBUILD_KEY, ...args);
      }
      await this.redis.rename(REBUILD_KEY, RANKING_KEY);
      return true;
      // Se ejecuta una vez al arrancar y son varios comandos: merece más margen que una lectura.
    }, 10_000);
    return result === true;
  }
}
