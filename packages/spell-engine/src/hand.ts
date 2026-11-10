/**
 * Índices de los 21 puntos de la mano de MediaPipe HandLandmarker.
 * https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
 */
import type { Point } from "./geometry";

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;

/** Una mano = 21 puntos en píxeles del fotograma, ya corregidos por el espejo. */
export type Hand = Point[];

/** Conexiones entre puntos para dibujar el esqueleto en el modo de depuración. */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
