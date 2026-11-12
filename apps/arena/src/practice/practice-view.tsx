/**
 * Arena de entrenamiento: el jugador practica sus gestos y su grito contra un muñeco.
 *
 * Usa el mismo módulo local que la partida (cámara + MediaPipe + voz, sección 4), pero los
 * hechizos no viajan al game-server: los resuelve practice-sim.ts en el navegador. Así se
 * practica sin rival, sin conexión y sin tocar el oro ni el rating.
 */
import type { SpellId, UltimateId } from "@duelo/contracts";
import { MATCH_RULES, SPELLS, ULTIMATES } from "@duelo/game-rules";
import type { SpellEvent, SpellFailedEvent, UltimateEvent } from "@duelo/spell-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpellSource } from "../engine/use-spell-source";
import { useVoice } from "../engine/use-voice";
import { ACK_ERROR_MESSAGES, SPELL_LABELS } from "../match/messages";
import { PlayerPanel } from "../ui/player-panel";
import { UltimateRow } from "../ui/ultimate-row";
import { useNow } from "../ui/use-now";
import {
  advance,
  castSpell,
  castUltimate,
  createPractice,
  failSpell,
  resetDummy,
  sealCancel,
  sealCharging,
  setInfiniteMana,
  setLoadout,
  toPlayerState,
  type PracticeResult,
} from "./practice-sim";

interface Props {
  grimoire: readonly SpellId[];
  ultimateId: UltimateId;
  onExit: () => void;
}

interface LogEntry {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
}

/** Intentos visibles en el historial: los últimos bastan para corregir el gesto. */
const LOG_SIZE = 6;
const formatConfidence = (value: number) => value.toFixed(2).replace(".", ",");

export function PracticeView({ grimoire, ultimateId, onExit }: Props) {
  // El simulador vive en una ref: lo mutan los eventos del reconocedor y el reloj lo dibuja.
  const sim = useRef(createPractice(grimoire, ultimateId, Date.now()));
  useEffect(() => setLoadout(sim.current, grimoire, ultimateId), [grimoire, ultimateId]);

  const now = useNow(Date.now, true);
  advance(sim.current, now);

  const [log, setLog] = useState<LogEntry[]>([]);
  const nextId = useRef(0);
  const push = useCallback((text: string, tone: LogEntry["tone"]) => {
    const entry = { id: nextId.current++, text, tone };
    setLog((current) => [entry, ...current].slice(0, LOG_SIZE));
  }, []);

  const report = useCallback(
    (label: string, result: PracticeResult, detail: string) => {
      if (!result.ok) {
        push(`${label} · ${ACK_ERROR_MESSAGES[result.code]}`, "bad");
        return;
      }
      const effect = result.outcome === "self" ? "sobre ti" : `${result.damage} de daño`;
      push(`${label} · ${detail}${effect}`, "good");
    },
    [push],
  );

  // --- Módulo local (el mismo de la partida) -------------------------------------
  const [debug, setDebug] = useState(false);
  const [engineAttempt, setEngineAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const onUltimate = useCallback(
    ({ ultimateId: id, transcript }: UltimateEvent) => {
      const result = castUltimate(sim.current, id, transcript, Date.now());
      // Diferencia con la partida: aquí el Vacío púrpura no exige vida ≤ 30; se recuerda.
      const note = id === "purple-void" && result.ok ? " (en partida exige vida ≤ 30)" : "";
      report(SPELL_LABELS[id], result, `«${transcript}» · `);
      if (note) push(`🟣 Recuerda${note}`, "info");
    },
    [report, push],
  );

  const engine = useSpellSource({
    enabled: true,
    grimoire,
    ultimateId,
    minConfidence: MATCH_RULES.minConfidence,
    debug,
    video: videoRef,
    canvas: canvasRef,
    attempt: engineAttempt,
    handlers: {
      onSpell({ spellId, confidence }: SpellEvent) {
        const result = castSpell(sim.current, spellId, confidence, Date.now());
        report(SPELL_LABELS[spellId], result, `confianza ${formatConfidence(confidence)} · `);
      },
      onSpellFailed({ bestGuess, confidence }: SpellFailedEvent) {
        failSpell(sim.current, Date.now());
        const guess = bestGuess ? ` Parecía ${SPELL_LABELS[bestGuess]} (${formatConfidence(confidence)}).` : "";
        push(`¡Hechizo fallido!${guess} Hace falta ${formatConfidence(MATCH_RULES.minConfidence)}.`, "bad");
      },
      // Solo en modo teclado (tecla 9); con micrófono lo emite useVoice.
      onUltimate,
      onSealCharging() {
        sealCharging(sim.current, Date.now());
        push("✖️ Cargando el Sello… sostén la X", "info");
      },
      onSealCancel() {
        sealCancel(sim.current);
        push("Sello cancelado: separaste las manos antes de tiempo", "info");
      },
    },
  });

  const meterRef = useRef<HTMLDivElement>(null);
  const voice = useVoice({ enabled: !engine.keyboard, ultimateId, meter: meterRef, onUltimate });

  // --- Controles -------------------------------------------------------------------
  const [infiniteMana, setInfinite] = useState(false);
  const toggleInfiniteMana = (enabled: boolean) => {
    setInfinite(enabled);
    setInfiniteMana(sim.current, enabled);
  };

  const { player, dummy, stats } = sim.current;
  const playerState = toPlayerState(player, now);
  const dummyState = toPlayerState(dummy, now);
  const ultimate = ULTIMATES[ultimateId];

  return (
    <div className="ar-stage ar-stage--combat">
      {!engine.keyboard && (
        <div className="ar-camera">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} />
          {engine.status === "loading" && <div className="ar-camera__msg">Cargando cámara y detector de manos…</div>}
          {engine.status === "running" && !engine.handVisible && (
            <div className="ar-camera__msg">✋ Pon la mano frente a la cámara</div>
          )}
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

      <div className="ar-duel">
        <PlayerPanel
          side="you"
          summary={null}
          state={playerState}
          now={now}
          grimoire={grimoire}
          footer={
            <UltimateRow
              ultimateId={ultimateId}
              voice={voice}
              keyboard={engine.keyboard}
              manaFull={playerState.mana >= MATCH_RULES.maxMana}
              meter={meterRef}
            />
          }
        />
        <div className="ar-duel__center ar-practice__center">
          <h2>Entrenamiento</h2>
          <dl className="ar-practice__stats">
            <div>
              <dt>Lanzados</dt>
              <dd>{stats.casts}</dd>
            </div>
            <div>
              <dt>Fallidos</dt>
              <dd>{stats.failed}</dd>
            </div>
            <div>
              <dt>KOs</dt>
              <dd>{stats.kos}</dd>
            </div>
          </dl>
          <label className="ar-row ar-muted">
            <input type="checkbox" checked={infiniteMana} onChange={(e) => toggleInfiniteMana(e.target.checked)} /> Maná
            infinito
          </label>
          <label className="ar-row ar-muted">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Ver puntos de la mano
          </label>
          <button className="ar-btn" onClick={() => resetDummy(sim.current)}>
            Reiniciar muñeco
          </button>
          <button className="ar-btn" onClick={onExit}>
            Salir
          </button>
        </div>
        <PlayerPanel side="rival" name="🎯 Muñeco de práctica" summary={null} state={dummyState} now={now} />
      </div>

      <div className="ar-practice__info">
        <section className="ar-panel">
          <h3>Últimos intentos</h3>
          {log.length === 0 ? (
            <p className="ar-muted">Haz la pinza y dibuja un gesto: aquí verás qué detectó y con qué confianza.</p>
          ) : (
            <ul className="ar-practice__log" aria-live="polite">
              {log.map((entry) => (
                <li key={entry.id} className={`ar-practice__entry ar-practice__entry--${entry.tone}`}>
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ar-panel">
          <h3>Cómo se lanza cada hechizo</h3>
          <ul className="ar-practice__guide">
            {grimoire.map((spellId) => {
              const def = SPELLS[spellId];
              const cooldown = def.cooldownMs === null ? "1 vez por partida" : `${def.cooldownMs / 1000} s`;
              return (
                <li key={spellId}>
                  <strong>{SPELL_LABELS[spellId]}</strong>
                  <span>{def.gestureDescription}</span>
                  <span className="ar-muted">
                    {def.manaCost} de maná · {cooldown}
                  </span>
                </li>
              );
            })}
            <li>
              <strong>{SPELL_LABELS[ultimateId]}</strong>
              <span>{ultimate.gestureDescription}</span>
              <span className="ar-muted">{ultimate.manaCost} de maná (lleno) · volumen alto + palabra</span>
            </li>
          </ul>
          <p className="ar-muted">
            Solo se reconocen los hechizos de tu grimorio; cámbialo en la Tienda. Aquí no ganas oro ni puntos.
          </p>
        </section>
      </div>
    </div>
  );
}
