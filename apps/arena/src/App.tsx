/**
 * Remote Arena: el componente que expone Module Federation y que el shell monta con
 * `session` y `navigate` (sección 9). También corre solo con una sesión de prueba (main.tsx).
 */
import { emitDueloEvent, type RemoteAppProps, type SpellId } from "@duelo/contracts";
import type { SpellEvent } from "@duelo/spell-engine";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_GRIMOIRE, GAME_SERVER_URL } from "./config";
import { useSpellSource } from "./engine/use-spell-source";
import { fetchGrimoire } from "./grimoire";
import { MatchClient } from "./match/match-client";
import { EndScreen } from "./ui/end-screen";
import { PlayerPanel } from "./ui/player-panel";
import { useNow } from "./ui/use-now";
import "./arena.css";

/** Penalización local tras un hechizo fallido (sección 6): el reconocedor ignora gestos 0,5 s. */
const FAIL_PENALTY_MS = 500;

export default function App(props: RemoteAppProps) {
  if (!GAME_SERVER_URL) {
    return (
      <div className="arena">
        <div className="panel error">Falta configurar VITE_GAME_SERVER_URL en el .env de la Arena.</div>
      </div>
    );
  }
  // key: si cambia el usuario o el token se crea un cliente nuevo.
  return <Arena key={`${props.session.user.id}:${props.session.token}`} {...props} />;
}

function Arena(props: RemoteAppProps) {
  const { session } = props;
  const userId = session.user.id;
  // El cliente se crea dentro del efecto (y no con useMemo) para que el doble montaje de
  // StrictMode no deje un socket cerrado: cada montaje crea el suyo y el cleanup lo cierra.
  const [client, setClient] = useState<MatchClient | null>(null);
  useEffect(() => {
    const created = new MatchClient({
      url: GAME_SERVER_URL,
      token: session.token,
      userId,
      onSessionExpired: () => emitDueloEvent("duelo:session-expired", {}),
    });
    setClient(created);
    return () => {
      created.dispose();
      setClient(null);
    };
  }, [session.token, userId]);

  if (!client) return <div className="arena" />;
  return <ArenaView {...props} client={client} />;
}

function ArenaView({ session, navigate, client }: RemoteAppProps & { client: MatchClient }) {
  const userId = session.user.id;
  const match = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const getServerNow = useCallback(() => client.serverNow(), [client]);
  const ticking = match.phase === "countdown" || match.phase === "active" || match.opponentGraceUntil !== null;
  const now = useNow(getServerNow, ticking);

  const [grimoire, setGrimoire] = useState<readonly SpellId[]>(DEFAULT_GRIMOIRE);
  useEffect(() => {
    void fetchGrimoire(session.token).then(setGrimoire);
  }, [session.token]);

  // --- Módulo local ----------------------------------------------------------
  const [debug, setDebug] = useState(false);
  const [engineAttempt, setEngineAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lockedUntil = useRef(0);

  const inMatch = match.phase === "found" || match.phase === "ready" || match.phase === "countdown" || match.phase === "active";

  const engine = useSpellSource({
    enabled: inMatch,
    grimoire,
    debug,
    video: videoRef,
    canvas: canvasRef,
    attempt: engineAttempt,
    handlers: {
      onSpell({ spellId, confidence }: SpellEvent) {
        if (Date.now() < lockedUntil.current) return;
        client.castSpell(spellId, confidence);
      },
      onSpellFailed() {
        if (match.phase !== "active") return;
        lockedUntil.current = Date.now() + FAIL_PENALTY_MS;
        client.notify("¡Hechizo fallido!", "bad");
      },
    },
  });

  // --- Fin de partida: avisar al shell y al ranking (sección 9) ---------------
  const end = match.end;
  useEffect(() => {
    const reward = end?.rewards[userId];
    if (end && reward) emitDueloEvent("duelo:match-ended", { matchId: end.matchId, newRating: reward.newRating });
  }, [end, userId]);

  const you = match.state?.players[userId];
  const rivalId = match.rival?.id;
  const rival = rivalId ? match.state?.players[rivalId] : undefined;
  const visibleNotices = match.notices.filter((n) => n.until > Date.now());

  return (
    <div className="arena">
      <StatusBar connection={match.connection} keyboard={engine.keyboard} />

      {match.error && <div className="panel error">{match.error}</div>}

      {match.phase === "idle" && (
        <div className="panel center">
          <h2>Arena</h2>
          <p className="muted">Dibuja con la pinza: ⚡ zigzag = Rayo, 🛡️ círculo = Escudo.</p>
          <button className="btn btn--primary" onClick={() => client.joinQueue()} disabled={match.connection !== "online"}>
            Buscar rival
          </button>
        </div>
      )}

      {match.phase === "queued" && (
        <div className="panel center">
          <h2>Buscando rival…</h2>
          <p className="muted">
            {match.ratingRange === null ? "Aceptando cualquier rival" : `Rivales a ±${match.ratingRange} puntos`}
          </p>
          <button className="btn" onClick={() => client.leaveQueue()}>
            Cancelar
          </button>
        </div>
      )}

      {inMatch && (
        <div className={`stage stage--${match.phase === "active" || match.phase === "countdown" ? "combat" : "calibration"}`}>
          {!engine.keyboard && (
            <div className="camera">
              <video ref={videoRef} playsInline muted />
              <canvas ref={canvasRef} />
              {engine.status === "loading" && <div className="camera__msg">Cargando cámara y detector de manos…</div>}
            </div>
          )}

          {engine.status === "error" && engine.error && (
            <div className="panel error">
              <p>{engine.error.message}</p>
              <button className="btn" onClick={() => setEngineAttempt((n) => n + 1)}>
                Reintentar
              </button>
            </div>
          )}

          {(match.phase === "found" || match.phase === "ready") && (
            <div className="panel center">
              <h2>Calibración</h2>
              <p className="muted">
                Rival: <strong>{match.rival?.username}</strong> ({match.rival?.rank})
              </p>
              <p>{engine.handVisible ? "✅ Mano detectada. Prueba hacer la pinza." : "✋ Pon la mano frente a la cámara."}</p>
              {match.phase === "found" ? (
                <button className="btn btn--primary" onClick={() => client.ready()} disabled={engine.status !== "running" || !engine.handVisible}>
                  ¡Estoy listo!
                </button>
              ) : (
                <p className="muted">Esperando a que el rival esté listo…</p>
              )}
              <label className="muted row">
                <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Ver puntos de la mano
              </label>
            </div>
          )}

          {(match.phase === "countdown" || match.phase === "active") && (
            <>
              <div className="duel">
                <PlayerPanel side="you" summary={match.you} state={you} now={now} grimoire={grimoire} />
                <div className="duel__center">
                  {match.phase === "countdown" && match.startsAt && (
                    <div className="countdown">{Math.max(1, Math.ceil((match.startsAt - now) / 1000))}</div>
                  )}
                  {match.phase === "active" && match.endsAt && (
                    <div className="timer">{Math.max(0, Math.ceil((match.endsAt - now) / 1000))} s</div>
                  )}
                </div>
                <PlayerPanel side="rival" summary={match.rival} state={rival} now={now} />
              </div>

              {match.sealWarning && <div className="banner banner--bad">¡Te están sellando!</div>}
              {match.opponentGraceUntil !== null && (
                <div className="banner">
                  El rival se desconectó. Esperando {Math.max(0, Math.ceil((match.opponentGraceUntil - now) / 1000))} s…
                </div>
              )}
            </>
          )}
        </div>
      )}

      {match.phase === "ended" && match.end && (
        <EndScreen end={match.end} userId={userId} onPlayAgain={() => client.backToLobby()} onExit={() => navigate("/ranking")} />
      )}

      <ul className="notices" aria-live="polite">
        {visibleNotices.map((n) => (
          <li key={n.id} className={`notice notice--${n.tone}`}>
            {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBar({ connection, keyboard }: { connection: string; keyboard: boolean }) {
  if (connection === "online" && !keyboard) return null;
  return (
    <div className="statusbar">
      {connection === "connecting" && <span>Conectando con el servidor…</span>}
      {connection === "reconnecting" && <span className="warn">Conexión perdida. Reconectando…</span>}
      {connection === "unauthorized" && <span className="warn">Tu sesión expiró. Vuelve a iniciar sesión.</span>}
      {keyboard && <span>Modo teclado (pruebas): 1 = Rayo, 2 = Escudo, 0 = fallido</span>}
    </div>
  );
}
