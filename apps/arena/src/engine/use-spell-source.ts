/**
 * Conecta el módulo local con React. Según el modo (config.ts → spellSourceMode):
 *   - "agent" (por defecto): LocalAgentSource. La cámara, MediaPipe y la voz corren en el agente
 *     local, otro programa del PC del jugador; la Arena NO abre cámara ni micrófono (en Windows
 *     la webcam no se comparte entre programas) y solo recibe eventos por 127.0.0.1.
 *   - "browser": SpellEngine con la cámara del navegador (respaldo si el agente no está).
 *   - "keyboard": KeyboardSpellSource, solo en desarrollo con ?teclado.
 * Libera la cámara o el WebSocket al desmontar (al salir de la Arena).
 */
import type { SpellId, UltimateId } from "@duelo/contracts";
import {
  KeyboardSpellSource,
  LocalAgentSource,
  SpellEngine,
  drawDebug,
  drawSeal,
  drawStroke,
  type LocalAgentStatus,
  type SpellEngineError,
  type SpellEngineHandlers,
  type SpellSource,
} from "@duelo/spell-engine";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  LOCAL_AGENT_URL,
  MEDIAPIPE_MODEL_PATH,
  MEDIAPIPE_WASM_PATH,
  browserCameraChosen,
  chooseBrowserCamera,
  spellSourceMode,
  type SpellSourceMode,
} from "../config";
import type { AgentPanelState } from "../ui/agent-panel-provisional";

export type EngineStatus = "off" | "loading" | "running" | "error";

/** Lo que pinta el panel del agente en el lugar de la cámara. */
export interface AgentView {
  state: AgentPanelState;
  handVisible: boolean;
  lastSpell: { spellId: SpellId; confidence: number } | null;
  errorMessage: string | null;
  /** Micrófono del agente listo: si no, solo se pierden los definitivos. */
  micReady: boolean;
}

export interface SpellSourceState {
  mode: SpellSourceMode;
  /** "running" = se puede jugar (en modo agente: conectado, con detector y cámara lista). */
  status: EngineStatus;
  /** Error de la cámara del navegador (en modo agente los errores van en `agent`). */
  error: SpellEngineError | null;
  keyboard: boolean;
  /** true si se ve al menos una mano (para la calibración). */
  handVisible: boolean;
  /** Solo en modo agente. */
  agent: AgentView | null;
  /** "Usar la cámara del navegador": cambia de modo en esta pestaña. */
  switchToBrowserCamera: () => void;
}

interface Options {
  enabled: boolean;
  grimoire: readonly SpellId[];
  /** Definitivo equipado: lo usan el agente y la tecla 9 del modo teclado. */
  ultimateId: UltimateId;
  /** Confianza mínima del $1 (MATCH_RULES.minConfidence de game-rules). */
  minConfidence: number;
  /** Mostrar esqueleto de la mano (modo depuración, solo cámara del navegador). */
  debug: boolean;
  handlers: SpellEngineHandlers;
  video: RefObject<HTMLVideoElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  /** Cambiarlo reinicia la fuente (botón "Reintentar"). */
  attempt?: number;
}

/** Errores del agente que no son de la cámara: el panel los trata aparte. */
const AGENT_CONNECTION_ERRORS = new Set(["AGENT_NOT_RUNNING", "AGENT_IN_OTHER_TAB", "AGENT_OUTDATED"]);

const NO_AGENT: LocalAgentStatus = { connected: false, detector: false, camera: null, handVisible: false, micReady: false };

export function useSpellSource({
  enabled,
  grimoire,
  ultimateId,
  minConfidence,
  debug,
  handlers,
  video,
  canvas,
  attempt = 0,
}: Options): SpellSourceState {
  const [browserChosen, setBrowserChosen] = useState(browserCameraChosen);
  const mode = spellSourceMode(browserChosen);
  const keyboard = mode === "keyboard";

  const [status, setStatus] = useState<EngineStatus>("off");
  const [error, setError] = useState<SpellEngineError | null>(null);
  const [handVisible, setHandVisible] = useState(false);
  const [agentStatus, setAgentStatus] = useState<LocalAgentStatus>(NO_AGENT);
  const [agentError, setAgentError] = useState<SpellEngineError | null>(null);
  const [lastSpell, setLastSpell] = useState<AgentView["lastSpell"]>(null);
  const sourceRef = useRef<SpellSource | null>(null);

  // Los handlers cambian en cada render; la fuente guarda una referencia estable que los lee aquí.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const debugRef = useRef(debug);
  debugRef.current = debug;

  useEffect(() => {
    if (!enabled) return;
    const stable: SpellEngineHandlers = {
      onSpell: (e) => {
        if (mode === "agent") setLastSpell(e);
        handlersRef.current.onSpell?.(e);
      },
      onSpellFailed: (e) => handlersRef.current.onSpellFailed?.(e),
      onUltimate: (e) => handlersRef.current.onUltimate?.(e),
      onSealCharging: () => handlersRef.current.onSealCharging?.(),
      onSealCancel: () => handlersRef.current.onSealCancel?.(),
      onError: (e) => {
        if (mode === "agent") {
          // Sin micrófono en el agente solo se pierden los definitivos: no es un error del panel.
          if (e.fatal) setAgentError(e);
        } else {
          setError(e);
          setStatus("error");
        }
        handlersRef.current.onError?.(e);
      },
    };

    let source: SpellSource;
    if (mode === "keyboard") {
      source = new KeyboardSpellSource(grimoire, stable, ultimateId);
    } else if (mode === "agent") {
      source = new LocalAgentSource(
        {
          url: LOCAL_AGENT_URL,
          grimoire,
          ultimateId,
          minConfidence,
          onStatus: (s) => {
            setAgentStatus(s);
            // Conectó (también tras reabrir el agente): el aviso de "no encontrado" ya no vale.
            if (s.connected) setAgentError((current) => (current && AGENT_CONNECTION_ERRORS.has(current.code) ? null : current));
            // Cámara del detector lista de nuevo: se olvida el error de cámara anterior.
            if (s.camera === "ready") setAgentError((current) => (current && !AGENT_CONNECTION_ERRORS.has(current.code) ? null : current));
          },
        },
        stable,
      );
    } else {
      const videoEl = video.current;
      if (!videoEl) return;
      let lastHandVisible = false;
      source = new SpellEngine(
        {
          video: videoEl,
          wasmBasePath: MEDIAPIPE_WASM_PATH,
          modelAssetPath: MEDIAPIPE_MODEL_PATH,
          grimoire,
          minConfidence,
          onFrame(snapshot, size) {
            const visible = snapshot.hands.length > 0;
            // Solo re-renderiza React cuando cambia, no 30 veces por segundo.
            if (visible !== lastHandVisible) {
              lastHandVisible = visible;
              setHandVisible(visible);
            }
            const c = canvas.current;
            const ctx = c?.getContext("2d");
            if (!c || !ctx) return;
            if (c.width !== size.width || c.height !== size.height) {
              c.width = size.width;
              c.height = size.height;
            }
            ctx.clearRect(0, 0, c.width, c.height);
            if (debugRef.current) drawDebug(ctx, snapshot);
            drawStroke(ctx, snapshot.stroke);
            drawSeal(ctx, snapshot);
          },
        },
        stable,
      );
    }

    sourceRef.current = source;
    setError(null);
    setAgentError(null);
    setStatus("loading");
    let cancelled = false;
    void source.start().then((ok) => {
      // En modo agente el estado real lo da onStatus (puede conectar más tarde, al abrir el agente).
      if (!cancelled && ok && mode !== "agent") setStatus("running");
    });

    return () => {
      cancelled = true;
      source.stop();
      sourceRef.current = null;
      setStatus("off");
      setHandVisible(false);
      setAgentStatus(NO_AGENT);
      setLastSpell(null);
    };
    // El grimorio y el definitivo se actualizan sin reiniciar la fuente (efectos de abajo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, attempt]);

  useEffect(() => {
    sourceRef.current?.setGrimoire(grimoire);
  }, [grimoire]);

  // El definitivo llega con el inventario, después de crear la fuente.
  useEffect(() => {
    const source = sourceRef.current;
    if (source instanceof KeyboardSpellSource || source instanceof LocalAgentSource) source.setUltimate(ultimateId);
  }, [ultimateId, status, agentStatus.connected]);

  const switchToBrowserCamera = useCallback(() => {
    chooseBrowserCamera();
    setBrowserChosen(true);
  }, []);

  if (mode === "agent") {
    const agentReady = agentStatus.connected && agentStatus.detector && agentStatus.camera === "ready";
    return {
      mode,
      status: !enabled ? "off" : agentReady ? "running" : "loading",
      error: null,
      keyboard,
      handVisible: agentStatus.handVisible,
      agent: {
        state: agentPanelState(agentStatus, agentError),
        handVisible: agentStatus.handVisible,
        lastSpell,
        errorMessage: agentError?.message ?? null,
        micReady: agentStatus.micReady,
      },
      switchToBrowserCamera,
    };
  }

  return { mode, status, error, keyboard, handVisible: keyboard || handVisible, agent: null, switchToBrowserCamera };
}

function agentPanelState(s: LocalAgentStatus, error: SpellEngineError | null): AgentPanelState {
  if (!s.connected) {
    if (error?.code === "AGENT_NOT_RUNNING") return "not-found";
    // Otra pestaña con el agente o versiones distintas: el panel muestra el mensaje y Reintentar.
    if (error && AGENT_CONNECTION_ERRORS.has(error.code)) return "camera-error";
    return "connecting";
  }
  if (!s.detector) return "detector-closed";
  if (s.camera === "error" || (error && !AGENT_CONNECTION_ERRORS.has(error.code))) return "camera-error";
  return "connected";
}
