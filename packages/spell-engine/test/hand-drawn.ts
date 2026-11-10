/**
 * Trazos "a mano" para medir el reconocedor: cada figura con temblor, rotación leve,
 * estiramiento, distinto punto de inicio y sentido. Semilla fija = resultados reproducibles.
 */
import type { SpellId } from "@duelo/contracts";
import type { Point } from "../src/geometry";
import { handDrawnCircle, handDrawnZigzag, polyline, seededRandom } from "./fixtures";

/** Rota, estira y añade temblor alrededor del centro del trazo. */
export function distort(points: readonly Point[], seed: number, opts: { rotateDeg?: number; jitter?: number } = {}): Point[] {
  const random = seededRandom(seed);
  const rotate = (((opts.rotateDeg ?? 12) * (random() * 2 - 1)) * Math.PI) / 180;
  const sx = 0.85 + random() * 0.3;
  const sy = 0.85 + random() * 0.3;
  const jitter = opts.jitter ?? 4;
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  return points.map((p) => {
    const x = p.x * sx;
    const y = p.y * sy;
    return {
      x: 320 + x * cos - y * sin + (random() - 0.5) * 2 * jitter,
      y: 240 + x * sin + y * cos + (random() - 0.5) * 2 * jitter,
    };
  });
}

/** Polígono cerrado empezando en el vértice `start` y en el sentido indicado. */
function polygonFrom(vertices: readonly Point[], start: number, clockwise: boolean): Point[] {
  const n = vertices.length;
  const order = Array.from({ length: n }, (_, i) => vertices[(start + (clockwise ? i : n - i)) % n]!);
  return polyline([...order, order[0]!], 12);
}

const TRIANGLE: Point[] = [{ x: 0, y: -90 }, { x: 100, y: 80 }, { x: -100, y: 80 }];
const SQUARE: Point[] = [{ x: -90, y: -90 }, { x: 90, y: -90 }, { x: 90, y: 90 }, { x: -90, y: 90 }];

/** S de arriba hacia abajo con curvas irregulares. */
function handDrawnS(seed: number): Point[] {
  const random = seededRandom(seed);
  const r1 = 50 + random() * 20;
  const r2 = 50 + random() * 20;
  const pts: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = ((-20 + (-250 * i) / 24) * Math.PI) / 180;
    pts.push({ x: r1 * Math.cos(a), y: -r1 + r1 * Math.sin(a) });
  }
  for (let i = 0; i <= 24; i++) {
    const a = ((-90 + (250 * i) / 24) * Math.PI) / 180;
    pts.push({ x: r2 * Math.cos(a), y: r2 + r2 * Math.sin(a) });
  }
  return pts;
}

/** V con brazos de largo distinto. */
function handDrawnV(seed: number, leftToRight: boolean): Point[] {
  const random = seededRandom(seed);
  const v = [
    { x: -70 - random() * 20, y: -100 + random() * 20 },
    { x: (random() - 0.5) * 20, y: 100 },
    { x: 70 + random() * 20, y: -100 + random() * 30 },
  ];
  return polyline(leftToRight ? v : v.reverse(), 12);
}

export interface Sample {
  expected: SpellId;
  label: string;
  points: Point[];
}

/** Muestras de todas las figuras del $1 (Corte va aparte: no pasa por el $1). */
export function samples(): Sample[] {
  const out: Sample[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const cw = seed % 2 === 0;
    out.push({ expected: "lightning", label: `zigzag ${seed}`, points: distort(handDrawnZigzag(3 + (seed % 3), cw, seed), seed) });
    out.push({ expected: "shield", label: `círculo ${seed}`, points: distort(handDrawnCircle({ clockwise: cw, startDeg: seed * 60 }), seed) });
    out.push({ expected: "fireball", label: `triángulo ${seed}`, points: distort(polygonFrom(TRIANGLE, seed % 3, cw), seed) });
    out.push({ expected: "freeze", label: `cuadrado ${seed}`, points: distort(polygonFrom(SQUARE, seed % 4, cw), seed) });
    out.push({ expected: "heal", label: `V ${seed}`, points: distort(handDrawnV(seed, cw), seed) });
    out.push({ expected: "poison", label: `S ${seed}`, points: distort(handDrawnS(seed), seed) });
  }
  return out;
}
