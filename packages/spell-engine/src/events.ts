/**
 * Interfaz de eventos del módulo local. Es lo único que la Arena conoce del motor:
 * si mañana la fuente de eventos cambia (modo teclado, un agente local en Python…),
 * la Arena no se toca.
 *
 * onUltimate lo emite VoiceListener (grito + palabra). onSealCharging y onSealCancel llegarán
 * con la X de dos manos (P2).
 */
import type { SpellId, UltimateId } from "@duelo/contracts";

export interface SpellEvent {
  spellId: SpellId;
  /** 0..1, ya ≥ a la confianza mínima. */
  confidence: number;
}

export interface SpellFailedEvent {
  /** Hechizo al que más se parecía (para depurar), o null si no había candidato. */
  bestGuess: SpellId | null;
  confidence: number;
}

export interface UltimateEvent {
  ultimateId: UltimateId;
  transcript: string;
}

export type SpellEngineErrorCode =
  | "CAMERA_UNSUPPORTED"
  | "CAMERA_DENIED"
  | "CAMERA_NOT_FOUND"
  | "CAMERA_IN_USE"
  | "MEDIAPIPE_LOAD_FAILED"
  // Voz: nunca fatales, solo desactivan los definitivos (sección 11).
  | "MIC_DENIED"
  | "MIC_NOT_FOUND"
  | "SPEECH_UNSUPPORTED"
  | "SPEECH_NETWORK";

export interface SpellEngineError {
  code: SpellEngineErrorCode;
  /** Mensaje en español apto para mostrarse tal cual al jugador. */
  message: string;
  /** Sin cámara o sin MediaPipe no se puede jugar (true); sin micrófono solo se pierden los definitivos (false). */
  fatal: boolean;
  cause?: unknown;
}

export interface SpellEngineHandlers {
  onSpell?: (event: SpellEvent) => void;
  onSpellFailed?: (event: SpellFailedEvent) => void;
  onUltimate?: (event: UltimateEvent) => void;
  onSealCharging?: () => void;
  onSealCancel?: () => void;
  onError?: (error: SpellEngineError) => void;
}

export const ERROR_MESSAGES: Record<SpellEngineErrorCode, string> = {
  CAMERA_UNSUPPORTED:
    "Tu navegador no permite usar la cámara aquí. Abre el juego con https:// (o localhost) en Chrome, Edge o Firefox actualizados.",
  CAMERA_DENIED:
    "Bloqueaste el acceso a la cámara. Haz clic en el ícono del candado junto a la dirección, permite la cámara y recarga la página. Sin cámara no se puede jugar.",
  CAMERA_NOT_FOUND: "No encontramos ninguna cámara. Conecta una webcam y recarga la página.",
  CAMERA_IN_USE:
    "La cámara está ocupada por otra aplicación (Zoom, Meet, Teams u otra pestaña). Ciérrala y recarga la página.",
  MEDIAPIPE_LOAD_FAILED:
    "No se pudo cargar el detector de manos. Recarga la página; si sigue fallando, prueba en Chrome o Edge actualizados.",
  MIC_DENIED:
    "Bloqueaste el micrófono: los definitivos están desactivados. Para usarlos, permite el micrófono en el candado junto a la dirección y recarga. El resto del juego funciona igual.",
  MIC_NOT_FOUND: "No encontramos micrófono: los definitivos están desactivados. El resto del juego funciona igual.",
  SPEECH_UNSUPPORTED:
    "Tu navegador no reconoce voz: los definitivos están desactivados. Usa Chrome o Edge para gritar los definitivos.",
  SPEECH_NETWORK: "El reconocimiento de voz necesita internet. Revisa tu conexión para usar los definitivos.",
};

export function engineError(code: SpellEngineErrorCode, cause?: unknown): SpellEngineError {
  return { code, message: ERROR_MESSAGES[code], fatal: true, cause };
}
