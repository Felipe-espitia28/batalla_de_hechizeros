import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAgentSource, type LocalAgentStatus, type WebSocketLike } from "../src/local-agent-source";

/** WebSocket falso: el test decide cuándo abre, qué llega y cuándo se cierra. */
class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
}

const URL = "ws://127.0.0.1:47800/events";

function setup() {
  const handlers = {
    onSpell: vi.fn(),
    onSpellFailed: vi.fn(),
    onUltimate: vi.fn(),
    onSealCharging: vi.fn(),
    onSealCancel: vi.fn(),
    onError: vi.fn(),
  };
  const statuses: LocalAgentStatus[] = [];
  const source = new LocalAgentSource(
    {
      url: URL,
      grimoire: ["lightning", "shield"],
      ultimateId: "meteor",
      minConfidence: 0.8,
      onStatus: (s) => statuses.push(s),
      createSocket: (url) => new FakeSocket(url),
    },
    handlers,
  );
  return { source, handlers, statuses, socket: () => FakeSocket.all.at(-1)! };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LocalAgentSource", () => {
  it("conecta, se presenta como arena y manda el grimorio", async () => {
    const { source, socket, statuses } = setup();
    const started = source.start();
    socket().open();
    expect(await started).toBe(true);
    expect(socket().url).toBe(URL);
    expect(socket().sent).toEqual([
      { type: "agent:hello", role: "arena", protocolVersion: 1 },
      { type: "agent:config", grimoire: ["lightning", "shield"], ultimateId: "meteor", minConfidence: 0.8 },
    ]);
    expect(statuses.at(-1)).toMatchObject({ connected: true, detector: false });
  });

  it("convierte los mensajes del detector en los handlers de siempre", async () => {
    const { source, socket, handlers } = setup();
    const started = source.start();
    socket().open();
    await started;
    socket().receive({ type: "agent:spell", spellId: "lightning", confidence: 0.91 });
    socket().receive({ type: "agent:spell-failed", bestGuess: "shield", confidence: 0.6 });
    socket().receive({ type: "agent:ultimate", ultimateId: "meteor", transcript: "¡Meteoro!" });
    socket().receive({ type: "agent:seal-charging" });
    socket().receive({ type: "agent:seal-cancel" });
    socket().receive({ type: "agent:error", code: "CAMERA_DENIED", message: "Bloqueaste la cámara", fatal: true });
    expect(handlers.onSpell).toHaveBeenCalledWith({ spellId: "lightning", confidence: 0.91 });
    expect(handlers.onSpellFailed).toHaveBeenCalledWith({ bestGuess: "shield", confidence: 0.6 });
    expect(handlers.onUltimate).toHaveBeenCalledWith({ ultimateId: "meteor", transcript: "¡Meteoro!" });
    expect(handlers.onSealCharging).toHaveBeenCalledOnce();
    expect(handlers.onSealCancel).toHaveBeenCalledOnce();
    expect(handlers.onError).toHaveBeenCalledWith({ code: "CAMERA_DENIED", message: "Bloqueaste la cámara", fatal: true });
  });

  it("agent:peer y agent:status llegan como estado (para el panel y la calibración)", async () => {
    const { source, socket, statuses } = setup();
    const started = source.start();
    socket().open();
    await started;
    socket().receive({ type: "agent:peer", detector: true, arena: true });
    socket().receive({ type: "agent:status", camera: "ready", handVisible: true, micReady: true });
    expect(statuses.at(-1)).toEqual({ connected: true, detector: true, camera: "ready", handVisible: true, micReady: true });
    // Se cierra la ventana del detector: lo último que dijo de la cámara deja de valer.
    socket().receive({ type: "agent:peer", detector: false, arena: true });
    expect(statuses.at(-1)).toEqual({ connected: true, detector: false, camera: null, handVisible: false, micReady: false });
  });

  it("sin agente: a los 3 s devuelve false con AGENT_NOT_RUNNING y sigue reintentando", async () => {
    const { source, socket, handlers, statuses } = setup();
    const started = source.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await started).toBe(false);
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "AGENT_NOT_RUNNING", fatal: true }));

    // El navegador cierra el intento fallido; a los 2 s vuelve a intentar y el agente ya está abierto.
    socket().drop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.all).toHaveLength(2);
    socket().open();
    expect(statuses.at(-1)).toMatchObject({ connected: true });
  });

  it("si el agente se cae a mitad de partida, avisa una vez y se reconecta solo", async () => {
    const { source, socket, statuses, handlers } = setup();
    const started = source.start();
    socket().open();
    await started;
    socket().drop();
    expect(statuses.at(-1)).toMatchObject({ connected: false });
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "AGENT_NOT_RUNNING" }));
    // Los reintentos fallidos no repiten el aviso.
    await vi.advanceTimersByTimeAsync(2000);
    socket().drop();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    socket().open();
    expect(statuses.at(-1)).toMatchObject({ connected: true });
    expect(socket().sent[0]).toMatchObject({ type: "agent:hello", role: "arena" });
  });

  it("setGrimoire y setUltimate mandan agent:config", async () => {
    const { source, socket } = setup();
    const started = source.start();
    socket().open();
    await started;
    source.setGrimoire(["lightning", "shield", "fireball"]);
    source.setUltimate("storm");
    expect(socket().sent.slice(-2)).toEqual([
      { type: "agent:config", grimoire: ["lightning", "shield", "fireball"], ultimateId: "meteor", minConfidence: 0.8 },
      { type: "agent:config", grimoire: ["lightning", "shield", "fireball"], ultimateId: "storm", minConfidence: 0.8 },
    ]);
  });

  it("otra pestaña de la Arena tomó el agente (4001): no reconecta para no pelear el puesto", async () => {
    const { source, socket, handlers } = setup();
    const started = source.start();
    socket().open();
    await started;
    socket().drop(4001);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "AGENT_IN_OTHER_TAB" }));
  });

  it("stop() cierra y deja de reintentar", async () => {
    const { source, socket } = setup();
    const started = source.start();
    socket().open();
    await started;
    source.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket().readyState).toBe(3);
  });
});
