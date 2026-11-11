/**
 * X del Sello de silencio (sección 6 de CLAUDE.md):
 *   - dos manos visibles;
 *   - los segmentos base→punta de los dos índices (nudillo 5 → punta 8) se cruzan;
 *   - el ángulo entre ellos está entre 45° y 135°;
 *   - se sostiene 0,7 s seguidos.
 * Al formarse la X se emite `seal-charging` (el servidor solo acepta el Sello si lo recibió al
 * menos 0,6 s antes); si la X se deshace antes de tiempo, `seal-cancel` sin gastar maná.
 *
 * Lógica pura: recibe las manos de cada fotograma con su hora, así se prueba sin cámara.
 */
import type { Point } from "./geometry";
import { INDEX_MCP, INDEX_TIP, type Hand } from "./hand";

export type SealEvent =
  | { kind: "seal-charging" }
  | { kind: "seal-cancel" }
  /** X sostenida el tiempo completo: se lanza el Sello. */
  | { kind: "seal-cast"; confidence: number };

export interface SealDetectorOptions {
  holdMs?: number;
  minAngleDeg?: number;
  maxAngleDeg?: number;
  /**
   * Tolerancia a fotogramas sueltos sin X (MediaPipe pierde una mano un instante, o el temblor
   * separa los dedos): sin esto el Sello se cancelaría casi siempre.
   */
  graceMs?: number;
}

type State = { kind: "idle" } | { kind: "charging"; since: number; lastSeen: number } | { kind: "fired"; lastSeen: number };

export class SealDetector {
  private state: State = { kind: "idle" };
  private readonly holdMs: number;
  private readonly minAngle: number;
  private readonly maxAngle: number;
  private readonly graceMs: number;

  constructor(options: SealDetectorOptions = {}) {
    this.holdMs = options.holdMs ?? 700;
    this.minAngle = options.minAngleDeg ?? 45;
    this.maxAngle = options.maxAngleDeg ?? 135;
    this.graceMs = options.graceMs ?? 150;
  }

  /** 0..1 mientras se carga (para el círculo de carga); null si no hay X. */
  progress(time: number): number | null {
    if (this.state.kind !== "charging") return null;
    return Math.min(1, (time - this.state.since) / this.holdMs);
  }

  update(hands: readonly Hand[], time: number): SealEvent | null {
    const crossed = this.isCross(hands);
    const s = this.state;

    if (s.kind === "idle") {
      if (!crossed) return null;
      this.state = { kind: "charging", since: time, lastSeen: time };
      return { kind: "seal-charging" };
    }

    if (s.kind === "charging") {
      if (crossed) {
        s.lastSeen = time;
        if (time - s.since >= this.holdMs) {
          this.state = { kind: "fired", lastSeen: time };
          // La X es geométrica (se cruza o no): confianza 1, igual que la línea del Corte.
          return { kind: "seal-cast", confidence: 1 };
        }
        return null;
      }
      if (time - s.lastSeen > this.graceMs) {
        this.state = { kind: "idle" };
        return { kind: "seal-cancel" };
      }
      return null;
    }

    // Ya se lanzó: hay que deshacer la X antes de poder cargar otra (evita lanzar sin querer).
    if (crossed) s.lastSeen = time;
    else if (time - s.lastSeen > this.graceMs) this.state = { kind: "idle" };
    return null;
  }

  reset(): void {
    this.state = { kind: "idle" };
  }

  /** ¿Las dos primeras manos forman la X? */
  isCross(hands: readonly Hand[]): boolean {
    if (hands.length < 2) return false;
    const a0 = hands[0]![INDEX_MCP]!;
    const a1 = hands[0]![INDEX_TIP]!;
    const b0 = hands[1]![INDEX_MCP]!;
    const b1 = hands[1]![INDEX_TIP]!;
    if (!segmentsIntersect(a0, a1, b0, b1)) return false;
    const angle = angleBetween(a0, a1, b0, b1);
    return angle >= this.minAngle && angle <= this.maxAngle;
  }
}

/** Ángulo (0–180°) entre los vectores p0→p1 y q0→q1. */
export function angleBetween(p0: Point, p1: Point, q0: Point, q1: Point): number {
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const vx = q1.x - q0.x;
  const vy = q1.y - q0.y;
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (len === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / len));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** ¿Se cruzan los segmentos p0–p1 y q0–q1? (prueba de orientación clásica). */
export function segmentsIntersect(p0: Point, p1: Point, q0: Point, q1: Point): boolean {
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = cross(q0, q1, p0);
  const d2 = cross(q0, q1, p1);
  const d3 = cross(p0, p1, q0);
  const d4 = cross(p0, p1, q1);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
