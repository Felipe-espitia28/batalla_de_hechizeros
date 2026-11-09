/**
 * PROVISIONAL: estos números pertenecen a `packages/game-rules` (sección 4: "los números de balance
 * viven en game-rules"). Ese paquete aún está vacío; cuando su dueño publique la tabla de rangos y la
 * economía, este archivo se borra y se importa de `@duelo/game-rules` sin tocar el resto del módulo.
 * Los valores son exactamente los de las secciones 6 "Economía" y "Rangos" de CLAUDE.md.
 */
import type { RankName } from "@duelo/contracts";

/** Rangos de mayor a menor umbral, para encontrar el primero que cumple. */
const RANK_THRESHOLDS: ReadonlyArray<{ minRating: number; rank: RankName }> = [
  { minRating: 900, rank: "Grado Especial" },
  { minRating: 500, rank: "Grado 1" },
  { minRating: 250, rank: "Grado 2" },
  { minRating: 100, rank: "Grado 3" },
  { minRating: 0, rank: "Grado 4" },
];

export function rankForRating(rating: number): RankName {
  const found = RANK_THRESHOLDS.find((t) => rating >= t.minRating);
  // El rating nunca es negativo; si llegara a serlo por un error, se muestra el rango más bajo.
  return found ? found.rank : "Grado 4";
}

/** Resultado de un jugador concreto en una partida, ya interpretado según el motivo de fin. */
export type PlayerOutcome = "win" | "loss" | "draw" | "abandoned" | "stayed";

export const MATCH_REWARDS: Readonly<Record<PlayerOutcome, { rating: number; gold: number }>> = {
  win: { rating: 25, gold: 50 },
  loss: { rating: -15, gold: 20 },
  draw: { rating: 0, gold: 30 },
  abandoned: { rating: -25, gold: 0 },
  stayed: { rating: 25, gold: 50 },
};
