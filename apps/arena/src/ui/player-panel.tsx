/**
 * Un hechicero en la partida (Figma "Arena · Duelo en curso"): nombre y grado, vida, maná,
 * efectos y, para el jugador propio, los hechizos del grimorio con su cooldown. Solo dibuja lo
 * que manda el servidor en match:state; no calcula nada.
 *
 * La cámara del jugador no vive aquí: es el primer hijo de .ar-stage (ver arena.css) y el CSS la
 * coloca encima de este panel, dentro de la misma tarjeta.
 */
import type { PlayerState, PlayerSummary, SpellId } from "@duelo/contracts";
import type { ReactNode } from "react";
import { UI_ASSETS_PATH } from "../config";
import { SpellRows, StatBars, StatusEffects } from "./duel-parts";

interface Props {
  summary: PlayerSummary | null;
  state: PlayerState | undefined;
  /** Hora estimada del servidor. */
  now: number;
  side: "you" | "rival";
  /** true cuando no hay cámara (modo teclado): se dibuja el mago en su lugar. El rival siempre lo lleva. */
  avatar?: boolean;
  /** Modo teclado: los hechizos muestran su tecla en vez del gesto. */
  keyboard?: boolean;
  /** Solo para el jugador propio: hechizos del grimorio con su cooldown. */
  grimoire?: readonly SpellId[];
  /** Fila extra al final de la lista de hechizos (el definitivo del jugador propio). */
  footer?: ReactNode;
}

export function PlayerPanel({ summary, state, now, side, avatar = side === "rival", keyboard = false, grimoire, footer }: Props) {
  const hp = state?.hp ?? 100;
  const mana = state?.mana ?? 0;
  const shielded = state?.shieldUntil != null && state.shieldUntil > now;
  const titleId = `ar-fighter-${side}`;

  return (
    <section
      className={`ar-fighter ar-fighter--${side}${shielded ? " ar-fighter--shielded" : ""}${hp <= 0 ? " ar-fighter--down" : ""}`}
      aria-labelledby={titleId}
    >
      <header className="ar-fighter__identity">
        <h2 id={titleId} className="ar-fighter__name">
          {summary?.username ?? (side === "you" ? "Tú" : "Rival")}
        </h2>
        {summary && <span className="ar-fighter__rank">{summary.rank}</span>}
      </header>

      {avatar && (
        <div className="ar-fighter__figure">
          <img src={`${UI_ASSETS_PATH}/duelo/mago.png`} width={144} height={145} alt="" aria-hidden="true" />
        </div>
      )}

      <StatBars hp={hp} mana={mana} />
      <StatusEffects state={state} now={now} />

      {grimoire && (
        <ul className="ar-training__spells">
          <SpellRows grimoire={grimoire} cooldownsUntil={state?.cooldownsUntil ?? {}} now={now} keyboard={keyboard} />
          {footer}
        </ul>
      )}
    </section>
  );
}
