/**
 * Servidor de juego SIMULADO, solo para desarrollar la Arena sin depender del game-server real.
 * No es la fuente de verdad de las reglas (eso es services/game-server, de Johan): implementa
 * lo mínimo de P0 (Rayo, Escudo, daño, fin de partida, abandono) con los números de CLAUDE.md
 * y respeta los tipos de packages/contracts.
 *
 * Uso: pnpm --filter @duelo/arena mock   (escucha en http://localhost:3001)
 * Token: "dev:<usuario>". Si en 5 s no hay un segundo jugador, empareja contra un muñeco.
 */
import type {
  ClientToServerEvents,
  MatchEndPayload,
  MatchState,
  PlayerState,
  PlayerSummary,
  RejectionCode,
  ServerToClientEvents,
  SocketData,
  SpellId,
} from "@duelo/contracts";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";

type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const PORT = Number(process.env.PORT ?? 3001);
const BOT_ID = "bot-muneco";
const SPELLS: Partial<Record<SpellId, { mana: number; cooldownMs: number; damage: number }>> = {
  lightning: { mana: 10, cooldownMs: 1500, damage: 10 },
  shield: { mana: 20, cooldownMs: 6000, damage: 0 },
};

interface Match {
  id: string;
  players: [PlayerSummary, PlayerSummary];
  ready: Set<string>;
  state: MatchState;
  startsAt: number;
  lastCastAt: Map<string, number>;
  ticker?: ReturnType<typeof setInterval>;
  abandonTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
  cors: { origin: true },
});

const queue: { userId: string; since: number }[] = [];
const sockets = new Map<string, IoSocket>();
const matches = new Map<string, Match>();
const matchOf = new Map<string, string>();
let matchCounter = 0;

const summary = (id: string, username: string): PlayerSummary => ({ id, username, rating: 0, rank: "Grado 4" });
const emitTo = (userId: string) => sockets.get(userId);

// Auth: igual que el real, rechaza con UNAUTHORIZED si el token no sirve.
io.use((socket, next) => {
  const token = String((socket.handshake.auth as { token?: unknown }).token ?? "");
  if (!token.startsWith("dev:") || token.length < 5) return next(new Error("UNAUTHORIZED"));
  const username = token.slice(4);
  socket.data = { userId: `dev-${username}`, username };
  next();
});

io.on("connection", (socket: IoSocket) => {
  const { userId, username } = socket.data;
  sockets.set(userId, socket);
  console.log(`[mock] conectado ${username}`);

  socket.on("matchmaking:join", (_p, ack) => {
    if (matchOf.has(userId)) return ack({ ok: false, code: "ALREADY_IN_MATCH" });
    if (queue.some((q) => q.userId === userId)) return ack({ ok: false, code: "ALREADY_QUEUED" });
    queue.push({ userId, since: Date.now() });
    ack({ ok: true });
    socket.emit("matchmaking:queued", { ratingRange: 150 });
  });

  socket.on("matchmaking:leave", (_p, ack) => {
    removeFromQueue(userId);
    ack({ ok: true });
  });

  socket.on("match:ready", ({ matchId }, ack) => {
    const match = matches.get(matchId);
    if (!match) return ack({ ok: false, code: "MATCH_NOT_FOUND" });
    match.ready.add(userId);
    ack({ ok: true });
    if (match.ready.size === 2) startMatch(match);
  });

  socket.on("match:rejoin", ({ matchId }, ack) => {
    const match = matches.get(matchId);
    if (!match || matchOf.get(userId) !== matchId) return ack({ ok: false, code: "MATCH_NOT_FOUND" });
    ack({ ok: true });
    const timer = match.abandonTimers.get(userId);
    if (timer) clearTimeout(timer);
    match.abandonTimers.delete(userId);
    const rival = match.players.find((p) => p.id !== userId)!;
    socket.emit("match:found", { matchId, you: match.players.find((p) => p.id === userId)!, rival });
    socket.emit("match:start", { matchId, startsAt: match.startsAt, endsAt: match.state.endsAt, serverNow: Date.now() });
    emitTo(rival.id)?.emit("match:opponent-reconnected", {});
  });

  socket.on("combat:cast-spell", ({ matchId, castId, spellId, confidence }, ack) => {
    const code = cast(matchId, userId, spellId, confidence, castId);
    if (code) {
      ack({ ok: false, code });
      socket.emit("combat:spell-rejected", { castId, code });
    } else ack({ ok: true });
  });

  socket.on("combat:cast-ultimate", (_p, ack) => ack({ ok: false, code: "NOT_IN_GRIMOIRE" }));
  socket.on("combat:seal-charging", (_p, ack) => ack({ ok: false, code: "NOT_IN_GRIMOIRE" }));
  socket.on("combat:seal-cancel", (_p, ack) => ack({ ok: true }));

  socket.on("disconnect", () => {
    if (sockets.get(userId) === socket) sockets.delete(userId);
    removeFromQueue(userId);
    const match = matches.get(matchOf.get(userId) ?? "");
    if (!match || match.state.status === "ended") return;
    const rival = match.players.find((p) => p.id !== userId)!;
    emitTo(rival.id)?.emit("match:opponent-disconnected", { graceMs: 10_000 });
    match.abandonTimers.set(userId, setTimeout(() => endMatch(match, rival.id, "ABANDON"), 10_000));
  });
});

// Emparejamiento cada 1 s, como el real (sección 4).
setInterval(() => {
  while (queue.length >= 2) {
    const [a, b] = queue.splice(0, 2);
    createMatch(a!.userId, b!.userId);
  }
  const lonely = queue[0];
  if (lonely && Date.now() - lonely.since > 5000) {
    queue.shift();
    createMatch(lonely.userId, BOT_ID);
  }
}, 1000);

function createMatch(aId: string, bId: string): void {
  const id = `m_mock${++matchCounter}`;
  const a = summary(aId, sockets.get(aId)?.data.username ?? aId);
  const b = bId === BOT_ID ? summary(BOT_ID, "Muñeco de práctica") : summary(bId, sockets.get(bId)?.data.username ?? bId);
  const fresh = (): PlayerState => ({
    hp: 100,
    mana: 30,
    shieldUntil: null,
    effects: [],
    cooldownsUntil: {},
    silencedUntil: null,
    used: { "silence-seal": false, "purple-void": false },
  });
  const match: Match = {
    id,
    players: [a, b],
    ready: new Set(bId === BOT_ID ? [BOT_ID] : []),
    state: { matchId: id, status: "waiting", serverNow: Date.now(), endsAt: 0, players: { [a.id]: fresh(), [b.id]: fresh() } },
    startsAt: 0,
    lastCastAt: new Map(),
    abandonTimers: new Map(),
  };
  matches.set(id, match);
  for (const p of match.players) matchOf.set(p.id, id);
  emitTo(a.id)?.emit("match:found", { matchId: id, you: a, rival: b });
  emitTo(b.id)?.emit("match:found", { matchId: id, you: b, rival: a });
  console.log(`[mock] partida ${id}: ${a.username} vs ${b.username}`);
}

function startMatch(match: Match): void {
  const now = Date.now();
  match.startsAt = now + 3000;
  match.state.status = "countdown";
  match.state.endsAt = match.startsAt + 90_000;
  broadcast(match, (s) => s.emit("match:start", { matchId: match.id, startsAt: match.startsAt, endsAt: match.state.endsAt, serverNow: now }));

  let tick = 0;
  match.ticker = setInterval(() => {
    const t = Date.now();
    if (match.state.status === "countdown" && t >= match.startsAt) match.state.status = "active";
    if (match.state.status === "active") {
      for (const p of Object.values(match.state.players)) p.mana = Math.min(100, p.mana + 0.4); // +4/s
      // El muñeco lanza un Rayo cada ~4 s para que se vea el daño recibido.
      if (match.players[1].id === BOT_ID && tick % 40 === 39) cast(match.id, BOT_ID, "lightning", 1, `bot_${tick}`);
      if (t >= match.state.endsAt) {
        const [a, b] = match.players.map((p) => match.state.players[p.id]!.hp);
        return endMatch(match, a! === b! ? null : a! > b! ? match.players[0].id : match.players[1].id, a === b ? "DRAW" : "TIMEOUT");
      }
    }
    if (++tick % 2 === 0) sendState(match); // 5 veces por segundo
  }, 100);
}

function cast(matchId: string, casterId: string, spellId: SpellId, confidence: number, castId: string): RejectionCode | null {
  const match = matches.get(matchId);
  if (!match || match.state.status !== "active") return "MATCH_NOT_ACTIVE";
  const spell = SPELLS[spellId];
  if (!spell) return "NOT_IN_GRIMOIRE";
  if (confidence < 0.8) return "LOW_CONFIDENCE";
  const now = Date.now();
  if (now - (match.lastCastAt.get(casterId) ?? 0) < 300) return "RATE_LIMIT";
  const me = match.state.players[casterId]!;
  if ((me.cooldownsUntil[spellId] ?? 0) > now) return "COOLDOWN";
  if (me.mana < spell.mana) return "NO_MANA";

  match.lastCastAt.set(casterId, now);
  me.mana -= spell.mana;
  me.cooldownsUntil[spellId] = now + spell.cooldownMs;
  const targetId = match.players.find((p) => p.id !== casterId)!.id;
  const target = match.state.players[targetId]!;

  let outcome: "hit" | "blocked" | "self" = "self";
  let damage = 0;
  if (spellId === "shield") {
    me.shieldUntil = now + 3000;
  } else if (target.shieldUntil && target.shieldUntil > now) {
    target.shieldUntil = null;
    outcome = "blocked";
  } else {
    damage = spell.damage;
    target.hp = Math.max(0, target.hp - damage);
    outcome = "hit";
  }
  broadcast(match, (s) => s.emit("combat:spell-resolved", { castId, casterId, spellId, outcome, damage }));
  sendState(match);
  if (target.hp <= 0) endMatch(match, casterId, "KO");
  return null;
}

function endMatch(match: Match, winnerId: string | null, reason: MatchEndPayload["reason"]): void {
  if (match.state.status === "ended") return;
  match.state.status = "ended";
  clearInterval(match.ticker);
  for (const t of match.abandonTimers.values()) clearTimeout(t);
  const rewards: MatchEndPayload["rewards"] = {};
  for (const p of match.players) {
    const won = winnerId === p.id;
    const delta = winnerId === null ? 0 : won ? 25 : reason === "ABANDON" ? -25 : -15;
    const gold = winnerId === null ? 30 : won ? 50 : reason === "ABANDON" ? 0 : 20;
    rewards[p.id] = { ratingDelta: delta, goldDelta: gold, newRating: Math.max(0, p.rating + delta), newRank: "Grado 4" };
  }
  sendState(match);
  broadcast(match, (s) => s.emit("match:end", { matchId: match.id, winnerId, reason, rewards }));
  for (const p of match.players) matchOf.delete(p.id);
  matches.delete(match.id);
  console.log(`[mock] fin ${match.id}: ${reason}, gana ${winnerId ?? "nadie"}`);
}

function sendState(match: Match): void {
  match.state.serverNow = Date.now();
  broadcast(match, (s) => s.emit("match:state", match.state));
}

function broadcast(match: Match, send: (s: IoSocket) => void): void {
  for (const p of match.players) {
    const s = sockets.get(p.id);
    if (s) send(s);
  }
}

function removeFromQueue(userId: string): void {
  const i = queue.findIndex((q) => q.userId === userId);
  if (i >= 0) queue.splice(i, 1);
}

httpServer.listen(PORT, () => console.log(`[mock] game-server simulado en http://localhost:${PORT}`));
