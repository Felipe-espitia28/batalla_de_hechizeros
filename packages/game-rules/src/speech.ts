/**
 * Validación de la palabra gritada para los definitivos (sección 6, Definitivos).
 * La Arena la usa para decidir si envía el evento y el servidor la repite sobre `transcript`
 * porque nunca confía en lo que decidió el cliente.
 */
import type { UltimateId } from "@duelo/contracts";
import { ULTIMATES } from "./spells.js";

/** Minúsculas y sin tildes: "¡Vacío PÚRPURA!" → "¡vacio purpura!". */
export function normalizeSpeech(text: string): string {
  // NFD separa la letra de su tilde; luego se borran las marcas combinantes (U+0300–U+036F).
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** true si alguna palabra del texto reconocido es una de las aceptadas por el definitivo. */
export function transcriptMatchesUltimate(ultimateId: UltimateId, transcript: string): boolean {
  const accepted: readonly string[] = ULTIMATES[ultimateId].acceptedWords;
  // Se compara por palabras completas para que "meteorológico" no active Meteoro.
  const words = normalizeSpeech(transcript).split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => accepted.includes(word));
}
