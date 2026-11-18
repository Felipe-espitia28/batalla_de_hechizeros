/**
 * Protocolo del agente local (mejora de R2, docs/plan-agente-local.md).
 *
 * El agente es un programa que corre en el PC del jugador: un servidor Node en 127.0.0.1 y una
 * ventana del detector (cámara + MediaPipe + $1 + voz). La Arena se conecta a ese servidor por
 * WebSocket y solo recibe eventos ya procesados: nunca viaja video ni audio.
 *
 *   detector ──agent:spell──▶ servidor local ──▶ arena ──combat:cast-spell──▶ game-server
 *   arena ──agent:config──▶ servidor local ──▶ detector
 *
 * Todos los mensajes son JSON con un campo `type` en formato `agent:accion`.
 */
import type { SpellId, UltimateId } from "./common.js";

/** Sube si cambia la forma de un mensaje: el servidor rechaza clientes con otra versión. */
export const LOCAL_AGENT_PROTOCOL_VERSION = 1;

/** Ruta del WebSocket dentro del servidor local. */
export const LOCAL_AGENT_EVENTS_PATH = "/events";

export type LocalAgentRole = "detector" | "arena";

// --- Primer mensaje de cualquier cliente ---

export interface AgentHelloMessage {
  type: "agent:hello";
  role: LocalAgentRole;
  protocolVersion: number;
}

// --- Arena → detector ---

/** La Arena le dice al detector contra qué hechizos comparar y con qué confianza mínima. */
export interface AgentConfigMessage {
  type: "agent:config";
  grimoire: SpellId[];
  ultimateId: UltimateId;
  /** 0..1 (MATCH_RULES.minConfidence de game-rules). */
  minConfidence: number;
}

// --- Detector → arena ---

export type AgentCameraStatus = "loading" | "ready" | "error";

/** Se manda al conectar y cada vez que cambia algo (no en cada fotograma). */
export interface AgentStatusMessage {
  type: "agent:status";
  camera: AgentCameraStatus;
  /** Hay al menos una mano a la vista (la calibración de la Arena lo usa). */
  handVisible: boolean;
  /** Micrófono y reconocimiento de voz listos: sin esto, solo se pierden los definitivos. */
  micReady: boolean;
}

export interface AgentSpellMessage {
  type: "agent:spell";
  spellId: SpellId;
  /** 0..1, ya ≥ a la confianza mínima. */
  confidence: number;
}

export interface AgentSpellFailedMessage {
  type: "agent:spell-failed";
  bestGuess: SpellId | null;
  confidence: number;
}

export interface AgentUltimateMessage {
  type: "agent:ultimate";
  ultimateId: UltimateId;
  transcript: string;
}

export interface AgentSealChargingMessage {
  type: "agent:seal-charging";
}

export interface AgentSealCancelMessage {
  type: "agent:seal-cancel";
}

/**
 * Error de cámara, MediaPipe o micrófono. `code` es uno de SpellEngineErrorCode
 * (packages/spell-engine); aquí va como string para que contracts no dependa del motor.
 */
export interface AgentErrorMessage {
  type: "agent:error";
  code: string;
  /** Mensaje en español apto para mostrarse tal cual al jugador. */
  message: string;
  fatal: boolean;
}

// --- Servidor local → ambos ---

/** Quién está conectado al agente. La Arena muestra "detector cerrado" si `detector` es false. */
export interface AgentPeerMessage {
  type: "agent:peer";
  detector: boolean;
  arena: boolean;
}

export type ArenaToAgentMessage = AgentConfigMessage;

export type DetectorToAgentMessage =
  | AgentStatusMessage
  | AgentSpellMessage
  | AgentSpellFailedMessage
  | AgentUltimateMessage
  | AgentSealChargingMessage
  | AgentSealCancelMessage
  | AgentErrorMessage;

export type LocalAgentMessage =
  | AgentHelloMessage
  | ArenaToAgentMessage
  | DetectorToAgentMessage
  | AgentPeerMessage;

export type LocalAgentMessageType = LocalAgentMessage["type"];

/**
 * Quién puede enviar cada mensaje. El servidor local reenvía un mensaje solo si llega del rol
 * correcto, y lo entrega al otro rol (`peer` y `hello` no se reenvían).
 */
export const LOCAL_AGENT_SENDERS: Record<LocalAgentMessageType, LocalAgentRole | "any" | "server"> = {
  "agent:hello": "any",
  "agent:config": "arena",
  "agent:status": "detector",
  "agent:spell": "detector",
  "agent:spell-failed": "detector",
  "agent:ultimate": "detector",
  "agent:seal-charging": "detector",
  "agent:seal-cancel": "detector",
  "agent:error": "detector",
  "agent:peer": "server",
};

/**
 * Lee un mensaje recibido por el WebSocket. Devuelve null si no es JSON o si su `type`
 * no es del protocolo. No valida cada campo: el servidor solo reenvía y quien lo recibe
 * ya conoce la forma por el tipo.
 */
export function parseLocalAgentMessage(raw: string): LocalAgentMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const type = (data as { type?: unknown }).type;
  if (typeof type !== "string" || !Object.hasOwn(LOCAL_AGENT_SENDERS, type)) return null;
  return data as LocalAgentMessage;
}
