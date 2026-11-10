/**
 * Textos y formatos de la interfaz. Funciones puras: se prueban sin navegador.
 */
import type { EndReason, MatchResult, RankName } from "@duelo/contracts";
import { RANK_TIERS } from "@duelo/game-rules";

export const RESULT_LABELS: Record<MatchResult, string> = {
  win: "Victoria",
  loss: "Derrota",
  draw: "Empate",
};

export const END_REASON_LABELS: Record<EndReason, string> = {
  KO: "KO",
  TIMEOUT: "Tiempo",
  DRAW: "Empate",
  ABANDON: "Abandono",
};

/** "+25", "−15", "0": con signo menos tipográfico para que se lea bien en la tabla. */
export function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

/** 65000 → "1:05". Las partidas duran como máximo 90 s, así que minutos:segundos basta. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Fecha corta en español de Colombia; la zona horaria es la del navegador del jugador. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Cuánto falta para el siguiente rango, con la misma tabla que usa el api (game-rules).
 * `null` en el rango más alto.
 */
export function nextRankProgress(rating: number): { next: RankName; missing: number } | null {
  // RANK_TIERS va de mayor a menor: el siguiente es el de umbral más bajo que aún no se alcanza.
  const above = RANK_TIERS.filter((tier) => tier.minRating > rating);
  const next = above[above.length - 1];
  return next ? { next: next.name, missing: next.minRating - rating } : null;
}
