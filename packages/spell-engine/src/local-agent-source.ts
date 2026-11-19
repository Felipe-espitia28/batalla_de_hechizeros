/**
 * Fuente de hechizos que viene del agente local (mejora de R2, docs/plan-agente-local.md).
 *
 * La cámara, MediaPipe, el $1 y la voz corren en la ventana del detector, un programa aparte en
 * el PC del jugador. La Arena solo abre un WebSocket a 127.0.0.1 y recibe eventos ya procesados
 * (agent:spell, agent:ultimate…), que convierte en los mismos handlers de siempre: para la
 * Arena da igual si el hechizo lo reconoció el motor del navegador, el teclado o el agente.
 *
 * No lee import.meta.env: la URL llega por opción (la Arena la saca de VITE_LOCAL_AGENT_URL).
 */
import {
  LOCAL_AGENT_PROTOCOL_VERSION,
  parseLocalAgentMessage,
  type AgentCameraStatus,
  type AgentConfigMessage,
  type AgentHelloMessage,
  type LocalAgentMessage,
  type SpellId,
  type UltimateId,
} from "@duelo/contracts";
import { engineError, type SpellEngineErrorCode, type SpellEngineHandlers } from "./events";
import type { SpellSource } from "./spell-source";

/** Lo que la Arena necesita saber del agente para el panel y la calibración. */
export interface LocalAgentStatus {
  /** El WebSocket con el agente está abierto. */
  connected: boolean;
  /** La ventana del detector está conectada al agente (agent:peer). */
  detector: boolean;
  /** null hasta que el detector manda su primer agent:status. */
  camera: AgentCameraStatus | null;
  handVisible: boolean;
  micReady: boolean;
}

/** Lo mínimo de WebSocket que se usa: el del navegador sirve tal cual y los tests inyectan uno falso. */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface LocalAgentSourceOptions {
  /** ws://127.0.0.1:<AGENT_PORT>/events (VITE_LOCAL_AGENT_URL en la Arena). */
  url: string;
  grimoire: readonly SpellId[];
  ultimateId: UltimateId;
  minConfidence: number;
  /** Cada cambio de conexión, cámara, mano visible o micrófono. */
  onStatus?: (status: LocalAgentStatus) => void;
  /** Si el agente no responde en este tiempo, start() devuelve false con AGENT_NOT_RUNNING. */
  connectTimeoutMs?: number;
  /** Espera entre reintentos mientras el agente esté cerrado o se haya caído. */
  retryDelayMs?: number;
  createSocket?: (url: string) => WebSocketLike;
}

const OPEN = 1;
/** Códigos de cierre del servidor del agente (apps/local-agent/src/server.ts). */
const CLOSE_BAD_HELLO = 4000;
const CLOSE_REPLACED = 4001;
const CLOSE_PROTOCOL_VERSION = 4003;

const DISCONNECTED: LocalAgentStatus = { connected: false, detector: false, camera: null, handVisible: false, micReady: false };

export class LocalAgentSource implements SpellSource {
  private socket: WebSocketLike | null = null;
  private status: LocalAgentStatus = DISCONNECTED;
  private grimoire: readonly SpellId[];
  private ultimateId: UltimateId;
  private running = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly connectTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly createSocket: (url: string) => WebSocketLike;

  constructor(
    private readonly options: LocalAgentSourceOptions,
    private readonly handlers: SpellEngineHandlers = {},
  ) {
    this.grimoire = options.grimoire;
    this.ultimateId = options.ultimateId;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    this.retryDelayMs = options.retryDelayMs ?? 2000;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  getStatus(): LocalAgentStatus {
    return this.status;
  }

  /**
   * Conecta con el agente. Devuelve false (y emite AGENT_NOT_RUNNING) si no responde a tiempo,
   * pero sigue reintentando en segundo plano: cuando el jugador abra el agente, la Arena se
   * conecta sola y onStatus lo avisa.
   */
  start(): Promise<boolean> {
    if (this.running) return Promise.resolve(this.status.connected);
    this.running = true;
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) this.handlers.onError?.(engineError("AGENT_NOT_RUNNING"));
        resolve(ok);
      };
      const timer = setTimeout(() => settle(false), this.connectTimeoutMs);
      this.connect(() => settle(true), () => settle(false));
    });
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(1000, "La Arena dejó de usar el agente");
    }
    this.setStatus(DISCONNECTED);
  }

  setGrimoire(grimoire: readonly SpellId[]): void {
    this.grimoire = grimoire;
    this.sendConfig();
  }

  setUltimate(ultimateId: UltimateId): void {
    this.ultimateId = ultimateId;
    this.sendConfig();
  }

  private connect(onOpen?: () => void, onFail?: () => void): void {
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.options.url);
    } catch {
      // URL mal formada: no tiene sentido reintentar con la misma.
      onFail?.();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      const hello: AgentHelloMessage = { type: "agent:hello", role: "arena", protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION };
      socket.send(JSON.stringify(hello));
      // Siempre tras el hello: el detector puede haber arrancado con el grimorio por defecto.
      this.sendConfig();
      this.setStatus({ ...DISCONNECTED, connected: true });
      onOpen?.();
    };

    socket.onmessage = (event) => {
      const message = typeof event.data === "string" ? parseLocalAgentMessage(event.data) : null;
      if (message) this.handle(message);
    };

    // Un error siempre viene seguido de close: ahí se decide si reintentar.
    socket.onerror = () => undefined;

    socket.onclose = ({ code }) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const wasConnected = this.status.connected;
      this.setStatus(DISCONNECTED);
      onFail?.();
      if (!this.running) return;

      // Otra pestaña de la Arena tomó el agente: reconectar haría que se quiten el puesto sin fin.
      if (code === CLOSE_REPLACED) {
        this.running = false;
        this.handlers.onError?.(engineError("AGENT_IN_OTHER_TAB"));
        return;
      }
      if (code === CLOSE_BAD_HELLO || code === CLOSE_PROTOCOL_VERSION) {
        this.running = false;
        this.handlers.onError?.(engineError("AGENT_OUTDATED"));
        return;
      }
      // El agente se cerró a mitad de partida: se avisa una vez por caída (no en cada reintento)
      // y se sigue intentando; al reabrirlo, la Arena se reconecta sola.
      if (wasConnected) this.handlers.onError?.(engineError("AGENT_NOT_RUNNING"));
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.running) this.connect();
      }, this.retryDelayMs);
    };
  }

  private handle(message: LocalAgentMessage): void {
    switch (message.type) {
      case "agent:peer":
        // Si se cerró la ventana del detector, lo último que dijo de la cámara ya no vale.
        this.setStatus(
          message.detector
            ? { ...this.status, detector: true }
            : { ...this.status, detector: false, camera: null, handVisible: false, micReady: false },
        );
        break;
      case "agent:status":
        this.setStatus({ ...this.status, camera: message.camera, handVisible: message.handVisible, micReady: message.micReady });
        break;
      case "agent:spell":
        this.handlers.onSpell?.({ spellId: message.spellId, confidence: message.confidence });
        break;
      case "agent:spell-failed":
        this.handlers.onSpellFailed?.({ bestGuess: message.bestGuess, confidence: message.confidence });
        break;
      case "agent:ultimate":
        this.handlers.onUltimate?.({ ultimateId: message.ultimateId, transcript: message.transcript });
        break;
      case "agent:seal-charging":
        this.handlers.onSealCharging?.();
        break;
      case "agent:seal-cancel":
        this.handlers.onSealCancel?.();
        break;
      case "agent:error":
        this.handlers.onError?.({ code: message.code as SpellEngineErrorCode, message: message.message, fatal: message.fatal });
        break;
      default:
        // hello y config no le llegan a la Arena: el servidor no los reenvía.
        break;
    }
  }

  private sendConfig(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    const config: AgentConfigMessage = {
      type: "agent:config",
      grimoire: [...this.grimoire],
      ultimateId: this.ultimateId,
      minConfidence: this.options.minConfidence,
    };
    socket.send(JSON.stringify(config));
  }

  private setStatus(status: LocalAgentStatus): void {
    const s = this.status;
    if (
      s.connected === status.connected &&
      s.detector === status.detector &&
      s.camera === status.camera &&
      s.handVisible === status.handVisible &&
      s.micReady === status.micReady
    ) {
      return;
    }
    this.status = status;
    this.options.onStatus?.(status);
  }
}
