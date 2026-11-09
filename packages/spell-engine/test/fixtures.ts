/**
 * Generadores de trazos y manos sintéticas para los tests.
 * Ruido con semilla fija: los tests deben dar siempre el mismo resultado.
 */
import type { Hand } from "../src/hand";
import type { Point } from "../src/geometry";

/** PRNG mulberry32: determinista y suficiente para ruido de prueba. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Variation {
  scale?: number;
  offset?: Point;
  /** Amplitud del temblor en px. */
  jitter?: number;
  seed?: number;
}

export function vary(points: readonly Point[], { scale = 1, offset = { x: 320, y: 240 }, jitter = 0, seed = 1 }: Variation = {}): Point[] {
  const random = seededRandom(seed);
  return points.map((p) => ({
    x: p.x * scale + offset.x + (random() - 0.5) * 2 * jitter,
    y: p.y * scale + offset.y + (random() - 0.5) * 2 * jitter,
  }));
}

/** Une vértices con `steps` puntos por tramo, como haría la cámara a ~30 fps. */
export function polyline(vertices: readonly Point[], steps = 10): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    for (let s = 0; s < steps; s++) out.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
  }
  out.push({ ...vertices[vertices.length - 1]! });
  return out;
}

/** Zigzag "a mano": quiebres con alturas y anchos irregulares. */
export function handDrawnZigzag(peaks: number, startUp: boolean, seed: number): Point[] {
  const random = seededRandom(seed);
  const vertices: Point[] = [];
  let x = -150;
  const step = 300 / peaks;
  for (let i = 0; i <= peaks; i++) {
    const high = i % 2 === 0 ? !startUp : startUp;
    vertices.push({ x, y: (high ? -50 : 50) + (random() - 0.5) * 30 });
    x += step * (0.8 + random() * 0.4);
  }
  return polyline(vertices);
}

/** Círculo/elipse "a mano" que empieza en un ángulo cualquiera y cierra un poco de más o de menos. */
export function handDrawnCircle(opts: { clockwise: boolean; startDeg: number; rx?: number; ry?: number; sweepDeg?: number }): Point[] {
  const { clockwise, startDeg, rx = 100, ry = 100, sweepDeg = 360 } = opts;
  const points: Point[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const angle = ((startDeg + (clockwise ? 1 : -1) * (sweepDeg * i) / steps) * Math.PI) / 180;
    points.push({ x: rx * Math.cos(angle), y: ry * Math.sin(angle) });
  }
  return points;
}

/**
 * Mano sintética de 21 puntos con la punta del índice en `tip`.
 * Tamaño de mano (muñeca → nudillo del medio) = 100 px.
 */
export function syntheticHand(tip: Point, pinched: boolean): Hand {
  const wrist = { x: tip.x, y: tip.y + 150 };
  const hand: Hand = Array.from({ length: 21 }, () => ({ ...wrist }));
  hand[9] = { x: tip.x, y: tip.y + 50 };
  hand[8] = { ...tip };
  // Pinza: proporción 0,1 (cerrada) o 0,8 (abierta).
  hand[4] = { x: tip.x + (pinched ? 10 : 80), y: tip.y };
  return hand;
}
