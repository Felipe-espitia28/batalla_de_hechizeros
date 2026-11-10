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

/** Polígono cerrado: vuelve al primer vértice. `clockwise` en la vista del jugador. */
function closedPolygon(vertices: readonly Point[], clockwise: boolean): Point[] {
  const ordered = clockwise ? [...vertices] : [vertices[0]!, ...vertices.slice(1).reverse()];
  return polyline([...ordered, ordered[0]!]);
}

/** Triángulo (Bola de fuego) que empieza en el vértice de arriba. */
export function trianglePoints(clockwise: boolean, size = 200): Point[] {
  const h = (size * Math.sqrt(3)) / 2;
  return closedPolygon(
    [
      { x: 0, y: -h / 2 },
      { x: size / 2, y: h / 2 },
      { x: -size / 2, y: h / 2 },
    ],
    clockwise,
  );
}

/** Cuadrado (Congelar) que empieza en la esquina de arriba a la izquierda. */
export function squarePoints(clockwise: boolean, size = 200): Point[] {
  const s = size / 2;
  return closedPolygon(
    [
      { x: -s, y: -s },
      { x: s, y: -s },
      { x: s, y: s },
      { x: -s, y: s },
    ],
    clockwise,
  );
}

/** V (Curación): baja y sube. `leftToRight` = empieza en la punta izquierda. */
export function vPoints(leftToRight: boolean, width = 140, height = 200): Point[] {
  const w = width / 2;
  const h = height / 2;
  const vertices = [
    { x: -w, y: -h },
    { x: 0, y: h },
    { x: w, y: -h },
  ];
  return polyline(leftToRight ? vertices : vertices.reverse());
}

/**
 * S (Veneno) dibujada de arriba hacia abajo (sección 6): arco superior hacia la izquierda
 * y arco inferior hacia la derecha, como se escribe a mano.
 */
export function sPoints(radius = 60, steps = 32): Point[] {
  const points: Point[] = [];
  const arc = (cy: number, fromDeg: number, toDeg: number) => {
    for (let i = 0; i <= steps; i++) {
      const angle = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
      points.push({ x: radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    }
  };
  // Con y hacia abajo: -90° es arriba. Arco de arriba en sentido antihorario hasta el centro,
  // arco de abajo en sentido horario hasta abajo a la izquierda.
  arc(-radius, -20, -270);
  arc(radius, -90, 160);
  return points;
}

/**
 * Plantillas por hechizo (sección 6).
 * Corte (`slash`) no tiene plantilla a propósito: la línea se detecta antes del $1.
 * El Sello de silencio tampoco: es la X de dos manos, no un trazo.
 *
 * Las figuras cerradas no necesitan una plantilla por vértice de inicio: el $1 rota el trazo
 * a su "ángulo indicativo", y empezar en otra esquina equivale a rotar la figura.
 * Sí hacen falta los dos sentidos de giro, porque el $1 compara los puntos en orden.
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
  fireball: [createTemplate("fireball", trianglePoints(true)), createTemplate("fireball", trianglePoints(false))],
  heal: [createTemplate("heal", vPoints(true)), createTemplate("heal", vPoints(false))],
  poison: [createTemplate("poison", sPoints())],
  freeze: [createTemplate("freeze", squarePoints(true)), createTemplate("freeze", squarePoints(false))],
};

/** Plantillas que el $1 debe usar: solo las de los hechizos del grimorio del jugador. */
export function templatesFor(grimoire: readonly SpellId[]): GestureTemplate[] {
  return grimoire.flatMap((spellId) => GESTURE_TEMPLATES[spellId] ?? []);
}
