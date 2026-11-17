/**
 * Arena de entrenamiento: el jugador practica sus gestos y su grito contra un muñeco.
 *
 * Usa el mismo módulo local que la partida (cámara + MediaPipe + voz, sección 4), pero los
 * hechizos no viajan al game-server: los resuelve practice-sim.ts en el navegador. Así se
 * practica sin rival, sin conexión y sin tocar el oro ni el rating.
 *
 * Diseño: Figma "Arena · Entrenamiento". Arriba "Tú" (cámara, barras y hechizos), los controles
 * y el muñeco; abajo los últimos intentos y la guía de gestos.
 */
import type { SpellId, UltimateId } from "@duelo/contracts";
import { MATCH_RULES, SPELLS, ULTIMATES } from "@duelo/game-rules";
import type { SpellEvent, SpellFailedEvent, UltimateEvent } from "@duelo/spell-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { UI_ASSETS_PATH } from "../config";
import { useSpellSource } from "../engine/use-spell-source";
import { useVoice } from "../engine/use-voice";
import { ACK_ERROR_MESSAGES, SPELL_LABELS } from "../match/messages";
import { SpellRows, StatBars, StatusEffects, UltimateLine } from "../ui/duel-parts";
import { SpellGlyph } from "../ui/spell-glyph";
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
    <div className="ar-training">
      <div className="ar-training__top">
        {/* --- Tú: cámara, barras y hechizos --- */}
        <section className="ar-training__card ar-training__you" aria-labelledby="ar-training-you">
          {/* El <video> es siempre el mismo elemento: si se desmontara, la cámara quedaría en negro. */}
          {!engine.keyboard && (
            <div className={`ar-camera ar-training__camera${playerState.shieldUntil ? " ar-training__camera--shielded" : ""}`}>
              <video ref={videoRef} playsInline muted />
              <canvas ref={canvasRef} />
              {engine.status === "loading" && (
                <div className="ar-training__loading" role="status">
                  <img src={`${UI_ASSETS_PATH}/entrenamiento/cargando.png`} width={16} height={16} alt="" aria-hidden="true" />
                  <span>Cargando cámara y detector de manos…</span>
                </div>
              )}
              {engine.status === "running" && !engine.handVisible && (
                <div className="ar-camera__hint">✋ Pon la mano frente a la cámara</div>
              )}
            </div>
          )}

          {engine.status === "error" && engine.error && (
            <div className="ar-training__error" role="alert">
              <p>{engine.error.message}</p>
              <button className="ar-training__btn" onClick={() => setEngineAttempt((n) => n + 1)}>
                Reintentar
              </button>
            </div>
          )}

          <h2 id="ar-training-you" className="ar-training__title">
            Tú
          </h2>
          <StatBars hp={playerState.hp} mana={playerState.mana} />
          <StatusEffects state={playerState} now={now} />

          <ul className="ar-training__spells">
            <SpellRows grimoire={grimoire} cooldownsUntil={playerState.cooldownsUntil} now={now} keyboard={engine.keyboard} />
            <UltimateLine
              ultimateId={ultimateId}
              voice={voice}
              keyboard={engine.keyboard}
              manaFull={playerState.mana >= MATCH_RULES.maxMana}
              meter={meterRef}
            />
          </ul>
        </section>

        {/* --- Controles --- */}
        <section className="ar-training__card ar-training__controls" aria-labelledby="ar-training-controls">
          <h2 id="ar-training-controls" className="ar-training__title">
            Entrenamiento
          </h2>
          <dl className="ar-training__stats">
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
              <dd className="ar-training__kos">{stats.kos}</dd>
            </div>
          </dl>
          <div className="ar-training__options">
            <label className="ar-training__check">
              <input type="checkbox" checked={infiniteMana} onChange={(e) => toggleInfiniteMana(e.target.checked)} />
              <span className="ar-training__box" aria-hidden="true" />
              Maná infinito
            </label>
            <label className="ar-training__check">
              <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
              <span className="ar-training__box" aria-hidden="true" />
              Ver puntos de la mano
            </label>
          </div>
          <div className="ar-training__actions">
            <button className="ar-training__btn" onClick={() => resetDummy(sim.current)}>
              Reiniciar muñeco
            </button>
            <button className="ar-training__btn ar-training__btn--ghost" onClick={onExit}>
              Salir
            </button>
          </div>
        </section>

        {/* --- Muñeco --- */}
        <section className="ar-training__card ar-training__dummy" aria-labelledby="ar-training-dummy">
          <h2 id="ar-training-dummy" className="ar-training__title">
            Muñeco de práctica
          </h2>
          <div className="ar-training__figure">
            <img src={`${UI_ASSETS_PATH}/entrenamiento/mago.png`} width={144} height={142} alt="Muñeco de práctica" />
          </div>
          <StatBars hp={dummyState.hp} mana={dummyState.mana} />
          <StatusEffects state={dummyState} now={now} />
        </section>
      </div>

      <div className="ar-training__bottom">
        <section className="ar-training__card ar-training__log-card" aria-labelledby="ar-training-log">
          <h2 id="ar-training-log" className="ar-training__title">
            Últimos intentos
          </h2>
          {log.length === 0 ? (
            <p className="ar-training__muted">Haz la pinza y dibuja un gesto: aquí verás qué detectó y con qué confianza.</p>
          ) : (
            <ul className="ar-training__log" aria-live="polite">
              {log.map((entry) => (
                <li key={entry.id} className={`ar-training__entry ar-training__entry--${entry.tone}`}>
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ar-training__card" aria-labelledby="ar-training-guide">
          <h2 id="ar-training-guide" className="ar-training__title">
            Cómo se lanza cada hechizo
          </h2>
          <ul className="ar-training__guide">
            {grimoire.map((spellId) => {
              const def = SPELLS[spellId];
              const cooldown = def.cooldownMs === null ? "1 vez por partida" : `${def.cooldownMs / 1000} s`;
              return (
                <GuideItem key={spellId} id={spellId} name={def.name} cost={`${def.manaCost} de maná · ${cooldown}`}>
                  {def.gestureDescription}
                </GuideItem>
              );
            })}
            <GuideItem id={ultimateId} name={ultimate.name} cost={`${ultimate.manaCost} de maná (lleno) · volumen alto + palabra`}>
              {ultimate.gestureDescription}
            </GuideItem>
          </ul>
          <p className="ar-training__note">
            Sólo se reconocen los hechizos de tu grimorio; cámbialo en la Tienda. Aquí no ganas oro ni puntos.
          </p>
        </section>
      </div>
    </div>
  );
}

function GuideItem({ id, name, cost, children }: { id: SpellId | UltimateId; name: string; cost: string; children: string }) {
  return (
    <li className="ar-training__guide-item">
      <span className="ar-training__guide-head">
        <SpellGlyph id={id} />
        <strong>{name}</strong>
        <span className="ar-training__guide-cost">{cost}</span>
      </span>
      <span className="ar-training__guide-text">{children}</span>
    </li>
  );
}
