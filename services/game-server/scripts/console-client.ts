/**
 * Cliente de consola para probar el game-server sin la Arena.
 *
 *   pnpm --filter @duelo/game-server client -- --name ana            (manual: teclas r/e/f/q)
 *   pnpm --filter @duelo/game-server client -- --name beto --auto    (lanza solo)
 *
 * Abre dos terminales, uno por jugador. Teclas en modo manual:
 *   r = Rayo · e = Escudo · f = gesto fallido (confianza 0,5) · q = salir (prueba el abandono)
 *
 * Sin --token firma un JWT de prueba con JWT_SECRET del .env (solo sirve con el api simulado;
 * con el api real usa --token con el token de POST /auth/login).
 */
import { createHash } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type {
  AckResponse,
  ClientToServerEvents,
  MatchEndPayload,
  MatchState,
  ServerToClientEvents,
  SpellId,
} from "@duelo/contracts";
import { SPELLS } from "@duelo/game-rules";
import { io, type Socket } from "socket.io-client";
import { signDevToken } from "../src/auth.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ConsoleClientOptions {
  url: string;
  token: string;
  label: string;
  auto: boolean;
  /** Se desconecta este tiempo después de empezar la partida (prueba de abandono). */
  quitAfterMs?: number;
  interactive?: boolean;
}

/** UUID estable a partir del nombre: el mismo nombre conserva su rating en el api simulado. */
export function devUserId(name: string): string {
  const h = createHash("sha256").update(`duelo-dev:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function devToken(name: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta JWT_SECRET (copia .env.example a .env) o pasa --token");
  return signDevToken(devUserId(name), name, secret);
}

const bar = (hp: number) => "█".repeat(Math.round(hp / 10)).padEnd(10, "·");

export function runConsoleClient(options: ConsoleClientOptions): Promise<MatchEndPayload | null> {
  const { label } = options;
  const log = (message: string) => console.log(`[${label}] ${message}`);

  return new Promise((resolve) => {
    const socket: Client = io(options.url, { auth: { token: options.token }, transports: ["websocket"] });
    let matchId: string | null = null;
    let myId: string | null = null;
    let rivalId: string | null = null;
    let state: MatchState | null = null;
    let castCounter = 0;
    let lastCastAt = 0;
    let lastPrintAt = 0;
    let finished = false;

    const done = (result: MatchEndPayload | null) => {
      if (finished) return;
      finished = true;
      if (options.interactive && process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      socket.disconnect();
      resolve(result);
    };

    const send = async (event: keyof ClientToServerEvents, payload: unknown): Promise<AckResponse> =>
      (socket.timeout(5_000).emitWithAck as (e: string, p: unknown) => Promise<AckResponse>)(event, payload);

    const cast = async (spellId: SpellId, confidence: number) => {
      if (!matchId) return log("todavía no hay partida");
      lastCastAt = Date.now();
      const castId = `c_${String(++castCounter).padStart(4, "0")}`;
      const res = await send("combat:cast-spell", { matchId, castId, spellId, confidence });
      if (!res.ok) log(`✗ ${SPELLS[spellId].name} rechazado: ${res.code}`);
    };

    socket.on("connect", async () => {
      log(`conectado a ${options.url}`);
      // Tras una reconexión automática con partida en curso se pide rejoin, no cola nueva.
      const res = matchId ? await send("match:rejoin", { matchId }) : await send("matchmaking:join", {});
      log(matchId ? `rejoin → ${JSON.stringify(res)}` : `entrar a la cola → ${JSON.stringify(res)}`);
    });
    socket.on("connect_error", (error) => {
      log(`no se pudo conectar: ${error.message}`);
      if (error.message === "UNAUTHORIZED") done(null);
    });
    socket.on("disconnect", (reason) => log(`desconectado (${reason})`));

    socket.on("matchmaking:queued", ({ ratingRange }) =>
      log(`en cola, margen de rating ${ratingRange === null ? "cualquiera" : `±${ratingRange}`}`),
    );
    socket.on("match:found", async (found) => {
      matchId = found.matchId;
      myId = found.you.id;
      rivalId = found.rival.id;
      log(`rival: ${found.rival.username} (${found.rival.rank}, ${found.rival.rating} pts) · ${found.matchId}`);
      const res = await send("match:ready", { matchId: found.matchId });
      if (!res.ok) log(`ready falló: ${res.code}`);
    });
    socket.on("match:start", ({ startsAt, serverNow }) => {
      log(`¡empieza en ${Math.round((startsAt - serverNow) / 1000)} s!`);
      if (options.quitAfterMs !== undefined) {
        setTimeout(() => {
          log("me voy sin avisar (prueba de abandono)");
          done(null);
        }, startsAt - serverNow + options.quitAfterMs);
      }
    });
    socket.on("match:state", (next) => {
      state = next;
      if (!myId || !rivalId || next.status !== "active") return;
      const me = next.players[myId]!;
      const rival = next.players[rivalId]!;

      if (Date.now() - lastPrintAt >= 2_000) {
        lastPrintAt = Date.now();
        const left = Math.max(0, Math.round((next.endsAt - next.serverNow) / 1000));
        log(`yo ${bar(me.hp)} ${me.hp} ♥ ${me.mana} ✦ | rival ${bar(rival.hp)} ${rival.hp} ♥ | ${left} s`);
      }

      if (!options.auto || Date.now() - lastCastAt < 400) return;
      const ready = (id: SpellId) => (me.cooldownsUntil[id] ?? 0) <= next.serverNow;
      if (ready("shield") && me.mana >= SPELLS.shield.manaCost && me.shieldUntil === null && Math.random() < 0.08) {
        void cast("shield", 0.95);
      } else if (ready("lightning") && me.mana >= SPELLS.lightning.manaCost) {
        // De vez en cuando un gesto "mal dibujado" para ver LOW_CONFIDENCE.
        void cast("lightning", Math.random() < 0.15 ? 0.6 : 0.9);
      }
    });
    socket.on("combat:spell-resolved", ({ casterId, spellId, outcome, damage }) => {
      const who = casterId === myId ? "yo" : "rival";
      log(`${who}: ${spellId} → ${outcome}${damage ? ` (${damage} de daño)` : ""}`);
    });
    socket.on("match:opponent-disconnected", ({ graceMs }) =>
      log(`el rival se desconectó; gana por abandono si no vuelve en ${graceMs / 1000} s`),
    );
    socket.on("match:opponent-reconnected", () => log("el rival volvió"));
    socket.on("match:end", (end) => {
      const mine = myId ? end.rewards[myId] : undefined;
      const verdict = end.winnerId === null ? "EMPATE" : end.winnerId === myId ? "VICTORIA" : "DERROTA";
      log(`fin (${end.reason}): ${verdict}`);
      if (mine) log(`rating ${mine.ratingDelta >= 0 ? "+" : ""}${mine.ratingDelta} → ${mine.newRating} (${mine.newRank}), oro +${mine.goldDelta}`);
      if (state && myId) log(`vida final: ${state.players[myId]?.hp}`);
      done(end);
    });

    if (options.interactive && process.stdin.isTTY) {
      emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.on("keypress", (_text: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.name === "r") void cast("lightning", 0.9);
        else if (key.name === "e") void cast("shield", 0.9);
        else if (key.name === "f") void cast("lightning", 0.5);
        else if (key.name === "q" || (key.ctrl && key.name === "c")) {
          log("saliendo");
          done(null);
        }
      });
      log("teclas: r = Rayo · e = Escudo · f = gesto fallido · q = salir");
    }
  });
}

/** URL por defecto: el game-server local en PORT (3001 si no hay .env). */
export function defaultUrl(): string {
  return `http://localhost:${process.env.PORT || 3001}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      token: { type: "string" },
      url: { type: "string" },
      auto: { type: "boolean", default: false },
    },
  });
  const name = values.name ?? "jugador";
  const result = await runConsoleClient({
    url: values.url ?? defaultUrl(),
    token: values.token ?? devToken(name),
    label: name,
    auto: values.auto ?? false,
    interactive: !values.auto,
  });
  process.exit(result ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
