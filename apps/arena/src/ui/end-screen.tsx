/**
 * Resultado de la partida (Figma "Arena · Victoria" y "Arena · Derrota"): título, motivo, puntos
 * de rango con el grado nuevo, oro ganado y, en la derrota, el último hechizo que te golpeó.
 * Todo sale de match:end y de lo que ya mandó el servidor; aquí no se calcula ninguna recompensa.
 */
import type { MatchEndPayload, UserId } from "@duelo/contracts";
import { SPELLS, ULTIMATES } from "@duelo/game-rules";
import { UI_ASSETS_PATH } from "../config";
import type { LastHit } from "../match/match-client";
import { END_REASON_MESSAGES } from "../match/messages";
import { SpellGlyph } from "./spell-glyph";

interface Props {
  end: MatchEndPayload;
  userId: UserId;
  /** Último golpe directo del rival; solo se muestra en la derrota. */
  lastHit: LastHit | null;
  onPlayAgain: () => void;
  onExit: () => void;
}

export function EndScreen({ end, userId, lastHit, onPlayAgain, onExit }: Props) {
  const reward = end.rewards[userId];
  // Sin recompensas = el servidor canceló la partida (nadie confirmó la calibración).
  if (!reward) {
    return (
      <section className="ar-result ar-result--draw" aria-labelledby="ar-result-title">
        <div className="ar-result__head">
          <h2 id="ar-result-title" className="ar-result__title">
            Partida cancelada
          </h2>
          <p className="ar-result__reason">Ningún jugador confirmó a tiempo. No cuenta para el ranking.</p>
        </div>
        <div className="ar-result__actions">
          <button className="ar-result__btn ar-result__btn--primary" onClick={onPlayAgain}>
            Buscar otra partida
          </button>
        </div>
      </section>
    );
  }

  const tone = end.winnerId === null ? "draw" : end.winnerId === userId ? "win" : "loss";
  const title = tone === "draw" ? "Empate" : tone === "win" ? "¡Victoria!" : "Derrota";
  const ratingTone = reward.ratingDelta > 0 ? "up" : reward.ratingDelta < 0 ? "down" : "even";

  return (
    <section className={`ar-result ar-result--${tone}`} aria-labelledby="ar-result-title">
      <div className="ar-result__head">
        <h2 id="ar-result-title" className="ar-result__title">
          {title}
        </h2>
        <p className="ar-result__reason">{END_REASON_MESSAGES[end.reason]}</p>
      </div>

      <dl className="ar-result__stats">
        <div className="ar-result__stat ar-result__stat--rating">
          <dt>Puntos de rango</dt>
          <dd>
            <span className={`ar-result__value ar-result__value--${ratingTone}`}>
              {signed(reward.ratingDelta)} → {reward.newRating}
            </span>
            <span className="ar-result__rank">{reward.newRank}</span>
          </dd>
        </div>
        <div className="ar-result__stat ar-result__stat--gold">
          <dt>Oro arcano</dt>
          <dd>
            <span className="ar-result__value ar-result__value--gold">{signed(reward.goldDelta)}</span>
          </dd>
        </div>
      </dl>

      <div className="ar-result__actions">
        <button className="ar-result__btn ar-result__btn--primary" onClick={onPlayAgain}>
          Jugar otra vez
        </button>
        <button className="ar-result__btn" onClick={onExit}>
          Ver ranking
        </button>
      </div>

      {tone === "loss" && lastHit && (
        <p className="ar-result__hit">
          <span>Te golpeó</span>
          {/* El Figma dibuja la Bola de fuego a 17 px; los demás usan el icono de la Arena a ese tamaño. */}
          {lastHit.spellId === "fireball" ? (
            <img src={`${UI_ASSETS_PATH}/duelo/bola-de-fuego.svg`} width={17} height={17} alt="" aria-hidden="true" />
          ) : (
            <SpellGlyph id={lastHit.spellId} size={17} />
          )}
          <span>
            {spellName(lastHit.spellId)} −{lastHit.damage}
          </span>
        </p>
      )}
    </section>
  );
}

function spellName(id: LastHit["spellId"]): string {
  return id in SPELLS ? SPELLS[id as keyof typeof SPELLS].name : ULTIMATES[id as keyof typeof ULTIMATES].name;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
