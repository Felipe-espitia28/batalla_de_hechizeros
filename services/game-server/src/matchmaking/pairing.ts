/**
 * Emparejamiento por rating con margen creciente (sección 6, Matchmaking).
 * Función pura: recibe la cola y la hora, devuelve las parejas. El ciclo de 1 s del servidor
 * la llama con la cola en memoria; Redis solo refleja la cola (ver live-store.ts).
 */
import type { UserId } from "@duelo/contracts";
import { getRatingRange } from "@duelo/game-rules";

export interface QueueEntry {
  userId: UserId;
  rating: number;
  joinedAt: number;
}

/**
 * Empareja primero a quien lleva más tiempo esperando, con el rival de rating más cercano
 * dentro de su margen. Como el más antiguo siempre tiene el margen más amplio, basta con
 * usar el suyo: si él acepta, el otro también habría aceptado tras esperar lo mismo.
 */
export function findPairs<T extends QueueEntry>(entries: readonly T[], now: number): Array<[T, T]> {
  const sorted = [...entries].sort((a, b) => a.joinedAt - b.joinedAt);
  const taken = new Set<UserId>();
  const pairs: Array<[T, T]> = [];

  for (const first of sorted) {
    if (taken.has(first.userId)) continue;
    const range = getRatingRange(now - first.joinedAt) ?? Number.POSITIVE_INFINITY;

    let best: T | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const candidate of sorted) {
      if (candidate.userId === first.userId || taken.has(candidate.userId)) continue;
      const diff = Math.abs(first.rating - candidate.rating);
      if (diff <= range && diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }

    if (best) {
      taken.add(first.userId);
      taken.add(best.userId);
      pairs.push([first, best]);
    }
  }
  return pairs;
}
