/**
 * Reglas generales de la partida, del matchmaking y de los gestos (sección 6 de CLAUDE.md).
 * Viven aquí y no en la base de datos: el balance se cambia con un PR revisado, no con un UPDATE.
 */

/** Números de una partida. Los tiempos van en milisegundos para no convertir en cada uso. */
export const MATCH_RULES = {
  /** Duración máxima de la ronda (90 s). */
  durationMs: 90_000,
  /** Cuenta regresiva 3-2-1 tras la calibración. */
  countdownMs: 3_000,
  maxHp: 100,
  maxMana: 100,
  startingMana: 30,
  manaRegenPerSecond: 4,
  /** Por debajo de esta confianza el hechizo falla: no gasta maná y penaliza. */
  minConfidence: 0.8,
  failedCastPenaltyMs: 500,
  /** Intervalo mínimo entre dos lanzamientos del mismo jugador (anti-trampas). */
  minCastIntervalMs: 300,
  /** Espera para que un jugador desconectado vuelva antes de perder por abandono. */
  reconnectGraceMs: 10_000,
  /** El servidor solo acepta el Sello si recibió `combat:seal-charging` al menos este tiempo antes. */
  sealMinChargeMs: 600,
} as const;

/**
 * Misma forma que MATCH_RULES pero con `number`: permite que los tests del servidor
 * usen partidas más cortas sin tocar los valores reales.
 */
export type MatchRules = { readonly [K in keyof typeof MATCH_RULES]: number };

/** Emparejamiento por rating con margen creciente. */
export const MATCHMAKING_RULES = {
  /** Margen inicial: rival a ≤ 150 puntos. */
  initialRatingRange: 150,
  /** Cada 10 s sin rival el margen crece 100 puntos. */
  rangeGrowth: 100,
  rangeGrowthEveryMs: 10_000,
  /** Tras 30 s se acepta cualquier rival. */
  anyRivalAfterMs: 30_000,
} as const;

/**
 * Margen de rating (±) según el tiempo en cola. `null` significa "cualquier rival",
 * igual que `ratingRange` en `matchmaking:queued`.
 */
export function getRatingRange(waitedMs: number): number | null {
  if (waitedMs >= MATCHMAKING_RULES.anyRivalAfterMs) return null;
  const steps = Math.floor(Math.max(0, waitedMs) / MATCHMAKING_RULES.rangeGrowthEveryMs);
  return MATCHMAKING_RULES.initialRatingRange + steps * MATCHMAKING_RULES.rangeGrowth;
}

/**
 * Umbrales del reconocedor local (spell-engine). Están aquí para que la Arena y el
 * servidor hablen de los mismos números aunque solo el cliente los use para clasificar.
 */
export const GESTURE_RULES = {
  /** Corte: distancia inicio–fin ≥ 90 % de la longitud total del trazo. */
  straightLineMinRatio: 0.9,
  /** Corte: longitud ≥ 1/4 del ancho de la cámara. */
  straightLineMinWidthFraction: 0.25,
  /** X del Sello: ángulo entre los dos índices. */
  sealMinAngleDeg: 45,
  sealMaxAngleDeg: 135,
  /** X del Sello: tiempo sostenida para considerarla cargada. */
  sealHoldMs: 700,
} as const;
