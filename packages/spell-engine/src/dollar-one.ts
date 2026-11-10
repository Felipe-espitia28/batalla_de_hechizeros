/**
 * Reconocedor $1 Unistroke (Wobbrock, Wilson y Li, UIST 2007).
 *
 * Se implementa a mano en vez de usar una librería porque son ~100 líneas, no tiene dependencias
 * y así controlamos el puntaje (confianza 0..1) que viaja al servidor.
 *
 * Pasos: remuestrear a N puntos → rotar al "ángulo indicativo" → escalar a un cuadrado →
 * trasladar al origen → comparar contra cada plantilla buscando el mejor ángulo (±45°).
 *
 * Limitación conocida: el escalado no uniforme deforma las líneas rectas; por eso la línea
 * (Corte) se detecta antes con `isStraightStroke` y nunca llega aquí (sección 6 de CLAUDE.md).
 */
import { boundingBox, centroid, distance, pathLength, type Point } from "./geometry";

export const RESAMPLE_POINTS = 64;
const SQUARE_SIZE = 250;
const HALF_DIAGONAL = 0.5 * Math.sqrt(SQUARE_SIZE * SQUARE_SIZE * 2);
const ANGLE_RANGE = degToRad(45);
const ANGLE_PRECISION = degToRad(2);
const PHI = 0.5 * (-1 + Math.sqrt(5));

export interface Template<Name extends string = string> {
  name: Name;
  /** Puntos ya normalizados con `normalizeStroke`. */
  points: Point[];
}

export interface Match<Name extends string = string> {
  name: Name;
  /** 1 = idéntico a la plantilla; 0 = lo más lejos posible. */
  score: number;
}

/** Normaliza un trazo crudo. Se aplica igual a plantillas y a trazos del jugador. */
export function normalizeStroke(raw: readonly Point[]): Point[] {
  let points = resample(raw, RESAMPLE_POINTS);
  points = rotateBy(points, -indicativeAngle(points));
  points = scaleTo(points, SQUARE_SIZE);
  return translateTo(points, { x: 0, y: 0 });
}

export function createTemplate<Name extends string>(name: Name, raw: readonly Point[]): Template<Name> {
  return { name, points: normalizeStroke(raw) };
}

/**
 * Devuelve la plantilla más parecida o `null` si no hay plantillas.
 * Varias plantillas pueden compartir nombre (variantes del mismo gesto): gana la mejor.
 */
export function recognize<Name extends string>(
  raw: readonly Point[],
  templates: readonly Template<Name>[],
): Match<Name> | null {
  if (templates.length === 0 || raw.length < 2) return null;
  const candidate = normalizeStroke(raw);
  let best: Match<Name> | null = null;
  let bestDistance = Infinity;
  for (const template of templates) {
    const d = distanceAtBestAngle(candidate, template.points, -ANGLE_RANGE, ANGLE_RANGE, ANGLE_PRECISION);
    if (d < bestDistance) {
      bestDistance = d;
      best = { name: template.name, score: Math.max(0, 1 - d / HALF_DIAGONAL) };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pasos del algoritmo
// ---------------------------------------------------------------------------

export function resample(raw: readonly Point[], n: number): Point[] {
  const points = raw.map((p) => ({ x: p.x, y: p.y }));
  const interval = pathLength(points) / (n - 1);
  const result: Point[] = [{ ...points[0]! }];
  let accumulated = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const d = distance(prev, curr);
    if (interval > 0 && accumulated + d >= interval) {
      const t = (interval - accumulated) / d;
      const q = { x: prev.x + t * (curr.x - prev.x), y: prev.y + t * (curr.y - prev.y) };
      result.push(q);
      // q pasa a ser el punto anterior del siguiente tramo.
      points.splice(i, 0, q);
      accumulated = 0;
    } else {
      accumulated += d;
    }
  }
  // Por redondeo a veces falta el último punto.
  while (result.length < n) result.push({ ...points[points.length - 1]! });
  return result.slice(0, n);
}

function indicativeAngle(points: readonly Point[]): number {
  const c = centroid(points);
  const first = points[0]!;
  return Math.atan2(c.y - first.y, c.x - first.x);
}

function rotateBy(points: readonly Point[], radians: number): Point[] {
  const c = centroid(points);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }));
}

function scaleTo(points: readonly Point[], size: number): Point[] {
  const box = boundingBox(points);
  // Evita dividir por 0 con trazos degenerados (un punto o una línea perfecta).
  const width = Math.max(box.width, 1e-6);
  const height = Math.max(box.height, 1e-6);
  return points.map((p) => ({ x: (p.x * size) / width, y: (p.y * size) / height }));
}

function translateTo(points: readonly Point[], target: Point): Point[] {
  const c = centroid(points);
  return points.map((p) => ({ x: p.x + target.x - c.x, y: p.y + target.y - c.y }));
}

function pathDistance(a: readonly Point[], b: readonly Point[]): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += distance(a[i]!, b[i]!);
  return d / n;
}

function distanceAtAngle(points: readonly Point[], template: readonly Point[], radians: number): number {
  return pathDistance(rotateBy(points, radians), template);
}

/** Búsqueda de la sección áurea: encuentra la rotación que más acerca el trazo a la plantilla. */
function distanceAtBestAngle(
  points: readonly Point[],
  template: readonly Point[],
  from: number,
  to: number,
  precision: number,
): number {
  let a = from;
  let b = to;
  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = distanceAtAngle(points, template, x1);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = distanceAtAngle(points, template, x2);
  while (Math.abs(b - a) > precision) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = distanceAtAngle(points, template, x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = distanceAtAngle(points, template, x2);
    }
  }
  return Math.min(f1, f2);
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
