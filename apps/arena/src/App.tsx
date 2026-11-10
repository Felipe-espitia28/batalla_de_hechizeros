/**
 * Remote Arena: el componente que expone Module Federation y que el shell monta con
 * `session` y `navigate` (sección 9). También corre solo con una sesión de prueba (main.tsx).
 */
import { emitDueloEvent, type RemoteAppProps, type SpellId } from "@duelo/contracts";
import type { SpellEvent } from "@duelo/spell-engine";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MATCH_RULES } from "@duelo/game-rules";
import { DEFAULT_LOADOUT, fetchGold, fetchLoadout, type Loadout } from "./api";
import { GAME_SERVER_URL } from "./config";
import { useSpellSource } from "./engine/use-spell-source";
import { useVoice } from "./engine/use-voice";
import { MatchClient, type Notice } from "./match/match-client";
import { EndScreen } from "./ui/end-screen";
import { PlayerPanel } from "./ui/player-panel";
import { UltimateRow } from "./ui/ultimate-row";
import { useNow } from "./ui/use-now";
import "./arena.css";


export default function App(props: RemoteAppProps) {
  if (!GAME_SERVER_URL) {
    return (
      <div className="arena">
        <div className="ar-panel ar-error">Falta configurar VITE_GAME_SERVER_URL en el .env de la Arena.</div>
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

  const [loadout, setLoadout] = useState<Loadout>(DEFAULT_LOADOUT);
  useEffect(() => {
    void fetchLoadout(session.token).then(setLoadout);
  }, [session.token]);
  const grimoire: readonly SpellId[] = loadout.spells;
  const ultimateId = loadout.ultimateId;

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
    ultimateId,
    minConfidence: MATCH_RULES.minConfidence,
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
        // Penalización local (sección 6): el fallo nunca llega al servidor, así que la aplica la Arena.
        lockedUntil.current = Date.now() + MATCH_RULES.failedCastPenaltyMs;
        client.notify("¡Hechizo fallido!", "bad");
      },
      // Solo en modo teclado (tecla 9); con micrófono lo emite useVoice.
      onUltimate: ({ ultimateId: id, transcript }) => client.castUltimate(id, transcript),
    },
  });

  // --- Voz: definitivos (grito + palabra) ---------------------------------------
  const meterRef = useRef<HTMLDivElement>(null);
  const voice = useVoice({
    enabled: inMatch && !engine.keyboard,
    ultimateId,
    meter: meterRef,
    onUltimate: ({ ultimateId: id, transcript }) => client.castUltimate(id, transcript),
  });

  // --- Fin de partida: avisar al shell y al ranking (sección 9) ---------------
  // Se recuerda la partida ya avisada: StrictMode ejecuta los efectos dos veces en desarrollo
  // y el shell no debe recibir dos duelo:match-ended por la misma partida.
  const end = match.end;
  const announcedMatch = useRef<string | null>(null);
  useEffect(() => {
    const reward = end?.rewards[userId];
    if (!end || !reward || announcedMatch.current === end.matchId) return;
    announcedMatch.current = end.matchId;
    emitDueloEvent("duelo:match-ended", { matchId: end.matchId, newRating: reward.newRating });
    // match:end solo trae cuánto oro se ganó; el total lo sabe el api (GET /me).
    void fetchGold(session.token).then((gold) => {
      if (gold !== null) emitDueloEvent("duelo:gold-changed", { gold });
    });
  }, [end, userId, session.token]);

  const you = match.state?.players[userId];
  const rivalId = match.rival?.id;
  const rival = rivalId ? match.state?.players[rivalId] : undefined;
  const visibleNotices = match.notices.filter((n) => n.until > Date.now());

  return (
    <div className="arena">
      <StatusBar connection={match.connection} keyboard={engine.keyboard} />

      {match.error && <div className="ar-panel ar-error">{match.error}</div>}

      {match.phase === "idle" && (
        <div className="ar-panel ar-center">
          <h2>Arena</h2>
          <p className="ar-muted">Dibuja con la pinza: ⚡ zigzag = Rayo, 🛡️ círculo = Escudo.</p>
          <button className="ar-btn ar-btn--primary" onClick={() => client.joinQueue()} disabled={match.connection !== "online"}>
            Buscar rival
          </button>
        </div>
      )}

      {match.phase === "queued" && (
        <div className="ar-panel ar-center">
          <h2>Buscando rival…</h2>
          <p className="ar-muted">
            {match.ratingRange === null ? "Aceptando cualquier rival" : `Rivales a ±${match.ratingRange} puntos`}
          </p>
          <button className="ar-btn" onClick={() => client.leaveQueue()}>
            Cancelar
          </button>
        </div>
      )}

      {inMatch && (
        <div className={`ar-stage ar-stage--${match.phase === "active" || match.phase === "countdown" ? "combat" : "calibration"}`}>
          {!engine.keyboard && (
            <div className="ar-camera">
              <video ref={videoRef} playsInline muted />
              <canvas ref={canvasRef} />
              {engine.status === "loading" && <div className="ar-camera__msg">Cargando cámara y detector de manos…</div>}
            </div>
          )}

          {engine.status === "error" && engine.error && (
            <div className="ar-panel ar-error">
              <p>{engine.error.message}</p>
              <button className="ar-btn" onClick={() => setEngineAttempt((n) => n + 1)}>
                Reintentar
              </button>
            </div>
          )}

          {(match.phase === "found" || match.phase === "ready") && (
            <div className="ar-panel ar-center">
              <h2>Calibración</h2>
              <p className="ar-muted">
                Rival: <strong>{match.rival?.username}</strong> ({match.rival?.rank})
              </p>
              <p>{engine.handVisible ? "✅ Mano detectada. Prueba hacer la pinza." : "✋ Pon la mano frente a la cámara."}</p>
              {!engine.keyboard && (
                <p className="ar-muted">
                  {voice.status === "ready" && "🎤 Micrófono listo: prueba gritar y mira el medidor."}
                  {voice.status === "loading" && "🎤 Pidiendo el micrófono…"}
                  {voice.status === "disabled" && `🎤 ${voice.message}`}
                </p>
              )}
              {match.phase === "found" ? (
                <button className="ar-btn ar-btn--primary" onClick={() => client.ready()} disabled={engine.status !== "running" || !engine.handVisible}>
                  ¡Estoy listo!
                </button>
              ) : (
                <p className="ar-muted">Esperando a que el rival esté listo…</p>
              )}
              <label className="ar-muted ar-row">
                <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Ver puntos de la mano
              </label>
            </div>
          )}

          {(match.phase === "countdown" || match.phase === "active") && (
            <>
              <div className="ar-duel">
                <PlayerPanel
                  side="you"
                  summary={match.you}
                  state={you}
                  now={now}
                  grimoire={grimoire}
                  footer={
                    <UltimateRow
                      ultimateId={ultimateId}
                      voice={voice}
                      keyboard={engine.keyboard}
                      manaFull={(you?.mana ?? 0) >= MATCH_RULES.maxMana}
                      meter={meterRef}
                    />
                  }
                />
                <div className="ar-duel__center">
                  {match.phase === "countdown" && match.startsAt && (
                    <div className="ar-countdown">{Math.max(1, Math.ceil((match.startsAt - now) / 1000))}</div>
                  )}
                  {match.phase === "active" && match.endsAt && (
                    <div className="ar-timer">{Math.max(0, Math.ceil((match.endsAt - now) / 1000))} s</div>
                  )}
                  {/* En combate los avisos van bajo el reloj: así no tapan nombres ni barras. */}
                  <Notices notices={visibleNotices} />
                </div>
                <PlayerPanel side="rival" summary={match.rival} state={rival} now={now} />
              </div>

              {match.sealWarning && <div className="ar-banner ar-banner--bad">¡Te están sellando!</div>}
              {match.opponentGraceUntil !== null && (
                <div className="ar-banner">
                  El rival se desconectó. Esperando{" "}
                  {/* El reloj de pantalla se refresca cada 100 ms: se limita al graceMs real. */}
                  {Math.min(match.opponentGraceMs / 1000, Math.max(0, Math.ceil((match.opponentGraceUntil - now) / 1000)))} s…
                </div>
              )}
            </>
          )}
        </div>
      )}

      {match.phase === "ended" && match.end && (
        <EndScreen end={match.end} userId={userId} onPlayAgain={() => client.backToLobby()} onExit={() => navigate("/ranking")} />
      )}

      {!(match.phase === "countdown" || match.phase === "active") && <Notices notices={visibleNotices} />}
    </div>
  );
}

function Notices({ notices }: { notices: Notice[] }) {
  return (
    <ul className="ar-notices" aria-live="polite">
      {notices.map((n) => (
        <li key={n.id} className={`ar-notice ar-notice--${n.tone}`}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}

function StatusBar({ connection, keyboard }: { connection: string; keyboard: boolean }) {
  if (connection === "online" && !keyboard) return null;
  return (
    <div className="ar-statusbar">
      {connection === "connecting" && <span>Conectando con el servidor…</span>}
      {connection === "reconnecting" && <span className="ar-warn">Conexión perdida. Reconectando…</span>}
      {connection === "unauthorized" && <span className="ar-warn">Tu sesión expiró. Vuelve a iniciar sesión.</span>}
      {keyboard && <span>Modo teclado (pruebas): 1 = Rayo, 2 = Escudo, 0 = fallido</span>}
    </div>
  );
}
