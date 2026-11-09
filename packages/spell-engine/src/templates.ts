/**
 * Plantillas de gestos para el $1.
 *
 * Se generan con código (vértices + interpolación) en lugar de grabarlas, para que sean
 * reproducibles y fáciles de revisar en un PR. Si las pruebas reales con cámara muestran
 * confusiones, se pueden añadir variantes grabadas desde el playground.
 *
 * Coordenadas en "pantalla": x crece a la derecha, y crece hacia abajo, vistas por el jugador
 * (el motor ya corrige el espejo de la cámara antes de llegar aquí).
 */
import type { SpellId } from "@duelo/contracts";
import { createTemplate, type Template } from "./dollar-one";
import type { Point } from "./geometry";

export type GestureTemplate = Template<SpellId>;

/** Une los vértices con puntos intermedios para que se parezca a un trazo real. */
function polyline(vertices: readonly Point[], stepsPerSegment = 16): Point[] {
  const points: Point[] = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  points.push({ ...vertices[vertices.length - 1]! });
  return points;
}

/** Zigzag de izquierda a derecha con `segments` tramos; `startUp` = el primer tramo sube. */
export function zigzagPoints(segments: number, startUp: boolean, width = 300, height = 120): Point[] {
  const vertices: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const high = i % 2 === 0 ? !startUp : startUp;
    vertices.push({ x: (i * width) / segments, y: high ? 0 : height });
  }
  return polyline(vertices);
}

/** Círculo que empieza arriba; `clockwise` en la vista del jugador. */
export function circlePoints(clockwise: boolean, radius = 100, steps = 64): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    // -90° = arriba. Con y hacia abajo, ángulo creciente = sentido horario en pantalla.
    const angle = -Math.PI / 2 + (clockwise ? 1 : -1) * (2 * Math.PI * i) / steps;
    points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return points;
}

/**
 * Plantillas por hechizo. Solo P0 (Rayo y Escudo) por ahora.
 * Corte (`slash`) no tiene plantilla a propósito: la línea se detecta antes del $1.
 */
export const GESTURE_TEMPLATES: Partial<Record<SpellId, GestureTemplate[]>> = {
  lightning: [
    // Cada persona dibuja el rayo con 2, 3 o 4 quiebres y empezando hacia arriba o abajo.
    createTemplate("lightning", zigzagPoints(3, false)),
    createTemplate("lightning", zigzagPoints(3, true)),
    createTemplate("lightning", zigzagPoints(4, false)),
    createTemplate("lightning", zigzagPoints(4, true)),
    createTemplate("lightning", zigzagPoints(5, false)),
    createTemplate("lightning", zigzagPoints(5, true)),
  ],
  shield: [
    // El $1 distingue el sentido de giro, así que hacen falta los dos.
    createTemplate("shield", circlePoints(true)),
    createTemplate("shield", circlePoints(false)),
  ],
};

/** Plantillas que el $1 debe usar: solo las de los hechizos del grimorio del jugador. */
export function templatesFor(grimoire: readonly SpellId[]): GestureTemplate[] {
  return grimoire.flatMap((spellId) => GESTURE_TEMPLATES[spellId] ?? []);
}
