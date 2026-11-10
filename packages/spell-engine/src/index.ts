// API pública del módulo local. La Arena solo debería importar desde aquí.
export { SpellEngine, type SpellEngineOptions } from "./spell-engine";
export { KeyboardSpellSource } from "./keyboard-source";
export type { SpellSource } from "./spell-source";
export { VoiceListener, getSpeechRecognition, type VoiceListenerOptions } from "./voice-listener";
export { ShoutDetector, DEFAULT_SHOUT_THRESHOLD } from "./shout-detector";
export type {
  SpellEngineError,
  SpellEngineErrorCode,
  SpellEngineHandlers,
  SpellEvent,
  SpellFailedEvent,
  UltimateEvent,
} from "./events";
export { ERROR_MESSAGES } from "./events";
export type { GestureSnapshot } from "./gesture-processor";
export { GestureProcessor } from "./gesture-processor";
export { classifyStroke, isStraightStroke, DEFAULT_MIN_CONFIDENCE, type ClassifyResult } from "./classifier";
export { drawDebug, drawStroke } from "./debug";
export type { Point } from "./geometry";
export type { Hand } from "./hand";
