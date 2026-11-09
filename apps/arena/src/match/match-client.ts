/**
 * Cliente de partida: envuelve el socket y mantiene una "foto" inmutable del estado para React
 * (useSyncExternalStore). No calcula daño ni valida reglas: envía "lancé X" y muestra lo que
 * el servidor decide (servidor autoritativo, sección 4).
 */
import {
  SOCKET_UNAUTHORIZED,
  type AckErrorCode,
  type CastId,
  type AckResponse,
  type ClientToServerEvents,
  type MatchEndPayload,
  type MatchFoundPayload,
  type MatchId,
  type MatchState,
  type PlayerSummary,
  type ServerToClientEvents,
  type SpellId,
  type UserId,
} from "@duelo/contracts";
import { io, type Socket } from "socket.io-client";
import { ACK_ERROR_MESSAGES, SPELL_LABELS } from "./messages";

export type Phase =
  | "idle" // conectado, sin buscar partida
  | "queued" // en la cola de matchmaking
  | "found" // rival encontrado: calibración de cámara
  | "ready" // envió match:ready, esperando al rival
  | "countdown" // 3-2-1
  | "active"
  | "ended";

export type Connection = "connecting" | "online" | "reconnecting" | "unauthorized";

export type NoticeTone = "info" | "good" | "bad";

export interface Notice {
  id: number;
  text: string;
  tone: NoticeTone;
  /** Hora local (Date.now()) en la que deja de mostrarse. */
  until: number;
}

export interface MatchSnapshot {
  phase: Phase;
  connection: Connection;
  matchId: MatchId | null;
  you: PlayerSummary | null;
  rival: PlayerSummary | null;
  /** ± rating de búsqueda; null = cualquier rival. */
  ratingRange: number | null;
  startsAt: number | null;
  endsAt: number | null;
  state: MatchState | null;
  end: MatchEndPayload | null;
  /** Hora del servidor hasta la que se espera al rival desconectado. */
  opponentGraceUntil: number | null;
  /** El rival está cargando la X del Sello. */
  sealWarning: boolean;
  notices: Notice[];
  error: string | null;
}

export interface MatchClientOptions {
  url: string;
  token: string;
  userId: UserId;
  onSessionExpired?: () => void;
  /** Para los tests: permite inyectar un socket falso. */
  createSocket?: (url: string, token: string) => GameSocket;
}

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const NOTICE_MS = 1800;
/** Tiempo máximo de espera de un ack antes de dar el envío por perdido. */
const ACK_TIMEOUT_MS = 5000;

const INITIAL: MatchSnapshot = {
  phase: "idle",
  connection: "connecting",
  matchId: null,
  you: null,
  rival: null,
  ratingRange: null,
  startsAt: null,
  endsAt: null,
  state: null,
  end: null,
  opponentGraceUntil: null,
  sealWarning: false,
  notices: [],
  error: null,
};

export class MatchClient {
  private snapshot: MatchSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly socket: GameSocket;
  /** Diferencia serverNow − Date.now(); el reloj local de cada PC puede ir desfasado. */
  private clockOffset = 0;
  private castCounter = 0;
  private noticeCounter = 0;
  private sealWarningTimer: ReturnType<typeof setTimeout> | null = null;
  /** castIds ya rechazados: el rechazo puede llegar por el ack y por combat:spell-rejected. */
  private readonly rejectedCasts = new Set<CastId>();

  constructor(private readonly options: MatchClientOptions) {
    const create =
      options.createSocket ??
      ((url, token) => io(url, { auth: { token }, autoConnect: false, reconnectionDelayMax: 3000 }) as GameSocket);
    this.socket = create(options.url, options.token);
    this.bind();
    this.socket.connect();
  }

  // --- API para React ------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MatchSnapshot => this.snapshot;

  /** Hora actual estimada del servidor. */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  joinQueue(): void {
    this.update({ error: null, end: null, state: null });
    this.socket.emit("matchmaking:join", {}, (ack) => {
      if (ack.ok) this.update({ phase: "queued" });
      else this.update({ error: ACK_ERROR_MESSAGES[ack.code] });
    });
  }

  leaveQueue(): void {
    this.socket.emit("matchmaking:leave", {}, () => this.update({ phase: "idle", ratingRange: null }));
  }

  ready(): void {
    const matchId = this.snapshot.matchId;
    if (!matchId) return;
    this.socket.emit("match:ready", { matchId }, (ack) => {
      if (ack.ok) this.update({ phase: this.snapshot.phase === "found" ? "ready" : this.snapshot.phase });
      else this.update({ error: ACK_ERROR_MESSAGES[ack.code] });
    });
  }

  /** Solo viaja el resultado del reconocedor local (R2): nunca video ni audio. */
  castSpell(spellId: SpellId, confidence: number): void {
    const { matchId, phase } = this.snapshot;
    if (!matchId || phase !== "active") return;
    const castId = `c_${++this.castCounter}_${Date.now().toString(36)}`;
    this.socket.timeout(ACK_TIMEOUT_MS).emit("combat:cast-spell", { matchId, castId, spellId, confidence }, (err: Error | null, ack?: AckResponse) => {
      if (err) this.notify("Sin respuesta del servidor", "bad");
      else if (ack && !ack.ok) this.reject(castId, ack.code);
    });
  }

  /** Aviso local (p. ej. "¡Hechizo fallido!" del reconocedor, que nunca llega al servidor). */
  notify(text: string, tone: NoticeTone = "info"): void {
    const now = Date.now();
    const notices = [...this.snapshot.notices.filter((n) => n.until > now), { id: ++this.noticeCounter, text, tone, until: now + NOTICE_MS }];
    this.update({ notices: notices.slice(-4) });
  }

  /** Vuelve al lobby tras ver la pantalla final. */
  backToLobby(): void {
    this.update({ ...INITIAL, connection: this.snapshot.connection });
  }

  dispose(): void {
    if (this.sealWarningTimer) clearTimeout(this.sealWarningTimer);
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.listeners.clear();
  }

  // --- Eventos del servidor ------------------------------------------------

  private bind(): void {
    const s = this.socket;

    s.on("connect", () => {
      this.update({ connection: "online" });
      // Reconexión en mitad de una partida: pedimos volver a ella (sección 11).
      const { matchId, phase } = this.snapshot;
      if (matchId && phase !== "idle" && phase !== "queued" && phase !== "ended") {
        s.emit("match:rejoin", { matchId }, (ack) => {
          if (!ack.ok) this.update({ ...INITIAL, connection: "online", error: ACK_ERROR_MESSAGES[ack.code] });
        });
      } else if (phase === "queued") {
        // Al reconectar, el servidor ya nos sacó de la cola.
        this.update({ phase: "idle" });
      }
    });

    s.on("disconnect", () => {
      if (this.snapshot.connection !== "unauthorized") this.update({ connection: "reconnecting" });
    });

    s.on("connect_error", (error) => {
      if (error.message === SOCKET_UNAUTHORIZED) {
        this.update({ connection: "unauthorized", error: ACK_ERROR_MESSAGES.UNAUTHORIZED });
        this.options.onSessionExpired?.();
        s.disconnect();
      } else {
        this.update({ connection: "reconnecting" });
      }
    });

    s.on("matchmaking:queued", ({ ratingRange }) => this.update({ phase: "queued", ratingRange }));

    s.on("match:found", (payload: MatchFoundPayload) =>
      this.update({ phase: "found", matchId: payload.matchId, you: payload.you, rival: payload.rival, end: null, state: null }),
    );

    s.on("match:start", ({ matchId, startsAt, endsAt, serverNow }) => {
      this.clockOffset = serverNow - Date.now();
      this.update({ matchId, startsAt, endsAt, phase: serverNow < startsAt ? "countdown" : "active" });
    });

    s.on("match:state", (state) => {
      this.clockOffset = state.serverNow - Date.now();
      const phase =
        state.status === "active" ? "active" : state.status === "countdown" ? "countdown" : this.snapshot.phase;
      this.update({ state, phase, endsAt: state.endsAt });
    });

    s.on("combat:spell-resolved", ({ casterId, spellId, outcome, damage }) => {
      const mine = casterId === this.options.userId;
      const label = SPELL_LABELS[spellId];
      if (outcome === "self") this.notify(mine ? `${label}` : `El rival usó ${label}`, mine ? "good" : "info");
      else if (outcome === "blocked") this.notify(mine ? `${label} bloqueado por su escudo` : `¡Tu escudo bloqueó ${label}!`, mine ? "bad" : "good");
      else this.notify(mine ? `${label} −${damage}` : `Te golpeó ${label} −${damage}`, mine ? "good" : "bad");
    });

    s.on("combat:spell-rejected", ({ castId, code }) => this.reject(castId, code));

    s.on("combat:seal-warning", ({ byPlayerId }) => {
      if (byPlayerId === this.options.userId) return;
      this.update({ sealWarning: true });
      if (this.sealWarningTimer) clearTimeout(this.sealWarningTimer);
      this.sealWarningTimer = setTimeout(() => this.update({ sealWarning: false }), 1500);
    });

    s.on("match:opponent-disconnected", ({ graceMs }) => this.update({ opponentGraceUntil: this.serverNow() + graceMs }));
    s.on("match:opponent-reconnected", () => this.update({ opponentGraceUntil: null }));

    s.on("match:end", (end) => this.update({ phase: "ended", end, opponentGraceUntil: null, sealWarning: false }));
  }

  private reject(castId: CastId, code: AckErrorCode): void {
    if (this.rejectedCasts.has(castId)) return;
    this.rejectedCasts.add(castId);
    this.notify(ACK_ERROR_MESSAGES[code], "bad");
  }

  private update(patch: Partial<MatchSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
