/**
 * Ventana del detector del agente local (mejora de R2, docs/plan-agente-local.md). Dueño: Juan.
 *
 * Aquí corre todo lo pesado: la cámara, MediaPipe, el $1 y la voz. A la Arena solo le llegan
 * eventos (agent:spell, agent:ultimate…) por el WebSocket del agente en 127.0.0.1: nunca video
 * ni audio. MediaPipe se sirve desde el propio agente (./mediapipe), así que los gestos siguen
 * funcionando sin internet.
 *
 * El HTML y el CSS son de Angel. Los IDs están acordados en docs/prompts-agente-local.md; si
 * alguno falta, se crea un elemento mínimo para no romper la ventana.
 */
import {
  LOCAL_AGENT_EVENTS_PATH,
  LOCAL_AGENT_PROTOCOL_VERSION,
  parseLocalAgentMessage,
  type AgentCameraStatus,
  type AgentHelloMessage,
  type AgentStatusMessage,
  type DetectorToAgentMessage,
  type SpellId,
  type UltimateId,
} from "@duelo/contracts";
import { MATCH_RULES, SPELLS, ULTIMATES } from "@duelo/game-rules";
import { SpellEngine, VoiceListener, drawSeal, drawStroke, type SpellEngineError, type SpellEngineHandlers } from "@duelo/spell-engine";

// --- Elementos de la ventana -----------------------------------------------------------------

function element<T extends HTMLElement>(id: string, create: () => T): T {
  const existing = document.getElementById(id);
  if (existing) return existing as T;
  const el = create();
  el.id = id;
  (document.getElementById("detector") ?? document.body).append(el);
  return el;
}

const video = element("camera-video", () => Object.assign(document.createElement("video"), { playsInline: true, muted: true }));
const canvas = element("camera-canvas", () => document.createElement("canvas"));
const cameraStatus = element("status", () => document.createElement("p"));
const arenaStatus = element("arena-status", () => document.createElement("p"));
const micStatus = element("mic-status", () => document.createElement("p"));
const micMeter = element("mic-meter", () => document.createElement("div"));
const eventLog = element("event-log", () => document.createElement("ol"));
const ctx = canvas.getContext("2d");

const MAX_LOG_ITEMS = 10;
const RECONNECT_MS = 2000;

// MediaPipe se pide al mismo servidor del agente: rutas absolutas desde la página.
const WASM_PATH = new URL("./mediapipe/wasm", window.location.href).href;
const MODEL_PATH = new URL("./mediapipe/hand_landmarker.task", window.location.href).href;

// --- Estado que se le cuenta a la Arena -----------------------------------------------------

/** Hasta que la Arena mande agent:config se usa lo que recibe toda cuenta nueva. */
let grimoire: SpellId[] = ["lightning", "shield"];
let ultimateId: UltimateId = "meteor";
let minConfidence: number = MATCH_RULES.minConfidence;

const status: Omit<AgentStatusMessage, "type"> = { camera: "loading", handVisible: false, micReady: false };

function setStatus(patch: Partial<typeof status>): void {
  const next = { ...status, ...patch };
  // Solo cuando algo cambia: la mano visible se evalúa 30 veces por segundo.
  if (next.camera === status.camera && next.handVisible === status.handVisible && next.micReady === status.micReady) return;
  Object.assign(status, next);
  sendStatus();
}

function sendStatus(): void {
  send({ type: "agent:status", ...status });
}

// --- WebSocket con el agente ----------------------------------------------------------------

let socket: WebSocket | null = null;
let arenaConnected = false;

function connect(): void {
  const ws = new WebSocket(`ws://${window.location.host}${LOCAL_AGENT_EVENTS_PATH}`);
  socket = ws;

  ws.onopen = () => {
    const hello: AgentHelloMessage = { type: "agent:hello", role: "detector", protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION };
    ws.send(JSON.stringify(hello));
    sendStatus();
  };

  ws.onmessage = (event) => {
    const message = typeof event.data === "string" ? parseLocalAgentMessage(event.data) : null;
    if (!message) return;
    if (message.type === "agent:peer") {
      arenaConnected = message.arena;
      renderArenaStatus();
      // Una Arena recién conectada necesita saber ya cómo está la cámara.
      if (message.arena) sendStatus();
    } else if (message.type === "agent:config") {
      grimoire = message.grimoire;
      ultimateId = message.ultimateId;
      minConfidence = message.minConfidence;
      engine.setGrimoire(grimoire);
      engine.setMinConfidence(minConfidence);
      voice.setUltimate(ultimateId);
      log(`Grimorio de la Arena: ${grimoire.map(spellLabel).join(", ")}`, "info");
    }
  };

  ws.onclose = (event) => {
    if (socket === ws) socket = null;
    arenaConnected = false;
    renderArenaStatus(event.code === 4001 ? "Se abrió otra ventana del detector: usa esa." : null);
    // 4001: otra ventana del detector tomó el puesto; reconectar las haría pelear sin fin.
    if (event.code !== 4001) setTimeout(connect, RECONNECT_MS);
  };
}

function send(message: DetectorToAgentMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// --- Motor de gestos y voz (igual que la Arena en modo navegador) --------------------------

function sendError(error: SpellEngineError): void {
  // Sin `cause`: puede ser un objeto del navegador que no se serializa (y no le sirve a la Arena).
  send({ type: "agent:error", code: error.code, message: error.message, fatal: error.fatal });
}

const handlers: SpellEngineHandlers = {
  onSpell({ spellId, confidence }) {
    send({ type: "agent:spell", spellId, confidence });
    log(`${spellLabel(spellId)} ${confidence.toFixed(2)}`, "ok");
  },
  onSpellFailed({ bestGuess, confidence }) {
    send({ type: "agent:spell-failed", bestGuess, confidence });
    log(`Hechizo fallido${bestGuess ? ` (parecía ${spellLabel(bestGuess)} ${confidence.toFixed(2)})` : ""}`, "failed");
  },
  onSealCharging() {
    send({ type: "agent:seal-charging" });
    log("Cargando el Sello…", "info");
  },
  onSealCancel() {
    send({ type: "agent:seal-cancel" });
    log("Sello cancelado", "failed");
  },
  onError(error) {
    sendError(error);
    setStatus({ camera: "error" });
    renderCameraStatus("error", error.message);
  },
};

let lastHandVisible = false;
const engine = new SpellEngine(
  {
    video,
    wasmBasePath: WASM_PATH,
    modelAssetPath: MODEL_PATH,
    grimoire,
    minConfidence,
    onFrame(snapshot, size) {
      const visible = snapshot.hands.length > 0;
      if (visible !== lastHandVisible) {
        lastHandVisible = visible;
        setStatus({ handVisible: visible });
        renderCameraStatus("ready");
      }
      if (!ctx) return;
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStroke(ctx, snapshot.stroke);
      drawSeal(ctx, snapshot);
    },
  },
  handlers,
);

const voice = new VoiceListener(
  {
    ultimateId,
    onLevel(level, isShout) {
      // Escala no lineal, igual que en la Arena: la voz normal ya se ve y el grito llena la barra.
      micMeter.style.width = `${Math.round(Math.min(1, Math.sqrt(level / 0.2)) * 100)}%`;
      micMeter.dataset.shout = String(isShout);
    },
  },
  {
    onUltimate({ ultimateId: id, transcript }) {
      send({ type: "agent:ultimate", ultimateId: id, transcript });
      log(`${ULTIMATES[id].emoji} ${ULTIMATES[id].name}: «${transcript}»`, "ok");
    },
    onError(error) {
      // Sin micrófono solo se pierden los definitivos: la cámara sigue (sección 11).
      sendError(error);
      setStatus({ micReady: false });
      micStatus.textContent = `🎤 ${error.message}`;
    },
  },
);

// --- Pantalla ------------------------------------------------------------------------------

function spellLabel(spellId: SpellId): string {
  const spell = SPELLS[spellId];
  return `${spell.emoji} ${spell.name}`;
}

function log(text: string, kind: "ok" | "failed" | "info"): void {
  const item = document.createElement("li");
  item.className = kind;
  const time = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const sent = kind === "info" ? "" : arenaConnected ? " → Arena" : " (Arena no conectada)";
  item.textContent = `${time} ${text}${sent}`;
  eventLog.prepend(item);
  while (eventLog.children.length > MAX_LOG_ITEMS) eventLog.lastElementChild?.remove();
}

function renderCameraStatus(camera: AgentCameraStatus, message?: string): void {
  cameraStatus.dataset.state = camera;
  if (camera === "loading") cameraStatus.textContent = "Cargando cámara y detector de manos…";
  else if (camera === "error") cameraStatus.textContent = message ?? "Error de cámara";
  else cameraStatus.textContent = status.handVisible ? "✅ Mano detectada: haz la pinza para dibujar" : "✋ Pon la mano frente a la cámara";
}

function renderArenaStatus(reason: string | null = null): void {
  arenaStatus.dataset.state = arenaConnected ? "connected" : "waiting";
  arenaStatus.textContent = reason ?? (arenaConnected ? "Arena conectada" : "Esperando a la Arena…");
}

// --- Arranque ------------------------------------------------------------------------------

renderCameraStatus("loading");
renderArenaStatus();
micStatus.textContent = "🎤 Pidiendo el micrófono…";
connect();

void engine.start().then((ok) => {
  if (!ok) return; // el motivo ya llegó por onError
  setStatus({ camera: "ready" });
  renderCameraStatus("ready");
});

void voice.start().then((ok) => {
  if (!ok) return;
  setStatus({ micReady: true });
  micStatus.textContent = "🎤 Micrófono listo: grita el definitivo con el maná lleno";
});

// Al cerrar la ventana se liberan la cámara y el micrófono.
window.addEventListener("pagehide", () => {
  engine.stop();
  voice.stop();
  socket?.close();
});
