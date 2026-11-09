/**
 * Economía: puntos de rango y oro arcano al cerrar una partida (sección 6, Economía).
 * El api la aplica al registrar el resultado (POST /internal/matches); el game-server la usa
 * solo para calcular recompensas provisionales si el api no responde.
 */
import type { EndReason, MatchReward, UserId } from "@duelo/contracts";
import { getRankForRating } from "./ranks.js";

/** Resultado de un jugador ya interpretado según el motivo de fin. */
export type PlayerOutcome = "win" | "loss" | "draw" | "abandoned" | "stayed";

export const MATCH_REWARDS: Readonly<Record<PlayerOutcome, { rating: number; gold: number }>> = {
  win: { rating: 25, gold: 50 },
  loss: { rating: -15, gold: 20 },
  draw: { rating: 0, gold: 30 },
  /** Quien abandona. */
  abandoned: { rating: -25, gold: 0 },
  /** Quien se queda cuando el rival abandona. */
  stayed: { rating: 25, gold: 50 },
};

/** Valores de una cuenta nueva. El oro de las cuentas de la demo se prepara aparte. */
export const STARTING_RATING = 0;
export const STARTING_GOLD = 0;

/**
 * Traduce el fin de partida al resultado de un jugador concreto.
 * En ABANDON, `winnerId` es quien se quedó.
 */
export function getPlayerOutcome(reason: EndReason, winnerId: UserId | null, userId: UserId): PlayerOutcome {
  if (winnerId === null) return "draw";
  if (reason === "ABANDON") return winnerId === userId ? "stayed" : "abandoned";
  return winnerId === userId ? "win" : "loss";
}

/**
 * Aplica la recompensa a un rating. El rating nunca baja de 0, así que `ratingDelta`
 * es el cambio real (con 10 puntos, perder resta 10 y no 15).
 */
export function applyMatchReward(rating: number, outcome: PlayerOutcome): MatchReward {
  const reward = MATCH_REWARDS[outcome];
  const newRating = Math.max(0, rating + reward.rating);
  return {
    ratingDelta: newRating - rating,
    goldDelta: reward.gold,
    newRating,
    newRank: getRankForRating(newRating),
  };
}
