/**
 * Textos en español para lo que decide el servidor. El cliente no interpreta reglas:
 * solo traduce códigos a mensajes.
 */
import type { AckErrorCode, AnySpellId, EndReason } from "@duelo/contracts";

export const SPELL_LABELS: Record<AnySpellId, string> = {
  lightning: "⚡ Rayo",
  shield: "🛡️ Escudo",
  slash: "🗡️ Corte",
  fireball: "🔥 Bola de fuego",
  heal: "💚 Curación",
  poison: "🐍 Veneno",
  freeze: "❄️ Congelar",
  "silence-seal": "✖️ Sello de silencio",
  meteor: "☄️ Meteoro",
  storm: "🌪️ Tormenta",
  rebirth: "✨ Renacer",
  "purple-void": "🟣 Vacío púrpura",
};

/** Cómo se dibuja cada hechizo (ayuda en pantalla). */
export const SPELL_GESTURES: Partial<Record<AnySpellId, string>> = {
  lightning: "zigzag",
  shield: "círculo",
  slash: "línea recta",
};

export const ACK_ERROR_MESSAGES: Record<AckErrorCode, string> = {
  NO_MANA: "No tienes maná suficiente",
  COOLDOWN: "Ese hechizo aún se está recargando",
  SILENCED: "¡Estás sellado! No puedes lanzar",
  NOT_IN_GRIMOIRE: "Ese hechizo no está en tu grimorio",
  RATE_LIMIT: "Demasiado rápido",
  LOW_CONFIDENCE: "¡Hechizo fallido!",
  REQUIREMENT_NOT_MET: "No cumples el requisito de ese hechizo",
  ALREADY_USED: "Ya lo usaste en esta partida",
  MATCH_NOT_ACTIVE: "La partida no está activa",
  SEAL_NOT_CHARGED: "El sello no se cargó a tiempo",
  UNAUTHORIZED: "Tu sesión expiró",
  INVALID_PAYLOAD: "Error de comunicación con el servidor",
  ALREADY_QUEUED: "Ya estás buscando rival",
  ALREADY_IN_MATCH: "Ya estás en una partida",
  MATCH_NOT_FOUND: "La partida ya no existe",
  INTERNAL_ERROR: "Error del servidor; inténtalo de nuevo",
};

export const END_REASON_MESSAGES: Record<EndReason, string> = {
  KO: "Por K.O.",
  TIMEOUT: "Se acabó el tiempo",
  DRAW: "Empate",
  ABANDON: "Por abandono",
};
