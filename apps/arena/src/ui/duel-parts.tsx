/**
 * Piezas que comparten la partida (Figma "Arena · Duelo en curso") y el entrenamiento
 * ("Arena · Entrenamiento"): barras de vida y maná, efectos activos, hechizos del grimorio y la
 * fila del definitivo con su medidor de voz. Solo dibujan el estado que reciben; no calculan nada.
 * Conservan las clases ar-training__* porque el estilo de los dos diseños es el mismo.
 */
import type { PlayerState, SpellId, UltimateId } from "@duelo/contracts";
import { SPELLS, ULTIMATES } from "@duelo/game-rules";
import type { RefObject } from "react";
import type { VoiceState } from "../engine/use-voice";
import { SPELL_GESTURES } from "../match/messages";
import { SpellGlyph } from "./spell-glyph";

const EFFECT_LABELS = { burn: "🔥 Quemadura", poison: "🐍 Veneno", freeze: "❄️ Congelado", storm: "🌪️ Tormenta" } as const;

/** Vida y maná con etiqueta y valor encima de una barra de 7 px (diseño "Tu vida y maná"). */
export function StatBars({ hp, mana }: { hp: number; mana: number }) {
  return (
    <div className="ar-training__bars">
      <Bar label="Vida" value={hp} kind="hp" />
      <Bar label="Maná" value={mana} kind="mana" />
    </div>
  );
}

function Bar({ label, value, kind }: { label: string; value: number; kind: "hp" | "mana" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="ar-training__bar">
      <div className="ar-training__bar-head">
        <span>{label}</span>
        <strong>{Math.floor(value)}</strong>
      </div>
      <div
        className={`ar-training__track ar-training__track--${kind}`}
        role="meter"
        aria-label={label}
        aria-valuenow={Math.floor(value)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="ar-training__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Escudo, sello y efectos activos; no ocupa espacio si no hay ninguno. */
export function StatusEffects({ state, now }: { state: PlayerState | undefined; now: number }) {
  if (!state) return null;
  const shielded = state.shieldUntil != null && state.shieldUntil > now;
  const silenced = state.silencedUntil != null && state.silencedUntil > now;
  const effects = state.effects.filter((e) => e.until > now);
  if (!shielded && !silenced && effects.length === 0) return null;
  return (
    <ul className="ar-training__effects">
      {shielded && <li className="ar-chip ar-chip--good">🛡️ Escudo</li>}
      {silenced && <li className="ar-chip ar-chip--bad">✖️ Sellado</li>}
      {effects.map((e) => (
        <li key={`${e.type}-${e.until}`} className="ar-chip ar-chip--bad">
          {EFFECT_LABELS[e.type]}
        </li>
      ))}
    </ul>
  );
}

/** Una fila por hechizo del grimorio: icono, nombre y gesto (o tecla, o el cooldown que queda). */
export function SpellRows(props: {
  grimoire: readonly SpellId[];
  cooldownsUntil: PlayerState["cooldownsUntil"];
  now: number;
  keyboard: boolean;
}) {
  return (
    <>
      {props.grimoire.map((spellId, index) => {
        const until = props.cooldownsUntil[spellId];
        const remaining = until && until > props.now ? (until - props.now) / 1000 : 0;
        return (
          <li key={spellId} className={`ar-training__spell${remaining ? " ar-training__spell--cooling" : ""}`}>
            <span className="ar-training__spell-head">
              <SpellGlyph id={spellId} />
              <span className="ar-training__spell-name">{SPELLS[spellId].name}</span>
              <span className="ar-training__spell-hint">
                {remaining ? `${remaining.toFixed(1)} s` : props.keyboard ? `tecla ${index + 1}` : (SPELL_GESTURES[spellId] ?? "")}
              </span>
            </span>
          </li>
        );
      })}
    </>
  );
}

/**
 * Fila del definitivo con el medidor de voz (mismo --level / data-shout que usa useVoice).
 * "Maná lleno" es solo una pista visual: en partida quien decide es el servidor.
 */
export function UltimateLine(props: {
  ultimateId: UltimateId;
  voice: VoiceState;
  keyboard: boolean;
  manaFull: boolean;
  meter: RefObject<HTMLDivElement | null>;
}) {
  const word = ULTIMATES[props.ultimateId].acceptedWords[0] ?? "";
  const how = props.keyboard ? "tecla 9" : `grita «¡${word}!»`;
  return (
    <li className={`ar-training__spell ar-training__spell--ultimate${props.manaFull ? " ar-training__spell--ready" : ""}`}>
      <span className="ar-training__spell-head">
        <SpellGlyph id={props.ultimateId} />
        <span className="ar-training__spell-name">{ULTIMATES[props.ultimateId].name}</span>
        <span className="ar-training__spell-hint">{props.manaFull ? `¡Maná lleno! ${how}` : `${how} con el maná lleno`}</span>
      </span>
      {!props.keyboard && props.voice.status === "disabled" && <p className="ar-training__voice-off">{props.voice.message}</p>}
      {!props.keyboard && props.voice.status !== "disabled" && (
        <div className="ar-meter ar-training__meter" ref={props.meter} aria-hidden>
          <div className="ar-meter__fill" />
        </div>
      )}
    </li>
  );
}
