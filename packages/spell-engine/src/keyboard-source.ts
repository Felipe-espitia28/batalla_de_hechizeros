/**
 * Modo teclado (1–4 = espacios del grimorio, 9 = definitivo, 0 = fallido), SOLO para pruebas: permite probar la Arena y el game-server sin cámara
 * (por ejemplo, dos pestañas en el mismo PC). Emite los mismos eventos que el motor real,
 * así que la Arena no sabe cuál de los dos está usando.
 *
 * No debe activarse en producción: la Arena lo habilita únicamente en desarrollo.
 */
import type { SpellId, UltimateId } from "@duelo/contracts";
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
    /** Definitivo equipado: la tecla 9 simula gritarlo. */
    private ultimateId: UltimateId = "meteor",
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

  setUltimate(ultimateId: UltimateId): void {
    this.ultimateId = ultimateId;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || isTyping(event.target)) return;
    if (event.key === "9") {
      // Simula el grito: el transcript es el nombre en español, como lo entregaría Web Speech.
      const words: Record<UltimateId, string> = { meteor: "meteoro", storm: "tormenta", rebirth: "renacer", "purple-void": "vacío" };
      this.handlers.onUltimate?.({ ultimateId: this.ultimateId, transcript: words[this.ultimateId] });
      return;
    }
    if (event.key === "0") {
      // Simula un trazo mal hecho para probar el aviso de "¡Hechizo fallido!".
      this.handlers.onSpellFailed?.({ bestGuess: null, confidence: 0 });
      return;
    }
    const slot = SLOT_KEYS.indexOf(event.key as (typeof SLOT_KEYS)[number]);
    const spellId = slot >= 0 ? this.grimoire[slot] : undefined;
    if (spellId === "silence-seal") {
      // Simula la X: carga y, tras 0,7 s, lanza el Sello (el servidor exige la carga previa).
      this.handlers.onSealCharging?.();
      setTimeout(() => this.handlers.onSpell?.({ spellId, confidence: 1 }), 700);
    } else if (spellId) {
      this.handlers.onSpell?.({ spellId, confidence: 1 });
    }
  };
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
