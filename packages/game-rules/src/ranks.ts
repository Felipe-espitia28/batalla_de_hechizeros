/**
 * Tabla de rangos (sección 6 de CLAUDE.md).
 * El rango no se guarda en la base: api y game-server lo calculan desde `rating` con esta tabla,
 * así un cambio de umbrales no exige migrar datos.
 */
import type { RankName } from "@duelo/contracts";

export interface RankTier {
  name: RankName;
  /** Puntos mínimos (inclusive) para tener este rango. */
  minRating: number;
}

/** Ordenada de mayor a menor para que la búsqueda devuelva el primer umbral alcanzado. */
export const RANK_TIERS: readonly RankTier[] = [
  { name: "Grado Especial", minRating: 900 },
  { name: "Grado 1", minRating: 500 },
  { name: "Grado 2", minRating: 250 },
  { name: "Grado 3", minRating: 100 },
  { name: "Grado 4", minRating: 0 },
];

export function getRankForRating(rating: number): RankName {
  // El rating nunca es negativo en la base, pero si llegara uno se trata como el rango más bajo.
  const tier = RANK_TIERS.find((t) => rating >= t.minRating);
  return tier ? tier.name : "Grado 4";
}
