/**
 * Procesador de gestos: recibe las manos de cada fotograma y decide cuándo empieza, avanza
 * y termina un trazo. No sabe nada de cámaras ni de MediaPipe, así que se prueba con manos
 * sintéticas en los tests.
 */
import type { SpellId } from "@duelo/contracts";
import { classifyStroke, type ClassifyResult } from "./classifier";
import { distance, type Point } from "./geometry";
import { INDEX_TIP, type Hand } from "./hand";
import { PinchDetector, type PinchOptions } from "./pinch";
import { SealDetector, type SealDetectorOptions, type SealEvent } from "./seal-detector";

/** Lo que puede salir de un fotograma: el final de un trazo o un evento del Sello. */
export type GestureResult = ClassifyResult | SealEvent;

export interface GestureFrame {
  /** Manos detectadas, en píxeles y ya corregidas por el espejo. */
  hands: Hand[];
  width: number;
  height: number;
  /** ms (performance.now()). */
  time: number;
}

export interface GestureProcessorOptions {
  grimoire: readonly SpellId[];
  minConfidence?: number;
  pinch?: Partial<PinchOptions>;
  /** Tiempo sin ver la mano antes de descartar el trazo en curso. */
  lostHandTimeoutMs?: number;
  seal?: SealDetectorOptions;
}

export interface GestureSnapshot {
  hands: Hand[];
  isPinched: boolean;
  /** Trazo en curso (para dibujar la estela). Vacío si no se está dibujando. */
  stroke: Point[];
  /** true mientras hay dos manos: el dibujo con pinza se pausa (sección 6). */
  twoHandsPaused: boolean;
  /** 0..1 mientras se carga la X del Sello (círculo de carga); null si no. */
  sealProgress: number | null;
}

/** Suavizado exponencial de la punta del índice: quita el temblor sin meter mucho retraso. */
const SMOOTHING = 0.5;
/** No se agregan puntos más cercanos que esto (px): evita amontonar puntos con la mano quieta. */
const MIN_POINT_GAP = 2;

export class GestureProcessor {
  private grimoire: readonly SpellId[];
  private readonly minConfidence: number | undefined;
  private readonly lostHandTimeoutMs: number;
  private readonly pinch: PinchDetector;
  private stroke: Point[] = [];
  private drawing = false;
  private lastHandSeenAt = 0;
  private readonly seal: SealDetector;
  private snapshot: GestureSnapshot = { hands: [], isPinched: false, stroke: [], twoHandsPaused: false, sealProgress: null };

  constructor(options: GestureProcessorOptions) {
    this.grimoire = options.grimoire;
    this.minConfidence = options.minConfidence;
    this.lostHandTimeoutMs = options.lostHandTimeoutMs ?? 250;
    this.pinch = new PinchDetector(options.pinch);
    this.seal = new SealDetector(options.seal);
  }

  setGrimoire(grimoire: readonly SpellId[]): void {
    this.grimoire = grimoire;
    if (!this.hasSeal) this.seal.reset();
  }

  /** Sin el Sello en el grimorio, las dos manos solo pausan el dibujo: no se detecta la X. */
  private get hasSeal(): boolean {
    return this.grimoire.includes("silence-seal");
  }

  getSnapshot(): GestureSnapshot {
    return this.snapshot;
  }

  /** Procesa un fotograma. Devuelve algo solo cuando termina un trazo o cambia el Sello. */
  process(frame: GestureFrame): GestureResult | null {
    // La X va primero (sección 6: dos manos → Sello) y también recibe los fotogramas con una
    // mano o ninguna, para poder cancelar la carga cuando se separan.
    const sealEvent = this.hasSeal ? this.seal.update(frame.hands, frame.time) : null;
    const result = this.step(frame);
    this.snapshot = {
      hands: frame.hands,
      isPinched: this.pinch.isPinched,
      stroke: this.drawing ? [...this.stroke] : [],
      twoHandsPaused: frame.hands.length >= 2,
      sealProgress: this.hasSeal ? this.seal.progress(frame.time) : null,
    };
    return sealEvent ?? result;
  }

  private step(frame: GestureFrame): ClassifyResult | null {
    if (frame.hands.length >= 2) {
      // La X del Sello tiene prioridad; mientras haya dos manos no se dibuja.
      this.cancelStroke();
      return null;
    }

    const hand = frame.hands[0];
    if (!hand) {
      // Tolerancia: MediaPipe pierde la mano un par de fotogramas con movimientos rápidos.
      if (this.drawing && frame.time - this.lastHandSeenAt > this.lostHandTimeoutMs) this.cancelStroke();
      return null;
    }
    this.lastHandSeenAt = frame.time;

    const transition = this.pinch.update(hand);
    const tip = hand[INDEX_TIP]!;

    if (transition === "closed") {
      this.drawing = true;
      this.stroke = [{ ...tip }];
      return null;
    }

    if (transition === "opened" && this.drawing) {
      const points = this.stroke;
      this.drawing = false;
      this.stroke = [];
      return classifyStroke(points, {
        grimoire: this.grimoire,
        frameWidth: frame.width,
        ...(this.minConfidence !== undefined ? { minConfidence: this.minConfidence } : {}),
      });
    }

    if (this.drawing) {
      const last = this.stroke[this.stroke.length - 1]!;
      const smoothed = {
        x: last.x + SMOOTHING * (tip.x - last.x),
        y: last.y + SMOOTHING * (tip.y - last.y),
      };
      if (distance(last, smoothed) >= MIN_POINT_GAP) this.stroke.push(smoothed);
    }
    return null;
  }

  private cancelStroke(): void {
    this.drawing = false;
    this.stroke = [];
    this.pinch.reset();
  }
}
