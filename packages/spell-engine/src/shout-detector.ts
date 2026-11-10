/**
 * Decide si hubo un definitivo: grito (volumen sobre el umbral) Y la palabra correcta (sección 6).
 * Es lógica pura: recibe niveles de volumen y textos reconocidos con su hora, así se prueba sin
 * micrófono. VoiceListener le pasa los datos reales de Web Audio y Web Speech.
 *
 * Por qué una ventana de tiempo: Web Speech entrega el texto entre 0,3 y 1,5 s DESPUÉS de que el
 * jugador habló, cuando el volumen ya bajó. Se acepta el texto si hubo un grito poco antes.
 */
import type { UltimateId } from "@duelo/contracts";
import { transcriptMatchesUltimate } from "@duelo/game-rules";
import type { UltimateEvent } from "./events";

export interface ShoutDetectorOptions {
  ultimateId: UltimateId;
  /**
   * Nivel RMS (0..1) a partir del cual se considera grito. 0,12 ≈ −18 dBFS: una voz normal a
   * 50 cm del micrófono de un portátil suele quedar en 0,02–0,08. Ajustable porque cada
   * micrófono tiene su propia ganancia.
   */
  shoutThreshold?: number;
  /** Cuánto tiempo después del grito se acepta el texto reconocido. */
  windowMs?: number;
  /** Tras un definitivo, se ignoran repeticiones (Web Speech manda el mismo texto varias veces). */
  cooldownMs?: number;
}

export const DEFAULT_SHOUT_THRESHOLD = 0.12;

export class ShoutDetector {
  private ultimateId: UltimateId;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private lastShoutAt = -Infinity;
  private lastFiredAt = -Infinity;

  constructor(options: ShoutDetectorOptions) {
    this.ultimateId = options.ultimateId;
    this.threshold = options.shoutThreshold ?? DEFAULT_SHOUT_THRESHOLD;
    this.windowMs = options.windowMs ?? 2000;
    this.cooldownMs = options.cooldownMs ?? 3000;
  }

  setUltimate(ultimateId: UltimateId): void {
    this.ultimateId = ultimateId;
  }

  /** true si este nivel cuenta como grito (para pintar el medidor). */
  isShout(level: number): boolean {
    return level >= this.threshold;
  }

  feedLevel(level: number, time: number): void {
    if (this.isShout(level)) this.lastShoutAt = time;
  }

  /** Devuelve el evento si el texto es la palabra del definitivo y hubo grito reciente. */
  feedTranscript(transcript: string, time: number): UltimateEvent | null {
    if (time - this.lastFiredAt < this.cooldownMs) return null;
    if (time - this.lastShoutAt > this.windowMs) return null;
    if (!transcriptMatchesUltimate(this.ultimateId, transcript)) return null;
    this.lastFiredAt = time;
    // Solo viaja el texto reconocido (R2): el servidor vuelve a validarlo, nunca el audio.
    return { ultimateId: this.ultimateId, transcript: transcript.trim() };
  }
}
