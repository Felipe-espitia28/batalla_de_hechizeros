/**
 * Contrato común de cualquier fuente de hechizos (cámara, teclado o, en el futuro, un agente
 * local externo). La Arena solo depende de esto y de SpellEngineHandlers.
 */
import type { SpellId } from "@duelo/contracts";

export interface SpellSource {
  /** Devuelve false si no pudo arrancar (el motivo llega por onError). */
  start(): Promise<boolean>;
  /** Libera cámara, micrófono y listeners. Seguro de llamar varias veces. */
  stop(): void;
  setGrimoire(grimoire: readonly SpellId[]): void;
}
