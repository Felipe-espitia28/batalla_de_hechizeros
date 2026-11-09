/**
 * Clasifica un trazo terminado siguiendo el orden de la sección 6 de CLAUDE.md:
 *   1. (la X de dos manos se resuelve antes, en el procesador, porque no es un trazo)
 *   2. ¿Trazo recto? → Corte, sin pasar por el $1.
 *   3. Si no → $1 contra las plantillas del grimorio.
 */
import type { SpellId } from "@duelo/contracts";
import { recognize } from "./dollar-one";
import { distance, pathLength, type Point } from "./geometry";
import { templatesFor } from "./templates";

/** Confianza mínima del reconocedor (sección 6). */
export const DEFAULT_MIN_CONFIDENCE = 0.8;

export interface ClassifyOptions {
  /** Hechizos del grimorio del jugador: el $1 solo compara contra estos. */
  grimoire: readonly SpellId[];
  /** Ancho del fotograma en píxeles (para las longitudes mínimas). */
  frameWidth: number;
  minConfidence?: number;
}

export type ClassifyResult =
  /** Reconocido con confianza suficiente. */
  | { kind: "spell"; spellId: SpellId; confidence: number }
  /** Se intentó un gesto pero no se parece lo suficiente a ninguno: "¡Hechizo fallido!". */
  | { kind: "failed"; bestGuess: SpellId | null; confidence: number }
  /** Trazo demasiado corto: pinza accidental, se ignora sin penalizar al jugador. */
  | { kind: "ignored" };

/** Por debajo de esta fracción del ancho de la cámara, el trazo se considera accidental. */
const MIN_STROKE_FRACTION = 0.08;
const MIN_STROKE_POINTS = 6;

/**
 * Rectitud (sección 6): distancia inicio–fin ≥ 90 % de la longitud total
 * y longitud ≥ 1/4 del ancho de la cámara.
 */
export function isStraightStroke(points: readonly Point[], frameWidth: number): boolean {
  if (points.length < 2) return false;
  const length = pathLength(points);
  if (length < frameWidth / 4) return false;
  return distance(points[0]!, points[points.length - 1]!) >= 0.9 * length;
}

export function classifyStroke(points: readonly Point[], options: ClassifyOptions): ClassifyResult {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  if (points.length < MIN_STROKE_POINTS || pathLength(points) < options.frameWidth * MIN_STROKE_FRACTION) {
    return { kind: "ignored" };
  }

  if (isStraightStroke(points, options.frameWidth)) {
    // Una línea es inequívoca, por eso confianza 1. Si no tiene Corte, es un hechizo fallido:
    // mandarla al $1 la deformaría y podría confundirse con un zigzag.
    return options.grimoire.includes("slash")
      ? { kind: "spell", spellId: "slash", confidence: 1 }
      : { kind: "failed", bestGuess: null, confidence: 0 };
  }

  const match = recognize(points, templatesFor(options.grimoire));
  if (!match) return { kind: "failed", bestGuess: null, confidence: 0 };
  // Redondeo a 2 decimales: suficiente para el servidor y más legible en el playground.
  const confidence = Math.round(match.score * 100) / 100;
  return confidence >= minConfidence
    ? { kind: "spell", spellId: match.name, confidence }
    : { kind: "failed", bestGuess: match.name, confidence };
}
