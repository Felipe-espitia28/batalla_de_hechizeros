/**
 * Un hechicero: vida, maná, escudo, efectos y cooldowns. Solo dibuja lo que manda el servidor
 * en match:state; no calcula nada.
 */
import type { PlayerState, PlayerSummary, SpellId } from "@duelo/contracts";
import type { ReactNode } from "react";
import { SPELL_GESTURES, SPELL_LABELS } from "../match/messages";

interface Props {
  summary: PlayerSummary | null;
  state: PlayerState | undefined;
  /** Hora estimada del servidor. */
  now: number;
  side: "you" | "rival";
  /** Nombre a mostrar sin `summary` (el muñeco de la arena de entrenamiento). */
  name?: string;
  /** Solo para el jugador propio: hechizos del grimorio con su cooldown. */
  grimoire?: readonly SpellId[];
  /** Contenido extra al final (el definitivo del jugador propio). */
  footer?: ReactNode;
}

const EFFECT_LABELS = { burn: "🔥 Quemadura", poison: "🐍 Veneno", freeze: "❄️ ¡Congelado!", storm: "🌪️ Tormenta" } as const;

export function PlayerPanel({ summary, state, now, side, name, grimoire, footer }: Props) {
  const hp = state?.hp ?? 100;
  const mana = state?.mana ?? 0;
  const shielded = state?.shieldUntil != null && state.shieldUntil > now;
  const silenced = state?.silencedUntil != null && state.silencedUntil > now;
  const effects = (state?.effects ?? []).filter((e) => e.until > now);

  return (
    <section className={`ar-player ar-player--${side}${shielded ? " ar-player--shielded" : ""}${hp <= 0 ? " ar-player--down" : ""}`}>
      <header className="ar-player__header">
        <span className="ar-player__name">{summary?.username ?? name ?? (side === "you" ? "Tú" : "Rival")}</span>
        {summary && <span className="ar-player__rank">{summary.rank}</span>}
      </header>

      <div className="ar-player__avatar" aria-hidden>
        🧙
        {shielded && <span className="ar-player__shield" />}
      </div>

      <Bar label="Vida" value={hp} max={100} kind="hp" />
      <Bar label="Maná" value={mana} max={100} kind="mana" />

      <ul className="ar-player__effects">
        {shielded && <li className="ar-chip ar-chip--good">🛡️ Escudo</li>}
        {silenced && <li className="ar-chip ar-chip--bad">✖️ Sellado</li>}
        {effects.map((e) => (
          <li key={`${e.type}-${e.until}`} className="ar-chip ar-chip--bad">
            {EFFECT_LABELS[e.type]}
          </li>
        ))}
      </ul>

      {grimoire && (
        <ul className="ar-player__spells">
          {grimoire.map((spellId, i) => {
            const until = state?.cooldownsUntil[spellId];
            const remaining = until && until > now ? (until - now) / 1000 : 0;
            return (
              <li key={spellId} className={`ar-spell${remaining ? " ar-spell--cooling" : ""}`}>
                <span className="ar-spell__name">{SPELL_LABELS[spellId]}</span>
                <span className="ar-spell__hint">
                  {remaining ? `${remaining.toFixed(1)} s` : (SPELL_GESTURES[spellId] ?? `tecla ${i + 1}`)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </section>
  );
}

function Bar({ label, value, max, kind }: { label: string; value: number; max: number; kind: "hp" | "mana" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`ar-bar ar-bar--${kind}`} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <div className="ar-bar__fill" style={{ width: `${pct}%` }} />
      <span className="ar-bar__text">
        {label} {Math.floor(value)}
      </span>
    </div>
  );
}
