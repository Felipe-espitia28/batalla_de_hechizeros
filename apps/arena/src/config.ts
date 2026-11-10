/**
 * Configuración de la Arena. Ninguna URL se escribe en el código: todas salen de variables
 * de entorno (sección 4 de CLAUDE.md).
 */
export const GAME_SERVER_URL: string = import.meta.env.VITE_GAME_SERVER_URL ?? "";
export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

/**
 * Archivos de MediaPipe servidos por la propia Arena (copiados a public/mediapipe en dev y build).
 * Se resuelven contra el origen de ESTE módulo y no contra la página: cuando la Arena corre
 * dentro del shell, la página es del shell pero los archivos viven en el dominio de la Arena.
 */
// Ojo: no usar `new URL("/ruta", import.meta.url)`; Vite reescribe ese patrón como asset propio.
const ARENA_ORIGIN = new URL(import.meta.url).origin;
export const MEDIAPIPE_WASM_PATH = `${ARENA_ORIGIN}/mediapipe/wasm`;
export const MEDIAPIPE_MODEL_PATH = `${ARENA_ORIGIN}/mediapipe/hand_landmarker.task`;

/** Grimorio por defecto (sección 6): Rayo y Escudo fijos en los espacios 1 y 2. */
export const DEFAULT_GRIMOIRE = ["lightning", "shield"] as const;

/**
 * Modo teclado: solo en desarrollo y solo si se pide con ?teclado en la URL.
 * En producción no existe, para que nadie juegue sin cámara.
 */
export function keyboardModeEnabled(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has("teclado");
}
