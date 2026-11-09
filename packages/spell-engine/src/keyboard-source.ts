/**
 * Modo teclado, SOLO para pruebas: permite probar la Arena y el game-server sin cámara
 * (por ejemplo, dos pestañas en el mismo PC). Emite los mismos eventos que el motor real,
 * así que la Arena no sabe cuál de los dos está usando.
 *
 * No debe activarse en producción: la Arena lo habilita únicamente en desarrollo.
 */
import type { SpellId } from "@duelo/contracts";
import type { SpellEngineHandlers } from "./events";
import type { SpellSource } from "./spell-source";

/** Tecla → hechizo, en el orden de los espacios del grimorio (1 = Rayo, 2 = Escudo…). */
const SLOT_KEYS = ["1", "2", "3", "4"] as const;

export class KeyboardSpellSource implements SpellSource {
  private grimoire: readonly SpellId[];
  private listening = false;

  constructor(
    grimoire: readonly SpellId[],
    private readonly handlers: SpellEngineHandlers = {},
  ) {
    this.grimoire = grimoire;
  }

  async start(): Promise<boolean> {
    if (!this.listening) window.addEventListener("keydown", this.onKeyDown);
    this.listening = true;
    return true;
  }

  stop(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.listening = false;
  }

  setGrimoire(grimoire: readonly SpellId[]): void {
    this.grimoire = grimoire;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || isTyping(event.target)) return;
    if (event.key === "0") {
      // Simula un trazo mal hecho para probar el aviso de "¡Hechizo fallido!".
      this.handlers.onSpellFailed?.({ bestGuess: null, confidence: 0 });
      return;
    }
    const slot = SLOT_KEYS.indexOf(event.key as (typeof SLOT_KEYS)[number]);
    const spellId = slot >= 0 ? this.grimoire[slot] : undefined;
    if (spellId) this.handlers.onSpell?.({ spellId, confidence: 1 });
  };
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
