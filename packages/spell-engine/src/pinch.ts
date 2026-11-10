/**
 * Detector de pinza (pulgar + índice juntos).
 *
 * La distancia pulgar–índice se divide por el tamaño de la mano (muñeca → nudillo del medio)
 * para que funcione igual con la mano cerca o lejos de la cámara.
 *
 * Usa histéresis (umbral para cerrar < umbral para abrir) y exige varios fotogramas seguidos:
 * sin esto, el temblor natural de la mano abre y cierra la pinza a mitad del trazo y lo corta.
 */
import { distance } from "./geometry";
import { MIDDLE_MCP, THUMB_TIP, INDEX_TIP, WRIST, type Hand } from "./hand";

export interface PinchOptions {
  /** Proporción por debajo de la cual se considera pinza. */
  closeRatio: number;
  /** Proporción por encima de la cual se considera abierta. */
  openRatio: number;
  /** Fotogramas seguidos necesarios para cambiar de estado. */
  stableFrames: number;
}

export const DEFAULT_PINCH_OPTIONS: PinchOptions = {
  closeRatio: 0.3,
  openRatio: 0.45,
  stableFrames: 2,
};

export type PinchTransition = "closed" | "opened" | null;

export function pinchRatio(hand: Hand): number {
  const handSize = distance(hand[WRIST]!, hand[MIDDLE_MCP]!);
  if (handSize === 0) return Infinity;
  return distance(hand[THUMB_TIP]!, hand[INDEX_TIP]!) / handSize;
}

export class PinchDetector {
  private pinched = false;
  private pendingFrames = 0;
  private readonly options: PinchOptions;

  constructor(options: Partial<PinchOptions> = {}) {
    this.options = { ...DEFAULT_PINCH_OPTIONS, ...options };
  }

  get isPinched(): boolean {
    return this.pinched;
  }

  /** Procesa un fotograma y devuelve si la pinza acaba de cerrarse o abrirse. */
  update(hand: Hand): PinchTransition {
    const ratio = pinchRatio(hand);
    const wantsChange = this.pinched ? ratio > this.options.openRatio : ratio < this.options.closeRatio;
    if (!wantsChange) {
      this.pendingFrames = 0;
      return null;
    }
    this.pendingFrames++;
    if (this.pendingFrames < this.options.stableFrames) return null;
    this.pendingFrames = 0;
    this.pinched = !this.pinched;
    return this.pinched ? "closed" : "opened";
  }

  reset(): void {
    this.pinched = false;
    this.pendingFrames = 0;
  }
}
