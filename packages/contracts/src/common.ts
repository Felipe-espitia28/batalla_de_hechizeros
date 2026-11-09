/**
 * Tipos base compartidos por el socket, el REST y los micro frontends.
 * Los IDs de hechizos viven aquí (y no en game-rules) porque forman parte del protocolo:
 * game-rules los importa para colgarles los números de balance.
 */

/** UUID del usuario (tabla `users`). */
export type UserId = string;
/** Identificador de partida generado por el game-server. */
export type MatchId = string;
/** Identificador de lanzamiento generado por el cliente; sirve para casar el ack y los eventos de resultado. */
export type CastId = string;
/** Milisegundos desde epoch. Siempre viaja junto a `serverNow` para calcular el desfase de reloj. */
export type EpochMs = number;
/** Fecha ISO 8601 (solo en REST). */
export type IsoDateString = string;

/** Hechizos normales (sección 6). */
export const SPELL_IDS = [
  "lightning",
  "shield",
  "slash",
  "fireball",
  "heal",
  "poison",
  "freeze",
  "silence-seal",
] as const;
export type SpellId = (typeof SPELL_IDS)[number];

/** Definitivos: se activan gritando su nombre (sección 6). */
export const ULTIMATE_IDS = ["meteor", "storm", "rebirth", "purple-void"] as const;
export type UltimateId = (typeof ULTIMATE_IDS)[number];

/** Cualquier cosa que se pueda tener en el inventario o lanzar. */
export type AnySpellId = SpellId | UltimateId;

export type SpellKind = "spell" | "ultimate";

/** El rango no se guarda en la base: se calcula desde `rating` con la tabla de game-rules. */
export const RANK_NAMES = ["Grado 4", "Grado 3", "Grado 2", "Grado 1", "Grado Especial"] as const;
export type RankName = (typeof RANK_NAMES)[number];

/** Resumen público de un jugador (lo que se puede mostrar del rival). */
export interface PlayerSummary {
  id: UserId;
  username: string;
  rating: number;
  rank: RankName;
}

/**
 * Claims del JWT. El mismo token sirve para REST y para el socket,
 * así que api y game-server deben leer exactamente esta forma.
 */
export interface JwtClaims {
  /** id del usuario */
  sub: UserId;
  username: string;
  /** emitido / expira (segundos epoch, estándar JWT) */
  iat: number;
  exp: number;
}
